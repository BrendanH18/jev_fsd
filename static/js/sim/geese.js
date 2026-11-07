// Canada geese crossing the road (World option `geese`). Now and then, from its own random stream, by day
// and not in snow, a gaggle of GAGGLE geese (now and then two or three adults with their goslings) stands
// on the grass beside a street that runs beside or between a park or water (jev/osm/parks.py, the map's
// parks layer) near the driven car's way. As the car comes along, they set off across the street in a
// loose single file at a goose's walking pace (ADULT_MPS, GOSLING_MPS), the lead stopping at the kerb to
// look (LOOK_S) and stepping off only once nothing coming would have to brake hard for them; on the road
// one or another pauses now and then (PAUSE_RATE), and in some gaggles one stops in the road for a
// while (STOPPER_P, STOP_S), the ones behind it waiting in file. Once the last is off the roadway they
// wander on onto the grass. Geese are not in `world.npcs`: `world.obstaclesNear` adds them, small
// (GOOSE, GOSLING), so the forward sims see them and hitting one is a collision (World.audit: at fault
// when the car was moving, as for a pedestrian).
//
// Everyone stops for them and waits until the LAST goose is off the roadway: no squeezing through a gap
// between geese, and no creeping into the file. `geeseConflict` is the one test, shared by the driven
// car's sensing (`geeseCrossing`, `geese_crossing` in brain/sensors.js), the forward sims
// (brain/candidates.js `wait_for_geese` and the `drives_into_geese` rejection), traffic, cyclists too
// (`geeseYield`, sim/npc.js) and the lead goose's look at the kerb: the corridor the file walks along,
// from kerb to kerb, CORRIDOR_M either side of its line. While the gaggle walks up to the kerb ("coming")
// a driver whose way crosses the corridor slows to CAUTION_MPS by CAUTION_AT_M short of it; from the
// lead stepping off until the last goose is off the roadway ("crossing") a driver stops STOP_BACK_M short
// of it. The audit (`auditGeese`) counts moving faster than CRAWL_MPS within NEAR_M of a goose on the
// roadway, or hitting one, as `wildlife_conflicts`, once per gaggle each, reported only once a gaggle
// has crossed near the driven car (`World.geeseSeen`).
//
// With the option off nothing here is built, stepped or drawn from a random stream: no geese, and
// `world.obstaclesNear`, sensing and traffic see nothing new.

import { CAR, comfort } from "./vehicle.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { rng } from "../common.js";
import { obbOverlap } from "./collision.js";
import { GUTTER, CURB, streetOf } from "../map/streets.js";

// An adult Canada goose and a gosling, as obstacles (beak to tail, across the body).
export const GOOSE = { kind: "goose", length: 0.9, width: 0.4, rearOverhang: 0.45 };
export const GOSLING = { kind: "goose", length: 0.45, width: 0.25, rearOverhang: 0.22 };
// Free drives: one gaggle at a time, the first FIRST_S in, then NEXT_S after the last; at a crossing
// place AHEAD_M along the car's route, setting off once the car's front is TRIGGER_M short of it.
export const FIRST_S = [20, 45];
export const NEXT_S = [50, 120];
export const AHEAD_M = [100, 190];
export const TRIGGER_M = [50, 80];
const RETIRE_M = 200;
const GIVE_UP_S = 120;
// A crossing place: this far from either end of its street's edge, a stop line or a crosswalk.
export const SITE_END_M = 15;
const SITE_CONTROL_M = 20;
const SITE_CROSSWALK_M = 12;
// The gaggle: 4 to 9 geese; GOSLINGS_P of the time two or three adults with their goslings.
export const GAGGLE = [4, 9];
export const GOSLINGS_P = 0.45;
// Walking, in single file: each at its own pace, keeping its spacing to the one ahead, wandering this far
// either side of the file's line.
export const ADULT_MPS = [0.5, 0.8];
export const GOSLING_MPS = [0.4, 0.65];
const ADULT_SPACING_M = [1.0, 1.6];
const GOSLING_SPACING_M = [0.6, 1.0];
const JITTER_M = 0.3;
// On the road, one or another stops for a moment now and then; in STOPPER_P of the gaggles one stops in
// the road for a while.
export const PAUSE_RATE = 0.05;
const PAUSE_S = [0.8, 2.5];
export const STOPPER_P = 0.35;
export const STOP_S = [4, 9];
// The lead stops this far short of the kerb to look, for LOOK_S, and steps off once nothing coming
// would need more than LOOK_DECEL to stop short of the file, after LOOK_REACT_S to react.
export const LOOK_S = 1.0;
const KERB_M = 0.4;
const LOOK_DECEL = 2.5;
const LOOK_REACT_S = 0.8;
// They stand this far onto the grass beyond the sidewalk, and wander on this far beyond the far one.
const VERGE_M = 1.0;
const WANDER_M = 4.0;
// The corridor others keep out of: kerb to kerb, CORRIDOR_M either side of the file's line (its
// wander, a goose's body and a little room).
export const CORRIDOR_M = 1.3;
const CORRIDOR_PAD_M = 0.5;
// A goose this far past the kerb face is off the roadway.
export const OFF_M = 0.3;
// Others: while they come up to the kerb, slow to CAUTION_MPS by CAUTION_AT_M short of them; while they
// cross, stop STOP_BACK_M short of the corridor.
export const CAUTION_MPS = 4.0;
export const CAUTION_AT_M = 8;
export const STOP_BACK_M = 2.0;
const LOOK_AHEAD_M = 70;
// The audit: moving faster than this within NEAR_M of a goose on the roadway.
export const CRAWL_MPS = 0.8;
export const NEAR_M = 2.0;
const SEEN_M = 60;

