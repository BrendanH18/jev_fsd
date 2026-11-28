import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import "./render_actor_test_support.mjs";

const THREE = await import("three");
const { mountActorViews, mountFeatureScenery, mountFeatureViews, replayActorPose } = await import(
  "../static/js/render/feature-views.js"
);
const { createCarMesh, addHeadlights } = await import("../static/js/render/cars.js");
const { CAR } = await import("../static/js/sim/vehicle.js");

const pose = (id, values = {}) => ({ id, x: 22, y: -3, psi: 0, v: 4, delta: 0.1, spec: CAR, ...values });
const person = (id, values = {}) => ({ id, look: id, x: 28, y: 4, psi: 0.5, v: 1.3, phase: 0.6, ...values });
const drawKinds = [
  "bike",
  "ambulance",
  "fire_truck",
  "bus",
  "streetcar",
  "train",
  "school_bus",
  "snow_plow",
  "collection_truck",
  "delivery_van",
  "constructor",
];

function sample() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const view = { scene, camera, addScenery: (group) => scene.add(group) };
  const edge = {
    id: "road",
    pts: [
      [0, 0],
      [110, 0],
    ],
    cum: [0, 110],
    length: 110,
    lane_width: 3.5,
    lane_offsets: [1.75, 5.25],
    asphalt: [-3.5, 7],
  };
  const map = {
    edges: new Map([["road", edge]]),
    transit: [],
    intersections: new Map(),
    calming: [{ type: "hump", at: [{ edge: "road", s: 22 }] }],
    rail: [],
    buslanes: [],
    extent: [0, -10, 110, 10],
  };
  const tow = pose("tow", { roadside: true, kind: "tow_truck", flashing: true });
  const cruiser = pose("cruiser", { roadside: true, kind: "police", flashing: true });
  const van = pose("van", { doubleParked: true, hazards: true, kind: "delivery_van" });
  const work = pose("work", { workzone: true });
  const closure = pose("closure", { closure: true });
  const base = pose("parked", { color: 0x335577, curb: "right" });
  const workZone = {
    id: "work",
    closed: "road",
    r: 24,
    f: 56,
    heading: 0.2,
    x: 20,
    y: 0,
    phase: "open",
    closure: work,
    flaggers: { closed: [24, -6], open: [57, 4] },
    signs: { closed: [12, -6], open: [72, 4] },
  };
  const laneClosure = {
    id: "merge",
    edge: "road",
    closed: 1,
    open: 0,
    m: 15,
    r: 34,
    f: 58,
    heading: 0,
    x: 30,
    y: 0,
    closure,
    signs: { ahead: [9, -9], merge: [21, -9] },
  };
  const hole = { x: 22, y: -3.76, a: 0.9, b: 0.9, heading: 0, depth: 0.15, shape: 18 };
  const list = [base, tow, cruiser, van, work, closure];
  const world = {
    map,
    t: 0.1,
    weather: "rain",
    clock: { hour: 23 },
    ego: pose("ego", { highBeam: true }),
    busLanes: true,
    sunGlare: { enabled: false },
    geese: { enabled: false },
    visibility: { night: 1, occluded: () => false },
    streetLightsOut: true,
    parked: {
      list,
      added: list.slice(),
      removed: [],
      activeDoors: [{ id: "open", owner: base, x: 23, y: -3.7, psi: 0.5 }],
    },
    crowd: {
      list: [
        person("adult"),
        person("kid_1", { child: true }),
        person("guard", { worker: true, crossingGuard: true, paddle: "up" }),
      ],
    },
    contraflow: { riders: [pose("contra", { kind: "bike", x: 40 })] },
    driveways: { cars: [pose("driveway", { x: 43, reverseLamps: true })] },
    roadside: { vehicles: [tow] },
    officers: { enabled: false, list: [{ cruiser: { parked: true, id: cruiser.id, vehicle: cruiser } }] },
    workZones: { zones: [workZone] },
    laneClosures: { zones: [laneClosure] },
    doubleParked: { vans: [{ van }, { truck: true, van: pose("collection_truck") }] },
    highBeams: true,
    calming: true,
    potholes: { enabled: true, list: [hole], near: () => [hole] },
    parkers: { enabled: true },
    tailgaters: { enabled: true },
  };
  const fleet = {
    vehicles: drawKinds.map((kind, i) =>
      pose(kind, {
        kind,
        x: 22 + i * 3,
        color: 0x224466 + i * 0x050201,
        ref: "14",
        headsign: "Downtown",
        doors: true,
        signal: "left",
        siren: true,
        beacons: true,
        hazards: true,
        school: { stage: "loading" },
        ...(kind === "constructor" && { reverseLamps: true, tailgate: { close: true, phase: 0, since: 0 } }),
      }),
    ),
  };
  return { view, world, fleet };
}

