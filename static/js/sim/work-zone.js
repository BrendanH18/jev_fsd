// Work zones with a flagger (Ontario Highway Traffic Act s. 146.1; the Ontario Traffic Manual, Book 7):
// a road crew closes one lane of a two-way street with one lane each way, and two traffic control
// persons, one at each end of the work, take turns letting each direction through the lane that is
// left. A driver facing the STOP side of the paddle stops before reaching the flagger and does not go
// on until it turns to SLOW; under SLOW it goes on with caution. The direction whose lane is closed
// drives round the work in the other lane.
//
// Along the closed lane's street (its own `s`, from where it starts) a zone runs, in order: the closed
// direction's stop line (`a`, where its flagger stands on the sidewalk), LINE_M to where it starts
// moving across (`d0`), TAPER_M over which it does (cones angle across the closed lane), CLEAR_M, the
// closed stretch itself (`r` to `f`: the crew's truck and cones, a WORK_M long rectangle over the
// closed lane and its parking lane, a parked obstacle like any other, so collisions, traffic and the
// car's predictions already treat it as solid), CLEAR_M, TAPER_M back, and LINE_M on to the other
// direction's stop line (`b`, its flagger on the sidewalk opposite). From `d0` to `d1` there is one
// lane: the one-lane section.
//
// The flaggers keep one side on SLOW (`phase` "open", the direction whose lane is open, or "closed")
// for at least SLOW_MIN_S, then turn both paddles to STOP once someone is waiting at the other end
// and nobody more is coming on this one, or after SLOW_MAX_S. Both stay on STOP (`phase` "clear") for
// at least CLEAR_S and until nothing is left in the one-lane section or on its way into it too close
// to stop, and then the other side gets SLOW. A challenge can hold a phase (`held`).
//
// Everyone in a zone keeps to WZ_LIMIT_MPS, never above the street's limit, from their stop line to
// the end of the one-lane section. A driver still short of its stop line when its paddle turns to STOP
// stops there if it could, braking at no more than OWED_DECEL; one too close to stop goes on through,
// and the flaggers wait for it. Traffic, buses and cyclists all do (sim/npc.js); the driven car's
// sensing reports `work_zone` (brain/sensors.js), and the audit counts going past STOP once owed as a
// missed stop (sim/world.js).
//
// In a free drive one zone stands at a time, somewhere 150 to 450 m from the car where it cannot see
// it, for 4 to 8 minutes, then packs up once the car is well away and nothing is in its one-lane
// section (WorkZones; `?workzones=0` takes them off). Zones go only on straight blocks without a
// marked crosswalk, a bus or streetcar route, or a level crossing, clear of the junctions at each end.

import { Vehicle, CAR } from "./vehicle.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { rng } from "../common.js";
import { railIndex } from "./rail.js";

export const WZ_LIMIT_MPS = 30 / 3.6;
export const LINE_M = 6;
export const TAPER_M = 30;
export const CLEAR_M = 2;
export const WORK_M = 24;
export const SPAN_M = 2 * (LINE_M + TAPER_M + CLEAR_M) + WORK_M;
const END_M = 20;            // the zone's stop lines are at least this far from a junction or its stop line
const STRAIGHT_RAD = 0.08;   // the street's heading varies no more than this along the zone
export const SIGN_M = 50;    // the "flagger ahead" sign, this far before each stop line
export const SLOW_MIN_S = 10;
export const SLOW_MAX_S = 25;
export const CLEAR_S = 2;
export const OWED_DECEL = 3.5;
export const WAIT_LOOK_M = 60;    // someone this far short of a stop line, or nearer, is waiting at it
const COMING_LOOK_M = 40;         // and on the side with SLOW, this near is still coming
const SIDEWALK_M = 0.7;           // the flaggers stand this far beyond the asphalt's edge
// Free drive: how many stand at once, where they turn up, for how long, and how far away the car must
// be before one leaves.
export const WORK_ZONE_COUNT = 1;
const SPAWN_M = [150, 450];
const STAY_S = [240, 480];
const LEAVE_M = 150;
const RETRY_S = 5;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Whose paddle shows what: "slow" or "stop", for the side ("closed" or "open") whose lane it is.
export const paddle = (z, side) => z.phase === side ? "slow" : "stop";
// Which time this is that a side's paddle has turned to STOP (it starts on STOP for the side without
// SLOW): a driver owes each such stop once.
export const stopKey = (z, side) => `${z.id}:${side}:${z.stops[side]}`;
export const sideOf = (z, edgeId) => edgeId === z.closed ? "closed" : edgeId === z.open ? "open" : null;
export const isWorkZone = (o) => !!o && o.workzone === true;

