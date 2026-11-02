// Passing cyclists with room. On a two-way street with one lane each way, a cyclist riding in the
// travel lane leaves no room to pass inside it: going by means moving over into the oncoming lane.
// Canadian law sets how far over: BC's minimum passing distance regulation (Motor Vehicle Act, 2024)
// asks for 1 m where the limit is 50 km/h or less and 1.5 m above, as Québec's Highway Safety Code
// (s. 341) does; Ontario's Highway Traffic Act (s. 148(6.1)) asks for 1 m. Every province's driver's
// handbook says the rest: oncoming traffic has the right of way, so a driver crosses the centre line
// to pass only when it can see that the way is clear for long enough to get by and back, and never
// approaching a junction, a marked crosswalk or a level crossing.
//
// Along the cyclist's street (its edge's own `s`; positions are the driver's front bumper): the pass
// (planPass) runs from where the driver is to where it is back in its lane ahead of the cyclist. It
// eases over, across `ease_m` (EASE_S of travel at the pass speed, at least EASE_MIN_M), to be all
// the way across by `full`, where its front is LEAD_M short of the cyclist's rear; stays across until
// `back`, where its rear is RETURN_M past the cyclist's front; and eases back in by `to`. Across means
// its side the minimum passing distance (plus AIM_M) from the cyclist's, which may be straddling the
// centre line or right over it; never past the oncoming lane's far edge (`no_room`). The cyclist
// moves, so the marks are where the driver gets to them passing at the pass speed (`pass_mps`: the
// cyclist's plus PASS_MARGIN_MPS, up to the street's limit), pulling away at PASS_ACCEL; the driven car
// works them out again at every decision, from where the cyclist is then, keeping only where it
// started over, so they hold however fast it actually goes. A pass that gains less than MIN_GAIN_MPS on
// the cyclist (`too_fast`), would not be over
// JUNCTION_CLEAR_M short of the junction ahead (`junction`), CROSSWALK_CLEAR_M short of a marked
// crosswalk (`crosswalk`) or RAIL_CLEAR_M short of a level crossing (`level_crossing`), or would go
// past a work zone, a lane closure, a double-parked van, a school bus with its reds flashing or a
// streetcar standing on the street, or has no room to move back in ahead of the cyclist
// (`no_room_ahead`), is not on.
//
// The way is clear (wayClear) when nobody coming the other way, along the street or about to turn
// into the oncoming lane at the junction ahead (as round a double-parked van: sim/double-parked.js
// arrival), would reach the end of the pass sooner than MARGIN_S after the driver has its front there;
// and, for the driven car, it can see along the oncoming lane
// that far (or as far as it ever sees, DAYLIGHT_RANGE_M less SIGHT_SLACK_M, so by night or in fog it
// stays behind). Only the first driver behind the cyclist passes it (queuedBehind). Once a driver has
// started over it carries on, unless the way stops being clear while it is still behind the cyclist:
// then it falls back in behind it.
//
// All of this is opt-in: `World` option `passCyclists` (free drives, unless `?cyclistpass=0`; the "Give
// them room" challenge). Traffic passes cyclists the same way (sim/npc.js), the driven car's sensing
// reports `cyclist_pass` (brain/sensors.js), and the audit counts passing a cyclist closer than the
// minimum passing distance as `close_passes`, and crossing into the way of oncoming traffic while
// passing one as a failure to yield (sim/world.js). With it off nothing here is computed.

import { CAR, BIKE } from "./vehicle.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { DAYLIGHT_RANGE_M } from "./visibility.js";
import { arrival, isVan, onStreet, oppositeOf } from "./double-parked.js";
import { railIndex } from "./rail.js";
import { redsOn } from "./school-bus.js";
import { isStreetcar } from "./streetcar.js";

