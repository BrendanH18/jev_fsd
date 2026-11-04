// School crossing guards (Ontario Highway Traffic Act s. 176; BC's Motor Vehicle Act and Québec's
// Highway Safety Code have the same rule): at a marked crosswalk in a school zone, a guard in a hi-vis
// vest walks children across, holding up a round red STOP sign. A driver facing it stops before the
// crosswalk and does not go on until the guard and every child are off the roadway, not just out of
// its own lane.
//
// A post stands at every marked crosswalk between junctions (`map.crosswalks`, sim/crosswalk.js) that
// lies in a school zone (jev/osm/zones.py), while the zone is in effect (sim/speed-zones.js, by the
// world's clock). Its guard waits on the sidewalk at one end (`home`). Children come along the
// sidewalk in small groups, from either side, and wait at the curb. Once a group is waiting, the
// guard waits for a gap: nothing coming either way, the driven car included, too close to stop
// comfortably (comfort().decel after GAP_REACT_S) with its front STOP_M short of the crosswalk's centre, and
// nothing on the crosswalk. Then the guard raises the sign and walks out to the middle of the road
// (`phase` "out"); once there, the children cross ("cross"); once every child is off the roadway the
// guard walks back to the curb ("back"), and lowers the sign there ("idle"). The sign is up from the
// moment the guard steps out until the guard is back on the sidewalk (`paddleUp`).
//
// Everyone coming toward the crosswalk while the sign is up stops with its front STOP_M short of its
// centre, if it could when the sign went up (braking at no more than OWED_DECEL; standing still, it
// can), and stays stopped while the sign is up. Traffic and cyclists do (sim/npc.js); the driven car's
// sensing reports `crossing_guard` (brain/sensors.js), and the audit counts going past the stop point
// once owed (sim/world.js, `guard_violations`).
//
// The guard and the children are pedestrians in the crowd (sim/pedestrians.js), so collisions, sight
// and rendering treat them as people, but the crowd leaves them to the post (`ped.guard`) until a child
// is across: then it walks off along the sidewalk and home.
//
// Opt-in: World option `guards` (free drives, unless `?guards=0`; challenges with `guards: true`).
// With it off nothing here is computed and no random stream is drawn from.

import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { sidewalkOffset } from "../map/streets.js";
import { rng } from "../common.js";
import { comfort } from "./vehicle.js";
import { Pedestrian } from "./pedestrians.js";
import { inEffect } from "./speed-zones.js";
import { distanceTo } from "./crosswalk.js";

export const STOP_M = 5;           // traffic stops with its front this far short of the crosswalk's centre
export const OWED_DECEL = 3.5;     // a driver owes the stop if it could make it braking at no more than this
const GAP_REACT_S = 1.0;           // after this long to react
const GAP_LOOK_M = 100;            // looking this far along the street
export const LOOK_M = 80;          // drivers heed a post this far ahead
const GUARD_MPS = 1.2;
const KID_MPS = [1.0, 1.3];
const KIDS = [1, 4];               // children in a group
const KID_EVERY_S = [25, 70];      // (free drive) between groups at a post
const KID_FROM_M = [18, 32];       // (free drive) a group comes along the sidewalk from this far away
const REST_S = 4;                  // the guard stays at the curb at least this long between crossings
const UPSTREAM_M = 1.0;            // the guard stands this far back from the crosswalk's centre, toward the base edge's traffic
const HOME_BACK_M = 1.5;           // and waits on the sidewalk this far back from it
const CURB_M = 0.7;                // and this far beyond the asphalt's edge
const OFF_ROAD_M = 0.3;            // someone is off the roadway once their middle is this far beyond its edge
const HOME_WALK = [10, 30];        // a child across walks this far along the sidewalk, and home

// Whether a driver at speed v could stop `d` metres ahead braking at no more than `decel`.
export const canStopFor = (v, d, decel = OWED_DECEL) => v < 0.5 || d >= v * v / (2 * decel);
// Which time this is that a post's sign has gone up: a driver owes each such stop once.
export const stopKey = (post) => `${post.id}:${post.stops}`;
export const isCrossingGuard = (o) => !!o && !!o.crossingGuard;

function offsetPoint(e, s, lat) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat];
}

