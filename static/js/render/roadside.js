// Vehicles stopped at the roadside with their lights flashing (sim/roadside.js): a light-duty tow
// truck, built from boxes at its simulated size (a one-ton cab, a wrecker body with tool boxes, its
// boom and the wheel-lift folded under the rear), with amber light bars on the cab and the boom; and
// a police SUV, the traffic's SUV in white with a red and blue light bar and a push bar. Local +X is
// forward, +Z is right, rear axle at the origin, as for cars.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TOW_TRUCK } from "../sim/vehicle.js";
import { addLightBars, flashLights, shared, wheel } from "./emergency.js";
import { createCarMesh, syncCar } from "./cars.js";
import { hash01 } from "./geo.js";
import { snowable } from "./weather.js";

const AMBER = 0xffa21a;
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) => mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
const steel = new THREE.MeshStandardMaterial({ color: 0x3b3f45, metalness: 0.6, roughness: 0.45 });

function towTruck(vehicle) {
  const spec = TOW_TRUCK, xr = -spec.rearOverhang, xf = spec.length - spec.rearOverhang, w = spec.width, wb = spec.wheelbase;
  const cabRear = wb - 1.25, cabFront = xf - 1.0, cabRoof = 2.1;
  const g = new THREE.Group(), body = new THREE.Group();
  g.name = "roadside-tow_truck";
  g.add(body);
  const add = (geometry, material, shadow, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    body.add(mesh);
  };
  const paint = snowable(new THREE.MeshPhysicalMaterial({ color: vehicle.color ?? 0xe2a514, metalness: 0.3, roughness: 0.35, clearcoat: 0.8 }), "car");
  add(merge([
    box(cabFront - cabRear, cabRoof - 0.65, w - 0.2, (cabRear + cabFront) / 2, 0.65 + (cabRoof - 0.65) / 2, 0),   // cab
    box(xf - cabFront, 0.6, w - 0.3, (cabFront + xf) / 2, 0.68 + 0.3, 0),                                     // hood
  ]), paint, true, "bodywork");
  add(merge([
    ...[-1, 1].map((side) => box(cabRear - 0.1 - (xr + 0.35), 0.8, 0.5, (xr + 0.35 + cabRear - 0.1) / 2, 0.95, side * (w / 2 - 0.25))),   // tool boxes
    box(cabRear - 0.1 - (xr + 0.35), 0.12, w - 1.0, (xr + 0.35 + cabRear - 0.1) / 2, 0.6, 0),                                            // deck
    box(0.12, 1.2, w - 0.3, cabRear - 0.15, 1.3, 0),                                                                                      // headboard
  ]), steel, true, "wrecker-body");
  // the boom, rising from behind the cab to the rear, and the wheel-lift folded under the back
  const boom = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 0.32), steel);
  boom.position.set(cabRear - 1.5, 1.75, 0); boom.rotation.z = -0.32; boom.castShadow = true; boom.name = "boom";
  body.add(boom);
  add(merge([box(0.5, 0.14, 0.18, xr - 0.15, 0.32, 0), box(0.14, 0.12, w - 0.5, xr - 0.4, 0.3, 0)]), steel, false, "wheel-lift");
  add(merge([box(0.06, 0.6, w - 0.36, cabFront + 0.005, 1.65, 0), box(cabFront - cabRear - 0.5, 0.5, w - 0.18, (cabRear + cabFront) / 2 + 0.1, 1.65, 0)]), shared.glass, false, "windows");
  add(merge([box(0.18, 0.28, w - 0.1, xf + 0.02, 0.55, 0), box(xf - xr - 0.5, 0.25, 0.9, (xr + xf) / 2, 0.45, 0)]), shared.trim, false, "trim");
  add(merge([box(0.05, 0.16, 0.3, xf + 0.01, 0.92, -(w / 2 - 0.35)), box(0.05, 0.16, 0.3, xf + 0.01, 0.92, w / 2 - 0.35)]), shared.head, false, "headlamps");
  const lenses = addLightBars(body, [
    { x: (cabRear + cabFront) / 2, y: cabRoof + 0.07, z: 0, len: 0.28, span: w - 0.5 },   // on the cab roof
    { x: cabRear - 0.15, y: 1.97, z: 0, len: 0.16, span: w - 0.6 },                        // on the headboard, seen from behind
  ], [AMBER, AMBER, 0xffe0a0]);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.length + 0.6, w + 0.6).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(spec.length / 2 - spec.rearOverhang, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  const track = spec.track / 2, tire = 0.4;
  for (const [x, z, dual] of [[wb, -track, false], [wb, track, false], [0, -track, true], [0, track, true]]) {
    const wh = wheel(tire, dual ? 0.5 : 0.26);
    wh.position.set(x, tire, z);
    g.add(wh);
  }
  return { g, lenses };
}

function policeCar(vehicle) {
  const g = createCarMesh(vehicle.color ?? 0xf4f4f0, vehicle.id, 3);   // (the traffic's SUV)
  g.name = "roadside-police";
  const bounds = new THREE.Box3().setFromObject(g);
  const roof = bounds.max.y, x = (bounds.min.x + bounds.max.x) / 2 - 0.25;
  const bar = new THREE.Group();
  const lenses = addLightBars(bar, [{ x, y: roof + 0.09, z: 0, len: 0.26, span: 1.25 }], [0xff1a1a, 0x1a4dff]);
  const push = new THREE.Mesh(merge([box(0.08, 0.5, 1.3, bounds.max.x + 0.08, 0.62, 0), ...[-1, 1].map((side) => box(0.3, 0.07, 0.07, bounds.max.x - 0.06, 0.5, side * 0.45))]), shared.trim);
  push.name = "push-bar";
  bar.add(push);
  g.add(bar);
  return { g, lenses };
}

export function createRoadsideMesh(vehicle) {
  const { g, lenses } = vehicle.kind === "police" ? policeCar(vehicle) : towTruck(vehicle);
  g.userData.roadside = { kind: vehicle.kind, lenses, phase: hash01(vehicle.id, 7) };
  g.position.set(vehicle.x, 0, -vehicle.y);
  g.rotation.y = vehicle.psi;
  return g;
}

export function syncRoadside(mesh, vehicle, dt = 0, t = 0, lightsOn = 0) {
  if (!mesh) return;
  const u = mesh.userData.roadside;
  if (u.kind === "police") syncCar(mesh, vehicle, dt, t, lightsOn);
  else { mesh.position.set(vehicle.x, 0, -vehicle.y); mesh.rotation.y = vehicle.psi; }
  flashLights(u.lenses, !!vehicle.flashing, t, u.phase);
}