export const SLOW_STREET_MPS = 50 / 3.6;
// The minimum passing distance on a street with limit `limit` (m/s).
export const minPassM = (limit) => (limit > SLOW_STREET_MPS + 0.05 ? 1.5 : 1.0);
export const PASS_MARGIN_MPS = 20 / 3.6;
export const MIN_GAIN_MPS = 2.5;
export const PASS_ACCEL = 1.5;
export const PASS_DECEL = 1.5;
export const LEAD_M = 2;
export const RETURN_M = 5;
export const EASE_S = 2.5;
export const EASE_MIN_M = 12;
export const MIN_EASE_M = 8;         // the driven car pulls out only with this much room to do it, or drops back
export const MARGIN_S = 2;
export const AIM_M = 0.25;           // aiming this much wider than the minimum passing distance
export const LOOK_M = 50;            // a cyclist this far ahead counts
export const DECIDE_M = 25;          // traffic decides whether to pass once its front is this near the cyclist
export const FOLLOW_M = 8;           // staying behind, the driven car keeps this gap to the cyclist's rear wheel
export const JUNCTION_CLEAR_M = 5;
export const CROSSWALK_CLEAR_M = 10;
export const RAIL_CLEAR_M = 30;
const ROOM_AHEAD_M = 6;              // moving back in, at least this behind whoever is ahead of the cyclist
const EDGE_SLACK_M = 0.2;            // across, the driver's far side stays this far inside the oncoming lane
const SIGHT_SLACK_M = 10;
const IN_LANE_M = 1.6;
const STEP_S = 0.05;
const PREFIX = "cyclist:";

export const passId = (bike) => `${PREFIX}${bike.id}`;
export const isCyclistPass = (detour) => typeof detour?.id === "string" && detour.id.startsWith(PREFIX);
const laneCentre = (e) => e.lane_offsets?.[0] ?? e.lane_width / 2;

// The street of edge `edgeId`, where a cyclist can only be passed through the oncoming lane: two-way,
// with one lane each way. { opposite, crosswalks, rails } (along the edge, either way), or null.
const streetCache = new WeakMap();
export function passStreet(map, edgeId) {
  let cache = streetCache.get(map);
  if (!cache) streetCache.set(map, cache = new Map());
  if (cache.has(edgeId)) return cache.get(edgeId);
  const e = map.edges.get(edgeId), o = e && !e.oneway && e.lanes === 1 && !e.ring ? oppositeOf(map, e) : null;
  let out = null;
  if (o) {
    const along = (edge, s) => (edge === e.id ? s : edge === o.id ? e.length - s : null);
    const crosswalks = (map.crosswalks || []).map((c) => along(c.edge, c.s)).filter((s) => s !== null);
    const rails = railIndex(map).crossings.flatMap((c) => c.edges.map((on) => along(on.edge, on.s))).filter((s) => s !== null);
    out = { opposite: o.id, crosswalks, rails };
  }
  cache.set(edgeId, out);
  return out;
}

// Cyclist `b` on edge `e`'s street, going its way with its centre in the travel lane: where it is
// (onStreet), or null.
export function ridingIn(e, b) {
  const on = onStreet(e, b);
  return on && on.same && Math.abs(on.lateral - laneCentre(e)) < e.lane_width / 2 ? on : null;
}

// How long, and how far, a driver at `v0` takes to gain `gain` metres on a cyclist riding at `vb`,
// pulling away at `accel` (after `react` seconds) up to `vTop`, or slowing to it at PASS_DECEL. { t, d },
// or null when it never does.
function gainOn(gain, v0, vb, vTop, accel, react = 0) {
  if (gain <= 0) return { t: 0, d: 0 };
  let t = 0, x = 0, v = Math.max(0, v0);
  while (t < 60) {
    const a = t < react ? 0 : v < vTop ? Math.min(accel, (vTop - v) / STEP_S) : -Math.min(PASS_DECEL, (v - vTop) / STEP_S);
    const v1 = Math.max(0, v + a * STEP_S);
    x += (v + v1) / 2 * STEP_S; v = v1; t += STEP_S;
    if (x - vb * t >= gain) return { t, d: x };
  }
  return null;
}

