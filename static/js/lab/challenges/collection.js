// Collection day: a garbage truck (sim/collection-truck.js) stopped at a collection stop in the car's
// lane, on a block of the challenge's `street` (where it has one) with a parking lane, its rear at
// least TR_START_M plus the car's front along it; the car starts from a standstill TR_START_M short of
// the truck's rear. Its crew stands ready at its rear until the car's front is TR_TRIGGER_M from the
// truck: then one goes to the bins at the right kerb, and one across the street behind it to the far
// kerb and back, as TR_CARS cars, TR_CAR_GAP_M apart, come down the oncoming lane at the street's
// limit, the first from TR_ONCOMING_M past the truck's front. The truck stays until the car is past
// it. The route ends TR_PAST_M past the truck, on its street.
import { pointAt, headingAt, projectPoint } from "../../map/mapdata.js";
import { Vehicle, CAR, COLLECTION_TRUCK } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { curbOffset } from "../../sim/roadside.js";
import { truckSites } from "../../sim/collection-truck.js";
import { rng } from "../../common.js";
import { frontWithin, laneScenario, pick, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "collection",
  title: "Collection day",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 33042,
  icon: "♻",
  difficulty: "Patience",
  hazard: "collection",
  description:
    "It's collection day. A garbage truck is stopped in your lane ahead, beside the parked cars, its crew emptying the bins at the kerb, and there's one lane each way. As you come up behind it, one of the crew heads across the street behind the truck to the bins on the far side.",
  lesson:
    "Stop well back from a garbage truck at work: its crew works at its rear, walking between it and the kerbs and across the street behind it, and they are often out of sight behind the truck. Go round only when the crew is back at the kerb or on the truck and the oncoming lane is clear for the whole way round, and go round slowly, with room to spare. On the move, stay behind it: it is about to stop again.",
};

const TR_START_M = 60,
  TR_TRIGGER_M = 38,
  TR_CARS = 2,
  TR_CAR_GAP_M = 16,
  TR_ONCOMING_M = 75,
  TR_PAST_M = 45,
  TR_PARKED = 4;
const truckSiteCache = new WeakMap();
function collectionSites(map, street) {
  if (!truckSiteCache.has(map)) {
    const sites = [],
      front = CAR.length - CAR.rearOverhang;
    for (const site of truckSites(map).sites) {
      const e = map.edges.get(site.edge),
        lane = map.lane(site.edge, 0);
      const rear = Math.min(site.hi, Math.max(site.lo, TR_START_M + front + 4)),
        end = rear + COLLECTION_TRUCK.length;
      const startS = ((rear - TR_START_M - front) * lane.length) / e.length;
      if (
        startS < 2 ||
        !e.parking?.[1] ||
        e.length - end < TR_ONCOMING_M + (TR_CARS - 1) * TR_CAR_GAP_M + 6 ||
        end + TR_PAST_M > (e.control?.s_line ?? e.length) - 3
      )
        continue;
      sites.push({
        lane,
        startS,
        goalS: ((end + TR_PAST_M) * lane.length) / e.length,
        truck: { edge: site.edge, rear },
      });
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    truckSiteCache.set(map, sites);
  }
  const sites = truckSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const truck = pick(
      collectionSites(map, challenge.street),
      random,
      "This map has no straight block of a quiet two-way street with one lane each way and a parking lane, long enough for a garbage truck to stop on.",
    );
    return {
      lane: truck.lane,
      startS: truck.startS,
      extend: 0,
      goalS: truck.goalS,
      fields: { collection: truck.truck },
    };
  });

// The garbage truck at its stop (see collectionSites), held there until the car is past it, with cars
// parked at the kerb beside and behind it, its crew ready at its rear (one to cross), and the oncoming
// cars, released with the crew.
function placeTruck(world, fleet, { edge, rear }, seed) {
  const map = world.map,
    random = rng(seed),
    e = map.edges.get(edge),
    lane = map.lane(edge, 0),
    ids = [];
  const truck = fleet.collection.add(lane, ((rear + COLLECTION_TRUCK.rearOverhang) * lane.length) / e.length, 0, [], {
    color: 0x2f6b3a,
    path: new NpcPath(map, random),
  });
  truck.collect.held = true;
  truck.collect.stop = { edge, rear };
  fleet.collection.arrive(truck, { cross: true });
  for (const p of truck.collect.crew) p.held = true;
  const lat = curbOffset(e, CAR);
  for (let i = 0; i < TR_PARKED; i++) {
    const s = rear - 13 + i * 6.5 + CAR.rearOverhang,
      p = pointAt(e.pts, e.cum, s),
      h = headingAt(e.pts, e.cum, s);
    const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
    Object.assign(car, {
      id: `challenge_parked_${i + 1}`,
      color: [0x2b3a55, 0x8d9299, 0x9b1e1e, 0x1a1c20][i % 4],
      style: [0, 3, 1, 5][i % 4],
      curb: "right",
      edge,
      stay: true,
    });
    world.parked.add(car);
  }
  const d = truck.collect.record,
    o = map.edges.get(d.opposite),
    ol = map.lane(o.id, 0);
  for (let i = 0; i < TR_CARS; i++) {
    const s =
      ((o.length - (d.front + TR_ONCOMING_M + i * TR_CAR_GAP_M) + (CAR.length - CAR.rearOverhang)) * ol.length) /
      o.length;
    const p = pointAt(ol.pts, ol.cum, s),
      car = new Vehicle(p[0], p[1], headingAt(ol.pts, ol.cum, s), 0);
    Object.assign(car, {
      id: `challenge_oncoming_${i + 1}`,
      color: [0x9b1e1e, 0xb0b5b9][i % 2],
      v0: o.limit,
      driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.5 + random() * 0.3, lcRate: 0 },
      stopMem: new StopMemory(),
      path: new NpcPath(map, fleet.random),
      frozen: 1e6,
      waiting: 0,
    });
    car.path.start(o.id, 0, s);
    fleet.vehicles.push(car);
    ids.push(car.id);
  }
  return { truckId: truck.id, vanCarIds: ids, at: pointAt(e.pts, e.cum, rear) };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeTruck(world, fleet, scenario.collection, challenge.seed));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: frontWithin(TR_TRIGGER_M),
    release: (world, fleet, state) => {
      // (the cars coming the other way set off down the oncoming lane)
      for (const id of state.vanCarIds || []) {
        const car = fleet.vehicles.find((v) => v.id === id);
        if (car) {
          car.frozen = 0;
          car.v = car.v0;
        }
      }
      // (the garbage crew goes to the bins, one across the street)
      for (const p of world.crowd.list) if (p.crew && p.truck === state.truckId) p.held = false;
    },
    // (the garbage truck drives on once the car is past it: sim/collection-truck.js)
    follow: (world, fleet, state) => {
      const truck = state.truckId && fleet.vehicles.find((v) => v.id === state.truckId);
      if (truck?.collect.held && truck.collect.record) {
        const d = truck.collect.record,
          e = world.map.edges.get(d.edge),
          q = projectPoint(e.pts, e.cum, [world.ego.x, world.ego.y], null);
        if (q && q.s - world.ego.spec.rearOverhang > d.front + 3) truck.collect.held = false;
      }
    },
  });
