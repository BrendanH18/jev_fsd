// Lane closures and the zipper merge. A road crew closes the curb lane of a street with two lanes going
// its way, with cones, a truck and a flashing arrow board but no flagger, and traffic from the closed lane
// merges into the open one where the lane ends. Manitoba's driver's handbook (Manitoba Public Insurance)
// teaches the zipper merge, and the City of Winnipeg signs it at lane closures; Ontario cities (Windsor,
// Brantford, Greater Sudbury) and police ask for it too, and the Alberta Motor Association says merging
// late is right: use both lanes right up to the merge point, then take turns, one vehicle from each lane.
// Don't cut in out of turn, and don't close the gap on someone whose turn it is. (Brantford allows an
// early merge in light traffic where it slows nobody; here everyone keeps its lane to the merge point.)
//
// Along the closed lane's edge (its own `s`) a zone runs, in order: AHEAD_M before it the "right lane
// closed ahead" sign, the merge point `m` (where the cones start to angle across the closed lane, and
// where a driver in it waits for its turn), TAPER_M over which the closed lane's traffic moves across
// into the open lane, CLEAR_M, the closed stretch itself (`r` to `f`: the crew's truck and cones, a
// WORK_M long rectangle over the closed lane and any parking lane beside it, a parked obstacle like any
// other, so collisions, traffic and the car's predictions already treat it as solid), CLEAR_M, and
// TAPER_M back to the end of the zone (`to`), where the lane opens again. From AHEAD_M short of the
// merge point to the end, nobody changes lanes into or out of the closed lane: that is the zipper.
//
// Taking turns (LaneClosures.control): each driver's lane is noted while it is short of the merge
// point. The one in the closed lane nearest the merge point, within HEAD_M of it, is at the merge (the
// `head`). It is the closed lane's turn when the last driver through the merge point came from the
// open lane, or when nobody in the open lane is coming within COMING_M of it; otherwise it is the open
// lane's. On the closed lane's turn the head is let in (`grant`) once the open lane is clear beside it
// and whoever comes up behind it can stop short of it: until then, and on the open lane's turn, it
// waits at the merge point (a driver decides there, within HEAD_M of it: further back it drives on up
// its lane). A driver in the open lane lets it in, stopping its front LET_IN_M short of
// the merge point, and behind its rear, if it can do so braking at LET_IN_DECEL; one too close goes on
// through first. It
// also stays behind one let in until that one is across in front of it. A head let in that does not
// go, or one stuck short of the merge point, standing still GIVE_UP_S on its turn, loses it to the open
// lane (`skip`) until the next driver goes through.
//
// Everyone in a zone keeps to LC_LIMIT_MPS, never above the street's limit, from 5 m short of the merge
// point to the end. Traffic, buses and cyclists all take turns (sim/npc.js); the driven car's sensing
// reports `lane_closure` (brain/sensors.js), and the audit counts merging out of turn, forcing in, as a
// failure (sim/world.js).
//
// In a free drive one closure stands at a time, somewhere 150 to 450 m from the car where it cannot see
// it, for 4 to 8 minutes, then packs up once the car is well away and nobody is in it (LaneClosures;
// `?closures=0` takes them off). They go only on straight blocks with two lanes going the same way, with
// no marked crosswalk, bus or streetcar route or level crossing, clear of the junctions at each end.

import { Vehicle, CAR } from "./vehicle.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { rng } from "../common.js";
import { railIndex } from "./rail.js";
import { WZ_LIMIT_MPS } from "./work-zone.js";