function graphDigest(scene) {
  const hash = createHash("sha256");
  const add = (value) => hash.update(JSON.stringify(value));
  scene.traverse((object) => {
    add([
      object.name,
      object.type,
      object.children.length,
      object.position.toArray(),
      object.quaternion.toArray(),
      object.scale.toArray(),
      object.visible,
      object.castShadow,
      object.receiveShadow,
      object.renderOrder,
      object.intensity,
    ]);
    if (object.geometry) {
      for (const [name, attribute] of Object.entries(object.geometry.attributes)) {
        add([name, attribute.itemSize, attribute.normalized]);
        hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      }
      if (object.geometry.index) hash.update(Buffer.from(object.geometry.index.array.buffer));
      add(object.geometry.groups);
    }
    if (object.instanceMatrix) hash.update(Buffer.from(object.instanceMatrix.array.buffer));
    if (object.instanceColor) hash.update(Buffer.from(object.instanceColor.array.buffer));
    for (const material of [object.material].flat().filter(Boolean)) {
      add([
        material.type,
        material.color?.getHex(),
        material.emissive?.getHex(),
        material.emissiveIntensity,
        material.roughness,
        material.metalness,
        material.visible,
        material.opacity,
        material.transparent,
        material.depthWrite,
        material.depthTest,
        material.side,
        material.map?.image?.trace,
      ]);
    }
  });
  return hash.digest("hex");
}

test("mixed traffic, parked features, pedestrians and replay go through the browser actor adapter", () => {
  const { view, world, fleet } = sample();
  mountFeatureScenery(view, world.map);
  const features = mountFeatureViews(view, world);
  const actors = mountActorViews(view, world, fleet);
  const ego = createCarMesh(0x2f7cff);
  addHeadlights(ego);
  view.scene.add(ego);

  const frames = [];
  const render = (replay = null) => {
    actors.sync();
    actors.updateEgo(ego, { ...world.ego }, 0.1, 0.6);
    actors.updateVehicles(0.1, 0.6, 0.25, replay, 0.5);
    actors.updatePeople(0.25, replay, 0.5);
    features.update(fleet, actors.people, 0.1, 0.6);
    if (process.argv.includes("--scene-digest")) frames.push(graphDigest(view.scene));
  };

  render();
  assert.equal(ego.userData.headlights[0].intensity, 108);
  assert.equal(actors.people.get("guard").userData.guardSign.position.y, 0.5);
  assert.equal(view.scene.getObjectByName("work-zone-work").userData.workZone.arrow.emissiveIntensity, 6);
  assert.equal(view.scene.getObjectByName("lane-closure-merge").userData.laneClosure.arrow.emissiveIntensity, 6);
  assert.equal(view.scene.children.filter((child) => child.userData.bus).length, 1);
  assert.equal(view.scene.children.filter((child) => child.userData.streetcar).length, 1);
  assert.equal(view.scene.children.filter((child) => child.userData.train).length, 1);
  assert.equal(view.scene.children.filter((child) => child.userData.bike).length, 2);
  assert.equal(view.scene.children.filter((child) => child.userData.van).length, 2);
  assert.equal(view.scene.children.filter((child) => child.userData.plow).length, 1);
  assert.equal(view.scene.children.filter((child) => child.userData.truck).length, 1);
  assert.equal(view.scene.children.filter((child) => child.userData.roadside).length, 2);

  const bus = view.scene.children.find((child) => child.userData.bus);
  const before = bus.position.x;
  const initialIdle = bus.userData.open;
  actors.capture();
  for (const v of [...fleet.vehicles, ...world.contraflow.riders, ...world.driveways.cars]) v.x += 4;
  const guard = world.crowd.list[2];
  guard.paddle = "down";
  world.t = 0.7;
  render();
  assert.equal(bus.position.x, before + 1);
  assert.equal(bus.userData.open > initialIdle, true);
  assert.equal(actors.people.get("guard").userData.guardSign.position.y, 0.05);
  assert.equal(view.scene.getObjectByName("work-zone-work").userData.workZone.arrow.emissiveIntensity, 0);

  world.parked.activeDoors.length = 0;
  world.crowd.list.splice(1, 1);
  world.parked.list = world.parked.list.filter((car) => !car.doubleParked);
  actors.restore();
  render({
    fleet: { vehicles: fleet.vehicles.map((v) => ({ ...v, x: v.x + 2 })) },
    world: { crowd: { list: world.crowd.list.map((p) => ({ ...p, y: p.y + 4 })) } },
  });
  assert.equal(bus.position.x, before + 5);
  assert.equal(actors.people.has("kid_1"), false);
  assert.equal(actors.people.get("guard").position.z, -6);
  assert.equal(view.scene.children.filter((child) => child.userData.van && child.visible).length, 1);
  if (process.argv.includes("--scene-digest")) console.log(frames.join("\n"));
});

