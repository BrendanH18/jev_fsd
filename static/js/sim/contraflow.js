// Contraflow cyclists (World option `contraflow`): on one-way streets that cyclists may ride both
// ways (jev/osm/contraflow.py: a painted contraflow lane, or just a shared street), cyclists ride
// against the traffic at the left edge of the street (the driver's left; the right where the tags put
// the lane there), at cyclist speeds, stopping for the signals and stop signs that face their way.
// Each rides the street's contraflow blocks in turn, then crosses or turns onto another street and
// rides on until it is well away from the car, when another takes its place later.
//
// Everyone looks both ways for them. A driver turning into such a street, or going straight on into
// it, waits short of the junction while one is coming out of it; one crossing or turning off it waits
// for one as for oncoming traffic; and one driving along it moves over to the right for one coming the
// other way and, where that leaves less than the minimum passing distance (1 m at 50 km/h or less,
// 1.5 m above: sim/cyclist-pass.js), stops, moved over, until it has gone by. `riderConflict` is that
// test, shared by the driven car's sensing (brain/sensors.js contraflowCyclist), traffic (sim/npc.js)
// and the forward sims. The audit counts cutting one off as a failure to yield, and both that and
// meeting one closer than the minimum passing distance as `contraflow_conflicts`.
//
// With the option off nothing here is built, stepped or drawn from a random stream: no riders, and
// `world.obstaclesNear` and traffic see nothing new.

import { Vehicle, BIKE, comfort } from "./vehicle.js";
import { cumulative, pointAt, headingAt, joinLanes } from "../map/mapdata.js";
import { approachPhase, movementSignal } from "./signals.js";
import { rng } from "../common.js";
import { obbOverlap } from "./collision.js";
import { crosswalkConflict } from "./pedestrians.js";
import { current as weather } from "./weather.js";
import { purePursuit } from "./controller.js";
import { minPassM } from "./cyclist-pass.js";
import { NIGHT_CAUTION_MPS } from "./night-flash.js";
import { officerDirection } from "./traffic-officer.js";

// How many ride at a time in a free drive, and where they start: on a contraflow street this far
// from the car (or, failing that, anywhere on the map), and how long until the next one.
export const RIDERS = 3;
const START_M = [40, 260];
const RETIRE_M = 340;
const NEXT_S = [6, 20];
// They ride this far in from the asphalt's edge (or the parking lane's), centre of the bicycle.
export const RIDE_IN_M = 0.6;
// A painted contraflow lane is this wide (as drawn).
export const LANE_M = 1.5;
const COLORS = [0x0f766e, 0xb45309, 0x7c3aed, 0x1d4ed8, 0xbe123c];
// Riding: the IDM as for traffic's cyclists, slowing for bends and junctions it gives way at.
const IDM = { aMax: 1.0, b: 1.6, s0: 1.5, T: 1.0 };
const TURN_MPS = 3.5;
const YIELD_MPS = 3.0;
const BODY_LOOK_M = 10;
// At a junction it stops at, it goes once nothing moves within JUNCTION_R_M of the junction's centre
// and nothing heading for it would get there within COMING_S (from up to COMING_M away).
const JUNCTION_R_M = 11;
const COMING_S = 5;
const COMING_M = 70;
// How far along its way a rider is looked at for the conflict test, and how often.
export const RIDER_LOOK_M = 60;
const SAMPLE_M = 1;
// The conflict test: a vehicle crossing a rider's line clears it this long before or after it; one
// meeting it along the street passes it with the minimum passing distance, moving over to the right
// as far as RIGHT_MARGIN_M short of the asphalt's edge (not into a parking lane).
export const MARGIN_S = 1.5;
export const CROSS_SIDE_M = 0.5;
const RIGHT_MARGIN_M = 0.2;
const PULL_ACCEL = 2.0;
// A driver about to turn or go straight into a contraflow street it has not entered yet waits short
// of the junction (ENTRY_M short of the crossing street's asphalt) while a rider is coming out within
// ENTRY_LOOK_M of it.
const ENTRY_M = 1.5;
export const ENTRY_LOOK_M = 60;
// A driver moves over for one coming the other way once its way is within this far ahead.
const SHIFT_LOOK_M = 45;
// A rider held up this long by a vehicle standing in its way squeezes by (a driver that has not moved
// over far enough), or, out of the car's sight, rides off.
const BLOCKED_S = 6;
// Past a vehicle standing still facing it, a rider leaves at least this between them, at SQUEEZE_MPS.
const SQUEEZE_M = 0.1;
const SQUEEZE_MPS = 2;
// Squeezing by a vehicle standing face to face along a contraflow street, it may ride up to HUG_M nearer
// the kerb than its line, moving over at HUG_MPS.
const HUG_M = 0.2;
const HUG_MPS = 0.4;

export const isContraflowRider = (o) => !!o?.contra;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };

// The contraflow record of an edge (jev/osm/contraflow.py: { edge, kind, side }), or null.
export function contraflowOf(map, edgeId) { return map.contraflow?.get(edgeId) || null; }

// How far right of an edge's centreline a contraflow rider rides (negative: the left).
export function rideLateral(e, side = "left") {
  const park = e.parking || [0, 0];
  return side === "right" ? e.asphalt[1] - (park[1] || 0) - RIDE_IN_M : e.asphalt[0] + (park[0] || 0) + RIDE_IN_M;
}

