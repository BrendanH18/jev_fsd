// Railway level crossings, the trains that run over them, and the rules that go with them. The map's
// tracks and their crossings with its streets (`map.rail`, built by jev/osm/rail.py) are indexed here.
// In Old Strathcona, Edmonton, the one track is the High Level Bridge Streetcar's heritage line, laid
// in a right of way of its own, which crosses eight streets on the level, each marked by crossbucks
// alone: no lights, no gates, no bell.
//
// A train is approaching a crossing when it is coming toward it ringing its gong (an audible
// signal), its front within GONG_M of the road, or is on it, its body not yet clear of the road (Alberta
// Use of Highway and Rules of the Road Regulation, AR 304/2002, s. 42(1)). While one is, a driver
// coming up to the crossing must stop no closer than HOLD_M back from the nearest rail, and must not
// cross until it has passed by (s. 42(2)); a driver aims its front STOP_M back, short of that with room
// to spare (the shared stop candidate overshoots by about a metre and a half). A driver owes the stop
// when, first hearing or seeing the train, it can stop there braking at no more than OWED_DECEL; one
// that cannot carries on across. A train that has come to a stop short of the road is not
// approaching: once it rings and moves off again, it is.
//
// And whatever is coming, a driver never stops on the tracks: it does not start across unless there
// is room for all of it past them (as Manitoba's and Ontario's handbooks put it, and Operation
// Lifesaver), so a queue backed up across a crossing is waited for at the same place, STOP_M back from
// the nearest rail. Past the tracks means clear of the train's envelope (ENVELOPE_M either side of the
// track's centre) by ROOM_M, behind the vehicle there: a vehicle there moving at QUEUE_MPS or more is
// driving away, and leaves room. A driver whose front is already past where it would stop goes on,
// unless it is barely moving and still short of the envelope (stopped a little long, say): it stays.
// One already on the tracks always goes on.
//
// In a free drive one heritage streetcar runs the line: from the edge of the map, where it comes off
// the High Level Bridge, to its terminus and back, stopping at its stops (DWELL_S) and waiting at its
// terminus (LAYOVER_S) before it turns back; off the map it is gone for AWAY_S before it comes back.
// It runs at up to LINE_MPS and brakes for anything in its way that its motorman can see, at up to
// EMERGENCY_DECEL: it has the right of way, and cannot steer round anything.

import { HERITAGE_STREETCAR } from "./vehicle.js";
import { cumulative, pointAt, projectPoint } from "../map/mapdata.js";

export const HOLD_M = 5;
export const STOP_M = 7;
export const RAIL_HALF_M = 0.79;     // half the standard gauge (1435 mm) and a rail head
export const ENVELOPE_M = 2.5;
export const ROOM_M = 1;
export const GONG_M = 150;
export const HEAR_M = 250;           // a gong is heard this far away, round any corner
export const OWED_DECEL = 3.5;
export const QUEUE_MPS = 3;
export const LINE_MPS = 25 / 3.6;
export const DWELL_S = [15, 30];
export const LAYOVER_S = [40, 80];
export const AWAY_S = [60, 150];
export const SERVICE_DECEL = 1.2;
export const EMERGENCY_DECEL = 2.5;
export const ACCEL = 0.8;
const MOVING_MPS = 0.3;
const TERMINUS_STOP_M = 10;
const CREEP_MPS = 2;
const EXTEND_M = 60;                 // a track that leaves the map runs on this far past its edge
const NEAR_M = 30;                   // (the track this far either side of a crossing is where it crosses)
const SIGHT_M = 70;                  // how far ahead along the track the motorman looks
const CLEAR_M = 3;                   // and stops this far short of anything in the way
const BODY_M = HERITAGE_STREETCAR.width / 2 + 0.5;   // something this near the track's centre is in its way
const SAME_WAY = Math.PI / 3;
const STAY_M = 1.6;                  // a vehicle this near a driver's path is on it

