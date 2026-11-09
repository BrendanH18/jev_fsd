// Road closures (World option `roadClosures`): a whole block closed for an event, a street festival, say,
// and the detour round it. Now and then, from the feature's own seeded random stream, a block on the
// driven car's route ahead (both directions of the street between two junctions) is closed: striped
// barricades across the street at both ends, just past the crosswalks, with flashing amber lamps, ROAD
// CLOSED and DETOUR signs (render/road-closures.js). Never the block the car is on, nor the one its drive
// started on or ends on, nor one it is already close to (the closure goes up beyond its sight), nor one
// whose closure would leave the car no way to its destination from the street before it (it may see the
// barricade only from there), nor one a bus, streetcar, school bus, plow or garbage truck is due along; and
// never inside a scenario that has not asked for one (the option is off in the seeded benchmark and every
// other challenge).
//
// The car learns of a closure only when it sees a barricade (sim/visibility.js: weather, darkness and
// buildings), and then re-plans: a new route request that avoids the closed edges (`avoid`, on the local
// server jev/routing.py, and in the browser router demo/routing.js, which also serves Node and the public
// demo when there is no server). Until the detour arrives, or if there is none, it stops short of the
// junction before the closed block (or, already past that, short of the barricade): never into it. The
// barricades are static obstacles in `world.obstaclesNear`, so driving into one is a collision.
//
// Traffic knows about the festival: no driver or cyclist ever chooses a closed edge as its next edge
// (sim/npc.js NpcPath.extend), one whose way goes through it re-plans from where it is, and those on the
// block, or committed to it, when it closes are moved elsewhere, out of the car's sight.
//
// `closureAhead` is the one test, shared by sensing (brain/sensors.js `road_closed`), the candidates
// (`stop_for_closure`, and the rejection `enters_closed_road`), Rules, the cautious agent, the model
// wording, traffic (`closureHold`, `avoidClosure`) and the coach: the first barricade line across a
// closed block along a way (a route, or a driver's path) ahead of a front bumper. The audit counts the
// driven car's front crossing a barricade line onto a closed block as `closure_entries`; the metric
// reaches reports, and fails a drive, only once the car has come up to a closure (seen a barricade, or
// crossed one: `World.roadClosuresSeen`). With the option off nothing here is computed and no random
// number is drawn.

import { rng } from "../common.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { browserRoute } from "../demo/routing.js";

// Free drives: a block on the route is looked for every CLOSURE_CHECK_S from CLOSURE_FIRST_S into the
// drive and closed with CLOSURE_CHANCE (a draw only when there is one); one at a time, and after one comes
// down, none for CLOSURE_COOLDOWN_S. The block's near junction lies AHEAD_MIN_M to AHEAD_MAX_M ahead
// along the route, and the block is at least BLOCK_MIN_M long.
export const CLOSURE_CHANCE = 0.35;
export const CLOSURE_CHECK_S = 3;
export const CLOSURE_FIRST_S = 25;
export const CLOSURE_COOLDOWN_S = 90;
export const AHEAD_MIN_M = 120;
export const AHEAD_MAX_M = 450;
export const BLOCK_MIN_M = 40;
// A free drive's closure comes down once it has stood STAND_MIN_S and the car is CLEAR_M from it, with
// neither block on its route.
export const STAND_MIN_S = 60;
export const CLEAR_M = 200;
// The barricades stand PAST_KERB_M beyond the widest cross street's asphalt (past its crosswalk), at
// least SETBACK_MIN_M into the block and at most SETBACK_MAX_SHARE of its length; each board is at most
// BOARD_MAX_M across the street and BOARD_DEPTH_M deep.
export const PAST_KERB_M = 4.5;
export const SETBACK_MIN_M = 5;
export const SETBACK_MAX_SHARE = 0.3;
export const BOARD_MAX_M = 2.6;
export const BOARD_DEPTH_M = 0.5;
// The driven car, with no detour yet, stops HOLD_BACK_M short of the cross street's asphalt before the
// closed block (at its stop line where it has one), or, past that already, STOP_BACK_M short of the
// barricade. A barricade is looked for up to LOOK_M ahead; one the car has seen is reported up to
// NOTICE_M off once it has a detour.
export const HOLD_BACK_M = 3.5;
export const STOP_BACK_M = 3;
// It plans that stop braking at STOP_DECEL, so as to start early enough to stop there despite the
// response lag (it comes into sight at most a block ahead).
export const STOP_DECEL = 1.8;
// Having run up to OVERRUN_M past where it meant to stop short of the junction, it stops where it is
// rather than going on to the barricade.
export const OVERRUN_M = 3;
export const LOOK_M = 150;
export const NOTICE_M = 90;
// Traffic: re-plans while more than REPLAN_M short of the end of its street; otherwise stops
// NPC_STOP_BACK_M short of the barricade (it never gets there: see `close`).
export const REPLAN_M = 12;
export const NPC_STOP_BACK_M = 2;
// Drivers moved off a block as it closes go somewhere at least AWAY_M from the car.
export const AWAY_M = 150;

