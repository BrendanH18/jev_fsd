// Reserved curb lanes. Cars may enter for a right turn in the last 50 m,
// or for the actual curb parking/pull-out manoeuvre. No random draws.
// A right turn into a street ends in its curb lane (BC MVA s. 165: as close as practicable to the
// right-hand curb); where that lane is reserved, the car leaves it at once, and the lane change out is
// not driving in it.
import { laneChangeLength } from "./controller.js";
export const BUS_TURN_M = 50;
function validWindow(window) {
  return (
    Number.isInteger(window?.start) &&
    window.start >= 0 &&
    window.start < 1440 &&
    Number.isInteger(window.end) &&
    window.end >= 0 &&
    window.end <= 1440 &&
    Array.isArray(window.days) &&
    Array.from(window.days).every((day) => Number.isInteger(day) && day >= 0 && day < 7)
  );
}

export function busLaneActive(lane, clock) {
  const hour = clock?.hour;
  if (!lane || !Number.isFinite(hour) || hour < 0 || hour >= 24) return false;
  const hours = lane.hours;
  if (!Array.isArray(hours)) return true; // absent and unrecognized schedules retain the reservation
  const minute = hour * 60;
  const day = clock.weekday ?? 0;
  if (!Number.isInteger(day) || day < 0 || day > 6) return hours.length > 0;
  return hours.some((w) => {
    if (!validWindow(w)) return true;
    if (w.start <= w.end) return w.days.includes(day) && minute >= w.start && minute < w.end;
    return (w.days.includes(day) && minute >= w.start) || (w.days.includes((day + 6) % 7) && minute < w.end);
  });
}

function busLaneLayer(map) {
  return Array.isArray(map?.buslanes) ? map.buslanes : [];
}

export function reservedLane(map, edge, index, clock, kind = "car") {
  const vehicleClass = kind === "bike" ? "bicycle" : kind;
  return busLaneLayer(map).find(
    (lane) =>
      lane &&
      lane.edge === edge &&
      lane.lane === index &&
      busLaneActive(lane, clock) &&
      !(Array.isArray(lane.allowed) && lane.allowed.includes(vehicleClass)),
  );
}
export function legalBusLane(
  map,
  edge,
  index,
  clock,
  turn = "straight",
  remaining = Infinity,
  curb = false,
  kind = "car",
) {
  return curb || (turn === "right" && remaining <= BUS_TURN_M) || !reservedLane(map, edge, index, clock, kind);
}
export function routeBusLane(route, s, clock, curb = false, i) {
  if (!Number.isFinite(s)) return null;
  i ??= route?.laneEdgeAt?.(s);
  if (!Number.isSafeInteger(i) || i < 0) return null;
  const edge = route?.map?.edges?.get(route.edges?.[i]);
  if (!edge) return null;
  const lanes = busLaneLayer(route.map).filter((l) => l?.edge === edge.id);
  if (!lanes.length) return null;
  const starts = route.laneEdgeStarts(),
    remaining = starts[i + 1] - s;
  const turn = route.map.turnThrough(
    route.edges,
    i,
    route.map.junctionNodes(route.map.intersections.get(edge.control?.id)),
  ).turn;
  // (how far along this street the car is, having turned right into it: null if it did not)
  const before = i > 0 ? route.map.edges.get(route.edges[i - 1]) : null;
  const turnedIn =
    before &&
    route.map.turnThrough(route.edges, i - 1, route.map.junctionNodes(route.map.intersections.get(before.control?.id)))
      .turn === "right"
      ? s - starts[i]
      : null;
  return {
    edge: edge.id,
    lanes,
    turn,
    remaining,
    entering_allowed: curb || (turn === "right" && remaining <= BUS_TURN_M),
    active: lanes.some((l) => busLaneActive(l, clock)),
    approach_m: BUS_TURN_M,
    turned_in_m: turnedIn,
  };
}
// How far into a street it turned right into the car may still be leaving its reserved curb lane:
// a lane change's length at the fastest it went there before it had moved `TURN_OUT_M` from the
// lane's centre, then fixed (per street and route). The latch lives on the world, so checkpoints keep it.
export const TURN_OUT_M = 0.5;
function turnInAllowance(world, near) {
  let t = world.busTurnIn;
  if (t?.edge !== near.lane.edge || t.route !== world.route)
    t = world.busTurnIn = { edge: near.lane.edge, route: world.route, allow_m: 0, out: false };
  if (!t.out) {
    t.allow_m = Math.max(t.allow_m, laneChangeLength(world.ego.v));
    t.out = Math.abs(near.lateral) >= TURN_OUT_M;
  }
  return t.allow_m;
}
// The lane the car is actually in, route or not (manual driving included); the route only grants the
// right-turn approach, and parking grants the curb.
export function auditBusLanes(world, dt) {
  const { map, route, ego } = world;
  if (!world.clock) return;
  const near = map.nearestLane(ego.x, ego.y, ego.psi, 5);
  if (!near || !busLaneLayer(map).some((l) => l?.edge === near.lane.edge && busLaneActive(l, world.clock))) return;
  world.busLanesSeen = true;
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(ego.v) || ego.v < 0.2) return;
  if (!reservedLane(map, near.lane.edge, near.lane.idx, world.clock)) return;
  // (on the route's own street: rounding the corner of the right turn, the route is already on the next one)
  const curb = !!world.parking || !!world.parkedIn,
    i = route ? route.edges.indexOf(near.lane.edge) : -1;
  const p = !curb && i >= 0 && route.project(ego.x, ego.y, route.hint);
  const b = p ? routeBusLane(route, p.s, world.clock, false, i) : null;
  if (curb || b?.entering_allowed) return;
  // (or leaving the curb lane it turned right into, over a lane change's length: latched at the speed
  // it had when it started out of the lane, so slowing on the way across does not shorten it)
  if (b?.turned_in_m != null && b.turned_in_m <= turnInAllowance(world, near)) return;
  const previous = world.violations.bus_lane_driving;
  const distance = (Number.isFinite(previous) && previous > 0 ? previous : 0) + ego.v * dt;
  if (!Number.isFinite(distance)) return;
  world.violations.bus_lane_driving = distance;
  world.events.push({ type: "bus_lane_driving", edge: near.lane.edge });
}
