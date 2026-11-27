// The browser side of the feature registry (docs/feature-interface.md). The simulation registry
// (sim/features/index.js) loads in Node without Three.js, so a record only says where its render module is:
//
//   view: () => import(RENDER_MODULE)        (the path of render/geese.js, say, from the record's file)
//
// This adapter loads those modules once and reads the `view` each exports. It draws traffic, parked cars
// and people itself and never names a feature: whatever a feature draws, it declares in its own view.
//
// A view (every field optional; `order` places it among the other features' and is unique within a field):
//   scenery     { order, build(map) }               scenery of the map alone, added before the World exists
//   mount       { order, run({ view, scene, world, map }), frame?(mounted, { view, world, fleet, people,
//               camera, dt, lightsOn }), signals?(mounted) }   its scene objects for this World: `run` returns
//               null while the feature is off, or what it mounted, kept under the record's key for its
//               notices to read; `frame` then runs once a frame, and `signals` as the signal lamps change
//   vehicles    { [kind]: { create(vehicle), sync(mesh, pose, dt, t, lightsOn), roadEffects?, onRails?,
//               minimap? } }   the mesh and animator of a kind of traffic. `roadEffects: false` leaves it out
//               of the road effects below, `onRails: true` tells them it runs on rails, and `minimap` marks
//               it on the minimap as "emergency" or "transit" (an ordinary dot otherwise).
//   traffic     { order, list(world), after?(mesh, actor), minimap? }   road users it keeps outside the
//               fleet, drawn and interpolated as traffic (`list` is also read from a replay's next
//               checkpoint); `after` runs once the mesh is in place, `minimap` shows them on the minimap
//   parked      { order, flag?, create?(car, world), sync?(world, meshOf, { dt, t, lightsOn, camera }) }
//               a parked car with `car[flag]` set gets a mesh of its own instead of a place in the batch.
//               `create` returns it, placed (or null to leave it to the next feature, then to an ordinary
//               car), and `sync` animates the feature's own each frame (`meshOf(car)` finds one).
//   car         { order, pose?(world, vehicle, pose), effect?(world, mesh, vehicle) }   ordinary cars in
//               traffic: fields added to the pose they are drawn from, and an effect after they are drawn
//   ego         { order, pose(world, pose) }        fields added to the pose the driven car is drawn from
//   roadEffect  { order, run(world, mesh, pose, dt, { onRails }) }   what the road does to a vehicle's mesh
//               (the adapter levels `rotation.z` first, so effects compose in order)
//   person      { order, mount(mesh, person), sync(mesh, person) }   something a person carries
//   transientPeople  [prefix, ...]                  ids of people who come and go, whose meshes are retired
//                                                   once they leave
import { actorTime, resetActorMotion } from "./actor-motion.js";
import { retireActor } from "./actor-resources.js";
import { createPersonMesh, syncPerson } from "./people.js";
import {
  createCarMesh,
  syncCar,
  buildParkedCars,
  createBikeMesh,
  syncBike,
  hideParkedCar,
  restoreParkedCar,
  createDoorMesh,
  syncDoor,
} from "./cars.js";
import { capturePose, interpolatePose } from "../sim/interpolate.js";
import { FEATURE_VIEWS } from "../sim/features/index.js";

const carView = {
  create: (car) => createCarMesh(car.color, car.id, car.style ?? null),
  sync: syncCar,
};

// (a bicycle keeps to its own line over humps and holes)
const bikeView = {
  create: (bike) => createBikeMesh(bike.color, bike.id),
  sync: syncBike,
  roadEffects: false,
};

