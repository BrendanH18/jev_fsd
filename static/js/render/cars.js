// Car meshes: a side profile extruded to the car's width with rounded edges, a glass cabin with a
// painted roof and pillars, lights, plates, and wheels with rims. Three body styles share the sim's
// footprint (CAR). Local +X is forward, +Z is the right side; the rear axle sits at the origin.

import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { CAR } from "../sim/vehicle.js";
import { blobTexture, glowTexture } from "./textures.js";
import { hash01 } from "./geo.js";

const XR = -CAR.rearOverhang, XF = CAR.length - CAR.rearOverhang, W = CAR.width;
const BEVEL = 0.09;

// Profiles in (x forward, y up). `body` is the lower shell and `glass` the greenhouse; the painted
// roof is the top of the greenhouse, clipped off and extruded a touch wider. Arches are cut around
// wheels of radius `tire`.
const STYLES = {
  sedan: {
    tire: 0.33, sill: 0.3, belt: 1.0,
    nose: [[XF, 0.42], [XF + 0.02, 0.62], [XF - 0.08, 0.76], [XF - 0.5, 0.86], [2.35, 0.95], [2.05, 0.99]],
    tail: [[-0.3, 1.0], [XR + 0.15, 0.99], [XR, 0.86], [XR - 0.03, 0.6], [XR + 0.04, 0.36]],
    glass: [[-0.42, 0.97], [2.08, 0.97], [1.3, 1.42], [0.1, 1.45]],
    pillar: 0.78,
  },
  hatch: {
    tire: 0.32, sill: 0.3, belt: 1.0,
    nose: [[XF, 0.42], [XF + 0.02, 0.62], [XF - 0.1, 0.78], [XF - 0.55, 0.88], [2.3, 0.97], [2.0, 1.0]],
    tail: [[XR + 0.12, 1.02], [XR, 0.9], [XR - 0.03, 0.6], [XR + 0.04, 0.36]],
    glass: [[XR + 0.14, 1.0], [2.02, 0.99], [1.3, 1.46], [XR + 0.4, 1.5], [XR + 0.16, 1.2]],
    pillar: 0.62,
  },
  suv: {
    tire: 0.37, sill: 0.4, belt: 1.12,
    nose: [[XF, 0.5], [XF + 0.02, 0.78], [XF - 0.1, 0.94], [XF - 0.6, 1.02], [2.25, 1.1], [2.0, 1.13]],
    tail: [[XR + 0.1, 1.14], [XR, 1.0], [XR - 0.03, 0.66], [XR + 0.04, 0.44]],
    glass: [[XR + 0.12, 1.12], [2.02, 1.12], [1.38, 1.7], [XR + 0.2, 1.74], [XR + 0.1, 1.4]],
    pillar: 0.72,
  },
};

function extrude(outline, width, bevel = BEVEL, arches = null) {
  const s = new THREE.Shape();
  s.moveTo(outline[0][0], outline[0][1]);
  for (const [x, y] of outline.slice(1)) s.lineTo(x, y);
  s.closePath();
  const depth = Math.max(0.01, width - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 3, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  return toCreasedNormals(geo, Math.PI / 5);
}

// The lower shell: along the bottom from rear to front with an arch over each wheel, up the nose,
// back along the beltline and hood, down the tail. Counter-clockwise seen from +Z.
function bodyOutline(st) {
  const pts = [[XR + 0.08, st.sill]];
  for (const cx of [0, CAR.wheelbase]) {
    const r = st.tire + 0.07, cy = st.tire;
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI - (k / 10) * Math.PI;
      pts.push([cx + Math.cos(a) * r, Math.max(st.sill, cy + Math.sin(a) * r)]);
    }
  }
  pts.push([XF - 0.08, st.sill]);
  return pts.concat(st.nose, st.tail);
}

const roofLine = (st) => Math.max(...st.glass.map((p) => p[1])) - 0.07;

// The part of a polygon above y = cut (Sutherland-Hodgman against one edge).
function clipAbove(poly, cut) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ina = a[1] >= cut, inb = b[1] >= cut;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (cut - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, cut]);
    }
  }
  return out;
}

const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z).toNonIndexed();
const merge = (parts) => mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);

// Every static part of a style merged per material, so a car is a handful of draw calls.
const geoCache = new Map();
function styleGeometry(name) {
  if (geoCache.has(name)) return geoCache.get(name);
  const st = STYLES[name];
  const zL = W / 2 - 0.26;
  const noseY = st.nose[1][1] - 0.02, tailY = st.tail[st.tail.length - 3][1] - 0.02;
  const pair = (fn) => [fn(-zL, -1), fn(zL, 1)];
  const g = {
    tailY,
    paint: merge([
      extrude(bodyOutline(st), W),
      extrude(clipAbove(st.glass, roofLine(st)), W * 0.86 + 0.02, 0.06),
      box(0.12, roofLine(st) - st.belt + 0.02, W * 0.86 + 0.01, st.pillar, (st.belt + roofLine(st)) / 2, 0),
      ...pair((z, s) => box(0.18, 0.06, 0.12, 1.95, st.belt + 0.08, s * (W / 2 + 0.04))),   // mirrors
    ]),
    glass: extrude(st.glass, W * 0.86, 0.06),
    trim: merge([
      box(0.06, 0.2, W * 0.5, XF + 0.06, st.sill + 0.12, 0),                               // grille
      box(CAR.length - 0.5, 0.12, W - 0.1, (XR + XF) / 2, st.sill - 0.02, 0),                // underbody
    ]),
    plate: merge([box(0.03, 0.14, 0.5, XF + 0.1, st.sill + 0.12, 0), box(0.03, 0.14, 0.5, XR - 0.1, st.sill + 0.25, 0)]),
    head: merge(pair((z) => box(0.08, 0.13, 0.36, XF + 0.06, noseY, z))),
    tail: merge(pair((z) => box(0.08, 0.14, 0.4, XR - 0.06, tailY, z))),
  };
  geoCache.set(name, g);
  return g;
}

