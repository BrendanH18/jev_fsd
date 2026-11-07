// Black ice: a thin, clear glaze of ice on the asphalt, nearly invisible, that grips about a tenth as
// well as dry pavement. When it is near freezing it forms first on bridge decks and overpasses, which
// lose heat from below as well as above, and on stretches of street in the shade of tall buildings,
// where the low sun never reaches, often while the rest of the road looks only dry or damp. Each patch
// covers the roadway, kerb to kerb, over a stretch of one street (`from`, `to`: metres along its
// centreline), with its own grip (`mu`, MU_MIN to MU_MAX).
//
// A driver who knows the conditions favour ice eases off before a bridge (CAUTION_MPS, "bridges freeze
// first"). The ice itself is seen late: by day only close up (SEE_DAY_M), at night as a faint sheen in
// the headlights (SEE_NIGHT_M). Having seen a patch, a driver slows before it to the speed it can be
// crossed at (safeSpeed: one from which the car could still stop on it), braking on the dry road, and
// crosses it without braking, accelerating or steering hard: on the ice it only eases off (EASE_MPS a
// decision), never brakes.
//
// Every vehicle (the driven car, traffic, cyclists, and every candidate's forward sim) feels it through
// the one car model: sim/vehicle.js ROAD.gripAt gives the grip under each axle, which this module sets
// while a world has ice on, and clears (null) in every world that has not, so that a world without it
// steps exactly as before. Rail vehicles run on steel and do not feel it.
//
// Opt-in: the World option `ice` (free drives, unless `?ice=0`; challenges with `ice: true`). With it off
// nothing is placed, no random stream is drawn from and nothing is computed, so the seeded benchmark and
// the other challenges play out exactly as before. With it on:
//   - patches are placed from their own random stream on the map's bridges (the bridges layer,
//     jev/osm/bridges.py) and on shaded stretches beside tall buildings, and lie on the road while the
//     weather and the time of day favour ice (iceConditions; a challenge places its own: setList);
//   - the driven car's sensing reports the patches it has seen ahead (`black_ice`, `black_ice_ahead`)
//     and, while conditions favour ice, a caution and the next bridge (`ice_caution`), both of which cap
//     `snap.limit` (iceLimit); every lane manoeuvre slows for the ice it has seen (`slowTo`,
//     sim/controller.js), `slow_for_ice` eases off early, and a forward sim that takes the car onto a
//     patch too fast, or brakes, accelerates or steers hard on one, is rejected (`crosses_ice_too_fast`,
//     `brakes_on_ice`, iceSimCheck);
//   - traffic and cyclists do the same (npcIce, sim/npc.js);
//   - the audit counts the car crossing a patch more than OVER_MPS over its safe speed, or braking,
//     accelerating or skidding on one (`ice_overspeed`, auditIce); it reaches the metrics, and fails a
//     drive, only once the car has come near a patch (World.iceSeen).

import { rng } from "../common.js";
import { ROAD, G } from "./vehicle.js";
import { cumulative, pointAt } from "../map/mapdata.js";
import { approachSpeed, slowCap } from "./potholes.js";