// Where things are for a side, in that side's own edge `s`: its stop line, the one-lane section, and
// its flagger's sign.
export function marksOn(z, side) {
  const L = z.length;
  return side === "closed" ? { line: z.a, from: z.d0, to: z.d1, sign: z.a - SIGN_M }
    : { line: L - z.b, from: L - z.d1, to: L - z.d0, sign: L - z.b - SIGN_M };
}

// The detour round the closed stretch, in the closed edge's `s` (sim/controller.js detourAt).
export const detourOf = (z) => ({ from: z.d0, full: z.d0 + TAPER_M, back: z.d1 - TAPER_M, to: z.d1, shift: z.shift });

// Whether a driver at `v`, `d` metres short of a stop line, could stop there braking at OWED_DECEL.
export const canStopFor = (v, d) => v < 0.5 || d >= v * v / (2 * OWED_DECEL);

// The blocks a zone can go on: a two-way street with one lane each way (each direction's edge), long
// and straight enough, where `closed` is the edge whose lane is closed and `open` the other, and
// [lo, hi] the range its closed-side stop line can take.
const siteCache = new WeakMap();
export function workZoneSites(map) {
  if (siteCache.has(map)) return siteCache.get(map);
  const routed = new Set();
  for (const route of map.transit?.routes || []) for (const run of route.runs || []) for (const id of run.edges || []) routed.add(id);
  for (const c of railIndex(map).crossings) for (const on of c.edges) routed.add(on.edge);
  const crossed = new Set((map.crosswalks || []).map((c) => c.edge));
  const sites = [];
  for (const e of map.edges.values()) {
    if (e.oneway || e.lanes !== 1 || e.ring || routed.has(e.id) || crossed.has(e.id)) continue;
    const o = (map.out.get(e.to) || []).map((id) => map.edges.get(id)).find((x) => x.to === e.from && x.lanes === 1 && !x.oneway && Math.abs(x.length - e.length) < 1);
    if (!o || routed.has(o.id) || crossed.has(o.id)) continue;
    const L = e.length;
    const lo = Math.max(END_M, L - (o.control?.s_line ?? L) + END_M), hi = Math.min(L - END_M, (e.control?.s_line ?? L) - END_M) - SPAN_M;
    if (hi < lo) continue;
    const h0 = headingAt(e.pts, e.cum, lo);
    let straight = true;
    for (let s = lo; s <= hi + SPAN_M && straight; s += 4) straight = Math.abs(wrap(headingAt(e.pts, e.cum, s) - h0)) < STRAIGHT_RAD;
    if (straight) sites.push({ closed: e.id, open: o.id, lo, hi });
  }
  sites.sort((a, b) => String(a.closed).localeCompare(String(b.closed)));
  siteCache.set(map, sites);
  return sites;
}

// A point `lat` metres right of edge `e`'s centre line, `s` along it.
function at(e, s, lat) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat];
}

// The extent of vehicle `v`'s body along edge `e` ([lo, hi] in its `s`) and how far right of its
// centre line it is, or null when it is off the street.
function along(e, v) {
  const s = v.spec || CAR, c = Math.cos(v.psi), n = Math.sin(v.psi);
  const p = projectPoint(e.pts, e.cum, [v.x, v.y], null);
  if (!p || Math.abs(p.lateral) > Math.max(-e.asphalt[0], e.asphalt[1]) + 1.5) return null;
  const rear = projectPoint(e.pts, e.cum, [v.x - c * s.rearOverhang, v.y - n * s.rearOverhang], null).s;
  const front = projectPoint(e.pts, e.cum, [v.x + c * (s.length - s.rearOverhang), v.y + n * (s.length - s.rearOverhang)], null).s;
  return { lo: Math.min(rear, front), hi: Math.max(rear, front), front, lateral: p.lateral, heading: wrap(v.psi - headingAt(e.pts, e.cum, p.s)) };
}

