// Pedestrians: they walk the sidewalks, turn corners, and cross streets at intersections, and every
// driver (the ego and the traffic) must yield to one in a crosswalk it is about to drive through.
//
// Where they may cross: at the corners of junctions, along the line of the cross street's sidewalk
// (a marked crosswalk at signals, an unmarked one elsewhere, as BC law has it). When: at a signal,
// only in the walk phase, which runs with the parallel traffic's green; elsewhere, when no
// approaching vehicle would reach the crosswalk within a few seconds. Nobody crosses at a
// roundabout.
//
// On quiet residential blocks some people cut straight across mid-block instead, once they have
// looked both ways and nothing is coming for a good while. Legally they must yield to traffic
// there, but drivers still have to avoid them. And someone on the road who sees a car coming that
// is not stopping for them reacts: in its path, they hurry out of it; beside it, they wait.

import { pointAt, headingAt } from "../map/mapdata.js";
import { sidewalkOffset } from "../map/streets.js";
import { pedPhase } from "./signals.js";
import { rng } from "../common.js";

export const PEDESTRIANS = 60;
export const PED = { kind: "pedestrian", length: 0.5, width: 0.6, rearOverhang: 0.25 };   // footprint for collisions

class Pedestrian {
  constructor(props) { Object.assign(this, props); this.spec = PED; this.kind = "pedestrian"; this.a = 0; this.frozen = 0; }
  get center() { return [this.x, this.y]; }
  obb() { return { center: [this.x, this.y], heading: this.psi, halfLength: PED.length / 2, halfWidth: PED.width / 2 }; }
  toLocal(px, py) {
    const dx = px - this.x, dy = py - this.y, c = Math.cos(this.psi), s = Math.sin(this.psi);
    return { ahead: dx * c + dy * s, right: dx * s - dy * c };
  }
}
const CROSS_BEYOND_CURB_M = 1.6;   // crosswalk center past the cross street's asphalt edge
const GAP_S = 5;                   // an approaching vehicle closer than this in time blocks a crossing
const JAYWALK_GAP_S = 8;           // a mid-block crossing waits for a longer gap
const JAYWALK_P = 0.14;            // chance a walk along a quiet block ends up crossing mid-block
const QUIET = new Set(["residential", "unclassified", "living_street"]);
const YIELD_AHEAD_M = 3.0;         // a pedestrian still this far short of the car's path counts

export class Crowd {
  constructor(world, { count = PEDESTRIANS, seed = 1 } = {}) {
    this.world = world;
    this.map = world.map;
    this.random = rng(seed * 31337 + 11);
    this.habits = rng(seed * 4099 + 29);   // walking speeds and jaywalking, apart from the routes
    this.list = [];
    this.build();
    if (this.legsAt.size) this.spawn(count);
  }

  // Streets (a two-way street is two edges) and, per junction node, the legs meeting there with the
  // point where each leg's crosswalk meets each of its sidewalks.
  build() {
    const map = this.map;
    const streets = new Map();
    for (const e of map.edges.values()) {
      if (e.ring) continue;
      const key = [e.from, e.to].sort().join("|") + "|" + Math.round(e.length);
      if (!streets.has(key)) streets.set(key, { id: key, edge: e });
    }
    this.streets = [...streets.values()];
    const legs = new Map();
    for (const st of this.streets) {
      for (const [node, out] of [[st.edge.from, true], [st.edge.to, false]]) {
        if (!legs.has(node)) legs.set(node, []);
        legs.get(node).push({ st, out });
      }
    }
    this.ringNodes = new Set();
    for (const rb of (map.roundabouts || new Map()).values()) for (const v of rb.vertices) this.ringNodes.add(v);
    this.legsAt = new Map();
    for (const [node, list] of legs) {
      if (this.ringNodes.has(node)) continue;
      // how far out the crosswalks sit: past the widest street's asphalt at this node
      let half = 0;
      for (const l of list) half = Math.max(half, Math.abs(l.st.edge.asphalt[0]), Math.abs(l.st.edge.asphalt[1]));
      const inter = [...map.intersections.values()].find((i) => i.vertices && i.vertices.includes(node)) || null;
      for (const l of list) {
        const e = l.st.edge, L = e.cum[e.cum.length - 1];
        const d = Math.min(L / 2, list.length >= 3 ? half + CROSS_BEYOND_CURB_M : 0.5);
        l.s = l.out ? d : L - d;                 // position along the base edge
        l.ends = {};
        for (const side of [1, -1]) l.ends[side] = offsetPoint(e, l.s, sidewalkOffset(e, side));
        l.group = inter ? groupOf(inter, headingAt(e.pts, e.cum, l.s)) : null;
      }
      this.legsAt.set(node, { list, inter, junction: list.length >= 3 });
    }
  }

