// Marked crosswalks between junctions (`map.crosswalks`, built by jev/osm/crossings.py; the crowd
// in sim/pedestrians.js crosses at them), and the rule that goes with them.
//
// A driver must not overtake and pass a vehicle that is slowing down or stopped at a crosswalk to
// let a pedestrian cross (BC Motor Vehicle Act s. 179(3)): the vehicle can hide the very person it
// stopped for, who walks out from in front of it into the next lane (the "multiple threat"). Here a
// vehicle in traffic (not a cyclist, not parked) is stopped at a marked crosswalk when its front is
// within STOPPED_AT_M short of the crosswalk's centre (or up to 1 m into it) and it moves slower
// than STOPPED_MPS. A driver coming up behind it in another lane going the same way, still behind
// it, stops with its front HOLD_M short of the crosswalk's centre, if it could do that braking at no
// more than OWED_DECEL when the vehicle was first seen stopped there. Once it has stood still there
// for LOOK_S it may go on: it can see past the vehicle by then, and anyone crossing in its own path
// is given way to as usual.
//
// Road vehicles also hide people: a pedestrian is out of a driver's sight when every line from the
// driver to them passes through the body of a vehicle in traffic (`hiddenByTraffic`). Cyclists do
// not hide anyone, nor do parked cars, except with hidden hazards on (sim/hidden-hazards.js), when
// the vehicles standing at the kerb (`standing`) hide people too.

import { CAR } from "./vehicle.js";

export const STOPPED_AT_M = 8;
export const STOPPED_MPS = 3;
export const HOLD_M = 3.5;
export const OWED_DECEL = 3.5;
export const LOOK_S = 2;
const AT_CROSSWALK_M = HOLD_M + 2;   // a car whose front is this close short of the centre is at it
const SAME_WAY = Math.PI / 6;
const OTHER_LANE_M = 2;              // a vehicle this far to one side of the car is in another lane
const BESIDE_M = 3;                  // (a car that stops level with it, or a little past, has not passed it)
const HIDE_RANGE_M = 80;          // (the farthest anyone sees, in clear daylight)
const PROBE_M = 0.3;                 // a person is seen if any of their middle or sides is in view

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const frontOf = (v) => (v.spec || CAR).length - (v.spec || CAR).rearOverhang;

// Where the line from p in direction (ux, uy) crosses crosswalk `cw` (sidewalk end to sidewalk end):
// the distance along that line, or null if it misses.
export function distanceTo(cw, p, ux, uy) {
  const a = cw.ends[1], b = cw.ends[-1];
  const sx = b[0] - a[0], sy = b[1] - a[1];
  const den = ux * sy - uy * sx;
  if (Math.abs(den) < 1e-9) return null;
  const wx = a[0] - p[0], wy = a[1] - p[1];
  const t = (wx * sy - wy * sx) / den, u = (wx * uy - wy * ux) / den;
  return u >= 0 && u <= 1 ? t : null;
}

// How far a vehicle's front is short of crosswalk `cw`'s centre, along its heading (negative: past
// it), or null when it is not heading across it.
export function frontTo(cw, v) {
  const [fx, fy] = v.front || [v.x, v.y];
  return distanceTo(cw, [fx, fy], Math.cos(v.psi), Math.sin(v.psi));
}

// Vehicles stopped at crosswalk `cw` that `car` would pass: in another lane going its way, not yet
// passed (their fronts no more than BESIDE_M behind its front; or anywhere beside it, with `ahead`
// false). `vehicles` defaults to all traffic.
export function stoppedAt(world, cw, car, vehicles = world.npcs, ahead = true) {
  const out = [];
  for (const n of vehicles) {
    if (n === car || n.kind === "bike" || n.kind === "pedestrian" || n.parked || Math.abs(n.v) >= STOPPED_MPS) continue;
    if (Math.abs(wrap(n.psi - car.psi)) > SAME_WAY) continue;
    const d = frontTo(cw, n);
    if (d === null || d > STOPPED_AT_M || d < -1) continue;
    const local = car.toLocal(...(n.front || [n.x, n.y]));
    if (Math.abs(local.right) < OTHER_LANE_M || (ahead && local.ahead - frontOf(car) < -BESIDE_M)) continue;
    out.push(n);
  }
  return out;
}