const r1 = (x) => Math.round(x * 10) / 10;

// One board of a barricade: a static obstacle (`kind` "barricade") the size of the board, its long side
// across the street (so `psi` is along it, as for a vehicle: `spec.length` is the board's depth).
export class Barricade {
  constructor(props) { Object.assign(this, props); this.kind = "barricade"; this.barricade = true; this.v = 0; this.a = 0; this.frozen = 0; }
  get center() { return [this.x, this.y]; }
  obb() { return { center: [this.x, this.y], heading: this.psi, halfLength: this.spec.length / 2, halfWidth: this.spec.width / 2 }; }
  toLocal(px, py) {
    const dx = px - this.x, dy = py - this.y, c = Math.cos(this.psi), s = Math.sin(this.psi);
    return { ahead: dx * c + dy * s, right: dx * s - dy * c };
  }
}

export const isBarricade = (o) => !!o?.barricade;

// Half the asphalt of the widest street meeting `node`, other than the block's own (edges `own`).
function crossHalf(map, node, own) {
  let half = 0;
  for (const id of [...(map.inn.get(node) || []), ...(map.out.get(node) || [])]) {
    if (own.includes(id)) continue;
    const o = map.edges.get(id);
    half = Math.max(half, Math.abs(o.asphalt[0]), Math.abs(o.asphalt[1]));
  }
  return half;
}

// The edge running the other way along the same street, or null (a one-way street).
export function reverseOf(map, edgeId) {
  const e = map.edges.get(edgeId);
  for (const id of map.out.get(e.to) || []) { const o = map.edges.get(id); if (o.to === e.from && Math.abs(o.length - e.length) < 2) return id; }
  return null;
}

// A point `lat` metres right of edge `e`'s centreline, `s` metres along it (the pack's length).
function onEdge(e, s, lat = 0) {
  const sc = Math.max(0, Math.min(e.length, s)) * e.cum[e.cum.length - 1] / Math.max(1e-6, e.length);
  const p = pointAt(e.pts, e.cum, sc), h = headingAt(e.pts, e.cum, sc);
  return { x: p[0] + Math.sin(h) * lat, y: p[1] - Math.cos(h) * lat, h };
}

// The closure of the block edge `edgeId` runs along, both ways: its two barricades (`ends`, each a line
// across the street, `psi` pointing into the block, `lo`/`hi` its extent right of that line's centre),
// the boards they are made of, and where along each closed edge its entry barricade stands (`entry`).
export function buildClosure(map, edgeId, id, since = 0) {
  const e = map.edges.get(edgeId), back = reverseOf(map, edgeId), own = back ? [edgeId, back] : [edgeId];
  const setback = (node) => Math.max(SETBACK_MIN_M, Math.min(e.length * SETBACK_MAX_SHARE, crossHalf(map, node, own) + PAST_KERB_M));
  const sA = setback(e.from), sB = setback(e.to);
  const boards = [], ends = [];
  for (const [k, s, flip] of [[0, sA, false], [1, e.length - sB, true]]) {
    const c = onEdge(e, s), psi = flip ? c.h + Math.PI : c.h;
    const lo = flip ? -e.asphalt[1] : e.asphalt[0], hi = flip ? -e.asphalt[0] : e.asphalt[1];
    const width = hi - lo, n = Math.max(1, Math.ceil(width / BOARD_MAX_M)), w = width / n;
    ends.push({ k, node: flip ? e.to : e.from, x: c.x, y: c.y, psi, lo, hi });
    for (let i = 0; i < n; i++) {
      const lat = lo + (i + 0.5) * w;
      boards.push(new Barricade({ id: `${id}_b${k}_${i}`, closure: id, end: k, x: c.x + Math.sin(psi) * lat, y: c.y - Math.cos(psi) * lat, psi,
        spec: { length: BOARD_DEPTH_M, width: w - 0.1, rearOverhang: BOARD_DEPTH_M / 2 } }));
    }
  }
  const entry = { [edgeId]: sA, ...(back ? { [back]: sB } : {}) };
  return { id, street: e.name || "", edges: own, nodes: [e.from, e.to], ends, boards, entry, since, x: (ends[0].x + ends[1].x) / 2, y: (ends[0].y + ends[1].y) / 2 };
}

