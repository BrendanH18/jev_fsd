// Puddles at the kerb in the rain, and not splashing people. Rain runs off the crown of the road into
// the gutter and stands there wherever the drain cannot keep up: long, shallow puddles along the outer
// edge of the kerb lane, and wider, deeper ones at the corners of junctions and over blocked catch
// basins, some reaching into the right wheel path. A wheel through one fast throws a sheet of water
// over the kerb; drenching someone on the sidewalk, or waiting at the kerb or a bus stop, is careless
// (inconsiderate) driving in every Canadian province.
//
// Each puddle lies in the kerb lane of an edge (the lane furthest right) against the kerb: its arc
// length along the lane, its centre's offset right of the lane's centre, half its length along the
// lane (`a`), half its width across it (`b`) and its depth. It is the same shape as a pothole
// (sim/potholes.js), so the wheel tests there (wheelRoom, wheelsCross, inPothole, crossesPothole) serve
// for both; and while the puddles lie, a pothole full of rain water splashes just like one.
//
// A driver who sees a puddle ahead in its lane with someone within splash reach of it (splashRisk):
//   - where the lane leaves room, eases over inside it (left, away from the kerb) so that the right
//     wheels miss it, never crossing a lane line;
//   - otherwise slows below its splash speed (about 25 km/h for a shallow one, less for a deep one: the
//     sheet a tyre throws grows with the speed and the depth), braking gently by comfort(), and keeps
//     below it until its rear wheels are through.
// A puddle with nobody near is just water: no one slows for it.
//
// Opt-in: the World option `puddles` (free drives, unless `?puddles=0`; challenges with `puddles:
// true`). With it off nothing is placed, no random stream is drawn from and nothing is computed, so the
// seeded benchmark and the other challenges play out exactly as before. With it on, the puddles are
// placed from their own random stream, and lie on the road while it rains; they stay for the rest of
// the drive once it has rained (water drains slowly), until it snows (puddlesLie). While they lie:
//   - the driven car's sensing reports the next puddle in its lane with someone within reach
//     (`puddle_splash`, brain/sensors.js, which also caps `snap.limit` for one it cannot get round), the
//     candidates offer `ease_round_puddle` where there is room, every lane manoeuvre whose wheels would
//     go through one slows below its splash speed (`slowTo`, sim/controller.js), and a forward sim whose
//     wheel goes through one faster is rejected (`splashes_pedestrian`, brain/candidates.js);
//   - traffic does the same (npcPuddle, sim/npc.js);
//   - the audit counts each person the car splashes (`pedestrians_splashed`, auditPuddles); it reaches
//     the metrics, and fails a drive, only once the car has come up to a puddle with someone near it
//     (World.puddlesSeen).
// The spray of any vehicle driving through one fast, and a splashed person flinching, are render-only
// (render/puddles.js).

import { rng } from "../common.js";
import { pointAt, headingAt, wrapAngle } from "../map/mapdata.js";
import { GUTTER } from "../map/streets.js";
import { CAR } from "./vehicle.js";
import { current as weather } from "./weather.js";
import { approachSpeed, crossesPothole, easeLength, inPothole, slowCap, wheelPoints, wheelRoom, wheelsCross, ROOM_MARGIN_M } from "./potholes.js";

