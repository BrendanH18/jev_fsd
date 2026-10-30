// Keeping the junction clear ("don't block the box"). Québec's Highway Safety Code: even on a green,
// a driver must not enter an intersection without room past it to clear it completely, and must stop
// before it instead (Québec.ca, "Savoir manœuvrer aux intersections"; the SPVM's "Pour un partage
// sécuritaire de la route"). The same holds for a level crossing (sim/rail.js), whose room rule this
// mirrors. At a signal the box is the junction from the stop line to the far side of the widest street
// across it; a driver short of the line, or barely over it, waits there while a vehicle ahead on its
// way past the junction, going its way, stopped or slower than 3 m/s, leaves less than its own length,
// the gap it would stop behind that vehicle and 1 m clear of the box; and so does one a little further over it, barely moving and still short of
// the street across. Once into the junction it is committed, and drives on. Traffic, buses,
// streetcars and the driven car all do; cyclists, who keep right of the queue, and emergency vehicles
// with their sirens on do not. Junctions without a signal, and roundabouts, are left out.

import { projectPoint } from "../map/mapdata.js";
import { QUEUE_MPS, ROOM_M as SPARE_M } from "./rail.js";
import { isEmergency } from "./emergency.js";

export { QUEUE_MPS };
export const STANDSTILL_M = 2.5;    // the gap a driver stops behind a stopped vehicle (traffic 2 m, Rules 2.5 m)
export const ROOM_M = STANDSTILL_M + SPARE_M;   // what a driver needs past the box besides its own length
export const ENTERED_M = 1;         // a front this far past the line waits there only if barely moving
export const CREEP_MPS = 2;         // (and short of the street across)
export const LOOK_M = 60;           // a line further ahead than this is not checked yet
const PAST_LINE_M = 2;              // (a vehicle whose rear is not this far past the line is queued at it, not in the box)
const STAY_M = 1.6;                 // a vehicle this near a driver's path is on it
const SAME_WAY = Math.PI / 3;
const NEAR_M = 90;                  // (only vehicles this near the junction are looked at)

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Where the box of a signal ends along a path whose junction centre is at `centreS`: the far side of
// the widest street across it (MapData.crossingHalfWidth), or of the one it comes in on if wider.
export function boxEnd(map, edgeId, centreS) {
  const e = map.edges.get(edgeId);
  const own = e?.asphalt ? Math.max(Math.abs(e.asphalt[0]), Math.abs(e.asphalt[1])) : 0;
  return centreS + Math.max(map.crossingHalfWidth(edgeId), own);
}
// And where the street across begins: its near side.
export const boxStart = (map, edgeId, centreS) => centreS - map.crossingHalfWidth(edgeId);

// The vehicle that leaves no room past the box for a vehicle of `spec` on the path (`pts`, `cum`),
// whose line is at `line` and box ends at `far` along it: the nearest, among `vehicles`, on the path
// (its rear within STAY_M of it) and going its way, stopped or slower than QUEUE_MPS, with its rear
// past the line and short of `far` + its length + ROOM_M (its rear, stopped behind the vehicle, clear
// of the box), and the path within STAY_M of it (not just level with the path's end). `{ vehicle, rear_m }`
// (how far past the box the vehicle's rear is), or null. `centre`: the junction, for skipping those far from it.
export function boxBlocker(pts, cum, line, far, spec, vehicles, self = null, centre = null) {
  const need = far + spec.length + ROOM_M;
  let best = null;
  for (const o of vehicles) {
    if (o === self || o.kind === "pedestrian" || o.kind === "bike" || o.kind === "train" || o.kind === "door" || o.parked || o.parking || Math.abs(o.v) >= QUEUE_MPS) continue;
    if (centre && (Math.abs(o.x - centre[0]) > NEAR_M || Math.abs(o.y - centre[1]) > NEAR_M)) continue;
    const os = o.spec || o;
    const rearX = o.x - Math.cos(o.psi) * (os.rearOverhang || 0), rearY = o.y - Math.sin(o.psi) * (os.rearOverhang || 0);
    const q = projectPoint(pts, cum, [rearX, rearY], null);
    if (!q || q.s < line + PAST_LINE_M || q.s > need || q.distance > STAY_M + (os.width || 1.9) / 2) continue;
    if (Math.abs(wrap(o.psi - q.heading)) > SAME_WAY) continue;
    if (!best || q.s < best.s) best = { vehicle: o, s: q.s };
  }
  return best ? { vehicle: best.vehicle, rear_m: best.s - far } : null;
}

