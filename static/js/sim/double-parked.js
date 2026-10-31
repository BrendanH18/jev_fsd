// Double-parked delivery vans. A van stops in the travel lane of a two-way street with one lane each
// way, beside the cars parked at the curb, its hazard lights flashing while its driver runs a parcel
// to a door. The only way past is round it through the oncoming lane, and every province's driver's
// handbook says the same about that: oncoming traffic has the right of way, and a driver may cross
// the centre line to go round something blocking its lane only when it can see that the way is clear
// for long enough to get round and back without making anyone coming the other way slow down or
// swerve. Until then it waits behind it.
//
// Along the van's street (its edge's own `s`), with `rear` and `front` the van's ends: the way round
// (`detour`, sim/controller.js detourAt, at a driver's pursuit point) eases across from LEAD_M short
// of its rear to just short of it, all the way into the oncoming lane, stays there until just past
// its front, and eases back by RETURN_M past it. A driver waits with its front WAIT_M short of the
// van's rear (`wait`), back far enough to pull out round it. It goes round once nobody is waiting
// ahead of it (queuedAhead) and the way is clear (wayRound): nobody coming the other way, in the
// oncoming lane or about to turn into it at the junction ahead, would reach the end of the way round
// (`to`) sooner than MARGIN_S after the driver, going round at PASS_MPS and pulling away at
// PASS_ACCEL, has its front there; and, for the driven car, it can see that far along the oncoming
// lane (or, where that is further, as far as it ever sees, DAYLIGHT_RANGE_M, so that by night or in
// fog it waits). Once it has started across it carries on round. Everyone keeps to PASS_MPS from
// where it would wait until it is back in its lane.
//
// Traffic and cyclists all do (sim/npc.js); the driven car's sensing reports `double_parked`
// (brain/sensors.js), and the audit counts going round into the way of oncoming traffic as a failure
// to yield (sim/world.js).
//
// In a free drive one van stands at a time, somewhere 150 to 450 m from the car where it cannot see
// it, for 1 to 3 minutes, by day and out of fog (deliveries are made by day, and in poor sight the car
// could not see far enough to go round). Then, once nobody is going round it, it leaves: out of the car's sight it
// goes; in sight, it switches its hazards off and drives away as traffic (sim/npc.js driveOffVans).
// `?vans=0` takes them off. Vans stop only on straight blocks without a marked crosswalk, a bus or
// streetcar route, or a level crossing, clear of the junctions at each end, and never on the block of
// a work zone or a vehicle stopped at the roadside.

import { Vehicle, CAR, DELIVERY_VAN } from "./vehicle.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { rng } from "../common.js";
import { railIndex } from "./rail.js";
import { DAYLIGHT_RANGE_M } from "./visibility.js";
import { current as weather } from "./weather.js";

export const VAN_NAME = "delivery van";
export const WAIT_M = 7;
export const LEAD_M = 18;
export const RETURN_M = 16;
export const PASS_MPS = 20 / 3.6;
export const PASS_ACCEL = 1.5;
export const MARGIN_S = 2;
export const PASS_DECEL = 1.5;      // slowing to PASS_MPS by the wait point, at no more than this
export const DECIDE_M = 30;         // traffic decides whether to go round once its front is this near the van
export const VAN_LOOK_M = 80;       // and looks out for one this far ahead
const LANE_SIDE_M = 0.15;           // the van stands this far right of its lane's centre, beside the parked cars
const END_M = 12;                   // the way round, and room for a queue behind it, keep this far from the junction lines
const QUEUE_M = 15;
const STRAIGHT_RAD = 0.1;
const FAR_M = 50;                   // someone this near the junction ahead (or as near as it comes in the time the way round takes) may turn into the oncoming lane
const STANDING_MPS = 0.5;
const SIGHT_SLACK_M = 10;          // (the car's eyes are behind its front: see as far as it ever does, less this)
const ON_STREET_M = 1;              // on the street: within this of its asphalt
const END_REACH_M = 6;              // or up to this far past its far end
const SAME_WAY = Math.PI / 4;
const HELD_M = 4;                   // parked cars along the way round, and this far beyond it, stay put while it stands there
// Free drive: how many stand at once, where they turn up, for how long, and how far away the car
// must be before one leaves without being seen.
export const VAN_COUNT = 1;
const SPAWN_M = [150, 450];
const STAY_S = [60, 180];
const LEAVE_M = 150;
const RETRY_S = 5;
const ROADSIDE_CLEAR_M = 40;
const COLORS = [0xf2f2ee, 0xe9e9e4, 0x5b2a86, 0x7a5230];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const isVan = (o) => !!o && o.doubleParked === true;

