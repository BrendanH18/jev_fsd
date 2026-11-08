// Snowbanks (World option `snowbanks`). After a snowfall the plows push the snow off the road against the
// kerbs, and in Canadian cities it stays there in banks until it is carted away. With the option on and
// snow falling when the drive starts (or once a challenge puts them down), a bank runs along every kerb,
// from its own random stream: BANK_H high along the block, piled higher at the corners (CORNER_H) where
// the plows turn, with a cut through it at each corner's crosswalk. A bank sits on the gutter and the
// boulevard; it is scenery, not an obstacle.
//
// Narrowings. On a two-way residential street with one lane each way and a parking lane at both kerbs,
// the bank fills the kerb side of the parking lane, and the cars parked there stand PUSH_M further out.
// Between them there is room for one moving car at a time (`narrowings`, NARROW_P of the blocks, a
// NARROW_LEN_M stretch of each: [a, b] along the street's edge, its cum frame). Everyone moves over
// toward the middle there (keepAt: SIDE_CLEAR_M clear of the parked cars) and keeps to NARROW_MPS, and
// drivers coming from either end take turns, as they do on any Montréal street in February: whoever is
// already in the narrowed stretch (or so close to it that it could not stop comfortably) has the way;
// a driver arriving waits with its front WAIT_M short of where it starts until that driver is out; and
// of two waiting at either end, or arriving, the one that came within ZONE_M of its end first goes first
// (`narrowingTurn`, the one test shared by the driven car's sensing, its forward sims, traffic, and the
// audit). A driver moving off within LATCH_M of its end, its turn come, has gone. Two that meet in the
// stretch anyway (one spawned there, say) squeeze past each other at SQUEEZE_MPS. Cyclists are narrow
// enough to pass anyone there, and keep clear of the parked cars too.
//
// Corners. A corner pile at least HIDE_H high on a residential street hides a person waiting at that
// corner, and a cyclist or car (not a truck, bus or van) coming out of the side street, from the driven
// car (World.sees, through `bankHidden`), and it hides the side street's lanes from a car giving way
// there just as a building would (brain/sensors.js giveWayAt, through `blocksView`), so the car creeps
// up to see. Coming up to a corner whose waiting spot it cannot see, the car slows to CREEP_MPS by
// CREEP_AT_M short of the crosswalk (`snowbankAhead` corner).
//
// The audit (`auditSnowbanks`) counts the driven car's front entering a narrowed stretch while a vehicle
// it could see coming the other way had the way (in it, committed, or there first) as `snowbank_conflicts`,
// reported only once the car has come within SEEN_M of a narrowing (`World.snowbanksSeen`).
//
// With the option off nothing here is built, stepped, drawn from a random stream or looked at.

import { CAR, G, ROAD, comfort } from "./vehicle.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { rng } from "../common.js";
import { oppositeOf, onStreet } from "./double-parked.js";
import { railIndex } from "./rail.js";
import { segmentHitsBox } from "./crosswalk.js";
import { GUTTER, CURB, streetOf, sidewalkOffset } from "../map/streets.js";

export const EGO_ID = "ego";
// The banks: how far out onto the road one reaches from the kerb face, and how high it is.
export const BANK_IN_M = 0.4;
export const BANK_H = { quiet: [0.6, 1.1], main: [0.3, 0.6] };
export const CORNER_H = { quiet: [1.4, 1.9], main: [0.8, 1.2] };
export const LUMP_M = 2.5;
// A corner pile this high hides people, cyclists and cars from a driver (on a residential street).
export const HIDE_H = 1.3;
// Corner piles run this far back along the kerb, and stop CUT_M short of the corner's crosswalk middle.
export const CORNER_M = [7, 10];
const CUT_M = 2.0;
const CROSS_BEYOND_CURB_M = 1.6;   // (as sim/pedestrians.js: where a corner's crosswalk is)
const SLICE_M = 2;
const QUIET = new Set(["residential", "unclassified", "living_street"]);
const BANKED = new Set(["residential", "unclassified", "living_street", "tertiary", "secondary", "primary", "trunk"]);
// Narrowings: where the bank fills the kerb side of the parking lane, the parked cars stand PUSH_M
// further out; others keep SIDE_CLEAR_M clear of them.
export const PUSH_M = 0.6;
export const SIDE_CLEAR_M = 0.5;
export const NARROW_P = 0.7;
export const NARROW_LEN_M = [40, 100];
const MIN_NARROW_M = 30;
const NARROW_END_M = 20;
const CORNER_CLEAR_M = 5.0, LINE_CLEAR_M = 6.0;   // (as sim/parking.js: where cars park)
// Taking turns: arriving within ZONE_M of its end, a driver takes its turn in order of arrival; waiting,
// it stops its front WAIT_M short of the stretch; moving off within LATCH_M of it, its turn come, it has
// gone. One standing still further back than QUEUED_M is queued behind something else, not waiting its
// turn.
export const ZONE_M = 30;
export const WAIT_M = 2.0;
export const LATCH_M = 8;
const COMMIT_M = 1.0;
const STALL_S = 8;
const QUEUED_M = 12;
export const NARROW_MPS = 20 / 3.6;
export const SQUEEZE_MPS = 1.5;
const SQUEEZE_M = 25;
const EASE_IN_M = 10, EASE_OUT_M = 8;
export const LOOK_M = 80;
export const SEEN_M = 40;
// Corner sight: creep up to a corner whose waiting spot is hidden.
export const CREEP_MPS = 2.5;
export const CREEP_AT_M = 3;
const CORNER_LOOK_M = 50;
const CELL = 25;
// Tall enough to be seen over a bank.
const TALL = new Set(["bus", "school_bus", "streetcar", "train", "delivery_van", "snow_plow", "collection_truck", "fire_truck", "ambulance", "tow_truck"]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const ease = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

const lengthOf = (e) => e.cum[e.cum.length - 1];
// The hardest a vehicle can brake on the grip under its wheels: the road's, or a black-ice patch's
// where one is under an axle (sim/black-ice.js sets ROAD.gripAt), as sim/vehicle.js comfort() does.
function hardDecelUnder(v) {
  let mu = ROAD.mu;
  if (ROAD.gripAt && v?.spec) {
    const c = Math.cos(v.psi), s = Math.sin(v.psi), wb = v.spec.wheelbase || 2.7;
    mu = Math.min(mu, ROAD.gripAt(v.x, v.y, v.spec) ?? Infinity, ROAD.gripAt(v.x + c * wb, v.y + s * wb, v.spec) ?? Infinity);
  }
  return Math.min(4, mu * G * 0.8);
}
// Where a driver waiting its turn stops its front, along its way, given where its front is: WAIT_M short
// of the stretch, or, once past that point (creeping up to an end it cannot see past, say), HOLD_M short
// of the stretch itself.
const HOLD_M = 0.2;
const BRAKE_RAMP_S = 0.15;
export const waitPoint = (en, front) => (en - front >= WAIT_M ? en - WAIT_M : en - HOLD_M);
function offsetPoint(e, s, lat) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat];
}
// The streets meeting at `node`, and the half width of the widest of them.
function nodeInfo(map, node) {
  const ids = [...(map.inn.get(node) || []), ...(map.out.get(node) || [])];
  const next = new Set();
  let half = 0;
  for (const id of ids) {
    const o = map.edges.get(id);
    next.add(o.from === node ? o.to : o.from);
    half = Math.max(half, Math.abs(o.asphalt[0]), Math.abs(o.asphalt[1]));
  }
  return { junction: next.size >= 3, half };
}

