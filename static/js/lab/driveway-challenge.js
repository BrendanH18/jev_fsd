// "Reverse lights": a car backs out of a driveway (sim/driveway-reversers.js) on a residential street as
// the driven car comes along it, half hidden by the cars parked at the kerb on either side of the
// driveway (hidden hazards on: the parked cars hide it from the car, and the car from its driver). The
// site: the first driveway, in the map's driveways layer order, on the right of a two-way residential
// block of the challenge's `street` with one lane each way and a parking lane on the right, far enough
// from both ends of the block (drivewaySites). The car starts from a standstill RV_START_M short of
// the driveway, in the kerb lane; the car in the driveway starts backing out once the car's front is
// RV_TRIGGER_M short of it, already across the sidewalk (RV_START_BACK_M short of where it stops to
// look), so it comes out into the lane while the car is still coming: a car that keeps its speed meets
// it there. The route ends RV_GOAL_M past the driveway.
import { routeFromLanes } from "../demo/routing.js";
import { cumulative, headingAt, pointAt } from "../map/mapdata.js";
import { Vehicle, CAR } from "../sim/vehicle.js";
import { obbOverlap } from "../sim/collision.js";
import { drivewayGeometry } from "../sim/driveway-reversers.js";
import { curbOffset } from "../sim/roadside.js";
import { rng } from "../common.js";

export const RV_START_M = 110, RV_TRIGGER_M = 70, RV_START_BACK_M = 1.2, RV_GOAL_M = 30;
const PARKED_FROM_M = 60, PARKED_TO_M = 30, PARKED_GAP_M = 1.2;

export function drivewaySites(map, street = null) {
  const out = [];
  for (const d of map.driveways || []) {
    const e = map.edges.get(d.edge);
    if (!e || d.side !== "right" || e.oneway || e.lanes !== 1 || e.cls !== "residential" || !(e.parking?.[1] > 0) || (street && e.name !== street)) continue;
    if (d.s < RV_START_M + 10 || d.s > e.length - RV_GOAL_M - 15 || e.control && e.control.s_line < d.s + RV_GOAL_M + 5) continue;
    if (!drivewayGeometry(map, d, CAR)) continue;
    out.push({ driveway: d.id, edge: e.id });
  }
  return out;
}

export function drivewayScenario(map, challenge) {
  const site = drivewaySites(map, challenge.street)[0];
  if (!site) throw new Error(`No driveway on ${challenge.street} with room for the "Reverse lights" challenge.`);
  const d = map.driveways.find((x) => x.id === site.driveway), e = map.edges.get(site.edge);
  const lane = map.lane(e.id, e.lanes - 1), k = lane.length / e.length;
  const front = CAR.length - CAR.rearOverhang;
  const s = (d.s - RV_START_M) * k - front;
  const route = routeFromLanes(map, [lane], s, (d.s + RV_GOAL_M) * k);
  const p = pointAt(lane.pts, lane.cum, s);
  return { id: challenge.id, start: { edge: e.id, lane: lane.idx, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) }, route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    reverser: { driveway: d.id, edge: e.id, s: d.s },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

// The cars parked along the kerb either side of the driveway, clear of its way out, and the car in the
// driveway (the world's own reversers off).
export function placeReverser(world, spec, seed) {
  const map = world.map, e = map.edges.get(spec.edge), d = map.driveways.find((x) => x.id === spec.driveway);
  const reversers = world.driveways;
  reversers.target = 0;
  const geo = drivewayGeometry(map, d, CAR);
  const sweep = [];
  for (let s = 0; s <= geo.sEnd + 0.01; s += 0.5) {
    const p = geo.path.pointAt(s), psi = geo.path.headingAt(s) + Math.PI, f = CAR.length / 2 - CAR.rearOverhang;
    sweep.push({ center: [p[0] + Math.cos(psi) * f, p[1] + Math.sin(psi) * f], heading: psi, halfLength: CAR.length / 2, halfWidth: CAR.width / 2 });
  }
  const random = rng(seed), colors = [0x8d9299, 0x2b3a55, 0xeeeeea, 0x1a1c20, 0x6b7f5e, 0x9b1e1e, 0xc4c8cc];
  // (along this side, and the other side of the street: its twin edge's right)
  const twin = [...map.edges.values()].find((o) => o.from === e.to && o.to === e.from && Math.abs(o.length - e.length) < 1);
  let n = 0;
  for (const [side, from, to] of [[e, d.s - PARKED_FROM_M, d.s + PARKED_TO_M], ...(twin?.parking?.[1] > 0 ? [[twin, e.length - d.s - PARKED_TO_M, e.length - d.s + PARKED_FROM_M]] : [])]) {
    const lat = curbOffset(side, CAR), scale = side.cum[side.cum.length - 1] / side.length;
    for (let r = Math.max(2, from); r + CAR.length <= Math.min(side.length - 2, to); r += CAR.length + PARKED_GAP_M + random() * 1.5) {
      const s = (r + CAR.rearOverhang) * scale, p = pointAt(side.pts, side.cum, s), h = headingAt(side.pts, side.cum, s);
      const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
      // (none across the driveway's way out, with room to spare)
      if (sweep.some((b) => obbOverlap(b, car.obb(), 0.6))) continue;
      Object.assign(car, { id: `challenge_parked_${++n}`, color: colors[Math.floor(random() * colors.length)], style: n % 6, curb: "right", edge: side.id, stay: true });
      world.parked.add(car);
    }
  }
  const car = reversers.place(d, { trigger: RV_TRIGGER_M, routeS: world.route.project(geo.q[0], geo.q[1], 0).s, color: 0x9b1e1e, style: 1, id: "challenge_reversing", keep: true });
  if (!car) throw new Error(`Could not place the car in driveway ${d.id}.`);
  // (already across the sidewalk, waiting at the wheel, as the car comes along)
  const at = Math.max(0, geo.sCheck - RV_START_BACK_M), p = geo.path.pointAt(at);
  car.x = p[0]; car.y = p[1]; car.psi = geo.path.headingAt(at) + Math.PI; car.ps = at;
  return { reverserId: car.id, at: geo.q, triggered: true };
}