// A patch's grip, from its own stream.
export const MU_MIN = 0.10, MU_MAX = 0.15;
// The speed to cross a patch at: one from which the car could still stop within STOP_M on it, braking
// at BRAKE_SHARE of its grip (about 29 km/h on a glaze of 0.12).
export const STOP_M = 40, BRAKE_SHARE = 0.7;
// The audit: crossing faster than its safe speed plus OVER_MPS; braking or accelerating harder than
// HARD_SHARE of its grip, or the tyres sliding sideways past SKID (sim/vehicle.js `slipping`), on it,
// above HARD_MIN_MPS (slower than that nothing much happens).
export const OVER_MPS = 10 / 3.6, HARD_SHARE = 0.75, SKID = 0.2, HARD_MIN_MPS = 2.5;
// A forward sim (brain/candidates.js) is rejected for going onto a seen patch faster than its safe speed
// plus SIM_OVER_MPS, or, once HARD_AFTER_S into it (the actuator's lag), braking or accelerating harder
// than SIM_HARD_SHARE of the patch's grip, or skidding, on one.
export const SIM_OVER_MPS = 0.5, SIM_HARD_SHARE = 0.6, HARD_AFTER_S = 0.4;
// How far ahead a driver sees a patch: by day only close up; at night its sheen catches the headlights.
export const SEE_DAY_M = 20, SEE_NIGHT_M = 40;
// While conditions favour ice, drivers keep to CAUTION_MPS across a bridge, from its start to its end,
// looking BRIDGE_LOOK_M ahead for one.
export const CAUTION_MPS = 40 / 3.6, BRIDGE_LOOK_M = 120;
// Stretches of bridge along a route closer together than this are one bridge.
const BRIDGE_JOIN_M = 50;
// On a patch, a driver faster (or slower) than its speed eases toward it by no more than this a decision.
export const EASE_MPS = 0.3;
// The car plans to cross at this share of the safe speed, at it this far before its front wheels reach
// the ice; `slow_for_ice` is there ICE_EARLY_M sooner.
const PLAN_SHARE = 0.95, EARLY_M = 4;
export const ICE_EARLY_M = 10;
// Traffic plans more gently and earlier, a little under the speed.
const NPC_LOOK_M = 70, NPC_SHARE = 0.9, NPC_SLOW_SHARE = 0.4, NPC_EARLY_M = 6;
// Placement: a patch on a bridge with chance P_BRIDGE, 25 to 70 m of it; on a stretch at least
// SHADE_RUN_M long in the shade of a building SHADE_H or taller (one to its south, within SHADE_REACH
// times its height and SHADE_MAX_M, inside SHADE_SECTOR of due south: the low winter sun), with chance
// P_SHADE, 10 to 30 m of it; none within END_M of a street's ends (the junctions), none shorter than
// MIN_PATCH_M, none on service roads or roundabout rings.
const P_BRIDGE = 0.8, P_SHADE = 0.2, END_M = 8, MIN_PATCH_M = 10;
const SHADE_H = 20, SHADE_REACH = 2.5, SHADE_MAX_M = 90, SHADE_SECTOR = 50 * Math.PI / 180, SHADE_STEP_M = 4, SHADE_RUN_M = 20;
const STEP_M = 2, CELL = 25;
// The car has come near a patch (World.iceSeen) with one this far ahead of its front, or under it.
const NEAR_AHEAD_M = 40;
// Rail vehicles (sim/streetcar.js, sim/rail.js) run on steel rails.
const RAIL = new Set(["streetcar", "train"]);

// Whether the weather and the time of day (`clock.hour`) favour black ice: { kind, text }, or null. Snow
// at any hour (what melts refreezes); freezing fog by night and in the morning; rain on a road cooling
// toward freezing late at night and early in the morning; and frost after a clear, cold night. Without
// a clock, only snow.
export function iceConditions(weather, clock) {
  if (weather === "snow") return { kind: "snow", text: "snow: what melts on the road refreezes" };
  const h = clock?.hour;
  if (!Number.isFinite(h)) return null;
  if (weather === "fog" && (h < 11 || h >= 18)) return { kind: "freezing_fog", text: "freezing fog near zero" };
  if (weather === "rain" && (h < 9 || h >= 20)) return { kind: "freezing_rain", text: "rain on a road cooling to freezing" };
  if (weather === "dry" && (h < 9 || h >= 22)) return { kind: "frost", text: "a clear night near freezing: frost on the road" };
  return null;
}

// The speed to cross patch `p` at, and the speed the car plans to cross it at.
export const safeSpeed = (p) => Math.sqrt(2 * BRAKE_SHARE * p.mu * G * STOP_M);
export const planSpeed = (p) => safeSpeed(p) * PLAN_SHARE;
// On a patch at `v`, the speed to keep to for now: toward `mps`, by no more than EASE_MPS.
export const easeToward = (mps, v) => v > mps ? Math.max(mps, v - EASE_MPS) : Math.min(mps, v + EASE_MPS);
// How far ahead the driven car sees a patch (`world.visibility`: night, and the sight range).
export function seeRange(world) {
  const night = (world.visibility?.night ?? 0) > 0.5;
  return Math.min(night ? SEE_NIGHT_M : SEE_DAY_M, world.visibility?.range ?? Infinity);
}