  spawn(count) {
    const total = this.streets.reduce((a, st) => a + st.edge.length, 0);
    for (let k = 0, attempts = 0; k < count && attempts < count * 10; attempts++) {
      let pick = this.random() * total, st = this.streets[0];
      for (const x of this.streets) { pick -= x.edge.length; if (pick <= 0) { st = x; break; } }
      const e = st.edge;
      if (!this.legsAt.has(e.from) || !this.legsAt.has(e.to)) continue;
      const side = this.random() < 0.5 ? 1 : -1;
      const dir = this.random() < 0.5 ? 1 : -1;
      const a = this.leg(e.from, st).s, b = this.leg(e.to, st).s;
      if (b - a < 4) continue;
      const s = a + this.random() * (b - a);
      const p = offsetPoint(e, s, sidewalkOffset(e, side));
      const ped = new Pedestrian({
        id: `ped_${++k}`, x: p[0], y: p[1], psi: 0, v: 0,
        speed: 1.1 + this.random() * 0.5, path: [], crossing: null, waiting: 0, phase: this.random() * 6,
        look: Math.floor(this.random() * 1e6),
      });
      if (this.habits() < 0.12) ped.speed = 0.75 + this.habits() * 0.25;   // older or unhurried
      this.walkAlong(ped, st, side, s, dir);
      this.list.push(ped);
    }
  }

  leg(node, st) { return this.legsAt.get(node).list.find((l) => l.st === st); }

  // Queue a walk along street `st`'s sidewalk on `side` from `s` toward the end in direction `dir`.
  walkAlong(ped, st, side, s, dir) {
    const e = st.edge;
    const node = dir > 0 ? e.to : e.from;
    const L = e.cum[e.cum.length - 1];
    // no crosswalks at a roundabout: walk up to it and turn back
    const known = this.legsAt.has(node);
    const end = known ? this.leg(node, st).s : dir > 0 ? Math.max(s, L - 12) : Math.min(s, 12);
    const lat = sidewalkOffset(e, side);
    // now and then, on a quiet block, cut across to the other sidewalk partway along
    let cross = null;
    if (QUIET.has(e.cls) && !e.ring && Math.abs(end - s) > 35 && this.habits() < JAYWALK_P) {
      cross = s + dir * (10 + this.habits() * (Math.abs(end - s) - 25));
    }
    const path = [];
    const step = 5;
    const walk = (from, to, sideLat) => {
      for (let u = from; dir > 0 ? u < to : u > to; u += dir * step) path.push({ p: offsetPoint(e, u, sideLat) });
      path.push({ p: offsetPoint(e, to, sideLat) });
    };
    if (cross === null) walk(s, end, lat);
    else {
      walk(s, cross, lat);
      const other = sidewalkOffset(e, -side);
      const from = offsetPoint(e, cross, lat), to = offsetPoint(e, cross + dir * 2.5, other);
      path.push({ p: to, cross: { node: null, from, to, jaywalk: true } });
      walk(cross + dir * 2.5, end, other);
      side = -side;
    }
    ped.path = path;
    ped.at = { node, st, side, s: end, dir, turnBack: !known };
  }

