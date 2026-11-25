import { actorTime, resetActorMotion } from "./actor-motion.js";
import { retireActor } from "./actor-resources.js";
// Rendering adapters live here so the simulation registry can also load in Node without Three.js.
import { BallView } from "./ball-chase.js";
import { IceView } from "./black-ice.js";
import { buildContraflow } from "./contraflow.js";
import { GeeseView } from "./geese.js";
import { buildPuddles, PuddleView } from "./puddles.js";
import { buildPxos } from "./pxo.js";
import { RoadClosureView } from "./road-closures.js";
import { buildSnowbanks } from "./snowbanks.js";
import { SunGlareView } from "./sun-glare.js";
import { OfficerView } from "./traffic-officer.js";
import { buildRestrictions } from "./turn-restrictions.js";
import { egoGlare } from "../sim/sun-glare.js";

import { createEmergencyMesh, syncEmergency } from "./emergency.js";
import { buildBusStops, createBusMesh, syncBus } from "./bus.js";
import { createSchoolBusMesh, syncSchoolBus } from "./school-bus.js";
import { buildTracks, createStreetcarMesh, syncStreetcar } from "./streetcar.js";
import { buildRail, createTrainMesh, syncTrain } from "./rail.js";
import { createRoadsideMesh, syncRoadside } from "./roadside.js";
import { createWorkZoneMesh, syncWorkZone } from "./work-zone.js";
import { createLaneClosureMesh, syncLaneClosure } from "./lane-closure.js";
import { createVanMesh, syncVan } from "./delivery-van.js";
import { createPlowMesh, syncPlow } from "./snow-plow.js";
import { createTruckMesh, syncTruck } from "./collection-truck.js";
import { buildBusLanes } from "./bus-lanes.js";
import { syncTailgaterFlash } from "./tailgaters.js";
import { addGuardSign, syncGuardSign } from "./crossing-guard.js";
import { createPersonMesh, syncPerson } from "./people.js";
import { npcHighBeam } from "../sim/high-beams.js";
import { tailgaterFlash } from "../sim/tailgaters.js";
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
import { buildDriveways, syncReverseLamps } from "./driveway-reversers.js";
import { buildPotholes, potholeJolt } from "./potholes.js";
import { buildCalming, rideOver } from "./traffic-calming.js";

export function mountFeatureViews(view, world) {
  const { scene } = view;
  const { map } = world;
  if (world.busLanes) scene.add(buildBusLanes(map));
  if (world.restrictions || world.redTurnSigns) {
    scene.add(
      buildRestrictions(map, [
        ...(world.restrictions ? map.restrictions : []),
        ...(world.redTurnSigns ? map.redTurns : []),
      ]),
    );
  }
  if (world.calming) scene.add(buildCalming(map));
  const glare = world.sunGlare.enabled ? new SunGlareView(scene) : null;
  if (world.contraflow.enabled) scene.add(buildContraflow(map));
  if (world.driveways.enabled) scene.add(buildDriveways(map));
  if (world.potholes.enabled) scene.add(buildPotholes(world));
  const balls = world.balls?.enabled ? new BallView(scene) : null;
  const geese = world.geese.enabled ? new GeeseView(scene) : null;
  const roadClosures = world.roadClosures?.enabled ? new RoadClosureView(scene) : null;
  const ice = world.ice?.enabled ? new IceView(scene) : null;
  const puddleGroup = world.puddles?.enabled ? buildPuddles(world) : null;
  if (puddleGroup) scene.add(puddleGroup);
  const puddles = puddleGroup ? new PuddleView(scene, puddleGroup) : null;
  const officers = world.officers?.enabled ? new OfficerView(scene) : null;
  if (world.snowbanks?.geo.runs.length) scene.add(buildSnowbanks(world));
  const crossing = world.pxo ? buildPxos(world) : null;
  if (crossing) scene.add(crossing.group);
  return {
    balls,
    roadClosures,
    ice,
    puddles,
    updateSignals() {
      crossing?.update();
    },
    update(fleet, people, dt, lightsOn) {
      const { camera } = view;
      geese?.sync(world, world.t, camera);
      roadClosures?.sync(world, world.t);
      ice?.sync(world);
      puddles?.update(world, [world.ego, ...fleet.vehicles], people, camera, dt);
      officers?.sync(world, dt, camera, lightsOn);
      if (glare) glare.update(camera, view.atmosphere, egoGlare(world)?.severity ?? 0);
      balls?.update(world, camera);
    },
  };
}

