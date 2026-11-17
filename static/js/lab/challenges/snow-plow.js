// Behind the plow: a snow plow (sim/snow-plow.js) clearing the left lane of a straight street with two
// lanes or more going the car's way and a limit of 80 km/h or less (on the challenge's `street`, where
// it has one), at its clearing speed, its rear PLOW_AHEAD_M ahead of the car's front as the car starts
// from a standstill in the curb lane, PLOW_START_M along the street. The curb lane beside the plow is
// empty all the way to the destination, PLOW_ROUTE_M on and at least PLOW_END_M short of the junction
// at the street's end: the car could draw level with the plow and go by it on the right, which it must
// never do. It stays STAY_BACK_M behind it in the curb lane all the way, the plow carrying straight on
// past the junction. (In falling snow it cannot see far enough to pass the plow on the left.)
import { headingAt, wrapAngle } from "../../map/mapdata.js";
import { SNOW_PLOW } from "../../sim/vehicle.js";
import { PLOW_MPS } from "../../sim/snow-plow.js";
import { laneScenario, pick } from "./shared/kit.js";

export const challenge = {
  id: "snow-plow",
  title: "Behind the plow",
  map: "winnipeg",
  weather: "snow",
  time: "afternoon",
  seed: 28042,
  icon: "❆",
  difficulty: "Patience",
  hazard: "snow-plow",
  street: "William Avenue",
  description:
    "It's snowing on William Avenue, two lanes each way. A city plow is clearing the left lane just ahead of you at 18 km/h, its blue and amber lamps flashing, and the right lane beside it is wide open.",
  lesson:
    "Stay at least 30 m behind a snow plow with its lights flashing (100 m where the limit is over 80 km/h): that is Manitoba's law, and other provinces' handbooks say the same. Never pass one on the right, the side its blade throws snow and debris, and don't pass one at all when blowing snow hides the road ahead. Pass only on the left, where you can see the way is clear, and move back in well ahead of it.",
};

const PLOW_START_M = 15,
  PLOW_AHEAD_M = 20,
  PLOW_ROUTE_M = 330,
  PLOW_END_M = 60;
const plowSiteCache = new WeakMap();
function plowSites(map, street) {
  if (!plowSiteCache.has(map)) {
    const sites = [];
    for (const e of map.edges.values()) {
      if (e.ring || e.lanes < 2 || e.limit > 80 / 3.6 + 0.1 || (map.crosswalks || []).some((c) => c.edge === e.id))
        continue;
      const end = (e.control?.s_line ?? e.length) - PLOW_END_M;
      if (end - PLOW_START_M < PLOW_ROUTE_M) continue;
      const h0 = headingAt(e.pts, e.cum, PLOW_START_M);
      let straight = true;
      for (let s = PLOW_START_M; s <= end && straight; s += 10)
        straight = Math.abs(wrapAngle(headingAt(e.pts, e.cum, s) - h0)) < 0.08;
      if (!straight) continue;
      // (the plow carries straight on along the street past the junction, in its leftmost lane)
      const ahead = [];
      for (let prev = e.id, i = 0; i < 4; i++) {
        const next = map
          .successors(prev)
          .find((id) => map.classifyTurn(map.turnAngle(prev, id)) === "straight" && !map.edges.get(id).ring);
        if (!next) break;
        ahead.push([next, 0]);
        prev = next;
      }
      const lane = map.lane(e.id, e.lanes - 1),
        scale = lane.length / e.length;
      sites.push({
        lane,
        startS: PLOW_START_M * scale,
        goalS: (PLOW_START_M + PLOW_ROUTE_M) * scale,
        plow: { edge: e.id, ahead },
      });
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    plowSiteCache.set(map, sites);
  }
  const sites = plowSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const plow = pick(
      plowSites(map, challenge.street),
      random,
      "This map has no long straight street with two lanes or more going one way and a limit of 80 km/h or less.",
    );
    return { lane: plow.lane, startS: plow.startS, extend: 0, goalS: plow.goalS, fields: { snowPlow: plow.plow } };
  });

// The snow plow in the leftmost lane (see plowSites), its rear PLOW_AHEAD_M ahead of the car's front,
// already clearing at its speed, carrying straight on.
function placePlow(world, fleet, { edge, ahead }, start) {
  const map = world.map,
    e = map.edges.get(edge),
    curb = map.lane(edge, start.lane),
    lane = map.lane(edge, 0),
    spec = world.ego.spec;
  const rear =
    (start.s * e.length) / curb.length + (spec.length - spec.rearOverhang) + PLOW_AHEAD_M + SNOW_PLOW.rearOverhang;
  const plow = fleet.addPlow(lane, (rear * lane.length) / e.length, PLOW_MPS, ahead);
  return { plowId: plow.id, at: [plow.x, plow.y] };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placePlow(world, fleet, scenario.snowPlow, scenario.start));
}
