// Emergency vehicles: an ambulance or a fire truck answering a call, lights flashing and siren on.
// Everyone gives way to one coming toward them, from behind, ahead or a side street (BC Motor
// Vehicle Act s. 177): pull over as close to the right-hand edge of the road as they can, clear of
// any junction, and stop until it has gone by. A driver already in a junction clears it first.
// Nobody follows one within 150 m (Alberta's rule for any emergency vehicle with its lights or siren
// on): traffic hangs back as from a car 150 m nearer.
//
// The vehicle itself drives at up to 35% over the limit (60 km/h at most) along the middle of the
// road: astride the centre line of a two-way street, along the left of the leftmost lane of a
// one-way one. To get past vehicles in the next 30 m it moves across the road, at up to 1 m/s, to
// the nearest gap between them (and anything parked) its body clears by 0.15 m, at 4 m/s when within
// 0.6 m, and 1.5 m from anything moving that is not going its way. It slows to 5 m/s through any junction where it has a red light, a stop or a yield line,
// and to 8 m/s through any other, and waits at the line for anything crossing. A vehicle going its way that it is stuck behind for 3 s
// drives on ahead of it instead of waiting for it. Stuck for 20 s, it is stood down: the siren goes
// off and it carries on at the limit.

import { AMBULANCE, FIRE_TRUCK, CAR } from "./vehicle.js";

export const EMERGENCY_SPECS = { ambulance: AMBULANCE, fire_truck: FIRE_TRUCK };
export const EMERGENCY_NAMES = { ambulance: "ambulance", fire_truck: "fire truck" };
// A siren is heard this far away, through buildings; its lights are seen in line of sight.
export const CALL_M = 100;
// The path of a vehicle answering a call that a driver gives way to: as far as it can see it go
// (along its street and through the next junction).
const CALL_PATH_M = CALL_M + 20;
// A vehicle within this distance of that path, where it is or where it will be in the next 20 m,
// is in its way: both directions of a street, and the lanes of a side street it crosses.
export const IN_WAY_M = 8;
const AHEAD_POINTS_M = [0, 10, 20];
export const FOLLOW_M = 150;
export const EV_LIMIT_FACTOR = 1.35;
export const EV_MAX_MPS = 16.7;
export const EV_JUNCTION_MPS = 5;
export const EV_SQUEEZE_M = 0.15;
export const EV_SQUEEZE_MPS = 4;
export const EV_STUCK_S = 3;
export const EV_STAND_DOWN_S = 20;
export const EV_PASS_LOOK_M = 30;
// Where a yielding vehicle pulls over to, right of its lane's centre: into an empty parking lane
// beside the curb lane, at most this far, else to 0.35 m short of the right-hand edge of its lane
// (clear of cars parked beyond it).
export const PULL_INTO_PARKING_M = 1.5;
const LANE_EDGE_MARGIN_M = 0.35;

export const isEmergency = (v) => !!v && v.siren === true;
// One of the emergency vehicles, siren on or not.
export const isEmergencyVehicle = (v) => !!v && !!EMERGENCY_SPECS[v.kind];
// Whether a vehicle an emergency vehicle is stuck behind should drive on ahead of it: one going its
// way, that has held it up for EV_STUCK_S.
export const leadsEmergency = (ev, o) => holdsUp(ev, o, EV_STUCK_S) && Math.abs(wrap(o.psi - ev.psi)) < Math.PI / 4;
// Whether `o` is one of what has held emergency vehicle `ev` up, standing, for more than `s` seconds.
export const holdsUp = (ev, o, s) => !!ev.blockedBy?.includes(o) && ev.blockedFor > s;

// Where an emergency vehicle drives across its lane, in metres right of the lane's centre: on a
// two-way street, astride the centre line; on a one-way street, along the left of the leftmost lane,
// half its width plus 0.2 m in from that lane's left edge.
export function evOffset(edge, laneIdx, spec) {
  if (!edge) return 0;
  const centre = edge.lane_offsets[laneIdx] ?? 0;
  if (!edge.oneway) return -centre;
  const left = edge.lane_offsets[0] - edge.lane_width / 2 + spec.width / 2 + 0.2;
  return Math.min(0, left - centre);
}

// Where across the road an emergency vehicle drives to get past what is ahead of it: the point
// nearest `preferred` (metres right of its lane's centre) where its body clears every span in
// `spans` ([left, right] across the road, from vehicles beside it and in the next stretch) by
// EV_SQUEEZE_M, between the left edge of the asphalt and the right edge of the traffic lanes. Null
// when there is none.
export function threadGap(edge, laneIdx, spec, preferred, spans) {
  const half = spec.width / 2 + EV_SQUEEZE_M, centre = edge.lane_offsets[laneIdx] ?? 0;
  // (as far left as the asphalt goes, and right only as far as the traffic lanes: the curb side is
  // where everyone else pulls over)
  const lo = edge.asphalt[0] - centre + spec.width / 2 + 0.2, hi = edge.lane_offsets[edge.lanes - 1] + edge.lane_width / 2 - centre - spec.width / 2;
  const fits = (c) => c >= lo - 1e-9 && c <= hi + 1e-9 && spans.every(([a, b]) => c + half <= a || c - half >= b);
  const options = [preferred, ...spans.flatMap(([a, b]) => [a - half, b + half])].filter(fits);
  if (!options.length) return null;
  return options.reduce((best, c) => Math.abs(c - preferred) < Math.abs(best - preferred) ? c : best);
}