// Where a car parked at the right kerb of edge `e` stands in a narrowing (its centre, right of the
// centreline), and how far right of it another vehicle `spec` may keep (its centre).
export const pushedLat = (e) => e.asphalt[1] - (e.parking?.[1] || 2.1) / 2 - 0.05 - PUSH_M;
export const keepAt = (e, spec = CAR) => pushedLat(e) - CAR.width / 2 - SIDE_CLEAR_M - spec.width / 2;

// The blocks a narrowing can form on: a two-way residential street with one lane each way and a
// parking lane at both kerbs, no transit route, level crossing or marked crosswalk, with [lo, hi] (the
// edge's cum frame) where cars park at both kerbs, at least MIN_NARROW_M long. One per street (its edge
// with the lower id).
const siteCache = new WeakMap();
export function narrowingSites(map) {
  if (siteCache.has(map)) return siteCache.get(map);
  const routed = new Set();
  for (const route of map.transit?.routes || []) for (const run of route.runs || []) for (const id of run.edges || []) routed.add(id);
  for (const c of railIndex(map).crossings) for (const on of c.edges) routed.add(on.edge);
  const crossed = new Set((map.crosswalks || []).map((c) => c.edge));
  const span = (e) => {
    const L = lengthOf(e), a = nodeInfo(map, e.from), b = nodeInfo(map, e.to);
    let to = L - (b.junction ? b.half : 0) - CORNER_CLEAR_M;
    if (e.control) to = Math.min(to, e.control.s_line * L / Math.max(1e-6, e.length) - LINE_CLEAR_M);
    return [(a.junction ? a.half : 0) + CORNER_CLEAR_M, to];
  };
  const sites = [];
  for (const e of map.edges.values()) {
    if (e.oneway || e.lanes !== 1 || e.ring || !QUIET.has(e.cls) || !(e.parking?.[1] > 0) || routed.has(e.id) || crossed.has(e.id)) continue;
    const o = oppositeOf(map, e);
    if (!o || !(o.parking?.[1] > 0) || routed.has(o.id) || crossed.has(o.id) || String(o.id) < String(e.id)) continue;
    const L = lengthOf(e), [e0, e1] = span(e), [o0, o1] = span(o);
    // (clear of the junctions at either end, so that a driver waiting its turn is out of the junction and
    // one turning in is straight before moving over)
    const lo = Math.max(e0, L - o1, NARROW_END_M), hi = Math.min(e1, L - o0, L - NARROW_END_M);
    if (hi - lo >= MIN_NARROW_M) sites.push({ edge: e.id, opposite: o.id, lo, hi, name: e.name });
  }
  sites.sort((x, y) => String(x.edge).localeCompare(String(y.edge)));
  siteCache.set(map, sites);
  return sites;
}

// A narrowing's ends for a driver going `dir` (+1 along its edge, -1 along the opposite), in that
// direction's edge's own frame: where it comes into it, and where it leaves.
const entryOf = (nw, dir) => (dir > 0 ? nw.a : nw.L - nw.b);
const exitOf = (nw, dir) => (dir > 0 ? nw.b : nw.L - nw.a);
const keyOf = (v, nw) => `${v.id ?? EGO_ID}|${nw.id}`;
const narrowable = (v) => !!v && !v.parked && v.kind !== "bike" && v.kind !== "pedestrian" && v.kind !== "door" && !v.rail && !v.transit?.tram && !v.goose;