export const isGoose = (o) => !!o?.goose;

export class Goose {
  constructor(props) { Object.assign(this, props); this.kind = "goose"; this.goose = true; this.a = 0; this.frozen = 0; }
  get center() { return [this.x, this.y]; }
  obb() { return { center: [this.x, this.y], heading: this.psi, halfLength: this.spec.length / 2, halfWidth: this.spec.width / 2 }; }
  toLocal(px, py) {
    const dx = px - this.x, dy = py - this.y, c = Math.cos(this.psi), s = Math.sin(this.psi);
    return { ahead: dx * c + dy * s, right: dx * s - dy * c };
  }
}

// The way a gaggle crosses edge `edgeId` at `s` (metres along its centreline, the pack's), from its side
// `sigma` (+1 right of travel, -1 left) to the other, `tilt` radians off straight across: the file's line
// (from A, along d, at arc length u: A is on the grass VERGE_M beyond the sidewalk), where it meets the
// roadway (`uIn`, `uOut`: the kerb faces) and where it ends on the far side (`uEnd`).
export function crossingGeometry(map, edgeId, s, sigma, tilt = 0) {
  const e = map.edges.get(edgeId);
  if (!e) return null;
  const sScaled = Math.max(0, Math.min(e.length, s)) * e.cum[e.cum.length - 1] / Math.max(1e-6, e.length);
  const q = pointAt(e.pts, e.cum, sScaled), h = headingAt(e.pts, e.cum, sScaled);
  const nR = [Math.sin(h), -Math.cos(h)], t = [Math.cos(h), Math.sin(h)];
  const base = [-nR[0] * sigma, -nR[1] * sigma], c = Math.cos(tilt), sn = Math.sin(tilt);
  const d = [base[0] * c + t[0] * sn, base[1] * c + t[1] * sn];
  const asphalt = e.asphalt || [-(e.width || 6) / 2, (e.width || 6) / 2];
  const roadR = asphalt[1] + GUTTER, roadL = -asphalt[0] + GUTTER;
  const roadFrom = sigma > 0 ? roadR : roadL, roadTo = sigma > 0 ? roadL : roadR;
  const [blvd, walk] = streetOf(e);
  const verge = CURB + blvd + walk + VERGE_M;
  const out = roadFrom + verge;
  const A = [q[0] + nR[0] * sigma * out, q[1] + nR[1] * sigma * out];
  const uIn = (out - roadFrom) / c, uOut = (out + roadTo) / c, uEnd = (out + roadTo + verge + WANDER_M) / c;
  const at = (u) => [A[0] + d[0] * u, A[1] + d[1] * u];
  const p0 = at(uIn - CORRIDOR_PAD_M), p1 = at(uOut + CORRIDOR_PAD_M);
  return { e, edge: e.id, s, sigma, tilt, q, h, A, d, uIn, uOut, uEnd, p0, p1, mid: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], heading: Math.atan2(d[1], d[0]) };
}

