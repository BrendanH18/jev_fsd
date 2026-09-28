// Car meshes: a side profile extruded to the car's width with rounded edges, a glass cabin with a
// painted roof and pillars, lights, plates, and wheels with rims. Three body styles share the sim's
// footprint (CAR). Local +X is forward, +Z is the right side; the rear axle sits at the origin.

import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { CAR } from "../sim/vehicle.js";
import { blobTexture, glowTexture } from "./textures.js";
import { hash01 } from "./geo.js";
import { snowable } from "./weather.js";

const XR = -CAR.rearOverhang, XF = CAR.length - CAR.rearOverhang, W = CAR.width;
const BEVEL = 0.09;
const CG_X = CAR.wheelbase - CAR.cgToFront, CG_Y = 0.5;
const PITCH_PER_MS2 = 0.0045;   // rad of nose dive per m/s^2 of braking (about 2 deg at 8 m/s^2)
const ROLL_PER_MS2 = 0.007;     // rad of body roll per m/s^2 of cornering (about 3.5 deg at 0.9 g)

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
    // indicators: front and rear corner on each side (local +z is the right side)
    blinkL: merge([box(0.07, 0.12, 0.22, XF + 0.05, noseY - 0.12, -(W / 2 - 0.1)), box(0.07, 0.12, 0.22, XR - 0.07, tailY - 0.12, -(W / 2 - 0.1))]),
    blinkR: merge([box(0.07, 0.12, 0.22, XF + 0.05, noseY - 0.12, W / 2 - 0.1), box(0.07, 0.12, 0.22, XR - 0.07, tailY - 0.12, W / 2 - 0.1)]),
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
  blink: new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8c00, emissiveIntensity: 3, roughness: 0.3 }),
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
  // The body hangs from a pivot at the center of gravity, so it can pitch under braking and roll
  // in bends while the wheels stay on the road.
  const pivot = new THREE.Group();
  pivot.position.set(CG_X, CG_Y, 0);
  const body = new THREE.Group();
  body.position.set(-CG_X, -CG_Y, 0);
  pivot.add(body);
  g.add(pivot);
  const add = (geometry, material, shadow) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow; m.receiveShadow = true;
    body.add(m);
  };
  const tail = new THREE.MeshStandardMaterial({ color: 0x4a0606, emissive: 0xff0000, emissiveIntensity: 0.3, roughness: 0.2 });
  add(geo.paint, paint(color), true);
  add(geo.glass, shared.glass, true);
  add(geo.trim, shared.trim, false);
  add(geo.plate, shared.plate, false);
  add(geo.head, shared.head, false);
  add(geo.tail, tail, false);
  const blinkers = { left: new THREE.Mesh(geo.blinkL, shared.blink), right: new THREE.Mesh(geo.blinkR, shared.blink) };
  blinkers.left.visible = blinkers.right.visible = false;
  body.add(blinkers.left, blinkers.right);

  const brake = [];
  for (const z of [-(W / 2 - 0.26), W / 2 - 0.26]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff0000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.position.set(XR - 0.2, geo.tailY, z);
    s.scale.setScalar(0.7);
    s.visible = false;
    body.add(s);
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
  g.userData = { wheels, spin: 0, tire: st.tire, tail, brake, blinkers, prevV: 0, brakeLevel: 0, pivot, pitch: 0, roll: 0 };
  return g;
}

