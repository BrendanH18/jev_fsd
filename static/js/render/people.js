// Pedestrians. Each person is one vertex-colored skinned mesh with a shaped torso, head, jointed arms
// and legs: hips and knees, shoulders and elbows swing through a walk cycle driven by the distance
// walked, so feet do not slide. Clothes, skin, hair, height, and build vary; some carry a backpack,
// and in the rain most walk under an umbrella. Children (off a school bus) are smaller, and carry a
// backpack. People far from the camera are not drawn.

import * as THREE from "three";
import { shareActorResources } from "./actor-resources.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash01 } from "./geo.js";

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd9a47e, 0x6b4226];
const TOPS = [
  0x2b4c7e, 0x9b2c2c, 0x2f6b4f, 0xc9a227, 0x4c3a73, 0x1a1d22, 0xe2e4e8, 0x6b4a2b, 0x4a5568, 0x9c2e62, 0x7a8a99,
  0x2c2c2c,
];
const BOTTOMS = [0x1a202c, 0x2d3748, 0x2c4a73, 0x4a5568, 0x5c4630, 0x6d7885, 0x222222];
const HAIR = [0x1a1a1a, 0x3b2314, 0x6b4423, 0xa0522d, 0xd4b483, 0x9e9e9e, 0x2a1a10];
const SHOES = [0x111111, 0x3a2a1a, 0xe8e8e8, 0x2a2f38];
const UMBRELLAS = [0x111111, 0x1f3a64, 0x8a1c1c, 0x2d5a3d, 0x5a3d7a, 0xd8b030];
const DRAW_WITHIN_M = 130;
const HIP = 0.92;

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
shareActorResources([material]);

// Give a geometry one flat vertex color.
function tint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute("uv");
  return g;
}

// A limb segment hanging down from its joint (the origin), `len` long.
const segment = (r0, r1, len) => new THREE.CylinderGeometry(r0, r1, len, 8).translate(0, -len / 2, 0);
const ball = (r) => new THREE.SphereGeometry(r, 8, 6);

// (`worker`: a hi-vis vest over the top, as a tow truck's operator wears)
export function createPersonMesh(look = 0, { child = false, worker = false } = {}) {
  const k = (i) => hash01(String(look), i);
  const pick = (list, i) => list[Math.floor(k(i) * list.length)];
  const skin = pick(SKIN, 1),
    top = worker ? 0xd8ff1e : pick(TOPS, 2),
    bottom = pick(BOTTOMS, 3),
    hair = pick(HAIR, 4),
    shoes = pick(SHOES, 6);
  const height = child ? 0.62 + k(5) * 0.14 : 0.9 + k(5) * 0.18,
    build = 0.9 + k(7) * 0.25;
  const longHair = k(8) < 0.35,
    backpack = child || k(9) < 0.25,
    coat = k(10) < 0.4;

  // the rigid body: pelvis, torso, neck, head, hair, backpack (local +x is forward)
  const parts = [
    tint(new THREE.CylinderGeometry(0.155, 0.15, 0.16, 10).scale(0.7, 1, 1).translate(0, 0.94, 0), bottom),
    tint(
      new THREE.CylinderGeometry(0.2, 0.155, coat ? 0.68 : 0.52, 12)
        .scale(0.62, 1, 1)
        .translate(0, coat ? 1.2 : 1.27, 0),
      top,
    ),
    tint(
      new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.62, 0.35, 1).translate(0, 1.52, 0),
      top,
    ), // shoulders
    tint(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 8).translate(0, 1.58, 0), skin),
    tint(ball(0.105).scale(1, 1.18, 0.92).translate(0.01, 1.72, 0), skin),
    tint(
      new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55)
        .scale(1.02, 1.1, 0.98)
        .translate(-0.005, 1.735, 0),
      hair,
    ),
  ];
  if (longHair)
    parts.push(
      tint(
        new THREE.CylinderGeometry(0.1, 0.085, 0.24, 10, 1, true, Math.PI * 0.5, Math.PI).translate(-0.02, 1.64, 0),
        hair,
      ),
    );
  if (backpack)
    parts.push(
      tint(
        new THREE.BoxGeometry(0.14, 0.36, 0.28).translate(-0.19, 1.3, 0),
        pick([0x1a1a1a, 0x7a2a2a, 0x2a4a7a, 0x3a5a3a], 11),
      ),
    );
  const torso = mergeGeometries(parts, false).translate(0, -HIP, 0);
  const bones = [],
    sections = [];
  const joint = (parent, x, y, z, geo) => {
    const pivot = new THREE.Bone();
    pivot.position.set(x, y, z);
    parent?.add(pivot);
    pivot.updateWorldMatrix(true, false);
    // Each section moves rigidly with this joint. Store its vertices in the common bind pose.
    sections.push(geo.applyMatrix4(pivot.matrixWorld));
    bones.push(pivot);
    return pivot;
  };
  const body = joint(null, 0, HIP, 0, torso); // bobs with each step, leans on a bike
  const legs = [],
    arms = [];
  for (const side of [-1, 1]) {
    const hip = joint(body, 0, 0, side * 0.085, tint(segment(0.075 * build, 0.058, 0.43), bottom));
    const knee = joint(
      hip,
      0,
      -0.43,
      0,
      mergeGeometries(
        [
          tint(segment(0.056, 0.042, 0.43), bottom),
          tint(new THREE.BoxGeometry(0.24, 0.07, 0.095).translate(0.05, -0.46, 0), shoes),
        ],
        false,
      ),
    );
    legs.push({ hip, knee, side });
    const shoulder = joint(
      body,
      0,
      1.48 - HIP,
      side * 0.2 * build,
      tint(segment(0.047, 0.04, 0.29), coat ? top : pick([top, skin], 12)),
    );
    const elbow = joint(
      shoulder,
      0,
      -0.29,
      0,
      mergeGeometries(
        [tint(segment(0.04, 0.033, 0.25), coat ? top : skin), tint(ball(0.042).translate(0, -0.28, 0), skin)],
        false,
      ),
    );
    arms.push({ shoulder, elbow, side });
  }
  // Append the umbrella at its bind position. Closing it shortens the same draw.
  const canopy = new THREE.ConeGeometry(0.55, 0.22, 10, 1, true).translate(0, 0.11, 0);
  const umbrella = mergeGeometries(
    [
      tint(canopy, pick(UMBRELLAS, 13)),
      tint(new THREE.CylinderGeometry(0.01, 0.01, 0.8, 5).translate(0, -0.3, 0), 0x333333),
    ],
    false,
  ).translate(0.12, 1.98, 0.16);
  const geometry = mergeGeometries([...sections, umbrella], false);
  const count = geometry.attributes.position.count;
  const indices = new Uint8Array(count * 4),
    weights = new Uint8Array(count * 4);
  let vertex = 0;
  for (const [index, section] of sections.entries()) {
    const end = vertex + section.attributes.position.count;
    for (; vertex < end; vertex++) indices[4 * vertex] = index;
  }
  // The umbrella's remaining indices already point to the body (bone zero).
  for (let i = 0; i < count; i++) weights[4 * i] = 1;
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
  geometry.setDrawRange(0, vertex);
  const g = new THREE.SkinnedMesh(geometry, material);
  g.add(body);
  g.bind(new THREE.Skeleton(bones));
  // Bounds in person space enclose the longest arm reach, stride and open umbrella in every pose.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, HIP, 0), 1.5);
  g.castShadow = true;
  g.receiveShadow = true;
  g.scale.setScalar(height);
  g.userData = { legs, arms, body, umbrellaStart: vertex, carries: k(14) < 0.75 };
  return g;
}

