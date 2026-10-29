// Buses on their real routes, from OpenStreetMap (`map.transit`, built by jev/osm/transit.py). A bus
// drives a run of its route in the curb lane, at up to 95% of the limit, and stops at each of the
// route's stops: it signals right from 50 m before, eases over toward the curb over the last 30 m
// (to 0.3 m from it, across the parking lane, which is a bus zone: nobody parks from 22 m before
// where the bus stops to 3 m after it) and stops with its front 1 m past the sign (clear of the
// junction behind it, and 1 m short of the crossing street ahead), or in its lane when something is
// parked there all the same. It waits 10 to 25 s with its doors open, then signals left. It pulls out
// once it has signalled for 2 s, when nothing is beside it in the lane it re-enters and nothing coming
// up behind it in that lane would have to brake harder than 3 m/s^2 to stop 2 m behind it, and
// anything within 25 m behind is slowing down or standing.
//
// Where the limit is 60 km/h or less, a driver coming up behind a bus at a stop that is signalling to
// pull out yields to it (BC Motor Vehicle Act s. 169.1; the bus itself may pull out only when it is
// safe to): one in the lane it re-enters, still behind it, that can stop 2 m behind it braking at no
// more than 3 m/s^2, stops there until it has pulled out. One that cannot, or is already beside it,
// carries on, and the bus waits for it. On a faster road the bus waits for a gap instead.

import { BUS, CAR } from "./vehicle.js";
import { isJunction } from "./emergency.js";

export const BUS_YIELD_LIMIT_MPS = 60 / 3.6 + 0.05;
export const BUS_YIELD_DECEL = 3;
export const BUS_YIELD_GAP_M = 2;
export const BUS_SIGNAL_S = 2;
export const BUS_DWELL_S = [10, 25];
export const BUS_SIGNAL_M = 50;
export const BUS_TAPER_M = 30;
export const BUS_SLOWING_M = 25;
const SIGN_TO_FRONT_M = 1;
const CURB_GAP_M = 0.3;
const ZONE_BEFORE_M = 10;   // the bus zone starts this far behind a stopped bus's rear
const ZONE_AFTER_M = 3;
const LOOK_BEHIND_M = 90;
const FAST_GAP_S = 6;       // on a road over 60 km/h, the gap the bus waits for

export const isBus = (v) => !!v && v.kind === "bus";

// The widest asphalt half-width of the other streets at `node`, but the one `e` lies along.
function crossingAt(map, node, e) {
  let widest = 0;
  for (const id of [...(map.inn.get(node) || []), ...(map.out.get(node) || [])]) {
    const o = map.edges.get(id);
    if ((o.from === e.from && o.to === e.to) || (o.from === e.to && o.to === e.from)) continue;
    widest = Math.max(widest, Math.abs(o.asphalt[0]), Math.abs(o.asphalt[1]));
  }
  return widest;
}

// Where along edge `edgeId` (metres along its centreline) a bus's front stops for a stop whose sign
// is `s` metres along it: 1 m past the sign, its rear clear of the junction the street starts at,
// and 1 m short of the crossing street at its end (or 0.5 m short of a stop line there). Null when
// the street is too short for both. (`length`: a streetcar's, sim/streetcar.js, is longer.)
export function busStopFront(map, edgeId, s, length = BUS.length) {
  const e = map.edges.get(edgeId);
  if (!e) return null;
  const L = e.cum ? e.cum[e.cum.length - 1] : e.length;
  let front = s + SIGN_TO_FRONT_M;
  if (isJunction(map, e.from)) front = Math.max(front, crossingAt(map, e.from, e) + length + 1);
  let last = L - 0.5;
  if (isJunction(map, e.to)) last = Math.min(last, L - map.crossingHalfWidth(e.id) - 1);
  if (e.control) last = Math.min(last, e.control.s_line - 0.5);
  return front <= last ? front : null;
}

// The bus zones of a map: edge id -> [[from, to], ...] along its centreline, where nobody parks.
const zoneCache = new WeakMap();
export function busZones(map) {
  if (zoneCache.has(map)) return zoneCache.get(map);
  const zones = new Map();
  for (const route of map.transit?.routes || []) for (const run of route.runs) for (const stop of run.stops) {
    if (route.mode === "tram") continue;   // (a streetcar stops in its lane, sim/streetcar.js)
    const front = busStopFront(map, stop.edge, stop.s);
    if (front === null) continue;
    if (!zones.has(stop.edge)) zones.set(stop.edge, []);
    zones.get(stop.edge).push([front - BUS.length - ZONE_BEFORE_M, front + ZONE_AFTER_M]);
  }
  zoneCache.set(map, zones);
  return zones;
}

