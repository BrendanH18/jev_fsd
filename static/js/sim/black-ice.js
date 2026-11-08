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
// The days of the year (1 November, 31 March, a common year) between which a night can freeze.
const COLD_DAYS = [305, 90];
// On black ice it has seen (a lane law with `ice`, sim/controller.js), the driver only eases the pedals
// and the wheel: no more than GENTLE_SHARE of the ice's grip either way (under the audit's HARD_SHARE
// and the forward sims' SIM_HARD_SHARE), and the wheel turned no faster than ICE_STEER_RATE (rad/s: a
// quick turn of the wheel slides the front tyres past their small sliding angle on ice before the car
// can yaw). It starts ICE_LEAD_S of travel before the front wheels reach the ice, for the pedals' lag.
export const GENTLE_SHARE = 0.5, ICE_STEER_RATE = 0.15, ICE_LEAD_S = 0.6, STEER_LAT_SHARE = 0.6;
// The car crosses a patch in a bend no faster than keeps its sideways acceleration within LAT_SHARE of
// the ice's grip.
export const LAT_SHARE = 0.4;
// On or coming up to black ice it has seen, the car keeps to a speed from which it can stop at
// GENTLE_SHARE of the ice's grip for the car ahead (ICE_GAP_M short of it), the line ahead and the
// destination.
export const ICE_GAP_M = 4, STOP_PLAN_SHARE = 0.7;