// Distance from p to segment ab.
function toSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * u, p[1] - a[1] - dy * u);
}

// What a gaggle asks of others now: "coming" (walking up to the kerb, or looking: slow), "crossing" (from
// the lead stepping off until the last is off the roadway: stop), or null.
export function gaggleClaim(g) {
  if (g.phase === "coming" || g.phase === "look") return "coming";
  if (g.phase === "crossing") return "crossing";
  return null;
}

// The conflict between a vehicle going along `line` ({ pts, cum }: its route or path; its front at arc
// length `front`, its centre `lat` metres right of the line) and gaggle `g`: the first arc length within
// `look` metres where its body would come within reach of the corridor (`at`, for its front), and what
// that asks of it (`kind`; `claim` overrides the gaggle's own); or null.
export function geeseConflict(g, line, { front, spec = CAR, lat = 0, look = LOOK_AHEAD_M, claim = null }) {
  const kind = claim || gaggleClaim(g);
  if (!kind) return null;
  const { pts, cum } = line, L = cum[cum.length - 1], geo = g.geo;
  const reach = spec.width / 2 + CORRIDOR_M;
  const far = Math.hypot(geo.p1[0] - geo.p0[0], geo.p1[1] - geo.p0[1]) / 2 + reach + 2;
  for (let s = Math.max(0, front - spec.length); s <= Math.min(L, front + look); s += 0.5) {
    const p = pointAt(pts, cum, s);
    if (Math.abs(p[0] - geo.mid[0]) > far || Math.abs(p[1] - geo.mid[1]) > far) continue;
    const h = lat ? headingAt(pts, cum, s) : 0, q = lat ? [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat] : p;
    if (toSegment(q, geo.p0, geo.p1) < reach) return { at: s, gap_m: s - front, kind };
  }
  return null;
}

// How fast a driver `gap` metres short of the corridor goes while the gaggle comes up to the kerb:
// slowing gently to CAUTION_MPS by CAUTION_AT_M short of it.
export function cautionSpeed(gap) {
  return Math.sqrt(CAUTION_MPS * CAUTION_MPS + 2 * 0.6 * comfort().decel * Math.max(0, gap - CAUTION_AT_M));
}

// Whether goose `o` of gaggle `g` stands on the roadway (between the kerb faces, OFF_M either side).
export function onRoadway(g, o) { return o.u > g.geo.uIn - OFF_M && o.u < g.geo.uOut + OFF_M; }

export class Geese {
  constructor(world, { enabled = false, seed = 1 } = {}) {
    this.world = world;
    this.enabled = !!enabled && !!world.map.parkSpans?.length;
    this.gaggles = [];
    this.made = 0;
    this.target = this.enabled ? 1 : 0;
    // (their own stream, drawn from only while the option is on)
    this.random = this.enabled ? rng(seed * 2654435761 + 97) : null;
    this.next = this.enabled ? FIRST_S[0] + this.random() * (FIRST_S[1] - FIRST_S[0]) : Infinity;
  }

  // Every goose of every gaggle.
  get list() { return this.gaggles.flatMap((g) => g.geese); }

  near(x, y, r) {
    if (!this.gaggles.length) return [];
    const out = [];
    for (const g of this.gaggles) {
      if (Math.abs(g.geo.mid[0] - x) > r + 30 || Math.abs(g.geo.mid[1] - y) > r + 30) continue;
      for (const o of g.geese) if (Math.abs(o.x - x) < r + 1 && Math.abs(o.y - y) < r + 1) out.push(o);
    }
    return out;
  }

  // By day, and not in snow.
  inSeason() {
    const world = this.world;
    if (world.weather === "snow") return false;
    return world.clock ? (world.clock.sun_deg ?? 10) > 0 : world.visibility.night < 0.5;
  }

