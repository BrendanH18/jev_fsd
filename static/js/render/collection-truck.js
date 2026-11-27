import {
  addActorDetails,
  boxDetail as detail,
  mirroredDetails as sides,
  RUBBER,
  STEEL,
  REFLECT_RED,
} from "./actor-details.js";
import { rollWheels, flashPhase, syncHeadMaterial, syncBrakeMaterial, syncAmberLenses } from "./actor-motion.js";
// The garbage truck (sim/collection-truck.js): a rear-loader built from boxes at its simulated size, a
// white cab ahead of a packer body in the city's colour, the hopper and its tailgate at the back with a
// riding step and a grab handle each side for the crew, amber beacons on the cab roof turning while it
// works its round, and the hazard lights flashing while it stands at a stop. Local +X is forward, +Z is
// right, rear axle at the origin, as for cars.

import * as THREE from "three";
import { shareActorResources } from "./actor-resources.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COLLECTION_TRUCK } from "../sim/vehicle.js";
import { lamp, shared, wheel } from "./emergency.js";
import { hash01 } from "./geo.js";
import { snowable } from "./weather.js";

const AMBER = 0xffa21a;
const BEACON_S = 0.8,
  HAZARD_S = 0.8;
const TIRE = 0.52;
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const merge = (parts) =>
  mergeGeometries(
    parts.map((p) => p.toNonIndexed()),
    false,
  );
const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d41, metalness: 0.6, roughness: 0.55 });
const cabPaint = snowable(
  new THREE.MeshPhysicalMaterial({ color: 0xeeeeea, metalness: 0.2, roughness: 0.45, clearcoat: 0.4 }),
  "car",
);
const tail = new THREE.MeshStandardMaterial({
  color: 0x7a0d10,
  emissive: 0x5a0000,
  emissiveIntensity: 0.6,
  roughness: 0.3,
});

shareActorResources([steel, cabPaint, tail]);