// A patch on edge `e` from `a` to `b` (metres along its centreline), kerb to kerb: { id, kind, name,
// edge, from, to, mu, lo, hi (its sides, metres right of the centreline), pts, cum, len, box, shape }.
export function patchOn(map, edgeId, a, b, { id, kind = "bridge", name = "", mu = 0.12, shape = 1 } = {}) {
  const e = map.edges.get(edgeId);
  if (!e || !(b > a)) return null;
  const k = e.cum[e.cum.length - 1] / Math.max(1e-6, e.length), pts = [];
  for (let s = a * k; s < b * k - 0.5; s += STEP_M) pts.push(pointAt(e.pts, e.cum, s));
  pts.push(pointAt(e.pts, e.cum, b * k));
  const cum = cumulative(pts), [lo, hi] = e.asphalt || [-e.width / 2, e.width / 2], r = Math.max(-lo, hi) + 0.5;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return { id, kind, name: name || e.name || "", edge: edgeId, from: a, to: b, mu, lo, hi, pts, cum, len: cum[cum.length - 1],
    box: [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r], shape };
}

// Whether (x, y) is on patch `p`: alongside it, between its ends, and between its sides.
export function inPatch(p, x, y) {
  if (x < p.box[0] || x > p.box[2] || y < p.box[1] || y > p.box[3]) return false;
  let best = Infinity, lateral = 0, outside = false;
  const n = p.pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = p.pts[i], b = p.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], seg2 = dx * dx + dy * dy;
    const t = seg2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / seg2 : 0, tc = Math.max(0, Math.min(1, t));
    const qx = a[0] + dx * tc, qy = a[1] + dy * tc, d = Math.hypot(x - qx, y - qy);
    if (d < best) {
      best = d; lateral = seg2 > 0 ? ((x - qx) * dy - (y - qy) * dx) / Math.sqrt(seg2) : 0;
      outside = (i === 0 && t < 0) || (i === n - 1 && t > 1);
    }
  }
  return !outside && lateral >= p.lo && lateral <= p.hi;
}

// The two-way street's other direction: the edge from e's end back to its start, as long.
function twinOf(map, e) {
  for (const id of map.out.get(e.to) || []) {
    const t = map.edges.get(id);
    if (t.to === e.from && Math.abs(t.length - e.length) < 1) return t;
  }
  return null;
}

// Where black ice may form on a map, from the stream `random`: on its bridges and in the shade.
function placePatches(map, random) {
  const out = [], done = new Set();
  const key = (e) => [e.from, e.to].sort().join("|");
  const mu = () => MU_MIN + random() * (MU_MAX - MU_MIN);
  for (const sp of map.bridges || []) {
    const e = map.edges.get(sp.edge);
    if (!e || done.has(key(e))) continue;
    done.add(key(e));
    const L = sp.to - sp.from;
    if (L < MIN_PATCH_M + 2 || random() > P_BRIDGE) continue;
    const len = Math.min(L - 2, 25 + random() * 45), a = sp.from + 1 + random() * (L - 2 - len);
    out.push(patchOn(map, e.id, a, a + len, { id: `ice${out.length + 1}`, kind: "bridge", name: sp.name, mu: mu(), shape: 1 + Math.floor(random() * 1e6) }));
  }
  const tall = [];
  for (const bld of map.pack?.buildings || []) {
    if (!(bld.h >= SHADE_H) || !bld.pts?.length) continue;
    const cx = bld.pts.reduce((s, q) => s + q[0], 0) / bld.pts.length, cy = bld.pts.reduce((s, q) => s + q[1], 0) / bld.pts.length;
    tall.push({ cx, cy, r: Math.max(...bld.pts.map((q) => Math.hypot(q[0] - cx, q[1] - cy))), reach: Math.min(SHADE_MAX_M, SHADE_REACH * bld.h) });
  }
  const shaded = (x, y) => tall.some((b) => {
    const dx = b.cx - x, dy = b.cy - y;
    if (dy >= 0 || -dy > b.reach + b.r || Math.abs(dx) > b.reach + b.r) return false;
    return Math.hypot(dx, dy) - b.r <= b.reach && Math.abs(Math.atan2(dx, -dy)) <= SHADE_SECTOR;
  });
  if (tall.length) for (const e of map.edges.values()) {
    if (e.ring || e.cls === "service" || done.has(key(e)) || e.length < 2 * END_M + SHADE_RUN_M) continue;
    done.add(key(e));
    const k = e.cum[e.cum.length - 1] / Math.max(1e-6, e.length);
    let run = null;
    const runs = [];
    for (let s = END_M; s <= e.length - END_M; s += SHADE_STEP_M) {
      const [x, y] = pointAt(e.pts, e.cum, s * k);
      if (shaded(x, y)) { if (run) run[1] = s; else runs.push(run = [s, s]); } else run = null;
    }
    for (const [a0, b0] of runs) {
      if (b0 - a0 < SHADE_RUN_M || random() > P_SHADE) continue;
      const len = Math.min(b0 - a0, 10 + random() * 20), a = a0 + random() * (b0 - a0 - len);
      out.push(patchOn(map, e.id, a, a + len, { id: `ice${out.length + 1}`, kind: "shade", mu: mu(), shape: 1 + Math.floor(random() * 1e6) }));
    }
  }
  return out.filter(Boolean);
}