// A way a vehicle goes: its edges in order, and `at(i, s)`, where `s` metres along edge i (the pack's
// length) falls along it.
export function routeWay(route) {
  const starts = route.laneEdgeStarts(), m = route.map;
  return { edges: route.edges, at: (i, s) => i > 0 ? starts[i] + s : (starts[1] ?? route.length) - (m.edges.get(route.edges[0]).length - s) };
}
export function pathWay(path, map) {
  return { edges: path.edges.map((e) => e.id), at: (i, s) => { const e = path.edges[i]; return e.sStart + s * (e.sEnd - e.sStart) / Math.max(1e-6, map.edges.get(e.id).length); } };
}

// The one test. The first barricade across a closed block along `way` that `front` (a front bumper's
// position along it) has not yet passed, up to `look` ahead: { closure, edge, index (of the edge along
// the way), line_s (along the way), distance_m (front bumper to it) }, or null.
export function closureAhead(world, way, front, look = LOOK_M) {
  const rc = world.roadClosures;
  if (!rc?.list.length || !way) return null;
  for (let i = 0; i < way.edges.length; i++) {
    const c = rc.closed.get(way.edges[i]);
    if (!c) continue;
    const at = way.at(i, c.entry[way.edges[i]]);
    if (at - front < -1) continue;
    if (at - front > look) return null;
    return { closure: c, edge: way.edges[i], index: i, line_s: at, distance_m: at - front };
  }
  return null;
}

// The driven car's sensing: the closure ahead on its route that it has seen, with where it stops for it
// while it has no detour (`stop_s_route`, front bumper, route arc length); or else, once it has one, the
// nearest closure it has seen, its barricade ahead within NOTICE_M (`detour_planned`).
export function roadClosedSensing(world, route, frontS) {
  const rc = world.roadClosures;
  if (!rc?.known.size) return null;
  const hit = route ? closureAhead(world, routeWay(route), frontS) : null;
  if (hit && rc.known.has(hit.closure.id)) {
    const c = hit.closure, starts = route.laneEdgeStarts();
    // (short of the junction before the block: at its stop line, where there is one, or short of the cross
    // street's asphalt; past that already, short of the barricade)
    const line = hit.index > 0 ? route.controls.find((x) => x.edge === route.edges[hit.index - 1]) : null;
    const hold = hit.index > 0 ? (line ? line.sRoute - 0.5 : starts[hit.index] - world.map.crossingHalfWidth(route.edges[hit.index - 1]) - HOLD_BACK_M) : -Infinity;
    const stop = frontS < hold - 0.5 ? hold : frontS < hold + OVERRUN_M ? Math.max(hold, frontS) : hit.line_s - STOP_BACK_M;
    return { id: c.id, street: c.street, distance_m: hit.distance_m, line_s_route: hit.line_s, stop_s_route: stop, bumper_to_stop_m: stop - frontS, on_route: true, detour_planned: false, edges: c.edges };
  }
  const near = knownAhead(world);
  return near ? { ...near, on_route: false, detour_planned: true } : null;
}

