// "Pothole season": Rue Saint-Denis in the Plateau, a busy main street with one lane each way and no
// parking lane, on a wet spring afternoon, the frost coming out of the ground. Most of the block from
// Avenue Duluth Est down toward Rue Rachel Est (edge e212, 176 m, no control along it) has a run of
// potholes in the car's lane (sim/potholes.js), each full of rain water: two small ones in the wheel
// paths that it can ease round inside the lane, putting each between its wheels (the first on the
// right, the second on the left), one wide one across the middle of the lane that no car gets round
// without crossing the centre line, so it must slow to drive over it, and a last small one that lies
// between the wheels as it is. The car starts from a standstill START_S along the block and stops
// short of the light at Rachel.
import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { potholeOnLane } from "../sim/potholes.js";

const EDGE = "e212", START_S = 8, GOAL_S = 168;
// Each pothole: metres along the lane, right of its centre, half its length and width, and its depth.
export const PH_POTHOLES = [
  { s: 50, offset: 0.75, a: 0.35, b: 0.3, depth: 0.06 },
  { s: 90, offset: -0.6, a: 0.4, b: 0.3, depth: 0.07 },
  { s: 128, offset: 0.1, a: 0.85, b: 0.8, depth: 0.1, wide: true },
  { s: 152, offset: 0, a: 0.3, b: 0.24, depth: 0.05 },
];

export function potholeScenario(map, challenge) {
  const e = map.edges.get(EDGE);
  if (e?.name !== challenge.street || e.lanes !== 1 || e.oneway) throw new Error("Pothole season needs Montréal's Rue Saint-Denis.");
  const lane = map.lane(EDGE, 0), p = pointAt(lane.pts, lane.cum, START_S);
  const route = routeFromLanes(map, [lane], START_S, GOAL_S);
  return { id: challenge.id, start: { edge: EDGE, lane: 0, s: START_S, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, START_S) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed, potholes: { edge: EDGE, lane: 0, list: PH_POTHOLES },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

// The run of potholes, in place of the world's own; the hazard is the wide one.
export function installPotholes(world, scenario) {
  const { edge, lane, list } = scenario.potholes;
  const placed = list.map((p, i) => potholeOnLane(world.map, edge, lane, p.s, { id: `challenge_pothole_${i + 1}`, offset: p.offset, a: p.a, b: p.b, depth: p.depth, shape: 51042 + i * 7919 }));
  world.potholes.setList(placed);
  const wide = placed[list.findIndex((p) => p.wide)];
  Object.assign(world.challenge, { at: [wide.x, wide.y], potholeIds: placed.map((h) => h.id), widePothole: wide.id });
}