// A pass of cyclist `bike` (where it is along edge `e`: `on`, ridingIn) by a driver whose front is
// `front` along it, at `v`, of size `spec`: { bike, edge, opposite, front, min_pass_m, shift (how far
// right of its lane's centre the driver goes, negative: left), gap_m (from its front to the cyclist's
// rear), bike_rear, bike_front, bike_speed, pass_mps, ease_m, start (the driver's rear now), from,
// full, back, to, need_s (until its front is at `to`), possible, why }, or null
// when it needs no pass: it is past the cyclist with room in its own lane. `driver` ({ accel, react,
// vmax }), for traffic: as that driver pulls away. `others`: vehicles that may be in the way.
export function planPass(world, e, { front, v, spec = CAR, bike, on, driver = null, others = [] }) {
  const map = world.map, street = passStreet(map, e.id);
  if (!street) return null;
  const o = map.edges.get(street.opposite), bs = bike.spec || BIKE, lc = laneCentre(e), oc = o.lane_offsets?.[0] ?? o.lane_width / 2;
  const limit = e.limit || 11.2, min = minPassM(limit);
  // (the driver's centre, right of the centre line, the minimum passing distance clear of the cyclist)
  const target = on.lateral - bs.width / 2 - min - AIM_M - spec.width / 2;
  if (target - lc > -0.05) return null;
  const rear = on.s - bs.rearOverhang, vb = Math.max(0, bike.v);
  const vp = Math.min(limit, vb + PASS_MARGIN_MPS, driver?.vmax ?? Infinity);
  const out = { bike, edge: e.id, opposite: o.id, front, min_pass_m: min, shift: target - lc, gap_m: rear - front, bike_rear: rear, bike_front: rear + bs.length,
    bike_speed: vb, pass_mps: vp, ease_m: Math.max(EASE_MIN_M, EASE_S * vp),
    start: front - spec.length, possible: true, why: null };
  const fail = (why) => Object.assign(out, { possible: false, why });
  if (target - spec.width / 2 < -(oc + o.lane_width / 2) + EDGE_SLACK_M) return fail("no_room");
  if (vp - vb < MIN_GAIN_MPS - 1e-9) return fail("too_fast");
  const accel = Math.min(PASS_ACCEL, driver?.accel ?? PASS_ACCEL), react = v < 0.3 ? driver?.react ?? 0 : 0;
  const full = gainOn(out.gap_m - LEAD_M, v, vb, vp, accel, react);
  const back = gainOn(out.gap_m + bs.length + RETURN_M + spec.length, v, vb, vp, accel, react);
  if (!full || !back) return fail("too_fast");
  Object.assign(out, { full: front + full.d, back: front + back.d, to: front + back.d + out.ease_m, need_s: back.t + out.ease_m / vp });
  out.from = out.full - out.ease_m;
  // (all of it this side of any level crossing, any marked crosswalk and the junction ahead)
  if (street.rails.some((s) => s > front - RAIL_CLEAR_M && s < out.to + RAIL_CLEAR_M)) return fail("level_crossing");
  if (street.crosswalks.some((s) => s > front - 2 && s < out.to + CROSSWALK_CLEAR_M)) return fail("crosswalk");
  const line = e.control?.s_line ?? e.length - map.crossingHalfWidth(e.id);
  if (out.to > line - JUNCTION_CLEAR_M) return fail("junction");
  const ids = new Set([e.id, o.id]);
  if ((world.workZones?.zones || []).some((z) => ids.has(z.closed) || ids.has(z.open))) return fail("work_zone");
  if ((world.laneClosures?.zones || []).some((z) => ids.has(z.edge))) return fail("lane_closure");
  for (const d of world.doubleParked?.vans || []) {
    const lo = d.edge === e.id ? d.rear : e.length - d.front, hi = d.edge === e.id ? d.front : e.length - d.rear;
    if (ids.has(d.edge) && hi > front - 10 && lo < out.to + 10) return fail("double_parked");
  }
  for (const n of others) {
    if (n === bike || n.parked || n.kind === "pedestrian" || n.kind === "door" || Math.abs(n.x - bike.x) > 150 || Math.abs(n.y - bike.y) > 150) continue;
    const q = onStreet(e, n);
    if (!q) continue;
    if (redsOn(n) || (isStreetcar(n) && n.v < 0.5)) {
      if (q.s > front - 20 && q.s < out.to + 30) return fail(redsOn(n) ? "school_bus" : "streetcar");
      continue;
    }
    // (moving back in: room behind whoever is in the lane ahead of the cyclist by then)
    if (!q.same || Math.abs(q.lateral - lc) > IN_LANE_M) continue;
    const r = q.s - (n.spec || CAR).rearOverhang;
    if (r < out.bike_front - 0.5) continue;
    if (r + Math.max(0, n.v) * out.need_s < out.to + spec.length + ROOM_AHEAD_M) return fail("no_room_ahead");
  }
  return out;
}

