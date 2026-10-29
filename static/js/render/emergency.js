// Emergency vehicles (sim/emergency.js): a box ambulance on a van chassis and a pumper fire truck,
// built from boxes at their simulated sizes, with light bars that flash red and white (red, white
// and blue on the ambulance) while the siren is on. Local +X is forward, +Z is right, rear axle at
// the origin, as for cars.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { AMBULANCE, FIRE_TRUCK } from "../sim/vehicle.js";
import { blobTexture } from "./textures.js";
import { hash01 } from "./geo.js";
import { snowable } from "./weather.js";

const FLASH_S = 0.5;   // one left-right cycle of the light bars

const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
export const shared = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x141c24, metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 2 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.2 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x19191a, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb4b9c0, metalness: 1, roughness: 0.3 }),
  white: snowable(new THREE.MeshPhysicalMaterial({ color: 0xf2f2ee, metalness: 0.2, roughness: 0.35, clearcoat: 0.8 }), "car"),
  red: snowable(new THREE.MeshPhysicalMaterial({ color: 0xb3121b, metalness: 0.35, roughness: 0.3, clearcoat: 1 }), "car"),
  stripe: new THREE.MeshStandardMaterial({ color: 0xc8161d, roughness: 0.5 }),
  reflective: new THREE.MeshStandardMaterial({ color: 0xf5f0d8, emissive: 0x3a3520, roughness: 0.4 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff1dc, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.4 }),
  blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.65 }),
};

// A light lens: its own material, so each vehicle's bars flash on their own.
export function lamp(color) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.92 });
}

export function wheel(r, width) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 20).rotateX(Math.PI / 2), shared.tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, width + 0.02, 12).rotateX(Math.PI / 2), shared.rim);
  tire.castShadow = true;
  g.add(tire, rim);
  return g;
}

function ambulanceParts(spec) {
  const xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, wb = spec.wheelbase;
  const boxEnd = wb * 0.62, cabRoof = 2.15, boxTop = 2.75;
  return {
    paint: merge([
      box(boxEnd - xr, boxTop - 0.45, w, (xr + boxEnd) / 2, 0.45 + (boxTop - 0.45) / 2, 0),        // patient module
      box(xf - 0.9 - boxEnd, cabRoof - 0.5, w - 0.12, (boxEnd + xf - 0.9) / 2, 0.5 + (cabRoof - 0.5) / 2, 0),   // cab
      box(0.9, 0.55, w - 0.16, xf - 0.45, 0.5 + 0.55 / 2 + 0.05, 0),                            // hood
    ]),
    stripe: merge([box(boxEnd - xr + 0.01, 0.28, w + 0.02, (xr + boxEnd) / 2, 1.1, 0), box(xf - boxEnd, 0.18, w - 0.1, (boxEnd + xf) / 2, 0.95, 0)]),
    reflective: merge([box(0.02, 0.5, w * 0.7, xr - 0.01, 1.55, 0)]),
    glass: merge([
      box(0.06, 0.62, w - 0.3, xf - 0.95, 1.6, 0),
      box(0.7, 0.55, w - 0.08, boxEnd + 0.75, 1.6, 0),
    ]),
    trim: merge([box(0.25, 0.35, w + 0.04, xf - 0.05, 0.42, 0), box(0.2, 0.3, w, xr + 0.05, 0.4, 0), box(xf - xr - 0.3, 0.25, w - 0.25, (xr + xf) / 2, 0.42, 0)]),
    head: merge([box(0.06, 0.16, 0.34, xf + 0.01, 0.82, -(w / 2 - 0.3)), box(0.06, 0.16, 0.34, xf + 0.01, 0.82, w / 2 - 0.3)]),
    bars: [
      { x: (boxEnd + xf - 0.9) / 2, y: cabRoof + 0.07, z: 0, len: 0.3, span: w - 0.4 },     // light bar on the cab
      { x: boxEnd - 0.15, y: boxTop + 0.06, z: 0, len: 0.2, span: w - 0.1 },               // front of the module
      { x: xr + 0.15, y: boxTop + 0.06, z: 0, len: 0.2, span: w - 0.1 },                   // rear of the module
    ],
    tire: 0.4, rearDual: true, colors: [0xff1a1a, 0xffffff, 0x1a4dff],
  };
}

