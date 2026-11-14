// Take turns: a lane closure (sim/lane-closure.js) on a block of the challenge's `street` (where it has
// one) with a limit above the closure's, its merge point far enough along for ZIP_QUEUE cars, ZIP_GAP_M
// apart, to stand queued in the open lane back from it, the first with its front a metre short of it.
// In the closed lane ZIP_WAITING cars wait at the merge, ZIP_WAIT_GAP_M apart, and the car starts from a
// standstill behind them, its front ZIP_START_M short of the merge point; the lane ahead of it is
// otherwise empty. One from each lane in turn, the car merges after the third car in the open lane, not
// straight after the second car in its own. The route ends ZIP_END_M short of the street's stop line, on
// the same block.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, CAR } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { LC_LIMIT_MPS, SPAN_M as LC_SPAN_M, laneClosureSites } from "../../sim/lane-closure.js";
import { rng } from "../../common.js";
import { laneScenario, pick } from "./shared/kit.js";

export const challenge = { id: "zipper", title: "Take turns", map: "calgary", weather: "dry", time: "afternoon", seed: 29042, icon: "⋈", difficulty: "Courtesy", hazard: "lane-closure", street: "14 Avenue SW",
  description: "A road crew has closed the right lane of 14 Avenue SW, one-way with two lanes. The left lane is backed up to the cones, two cars in your lane are waiting at the merge, and the lane ahead of you is otherwise empty.", lesson: "Where a lane is closed, zipper merge: in slow traffic, stay in your lane right up to the merge point, then take turns, one vehicle from each lane. Manitoba's driver's handbook teaches it, and Ontario cities and the Alberta Motor Association ask drivers to merge this way. Merging early makes the queue longer, and following the car ahead in out of turn forces the driver whose turn it is to brake. Wait for your turn, then go." };

const ZIP_START_M = 30, ZIP_QUEUE = 7, ZIP_GAP_M = 7.5, ZIP_WAITING = 2, ZIP_WAIT_GAP_M = 8, ZIP_END_M = 12;
const zipSiteCache = new WeakMap();
function zipperSites(map, street) {
  if (!zipSiteCache.has(map)) {
    const sites = [], front = CAR.length - CAR.rearOverhang, room = 1 + (ZIP_QUEUE - 1) * ZIP_GAP_M + CAR.length + 4;
    for (const site of laneClosureSites(map)) {
      const e = map.edges.get(site.edge);
      if (e.limit <= LC_LIMIT_MPS + 1) continue;
      const m = Math.min(site.hi, Math.max(site.lo, room)), end = Math.min(e.length, e.control?.s_line ?? e.length) - ZIP_END_M;
      if (m < room || end < m + LC_SPAN_M + 10) continue;
      const lane = map.lane(site.edge, e.lanes - 1), k = lane.length / e.length;
      sites.push({ lane, startS: (m - ZIP_START_M - front) * k, goalS: end * k, closure: { edge: site.edge, m } });
    }
    zipSiteCache.set(map, sites);
  }
  const sites = zipSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const zip = pick(zipperSites(map, challenge.street), random, "This map has no straight block with two lanes going one way, a limit above 30 km/h and room for a lane closure with a queue.");
  return { lane: zip.lane, startS: zip.startS, extend: 0, goalS: zip.goalS, fields: { laneClosure: zip.closure } };
});

// The lane closure (see zipperSites), the cars waiting at its merge point in the closed lane, and the
// queue in the open lane, all standing still.
function placeZipper(world, fleet, { edge, m }, seed) {
  const map = world.map, random = rng(seed), e = map.edges.get(edge), z = world.laneClosures.place({ edge, m }), ids = [];
  const colors = [0x2b3a55, 0xb0b5b9, 0x9b1e1e, 0x1a1c20, 0xeeeeea, 0x6b7f5e, 0x8d9299, 0x4a4f57, 0xc4c8cc];
  const front = CAR.length - CAR.rearOverhang;
  const add = (lane, fronts, name) => fronts.forEach((f, i) => {
    const L = map.lane(edge, lane), s = (f - front) * L.length / e.length, p = pointAt(L.pts, L.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(L.pts, L.cum, s), 0);
    Object.assign(car, { id: `challenge_${name}_${i + 1}`, color: colors[ids.length % colors.length], v0: e.limit, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.4 + random() * 0.3, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(edge, lane, s);
    fleet.vehicles.push(car); ids.push(car.id);
  });
  add(e.lanes - 1, Array.from({ length: ZIP_WAITING }, (_, i) => m - 0.5 - i * ZIP_WAIT_GAP_M), "merging");
  add(e.lanes - 2, Array.from({ length: ZIP_QUEUE }, (_, i) => m - 1 - i * ZIP_GAP_M), "queue");
  return { closureId: z.id, zipperIds: ids, at: pointAt(e.pts, e.cum, m) };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeZipper(world, fleet, scenario.laneClosure, challenge.seed));
}
