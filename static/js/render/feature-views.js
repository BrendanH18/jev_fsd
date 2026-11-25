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
      geese?.sync(world, world.t);
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

export function mountActorViews(view, world, fleet) {
  const { map } = world;
  // (those stopped at the roadside with their lights flashing get a mesh each, below, and so does a
  // work zone's closed stretch)
  view.addScenery(buildParkedCars(world.parked.list.filter((car) => !hasIndividualMesh(car))));
  const originalParked = world.parked.list.slice();
  world.parked.added = world.parked.added.filter(hasIndividualMesh);
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
  const doorMeshes = new Map();
  const previousCars = new Map(),
    previousPeople = new Map();
  // traffic changes as parked cars pull out and far-off cars leave: keep a mesh per vehicle
  const syncFleetMeshes = () => {
    const ids = new Set();
    // (contraflow cyclists too: sim/contraflow.js)
    // (and cars backing out of driveways: sim/driveway-reversers.js)
    for (const n of [...fleet.vehicles, ...world.contraflow.riders, ...world.driveways.cars]) {
      ids.add(n.id);
      if (npcMeshes.has(n.id)) continue;
      const adapter = vehicleViews.get(n.kind) ?? carView;
      const mesh = adapter.create(n);
      view.scene.add(mesh);
      npcMeshes.set(n.id, { adapter, mesh });
    }
    for (const [id, { mesh }] of npcMeshes)
      if (!ids.has(id)) {
        view.scene.remove(mesh);
        npcMeshes.delete(id);
        previousCars.delete(id);
      }
    for (const car of world.parked.added.splice(0)) {
      const mesh = createParkedActor(car, world);
      view.scene.add(mesh);
      parkedMeshes.set(car.id, mesh);
    }
    for (const car of world.parked.removed.splice(0)) {
      hideParkedCar(car);
      if (parkedMeshes.has(car.id)) {
        view.scene.remove(parkedMeshes.get(car.id));
        parkedMeshes.delete(car.id);
      }
    }
    const doors = new Set();
    for (const door of world.parked.activeDoors) {
      doors.add(door.id);
      if (!doorMeshes.has(door.id)) {
        const m = createDoorMesh(door.owner);
        view.scene.add(m);
        doorMeshes.set(door.id, m);
      }
      syncDoor(doorMeshes.get(door.id), door);
    }
    for (const [id, m] of doorMeshes)
      if (!doors.has(id)) {
        view.scene.remove(m);
        m.traverse((o) => o.geometry?.dispose());
        doorMeshes.delete(id);
      }
  };
  syncFleetMeshes();

  return {
    people: pedMeshes,
    sync: syncFleetMeshes,
    capture() {
      for (const car of fleet.vehicles) previousCars.set(car.id, capturePose(car, previousCars.get(car.id)));
      for (const bike of world.contraflow.riders)
        previousCars.set(bike.id, capturePose(bike, previousCars.get(bike.id)));
      for (const car of world.driveways.cars) previousCars.set(car.id, capturePose(car, previousCars.get(car.id)));
      for (const p of world.crowd.list) previousPeople.set(p.id, capturePose(p, previousPeople.get(p.id)));
    },
    restore() {
      previousCars.clear();
      previousPeople.clear();
      for (const car of originalParked) hideParkedCar(car);
      for (const car of world.parked.list) restoreParkedCar(car);
      world.parked.added = world.parked.list.filter((c) => !c.instances && !parkedMeshes.has(c.id));
      for (const [id, mesh] of parkedMeshes) mesh.visible = world.parked.list.some((c) => c.id === id);
      for (const mesh of doorMeshes.values()) {
        view.scene.remove(mesh);
        mesh.traverse((o) => o.geometry?.dispose());
      }
      doorMeshes.clear();
    },
    updateEgo(egoMesh, renderEgo, dt, lightsOn) {
      if (world.highBeams) renderEgo.highBeam = !!world.ego.highBeam;
      syncCar(egoMesh, renderEgo, dt, world.t, lightsOn);
      // (riding over speed humps and the like: render/traffic-calming.js)
      if (world.calming) rideOver(map, egoMesh, renderEgo);
      // (and jolting over potholes: render/potholes.js)
      if (world.potholes.enabled) potholeJolt(world, egoMesh, renderEgo, dt, world.calming);
    },
    updateVehicles(dt, lightsOn, alpha, replayNext, replayAlpha) {
      for (const n of fleet.vehicles) {
        const next = replayNext?.fleet.vehicles.find((v) => v.id === n.id),
          pose = {
            ...(next ? interpolatePose(next, n, replayAlpha) : interpolatePose(n, previousCars.get(n.id), alpha)),
          };
        if (world.highBeams) pose.highBeam = npcHighBeam(world, n);
        const { mesh, adapter } = npcMeshes.get(n.id);
        adapter.sync(mesh, pose, dt, world.t, lightsOn);
        if (world.calming && n.kind !== "bike" && n.kind !== "train") rideOver(map, mesh, pose);
        if (world.potholes.enabled && n.kind !== "bike" && n.kind !== "train" && n.kind !== "streetcar")
          potholeJolt(world, mesh, pose, dt, world.calming);
        if (n.tailgate && world.tailgaters?.enabled) syncTailgaterFlash(mesh, tailgaterFlash(world, n));
        if (world.parkers?.enabled) syncReverseLamps(mesh, n);
      }
      for (const n of world.contraflow.riders) {
        const next = replayNext?.world.contraflow?.riders.find((v) => v.id === n.id);
        const pose = next ? interpolatePose(next, n, replayAlpha) : interpolatePose(n, previousCars.get(n.id), alpha);
        const entry = npcMeshes.get(n.id);
        if (entry) syncBike(entry.mesh, pose, dt, world.t, lightsOn);
      }
      for (const n of world.driveways.cars) {
        const next = replayNext?.world.driveways?.cars.find((v) => v.id === n.id);
        const pose = next ? interpolatePose(next, n, replayAlpha) : interpolatePose(n, previousCars.get(n.id), alpha);
        const entry = npcMeshes.get(n.id);
        if (entry) {
          syncCar(entry.mesh, pose, dt, world.t, lightsOn);
          syncReverseLamps(entry.mesh, n);
        }
      }
      for (const v of world.roadside.vehicles) syncRoadside(parkedMeshes.get(v.id), v, dt, world.t, lightsOn);
      // (a police officer's cruiser parked in a bay at the corner, its lights on: sim/traffic-officer.js)
      for (const o of world.officers?.list || [])
        if (o.cruiser?.parked) syncRoadside(parkedMeshes.get(o.cruiser.id), o.cruiser.vehicle, dt, world.t, lightsOn);
      for (const z of world.workZones.zones) syncWorkZone(parkedMeshes.get(z.closure.id), z, world.t, view.camera);
      for (const z of world.laneClosures.zones)
        syncLaneClosure(parkedMeshes.get(z.closure.id), z, world.t, view.camera);
      // (a garbage truck at a stop is in traffic, and drawn there: sim/collection-truck.js)
      for (const d of world.doubleParked.vans) if (!d.truck) syncVan(parkedMeshes.get(d.van.id), d.van, dt, world.t);
    },
    updatePeople(alpha, replayNext, replayAlpha) {
      const here = new Set();
      for (const p of world.crowd.list) {
        here.add(p.id);
        const next = replayNext?.world.crowd.list.find((v) => v.id === p.id);
        syncPerson(
          pedMesh(p),
          next ? interpolatePose(next, p, replayAlpha) : interpolatePose(p, previousPeople.get(p.id), alpha),
          view.camera,
          world.weather === "rain",
        );
        if (p.crossingGuard) syncGuardSign(pedMesh(p), p);
      }
      for (const [id, m] of pedMeshes)
        if (!here.has(id)) {
          m.visible = false;
          if (id.startsWith("kid_") || id.startsWith("rider_") || id.startsWith("stepout_") || id.startsWith("crew_")) {
            view.scene.remove(m);
            m.traverse((o) => o.geometry?.dispose());
            pedMeshes.delete(id);
            previousPeople.delete(id);
          }
        }
    },
  };
}