export const isTrain = (v) => !!v && v.kind === "train";
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The map's tracks and crossings, indexed: { tracks: Map(id -> track), crossings: [crossing] }, each
// track with its points (run on EXTEND_M past an end that leaves the map: `ends` "edge"), `cum` and
// `length`, its stops' and crossings' `s` along those points; each crossing with its `track`, the
// track's points within NEAR_M of it (`near`), and `half_m`, half the widest street it crosses as
// measured along the track (and a train's corner). Cached.
const cache = new WeakMap();
export function railIndex(map) {
  if (cache.has(map)) return cache.get(map);
  const tracks = new Map(), crossings = [];
  for (const t of map.rail?.tracks || []) {
    let pts = t.pts.map((p) => [p[0], p[1]]);
    const shift = t.ends[0] === "edge" ? EXTEND_M : 0;
    const out = (a, b) => { const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [a[0] + (a[0] - b[0]) / d * EXTEND_M, a[1] + (a[1] - b[1]) / d * EXTEND_M]; };
    if (t.ends[0] === "edge") pts = [out(pts[0], pts[1]), ...pts];
    if (t.ends[1] === "edge") pts = [...pts, out(pts.at(-1), pts.at(-2))];
    const cum = cumulative(pts);
    tracks.set(t.id, { ...t, pts, cum, length: cum.at(-1), shift, stops: t.stops.map((st) => ({ ...st, s: st.s + shift })), crossings: [] });
  }
  for (const c of map.rail?.crossings || []) {
    const track = tracks.get(c.track);
    if (!track) continue;
    const s = c.s + track.shift, edges = c.edges.filter((on) => map.edges.has(on.edge));
    if (!edges.length) continue;
    const half = Math.max(...edges.map((on) => {
      const e = map.edges.get(on.edge), a = Math.max(0.35, on.angle_deg * Math.PI / 180);
      return (e.width || 8) / 2 / Math.sin(a) + HERITAGE_STREETCAR.width / 2 / Math.tan(a);
    }));
    const lo = Math.max(0, s - NEAR_M), hi = Math.min(track.length, s + NEAR_M);
    const near = [pointAt(track.pts, track.cum, lo), ...track.pts.filter((_, i) => track.cum[i] > lo && track.cum[i] < hi), pointAt(track.pts, track.cum, hi)];
    const crossing = { ...c, s, edges, track: track.id, near, half_m: half };
    track.crossings.push(crossing);
    crossings.push(crossing);
  }
  for (const t of tracks.values()) t.crossings.sort((a, b) => a.s - b.s);
  const index = { tracks, crossings };
  cache.set(map, index);
  return index;
}

// Along a street, the stretch of it that a vehicle `w` wide crossing the track at `angle` (rad between
// the two, up to 90 deg) covers while any of it is within `half` of the track's centre.
export const alongStreet = (half, angle, w) => half / Math.sin(angle) + w / 2 / Math.tan(angle);

// Where the polyline `pts`/`cum` crosses crossing `c`'s track, between `from` and `to` metres along
// it: { s (along the polyline), angle (rad, between it and the track, up to 90 deg) }, or null.
export function crossingOnPath(pts, cum, c, from = 0, to = Infinity) {
  const near = c.near;
  for (let i = 0; i < pts.length - 1; i++) {
    if (cum[i + 1] < from) continue;
    if (cum[i] > to) break;
    const a = pts[i], b = pts[i + 1];
    if (Math.min(a[0], b[0]) > c.x + NEAR_M || Math.max(a[0], b[0]) < c.x - NEAR_M || Math.min(a[1], b[1]) > c.y + NEAR_M || Math.max(a[1], b[1]) < c.y - NEAR_M) continue;
    for (let j = 0; j < near.length - 1; j++) {
      const p = near[j], q = near[j + 1];
      const rx = b[0] - a[0], ry = b[1] - a[1], sx = q[0] - p[0], sy = q[1] - p[1];
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) continue;
      const wx = p[0] - a[0], wy = p[1] - a[1];
      const t = (wx * sy - wy * sx) / den, u = (wx * ry - wy * rx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const s = cum[i] + t * (cum[i + 1] - cum[i]);
      if (s < from || s > to) continue;
      let angle = Math.abs(wrap(Math.atan2(ry, rx) - Math.atan2(sy, sx)));
      if (angle > Math.PI / 2) angle = Math.PI - angle;
      return { s, angle: Math.max(0.35, angle) };
    }
  }
  return null;
}