export function mountTransitScenery(view, map) {
  view.addScenery(buildBusStops(map));
  view.addScenery(buildTracks(map));
  view.addScenery(buildRail(map));
}

const carView = {
  create: (car) => createCarMesh(car.color, car.id, car.style ?? null),
  sync: syncCar,
};

const bikeView = {
  create: (bike) => createBikeMesh(bike.color, bike.id),
  sync: syncBike,
};

const emergencyView = {
  create: (vehicle) => createEmergencyMesh(vehicle.kind, vehicle.id),
  sync: syncEmergency,
};

// Keep each actor's factory and updater together so a new mesh always gets its matching animator.
const vehicleViews = new Map([
  ["bike", bikeView],
  ["ambulance", emergencyView],
  ["fire_truck", emergencyView],
  ["bus", { create: (v) => createBusMesh(v.id, `${v.ref || ""} ${v.headsign || ""}`.trim()), sync: syncBus }],
  ["streetcar", { create: (v) => createStreetcarMesh(v.id, v.headsign || v.ref || ""), sync: syncStreetcar }],
  ["train", { create: (v) => createTrainMesh(v.id), sync: syncTrain }],
  ["school_bus", { create: (v) => createSchoolBusMesh(v.id), sync: syncSchoolBus }],
  ["snow_plow", { create: createPlowMesh, sync: syncPlow }],
  ["collection_truck", { create: createTruckMesh, sync: syncTruck }],
  ["delivery_van", { create: createVanMesh, sync: syncVan }],
]);

function updateRoadEffects(world, mesh, pose, dt) {
  if (world.calming) rideOver(world.map, mesh, pose);
  else mesh.rotation.z = 0;
  if (pose.kind !== "streetcar" && world.potholes.enabled) potholeJolt(world, mesh, pose, dt, world.calming);
  else if (mesh.userData.potholeJolt) delete mesh.userData.potholeJolt;
}

const hasIndividualMesh = (car) => car.roadside || car.workzone || car.closure || car.doubleParked;

