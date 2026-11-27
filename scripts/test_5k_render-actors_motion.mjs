import assert from "node:assert/strict";
import { test } from "node:test";
import "./render_actor_test_support.mjs";

const THREE = await import("three");
const { actorTime, advanceRotation, flashPhase, followAnimation, readBrakeLevel, resetActorMotion } = await import(
  "../static/js/render/actor-motion.js"
);
const { createBusMesh, syncBus } = await import("../static/js/render/bus.js");
const { createSchoolBusMesh, syncSchoolBus } = await import("../static/js/render/school-bus.js");
const { createStreetcarMesh, syncStreetcar } = await import("../static/js/render/streetcar.js");
const { createTrainMesh, syncTrain } = await import("../static/js/render/rail.js");
const { createVanMesh, syncVan } = await import("../static/js/render/delivery-van.js");
const { createTruckMesh, syncTruck } = await import("../static/js/render/collection-truck.js");
const { createPlowMesh, syncPlow } = await import("../static/js/render/snow-plow.js");
const { createEmergencyMesh, syncEmergency, flashLights } = await import("../static/js/render/emergency.js");
const { createRoadsideMesh, syncRoadside } = await import("../static/js/render/roadside.js");
const { createBikeMesh, syncBike, createCarMesh, syncCar, addHeadlights, syncDoor, createDoorMesh } = await import(
  "../static/js/render/cars.js"
);
const { syncReverseLamps } = await import("../static/js/render/driveway-reversers.js");
const { syncTailgaterFlash } = await import("../static/js/render/tailgaters.js");
const { createPersonMesh, syncPerson } = await import("../static/js/render/people.js");
const { createOfficerMesh, syncOfficer, OfficerView } = await import("../static/js/render/traffic-officer.js");
const { GeeseView } = await import("../static/js/render/geese.js");
const { createWorkZoneMesh, syncWorkZone } = await import("../static/js/render/work-zone.js");
const { createLaneClosureMesh, syncLaneClosure } = await import("../static/js/render/lane-closure.js");
const { potholeJolt } = await import("../static/js/render/potholes.js");
const { rideOver } = await import("../static/js/render/traffic-calming.js");
const { retireActor, shareActorResources } = await import("../static/js/render/actor-resources.js");
const { CAR } = await import("../static/js/sim/vehicle.js");

const pose = { id: "actor", x: 20, y: 13, psi: 0, v: 6, delta: 0.18, spec: CAR };
const camera = new THREE.PerspectiveCamera();
const approx = (value, expect) => assert.ok(Math.abs(value - expect) < 1e-7, `${value} != ${expect}`);

test("rotation stays bounded, respects reverse, and holds at bad time or speed samples", () => {
  const rot = advanceRotation(0, 90, 5000, 0.4);
  assert.ok(Math.abs(rot) < 2 * Math.PI);
  assert.ok(advanceRotation(0, -3, 0.1, 0.4) < 0);
  assert.equal(advanceRotation(0.1, 10, Infinity, 0.4), 0.1);
  assert.equal(advanceRotation(0.1, Number.NaN, 0.1, 0.4), 0.1);
  assert.equal(advanceRotation(0.1, 10, 0, 0.4), 0.1);
  assert.equal(followAnimation(0.6, 1, -0.1, 3), 0.6);
  assert.equal(followAnimation(0.6, 1, 10, 3), 1);
  approx(flashPhase(-0.1, 0.8), 0.875);
  approx(flashPhase(0.7, 0.8), 0.875);
});

test("brakes distinguish slowing in reverse from starting to reverse", () => {
  const state = { prevV: null, brakeLevel: 0 };
  assert.equal(readBrakeLevel(state, -8, 0.2), 0);
  assert.equal(readBrakeLevel(state, -6, 0.2), 1);
  assert.equal(readBrakeLevel(state, -9, 0.2), 0);
  assert.equal(readBrakeLevel(state, 0, 0.1), 1);
  assert.equal(readBrakeLevel(state, Number.NaN, 0.1), 1);
  assert.equal(readBrakeLevel(state, 2, 0), 1);
});