export class WorkZones {
  constructor(world, { count = 0, seed = 1 } = {}) {
    this.world = world;
    this.count = count;
    this.random = rng(seed * 15485867 + 29);
    this.zones = [];
    this.made = 0;
    // (the first is put up on the first step, once the car and the traffic are where they start)
    this.next = 0;
  }

  step(dt) {
    for (const z of this.zones) this.control(z, dt);
    if (!this.count) return;
    const ego = this.world.ego;
    for (const z of [...this.zones]) {
      z.left -= dt;
      if (z.left <= 0 && Math.hypot(z.x - ego.x, z.y - ego.y) > LEAVE_M && !this.seen(z) && !this.occupied(z)) this.retire(z);
    }
    if (this.zones.length < this.count && (this.next -= dt) <= 0) { this.next = RETRY_S; this.spawn(); }
  }

  // The flaggers: SLOW for one side, then STOP for both until the one-lane section is clear, then SLOW
  // for the other.
  control(z, dt) {
    z.t += dt;
    if (z.phase === "clear") {
      if (z.t >= CLEAR_S && !this.occupied(z)) this.turn(z, z.next);
      return;
    }
    if (z.held) return;
    const other = z.phase === "open" ? "closed" : "open";
    if (z.t >= SLOW_MIN_S && this.waiting(z, other, WAIT_LOOK_M) && (!this.waiting(z, z.phase, COMING_LOOK_M) || z.t >= SLOW_MAX_S)) {
      z.next = other;
      this.turn(z, "clear");
    }
  }

  turn(z, phase) {
    const was = { closed: paddle(z, "closed"), open: paddle(z, "open") };
    z.phase = phase;
    z.t = 0;
    z.changes++;
    for (const side of ["closed", "open"]) if (was[side] === "slow" && paddle(z, side) === "stop") z.stops[side]++;
  }

  // Everyone moving on the street, the car included: { v, side, body } for each.
  movers(z) {
    const world = this.world, e = world.map.edges.get(z.closed), out = [];
    for (const v of [world.ego, ...(world.npcs || [])]) {
      if (v.rail || Math.abs(v.x - z.x) > SPAN_M + 40 || Math.abs(v.y - z.y) > SPAN_M + 40) continue;
      const body = along(e, v);
      if (body) out.push({ v, body, side: Math.abs(body.heading) < Math.PI / 2 ? "closed" : "open" });
    }
    return out;
  }

  // Anyone in the one-lane section (any part of them between `d0` and `d1`), or on their way into it
  // and committed: moving, and past their stop line or too close to it to stop there.
  occupied(z) {
    return this.movers(z).some(({ v, body, side }) => {
      if (body.hi > z.d0 && body.lo < z.d1) return true;
      const toLine = side === "closed" ? z.a - body.front : body.front - z.b, toSection = toLine + LINE_M;
      return toSection > 0 && toLine > -LINE_M && v.v > 0.5 && (toLine < 0 || !canStopFor(v.v, toLine));
    });
  }

  // Someone heading into the zone on `side`, its front within `look` metres short of its stop line
  // (or up to a metre past it, waiting).
  waiting(z, side, look) {
    return this.movers(z).some(({ body, side: s }) => {
      if (s !== side) return false;
      const short = side === "closed" ? z.a - body.front : body.front - z.b;
      return short > -1 && short < look;
    });
  }

  // Whether the car can see either flagger or the closed stretch.
  seen(z) {
    const vis = this.world.visibility, ego = this.world.ego;
    return [z.flaggers.closed, z.flaggers.open, [z.x, z.y]].some((p) => vis.canSee(ego, p[0], p[1]));
  }