// How far right of its lane's centre a bus pulls in to the curb: across the parking lane to
// CURB_GAP_M from the curb, from the curb lane only.
export function curbShift(edge, laneIdx, width = BUS.width) {
  if (!edge || edge.ring || laneIdx !== edge.lanes - 1) return 0;
  return Math.max(0, edge.asphalt[1] - edge.lane_offsets[laneIdx] - width / 2 - CURB_GAP_M);
}

// Where vehicle `o` is relative to bus `bus`, going its way (within 30 deg), or null: how far its
// front is behind the bus's rear bumper (`behind_m`, negative once it has drawn level), whether it is
// beside the bus, and how far right of the centre of the lane the bus pulls out into it is
// (`across_m`), and whether it is in that lane.
export function busRelation(o, bus) {
  const t = bus.transit;
  if (!t || o === bus || Math.abs(wrap(o.psi - bus.psi)) > Math.PI / 6) return null;
  const os = o.spec || CAR, bs = bus.spec, l = bus.toLocal(o.x, o.y);
  if (l.ahead < -LOOK_BEHIND_M || l.ahead > bs.length + 5) return null;
  const front = l.ahead + Math.cos(o.psi - bus.psi) * (os.length - os.rearOverhang), rear = front - os.length;
  const across = l.right + t.shift;
  return { behind_m: -bs.rearOverhang - front, beside: front > -bs.rearOverhang && rear < bs.length - bs.rearOverhang,
    across_m: across, inLane: Math.abs(across) < (t.laneWidth || 3.5) / 2 + 0.3 };
}

// Whether a bus is signalling to pull out from a stop (or pulling out), with traffic behind it bound
// to let it (s. 169.1).
export const busSignalling = (bus) => isBus(bus) && (bus.transit?.phase === "leaving" || bus.transit?.phase === "out");
export const busHasRightOfWay = (bus) => busSignalling(bus) && bus.transit.limit <= BUS_YIELD_LIMIT_MPS;

// Whether `o` must yield to `bus` pulling out: the bus signals to, the limit is 60 km/h or less,
// and `o` is in the lane it pulls out into, still behind it. Its relation (see busRelation) with
// `stop_m`, how far ahead of `o`'s front it stops, or null.
export function busYield(o, bus) {
  if (!busHasRightOfWay(bus)) return null;
  const r = busRelation(o, bus);
  if (!r || !r.inLane || r.beside || r.behind_m <= 0) return null;
  return { ...r, stop_m: r.behind_m - BUS_YIELD_GAP_M };
}

// Whether a driver at `v` can stop within `room` metres braking at no more than BUS_YIELD_DECEL.
export const canStopFor = (v, room) => room >= Math.max(0, v) ** 2 / (2 * BUS_YIELD_DECEL);

// Whether a bus at a stop may pull out now (see the top of this file). `yielding(o)`: whether
// traffic vehicle `o` has already chosen to yield to it.
export function busMayPullOut(bus, others, yielding = () => false) {
  const t = bus.transit;
  if (!t || t.t < BUS_SIGNAL_S) return false;
  for (const o of others) {
    if (o === bus || Math.abs(o.x - bus.x) > LOOK_BEHIND_M + 15 || Math.abs(o.y - bus.y) > LOOK_BEHIND_M + 15) continue;
    const r = busRelation(o, bus);
    if (!r || !r.inLane) continue;
    if (r.beside) return false;
    if (r.behind_m < 0 || o.v < 0.3) continue;
    if (t.limit > BUS_YIELD_LIMIT_MPS) { if (r.behind_m < 10 + o.v * FAST_GAP_S) return false; continue; }
    if (!canStopFor(o.v, r.behind_m - BUS_YIELD_GAP_M)) return false;
    // (close behind, it must be seen to slow down)
    if (r.behind_m < BUS_SLOWING_M && o.v > 2 && !(o.a < -0.3) && !yielding(o)) return false;
  }
  return true;
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