// Whether a driver at `v`, its front `toLine` short of the line (negative: past it) and `toNear` short
// of the street across, still waits there.
export const waitsAt = (toLine, toNear, v) => toLine > -ENTERED_M || (Math.abs(v) < CREEP_MPS && toNear > 0.5);

// The signals ahead on the path of a traffic driver (sim/npc.js NpcPath), its front at `front` along
// it and going at `v`, at whose lines it could still wait: [{ edge, control, line, far, centre }],
// nearest first, the lines within LOOK_M.
export function signalBoxesAhead(map, path, front, v) {
  const out = [];
  for (const e of path.edges) {
    if (e.sEnd < front - 30) continue;
    const c = e.control;
    if (!c || c.type !== "signal") continue;
    const line = e.sStart + (c.s_line / Math.max(1, map.edges.get(e.id).length)) * (e.sEnd - e.sStart);
    if (line - front > LOOK_M) break;
    if (!waitsAt(line - front, boxStart(map, e.id, e.sEnd) - front, v)) continue;
    const node = map.nodes.get(map.edges.get(e.id).to);
    out.push({ edge: e.id, control: c, line, far: boxEnd(map, e.id, e.sEnd), centre: node ? [node.x, node.y] : null });
  }
  return out;
}

// Where a traffic driver's front stops for a junction it could not clear, metres ahead of it, or null.
export function boxHold(map, n, front, vehicles) {
  if (n.kind === "bike" || (isEmergency(n) && n.siren)) return null;
  for (const b of signalBoxesAhead(map, n.path, front, n.v)) {
    if (boxBlocker(n.path.pts, n.path.cum, b.line, b.far, n.spec, vehicles, n, b.centre)) return Math.max(0, b.line - front);
  }
  return null;
}

// The driven car's next signal along its route (`route.controls`), its front at `frontS`, the line
// within LOOK_M and the car not yet out of its far side: { c, line, near, far, toLine, toNear, waits }
// (`waits`: at `v`, it could still wait at the line), or null.
export function routeBoxAhead(map, route, frontS, v) {
  for (const c of route.controls) {
    if (c.control.type !== "signal" || c.sJunction === null) continue;
    const far = boxEnd(map, c.edge, c.sJunction);
    if (frontS > far) continue;
    const toLine = c.sRoute - frontS;
    if (toLine > LOOK_M) return null;
    const near = boxStart(map, c.edge, c.sJunction), toNear = near - frontS;
    return { c, line: c.sRoute, near, far, toLine, toNear, waits: waitsAt(toLine, toNear, v) };
  }
  return null;
}

// What the HUD tells the driver of the car about the signal its route takes it through next, within
// LOOK_M: while its light is not red (on a red it waits anyway) and traffic it can see past the
// junction leaves no room for it, to wait at the line. { key, text }, or null.
export function boxNotice(world) {
  const route = world.route, ego = world.ego;
  if (!route) return null;
  const p = route.project(ego.x, ego.y, route.hint);
  if (!p || p.distance > 4) return null;
  const box = routeBoxAhead(world.map, route, p.s + ego.spec.length - ego.spec.rearOverhang, ego.v);
  if (!box?.waits || world.light(box.c.control.id, box.c.edge, box.c.turn) === "red") return null;
  const visible = world.npcs.filter((n) => world.sees(ego, n));
  return boxBlocker(route.pts, route.cum, box.line, box.far, ego.spec, visible, ego) ? { key: `${box.c.control.id}:${Math.round(box.line)}`, text: "JUNCTION · NO ROOM PAST IT · WAIT AT THE LINE" } : null;
}