// The edge of the same street going the other way from `e`, with one lane, or undefined.
export function oppositeOf(map, e) {
  return (map.out.get(e.to) || []).map((id) => map.edges.get(id)).find((x) => x.to === e.from && x.lanes === 1 && !x.oneway && Math.abs(x.length - e.length) < 1);
}

// The streets a van can stop on: a two-way street with one lane each way (`edge` the way it faces,
// `opposite` the other), long and straight enough, where [lo, hi] is the range its rear can take.
const siteCache = new WeakMap();
export function vanSites(map) {
  if (siteCache.has(map)) return siteCache.get(map);
  const routed = new Set();
  for (const route of map.transit?.routes || []) for (const run of route.runs || []) for (const id of run.edges || []) routed.add(id);
  for (const c of railIndex(map).crossings) for (const on of c.edges) routed.add(on.edge);
  const crossed = new Set((map.crosswalks || []).map((c) => c.edge));
  const sites = [];
  for (const e of map.edges.values()) {
    if (e.oneway || e.lanes !== 1 || e.ring || routed.has(e.id) || crossed.has(e.id)) continue;
    const o = oppositeOf(map, e);
    if (!o || routed.has(o.id) || crossed.has(o.id)) continue;
    const L = e.length, start = L - (o.control?.s_line ?? L), end = e.control?.s_line ?? L;
    const lo = start + END_M + QUEUE_M + LEAD_M, hi = end - END_M - RETURN_M - DELIVERY_VAN.length;
    if (hi < lo) continue;
    const h0 = headingAt(e.pts, e.cum, lo - LEAD_M);
    let straight = true;
    for (let s = lo - LEAD_M; s <= hi + DELIVERY_VAN.length + RETURN_M && straight; s += 4) straight = Math.abs(wrap(headingAt(e.pts, e.cum, s) - h0)) < STRAIGHT_RAD;
    if (straight) sites.push({ edge: e.id, opposite: o.id, lo, hi });
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

// Vehicle `n` on the street of edge `e`: { s (its reference point along `e`), lateral (right of the
// centre line), same (heading the way of `e`), opposite (heading against it) }, or null when it is
// not on the street. (One just past its far end, coming into it from the junction there, is on it,
// at its end.)
function onStreet(e, n) {
  const p = projectPoint(e.pts, e.cum, [n.x, n.y], null);
  if (!p || p.s < 0.5 || p.distance > Math.abs(p.lateral) + END_REACH_M || p.lateral < e.asphalt[0] - ON_STREET_M || p.lateral > e.asphalt[1] + ON_STREET_M) return null;
  const d = wrap(n.psi - p.heading);
  return { s: p.s, lateral: p.lateral, same: Math.abs(d) < SAME_WAY, opposite: Math.abs(d) > Math.PI - SAME_WAY };
}

// How long a driver at `v` takes to cover `d` metres going round, pulling away at PASS_ACCEL up to
// PASS_MPS (or slowing to it). `driver` ({ accel, react, vmax }), for traffic: as that driver pulls
// away, no faster than that, after its reaction time if it is standing still, up to its own speed.
export function passTime(d, v, driver = null) {
  if (d <= 0) return 0;
  const a = Math.min(PASS_ACCEL, driver?.accel ?? PASS_ACCEL), vm = Math.min(PASS_MPS, driver?.vmax ?? PASS_MPS), wait = v < 0.3 ? driver?.react ?? 0 : 0;
  const v0 = Math.min(Math.max(0, v), vm), da = (vm * vm - v0 * v0) / (2 * a);
  if (d <= da) return wait + (Math.sqrt(v0 * v0 + 2 * a * d) - v0) / a;
  return wait + (vm - v0) / a + (d - da) / vm;
}

// When vehicle `n`'s front, coming the other way, reaches the end of the way round van `d` (seconds;
// 0 when it is already there), or null when it is not coming: already past, going elsewhere, or
// standing still beyond it. Along the street, by where it is; at the junction ahead, by its indicator:
// one coming up to the junction whose indicator (or none, going straight on) points into the
// oncoming lane.
function arrival(map, d, n, by = 0) {
  const e = map.edges.get(d.edge), ns = n.spec || CAR, fr = ns.length - ns.rearOverhang;
  const on = onStreet(e, n);
  if (on) {
    if (!on.opposite) return null;
    const front = on.s - fr, rear = on.s + ns.rearOverhang;
    if (rear < d.detour.from) return null;
    if (front <= d.detour.to) return 0;
    if (n.v < STANDING_MPS) return null;
    return (front - d.detour.to) / n.v;
  }
  const node = map.nodes.get(e.to);
  if (!node || n.v < 1) return null;
  const dx = node.x - n.x, dy = node.y - n.y, dist = Math.hypot(dx, dy);
  if (dist > Math.max(FAR_M, n.v * by) || (dx * Math.cos(n.psi) + dy * Math.sin(n.psi)) < 0.3 * dist) return null;
  const o = map.edges.get(d.opposite), turn = wrap(headingAt(o.pts, o.cum, 0) - n.psi);
  if (Math.abs(turn) > Math.PI * 3 / 4) return null;
  const way = Math.abs(turn) < Math.PI / 4 ? null : turn > 0 ? "left" : "right";
  if ((n.signal || null) !== way) return null;
  return (dist + (e.length - d.detour.to)) / n.v;
}

// The way round van `d` for a driver whose front is `frontS` along its street, at `v`, against
// vehicles `others` (not the driver), and, with `sight`, only as far as it can see (sight(s): whether
// it can see the oncoming lane `s` along the street; it need not see further than DAYLIGHT_RANGE_M
// past its front, less SIGHT_SLACK_M): { clear, need_s (until its front is at the end of the way
// round), oncoming: { vehicle, eta_s } (the first one coming that leaves too little time),
// sees_far_enough }. `driver`: as for passTime.
export function wayRound(world, d, frontS, v, others, sight = null, driver = null) {
  const map = world.map, e = map.edges.get(d.edge), need = passTime(d.detour.to - frontS, v, driver), by = need + MARGIN_S;
  let first = null;
  for (const n of others) {
    if (n.parked || isVan(n) || n.rail || n.kind === "pedestrian" || n.kind === "door") continue;
    if (Math.abs(n.x - d.x) > 300 || Math.abs(n.y - d.y) > 300) continue;
    const eta = arrival(map, d, n, by);
    if (eta !== null && eta < by && (!first || eta < first.eta_s)) first = { vehicle: n, eta_s: eta };
  }
  // (as far along the oncoming lane as anyone at the street's limit would come in that time)
  const seen = !sight || sight(Math.min(e.length - 1, d.detour.to + (e.limit || 11.2) * by, frontS + DAYLIGHT_RANGE_M - SIGHT_SLACK_M));
  return { clear: !first && seen, need_s: need, oncoming: first, sees_far_enough: seen };
}

// Someone waiting behind van `d` ahead of a driver whose front is `frontS` along its street: in the
// van's lane, going its way, between the driver and the van, and not going round it. Or null.
export function queuedAhead(world, d, frontS, driver, others) {
  const e = world.map.edges.get(d.edge), lane = e.lane_offsets?.[0] ?? e.lane_width / 2;
  for (const n of others) {
    if (n === driver || isVan(n) || n.parked || n.kind === "pedestrian" || n.kind === "door") continue;
    if (Math.abs(n.x - d.x) > 60 || Math.abs(n.y - d.y) > 60) continue;
    const on = onStreet(e, n);
    if (!on || !on.same || Math.abs(on.lateral - lane) > 1.6) continue;
    const rear = on.s - (n.spec || CAR).rearOverhang;
    if (rear > frontS - 0.5 && rear < d.rear) return n;
  }
  return null;
}

export class DoubleParked {
  constructor(world, { count = 0, seed = 1 } = {}) {
    this.world = world;
    this.count = count;
    this.random = rng(seed * 32452867 + 41);
    this.vans = [];
    this.made = 0;
    // (the first stops on the first step, once the car and the traffic are where they start)
    this.next = 0;
  }

  step(dt) {
    if (!this.vans.length && !this.count) return;
    const ego = this.world.ego;
    for (const d of [...this.vans]) {
      d.left -= dt;
      if (d.held || d.left > 0 || d.leaving || this.busy(d)) continue;
      if (this.world.visibility.canSee(ego, d.x, d.y)) d.leaving = true;
      else if (Math.hypot(d.x - ego.x, d.y - ego.y) > LEAVE_M) this.retire(d);
    }
    if (this.count && this.vans.length < this.count && (this.next -= dt) <= 0) { this.next = RETRY_S; this.spawn(); }
  }

  // Whether anyone is beside van `d` or going round it, either way: it cannot leave yet.
  busy(d) {
    const world = this.world, e = world.map.edges.get(d.edge), lane = e.lane_offsets?.[0] ?? e.lane_width / 2;
    for (const n of [world.ego, ...(world.npcs || [])]) {
      if (n.rail || Math.abs(n.x - d.x) > 50 || Math.abs(n.y - d.y) > 50) continue;
      const on = onStreet(e, n);
      if (!on) continue;
      const ns = n.spec || CAR, lo = on.s - (on.opposite ? ns.length - ns.rearOverhang : ns.rearOverhang), hi = on.s + (on.opposite ? ns.rearOverhang : ns.length - ns.rearOverhang);
      if (hi > d.rear - 1 && lo < d.front + 2) return true;
      if (on.same && on.lateral < lane - 1 && hi > d.detour.from && lo < d.detour.to) return true;
    }
    return false;
  }

  // A free-drive van on a street SPAWN_M from the car and out of its sight, with nobody along the way
  // round, and no work zone or roadside stop on the street; by day, and out of fog.
  spawn() {
    const world = this.world, map = world.map, ego = world.ego, sites = vanSites(map);
    if (!sites.length || world.visibility.night > 0.5 || weather.visibility < DAYLIGHT_RANGE_M) return null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const site = sites[Math.floor(this.random() * sites.length)];
      if (this.vans.some((d) => d.edge === site.edge || d.edge === site.opposite)) continue;
      if ((world.workZones?.zones || []).some((z) => z.closed === site.edge || z.closed === site.opposite)) continue;
      const rear = site.lo + this.random() * (site.hi - site.lo), e = map.edges.get(site.edge);
      const mid = at(e, rear + DELIVERY_VAN.length / 2, 0), dist = Math.hypot(mid[0] - ego.x, mid[1] - ego.y);
      if (dist < SPAWN_M[0] || dist > SPAWN_M[1] || world.visibility.canSee(ego, mid[0], mid[1])) continue;
      if ((world.roadside?.vehicles || []).some((v) => Math.hypot(v.x - mid[0], v.y - mid[1]) < ROADSIDE_CLEAR_M)) continue;
      const from = rear - LEAD_M - 6, to = rear + DELIVERY_VAN.length + RETURN_M + 6;
      if ([ego, ...(world.npcs || [])].some((n) => { const on = onStreet(e, n); return on && on.s > from && on.s < to; })) continue;
      return this.place({ edge: site.edge, rear, stay: STAY_S[0] + this.random() * (STAY_S[1] - STAY_S[0]) });
    }
    return null;
  }

  // A van double-parked in the lane of edge `edge`, its rear `rear` metres along it, for `stay`
  // seconds. Returns its record: { id, van, edge, opposite, rear, front, x, y, heading, detour, wait,
  // left, held (a challenge keeps it there), leaving }.
  place({ edge, rear, stay = Infinity, color = null }) {
    const world = this.world, map = world.map, e = map.edges.get(edge), o = oppositeOf(map, e), spec = DELIVERY_VAN, n = ++this.made;
    const laneC = e.lane_offsets?.[0] ?? e.lane_width / 2, oLane = o ? (o.lane_offsets?.[0] ?? o.lane_width / 2) : laneC;
    const s = rear + spec.rearOverhang, h = headingAt(e.pts, e.cum, s), [x, y] = at(e, s, laneC + LANE_SIDE_M);
    const van = new Vehicle(x, y, h, 0, spec);
    const id = `van_${n}`;
    Object.assign(van, { id, kind: "delivery_van", doubleParked: true, hazards: true, stay: true, edge, color: color ?? COLORS[(n - 1) % COLORS.length] });
    world.parked.add(van);
    const front = rear + spec.length, [cx, cy] = at(e, rear + spec.length / 2, laneC);
    const d = {
      id, van, edge, opposite: o?.id ?? null, rear, front, x: cx, y: cy, heading: h,
      // (from the van's lane's centre to the oncoming one's, in the van's edge's frame)
      detour: { id, from: rear - LEAD_M, full: rear - 1, back: front + 2, to: front + RETURN_M, shift: -(laneC + oLane) },
      wait: rear - WAIT_M, left: stay, held: false, leaving: false, stayed: [],
    };
    // (the cars parked along the way round, at either curb, stay put while it is there: no door swings
    // open into it, and nobody pulls out into it)
    for (const c of world.parked.list) {
      if (c === van || c.stay || (c.edge !== e.id && c.edge !== o?.id)) continue;
      const p = projectPoint(e.pts, e.cum, [c.x, c.y], null);
      if (p && p.s > d.detour.from - HELD_M && p.s < d.detour.to + HELD_M) { c.stay = true; d.stayed.push(c); }
    }
    this.vans.push(d);
    return d;
  }

  retire(d) {
    this.world.parked.remove(d.van);
    for (const c of d.stayed) c.stay = false;
    const i = this.vans.indexOf(d);
    if (i >= 0) this.vans.splice(i, 1);
  }

  // The vans standing on edge `edgeId`.
  on(edgeId) {
    return this.vans.filter((d) => d.edge === edgeId);
  }

  // Whether point (x, y) is on the street along the way round a van: nobody is put there.
  covers(x, y) {
    const map = this.world.map;
    return this.vans.some((d) => {
      if (Math.abs(x - d.x) > 60 || Math.abs(y - d.y) > 60) return false;
      const e = map.edges.get(d.edge), p = projectPoint(e.pts, e.cum, [x, y], null);
      return p && p.s > d.wait - 8 && p.s < d.detour.to + 4 && p.lateral > e.asphalt[0] - 1 && p.lateral < e.asphalt[1] + 1;
    });
  }

  // How the driven car stands to the vans: the one in its lane ahead along its street (going its way,
  // its front from VAN_LOOK_M short of the van's rear to the end of the way round), with what the car
  // can tell about the way round, or null. { van (its record), front (the car's front along the van's
  // street), going (round it: across the centre line beside the way round), way (wayRound, against
  // what the car can see, as far as it can see), queued (someone waiting ahead of it), seen }.
  // Sensing-free, for the HUD and the audit.
  egoView() {
    const world = this.world, ego = world.ego, map = world.map, FRONT = ego.spec.length - ego.spec.rearOverhang;
    for (const d of this.vans) {
      if (Math.abs(ego.x - d.x) > VAN_LOOK_M + 30 || Math.abs(ego.y - d.y) > VAN_LOOK_M + 30) continue;
      const e = map.edges.get(d.edge), on = onStreet(e, ego);
      if (!on || !on.same) continue;
      const front = on.s + FRONT;
      if (front < d.rear - VAN_LOOK_M || front > d.detour.to) continue;
      const seen = world.sees(ego, d.van);
      const lane = e.lane_offsets?.[0] ?? e.lane_width / 2;
      const others = world.visibleObstaclesNear(ego.x, ego.y, DAYLIGHT_RANGE_M + 10).filter((n) => n !== ego && !n.parked && n.kind !== "pedestrian");
      const way = wayRound(world, d, front, ego.v, others, this.sightFor(d));
      return { van: d, front, going: on.lateral < lane - 1 && front > d.detour.from, lateral: on.lateral, way, queued: queuedAhead(world, d, front, ego, others), seen };
    }
    return null;
  }

  // The van the driven car is going round now: going its street's way, its front alongside the way
  // round (between where it starts and a few metres past where it ends) and its centre more than
  // half a metre left of its lane's. Or null. Sensing-free, for the coaching score.
  passing() {
    const world = this.world, ego = world.ego, FRONT = ego.spec.length - ego.spec.rearOverhang;
    for (const d of this.vans) {
      if (Math.abs(ego.x - d.x) > 60 || Math.abs(ego.y - d.y) > 60) continue;
      const e = world.map.edges.get(d.edge), on = onStreet(e, ego), lane = e.lane_offsets?.[0] ?? e.lane_width / 2;
      if (on?.same && on.lateral < lane - 0.5 && on.s + FRONT > d.detour.from && on.s + FRONT < d.detour.to + 4) return d;
    }
    return null;
  }

  // What the driven car can see along the oncoming lane by van `d`: sight(s), as for wayRound.
  sightFor(d) {
    const world = this.world, map = world.map, e = map.edges.get(d.edge), o = d.opposite ? map.edges.get(d.opposite) : null;
    const lat = -(o ? (o.lane_offsets?.[0] ?? o.lane_width / 2) : e.lane_width / 2);
    return (s) => { const [x, y] = at(e, s, lat); return world.visibility.canSee(world.ego, x, y); };
  }
}

// What the HUD tells the driver of the car about a van double-parked in its lane ahead, once it can
// see it (within NOTICE_M of its rear) until it is back in its lane past it: to wait behind it, or
// that the way round is clear. { key, text, wait }, or null.
const NOTICE_M = 60;
export function vanNotice(world) {
  const view = world.doubleParked?.egoView();
  if (!view || !view.seen || view.front < view.van.rear - NOTICE_M) return null;
  const { van, way, queued, going } = view;
  if (going) return { key: `${van.id}:going`, wait: false, text: "DOUBLE-PARKED VAN · GOING ROUND · BACK INTO YOUR LANE PAST IT" };
  if (view.front > van.front) return null;
  if (queued) return { key: `${van.id}:queued`, wait: true, text: "DOUBLE-PARKED VAN · WAIT YOUR TURN BEHIND IT" };
  if (!way.clear) return { key: `${van.id}:wait:${way.sees_far_enough ? "traffic" : "sight"}`, wait: true,
    text: way.sees_far_enough ? "DOUBLE-PARKED VAN · ONCOMING TRAFFIC · WAIT BEHIND IT" : "DOUBLE-PARKED VAN · CAN'T SEE PAST · WAIT BEHIND IT" };
  return { key: `${van.id}:clear`, wait: false, text: "DOUBLE-PARKED VAN · WAY CLEAR · GO ROUND IT" };
}