// A polyline moved `d` metres right of travel.
function offsetLine(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
    out.push([pts[i][0] + Math.sin(h) * d, pts[i][1] - Math.cos(h) * d]);
  }
  return out;
}

// The line a contraflow rider rides along edge e, from its `to` end to its `from` end.
export function contraLine(e, side) { return offsetLine(e.pts, rideLateral(e, side)).reverse(); }

// Half the asphalt of the widest street meeting `node` other than `skip` edges' street.
function crossHalf(map, node, skip) {
  let w = 0;
  for (const id of [...(map.inn.get(node) || []), ...(map.out.get(node) || [])]) {
    const o = map.edges.get(id);
    if (skip.some((e) => (o.from === e.from && o.to === e.to) || (o.from === e.to && o.to === e.from))) continue;
    w = Math.max(w, Math.abs(o.asphalt[0]), Math.abs(o.asphalt[1]));
  }
  return w;
}

// What faces a rider coming out of contraflow edge e at its `from` end: a signal (the light of the
// approach on its street's axis), a stop sign (as the street's own traffic has from the other side;
// or, where the street ends at one that does not stop for it, there), "yield" (an uncontrolled
// junction it does not have the right of way at), "major" (the streets across stop for it), or null
// (no junction). `setback`: how far short of the junction's centre it stops.
export function contraControl(map, e) {
  const node = e.from, h = wrap(map.headingOut(e.id) + Math.PI);
  const inn = (map.inn.get(node) || []).map((id) => map.edges.get(id)).filter((o) => o.id !== e.id && !(o.from === e.to && o.to === e.from));
  const out = (map.out.get(node) || []).map((id) => map.edges.get(id));
  const neighbours = new Set([...inn.map((o) => o.from), ...out.map((o) => o.to)]);
  if (neighbours.size < 3) return null;
  const axis = (o) => Math.abs(Math.cos(map.headingIn(o.id) - h));
  const same = inn.filter((o) => axis(o) > Math.cos(Math.PI / 6)).sort((a, b) => axis(b) - axis(a))[0] || null;
  const half = crossHalf(map, node, [e, ...(same ? [same] : [])]);
  const setbackOf = (o) => (o?.control ? Math.max(2, o.length - o.control.s_line) : half + 1.5);
  const signals = inn.filter((o) => o.control?.type === "signal");
  if (signals.length) {
    const ref = signals.slice().sort((a, b) => axis(b) - axis(a))[0];
    return { type: "signal", id: ref.control.id, ref: ref.id, setback: axis(ref) > Math.cos(Math.PI / 6) ? setbackOf(ref) : half + 1.5, node };
  }
  if (same?.control?.type === "stop") return { type: "stop", id: `cf:${e.id}`, all_way: !!same.control.all_way, setback: setbackOf(same), node };
  const others = inn.filter((o) => o !== same);
  if (others.length && others.every((o) => o.control && o.control.type !== "signal")) return { type: "major", setback: half + 1.5, node };
  if (!same) return { type: "stop", id: `cf:${e.id}`, all_way: false, setback: half + 1.5, node };
  const rule = map.priorityOf(same.id)?.rule;
  return { type: rule === "major" ? "major" : "yield", rule: rule || "minor", setback: half + 1.5, node };
}

// A rider's way: polyline, cumulative lengths, `s` (rear axle) and its stretches (`segs`): each the
// edge it rides, `contra` against its traffic, the arc lengths it spans and the junction it ends at
// with what faces the rider there (`control`, with `line`: where its front stops).
export class RiderPath {
  constructor() { this.pts = []; this.cum = [0]; this.length = 0; this.s = 0; this.segs = []; }
  add(id, line, contra, control, node) {
    this.pts = joinLanes(this.pts, line);
    this.cum = cumulative(this.pts);
    const sStart = this.segs.length ? this.segs[this.segs.length - 1].sEnd : 0;
    this.length = this.cum[this.cum.length - 1];
    const seg = { id, contra, sStart, sEnd: this.length, node, control };
    if (control) seg.line = Math.max(sStart + 1, this.length - control.setback);
    this.segs.push(seg);
  }
  pointAt(s) { return pointAt(this.pts, this.cum, s); }
  headingAt(s) { return headingAt(this.pts, this.cum, s); }
  offsetPointAt(s, d) {
    const p = pointAt(this.pts, this.cum, s), h = headingAt(this.pts, this.cum, s);
    return [p[0] + Math.sin(h) * d, p[1] - Math.cos(h) * d];
  }
}

// The control of an ordinary edge, as a rider riding it with the traffic sees it at its `to` end.
function withControl(map, e) {
  if (e.control) return { ...e.control, setback: Math.max(2, e.length - e.control.s_line), ref: e.id, node: e.to };
  const p = map.priorityOf(e.id);
  if (!p) return null;
  return { type: p.rule === "major" ? "major" : "yield", rule: p.rule, setback: Math.max(2, e.length - p.s_line), node: e.to };
}

export class ContraflowRiders {
  constructor(world, { enabled = false, seed = 1, count = RIDERS } = {}) {
    this.world = world;
    this.enabled = !!enabled && !!world.map.contraflow?.size;
    this.riders = [];
    this.made = 0;
    this.target = this.enabled ? count : 0;
    // (their own stream, drawn from only while they ride)
    this.random = this.enabled ? rng(seed * 122949823 + 47) : null;
    this.next = 0;
  }