// The nearest barricade the driven car has seen, ahead of it within NOTICE_M (whatever its route, or none:
// the coach uses it as the driver drives): { id, street, distance_m, edges }, or null.
export function knownAhead(world) {
  const rc = world.roadClosures, ego = world.ego;
  if (!rc?.known.size) return null;
  let best = null;
  for (const c of rc.list) {
    if (!rc.known.has(c.id)) continue;
    for (const end of c.ends) {
      const l = ego.toLocal(end.x, end.y), d = Math.hypot(l.ahead, l.right);
      if (l.ahead > 0 && d < NOTICE_M && (!best || d < best.distance_m)) best = { id: c.id, street: c.street, distance_m: d, edges: c.edges };
    }
  }
  return best;
}

// Traffic: the barricade ahead along driver `n`'s path, to stop NPC_STOP_BACK_M short of (`hold`, along
// its path), or null.
export function closureHold(world, n, front) {
  const hit = closureAhead(world, pathWay(n.path, world.map), front);
  return hit ? { hold: hit.line_s - NPC_STOP_BACK_M, closure: hit.closure.id } : null;
}

// Drivers that can choose their way: not transit or school buses, trains, plows or garbage trucks, which
// keep to theirs (no block on their way is closed: see `close`).
const free = (n) => !n.transit && !["train", "school_bus", "snow_plow", "collection_truck"].includes(n.kind);

// Traffic: a driver whose way goes through a closed block re-plans from the street it is on, while there
// is room; true when it did.
export function avoidClosure(world, n) {
  const path = n.path, rc = world.roadClosures;
  if (!path || !free(n)) return false;
  path.closures = rc;
  const cur = path.currentEdge(), i = path.edges.indexOf(cur);
  if (!path.edges.slice(i + 1).some((e) => rc.closed.has(e.id)) || rc.closed.has(cur.id) || cur.sEnd - path.s <= REPLAN_M) return false;
  const lane = world.map.lane(cur.id, cur.lane);
  if (!lane) return false;
  path.start(cur.id, cur.lane, projectPoint(lane.pts, lane.cum, [n.x, n.y]).s);
  return true;
}

// The World's state: whether closures come, their random stream, the closures standing and their edges,
// which ones the driven car has seen, when the next may come, and the drive (its destination and the edge
// it started on).
export class RoadClosures {
  constructor({ enabled = false, seed = 1 } = {}) {
    this.enabled = !!enabled;
    this.random = this.enabled ? rng(seed * 2654435761 + 60042) : null;
    this.list = [];
    this.closed = new Map();
    this.known = new Set();
    this.next = this.enabled ? CLOSURE_FIRST_S : Infinity;
    this.checkAt = 0;
    this.made = 0;
    this.fixed = false;
    this.drive = null;
  }

  get boards() { return this.list.flatMap((c) => c.boards); }

  near(x, y, r) {
    const out = [];
    for (const c of this.list) {
      if (Math.abs(c.x - x) > r + 120 || Math.abs(c.y - y) > r + 120) continue;
      for (const b of c.boards) if (Math.abs(b.x - x) < r + 2 && Math.abs(b.y - y) < r + 2) out.push(b);
    }
    return out;
  }

  // The edges no route may enter: those of the closures the driven car has seen.
  avoid() { return this.list.filter((c) => this.known.has(c.id)).flatMap((c) => c.edges); }

  add(closure) {
    this.list.push(closure);
    for (const id of closure.edges) this.closed.set(id, closure);
  }

  remove(closure) {
    this.list = this.list.filter((c) => c !== closure);
    for (const id of closure.edges) if (this.closed.get(id) === closure) this.closed.delete(id);
    this.known.delete(closure.id);
  }

  // Close the block of `edgeId` now: traffic on it, or committed to it, is moved elsewhere. Returns the
  // closure, or null where that cannot be done unseen (see `blockFree`; and a free drive's barricades go
  // up out of the car's sight).
  close(world, fleet, edgeId, { fixed = false } = {}) {
    const closure = buildClosure(world.map, edgeId, `closure_${this.made + 1}`, world.t);
    if (!fixed && closure.boards.some((b) => world.visibility.sees(world.ego, b))) return null;
    const moving = this.blockFree(world, fleet, closure, fixed);
    if (!moving) return null;
    this.made++;
    this.add(closure);
    for (const n of moving) this.relocate(world, fleet, n);
    return closure;
  }