test("checkpoint motion preserves lights, door latches, and other discrete state", () => {
  const old = pose("bus", { kind: "bus", doors: false, signal: "left" });
  const next = pose("bus", { kind: "bus", doors: true, signal: "right", x: old.x + 6, psi: 0.4 });
  const between = replayActorPose(old, next, 0.5);
  assert.equal(between.x, old.x + 3);
  assert.ok(Math.abs(between.psi - 0.2) < 1e-8);
  assert.equal(between.doors, false);
  assert.equal(between.signal, "left");
  assert.equal(next.doors, true);
  assert.equal(replayActorPose(old, { ...next, x: 113 }, 0.5) === old, true);
  assert.equal(replayActorPose(old, { ...next, kind: "bike" }, 0.5) === old, true);
  assert.equal(replayActorPose(old, null, 0.5) === old, true);
});

test("moving car batches follow the animated parts and release draws as cars leave", () => {
  const { view, world } = sample();
  const first = pose("first", { x: 29, style: 0, signal: "left" });
  const second = pose("second", { x: 38, style: 0, psi: 0.45, signal: "left" });
  const fleet = { vehicles: [first, second] };
  const actors = mountActorViews(view, world, fleet);
  const draw = () => {
    actors.sync();
    actors.updateVehicles(0.1, 0.6, 1, null, 0);
  };
  draw();
  const car = view.scene.children.find((node) => node.name === "car-sedan" && node.position.x === first.x);
  const batchFor = (mesh) =>
    view.scene.children.find((node) => node.name === "moving-traffic-batch" && node.geometry === mesh.geometry);
  const bodywork = car.getObjectByName("bodywork");
  const bodies = batchFor(bodywork);
  const lens = car.userData.blinkers.left;
  const indicators = batchFor(lens);
  const wheel = car.userData.wheels.find(({ steer }) => steer).wheel;
  const wheels = batchFor(wheel);
  assert.deepEqual([bodies.count, indicators.count, wheels.count], [2, 2, 8]);
  assert.equal(bodywork.layers.mask, 0);
  assert.equal(lens.visible, true);
  assert.equal(car.getObjectByName("rear-lamps").layers.mask, 1);
  assert.equal(wheels.castShadow, wheel.castShadow);
  const matrix = new THREE.Matrix4();
  const wheelIndex = car.userData.wheels.findIndex((entry) => entry.wheel === wheel);
  wheels.getMatrixAt(wheelIndex, matrix);
  assert.deepEqual(matrix.elements, wheel.matrixWorld.elements.map(Math.fround));

  assert.throws(() => {
    actors.updateVehicles(0, 0.6, 1, null, 0, () => {
      throw new Error("interrupted road effects");
    });
  }, /interrupted road effects/);
  draw();
  assert.deepEqual([bodies.count, indicators.count, wheels.count], [2, 2, 8]);

  world.t = 0.6; // Both indicators blink off but will reuse the same batch.
  draw();
  assert.equal(indicators.count, 0);
  assert.equal(indicators.parent, view.scene);
  world.t = 0.9;
  draw();
  assert.equal(indicators.count, 2);

  first.x = 30;
  first.delta = 0.4;
  second.signal = null;
  draw();
  wheels.getMatrixAt(wheelIndex, matrix);
  assert.deepEqual(matrix.elements, wheel.matrixWorld.elements.map(Math.fround));
  assert.equal(lens.layers.mask, 1);
  assert.equal(indicators.visible, false);

  fleet.vehicles.pop();
  draw();
  assert.equal(bodywork.layers.mask, 1);
  assert.equal(bodies.count, 0);
  assert.equal(wheels.count, 4);
  let disposed = 0;
  wheels.addEventListener("dispose", () => disposed++);
  fleet.vehicles.pop();
  draw();
  assert.equal(disposed, 1);
  assert.equal(batchFor(wheel), undefined);
});

test("moving, parking again and reinstating an earlier bay preserve one drawing", () => {
  const { view, world, fleet } = sample();
  const original = world.parked.list[0];
  Object.freeze(original);
  const actors = mountActorViews(view, world, fleet);
  assert.equal(world.parked.added.length, world.parked.list.length);
  const { mesh, i } = view.scene.children.find((node) => node.userData.instances).userData.instances.get(original)[0];
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  assert.equal(m.elements[12], original.x);
  world.parked.list.shift();
  world.parked.removed.push(original);
  const sameIdElsewhere = pose(original.id, { x: 65 });
  world.parked.list.push(sameIdElsewhere);
  world.parked.added.push(sameIdElsewhere, sameIdElsewhere);
  actors.sync();
  mesh.getMatrixAt(i, m);
  assert.equal(m.elements[0], 0);
  assert.equal(world.parked.added.at(-1) === sameIdElsewhere, true);
  assert.equal(world.parked.removed.length, 1);
  const at = () => view.scene.children.filter((node) => node.userData.style && node.position.x === 65);
  assert.equal(at().length, 1);

  world.parked.list.pop();
  world.parked.list.unshift({ ...original });
  world.parked.removed.push(original);
  const transient = at()[0].userData.pool.geometry;
  let retired = 0;
  transient.addEventListener("dispose", () => retired++);
  actors.restore();
  actors.sync();
  mesh.getMatrixAt(i, m);
  assert.equal(m.elements[12], original.x);
  assert.equal(at().length, 0);
  assert.equal(retired, 1);
  assert.equal(world.parked.added.at(-1) === sameIdElsewhere, true);
  assert.equal(world.parked.removed.length, 2);
});