// The marked crosswalks in a school zone (`crowd.marked` entries), cached per crowd.
const siteCache = new WeakMap();
export function guardSites(world) {
  const marked = world.crowd?.marked;
  if (!marked) return [];
  if (siteCache.has(marked)) return siteCache.get(marked);
  const map = world.map, sites = [];
  for (const cw of marked) {
    const e = cw.st.edge;
    // (on either edge of a two-way street, as the zone may be mapped on one)
    const ids = [e.id, ...[...map.edges.values()].filter((o) => o.from === e.to && o.to === e.from).map((o) => o.id)];
    const zone = ids.flatMap((id) => (map.zoneSpans.get(id) || []).map((span) => ({ span, s: id === e.id ? cw.s : map.edges.get(id).length - cw.s })))
      .find(({ span, s }) => span.zone.kind === "school" && s >= span.from - 1 && s <= span.to + 1);
    if (zone) sites.push({ cw, zone: zone.span.zone });
  }
  siteCache.set(marked, sites);
  return sites;
}

export class CrossingGuards {
  // `enabled`: posts are staffed while a school zone is in effect. `arrivals`: children come along now
  // and then (a challenge places its own).
  constructor(world, { enabled = false, seed = 1 } = {}) {
    this.world = world;
    this.enabled = !!enabled;
    this.arrivals = true;
    this.random = rng(seed * 49157 + 71);
    this.posts = [];
    this.made = 0;
    this.kids = 0;
    // (whether any post's sign is up, or anyone is in the road at one: traffic looks only then)
    this.active = false;
  }

  step(dt) {
    if (!this.enabled) return;
    const world = this.world, school = inEffect("school", world.clock);
    if (school) this.staff();
    let active = false;
    for (const post of this.posts) {
      // (staffed while the zone is in effect; off duty only with nobody in the road)
      if (!school && post.onDuty && post.phase === "idle" && !post.kids.length) this.offDuty(post);
      if (school && !post.onDuty) this.onDutyAgain(post);
      if (!post.onDuty) continue;
      this.control(post, dt);
      if (post.paddleUp || this.inRoad(post).length) active = true;
    }
    this.active = active;
  }

  // A post at every marked crosswalk in a school zone, the first time one is in effect. Returns them.
  staff() {
    if (!this.posts.length) for (const site of guardSites(this.world)) this.place(site);
    return this.posts;
  }

  // A post at crosswalk `cw` (a `crowd.marked` entry), its guard waiting at the end on `side` (1: the
  // right of its street's base edge, -1 the left). Returns it.
  place({ cw, zone = null }, { side = 1 } = {}) {
    const e = cw.st.edge, n = ++this.made, id = `guard_${n}`;
    const edgeLat = (sd) => sd > 0 ? e.asphalt[1] : e.asphalt[0];
    const home = offsetPoint(e, cw.s - HOME_BACK_M, edgeLat(side) + side * CURB_M);
    const mid = offsetPoint(e, cw.s - UPSTREAM_M, (e.asphalt[0] + e.asphalt[1]) / 2);
    const h = headingAt(e.pts, e.cum, cw.s);
    const guard = new Pedestrian({ id, x: home[0], y: home[1], psi: h + Math.PI, v: 0, speed: GUARD_MPS, path: [], crossing: null, waiting: 0, phase: 0,
      look: n * 7919 + 13, worker: true, crossingGuard: id, guard: id, paddle: "down" });
    const post = { id, cw, edge: e.id, s: cw.s, side, home, mid, heading: h, zone: zone ? { id: zone.id, name: zone.name } : null,
      guard, kids: [], phase: "idle", t: REST_S, paddleUp: false, stops: 0, held: false, onDuty: true, calls: new Map(), egoSawStop: false, next: this.arrivals ? this.wait() : Infinity };
    this.posts.push(post);
    this.world.crowd.list.push(guard);
    return post;
  }

  offDuty(post) {
    post.onDuty = false;
    const list = this.world.crowd.list, i = list.indexOf(post.guard);
    if (i >= 0) list.splice(i, 1);
  }

  onDutyAgain(post) {
    post.onDuty = true;
    Object.assign(post.guard, { x: post.home[0], y: post.home[1], psi: post.heading + Math.PI, v: 0, paddle: "down" });
    post.phase = "idle"; post.paddleUp = false; post.t = REST_S;
    this.world.crowd.list.push(post.guard);
  }