  // At a corner: turn onto the next street, cross this one, or cross the next one.
  plan(ped) {
    const { node, st, side } = ped.at;
    if (ped.at.turnBack) { this.walkAlong(ped, st, side, ped.at.s, -ped.at.dir); return; }
    const info = this.legsAt.get(node);
    const here = this.leg(node, st);
    const from = here.ends[side];
    const others = info.list.filter((l) => l !== here);
    // the corner shares a block with the nearest sidewalk end of another leg
    let corner = null;
    for (const l of others) for (const sd of [1, -1]) {
      const d = dist(l.ends[sd], from);
      if (!corner || d < corner.d) corner = { leg: l, side: sd, d };
    }
    const r = this.random();
    const moves = [];
    let target;
    if (!others.length || (info.junction && r < 0.2)) {
      // cross the street we are on (at a dead end, turn back along the other side)
      target = { leg: here, side: -side };
      if (info.junction) moves.push({ p: here.ends[-side], cross: { node, leg: here, from: from, to: here.ends[-side] } });
      else moves.push({ p: here.ends[-side] });
    } else if (info.junction && r < 0.55) {
      // round the corner, then cross the street there, continuing straight ahead
      moves.push({ p: corner.leg.ends[corner.side] });
      target = { leg: corner.leg, side: -corner.side };
      moves.push({ p: corner.leg.ends[-corner.side], cross: { node, leg: corner.leg, from: corner.leg.ends[corner.side], to: corner.leg.ends[-corner.side] } });
    } else {
      moves.push({ p: corner.leg.ends[corner.side] });
      target = { leg: corner.leg, side: corner.side };
    }
    // then along the new street, away from this node
    const next = target.leg;
    ped.path = moves;
    ped.then = { st: next.st, side: target.side, s: next.s, dir: next.out ? 1 : -1 };
  }

  step(dt) {
    const t = this.world.t;
    for (const ped of this.list) {
      if (ped.frozen > 0) { ped.frozen -= dt; ped.v = 0; continue; }   // knocked down
      if (!ped.path.length) {
        if (ped.then) { this.walkAlong(ped, ped.then.st, ped.then.side, ped.then.s, ped.then.dir); ped.then = null; }
        else this.plan(ped);
        continue;
      }
      const wp = ped.path[0];
      if (wp.cross && !ped.crossing) {
        // at the curb: wait for the walk phase or a safe gap
        if (!this.mayCross(wp.cross, t)) { ped.v = 0; ped.waiting += dt; continue; }
        ped.crossing = wp.cross;
        ped.waiting = 0;
      }
      const dx = wp.p[0] - ped.x, dy = wp.p[1] - ped.y, d = Math.hypot(dx, dy);
      let v = ped.crossing ? ped.speed * 1.15 : ped.speed;   // people hurry across
      if (ped.crossing) {
        const react = this.threat(ped, dx / (d || 1), dy / (d || 1));
        if (react === "wait") { ped.v = 0; continue; }
        if (react === "hurry") v = Math.max(v, 2.4);
      }
      if (d <= v * dt) {
        ped.x = wp.p[0]; ped.y = wp.p[1];
        ped.path.shift();
        if (wp.cross) ped.crossing = null;
        continue;
      }
      ped.psi = Math.atan2(dy, dx);
      ped.v = v;
      ped.x += (dx / d) * v * dt;
      ped.y += (dy / d) * v * dt;
      ped.phase += v * dt;
    }
  }

  // A car bearing down that will not stop in time: "hurry" out of its path if already in it, "wait"
  // if about to step into it, else null.
  threat(ped, ux, uy) {
    for (const o of [this.world.ego, ...this.world.npcs]) {
      if (o.v < 2 || Math.abs(o.x - ped.x) > 40 || Math.abs(o.y - ped.y) > 40) continue;
      const local = o.toLocal(ped.x, ped.y);
      const front = (o.spec ? o.spec.length - o.spec.rearOverhang : 3.6);
      const ahead = local.ahead - front;
      if (ahead < -0.5 || ahead > 30) continue;
      const stopDist = o.v * o.v / (2 * 4) + o.v * 0.5;   // what a driver braking now would need
      if (ahead > stopDist + 2 && (o.a || 0) < -1) continue;   // it is braking in time
      if (ahead / o.v > 3) continue;
      const half = (o.spec ? o.spec.width : 1.9) / 2 + 0.6;
      if (Math.abs(local.right) < half) return "hurry";
      // beside its path: step in only if walking away from it
      const c = Math.cos(o.psi), s = Math.sin(o.psi);
      const towardRight = ux * s - uy * c;   // + means walking to the car's right
      if (Math.abs(local.right) < half + 2.5 && Math.sign(towardRight) === -Math.sign(local.right)) return "wait";
    }
    return null;
  }