const models = [
  ["bus", () => createBusMesh(pose.id, "15 Downtown"), syncBus],
  ["school bus", () => createSchoolBusMesh(pose.id), syncSchoolBus],
  ["streetcar", () => createStreetcarMesh(pose.id, "501 Queen"), syncStreetcar],
  ["heritage train", () => createTrainMesh(pose.id), syncTrain],
  ["delivery van", () => createVanMesh(pose), syncVan],
  ["collection truck", () => createTruckMesh(pose), syncTruck],
  ["snowplow", () => createPlowMesh(pose), syncPlow],
  ["ambulance", () => createEmergencyMesh("ambulance", pose.id), syncEmergency],
  ["fire truck", () => createEmergencyMesh("fire_truck", pose.id), syncEmergency],
];

for (const [name, create, sync] of models) {
  test(`${name} follows its pose and lights without changing a second vehicle`, () => {
    const a = create();
    const b = create();
    sync(b, pose, 0, 0, 0.9);
    sync(a, { ...pose, psi: 0.7 }, 0, 0, 0);
    assert.equal(a.position.x, pose.x);
    assert.equal(a.position.z, -pose.y);
    assert.equal(a.rotation.y, 0.7);
    approx(a.userData.head.emissiveIntensity, 0.6);
    approx(b.userData.head.emissiveIntensity, 6);
    const u = a.userData;
    const before = u.brake.emissiveIntensity;
    assert.equal(u.brakeLevel, 0);
    sync(a, { ...pose, v: 2 }, 0.1, 0.1, 0);
    assert.ok(u.brake.emissiveIntensity > before);
    assert.ok(b.userData.brakeLevel === 0);
    if (u.wheels) {
      const front = u.wheels.find((wheel) => wheel.steer);
      const rear = u.wheels.find((wheel) => !wheel.steer);
      assert.equal(front.pivot.rotation.y, pose.delta);
      assert.equal(rear.pivot.rotation.y, 0);
      assert.ok(front.wheel.rotation.z < 0);
    }
  });
}

test("roadside tow headlamps follow visibility separately from its warning strobes", () => {
  const state = { ...pose, kind: "tow_truck", flashing: false };
  const mesh = createRoadsideMesh(state);
  syncRoadside(mesh, state, 0, 2, 0.5);
  approx(mesh.userData.roadside.head.emissiveIntensity, 3.6);
  assert.equal(
    mesh.userData.roadside.lenses.left.every((m) => m.material.emissiveIntensity === 0),
    true,
  );
});

test("hazard and directional lamps have distinct states on commercial vehicles", () => {
  for (const [create, sync, lensesKey] of [
    [createVanMesh, syncVan, "lenses"],
    [createTruckMesh, syncTruck, "hazards"],
  ]) {
    const mesh = create(pose);
    const t = lensesKey === "lenses" ? 0.81 - mesh.userData.phase : 0.01;
    const lenses = mesh.userData[lensesKey];
    sync(mesh, { ...pose, signal: "left" }, 0.05, t, 0);
    assert.equal(
      lenses.every(({ mesh: m, side }) => m.material.emissiveIntensity === (side === "left" ? 6 : 0)),
      true,
    );
    sync(mesh, { ...pose, hazards: true, signal: "right" }, 0.05, t, 0);
    assert.equal(
      lenses.every(({ mesh: m }) => m.material.emissiveIntensity === 6),
      true,
    );
    sync(mesh, { ...pose, hazards: true }, 0.05, t + 0.51, 0);
    assert.equal(
      lenses.every(({ mesh: m }) => m.material.emissiveIntensity === 0),
      true,
    );
  }
});

test("bicycle wheel rolls, steers and leans while the rear pivot stays straight", () => {
  const bike = createBikeMesh();
  syncBike(bike, { ...pose, latAccel: 1.6 }, 0.15);
  const u = bike.userData;
  assert.ok(bike.rotation.x < 0);
  assert.equal(u.wheels[0].pivot.rotation.y, 0);
  assert.equal(u.wheels[1].pivot.rotation.y, pose.delta);
  assert.ok(u.wheels[1].wheel.rotation.z < 0);
  assert.ok(u.rider.userData.body.rotation.z < 0);
  const crank = u.crank;
  syncBike(bike, pose, 0);
  assert.equal(u.crank, crank);
});