export function syncCar(mesh, vehicle, dt = 0, t = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  u.spin += (vehicle.v * dt) / u.tire;
  for (let i = 0; i < u.wheels.length; i++) {
    u.wheels[i].wheel.rotation.z = -u.spin;
    u.wheels[i].pivot.rotation.y = i < 2 ? vehicle.delta : 0;
  }
  // pitch and roll follow the car's accelerations through a soft suspension
  if (dt > 0) {
    const k = Math.min(1, dt * 8);
    u.pitch += ((vehicle.ax || 0) * PITCH_PER_MS2 - u.pitch) * k;
    u.roll += ((vehicle.latAccel || 0) * ROLL_PER_MS2 - u.roll) * k;
    u.pivot.rotation.set(u.roll, 0, u.pitch);
  }
  // indicators blink at about 75 per minute
  const on = (t % 0.8) < 0.45;
  u.blinkers.left.visible = on && vehicle.signal === "left";
  u.blinkers.right.visible = on && vehicle.signal === "right";
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

// Parked cars: thousands of them, so each body style's parts are instanced per map chunk (a few
// dozen draw calls in all) and culled like the buildings. Lights are off; paint is per instance.
const PARKED_CHUNK = 360;
const STYLE_NAMES = ["sedan", "sedan", "hatch", "suv", "suv"];
export function buildParkedCars(cars) {
  const group = new THREE.Group();
  const white = snowable(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.08 }), "car");
  const tailOff = new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.25 });
  const headOff = new THREE.MeshStandardMaterial({ color: 0xc9d0d8, roughness: 0.15, metalness: 0.3 });
  const chunks = new Map();
  for (const car of cars) {
    const key = `${Math.floor(car.x / PARKED_CHUNK)},${Math.floor(car.y / PARKED_CHUNK)}|${STYLE_NAMES[car.style || 0]}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(car);
  }
  const Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const [key, list] of chunks) {
    const style = key.split("|")[1];
    const st = STYLES[style], geo = styleGeometry(style);
    const mats = list.map((c) => new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, -c.y), new THREE.Quaternion().setFromAxisAngle(Y, c.psi), one));
    const emit = (geometry, material, matrices, colors = null, shadow = false) => {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((m, i) => { mesh.setMatrixAt(i, m); if (colors) mesh.setColorAt(i, colors[i]); });
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    };
    emit(geo.paint, white, mats, list.map((c) => new THREE.Color(c.color)), true);
    emit(geo.glass, shared.glass, mats, null, true);
    emit(geo.trim, shared.trim, mats);
    emit(geo.plate, shared.plate, mats);
    emit(geo.head, headOff, mats);
    emit(geo.tail, tailOff, mats);
    const wheels = [];
    for (const m of mats) {
      for (const [lx, lz] of [[CAR.wheelbase, W / 2 - 0.17], [CAR.wheelbase, -W / 2 + 0.17], [0, W / 2 - 0.17], [0, -W / 2 + 0.17]]) {
        wheels.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(lx, st.tire, lz)));
      }
    }
    emit(wheelGeometry(st.tire), [shared.tire, shared.rim], wheels);
  }
  group.userData.count = cars.length;
  return group;
}

// A cyclist: a bicycle (two wheels, a diamond frame, bars, saddle) and a rider whose legs pedal
// with the wheels. Local +X is forward from the rear axle, as for the cars.
const bikeShared = {
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.35 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xd9a47e, roughness: 0.7 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.8 }),
  helmet: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
};
const rod = (x0, y0, x1, y1, r = 0.022) => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.rotateZ(Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2);
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
};
export function createBikeMesh(color = 0x2b6cb0) {
  const g = new THREE.Group();
  const R = 0.34, wb = 1.05;
  const frameMat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 });
  const wheels = [];
  for (const x of [0, wb]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(R, 0.025, 6, 24), bikeShared.tire);
    w.position.set(x, R, 0);
    g.add(w);
    wheels.push(w);
  }
  const crank = [0.45, 0.3], seat = [0.3, 0.85], head = [0.92, 0.82];
  const frame = mergeGeometries([
    rod(0, R, crank[0], crank[1]), rod(0, R, seat[0], seat[1]), rod(crank[0], crank[1], seat[0], seat[1]),
    rod(crank[0], crank[1], head[0], head[1] - 0.08), rod(seat[0], seat[1] - 0.05, head[0], head[1]),
    rod(head[0], head[1], wb, R), rod(head[0], head[1], head[0] - 0.05, head[1] + 0.18),
  ], false);
  g.add(new THREE.Mesh(frame, frameMat));
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6).rotateX(Math.PI / 2).translate(head[0] - 0.05, head[1] + 0.18, 0), bikeShared.metal);
  g.add(bars);
  // rider
  const shirt = new THREE.MeshStandardMaterial({ color: [0xc53030, 0x2f855a, 0xf6e05e, 0x3182ce, 0x1a202c][Math.floor(Math.random() * 5)], roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.58, 0.34).translate(0, 0.29, 0), shirt);
  torso.position.set(seat[0] + 0.02, seat[1] + 0.05, 0);
  torso.rotation.z = -0.55;
  g.add(torso);
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), bikeShared.skin);
  headMesh.position.set(seat[0] + 0.35, seat[1] + 0.62, 0);
  g.add(headMesh);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), bikeShared.helmet);
  helmet.position.copy(headMesh.position).add(new THREE.Vector3(0, 0.02, 0));
  g.add(helmet);
  for (const z of [-0.12, 0.12]) {
    const arm = new THREE.Mesh(rod(0, 0, head[0] - 0.05 - (seat[0] + 0.27), head[1] + 0.18 - (seat[1] + 0.45), 0.035), shirt);
    arm.position.set(seat[0] + 0.27, seat[1] + 0.45, z * 1.6);
    g.add(arm);
  }
  const legs = [];
  for (const [z, phase] of [[-0.1, 0], [0.1, Math.PI]]) {
    const leg = new THREE.Group();
    leg.position.set(seat[0], seat[1], z);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.45, 6).translate(0, -0.225, 0), bikeShared.pants);
    leg.add(thigh);
    g.add(leg);
    legs.push({ leg, phase });
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(wb / 2, 0.02, 0);
  g.add(blob);
  g.traverse((m) => { if (m.isMesh && m !== blob) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData = { bike: true, wheels, legs, spin: 0, crank: 0 };
  return g;
}

export function syncBike(mesh, vehicle, dt = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  // lean into turns: tan(lean) = v^2 * curvature / g
  mesh.rotation.x = Math.atan((vehicle.latAccel || 0) / 9.81) * -0.9;
  const u = mesh.userData;
  u.spin += (vehicle.v * dt) / 0.34;
  for (const w of u.wheels) w.rotation.z = -u.spin;
  u.crank += (vehicle.v * dt) / 0.34 * 0.55;
  for (const { leg, phase } of u.legs) leg.rotation.z = 0.35 + Math.sin(u.crank + phase) * 0.45;
}

// A pedestrian: legs and arms that swing with each step, a torso, a head. Clothes and skin vary.
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd9a47e];
const TOPS = [0x2b6cb0, 0xc53030, 0x2f855a, 0xd69e2e, 0x553c9a, 0x1a202c, 0xe2e8f0, 0x744210, 0x4a5568, 0xb83280];
const BOTTOMS = [0x1a202c, 0x2d3748, 0x2c5282, 0x4a5568, 0x744210, 0x718096];
const pedGeo = {
  leg: new THREE.CylinderGeometry(0.07, 0.06, 0.82, 6).translate(0, -0.41, 0),
  arm: new THREE.CylinderGeometry(0.05, 0.045, 0.62, 6).translate(0, -0.31, 0),
  torso: new THREE.BoxGeometry(0.24, 0.62, 0.4).translate(0, 0.31, 0),
  head: new THREE.SphereGeometry(0.11, 10, 8),
  hair: new THREE.SphereGeometry(0.118, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
};
const pedMats = new Map();
const pedMat = (hex) => { if (!pedMats.has(hex)) pedMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 })); return pedMats.get(hex); };
export function createPedMesh(look = 0) {
  const pick = (list, k) => list[Math.floor(hash01(String(look), k) * list.length)];
  const g = new THREE.Group();
  const skin = pedMat(pick(SKIN, 1)), top = pedMat(pick(TOPS, 2)), bottom = pedMat(pick(BOTTOMS, 3));
  const hair = pedMat(pick([0x1a1a1a, 0x3b2314, 0x6b4423, 0xa0522d, 0xd4b483, 0x9e9e9e], 4));
  const scale = 0.92 + hash01(String(look), 5) * 0.16;
  const limbs = [];
  for (const z of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(pedGeo.leg, bottom);
    leg.position.set(0, 0.86, z);
    g.add(leg);
    limbs.push({ m: leg, sign: z < 0 ? 1 : -1, amp: 0.45 });
  }
  const torso = new THREE.Mesh(pedGeo.torso, top);
  torso.position.set(0, 0.86, 0);
  g.add(torso);
  for (const z of [-0.26, 0.26]) {
    const arm = new THREE.Mesh(pedGeo.arm, top);
    arm.position.set(0, 1.44, z);
    g.add(arm);
    limbs.push({ m: arm, sign: z < 0 ? -1 : 1, amp: 0.35 });
  }
  const head = new THREE.Mesh(pedGeo.head, skin);
  head.position.set(0.02, 1.62, 0);
  g.add(head);
  const hairMesh = new THREE.Mesh(pedGeo.hair, hair);
  hairMesh.position.set(0.0, 1.64, 0);
  g.add(hairMesh);
  g.scale.setScalar(scale);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData = { limbs };
  return g;
}

export function syncPed(mesh, ped) {
  mesh.position.set(ped.x, 0, -ped.y);
  mesh.rotation.y = ped.psi;
  mesh.rotation.x = ped.frozen > 0 ? Math.PI / 2 : 0;   // knocked down
  const swing = ped.v > 0.1 ? Math.sin(ped.phase * 4.2) : 0;
  for (const l of mesh.userData.limbs) l.m.rotation.z = l.sign * l.amp * swing;
}
