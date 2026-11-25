import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const three = new URL("../static/vendor/three/", import.meta.url);
    if (specifier === "three") return nextResolve(new URL("build/three.module.js", three).href, context);
    if (specifier.startsWith("three/addons/"))
      return nextResolve(new URL(specifier.replace("three/addons/", "examples/jsm/"), three).href, context);
    return nextResolve(specifier, context);
  },
});

// Canvas drawing is outside these scene-graph checks. Preserve the drawing inputs, including sign text.
const drawing = () => {
  const trace = [];
  return new Proxy(
    {
      trace,
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      measureText: (value) => ({ width: String(value).length * 12 }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    },
    {
      get(target, key) {
        return (
          target[key] ?? ((...args) => trace.push([key, ...args.slice(0, 6).filter((a) => typeof a !== "object")]))
        );
      },
    },
  );
};
globalThis.document = {
  querySelector: () => null,
  createElement() {
    const ctx = drawing();
    return { width: 0, height: 0, trace: ctx.trace, getContext: () => ctx };
  },
};

const THREE = await import("three");
const { mountActorViews, mountFeatureViews, mountTransitScenery } = await import(
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
  mountTransitScenery(view, world.map);
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
    frames.push(graphDigest(view.scene));
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