export class Snowbanks {
  constructor(world, { enabled = false, seed = 1 } = {}) {
    this.world = world;
    this.enabled = !!enabled;
    this.narrowings = [];
    this.piles = [];
    // (static once built: the banks, the corner piles that hide and their grid; shared by checkpoints)
    this.geo = { runs: [], piles: [], grid: new Map(), byEdge: new Map() };
    this.since = new Map();    // "<vehicle>|<narrowing>" -> when it came within ZONE_M of its end
    this.go = new Map();       // "<vehicle>|<narrowing>" -> its turn come, it has gone
    this.lists = new Map();    // narrowing id -> everyone coming to or in it (worked out once a tick)
    this.stall = new Map();    // "<vehicle>|<narrowing>" -> how long it has stood short of its end, free to go
    this.tick = -1;
    this.routeEnds = new WeakMap();
    // (their own stream, drawn from only while the option is on, and only once it has snowed)
    this.random = this.enabled ? rng(seed * 2246822519 + 131) : null;
    if (this.enabled && world.weather === "snow") this.build();
  }

  // The narrowings the stream picks (NARROW_P of the sites, a NARROW_LEN_M stretch of each), and the
  // banks along every kerb; the cars parked in a narrowing pushed out.
  build({ narrowings = null } = {}) {
    const map = this.world.map, r = this.random;
    const list = [];
    if (narrowings) list.push(...narrowings);
    else for (const site of narrowingSites(map)) {
      if (r() >= NARROW_P) continue;
      const len = Math.min(site.hi - site.lo, NARROW_LEN_M[0] + r() * (NARROW_LEN_M[1] - NARROW_LEN_M[0]));
      const a = site.lo + r() * (site.hi - site.lo - len);
      list.push({ edge: site.edge, a, b: a + len });
    }
    this.narrowings = list.map((x) => this.narrowing(x));
    this.geo = { runs: [], piles: [], grid: new Map(), byEdge: new Map() };
    for (const nw of this.narrowings) { this.geo.byEdge.set(nw.edge, { nw, dir: 1 }); this.geo.byEdge.set(nw.opposite, { nw, dir: -1 }); }
    for (const e of map.edges.values()) this.bankEdge(e);
    this.piles = this.geo.piles;
    for (const nw of this.narrowings) this.pushParked(nw);
  }

  narrowing({ edge, a, b }) {
    const map = this.world.map, e = map.edges.get(edge), o = oppositeOf(map, e), L = lengthOf(e);
    const mid = pointAt(e.pts, e.cum, (a + b) / 2);
    return { id: `narrow_${edge}`, edge: e.id, opposite: o.id, a, b, L, name: e.name, x: mid[0], y: mid[1], reach: (b - a) / 2 + 10 };
  }