export const LC_LIMIT_MPS = WZ_LIMIT_MPS;
export const TAPER_M = 30;
export const CLEAR_M = 2;
export const WORK_M = 24;
export const SPAN_M = 2 * (TAPER_M + CLEAR_M) + WORK_M;
export const AHEAD_M = 80;        // the sign, and no lane changes into or out of the closed lane, from this far short of the merge point
export const HEAD_M = 25;         // in the closed lane this near the merge point, a driver is at the merge
export const COMING_M = 40;       // in the open lane this near it, one is coming
export const LET_IN_M = 7;        // letting someone in, a driver in the open lane stops its front this far short of the merge point
export const LET_IN_DECEL = 2.5;  // if it can, braking at no more than this
export const OWED_DECEL = 3.5;    // a driver at the merge waits there if it can stop braking at no more than this
export const GIVE_UP_S = 6;
const IN_M = 1.9;                 // one let in is across once its centre is this near the open lane's
const OPEN_M = 2.2;               // anyone whose centre is this near the open lane's is in it
const MIN_M = 40;                 // the merge point at least this far along its edge: room for a queue
const END_M = 20;                 // and the zone's end at least this far short of the junction (or its stop line)
const STRAIGHT_RAD = 0.08;
const SIDEWALK_M = 0.7;
// Free drive: how many stand at once, where they turn up, for how long, and how far away the car must
// be before one leaves.
export const LANE_CLOSURE_COUNT = 1;
const SPAWN_M = [150, 450];
const STAY_S = [240, 480];
const LEAVE_M = 150;
const RETRY_S = 5;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const isLaneClosure = (o) => !!o && o.closure === true;
// The driven car has no id of its own: it goes by this one here.
export const EGO_ID = "ego";
// Past the merge point by this much, a driver has gone through it (a short stop there overshoots).
export const THROUGH_M = 1;
// Whether a driver at `v` could stop within `d` metres braking at `decel`.
export const canStop = (v, d, decel) => v < 0.5 || d >= v * v / (2 * decel);
// The way the closed lane's traffic moves across into the open lane and back, in the edge's `s`
// (sim/controller.js detourAt).
export const detourOf = (z) => ({ from: z.m, full: z.m + TAPER_M, back: z.f + CLEAR_M, to: z.to, shift: z.shift });

// The blocks a closure can go on: an edge with two lanes going its way (one-way or not), long and
// straight enough, where [lo, hi] is the range its merge point can take.
const siteCache = new WeakMap();
export function laneClosureSites(map) {
  if (siteCache.has(map)) return siteCache.get(map);
  const routed = new Set();
  for (const route of map.transit?.routes || []) for (const run of route.runs || []) for (const id of run.edges || []) routed.add(id);
  for (const c of railIndex(map).crossings) for (const on of c.edges) routed.add(on.edge);
  const crossed = new Set((map.crosswalks || []).map((c) => c.edge));
  const sites = [];
  for (const e of map.edges.values()) {
    if (e.lanes !== 2 || e.ring || routed.has(e.id) || crossed.has(e.id) || !e.lane_offsets || e.lane_offsets.length < 2) continue;
    const L = e.length, lo = MIN_M, hi = Math.min(L, e.control?.s_line ?? L) - END_M - SPAN_M;
    if (hi < lo) continue;
    const h0 = headingAt(e.pts, e.cum, lo - HEAD_M);
    let straight = true;
    for (let s = lo - HEAD_M; s <= hi + SPAN_M && straight; s += 4) straight = Math.abs(wrap(headingAt(e.pts, e.cum, s) - h0)) < STRAIGHT_RAD;
    if (straight) sites.push({ edge: e.id, lo, hi });
  }
  sites.sort((a, b) => String(a.edge).localeCompare(String(b.edge)));
  siteCache.set(map, sites);
  return sites;
}

// A point `lat` metres right of edge `e`'s centre line, `s` along it.
function at(e, s, lat) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat];
}

// The extent of vehicle `v`'s body along edge `e` ([lo, hi] in its `s`, and its front), how far right of
// its centre line it is, and its heading from the edge's, or null when it is off the street.
function along(e, v) {
  const s = v.spec || CAR, c = Math.cos(v.psi), n = Math.sin(v.psi);
  const p = projectPoint(e.pts, e.cum, [v.x, v.y], null);
  if (!p || p.lateral < e.asphalt[0] - 1.5 || p.lateral > e.asphalt[1] + 1.5) return null;
  const rear = projectPoint(e.pts, e.cum, [v.x - c * s.rearOverhang, v.y - n * s.rearOverhang], null).s;
  const front = projectPoint(e.pts, e.cum, [v.x + c * (s.length - s.rearOverhang), v.y + n * (s.length - s.rearOverhang)], null).s;
  return { lo: Math.min(rear, front), hi: Math.max(rear, front), front, lateral: p.lateral, heading: wrap(v.psi - headingAt(e.pts, e.cum, p.s)) };
}