  // The drivers on the block of `closure`, or committed to it, who must be moved elsewhere as it closes; or
  // null when one of them cannot be (the car can see it, or it keeps to a way of its own).
  blockFree(world, fleet, closure, fixed) {
    const out = [], own = new Set(closure.edges);
    for (const n of fleet?.vehicles || []) {
      const path = n.path;
      if (!path?.edges?.length) continue;
      const cur = path.currentEdge(), i = path.edges.indexOf(cur), later = path.edges.slice(i + 1);
      const on = own.has(cur.id), committed = later.length && own.has(later[0].id) && cur.sEnd - path.s <= REPLAN_M + 3;
      if (!on && !committed && !later.some((e) => own.has(e.id))) continue;
      if (!free(n)) { if (!fixed) return null; out.push(n); continue; }
      if (on || committed) {
        if (!fixed && world.sees(world.ego, n)) return null;
        out.push(n);
      }
    }
    return out;
  }

  // Move driver `n` to a lane elsewhere, out of the car's sight, from the feature's stream.
  relocate(world, fleet, n) {
    const map = world.map, ego = world.ego, bike = n.kind === "bike";
    const lanes = map.laneList.filter((l) => l.length > 25 && !this.closed.has(l.edge) && !l.edgeRef.ring && (!bike || l.idx === l.edgeRef.lanes - 1));
    for (let k = 0; k < 40 && lanes.length; k++) {
      const lane = lanes[Math.floor(this.random() * lanes.length)], s = 5 + this.random() * (lane.length - 10), p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - ego.x, p[1] - ego.y) < AWAY_M) continue;
      if (fleet.vehicles.some((v) => v !== n && Math.hypot(v.x - p[0], v.y - p[1]) < 14)) continue;
      Object.assign(n, { x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s), v: 0, a: 0, vy: 0, r: 0, delta: 0, lc: null, waiting: 0 });
      n.path.start(lane.edge, lane.idx, s);
      return;
    }
    // (nowhere to go: off the road altogether)
    fleet.vehicles.splice(fleet.vehicles.indexOf(n), 1);
  }

  // Each step, before traffic moves: a free drive's closures come and go.
  step(world, fleet) {
    if (this.fixed) return;
    const ego = world.ego, route = world.route;
    if (world.destination && (!this.drive || this.drive.dest[0] !== world.destination[0] || this.drive.dest[1] !== world.destination[1])) {
      this.drive = { dest: [world.destination[0], world.destination[1]], start: route?.edges[0] ?? null };
    }
    for (const c of [...this.list]) {
      const far = c.ends.every((e) => Math.hypot(e.x - ego.x, e.y - ego.y) > CLEAR_M);
      if (world.t - c.since > STAND_MIN_S && far && !(route?.edges || []).some((id) => this.closed.get(id) === c)) {
        this.remove(c);
        this.next = world.t + CLOSURE_COOLDOWN_S;
      }
    }
    if (this.list.length || world.t < this.next || world.t < this.checkAt || !route || !world.destination) return;
    this.checkAt = world.t + CLOSURE_CHECK_S;
    const blocks = this.blocksAhead(world);
    if (!blocks.length || this.random() >= CLOSURE_CHANCE) return;
    const edge = blocks[Math.floor(this.random() * blocks.length)];
    // (only where the car still has a way to its destination round it from the start of the street before
    // the block: it may not see the barricade until it is on that street, and must turn off at its end)
    const avoid = [edge, reverseOf(world.map, edge)].filter(Boolean), before = route.edges[route.edges.indexOf(edge) - 1];
    const lane = world.map.lane(before, 0), at = lane ? pointAt(lane.pts, lane.cum, Math.min(1, lane.length / 2)) : null;
    const way = at && browserRoute(world.map, { x: at[0], y: at[1], heading: headingAt(lane.pts, lane.cum, 0) }, { x: world.destination[0], y: world.destination[1] },
      { avoid, ...(world.restrictions ? { restrictions: true, hour: world.clock?.hour ?? 15.5, weekday: world.clock?.weekday ?? 0 } : {}) });
    if (!way || way.edges[0] !== before) return;
    this.close(world, fleet, edge);
  }

  // The blocks of the route ahead a free drive's closure may go up on (their edges along the route).
  blocksAhead(world) {
    const route = world.route, map = world.map, ego = world.ego, starts = route.laneEdgeStarts();
    const p = projectPoint(route.pts, route.cum, [ego.x, ego.y], route.hint);
    if (!p) return [];
    const at = route.laneEdgeAt(p.s), last = route.edges.length - 1;
    const goal = new Set([route.edges[last], reverseOf(map, route.edges[last])]);
    const start = this.drive?.start ? new Set([this.drive.start, reverseOf(map, this.drive.start)]) : new Set();
    const transit = this.transitEdges(map);
    const out = [];
    for (let i = at + 2; i < last; i++) {
      const ahead = starts[i] - p.s;
      if (ahead < AHEAD_MIN_M) continue;
      if (ahead > AHEAD_MAX_M) break;
      const id = route.edges[i], e = map.edges.get(id), back = reverseOf(map, id);
      if (e.length < BLOCK_MIN_M || e.ring || goal.has(id) || start.has(id) || transit.has(id) || (back && transit.has(back))) continue;
      if (route.edges.slice(0, at + 1).some((x) => x === id || x === back)) continue;
      if (map.contraflow?.has(id) || (back && map.contraflow?.has(back))) continue;
      out.push(id);
    }
    return out;
  }

  transitEdges(map) {
    if (!this._transit || this._transit.map !== map) {
      const set = new Set();
      for (const r of map.transit?.routes || []) for (const run of r.runs || []) for (const id of run.edges || []) set.add(id);
      this._transit = { map, set };
    }
    return this._transit.set;
  }
}