function createParkedActor(car, world) {
  const zone = car.workzone ? world.workZones.zones.find((z) => z.closure === car) : null;
  const closure = car.closure ? world.laneClosures.zones.find((z) => z.closure === car) : null;
  const mesh = car.roadside
    ? createRoadsideMesh(car)
    : zone
      ? createWorkZoneMesh(zone, world.map)
      : closure
        ? createLaneClosureMesh(closure, world.map)
        : car.doubleParked
          ? createVanMesh(car)
          : carView.create(car);
  if (zone) syncWorkZone(mesh, zone);
  else if (closure) syncLaneClosure(mesh, closure);
  else (car.roadside ? syncRoadside : car.doubleParked ? syncVan : syncCar)(mesh, car);
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
  // (those stopped at the roadside with their lights flashing get a mesh each, below, and so does a
  // work zone's closed stretch)
  view.addScenery(buildParkedCars(world.parked.list.filter((car) => !hasIndividualMesh(car))));
  const initialInstances = new Map(world.parked.list.filter((car) => car.instances).map((car) => [car.id, car]));
  // (a mesh per person, by id: children get off school buses and go home)
  const pedMeshes = new Map();
  const pedMesh = (p) => {
    if (!pedMeshes.has(p.id)) {
      const m = createPersonMesh(p.look, { child: !!p.child, worker: !!p.worker });
      if (p.crossingGuard) addGuardSign(m);
      view.scene.add(m);
      pedMeshes.set(p.id, m);
    }
    return pedMeshes.get(p.id);
  };
  world.crowd.list.forEach(pedMesh);
  const npcMeshes = new Map();
  const parkedMeshes = new Map();
  const parkedMesh = (car) => parkedMeshes.get(car.id);
  let lastVehicleTime = world.t;
  const doorMeshes = new Map();
  const previousCars = new Map(),
    previousPeople = new Map();
  function syncParked(car) {
    if (initialInstances.has(car.id) && car.instances) {
      restoreParkedCar(car);
      return;
    }
    if (!parkedMeshes.has(car.id)) {
      const mesh = createParkedActor(car, world);
      view.scene.add(mesh);
      parkedMeshes.set(car.id, mesh);
    }
  }

  function removeParked(id) {
    const instance = initialInstances.get(id);
    if (instance) hideParkedCar(instance);
    const mesh = parkedMeshes.get(id);
    if (mesh) {
      retireActor(mesh);
      parkedMeshes.delete(id);
    }
  }

  function reconcileParked() {
    const { parked } = world;
    if (!parked.added.length && !parked.removed.length) return;
    // A car can leave a bay and park again between render frames. Draw its final location once.
    const dirty = new Set([...parked.added, ...parked.removed].map((car) => car.id));
    const current = new Map(parked.list.filter((car) => dirty.has(car.id)).map((car) => [car.id, car]));
    for (const id of dirty) {
      removeParked(id);
      const car = current.get(id);
      if (car) syncParked(car);
    }
    parked.added.length = parked.removed.length = 0;
  }

  // traffic changes as parked cars pull out and far-off cars leave: keep a mesh per vehicle
  const syncFleetMeshes = () => {
    const ids = new Set();
    // (contraflow cyclists too: sim/contraflow.js)
    // (and cars backing out of driveways: sim/driveway-reversers.js)
    for (const group of trafficGroups()) {
      for (const n of group) {
        ids.add(n.id);
        const previous = npcMeshes.get(n.id);
        if (previous && sameVehicleLook(previous.look, n)) continue;
        const adapter = vehicleViews.get(n.kind) ?? carView;
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
  const trafficGroups = () => [fleet.vehicles, world.contraflow.riders, world.driveways.cars];
  for (const car of world.parked.list) syncParked(car);
  world.parked.added.length = 0;
  syncFleetMeshes();

  return {
    people: pedMeshes,
    sync: syncFleetMeshes,
    capture() {
      for (const group of trafficGroups())
        for (const actor of group) previousCars.set(actor.id, capturePose(actor, previousCars.get(actor.id)));
      for (const p of world.crowd.list) previousPeople.set(p.id, capturePose(p, previousPeople.get(p.id)));
    },
    restore(egoMesh, seek = true) {
      if (seek || world.t < lastVehicleTime || world.t - lastVehicleTime > 1) {
        if (egoMesh) resetActorMotion(egoMesh);
        for (const { mesh } of npcMeshes.values()) resetActorMotion(mesh);
        for (const mesh of parkedMeshes.values()) resetActorMotion(mesh);
      }
      previousCars.clear();
      previousPeople.clear();
      const { parked } = world;
      const restored = new Map(parked.list.map((car) => [car.id, car]));
      for (const [id, car] of initialInstances) {
        if (!restored.get(id)?.instances) hideParkedCar(car);
      }
      for (const id of parkedMeshes.keys()) {
        if (!restored.has(id) || restored.get(id).instances) removeParked(id);
      }
      for (const car of restored.values()) syncParked(car);
      // Checkpoints can include notifications that were already drawn in the original timeline.
      parked.added.length = parked.removed.length = 0;
      for (const mesh of doorMeshes.values()) retireActor(mesh);
      doorMeshes.clear();
    },
    updateEgo(egoMesh, renderEgo, dt, lightsOn, t = world.t) {
      if (world.highBeams) renderEgo = { ...renderEgo, highBeam: !!world.ego.highBeam };
      syncCar(egoMesh, renderEgo, dt, t, lightsOn);
      updateRoadEffects(world, egoMesh, renderEgo, dt);
    },
    updateVehicles(dt, lightsOn, alpha, replayNext, replayAlpha) {
      lastVehicleTime = world.t;
      const t = actorTime(world.t, replayNext?.world.t, replayAlpha);
      const fleets = [
        replayNext?.fleet.vehicles,
        replayNext?.world.contraflow?.riders,
        replayNext?.world.driveways?.cars,
      ];
      const [fleetNext, contraNext, drivewayNext] = fleets.map(indexReplay);
      for (const n of fleet.vehicles) {
        let pose = actorPose(n, previousCars, alpha, fleetNext, replayAlpha);
        const { mesh, adapter } = npcMeshes.get(n.id);
        if (world.highBeams && adapter === carView) pose = { ...pose, highBeam: npcHighBeam(world, n) };
        adapter.sync(mesh, pose, dt, t, lightsOn);
        if (n.kind !== "bike" && n.kind !== "train") updateRoadEffects(world, mesh, pose, dt);
        if (adapter === carView && n.tailgate && world.tailgaters?.enabled)
          syncTailgaterFlash(mesh, tailgaterFlash(world, n));
        if (adapter === carView) syncReverseLamps(mesh, n, world.parkers?.enabled === true);
      }
      for (const n of world.contraflow.riders) {
        const pose = actorPose(n, previousCars, alpha, contraNext, replayAlpha);
        const entry = npcMeshes.get(n.id);
        if (entry) syncBike(entry.mesh, pose, dt, t, lightsOn);
      }
      for (const n of world.driveways.cars) {
        const pose = actorPose(n, previousCars, alpha, drivewayNext, replayAlpha);
        const entry = npcMeshes.get(n.id);
        if (entry) {
          syncCar(entry.mesh, pose, dt, t, lightsOn);
          syncReverseLamps(entry.mesh, n);
        }
      }
      for (const v of world.roadside.vehicles) syncRoadside(parkedMesh(v), v, dt, t, lightsOn);
      // (a police officer's cruiser parked in a bay at the corner, its lights on: sim/traffic-officer.js)
      for (const o of world.officers?.list || [])
        if (o.cruiser?.parked) syncRoadside(parkedMesh(o.cruiser), o.cruiser.vehicle, dt, t, lightsOn);
      for (const z of world.workZones.zones) syncWorkZone(parkedMesh(z.closure), z, t, view.camera, dt);
      for (const z of world.laneClosures.zones) syncLaneClosure(parkedMesh(z.closure), z, t, view.camera);
      // (a garbage truck at a stop is in traffic, and drawn there: sim/collection-truck.js)
      for (const d of world.doubleParked.vans) if (!d.truck) syncVan(parkedMesh(d.van), d.van, dt, t, lightsOn);
    },
    updatePeople(alpha, replayNext, replayAlpha, weather = world.weather) {
      const here = new Set();
      const next = indexReplay(replayNext?.world.crowd.list);
      for (const p of world.crowd.list) {
        here.add(p.id);
        const mesh = pedMesh(p);
        syncPerson(mesh, actorPose(p, previousPeople, alpha, next, replayAlpha), view.camera, weather === "rain");
        if (p.crossingGuard && mesh.visible) syncGuardSign(mesh, p);
      }
      for (const [id, m] of pedMeshes)
        if (!here.has(id)) {
          m.visible = false;
          if (id.startsWith("kid_") || id.startsWith("rider_") || id.startsWith("stepout_") || id.startsWith("crew_")) {
            retireActor(m);
            pedMeshes.delete(id);
            previousPeople.delete(id);
          }
        }
    },
  };
}
