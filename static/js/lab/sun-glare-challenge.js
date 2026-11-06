// Into the sun: Calgary's 17 Avenue SW, westbound in the right lane, on a clear 8 October at 18:15
// (Mountain daylight time). The sun stands about 6 degrees up at 253 degrees, 17 degrees left of the
// avenue, so a westbound driver looks straight into it (sim/sun-glare.js). Ahead are the signals at
// 4 Street SW and 5 Street SW, and between them someone crossing mid-block from the far side.
// A Calgary avenue runs east-west: at this latitude the low evening sun is that close to west only
// from mid-September to mid-October (by November it sets in the south-west, 25 to 35 degrees off a
// westbound street), which is when Calgary's avenues are known for it.
import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { Pedestrian } from "../sim/pedestrians.js";

const CHAIN = ["e267", "e269", "e319", "e275", "e273", "e271", "e136"];
const START_S = 40, CROSS_EDGE = "e273", CROSS_S = 38;

export function sunGlareScenario(map, challenge) {
  const edges = CHAIN.map(id => map.edges.get(id));
  if (edges.some(e => e?.name !== "17 Avenue SW")) throw new Error("Into the sun needs Calgary's 17 Avenue SW.");
  const lanes = edges.map(e => map.lane(e.id, e.lanes - 1)), start = lanes[0];
  const route = routeFromLanes(map, lanes, START_S, lanes.at(-1).length - 5);
  const p = pointAt(start.pts, start.cum, START_S);
  // (the crossing: from the far, south side of the avenue to the north side, the car's right)
  // (`asphalt`: its left and right edges, right of the centreline; the person starts and ends 1.2 m past them)
  const e = map.edges.get(CROSS_EDGE), cum = cumulative(e.pts), c = pointAt(e.pts, cum, CROSS_S), h = headingAt(e.pts, cum, CROSS_S);
  const right = [Math.sin(h), -Math.cos(h)], near = e.asphalt[0] - 1.2, far = e.asphalt[1] + 1.2;
  return { id: challenge.id, start: { edge: start.edge, lane: start.idx, s: START_S, x: p[0], y: p[1], psi: headingAt(start.pts, start.cum, START_S) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    sunGlare: { at: c, from: [c[0] + right[0] * near, c[1] + right[1] * near], to: [c[0] + right[0] * far, c[1] + right[1] * far] },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 2, stops: 0, lefts: 0, rights: 0 } };
}

// The signals are coordinated, a 60 s cycle: start 25 s in, so that 4 Street's light is red as the car
// comes up to it (seen late, in the glare), and 5 Street's green when it gets there. The person waits
// at the far curb until the car comes up (stepChallenge's trigger), then crosses.
export const SIGNAL_OFFSET_S = 25;
export function installSunGlare(world, scenario, seed) {
  const { at, from, to } = scenario.sunGlare;
  world.t = SIGNAL_OFFSET_S;
  const ped = new Pedestrian({ id: "challenge_pedestrian", x: from[0], y: from[1], psi: Math.atan2(to[1] - from[1], to[0] - from[0]),
    v: 0, speed: 1.35, path: [{ p: to, cross: { node: null, from, to, jaywalk: true } }], crossing: null, waiting: 0, phase: 0, look: seed, at: null });
  ped.frozen = 1e6;
  world.crowd.list.push(ped);
  Object.assign(world.challenge, { at, pedestrianId: ped.id });
}