// The audit, each step: what the driven car has seen (a barricade in sight), and its front crossing a
// barricade line onto a closed block, as `closure_entries`.
export function auditRoadClosures(world) {
  const rc = world.roadClosures, ego = world.ego, calls = world.roadClosureCalls ||= new Map();
  if (!rc.list.length) { calls.clear(); return; }
  const range = world.visibility.range + 5;
  for (const c of rc.list) {
    if (Math.abs(c.x - ego.x) > 200 || Math.abs(c.y - ego.y) > 200) continue;
    if (!rc.known.has(c.id) && c.boards.some((b) => Math.hypot(b.x - ego.x, b.y - ego.y) < range && world.visibility.sees(ego, b))) {
      rc.known.add(c.id);
      world.roadClosuresSeen = true;
      world.events.push({ type: "road_closed_seen", closure: c.id, street: c.street });
    }
    const [fx, fy] = ego.front;
    for (const end of c.ends) {
      const key = `${c.id}:${end.k}`, u = [Math.cos(end.psi), Math.sin(end.psi)];
      const d = (fx - end.x) * u[0] + (fy - end.y) * u[1], lat = (fx - end.x) * u[1] - (fy - end.y) * u[0];
      const prev = calls.get(key);
      calls.set(key, d);
      if (prev !== undefined && prev < 0 && d >= 0 && lat > end.lo - 1 && lat < end.hi + 1 && Math.abs(d - prev) < 3) {
        world.roadClosuresSeen = true;
        world.violations.closure_entries = (world.violations.closure_entries || 0) + 1;
        world.events.push({ type: "closure_entry", closure: c.id, street: c.street, speed_mps: r1(ego.v) });
      }
    }
  }
}

// The HUD's line: a road closed ahead that the car has seen, on its route (stopping for it while it
// re-plans) or beside its detour; or, the driver driving, a barricade it has seen ahead.
export function roadClosedNotice(snap, world = null) {
  const rc = snap?.road_closed || (world ? knownAhead(world) : null);
  if (!rc) return null;
  if (rc.detour_planned === undefined) return { key: `${rc.id}:seen`, text: `ROAD CLOSED AHEAD · DETOUR${rc.street ? ` · ${rc.street}` : ""}`, stop: false };
  return { key: `${rc.id}:${rc.detour_planned ? "detour" : "stop"}`, text: rc.detour_planned ? `ROAD CLOSED AHEAD · DETOUR${rc.street ? ` · ${rc.street}` : ""}` : `ROAD CLOSED AHEAD · finding a detour`, stop: !rc.detour_planned };
}
