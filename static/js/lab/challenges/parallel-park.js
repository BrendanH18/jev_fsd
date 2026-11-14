// Squeeze in: parallel parking (sim/parallel-park.js) in the one space left, SPACE_M long bumper to
// bumper, on a straight block whose right kerb is lined with cars PARK_CAR_GAP_M apart wherever one may
// park, at least PARK_CARS of them either side of the space. The car starts from a standstill in its lane, its front PARK_START_M short of the
// space; the route ends PARK_PAST_M past the space, on its street, so the space is near the destination.
// (On the challenge's `street`, where it has a block long enough.)
// A car waits PARK_FOLLOW_M behind the car, out of the way; once the car's front is PARK_TRIGGER_M from
// the space, it sets off at the street's limit and comes up behind the car as it slows and stops to
// reverse in. It has to keep back while the car reverses in, and go by once it is in.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, CAR } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { curbOffset } from "../../sim/roadside.js";
import { legalStretches, straight as straightKerb } from "../../sim/parallel-park.js";
import { rng } from "../../common.js";
import { frontWithin, laneScenario, pick, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "parallel-park", title: "Squeeze in", map: "kitsilano", weather: "dry", time: "afternoon", seed: 25042, icon: "⇲", difficulty: "Control", hazard: "parking", park: true, street: "West 10th Avenue",
  description: "Your destination is on a block in Kitsilano lined with parked cars, and there's one space left, a little over one and a half car lengths long. As you slow for it, a car comes up behind you.", lesson: "Signal early so the driver behind knows you're stopping. Pull up alongside the car in front of the space, about a door's width from it, with your rear bumpers level. Check behind, then reverse in on full lock toward the kerb, straighten, and turn the other way to swing the front in. Finish parallel, within 30 cm of the kerb. Never back into someone: wait until it's clear behind. That is BC's Motor Vehicle Act, and every province's driver's handbook teaches the same." };

const SPACE_M = 6.8, PARK_CARS = 3, PARK_CAR_GAP_M = 1.6, PARK_START_M = 90, PARK_PAST_M = 25, PARK_FOLLOW_M = 22, PARK_TRIGGER_M = 45;
const parkSiteCache = new WeakMap();
function parkingSites(map, street) {
  if (!parkSiteCache.has(map)) {
    const sites = [], front = CAR.length - CAR.rearOverhang, row = PARK_CARS * (CAR.length + PARK_CAR_GAP_M);
    for (const e of map.edges.values()) {
      if (!e.parking?.[1] || e.ring || e.oneway || e.lanes !== 1 || e.control) continue;
      const a = PARK_START_M + front + PARK_FOLLOW_M + 8, b = a + SPACE_M;
      if (b + Math.max(row, PARK_PAST_M) + 4 > e.length) continue;
      if (!legalStretches(map, e).some(([lo, hi]) => lo <= a - row - 0.5 && hi >= b + row + 0.5)) continue;
      if (!straightKerb(e, a - row - 2, b + row + 2)) continue;
      const lane = map.lane(e.id, e.lanes - 1), k = lane.length / e.length;
      sites.push({ lane, startS: (a - PARK_START_M - front) * k, goalS: (b + PARK_PAST_M) * k, space: { edge: e.id, a, b } });
    }
    sites.sort((x, y) => String(x.space.edge).localeCompare(String(y.space.edge)));
    parkSiteCache.set(map, sites);
  }
  const sites = parkSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const park = pick(parkingSites(map, challenge.street), random, "This map has no straight block of a two-way street with one lane each way and a parking lane, long enough to park on.");
  return { lane: park.lane, startS: park.startS, extend: 0, goalS: park.goalS, fields: { parking: park.space } };
});

// The cars parked either side of the space (see parkingSites), staying put, and the car that will come
// up behind, waiting until the car comes up to the space.
function placeParking(world, fleet, { edge, a, b }, seed) {
  const map = world.map, random = rng(seed), e = map.edges.get(edge), lat = curbOffset(e, CAR);
  const colors = [0x2b3a55, 0x8d9299, 0x9b1e1e, 0x1a1c20, 0xeeeeea, 0x6b7f5e];
  // (the whole block is lined with cars, wherever one may park, but for the space)
  const step = CAR.length + PARK_CAR_GAP_M, rears = [];
  for (const [lo, hi] of legalStretches(map, e)) {
    for (let rear = a - CAR.length; rear >= lo; rear -= step) if (rear + CAR.length <= hi) rears.push(rear);
    for (let rear = b; rear + CAR.length <= hi; rear += step) if (rear >= lo) rears.push(rear);
  }
  for (const [i, rear] of [...new Set(rears)].sort((x, y) => x - y).entries()) {
    const s = rear + CAR.rearOverhang, p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
    Object.assign(car, { id: `challenge_parked_${i + 1}`, color: colors[i % colors.length], style: [0, 3, 1, 5, 2, 4][i % 6], curb: "right", edge, stay: true });
    world.parked.add(car);
  }
  const lane = map.lane(edge, e.lanes - 1), k = lane.length / e.length, front = CAR.length - CAR.rearOverhang;
  const s = (a - PARK_START_M - front - PARK_FOLLOW_M) * k, p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
  Object.assign(car, { id: "challenge_follower", color: 0xb0b5b9, v0: e.limit, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5 + random() * 0.3, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0 });
  car.path.start(edge, lane.idx, s);
  fleet.vehicles.push(car);
  return { followerIds: [car.id], at: pointAt(e.pts, e.cum, a) };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeParking(world, fleet, scenario.parking, challenge.seed));
}

export const step = (world, fleet) => stepAuthored(world, fleet, {
  trigger: frontWithin(PARK_TRIGGER_M),
  // (the car behind sets off up the street)
  release: (world, fleet, state) => {
    for (const id of state.followerIds || []) { const car = fleet.vehicles.find(v => v.id === id); if (car) car.frozen = 0; }
  },
});