test("a traffic car that finishes parking has unlit rear lamps", () => {
  const { view, world, fleet } = sample();
  const car = pose("parker", { x: 70 });
  fleet.vehicles.push(car);
  const actors = mountActorViews(view, world, fleet);
  fleet.vehicles.pop();
  car.v = 0;
  world.parked.list.push(car);
  world.parked.added.push(car);
  actors.sync();
  const mesh = view.scene.children.find((node) => node.userData.style && node.position.x === car.x);
  assert.equal(mesh.userData.tail.emissiveIntensity, 0);
  assert.equal(
    mesh.userData.brake.some((lamp) => lamp.visible),
    false,
  );
});

test("retired traffic frees its resources and a reused ID can show a new vehicle kind", () => {
  const { view, world, fleet } = sample();
  const actors = mountActorViews(view, world, fleet);
  const bus = view.scene.children.find((node) => node.userData.bus);
  const destination = bus.getObjectByName("destination").material;
  const ownedHead = bus.userData.head;
  let ownedDisposed = 0;
  let sharedDisposed = 0;
  ownedHead.addEventListener("dispose", () => ownedDisposed++);
  destination.addEventListener("dispose", () => sharedDisposed++);
  const busState = fleet.vehicles.find((v) => v.id === "bus");
  busState.kind = "bike";
  actors.sync();
  assert.equal(bus.parent === null, true);
  assert.equal(ownedDisposed, 1);
  assert.equal(sharedDisposed, 0);
  actors.updateVehicles(0, 0, 1, null, 0);
  assert.equal(view.scene.children.filter((node) => node.userData.bike).length, 3);
});

test("render-side high-beam policy cannot overwrite the pose supplied by the simulation", () => {
  const { view, world, fleet } = sample();
  const actors = mountActorViews(view, world, fleet);
  const ego = createCarMesh();
  addHeadlights(ego);
  const supplied = { ...world.ego, highBeam: false };
  actors.updateEgo(ego, supplied, 0, 1);
  assert.equal(supplied.highBeam, false);
  assert.equal(ego.userData.headlights[0].intensity, 180);
});

test("feature badges retain their references to mounted visual state", () => {
  const { view, world } = sample();
  world.balls = { enabled: true };
  world.ice = { enabled: true };
  world.roadClosures = { enabled: true };
  const features = mountFeatureViews(view, world);
  assert.equal(features.balls.meshes.size, 0);
  assert.equal(features.roadClosures.meshes.size, 0);
  assert.equal(features.ice.group.visible, false);
  assert.equal(features.puddles, null);
});

test("unbatched feature poses follow their own scenario records", () => {
  const { view, world, fleet } = sample();
  const actors = mountActorViews(view, world, fleet);
  actors.updateVehicles(0, 0, 1, null, 0);
  const reversing = view.scene.children.find((node) => node.position.x === 43 && node.userData.reverseLamps);
  assert.equal(
    reversing.userData.reverseLamps.every((m) => m.visible),
    true,
  );
  const tow = view.scene.getObjectByName("roadside-tow_truck") ?? view.scene.getObjectByName("roadside-tow");
  assert.ok(tow?.userData.roadside);
  assert.equal(view.scene.getObjectByName("roadside-police").userData.roadside.kind, "police");
  assert.equal(view.scene.children.filter((node) => node.userData.schoolBus).length, 1);
  assert.ok(view.scene.children.some((node) => node.userData.emergency && node.userData.kind === "fire_truck"));
  const ordinary = view.scene.children.find((node) => node.userData.style && node.userData.flashHead);
  assert.ok(!!ordinary?.userData.flashHead);
  assert.equal(view.scene.children.filter((node) => node.position.x === 40 && node.userData.bike).length, 1);
  const { world: state } = sample();
  const frozen = mountActorViews(view, state, { vehicles: [] });
  frozen.updatePeople(1, null, 0, "dry");
  assert.equal(frozen.people.get("adult").userData.umbrella.visible, false);
});
