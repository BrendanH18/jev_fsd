// "Don't splash": Main Street in Mount Pleasant, Vancouver, northbound in the rain on an afternoon, in
// the kerb lane (three lanes each way, 50 km/h, no parking lane, the sidewalk right at the kerb). The
// car comes along the block from East 10th Avenue (edge e708, 100 m), past the stop for the 8 and the
// 19 (s1753317119, about 30 m along the block), and on along the next block (e666). Puddles stand in
// the gutter (sim/puddles.js):
//   - at the bus stop, where three people wait at the kerb, one reaching into the right wheel path: the
//     car can ease left inside its lane so that its wheels miss it;
//   - on the next block, a deep one spreading across most of the lane, as someone walks up the sidewalk
//     beside it: there is no room to miss it without leaving the lane, so the car must slow below its
//     splash speed (about 16 km/h) to go through it;
//   - and further on, a long shallow one with nobody near: just water, no reason to slow.
// The car starts moving, in the kerb lane, and its drive ends along the second block.
import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { sidewalkOffset, GUTTER, CURB } from "../map/streets.js";
import { Pedestrian } from "../sim/pedestrians.js";
import { puddleOnLane } from "../sim/puddles.js";

// The route, edge by edge (the kerb lane of each), where it starts and ends, and the speed it starts at.
const CHAIN = ["e708", "e666"], KERB_LANE = 2, START_S = 4, START_MPS = 11, GOAL_S = 88;
// Each puddle: its edge, metres along the kerb lane, how far it reaches out from the kerb, half its
// length, and its depth.
export const SPLASH_PUDDLES = [
  { edge: "e708", s: 46, width: 1.3, a: 2.6, depth: 0.03 },
  { edge: "e666", s: 40, width: 2.0, a: 2.4, depth: 0.05 },
  { edge: "e666", s: 76, width: 1.4, a: 3.5, depth: 0.012 },
];
// The people waiting at the bus stop (metres along e708, and out from the kerb face), and the one
// walking up the sidewalk on e666 (from, to: metres along it) at WALK_MPS.
const WAITING = [[40, 0.8], [44, 1.1], [48.5, 0.7]], WALK = { edge: "e666", from: 24, to: 70 }, WALK_MPS = 1.3;

export function puddleScenario(map, challenge) {
  const e = map.edges.get(CHAIN[0]);
  if (e?.name !== challenge.street || e.lanes !== 3 || !CHAIN.every((id) => map.edges.get(id)?.lanes === 3)) throw new Error("Don't splash needs Vancouver's Main Street in Mount Pleasant.");
  const lanes = CHAIN.map((id) => map.lane(id, KERB_LANE)), route = routeFromLanes(map, lanes, START_S, GOAL_S);
  const l = lanes[0], p = pointAt(l.pts, l.cum, START_S);
  return { id: challenge.id, start: { edge: CHAIN[0], lane: KERB_LANE, s: START_S, x: p[0], y: p[1], psi: headingAt(l.pts, l.cum, START_S) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed, puddles: { lane: KERB_LANE, list: SPLASH_PUDDLES },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

// A point `out` metres right of edge `e`'s centreline, `s` along it.
function sidePoint(e, s, out) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return [p[0] + Math.sin(h) * out, p[1] - Math.cos(h) * out];
}

// The puddles, in place of the world's own; the people at the bus stop; and the one walking.
export function installPuddles(world, scenario) {
  const map = world.map, { lane, list } = scenario.puddles;
  const placed = list.map((q, i) => puddleOnLane(map, q.edge, lane, q.s, { id: `challenge_puddle_${i + 1}`, width: q.width, a: q.a, depth: q.depth, shape: 59042 + i * 7919 }));
  world.puddles.setList(placed);
  const stop = map.edges.get(CHAIN[0]), kerb = stop.asphalt[1] + GUTTER + CURB;
  WAITING.forEach(([s, out], i) => {
    const [x, y] = sidePoint(stop, s, kerb + out), h = headingAt(stop.pts, stop.cum, s);
    world.crowd.list.push(new Pedestrian({ id: `challenge_waiting_${i + 1}`, x, y, psi: h + Math.PI / 2 + (i - 1) * 0.5, v: 0, speed: 1.2, path: [], crossing: null, waiting: 0, phase: i * 1.7, look: 59042 + i * 31, held: true }));
  });
  const e = map.edges.get(WALK.edge), walk = sidewalkOffset(e, 1), path = [];
  for (let s = WALK.from + 4; s <= WALK.to; s += 4) path.push({ p: sidePoint(e, s, walk) });
  const [x, y] = sidePoint(e, WALK.from, walk);
  world.crowd.list.push(new Pedestrian({ id: "challenge_walker", x, y, psi: headingAt(e.pts, e.cum, WALK.from), v: 0, speed: WALK_MPS, path, crossing: null, waiting: 0, phase: 0, look: 59042 + 97, home: true }));
  world.ego.v = START_MPS;
  Object.assign(world.challenge, { at: [placed[0].x, placed[0].y], puddleIds: placed.map((h) => h.id), puddles: true });
}

// The hazard: the car has come up to a puddle with someone beside it.
export function stepPuddles(world) {
  if (!world.challenge.triggered && world.puddlesSeen) world.challenge.triggered = true;
}
