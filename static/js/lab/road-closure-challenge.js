// "Road closed": Spring Garden Road in downtown Halifax on a festival afternoon. Its block between Queen
// Street and Birmingham Street (e277, and e278 the other way) is closed for a street festival: barricades
// across both ends, with ROAD CLOSED and DETOUR signs (sim/road-closures.js). The driven car sets off a
// block and a half before it (e489) with a route that still runs down the closed block and onto Birmingham
// Street; it learns of the closure only once it can see the barricade past Queen Street, and must re-plan
// and take the detour (Queen Street, Clyde Street, back onto Birmingham Street) rather than stop in the
// junction or drive past the barricades.
import { browserRoute } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";

const START = "e489", APPROACH = "e491", CLOSED = "e277", EXIT = "e172", CROSS = "e494";
// The car starts START_S along Spring Garden Road, at rest, a block and a half short of the closed block
// (beyond sight of its barricades); the destination is GOAL_S along Birmingham Street.
export const START_S = 20, GOAL_S = 60;

export function roadClosureScenario(map, challenge) {
  const start = map.edges.get(START), approach = map.edges.get(APPROACH), closed = map.edges.get(CLOSED), exit = map.edges.get(EXIT), cross = map.edges.get(CROSS);
  if (start?.name !== challenge.street || approach?.name !== challenge.street || closed?.name !== challenge.street || closed.oneway || exit?.name !== "Birmingham Street"
    || cross?.name !== "Queen Street" || start.to !== approach.from || approach.to !== closed.from || cross.from !== closed.from || approach.control?.type !== "signal")
    throw new Error("The road closure lesson needs Halifax's Spring Garden Road, two-way, closed between Queen Street and Birmingham Street.");
  const lane = map.lane(START, start.lanes - 1), p = pointAt(lane.pts, lane.cum, START_S), psi = headingAt(lane.pts, lane.cum, START_S);
  const out = map.lane(EXIT, exit.lanes - 1), q = pointAt(out.pts, out.cum, GOAL_S);
  // (the way the car would go with the street open: down the closed block and onto Birmingham Street)
  const route = browserRoute(map, { x: p[0], y: p[1], heading: psi }, { x: q[0], y: q[1] });
  if (route?.edges[0] !== START || route.edges[2] !== CLOSED || route.edges.at(-1) !== EXIT)
    throw new Error("The road closure lesson's route must run down the closed block of Spring Garden Road.");
  return { id: challenge.id, start: { edge: START, lane: lane.idx, s: START_S, x: p[0], y: p[1], psi },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    roadClosure: { edge: CLOSED, street: closed.name, from: cross.name, to: exit.name },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: route.edges.filter(id => map.edges.get(id).control?.type === "signal").length,
      stops: route.edges.filter(id => map.edges.get(id).control?.type === "stop").length, lefts: route.turns.filter(t => t.dir === "left").length, rights: route.turns.filter(t => t.dir === "right").length } };
}

// The block closes before the car sets off; the car knows nothing of it until it sees a barricade.
export function installRoadClosure(world, fleet, scenario) {
  const closures = world.roadClosures;
  if (!closures?.enabled) throw new Error("The road closure lesson needs road closures on.");
  closures.fixed = true;
  const closure = closures.close(world, fleet, scenario.roadClosure.edge, { fixed: true });
  if (!closure) throw new Error("The road closure lesson's block could not be closed.");
  Object.assign(world.challenge, { at: [closure.ends[0].x, closure.ends[0].y], roadClosure: { id: closure.id } });
}

// The hazard is the closure: it triggers once the car has seen a barricade.
export function stepRoadClosure(world) {
  const state = world.challenge;
  if (!state.triggered && world.roadClosuresSeen) state.triggered = true;
}