  // A free-drive zone on a block SPAWN_M from the car and out of its sight, with nothing on the street
  // within it, and no stop at the roadside there: whoever is parked along it leaves.
  spawn() {
    const world = this.world, map = world.map, ego = world.ego, sites = workZoneSites(map);
    if (!sites.length) return null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const site = sites[Math.floor(this.random() * sites.length)];
      if (this.zones.some((z) => z.closed === site.closed || z.closed === site.open)) continue;
      const a = site.lo + this.random() * (site.hi - site.lo), e = map.edges.get(site.closed);
      const mid = at(e, a + SPAN_M / 2, 0), d = Math.hypot(mid[0] - ego.x, mid[1] - ego.y);
      if (d < SPAWN_M[0] || d > SPAWN_M[1] || world.visibility.canSee(ego, mid[0], mid[1])) continue;
      const probe = { x: mid[0], y: mid[1], d0: a - LINE_M - 5, d1: a + SPAN_M + 5, closed: site.closed };
      if (this.movers(probe).some(({ body }) => body.hi > probe.d0 && body.lo < probe.d1)) continue;
      if (this.bays(site.closed, site.open, probe.d0, probe.d1).some((b) => b.reserved || b.occupant?.stay || b.occupant?.door)) continue;
      return this.place({ closed: site.closed, open: site.open, a, stay: STAY_S[0] + this.random() * (STAY_S[1] - STAY_S[0]) });
    }
    return null;
  }

  // The parking bays along edges `closed` and `open` between `lo` and `hi` (in the closed edge's `s`).
  bays(closed, open, lo, hi) {
    const map = this.world.map, e = map.edges.get(closed), L = e.length;
    return this.world.parked.slots.filter((slot) => {
      if (slot.edge !== closed && slot.edge !== open) return false;
      const s = projectPoint(e.pts, e.cum, [slot.x, slot.y], null).s;
      return s + 3 > lo && s - 3 < hi && s >= 0 && s <= L;
    });
  }

  // A zone with the lane of edge `closed` shut, its closed-side stop line `a` metres along it, starting
  // on SLOW for `phase` ("open" or "closed"). Returns it.
  place({ closed, open, a, phase = "open", stay = Infinity }) {
    const world = this.world, map = world.map, e = map.edges.get(closed), o = map.edges.get(open), n = ++this.made;
    const d0 = a + LINE_M, r = d0 + TAPER_M + CLEAR_M, f = r + WORK_M, d1 = f + CLEAR_M + TAPER_M, b = d1 + LINE_M;
    // the closed stretch: the closed lane and any parking lane beside it, from just right of the centre line
    const lo = 0.15, hi = e.asphalt[1] - 0.1, h = headingAt(e.pts, e.cum, r);
    const spec = { ...CAR, kind: "work_zone", length: WORK_M, width: hi - lo, rearOverhang: 0, wheelbase: WORK_M, mass: 0 };
    const [x, y] = at(e, r, (lo + hi) / 2);
    const closure = new Vehicle(x, y, h, 0, spec);
    const id = `workzone_${n}`;
    Object.assign(closure, { id, kind: "work_zone", workzone: true, stay: true, edge: closed, curb: "right" });
    const [cx, cy] = at(e, (r + f) / 2, 0);
    const z = {
      id, closed, open, length: e.length, a, d0, r, f, d1, b, x: cx, y: cy, heading: h,
      // (from the closed lane's centre to the open one's, in the closed edge's frame)
      shift: -((e.lane_offsets?.[0] ?? e.lane_width / 2) + (o.lane_offsets?.[0] ?? o.lane_width / 2)),
      closure, phase, next: null, t: 0, changes: 0, stops: { closed: 0, open: 0 }, held: false, left: stay, bays: [],
      flaggers: { closed: at(e, a + 1.5, e.asphalt[1] + SIDEWALK_M), open: at(e, b - 1.5, e.asphalt[0] - SIDEWALK_M) },
      signs: { closed: a - SIGN_M > 2 ? at(e, a - SIGN_M, e.asphalt[1] + SIDEWALK_M) : null, open: b + SIGN_M < e.length - 2 ? at(e, b + SIGN_M, e.asphalt[0] - SIDEWALK_M) : null },
    };
    for (const slot of this.bays(closed, open, a - 5, b + 5)) {
      if (slot.occupant) world.parked.remove(slot.occupant);
      slot.reserved = closure;
      z.bays.push(slot);
    }
    world.parked.add(closure);
    this.zones.push(z);
    return z;
  }

  retire(z) {
    this.world.parked.remove(z.closure);
    for (const slot of z.bays) if (slot.reserved === z.closure) slot.reserved = null;
    this.zones.splice(this.zones.indexOf(z), 1);
  }

  // The zone the driven car is going through, on a street limited to `limit`: { zone, side, limit (the
  // speed to keep to) } from its front at the stop line to the end of the one-lane section, going its
  // way along the street, or null. Sensing-free, for the coaching score.
  passing(limit) {
    const ego = this.world.ego, map = this.world.map, front = ego.spec.length - ego.spec.rearOverhang;
    for (const z of this.zones) {
      if (Math.abs(ego.x - z.x) > SPAN_M || Math.abs(ego.y - z.y) > SPAN_M) continue;
      for (const side of ["closed", "open"]) {
        const e = map.edges.get(z[side]), p = projectPoint(e.pts, e.cum, [ego.x, ego.y], null), m = marksOn(z, side);
        if (!p || p.lateral < e.asphalt[0] - 1 || p.lateral > e.asphalt[1] + 1 || Math.abs(wrap(ego.psi - p.heading)) > Math.PI / 3) continue;
        if (p.s + front >= m.line && p.s + front <= m.to) return { zone: z, side, limit: Math.min(limit, WZ_LIMIT_MPS) };
      }
    }
    return null;
  }

  // Whether point (x, y) is on the street inside a zone (from a stop line to the other): nobody is
  // put there.
  covers(x, y) {
    const map = this.world.map;
    return this.zones.some((z) => {
      if (Math.abs(x - z.x) > SPAN_M || Math.abs(y - z.y) > SPAN_M) return false;
      const e = map.edges.get(z.closed), p = projectPoint(e.pts, e.cum, [x, y], null);
      return p && p.s > z.a - 8 && p.s < z.b + 8 && p.lateral > e.asphalt[0] - 1 && p.lateral < e.asphalt[1] + 1;
    });
  }

  // The zone a vehicle on edge `edgeId` is in or coming up to, with its side, or null.
  on(edgeId) {
    for (const z of this.zones) { const side = sideOf(z, edgeId); if (side) return { zone: z, side }; }
    return null;
  }
}