// The black ice of a world. With `enabled`, its patches are placed from their own random stream, and
// lie on the road (`list`) while conditions favour ice (refresh, each step); the grip hook is installed.
export class BlackIce {
  constructor(world, { enabled = false, seed = 1 } = {}) {
    this.enabled = !!enabled;
    this.all = []; this.list = []; this.grid = new Map(); this.byEdge = new Map(); this.bridgeByEdge = new Map();
    this.version = 0; this.fixed = false; this.conditions = null; this.key = null;
    // (every world sets the hook afresh: none without ice, so that nothing about it is computed)
    ROAD.gripAt = null;
    if (!this.enabled) return;
    this.map = world.map;
    for (const sp of world.map.bridges || []) {
      if (!this.bridgeByEdge.has(sp.edge)) this.bridgeByEdge.set(sp.edge, []);
      this.bridgeByEdge.get(sp.edge).push(sp);
    }
    this.all = placePatches(world.map, rng(seed * 2654435761 + 233));
    this.hook = (x, y, spec) => this.muAt(x, y, spec);
    this.refresh(world);
  }

  // Whether conditions favour ice now (the world's weather and clock), and so which patches lie on the
  // road; and the grip hook, installed again (another world may have been built since).
  refresh(world) {
    ROAD.gripAt = this.hook;
    const cond = iceConditions(world.weather, world.clock);
    this.conditions = cond || (this.fixed ? { kind: "frost", text: "near freezing" } : null);
    const key = this.fixed ? "fixed" : cond ? "on" : "off";
    if (key === this.key) return;
    this.key = key;
    this.index(this.fixed || cond ? this.all : []);
  }

  // Replace the patches (a challenge places its own: lab/black-ice-challenge.js); they lie on the road
  // whatever the conditions.
  setList(list) {
    this.fixed = true; this.all = list.filter(Boolean); this.key = "fixed";
    if (!this.conditions) this.conditions = { kind: "frost", text: "near freezing" };
    this.index(this.all);
  }

  index(list) {
    this.list = list; this.grid = new Map(); this.byEdge = new Map(); this.version++;
    const add = (id, entry) => { if (!this.byEdge.has(id)) this.byEdge.set(id, []); this.byEdge.get(id).push(entry); };
    for (const p of list) {
      for (let i = Math.floor(p.box[0] / CELL); i <= Math.floor(p.box[2] / CELL); i++) for (let j = Math.floor(p.box[1] / CELL); j <= Math.floor(p.box[3] / CELL); j++) {
        const k = `${i},${j}`;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(p);
      }
      const e = this.map.edges.get(p.edge);
      add(p.edge, { patch: p, from: p.from, to: p.to });
      const t = e && twinOf(this.map, e);
      if (t) add(t.id, { patch: p, from: t.length - p.to, to: t.length - p.from });
    }
    for (const l of this.byEdge.values()) l.sort((x, y) => x.from - y.from);
  }