  // The banks along edge `e`'s kerbs: its right one (a two-way street's left kerb is its twin's right),
  // and on a one-way street its left one too.
  bankEdge(e) {
    if (e.ring || !BANKED.has(String(e.cls).replace("_link", "")) || !e.asphalt) return;
    const map = this.world.map, r = this.random, L = lengthOf(e);
    if (L < 4) return;
    const quiet = QUIET.has(e.cls), [blvd] = streetOf(e);
    const ends = [nodeInfo(map, e.from), nodeInfo(map, e.to)];
    const cut = ends.map((x) => (x.junction ? x.half + CROSS_BEYOND_CURB_M + CUT_M : 0));
    const at = this.geo.byEdge.get(e.id);
    for (const side of e.oneway ? [1, -1] : [1]) {
      const kerb = side > 0 ? e.asphalt[1] + GUTTER : e.asphalt[0] - GUTTER;
      const outer = kerb + side * (CURB + Math.max(0.6, blvd * 0.8));
      const lo = cut[0], hi = L - cut[1];
      if (hi - lo < 2) continue;
      // (corner piles at junction ends, the bank between them, split where a narrowing starts and ends)
      const pieces = [];
      const cornerLen = () => CORNER_M[0] + r() * (CORNER_M[1] - CORNER_M[0]);
      const c0 = ends[0].junction ? Math.min(hi, lo + cornerLen()) : lo, c1 = ends[1].junction ? Math.max(c0, hi - cornerLen()) : hi;
      if (c0 > lo) pieces.push({ s0: lo, s1: c0, corner: -1 });
      const cuts = [c0, c1];
      if (at && side > 0) {
        const [na, nb] = [entryOf(at.nw, at.dir), exitOf(at.nw, at.dir)];
        for (const s of [na, nb]) if (s > c0 && s < c1) cuts.push(s);
      }
      cuts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] - cuts[i] > 0.5) pieces.push({ s0: cuts[i], s1: cuts[i + 1], corner: 0 });
      if (c1 < hi) pieces.push({ s0: c1, s1: hi, corner: 1 });
      for (const pc of pieces) {
        const mid = (pc.s0 + pc.s1) / 2;
        const pushed = !pc.corner && at && side > 0 && mid > entryOf(at.nw, at.dir) && mid < exitOf(at.nw, at.dir);
        const inner = kerb - side * (BANK_IN_M + (pushed ? PUSH_M : 0));
        const [h0, h1] = pc.corner ? CORNER_H[quiet ? "quiet" : "main"] : BANK_H[quiet ? "quiet" : "main"];
        const base = h0 + r() * (h1 - h0), n = Math.max(2, Math.ceil((pc.s1 - pc.s0) / LUMP_M) + 1);
        const h = [];
        for (let k = 0; k < n; k++) {
          // (a corner pile rises toward the corner; lumps either way)
          const u = k / (n - 1), rise = pc.corner ? 0.55 + 0.45 * (pc.corner > 0 ? u : 1 - u) : 1;
          h.push(Math.max(0.15, base * rise + (r() - 0.5) * 0.25));
        }
        const run = { edge: e.id, side, s0: pc.s0, s1: pc.s1, inner, outer, h, corner: !!pc.corner, pushed: !!pushed, quiet, dirt: r() };
        this.geo.runs.push(run);
        if (pc.corner && quiet && base >= HIDE_H) this.addPile(e, run);
      }
    }
  }

  // A corner pile that hides: boxes every SLICE_M along it, filed in the grid.
  addPile(e, run) {
    const slices = [];
    for (let s = run.s0; s < run.s1 - 0.1; s += SLICE_M) {
      const s1 = Math.min(run.s1, s + SLICE_M), m = (s + s1) / 2, h = headingAt(e.pts, e.cum, m);
      const c = offsetPoint(e, m, (run.inner + run.outer) / 2);
      slices.push({ center: c, heading: h, halfLength: (s1 - s) / 2 + 0.05, halfWidth: Math.abs(run.outer - run.inner) / 2 });
    }
    const xs = slices.map((b) => b.center[0]), ys = slices.map((b) => b.center[1]);
    const pile = { id: `pile_${this.geo.piles.length + 1}`, edge: e.id, side: run.side, end: run.s1 >= lengthOf(e) / 2 ? "end" : "start", node: run.s1 >= lengthOf(e) / 2 ? e.to : e.from, run, slices,
      box: [Math.min(...xs) - 6, Math.min(...ys) - 6, Math.max(...xs) + 6, Math.max(...ys) + 6] };
    this.geo.piles.push(pile);
    for (let cx = Math.floor(pile.box[0] / CELL); cx <= Math.floor(pile.box[2] / CELL); cx++) for (let cy = Math.floor(pile.box[1] / CELL); cy <= Math.floor(pile.box[3] / CELL); cy++) {
      const key = `${cx},${cy}`;
      if (!this.geo.grid.has(key)) this.geo.grid.set(key, []);
      this.geo.grid.get(key).push(pile);
    }
  }

  // The cars parked at the right kerb of either edge of narrowing `nw`, and the spaces there, pushed out.
  pushParked(nw) {
    const world = this.world, map = world.map;
    for (const dir of [1, -1]) {
      const e = map.edges.get(dir > 0 ? nw.edge : nw.opposite), lo = entryOf(nw, dir) - 0.5, hi = exitOf(nw, dir) + 0.5;
      const along = (x, y) => projectPoint(e.pts, e.cum, [x, y], null);
      for (const c of [...world.parked.list]) {
        if (c.edge !== e.id || c.curb === "left" || c.roadside || c.doubleParked || c.workzone || c.closure) continue;
        const p = along(c.x, c.y);
        if (!p || p.s < lo || p.s > hi || p.lateral < 0) continue;
        world.parked.move(c, c.x - Math.sin(p.heading) * PUSH_M, c.y + Math.cos(p.heading) * PUSH_M);
      }
      for (const slot of world.parked.slots) {
        if (slot.edge !== e.id || slot.curb !== "right") continue;
        const p = along(slot.x, slot.y);
        if (!p || p.s < lo || p.s > hi) continue;
        slot.x -= Math.sin(p.heading) * PUSH_M; slot.y += Math.cos(p.heading) * PUSH_M;
      }
    }
  }

  // Whether the line from `from` to `to` passes through a corner pile that hides.
  blocksView(from, to) {
    if (!this.geo.piles.length) return false;
    const x0 = Math.min(from[0], to[0]), x1 = Math.max(from[0], to[0]), y0 = Math.min(from[1], to[1]), y1 = Math.max(from[1], to[1]);
    const seen = new Set();
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
      for (const pile of this.geo.grid.get(`${cx},${cy}`) || []) {
        if (seen.has(pile)) continue;
        seen.add(pile);
        if (pile.box[2] < x0 || pile.box[0] > x1 || pile.box[3] < y0 || pile.box[1] > y1) continue;
        if (pile.slices.some((b) => segmentHitsBox(from, to, b))) return true;
      }
    }
    return false;
  }

  // ---- taking turns ----

  // Where vehicle `v` stands to narrowing `nw`: { v, id, dir, gap (its front to where it comes in, along
  // its way; below 0 once in), inside, speed, en, ex (along its route or path, where it has one) }, or
  // null when it is not coming to it within LOOK_M, or is through it.
  claimFor(nw, v) {
    if (!narrowable(v)) return null;
    const world = this.world, map = world.map, spec = v.spec || CAR, fr = spec.length - spec.rearOverhang;
    if (Math.abs(v.x - nw.x) > nw.reach + LOOK_M || Math.abs(v.y - nw.y) > nw.reach + LOOK_M) return null;
    const make = (dir, gap, en = null, ex = null) => {
      const toExit = gap + (exitOf(nw, dir) - entryOf(nw, dir));
      if (gap > LOOK_M || toExit + spec.length < 0) return null;
      return { v, id: v.id ?? EGO_ID, dir, gap, inside: gap < 0, speed: Math.max(0, v.v), en, ex };
    };
    if (v === world.ego) {
      const route = world.route, ends = route ? this.alongRoute(route, nw) : null;
      if (ends) {
        const p = route.project(v.x, v.y, route.hint ?? 0);
        if (p && p.distance < 6) return make(ends.dir, ends.en - (p.s + fr), ends.en, ends.ex);
      }
    } else if (v.path?.edges?.length && Number.isFinite(v.path.s)) {
      for (const pe of v.path.edges) {
        if (pe.id !== nw.edge && pe.id !== nw.opposite) continue;
        const dir = pe.id === nw.edge ? 1 : -1, { en, ex } = pathEnds(map, v.path, pe, nw, dir), front = v.path.s + fr;
        if (front - spec.length > ex) continue;
        return make(dir, en - front, en, ex);
      }
    }
    // (off its route or path: by where it is on the street)
    const e = map.edges.get(nw.edge), on = onStreet(e, v);
    if (!on || (!on.same && !on.opposite)) return null;
    return on.same ? make(1, nw.a - (on.s + fr)) : make(-1, (on.s - fr) - nw.b);
  }

  // Where route `route` comes into and leaves narrowing `nw` (route arc lengths, on its lane), or null.
  alongRoute(route, nw) {
    if (!this.routeEnds.has(route)) this.routeEnds.set(route, new Map());
    const memo = this.routeEnds.get(route);
    if (memo.has(nw.id)) return memo.get(nw.id);
    let out = null;
    const i = route.edges.findIndex((id) => id === nw.edge || id === nw.opposite);
    if (i >= 0) {
      const map = this.world.map, dir = route.edges[i] === nw.edge ? 1 : -1, e = map.edges.get(route.edges[i]), lat = e.lane_offsets?.[0] ?? e.lane_width / 2;
      const at = (s) => { const q = offsetPoint(e, s, lat), p = projectPoint(route.pts, route.cum, q, null); return p && p.distance < 3 ? p.s : null; };
      const en = at(entryOf(nw, dir)), ex = at(exitOf(nw, dir));
      if (en !== null && ex !== null && ex > en) out = { dir, en, ex, edge: e.id };
    }
    memo.set(nw.id, out);
    return out;
  }

  // Everyone coming to or in narrowing `nw` now (worked out once a tick, or again with `force`).
  claims(nw, force = false) {
    if (force || this.tick !== this.world.tick) this.refresh();
    return this.lists.get(nw.id) || [];
  }

  // Who is coming to or in each narrowing: the driven car, near one; traffic, along its path.
  refresh() {
    const world = this.world, ego = world.ego, lists = this.lists = new Map();
    this.tick = world.tick;
    const add = (nw, c) => { if (!c) return; if (!lists.has(nw.id)) lists.set(nw.id, []); lists.get(nw.id).push(c); };
    for (const nw of this.narrowings) if (Math.abs(ego.x - nw.x) < nw.reach + LOOK_M && Math.abs(ego.y - nw.y) < nw.reach + LOOK_M) add(nw, this.claimFor(nw, ego));
    for (const n of world.npcs) {
      if (!narrowable(n) || !n.path?.edges?.length) continue;
      let met = null;
      for (const pe of n.path.edges) {
        const on = this.geo.byEdge.get(pe.id);
        if (!on || met?.has(on.nw)) continue;
        (met ||= new Set()).add(on.nw);
        add(on.nw, this.claimFor(on.nw, n));
      }
    }
  }

  sinceOf(nw, c) { return this.since.get(keyOf(c.v, nw)) ?? (c.gap <= ZONE_M ? this.world.t : Infinity); }

  // It has the way, whatever else: in, gone (its turn come), or too close to stop short of it. As others
  // see it: comfortably, with COMMIT_M to spare. As it sees itself (`self`): only when it truly could not
  // stop short of it even braking hard, on the grip under its wheels (black ice too), so that one already
  // in, coming the other way, outranks a late claim from a driver still outside that could still stop.
  committed(nw, c, self = false) {
    if (c.inside || this.go.get(keyOf(c.v, nw))) return true;
    if (c.speed <= 0.3) return false;
    if (!self) return c.gap < c.speed * c.speed / (2 * comfort().decel) + COMMIT_M;
    // (after the brakes' response, and the ramp to full braking, then braking hard)
    return c.gap < c.speed * ((c.v.spec?.accelLag || 0) + BRAKE_RAMP_S) + c.speed * c.speed / (2 * hardDecelUnder(c.v));
  }

  // Whether `o` (coming the other way) goes before `c`: it came within ZONE_M of its end first (and is
  // not standing queued behind something further back); on a tie, by id.
  precedes(nw, o, c) {
    if (o.gap > ZONE_M || (o.speed < 0.3 && o.gap > QUEUED_M) || this.stalled(nw, o)) return false;
    const so = this.sinceOf(nw, o), sc = this.sinceOf(nw, c);
    if (so < sc - 1e-6) return true;
    if (so > sc + 1e-6) return false;
    return String(o.id) < String(c.id);
  }

  // Step: who has come within ZONE_M of each narrowing's end since when, and who has gone in.
  // One standing still short of its end for STALL_S though nothing coming has the way (held up by
  // something else) loses its turn, so that those waiting at the other end are not held up for ever.
  step(dt = 0) {
    if (!this.narrowings.length) return;
    const t = this.world.t, live = new Set();
    // (the claims once a step: they depend only on where everyone is, not on what this loop records)
    this.refresh();
    for (const nw of this.narrowings) {
      const claims = this.claims(nw);
      for (const c of claims) {
        const key = keyOf(c.v, nw);
        live.add(key);
        if (c.gap <= ZONE_M && !this.since.has(key)) this.since.set(key, t);
        const may = !c.inside && c.gap <= ZONE_M ? narrowingTurn(this, nw, c).mayEnter : false;
        if (may && !this.go.get(key) && c.speed > 0.3 && c.gap < LATCH_M) this.go.set(key, true);
        if (may && c.speed < 0.3) this.stall.set(key, (this.stall.get(key) || 0) + dt);
        else this.stall.delete(key);
        if ((this.stall.get(key) || 0) > STALL_S) this.go.delete(key);
      }
    }
    for (const map of [this.since, this.go, this.stall]) for (const key of [...map.keys()]) if (!live.has(key)) map.delete(key);
  }

  stalled(nw, c) { return (this.stall.get(keyOf(c.v, nw)) || 0) > STALL_S; }

  // The narrowings edge `id` runs through, with the way along it.
  on(id) { return this.geo.byEdge.get(id) || null; }
}