  // The contraflow blocks a rider coming in at edge e's `to` end rides in turn: e, then each
  // contraflow edge of the same street ending where the last began, straight on.
  chain(e) {
    const map = this.world.map, out = [e];
    for (let k = 0; k < 8; k++) {
      const last = out[out.length - 1], h = map.headingOut(last.id);
      const prev = (map.inn.get(last.from) || []).map((id) => map.edges.get(id))
        .find((o) => contraflowOf(map, o.id) && !out.includes(o) && Math.abs(wrap(map.headingIn(o.id) - h)) < Math.PI / 6);
      if (!prev) break;
      out.push(prev);
    }
    return out;
  }

  // An ordinary edge leaving `node` for a rider heading `h`: straight on where it can (most of the
  // time), else right, else left; never back.
  exitFrom(node, h, exclude = []) {
    const map = this.world.map;
    const outs = (map.out.get(node) || []).map((id) => map.edges.get(id)).filter((o) => !o.ring && !exclude.includes(o.id))
      .map((o) => ({ o, a: wrap(map.headingOut(o.id) - h) })).filter((x) => Math.abs(x.a) < Math.PI * 130 / 180);
    if (!outs.length) return null;
    const straight = outs.filter((x) => Math.abs(x.a) < Math.PI / 7), right = outs.filter((x) => x.a < 0 && !straight.includes(x));
    const pool = straight.length && this.random() < 0.7 ? straight : right.length && this.random() < 0.7 ? right : outs;
    return pool[Math.floor(this.random() * pool.length)].o;
  }

  // An ordinary edge's line for a rider: the curb lane, at its right-hand side.
  withLine(e) {
    const lane = this.world.map.lane(e.id, e.lanes - 1) || this.world.map.lane(e.id, 0);
    return offsetLine(lane.pts, Math.max(0, e.lane_width / 2 - 0.6));
  }

  // Build a rider's way from contraflow edge e: its blocks, then on across the last junction.
  buildPath(e) {
    const map = this.world.map, path = new RiderPath(), chain = this.chain(e);
    for (const c of chain) path.add(c.id, contraLine(c, contraflowOf(map, c.id).side), true, contraControl(map, c), c.from);
    const last = chain[chain.length - 1];
    const exit = this.exitFrom(last.from, wrap(map.headingOut(last.id) + Math.PI), chain.map((c) => c.id));
    if (exit) path.add(exit.id, this.withLine(exit), false, withControl(map, exit), exit.to);
    return path;
  }

  // Ride on from the end of the way: another ordinary edge, as traffic's cyclists pick theirs.
  extend(n) {
    const map = this.world.map, path = n.path, last = path.segs[path.segs.length - 1];
    if (last.contra || n.extended >= 3) return false;
    const e = map.edges.get(last.id);
    const next = this.exitFrom(e.to, map.headingIn(e.id));
    if (!next) return false;
    path.add(next.id, this.withLine(next), false, withControl(map, next), next.to);
    n.extended++;
    return true;
  }

  // A rider on contraflow edge `edgeId`, `at` metres in from its `to` end, at `v` (and keeping to
  // `v0`). Returns it, or null when it cannot be placed.
  place({ edge, at = 10, v = 4, v0 = null, color = null } = {}) {
    const map = this.world.map, e = map.edges.get(edge);
    if (!e || !contraflowOf(map, edge)) return null;
    const path = this.buildPath(e);
    const s = Math.max(0, Math.min(path.segs[0].sEnd - 2, at * (path.segs[0].sEnd / Math.max(1, e.length))));
    const p = path.pointAt(s), n = new Vehicle(p[0], p[1], path.headingAt(s), v, BIKE);
    path.s = s;
    Object.assign(n, { id: `contra_bike_${++this.made}`, kind: "bike", contra: true, color: color ?? COLORS[this.made % COLORS.length], path, v0: v0 ?? 4.2 + this.random() * 2.3,
      stopState: null, stopS: null, held: false, extended: 0, frozen: 0, blocked: 0, squeeze: null, gone: false, waitedOn: null, waited: 0 });
    this.riders.push(n);
    return n;
  }

  // Put one down on a contraflow street START_M from the car, clear of everyone. Returns it or null.
  spawn() {
    const map = this.world.map, ego = this.world.ego;
    const edges = [...map.contraflow.keys()].map((id) => map.edges.get(id)).filter((e) => e && e.length > 20);
    if (!edges.length) return null;
    const total = edges.reduce((a, e) => a + e.length, 0);
    for (let attempt = 0; attempt < 20; attempt++) {
      let pick = this.random() * total, e = edges[0];
      for (const x of edges) { pick -= x.length; if (pick <= 0) { e = x; break; } }
      const at = 3 + this.random() * Math.max(1, e.length * 0.7);
      const line = contraLine(e, contraflowOf(map, e.id).side), lc = cumulative(line), p = pointAt(line, lc, at);
      const d = Math.hypot(p[0] - ego.x, p[1] - ego.y);
      if (attempt < 14 && (d < START_M[0] || d > START_M[1])) continue;
      if (d < START_M[0]) continue;
      if (this.world.npcs.concat(this.riders).some((o) => Math.hypot(o.x - p[0], o.y - p[1]) < 8)) continue;
      return this.place({ edge: e.id, at, v: 3 + this.random() * 1.5 });
    }
    return null;
  }