  // A gaggle of `geese` ([{ gosling, pace, spacing, stopFor, stopAt }], lead first: see `makeGaggle`)
  // crossing edge `edge` at `s` from side `sigma`, setting off once the driven car's front is `trigger`
  // metres short of it along `routeS` (its route arc length), or at once with trigger null. Returns it,
  // or null.
  place({ edge, s, sigma, tilt = 0 }, geese, { trigger = null, routeS = null, id = null, keep = false } = {}) {
    const geo = crossingGeometry(this.world.map, edge, s, sigma, tilt);
    if (!geo) return null;
    this.made++;
    const gid = id || `gaggle_${this.made}`;
    const g = { id: gid, geo, phase: trigger === null ? "coming" : "waiting", trigger, routeS, keep, since: this.world.t, waited: 0, seen: false, geese: [] };
    let u = -0.6;
    geese.forEach((spec, i) => {
      if (i) u -= spec.spacing;
      const o = new Goose({ id: `${gid}_${spec.gosling ? "gosling" : "goose"}_${i + 1}`, gaggle: gid, gosling: !!spec.gosling, spec: spec.gosling ? GOSLING : GOOSE,
        u, x: 0, y: 0, psi: geo.heading, v: 0, pace: spec.pace, spacing: spec.spacing, jitter: spec.jitter ?? 0, wobble: spec.wobble ?? 0,
        pause: 0, stopFor: spec.stopFor ?? 0, stopAt: spec.stopAt ?? null, stopped: false, graze: spec.graze ?? 0 });
      this.pose(g, o);
      // (grazing on the grass, before they set off: facing this way and that)
      if (g.phase === "waiting") o.psi = geo.heading + (o.graze - 0.5) * 2.4;
      g.geese.push(o);
    });
    // (where the lead stops on the far side: far enough for the last of the file, at its spacing, to be
    // off the roadway)
    g.uEnd = Math.max(geo.uEnd, geo.uOut + OFF_M + 0.5 + (g.geese[0].u - g.geese[g.geese.length - 1].u));
    this.gaggles.push(g);
    return g;
  }

  // A gaggle's make-up, from the stream: GAGGLE geese, adults first and last with goslings between them
  // GOSLINGS_P of the time; and, STOPPER_P of the time, one that stops for a while in the road.
  makeGaggle(geo) {
    const r = this.random, n = GAGGLE[0] + Math.floor(r() * (GAGGLE[1] - GAGGLE[0] + 1));
    const young = r() < GOSLINGS_P, adults = young ? 2 + Math.floor(r() * 2) : n;
    const out = [];
    for (let i = 0; i < n; i++) {
      // (with goslings: an adult leads and one brings up the rear; any third walks in the middle)
      const gosling = young && !(i === 0 || i === n - 1 || (adults > 2 && i === Math.floor(n / 2)));
      const [p0, p1] = gosling ? GOSLING_MPS : ADULT_MPS, [s0, s1] = gosling ? GOSLING_SPACING_M : ADULT_SPACING_M;
      out.push({ gosling, pace: p0 + r() * (p1 - p0), spacing: s0 + r() * (s1 - s0), jitter: (r() * 2 - 1) * JITTER_M, wobble: r() * 6.28, graze: r() });
    }
    if (r() < STOPPER_P) {
      const k = 1 + Math.floor(r() * (n - 1));
      out[k].stopFor = STOP_S[0] + r() * (STOP_S[1] - STOP_S[0]);
      out[k].stopAt = geo.uIn + 1 + r() * Math.max(0.5, geo.uOut - geo.uIn - 2);
    }
    return out;
  }

  // Where goose `o` stands, from its arc length along the file's line.
  pose(g, o) {
    const geo = g.geo, side = o.jitter + 0.12 * Math.sin(o.u * 1.7 + o.wobble);
    const nx = -geo.d[1], ny = geo.d[0];
    o.x = geo.A[0] + geo.d[0] * o.u + nx * side;
    o.y = geo.A[1] + geo.d[1] * o.u + ny * side;
    // (heading along the line, swaying with the wander)
    o.psi = geo.heading + 0.2 * Math.cos(o.u * 1.7 + o.wobble);
  }