// How far right of its lane's centre a vehicle of width `width` pulls over: into the street's
// parking lane when it is in the curb lane and `parkingFree` (nothing parked there where it stops),
// else to the right-hand edge of its lane.
export function pullOverOffset(edge, laneIdx, width, parkingFree) {
  if (!edge) return 0;
  const edgeOfLane = Math.max(0, (edge.lane_width - width) / 2 - LANE_EDGE_MARGIN_M);
  if (laneIdx !== edge.lanes - 1 || !parkingFree || edge.ring) return edgeOfLane;
  const room = edge.asphalt[1] - (edge.lane_offsets[laneIdx] + width / 2) - 0.3;
  return Math.max(edgeOfLane, Math.min(PULL_INTO_PARKING_M, room));
}

// Whether emergency vehicle `ev` calls on vehicle `o` to give way: its siren is on, it is within
// CALL_M, and `o`, now or over the next 20 m it goes (`points`, by default straight on along its
// heading), is within IN_WAY_M of the path `ev` is about to take, ahead of `ev` (until `ev` has
// passed it). Returns { relation: "behind" | "ahead" | "left" | "right", along_m (how far ahead of
// `ev`'s rear axle along its path `o` is), eta_s, distance_m } or null.
export function emergencyCall(o, ev, points = null) {
  if (!isEmergency(ev) || o === ev || !ev.path?.pts) return null;
  const distance = Math.hypot(o.x - ev.x, o.y - ev.y);
  if (distance > CALL_M) return null;
  const path = ev.path, s0 = path.s, s1 = Math.min(path.length, s0 + CALL_PATH_M);
  const oSpec = o.spec || CAR, mid = oSpec.length / 2 - oSpec.rearOverhang;
  const here = [o.x + Math.cos(o.psi) * mid, o.y + Math.sin(o.psi) * mid];
  const pts = points || AHEAD_POINTS_M.map((d) => [here[0] + Math.cos(o.psi) * d, here[1] + Math.sin(o.psi) * d]);
  // passed: its rear is beyond the middle of `o`, along its path (or `o` follows it)
  const passedAt = -(ev.spec.rearOverhang + oSpec.length / 2 + 0.5);
  const now = closestOnPath(path, pts[0][0], pts[0][1], s0 - 60, s1);
  if (now && now.distance <= IN_WAY_M && now.s < s0 + passedAt) return null;
  let hit = null;
  for (let k = 0; k < pts.length; k++) {
    // (where `o` will be counts only ahead of the front of `ev`: not beside or behind it)
    const from = s0 + (k === 0 ? passedAt : ev.spec.length - ev.spec.rearOverhang);
    const p = closestOnPath(path, pts[k][0], pts[k][1], from, s1);
    if (!p || p.distance > IN_WAY_M || (k > 0 && p.s <= from + 1e-6)) continue;
    hit = { s: p.s, k };
    break;
  }
  if (!hit) return null;
  const rel = wrap(ev.psi - o.psi);
  const behind = Math.abs(rel) < Math.PI / 4, oncoming = Math.abs(rel) > Math.PI * 3 / 4;
  const relation = behind ? "behind" : oncoming ? "ahead" : rel > 0 ? "right" : "left";
  const along = hit.s - s0;
  return { relation, along_m: along, eta_s: Math.max(0, along - (ev.spec.length - ev.spec.rearOverhang)) / Math.max(2, ev.v), distance_m: distance };
}

// The emergency vehicle nearest to calling on `o` to give way (the soonest due), or null.
export function nearestCall(o, vehicles, points = null) {
  let best = null;
  for (const ev of vehicles) {
    if (!isEmergency(ev)) continue;
    const c = emergencyCall(o, ev, points);
    if (c && (!best || c.eta_s < best.eta_s)) best = { ev, ...c };
  }
  return best;
}

const junctionCache = new WeakMap();
// A node where three or more streets meet.
export function isJunction(map, nodeId) {
  if (!junctionCache.has(map)) junctionCache.set(map, new Map());
  const cache = junctionCache.get(map);
  if (!cache.has(nodeId)) {
    const ids = [...(map.inn.get(nodeId) || []), ...(map.out.get(nodeId) || [])];
    const neighbours = new Set(ids.map((id) => { const e = map.edges.get(id); return e.from === nodeId ? e.to : e.from; }));
    cache.set(nodeId, neighbours.size >= 3);
  }
  return cache.get(nodeId);
}