// The marked crosswalks a route crosses, with the route arc length where it crosses each (cached).
const along = new WeakMap();
export function crosswalksAlong(route, crowd) {
  if (!route || !crowd?.marked?.length) return [];
  let list = along.get(route);
  if (list && list.crowd === crowd.marked) return list.items;
  const items = [];
  for (const cw of crowd.marked) {
    const a = cw.ends[1], b = cw.ends[-1];
    for (let i = 0; i < route.pts.length - 1; i++) {
      const p = route.pts[i], q = route.pts[i + 1];
      const len = route.cum[i + 1] - route.cum[i];
      if (len <= 0) continue;
      const t = distanceTo(cw, p, (q[0] - p[0]) / len, (q[1] - p[1]) / len);
      if (t !== null && t >= 0 && t <= len) { items.push({ cw, s: route.cum[i] + t }); break; }
    }
  }
  items.sort((x, y) => x.s - y.s);
  along.set(route, { crowd: crowd.marked, items });
  return items;
}

// Remembers where the car has stood still at a marked crosswalk ({ id, since, done }), for LOOK_S:
// called every tick (World.audit). A stop it moves off before LOOK_S is over does not count; one that
// lasted is kept (`done`) until its front is past the crosswalk or it moves away.
export function noteStop(world) {
  const car = world.ego, marked = world.crowd?.marked;
  if (!marked?.length) { world.crosswalkStop = null; return; }
  const kept = world.crosswalkStop && marked.find((c) => c.id === world.crosswalkStop.id);
  const d = kept ? frontTo(kept, car) : null;
  if (!kept || d === null || d < -1 || d > AT_CROSSWALK_M + 1) world.crosswalkStop = null;
  const stop = world.crosswalkStop;
  if (Math.abs(car.v) > 0.3) {
    if (stop && !stop.done) {
      if (world.t - stop.since >= LOOK_S) stop.done = true;
      else world.crosswalkStop = null;
    }
    return;
  }
  if (stop) return;
  for (const cw of marked) {
    if (Math.abs(cw.ends[1][0] - car.x) > 40 || Math.abs(cw.ends[1][1] - car.y) > 40) continue;
    const at = frontTo(cw, car);
    if (at !== null && at >= -1 && at <= AT_CROSSWALK_M) { world.crosswalkStop = { id: cw.id, since: world.t, done: false }; return; }
  }
}

// The car has stood still at crosswalk `cw` long enough to look past whatever is stopped there.
export const looked = (world, cw) => world.crosswalkStop?.id === cw.id && world.t - world.crosswalkStop.since >= LOOK_S;

// Could the car, at speed v, stop with its front HOLD_M short of a crosswalk `toCentre` metres ahead?
export const canStopShort = (v, toCentre) => toCentre - HOLD_M >= Math.max(0, v) ** 2 / (2 * OWED_DECEL);

// True when every line of sight from `observer` to pedestrian `ped` passes through the body of a
// road vehicle in traffic (`vehicles`: not cyclists, not parked).
export function hiddenByTraffic(observer, ped, vehicles, standing = []) {
  const dx = ped.x - observer.x, dy = ped.y - observer.y, d = Math.hypot(dx, dy);
  if (d < 1 || d > HIDE_RANGE_M) return false;
  const nx = -dy / d, ny = dx / d;
  const near = vehicles.filter((v) => v !== observer && v.kind !== "bike" && v.kind !== "pedestrian" && !v.parked
    && Math.abs(v.x - observer.x) < HIDE_RANGE_M + 10 && Math.abs(v.y - observer.y) < HIDE_RANGE_M + 10)
    .concat(standing.filter((v) => v !== observer));
  if (!near.length) return false;
  for (const k of [0, 1, -1]) {
    const to = [ped.x + nx * PROBE_M * k, ped.y + ny * PROBE_M * k];
    if (!near.some((v) => segmentHitsBox([observer.x, observer.y], to, v.obb()))) return false;
  }
  return true;
}

// Does segment a-b pass through box (an OBB)? Liang–Barsky in the box's frame.
function segmentHitsBox(a, b, box) {
  const c = Math.cos(box.heading), s = Math.sin(box.heading);
  const loc = (p) => { const x = p[0] - box.center[0], y = p[1] - box.center[1]; return [x * c + y * s, -x * s + y * c]; };
  const p = loc(a), q = loc(b);
  let lo = 0, hi = 1;
  for (let axis = 0; axis < 2; axis++) {
    const half = axis === 0 ? box.halfLength : box.halfWidth, d = q[axis] - p[axis];
    if (Math.abs(d) < 1e-12) { if (Math.abs(p[axis]) > half) return false; continue; }
    const t0 = (-half - p[axis]) / d, t1 = (half - p[axis]) / d;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return false;
  }
  return true;
}