test("transit doors open in pairs, stop to rest, and never drift with a negative frame time", () => {
  const bus = createBusMesh("bus", "14 Downtown");
  const tram = createStreetcarMesh();
  for (const [m, sync] of [
    [bus, syncBus],
    [tram, syncStreetcar],
  ]) {
    sync(m, { ...pose, doors: true }, 0.5);
    assert.equal(m.userData.open, 1);
    assert.equal(m.userData.doors[0].leaf.position.x < m.userData.doors[1].leaf.position.x, true);
    sync(m, { ...pose, doors: false }, -0.3);
    assert.equal(m.userData.open, 1);
    sync(m, { ...pose, doors: false }, 0.5);
    assert.equal(m.userData.open, 0);
  }
  const sign = bus.getObjectByName("rear-route").material;
  assert.equal(
    sign.map.image.trace.some(([call, value]) => call === "fillText" && value === "14"),
    true,
  );
});

test("school-bus lamps select the authoritative colour and stop arm stays linked to its hinge", () => {
  const mesh = createSchoolBusMesh();
  const u = mesh.userData;
  const state = { ...pose, school: { lights: "red", arm: true }, doors: true };
  syncSchoolBus(mesh, state, 0.5, 0);
  assert.equal(u.arm.rotation.y, -Math.PI / 2);
  assert.equal(u.arm.children[0].name, "stop-arm-linkage");
  assert.equal(u.open, 1);
  assert.equal(u.lamps.red.left.emissiveIntensity, 6);
  assert.equal(u.lamps.red.right.emissiveIntensity, 0);
  assert.equal(u.lamps.amber.left.emissiveIntensity, 0);
  syncSchoolBus(mesh, { ...state, school: { lights: "amber" }, doors: false }, 0.5, 0.65);
  approx(u.arm.rotation.y, 0);
  assert.equal(u.lamps.red.left.emissiveIntensity, 0);
  assert.ok(u.lamps.amber.left.emissiveIntensity + u.lamps.amber.right.emissiveIntensity === 6);
  assert.equal(u.open, 0);
});

test("warning lights alternate and turn off without affecting another actor", () => {
  const ambulance = createEmergencyMesh("ambulance");
  const lights = ambulance.userData.lenses;
  flashLights(lights, true, 0.01);
  assert.equal(
    lights.left.every((m) => m.material.emissiveIntensity === 9),
    true,
  );
  assert.equal(
    lights.right.every((m) => m.material.emissiveIntensity === 0),
    true,
  );
  flashLights(lights, true, 0.26);
  assert.equal(
    lights.right.every((m) => m.material.emissiveIntensity === 9),
    true,
  );
  flashLights(lights, false, 0.26);
  assert.equal(
    lights.right.every((m) => m.material.emissiveIntensity === 0),
    true,
  );
  const plow = createPlowMesh(pose);
  const u = plow.userData;
  syncPlow(plow, { ...pose, beacons: true }, 0, 0.71 - u.phase);
  assert.equal(
    u.amber.some((m) => m.material.emissiveIntensity > 0),
    true,
  );
  assert.equal(
    u.blue.some((m) => m.material.emissiveIntensity > 0),
    false,
  );
  syncPlow(plow, { ...pose, beacons: true }, 0, 1.07 - u.phase);
  assert.equal(
    u.amber.some((m) => m.material.emissiveIntensity > 0),
    false,
  );
  assert.equal(
    u.blue.some((m) => m.material.emissiveIntensity > 0),
    true,
  );
});

test("ego headlights are idempotent and a tailgater restores its ordinary headlamp after flashing", () => {
  const ego = createCarMesh();
  addHeadlights(ego);
  addHeadlights(ego);
  assert.equal(ego.userData.headlights.length, 2);
  syncCar(ego, { ...pose, highBeam: true }, 0.05, 0, 1);
  assert.equal(ego.userData.headlights[0].distance, 125);
  assert.equal(ego.userData.pool.scale.x, 3);
  const head = ego.userData.head;
  const high = head.material;
  syncTailgaterFlash(ego, true);
  const flash = head.material;
  assert.equal(flash.emissiveIntensity, 9);
  syncCar(ego, pose, 0.05, 0, 1);
  assert.equal(head.material !== high && head.material !== flash, true);
  assert.equal(ego.userData.headlights[0].distance, 70);
  assert.equal(ego.userData.pool.scale.x, 1);
  let disposed = 0;
  for (const m of [flash, high]) m.addEventListener("dispose", () => disposed++);
  retireActor(ego);
  assert.equal(disposed, 2);
});