// Whether the way is clear for pass `plan` (see planPass), against vehicles `others` (not the driver)
// and, with `sight`, only as far as the driver can see (sight(s): whether it can see the oncoming lane
// `s` along the street): { clear, need_s, oncoming: { vehicle, eta_s } (the first one coming that
// leaves too little time), sees_far_enough }.
export function wayClear(world, plan, others, sight = null) {
  const map = world.map, e = map.edges.get(plan.edge), by = plan.need_s + MARGIN_S;
  const d = { edge: plan.edge, opposite: plan.opposite, detour: { from: Math.min(plan.start, plan.from), to: plan.to } };
  const [mx, my] = pointAt(e.pts, e.cum, Math.max(0, Math.min(e.length, (plan.start + plan.to) / 2)));
  let first = null;
  for (const n of others) {
    if (n === plan.bike || n.parked || isVan(n) || n.rail || n.kind === "pedestrian" || n.kind === "door") continue;
    if (Math.abs(n.x - mx) > 300 || Math.abs(n.y - my) > 300) continue;
    const eta = arrival(map, d, n, by);
    if (eta !== null && eta < by && (!first || eta < first.eta_s)) first = { vehicle: n, eta_s: eta };
  }
  // (as far along the oncoming lane as anyone at the street's limit would come in that time)
  const seen = !sight || sight(Math.min(e.length - 1, plan.to + (e.limit || 11.2) * by, plan.front + DAYLIGHT_RANGE_M - SIGHT_SLACK_M));
  return { clear: !first && seen, need_s: plan.need_s, oncoming: first, sees_far_enough: seen };
}

// What `observer` (the driven car) can see along the oncoming lane by pass `plan`: sight(s), as for wayClear.
export function sightFor(world, plan, observer = world.ego) {
  const map = world.map, e = map.edges.get(plan.edge), o = map.edges.get(plan.opposite), lat = -(o.lane_offsets?.[0] ?? o.lane_width / 2);
  return (s) => {
    const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
    return world.visibility.canSee(observer, p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat);
  };
}

// Someone ahead of a driver whose front is `front` along edge `e`, between it and the cyclist of pass
// `plan` or passing it, not yet RETURN_M past its front: on the street going its way, not the driver.
// Or null.
export function queuedBehind(e, front, plan, driver, others) {
  for (const n of others) {
    if (n === driver || n === plan.bike || n.parked || n.kind === "pedestrian" || n.kind === "door") continue;
    if (Math.abs(n.x - plan.bike.x) > 60 || Math.abs(n.y - plan.bike.y) > 60) continue;
    const q = onStreet(e, n);
    if (!q || !q.same) continue;
    const rear = q.s - (n.spec || CAR).rearOverhang;
    if (rear > front - 0.5 && rear < plan.bike_front + RETURN_M) return n;
  }
  return null;
}

// The cyclist the driven car is passing now: on a street with one lane each way, going its way in the
// travel lane, from just behind the car's front to a little past where it is back in, with the car's
// centre more than half a metre left of its lane's. { bike, e, front, lateral, across (its centre left
// of the centre line) }, or null. Sensing-free, for the audit, coaching and the HUD.
export function egoPassing(world) {
  if (!world.passCyclists) return null;
  const ego = world.ego, map = world.map, FRONT = ego.spec.length - ego.spec.rearOverhang;
  for (const b of world.npcs) {
    if (b.kind !== "bike" || Math.abs(b.x - ego.x) > 40 || Math.abs(b.y - ego.y) > 40) continue;
    const pe = b.path?.currentEdge?.(), e = pe && map.edges.get(pe.id);
    if (!e || !passStreet(map, e.id)) continue;
    const bon = ridingIn(e, b), on = bon && onStreet(e, ego);
    if (!on?.same || on.lateral > laneCentre(e) - 0.5) continue;
    const bs = b.spec || BIKE, rear = bon.s - bs.rearOverhang, front = on.s + FRONT;
    if (front > rear - LEAD_M - 8 && front - ego.spec.length < rear + bs.length + RETURN_M + 12) return { bike: b, e, front, lateral: on.lateral, across: on.lateral < 0 };
  }
  return null;
}

