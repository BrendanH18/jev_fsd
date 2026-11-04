// Reserved curb lanes. Cars may enter for a right turn in the last 50 m,
// or for the actual curb parking/pull-out manoeuvre. No random draws.
export const BUS_TURN_M = 50;
export function busLaneActive(lane, clock) {
  if (!clock || !Number.isFinite(clock.hour)) return false;
  if (!lane.hours) return true;
  const minute = clock.hour * 60, day = clock.day ?? 0; // drive clocks default to Monday
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
export function routeBusLane(route, s, clock, curb = false) {
  const i = route.laneEdgeAt(s), edge = route.map.edges.get(route.edges[i]);
  if (!edge) return null;
  const starts = route.laneEdgeStarts(), remaining = starts[i + 1] - s;
  const turn = route.map.turnThrough(route.edges, i, route.map.junctionNodes(route.map.intersections.get(edge.control?.id))).turn;
  const lanes = (route.map.buslanes || []).filter(l => l.edge === edge.id);
  if (!lanes.length) return null;
  return { edge: edge.id, lanes, turn, remaining, entering_allowed: curb || (turn === 'right' && remaining <= BUS_TURN_M),
    active: lanes.some(l => busLaneActive(l, clock)), approach_m: BUS_TURN_M };
}
export function auditBusLanes(world, dt) {
  const { map, route, ego } = world;
  if (!route || !world.clock) return;
  const p = route.project(ego.x, ego.y, route.hint), info = p && routeBusLane(route, p.s, world.clock, !!world.parking || !!world.parkedIn);
  if (!info?.active) return;
  world.busLanesSeen = true;
  const near = map.nearestLane(ego.x, ego.y, ego.psi, 5);
  if (!near || near.lane.edge !== info.edge || info.entering_allowed || ego.v < .2) return;
  if (reservedLane(map, near.lane.edge, near.lane.idx, world.clock)) {
    world.violations.bus_lane_driving = (world.violations.bus_lane_driving || 0) + Math.max(0, ego.v) * dt;
    world.events.push({ type: 'bus_lane_driving', edge: info.edge });
  }
}