// A train's front and rear along its track (metres along it), and which way it is going (+1 or -1).
export function trainSpan(n) {
  const sp = n.spec, d = n.rail.dir;
  return { front: n.rail.s + d * (sp.length - sp.rearOverhang), rear: n.rail.s - d * sp.rearOverhang, dir: d };
}

// Whether train `n` is approaching crossing `c` (see the top): { on (its body on the road), coming
// (ringing, on its way to it), gap_m (its front to the road, along the track: 0 on it), eta_s }, or
// null.
export function approach(n, c) {
  if (!isTrain(n) || n.rail.track !== c.track || n.rail.gone) return null;
  const { front, rear, dir } = trainSpan(n);
  const gap = dir * (c.s - front) - c.half_m, past = dir * (rear - c.s) - c.half_m;
  if (gap < 0 && past < 0) return { on: true, coming: false, gap_m: 0, eta_s: 0 };
  if (gap >= 0 && gap <= GONG_M && n.v > MOVING_MPS) return { on: false, coming: true, gap_m: gap, eta_s: gap / Math.max(0.5, n.v) };
  return null;
}

// The train approaching crossing `c` (on it, or the soonest due), with how: { train, ...approach }, or
// null. `trains`: the world's vehicles.
export function trainAt(trains, c) {
  let best = null;
  for (const n of trains) {
    const a = isTrain(n) && approach(n, c);
    if (a && (!best || a.eta_s < best.eta_s)) best = { train: n, ...a };
  }
  return best;
}

// Whether a driver at `v` can stop within `room` metres braking at no more than OWED_DECEL.
export const canStopFor = (v, room) => room >= Math.max(0, v) ** 2 / (2 * OWED_DECEL);

// Whether a driver at `v` still waits at crossing `x` (from crossingsAhead), for a train or for room
// past the tracks (see the top): short of where it stops, or past it but barely moving and short of
// the train's envelope; never on the tracks.
export const waitsAt = (x, v) => !x.fouling && (x.stop_m > -1 || (x.entry_m > 0.5 && v < CREEP_MPS));

// The level crossings ahead along a driver's path `pts`/`cum` (its front `front` metres along it, its
// body `spec`), within `look` metres, and the one it is on: [{ c, s (the track's centre along the
// path), angle, stop_m (its front to where it stops, STOP_M back from the nearest rail), hold_m (to
// the law's line, HOLD_M back), entry_m (to the train's envelope), exit_m (its front to where its rear
// is clear of the envelope), fouling (some of it within the envelope) }], nearest first.
export function crossingsAhead(map, pts, cum, front, spec, look = 80) {
  const index = railIndex(map), out = [];
  if (!index.crossings.length) return out;
  const p = pointAt(pts, cum, Math.max(0, front)), from = front - spec.length - 12;
  for (const c of index.crossings) {
    if (Math.abs(c.x - p[0]) > look + 20 || Math.abs(c.y - p[1]) > look + 20) continue;
    const hit = crossingOnPath(pts, cum, c, from, front + look);
    if (!hit) continue;
    const rail = alongStreet(RAIL_HALF_M, hit.angle, spec.width), env = alongStreet(ENVELOPE_M, hit.angle, spec.width);
    const exit = hit.s + env + spec.length - front;
    if (exit < 0) continue;
    out.push({ c, s: hit.s, angle: hit.angle, stop_m: hit.s - rail - STOP_M - front, hold_m: hit.s - rail - HOLD_M - front,
      entry_m: hit.s - env - front, exit_m: exit, fouling: hit.s - env - front < 0 && exit > 0 });
  }
  return out.sort((a, b) => a.s - b.s);
}

