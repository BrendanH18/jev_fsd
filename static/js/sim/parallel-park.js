// Parallel parking at the destination. Near the end of a free drive the car looks for an empty, legal
// space in the parking lane on its right, before the destination, that it can see and that is long
// enough for it, and parks there the way every province's driver's handbook teaches: signal, pull up
// alongside the car parked in front of the space, check behind, reverse in on full lock toward the
// kerb, swing the front in on full lock the other way, straighten up and finish parallel to the kerb.
//
// Where it may park (BC Motor Vehicle Act s. 189(1) and s. 190(1); other provinces' rules and city
// bylaws are close to them): not in a junction or on a crosswalk, nor within 6 m of the approach side of
// a crosswalk, a stop sign or a signal (the stop line here), nor in a bus stop zone; on the right, with
// its wheels parallel to the kerb and within 30 cm of it. It never parks on the block of a work zone or
// a double-parked van, or on a street a level crossing is on. (Fire hydrants are not on the map, so
// the 5 m from a hydrant is not checked.) A space is long enough when the car can reverse into it in one
// go, its front corner keeping CLEAR_M from the car in front as it swings in, which `vehicle.spec`
// decides (planSpace): about 1.55 car lengths, so a van or a truck needs more.
//
// The plan (World.park, `ParkPlanner`): the space along its street (`edge`, from `sFrom` to `sTo`, its
// own `s`), a frame laid along the kerb there (`ox`, `oy`, `h`: `u` along it, `w` right of the street's
// centre line), the rear axle's goal (`goalU`, `goalW`: the body KERB_TARGET_M off the kerb, a little
// back from the car in front), and where the car stops to start, alongside the car in front
// (`stopS`, route arc length of the rear axle). The slots of the space are reserved for the car, so
// nobody else parks there, and traffic coming up behind keeps back by `hold` metres from the car's rear
// bumper while it signals and reverses in (sim/npc.js).
//
// The manoeuvre is a law (`kind: "park"`, World.parking) whose fields carry its progress: legs at
// walking pace, each on full lock or straight, the car stopping and turning the wheel before each one.
// Straight to where the S starts (`align`), the S into the space (`in1` on full lock toward the kerb up
// to an angle, `back` straight, `in2` on full lock the other way once that brings it parallel at the
// kerb), `square` legs to straighten up should anything cut a leg short, and `settle` straight forward
// or back to its goal; then `parked`. Pulling out of the space (`mode` "out", planPullOut) is the same
// path backwards. Each leg ends short of
// the kerb (the wheels never touch it; a bumper may reach over it) and CLEAR_M short of anything
// standing still. Moving traffic is left to the prediction and the safety brake. After MAX_LEGS it gives
// up (`stuck`).

import { obbOverlap } from "./collision.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { busZones } from "./bus.js";
import { railIndex } from "./rail.js";

export const PARK_NEAR_M = 60;      // a space whose back is this close to the destination, before it
export const PARK_LOOK_M = 70;      // chosen once the car is this close to where it would park (and can see the space)
export const ROOM_M = 1.7;          // a space shorter than the car's length and this is not looked at further
export const KERB_TARGET_M = 0.15;  // the body aimed this far off the kerb
export const KERB_MAX_M = 0.3;      // BC MVA s. 190(1): wheels within 30 cm of the kerb
export const CLEAR_M = 0.4;         // kept from anything standing still (more than the prediction's 0.3)
const FRONT_GAP_M = 0.9;            // the goal leaves this much in front, where the space allows
const START_SIDE_M = 0.6;           // the car starts this far out from the parked cars' side of the lane line
const START_BACK_M = 0.5;           // and its rear bumper this far behind the car in front's
const LANE_NUDGE_M = 0.6;           // and at most this far right of its lane's centre
const CROSSWALK_APPROACH_M = 6;     // s. 189(1)(f)
const LINE_APPROACH_M = 6;          // s. 189(1)(g)
const CROSSWALK_HALF_M = 1.5;
const CROSS_BEYOND_CURB_M = 1.6;    // a junction's crosswalk centre past the widest street's asphalt (sim/pedestrians.js)
const STRAIGHT_RAD = 0.06;          // the kerb along the space and where the car starts is this straight
const LANE_SIDE_M = 0.2;            // the parking lane's own cars stand at least this far in from its traffic side
const STOP_ROOM_DECEL = 2.0;        // a space is chosen only if the car can stop where it starts at this,
const DROP_DECEL = 3.5;             // and given up once it could not stop there even at this
const SEARCH_S = 0.25;              // looked for again this often
const WAIT_MAX_S = 30;              // waiting at the start this long without starting back, the car gives the space up
export const TRY_START_M = 1.2;     // the car starts once its rear axle is this close to where it stops
const START_MPS = 0.15;
const BEHIND_M = 15;                // anyone moving toward the car within this behind it, or
const BEHIND_S = 4;                 // reaching it this soon, has it wait
const HOLD_EXTRA_M = 1.5;           // traffic behind keeps the reverse's length and this back
const HOLD_FROM_M = 30;             // from when the car's rear axle is this close to where it stops
const VMAX = 0.8, VMIN = 0.15, LEG_DECEL = 0.6;
const PAR_TOL = 2.5 * Math.PI / 180;   // parallel to the kerb to within this
const LAT_TOL = 0.08;
const U_TOL = 0.2;
const ALIGN_M = 0.12;                // the S starts this close to where it should
const STEER_READY_RAD = 3 * Math.PI / 180;
const LEG_MAX_M = 9;
export const MAX_LEGS = 12;
const KERB_OVER_M = 0.25;           // how far a bumper may reach over the kerb
const TYRE_M = 0.1;                 // half a tyre's width: its outer face this far outside the wheel's centre
const OUT_GAP_M = 25;               // pulling out: nobody in the lane coming up behind within this, or
const OUT_GAP_S = 6;                // reaching the car this soon
const OUT_MPS = 3;                  // and the speed it drives on at once out
const LEFT_M = 10;                  // the space is let go once the car is this far from where it parked

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The rear axle's turning radius on full lock.
export const turnRadius = (spec) => spec.wheelbase / Math.tan(spec.maxSteer);

