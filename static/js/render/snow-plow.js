// The snow plow (sim/snow-plow.js): a single-axle dump truck built from boxes at its simulated size,
// with a salt spreader at the back of its box, a one-way blade angled across its nose (its left end
// leading, so the snow comes off to the right), the wing blade folded up along its right side, raised
// headlamps above the blade, and amber and blue lamps on the cab roof and at the back of the box,
// flashing in turn while it works. Local +X is forward, +Z is right, rear axle at the origin, as for
// cars.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SNOW_PLOW } from "../sim/vehicle.js";
import { PLOW_COLOR } from "../sim/snow-plow.js";
import { lamp, shared, wheel } from "./emergency.js";
import { hash01 } from "./geo.js";
import { snowable } from "./weather.js";

const AMBER = 0xffa21a, BLUE = 0x2a6bff;
const FLASH_S = 0.7;   // amber, then blue
const TIRE = 0.52;
const BLADE_DEG = 30, BLADE_M = 2.9;   // across the nose at 30 degrees, within the truck's width
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d41, metalness: 0.6, roughness: 0.55 });
const blade = snowable(new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.3, roughness: 0.5 }), "car");
const tail = new THREE.MeshStandardMaterial({ color: 0x7a0d10, emissive: 0x5a0000, emissiveIntensity: 0.6, roughness: 0.3 });

export function createPlowMesh(vehicle) {
  const spec = SNOW_PLOW, xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, wb = spec.wheelbase;
  const g = new THREE.Group(), body = new THREE.Group();
  g.name = "snow-plow";
  g.add(body);
  const add = (geometry, material, shadow, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };
  const paint = snowable(new THREE.MeshPhysicalMaterial({ color: vehicle.color ?? PLOW_COLOR, metalness: 0.25, roughness: 0.45, clearcoat: 0.4 }), "car");
  const bodyW = w - 0.2, cabRear = wb - 1.75, cabFront = wb - 0.15, hoodFront = wb + 1.3;
  add(merge([
    box(cabFront - cabRear, 1.75, bodyW, (cabRear + cabFront) / 2, 1.15 + 1.75 / 2, 0),                     // cab
    box(hoodFront - cabFront, 0.95, bodyW - 0.3, (cabFront + hoodFront) / 2, 1.05 + 0.95 / 2, 0),            // hood
    box(cabRear - 0.15 - (xr + 0.35), 1.25, bodyW, (xr + 0.35 + cabRear - 0.15) / 2, 1.3 + 1.25 / 2, 0),     // dump box
  ]), paint, true, "bodywork");
  add(merge([
    box(xf - 1.0 - xr, 0.32, 1.0, (xr + xf - 1.0) / 2, 0.85, 0),                                             // frame rails
    box(0.9, 0.5, 1.6, xf - 1.2, 0.85, 0),                                                                  // push frame
    box(0.35, 0.9, bodyW - 0.2, xr + 0.18, 1.15, 0),                                                        // salt spreader
    box(cabRear - 0.15 - xr, 0.12, bodyW + 0.02, (xr + cabRear - 0.15) / 2, 1.3, 0),                        // box floor rail
    ...[-1, 1].map((side) => box(0.9, 0.18, 0.45, wb, TIRE * 2 + 0.1, side * (w / 2 - 0.3))),              // front fenders
  ]), steel, true, "frame");
  add(merge([
    box(0.04, 0.8, bodyW - 0.3, cabFront + 0.02, 2.35, 0),                                                  // windscreen
    ...[-1, 1].map((side) => box(1.0, 0.7, 0.02, cabRear + 0.75, 2.3, side * (bodyW / 2 + 0.005))),         // side windows
  ]), shared.glass, false, "windows");
  // (the blade, angled back toward the right, and the wing folded up along the right of the box)
  const moldboard = new THREE.Mesh(box(0.14, 1.05, BLADE_M, 0, 0, 0), blade);
  moldboard.name = "blade"; moldboard.castShadow = true; moldboard.receiveShadow = true;
  moldboard.rotation.y = -BLADE_DEG * Math.PI / 180;
  moldboard.position.set(xf - 0.07 - (BLADE_M / 2) * Math.sin(BLADE_DEG * Math.PI / 180), 0.6, 0);
  body.add(moldboard);
  const wing = add(box(2.6, 0.7, 0.12, 0, 0, 0), blade, true, "wing");
  wing.position.set(cabRear - 1.8, 1.75, w / 2 - 0.08);
  wing.rotation.x = -0.12;
  // (raised headlamps on posts above the blade, and the tail lamps)
  add(merge([-1, 1].map((side) => box(0.12, 0.2, 0.3, hoodFront + 0.1, 2.05, side * (w / 2 - 0.45)))), shared.head, false, "headlamps");
  add(merge([-1, 1].map((side) => box(0.05, 0.3, 0.2, xr - 0.01, 1.0, side * (bodyW / 2 - 0.15)))), tail, false, "tail-lamps");
  // (amber and blue lamps: a pair on the cab roof, a pair on the box's back corners)
  const amber = [], blue = [];
  for (const [x, y, z, colour] of [[cabRear + 0.9, 3.0, -0.55, AMBER], [cabRear + 0.9, 3.0, 0.55, BLUE], [xr + 0.45, 2.7, -(bodyW / 2 - 0.15), BLUE], [xr + 0.45, 2.7, bodyW / 2 - 0.15, AMBER]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 10).translate(x, y, z), lamp(colour));
    m.name = colour === BLUE ? "blue-lamp" : "amber-lamp";
    body.add(m); (colour === BLUE ? blue : amber).push(m);
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.length + 0.8, w + 0.8).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(spec.length / 2 - spec.rearOverhang, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  const wheels = [], track = spec.track / 2;
  for (const [x, z, steer] of [[wb, -track, true], [wb, track, true], [0, -track, false], [0, track, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, TIRE, z);
    const wh = wheel(TIRE, 0.36);
    pivot.add(wh);
    g.add(pivot);
    wheels.push({ pivot, wheel: wh, steer });
  }
  g.userData = { plow: true, wheels, spin: 0, amber, blue, phase: hash01(vehicle.id, 11) * FLASH_S };
  g.position.set(vehicle.x, 0, -vehicle.y);
  g.rotation.y = vehicle.psi;
  return g;
}

export function syncPlow(mesh, vehicle, dt = 0, t = 0) {
  if (!mesh) return;
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  u.spin += ((vehicle.v || 0) * dt) / TIRE;
  for (const w of u.wheels) {
    w.wheel.rotation.z = -u.spin;
    w.pivot.rotation.y = w.steer ? vehicle.delta || 0 : 0;
  }
  const phase = ((t + u.phase) % FLASH_S) / FLASH_S, on = !!vehicle.beacons;
  for (const m of u.amber) m.material.emissiveIntensity = on && phase < 0.5 ? 7 : 0;
  for (const m of u.blue) m.material.emissiveIntensity = on && phase >= 0.5 ? 9 : 0;
}