// What stops a driver's room past crossing `x` (from crossingsAhead) on its path `pts`/`cum`: the
// nearest of `vehicles` on the path (within STAY_M of it, going its way, or standing anywhere on the
// track's envelope) between the envelope's near side and where the driver's rear would be clear of it
// by ROOM_M (and its own length past that, for the vehicle's body), moving slower than QUEUE_MPS:
// { vehicle, rear_m (its rear's distance past the envelope's far side, along the path) }, or null.
export function roomBlocker(pts, cum, front, spec, x, vehicles, self = null) {
  const far = front + x.exit_m - spec.length, need = far + spec.length + ROOM_M, near = front + x.entry_m;
  let best = null;
  for (const o of vehicles) {
    if (o === self || isTrain(o) || o.kind === "pedestrian" || o.parked || Math.abs(o.v) >= QUEUE_MPS) continue;
    if (Math.abs(o.x - x.c.x) > 60 || Math.abs(o.y - x.c.y) > 60) continue;
    const os = o.spec || o;
    const rearX = o.x - Math.cos(o.psi) * (os.rearOverhang || 0), rearY = o.y - Math.sin(o.psi) * (os.rearOverhang || 0);
    const q = projectPoint(pts, cum, [rearX, rearY], null);
    if (Math.abs(q.lateral) > STAY_M + (os.width || 1.9) / 2 || q.s < near - (os.length || 4.5) || q.s > need) continue;
    const across = Math.abs(wrap(o.psi - (q.heading ?? 0))) > SAME_WAY;
    if (across && !(q.s > near - (os.length || 4.5) && q.s < far)) continue;
    if (!best || q.s < best.s) best = { vehicle: o, s: q.s };
  }
  return best ? { vehicle: best.vehicle, rear_m: best.s - far } : null;
}

// A driver's hold for the level crossings ahead on its path (traffic, sim/npc.js; the audit and the
// HUD use the same pieces): where its front stops (metres ahead of it), or null. `trains`: the
// vehicles trains are found among; `vehicles`: those that can leave no room past the tracks;
// `owes(x, at)`: whether it owes the stop for the train `at` at crossing `x` (by default, whether it
// can stop now).
export function crossingHold(map, pts, cum, front, spec, v, { trains, vehicles, self = null, owes = null }) {
  for (const x of crossingsAhead(map, pts, cum, front, spec)) {
    if (!waitsAt(x, v)) continue;
    const at = trainAt(trains, x.c);
    if (at && (owes ? owes(x, at) : canStopFor(v, x.stop_m))) return { x, stop_m: Math.max(0, x.stop_m), why: "train", train: at };
    const block = roomBlocker(pts, cum, front, spec, x, vehicles, self);
    if (block) return { x, stop_m: Math.max(0, x.stop_m), why: "room", blocker: block.vehicle };
  }
  return null;
}

// Where train `n`'s body is: its rear axle at `s` along its track, its front bogie its wheelbase ahead.
export function placeTrain(n, track) {
  const sp = n.spec, d = n.rail.dir, s = n.rail.s;
  const a = pointAt(track.pts, track.cum, Math.max(0, Math.min(track.length, s))), b = pointAt(track.pts, track.cum, Math.max(0, Math.min(track.length, s + d * sp.wheelbase)));
  n.x = a[0]; n.y = a[1];
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5) n.psi = Math.atan2(b[1] - a[1], b[0] - a[0]);
}