  // Free drives: a crossing place beside a park or water along the car's route, AHEAD_M along it, by day
  // and not in snow. Returns the gaggle, or null.
  spawn() {
    const world = this.world, route = world.route, map = world.map, ego = world.ego;
    if (!route || route.length < 60 || !this.inSeason()) return null;
    const p = route.project(ego.x, ego.y, route.hint ?? 0);
    if (!p) return null;
    const front = p.s + ego.spec.length - ego.spec.rearOverhang;
    const options = [];
    for (let i = 0; i < route.edges.length; i++) {
      const start = route.edgeStarts[i];
      if (start > front + AHEAD_M[1]) break;
      const id = route.edges[i], e = map.edges.get(id);
      if (!e) continue;
      for (const sp of map.parkSpans) {
        if (sp.edge !== id) continue;
        for (let s = Math.max(sp.from, SITE_END_M) + 2; s <= Math.min(sp.to, e.length - SITE_END_M) - 2; s += 6) {
          if (!this.goodSite(e, s)) continue;
          const geo = crossingGeometry(map, id, s, 1);
          const q = route.project(geo.q[0], geo.q[1], p.index);
          if (!q || q.distance > 8 || q.s - front < AHEAD_M[0] || q.s - front > AHEAD_M[1]) continue;
          options.push({ sp, e, s, routeS: q.s });
        }
      }
    }
    if (!options.length) return null;
    const pick = options[Math.floor(this.random() * options.length)];
    // (from the park's or the water's side; from either when the street runs between two)
    const sides = [pick.sp.right ? 1 : null, pick.sp.left ? -1 : null].filter((x) => x !== null);
    const sigma = sides[Math.floor(this.random() * sides.length)];
    const tilt = (this.random() * 2 - 1) * 0.25;
    const geo = crossingGeometry(map, pick.e.id, pick.s, sigma, tilt);
    return this.place({ edge: pick.e.id, s: pick.s, sigma, tilt }, this.makeGaggle(geo),
      { trigger: TRIGGER_M[0] + this.random() * (TRIGGER_M[1] - TRIGGER_M[0]), routeS: pick.routeS });
  }

  // Away from the street's ends, its stop line and its crosswalks.
  goodSite(e, s) {
    if (s < SITE_END_M || s > e.length - SITE_END_M) return false;
    if (e.control && Math.abs((e.control.s_line ?? e.length) - s) < SITE_CONTROL_M) return false;
    for (const c of this.world.map.crosswalks || []) if (c.edge === e.id && Math.abs(c.s - s) < SITE_CROSSWALK_M) return false;
    return true;
  }

  step(dt) {
    if (!this.enabled) return;
    const world = this.world, ego = world.ego;
    for (const g of [...this.gaggles]) {
      const far = Math.hypot(g.geo.mid[0] - ego.x, g.geo.mid[1] - ego.y) > RETIRE_M;
      // (a gaggle still grazing that the car has gone by, or never came near, stays where it is; a
      // challenge's waits for the car however long it takes to come along: `keep`)
      const passed = g.phase === "waiting" && (far || (!g.keep && world.t - g.since > GIVE_UP_S) || this.egoFrontS(g) > g.routeS + 5);
      if (passed || (far && g.phase !== "waiting")) this.retire(g);
    }
    if (this.gaggles.length < this.target && world.t >= this.next) {
      if (!this.spawn()) this.next = world.t + 5;
    }
    for (const g of this.gaggles) this.walk(g, dt);
  }

  retire(g) {
    const i = this.gaggles.indexOf(g);
    if (i >= 0) this.gaggles.splice(i, 1);
    if (this.random) this.next = Math.max(this.next, this.world.t + NEXT_S[0] + this.random() * (NEXT_S[1] - NEXT_S[0]));
  }

  // The driven car's front along its route (-Infinity without one).
  egoFrontS(g) {
    const route = this.world.route, ego = this.world.ego;
    if (!route || g.routeS === null) return -Infinity;
    const p = route.project(ego.x, ego.y, route.hint ?? 0);
    return p ? p.s + ego.spec.length - ego.spec.rearOverhang : -Infinity;
  }