const shared = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x1b2530, metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.55 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb4b9c0, metalness: 1.0, roughness: 0.28 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff4e0, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.3 }),
  blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.65 }),
};
const paints = new Map();
function paint(hex) {
  if (!paints.has(hex)) {
    paints.set(hex, new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.45, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.08 }));
  }
  return paints.get(hex);
}

function wheelGeometry(r) {
  const key = "wheel" + r;
  if (geoCache.has(key)) return geoCache.get(key);
  const tire = new THREE.CylinderGeometry(r, r, 0.24, 24).rotateX(Math.PI / 2);
  tire.deleteAttribute("uv");
  const parts = [new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.25, 20).rotateX(Math.PI / 2)];
  for (let k = 0; k < 5; k++) {
    const spoke = new THREE.BoxGeometry(0.06, r * 1.1, 0.02).translate(0, r * 0.1, 0.13);
    spoke.rotateZ((k / 5) * Math.PI * 2);
    parts.push(spoke, spoke.clone().translate(0, 0, -0.26));
  }
  const g = mergeGeometries([tire, mergeParts(parts)], true);
  geoCache.set(key, g);
  return g;
}

function mergeParts(parts) {
  // Box and cylinder geometries share attributes, so a manual concat is enough.
  const pos = [], nrm = [], idx = [];
  let base = 0;
  for (const p of parts) {
    pos.push(...p.attributes.position.array);
    nrm.push(...p.attributes.normal.array);
    for (const i of p.index.array) idx.push(i + base);
    base += p.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

export function createCarMesh(color = 0x2f7cff, id = "ego") {
  const style = id === "ego" ? "sedan" : ["sedan", "sedan", "hatch", "suv", "suv"][Math.floor(hash01(id, 4) * 5)];
  const st = STYLES[style];
  const geo = styleGeometry(style);
  const g = new THREE.Group();
  const add = (geometry, material, shadow) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow; m.receiveShadow = true;
    g.add(m);
  };
  const tail = new THREE.MeshStandardMaterial({ color: 0x4a0606, emissive: 0xff0000, emissiveIntensity: 0.3, roughness: 0.2 });
  add(geo.paint, paint(color), true);
  add(geo.glass, shared.glass, true);
  add(geo.trim, shared.trim, false);
  add(geo.plate, shared.plate, false);
  add(geo.head, shared.head, false);
  add(geo.tail, tail, false);

  const brake = [];
  for (const z of [-(W / 2 - 0.26), W / 2 - 0.26]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff0000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.position.set(XR - 0.2, geo.tailY, z);
    s.scale.setScalar(0.7);
    s.visible = false;
    g.add(s);
    brake.push(s);
  }

  const blob = new THREE.Mesh(new THREE.PlaneGeometry(CAR.length + 0.5, W + 0.5).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set((XR + XF) / 2, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);

  const wg = wheelGeometry(st.tire);
  const wheels = [];
  for (const [lx, lz] of [[CAR.wheelbase, W / 2 - 0.17], [CAR.wheelbase, -W / 2 + 0.17], [0, W / 2 - 0.17], [0, -W / 2 + 0.17]]) {
    const pivot = new THREE.Group();   // steering turns the pivot; rolling spins the wheel inside it
    pivot.position.set(lx, st.tire, lz);
    const wheel = new THREE.Mesh(wg, [shared.tire, shared.rim]);
    pivot.add(wheel);
    g.add(pivot);
    wheels.push({ pivot, wheel });
  }
  g.userData = { wheels, spin: 0, tire: st.tire, tail, brake, prevV: 0, brakeLevel: 0 };
  return g;
}

export function syncCar(mesh, vehicle, dt = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  u.spin += (vehicle.v * dt) / u.tire;
  for (let i = 0; i < u.wheels.length; i++) {
    u.wheels[i].wheel.rotation.z = -u.spin;
    u.wheels[i].pivot.rotation.y = i < 2 ? vehicle.delta : 0;
  }
  // brake lights: on while decelerating or held stopped
  if (dt > 0) {
    const decel = (u.prevV - vehicle.v) / dt;
    const target = decel > 0.6 || Math.abs(vehicle.v) < 0.15 ? 1 : 0;
    u.brakeLevel += (target - u.brakeLevel) * Math.min(1, dt * 12);
    u.prevV = vehicle.v;
    u.tail.emissiveIntensity = 0.3 + u.brakeLevel * 1.2;
    for (const s of u.brake) { s.material.opacity = u.brakeLevel * 0.5; s.visible = u.brakeLevel > 0.02; }
  }
}
