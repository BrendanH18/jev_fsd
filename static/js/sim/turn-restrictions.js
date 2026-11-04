// Local calendar: Monday=0 by default, explicitly supplied by callers; no wall-clock time.
export function restrictionActive(r, clock) {
  if (r.suppressed_conditions?.some(condition => restrictionActive({ condition }, clock))) return false;
  const c = r.condition;
  if (!c) return true;
  const t = (clock?.hour ?? 15.5) * 60, day = clock?.weekday ?? 0;
  return c.start <= c.end ? c.days.includes(day) && t >= c.start && t < c.end
    : (c.days.includes(day) && t >= c.start) || (c.days.includes((day + 6) % 7) && t < c.end);
}
export function turnBanned(map, from, to, clock) {
  return (map.restrictions || []).some(r => r.from === from && restrictionActive(r, clock) && (r.kind.startsWith('only_') ? !r.to.includes(to) : r.to.includes(to)));
}
export function turnRestrictionAhead(world, s) {
  if (!world.restrictions || !world.route) return null;
  // (the first banned turn within reach, so a nearer turn that is allowed does not hide it)
  const route = world.route;
  let first = null;
  for (let i = 0; i < route.edges.length - 1; i++) {
    const records = (world.map.restrictions || []).filter(r => r.from === route.edges[i]);
    if (!records.length) continue;
    const edge = world.map.edges.get(route.edges[i]);
    const at = route.laneEdgeStarts()[i + 1];
    const distance = at - s;
    if (distance < -3 || distance > 100) continue;
    const hit = { from: edge.id, to: route.edges[i+1], distance_m: distance, kinds: records.map(r => r.kind), in_effect: records.some(r => restrictionActive(r, world.clock)), banned: turnBanned(world.map, edge.id, route.edges[i+1], world.clock) };
    if (hit.banned) return hit;
    first ||= hit;
  }
  return first;
}
// Observe actual lane transitions, independent of the planned route (manual driving included).
export function auditRestrictions(world) {
  const near = world.map.nearestLane(world.ego.x, world.ego.y, world.ego.psi, 8);
  const edge = near?.lane.edgeRef;
  if (!edge) return;
  const prior = world.restrictionEdge;
  if ((world.map.restrictions || []).some(r => r.from === edge.id && restrictionActive(r, world.clock))) world.restrictionsSeen = true;
  if (prior && prior !== edge.id && world.map.edges.get(prior)?.to === edge.from && turnBanned(world.map, prior, edge.id, world.clock)) {
    world.restrictionsSeen = true;
    world.violations.illegal_turns = (world.violations.illegal_turns || 0) + 1;
    world.events.push({ type: 'illegal_turn', from: prior, to: edge.id });
  }
  world.restrictionEdge = edge.id;
}
