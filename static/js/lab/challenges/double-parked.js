// Round the van: a delivery van double-parked (sim/double-parked.js) in the car's lane on a block of
// the challenge's `street` (where it has one), beside VAN_PARKED cars parked at the curb, with the car
// starting from a standstill, its front VAN_START_M short of the van. Once its front is VAN_TRIGGER_M
// from the van, VAN_CARS cars, VAN_CAR_GAP_M apart, come down the oncoming lane at the street's limit,
// the first from VAN_ONCOMING_M past the van's front: out of the car's sight at first, and in the way
// round just as it gets to the van. Going round straight away, it would meet them there; past them the
// way is clear. The route ends VAN_PAST_M past the van, on its street.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, CAR, DELIVERY_VAN } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { curbOffset } from "../../sim/roadside.js";
import { vanSites } from "../../sim/double-parked.js";
import { rng } from "../../common.js";
import { frontWithin, laneScenario, pick, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "double-parked",
  title: "Round the van",
  map: "toronto",
  weather: "dry",
  time: "afternoon",
  seed: 24042,
  icon: "◫",
  difficulty: "Patience",
  hazard: "double-parked",
  street: "Brunswick Avenue",
  description:
    "A delivery van with its hazards on blocks your lane on Brunswick Avenue. The van limits your view of oncoming traffic.",
  lesson:
    "Stop about a car length back where you have room to pull out and see farther past the van. Wait for an opposing-lane gap long enough to get around the van and fully back into your lane.",
};

const VAN_START_M = 62,
  VAN_TRIGGER_M = 40,
  VAN_CARS = 2,
  VAN_CAR_GAP_M = 14,
  VAN_ONCOMING_M = 70,
  VAN_PAST_M = 45,
  VAN_PARKED = 4;
const vanSiteCache = new WeakMap();
function doubleParkSites(map, street) {
  if (!vanSiteCache.has(map)) {
    const sites = [],
      front = CAR.length - CAR.rearOverhang;
    for (const site of vanSites(map)) {
      const e = map.edges.get(site.edge),
        lane = map.lane(site.edge, 0);
      const rear = Math.min(site.hi, Math.max(site.lo, VAN_START_M + front + 4)),
        van = rear + DELIVERY_VAN.length;
      const startS = ((rear - VAN_START_M - front) * lane.length) / e.length;
      if (
        startS < 2 ||
        !e.parking?.[1] ||
        e.length - van < VAN_ONCOMING_M + (VAN_CARS - 1) * VAN_CAR_GAP_M + 6 ||
        van + VAN_PAST_M > (e.control?.s_line ?? e.length) - 3
      )
        continue;
      sites.push({
        lane,
        startS,
        goalS: ((van + VAN_PAST_M) * lane.length) / e.length,
        van: { edge: site.edge, rear },
      });
    }
    vanSiteCache.set(map, sites);
  }
  const sites = vanSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// (past the van, along its street only)
export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const van = pick(
      doubleParkSites(map, challenge.street),
      random,
      "This map has no straight block of a two-way street with one lane each way and a parking lane, with room for a van to double-park.",
    );
    return { lane: van.lane, startS: van.startS, extend: 0, goalS: van.goalS, fields: { doubleParked: van.van } };
  });

// The double-parked van (see doubleParkSites), held there, the cars parked at the curb beside it, and
// the cars that will come down the oncoming lane, waiting out of sight until the car comes up.
function placeVan(world, fleet, { edge, rear }, seed) {
  const map = world.map,
    random = rng(seed),
    d = world.doubleParked.place({ edge, rear, color: 0xf2f2ee }),
    ids = [];
  d.held = true;
  const e = map.edges.get(edge),
    lat = curbOffset(e, CAR);
  for (let i = 0; i < VAN_PARKED; i++) {
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
  const o = map.edges.get(d.opposite),
    lane = map.lane(o.id, 0);
  for (let i = 0; i < VAN_CARS; i++) {
    // (rear axles, in the oncoming edge's own `s`: the first one's front VAN_ONCOMING_M past the van's front)
    const s =
      ((o.length - (d.front + VAN_ONCOMING_M + i * VAN_CAR_GAP_M) + (CAR.length - CAR.rearOverhang)) * lane.length) /
      o.length;
    const p = pointAt(lane.pts, lane.cum, s),
      car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
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
  return { vanId: d.van.id, vanCarIds: ids, at: pointAt(e.pts, e.cum, rear) };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeVan(world, fleet, scenario.doubleParked, challenge.seed));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: frontWithin(VAN_TRIGGER_M),
    // (the cars coming the other way past the double-parked van set off down the oncoming lane)
    release: (_world, fleet, state) => {
      for (const id of state.vanCarIds || []) {
        const car = fleet.vehicles.find((v) => v.id === id);
        if (car) {
          car.frozen = 0;
          car.v = car.v0;
        }
      }
    },
  });