  // The patch at (x, y), or null.
  at(x, y) {
    if (!this.list.length) return null;
    for (const p of this.grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) || []) if (inPatch(p, x, y)) return p;
    return null;
  }

  // The grip at (x, y) for a vehicle `spec` (sim/vehicle.js ROAD.gripAt): a patch's, or null (ROAD.mu).
  muAt(x, y, spec) {
    if (!this.list.length || (spec && RAIL.has(spec.kind))) return null;
    const p = this.at(x, y);
    return p ? p.mu : null;
  }

  // The patches along an edge, { patch, from, to } in metres along it, in order (its own, and its twin's).
  onEdge(id) { return this.byEdge.get(id) || []; }
}

// The patches along a route (cached by route and placement): { patch, from, to } in route arc length,
// in order: where the route's line is on each.
const routeMarks = new WeakMap();
function marksAlong(ice, route) {
  const cached = routeMarks.get(route);
  if (cached && cached.version === ice.version && cached.list === ice.list) return cached.marks;
  const marks = [], open = new Map();
  for (let s = 0; s <= route.length + 1e-6; s += 1) {
    const [x, y] = route.pointAt(Math.min(s, route.length)), p = ice.at(x, y), last = [...open.keys()];
    for (const id of last) if (!p || p.id !== id) open.delete(id);
    if (!p) continue;
    if (!open.has(p.id)) { const m = { patch: p, from: Math.max(0, s - 0.5), to: s }; marks.push(m); open.set(p.id, m); }
    open.get(p.id).to = Math.min(route.length, s + 0.5);
  }
  marks.sort((a, b) => a.from - b.from);
  routeMarks.set(route, { version: ice.version, list: ice.list, marks });
  return marks;
}
// The bridges along a route (cached by route), in route arc length: { from, to, name }.
const routeBridges = new WeakMap();
function bridgesAlong(ice, route) {
  if (routeBridges.has(route)) return routeBridges.get(route);
  const out = [], starts = route.laneEdgeStarts ? route.laneEdgeStarts() : route.edgeStarts;
  for (let i = 0; i < route.edges.length; i++) {
    const back = i === 0 ? route.edgeStarts[1] - (route.map.edges.get(route.edges[0])?.length ?? 0) : 0;
    for (const sp of ice.bridgeByEdge.get(route.edges[i]) || []) {
      const from = Math.max(0, starts[i] + sp.from + back), to = Math.min(route.length, starts[i] + sp.to + back);
      if (to <= from) continue;
      const last = out[out.length - 1];
      // (one bridge in several spans, with a pier or an island between them, is one, named for its
      // longest span)
      if (last && from - last.to < BRIDGE_JOIN_M) {
        if (to - from > last.longest) { last.longest = to - from; last.name = sp.name; }
        last.to = Math.max(last.to, to);
        continue;
      }
      out.push({ from, to, name: sp.name, longest: to - from });
    }
  }
  routeBridges.set(route, out);
  return out;
}