  wait() { return KID_EVERY_S[0] + this.random() * (KID_EVERY_S[1] - KID_EVERY_S[0]); }

  // The street a post's crosswalk crosses, and where a point is across it ({ s, lateral }).
  across(post, x, y) {
    const e = this.world.map.edges.get(post.edge);
    return projectPoint(e.pts, e.cum, [x, y], null);
  }

  // Whether a person is on the roadway at a post: between its asphalt's edges, OFF_ROAD_M slack.
  onRoad(post, p) {
    const e = this.world.map.edges.get(post.edge), q = this.across(post, p.x, p.y);
    return !!q && Math.abs(q.s - post.s) < 8 && q.lateral > e.asphalt[0] - OFF_ROAD_M && q.lateral < e.asphalt[1] + OFF_ROAD_M;
  }

  // The guard and the children still on the roadway at a post.
  inRoad(post) { return [post.guard, ...post.kids].filter((p) => this.onRoad(post, p)); }

  // A group of `count` children at a post, coming from the sidewalk on `side`: already waiting at the
  // curb (`at` "curb"), or walking up from `from` metres along it. `held`: the guard waits for the post's
  // `held` to clear before looking for a gap (a challenge's trigger). Returns them.
  gather(post, { side = 1, count = 2, from = 0, dir = 1, random = this.random } = {}) {
    const e = this.world.map.edges.get(post.edge), L = e.length, walkLat = sidewalkOffset(e, side), out = [];
    for (let k = 0; k < count; k++) {
      const stagger = (k - (count - 1) / 2) * 0.7 + 0.5;
      const wait = offsetPoint(e, post.s + stagger, walkLat);
      const start = from > 0 ? offsetPoint(e, Math.max(1, Math.min(L - 1, post.s + dir * (from + k * 1.2))), walkLat) : wait;
      const id = `kid_g${post.id.slice(6)}_${++this.kids}`;
      const kid = new Pedestrian({ id, x: start[0], y: start[1], psi: headingAt(e.pts, e.cum, post.s) + (dir > 0 ? Math.PI : 0), v: 0,
        speed: KID_MPS[0] + random() * (KID_MPS[1] - KID_MPS[0]), path: [], crossing: null, waiting: 0, phase: 0, look: Math.floor(random() * 1e6),
        child: true, guard: post.id, side, stagger, wait, to: offsetPoint(e, post.s + stagger, sidewalkOffset(e, -side)), home: true });
      post.kids.push(kid);
      this.world.crowd.list.push(kid);
      out.push(kid);
    }
    return out;
  }

  // (free drive) A group walking up to a post along the sidewalk, put down where the driven car cannot
  // see them if it can be.
  arrive(post) {
    const random = this.random, side = random() < 0.5 ? 1 : -1, count = KIDS[0] + Math.floor(random() * (KIDS[1] - KIDS[0] + 1));
    const from = KID_FROM_M[0] + random() * (KID_FROM_M[1] - KID_FROM_M[0]);
    let dir = random() < 0.5 ? -1 : 1;
    const e = this.world.map.edges.get(post.edge), ego = this.world.ego, lat = sidewalkOffset(e, side);
    const seen = (d) => this.world.visibility.canSee(ego, ...offsetPoint(e, Math.max(1, Math.min(e.length - 1, post.s + d * from)), lat));
    if (seen(dir) && !seen(-dir)) dir = -dir;
    return this.gather(post, { side, count, from, dir, random });
  }

  // Children waiting at the curb (or nearly there).
  waiting(post) { return post.kids.filter((k) => !k.crossing && !k.across && Math.hypot(k.x - k.wait[0], k.y - k.wait[1]) < 0.3); }

  // Nothing coming either way too close to stop comfortably short of the crosswalk, and nothing on it.
  gap(post) {
    const world = this.world, cw = post.cw, decel = comfort().decel;
    for (const o of [world.ego, ...world.npcs]) {
      if (o.rail || o.parked || Math.abs(o.x - post.mid[0]) > GAP_LOOK_M || Math.abs(o.y - post.mid[1]) > GAP_LOOK_M) continue;
      const d = frontToCentre(cw, o);
      if (d === null) continue;
      const spec = o.spec, len = spec ? spec.length : 4.5;
      if (d < -len - 1.5) continue;            // gone by
      if (d < 2) return false;                 // on the crosswalk, or at its edge
      const v = Math.max(0, o.v), room = d - STOP_M;
      if (v > 0.5 && room < v * GAP_REACT_S + v * v / (2 * decel)) return false;
    }
    return true;
  }