test("reversing lamps are lazy and hide cleanly when a feature is disabled", () => {
  const mesh = createCarMesh();
  syncReverseLamps(mesh, {});
  assert.equal(mesh.userData.reverseLamps, undefined);
  syncReverseLamps(mesh, { reverseLamps: true });
  assert.equal(mesh.userData.reverseLamps.length, 2);
  assert.equal(
    mesh.userData.reverseLamps.every((lamp) => lamp.visible),
    true,
  );
  syncReverseLamps(mesh, { reverseLamps: true }, false);
  assert.equal(
    mesh.userData.reverseLamps.every((lamp) => !lamp.visible),
    true,
  );
});

test("pedestrian pose remains finite on a missing walk phase and fallen pedestrians drop umbrellas", () => {
  const mesh = Array.from({ length: 8 }, (_, i) => createPersonMesh(i)).find((m) => m.userData.carries);
  syncPerson(mesh, { ...pose, v: 1.2, phase: 1 }, camera, true);
  assert.equal(mesh.userData.umbrella.visible, true);
  syncPerson(mesh, { ...pose, v: 1.2 }, camera, true);
  assert.equal(Number.isFinite(mesh.userData.legs[0].hip.rotation.z), true);
  syncPerson(mesh, { ...pose, v: 1.2, phase: 2, frozen: 1 }, camera, true);
  assert.equal(mesh.userData.umbrella.visible, false);
  assert.equal(mesh.rotation.x, Math.PI / 2);
  assert.equal(Math.abs(mesh.userData.legs[0].hip.rotation.z), 0);
});

test("officer all-stop holds the beckoning arm and rewind removes the future heading", () => {
  const officer = { id: "officer", face: 0, x: 4, y: 7, phase: "A" };
  const mesh = createOfficerMesh(officer);
  syncOfficer(mesh, officer, 0.2, camera);
  const [left, right] = mesh.userData.arms;
  assert.ok(left.elbow.rotation.z > 0);
  assert.equal(right.elbow.rotation.z, Math.PI / 2);
  syncOfficer(mesh, { ...officer, phase: "clear" }, 0.2, camera);
  assert.equal(left.elbow.rotation.z, 0);
  const scene = new THREE.Scene(),
    view = new OfficerView(scene);
  view.sync({ t: 1, officers: { list: [officer] } }, 0.2, camera);
  view.sync({ t: 2, officers: { list: [{ ...officer, face: 1 }] } }, 0.2, camera);
  assert.ok(scene.children[0].rotation.y > 0);
  view.sync({ t: 0, officers: { list: [officer] } }, 0, camera);
  assert.equal(scene.children[0].rotation.y, 0);
});

test("officer and cruiser cleanup track their independent membership", () => {
  const scene = new THREE.Scene();
  const view = new OfficerView(scene);
  const officer = { id: "same", face: 0, x: 4, y: 7, phase: "A" };
  const cruiser = { parked: false, vehicle: { ...pose, kind: "police", id: "same" } };
  view.sync({ t: 0, officers: { list: [{ ...officer, cruiser }] } }, 0.1, camera);
  assert.equal(scene.children.length, 2);
  view.sync({ t: 1, officers: { list: [officer] } }, 0.1, camera);
  assert.equal(scene.children.length, 1);
  assert.equal(view.cruisers.size, 0);
});

test("goose visibility follows the camera and uploads just the active instance range", () => {
  const scene = new THREE.Scene();
  const view = new GeeseView(scene);
  const cam = new THREE.PerspectiveCamera();
  const goose = { x: 11, y: 0, psi: 0, gosling: false, wobble: 0, v: 0.3, u: 3 };
  const world = {
    ego: { x: 500, y: 0 },
    geese: { gaggles: [{ geo: { mid: [500, 0] }, phase: "walking", geese: [goose] }] },
  };
  view.sync(world, 0.1, cam);
  const adults = scene.getObjectByName("geese_adults");
  assert.equal(adults.count, 1);
  assert.equal(adults.instanceMatrix.usage, THREE.DynamicDrawUsage);
  assert.equal(adults.instanceMatrix.updateRanges[0].count, 16);
  cam.position.x = 500;
  view.sync(world, 0.2, cam);
  assert.equal(adults.count, 0);
  cam.position.x = 11;
  goose.gosling = true;
  view.sync(world, 0.3, cam);
  assert.equal(scene.getObjectByName("geese_goslings").count, 1);
});