// What the driven car knows about black ice (brain/sensors.js): `black_ice`, the next patch it has seen,
// and `black_ice_ahead`, every one it has seen: { id, kind ("bridge" or "shade"), name, s_from, s_to
// (route arc length), starts_in_m, ends_in_m (front bumper to its start and end), length_m, mu, safe_mps,
// speed_mps (to cross it at), on_ice (an axle on it), slow ({ from, to, mps }: in route arc length of the
// rear axle, from where it is down to `mps` until its rear wheels are off it; on the ice, easing toward
// its speed) }; and `ice_caution`, while conditions favour ice: { kind, text, bridge ({ name,
// starts_in_m, ends_in_m, on } of the next bridge within BRIDGE_LOOK_M, or null), slow (likewise, at
// CAUTION_MPS across it) }. Nulls with none.
export function iceSensing(world, p, frontS) {
  const ice = world.ice, route = world.route, ego = world.ego;
  if (!ice?.list.length || !route || !p) return { black_ice: null, black_ice_ahead: null, ice_caution: null };
  const wb = ego.spec.wheelbase, s = p.s, v = Math.max(0, ego.v), see = seeRange(world), ahead = [];
  for (const m of marksAlong(ice, route)) {
    if (m.to < s - 0.3) continue;
    const startsIn = m.from - frontS, on = s + wb >= m.from - 0.2;
    if (!on && startsIn > see) break;
    const pa = m.patch, plan = planSpeed(pa);
    ahead.push({ id: pa.id, kind: pa.kind, name: pa.name, s_from: m.from, s_to: m.to, starts_in_m: startsIn, ends_in_m: m.to - frontS, length_m: Math.round((m.to - m.from) * 10) / 10,
      mu: pa.mu, safe_mps: safeSpeed(pa), speed_mps: plan, on_ice: on, slow: { from: m.from - wb - EARLY_M, to: m.to + 0.5, mps: on ? easeToward(plan, v) : plan } });
  }
  let caution = null;
  if (ice.conditions) {
    const b = bridgesAlong(ice, route).find((x) => x.to > s - 0.3 && x.from - frontS < BRIDGE_LOOK_M);
    const front = frontS - s;
    caution = { kind: ice.conditions.kind, text: ice.conditions.text,
      bridge: b ? { name: b.name, starts_in_m: b.from - frontS, ends_in_m: b.to - frontS, on: frontS >= b.from } : null,
      slow: b ? { from: b.from - front - EARLY_M, to: b.to + 0.5, mps: CAUTION_MPS } : null };
  }
  return { black_ice: ahead[0] || null, black_ice_ahead: ahead.length ? ahead : null, ice_caution: caution };
}

// The driven car's speed limit (brain/sensors.js `snap.limit`) at route arc length s (rear axle), for
// the black ice it has seen and the bridge it is coming up to in icy conditions.
export function iceLimit(snap, s) {
  let limit = Infinity;
  for (const a of snap.black_ice_ahead || []) limit = Math.min(limit, slowCap(a.slow, s));
  if (snap.ice_caution?.slow) limit = Math.min(limit, slowCap(snap.ice_caution.slow, s));
  return limit;
}

// `slow_for_ice`'s plan (brain/candidates.js): every patch seen, at its speed ICE_EARLY_M sooner.
export const earlySlows = (ahead) => ahead.map((a) => ({ ...a.slow, from: a.slow.from - ICE_EARLY_M }));

// What a forward sim's car (`car`, t seconds in) does on the ice it has seen (brain/candidates.js):
// "fast" going onto one (not one it started on, `startOn`) faster than its safe speed plus
// SIM_OVER_MPS, "hard" braking, accelerating or skidding on one, or null.
export function iceSimCheck(ice, ahead, car, t, startOn) {
  const c = Math.cos(car.psi), sn = Math.sin(car.psi), wb = car.spec.wheelbase;
  const fx = car.x + c * wb, fy = car.y + sn * wb;
  for (const a of ahead) {
    const p = ice.list.find((x) => x.id === a.id);
    if (!p || !(inPatch(p, fx, fy) || inPatch(p, car.x, car.y))) continue;
    if (!startOn.has(p.id) && car.v > a.safe_mps + SIM_OVER_MPS) return "fast";
    if (t >= HARD_AFTER_S && car.v > HARD_MIN_MPS && (Math.abs(car.a) > SIM_HARD_SHARE * p.mu * G || car.slipping > SKID)) return "hard";
  }
  return null;
}
// The patches the car is on now (by id), for iceSimCheck.
export function patchesUnder(ice, v) {
  const c = Math.cos(v.psi), sn = Math.sin(v.psi), wb = v.spec.wheelbase, out = new Set();
  for (const p of [ice.at(v.x + c * wb, v.y + sn * wb), ice.at(v.x, v.y)]) if (p) out.add(p.id);
  return out;
}