  // One post's crossing: wait for children and a gap, out, across, back.
  control(post, dt) {
    post.t += dt;
    const g = post.guard;
    if (g.frozen > 0) { g.v = 0; return; }
    if (post.phase === "idle") {
      if (this.arrivals && !post.held && !post.kids.length && (post.next -= dt) <= 0) { this.arrive(post); post.next = this.wait(); }
      this.walkKidsToCurb(post, dt);
      if (!post.held && post.t >= REST_S && this.waiting(post).length && this.waiting(post).length === post.kids.filter((k) => !k.across).length && this.gap(post)) {
        post.phase = "out"; post.t = 0; post.paddleUp = true; post.stops++; g.paddle = "up";
        this.world.guardsSeen = true;
        post.calls.clear(); post.egoSawStop = false;
        // Capture the obligation now, before any driver reacts or accelerates. New arrivals are
        // remembered on first approach; a driver too close now stays exempt for this whole crossing.
        for (const o of [this.world.ego, ...this.world.npcs]) {
          const d = frontToCentre(post.cw, o);
          if (d !== null && d >= -2 && d <= GAP_LOOK_M) this.owes(post, o, d - STOP_M);
        }
      }
      return;
    }
    if (post.phase === "out") {
      this.walkKidsToCurb(post, dt);
      if (walk(g, post.mid, GUARD_MPS, dt)) {
        g.psi = post.heading + Math.PI;
        post.phase = "cross"; post.t = 0;
        for (const k of this.waiting(post)) k.crossing = { node: null, marked: post.cw.id, from: k.wait, to: k.to, guard: post.id };
      }
      return;
    }
    if (post.phase === "cross") {
      g.psi = post.heading + Math.PI; g.v = 0;
      for (const k of post.kids) {
        if (!k.crossing || k.frozen > 0) { if (k.frozen > 0) k.v = 0; continue; }
        if (walk(k, k.to, k.speed * 1.1, dt)) { k.crossing = null; k.across = true; }
      }
      // (once every child is off the roadway, the guard walks back; those across walk off home)
      for (const k of [...post.kids]) if (k.across && !this.onRoad(post, k)) this.release(post, k);
      if (!post.kids.some((k) => k.crossing) && !post.kids.some((k) => k.across) && !post.kids.some((k) => this.onRoad(post, k))) { post.phase = "back"; post.t = 0; }
      return;
    }
    if (post.phase === "back") {
      this.walkKidsToCurb(post, dt);
      if (walk(g, post.home, GUARD_MPS, dt)) {
        g.psi = post.heading + Math.PI; g.paddle = "down";
        post.phase = "idle"; post.t = 0; post.paddleUp = false;
      }
    }
  }

  // Children still on their way to the curb walk up to it.
  walkKidsToCurb(post, dt) {
    for (const k of post.kids) {
      if (k.crossing || k.across || k.frozen > 0) continue;
      // (waiting, facing across)
      if (walk(k, k.wait, k.speed, dt)) k.psi = Math.atan2(k.to[1] - k.y, k.to[0] - k.x);
    }
  }

  // A child across, off the roadway: the crowd takes over, and it walks off along the sidewalk, home.
  release(post, kid) {
    const e = this.world.map.edges.get(post.edge), L = e.length, lat = sidewalkOffset(e, -kid.side);
    const dir = (kid.look % 2) ? 1 : -1, len = HOME_WALK[0] + (kid.look % 1000) / 1000 * (HOME_WALK[1] - HOME_WALK[0]);
    const path = [];
    for (let u = 4; u <= len; u += 4) path.push({ p: offsetPoint(e, Math.max(1, Math.min(L - 1, post.s + kid.stagger + dir * u)), lat) });
    Object.assign(kid, { guard: null, crossing: null, across: false, path });
    post.kids.splice(post.kids.indexOf(kid), 1);
  }