const ORDERED = {
  scenery: ["order", "build"],
  mount: ["order", "run", "frame", "signals"],
  traffic: ["order", "list", "after", "minimap"],
  parked: ["order", "flag", "create", "sync"],
  car: ["order", "pose", "effect"],
  ego: ["order", "pose"],
  roadEffect: ["order", "run"],
  person: ["order", "mount", "sync"],
};
const REQUIRED = {
  scenery: ["build"],
  mount: ["run"],
  traffic: ["list"],
  ego: ["pose"],
  roadEffect: ["run"],
  person: ["mount", "sync"],
};
const VEHICLE_FIELDS = ["create", "sync", "roadEffects", "onRails", "minimap"];
const MINIMAP_MARKS = ["emergency", "transit"];
const RESERVED = ["update", "updateSignals"];

function viewProblem(key, view) {
  if (!view || typeof view !== "object") return "its render module exports no `view`";
  if (RESERVED.includes(key)) return "its key is a name the adapter uses";
  for (const [field, value] of Object.entries(view)) {
    if (field === "transientPeople") {
      if (!Array.isArray(value) || !value.every((prefix) => typeof prefix === "string" && prefix))
        return "transientPeople must list id prefixes";
    } else if (field === "vehicles") {
      for (const [kind, adapter] of Object.entries(value)) {
        const unknown = Object.keys(adapter).find((name) => !VEHICLE_FIELDS.includes(name));
        if (unknown) return `vehicles.${kind} has an unknown field "${unknown}"`;
        if (typeof adapter.create !== "function" || typeof adapter.sync !== "function")
          return `vehicles.${kind} needs create and sync`;
        if (adapter.minimap !== undefined && !MINIMAP_MARKS.includes(adapter.minimap))
          return `vehicles.${kind}.minimap must be one of ${MINIMAP_MARKS.join(", ")}`;
      }
    } else if (Object.hasOwn(ORDERED, field)) {
      const unknown = Object.keys(value).find((name) => !ORDERED[field].includes(name));
      if (unknown) return `${field} has an unknown field "${unknown}"`;
      if (!Number.isSafeInteger(value.order)) return `${field}.order must be an integer`;
      for (const name of REQUIRED[field] ?? [])
        if (typeof value[name] !== "function") return `${field} needs a ${name} function`;
      if (field === "parked") {
        if (!value.create !== !value.flag) return "parked needs a flag and a create function together";
        if (value.flag !== undefined && (typeof value.flag !== "string" || !value.flag))
          return "parked.flag must name a field of a parked car";
        if (!value.create && !value.sync) return "parked needs create or sync";
      }
    } else return `has an unknown field "${field}"`;
  }
  return null;
}

// Every feature's declarations, each list in the order its features asked for.
export function compileViews(views) {
  const out = { vehicles: new Map([["bike", bikeView]]), transient: [], minimapMarks: new Map() };
  for (const { key, view } of views) {
    const problem = viewProblem(key, view);
    if (problem) throw new Error(`Feature views: ${key}: ${problem}.`);
  }
  for (const field of Object.keys(ORDERED)) {
    const list = views
      .filter(({ view }) => view[field])
      .map(({ key, view }) => ({ key, ...view[field] }))
      .sort((a, b) => a.order - b.order);
    for (let i = 1; i < list.length; i++)
      if (list[i].order === list[i - 1].order)
        throw new Error(`Feature views: ${list[i].key}: ${field} order ${list[i].order} is ${list[i - 1].key}'s.`);
    out[field] = list;
  }
  for (const { key, view } of views) {
    for (const [kind, adapter] of Object.entries(view.vehicles ?? {})) {
      if (out.vehicles.has(kind))
        throw new Error(`Feature views: ${key}: the vehicle kind "${kind}" is already drawn.`);
      out.vehicles.set(kind, adapter);
      if (adapter.minimap) out.minimapMarks.set(kind, adapter.minimap);
    }
    out.transient.push(...(view.transientPeople ?? []));
  }
  out.parkedOwn = out.parked.filter((entry) => entry.flag);
  const flags = out.parkedOwn.map((entry) => entry.flag);
  if (new Set(flags).size !== flags.length) throw new Error("Feature views: two features share a parked flag.");
  return out;
}