// The car (rear axle) in a plan's frame: along the kerb `u`, right of it `w`, its heading `phi`
// (positive: nose out, away from the kerb).
export function frameOf(vehicle, f) {
  const dx = vehicle.x - f.ox, dy = vehicle.y - f.oy, c = Math.cos(f.h), s = Math.sin(f.h);
  return { u: dx * c + dy * s, w: dx * s - dy * c, phi: wrap(vehicle.psi - f.h) };
}
function fromFrame(f, u, w) {
  const c = Math.cos(f.h), s = Math.sin(f.h);
  return [f.ox + u * c + w * s, f.oy + u * s - w * c];
}

// Where the rear axle is after `d` metres (negative: backwards) on steering angle `steer`.
function poseAfter(vehicle, steer, d) {
  const k = Math.tan(steer) / vehicle.spec.wheelbase;
  if (Math.abs(k) < 1e-6) return { x: vehicle.x + Math.cos(vehicle.psi) * d, y: vehicle.y + Math.sin(vehicle.psi) * d, psi: vehicle.psi };
  const psi = vehicle.psi + k * d;
  return { x: vehicle.x + (Math.sin(psi) - Math.sin(vehicle.psi)) / k, y: vehicle.y - (Math.cos(psi) - Math.cos(vehicle.psi)) / k, psi };
}
function boxAt(pose, spec) {
  const toCentre = spec.length / 2 - spec.rearOverhang;
  return { center: [pose.x + Math.cos(pose.psi) * toCentre, pose.y + Math.sin(pose.psi) * toCentre], heading: pose.psi, halfLength: spec.length / 2, halfWidth: spec.width / 2 };
}
// The body's corners, and the outer faces of its tyres.
function corners(pose, spec) {
  const box = boxAt(pose, spec), c = Math.cos(pose.psi), s = Math.sin(pose.psi);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [box.center[0] + a * box.halfLength * c - b * box.halfWidth * s, box.center[1] + a * box.halfLength * s + b * box.halfWidth * c]);
}
export function tyres(pose, spec) {
  const c = Math.cos(pose.psi), s = Math.sin(pose.psi), side = (spec.track || spec.width - 0.3) / 2 + TYRE_M;
  return [0, spec.wheelbase].flatMap((ax) => [1, -1].map((b) => [pose.x + ax * c - b * side * s, pose.y + ax * s + b * side * c]));
}

