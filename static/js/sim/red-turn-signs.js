// Red-only signs do not remove turns from routes: the same turn is legal on green.
import { restrictionActive } from "./turn-restrictions.js";

export function redTurnSigns(world) {
  return world.redTurnSigns ? world.map.redTurns : [];
}
export function redTurnBanned(world, from, to) {
  return world.redTurnSigns && redTurnSigns(world).some(r => r.from === from && r.to.includes(to) && restrictionActive(r, world.clock));
}
export function redTurnExits(world, from) {
  return redTurnSigns(world).filter(r => r.from === from && restrictionActive(r, world.clock)).flatMap(r => r.to);
}
export function routeRedTurnBanned(world, control) {
  if (!world.redTurnSigns) return false;
  const edges = world.route?.edges || [], i = edges.indexOf(control.edge);
  return i >= 0 && redTurnBanned(world, control.edge, edges[i + 1]);
}