// The speed a tyre throws water over the kerb from a puddle REF_DEPTH_M deep, and the range for others
// (a shallower one only faster, a deeper one already slower: v ~ 1/sqrt(depth)).
export const REF_DEPTH_M = 0.02, REF_MPS = 25 / 3.6, MIN_MPS = 12 / 3.6, MAX_MPS = 32 / 3.6;
// The audit counts a splash once a wheel goes through one faster than its splash speed plus this.
export const SPLASH_OVER_MPS = 2 / 3.6;
// A forward sim (brain/candidates.js) whose wheel goes through one faster than its splash speed plus this is rejected.
export const SIM_OVER_MPS = 0.3;
// Where the water lands: from REACH_IN_M inside the puddle's kerb-side edge (someone standing in the
// gutter) to REACH_M beyond it, across the sidewalk; and along the street, from BACK_M behind the
// puddle to FORE_M ahead of it (the sheet goes forward and out).
export const REACH_M = 2.5, REACH_IN_M = 0.6, BACK_M = 1, FORE_M = 3;
// Planning ahead, someone counts if they could be within reach by the time the car gets there: the
// zone grows along the street by NEAR_M plus WALK_MPS for every second until then (at most NEAR_MAX_M),
// and across it by NEAR_SIDE_M.
const NEAR_M = 1, WALK_MPS = 1.6, NEAR_MAX_M = 9, NEAR_SIDE_M = 0.2;
// How far ahead a driver sees a puddle in the rain.
export const SEE_M = 60;
// Planning to slow for one, drivers brake at no more than this share of comfort().decel, to be below its
// splash speed this far before the front wheels reach it; and the car plans to go through at this
// share of the splash speed.
const SLOW_SHARE = 0.6, EARLY_M = 5, PLAN_SHARE = 0.9;
// Traffic plans more gently, a little earlier, a little slower.
const NPC_SLOW_SHARE = 0.4, NPC_EARLY_M = 6, NPC_SHARE = 0.85;
// Traffic eases over at most this fast, looking this far ahead, and is over by NPC_EASE_M short of it.
export const NPC_SHIFT_MPS = 0.6;
const NPC_EASE_M = 30, NPC_LOOK_M = 70;
// Placement, in each kerb lane of a main (tertiary and up) or quiet street at least MIN_LANE_M long: a
// corner puddle short of the junction the lane runs into with chance CORNER_P (on a main street; less
// on a quiet one), one over a catch basin every CATCH_M along it with chance CATCH_P, and long shallow
// ones, on average one every SHALLOW_EVERY_M (main) or QUIET_EVERY_M (quiet); none within GAP_M of
// another, nor within END_M of the lane's start.
const MIN_LANE_M = 30, CORNER_P = 0.55, QUIET_CORNER_P = 0.3, CATCH_M = 45, CATCH_P = 0.3, SHALLOW_EVERY_M = 110, QUIET_EVERY_M = 200, GAP_M = 2, END_M = 6;
const MAIN = new Set(["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "trunk", "trunk_link"]);
const QUIET = new Set(["residential", "unclassified", "living_street"]);
const CELL = 20;
// A car comes up to a puddle (World.puddlesSeen) with one this close ahead of its front, in or beside
// its lane, while someone is within reach of it.
const NEAR_AHEAD_M = 30, NEAR_SIDE_M_EGO = 2.5;

// The speed above which a tyre through puddle `h` throws water over the kerb.
export const splashSpeed = (h) => Math.max(MIN_MPS, Math.min(MAX_MPS, REF_MPS * Math.sqrt(REF_DEPTH_M / Math.max(0.005, h.depth))));
// The speed a driver plans to go through it at: no faster than the weather allows anywhere else.
export const planSpeed = (h) => splashSpeed(h) * Math.min(1, weather.speed) * PLAN_SHARE;

// Whether the puddles lie on the road: while it rains, and, once it has rained this drive, until it
// snows (World.puddlesRained).
export const puddlesLie = (world) => !!world.puddles?.enabled && (world.weather === "rain" || (!!world.puddlesRained && world.weather !== "snow"));

// The water on the road the car and traffic can splash people from: the puddles, and potholes full of
// rain water (sim/potholes.js), while the puddles lie.
const waterSets = (world) => (puddlesLie(world) ? (world.potholes?.list.length ? [world.puddles, world.potholes] : [world.puddles]) : []);

// A puddle in lane `laneIdx` of edge `edgeId`, `s` metres along the lane, reaching `width` metres out
// from the kerb (its kerb-side edge against the kerb, beyond the gutter): { id, edge, lane, s, offset, a,
// b, depth, shape, x, y, heading, lane_w, puddle }.
export function puddleOnLane(map, edgeId, laneIdx, s, { id, width = 1, a = 2, depth = REF_DEPTH_M, shape = 1 }) {
  const lane = map.lane(edgeId, laneIdx);
  if (!lane) return null;
  const e = lane.edgeRef, kerb = e.asphalt[1] - lane.offset + GUTTER, b = width / 2, offset = kerb - b;
  const p = pointAt(lane.pts, lane.cum, s), h = headingAt(lane.pts, lane.cum, s);
  return { id, edge: edgeId, lane: laneIdx, s, offset, a, b, depth, shape, x: p[0] + Math.sin(h) * offset, y: p[1] - Math.cos(h) * offset, heading: h, lane_w: e.lane_width, puddle: true };
}

// The puddles of a world. With `enabled`, placed in every kerb lane of the map from their own random
// stream (none on service roads or roundabout rings).
export class Puddles {
  constructor(map, { enabled = false, seed = 1 } = {}) {
    this.map = map;
    this.enabled = !!enabled;
    this.list = []; this.grid = new Map(); this.byLane = new Map(); this.byId = new Map(); this.version = 0;
    if (!this.enabled) return;
    const random = rng(seed * 2246822519 + 173);
    const out = [];
    for (const e of map.edges.values()) {
      const main = MAIN.has(e.cls);
      if ((!main && !QUIET.has(e.cls)) || e.ring) continue;
      const k = e.lanes - 1, lane = map.lane(e.id, k);
      if (!lane || lane.length < MIN_LANE_M) continue;
      const L = lane.length, here = [];
      // (at the corner, short of the junction: water runs down to the catch basin there)
      if (random() < (main ? CORNER_P : QUIET_CORNER_P)) here.push({ s: L - 6 - random() * 8, width: 0.9 + random() * 1.0, a: 1.2 + random() * 1.6, depth: 0.025 + random() * 0.035 });
      // (over catch basins along the block, some of them blocked)
      for (let s = 20 + random() * 10; s < L - 15; s += CATCH_M) if (random() < CATCH_P) here.push({ s, width: 0.6 + random() * 0.9, a: 0.8 + random() * 1.2, depth: 0.02 + random() * 0.03 });
      // (and long, shallow ones along the gutter)
      const every = main ? SHALLOW_EVERY_M : QUIET_EVERY_M;
      for (let s = END_M + random() * every; s < L - END_M; s += every * (0.5 + random())) here.push({ s, width: 0.4 + random() * 0.6, a: 2 + random() * 3, depth: 0.008 + random() * 0.012 });
      here.sort((x, y) => x.s - y.s);
      let last = -Infinity;
      for (const q of here) {
        const a = Math.min(q.a, q.s - 1, L - q.s - 1);
        if (a < 0.6 || q.s - a < last + GAP_M) continue;
        last = q.s + a;
        out.push(puddleOnLane(map, e.id, k, q.s, { id: `pd${out.length + 1}`, width: q.width, a, depth: q.depth, shape: 1 + Math.floor(random() * 1e6) }));
      }
    }
    this.setList(out);
  }

  // Replace the puddles (a challenge places its own: lab/puddle-challenge.js).
  setList(list) {
    this.list = list.filter(Boolean);
    this.grid = new Map(); this.byLane = new Map(); this.byId = new Map(); this.version++;
    for (const h of this.list) {
      this.byId.set(h.id, h);
      const r = Math.max(h.a, h.b) + 0.5;
      for (let i = Math.floor((h.x - r) / CELL); i <= Math.floor((h.x + r) / CELL); i++) for (let j = Math.floor((h.y - r) / CELL); j <= Math.floor((h.y + r) / CELL); j++) {
        const key = `${i},${j}`;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(h);
      }
      const key = `${h.edge}:${h.lane}`;
      if (!this.byLane.has(key)) this.byLane.set(key, []);
      this.byLane.get(key).push(h);
    }
    for (const l of this.byLane.values()) l.sort((x, y) => x.s - y.s);
  }

  // The puddles within about r of (x, y).
  near(x, y, r) {
    if (!this.list.length) return [];
    const out = new Set();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((y - r) / CELL); j <= Math.floor((y + r) / CELL); j++) {
      for (const h of this.grid.get(`${i},${j}`) || []) if (Math.abs(h.x - x) <= r + h.a + 1 && Math.abs(h.y - y) <= r + h.a + 1) out.add(h);
    }
    return [...out];
  }

  onLane(edge, lane) { return this.byLane.get(`${edge}:${lane}`) || null; }
}

// Whether a person at (x, y) is within splash reach of puddle `h`, the zone grown by `along` metres
// along the street and `side` across it (0, 0: where the water lands).
export function inReach(h, x, y, along = 0, side = 0) {
  const dx = x - h.x, dy = y - h.y, c = Math.cos(h.heading), s = Math.sin(h.heading);
  const u = dx * c + dy * s, v = dx * s - dy * c;
  return u >= -h.a - BACK_M - along && u <= h.a + FORE_M + along && v >= h.b - REACH_IN_M - side && v <= h.b + REACH_M + side;
}

// THE shared test. The people within splash reach of puddle `h` (or a pothole full of water), or who
// could be by the time a vehicle `eta` seconds away gets there (`eta` null: right now, exactly);
// `seen`, a test of who the driver can see (null: everyone). A list of pedestrians, empty when the
// puddle is just water. Used by sensing, the candidates, traffic, the audit and the renderer.
export function splashRisk(world, h, eta = null, seen = null) {
  const crowd = world.crowd;
  if (!crowd?.list.length) return [];
  const along = eta === null ? 0 : Math.min(NEAR_MAX_M, NEAR_M + WALK_MPS * Math.max(0, eta)), side = eta === null ? 0 : NEAR_SIDE_M;
  const out = [];
  for (const p of crowd.near(h.x, h.y, h.a + REACH_M + FORE_M + along + 2)) {
    if (p.kind !== "pedestrian" || (seen && !seen(p))) continue;
    if (inReach(h, p.x, p.y, along, side)) out.push(p);
  }
  return out;
}

// The water along a route (cached by route and placement): { h, s (route arc length of its centre),
// lateral (metres right of the route) }, in order. Only that lying along the route's street, going its
// way, within 6 m of its line.
const routeMarks = [new WeakMap(), new WeakMap()];
function marksAlong(set, route, which) {
  const cache = routeMarks[which], cached = cache.get(route);
  if (cached && cached.version === set.version && cached.list === set.list) return cached.marks;
  const marks = [], seen = new Set();
  for (let s = 0; s <= route.length; s += CELL / 2) {
    const [x, y] = route.pointAt(s);
    for (const h of set.near(x, y, CELL / 2 + 6)) {
      if (seen.has(h.id)) continue;
      const p = route.project(h.x, h.y, Math.max(0, route.pts.length > 1 ? Math.min(route.pts.length - 2, segAt(route, s)) : 0));
      if (!p || p.distance > 6 || Math.abs(wrapAngle(h.heading - p.heading)) > 0.6) continue;
      seen.add(h.id);
      marks.push({ h, s: p.s, lateral: p.lateral });
    }
  }
  marks.sort((x, y) => x.s - y.s);
  cache.set(route, { version: set.version, list: set.list, marks });
  return marks;
}
// (the index of the route segment at arc length s, as a projection hint)
function segAt(route, s) {
  const cum = route.cum;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  return lo;
}

// The puddles ahead in the driven car's lane with someone within splash reach (brain/sensors.js): the
// next one the car must ease round or slow for (`puddle`, or null) and every one within sight (`ahead`), each { id, kind ("puddle" or "pothole", one
// full of water), s_route (its centre), starts_in_m (front bumper to its near end; negative once in it),
// wheels_in_m, lateral_m (right of the car's lane centre), lateral_route, length_m, width_m, depth_cm,
// splash_mps (its splash speed), speed_mps (the speed to go through it at, weather included), people
// (how many are within reach), person_ids, room (the car can ease round it in its lane, in time),
// shift_m (how far right of the lane's centre to ease to: negative, left), slow ({ from, to, mps }: in
// route arc length of the rear axle), detour (the ease round, for controller.lateralAt; a pothole's is
// the pothole's own, sim/potholes.js), b }. Null with none. `visible`: the obstacles the car can see.
export function puddlesAhead(world, p, frontS, lane, limit, visible = null) {
  const route = world.route, ego = world.ego, sets = waterSets(world);
  if (!sets.length || !route || !p) return null;
  const spec = ego.spec, wb = spec.wheelbase, s = p.s;
  const see = Math.min(SEE_M, world.visibility?.range ?? Infinity);
  const ease = easeLength(limit), center = lane ? lane.center : 0, lateralNow = lane ? lane.lateral : 0;
  const seen = visible ? ((set) => (o) => set.has(o))(new Set(visible)) : null;
  const ahead = [];
  sets.forEach((set, which) => {
    for (const m of marksAlong(set, route, which)) {
      const h = m.h;
      if (m.s + h.a < s - 0.5) continue;
      if (m.s - h.a - frontS > see) break;
      const laneW = h.lane_w || 3.3, dl = m.lateral - (center - route.frameMove(s, m.s));
      // (in the car's lane: some of it within the lane's width either side of its centre)
      if (Math.abs(dl) - h.b > laneW / 2) continue;
      const eta = Math.max(0, m.s - h.a - frontS) / Math.max(3, ego.v);
      const people = splashRisk(world, h, eta, seen);
      if (!people.length) continue;
      let shift = wheelRoom(dl, h, laneW, spec);
      const full = m.s - h.a - wb - 1;
      // (too late to ease over that far: it slows instead)
      if (shift !== null && shift !== 0 && full - s < ease * 0.5 * Math.min(1, Math.abs(shift - lateralNow) / 0.5) && Math.abs(shift - lateralNow) > 0.25) shift = null;
      const mps = planSpeed(h);
      ahead.push({ id: h.id, kind: h.puddle ? "puddle" : "pothole", s_route: m.s, starts_in_m: m.s - h.a - frontS, wheels_in_m: m.s - h.a - (s + wb), lateral_m: Math.round(dl * 100) / 100,
        lateral_route: m.lateral, length_m: Math.round(2 * h.a * 10) / 10, width_m: Math.round(2 * h.b * 10) / 10, depth_cm: Math.round(h.depth * 100), splash_mps: splashSpeed(h), speed_mps: mps,
        people: people.length, person_ids: people.map((x) => x.id), room: shift !== null, shift_m: shift, slow: { from: m.s - h.a - wb - EARLY_M, to: m.s + h.a + 0.5, mps },
        detour: shift && h.puddle ? { from: full - ease, full, back: m.s + h.a + 1 + Math.min(15, Math.max(4, 0.8 * Math.max(ego.v, limit || 0))), to: 0, shift, puddle: h.id } : null, b: h.b });
    }
  });
  ahead.sort((x, y) => x.s_route - y.s_route);
  for (const a of ahead) if (a.detour) a.detour.to = a.detour.back + ease;
  // (the one reported is the next that asks something of the car: one its wheels already miss in the
  // middle of the lane stays in `ahead`, for a manoeuvre that would move over into it)
  return ahead.length ? { puddle: ahead.find((a) => !a.room || a.shift_m) || null, ahead } : null;
}

// The driven car's speed limit (brain/sensors.js `snap.limit`) at route arc length s (rear axle) for a
// puddle with someone near that it cannot ease round (`a`, from puddlesAhead): below its splash speed
// before the weather, which the target speed then takes off as it does anywhere else.
export const puddleLimit = (a, s) => slowCap({ ...a.slow, mps: a.splash_mps * PLAN_SHARE }, s);

// The puddle (or pothole full of water) objects behind puddlesAhead's entries, for the forward sims.
export function splashTargets(world, ahead) {
  if (!ahead?.length) return null;
  const out = [];
  for (const a of ahead) {
    const h = a.kind === "puddle" ? world.puddles?.byId.get(a.id) : world.potholes?.list.find((x) => x.id === a.id);
    if (h) out.push(h);
  }
  return out.length ? out : null;
}

// Whether a forward sim's tyres (`before`, `after`: wheelPoints) went through one of `targets` faster
// than its splash speed, at speed `v` (brain/candidates.js `splashes_pedestrian`).
export function simSplashes(targets, before, after, v) {
  for (const h of targets) if (v > splashSpeed(h) + SIM_OVER_MPS && after.some(([x, y], i) => crossesPothole(h, before[i][0], before[i][1], x, y))) return true;
  return false;
}

// Every lane manoeuvre whose wheels (centre `lateralAt` metres right of the route at a puddle) would go
// through one with someone near, or within LAW_PAD_M of it: the speed caps it slows to (controller
// `slowTo`). (Less than the room wheelRoom leaves, so easing round one never slows for it.)
const LAW_PAD_M = 0.1;
export const lawSlows = (ahead, lateralAt, spec) => ahead.filter((a) => wheelsCross(lateralAt(a.s_route), a.lateral_route, a, spec, LAW_PAD_M)).map((a) => a.slow);

// What traffic does for the puddles with someone near on its path (sim/npc.js): { shift (metres right
// of its lane's centre to ease to now), limit (the speed to keep to) } or null with none. `n.path` is an
// NpcPath; `front`, its front's arc length along it; `base`, where it keeps in its lane otherwise
// (metres right of the centre); `busy`, already off the middle of its lane for something else (it
// slows instead of easing over); `heading`, where it is moving to in the lane (easing round a pothole,
// say), if elsewhere.
export function npcPuddle(world, n, front, base = 0, busy = false, heading = base) {
  const sets = waterSets(world), path = n.path, map = world.map, spec = n.spec || CAR;
  if (!sets.length || !path?.edges) return null;
  const wb = spec.wheelbase, s = path.s;
  let shift = null, limit = Infinity;
  for (const pe of path.edges) {
    if (pe.sEnd < s - 2) continue;
    if (pe.sStart > front + NPC_LOOK_M) break;
    const lane = map.lane(pe.id, pe.lane);
    if (!lane) continue;
    const k = (pe.sEnd - pe.sStart) / Math.max(1e-6, lane.length);
    for (const set of sets) {
      const list = set.onLane(pe.id, pe.lane);
      if (!list) continue;
      for (const h of list) {
        const at = pe.sStart + h.s * k;
        if (at + h.a < s - 0.5) continue;
        if (at - h.a > front + NPC_LOOK_M) break;
        // (only one its wheels would go through where it is keeping to)
        if (!wheelsCross(base + (n.pdShift || 0), h.offset, h, spec, 0.1) && !wheelsCross(base, h.offset, h, spec, 0.1) && !wheelsCross(heading, h.offset, h, spec, 0.1)) continue;
        const ahead = at - h.a - (s + wb);
        if (!splashRisk(world, h, Math.max(0, at - h.a - front) / Math.max(3, n.v)).length) continue;
        const room = h.puddle && !busy ? wheelRoom(h.offset, h, h.lane_w, spec) : null;
        let round = false;
        if (room !== null && shift === null) {
          // (over by the time its front wheels are NPC_EASE_M short of it, from where it is now)
          if (ahead < NPC_EASE_M) { shift = room; round = Math.abs(room - (n.pdShift || 0)) <= NPC_SHIFT_MPS * Math.max(0, ahead) / Math.max(1, n.v) + 0.05; }
          else round = true;
        } else if (room !== null) round = !wheelsCross(base + shift, h.offset, h, spec, ROOM_MARGIN_M);
        if (!round) {
          const mps = splashSpeed(h) * Math.min(1, weather.speed) * NPC_SHARE, from = at - h.a - wb - NPC_EARLY_M;
          if (at + h.a + 0.5 >= s) limit = Math.min(limit, s >= from ? mps : approachSpeed(mps, from - s, NPC_SLOW_SHARE));
        }
      }
    }
  }
  return shift === null && limit === Infinity ? null : { shift: shift ?? 0, limit };
}

// The puddles (and potholes full of water) a vehicle's tyres are in, with the speed it is going through
// them faster than their splash speed: [{ h, over }] (render/puddles.js spray, and the audit).
export function wheelsInWater(world, v) {
  const sets = waterSets(world);
  if (!sets.length) return [];
  const spec = v.spec || CAR, c = Math.cos(v.psi), sn = Math.sin(v.psi), wheels = wheelPoints(v), out = [];
  for (const set of sets) for (const h of set.near(v.x + c * spec.wheelbase / 2, v.y + sn * spec.wheelbase / 2, spec.wheelbase / 2 + 3)) {
    if (wheels.some(([x, y]) => inPothole(h, x, y))) out.push({ h, over: Math.abs(v.v) - splashSpeed(h) });
  }
  return out;
}

// The audit (World.audit): each person within reach of a puddle (or a pothole full of water) a wheel of
// the car goes through faster than its splash speed plus SPLASH_OVER_MPS is splashed, counted once a
// person each time the car goes through it; and the car has come up to a puddle once one with someone
// within reach is NEAR_AHEAD_M ahead of its front, in or beside its lane.
export function auditPuddles(world) {
  if (world.weather === "rain") world.puddlesRained = true;
  if (!puddlesLie(world)) { world.puddleWarn = null; return; }
  const ego = world.ego, spec = ego.spec, c = Math.cos(ego.psi), sn = Math.sin(ego.psi), front = spec.length - spec.rearOverhang;
  const calls = world.puddleCalls ||= new Map();
  // (one ahead in or beside its lane with someone within reach: the car has come up to it, and the coach
  // warns while the car is going faster than its splash speed, sim/drive-score.js)
  let warn = null;
  for (const set of waterSets(world)) {
    for (const h of set.near(ego.x + c * (front + NEAR_AHEAD_M / 2), ego.y + sn * (front + NEAR_AHEAD_M / 2), NEAR_AHEAD_M / 2 + 2)) {
      const dx = h.x - ego.x, dy = h.y - ego.y, ahead = dx * c + dy * sn - front, side = Math.abs(dx * sn - dy * c);
      if (!(ahead > -front - h.a && ahead < NEAR_AHEAD_M + h.a && side < NEAR_SIDE_M_EGO + h.b) || !splashRisk(world, h).length) continue;
      world.puddlesSeen = true;
      // (its wheels going through it where the car is now, across the lane)
      if (!warn && ego.v > splashSpeed(h) && ahead > 0 && wheelsCross(0, dx * sn - dy * c, h, spec, 0.05)) warn = { puddle: h.id, splash_kmh: Math.round(splashSpeed(h) * 36) / 10 };
    }
  }
  world.puddleWarn = warn;
  const here = new Set();
  for (const { h, over } of wheelsInWater(world, ego)) {
    here.add(h.id);
    if (over <= SPLASH_OVER_MPS) continue;
    const people = splashRisk(world, h);
    if (!people.length) continue;
    world.puddlesSeen = true;
    if (!calls.has(h.id)) calls.set(h.id, new Set());
    const done = calls.get(h.id);
    for (const p of people) {
      if (done.has(p.id)) continue;
      done.add(p.id);
      world.violations.pedestrians_splashed = (world.violations.pedestrians_splashed || 0) + 1;
      world.events.push({ type: "pedestrian_splashed", puddle: h.id, person: p.id, kmh: Math.round(ego.v * 36) / 10, splash_kmh: Math.round(splashSpeed(h) * 36) / 10, depth_cm: Math.round(h.depth * 100) });
    }
  }
  for (const id of calls.keys()) if (!here.has(id)) calls.delete(id);
}

// What the HUD tells the driver about the next puddle with people near in its lane (from the car's
// sensing): { key, text, slow }, or null.
const NOTICE_M = 45;
export function puddleNotice(world, snap) {
  if (!world.puddles?.enabled) return null;
  const h = snap?.puddle_splash;
  if (!h || h.starts_in_m > NOTICE_M) return null;
  if (h.room && h.shift_m) return { key: `${h.id}:round`, slow: false, text: `PUDDLE BY THE KERB · PEOPLE ON THE SIDEWALK · EASE ${Math.abs(h.shift_m).toFixed(1)} M LEFT` };
  if (h.room) return null;
  return { key: `${h.id}:slow`, slow: world.ego.v > h.speed_mps + 0.5, text: `PUDDLE BY THE KERB · PEOPLE ON THE SIDEWALK · SLOW` };
}