// Whether the weather and the time of day (`clock.hour`) favour black ice: { kind, text }, or null. Snow
// at any hour (what melts refreezes); freezing fog by night and in the morning; rain on a road cooling
// toward freezing late at night and early in the morning; and frost after a clear, cold night. Those
// three need the clock's `day` of the year in the cold season (COLD_DAYS, November to March): a clock
// without one (free drives keep the sky's late-September sun) or without a clock, only snow.
export const isColdSeason = (day) => Number.isFinite(day) && (day >= COLD_DAYS[0] || day <= COLD_DAYS[1]);
export function iceConditions(weather, clock) {
  if (weather === "snow") return { kind: "snow", text: "snow: what melts on the road refreezes" };
  const h = clock?.hour;
  if (!Number.isFinite(h) || !isColdSeason(clock.day)) return null;
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
// The driver's inputs on black ice it has seen (sim/controller.js, for a lane law with `ice`): `steer`
// and `accel` as asked, or eased while an axle is on a patch, or the front wheels will be within
// ICE_LEAD_S of travel: the pedals to GENTLE_SHARE of the ice's grip, the wheel at ICE_STEER_RATE.
export function gentleOnIce(vehicle, steer, accel, dt) {
  const at = ROAD.gripAt, P = vehicle.spec, c = Math.cos(vehicle.psi), s = Math.sin(vehicle.psi), wb = P.wheelbase;
  const lead = wb + Math.max(0, vehicle.v) * ICE_LEAD_S;
  const on = Math.min(at(vehicle.x, vehicle.y, P) ?? Infinity, at(vehicle.x + c * wb, vehicle.y + s * wb, P) ?? Infinity);
  // (still on the dry road, only speeding up is eased: braking there before the ice is what it is for)
  const mu = on < ROAD.mu ? on : at(vehicle.x + c * lead, vehicle.y + s * lead, P) ?? Infinity;
  if (!(mu < ROAD.mu)) return { steer, accel };
  const lim = GENTLE_SHARE * mu * G, turn = ICE_STEER_RATE * dt;
  // (and never so far that the turn asks more sideways grip than STEER_LAT_SHARE of the ice's: a lane change
  // on the ice is taken wider than on the dry road)
  const most = Math.atan(wb * STEER_LAT_SHARE * mu * G / Math.max(1, vehicle.v * vehicle.v));
  return { steer: Math.max(-most, Math.min(most, vehicle.delta + Math.max(-turn, Math.min(turn, steer - vehicle.delta)))), accel: Math.max(on < ROAD.mu ? -lim : -Infinity, Math.min(lim, accel)) };
}
// The gentlest grip among the seen patches (`ahead`, sensing's black_ice_ahead), for the stopping caps.
const gentleDecel = (ahead) => GENTLE_SHARE * Math.min(...ahead.map((a) => a.mu)) * G;
// The deceleration a stop is planned at on or coming up to black ice it has seen (brain/candidates.js:
// every lane manoeuvre that stops plans to stop as gently as the pedals are eased on the ice).
export const iceStopDecel = (ahead) => STOP_PLAN_SHARE * gentleDecel(ahead);
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
    // (no faster than its sideways grip allows round a bend on it: LAT_SHARE)
    const pa = m.patch, plan = Math.min(planSpeed(pa), bendSpeed(route, m.from - wb, m.to, pa.mu));
    // (on it, the car only eases toward its speed; slower than that, coming up to it, it speeds up no
    // further than that, and only gently once its front wheels are about to reach it: so it never
    // reaches the ice still accelerating, or has to brake on it for having sped up)
    const from = m.from - wb - EARLY_M;
    const slow = on ? { from, mps: easeToward(plan, v) } : v < plan ? { from: Math.min(from, s), mps: s >= from ? Math.min(plan, v + EASE_MPS) : plan } : { from, mps: plan };
    ahead.push({ id: pa.id, kind: pa.kind, name: pa.name, s_from: m.from, s_to: m.to, starts_in_m: startsIn, ends_in_m: m.to - frontS, length_m: Math.round((m.to - m.from) * 10) / 10,
      mu: pa.mu, safe_mps: safeSpeed(pa), speed_mps: plan, on_ice: on, slow: { from: slow.from, to: m.to + 0.5, mps: slow.mps } });
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

// Crossing a junction over black ice it has seen (brain/sensors.js clearTime, for the gaps it waits for
// in traffic: oncoming traffic turning left, traffic it gives way to): { mps, accel } it goes through at
// no faster than, and speeds up at, over the route from its front bumper (`frontS`) `distance` on, or
// null with no seen patch there. A turn across traffic on ice takes longer, so it needs a longer gap.
export function iceTurn(world, frontS, distance) {
  const ice = world.ice, route = world.route;
  if (!ice?.list.length || !route) return null;
  const see = seeRange(world), wb = world.ego.spec.wheelbase;
  let out = null;
  for (const m of marksAlong(ice, route)) {
    if (m.to < frontS - wb - 2 || m.from > frontS + distance) continue;
    if (m.from - frontS > see) continue;
    const pa = m.patch, mps = Math.min(planSpeed(pa), bendSpeed(route, m.from - wb, m.to, pa.mu)), accel = STOP_PLAN_SHARE * GENTLE_SHARE * pa.mu * G;
    out = out ? { mps: Math.min(out.mps, mps), accel: Math.min(out.accel, accel) } : { mps, accel };
  }
  return out;
}

// The driven car's speed limit (brain/sensors.js `snap.limit`) at route arc length s (rear axle), for
// the black ice it has seen and the bridge it is coming up to in icy conditions.
// On or coming up to black ice it has seen, also no faster than it can stop from at STOP_PLAN_SHARE of
// GENTLE_SHARE of the ice's grip wherever its way to a stop lies over ice: ICE_GAP_M short of the car
// ahead, short of the line ahead, at the destination, or where it stops to reverse into a parking space.
// A line or stop it is already too close to stop for even at the audit's HARD_SHARE is left to the rest
// of the planner (it has committed, or must brake hard: an emergency).
export function iceLimit(snap, s) {
  let limit = Infinity;
  const ahead = snap.black_ice_ahead;
  for (const a of ahead || []) limit = Math.min(limit, slowCap(a.slow, s));
  if (snap.ice_caution?.slow) limit = Math.min(limit, slowCap(snap.ice_caution.slow, s));
  if (ahead) {
    const d = gentleDecel(ahead), first = Math.min(...ahead.map((a) => a.starts_in_m)), v = Math.max(0, snap.ego?.v ?? 0);
    // (planned at STOP_PLAN_SHARE of that, for the speed control's lag behind it)
    const stopIn = (room, v0 = 0) => Math.sqrt(v0 * v0 + 2 * STOP_PLAN_SHARE * d * Math.max(0, room));
    // (one it could not stop for even at the audit's HARD_SHARE has been left too late: an emergency)
    const canStop = (room) => v * v <= 2 * (HARD_SHARE / GENTLE_SHARE) * d * room + 0.25;
    const f = snap.following;
    // (the car ahead may brake as hard as the road under it lets it, and stops within vL² / 2aL: the car
    // keeps room to stop gently behind where it would stop)
    if (f && f.gap_m - ICE_GAP_M > first) {
      const vL = Math.max(0, f.speed || 0), lead = f.vehicle, aL = ((lead && ROAD.gripAt?.(lead.x, lead.y, lead.spec)) ?? ROAD.mu) * G;
      limit = Math.min(limit, stopIn(f.gap_m - ICE_GAP_M + vL * vL / (2 * aL)));
    }
    const i = snap.intersection, line = i && !i.entered && i.bumper_to_line_m > 0 ? i.bumper_to_line_m - 1 : null;
    if (line !== null && line > first && canStop(line)) limit = Math.min(limit, stopIn(line));
    // (the destination, or, parking there, where the car stops to reverse into the space)
    for (const goal of [snap.nav?.remaining_m, snap.parking?.mode === "in" ? snap.parking.stop_in_m : null]) {
      if (goal != null && goal > first && canStop(goal)) limit = Math.min(limit, stopIn(goal));
    }
  }
  return limit;
}

// The fastest a vehicle can go round the bends of `line` (the driven car's route, or a traffic car's
// path: anything with `length` and `headingAt`) between arc lengths a and b keeping its sideways
// acceleration within LAT_SHARE of grip `mu`, each bend's radius from its heading over 12 m as
// Route.curveSpeedAt measures it.
function bendSpeed(line, a, b, mu) {
  const aLat = LAT_SHARE * mu * G;
  let v = Infinity;
  for (let x = Math.max(0, a); x <= b; x += 3) {
    const s0 = Math.min(x, line.length - 1);
    let dh = Math.abs(line.headingAt(Math.min(line.length, s0 + 6)) - line.headingAt(Math.max(0, s0 - 6)));
    while (dh > Math.PI) dh = Math.abs(dh - 2 * Math.PI);
    if (dh >= 1e-3) v = Math.min(v, Math.sqrt(aLat * 12 / dh));
  }
  return v;
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
    // (and no faster round a bend on the ice than its sideways grip allows, as the driven car: bendSpeed)
    for (const r of ice.onEdge(pe.id)) {
      const from = pe.sStart + r.from * k, to = pe.sStart + r.to * k;
      cap(from, to, Math.min(safeSpeed(r.patch) * NPC_SHARE, bendSpeed(path, from - (n.spec?.wheelbase ?? 2.7), to, r.patch.mu)));
    }
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
  if (!world.ice?.enabled) return null;
  // (driving by hand there is no snapshot: what sensing would see, along the route, with its hint so
  // the car's own route position stays as it was)
  if (!snap && world.route) {
    const p = world.route.project(world.ego.x, world.ego.y, world.route.hint ?? 0);
    if (p) snap = iceSensing(world, p, p.s + world.ego.spec.length - world.ego.spec.rearOverhang);
  }
  if (!snap) return null;
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