// Whose turn it is in narrowing `nw` for claim `c` (Snowbanks.claimFor): { mayEnter, committed (it has
// the way, whatever else), oncoming (the first coming the other way that has it: in, committed, or there
// first), reason ("inside", "committed", "turn") }. `seen(vehicle)`: only those (the driven car: what it
// can see); traffic sees what is there.
export function narrowingTurn(sb, nw, c, seen = null) {
  const self = sb.committed(nw, c, true);
  let first = null, reason = null;
  for (const o of sb.claims(nw)) {
    if (o.dir === c.dir || o.v === c.v || (seen && !seen(o.v)) || !sb.committed(nw, o)) continue;
    if (!first || (o.inside && !first.inside) || (o.inside === first.inside && o.gap < first.gap)) { first = o; reason = o.inside ? "inside" : "committed"; }
  }
  if (!first) for (const o of sb.claims(nw)) {
    if (o.dir === c.dir || o.v === c.v || (seen && !seen(o.v)) || !sb.precedes(nw, o, c)) continue;
    if (!first || o.gap < first.gap) { first = o; reason = "turn"; }
  }
  return { mayEnter: self || !first, committed: self, oncoming: first, reason };
}

// The speed to keep coming up to and through a narrowing `gap` metres ahead (below 0: in it), and squeezing
// past one coming the other way in it.
export function narrowSpeed(gap, squeeze = false) {
  if (squeeze) return SQUEEZE_MPS;
  return Math.sqrt(NARROW_MPS * NARROW_MPS + 2 * 0.6 * comfort().decel * Math.max(0, gap));
}