// Whether the car can move `d` metres on `steer`: its tyres stay on the asphalt (a bumper may reach
// KERB_OVER_M over the kerb; a corner already further over may only come back), and it stays clear of
// scenery and of anything standing still. Moving traffic is left to the prediction and the safety brake.
export function parkRoom(vehicle, world, steer, d) {
  const spec = vehicle.spec, to = poseAfter(vehicle, steer, d), map = world.map;
  const off = (p) => map.roadDistance(p[0], p[1]).distance;
  const tNow = tyres(vehicle, spec), tTo = tyres(to, spec);
  for (let k = 0; k < tTo.length; k++) if (off(tTo[k]) > 0.01 && off(tTo[k]) > off(tNow[k]) + 0.005) return false;
  const cNow = corners(vehicle, spec), cTo = corners(to, spec);
  for (let k = 0; k < cTo.length; k++) if (off(cTo[k]) > KERB_OVER_M && off(cTo[k]) > off(cNow[k]) + 0.005) return false;
  if (world.staticObstacles?.sweep({ x: vehicle.x, y: vehicle.y, psi: vehicle.psi }, to, spec, CLEAR_M / 2)) return false;
  const box = boxAt(to, spec);
  for (const n of world.obstaclesNear(box.center[0], box.center[1], 8)) {
    if (n === vehicle || n === world.ego || Math.abs(n.v || 0) > 0.5) continue;
    if (obbOverlap(box, n.obb(), CLEAR_M)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------
// Finding a space.

const legalCache = new WeakMap();
// The stretches of edge `e`'s right kerb where a car may park, as [from, to] along it (its own `s`), or
// [] where it may not park at all.
export function legalStretches(map, e) {
  if (!legalCache.has(map)) {
    const railed = new Set();
    for (const c of railIndex(map).crossings) for (const on of c.edges) railed.add(on.edge);
    legalCache.set(map, { railed, edges: new Map() });
  }
  const { railed, edges: cache } = legalCache.get(map);
  if (cache.has(e.id)) return cache.get(e.id);
  let out = [];
  if (e.parking?.[1] > 0 && !e.ring && !railed.has(e.id)) {
    const L = e.cum[e.cum.length - 1];
    const legs = (node) => new Set([...(map.inn.get(node) || []), ...(map.out.get(node) || [])].map((id) => { const o = map.edges.get(id); return o.from === node ? o.to : o.from; })).size;
    const half = (node) => Math.max(0, ...[...(map.inn.get(node) || []), ...(map.out.get(node) || [])].map((id) => { const o = map.edges.get(id); return Math.max(Math.abs(o.asphalt[0]), Math.abs(o.asphalt[1])); }));
    // the junction's crosswalk, from the widest street's asphalt there
    const reach = (node) => legs(node) >= 3 ? half(node) + CROSS_BEYOND_CURB_M + CROSSWALK_HALF_M : 0;
    let lo = reach(e.from), hi = L - (legs(e.to) >= 3 ? reach(e.to) + CROSSWALK_APPROACH_M : 0);
    if (e.control) hi = Math.min(hi, e.control.s_line - LINE_APPROACH_M);
    const cut = [];
    // marked crosswalks between junctions on this street, either way
    for (const c of map.crosswalks || []) {
      const base = map.edges.get(c.edge);
      if (!base || (c.edge !== e.id && !(base.from === e.to && base.to === e.from))) continue;
      const s = projectPoint(e.pts, e.cum, [c.x, c.y]).s;
      cut.push([s - CROSSWALK_HALF_M - CROSSWALK_APPROACH_M, s + CROSSWALK_HALF_M]);
    }
    for (const z of busZones(map).get(e.id) || []) cut.push(z);
    out = subtract([[lo, hi]], cut);
  }
  cache.set(e.id, out);
  return out;
}

// [[a, b], ...] less every [c, d] in `cut`.
function subtract(spans, cut) {
  let out = spans.filter(([a, b]) => b > a);
  for (const [c, d] of cut) {
    const next = [];
    for (const [a, b] of out) {
      if (d <= a || c >= b) { next.push([a, b]); continue; }
      if (c > a) next.push([a, c]);
      if (d < b) next.push([d, b]);
    }
    out = next;
  }
  return out;
}

// What stands in edge `e`'s right parking lane between `a` and `b` (its own `s`): anything not moving
// whose body reaches into it, and spaces another driver has reserved to park in, as [from, to, inner]
// (`inner`: how far right of the street's centre line its side nearest the traffic lane is).
function taken(world, e, a, b) {
  const kerb = e.asphalt[1], inner = kerb - e.parking[1] + LANE_SIDE_M;
  const mid = pointAt(e.pts, e.cum, (a + b) / 2), r = (b - a) / 2 + 8;
  const out = [];
  for (const o of world.obstaclesNear(mid[0], mid[1], r)) {
    if (o === world.ego || Math.abs(o.v || 0) > 0.5 || !o.obb) continue;
    const box = o.obb(), c = Math.cos(box.heading), s = Math.sin(box.heading);
    let s0 = Infinity, s1 = -Infinity, wMax = -Infinity, wMin = Infinity;
    for (const [p, q] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const x = box.center[0] + p * box.halfLength * c - q * box.halfWidth * s, y = box.center[1] + p * box.halfLength * s + q * box.halfWidth * c;
      const pr = projectPoint(e.pts, e.cum, [x, y]);
      s0 = Math.min(s0, pr.s); s1 = Math.max(s1, pr.s); wMax = Math.max(wMax, pr.lateral); wMin = Math.min(wMin, pr.lateral);
    }
    if (wMax > inner && wMin < kerb + 1 && s1 > a - 1 && s0 < b + 1) out.push([s0, s1, wMin]);
  }
  for (const slot of world.parked.slots) {
    if (slot.edge !== e.id || slot.curb !== "right" || !slot.reserved || slot.reserved === world.ego) continue;
    const s = projectPoint(e.pts, e.cum, [slot.x, slot.y]).s, spec = slot.reserved.spec;
    out.push([s - spec.rearOverhang - 0.5, s - spec.rearOverhang + spec.length + 0.5, kerb - e.parking[1] + LANE_SIDE_M]);
  }
  return out;
}

// Whether the edge's kerb is straight from `a` to `b`.
export function straight(e, a, b) {
  const L = e.cum[e.cum.length - 1], h0 = headingAt(e.pts, e.cum, Math.max(0, a));
  for (let s = Math.max(0, a); s <= Math.min(L, b); s += 2) if (Math.abs(wrap(headingAt(e.pts, e.cum, s) - h0)) > STRAIGHT_RAD) return false;
  return true;
}

// The spaces along `route` that the car could park in, with their plans, nearest the destination first:
// on route edges whose route lane is the one beside the right parking lane, before the destination.
export function spacesAlong(world, route, spec, { fromS = 0 } = {}) {
  const map = world.map, out = [];
  const starts = route.laneEdgeStarts();
  const need = spec.length + ROOM_M;
  for (let i = route.edges.length - 1; i >= 0; i--) {
    const e = map.edges.get(route.edges[i]);
    if (!e || starts[i + 1] < route.length - PARK_NEAR_M - 40) break;
    // (never on the block of a work zone or a double-parked van)
    if (world.workZones?.zones.some((z) => z.closed === e.id || z.open === e.id) || world.doubleParked?.vans.some((d) => d.edge === e.id || d.opposite === e.id)) continue;
    const info = route.laneInfo(i);
    if (!e.parking?.[1] || info.idx !== info.lanes - 1) continue;
    // (on the destination's street, a space ends far enough short of the destination for the car to
    // start from alongside it, before the route's end)
    const end = i === route.edges.length - 1 ? projectPoint(e.pts, e.cum, route.endPoint()) : null;
    const last = end && end.distance < 8 ? end.s - spec.rearOverhang + START_BACK_M - 1.6 : Infinity;
    for (const [a, b] of legalStretches(map, e)) {
      if (b - a < need) continue;
      const spans = taken(world, e, a, b);
      for (const [fa, fb0] of subtract([[a, b]], spans)) {
        const fb = Math.min(fb0, last);
        if (fb - fa < need) continue;
        const plan = planSpace(world, route, e, fa, fb, spec, spans);
        if (plan && plan.stopS > fromS) out.push(plan);
      }
    }
  }
  return out.sort((x, y) => y.goalS - x.goalS);
}

// The plan for the space [a, b] along edge `e` (`spans`: what stands in its parking lane), or null where
// the car could not reverse into it in one go, or would end past the destination or too far before it.
function planSpace(world, route, e, a, b, spec, spans) {
  const kerb = e.asphalt[1], R = turnRadius(spec), FRONT = spec.length - spec.rearOverhang;
  const goalW = kerb - KERB_TARGET_M - spec.width / 2;
  // where the car starts: alongside the car in front, its rear bumper START_BACK_M behind that car's (so
  // that its rear corner, swinging in, keeps clear of that car's), START_SIDE_M out from its side or the
  // parking lane's line, whichever is further out (a little right of its lane's centre, as far as
  // LANE_NUDGE_M)
  const lanePt = projectPoint(route.pts, route.cum, pointAt(e.pts, e.cum, b));
  if (!lanePt || lanePt.distance > 8) return null;
  // (the route's line beside the space: how far right of the street's centre line the lane's centre is)
  const laneW = projectPoint(e.pts, e.cum, lanePt.point).lateral;
  const front = spans.filter((sp) => sp[0] >= b - 0.1).sort((x, y) => x[0] - y[0])[0];
  const side = Math.min(kerb - e.parking[1], front ? front[2] : Infinity);
  const startW = Math.max(laneW, Math.min(laneW + LANE_NUDGE_M, side - START_SIDE_M - spec.width / 2));
  const startU = b + spec.rearOverhang - START_BACK_M;
  // Swinging in on the last arc, about a point R left of the rear axle, the car's outer front corner
  // keeps CLEAR_M from the inner rear corner of whatever is in front of the space: the S ends at least
  // `clip` behind it. A longer space ends the S where two arcs alone take it, and the car then drives
  // forward to its goal, FRONT_GAP_M short of the car in front.
  const reach = Math.hypot(FRONT, R + spec.width / 2) + CLEAR_M, apart = front ? front[2] - (goalW - R) : Infinity;
  const clip = apart >= reach ? 0 : Math.sqrt(reach * reach - apart * apart);
  const s = solveS(R, Infinity, goalW - startW);
  const endU = Math.min(b - clip, startU - s.X);
  // (room for the S behind, CLEAR_M from what is behind the space)
  if (endU - spec.rearOverhang < a + CLEAR_M - 0.05) return null;
  const S = solveS(R, startU - endU, goalW - startW);
  const frontGap = Math.min(FRONT_GAP_M, (b - a - spec.length) / 2);
  const goalU = Math.max(endU, b - frontGap - FRONT);
  if (!straight(e, a - 2, startU + spec.length)) return null;
  // the frame: along the street's straight line through the space, `u` its own `s` there
  const h = headingAt(e.pts, e.cum, a), pa = pointAt(e.pts, e.cum, a);
  const f = { ox: pa[0] - Math.cos(h) * a, oy: pa[1] - Math.sin(h) * a, h };
  const goal = fromFrame(f, goalU, goalW), start = fromFrame(f, startU, startW);
  const gp = projectPoint(route.pts, route.cum, goal), sp = projectPoint(route.pts, route.cum, start);
  if (!gp || !sp || sp.distance > LANE_NUDGE_M + 1) return null;
  const goalS = gp.s, stopS = sp.s;
  // (it ends before the destination, near it, and starts before the route's end)
  if (goalS - spec.rearOverhang < route.length - PARK_NEAR_M || stopS > route.length - 1.5 || goalS + FRONT > route.length + 2) return null;
  // the space's slots, to reserve
  const slots = world.parked.slots.filter((slot) => {
    if (slot.edge !== e.id || slot.curb !== "right") return false;
    const u = projectPoint(e.pts, e.cum, [slot.x, slot.y]).s;
    return u > a - 3 && u < b + 1;
  });
  return {
    id: `space:${e.id}@${Math.round(a * 10) / 10}`, edge: e.id, sFrom: a, sTo: b, length: b - a,
    ...f, kerbW: kerb, goalU, goalW, laneW, startU, startW, nudge: startW - laneW, endU, phi1: S.phi1, X: startU - endU, R, goalS, stopS, slots,
    hold: startU - endU + HOLD_EXTRA_M,
  };
}

// Reversing in, parallel at both ends, from `D` metres out from the kerb (rear axle): full lock toward
// the kerb up to `phi1`, straight back, full lock the other way until parallel again. The two arcs alone
// take the car back `X` (the least); going back further, a straight between them, at a smaller angle
// (no smaller than MIN_PHI). With `X` Infinity, the least.
const MIN_PHI = 12 * Math.PI / 180;
export function solveS(R, X, D) {
  const pure = Math.acos(Math.max(-1, 1 - D / (2 * R)));
  const least = 2 * R * Math.sin(pure);
  if (!Number.isFinite(X) || X <= least + 0.01) return { phi1: pure, X: least, d: 0 };
  const along = (p) => 2 * R * Math.sin(p) + (D - 2 * R * (1 - Math.cos(p))) / Math.tan(p);
  let lo = MIN_PHI, hi = pure;
  if (along(lo) <= X) return { phi1: lo, X: along(lo), d: (D - 2 * R * (1 - Math.cos(lo))) / Math.sin(lo) };
  for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (along(mid) > X) lo = mid; else hi = mid; }
  const p = (lo + hi) / 2;
  return { phi1: p, X: along(p), d: (D - 2 * R * (1 - Math.cos(p))) / Math.sin(p) };
}

// Whether the car can see the space: its middle and both ends, in the parking lane.
function seen(world, plan) {
  const w = plan.kerbW - 1.2;
  return [plan.sFrom + 0.5, (plan.sFrom + plan.sTo) / 2, plan.sTo - 0.5].every((u) => world.visibility.canSee(world.ego, ...fromFrame(plan, u, w)));
}

// Whether the space is still free.
function stillFree(world, plan) {
  const e = world.map.edges.get(plan.edge);
  return taken(world, e, plan.sFrom, plan.sTo).every(([c, d]) => d <= plan.sFrom + 0.05 || c >= plan.sTo - 0.05);
}

function reserve(world, plan, on) {
  for (const slot of plan.slots) {
    if (on && !slot.reserved && !slot.occupant) slot.reserved = world.ego;
    else if (!on && slot.reserved === world.ego) slot.reserved = null;
  }
}

// Who keeps the car from starting to reverse in: anything standing in the way back (traffic stopped
// close behind it, say), or moving toward it from behind, near or soon. Returns their id, or null.
export function blockerBehind(world, plan) {
  const ego = world.ego, spec = ego.spec;
  for (const o of world.visibleObstaclesNear(ego.x, ego.y, BEHIND_M + plan.X + 10)) {
    if (o === ego || o.parked) continue;
    const l = ego.toLocal(o.x, o.y), os = o.spec || spec;
    // its front, behind the car's rear bumper
    const gap = -l.ahead - spec.rearOverhang - (os.length - os.rearOverhang);
    if (l.ahead > spec.length || Math.abs(l.right) > 4.5 || gap > BEHIND_M + plan.X) continue;
    const closing = (o.v || 0) * Math.cos(wrap(o.psi - ego.psi));
    // in the way back, in the lane or the space (standing there, or still backing up out of it)
    if (gap < plan.hold && l.right > -2.2) return o.id;
    // coming up behind, in the lane or the parking lane
    if (closing > 0.3 && l.right > -2.2 && (gap < BEHIND_M || gap / closing < BEHIND_S)) return o.id;
  }
  return null;
}

// Who keeps the car from pulling out of the space it is parked in: traffic coming up the lane beside it
// from behind, near or soon, or anyone standing in the way out. Returns their id, or null.
export function blockerOut(world, spot) {
  const ego = world.ego, spec = ego.spec;
  for (const o of world.visibleObstaclesNear(ego.x, ego.y, 70)) {
    if (o === ego || o.parked) continue;
    const l = ego.toLocal(o.x, o.y), os = o.spec || spec;
    const d = wrap((o.psi || 0) - ego.psi);
    // (in the lane beside the car: the lane it pulls out into)
    const lane = l.right < -0.5 && l.right > -(spot.kerbW - spot.laneW) - 2.5;
    if (!lane) continue;
    const gap = -l.ahead - spec.rearOverhang - (os.length - os.rearOverhang);
    if (Math.abs(l.ahead) < spec.length + 4 && Math.abs(o.v || 0) < 0.5 && gap < 2) return o.id;
    const closing = (o.v || 0) * Math.cos(d);
    if (Math.abs(d) < Math.PI / 3 && closing > 0.3 && gap > -spec.length && (gap < OUT_GAP_M || gap / closing < OUT_GAP_S)) return o.id;
  }
  return null;
}

// Keeps World.park up to date while the autopilot drives: looks for a space near the destination, and
// keeps it while it is free and the car can still stop where it starts; gives it up after waiting too
// long, or once the manoeuvre is stuck. `status` says where things stand: "approach", "waiting",
// "parking", "parked" or "stuck", or "none" once there is no space to be had (the car stops in its lane
// at the destination, as without parking). Parked (World.parkedIn), a new drive starts by pulling out
// (`mode` "out": "waiting", then "leaving").
export class ParkPlanner {
  constructor() { this.at = -Infinity; }

  update(world, routeS, dt) {
    const route = world.route, ego = world.ego;
    if (!route) { this.clear(world); return null; }
    const law = world.parking;
    // pulling out of the space it is parked in, before anything else
    const spot = world.parkedIn;
    if (spot || law?.mode === "out") {
      let plan = world.park;
      if (plan?.mode !== "out") plan = world.park = { mode: "out", id: `${spot.id}:out`, status: "waiting", blocked: null, route, kerbW: spot.kerbW, laneW: spot.laneW };
      const going = law?.mode === "out" && law.phase !== "out_back" && law.phase !== "out_wait";
      plan.blocked = going ? null : blockerOut(world, spot || law);
      plan.status = going ? "leaving" : "waiting";
      if (law?.mode === "out") law.go = !plan.blocked;
      world.parkHold = 0;
      return plan;
    }
    if (!world.parkAtGoal) { this.clear(world); return null; }
    if (law) {
      const plan = world.park;
      plan.status = law.phase === "parked" ? "parked" : law.phase === "stuck" ? "stuck" : "parking";
      world.parkHold = law.phase === "parked" || law.phase === "stuck" ? 0 : plan.hold;
      return plan;
    }
    if (world.park && world.park.route !== route) this.clear(world);
    const remaining = route.length - routeS;
    if (remaining > PARK_NEAR_M + PARK_LOOK_M + 20) { world.parkHold = 0; return null; }
    let plan = world.park;
    if (plan?.status === "none") return plan;
    if (plan && world.t - this.at >= SEARCH_S) {
      this.at = world.t;
      const toStop = plan.stopS - routeS;
      const canStop = toStop > -TRY_START_M && (toStop < 1 || toStop > ego.v * ego.v / (2 * DROP_DECEL) - 0.5);
      if (!canStop || !stillFree(world, plan)) { (world.parkTried ||= []).push(plan.id); reserve(world, plan, false); plan = world.park = null; }
    }
    if (!plan && world.t - this.at >= SEARCH_S) {
      this.at = world.t;
      // (room to stop where it starts, or already standing there)
      const room = (p) => p.stopS - routeS > ego.v * ego.v / (2 * STOP_ROOM_DECEL) + 1 || (Math.abs(p.stopS - routeS) < TRY_START_M && Math.abs(ego.v) < START_MPS);
      const tried = new Set(world.parkTried || []);
      const all = spacesAlong(world, route, ego.spec, { fromS: routeS - TRY_START_M }).filter((p) => !tried.has(p.id) && room(p));
      const options = all.filter((p) => p.goalS - routeS < PARK_LOOK_M && seen(world, p));
      if (options.length) {
        plan = world.park = { ...options[0], mode: "in", route, status: "approach", waited: 0, blocked: null };
        reserve(world, plan, true);
      } else if (!all.length && remaining < PARK_NEAR_M) {
        // nowhere left that it could still stop for
        world.park = { status: "none", route };
      }
    }
    plan = world.park;
    if (!plan || plan.status === "none") { world.parkHold = 0; return plan; }
    const toStop = plan.stopS - routeS;
    const atStart = Math.abs(toStop) < TRY_START_M && Math.abs(ego.v) < START_MPS;
    plan.blocked = atStart ? blockerBehind(world, plan) : null;
    plan.status = atStart ? "waiting" : "approach";
    // (waiting there, for whatever reason: a driver that never reverses in gives the space up too)
    if (atStart) plan.waited += dt;
    if (plan.waited > WAIT_MAX_S) {
      (world.parkTried ||= []).push(plan.id);
      reserve(world, plan, false);
      world.park = { status: "none", route };
      world.parkHold = 0;
      return world.park;
    }
    world.parkHold = toStop < HOLD_FROM_M ? plan.hold : 0;
    return plan;
  }

  // Parked: the space stays reserved for the car while it stands there (World.audit lets it go once
  // the car has left), and the next drive starts by pulling out of it.
  park(world, parked) {
    const p = world.park;
    if (p?.mode === "in" && !parked) reserve(world, p, false);
    if (p?.mode === "in" && parked) world.parkedIn = { id: p.id, edge: p.edge, ox: p.ox, oy: p.oy, h: p.h, kerbW: p.kerbW, laneW: p.laneW, startW: p.startW, endU: p.endU, goalU: p.goalU, phi1: p.phi1, R: p.R, sFrom: p.sFrom, sTo: p.sTo, slots: p.slots, at: [world.ego.x, world.ego.y] };
    world.park = null; world.parking = null; world.parkHold = 0; world.parkTried = [];
  }

  clear(world) {
    if (world.park?.slots && world.park.mode === "in") reserve(world, world.park, false);
    world.park = null; world.parking = null; world.parkHold = 0; world.parkTried = [];
  }
}

// Releases the space the car parked in once it has left it (called every step, World.audit).
export function leftSpace(world) {
  const spot = world.parkedIn;
  if (!spot || Math.hypot(world.ego.x - spot.at[0], world.ego.y - spot.at[1]) < LEFT_M) return;
  for (const slot of spot.slots) if (slot.reserved === world.ego) slot.reserved = null;
  world.parkedIn = null;
}

// A fresh manoeuvre for plan `p`.
export function planParking(p) {
  return {
    kind: "park", mode: "in", id: p.id, ox: p.ox, oy: p.oy, h: p.h, goalU: p.goalU, goalW: p.goalW, kerbW: p.kerbW, R: p.R, phi1: p.phi1, startU: p.startU,
    backU: p.sFrom, frontU: p.sTo, phase: "start", dir: -1, steer: 0, legs: 0, travelled: 0, idle: 0, sign: 0, vTarget: 0,
  };
}

// Pulling out of the space the car is parked in (World.parkedIn): the way it came in, backwards. Straight
// back to where the S into it ended, then, once nothing is coming up the lane (`go`, set by the
// planner), full lock out, straight, and full lock back until it is parallel in the lane; then it
// follows its lane like any lane law (`done`).
export function planPullOut(spot) {
  return {
    kind: "park", mode: "out", id: `${spot.id}:out`, ox: spot.ox, oy: spot.oy, h: spot.h, kerbW: spot.kerbW, laneW: spot.laneW, startW: spot.startW, endU: spot.endU,
    R: spot.R, phi1: spot.phi1, backU: spot.sFrom, frontU: spot.sTo, phase: "out_back", dir: -1, steer: 0, legs: 0, travelled: 0, idle: 0, sign: 0, go: false,
    offset: 0, vTarget: OUT_MPS,
  };
}

// Whether the law's current leg moves the car backward.
export const reversing = (law) => law?.kind === "park" && law.dir < 0 && !["parked", "stuck", "start", "out_wait", "done"].includes(law.phase);

// The next leg, chosen with the car standing still at the end of the last one.
function nextLeg(vehicle, law, world) {
  const { u, w, phi } = frameOf(vehicle, law);
  const errW = law.goalW - w, spec = vehicle.spec;
  const can = (dir, steer) => parkRoom(vehicle, world, steer * spec.maxSteer, dir * 0.3);
  const first = law.phase === "start" || law.phase === "align";
  law.travelled = 0;
  if (!first) law.legs++;
  if (law.legs > MAX_LEGS) { law.phase = "stuck"; return; }
  // first, straight to where the S starts, its rear bumper level with the car in front's (stopping
  // there in the lane is never quite exact)
  if (law.phase === "start" && Math.abs(u - law.startU) > ALIGN_M && Math.abs(phi) <= PAR_TOL && can(Math.sign(law.startU - u), 0)) {
    Object.assign(law, { phase: "align", dir: Math.sign(law.startU - u), steer: 0 });
    return;
  }
  if (Math.abs(phi) <= PAR_TOL && errW <= LAT_TOL) {
    // parallel, at the kerb: on to the goal, straight, unless it is close enough
    const du = law.goalU - u;
    if (Math.abs(du) <= U_TOL || !can(Math.sign(du), 0)) { law.phase = "parked"; return; }
    Object.assign(law, { phase: "settle", dir: Math.sign(du), steer: 0 });
    return;
  }
  if (Math.abs(phi) <= PAR_TOL) {
    // parallel, out from the kerb: an S toward it, back (as from the start) or, without the room
    // behind, forward
    const behind = u - spec.rearOverhang - law.backU - CLEAR_M, ahead = law.frontU - CLEAR_M - (u + spec.length - spec.rearOverhang);
    const S = solveS(law.R, Infinity, errW);
    const dir = first || behind >= S.X || behind >= ahead ? -1 : 1;
    const phi1 = first ? law.phi1 : S.phi1;
    if (can(dir, -1)) { Object.assign(law, { phase: "in1", dir, steer: -1, target: phi1 }); return; }
    if (!first && can(-dir, -1)) { Object.assign(law, { phase: "in1", dir: -dir, steer: -1, target: S.phi1 }); return; }
    law.phase = errW < KERB_MAX_M - KERB_TARGET_M ? "parked" : "stuck";
    return;
  }
  // at an angle: square up, gaining on the kerb where it can
  const gain = phi > 0 ? { dir: -1, steer: 1 } : { dir: 1, steer: 1 };
  const lose = phi > 0 ? { dir: 1, steer: -1 } : { dir: -1, steer: -1 };
  const [one, two] = errW > LAT_TOL ? [gain, lose] : [lose, gain];
  const leg = can(one.dir, one.steer) ? one : can(two.dir, two.steer) ? two : null;
  if (!leg) { law.phase = "stuck"; return; }
  Object.assign(law, { phase: "square", ...leg, sign: Math.sign(phi) });
}

// How far the current leg has still to go (metres of travel), or <= 0 once it is over. The S's first
// arc goes to its angle (`target`), or less where that already brings the car parallel at the kerb on
// its second arc; the straight between them, until it does.
function remaining(vehicle, law) {
  const { u, w, phi } = frameOf(vehicle, law);
  const errW = law.goalW - w, a = Math.abs(phi);
  const toArc2 = errW - law.R * (1 - Math.cos(a));
  if (law.phase === "in1") return Math.min(law.R * (law.target - a), toArc2 / Math.max(0.15, 2 * Math.sin(a)));
  if (law.phase === "back") return toArc2 / Math.max(0.05, Math.sin(a));
  if (law.phase === "in2" || law.phase === "square") {
    // (until it is parallel, or has swung past it)
    if (law.sign && Math.sign(phi) !== law.sign) return 0;
    return a <= PAR_TOL / 4 ? 0 : law.R * a;
  }
  if (law.phase === "settle") return (law.goalU - u) * law.dir - U_TOL / 4;
  if (law.phase === "align") return (law.startU - u) * law.dir - 0.03;
  return 0;
}

// One physics step of the manoeuvre. Always returns true (it never hands back to the lane).
export function stepParking(vehicle, law, world, dt, speedControl) {
  const spec = vehicle.spec, v = Math.abs(vehicle.v);
  law.idle = v < 0.05 ? (law.idle || 0) + dt : 0;
  const hold = (steer) => vehicle.step(dt, { steer, accel: speedControl(vehicle.v, 0, { gain: 4, maxBrake: 3 }), reverse: vehicle.v < 0 });
  if (law.mode === "out") return stepOut(vehicle, law, world, dt, speedControl, hold);
  if (law.phase === "start") {
    if (v > 0.05) { hold(vehicle.delta); return true; }
    nextLeg(vehicle, law, world);
  }
  if (law.phase === "parked" || law.phase === "stuck") { hold(vehicle.delta); return true; }
  const steer = law.steer * spec.maxSteer;
  const left = remaining(vehicle, law);
  const look = 0.2 + v * v / (2 * LEG_DECEL);
  const room = parkRoom(vehicle, world, steer, law.dir * look);
  if (left <= 0 || !room || law.travelled > LEG_MAX_M) {
    hold(steer);
    if (Math.abs(vehicle.v) < 0.03) {
      vehicle.v = 0;
      // the S's first arc runs into the straight or its second arc, and the straight into the arc
      const f = frameOf(vehicle, law), toArc2 = law.goalW - f.w - law.R * (1 - Math.cos(Math.abs(f.phi)));
      if (room && law.phase === "in1") Object.assign(law, toArc2 > 0.02 ? { phase: "back", steer: 0, travelled: 0 } : { phase: "in2", steer: 1, travelled: 0, sign: Math.sign(f.phi) });
      else if (room && law.phase === "back") Object.assign(law, { phase: "in2", steer: 1, travelled: 0, sign: Math.sign(f.phi) });
      else nextLeg(vehicle, law, world);
    }
    return true;
  }
  const ready = Math.abs(vehicle.delta - steer) < STEER_READY_RAD || v > 0.1;
  const speed = Math.max(VMIN, Math.min(VMAX, Math.sqrt(2 * LEG_DECEL * Math.max(0, left - 0.03))));
  vehicle.step(dt, { steer, accel: speedControl(vehicle.v, ready ? law.dir * speed : 0, { gain: 4, maxAccel: 1.2, maxBrake: 3 }), reverse: law.dir < 0 });
  law.travelled += Math.abs(vehicle.v) * dt;
  return true;
}

// One physics step of pulling out (see planPullOut). Returns false once it is out (`done`), when the
// lane law takes over.
function stepOut(vehicle, law, world, dt, speedControl, hold) {
  if (law.phase === "done") return false;
  const spec = vehicle.spec, v = Math.abs(vehicle.v), f = frameOf(vehicle, law), a = Math.abs(f.phi);
  // how far it has still to move out, and how much of that the last arc makes
  const toArc = f.w - law.startW - law.R * (1 - Math.cos(a));
  if (law.phase === "out_wait") {
    hold(spec.maxSteer);
    if (law.go && v < 0.03) Object.assign(law, { phase: "out1", dir: 1, steer: 1, travelled: 0 });
    return true;
  }
  const leg = { out_back: [-1, 0, f.u - law.endU - 0.05], out1: [1, 1, Math.min(law.R * (law.phi1 - a), toArc / Math.max(0.15, 2 * Math.sin(a)))],
    out2: [1, 0, toArc / Math.max(0.05, Math.sin(a))], out3: [1, -1, f.phi <= PAR_TOL / 4 ? 0 : law.R * a] }[law.phase];
  if (!leg) { hold(vehicle.delta); return true; }
  const [dir, turn, left] = leg, steer = turn * spec.maxSteer;
  Object.assign(law, { dir, steer: turn });
  const room = parkRoom(vehicle, world, steer, dir * (0.2 + v * v / (2 * LEG_DECEL)));
  if (left <= 0 || !room || law.travelled > LEG_MAX_M) {
    hold(steer);
    if (Math.abs(vehicle.v) < 0.03) {
      vehicle.v = 0;
      law.travelled = 0;
      if (law.phase === "out_back") law.phase = "out_wait";
      else if (!room) law.phase = "stuck";
      else if (law.phase === "out1") law.phase = toArc > 0.02 ? "out2" : "out3";
      else if (law.phase === "out2") law.phase = "out3";
      else law.phase = "done";
    }
    return true;
  }
  const ready = Math.abs(vehicle.delta - steer) < STEER_READY_RAD || v > 0.1;
  const speed = Math.max(VMIN, Math.min(VMAX, Math.sqrt(2 * LEG_DECEL * Math.max(0, left - 0.03))));
  vehicle.step(dt, { steer, accel: speedControl(vehicle.v, ready ? dir * speed : 0, { gain: 4, maxAccel: 1.2, maxBrake: 3 }), reverse: dir < 0 });
  law.travelled += Math.abs(vehicle.v) * dt;
  return true;
}

// How the car stands once parked (or wherever it is in the space): its right tyres' distance from
// the kerb (negative: on it), how far from parallel it is (degrees), and the room in front and behind.
export function parkedPose(vehicle, plan, world) {
  const spec = vehicle.spec, f = frameOf(vehicle, plan);
  const right = tyres(vehicle, spec).filter((_, k) => k % 2 === 1);
  const kerb = Math.min(...right.map((p) => plan.kerbW - frameOf({ x: p[0], y: p[1], psi: 0 }, plan).w));
  return { kerb_m: Math.round(kerb * 100) / 100, angle_deg: Math.round(Math.abs(f.phi) * 180 / Math.PI * 10) / 10,
    within_kerb: kerb >= -0.01 && kerb <= KERB_MAX_M + 0.005 && Math.abs(f.phi) < 4 * Math.PI / 180 };
}

// The HUD line for the car's parking, or null.
export function parkNotice(world) {
  const p = world.park;
  if (!p || p.status === "none" || !p.id) return null;
  if (p.mode === "out") return p.status === "leaving" ? { key: `${p.id}:leaving`, text: "PULLING OUT" } : p.blocked ? { key: `${p.id}:wait`, wait: true, text: "PULLING OUT · TRAFFIC COMING · WAIT" } : { key: `${p.id}:clear`, text: "PULLING OUT · SIGNAL LEFT · CLEAR" };
  if (p.status === "approach") return { key: `${p.id}:approach`, text: "PARKING SPACE AHEAD · SIGNAL RIGHT · PULL UP ALONGSIDE THE CAR IN FRONT" };
  if (p.status === "waiting") return p.blocked ? { key: `${p.id}:wait`, wait: true, text: "PARKING · CHECKING BEHIND · WAIT" } : { key: `${p.id}:clear`, text: "PARKING · CLEAR BEHIND · REVERSE IN" };
  if (p.status === "parking") return { key: `${p.id}:parking`, text: "PARKING · REVERSING IN" };
  if (p.status === "parked") return { key: `${p.id}:parked`, text: "PARKED" };
  return null;
}
