// Give them room: passing a cyclist (sim/cyclist-pass.js) on a straight block of a two-way bike route
// with one lane each way and a parking lane on the right, at least CP_BLOCK_M long, with no marked
// crosswalk or level crossing, that carries straight on along the same street (on the challenge's
// `street`, where it has one). Both kerbs are lined with cars CP_PARKED_GAP_M apart wherever one may
// park, so the cyclist rides out in the lane. The car starts from a standstill, its front CP_START_M
// along the block; the cyclist rides CP_AHEAD_M ahead of it at CP_BIKE_MPS; and CP_CARS cars,
// CP_CAR_GAP_M apart, come down the oncoming lane at the street's limit, the first CP_ONCOMING_M ahead
// of the car: in sight from the start, and in the way of a pass straight away. Once they are by, the
// way is clear. The route ends CP_PAST_M along the next block.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, BIKE, CAR } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { curbOffset } from "../../sim/roadside.js";
import { legalStretches, straight as straightKerb } from "../../sim/parallel-park.js";
import { passStreet } from "../../sim/cyclist-pass.js";
import { rng } from "../../common.js";
import { laneScenario, pick } from "./shared/kit.js";

export const challenge = {
  id: "cyclist-pass",
  title: "Give them room",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 30042,
  icon: "⇉",
  difficulty: "Patience",
  hazard: "cyclist-pass",
  passCyclists: true,
  street: "West 10th Avenue",
  description:
    "Parked cars put a cyclist into your lane on the West 10th Avenue bikeway. Two oncoming cars occupy the lane you'd need to pass.",
  lesson:
    "Stay back until you can see a gap long enough to pass and return well ahead of the rider. Leave at least 1 m at limits up to 50 km/h in BC and 1.5 m at higher limits.",
};

const CP_START_M = 20,
  CP_AHEAD_M = 14,
  CP_BIKE_MPS = 4.2,
  CP_CARS = 2,
  CP_CAR_GAP_M = 12,
  CP_ONCOMING_M = 50,
  CP_PAST_M = 80,
  CP_PARKED_GAP_M = 1.6,
  CP_BLOCK_M = 160;
const cyclistSiteCache = new WeakMap();
function cyclistPassSites(map, street) {
  if (!cyclistSiteCache.has(map)) {
    const sites = [],
      front = CAR.length - CAR.rearOverhang;
    for (const e of map.edges.values()) {
      const ps = passStreet(map, e.id);
      if (
        !ps ||
        !e.bike ||
        !e.parking?.[1] ||
        e.length < CP_BLOCK_M ||
        ps.crosswalks.length ||
        ps.rails.length ||
        !straightKerb(e, 0, e.length)
      )
        continue;
      const next = map
        .successors(e.id)
        .find(
          (id) =>
            id !== ps.opposite &&
            map.edges.get(id).name === e.name &&
            Math.abs(map.turnAngle(e.id, id)) < 0.2 &&
            passStreet(map, id) &&
            map.edges.get(id).length > CP_PAST_M + 10,
        );
      if (!next) continue;
      const lane = map.lane(e.id, 0),
        ahead = map.lane(next, 0);
      sites.push({
        lane,
        ahead,
        startS: ((CP_START_M - front) * lane.length) / e.length,
        goalS: (CP_PAST_M * ahead.length) / map.edges.get(next).length,
        cyclist: { edge: e.id, next, rear: CP_START_M + CP_AHEAD_M },
      });
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    cyclistSiteCache.set(map, sites);
  }
  const sites = cyclistSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const cyc = pick(
      cyclistPassSites(map, challenge.street),
      random,
      "This map has no long straight block of a two-way bike route with one lane each way and a parking lane, that carries straight on.",
    );
    return {
      lane: cyc.lane,
      startS: cyc.startS,
      through: [cyc.ahead],
      extend: 0,
      goalS: cyc.goalS,
      fields: { cyclistPass: cyc.cyclist },
    };
  });

// Both kerbs of the block lined with parked cars (see cyclistPassSites), staying put; the cyclist out in
// the lane, riding straight on; and the cars coming the other way, already moving.
function placeCyclistPass(world, fleet, { edge, next, rear }, seed) {
  const map = world.map,
    random = rng(seed),
    e = map.edges.get(edge),
    o = map.edges.get(passStreet(map, edge).opposite);
  const colors = [0x8d9299, 0x2b3a55, 0xeeeeea, 0x1a1c20, 0x6b7f5e, 0x9b1e1e, 0xc4c8cc];
  let n = 0;
  for (const side of [e, o]) {
    const lat = curbOffset(side, CAR);
    for (const [lo, hi] of legalStretches(map, side)) {
      for (let r = lo + 0.5; r + CAR.length <= hi - 0.5; r += CAR.length + CP_PARKED_GAP_M) {
        const s = r + CAR.rearOverhang,
          p = pointAt(side.pts, side.cum, s),
          h = headingAt(side.pts, side.cum, s),
          k = n++;
        const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
        Object.assign(car, {
          id: `challenge_parked_${k + 1}`,
          color: colors[Math.floor(random() * colors.length)],
          style: k % 6,
          curb: "right",
          edge: side.id,
          stay: true,
        });
        world.parked.add(car);
      }
    }
  }
  const lane = map.lane(edge, 0),
    side = e.lane_width / 2 - 0.75,
    s = ((rear + BIKE.rearOverhang) * lane.length) / e.length;
  const p = pointAt(lane.pts, lane.cum, s),
    psi = headingAt(lane.pts, lane.cum, s);
  const bike = new Vehicle(p[0] + Math.sin(psi) * side, p[1] - Math.cos(psi) * side, psi, CP_BIKE_MPS, BIKE);
  Object.assign(bike, {
    id: "challenge_cyclist",
    kind: "bike",
    color: 0x2f855a,
    v0: CP_BIKE_MPS,
    side,
    strip: false,
    driver: { aMax: 0.9, b: 2, s0: 2, T: 1.5, react: 0.6, lcRate: 0 },
    stopMem: new StopMemory(),
    path: new NpcPath(map, fleet.random, { bike: true }),
    frozen: 0,
    waiting: 0,
  });
  bike.path.start(edge, 0, s, [[next, 0]]);
  fleet.vehicles.push(bike);
  const ol = map.lane(o.id, 0),
    ids = [],
    front = CAR.length - CAR.rearOverhang;
  for (let i = 0; i < CP_CARS; i++) {
    // (rear axles, in the oncoming edge's own `s`: the first one's front CP_ONCOMING_M ahead of the car's)
    const so = ((o.length - (CP_START_M + CP_ONCOMING_M + i * CP_CAR_GAP_M) + front) * ol.length) / o.length;
    const q = pointAt(ol.pts, ol.cum, so),
      car = new Vehicle(q[0], q[1], headingAt(ol.pts, ol.cum, so), o.limit);
    Object.assign(car, {
      id: `challenge_oncoming_${i + 1}`,
      color: [0x9b1e1e, 0xb0b5b9][i % 2],
      v0: o.limit,
      driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.5 + random() * 0.3, lcRate: 0 },
      stopMem: new StopMemory(),
      path: new NpcPath(map, fleet.random),
      frozen: 0,
      waiting: 0,
    });
    car.path.start(o.id, 0, so);
    fleet.vehicles.push(car);
    ids.push(car.id);
  }
  return { cyclistId: bike.id, cyclistCarIds: ids, at: [bike.x, bike.y] };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeCyclistPass(world, fleet, scenario.cyclistPass, challenge.seed));
}
