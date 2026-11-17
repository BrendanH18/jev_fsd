// Stop for the guard: a school crossing guard (sim/crossing-guard.js) at a marked crosswalk between
// junctions in a school zone, on the challenge's `street` where it has one, with GUARD_AHEAD_M of the
// same edge before it and GUARD_PAST_M after it short of any stop line. The car starts from a
// standstill, its front GUARD_AHEAD_M short of the crosswalk's centre; the guard and GUARD_KIDS children
// wait at the curb on the right of its way. Once the car's front is GUARD_TRIGGER_M from the crosswalk,
// the guard looks for a gap (the car can stop easily by then), steps out with the STOP sign raised to
// the middle of the road, the children cross, and the guard walks back to the curb. The route ends
// GUARD_PAST_M past the crosswalk. Driving past the guard's STOP sign (`drove past a crossing guard's
// stop sign`) is a failure.
import { projectPoint } from "../../map/mapdata.js";
import { CAR } from "../../sim/vehicle.js";
import { rng } from "../../common.js";
import { frontWithin, laneScenario, pick, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "crossing-guard",
  title: "Stop for the guard",
  map: "montreal",
  weather: "dry",
  time: "morning",
  seed: 34042,
  icon: "◉",
  difficulty: "Patience",
  hazard: "crossing-guard",
  guards: true,
  street: "Rue Berri",
  description:
    "Rue Berri, beside École Louis-Hippolyte-Lafontaine, at 9 in the morning. A school crossing guard waits at the marked crosswalk ahead with three children, ready to walk them across.",
  lesson:
    "A school crossing guard's STOP sign is a traffic sign. When the guard steps out holding it up, stop before the crosswalk and stay stopped until the guard and every child are off the road, not just out of your lane: that is Ontario's Highway Traffic Act, and BC's and Québec's rules are the same. Slow down whenever children wait at the curb with a guard.",
};

const GUARD_AHEAD_M = 95,
  GUARD_TRIGGER_M = 50,
  GUARD_KIDS = 3,
  GUARD_PAST_M = 50;
const guardSiteCache = new WeakMap();
function guardChallengeSites(map, street) {
  if (!guardSiteCache.has(map)) {
    const sites = [],
      front = CAR.length - CAR.rearOverhang;
    for (const c of map.crosswalks || []) {
      const e = map.edges.get(c.edge);
      if (!e || e.ring) continue;
      const s = projectPoint(e.pts, e.cum, [c.x, c.y]).s;
      if (s < GUARD_AHEAD_M + 5 || s + GUARD_PAST_M > (e.control?.s_line ?? e.length) - 10) continue;
      if (
        !(map.zoneSpans.get(e.id) || []).some((span) => span.zone.kind === "school" && s >= span.from && s <= span.to)
      )
        continue;
      const lane = map.lane(e.id, e.lanes - 1),
        k = lane.length / e.length;
      sites.push({
        lane,
        startS: (s - GUARD_AHEAD_M - front) * k,
        goalS: (s + GUARD_PAST_M) * k,
        guard: { crosswalk: c.id },
      });
    }
    sites.sort((a, b) => String(a.guard.crosswalk).localeCompare(String(b.guard.crosswalk)));
    guardSiteCache.set(map, sites);
  }
  const sites = guardSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const guard = pick(
      guardChallengeSites(map, challenge.street),
      random,
      "This map has no marked crosswalk in a school zone with room to come up to it.",
    );
    return {
      lane: guard.lane,
      startS: guard.startS,
      extend: 0,
      goalS: guard.goalS,
      fields: { crossingGuard: guard.guard },
    };
  });

// The crossing guard's post at the crosswalk (see guardChallengeSites), with no children coming along on
// their own, and GUARD_KIDS waiting at the curb with the guard, held until the trigger.
function placeGuard(world, { crosswalk }, seed) {
  const g = world.crossingGuards;
  g.arrivals = false;
  const post = g.staff().find((p) => p.cw.id === crosswalk);
  if (!post)
    throw new Error("The crosswalk has no crossing guard: the challenge needs `guards` and its school zone in effect.");
  post.held = true;
  const kids = g.gather(post, { side: post.side, count: GUARD_KIDS, random: rng(seed) });
  return { guardPostId: post.id, guardId: post.guard.id, childIds: kids.map((k) => k.id), at: post.mid };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeGuard(world, scenario.crossingGuard, challenge.seed));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: frontWithin(GUARD_TRIGGER_M),
    // (the crossing guard looks for a gap, to walk the children across)
    release: (world, fleet, state) => {
      const post = state.guardPostId && world.crossingGuards.posts.find((p) => p.id === state.guardPostId);
      if (post) post.held = false;
    },
  });