// Coming up to the end of a narrowing it cannot see through, `gap` metres short of where it would wait:
// slowing gently to EDGE_MPS by EDGE_LEAD_M before there, and keeping to it until it is in (whatever it
// may think of its own claim): slow enough to stop, short of the stretch, for one it then sees in it.
export const EDGE_MPS = 1.2;
export const EDGE_LEAD_M = 2;
export function edgeSpeed(gap) {
  return Math.sqrt(EDGE_MPS * EDGE_MPS + 2 * 0.6 * comfort().decel * Math.max(0, gap));
}

// Whether the fronts of `c` and of one coming the other way in the stretch are within SQUEEZE_M of
// meeting (both in it).
function squeezing(sb, nw, c) {
  if (!c.inside) return null;
  const at = (x) => (x.dir > 0 ? nw.a - x.gap : nw.b + x.gap);
  for (const o of sb.claims(nw)) {
    if (o.dir === c.dir || !o.inside) continue;
    const apart = c.dir > 0 ? at(o) - at(c) : at(c) - at(o);
    if (apart > -2 && apart < SQUEEZE_M) return o;
  }
  return null;
}

// Where a driver's path (sim/npc.js NpcPath) comes into and leaves narrowing `nw` along its edge `pe`
// (arc lengths of the path): the narrowing's ends on its lane, found on the path itself, since the path
// rounds the corners where its lanes join. Kept on `pe`, relative to its start, as the path moves on.
function pathEnds(map, path, pe, nw, dir) {
  const memo = pe.snowbank;
  if (memo?.id === nw.id) return { en: pe.sStart + memo.en, ex: pe.sStart + memo.ex };
  const e = map.edges.get(pe.id), lat = e.lane_offsets?.[pe.lane ?? 0] ?? e.lane_width / 2, k = (pe.sEnd - pe.sStart) / Math.max(1e-6, nw.L);
  const at = (s) => {
    const p = path.pts?.length > 1 ? projectPoint(path.pts, path.cum, offsetPoint(e, s, lat), null) : null;
    return p && p.distance < 3 && p.s > pe.sStart - 1 && p.s < pe.sEnd + 1 ? p.s : pe.sStart + s * k;
  };
  const en = at(entryOf(nw, dir)), ex = at(exitOf(nw, dir));
  pe.snowbank = { id: nw.id, en: en - pe.sStart, ex: ex - pe.sStart };
  return { en, ex };
}

// How far over toward the middle a driver keeps in a narrowing, relative to its lane's centre (metres
// right: below 0), for vehicle `spec`, going `dir`.
function keepRel(map, nw, dir, spec) {
  const e = map.edges.get(dir > 0 ? nw.edge : nw.opposite), lane = e.lane_offsets?.[0] ?? e.lane_width / 2;
  return Math.min(0, keepAt(e, spec) - lane);
}

// How far into the move over toward the middle a driver is at arc length `s` of its way, for a narrowing
// it comes into at `en` and leaves at `ex` (0 to 1).
const moveAt = (s, en, ex) => (s < en - EASE_IN_M || s > ex + EASE_OUT_M ? 0 : s < en - 1 ? ease((s - en + EASE_IN_M) / (EASE_IN_M - 1)) : s > ex + 1 ? ease((ex + EASE_OUT_M - s) / (EASE_OUT_M - 1)) : 1);