export function createTruckMesh(vehicle) {
  const spec = COLLECTION_TRUCK,
    xr = -spec.rearOverhang,
    w = spec.width,
    wb = spec.wheelbase;
  const g = new THREE.Group(),
    body = new THREE.Group();
  g.name = "collection-truck";
  g.add(body);
  const add = (geometry, material, shadow, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };
  const paint = snowable(
    new THREE.MeshPhysicalMaterial({
      color: vehicle.color ?? 0x2f6b3a,
      metalness: 0.25,
      roughness: 0.5,
      clearcoat: 0.3,
    }),
    "car",
  );
  const bodyW = w - 0.15,
    cabRear = wb - 0.4,
    cabFront = wb + 1.55,
    packFront = cabRear - 0.1,
    hopper = xr + 1.5;
  add(
    merge([
      box(cabFront - cabRear, 1.9, bodyW, (cabRear + cabFront) / 2, 1.05 + 1.9 / 2, 0), // cab
    ]),
    cabPaint,
    true,
    "cab",
  );
  add(
    merge([
      box(packFront - hopper, 2.35, bodyW, (hopper + packFront) / 2, 1.15 + 2.35 / 2, 0), // packer body
      box(hopper - xr, 1.9, bodyW - 0.05, (xr + hopper) / 2, 1.55 + 1.9 / 2, 0), // tailgate, above the hopper
    ]),
    paint,
    true,
    "body",
  );
  add(
    merge([
      box(spec.length - 1.2, 0.32, 1.0, (xr + spec.length - spec.rearOverhang - 1.2) / 2, 0.85, 0), // frame rails
      box(0.4, 0.55, bodyW, xr + 0.2, 1.25, 0), // hopper lip
      ...[-1, 1].map((side) => box(0.55, 0.06, 0.6, xr - 0.2, 0.55, side * (bodyW / 2 - 0.35))), // riding steps
      ...[-1, 1].map((side) => box(0.05, 1.1, 0.05, xr + 0.05, 1.6, side * (bodyW / 2 - 0.08))), // grab handles
      ...[-1, 1].map((side) => box(0.9, 0.18, 0.45, wb, TIRE * 2 + 0.1, side * (w / 2 - 0.3))), // front fenders
    ]),
    steel,
    true,
    "frame",
  );
  add(
    merge([
      box(0.04, 0.85, bodyW - 0.3, cabFront + 0.02, 2.3, 0), // windscreen
      ...[-1, 1].map((side) => box(1.2, 0.75, 0.02, cabRear + 0.9, 2.3, side * (bodyW / 2 + 0.005))), // side windows
    ]),
    shared.glass,
    false,
    "windows",
  );
  const head = shared.head.clone();
  add(
    merge([-1, 1].map((side) => box(0.08, 0.22, 0.32, cabFront + 0.04, 1.35, side * (w / 2 - 0.4)))),
    head,
    false,
    "headlamps",
  );
  const brake = tail.clone();
  add(
    merge([-1, 1].map((side) => box(0.05, 0.3, 0.2, xr - 0.01, 1.05, side * (bodyW / 2 - 0.15)))),
    brake,
    false,
    "tail-lamps",
  );
  // (amber beacons on the cab roof and the tailgate's top corners; amber hazards front and back)
  const beacons = [],
    hazards = [];
  for (const [x, y, z] of [
    [cabRear + 0.6, 3.05, -0.6],
    [cabRear + 0.6, 3.05, 0.6],
    [xr + 0.3, 3.55, -(bodyW / 2 - 0.15)],
    [xr + 0.3, 3.55, bodyW / 2 - 0.15],
  ]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 10).translate(x, y, z), lamp(AMBER));
    m.name = "beacon";
    body.add(m);
    beacons.push(m);
  }
  for (const [x, z] of [
    [cabFront + 0.03, -(w / 2 - 0.2)],
    [cabFront + 0.03, w / 2 - 0.2],
    [xr - 0.02, -(bodyW / 2 - 0.15)],
    [xr - 0.02, bodyW / 2 - 0.15],
  ]) {
    const m = new THREE.Mesh(box(0.05, 0.14, 0.18, x, x > 0 ? 1.1 : 1.35, z), lamp(AMBER));
    m.name = "hazard";
    body.add(m);
    hazards.push({ mesh: m, side: z < 0 ? "left" : "right" });
  }
  addActorDetails(body, "collection-truck", () => [
    ...sides((side) => [
      detail("rear-worker-step-surface", RUBBER, 0.38, 0.043, 0.49, xr - 0.23, 0.607, side * (bodyW / 2 - 0.35)),
      detail("hopper-control-panel", RUBBER, 0.23, 0.31, 0.07, hopper - 0.31, 1.69, side * (bodyW / 2 + 0.014)),
      detail("tailgate-hinges", STEEL, 0.32, 0.21, 0.07, hopper - 0.31, 3.3, side * (bodyW / 2 + 0.015)),
      detail(
        "packer-lower-rail",
        STEEL,
        packFront - hopper - 0.1,
        0.09,
        0.11,
        (packFront + hopper) / 2,
        1.27,
        side * (bodyW / 2 + 0.03),
      ),
      detail("rear-hopper-reflectors", REFLECT_RED, 0.031, 0.11, 0.34, xr - 0.021, 1.23, side * (bodyW / 2 - 0.44)),
      detail("cab-access-step", STEEL, 0.55, 0.08, 0.23, cabRear + 0.43, 0.77, side * (bodyW / 2 - 0.05)),
    ]),
    ...Array.from({ length: 7 }, (_, i) =>
      detail("cab-grille", RUBBER, 0.024, 0.044, bodyW * 0.54, cabFront + 0.016, 1.22 + i * 0.07, 0),
    ),
    detail("rollaway-protection", STEEL, 0.12, 0.17, bodyW - 0.17, xr + 0.11, 0.47, 0),
    detail("rear-camera", RUBBER, 0.1, 0.086, 0.13, xr - 0.06, 3.23, 0),
  ]);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.length + 0.8, w + 0.8).rotateX(-Math.PI / 2), shared.blob);
  blob.position.set(spec.length / 2 - spec.rearOverhang, 0.02, 0);
  blob.renderOrder = 1;
  g.add(blob);
  const wheels = [],
    track = spec.track / 2;
  for (const [x, z, steer] of [
    [wb, -track, true],
    [wb, track, true],
    [0, -track, false],
    [0, track, false],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, TIRE, z);
    const wh = wheel(TIRE, 0.36);
    pivot.add(wh);
    g.add(pivot);
    wheels.push({ pivot, wheel: wh, steer });
  }
  g.userData = {
    head,
    brake,
    prevV: null,
    brakeLevel: 0,
    truck: true,
    wheels,
    spin: 0,
    beacons,
    hazards,
    phase: hash01(vehicle.id, 13) * BEACON_S,
  };
  g.position.set(vehicle.x, 0, -vehicle.y);
  g.rotation.y = vehicle.psi;
  return g;
}

export function syncTruck(mesh, vehicle, dt = 0, t = 0, lightsOn = 0) {
  if (!mesh) return;
  mesh.position.set(vehicle.x, 0, -vehicle.y);
  mesh.rotation.y = vehicle.psi;
  const u = mesh.userData;
  syncHeadMaterial(u.head, lightsOn);
  syncBrakeMaterial(u, vehicle.v, dt, lightsOn);
  rollWheels(u, vehicle, dt, TIRE);
  // (the beacons turn in pairs, the hazards blink together)
  const phase = flashPhase(t, BEACON_S, u.phase);
  u.beacons.forEach((m, i) => {
    m.material.emissiveIntensity = vehicle.beacons && phase < 0.5 === (i % 2 === 0) ? 7 : 0;
  });
  syncAmberLenses(u.hazards, vehicle, flashPhase(t, HAZARD_S) < 0.5);
}

export const view = {
  vehicles: { collection_truck: { create: createTruckMesh, sync: syncTruck } },
  transientPeople: ["crew_"],
};