// How the driven car stands to the nearest cyclist it can see riding ahead of it in its lane, on a
// street with one lane each way, within LOOK_M, that it could pass only through the oncoming lane:
// { bike, plan, way (wayClear, as far as the car can see; null when no pass is on), queued, gap,
// going }, or null. Sensing-free, for the HUD.
export function egoView(world) {
  if (!world.passCyclists) return null;
  const ego = world.ego, map = world.map, FRONT = ego.spec.length - ego.spec.rearOverhang;
  const passing = egoPassing(world);
  let best = null;
  for (const b of world.npcs) {
    if (b.kind !== "bike" || Math.abs(b.x - ego.x) > LOOK_M + 10 || Math.abs(b.y - ego.y) > LOOK_M + 10) continue;
    const pe = b.path?.currentEdge?.(), e = pe && map.edges.get(pe.id);
    if (!e || !passStreet(map, e.id) || !world.sees(ego, b)) continue;
    const bon = ridingIn(e, b), on = bon && onStreet(e, ego);
    if (!on?.same) continue;
    const front = on.s + FRONT, gap = bon.s - (b.spec || BIKE).rearOverhang - front;
    if ((gap < -0.5 && passing?.bike !== b) || gap > LOOK_M || (best && gap > best.gap)) continue;
    best = { bike: b, e, bon, front, gap };
  }
  if (!best) return null;
  const others = world.visibleObstaclesNear(ego.x, ego.y, DAYLIGHT_RANGE_M + 10).filter((n) => n !== ego && n.kind !== "pedestrian");
  const plan = planPass(world, best.e, { front: best.front, v: ego.v, spec: ego.spec, bike: best.bike, on: best.bon, others });
  if (!plan) return null;
  const way = plan.possible ? wayClear(world, plan, others, sightFor(world, plan)) : null;
  return { bike: best.bike, plan, way, queued: queuedBehind(best.e, best.front, plan, ego, others), gap: best.gap, going: passing?.bike === best.bike };
}

// Why a pass is not on, for the HUD.
const NOT_ON = { too_fast: "TOO FAST TO PASS", no_room: "NO ROOM TO PASS", junction: "JUNCTION AHEAD", crosswalk: "CROSSWALK AHEAD", level_crossing: "LEVEL CROSSING AHEAD",
  work_zone: "WORK ZONE AHEAD", lane_closure: "LANE CLOSED AHEAD", double_parked: "VAN STOPPED AHEAD", school_bus: "SCHOOL BUS STOPPED", streetcar: "STREETCAR STOPPED", no_room_ahead: "NO ROOM TO PULL BACK IN" };

// What the HUD tells the driver of the car about a cyclist riding in its lane ahead that it can pass
// only through the oncoming lane, from when it can see it until it is back in its lane ahead of it:
// to stay behind it, and why, or that the way is clear to pass with the minimum passing distance.
// { key, text, wait }, or null.
export function cyclistNotice(world) {
  const view = egoView(world);
  if (!view) return null;
  const { bike, plan, way, queued, going } = view, room = `${plan.min_pass_m === 1 ? "1" : "1.5"} M`;
  if (going) return { key: `${bike.id}:going`, wait: false, text: `PASSING A CYCLIST · ${room} CLEAR · BACK IN WELL AHEAD OF THEM` };
  if (view.gap < 0) return null;
  if (!plan.possible) return { key: `${bike.id}:${plan.why}`, wait: true, text: `CYCLIST AHEAD · ${NOT_ON[plan.why]} · STAY BEHIND` };
  if (queued) return { key: `${bike.id}:queued`, wait: true, text: "CYCLIST AHEAD · WAIT YOUR TURN BEHIND" };
  if (!way.clear) return { key: `${bike.id}:wait:${way.sees_far_enough ? "traffic" : "sight"}`, wait: true,
    text: way.sees_far_enough ? "CYCLIST AHEAD · ONCOMING TRAFFIC · STAY BEHIND" : "CYCLIST AHEAD · CAN'T SEE FAR ENOUGH · STAY BEHIND" };
  return { key: `${bike.id}:clear`, wait: false, text: `CYCLIST AHEAD · WAY CLEAR · PASS WITH ${room}` };
}