  near(x, y, r) {
    if (!this.riders.length) return [];
    return this.riders.filter((n) => Math.abs(n.x - x) < r + 2 && Math.abs(n.y - y) < r + 2);
  }

  step(dt) {
    if (!this.enabled) return;
    const world = this.world, ego = world.ego;
    // (retire those that rode off, far from the car)
    for (const n of [...this.riders]) {
      const far = Math.hypot(n.x - ego.x, n.y - ego.y) > RETIRE_M;
      if (far || n.gone || (n.path.s >= n.path.length - 2 && !this.extend(n))) {
        this.riders.splice(this.riders.indexOf(n), 1);
        this.next = Math.max(this.next, world.t + NEXT_S[0] + this.random() * (NEXT_S[1] - NEXT_S[0]));
      }
    }
    if (this.riders.length < this.target && world.t >= this.next) {
      if (!this.spawn()) this.next = world.t + 10;
      else if (this.riders.length < this.target) this.next = world.t + 1;
    }
    for (const n of this.riders) this.ride(n, dt);
  }

  // Whether the junction at `node` is clear for a rider going on there: nothing moving within
  // JUNCTION_R_M of its centre, and nothing heading for it that would get there within COMING_S (with
  // `right`, where it gives way to the right, only what comes from its right).
  clear(n, node, right = false) {
    const world = this.world, c = world.map.nodes.get(node);
    if (!c) return true;
    const others = [world.ego, ...world.npcs, ...this.riders].filter((o) => o !== n && !o.parked && Math.abs(o.x - c.x) < COMING_M && Math.abs(o.y - c.y) < COMING_M);
    for (const o of others) {
      const spec = o.spec || BIKE, f = spec.length - spec.rearOverhang;
      const fx = o.x + Math.cos(o.psi) * f, fy = o.y + Math.sin(o.psi) * f, d = Math.hypot(c.x - fx, c.y - fy);
      if (d < JUNCTION_R_M && Math.abs(o.v) > 0.3) {
        // (one beside it, going its way, is not in its way)
        if (Math.abs(wrap(o.psi - n.psi)) < Math.PI / 6 && d > 4) continue;
        return false;
      }
      if (o.v < 1 || d > COMING_M) continue;
      const rel = wrap(o.psi - n.psi);
      if (right && !(rel > Math.PI / 4 && rel < Math.PI * 3 / 4)) continue;
      const closing = ((c.x - fx) * Math.cos(o.psi) + (c.y - fy) * Math.sin(o.psi)) / Math.max(d, 1e-6);
      if (closing > 0.7 && d / o.v < COMING_S && !(o.a < -0.5 && o.v * o.v / (-2 * o.a) < d - JUNCTION_R_M)) return false;
    }
    return true;
  }

