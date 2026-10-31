// The delivery van (sim/double-parked.js): a high-roof long-wheelbase cargo van, built from boxes at
// its simulated size (a sloping nose and windscreen, a tall boxy body with a sliding side door and
// twin rear doors), its four amber corner lamps blinking together while its hazards are on. The same
// mesh drives off as traffic once its driver is back. Local +X is forward, +Z is right, rear axle at
// the origin, as for cars.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DELIVERY_VAN } from "../sim/vehicle.js";
import { lamp, shared, wheel } from "./emergency.js";
import { hash01 } from "./geo.js";
import { snowable } from "./weather.js";

const AMBER = 0xffa21a;
const BLINK_S = 0.8;    // hazards blink about 75 times a minute, as indicators do
const TIRE = 0.36;
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
const tail = new THREE.MeshStandardMaterial({ color: 0x7a0d10, emissive: 0x5a0000, emissiveIntensity: 0.6, roughness: 0.3 });
const seam = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.8 });

export function createVanMesh(vehicle) {
  const spec = DELIVERY_VAN, xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, wb = spec.wheelbase;
  const roof = 2.62, sill = 0.42, hoodTop = 1.12, screenFoot = xf - 0.95, cabRear = wb - 0.55;
  const g = new THREE.Group(), body = new THREE.Group();
  g.name = "delivery-van";
  g.add(body);
  const add = (geometry, material, shadow, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    body.add(mesh);
  };
  const paint = snowable(new THREE.MeshPhysicalMaterial({ color: vehicle.color ?? 0xf2f2ee, metalness: 0.25, roughness: 0.4, clearcoat: 0.6 }), "car");
  // (the tall body from the rear doors to the windscreen; the hood, sloping down ahead of it)
  const screen = new THREE.BoxGeometry(0.9, roof - hoodTop, w - 0.08).translate(screenFoot + 0.12, hoodTop + (roof - hoodTop) / 2, 0);
  const pos = screen.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > hoodTop + 0.2 && pos.getX(i) > screenFoot) pos.setX(i, screenFoot - 0.2);
  screen.computeVertexNormals();
  add(merge([
    box(screenFoot - 0.33 - xr, roof - sill, w, (xr + screenFoot - 0.33) / 2, sill + (roof - sill) / 2, 0),   // cargo body and cab
    screen,                                                                                                   // the cab's front, raked back
    box(xf - screenFoot, hoodTop - sill - 0.1, w - 0.12, (screenFoot + xf) / 2, sill + 0.05 + (hoodTop - sill - 0.1) / 2, 0),   // hood
  ]), paint, true, "bodywork");
  // (the windscreen lies on the raked front, a few millimetres proud of it)
  const glass = new THREE.BoxGeometry(0.03, roof - hoodTop - 0.3, w - 0.34).translate(0, hoodTop + 0.1 + (roof - hoodTop - 0.3) / 2, 0), gp = glass.attributes.position;
  const raked = (y) => screenFoot + 0.57 - (0.77 * (y - hoodTop)) / (roof - hoodTop);
  for (let i = 0; i < gp.count; i++) gp.setX(i, raked(gp.getY(i)) + (gp.getX(i) > 0 ? 0.03 : 0.005));
  glass.computeVertexNormals();
  add(merge([
    glass,                                                                                                    // windscreen
    ...[-1, 1].map((side) => box(cabRear - (screenFoot - 0.45) + 0.6, 0.58, 0.02, cabRear + 0.32, 1.62, side * (w / 2 + 0.005))),   // cab side windows
  ]), shared.glass, false, "windows");
  add(merge([
    box(xf - xr - 0.04, 0.2, w, (xr + xf) / 2, sill + 0.05, 0),                                             // rubbing strip and sills
    box(0.16, 0.32, w - 0.06, xf - 0.08, sill + 0.24, 0),                                                    // front bumper
    box(0.16, 0.26, w - 0.02, xr + 0.08, sill + 0.08, 0),                                                    // rear step bumper
    box(0.05, 0.22, w * 0.62, xf + 0.005, hoodTop - 0.28, 0),                                                // grille
  ]), shared.trim, false, "trim");
  add(merge([
    box(0.02, roof - sill - 0.3, 0.03, xr - 0.005, sill + (roof - sill) / 2, 0),                            // between the rear doors
    ...[-1, 1].map((side) => box(0.03, roof - sill - 0.5, 0.02, cabRear - 0.2, sill + (roof - sill - 0.5) / 2 + 0.1, side * (w / 2 + 0.006))),
    box(1.25, 0.03, 0.02, cabRear - 0.83, roof - 0.42, w / 2 + 0.006),                                       // the sliding door's top rail, on the right
  ]), seam, false, "door-seams");
  add(merge([box(0.05, 0.18, 0.32, xf + 0.01, hoodTop - 0.1, -(w / 2 - 0.3)), box(0.05, 0.18, 0.32, xf + 0.01, hoodTop - 0.1, w / 2 - 0.3)]), shared.head, false, "headlamps");
  add(merge([-1, 1].map((side) => box(0.05, 0.62, 0.16, xr - 0.02, 1.25, side * (w / 2 - 0.1)))), tail, false, "tail-lamps");
  // (the hazards: amber lamps at the four corners, blinking together)
  const lenses = [];
  for (const [x, z] of [[xf + 0.02, -(w / 2 - 0.08)], [xf + 0.02, w / 2 - 0.08], [xr - 0.03, -(w / 2 - 0.1)], [xr - 0.03, w / 2 - 0.1]]) {
    const m = new THREE.Mesh(box(0.06, 0.12, 0.14, x, x > 0 ? hoodTop - 0.32 : 0.86, z), lamp(AMBER));
    m.name = "hazard-lamp";
    body.add(m); lenses.push(m);
  }
  // (and repeaters on the sides, by the front wheels)
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(box(0.14, 0.05, 0.02, wb + 0.75, 0.86, side * (w / 2 + 0.01)), lamp(AMBER));
    m.name = "hazard-repeater";
    body.add(m); lenses.push(m);
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.length + 0.6, w + 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(spec.length / 2 - spec.rearOverhang, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  const wheels = [], track = spec.track / 2;
  for (const [x, z, steer] of [[wb, -track, true], [wb, track, true], [0, -track, false], [0, track, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, TIRE, z);
    const wh = wheel(TIRE, 0.24);
    pivot.add(wh);
    g.add(pivot);
    wheels.push({ pivot, wheel: wh, steer });
  }
  g.userData = { van: true, wheels, spin: 0, lenses, phase: hash01(vehicle.id, 7) * BLINK_S };
  g.position.set(vehicle.x, 0, -vehicle.y);
  g.rotation.y = vehicle.psi;
  return g;
}

export function syncVan(mesh, vehicle, dt = 0, t = 0) {
  if (!mesh) return;
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  u.spin += ((vehicle.v || 0) * dt) / TIRE;
  for (const w of u.wheels) {
    w.wheel.rotation.z = -u.spin;
    w.pivot.rotation.y = w.steer ? vehicle.delta || 0 : 0;
  }
  const lit = !!vehicle.hazards && ((t + u.phase) % BLINK_S) / BLINK_S < 0.5;
  for (const m of u.lenses) m.material.emissiveIntensity = lit ? 6 : 0;
}