  // Where a path (polyline with cumulative lengths) between sFrom and sTo crosses the crosswalk of a post
  // whose sign is up, or where anyone is still in the road: { post, s (the path's arc length at the
  // crosswalk's centre), key }, the nearest; or null.
  holdAhead(pts, cum, sFrom, sTo) {
    let best = null;
    for (const post of this.posts) {
      if (!post.onDuty || (!post.paddleUp && !this.inRoad(post).length)) continue;
      const hit = crossingOf(pts, cum, sFrom, sTo, post.cw);
      if (hit !== null && (!best || hit < best.s)) best = { post, s: hit, key: stopKey(post) };
    }
    return best;
  }

  // One immutable decision per vehicle per raising of the sign, shared by sensing, traffic and audit.
  owes(post, vehicle, toStop) {
    const id = vehicle === this.world.ego ? "ego" : vehicle.id;
    if (!post.calls.has(id)) post.calls.set(id, canStopFor(vehicle.v, toStop));
    return post.calls.get(id);
  }

  // What the HUD tells the driver of the car (see guardNotice).
  notice() { return guardNotice(this.world); }

  // The post at crosswalk `cwId` on duty, or null.
  at(cwId) { return this.posts.find((p) => p.onDuty && p.cw.id === cwId) || null; }
}

// Walk person `p` toward point `to` at `v`: true once there.
function walk(p, to, v, dt) {
  const dx = to[0] - p.x, dy = to[1] - p.y, d = Math.hypot(dx, dy);
  if (d <= v * dt) { p.x = to[0]; p.y = to[1]; p.v = 0; return true; }
  p.psi = Math.atan2(dy, dx);
  p.v = v;
  p.x += dx / d * v * dt; p.y += dy / d * v * dt;
  p.phase += v * dt;
  return false;
}

// How far vehicle `o`'s front is short of crosswalk `cw`'s centre line, along its heading (negative:
// past it), or null when it is not heading across it.
export function frontToCentre(cw, o) {
  const front = o.spec ? o.spec.length - o.spec.rearOverhang : 3.6, c = Math.cos(o.psi), s = Math.sin(o.psi);
  return distanceTo(cw, [o.x + c * front, o.y + s * front], c, s);
}

// The arc length where a polyline crosses crosswalk `cw` (sidewalk end to sidewalk end) between sFrom
// and sTo, or null.
export function crossingOf(pts, cum, sFrom, sTo, cw) {
  const a = cw.ends[1], b = cw.ends[-1];
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= sFrom) lo = m; else hi = m - 1; }
  for (let i = lo; i < pts.length - 1 && cum[i] <= sTo; i++) {
    const p = pts[i], q = pts[i + 1], rx = q[0] - p[0], ry = q[1] - p[1], sx = b[0] - a[0], sy = b[1] - a[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) continue;
    const wx = a[0] - p[0], wy = a[1] - p[1], t = (wx * sy - wy * sx) / den, u = (wx * ry - wy * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const at = cum[i] + t * (cum[i + 1] - cum[i]);
      if (at >= sFrom && at <= sTo) return at;
    }
  }
  return null;
}

// What the HUD tells the driver of the car about a crossing guard ahead on its way, once it can see
// the guard, within LOOK_M: the sign up, or children waiting at the curb. { key, text, stop }, or null.
export function guardNotice(world) {
  const g = world.crossingGuards;
  if (!g?.enabled || !g.posts.length) return null;
  const ego = world.ego;
  for (const post of g.posts) {
    if (!post.onDuty || Math.abs(post.mid[0] - ego.x) > LOOK_M + 10 || Math.abs(post.mid[1] - ego.y) > LOOK_M + 10) continue;
    const d = frontToCentre(post.cw, ego);
    if (d === null || d < -2 || d > LOOK_M || (!world.sees(ego, post.guard) && !(post.egoSawStop && post.paddleUp))) continue;
    if (post.paddleUp || g.inRoad(post).length) return { key: `${stopKey(post)}:up`, stop: true, text: "CROSSING GUARD · STOP · WAIT UNTIL EVERYONE IS ACROSS" };
    if (g.waiting(post).length) return { key: `${stopKey(post)}:ready`, stop: false, text: "SCHOOL CROSSING · CHILDREN WAITING · SLOW, READY TO STOP" };
  }
  return null;
}