// Traffic (sim/npc.js): for driver `n`, whose front is `front` along its path, the first narrowing ahead
// on it: { hold (its front's arc length where it waits, or null), limit, keep (how far over from its
// lane's centre to keep, at most), at(s) (how far into moving over it is at arc length s of its path,
// 0 to 1) }, or null. Cyclists only keep clear of the parked cars.
export function snowbankYield(world, n, front) {
  const sb = world.snowbanks;
  if (!sb?.narrowings.length || !n.path?.edges?.length) return null;
  const map = world.map;
  for (const pe of n.path.edges) {
    const on = sb.on(pe.id);
    if (!on) continue;
    const nw = on.nw, dir = on.dir, { en, ex } = pathEnds(map, n.path, pe, nw, dir);
    if (front - (n.spec || CAR).length > ex) continue;
    if (en - front > LOOK_M) return null;
    const keep = keepRel(map, nw, dir, n.spec || CAR), at = (s) => moveAt(s, en, ex);
    if (n.kind === "bike") return { hold: null, limit: Infinity, keep, at };
    const c = sb.claims(nw).find((x) => x.v === n) || sb.claimFor(nw, n);
    if (!c) return { hold: null, limit: Infinity, keep, at };
    const turn = narrowingTurn(sb, nw, c);
    return { hold: turn.mayEnter ? null : waitPoint(en, front), limit: narrowSpeed(en - front, !!squeezing(sb, nw, c)), keep, at, turn };
  }
  return null;
}

// Whether the driven car's sight of object `o` is hidden by a corner pile: a person, cyclist, goose or
// car (not a truck, bus or van, nor anything parked), every line to it (its middle, nose and tail)
// through one.
export function bankHidden(world, observer, o) {
  const sb = world.snowbanks;
  if (!sb?.piles.length || !o || o.parked || o.kind === "door" || o.rail || o.transit || o.school || TALL.has(o.kind) || TALL.has(o.spec?.kind)) return false;
  if (typeof o.obb !== "function") return false;
  const box = o.obb(), dx = Math.cos(box.heading) * box.halfLength, dy = Math.sin(box.heading) * box.halfLength;
  if (Math.hypot(box.center[0] - observer.x, box.center[1] - observer.y) < 3) return false;
  return [[0, 0], [dx, dy], [-dx, -dy]].every(([x, y]) => sb.blocksView([observer.x, observer.y], [box.center[0] + x, box.center[1] + y]));
}

// The driven car's sensing (brain/sensors.js `snowbank`): { narrowing, corner } or null.
// narrowing: the first narrowed stretch on its route within LOOK_M: { id, street, length_m, gap_m (front
// to where it starts; below 0 in it), inside, priority ("car": the car has the way or may take it;
// "oncoming": it waits), reason, oncoming ({ id, inside, gap_m, speed } of the one with the way), wait,
// stop_s_route, bumper_to_stop_m, limit_mps, squeeze, detour (over toward the middle, route arc lengths:
// sim/controller.js detourAt) }. Only vehicles it can see count.
// corner: the junction ahead whose corner waiting spot a pile hides from it: { node, side, gap_m (front to
// the crosswalk), limit_mps }.
export function snowbankAhead(world, p, frontS) {
  const sb = world.snowbanks;
  if (!sb?.enabled) return null;
  const narrowing = sb.narrowings.length ? egoNarrowing(world, frontS) : null;
  const corner = sb.piles.length ? egoCorner(world, p, frontS) : null;
  return narrowing || corner ? { narrowing, corner } : null;
}

function egoNarrowing(world, frontS) {
  const sb = world.snowbanks, ego = world.ego, route = world.route;
  let best = null;
  for (const nw of sb.narrowings) {
    if (!route || !sb.alongRoute(route, nw)) continue;
    const c = sb.claims(nw).find((x) => x.v === ego) || sb.claimFor(nw, ego);
    if (c && c.en !== null && (!best || c.gap < best.c.gap)) best = { nw, c };
  }
  if (!best) return null;
  const { nw, c } = best, turn = narrowingTurn(sb, nw, c, (v) => world.sees(ego, v));
  const wait = !turn.mayEnter, stop = wait ? waitPoint(c.en, frontS) : null, squeeze = squeezing(sb, nw, c);
  const o = turn.oncoming, r1 = (x) => Math.round(x * 10) / 10;
  const e = world.map.edges.get(c.dir > 0 ? nw.edge : nw.opposite), shift = keepRel(world.map, nw, c.dir, ego.spec);
  // (whether it can see to the far end, where anyone coming would come in: when it cannot, in snow or
  // fog, say, it comes up to its end no faster than it could stop there from, and edges in)
  const far = offsetPoint(e, exitOf(nw, c.dir), -(e.lane_offsets?.[0] ?? e.lane_width / 2));
  const through = c.inside || world.visibility.canSee(ego, far[0], far[1]);
  const limit = Math.min(narrowSpeed(c.gap, !!squeeze), through ? Infinity : edgeSpeed(c.gap - WAIT_M - EDGE_LEAD_M));
  return { id: nw.id, street: nw.name || "", length_m: Math.round(nw.b - nw.a), gap_m: r1(c.gap), inside: c.inside,
    priority: wait ? "oncoming" : "car", reason: turn.reason, committed: turn.committed, sees_through: through,
    oncoming: o ? { id: o.id, inside: o.inside, gap_m: r1(Math.max(0, o.gap)), speed: r1(o.speed) } : null,
    wait, stop_s_route: stop, bumper_to_stop_m: wait ? stop - frontS : null, entry_s_route: c.en,
    limit_mps: limit, squeeze: !!squeeze && squeeze.v !== ego,
    detour: shift < 0 ? { id: `sb:${nw.id}`, from: c.en - EASE_IN_M, full: c.en - 1, back: c.ex + 1, to: c.ex + EASE_OUT_M, shift: Math.round(shift * 100) / 100 } : null };
}

