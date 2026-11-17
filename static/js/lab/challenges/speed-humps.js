// Over the humps: a speed hump, cushion or table (sim/traffic-calming.js) at least HUMP_START_M along a
// block of the challenge's `street` (where it has one) whose limit is at least HUMP_LIMIT_KMH, outside
// any school or playground zone, with no sign or signal before it on the block: the car starts from a
// standstill at the start of the block, with room to reach the limit before it, if it does not slow.
// Where the street carries straight on past the next junction to another such block with a device of
// its own, the route does too. It ends HUMP_PAST_M past the last device (short of its block's line).
import { DEVICES } from "../../sim/traffic-calming.js";
import { laneScenario, pick } from "./shared/kit.js";

export const challenge = {
  id: "speed-humps",
  title: "Over the humps",
  map: "ottawa",
  weather: "dry",
  time: "afternoon",
  seed: 31042,
  icon: "⌒",
  difficulty: "Control",
  hazard: "speed-humps",
  calming: true,
  street: "Gloucester Street",
  description:
    "Gloucester Street is a one-way residential street in Centretown with a 50 km/h limit and a speed hump across each block. You set off from the start of a block, with a clear run of 80 m up to the first.",
  lesson:
    "Speed humps are built to be crossed at about 30 km/h, speed tables at about 40 and speed bumps at a crawl: faster, they jolt the car and everyone in it, and can unsettle it. Slow down before you reach one, not on it, cross at an even speed, and pick up speed again only once your rear wheels are over. Then slow again for the next one.",
};

const HUMP_LIMIT_KMH = 40,
  HUMP_START_M = 75,
  HUMP_FROM_M = 4,
  HUMP_PAST_M = 50;
const humpSiteCache = new WeakMap();
function humpSites(map, street) {
  if (!humpSiteCache.has(map)) {
    const sites = [];
    // (the first device a block has, of the kinds that rise across it: not a bump, under a metre long)
    const firstOn = (e) => (map.calmingSpans?.get(e.id) || []).find((x) => DEVICES[x.device.kind].length > 2);
    const calmBlock = (e) => e && !e.ring && e.limit * 3.6 >= HUMP_LIMIT_KMH - 0.5 && !map.zoneSpans.get(e.id)?.length;
    for (const e of map.edges.values()) {
      const first = calmBlock(e) && firstOn(e);
      if (!first || first.s - first.half < HUMP_START_M) continue;
      const lane = map.lane(e.id, e.lanes - 1);
      let ahead = null,
        last = first,
        lastEdge = e;
      const next = (map.out.get(e.to) || [])
        .map((id) => map.edges.get(id))
        .find((n) => n.name === e.name && Math.abs(map.turnAngle(e.id, n.id)) < 0.2 && calmBlock(n) && firstOn(n));
      if (next && firstOn(next).s + HUMP_PAST_M < (next.control?.s_line ?? next.length) - 5) {
        ahead = map.lane(next.id, Math.min(next.lanes - 1, e.lanes - 1));
        last = firstOn(next);
        lastEdge = next;
      }
      const goal = last.s + last.half + HUMP_PAST_M;
      if (!lane || goal > (lastEdge.control?.s_line ?? lastEdge.length) - 5) continue;
      const goalLane = ahead || lane;
      sites.push({
        lane,
        ahead,
        startS: (HUMP_FROM_M * lane.length) / e.length,
        goalS: (goal * goalLane.length) / lastEdge.length,
      });
    }
    sites.sort(
      (a, b) => (b.ahead ? 1 : 0) - (a.ahead ? 1 : 0) || String(a.lane.edge).localeCompare(String(b.lane.edge)),
    );
    humpSiteCache.set(map, sites);
  }
  const sites = humpSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street),
    pick = on.length ? on : sites;
  // (two blocks with a device each, where there are)
  return pick.some((s) => s.ahead) ? pick.filter((s) => s.ahead) : pick;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const hump = pick(
      humpSites(map, challenge.street),
      random,
      "This map has no block with a speed hump at least 75 m along it, a limit of 40 km/h or more and no school or playground zone.",
    );
    return {
      lane: hump.lane,
      startS: hump.startS,
      through: hump.ahead ? [hump.ahead] : [],
      extend: 0,
      goalS: hump.goalS,
    };
  });