  // Whether the lead can step off: nothing coming whose way crosses the file would have to brake harder
  // than LOOK_DECEL, after LOOK_REACT_S, to stop short of it, and nothing stands in the corridor.
  roadClear(g) {
    const world = this.world, geo = g.geo, [mx, my] = geo.mid;
    const vehicles = [world.ego, ...world.npcs];
    for (const o of vehicles) {
      if (o.parked || Math.abs(o.x - mx) > 100 || Math.abs(o.y - my) > 100) continue;
      const spec = o.spec || CAR, fr = spec.length - spec.rearOverhang;
      let line = null, front = 0;
      if (o === world.ego) {
        const route = world.route, p = route ? route.project(o.x, o.y, route.hint ?? 0) : null;
        if (p && p.distance < 4) { line = route; front = p.s + fr; }
      } else if (o.path?.pts?.length > 1 && Number.isFinite(o.path.s)) { line = o.path; front = o.path.s + fr; }
      const box = o.obb();
      // (anything standing in the corridor, or about to be)
      if (toSegment(box.center, geo.p0, geo.p1) < CORRIDOR_M + box.halfLength + 0.5) return false;
      if (!line) {
        // (off its route: straight on the way it faces)
        const ahead = (mx - o.x) * Math.cos(o.psi) + (my - o.y) * Math.sin(o.psi);
        const side = Math.abs(-(mx - o.x) * Math.sin(o.psi) + (my - o.y) * Math.cos(o.psi));
        if (ahead > 0 && side < 8 && ahead - fr < Math.max(0, o.v) * LOOK_REACT_S + o.v * o.v / (2 * LOOK_DECEL) + 3) return false;
        continue;
      }
      const c = geeseConflict(g, line, { front, spec, look: 90, claim: "crossing" });
      if (!c) continue;
      const v = Math.max(0, o.v);
      if (c.gap_m < v * LOOK_REACT_S + v * v / (2 * LOOK_DECEL) + STOP_BACK_M + 1) return false;
    }
    for (const o of [...(world.contraflow?.riders || []), ...(world.driveways?.cars || [])]) {
      if (toSegment([o.x, o.y], geo.p0, geo.p1) < CORRIDOR_M + 6) return false;
    }
    return true;
  }

  // Whether something stands, or is about to be, in goose `o`'s way.
  blocked(o) {
    const world = this.world, b = o.obb(), reach = 0.5;
    const ahead = { ...b, center: [b.center[0] + Math.cos(o.psi) * reach, b.center[1] + Math.sin(o.psi) * reach] };
    for (const v of [world.ego, ...world.npcs, ...(world.contraflow?.riders || []), ...(world.driveways?.cars || [])]) {
      if (Math.abs(v.x - o.x) > 12 || Math.abs(v.y - o.y) > 12) continue;
      if (obbOverlap(ahead, v.obb(), 0.25)) return true;
    }
    return false;
  }

  walk(g, dt) {
    const world = this.world, geo = g.geo, r = this.random;
    const lead = g.geese[0], last = g.geese[g.geese.length - 1];
    if (g.phase === "waiting") {
      if (this.egoFrontS(g) >= g.routeS - g.trigger) g.phase = "coming";
      else return;
    }
    if (Math.hypot(geo.mid[0] - world.ego.x, geo.mid[1] - world.ego.y) < SEEN_M && gaggleClaim(g) === "crossing") { world.geeseSeen = true; g.seen = true; }
    // (the lead at the kerb: look, then step off once the way is clear)
    if (g.phase === "coming" && lead.u >= geo.uIn - KERB_M - 0.05) { g.phase = "look"; g.waited = 0; }
    if (g.phase === "look") {
      g.waited += dt;
      if (g.waited >= LOOK_S && this.roadClear(g)) g.phase = "crossing";
    }
    if (g.phase === "crossing" && last.u > geo.uOut + OFF_M) g.phase = "across";
    for (let i = 0; i < g.geese.length; i++) {
      const o = g.geese[i];
      if (o.frozen > 0) { o.frozen -= dt; o.v = 0; continue; }
      let vt = o.pace;
      // (the lead waits at the kerb until it steps off)
      if (i === 0 && (g.phase === "coming" || g.phase === "look")) vt = Math.min(vt, Math.max(0, (geo.uIn - KERB_M - o.u) * 1.5));
      // (in file: no closer than its spacing to the one ahead)
      if (i > 0) vt = Math.min(vt, Math.max(0, (g.geese[i - 1].u - o.u - o.spacing) * 1.5));
      // (on the far grass, they slow and stop to graze)
      if (o.u >= g.uEnd) vt = 0;
      else if (o.u > geo.uOut + 1) vt = Math.min(vt, Math.max(0.15, (g.uEnd - o.u) * 0.5));
      const road = onRoadway(g, o);
      if (g.phase === "crossing" && o.stopAt !== null && !o.stopped && o.u >= o.stopAt) { o.stopped = true; o.pause = Math.max(o.pause, o.stopFor); }
      else if (g.phase === "crossing" && road && o.pause <= 0 && r && r() < PAUSE_RATE * dt) o.pause = PAUSE_S[0] + r() * (PAUSE_S[1] - PAUSE_S[0]);
      if (o.pause > 0) { o.pause -= dt; vt = 0; }
      if (vt > 0 && this.blocked(o)) vt = 0;
      // (a goose gets going and stops within a step or two)
      o.v = o.v + Math.max(-2 * dt, Math.min(1.5 * dt, vt - o.v));
      if (o.v < 0.01 && vt === 0) o.v = 0;
      o.u += o.v * dt;
      this.pose(g, o);
    }
  }
}