// The corner the car comes to next on its route: at the end of the street it is on (a junction), with a
// pile at either kerb there hiding where people wait to cross the car's street.
function egoCorner(world, p, frontS) {
  const sb = world.snowbanks, ego = world.ego, route = world.route, map = world.map;
  if (!route) return null;
  const i = route.edgeIndexAt(p.s), e = map.edges.get(route.edges[i]);
  if (!e || !QUIET.has(e.cls)) return null;
  const info = nodeInfo(map, e.to);
  if (!info.junction) return null;
  const L = lengthOf(e), legS = L - Math.min(L / 2, info.half + CROSS_BEYOND_CURB_M), lane = e.lane_offsets?.[e.lanes - 1] ?? e.lane_width / 2;
  const q = projectPoint(route.pts, route.cum, offsetPoint(e, legS, lane), p.index);
  if (!q || q.distance > 4) return null;
  const gap = q.s - frontS - 1.5;
  if (gap < -1 || gap > CORNER_LOOK_M) return null;
  const twin = !e.oneway ? oppositeOf(map, e) : null;
  const sides = [];
  for (const pile of sb.piles) {
    const right = pile.edge === e.id && pile.end === "end" && pile.side > 0, left = (twin && pile.edge === twin.id && pile.end === "start") || (pile.edge === e.id && pile.end === "end" && pile.side < 0);
    if (!right && !left) continue;
    const spot = offsetPoint(e, legS, sidewalkOffset(e, right ? 1 : -1));
    if (sb.blocksView([ego.x, ego.y], spot)) sides.push(right ? "right" : "left");
  }
  if (!sides.length) return null;
  return { node: e.to, side: sides.length > 1 ? "both" : sides[0], gap_m: Math.round(Math.max(0, gap) * 10) / 10, limit_mps: cornerSpeed(gap) };
}

// Coming up to a corner it cannot see round: slowing gently to CREEP_MPS by CREEP_AT_M short of the
// crosswalk there.
export function cornerSpeed(gap) {
  return Math.sqrt(CREEP_MPS * CREEP_MPS + 2 * 0.6 * comfort().decel * Math.max(0, gap - CREEP_AT_M));
}

// The audit (World.audit): the driven car's front coming into a narrowed stretch while a vehicle it could
// see coming the other way had the way (in it, committed, or there first): `snowbank_conflicts`, once a
// time in. `World.snowbanksSeen` once it has come within SEEN_M of one.
export function auditSnowbanks(world) {
  const sb = world.snowbanks;
  if (!sb?.narrowings.length) return;
  const ego = world.ego, calls = world.snowbankCalls ||= new Map();
  for (const nw of sb.narrowings) {
    const c = Math.abs(ego.x - nw.x) < nw.reach + LOOK_M && Math.abs(ego.y - nw.y) < nw.reach + LOOK_M ? sb.claimFor(nw, ego) : null;
    if (!c) { calls.delete(nw.id); continue; }
    if (c.gap < SEEN_M) world.snowbanksSeen = true;
    const call = calls.get(nw.id);
    if (call && !call.inside && c.inside && ego.v > 0.3) {
      const turn = narrowingTurn(sb, nw, { ...c, inside: false, gap: 0.01 }, (v) => world.sees(ego, v));
      const o = turn.oncoming;
      if (o) {
        world.violations.snowbank_conflicts = (world.violations.snowbank_conflicts || 0) + 1;
        world.events.push({ type: "snowbank_conflict", with: o.id, narrowing: nw.id, reason: turn.reason === "turn" ? "out_of_turn" : turn.reason === "inside" ? "oncoming_inside" : "forced_to_stop", street: nw.name || "" });
      }
    }
    calls.set(nw.id, { inside: c.inside });
  }
}

// What the HUD says about snowbanks ahead, or null: from the autopilot's sensing, or, driving by hand,
// worked out the same way.
export function snowbankNotice(world, snap = null) {
  let sbk = snap?.snowbank;
  if (!snap && world.snowbanks?.enabled && world.route) {
    const p = world.route.project(world.ego.x, world.ego.y, world.route.hint ?? 0);
    if (p) sbk = snowbankAhead(world, p, p.s + world.ego.spec.length - world.ego.spec.rearOverhang);
  }
  const n = sbk?.narrowing;
  if (n && n.gap_m < SEEN_M && !n.inside) {
    if (n.wait) return { key: `${n.id}:wait:${n.oncoming?.id ?? ""}`, wait: true, text: n.reason === "turn" ? "SNOWBANKS · ONE CAR AT A TIME · THEIR TURN FIRST" : "SNOWBANKS · ONE CAR AT A TIME · WAIT FOR THE ONCOMING CAR" };
    return { key: `${n.id}:go`, wait: false, text: "SNOWBANKS · ONE CAR AT A TIME · YOUR TURN, KEEP TO THE MIDDLE" };
  }
  if (n?.squeeze) return { key: `${n.id}:squeeze`, wait: true, text: "SNOWBANKS · ONCOMING CAR IN THE NARROW STRETCH · SQUEEZE PAST SLOWLY" };
  if (sbk?.corner) return { key: `corner:${sbk.corner.node}`, wait: false, text: "SNOWBANK HIDES THE CORNER · CREEP UP AND LOOK" };
  return null;
}
