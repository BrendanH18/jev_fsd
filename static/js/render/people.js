// Pedestrians. Each person is a shaped torso and head (one mesh, vertex-colored) with jointed arms
// and legs: hips and knees, shoulders and elbows swing through a walk cycle driven by the distance
// walked, so feet do not slide. Clothes, skin, hair, height, and build vary; some carry a backpack,
// and in the rain most walk under an umbrella. People far from the camera are not drawn.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash01 } from "./geo.js";

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd9a47e, 0x6b4226];
const TOPS = [0x2b4c7e, 0x9b2c2c, 0x2f6b4f, 0xc9a227, 0x4c3a73, 0x1a1d22, 0xe2e4e8, 0x6b4a2b, 0x4a5568, 0x9c2e62, 0x7a8a99, 0x2c2c2c];
const BOTTOMS = [0x1a202c, 0x2d3748, 0x2c4a73, 0x4a5568, 0x5c4630, 0x6d7885, 0x222222];
const HAIR = [0x1a1a1a, 0x3b2314, 0x6b4423, 0xa0522d, 0xd4b483, 0x9e9e9e, 0x2a1a10];
const SHOES = [0x111111, 0x3a2a1a, 0xe8e8e8, 0x2a2f38];
const UMBRELLAS = [0x111111, 0x1f3a64, 0x8a1c1c, 0x2d5a3d, 0x5a3d7a, 0xd8b030];
const DRAW_WITHIN_M = 130;
const HIP = 0.92;

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });

// Give a geometry one flat vertex color.
function tint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute("uv");
  return g;
}

// A limb segment hanging down from its joint (the origin), `len` long.
const segment = (r0, r1, len) => new THREE.CylinderGeometry(r0, r1, len, 8).translate(0, -len / 2, 0);
const ball = (r) => new THREE.SphereGeometry(r, 8, 6);

export function createPersonMesh(look = 0) {
  const k = (i) => hash01(String(look), i);
  const pick = (list, i) => list[Math.floor(k(i) * list.length)];
  const skin = pick(SKIN, 1), top = pick(TOPS, 2), bottom = pick(BOTTOMS, 3), hair = pick(HAIR, 4), shoes = pick(SHOES, 6);
  const height = 0.9 + k(5) * 0.18, build = 0.9 + k(7) * 0.25;
  const longHair = k(8) < 0.35, backpack = k(9) < 0.25, coat = k(10) < 0.4;

  const g = new THREE.Group();
  const body = new THREE.Group();   // origin at the hips: bobs with each step, leans on a bike
  body.position.y = HIP;
  g.add(body);
  // the rigid body: pelvis, torso, neck, head, hair, backpack (local +x is forward)
  const parts = [
    tint(new THREE.CylinderGeometry(0.155, 0.15, 0.16, 10).scale(0.7, 1, 1).translate(0, 0.94, 0), bottom),
    tint(new THREE.CylinderGeometry(0.2, 0.155, coat ? 0.68 : 0.52, 12).scale(0.62, 1, 1).translate(0, coat ? 1.2 : 1.27, 0), top),
    tint(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.62, 0.35, 1).translate(0, 1.52, 0), top),   // shoulders
    tint(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 8).translate(0, 1.58, 0), skin),
    tint(ball(0.105).scale(1, 1.18, 0.92).translate(0.01, 1.72, 0), skin),
    tint(new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.02, 1.1, 0.98).translate(-0.005, 1.735, 0), hair),
  ];
  if (longHair) parts.push(tint(new THREE.CylinderGeometry(0.1, 0.085, 0.24, 10, 1, true, Math.PI * 0.5, Math.PI).translate(-0.02, 1.64, 0), hair));
  if (backpack) parts.push(tint(new THREE.BoxGeometry(0.14, 0.36, 0.28).translate(-0.19, 1.3, 0), pick([0x1a1a1a, 0x7a2a2a, 0x2a4a7a, 0x3a5a3a], 11)));
  const torso = mergeGeometries(parts, false).translate(0, -HIP, 0);
  body.add(new THREE.Mesh(torso, material));

  const limb = (parent, x, y, z, geo) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.add(new THREE.Mesh(geo, material));
    parent.add(pivot);
    return pivot;
  };
  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const hip = limb(body, 0, 0, side * 0.085, tint(segment(0.075 * build, 0.058, 0.43), bottom));
    const knee = limb(hip, 0, -0.43, 0, mergeGeometries([
      tint(segment(0.056, 0.042, 0.43), bottom),
      tint(new THREE.BoxGeometry(0.24, 0.07, 0.095).translate(0.05, -0.46, 0), shoes),
    ], false));
    legs.push({ hip, knee, side });
    const shoulder = limb(body, 0, 1.48 - HIP, side * 0.2 * build, tint(segment(0.047, 0.04, 0.29), coat ? top : pick([top, skin], 12)));
    const elbow = limb(shoulder, 0, -0.29, 0, mergeGeometries([
      tint(segment(0.04, 0.033, 0.25), coat ? top : skin),
      tint(ball(0.042).translate(0, -0.28, 0), skin),
    ], false));
    arms.push({ shoulder, elbow, side });
  }
  // an umbrella, held in the right hand, shown in the rain
  const umbrella = new THREE.Group();
  const canopy = new THREE.ConeGeometry(0.55, 0.22, 10, 1, true).translate(0, 0.11, 0);
  umbrella.add(new THREE.Mesh(mergeGeometries([
    tint(canopy, pick(UMBRELLAS, 13)),
    tint(new THREE.CylinderGeometry(0.01, 0.01, 0.8, 5).translate(0, -0.3, 0), 0x333333),
  ], false), material));
  umbrella.position.set(0.12, 1.98 - HIP, 0.16);
  umbrella.visible = false;
  body.add(umbrella);
  for (const m of [...body.children]) m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.scale.setScalar(height);
  g.userData = { legs, arms, body, umbrella, carries: k(14) < 0.75 };
  return g;
}

// Follow the simulation: place, face, and animate. `camera` culls the far ones; `rain` opens the
// umbrellas.
export function syncPerson(mesh, ped, camera, rain = false) {
  const far = Math.abs(ped.x - camera.position.x) > DRAW_WITHIN_M || Math.abs(-ped.y - camera.position.z) > DRAW_WITHIN_M;
  mesh.visible = !far;
  if (far) return;
  mesh.position.set(ped.x, 0, -ped.y);
  mesh.rotation.y = ped.psi;
  mesh.rotation.x = ped.frozen > 0 ? Math.PI / 2 : 0;   // knocked down
  const u = mesh.userData;
  const moving = ped.v > 0.1;
  const phi = ped.phase * 4.2;
  const stride = moving ? Math.min(1, ped.v / 1.3) : 0;
  const umbrellaUp = rain && u.carries;
  u.umbrella.visible = umbrellaUp;
  for (const { hip, knee, side } of u.legs) {
    const p = phi + (side > 0 ? Math.PI : 0);
    hip.rotation.z = 0.42 * stride * Math.sin(p);
    // the knee bends as the leg swings through, and stays nearly straight while it carries weight
    knee.rotation.z = -stride * (0.08 + 0.75 * Math.max(0, Math.sin(p + 1.2)) ** 2);
  }
  for (const { shoulder, elbow, side } of u.arms) {
    const p = phi + (side > 0 ? 0 : Math.PI);
    if (umbrellaUp && side > 0) { shoulder.rotation.z = 0.5; shoulder.rotation.x = 0.25; elbow.rotation.z = 1.3; continue; }
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
  u.umbrella.visible = false;
}