  ride(n, dt) {
    const world = this.world, map = world.map, path = n.path;
    if (n.frozen > 0) { n.frozen -= dt; n.v = 0; return; }
    // (where it is along its way: near where it was)
    let best = null;
    for (let i = 0; i < path.pts.length - 1; i++) {
      if (path.cum[i + 1] < path.s - 4 || path.cum[i] > path.s + 6) continue;
      const [ax, ay] = path.pts[i], dx = path.pts[i + 1][0] - ax, dy = path.pts[i + 1][1] - ay, len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((n.x - ax) * dx + (n.y - ay) * dy) / (len * len)));
      const d = Math.hypot(n.x - ax - dx * t, n.y - ay - dy * t);
      if (!best || d < best.d) best = { s: path.cum[i] + t * len, d };
    }
    if (best) path.s = best.s;
    if (path.length - path.s < 40) this.extend(n);
    const spec = n.spec, front = path.s + spec.length - spec.rearOverhang;
    // what faces it at the next junction it reaches
    let stopAt = null, slow = Infinity;
    n.stopS = null;
    const seg = path.segs.find((g) => g.control && g.line >= front - 1 && g.sEnd > path.s - 1);
    if (seg) {
      const c = seg.control, toLine = seg.line - front, key = `${seg.id}:${c.type}`;
      if (n.stopState?.key !== key) n.stopState = { key, stopped: 0, done: false };
      const st = n.stopState, canStop = toLine > n.v * n.v / (2 * 2.5) + 0.3;
      if (c.type === "signal") {
        // (a dark signal, or one flashing red overnight, is a stop sign; flashing amber is a caution)
        // (a police officer directing traffic there: their direction, not the light's, sim/traffic-officer.js)
        const officer = world.officers?.list.length ? officerDirection(world, n, c.ref) : null;
        const light = officer ? (officer === "go" ? "green" : "red") : movementSignal(approachPhase(map.intersections.get(c.id), c.ref, world.t), "straight");
        const dark = !officer && (world.outages?.isDark(c.id) || light === "flashing_red");
        if (light === "flashing_amber") slow = Math.min(slow, NIGHT_CAUTION_MPS);
        if (dark) {
          if (!st.done) stopAt = toLine;
          else if (!this.clear(n, seg.node)) stopAt = Math.max(0, toLine);
        } else if (light === "red" || (light === "yellow" && canStop) || light === "arrow" || light === "arrow_yellow") stopAt = toLine;
        else if (toLine < 6 && !this.clear(n, seg.node) && canStop) stopAt = Math.max(0, toLine);
      } else if (c.type === "stop") {
        if (!st.done) stopAt = toLine;
        else if (!this.clear(n, seg.node)) stopAt = Math.max(0, toLine);
      } else if (c.type === "yield") {
        if (toLine < 12) slow = Math.min(slow, Math.sqrt(YIELD_MPS * YIELD_MPS + 2 * 1.5 * Math.max(0, toLine)));
        if (toLine < 8 && !this.clear(n, seg.node, c.rule === "equal") && canStop) stopAt = Math.max(0, toLine);
      } else if (c.type === "major") {
        if (toLine < 6 && toLine > 0 && !this.clear(n, seg.node) && canStop) stopAt = toLine;
      }
      // (a full stop: still at the line for 0.7 s)
      if (stopAt !== null && Math.abs(n.v) < 0.2 && toLine < 3) { st.stopped += dt; if (st.stopped >= 0.7) st.done = true; }
      // (what others see: where it will stop, while it means to)
      if (stopAt !== null) n.stopS = path.s + Math.max(0, stopAt) + spec.length - spec.rearOverhang;
    }
    // people on a crosswalk across its way
    const cw = crosswalkConflict(path.pts, path.cum, front - 2, front + 25, world.crowd, spec.width / 2 + 0.9);
    if (cw) stopAt = stopAt === null ? cw.s - front - 2 : Math.min(stopAt, cw.s - front - 2);
    // any body in its way just ahead: a car meeting it in a narrow street, one turning across it, a
    // cyclist, someone on foot
    if (n.squeeze && Math.hypot(n.squeeze.x - n.x, n.squeeze.y - n.y) > 15) n.squeeze = null;
    let gap = Infinity, leadV = n.v0, blocker = null, squeezing = false, hug = false;
    const reach = spec.width / 2 + 0.15;
    // (squeezing by, along a contraflow street, it may keep up to HUG_M nearer the kerb than its line:
    // which way that is, or 0)
    const seg0 = path.segs.find((g) => path.s < g.sEnd), kerb = seg0?.contra ? (contraflowOf(map, seg0.id)?.side === "right" ? -1 : 1) : 0;
    const bodies = [world.ego, ...world.npcs, ...this.riders, ...world.parked.near(n.x, n.y, BODY_LOOK_M + 6), ...world.parked.doorsNear(n.x, n.y, BODY_LOOK_M + 6), ...world.crowd.near(n.x, n.y, BODY_LOOK_M + 6)];
    for (const o of bodies) {
      if (o === n || o === n.squeeze || Math.abs(o.x - n.x) > BODY_LOOK_M + 8 || Math.abs(o.y - n.y) > BODY_LOOK_M + 8) continue;
      const b = o.obb(), c = Math.cos(b.heading), s = Math.sin(b.heading);
      // (a vehicle standing still facing it, moved over for it, or one it has waited for long enough: it
      // squeezes by, slowly, if it fits)
      const still = o.spec && Math.abs(o.v || 0) < 0.3 && (Math.abs(wrap(o.psi - n.psi)) > Math.PI * 2 / 3 || (n.waitedOn === o && n.waited > BLOCKED_S));
      const side = still ? spec.width / 2 + SQUEEZE_M : reach;
      // (one standing face to face that has not moved over far enough, the driven car stopped short of
      // where it meant to, say: by the kerb, where that fits)
      if (still && kerb && Math.abs(wrap(o.psi - n.psi)) > Math.PI * 2 / 3) {
        const blocks = (off) => {
          for (let d = 0; d <= BODY_LOOK_M; d += 0.5) {
            const [x, y] = path.offsetPointAt(Math.min(path.length, front + d), off), dx = x - b.center[0], dy = y - b.center[1];
            if (Math.abs(dx * c + dy * s) <= b.halfLength + side && Math.abs(dy * c - dx * s) <= b.halfWidth + side) return true;
          }
          return false;
        };
        if (blocks(0) && !blocks(kerb * HUG_M)) { hug = squeezing = true; continue; }
      }
      for (let d = 0; d <= BODY_LOOK_M && d < gap; d += 0.5) {
        const [x, y] = path.pointAt(Math.min(path.length, front + d)), dx = x - b.center[0], dy = y - b.center[1];
        if (still && d < 8 && Math.abs(dx * c + dy * s) <= b.halfLength + reach && Math.abs(dy * c - dx * s) <= b.halfWidth + reach + 0.6) squeezing = true;
        if (Math.abs(dx * c + dy * s) <= b.halfLength + side && Math.abs(dy * c - dx * s) <= b.halfWidth + side) { gap = d; leadV = Math.max(0, (o.v || 0) * Math.cos(o.psi - n.psi)); blocker = o; break; }
      }
    }
    // (how long it has been held up by the same vehicle standing in its way)
    const standing = blocker && blocker.spec && n.v < 0.2 && Math.abs(blocker.v || 0) < 0.2 && (stopAt === null || stopAt > gap + 1);
    if (standing) { if (n.waitedOn !== blocker) { n.waitedOn = blocker; n.waited = 0; } n.waited += dt; }
    else if (n.waitedOn && (Math.abs(n.waitedOn.v || 0) > 0.3 || Math.hypot(n.waitedOn.x - n.x, n.waitedOn.y - n.y) > 12)) { n.waitedOn = null; n.waited = 0; }
    // (held up, face to face, by a vehicle standing in its way, not the driven car: also where it means to
    // stop, as at a line a police officer holds it at, since a vehicle waiting there for it to go by
    // waits for good)
    const stuck = blocker && blocker !== world.ego && blocker.spec && n.v < 0.2 && Math.abs(blocker.v || 0) < 0.2 && Math.abs(wrap(blocker.psi - n.psi)) > Math.PI * 2 / 3;
    n.blocked = stuck ? (n.blocked || 0) + dt : 0;
    if (n.blocked > BLOCKED_S) {
      n.blocked = 0;
      if (!world.sees(world.ego, n)) { n.gone = true; return; }
      n.squeeze = blocker;
    }
    if (stopAt !== null && stopAt < gap) { gap = Math.max(0.05, stopAt); leadV = 0; }
    // bends: slow for a turn over the next 10 m
    const turn = Math.abs(wrap(path.headingAt(Math.min(path.length, path.s + 10)) - path.headingAt(path.s)));
    const v0 = Math.min(n.v0 * weather.speed, turn > 0.6 ? TURN_MPS : Infinity, slow, squeezing ? SQUEEZE_MPS : Infinity);
    let a;
    if (gap === Infinity) a = IDM.aMax * (1 - Math.pow(n.v / Math.max(0.1, v0), 4));
    else {
      const grip = Math.min(1, comfort().decel / 2.5), dv = n.v - leadV, T = IDM.T / Math.max(0.5, grip);
      const sStar = IDM.s0 * (gap < 3 && leadV === 0 && stopAt !== null && gap === Math.max(0.05, stopAt) ? 0.1 : 1) + Math.max(0, n.v * T + n.v * dv / (2 * Math.sqrt(IDM.aMax * IDM.b * grip)));
      a = IDM.aMax * (1 - Math.pow(n.v / Math.max(0.1, v0), 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
    }
    a = Math.max(-4, Math.min(IDM.aMax, a));
    if (n.v < 0.05 && a < 0) a = -1;
    n.held = stopAt !== null && n.v < 0.3;
    if (hug || n.hug) n.hug = (n.hug || 0) + Math.max(-HUG_MPS * dt, Math.min(HUG_MPS * dt, (hug ? kerb * HUG_M : 0) - (n.hug || 0)));
    n.step(dt, { steer: purePursuit(n, path, path.s, n.hug || 0), accel: a });
    if (n.v < 0) n.v = 0;
  }
}