export async function loadViews(registered = FEATURE_VIEWS) {
  return compileViews(await Promise.all(registered.map(async ({ key, load }) => ({ key, view: (await load()).view }))));
}

// (the registry is complete before any view loads, and the views before anything is mounted)
const VIEWS = await loadViews();

export function mountFeatureScenery(view, map) {
  for (const { build } of VIEWS.scenery) view.addScenery(build(map));
}

export function mountFeatureViews(view, world) {
  const handles = {},
    live = [];
  for (const mount of VIEWS.mount) {
    const mounted = mount.run({ view, scene: view.scene, world, map: world.map }) ?? null;
    handles[mount.key] = mounted;
    if (mounted) live.push({ mount, mounted });
  }
  return {
    ...handles,
    updateSignals() {
      for (const { mount, mounted } of live) mount.signals?.(mounted);
    },
    update(fleet, people, dt, lightsOn) {
      const frame = { view, world, fleet, people, camera: view.camera, dt, lightsOn };
      for (const { mount, mounted } of live) mount.frame?.(mounted, frame);
    },
  };
}

const ON_ROAD = Object.freeze({ onRails: false }),
  ON_RAILS = Object.freeze({ onRails: true });
function updateRoadEffects(world, mesh, pose, dt, adapter = carView) {
  mesh.rotation.z = 0;
  const context = adapter.onRails === true ? ON_RAILS : ON_ROAD;
  for (const effect of VIEWS.roadEffect) effect.run(world, mesh, pose, dt, context);
}

const hasIndividualMesh = (car) => VIEWS.parkedOwn.some(({ flag }) => car[flag]);
const parkedKeys = ["x", "y", "psi", "color", "style", "kind", ...VIEWS.parkedOwn.map(({ flag }) => flag)];
const parkedLook = (car) => parkedKeys.map((key) => car[key]);
const sameParkedLook = (look, car) => parkedKeys.every((key, i) => look[i] === car[key]);

function createParkedActor(car, world) {
  for (const { flag, create } of VIEWS.parkedOwn) {
    const mesh = car[flag] ? create(car, world) : null;
    if (mesh) return mesh;
  }
  const mesh = carView.create(car);
  mesh.position.set(car.x, 0, -car.y);
  mesh.rotation.y = car.psi;
  mesh.userData.tail.emissiveIntensity = 0;
  return mesh;
}

const lookKeys = ["kind", "color", "style", "ref", "headsign"];
const vehicleLook = (vehicle) => lookKeys.map((key) => vehicle[key]);
const sameVehicleLook = (look, vehicle) => lookKeys.every((key, i) => look[i] === vehicle[key]);

function indexReplay(list) {
  return list && new Map(list.map((actor) => [actor.id, actor]));
}

export function replayActorPose(actor, next, alpha) {
  if (!next || next.kind !== actor.kind) return actor;
  const pose = interpolatePose(next, actor, alpha);
  // If the interpolation rejected a jump, keep the current checkpoint visible until it advances.
  if (pose === next) return actor;
  // Geometry moves smoothly. Lights, doors and other state changes belong to the current checkpoint.
  return { ...actor, x: pose.x, y: pose.y, psi: pose.psi };
}

function actorPose(actor, previous, alpha, next, replayAlpha) {
  if (next) return replayActorPose(actor, next.get(actor.id), replayAlpha);
  return interpolatePose(actor, previous.get(actor.id), alpha);
}

