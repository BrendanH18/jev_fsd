// Ontario pedestrian crossovers: occupancy of the whole roadway, independent of lane clearance.
import { frontTo, crosswalksAlong } from "./crosswalk.js";
import { headingAt, pointAt } from "../map/mapdata.js";

export function ontarioMap(map) {
  const b = map.routingBbox || map.bbox;
  if (!b) return false;
  const lon = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2;
  return (lat >= 43.5 && lat <= 44 && lon >= -79.7 && lon <= -79)
    || (lat >= 45.1 && lat <= 45.6 && lon >= -76 && lon <= -75.3);
}

export function pxoPedestrian(crowd, ped) {
  const cross = ped.crossing;
  if (!crowd?.pxo || !cross?.marked) return false;
  const cw = crowd.marked.find(c => c.id === cross.marked && c.pxo);
  if (!cw) return false;
  const e = cw.st.edge, h = headingAt(e.pts, e.cum, cw.s);
  const mid = pointAt(e.pts, e.cum, cw.s);
  const right = (ped.x - mid[0]) * Math.sin(h) - (ped.y - mid[1]) * Math.cos(h);
  return right >= e.asphalt[0] - 0.3 && right <= e.asphalt[1] + 0.3;
}

export function pxoAhead(world, frontS) {
  if (!world.pxo) return null;
  for (const { cw, s } of crosswalksAlong(world.route, world.crowd)) {
    if (!cw.pxo || s < frontS - 1 || s > frontS + 65) continue;
    const people = world.crowd.list.filter(p => p.crossing?.marked === cw.id && pxoPedestrian(world.crowd, p));
    if (people.length) return { id: cw.id, pedestrian_ids: people.map(p => p.id), bumper_to_crosswalk_m: s - frontS, stop_s_route: s - 2 };
  }
  return null;
}

export function auditPxo(world) {
  const car = world.ego;
  for (const cw of world.crowd.marked) {
    if (!cw.pxo) continue;
    const d = frontTo(cw, car), before = world.pxoLines.get(cw.id);
    if (d === null || Math.abs(d) > 80) { world.pxoLines.delete(cw.id); continue; }
    world.pxoLines.set(cw.id, d);
    const occupied = world.crowd.list.some(p => p.crossing?.marked === cw.id && pxoPedestrian(world.crowd, p));
    if (occupied && d >= -5 && d <= 65) world.pxoSeen = true;
    // The hold line is 2 m short of the crossing centre, in either direction.
    if (occupied && before >= 2 && d < 2 && car.v > 0) {
      world.violations.pxo_early_goes = (world.violations.pxo_early_goes || 0) + 1;
      world.events.push({ type: "pxo_early_go", crossing: cw.id });
    }
  }
}