export class LaneClosures {
  constructor(world, { count = 0, seed = 1 } = {}) {
    this.world = world;
    this.count = count;
    this.random = rng(seed * 32452843 + 41);
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

  // Everyone on the zone's edge going its way, the car included: { v, body, lane (by where it is, or for
  // traffic the lane its path follows), side (the lane it came from: as noted short of the merge point) }.
  movers(z) {
    const world = this.world, e = world.map.edges.get(z.edge), out = [], reach = SPAN_M + AHEAD_M + 20;
    const co = e.lane_offsets[z.closed], oo = e.lane_offsets[z.open];
    for (const v of [world.ego, ...(world.npcs || [])]) {
      if (v.rail || Math.abs(v.x - z.x) > reach || Math.abs(v.y - z.y) > reach) continue;
      const body = along(e, v);
      if (!body || Math.abs(body.heading) > Math.PI / 3 || body.hi < z.m - AHEAD_M - 10 || body.lo > z.to + 5) continue;
      const pe = v.path?.currentEdge?.();
      const lane = pe && pe.id === z.edge ? (pe.lane === z.closed ? "closed" : "open") : Math.abs(body.lateral - co) < Math.abs(body.lateral - oo) ? "closed" : "open";
      const id = v === world.ego ? EGO_ID : v.id;
      out.push({ v, id, body, lane, side: body.front < z.m + THROUGH_M ? lane : z.from[id] ?? lane });
    }
    return out;
  }

  // Taking turns at the merge point (see the top of this file).
  control(z, dt) {
    const ms = this.movers(z), e = this.world.map.edges.get(z.edge), oo = e.lane_offsets[z.open];
    const ids = new Set(ms.map((x) => x.id));
    for (const id of Object.keys(z.from)) if (!ids.has(id)) delete z.from[id];
    for (const x of ms) if (x.body.front < z.m + THROUGH_M) z.from[x.id] = x.lane;
    // through the merge point: whose turn that was
    for (const x of ms) {
      if (x.body.front < z.m + THROUGH_M || x.body.front > z.m + 15 || z.passed.includes(x.id)) continue;
      z.passed.push(x.id);
      if (z.passed.length > 40) z.passed.shift();
      z.last = x.side; z.lastId = x.id; z.skip = null;
      if (x.side === "closed") z.merger = x.id;
      if (z.grant === x.id) z.grant = null;
    }
    // (one let in is across once it is in the open lane, or up to the closed stretch)
    const merger = z.merger && ms.find((x) => x.id === z.merger);
    if (!merger || Math.abs(merger.body.lateral - oo) < IN_M || merger.body.lo > z.r) z.merger = null;
    let head = null;
    for (const x of ms) if (x.side === "closed" && x.body.front < z.m + THROUGH_M && x.body.front > z.m - HEAD_M && (!head || x.body.front > head.body.front)) head = x;
    const headId = head?.id ?? null;
    z.headRear = head ? head.body.lo : null;
    if (headId !== z.head) { z.head = headId; z.idle = 0; if (z.grant && z.grant !== headId) z.grant = null; }
    const coming = ms.some((x) => x.side === "open" && x.body.front < z.m + THROUGH_M && x.body.front > z.m - COMING_M);
    // (one that lost its turn gets it back once the next goes through, or once nobody in the open lane is
    // coming)
    const turn = !head ? "open" : z.grant ? "closed" : (z.skip === headId || z.last === "closed") && coming ? "open" : "closed";
    if (turn !== z.turn) { z.turn = turn; z.changes++; }
    if (turn === "closed" && !z.grant && this.clearFor(z, head, ms)) { z.grant = headId; z.changes++; }
    // (its turn, let in or not, and standing still: after GIVE_UP_S it loses it, so that one stuck short
    // of the merge point, or one that does not go, does not hold the open lane up for ever)
    if (z.turn === "closed" && head) {
      z.idle = head.v.v < 0.3 ? z.idle + dt : 0;
      if (z.idle > GIVE_UP_S) { z.skip = headId; z.grant = null; z.idle = 0; z.turn = "open"; z.changes++; }
    } else z.idle = 0;
  }

  // Whether the head of the closed lane can be let in: nobody in the open lane beside it or just ahead
  // of where it joins, and whoever is coming up behind it in the open lane able to fall in behind it:
  // to drop back to its speed short of it braking at LET_IN_DECEL, with a headway of 0.6 s on top of
  // 1.5 m (the car, closing on it at more than 2 m/s, 2 s more of that back too: it has to be seen to let
  // it in).
  clearFor(z, head, ms) {
    const e = this.world.map.edges.get(z.edge), oo = e.lane_offsets[z.open], hf = head.body.front, hr = head.body.lo;
    for (const x of ms) {
      if (x === head || Math.abs(x.body.lateral - oo) > OPEN_M) continue;
      // (ahead of where it joins, it follows that one)
      if (x.body.lo > Math.max(hf, z.m) + 2) continue;
      if (x.body.hi > hr - 1) return false;
      const room = hr - x.body.hi, closing = Math.max(0, x.v.v - head.v.v), keep = 1.5 + 0.6 * Math.max(0, x.v.v);
      if (room < keep || !canStop(closing, room - keep, LET_IN_DECEL)) return false;
      if (x.v === this.world.ego && closing > 2 && room - keep < closing * 2) return false;
    }
    return true;
  }

  // Whether a driver in the open lane must let someone in: on the closed lane's turn, or while one let in
  // is still moving across in front of it (then it also keeps behind that one: see mergerRear). The line
  // its front waits at, in the edge's `s`, or null.
  letInLine(z, front) {
    // (LET_IN_M short of the merge point, and 1.5 m behind the rear of the one at the merge, wherever it
    // waits)
    const line = Math.min(z.m - LET_IN_M, (z.headRear ?? Infinity) - 1.5);
    if (front > line + 0.5) return null;
    return z.turn === "closed" || z.merger ? line : null;
  }

  // Whether the driver `id` in the open lane is the first there short of the merge point (nobody in the
  // open lane ahead of it who has not gone through yet): the one that lets someone in.
  firstInOpen(z, id) {
    const ms = this.movers(z), me = ms.find((x) => x.id === id), e = this.world.map.edges.get(z.edge), oo = e.lane_offsets[z.open];
    return !!me && !ms.some((x) => x !== me && x.side === "open" && Math.abs(x.body.lateral - oo) < OPEN_M && x.body.lo > me.body.front - 0.5 && x.body.front < z.m + THROUGH_M);
  }

  // The rear of the one let in, while it moves across: where it is, and its speed, or null.
  mergerRear(z) {
    if (!z.merger) return null;
    const world = this.world, v = z.merger === EGO_ID ? world.ego : (world.npcs || []).find((n) => n.id === z.merger);
    if (!v) return null;
    const r = (v.spec || CAR).rearOverhang;
    return { x: v.x - Math.cos(v.psi) * r, y: v.y - Math.sin(v.psi) * r, v: v.v };
  }

  // Anyone in the zone between `lo` and `hi` (edge `s`) and moving, or anyone at all inside the taper or
  // the closed stretch: nobody is put there, and the crew waits for them to leave.
  occupied(z) {
    return this.movers(z).some(({ body, v }) => body.hi > z.m - 5 && body.lo < z.to && (v.v > 0.1 || body.hi > z.m));
  }

  // Whether the car can see the sign, the merge point or the closed stretch.
  seen(z) {
    const vis = this.world.visibility, ego = this.world.ego;
    return [z.signs.ahead, z.signs.merge, [z.x, z.y]].filter(Boolean).some((p) => vis.canSee(ego, p[0], p[1]));
  }

  // A free-drive closure on a block SPAWN_M from the car and out of its sight, with nobody on the street
  // in it, and no stop at the roadside there: whoever is parked along it leaves.
  spawn() {
    const world = this.world, map = world.map, ego = world.ego, sites = laneClosureSites(map);
    if (!sites.length) return null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const site = sites[Math.floor(this.random() * sites.length)];
      if (this.zones.some((z) => z.edge === site.edge) || world.workZones?.zones.some((z) => z.closed === site.edge || z.open === site.edge)) continue;
      const m = site.lo + this.random() * (site.hi - site.lo), e = map.edges.get(site.edge);
      const mid = at(e, m + SPAN_M / 2, 0), d = Math.hypot(mid[0] - ego.x, mid[1] - ego.y);
      if (d < SPAWN_M[0] || d > SPAWN_M[1] || world.visibility.canSee(ego, mid[0], mid[1])) continue;
      const probe = { edge: site.edge, closed: 1, open: 0, x: mid[0], y: mid[1], m, to: m + SPAN_M, from: {} };
      if (this.movers(probe).some(({ body }) => body.hi > m - 10 && body.lo < m + SPAN_M + 5)) continue;
      if (this.bays(site.edge, m - 5, m + SPAN_M + 5).some((b) => b.reserved || b.occupant?.stay || b.occupant?.door)) continue;
      return this.place({ edge: site.edge, m, stay: STAY_S[0] + this.random() * (STAY_S[1] - STAY_S[0]) });
    }
    return null;
  }