export function mountActorViews(view, world, fleet) {
  // (a parked car a feature draws itself gets a mesh each, below)
  const batched = world.parked.list.filter((car) => !hasIndividualMesh(car));
  const batch = buildParkedCars(batched);
  view.addScenery(batch);
  const initialInstances = new Map(
    batched.map((car) => [
      car.id,
      { look: parkedLook(car), handles: batch.userData.instances.get(car), visible: true },
    ]),
  );
  // (a mesh per person, by id: some come and go)
  const pedMeshes = new Map();
  const pedMesh = (p) => {
    if (!pedMeshes.has(p.id)) {
      const m = createPersonMesh(p.look, { child: !!p.child, worker: !!p.worker });
      for (const carried of VIEWS.person) carried.mount(m, p);
      view.scene.add(m);
      pedMeshes.set(p.id, m);
    }
    return pedMeshes.get(p.id);
  };
  world.crowd.list.forEach(pedMesh);
  const npcMeshes = new Map();
  const parkedMeshes = new Map();
  const parkedMesh = (car) => parkedMeshes.get(car.id)?.mesh;
  let lastVehicleTime = world.t;
  const doorMeshes = new Map();
  const previousCars = new Map(),
    previousPeople = new Map();
  function reconcileParked() {
    // Replays restore fresh actor objects. Match the batched cars by ID and their original pose and look.
    const current = new Map(world.parked.list.map((car) => [car.id, car]));
    for (const [id, instance] of initialInstances) {
      const car = current.get(id);
      const visible = !!car && sameParkedLook(instance.look, car);
      if (visible !== instance.visible) {
        (visible ? restoreParkedCar : hideParkedCar)(instance.handles);
        instance.visible = visible;
      }
      if (visible) current.delete(id);
    }
    for (const [id, { mesh, look }] of parkedMeshes) {
      const car = current.get(id);
      if (car && sameParkedLook(look, car)) {
        current.delete(id);
      } else {
        retireActor(mesh);
        parkedMeshes.delete(id);
      }
    }
    for (const car of current.values()) {
      const mesh = createParkedActor(car, world);
      view.scene.add(mesh);
      parkedMeshes.set(car.id, { mesh, look: parkedLook(car) });
    }
  }

  // traffic changes as parked cars pull out and far-off cars leave: keep a mesh per vehicle
  const syncFleetMeshes = () => {
    const ids = new Set();
    // (the road users features keep outside the fleet too)
    for (const group of trafficGroups()) {
      for (const n of group) {
        ids.add(n.id);
        const previous = npcMeshes.get(n.id);
        if (previous && sameVehicleLook(previous.look, n)) continue;
        const adapter = VIEWS.vehicles.get(n.kind) ?? carView;
        if (previous) {
          retireActor(previous.mesh);
          previousCars.delete(n.id);
        }
        const mesh = adapter.create(n);
        view.scene.add(mesh);
        npcMeshes.set(n.id, { adapter, mesh, look: vehicleLook(n) });
      }
    }
    for (const [id, { mesh }] of npcMeshes)
      if (!ids.has(id)) {
        retireActor(mesh);
        npcMeshes.delete(id);
        previousCars.delete(id);
      }
    reconcileParked();
    const doors = new Set();
    for (const door of world.parked.activeDoors) {
      doors.add(door.id);
      if (!doorMeshes.has(door.id)) {
        const m = createDoorMesh(door.owner, door);
        view.scene.add(m);
        doorMeshes.set(door.id, m);
      }
      syncDoor(doorMeshes.get(door.id), door);
    }
    for (const [id, m] of doorMeshes)
      if (!doors.has(id)) {
        retireActor(m);
        doorMeshes.delete(id);
      }
  };
  const trafficGroups = () => [fleet.vehicles, ...VIEWS.traffic.map(({ list }) => list(world) ?? [])];
  syncFleetMeshes();

  return {
    people: pedMeshes,
    sync: syncFleetMeshes,
    minimapMarks: VIEWS.minimapMarks,
    // The vehicles the minimap shows: the fleet, and the road users features keep outside it.
    minimapVehicles() {
      let all = null;
      for (const { list, minimap } of VIEWS.traffic) {
        const extra = minimap ? list(world) : null;
        if (extra?.length) (all ??= [...fleet.vehicles]).push(...extra);
      }
      return all ?? fleet.vehicles;
    },
    capture() {
      for (const group of trafficGroups())
        for (const actor of group) previousCars.set(actor.id, capturePose(actor, previousCars.get(actor.id)));
      for (const p of world.crowd.list) previousPeople.set(p.id, capturePose(p, previousPeople.get(p.id)));
    },
    restore(egoMesh, seek = true) {
      if (seek || world.t < lastVehicleTime || world.t - lastVehicleTime > 1) {
        if (egoMesh) resetActorMotion(egoMesh);
        for (const { mesh } of npcMeshes.values()) resetActorMotion(mesh);
        for (const { mesh } of parkedMeshes.values()) resetActorMotion(mesh);
      }
      previousCars.clear();
      previousPeople.clear();
      reconcileParked();
      for (const mesh of doorMeshes.values()) retireActor(mesh);
      doorMeshes.clear();
    },
    updateEgo(egoMesh, renderEgo, dt, lightsOn, t = world.t) {
      for (const { pose } of VIEWS.ego) renderEgo = pose(world, renderEgo);
      syncCar(egoMesh, renderEgo, dt, t, lightsOn);
      updateRoadEffects(world, egoMesh, renderEgo, dt);
      return renderEgo;
    },
    updateVehicles(dt, lightsOn, alpha, replayNext, replayAlpha, visitRoadVehicle) {
      lastVehicleTime = world.t;
      const t = actorTime(world.t, replayNext?.world.t, replayAlpha);
      const fleetNext = indexReplay(replayNext?.fleet.vehicles);
      for (const n of fleet.vehicles) {
        let pose = actorPose(n, previousCars, alpha, fleetNext, replayAlpha);
        const { mesh, adapter } = npcMeshes.get(n.id);
        const car = adapter === carView;
        if (car) for (const drawn of VIEWS.car) if (drawn.pose) pose = drawn.pose(world, n, pose);
        adapter.sync(mesh, pose, dt, t, lightsOn);
        if (adapter.roadEffects !== false) updateRoadEffects(world, mesh, pose, dt, adapter);
        if (car) for (const drawn of VIEWS.car) drawn.effect?.(world, mesh, n);
        if (visitRoadVehicle && adapter.roadEffects !== false && !adapter.onRails) visitRoadVehicle(pose);
      }
      for (const { list, after } of VIEWS.traffic) {
        const next = indexReplay(replayNext && list(replayNext.world));
        for (const n of list(world) ?? []) {
          const pose = actorPose(n, previousCars, alpha, next, replayAlpha);
          const entry = npcMeshes.get(n.id);
          if (!entry) continue;
          entry.adapter.sync(entry.mesh, pose, dt, t, lightsOn);
          after?.(entry.mesh, n);
          if (visitRoadVehicle && entry.adapter.roadEffects !== false && !entry.adapter.onRails) visitRoadVehicle(pose);
        }
      }
      const frame = { dt, t, lightsOn, camera: view.camera };
      for (const { sync } of VIEWS.parked) sync?.(world, parkedMesh, frame);
    },
    updatePeople(alpha, replayNext, replayAlpha, weather = world.weather) {
      const here = new Set();
      const next = indexReplay(replayNext?.world.crowd.list);
      for (const p of world.crowd.list) {
        here.add(p.id);
        const mesh = pedMesh(p);
        syncPerson(mesh, actorPose(p, previousPeople, alpha, next, replayAlpha), view.camera, weather === "rain");
        for (const carried of VIEWS.person) carried.sync(mesh, p);
      }
      for (const [id, m] of pedMeshes)
        if (!here.has(id)) {
          m.visible = false;
          if (VIEWS.transient.some((prefix) => id.startsWith(prefix))) {
            retireActor(m);
            pedMeshes.delete(id);
            previousPeople.delete(id);
          }
        }
    },
  };
}