// What the HUD tells the driver of the car about a work zone ahead on its street, from NOTICE_M short
// of its stop line (once it can see its flagger) to the end of the one-lane section: what the paddle
// shows it, and, where its lane is closed, to go round. { key, text }, or null.
const NOTICE_M = 80;
export function workZoneNotice(world) {
  const ego = world.ego, map = world.map, front = ego.spec.length - ego.spec.rearOverhang;
  for (const z of world.workZones?.zones || []) {
    if (Math.abs(ego.x - z.x) > SPAN_M + NOTICE_M || Math.abs(ego.y - z.y) > SPAN_M + NOTICE_M) continue;
    for (const side of ["closed", "open"]) {
      const e = map.edges.get(z[side]), p = projectPoint(e.pts, e.cum, [ego.x, ego.y], null), m = marksOn(z, side);
      if (!p || p.lateral < e.asphalt[0] - 1 || p.lateral > e.asphalt[1] + 1 || Math.abs(wrap(ego.psi - p.heading)) > Math.PI / 3) continue;
      const at = p.s + front;
      if (at < m.line - NOTICE_M || at > m.to || (at < m.line && !world.visibility.canSee(ego, ...z.flaggers[side]))) continue;
      const shows = paddle(z, side), round = side === "closed" ? " · GO ROUND IT" : "";
      return { key: `${z.id}:${z.changes}`, stop: shows === "stop",
        text: shows === "stop" && at < m.from ? "WORK ZONE · FLAGGER SHOWS STOP · WAIT AT THE LINE" : `WORK ZONE · SLOW · ${Math.round(Math.min(e.limit, WZ_LIMIT_MPS) * 3.6)} · ONE LANE${round}` };
    }
  }
  return null;
}