// What a driver going along `line` does about the geese near it: { at, gap_m, hold (arc length its front
// must stop at, while they cross), limit (its speed ceiling, slowing gently toward them), gaggle, kind }
// for the first gaggle that asks something of it, or null. `seen(g)`: whether it can see that gaggle (the driven car); traffic sees what is there.
export function geeseAhead(world, line, { front, spec, lat = 0, seen = () => true, x, y }) {
  const gaggles = world.geese?.gaggles;
  if (!gaggles?.length) return null;
  let out = null;
  for (const g of gaggles) {
    if (!gaggleClaim(g) || Math.abs(g.geo.mid[0] - x) > LOOK_AHEAD_M + 25 || Math.abs(g.geo.mid[1] - y) > LOOK_AHEAD_M + 25 || !seen(g)) continue;
    const c = geeseConflict(g, line, { front, spec, lat });
    if (!c) continue;
    const hold = c.kind === "crossing" ? c.at - STOP_BACK_M : null;
    // (coming up to them, slowing gently either way: a driver who must stop for them stops from that)
    const limit = cautionSpeed(c.gap_m);
    if (!out || c.at < out.at) out = { at: c.at, gap_m: c.gap_m, hold, limit, gaggle: g, kind: c.kind };
  }
  return out;
}

// Traffic, cyclists too (sim/npc.js): where driver `n` stops for a gaggle crossing (arc length along its
// path for its front, or null), and its speed ceiling while one comes up to the kerb ahead.
export function geeseYield(world, n, front) {
  if (n.kind === "train" || !n.path?.pts?.length) return null;
  return geeseAhead(world, n.path, { front, spec: n.spec || CAR, x: n.x, y: n.y });
}

// Whether the driven car can see any goose of gaggle `g`.
export const seesGaggle = (world, observer, g) => g.geese.some((o) => world.sees(observer, o));

// The driven car's sensing (brain/sensors.js `geese_crossing`): the gaggle it must stop or slow for
// first, as far as it can see. `wait`: stop with the front at `stop_s_route` (route arc length) until
// the last goose is off the roadway; otherwise slow to `limit_mps`. Or null.
export function geeseCrossing(world, p, frontS, lane) {
  const { ego, route } = world;
  const c = geeseAhead(world, route, { front: frontS, spec: ego.spec, lat: lane?.center || 0, seen: (g) => seesGaggle(world, ego, g), x: ego.x, y: ego.y });
  if (!c) return null;
  const g = c.gaggle, crossing = c.kind === "crossing", wait = crossing && c.hold > frontS - 1;
  const stopS = wait ? Math.max(c.hold, frontS) : null;
  const road = g.geese.filter((o) => onRoadway(g, o));
  // (the side they come from, as the car sees it: they walk from its right when their way runs to its left)
  const h = route.headingAt(Math.min(route.length, Math.max(0, c.at)));
  const from = Math.cos(h) * g.geo.d[1] - Math.sin(h) * g.geo.d[0] > 0 ? "right" : "left";
  return { id: g.id, geese: g.geese.length, goslings: g.geese.filter((o) => o.gosling).length, from,
    phase: !crossing ? "about_to_cross" : road.some((o) => o.v < 0.05) ? "stopped_in_road" : "crossing",
    on_road: road.length, stopped_on_road: road.filter((o) => o.v < 0.05).length, gap_m: Math.max(0, c.gap_m), wait,
    stop_s_route: stopS, bumper_to_stop_m: wait ? stopS - frontS : null, limit_mps: crossing && !wait ? CAUTION_MPS / 2 : c.limit };
}