// Plans for sending an emergency vehicle past a driver at (x, y) heading `psi`: where it starts
// (`edge`, `lane`, `s`) and the edges it takes (`planned`, as [edge, lane]), so that it comes up
// behind the driver along its street, comes the other way down it, or crosses the next junction
// ahead from a side street. Each starts about `back` metres away along the streets. Null when the
// streets do not allow it.
export function planBehind(map, x, y, psi, back = 140) {
  const near = map.nearestLane(x, y, psi, 12);
  if (!near) return null;
  let cur = near.lane.edgeRef, need = back - near.s;
  const chain = [cur.id];
  while (need > 0) {
    const preds = (map.inn.get(cur.from) || []).map((id) => map.edges.get(id))
      .filter((p) => !p.ring && Math.abs(map.turnAngle(p.id, cur.id)) < 35 * Math.PI / 180 && !chain.includes(p.id));
    if (!preds.length) break;
    preds.sort((a, b) => Math.abs(map.turnAngle(a.id, cur.id)) - Math.abs(map.turnAngle(b.id, cur.id)));
    cur = preds[0];
    chain.unshift(cur.id);
    need -= cur.length;
  }
  const first = map.edges.get(chain[0]);
  const s = need <= 0 ? -need : chain.length > 1 ? 2 : Math.max(2, near.s - back);
  if (chain.length === 1 && near.s - s < 50) return null;
  return { edge: first.id, lane: 0, s, planned: chain.slice(1).map((id) => [id, 0]), relation: "behind" };
}

export function planOncoming(map, x, y, psi, ahead = 140) {
  const near = map.nearestLane(x, y, psi, 12);
  if (!near) return null;
  const reverse = (e) => (map.out.get(e.to) || []).map((id) => map.edges.get(id)).find((r) => r.to === e.from && !r.ring);
  let cur = near.lane.edgeRef, along = cur.length - near.s;
  const forward = [cur];
  while (along < ahead) {
    const next = map.successors(cur.id).map((id) => map.edges.get(id))
      .filter((n) => !n.ring && Math.abs(map.turnAngle(cur.id, n.id)) < 35 * Math.PI / 180 && !forward.includes(n));
    if (!next.length) break;
    next.sort((a, b) => Math.abs(map.turnAngle(cur.id, a.id)) - Math.abs(map.turnAngle(cur.id, b.id)));
    cur = next[0];
    forward.push(cur);
    along += cur.length;
  }
  if (along < 50) return null;
  const back = forward.map(reverse);
  if (back.some((r) => !r)) return null;
  // on the last street ahead, `along - ahead` metres short of its end, measured from the other way
  const last = forward.at(-1), into = Math.max(0, along - ahead);
  const sOnLast = last.length - into;
  const lanes = back.reverse();
  return { edge: lanes[0].id, lane: 0, s: Math.max(2, Math.min(lanes[0].length - 2, lanes[0].length - sOnLast)), planned: lanes.slice(1).map((r) => [r.id, 0]), relation: "ahead" };
}

export function planCrossing(map, x, y, psi, back = 110) {
  const near = map.nearestLane(x, y, psi, 12);
  if (!near) return null;
  const e = near.lane.edgeRef;
  if (!isJunction(map, e.to) || e.length - near.s < 25) return null;
  const options = [];
  for (const id of map.inn.get(e.to) || []) {
    const c = map.edges.get(id);
    if (c.id === e.id || c.from === e.to || c.ring) continue;
    const angle = Math.abs(wrap(map.headingIn(c.id) - map.headingIn(e.id)));
    if (angle < 50 * Math.PI / 180 || angle > 130 * Math.PI / 180) continue;
    const across = map.successors(c.id).find((o) => map.classifyTurn(map.turnAngle(c.id, o)) === "straight");
    if (across) options.push({ c, across });
  }
  if (!options.length) return null;
  options.sort((a, b) => String(a.c.id).localeCompare(String(b.c.id)));
  const { c, across } = options[0];
  let start = c, need = back - c.length;
  const chain = [c.id];
  while (need > 0) {
    const preds = (map.inn.get(start.from) || []).map((id) => map.edges.get(id))
      .filter((p) => !p.ring && map.classifyTurn(map.turnAngle(p.id, start.id)) === "straight" && !chain.includes(p.id));
    if (!preds.length) break;
    start = preds[0];
    chain.unshift(start.id);
    need -= start.length;
  }
  const s = need <= 0 ? -need : 2;
  return { edge: chain[0], lane: 0, s, planned: [...chain.slice(1), across].map((id) => [id, 0]), relation: "crossing" };
}

// The closest point to (x, y) on a path between arc lengths s0 and s1: its arc length, distance and
// signed lateral offset (right of travel positive).
export function closestOnPath(path, x, y, s0, s1) {
  const { pts, cum } = path;
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    if (cum[i + 1] < s0 || cum[i] > s1) continue;
    const [ax, ay] = pts[i], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const t = Math.max((s0 - cum[i]) / len, 0, Math.min(1, (s1 - cum[i]) / len, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
    const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(x - qx, y - qy);
    if (!best || d < best.distance) best = { s: cum[i] + t * len, distance: d, lateral: ((x - qx) * dy - (y - qy) * dx) / len };
  }
  return best;
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