// How far ahead of train `n`'s front, along its track, the nearest thing in its way is that its
// motorman can see (`sees(observer, o)`), among `others`; Infinity when nothing is.
export function inTheWay(n, track, others, sees) {
  const { front, dir } = trainSpan(n);
  const p = pointAt(track.pts, track.cum, Math.max(0, Math.min(track.length, front)));
  const cab = { x: p[0], y: p[1], psi: n.psi };
  let best = Infinity;
  for (const o of others) {
    if (o === n || Math.abs(o.x - p[0]) > SIGHT_M + 10 || Math.abs(o.y - p[1]) > SIGHT_M + 10) continue;
    const box = o.obb ? o.obb() : null;
    const c = box ? box.center : [o.x, o.y], hl = box ? box.halfLength : 0.3, hw = box ? box.halfWidth : 0.3;
    const q = projectPoint(track.pts, track.cum, c, null);
    const rel = (o.psi ?? 0) - q.heading;
    const across = hl * Math.abs(Math.sin(rel)) + hw * Math.abs(Math.cos(rel)), along = hl * Math.abs(Math.cos(rel)) + hw * Math.abs(Math.sin(rel));
    if (Math.abs(q.lateral) - across > BODY_M) continue;
    const gap = dir * (q.s - front) - along;
    if (gap < -1 || gap > SIGHT_M || gap >= best) continue;
    if (!sees(cab, o)) continue;
    best = Math.max(0, gap);
  }
  return best;
}

// One step of a train (see the top): it runs its track, stops at its stops and its terminus, rings
// its gong on the way to each crossing, and brakes for whatever is in its way. Sets `n.rail.gone` once
// it has run off the map's edge (the fleet then takes it off). `others`: what it might hit; `sees`:
// line of sight; `random`: its stream, for how long it waits.
export function stepTrain(n, track, dt, others, sees, random) {
  const r = n.rail, sp = n.spec;
  if (r.gone) return;
  const between = (span) => span[0] + random() * (span[1] - span[0]);
  if (r.phase === "dwell") {
    n.v = 0; n.a = 0;
    r.t += dt;
    if (r.t < r.dwell || r.held) { placeTrain(n, track); r.gong = false; return; }
    if (r.turn) {
      // (at its terminus: the motorman walks to the other end, and it goes back the way it came)
      const { front } = trainSpan(n);
      r.dir = -r.dir; r.s = front + r.dir * sp.rearOverhang; r.turn = false;
      r.next = nextStop(track, r);
    }
    r.phase = "run"; r.t = 0; r.departures++;
  }
  const { front, rear, dir } = trainSpan(n);
  // where it must stop: its next stop, the terminus, or short of whatever is in its way
  let to = Infinity, stopping = null;
  const stop = track.stops.find((st) => st.id === r.next);
  const end = dir > 0 ? track.length : 0, endKind = track.ends[dir > 0 ? 1 : 0];
  // (a stop within a car's length or so of the terminus is where it turns back)
  if (stop) { to = dir * (stop.s - front); stopping = endKind === "terminus" && dir * (end - stop.s) < sp.length + TERMINUS_STOP_M ? "terminus" : "stop"; }
  if (endKind === "terminus" && dir * (end - front) - 1 < to) { to = dir * (end - front) - 1; stopping = "terminus"; }
  const blocked = inTheWay(n, track, others, sees);
  if (blocked - CLEAR_M < to) { to = blocked - CLEAR_M; stopping = null; }
  const vWant = Math.min(LINE_MPS, Math.sqrt(2 * SERVICE_DECEL * Math.max(0, to)));
  const a = vWant > n.v ? Math.min(ACCEL, (vWant - n.v) / dt) : Math.max(-EMERGENCY_DECEL, (vWant - n.v) / dt);
  n.a = a;
  n.v = Math.max(0, n.v + a * dt);
  r.s += dir * n.v * dt;
  placeTrain(n, track);
  // ringing its gong on the way to a crossing, its front within GONG_M of the road
  r.gong = n.v > MOVING_MPS && track.crossings.some((c) => { const gap = dir * (c.s - front) - c.half_m; return gap > -c.half_m && gap <= GONG_M; });
  if (n.v < 0.05 && stopping && to < 0.6) {
    n.v = 0;
    Object.assign(r, { phase: "dwell", t: 0, dwell: between(stopping === "terminus" ? LAYOVER_S : DWELL_S), turn: stopping === "terminus" });
    if (stopping === "stop" || stop) r.next = nextStop(track, r, stop);
  }
  // (off the map's edge: gone)
  if (endKind === "edge" && dir * (rear - end) > -1) { r.gone = true; r.gong = false; }
}