test("work-zone paddles turn over elapsed time and snap to restored checkpoint positions", () => {
  const edge = {
    pts: [
      [0, 0],
      [100, 0],
    ],
    cum: [0, 100],
    lane_width: 3.2,
    lane_offsets: [1.6, 4.8],
    asphalt: [-3.2, 6.4],
  };
  const map = { edges: new Map([["road", edge]]) };
  const zone = {
    id: "w",
    closed: "road",
    r: 20,
    f: 53,
    heading: 0,
    x: 26,
    y: -4,
    phase: "closed",
    flaggers: { closed: [22, -4], open: [54, 4] },
    signs: { closed: [3, -5] },
  };
  const mesh = createWorkZoneMesh(zone, map);
  const u = mesh.userData.workZone;
  syncWorkZone(mesh, zone, 0.1, camera, 0);
  assert.equal(u.flaggers.closed.turn, Math.PI);
  assert.equal(u.flaggers.open.turn, 0);
  zone.phase = "open";
  syncWorkZone(mesh, zone, 0.3, camera, 0.2);
  approx(u.flaggers.closed.turn, Math.PI / 2);
  approx(u.flaggers.open.turn, Math.PI / 2);
  syncWorkZone(mesh, zone, 0.5, camera, 0.2);
  assert.equal(u.flaggers.open.turn, Math.PI);
  zone.phase = "closed";
  syncWorkZone(mesh, zone, 0.1, camera, 0);
  assert.equal(u.flaggers.open.turn, 0);
  assert.equal(u.arrow.emissiveIntensity, 6);
  assert.ok(mesh.getObjectByName("cones").count > 4);
  const closure = {
    id: "merge",
    edge: "road",
    closed: 1,
    open: 0,
    m: 13,
    r: 30,
    f: 61,
    heading: 0,
    x: 30,
    y: -5,
    signs: {},
  };
  const taper = createLaneClosureMesh(closure, map);
  syncLaneClosure(taper, closure, 0.75, camera);
  assert.equal(taper.userData.laneClosure.arrow.emissiveIntensity, 0);
  assert.ok(taper.getObjectByName("cone-bands").count > 4);
});

test("a restored mesh releases the previous frame's pitch, roll, and pothole impulse", () => {
  const mesh = createCarMesh();
  syncCar(mesh, { ...pose, ax: -4, latAccel: 2 }, 0.1);
  assert.ok(mesh.userData.pivot.rotation.z < 0);
  assert.ok(mesh.userData.pivot.rotation.x > 0);
  const hole = { x: pose.x, y: pose.y, a: 5, b: 5, heading: 0, depth: 0.15, shape: 18 };
  potholeJolt({ potholes: { list: [hole], near: () => [hole] } }, mesh, pose, 0.1, true);
  assert.equal(mesh.userData.potholeJolt.inside, true);
  mesh.rotation.z = 0.6;
  mesh.position.y = 0.1;
  resetActorMotion(mesh);
  assert.equal(mesh.userData.potholeJolt, undefined);
  assert.equal(mesh.position.y, 0);
  assert.equal(mesh.rotation.z, 0);
  assert.equal(mesh.userData.pivot.rotation.z, 0);
  assert.equal(mesh.userData.pivot.rotation.x, 0);
  assert.equal(mesh.userData.prevV, null);
});

test("pothole and hump offsets compose on the mesh without moving the simulated axle", () => {
  const mesh = createCarMesh();
  const car = { ...pose, x: 22, y: -3 };
  const original = JSON.stringify(car);
  const device = { type: "hump", x: car.x, y: car.y };
  const map = { calmingGrid: new Map([["1,-1", [{ device, h: 0, w: 2 }]]]) };
  rideOver(map, mesh, car);
  assert.ok(mesh.position.y > 0);
  const before = mesh.position.y;
  const hole = { x: car.x, y: car.y - CAR.track / 2, heading: 0, a: 0.7, b: 0.4, depth: 0.1 };
  const world = { potholes: { list: [hole], near: () => [hole] } };
  potholeJolt(world, mesh, car, -1, true);
  assert.ok(mesh.position.y < before);
  assert.equal(JSON.stringify(car), original);
});

test("door panels rotate in the parked car's frame", () => {
  const car = { ...pose, id: "door", psi: Math.PI / 2, curb: "left" };
  const mesh = createDoorMesh(car);
  syncDoor(mesh, { owner: car, x: car.x - 0.5, y: car.y + 1.5, psi: car.psi + 0.5 });
  approx(mesh.userData.swing.position.x, 1.5);
  approx(mesh.userData.swing.position.z, -0.5);
  approx(mesh.userData.swing.rotation.y, 0.5);
  assert.ok(mesh.children[0].position.z > 0);
});