// Follow the simulation: place, face, and animate. `camera` culls the far ones; `rain` opens the
// umbrellas.
export function syncPerson(mesh, ped, camera, rain = false) {
  const far =
    Math.abs(ped.x - camera.position.x) > DRAW_WITHIN_M || Math.abs(-ped.y - camera.position.z) > DRAW_WITHIN_M;
  mesh.visible = !far;
  if (far) return;
  mesh.position.set(ped.x, 0, -ped.y);
  mesh.rotation.y = ped.psi;
  mesh.rotation.x = ped.frozen > 0 ? Math.PI / 2 : 0; // knocked down
  const u = mesh.userData;
  const moving = !(ped.frozen > 0) && ped.v > 0.1;
  const phi = Number.isFinite(ped.phase) ? ped.phase * 4.2 : 0;
  const stride = moving ? Math.min(1, ped.v / 1.3) : 0;
  const umbrellaUp = rain && u.carries && !(ped.frozen > 0);
  mesh.geometry.setDrawRange(0, umbrellaUp ? Infinity : u.umbrellaStart);
  for (const { hip, knee, side } of u.legs) {
    const p = phi + (side > 0 ? Math.PI : 0);
    hip.rotation.z = 0.42 * stride * Math.sin(p);
    // the knee bends as the leg swings through, and stays nearly straight while it carries weight
    knee.rotation.z = -stride * (0.08 + 0.75 * Math.max(0, Math.sin(p + 1.2)) ** 2);
  }
  for (const { shoulder, elbow, side } of u.arms) {
    const p = phi + (side > 0 ? 0 : Math.PI);
    if (umbrellaUp && side > 0) {
      shoulder.rotation.z = 0.5;
      shoulder.rotation.x = 0.25;
      elbow.rotation.z = 1.3;
      continue;
    }
    shoulder.rotation.x = side * 0.06;
    shoulder.rotation.z = 0.32 * stride * Math.sin(p);
    elbow.rotation.z = 0.25 + 0.25 * stride * Math.max(0, Math.sin(p));
  }
  u.body.position.y = HIP + (moving ? 0.025 * Math.abs(Math.cos(phi)) * stride : 0);
}

// A person seated on a bicycle: leaning over the bars, hands on the grips, feet on the pedals.
// `crank` is the crank angle (rad).
export function poseRider(mesh, crank) {
  const u = mesh.userData;
  u.body.rotation.z = -0.55;
  for (const { hip, knee, side } of u.legs) {
    const c = crank + (side > 0 ? Math.PI : 0);
    hip.rotation.z = 1.05 + 0.4 * Math.sin(c);
    knee.rotation.z = -1.25 - 0.45 * Math.cos(c);
  }
  for (const { shoulder, elbow, side } of u.arms) {
    shoulder.rotation.z = 1.25;
    shoulder.rotation.x = side * 0.1;
    elbow.rotation.z = 0.35;
  }
  mesh.geometry.setDrawRange(0, u.umbrellaStart);
}