  // The parking bays along edge `edge` between `lo` and `hi` (in its `s`), on its right.
  bays(edge, lo, hi) {
    const e = this.world.map.edges.get(edge);
    return this.world.parked.slots.filter((slot) => {
      if (slot.edge !== edge || slot.curb !== "right") return false;
      const s = projectPoint(e.pts, e.cum, [slot.x, slot.y], null).s;
      return s + 3 > lo && s - 3 < hi && s >= 0 && s <= e.length;
    });
  }

  // A closure of edge `edge`'s curb lane, its merge point `m` metres along it. Returns it.
  place({ edge, m, stay = Infinity }) {
    const world = this.world, map = world.map, e = map.edges.get(edge), n = ++this.made;
    const closed = e.lanes - 1, open = e.lanes - 2, co = e.lane_offsets[closed], oo = e.lane_offsets[open];
    const r = m + TAPER_M + CLEAR_M, f = r + WORK_M, to = f + CLEAR_M + TAPER_M;
    // the closed stretch: the closed lane and any parking lane beside it, from just right of the line
    // between the two lanes
    const lo = (co + oo) / 2 + 0.15, hi = e.asphalt[1] - 0.1, h = headingAt(e.pts, e.cum, r);
    const spec = { ...CAR, kind: "lane_closure", length: WORK_M, width: hi - lo, rearOverhang: 0, wheelbase: WORK_M, mass: 0 };
    const [x, y] = at(e, r, (lo + hi) / 2);
    const closure = new Vehicle(x, y, h, 0, spec);
    const id = `closure_${n}`;
    Object.assign(closure, { id, kind: "lane_closure", closure: true, stay: true, edge, curb: "right" });
    const [cx, cy] = at(e, (m + to) / 2, (co + oo) / 2);
    const z = {
      id, edge, closed, open, length: e.length, m, r, f, to, x: cx, y: cy, heading: h, shift: oo - co, closure,
      from: {}, passed: [], last: null, lastId: null, head: null, headRear: null, turn: "open", grant: null, merger: null, skip: null, idle: 0, changes: 0, left: stay, bays: [],
      signs: { ahead: m - AHEAD_M > 2 ? at(e, m - AHEAD_M, e.asphalt[1] + SIDEWALK_M) : null, merge: at(e, m - 4, e.asphalt[1] + SIDEWALK_M) },
    };
    for (const slot of this.bays(edge, m - 5, to + 5)) {
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

  // Whether point (x, y) is on the street inside a zone, from AHEAD_M short of its merge point to its end,
  // in either lane: nobody is put there.
  covers(x, y) {
    const map = this.world.map;
    return this.zones.some((z) => {
      if (Math.abs(x - z.x) > SPAN_M + AHEAD_M || Math.abs(y - z.y) > SPAN_M + AHEAD_M) return false;
      const e = map.edges.get(z.edge), p = projectPoint(e.pts, e.cum, [x, y], null);
      return p && p.s > z.m - AHEAD_M && p.s < z.to + 8 && p.lateral > e.asphalt[0] - 1 && p.lateral < e.asphalt[1] + 1;
    });
  }

  // The zone on edge `edgeId`, or null.
  on(edgeId) { return this.zones.find((z) => z.edge === edgeId) || null; }

  // The zone the driven car is in, from 5 m short of the merge point to its end, going its way, with
  // the speed to keep to on a street limited to `limit`: { zone, limit }, or null. Sensing-free, for the
  // coaching score.
  passing(limit) {
    const ego = this.world.ego, map = this.world.map, front = ego.spec.length - ego.spec.rearOverhang;
    for (const z of this.zones) {
      if (Math.abs(ego.x - z.x) > SPAN_M || Math.abs(ego.y - z.y) > SPAN_M) continue;
      const e = map.edges.get(z.edge), p = projectPoint(e.pts, e.cum, [ego.x, ego.y], null);
      if (!p || p.lateral < e.asphalt[0] - 1 || p.lateral > e.asphalt[1] + 1 || Math.abs(wrap(ego.psi - p.heading)) > Math.PI / 3) continue;
      if (p.s + front >= z.m - 5 && p.s + front <= z.to) return { zone: z, limit: Math.min(limit, LC_LIMIT_MPS) };
    }
    return null;
  }

  // Where the driven car is at a zone it is going through or coming up to, from AHEAD_M short of the
  // merge point to the end: { zone, side ("closed" or "open": the lane it is in, or past the merge point
  // came from), front (its front, in the edge's `s`) }, or null.
  egoAt() {
    const ego = this.world.ego;
    for (const z of this.zones) {
      if (Math.abs(ego.x - z.x) > SPAN_M + AHEAD_M || Math.abs(ego.y - z.y) > SPAN_M + AHEAD_M) continue;
      const x = this.movers(z).find((m) => m.v === ego);
      if (x && x.body.front > z.m - AHEAD_M && x.body.front < z.to) return { zone: z, side: x.side, lane: x.lane, front: x.body.front, lateral: x.body.lateral };
    }
    return null;
  }
}

// What the HUD tells the driver of the car about a lane closure ahead on its street, once it can see it
// and from AHEAD_M short of the merge point until it is through: { key, text, stop }, or null.
export function laneClosureNotice(world) {
  const lc = world.laneClosures, here = lc?.zones.length ? lc.egoAt() : null;
  if (!here) return null;
  const z = here.zone;
  if (here.front > z.m + THROUGH_M + 1) return null;
  if (here.front < z.m - 30 && !lc.seen(z)) return null;
  const right = z.closed === world.map.edges.get(z.edge).lanes - 1 ? "RIGHT" : "LEFT";
  if (here.side === "closed") {
    if (here.front < z.m - HEAD_M) return { key: `${z.id}:ahead`, stop: false, text: `${right} LANE CLOSED AHEAD · STAY IN LANE TO THE MERGE · TAKE TURNS` };
    if (z.grant === EGO_ID) return { key: `${z.id}:go:${z.changes}`, stop: false, text: "YOUR TURN · MERGE NOW" };
    return { key: `${z.id}:wait:${z.changes}`, stop: true, text: "WAIT YOUR TURN · LET THE NEXT CAR GO FIRST" };
  }
  if (lc.letInLine(z, here.front) !== null && z.head && z.head !== EGO_ID) return { key: `${z.id}:letin:${z.changes}`, stop: true, text: "LANE ENDS BESIDE YOU · LET ONE CAR IN · TAKE TURNS" };
  return { key: `${z.id}:open`, stop: false, text: `${right} LANE CLOSED AHEAD · TAKE TURNS AT THE MERGE` };
}
