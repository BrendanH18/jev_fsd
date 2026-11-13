// Reserved curb lanes. Cars may enter for a right turn in the last 50 m,
// or for the actual curb parking/pull-out manoeuvre. No random draws.
// A right turn into a street ends in its curb lane (BC MVA s. 165: as close as practicable to the
// right-hand curb); where that lane is reserved, the car leaves it at once, and the lane change out is
// not driving in it.
import { laneChangeLength } from "./controller.js";
export const BUS_TURN_M = 50;
export function busLaneActive(lane, clock) {
  if (!clock || !Number.isFinite(clock.hour)) return false;
  if (!lane.hours) return true;
  const minute = clock.hour * 60, day = clock.weekday ?? 0; // (Monday = 0; drive clocks default to Monday)
  return lane.hours.some(w => w.start <= w.end
    ? w.days.includes(day) && minute >= w.start && minute < w.end
    : (w.days.includes(day) && minute >= w.start) || (w.days.includes((day + 6) % 7) && minute < w.end));
}
export function reservedLane(map, edge, index, clock, kind = 'car') {
  return (map.buslanes || []).find(l => l.edge === edge && l.lane === index && busLaneActive(l, clock)
    && !l.allowed.includes(kind === 'bike' ? 'bicycle' : kind));
}
export function legalBusLane(map, edge, index, clock, turn = 'straight', remaining = Infinity, curb = false, kind = 'car') {
  return curb || (turn === 'right' && remaining <= BUS_TURN_M) || !reservedLane(map, edge, index, clock, kind);
}
export function routeBusLane(route, s, clock, curb = false, i = route.laneEdgeAt(s)) {
  const edge = route.map.edges.get(route.edges[i]);
  if (!edge) return null;
  const starts = route.laneEdgeStarts(), remaining = starts[i + 1] - s;
  const turn = route.map.turnThrough(route.edges, i, route.map.junctionNodes(route.map.intersections.get(edge.control?.id))).turn;
  const lanes = (route.map.buslanes || []).filter(l => l.edge === edge.id);
  if (!lanes.length) return null;
  // (how far along this street the car is, having turned right into it: null if it did not)
  const before = i > 0 ? route.map.edges.get(route.edges[i - 1]) : null;
  const turnedIn = before && route.map.turnThrough(route.edges, i - 1, route.map.junctionNodes(route.map.intersections.get(before.control?.id))).turn === 'right' ? s - starts[i] : null;
  return { edge: edge.id, lanes, turn, remaining, entering_allowed: curb || (turn === 'right' && remaining <= BUS_TURN_M),
    active: lanes.some(l => busLaneActive(l, clock)), approach_m: BUS_TURN_M, turned_in_m: turnedIn };
}
// How far into a street it turned right into the car may still be leaving its reserved curb lane:
// a lane change's length at the fastest it went there before it had moved `TURN_OUT_M` from the
// lane's centre, then fixed (per street and route). The latch lives on the world, so checkpoints keep it.
export const TURN_OUT_M = 0.5;
function turnInAllowance(world, near) {
  let t = world.busTurnIn;
  if (t?.edge !== near.lane.edge || t.route !== world.route) t = world.busTurnIn = { edge: near.lane.edge, route: world.route, allow_m: 0, out: false };
  if (!t.out) { t.allow_m = Math.max(t.allow_m, laneChangeLength(world.ego.v)); t.out = Math.abs(near.lateral) >= TURN_OUT_M; }
  return t.allow_m;
}
// The lane the car is actually in, route or not (manual driving included); the route only grants the
// right-turn approach, and parking grants the curb.
export function auditBusLanes(world, dt) {
  const { map, route, ego } = world;
  if (!world.clock) return;
  const near = map.nearestLane(ego.x, ego.y, ego.psi, 5);
  if (!near || !(map.buslanes || []).some(l => l.edge === near.lane.edge && busLaneActive(l, world.clock))) return;
  world.busLanesSeen = true;
  if (ego.v < .2 || !reservedLane(map, near.lane.edge, near.lane.idx, world.clock)) return;
  // (on the route's own street: rounding the corner of the right turn, the route is already on the next one)
  const curb = !!world.parking || !!world.parkedIn, i = route ? route.edges.indexOf(near.lane.edge) : -1;
  const p = !curb && i >= 0 && route.project(ego.x, ego.y, route.hint);
  const b = p ? routeBusLane(route, p.s, world.clock, false, i) : null;
  if (curb || b?.entering_allowed) return;
  // (or leaving the curb lane it turned right into, over a lane change's length: latched at the speed
  // it had when it started out of the lane, so slowing on the way across does not shorten it)
  if (b?.turned_in_m != null && b.turned_in_m <= turnInAllowance(world, near)) return;
  world.violations.bus_lane_driving = (world.violations.bus_lane_driving || 0) + Math.max(0, ego.v) * dt;
  world.events.push({ type: 'bus_lane_driving', edge: near.lane.edge });
}