// What traffic and cyclists do about black ice and icy bridges on their path (sim/npc.js): { limit } or
// null with none. Locals know where it forms: they slow for the bridges in icy conditions and for the
// patches NPC_LOOK_M ahead, and on the ice only ease off.
export function npcIce(world, n, front) {
  const ice = world.ice, path = n.path, map = world.map;
  if (!ice?.list.length || !path?.edges) return null;
  const s = path.s, v = Math.max(0, n.v);
  let limit = Infinity;
  const cap = (from, to, mps) => {
    if (to < s - 0.5 || from - front > NPC_LOOK_M) return;
    limit = Math.min(limit, front >= from ? easeToward(mps, v) : approachSpeed(mps, from - front - NPC_EARLY_M, NPC_SLOW_SHARE));
  };
  for (const pe of path.edges) {
    if (pe.sEnd < s - 2) continue;
    if (pe.sStart > front + NPC_LOOK_M) break;
    const e = map.edges.get(pe.id), k = (pe.sEnd - pe.sStart) / Math.max(1e-6, e?.length || 1);
    for (const r of ice.onEdge(pe.id)) cap(pe.sStart + r.from * k, pe.sStart + r.to * k, safeSpeed(r.patch) * NPC_SHARE);
    if (ice.conditions) for (const b of ice.bridgeByEdge.get(pe.id) || []) cap(pe.sStart + b.from * k, pe.sStart + b.to * k, CAUTION_MPS);
  }
  return limit === Infinity ? null : { limit };
}

// The audit (World.audit): the car crossing a patch more than OVER_MPS over its safe speed, or braking,
// accelerating or skidding on one above HARD_MIN_MPS, is counted once a patch each time it goes over it
// (`ice_overspeed`); and the car has come near black ice once a patch is under it or NEAR_AHEAD_M ahead
// of its front.
export function auditIce(world) {
  const ice = world.ice, ego = world.ego;
  if (!ice?.list.length) return;
  const calls = world.iceCalls ||= new Map();
  const spec = ego.spec, c = Math.cos(ego.psi), sn = Math.sin(ego.psi), wb = spec.wheelbase;
  const under = [ice.at(ego.x + c * wb, ego.y + sn * wb), ice.at(ego.x, ego.y)].filter(Boolean);
  if (!world.iceSeen) {
    const front = spec.length - spec.rearOverhang;
    if (under.length) world.iceSeen = true;
    else for (let d = 0; d <= NEAR_AHEAD_M; d += 4) if (ice.at(ego.x + c * (front + d), ego.y + sn * (front + d))) { world.iceSeen = true; break; }
  }
  const count = (p, call, reason) => {
    call.counted = true;
    world.violations.ice_overspeed = (world.violations.ice_overspeed || 0) + 1;
    world.events.push({ type: "ice_overspeed", patch: p.id, reason, kmh: Math.round(ego.v * 36) / 10, safe_kmh: Math.round(safeSpeed(p) * 36) / 10 });
  };
  for (const p of under) {
    let call = calls.get(p.id);
    if (!call) {
      calls.set(p.id, call = { counted: false });
      if (ego.v > safeSpeed(p) + OVER_MPS) { count(p, call, "fast"); continue; }
    }
    if (call.counted || ego.v <= HARD_MIN_MPS) continue;
    const hard = HARD_SHARE * p.mu * G;
    const reason = ego.a < -hard ? "brake" : ego.a > hard ? "accelerate" : ego.slipping > SKID ? "skid" : null;
    if (reason) count(p, call, reason);
  }
  for (const id of calls.keys()) if (!under.some((p) => p.id === id)) calls.delete(id);
}

// What the HUD tells the driver about black ice and icy bridges (from the car's sensing): { key, text,
// slow }, or null.
export function iceNotice(world, snap) {
  if (!world.ice?.enabled || !snap) return null;
  const a = snap.black_ice;
  if (a) {
    const kmh = Math.round(a.speed_mps * 3.6);
    if (a.on_ice) return { key: `${a.id}:on`, slow: false, text: `ON BLACK ICE · HOLD ${kmh} KM/H · NO BRAKING OR SHARP STEERING` };
    return { key: `${a.id}:ahead`, slow: world.ego.v > a.speed_mps + 0.5, text: `BLACK ICE AHEAD · EASE OFF TO ${kmh} KM/H BEFORE IT` };
  }
  const b = snap.ice_caution?.bridge;
  if (b && b.starts_in_m < 80) return { key: `bridge:${b.name}`, slow: world.ego.v > CAUTION_MPS + 0.5, text: `${b.name ? `${b.name.toUpperCase()} · ` : ""}BRIDGES FREEZE FIRST · ${Math.round(CAUTION_MPS * 3.6)} KM/H` };
  return null;
}