// The conflict between a vehicle going along `line` ({ pts, cum }: its own path or route, its front at
// arc length `front`, its centre `lat` metres right of the line, `room(s)` how much further right it
// can move at arc length s) and contraflow rider `n`, if it went on now (pulling away at PULL_ACCEL up
// to `vMax`): the first arc length along the line its front must stay short of (`at`), whether that is
// meeting it along the street (`meet`) rather than crossing its way, when the rider gets there
// (`eta_s`) and when the vehicle would be clear (`need_s`); or null. Only the rider's way ahead, as
// far as it will go before a stop it means to make, counts; and only within `look` metres of the
// vehicle's front.
export function riderConflict(n, line, { front, spec, v, lat = 0, room = () => 0, vMax = 8, look = RIDER_LOOK_M, clearance = 1, margin = MARGIN_S, back = 0 }) {
  const path = n.path, bs = n.spec || BIKE, bf = path.s + bs.length - bs.rearOverhang;
  const stopAt = n.stopS !== null && n.stopS !== undefined ? n.stopS : Infinity;
  const vr = Math.max(n.v, 1.5);
  const lo = front - spec.length - back, hi = front + look;
  const meetReach = (spec.width + bs.width) / 2 + clearance, crossReach = (spec.width + bs.width) / 2 + CROSS_SIDE_M;
  // (time for the vehicle's front to cover d metres from now, pulling away from v)
  const travel = (d) => {
    if (d <= 0) return 0;
    const v0 = Math.max(0, v), top = Math.max(v0, vMax), dAcc = (top * top - v0 * v0) / (2 * PULL_ACCEL);
    if (d <= dAcc) return (Math.sqrt(v0 * v0 + 2 * PULL_ACCEL * d) - v0) / PULL_ACCEL;
    return (top - v0) / PULL_ACCEL + (d - dAcc) / top;
  };
  let hit = null, meetShift = 0;
  const { pts, cum } = line;
  for (let c = Math.max(path.s, bf - 1); c <= Math.min(path.length, bf + RIDER_LOOK_M); c += SAMPLE_M) {
    if (c > stopAt + 0.5) break;
    const [qx, qy] = path.pointAt(c), hq = path.headingAt(c);
    // (nearest point on the line between lo and hi)
    let bestD = Infinity, r = null, lateral = 0, hl = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      if (cum[i + 1] < lo || cum[i] > hi) continue;
      const [ax, ay] = pts[i], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay, len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const t = Math.max((lo - cum[i]) / len, 0, Math.min(1, (hi - cum[i]) / len, ((qx - ax) * dx + (qy - ay) * dy) / (len * len)));
      const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(qx - px, qy - py);
      if (d < bestD) { bestD = d; r = cum[i] + t * len; lateral = ((qx - px) * dy - (qy - py) * dx) / len; hl = Math.atan2(dy, dx); }
    }
    if (r === null || bestD > meetReach + 4) continue;
    const rel = Math.abs(wrap(hq - hl));
    // (going the same way along it: following, not a conflict)
    if (rel < Math.PI / 3) continue;
    const meet = rel > Math.PI * 2 / 3;
    const side = lateral - lat;
    let close;
    if (meet) {
      // (moving right takes it further from one on its left; nothing helps with one on its right)
      const sep = side < 0 ? -side + room(r) : side;
      close = sep < meetReach;
      if (side < 0 && -side < meetReach && r - front < SHIFT_LOOK_M) meetShift = Math.max(meetShift, Math.min(room(r), meetReach - -side + 0.1));
    } else close = Math.abs(side) < crossReach && bestD < crossReach + 1;
    if (!close) continue;
    const eta = Math.max(0, c - bf) / vr, gone = eta + (bs.length + (meet ? spec.length : spec.width)) / vr;
    const tIn = travel(r - front), tOut = travel(r - front + spec.length + (meet ? 0 : bs.width + 2 * CROSS_SIDE_M));
    if (tIn > gone + margin || tOut + margin < eta) continue;
    if (!hit || r < hit.at) hit = { at: r, meet, eta_s: eta, need_s: tOut, rider_s: c };
  }
  return hit ? { ...hit, shift: meetShift } : meetShift > 0 ? { at: null, meet: true, shift: meetShift } : null;
}