// The audit (World.audit): a gaggle crossing near the driven car (`World.geeseSeen`, set as they walk);
// moving faster than CRAWL_MPS within NEAR_M of a goose on the roadway, and hitting one. Both are
// `wildlife_conflicts`, once per gaggle each.
export function auditGeese(world) {
  const gaggles = world.geese?.gaggles;
  if (!gaggles?.length) return;
  const ego = world.ego, calls = world.geeseCalls ||= new Map(), egoBox = ego.obb();
  const count = (ev) => { world.violations.wildlife_conflicts = (world.violations.wildlife_conflicts || 0) + 1; world.events.push(ev); };
  for (const g of gaggles) {
    if (Math.abs(g.geo.mid[0] - ego.x) > 30 || Math.abs(g.geo.mid[1] - ego.y) > 30) continue;
    const call = calls.get(g.id) || { close: false, hit: false };
    calls.set(g.id, call);
    for (const o of g.geese) {
      const box = o.obb();
      if (!call.hit && obbOverlap(egoBox, box)) {
        call.hit = true;
        count({ type: "wildlife_conflict", with: o.id, gaggle: g.id, reason: "hit", speed_mps: Math.round(Math.abs(ego.v) * 10) / 10 });
      }
      if (!call.close && onRoadway(g, o) && Math.abs(ego.v) > CRAWL_MPS && gapTo(egoBox, box) < NEAR_M) {
        call.close = true;
        count({ type: "wildlife_conflict", with: o.id, gaggle: g.id, reason: "too_close", speed_mps: Math.round(Math.abs(ego.v) * 10) / 10, clearance_m: Math.round(gapTo(egoBox, box) * 100) / 100 });
      }
    }
  }
}

// The gap between two boxes (0 when they touch): by their corners, near enough for small bodies.
function gapTo(a, b) {
  if (obbOverlap(a, b)) return 0;
  const corners = (x) => {
    const c = Math.cos(x.heading), s = Math.sin(x.heading);
    return [[1, 1], [1, -1], [-1, -1], [-1, 1], [0, 0]].map(([p, q]) => [x.center[0] + p * x.halfLength * c - q * x.halfWidth * s, x.center[1] + p * x.halfLength * s + q * x.halfWidth * c]);
  };
  const toBox = (p, x) => {
    const c = Math.cos(x.heading), s = Math.sin(x.heading), dx = p[0] - x.center[0], dy = p[1] - x.center[1];
    return Math.hypot(Math.max(0, Math.abs(dx * c + dy * s) - x.halfLength), Math.max(0, Math.abs(-dx * s + dy * c) - x.halfWidth));
  };
  return Math.min(...corners(a).map((p) => toBox(p, b)), ...corners(b).map((p) => toBox(p, a)));
}

// What the HUD says about geese ahead, or null: from the autopilot's sensing, or, driving by hand, a
// gaggle the car can see coming up to or crossing the street within LOOK_AHEAD_M ahead.
export function geeseNotice(snap, world = null) {
  let c = snap?.geese_crossing;
  if (!c && world && !snap) {
    const ego = world.ego;
    const g = world.geese?.gaggles.find((x) => gaggleClaim(x) && ego.toLocal(...x.geo.mid).ahead > 0 && Math.hypot(x.geo.mid[0] - ego.x, x.geo.mid[1] - ego.y) < LOOK_AHEAD_M && seesGaggle(world, ego, x));
    if (g) c = { id: g.id, wait: gaggleClaim(g) === "crossing" };
  }
  if (!c) return null;
  if (c.wait) return { key: `${c.id}:wait`, text: "GEESE CROSSING · WAIT FOR THE LAST ONE", wait: true };
  return { key: `${c.id}:slow`, text: "GEESE BY THE ROAD AHEAD", wait: false };
}
