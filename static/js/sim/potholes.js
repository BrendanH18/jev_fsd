// Spring potholes: when the frost comes out of the ground in spring, water that seeped into cracks in
// the asphalt over the winter freezes and thaws, and the traffic breaks the weakened surface into
// holes. Busy main streets, with heavy traffic and buses, get many more of them than quiet residential
// ones. Each pothole lies in a lane: its arc length along the lane, its offset right of the lane's
// centre, its size (half its length along the lane, `a`, and half its width across it, `b`) and its
// depth.
//
// A driver who sees one ahead in their lane does one of two things:
//   - where the lane leaves room, eases over inside the lane so that both wheel paths miss it (the
//     smallest move that clears it: often putting it between the wheels), never crossing a lane line;
//   - otherwise slows to the speed to drive over it at (about 20 km/h for a 7 cm hole: the blow to a
//     tyre at the far edge grows with the speed squared and the depth, so a deeper hole is taken a
//     little slower), braking gently by comfort(), and keeps to it until the rear wheels are over it.
// In rain or snow a pothole holds water: it looks like any puddle, and is seen later (SEE_WET_M).
//
// Opt-in: the World option `potholes` (free drives, unless `?potholes=0`; challenges with
// `potholes: true`). With it off nothing is placed, no random stream is drawn from and nothing is
// computed, so the seeded benchmark and the other challenges play out exactly as before. With it on:
//   - potholes are placed on the map's lanes from their own random stream (Potholes);
//   - the driven car's sensing reports the next pothole in its lane (`pothole`, brain/sensors.js), the
//     candidates offer `ease_round_pothole` where there is room, every lane manoeuvre whose wheels
//     would cross one slows for it (`slowTo`, sim/controller.js), and a forward sim whose wheel crosses
//     one faster than its safe speed is rejected (`hits_pothole_too_fast`, brain/candidates.js);
//   - traffic does the same (npcPothole, sim/npc.js);
//   - the audit counts a wheel of the car crossing one faster than its safe speed plus HIT_OVER_MPS
//     (`pothole_hits`, auditPotholes); it reaches the metrics, and fails a drive, only once the car has
//     come near one (World.potholesSeen).

import { rng } from "../common.js";
import { pointAt, headingAt, wrapAngle } from "../map/mapdata.js";
import { comfort, CAR } from "./vehicle.js";
import { current as weather } from "./weather.js";