  mayCross(cross, t) {
    if (cross.jaywalk) return this.clearFor(cross, JAYWALK_GAP_S, 70);
    const info = this.legsAt.get(cross.node);
    if (info.inter && cross.leg.group) {
      // walk with the parallel traffic, and only step off on the walk signal
      return pedPhase(info.inter, cross.leg.group === "A" ? "B" : "A", t) === "walk";
    }
    return this.clearFor(cross, GAP_S, 45);
  }

  // Nothing moving would reach the crossing within `gap` seconds (looking out to `range` meters).
  clearFor(cross, gap, range) {
    const mid = [(cross.from[0] + cross.to[0]) / 2, (cross.from[1] + cross.to[1]) / 2];
    const half = dist(cross.from, cross.to) / 2 + 2;
    for (const o of [this.world.ego, ...this.world.npcs]) {
      if (Math.abs(o.v) < 0.5) continue;
      const dx = mid[0] - o.x, dy = mid[1] - o.y;
      const ahead = dx * Math.cos(o.psi) + dy * Math.sin(o.psi);
      if (ahead < -2 || Math.hypot(dx, dy) > range) continue;
      const side = Math.abs(dx * Math.sin(o.psi) - dy * Math.cos(o.psi));
      if (side > half + 6) continue;
      if (Math.max(0, ahead - 4) / o.v < gap) return false;
    }
    return true;
  }

  // Pedestrians near (x, y), for collision checks.
  near(x, y, r) { return this.list.filter((p) => Math.abs(p.x - x) < r && Math.abs(p.y - y) < r); }
}

// Where a driver on a path (polyline with cumulative lengths) must yield to a pedestrian: the arc
// length of the first crosswalk between sFrom and sTo that a pedestrian is on and has not yet
// cleared of the path. Returns { s, ped } or null.
export function crosswalkConflict(pts, cum, sFrom, sTo, crowd, laneHalf = 1.8) {
  if (!crowd) return null;
  let best = null;
  for (const ped of crowd.list) {
    const c = ped.crossing;
    if (!c) continue;
    const hit = segmentCrossing(pts, cum, sFrom, sTo, c.from, c.to);
    if (!hit || (best && hit.s >= best.s)) continue;
    // how far the pedestrian still is from the path's crossing point, along the crosswalk
    const len = dist(c.from, c.to);
    const along = ((ped.x - c.from[0]) * (c.to[0] - c.from[0]) + (ped.y - c.from[1]) * (c.to[1] - c.from[1])) / len;
    const toPath = hit.u * len - along;   // > 0: still approaching the path
    if (toPath < -laneHalf) continue;       // already past the car's lane
    if (toPath > laneHalf + YIELD_AHEAD_M + len) continue;
    best = { s: hit.s, ped, toPath };
  }
  return best;
}

// First intersection of the path (between sFrom and sTo) with segment a-b: { s, u } where u is the
// fraction along a-b.
function segmentCrossing(pts, cum, sFrom, sTo, a, b) {
  let i = 0, lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= sFrom) lo = mid; else hi = mid - 1; }
  i = lo;
  for (; i < pts.length - 1 && cum[i] <= sTo; i++) {
    const p = pts[i], q = pts[i + 1];
    const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) continue;
    const w = [a[0] - p[0], a[1] - p[1]];
    const t = (w[0] * s[1] - w[1] * s[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const at = cum[i] + t * (cum[i + 1] - cum[i]);
      if (at >= sFrom && at <= sTo) return { s: at, u };
    }
  }
  return null;
}

function offsetPoint(e, s, lat) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat];
}

function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

// Signal group whose approaches run along heading h (either direction).
function groupOf(inter, h) {
  let best = null;
  for (const a of inter.approaches) {
    const d = Math.abs(Math.sin(a.heading_deg * Math.PI / 180 - h));
    if (!best || d < best.d) best = { d, group: a.group };
  }
  return best ? best.group : null;
}