function fireTruckParts(spec) {
  const xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, wb = spec.wheelbase;
  const cabStart = wb + 0.1, cabRoof = 3.0, bodyTop = 2.55;
  const doors = [];
  for (let x = xr + 0.5; x < cabStart - 0.6; x += 1.2) for (const z of [-w / 2 - 0.005, w / 2 + 0.005]) doors.push(box(0.03, 1.4, 0.02, x, 1.5, z));
  return {
    paint: merge([
      box(cabStart - xr, bodyTop - 0.55, w, (xr + cabStart) / 2, 0.55 + (bodyTop - 0.55) / 2, 0),    // pump and hose body
      box(xf - cabStart, cabRoof - 0.6, w, (cabStart + xf) / 2, 0.6 + (cabRoof - 0.6) / 2, 0),     // crew cab
    ]),
    stripe: merge([box(xf - xr + 0.01, 0.16, w + 0.02, (xr + xf) / 2, 1.0, 0)]),
    reflective: merge([box(0.02, 0.18, w, xr - 0.01, 1.0, 0), ...doors]),
    glass: merge([box(0.06, 0.9, w - 0.25, xf + 0.005, 2.3, 0), box(xf - cabStart - 0.5, 0.75, w + 0.02, (cabStart + xf) / 2 + 0.1, 2.3, 0)]),
    chrome: merge([
      box(0.3, 0.3, w + 0.1, xf + 0.1, 0.55, 0),                                                // bumper
      ...[-1, 1].map((side) => box(wb * 1.25, 0.08, 0.08, xr + wb * 0.65, bodyTop + 0.45, side * (w / 2 - 0.3))),   // ladder rails
      ...Array.from({ length: 14 }, (_, k) => box(0.05, 0.05, w - 0.6, xr + 0.25 + k * wb * 1.25 / 13, bodyTop + 0.45, 0)),   // rungs
      ...[-1, 1].map((side) => box(0.08, 0.4, 0.08, xr + 0.4, bodyTop + 0.25, side * (w / 2 - 0.3))),
      ...[-1, 1].map((side) => box(0.08, 0.4, 0.08, cabStart - 0.4, bodyTop + 0.25, side * (w / 2 - 0.3))),
    ]),
    trim: merge([box(xf - xr - 0.4, 0.3, w - 0.3, (xr + xf) / 2, 0.45, 0), box(0.04, 0.5, w - 0.6, xf + 0.02, 1.25, 0)]),
    head: merge([box(0.06, 0.2, 0.36, xf + 0.02, 1.0, -(w / 2 - 0.3)), box(0.06, 0.2, 0.36, xf + 0.02, 1.0, w / 2 - 0.3)]),
    bars: [
      { x: xf - 0.5, y: cabRoof + 0.08, z: 0, len: 0.3, span: w - 0.3 },
      { x: xr + 0.15, y: bodyTop + 0.1, z: 0, len: 0.2, span: w - 0.2 },
    ],
    tire: 0.5, rearDual: true, colors: [0xff1a1a, 0xffffff],
  };
}

export function createEmergencyMesh(kind, id = kind) {
  const fire = kind === "fire_truck", spec = fire ? FIRE_TRUCK : AMBULANCE;
  const parts = fire ? fireTruckParts(spec) : ambulanceParts(spec);
  const g = new THREE.Group();
  g.name = `emergency-${kind}`;
  const body = new THREE.Group();
  g.add(body);
  const add = (geometry, material, shadow, name) => {
    if (!geometry) return;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    body.add(mesh);
  };
  add(parts.paint, fire ? shared.red : shared.white, true, "bodywork");
  add(parts.stripe, fire ? shared.reflective : shared.stripe, false, "stripes");
  add(parts.reflective, fire ? shared.chrome : shared.reflective, false, "reflective");
  add(parts.glass, shared.glass, false, "windows");
  add(parts.chrome, shared.chrome, false, "brightwork");
  add(parts.trim, shared.trim, false, "trim");
  add(parts.head, shared.head, false, "headlamps");
  const lenses = addLightBars(body, parts.bars, parts.colors);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.length + 0.6, spec.width + 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(spec.length / 2 - spec.rearOverhang, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  const wheels = [];
  const track = spec.track / 2;
  for (const [x, z, steer] of [[spec.wheelbase, -track, true], [spec.wheelbase, track, true], [0, -track, false], [0, track, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, parts.tire, z);
    const w = wheel(parts.tire, steer || !parts.rearDual ? 0.26 : 0.5);
    pivot.add(w);
    g.add(pivot);
    wheels.push({ pivot, wheel: w, steer });
  }
  g.userData = { emergency: true, kind, spec, wheels, tire: parts.tire, spin: 0, lenses, phase: hash01(id, 7) * FLASH_S };
  return g;
}

// Light bars (`bars`: { x, y, z, len, span } in the vehicle's frame) on `body`: lenses alternating
// colour along each bar, split into a left and a right half. Returns the halves, for flashLights.
export function addLightBars(body, bars, colors) {
  const lenses = { left: [], right: [] };
  for (const bar of bars) {
    const base = new THREE.Mesh(box(bar.len + 0.04, 0.06, bar.span + 0.04, bar.x, bar.y - 0.06, bar.z), shared.trim);
    base.name = "light-bar-base"; base.receiveShadow = true;
    body.add(base);
    const n = 6;
    for (let k = 0; k < n; k++) {
      const z = bar.z - bar.span / 2 + (k + 0.5) * bar.span / n, color = colors[k % colors.length];
      const m = new THREE.Mesh(box(bar.len, 0.12, bar.span / n - 0.02, bar.x, bar.y, z), lamp(color));
      m.name = "light-bar-lens";
      body.add(m);
      (z < bar.z ? lenses.left : lenses.right).push(m);
    }
  }
  return lenses;
}

// Left and right halves of the bars in turn, each lens strobing twice per half-cycle, while `on`.
export function flashLights(lenses, on, t, offset = 0) {
  const phase = ((t + offset) % FLASH_S) / FLASH_S;
  const left = phase < 0.5, strobe = (phase * 4) % 1 < 0.6;
  for (const [side, list] of Object.entries(lenses)) {
    const lit = on && strobe && (side === "left") === left;
    for (const m of list) m.material.emissiveIntensity = lit ? 9 : 0;
  }
}

export function syncEmergency(mesh, vehicle, dt = 0, t = 0) {
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  u.spin += (vehicle.v * dt) / u.tire;
  for (const w of u.wheels) {
    w.wheel.rotation.z = -u.spin;
    w.pivot.rotation.y = w.steer ? vehicle.delta : 0;
  }
  flashLights(u.lenses, !!vehicle.siren, t, u.phase);
}