// The speed to drive over a pothole REF_DEPTH_M deep at, and the range for others (shallower ones a
// little faster, deeper ones slower: v ~ 1/sqrt(depth)).
export const REF_DEPTH_M = 0.07, REF_MPS = 20 / 3.6, MIN_MPS = 15 / 3.6, MAX_MPS = 30 / 3.6;
// The audit counts a wheel crossing one faster than its safe speed plus this.
export const HIT_OVER_MPS = 5 / 3.6;
// A forward sim (brain/candidates.js) whose wheel crosses one faster than its safe speed plus this is rejected.
export const SIM_OVER_MPS = 0.5;
// Half a tyre's width, and the room a driver leaves between a wheel and the edge of a pothole it goes
// round (on top of that, the lane's lines: a car never puts a wheel over one to go round a pothole).
export const TYRE_HALF_M = 0.1, ROOM_MARGIN_M = 0.15, EDGE_MARGIN_M = 0.05;
// How far ahead a driver sees a pothole: a dry one stands out, a wet one is a puddle like any other.
export const SEE_M = 70, SEE_WET_M = 50;
// Planning to slow for one, drivers brake at no more than this share of comfort().decel, to be at its
// speed this far before the front wheels reach it.
const SLOW_SHARE = 0.6, EARLY_M = 6;
// Traffic (whose drivers ease off rather than follow a braking curve) plans more gently and earlier,
// and a little under the speed.
const NPC_SLOW_SHARE = 0.4, NPC_EARLY_M = 6, NPC_SHARE = 0.9;
// The car's plan crosses one at this share of its speed (the controller lags a little).
const PLAN_SHARE = 0.95;
// Placement: the mean distance between potholes along a lane on a main street (tertiary and up), and
// on a quiet one; none closer together than MIN_GAP_M, nor within END_M of a lane's ends (the corners
// of junctions), nor on a lane shorter than MIN_LANE_M.
const MAIN_EVERY_M = 70, QUIET_EVERY_M = 260, MIN_GAP_M = 25, END_M = 12, MIN_LANE_M = 40;
const MAIN = new Set(["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "trunk", "trunk_link"]);
const QUIET = new Set(["residential", "unclassified", "living_street"]);
// Easing round one: over EASE_M (twice the street's limit in metres, within these bounds), done
// before the front wheels reach it and held until the rear wheels and the pursuit point are past it.
const EASE_MIN_M = 12, EASE_MAX_M = 30;
// Traffic eases over at most this fast, from this far before a pothole.
export const NPC_SHIFT_MPS = 0.6;
const NPC_EASE_M = 35, NPC_LOOK_M = 80;
const CELL = 20;
// A car comes near a pothole (World.potholesSeen) with one this close ahead of its front, in or beside
// its lane.
const NEAR_AHEAD_M = 30, NEAR_SIDE_M = 2.5;

// The speed to drive over pothole `h` at (weather aside).
export const safeSpeed = (h) => Math.max(MIN_MPS, Math.min(MAX_MPS, REF_MPS * Math.sqrt(REF_DEPTH_M / Math.max(0.02, h.depth))));
// The speed a driver plans to cross it at: no faster than the weather allows anywhere else.
export const planSpeed = (h) => safeSpeed(h) * Math.min(1, weather.speed) * PLAN_SHARE;
// Between left and right tyres (a spec without one: its width less 0.3 m).
export const trackOf = (spec) => spec?.track ?? Math.max(0.5, (spec?.width ?? CAR.width) - 0.3);
// How far a vehicle may move over within a lane `laneW` wide, either way, without a wheel or its body
// crossing the lane's line.
export const maxShift = (laneW, spec) => Math.max(0, laneW / 2 - (spec?.width ?? CAR.width) / 2 - EDGE_MARGIN_M);
// The ease-in distance on a street with limit `limit` (m/s).
export const easeLength = (limit) => Math.max(EASE_MIN_M, Math.min(EASE_MAX_M, 2 * (limit || 11)));

// The smallest move (metres right of the lane's centre; 0 when its wheels already miss) that takes
// both wheel paths of a vehicle (`spec`) clear of a pothole `dl` metres right of the lane's centre,
// within a lane `laneW` wide; or null where none does (it must slow and drive over it). A tie goes to
// the move that puts the pothole between the wheels.
export function wheelRoom(dl, h, laneW, spec) {
  const half = trackOf(spec) / 2, c = h.b + TYRE_HALF_M + ROOM_MARGIN_M, lim = maxShift(laneW, spec);
  // (each wheel, at shift ± half, must keep out of (dl - c, dl + c): no shift within c of dl ∓ half)
  const bad = [[dl - half - c, dl - half + c], [dl + half - c, dl + half + c]];
  const clear = (x) => x >= -lim - 1e-9 && x <= lim + 1e-9 && bad.every(([lo, hi]) => x <= lo + 1e-9 || x >= hi - 1e-9);
  const options = [0, ...bad.flat()].filter(clear);
  if (!options.length) return null;
  // (the pothole between the wheels: |shift - dl| < half)
  const cm = (x) => Math.round(Math.abs(x) * 100);
  options.sort((x, y) => cm(x) - cm(y) || (Math.abs(x - dl) < half ? 0 : 1) - (Math.abs(y - dl) < half ? 0 : 1));
  return Math.round(options[0] * 100) / 100;
}

// Whether a vehicle (`spec`) whose centre is `lat` metres right of a line crosses a pothole `dl`
// metres right of it with a wheel (`pad`: a margin either side).
export function wheelsCross(lat, dl, h, spec, pad = 0) {
  const half = trackOf(spec) / 2, c = h.b + TYRE_HALF_M + pad;
  return Math.abs(lat - half - dl) < c || Math.abs(lat + half - dl) < c;
}

// Whether a tyre at (x, y) is in pothole `h` (an ellipse, the tyre's half width added across it).
export function inPothole(h, x, y) {
  const dx = x - h.x, dy = y - h.y, c = Math.cos(h.heading), s = Math.sin(h.heading);
  const u = (dx * c + dy * s) / h.a, v = (dx * s - dy * c) / (h.b + TYRE_HALF_M);
  return u * u + v * v <= 1;
}

// Whether a tyre going from (x0, y0) to (x1, y1) goes into pothole `h` on the way (an ellipse stays one
// under the stretch that makes it a circle, and so does the tyre's straight path).
export function crossesPothole(h, x0, y0, x1, y1) {
  const c = Math.cos(h.heading), s = Math.sin(h.heading), b = h.b + TYRE_HALF_M;
  const u0 = ((x0 - h.x) * c + (y0 - h.y) * s) / h.a, v0 = ((x0 - h.x) * s - (y0 - h.y) * c) / b;
  const u1 = ((x1 - h.x) * c + (y1 - h.y) * s) / h.a, v1 = ((x1 - h.x) * s - (y1 - h.y) * c) / b;
  const du = u1 - u0, dv = v1 - v0, len = du * du + dv * dv;
  const t = len > 1e-12 ? Math.max(0, Math.min(1, -(u0 * du + v0 * dv) / len)) : 0;
  const u = u0 + du * t, v = v0 + dv * t;
  return u * u + v * v <= 1;
}

// A vehicle's four tyres: [x, y] of front left, front right, rear left, rear right.
export function wheelPoints(v) {
  const spec = v.spec || CAR, c = Math.cos(v.psi), s = Math.sin(v.psi), wb = spec.wheelbase, half = trackOf(spec) / 2;
  const rx = Math.sin(v.psi) * half, ry = -Math.cos(v.psi) * half, fx = v.x + c * wb, fy = v.y + s * wb;
  return [[fx - rx, fy - ry], [fx + rx, fy + ry], [v.x - rx, v.y - ry], [v.x + rx, v.y + ry]];
}

// A pothole in lane `laneIdx` of edge `edgeId`, `s` metres along the lane and `offset` metres right of
// its centre: { id, edge, lane, s, offset, a, b, depth, shape, x, y, heading, lane_w }.
export function potholeOnLane(map, edgeId, laneIdx, s, { id, offset = 0, a = 0.4, b = 0.35, depth = REF_DEPTH_M, shape = 1 }) {
  const lane = map.lane(edgeId, laneIdx);
  if (!lane) return null;
  const p = pointAt(lane.pts, lane.cum, s), h = headingAt(lane.pts, lane.cum, s);
  return { id, edge: edgeId, lane: laneIdx, s, offset, a, b, depth, shape, x: p[0] + Math.sin(h) * offset, y: p[1] - Math.cos(h) * offset, heading: h, lane_w: lane.edgeRef.lane_width };
}

// The potholes of a world. With `enabled`, placed on every lane of the map from their own random
// stream: on average one every MAIN_EVERY_M of a main street's lane and one every QUIET_EVERY_M of a
// quiet street's (none on service roads or roundabout rings). Most are small and lie in a wheel path,
// where tyres break the surface; a few are wide ones no car can get round in its lane.
export class Potholes {
  constructor(map, { enabled = false, seed = 1 } = {}) {
    this.map = map;
    this.enabled = !!enabled;
    this.list = []; this.grid = new Map(); this.byLane = new Map(); this.version = 0;
    if (!this.enabled) return;
    const random = rng(seed * 2654435761 + 97);
    const out = [];
    for (const e of map.edges.values()) {
      const every = MAIN.has(e.cls) ? MAIN_EVERY_M : QUIET.has(e.cls) ? QUIET_EVERY_M : 0;
      if (!every || e.ring) continue;
      for (let k = 0; k < e.lanes; k++) {
        const lane = map.lane(e.id, k);
        if (!lane || lane.length < MIN_LANE_M) continue;
        const half = e.lane_width / 2;
        for (let s = END_M + random() * every; s < lane.length - END_M; s += MIN_GAP_M + random() * 2 * (every - MIN_GAP_M)) {
          const kind = random(), shape = 1 + Math.floor(random() * 1e6);
          const [a, b, depth] = kind < 0.6 ? [0.25 + random() * 0.15, 0.2 + random() * 0.15, 0.04 + random() * 0.03]
            : kind < 0.9 ? [0.4 + random() * 0.2, 0.35 + random() * 0.2, 0.06 + random() * 0.04]
              : [0.6 + random() * 0.3, 0.6 + random() * 0.25, 0.08 + random() * 0.05];
          // (in a wheel path, or anywhere across the lane)
          const where = random(), side = random() < 0.5 ? -1 : 1;
          const want = where < 0.7 ? side * (trackOf(CAR) / 2 + (random() - 0.5) * 0.3) : (random() - 0.5) * 0.6;
          const lim = Math.max(0, half - b - 0.1), offset = Math.max(-lim, Math.min(lim, want));
          out.push(potholeOnLane(map, e.id, k, s, { id: `ph${out.length + 1}`, offset, a, b, depth, shape }));
        }
      }
    }
    this.setList(out);
  }

  // Replace the potholes (a challenge places its own: lab/pothole-challenge.js).
  setList(list) {
    this.list = list.filter(Boolean);
    this.grid = new Map(); this.byLane = new Map(); this.version++;
    for (const h of this.list) {
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

  // The potholes within about r of (x, y).
  near(x, y, r) {
    if (!this.list.length) return [];
    const out = new Set();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((y - r) / CELL); j <= Math.floor((y + r) / CELL); j++) {
      for (const h of this.grid.get(`${i},${j}`) || []) if (Math.abs(h.x - x) <= r + 1 && Math.abs(h.y - y) <= r + 1) out.add(h);
    }
    return [...out];
  }

  onLane(edge, lane) { return this.byLane.get(`${edge}:${lane}`) || null; }
}

// The speed to slow to `ahead` metres short of where a pothole is crossed at `mps`.
export const approachSpeed = (mps, ahead, share = SLOW_SHARE) => Math.sqrt(mps * mps + 2 * comfort().decel * share * Math.max(0, ahead));

// The potholes along a route (cached by route and placement): { h, s (route arc length of its
// centre), lateral (metres right of the route) }, in order. Only those lying along the route's
// street, going its way, within 6 m of its line.
const routeMarks = new WeakMap();
function marksAlong(potholes, route) {
  const cached = routeMarks.get(route);
  if (cached && cached.version === potholes.version && cached.list === potholes.list) return cached.marks;
  const marks = [], seen = new Set();
  for (let s = 0; s <= route.length; s += CELL / 2) {
    const [x, y] = route.pointAt(s);
    for (const h of potholes.near(x, y, CELL / 2 + 6)) {
      if (seen.has(h.id)) continue;
      const p = route.project(h.x, h.y, Math.max(0, route.pts.length > 1 ? Math.min(route.pts.length - 2, segAt(route, s)) : 0));
      if (!p || p.distance > 6 || Math.abs(wrapAngle(h.heading - p.heading)) > 0.6) continue;
      seen.add(h.id);
      marks.push({ h, s: p.s, lateral: p.lateral });
    }
  }
  marks.sort((x, y) => x.s - y.s);
  routeMarks.set(route, { version: potholes.version, list: potholes.list, marks });
  return marks;
}
// (the index of the route segment at arc length s, as a projection hint)
function segAt(route, s) {
  const cum = route.cum;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  return lo;
}

// The potholes ahead in the driven car's lane (brain/sensors.js): the next one (`pothole`) and every
// one within sight (`ahead`), each { id, s_route (its centre), starts_in_m (front bumper to its near
// edge; negative once over it), wheels_in_m (front wheels to its near edge), lateral_m (right of the
// car's lane centre), lateral_route (right of the route), length_m, width_m, depth_cm, speed_mps (the speed to cross it at, weather
// included), room (the car can ease round it in its lane, in time), shift_m (how far right of the
// lane's centre to ease to), slow ({ from, to, mps }: in route arc length of the rear axle, from where
// it is down to `mps` until where its rear wheels are over), detour (the ease round, for
// controller.lateralAt), b (half its width) }. Null with none in sight.
export function potholesAhead(world, p, frontS, lane, limit) {
  const ph = world.potholes, route = world.route, ego = world.ego;
  if (!ph?.list.length || !route || !p) return null;
  const spec = ego.spec, wb = spec.wheelbase, s = p.s;
  const see = Math.min(weather.name === "rain" || weather.name === "snow" ? SEE_WET_M : SEE_M, world.visibility?.range ?? Infinity);
  const ease = easeLength(limit), center = lane ? lane.center : 0, lateralNow = lane ? lane.lateral : 0;
  const ahead = [];
  for (const m of marksAlong(ph, route)) {
    const h = m.h;
    if (m.s + h.a < s - 0.5) continue;
    if (m.s - h.a - frontS > see) break;
    const laneW = h.lane_w || 3.3, dl = m.lateral - (center - route.frameMove(s, m.s));
    // (in the car's lane: some of it within the lane's width either side of its centre)
    if (Math.abs(dl) - h.b > laneW / 2) continue;
    let shift = wheelRoom(dl, h, laneW, spec);
    const full = m.s - h.a - wb - 1;
    // (too late to ease over that far: it slows instead)
    if (shift !== null && shift !== 0 && full - s < ease * 0.5 * Math.min(1, Math.abs(shift - lateralNow) / 0.5) && Math.abs(shift - lateralNow) > 0.25) shift = null;
    const mps = planSpeed(h);
    ahead.push({ id: h.id, s_route: m.s, starts_in_m: m.s - h.a - frontS, wheels_in_m: m.s - h.a - (s + wb), lateral_m: Math.round(dl * 100) / 100,
      length_m: Math.round(2 * h.a * 10) / 10, width_m: Math.round(2 * h.b * 10) / 10, depth_cm: Math.round(h.depth * 100), speed_mps: mps, safe_mps: safeSpeed(h),
      lateral_route: m.lateral, room: shift !== null, shift_m: shift, slow: { from: m.s - h.a - wb - EARLY_M, to: m.s + h.a + 0.5, mps },
      detour: shift ? { from: full - ease, full, back: m.s + h.a + 1 + Math.min(15, Math.max(4, 0.8 * Math.max(ego.v, limit || 0))), to: 0, shift, pothole: h.id } : null, b: h.b });
  }
  for (const a of ahead) if (a.detour) a.detour.to = a.detour.back + ease;
  return ahead.length ? { pothole: ahead[0], ahead } : null;
}

// The speed cap (a law's `slowTo` entry, sim/controller.js) at route arc length s (rear axle).
export function slowCap(slow, s) {
  if (s > slow.to) return Infinity;
  return s >= slow.from ? slow.mps : approachSpeed(slow.mps, slow.from - s);
}

// The driven car's speed limit (brain/sensors.js `snap.limit`) at route arc length s for a pothole it
// cannot ease round (`a`, from potholesAhead): slowCap at its speed before the weather, which the
// target speed then takes off as it does anywhere else.
export const potholeLimit = (a, s) => slowCap({ ...a.slow, mps: a.safe_mps * PLAN_SHARE }, s);

// What traffic does for the potholes on its path (sim/npc.js): { shift (metres right of its lane's
// centre to ease to now), limit (the speed to keep to), hits (the potholes its wheels will cross,
// slowing) } or null with none. `n.path` is an NpcPath; `front`, its front's arc length along it.
export function npcPothole(world, n, front) {
  const ph = world.potholes, path = n.path, map = world.map, spec = n.spec || CAR;
  if (!ph?.list.length || !path?.edges) return null;
  const wb = spec.wheelbase, s = path.s;
  let shift = null, limit = Infinity;
  for (const pe of path.edges) {
    if (pe.sEnd < s - 2) continue;
    if (pe.sStart > front + NPC_LOOK_M) break;
    const list = ph.onLane(pe.id, pe.lane);
    if (!list) continue;
    const lane = map.lane(pe.id, pe.lane), k = (pe.sEnd - pe.sStart) / Math.max(1e-6, lane.length);
    for (const h of list) {
      const at = pe.sStart + h.s * k;
      if (at + h.a < s - 0.5) continue;
      if (at - h.a > front + NPC_LOOK_M) break;
      const room = wheelRoom(h.offset, h, h.lane_w, spec);
      if (room !== null) {
        // (the first it can get round: over by the time its front wheels are NPC_EASE_M short of it)
        if (shift === null && at - h.a - (s + wb) < NPC_EASE_M) shift = room;
      } else {
        const mps = safeSpeed(h) * Math.min(1, weather.speed) * NPC_SHARE, from = at - h.a - wb - NPC_EARLY_M;
        if (at + h.a + 0.5 >= s) limit = Math.min(limit, s >= from ? mps : approachSpeed(mps, from - s, NPC_SLOW_SHARE));
      }
    }
  }
  return shift === null && limit === Infinity ? null : { shift: shift ?? 0, limit };
}

// The audit (World.audit): a tyre of the car going into a pothole faster than its safe speed plus
// HIT_OVER_MPS is a hit, counted once a pothole each time the car goes over it; and the car has come
// near a pothole once one is NEAR_AHEAD_M ahead of its front, in or beside its lane.
export function auditPotholes(world) {
  const ph = world.potholes, ego = world.ego;
  if (!ph?.list.length) return;
  const calls = world.potholeCalls ||= new Map();
  const spec = ego.spec, c = Math.cos(ego.psi), sn = Math.sin(ego.psi), front = spec.length - spec.rearOverhang;
  if (!world.potholesSeen) {
    for (const h of ph.near(ego.x + c * (front + NEAR_AHEAD_M / 2), ego.y + sn * (front + NEAR_AHEAD_M / 2), NEAR_AHEAD_M / 2 + 2)) {
      const dx = h.x - ego.x, dy = h.y - ego.y, ahead = dx * c + dy * sn - front, side = Math.abs(dx * sn - dy * c);
      if (ahead > -front && ahead < NEAR_AHEAD_M && side < NEAR_SIDE_M + h.b) { world.potholesSeen = true; break; }
    }
  }
  const wheels = wheelPoints(ego), near = ph.near(ego.x + c * spec.wheelbase / 2, ego.y + sn * spec.wheelbase / 2, spec.wheelbase / 2 + 3), here = new Set();
  for (const h of near) {
    here.add(h.id);
    if (calls.has(h.id) || !wheels.some(([x, y]) => inPothole(h, x, y))) continue;
    const fast = ego.v > safeSpeed(h) + HIT_OVER_MPS;
    calls.set(h.id, fast);
    world.potholesSeen = true;
    if (fast) {
      world.violations.pothole_hits = (world.violations.pothole_hits || 0) + 1;
      world.events.push({ type: "pothole_hit", pothole: h.id, kmh: Math.round(ego.v * 36) / 10, safe_kmh: Math.round(safeSpeed(h) * 36) / 10, depth_cm: Math.round(h.depth * 100) });
    }
  }
  for (const id of calls.keys()) if (!here.has(id)) calls.delete(id);
}

// What the HUD tells the driver about the next pothole in its lane (from the car's sensing): { key,
// text, slow }, or null. `slow` while it must slow for one.
const NOTICE_M = 45;
export function potholeNotice(world, snap) {
  if (!world.potholes?.enabled) return null;
  const h = snap?.pothole;
  if (!h || h.starts_in_m > NOTICE_M) return null;
  const kmh = Math.round(h.speed_mps * 3.6), over = h.starts_in_m < 0;
  if (h.room) return { key: `${h.id}:round`, slow: false, text: h.shift_m ? `POTHOLE · EASE ${Math.abs(h.shift_m).toFixed(1)} M ${h.shift_m < 0 ? "LEFT" : "RIGHT"} IN THE LANE` : "POTHOLE · BETWEEN THE WHEELS" };
  return { key: `${h.id}:${over ? "over" : "slow"}`, slow: !over && world.ego.v > h.speed_mps + 0.5, text: over ? `OVER A POTHOLE · ${kmh} KM/H` : `POTHOLE AHEAD · NO ROOM · SLOW TO ${kmh} KM/H` };
}

// How far below the road a tyre at (x, y) is, in a pothole (render only: the car's body jolts).
export function dipAt(potholes, x, y) {
  if (!potholes?.list.length) return 0;
  let best = 0;
  for (const h of potholes.near(x, y, 1.5)) if (inPothole(h, x, y)) best = Math.max(best, h.depth * 0.6);
  return best;
}