test("actor retirement disposes unique resources and leaves shared material and textures live", () => {
  const geometry = new THREE.BoxGeometry();
  const unique = new THREE.MeshBasicMaterial();
  const texture = new THREE.Texture();
  const shared = new THREE.MeshBasicMaterial({ map: texture });
  const root = new THREE.Group();
  shareActorResources([shared]);
  const instance = new THREE.InstancedMesh(geometry, [unique, shared], 2);
  root.add(instance, new THREE.Mesh(geometry, unique));
  const counts = [0, 0, 0, 0, 0];
  for (const [i, resource] of [geometry, unique, shared, texture, instance].entries()) {
    resource.addEventListener("dispose", () => counts[i]++);
  }
  retireActor(root);
  assert.equal(counts.join(","), "1,1,0,0,1");
});

test("a replay animates lights between checkpoint times instead of aliasing to the recording period", () => {
  const mesh = createEmergencyMesh("ambulance");
  const { phase, lenses } = mesh.userData;
  const start = 0.01 - phase;
  syncEmergency(mesh, { ...pose, siren: true }, 0, actorTime(start, start + 0.5, 0));
  assert.equal(lenses.left[0].material.emissiveIntensity, 9);
  syncEmergency(mesh, { ...pose, siren: true }, 0, actorTime(start, start + 0.5, 0.5));
  assert.equal(lenses.right[0].material.emissiveIntensity, 9);
  assert.equal(actorTime(5, 4, 0.9), 5);
  assert.equal(actorTime(5, 6, -1), 5);
});

test("a paused checkpoint immediately shows the restored school bus doors and stop arm", () => {
  const mesh = createSchoolBusMesh();
  syncSchoolBus(mesh, { ...pose, doors: true, school: { arm: true } }, 0.5);
  resetActorMotion(mesh);
  syncSchoolBus(mesh, { ...pose, doors: false, school: { arm: false } }, 0);
  assert.equal(mesh.userData.open, 0);
  assert.equal(mesh.userData.swing, 0);
});

test("pedestrian scale, stride and culling follow the person rather than the parent scene", () => {
  const adult = createPersonMesh("look");
  const child = createPersonMesh("look", { child: true });
  assert.ok(child.scale.y < adult.scale.y);
  syncPerson(adult, { ...pose, v: 1.5, phase: 0.52 }, camera, false);
  assert.ok(adult.userData.legs[0].hip.rotation.z * adult.userData.legs[1].hip.rotation.z < 0);
  assert.ok(adult.userData.body.position.y > 0.92);
  assert.equal(adult.userData.umbrella.visible, false);
  syncPerson(adult, { ...pose, x: 500 }, camera);
  assert.equal(adult.visible, false);
  syncPerson(adult, { ...pose, v: 0, phase: 0.5 }, camera);
  assert.equal(adult.visible, true);
  approx(adult.userData.body.position.y, 0.92);
});

test("an ordinary car clears its turn signal between flashes and marks only the requested side", () => {
  const car = createCarMesh();
  syncCar(car, { ...pose, signal: "right" }, 0.1, 0.1);
  assert.equal(car.userData.blinkers.right.visible, true);
  assert.equal(car.userData.blinkers.left.visible, false);
  syncCar(car, { ...pose, signal: "right" }, 0.1, 0.6);
  assert.equal(car.userData.blinkers.right.visible, false);
  syncCar(car, { ...pose, signal: "left" }, 0.1, 0.81);
  assert.equal(car.userData.blinkers.left.visible, true);
  assert.equal(car.userData.blinkers.right.visible, false);
});

test("collection truck beacons turn as paired lights when activated", () => {
  const truck = createTruckMesh(pose);
  const u = truck.userData;
  syncTruck(truck, { ...pose, beacons: true }, 0, 0.81 - u.phase);
  assert.equal(u.beacons.filter((m) => m.material.emissiveIntensity === 7).length, 2);
  assert.equal(u.beacons[1].material.emissiveIntensity, 0);
  syncTruck(truck, { ...pose, beacons: true }, 0, 1.29 - u.phase);
  assert.equal(u.beacons[1].material.emissiveIntensity, 7);
  assert.equal(u.beacons[0].material.emissiveIntensity, 0);
  syncTruck(truck, pose, 0, 1.29 - u.phase);
  assert.equal(
    u.beacons.every((m) => m.material.emissiveIntensity === 0),
    true,
  );
});
