// "Goose crossing": a gaggle of Canada geese (sim/geese.js) crosses Clemow Avenue in the Glebe, Ottawa,
// where it runs between Central Park and Patterson's Creek Park (jev/osm/parks.py: the map's parks layer
// has a park on either side of it there), as the driven car comes along it. The site: the first span of
// the challenge's `street` in the parks layer with a park on both sides, on a two-way street with one
// lane each way, long enough past the junction before it (gooseSites). The car starts from a standstill
// in the edge before, GS_START_M short of the crossing, and the route ends GS_GOAL_M past it. Two adults
// lead and bring up the rear of five goslings with a third adult among them, walking from Patterson's
// Creek Park (the car's left) toward Central Park; they set off once the car's front is GS_TRIGGER_M
// short of the crossing, the lead already at the kerb, so the car must stop. The adult in the middle of
// the file stops in the car's lane for GS_STOP_S: a driver who goes as soon as the first geese have
// crossed its lane drives at it.
import { routeFromLanes } from "../demo/routing.js";
import { cumulative, headingAt, pointAt } from "../map/mapdata.js";
import { crossingGeometry } from "../sim/geese.js";
import { CAR } from "../sim/vehicle.js";
import { GUTTER } from "../map/streets.js";

export const GS_START_M = 98, GS_TRIGGER_M = 75, GS_GOAL_M = 30, GS_STOP_S = 8;
// The file, lead first: pace (m/s) and spacing to the one ahead (m). The fifth stops in the car's lane.
const FILE = [
  { gosling: false, pace: 0.6, spacing: 0 },
  { gosling: true, pace: 0.55, spacing: 0.8 },
  { gosling: true, pace: 0.5, spacing: 0.7 },
  { gosling: true, pace: 0.55, spacing: 0.75 },
  { gosling: false, pace: 0.6, spacing: 1.1, stopper: true },
  { gosling: true, pace: 0.5, spacing: 0.8 },
  { gosling: true, pace: 0.5, spacing: 0.7 },
  { gosling: false, pace: 0.6, spacing: 1.2 },
];

// The spans of `street` in the parks layer with parks on both sides, on a two-way street with one lane
// each way, entered straight on from a lane of the same street long enough to start in.
export function gooseSites(map, street = null) {
  const out = [];
  for (const sp of map.parkSpans || []) {
    const e = map.edges.get(sp.edge);
    if (!e || e.oneway || e.lanes !== 1 || !sp.left || !sp.right || (street && e.name !== street)) continue;
    const s = Math.max(sp.from, 20) + 10;
    if (s + GS_GOAL_M > e.length - 2 || s > sp.to) continue;
    const before = [...map.edges.values()].find((o) => o.to === e.from && o.from !== e.to && o.name === e.name && o.lanes === 1 && !o.control);
    if (!before || before.length + s < GS_START_M) continue;
    out.push({ edge: e.id, before: before.id, s, left: sp.left, right: sp.right });
  }
  return out;
}

export function geeseScenario(map, challenge) {
  const site = gooseSites(map, challenge.street)[0];
  if (!site) throw new Error(`No street between two parks on ${challenge.street} for the "Goose crossing" challenge.`);
  const e = map.edges.get(site.edge), b = map.edges.get(site.before);
  const laneB = map.lane(b.id, 0), lane = map.lane(e.id, 0);
  const kB = laneB.length / b.length, k = lane.length / e.length;
  const front = CAR.length - CAR.rearOverhang;
  const s = Math.max(1, (b.length - (GS_START_M - site.s)) * kB - front);
  const route = routeFromLanes(map, [laneB, lane], s, (site.s + GS_GOAL_M) * k);
  const p = pointAt(laneB.pts, laneB.cum, s);
  return { id: challenge.id, start: { edge: b.id, lane: 0, s, x: p[0], y: p[1], psi: headingAt(laneB.pts, laneB.cum, s) }, route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    geese: { edge: e.id, s: site.s, sigma: -1 },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

// The gaggle on the grass of Patterson's Creek Park, the lead at the kerb (the world's own geese off).
export function placeGeese(world, spec) {
  const map = world.map, geese = world.geese;
  geese.target = 0;
  const geo = crossingGeometry(map, spec.edge, spec.s, spec.sigma, 0);
  const e = geo.e;
  // (the car's lane centre, across the street from the gaggle's side: where the stopper stops)
  const laneOut = e.lane_offsets[0], roadFrom = -e.asphalt[0] + GUTTER;
  const stopAt = geo.uIn + roadFrom + laneOut;
  const file = FILE.map((f) => ({ ...f, jitter: 0, wobble: 0, graze: 0.5, ...(f.stopper ? { stopFor: GS_STOP_S, stopAt } : {}) }));
  const routeS = world.route.project(geo.q[0], geo.q[1], 0).s;
  const g = geese.place(spec, file, { trigger: GS_TRIGGER_M, routeS, id: "challenge_gaggle", keep: true });
  if (!g) throw new Error("Could not place the geese.");
  // (already across the sidewalk, the lead a step short of the kerb, the rest in file behind it)
  const shift = geo.uIn - 1.2 - g.geese[0].u;
  for (const o of g.geese) { o.u += shift; geese.pose(g, o); o.psi = geo.heading + (o.gosling ? 0.3 : -0.2); }
  return { gaggleId: g.id, stopperId: g.geese[4].id, at: geo.q, triggered: true };
}