// How far a vehicle in lane `laneIdx` of edge e can move right of its lane's centre, short of the
// asphalt's edge (not into a parking lane).
export function roomRight(e, laneIdx, spec) {
  if (!e) return 0;
  const centre = e.lane_offsets?.[laneIdx] ?? 0, park = e.parking?.[1] || 0;
  return Math.max(0, e.asphalt[1] - park - (centre + spec.width / 2) - RIGHT_MARGIN_M);
}

// Where a driver whose way enters contraflow edge `edgeId` at arc length `start` (along its line)
// waits: ENTRY_M short of the crossing street's asphalt.
export function entryHold(map, edgeId, start) {
  const e = map.edges.get(edgeId);
  return start - crossHalf(map, e.from, [e]) - ENTRY_M;
}

// Where the junction a driver enters contraflow edge `edgeId` through ends (arc length along its line,
// the edge starting at `start`): the far side of the crossing street's asphalt.
function junctionFar(map, edgeId, start) {
  const e = map.edges.get(edgeId);
  return start + crossHalf(map, e.from, [e]);
}

// Where traffic on NpcPath `path` waits before entering contraflow edge `en` ({ id, start }): at the line of
// the signal on the edge it comes in on, where there is one, or else (and never nearer) at `entryHold`.
function entryWait(map, path, en) {
  const i = path.edges.findIndex((g) => g.id === en.id), prev = i > 0 ? path.edges[i - 1] : null;
  const hold = entryHold(map, en.id, en.start), c = prev?.control;
  if (c?.type !== "signal") return hold;
  return Math.min(hold, prev.sStart + (c.s_line / Math.max(1, map.edges.get(prev.id).length)) * (prev.sEnd - prev.sStart));
}

// The contraflow edges along a vehicle's way that it enters within `look` metres of its front (not
// the one it is on): [{ id, start }] (start: the arc length where it begins).
export function entriesAhead(map, edges, front, look = ENTRY_LOOK_M) {
  const out = [];
  for (const e of edges) if (contraflowOf(map, e.id) && e.sStart > front - 2 && e.sStart < front + look) out.push({ id: e.id, start: e.sStart });
  return out;
}

// Whether rider `n` is on (or coming out of) contraflow edge `edgeId`, riding against it, within
// ENTRY_LOOK_M of its `from` end, and not stopping short of it: then a driver about to enter that
// street waits for it.
export function comingOut(n, edgeId) {
  const seg = n.path.segs.find((g) => g.id === edgeId && g.contra);
  if (!seg) return false;
  const front = n.path.s + n.spec.length - n.spec.rearOverhang;
  if (front > seg.sEnd + 8 || seg.sEnd - front > ENTRY_LOOK_M) return false;
  if (n.stopS !== null && n.stopS < seg.sStart) return false;
  return n.v > 0.3 || !n.held;
}