// The first stop of `track` ahead of train state `r` (after stop `after`, when given): its id, or null.
function nextStop(track, r, after = null) {
  const sp = HERITAGE_STREETCAR, front = r.s + r.dir * (sp.length - sp.rearOverhang);
  const ahead = track.stops.filter((st) => r.dir * (st.s - front) > 2 && st !== after).sort((a, b) => r.dir * (a.s - b.s));
  return ahead[0]?.id ?? null;
}

// Put a train on `track`, its front `front` metres along it going `dir`, at `v`.
export function trainState(track, front, dir, v = 0) {
  const sp = HERITAGE_STREETCAR, r = { track: track.id, dir, s: front - dir * (sp.length - sp.rearOverhang), phase: "run", t: 0, dwell: 0, turn: false, departures: 0, gong: false, gone: false, held: false, next: null };
  r.next = nextStop(track, r);
  return { rail: r, v };
}

// Whether the driver `o` (heading as it is) is fouling crossing `c`'s track: some of its body within
// the train's envelope (sensing-free: the audit and the score).
export function fouling(o, c, map) {
  const track = railIndex(map).tracks.get(c.track), box = o.obb();
  if (Math.abs(box.center[0] - c.x) > 25 || Math.abs(box.center[1] - c.y) > 25) return false;
  const q = projectPoint(track.pts, track.cum, box.center, null);
  if (Math.abs(q.s - c.s) > NEAR_M) return false;
  const rel = o.psi - q.heading;
  return Math.abs(q.lateral) - (box.halfLength * Math.abs(Math.sin(rel)) + box.halfWidth * Math.abs(Math.cos(rel))) < ENVELOPE_M;
}

// The crossing a driver `o` is heading across, straight on as it heads, within `look` metres (or is
// fouling): { c, x (as crossingsAhead) }, or null (sensing-free: the audit and the HUD).
export function crossingAheadOf(o, map, look = 70) {
  const sp = o.spec, f = sp.length - sp.rearOverhang, front = sp.rearOverhang + 12 + f;
  const pts = [[o.x - Math.cos(o.psi) * (sp.rearOverhang + 12), o.y - Math.sin(o.psi) * (sp.rearOverhang + 12)], [o.x + Math.cos(o.psi) * (f + look), o.y + Math.sin(o.psi) * (f + look)]];
  const cum = cumulative(pts), x = crossingsAhead(map, pts, cum, front, sp, look)[0];
  return x ? { c: x.c, x, pts, cum, front } : null;
}

// What the HUD tells the driver of the car about the level crossing it is heading across, within
// 60 m: a train it hears or sees approaching it, or traffic past it that leaves no room: { key, text },
// or null.
export function crossingNotice(world) {
  const ego = world.ego, ahead = crossingAheadOf(ego, world.map, 60);
  if (!ahead || !waitsAt(ahead.x, ego.v)) return null;
  const { c, x } = ahead, at = trainAt(world.npcs, c), name = railIndex(world.map).tracks.get(c.track)?.kind === "tram" ? "STREETCAR" : "TRAIN";
  if (at && ((at.train.rail.gong && Math.hypot(at.train.x - ego.x, at.train.y - ego.y) < HEAR_M) || world.sees(ego, at.train))) {
    return { key: `${c.id}:${at.train.id}:${at.train.rail.departures}`, text: `LEVEL CROSSING · ${name} ${at.on ? "CROSSING" : "COMING"} · STOP 5 M BACK` };
  }
  const visible = world.npcs.filter((n) => world.sees(ego, n));
  return roomBlocker(ahead.pts, ahead.cum, ahead.front, ego.spec, x, visible, ego) ? { key: `${c.id}:room`, text: "LEVEL CROSSING · NO ROOM PAST THE TRACKS · WAIT SHORT OF THEM" } : null;
}