// Traffic (sim/npc.js): where driver `d` waits for a contraflow rider (arc length along its path for
// its front, or null) and how far right it moves for one coming the other way.
export function trafficYield(world, d, front) {
  const riders = world.contraflow?.riders;
  if (!riders?.length) return null;
  const map = world.map, path = d.path, spec = d.spec;
  const cur = path.currentEdge(), e = map.edges.get(cur.id);
  const lat = (d.side || 0);
  // (the room on the street where it would meet the rider, which may be a narrower one it turns into)
  const room = (r) => {
    const g = path.edges.find((x) => r < x.sEnd) || cur;
    return roomRight(map.edges.get(g.id), g.lane, spec);
  };
  const entries = entriesAhead(map, path.edges, front);
  const stopping = d.v * d.v / (2 * Math.min(4, comfort().hardDecel)) - 1;
  let hold = null, shift = 0;
  for (const n of riders) {
    if (Math.abs(n.x - d.x) > RIDER_LOOK_M + 20 || Math.abs(n.y - d.y) > RIDER_LOOK_M + 20) continue;
    const c = riderConflict(n, path, { front, spec, v: d.v, lat, room, vMax: Math.min(e.limit, 8), clearance: minPassM(e.limit) });
    if (!c) continue;
    shift = Math.max(shift, c.shift || 0);
    if (c.at === null) continue;
    let at = c.at - (c.meet ? 3 : 1);
    for (const en of entries) {
      if (front >= en.start) continue;
      // (about to enter its street: short of the junction instead)
      if (comingOut(n, en.id)) at = Math.min(at, entryHold(map, en.id, en.start));
      // (meeting it just inside the street it turns into, one standing at its line say, where waiting for it
      // would leave the car's body in the junction: before the junction instead, at the line of a signal it
      // comes through, out of the box, as for a junction with no room past it (sim/junction-box.js); once it
      // can still stop there)
      else if (c.meet && c.at >= en.start && at - spec.length < junctionFar(map, en.id, en.start)) {
        const wait = entryWait(map, path, en);
        if (wait - front > stopping) at = Math.min(at, wait);
      }
    }
    if (hold === null || at < hold) hold = at;
  }
  return hold === null && shift === 0 ? null : { hold, shift };
}

// The audit (World.audit): a contraflow rider near the car (`World.contraflowSeen`); meeting one with
// less than the minimum passing distance while moving; cutting one off (a failure to yield, as in
// World.auditCyclists: the car's front in its way ahead of it, within 2 s). Both are
// `contraflow_conflicts`.
const AUDIT_NEAR_M = 30;
const AUDIT_YIELD_S = 2;
const AUDIT_AGAIN_S = 10;
const AUDIT_SLACK_M = 0.1;
export function auditContraflow(world, frontOnPath) {
  const riders = world.contraflow?.riders;
  if (!riders?.length) return;
  const ego = world.ego, FRONT = ego.spec.length - ego.spec.rearOverhang;
  const fx = ego.x + Math.cos(ego.psi) * FRONT, fy = ego.y + Math.sin(ego.psi) * FRONT;
  const calls = world.contraflowCalls ||= new Map();
  const v = world.violations;
  const count = (ev) => { v.contraflow_conflicts = (v.contraflow_conflicts || 0) + 1; world.events.push(ev); };
  for (const n of riders) {
    if (Math.abs(n.x - ego.x) > AUDIT_NEAR_M + 10 || Math.abs(n.y - ego.y) > AUDIT_NEAR_M + 10) continue;
    if (Math.hypot(n.x - ego.x, n.y - ego.y) < AUDIT_NEAR_M) world.contraflowSeen = true;
    const call = calls.get(n.id) || { cut: -Infinity, met: false };
    calls.set(n.id, call);
    // meeting: going the other way, side by side
    const local = ego.toLocal(n.x, n.y), rel = Math.abs(wrap(n.psi - ego.psi));
    const centre = local.ahead - (ego.spec.length / 2 - ego.spec.rearOverhang) - ((n.spec.length / 2 - n.spec.rearOverhang) * Math.cos(n.psi - ego.psi));
    const beside = Math.abs(centre) < (ego.spec.length + n.spec.length) / 2;
    if (rel > Math.PI * 2 / 3 && beside && n.v > 0.5 && ego.v > 1) {
      const gap = Math.abs(local.right) - (ego.spec.width + n.spec.width) / 2, min = minPassM(world._road?.limit ?? world.roadInfo().limit);
      if (gap < min - AUDIT_SLACK_M && !call.met) {
        call.met = true;
        count({ type: "contraflow_conflict", with: n.id, meeting: true, clearance_m: Math.round(gap * 100) / 100, min_m: min });
      }
    }
    if (!beside && centre < 0) call.met = false;
    // cutting it off
    if (n.v < 1 || ego.v < 0.5 || world.t - call.cut < AUDIT_AGAIN_S) continue;
    const p = frontOnPath(ego, n, fx, fy);
    if (!p || p.along || p.ahead_m / n.v >= AUDIT_YIELD_S) continue;
    if (n.stopS !== null && n.path.s + p.ahead_m > n.stopS) continue;
    call.cut = world.t;
    v.failed_to_yield++;
    count({ type: "failed_to_yield", to: "contraflow cyclist", with: n.id, contraflow: true });
  }
}

// What the HUD says about a contraflow rider the car is waiting for or moving over for, or null.
export function contraflowNotice(world, snap) {
  const c = snap?.contraflow_cyclist;
  if (!c) return null;
  if (c.wait) return { key: `${c.cyclist_id}:wait`, text: c.relation === "oncoming" ? "CYCLIST COMING THE OTHER WAY · NO ROOM · WAIT" : "CYCLIST RIDING AGAINST THE ONE-WAY · GIVE WAY", wait: true };
  if (c.shift_m > 0.05) return { key: `${c.cyclist_id}:shift`, text: `ONCOMING CYCLIST · MOVE OVER · ${c.min_pass_m} M`, wait: false };
  return null;
}
