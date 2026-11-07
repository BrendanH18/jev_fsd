// A ball rolls out, then a child chases it (World option `balls`). Driver's handbooks across Canada say
// the same: a ball bouncing into the street is a warning that a child may run out after it, unseen
// behind the parked cars until they are in the road; slow down, ready to stop.
//
// Now and then, from its own random stream, by day and not in snow, a ball rolls out from a gap between
// two cars parked at the kerb of a residential street on the driven car's way (`spawn`), once its front
// is TRIGGER_M short of the gap. The ball rolls across the street (`rollBall`): rolling resistance slows
// it at ROLL_DECEL, it bounces off the far kerb or a parked car's side, losing most of its speed
// (RESTITUTION), and comes to rest, and it stays in the road until the child picks it up. CHILD_DELAY_S
// after it, a child (a pedestrian with `child` and `ballChase` set, `kid_ball_<n>`) runs out from the
// same gap at a child's running pace, without looking (`dart`), on into the road after the ball; picks
// it up (PICKUP_S); and walks back to the kerb and home, carrying it. The child is one of the crowd, so
// it is in `world.obstaclesNear` and hitting it is a collision.
//
// The ball is not an obstacle: nobody steers round it or stops for the ball itself (a playground ball
// does no harm to a car), and a vehicle that runs over it squashes it flat where it is (`burst`), as a
// tyre does; the child still goes to fetch it.
//
// Hidden hazards (World option `hazards`): the parked cars hide the child, as they hide anyone between
// them (`World.sees`, sim/hidden-hazards.js), and hide the ball too while it is still between them
// (`ballHidden`); once out in the open road the ball is in plain view. With hazards off nobody is hidden
// by a parked car, the child included, but the ball is still the warning that a child may follow. The
// two options are independent: free drives turn both on.
//
// Drivers who see the ball (the driven car, and traffic, by `ballVisible`; `seenBy`) treat it as a
// warning: from REACT_S after seeing it, they keep to the cover speed (`coverSpeed`), the speed from
// which, after COVER_REACT_S and braking at comfort().decel (so it follows the weather), they stop
// COVER_MARGIN_M short of the gap's line across the street, never below CREEP_MPS, until their front is
// past that line. The warning stands (`warningStands`) until the child has appeared to that driver and
// is clear (back at the kerb, or gone), or COVER_S has passed with no child seen. `ballCover` is the one
// test, shared by the driven car's sensing (`ballInRoad`, `ball_in_road` in brain/sensors.js, which
// caps `snap.limit`), its candidates (brain/candidates.js `slow_for_ball` and the
// `passes_ball_gap_too_fast` rejection), traffic (`ballYield`, sim/npc.js) and the audit
// (`auditBalls`): `ball_warnings_ignored`, once per ball, when the car's front passes the gap's line
// while the warning stands, having gone faster on the way there, from AUDIT_REACT_S after it saw the
// ball, than both the cover speed and the speed it would have slowed to braking at comfort().decel from
// then on, by more than AUDIT_SLACK_MPS. The metric is reported, and fails a drive, only once a ball has
// rolled out near the car (`World.ballsSeen`).
//
// With the option off nothing here is built, stepped or drawn from a random stream: no ball rolls, and
// `world.obstaclesNear`, sensing, traffic and the audit see nothing new.

import { comfort, CAR } from "./vehicle.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { sidewalkOffset } from "../map/streets.js";
import { segmentHitsBox } from "./crosswalk.js";
import { rng } from "../common.js";
import { Pedestrian } from "./pedestrians.js";

export const EGO = "ego";
export const BALL_R = 0.11;
// Free drives: one at a time, the first FIRST_S in, the next NEXT_S after the last; from a gap AHEAD_M
// ahead of the car's front, rolling out once its front is TRIGGER_M short of the gap.
export const FIRST_S = [20, 60];
export const NEXT_S = [60, 150];
export const AHEAD_M = [50, 110];
export const TRIGGER_M = [26, 42];
const RETRY_S = 5;
const GIVE_UP_S = 60;
const GAP_M = [0.9, 3.5];             // the gap between two parked cars it rolls out of
const HIDE_IN_M = 0.6;                // the ball, and the child, start this far in from the cars' traffic side
const ROW_M = 6;                      // a parked car this far from the car's side, either side of the street
const RESIDENTIAL = new Set(["residential", "living_street"]);
// The ball: how fast it comes out, how fast rolling resistance slows it, how much speed a bounce keeps.
export const BALL_MPS = [3.0, 4.5];
export const ROLL_DECEL = 0.35;
export const RESTITUTION = 0.45;
const DRIFT_MPS = 0.5;                // along the street, either way
const REST_MPS = 0.05;
// The child: CHILD_DELAY_S after the ball, at a child's running pace (crossing, pedestrians hurry 15%),
// picking it up for PICKUP_S and walking back at RETURN_MPS.
export const CHILD_DELAY_S = [1, 2];
export const CHILD_MPS = [2.3, 2.7];
export const CATCH_M = 0.45;
export const PICKUP_S = 0.8;
export const RETURN_MPS = 1.5;
// Cover: reacting within COVER_REACT_S and braking at comfort().decel, stopping COVER_MARGIN_M short of
// the gap's line, never slower than CREEP_MPS; looking out LOOK_M along the way; the warning lifts
// COVER_S after seeing the ball with no child seen (and at most WARN_MAX_S after it).
export const REACT_S = 0.3;
export const COVER_REACT_S = 0.75;
export const COVER_MARGIN_M = 2;
export const CREEP_MPS = 1.5;
export const COVER_S = 8;
const WARN_MAX_S = 40;
export const LOOK_M = 80;
const STREET_M = 16;                  // the gap's line reaches this far across the street
// The audit: from AUDIT_REACT_S after the car saw the ball, faster than allowed by AUDIT_SLACK_MPS.
export const AUDIT_REACT_S = 1.0;
export const AUDIT_SLACK_MPS = 1.0;
const SEEN_M = 60;
const RETIRE_M = 220;
const COLORS = [0xe8322b, 0xffd21f, 0x2f7de1, 0xff7a1a, 0x2bb673, 0xd63cc7];

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const offset = (e, s, lat) => { const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s); return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat]; };

// The cover speed `d` metres short of the gap's line (m/s), on the road as it is now.
export function coverSpeed(d) {
  const a = comfort().decel, t = COVER_REACT_S, room = Math.max(0, d - COVER_MARGIN_M);
  return Math.max(CREEP_MPS, a * (Math.sqrt(t * t + 2 * room / a) - t));
}

// The speed to be at `horizon` seconds from now, slowing from `v` along the way, so as to be at the
// cover speed for where the car is then: x = coverSpeed(d - (v + x) / 2 * horizon), by bisection.
export function coverAfter(d, v, horizon) {
  const now = Math.min(Math.max(0, v), coverSpeed(d));
  let lo = CREEP_MPS, hi = Math.max(CREEP_MPS, coverSpeed(d));
  for (let k = 0; k < 24; k++) {
    const x = (lo + hi) / 2;
    if (coverSpeed(Math.max(0, d - (now + x) / 2 * horizon)) > x) lo = x; else hi = x;
  }
  return lo;
}

// A ball that has rolled out and not yet been carried home.
export const activeBall = (b) => b?.phase === "rolling" || b?.phase === "stopped" || b?.phase === "carried";
const inRoad = (b) => b?.phase === "rolling" || b?.phase === "stopped";

// Whether cars parked at the kerb hide ball `b` from `observer` (with hidden hazards on): the line
// between them passes through one.
export function ballHidden(world, observer, b) {
  const mx = (observer.x + b.x) / 2, my = (observer.y + b.y) / 2;
  const bodies = world.parked.near(mx, my, Math.hypot(b.x - observer.x, b.y - observer.y) / 2 + 6).filter((c) => c !== observer);
  return bodies.some((c) => segmentHitsBox([observer.x, observer.y], [b.x, b.y], c.obb()));
}

// Whether `observer` sees ball `b`: in its line of sight, and (with hidden hazards on) not behind a car
// parked at the kerb. Carried home, it is the child that matters.
export function ballVisible(world, observer, b) {
  if (!inRoad(b)) return false;
  return world.visibility.canSee(observer, b.x, b.y) && !(world.hazards && ballHidden(world, observer, b));
}

// Where a vehicle going along `line` ({ pts, cum }) meets the gap's line across the street: the first arc
// length between `from` and `to`, or null. (Only going along the street, either way.)
export function gapCrossing(b, line, from, to) {
  const { pts, cum } = line, g = b.gap;
  const a = [g.x - g.n[0], g.y - g.n[1]], c = [g.x + g.n[0] * STREET_M, g.y + g.n[1] * STREET_M];
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= from) lo = mid; else hi = mid - 1; }
  for (let i = lo; i < pts.length - 1 && cum[i] <= to; i++) {
    const p = pts[i], q = pts[i + 1];
    const r = [q[0] - p[0], q[1] - p[1]], s = [c[0] - a[0], c[1] - a[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) continue;
    const w = [a[0] - p[0], a[1] - p[1]];
    const t = (w[0] * s[1] - w[1] * s[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    // (along the street, not across it at a junction)
    if (Math.abs(Math.cos(Math.atan2(r[1], r[0]) - g.h)) < 0.7) continue;
    const at = cum[i] + t * (cum[i + 1] - cum[i]);
    if (at >= from && at <= to) return at;
  }
  return null;
}

// How far `v`'s front is short of the gap's line, going along the street (negative once past it), or
// null where it is not on that street going along it.
export function frontToGap(b, v) {
  const g = b.gap, spec = v.spec || CAR, f = spec.length - spec.rearOverhang;
  const along = Math.cos(v.psi - g.h);
  if (Math.abs(along) < 0.7) return null;
  const fx = v.x + Math.cos(v.psi) * f, fy = v.y + Math.sin(v.psi) * f;
  const dx = g.x - fx, dy = g.y - fy;
  // (on the street: within its width of the gap's line)
  const across = dx * g.n[0] + dy * g.n[1];
  if (across > 1.5 || across < -STREET_M) return null;
  const t = [Math.cos(g.h), Math.sin(g.h)], sign = Math.sign(along);
  return (dx * t[0] + dy * t[1]) * sign;
}

// Whether the warning ball `b` gave driver `id` still stands: it has seen the ball (REACT_S ago), and has
// not yet seen the child come and go back to the kerb, nor gone COVER_S since without seeing a child.
export function warningStands(world, b, id) {
  if (!activeBall(b)) return false;
  const seen = b.seenBy.get(id);
  if (seen === undefined || world.t - seen < REACT_S || world.t - seen > WARN_MAX_S) return false;
  const child = b.childSeenBy.has(id);
  if (child) return b.childState !== "clear" && b.childState !== "gone";
  return world.t - seen <= COVER_S;
}

// The cover a driver going along `line` keeps for the balls it has seen: { limit, at (arc length of the
// gap's line), gap_m, ball } for the nearest, or null.
export function ballCover(world, line, { front, id, spec = CAR, look = LOOK_M }) {
  const balls = world.balls?.balls;
  if (!balls?.length) return null;
  let out = null;
  for (const b of balls) {
    if (!warningStands(world, b, id)) continue;
    const at = gapCrossing(b, line, Math.max(0, front - spec.length), front + look);
    if (at === null) continue;
    const gap = at - front;
    if (gap < 0) continue;
    if (!out || gap < out.gap_m) out = { limit: coverSpeed(gap), at, gap_m: gap, ball: b };
  }
  return out;
}

// Traffic (sim/npc.js): the speed ceiling of driver `n` for a ball it has seen ahead, or null. (A driver
// above its ceiling eases off only gently, sim/npc.js IDM, so it aims at the cover speed it will need
// NPC_LEAD_S from now.)
const NPC_LEAD_S = 1.0;
export function ballYield(world, n, front) {
  const c = ballCover(world, n.path, { front, id: n.id, spec: n.spec || CAR });
  return c ? { ...c, limit: coverSpeed(Math.max(0, c.gap_m - Math.max(0, n.v) * NPC_LEAD_S)) } : null;
}

export class BallChase {
  constructor(world, { enabled = false, seed = 1 } = {}) {
    this.world = world;
    this.enabled = !!enabled;
    this.balls = [];
    this.made = 0;
    this.target = this.enabled ? 1 : 0;
    // (their own stream, drawn from only while the option is on)
    this.random = this.enabled ? rng(seed * 2654435761 + 97) : null;
    this.next = this.enabled ? FIRST_S[0] + this.random() * (FIRST_S[1] - FIRST_S[0]) : Infinity;
  }

  // A ball waiting in gap `gap` ({ edge, s, lat, side }: along edge `edge`, `lat` metres right of it,
  // between parked cars on its `side` (+1 right, -1 left)), rolling out once the driven car's front is
  // `trigger` metres short of the gap's line, or at once with trigger null; the child following
  // `delay` seconds later at `speed`. Returns it.
  place(gap, { trigger = null, speed = null, drift = 0, delay = null, childSpeed = null, color = null, id = null, keep = false } = {}) {
    const map = this.world.map, e = map.edges.get(gap.edge);
    const h = headingAt(e.pts, e.cum, gap.s), [x, y] = offset(e, gap.s, gap.lat);
    // (into the street: from a gap on the right, to the left of the edge's way)
    const n = gap.side > 0 ? [-Math.sin(h), Math.cos(h)] : [Math.sin(h), -Math.cos(h)];
    const r = this.random || (() => 0.5);
    this.made++;
    const b = { id: id || `ball_${this.made}`, kind: "ball", x, y, vx: 0, vy: 0, spin: 0, axis: [0, 1], burst: false, color: color ?? COLORS[this.made % COLORS.length],
      gap: { x, y, edge: e.id, s: gap.s, lat: gap.lat, side: gap.side, h, n }, phase: trigger === null ? "rolling" : "waiting", trigger, keep, since: this.world.t,
      speed: speed ?? BALL_MPS[0] + r() * (BALL_MPS[1] - BALL_MPS[0]), drift: drift ?? 0,
      delay: delay ?? CHILD_DELAY_S[0] + r() * (CHILD_DELAY_S[1] - CHILD_DELAY_S[0]), childSpeed: childSpeed ?? CHILD_MPS[0] + r() * (CHILD_MPS[1] - CHILD_MPS[0]),
      out: null, child: null, childState: "hidden", seenBy: new Map(), childSeenBy: new Set(), look: Math.floor(r() * 1e6) };
    if (b.phase === "rolling") this.release(b);
    this.balls.push(b);
    return b;
  }

  release(b) {
    const g = b.gap;
    b.phase = "rolling"; b.out = this.world.t;
    const t = [Math.cos(g.h), Math.sin(g.h)];
    b.vx = g.n[0] * b.speed + t[0] * b.drift; b.vy = g.n[1] * b.speed + t[1] * b.drift;
  }

  // Free drives: a gap between two cars parked along the residential street the car is on, either side,
  // AHEAD_M ahead of its front (and on its route, where it has one), by day and not in snow. True if placed.
  spawn() {
    const world = this.world, ego = world.ego, map = world.map, random = this.random;
    if (world.visibility.night >= 0.5 || world.weather === "snow") return false;
    const FRONT = ego.spec.length - ego.spec.rearOverhang;
    const near = map.nearestLane(ego.x, ego.y, ego.psi, 6);
    const e = near?.lane.edgeRef;
    if (!e || e.ring || !RESIDENTIAL.has(e.cls)) return false;
    const twin = (map.out.get(e.to) || []).map((id) => map.edges.get(id)).find((x) => x.to === e.from && Math.abs(x.length - e.length) < 1)?.id;
    const rows = { 1: [], [-1]: [] };
    for (const c of world.parked.near(ego.x, ego.y, AHEAD_M[1] + FRONT + 12)) {
      if (c.roadside || c.workzone || c.closure || c.doubleParked || (c.edge !== e.id && c.edge !== twin)) continue;
      const d = Math.abs(wrap(c.psi - ego.psi));
      if (d > Math.PI / 6 && d < Math.PI * 5 / 6) continue;
      const [cx, cy] = c.center, l = ego.toLocal(cx, cy), cs = c.spec || CAR;
      const gap = Math.abs(l.right) - cs.width / 2 - ego.spec.width / 2;
      if (gap < 0 || gap > ROW_M) continue;
      rows[Math.sign(l.right) || 1].push({ ahead: l.ahead, right: l.right, half: cs.length / 2, width: cs.width });
    }
    const gaps = [];
    for (const side of [1, -1]) {
      const row = rows[side].sort((a, b) => a.ahead - b.ahead);
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i], b = row[i + 1], g = (b.ahead - b.half) - (a.ahead + a.half);
        if (g < GAP_M[0] || g > GAP_M[1] || Math.abs(a.right - b.right) > 0.6) continue;
        const ahead = (a.ahead + a.half + b.ahead - b.half) / 2;
        if (ahead - FRONT < AHEAD_M[0] || ahead - FRONT > AHEAD_M[1]) continue;
        const inner = Math.min(Math.abs(a.right) - a.width / 2, Math.abs(b.right) - b.width / 2);
        gaps.push({ ahead, right: side * (inner + HIDE_IN_M) });
      }
    }
    if (!gaps.length) return false;
    const pick = gaps[Math.floor(random() * gaps.length)];
    const c = Math.cos(ego.psi), s = Math.sin(ego.psi);
    const x = ego.x + c * pick.ahead + s * pick.right, y = ego.y + s * pick.ahead - c * pick.right;
    // (on the car's route, where it has one)
    const route = world.route;
    if (route) {
      const q = route.project(x, y, route.hint ?? 0);
      if (!q || q.distance > 12) return false;
    }
    const pr = projectPoint(e.pts, e.cum, [x, y]);
    const b = this.place({ edge: e.id, s: pr.s, lat: pr.lateral, side: pr.lateral > 0 ? 1 : -1 },
      { trigger: TRIGGER_M[0] + random() * (TRIGGER_M[1] - TRIGGER_M[0]), drift: (random() * 2 - 1) * DRIFT_MPS });
    // (out of sight of the car until it rolls out, as anyone between the cars would be)
    return !!b;
  }

  step(dt) {
    if (!this.enabled) return;
    const world = this.world, ego = world.ego;
    for (const b of [...this.balls]) {
      const far = Math.hypot(b.x - ego.x, b.y - ego.y) > RETIRE_M;
      const waitingGone = b.phase === "waiting" && (far || (!b.keep && world.t - b.since > GIVE_UP_S) || (frontToGap(b, ego) ?? 1) < -2);
      if (waitingGone || b.phase === "gone" || (far && b.phase !== "waiting" && b.childState !== "out")) this.retire(b);
    }
    if (this.balls.length < this.target && world.t >= this.next) {
      if (!this.spawn()) this.next = world.t + RETRY_S;
    }
    for (const b of this.balls) {
      if (b.phase === "waiting") {
        const d = frontToGap(b, ego);
        if (d !== null && d <= b.trigger && d > 0) this.release(b);
        else continue;
      }
      if (Math.hypot(b.x - ego.x, b.y - ego.y) < SEEN_M) world.ballsSeen = true;
      if (b.phase === "rolling" || b.phase === "stopped") this.roll(b, dt);
      this.chase(b);
      this.look(b);
    }
  }

  retire(b) {
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
    if (b.child && b.childState !== "gone") {
      const j = this.world.crowd.list.indexOf(b.child);
      // (a child still at the kerb goes home with it; one in the street finishes on their own)
      if (j >= 0 && b.childState !== "out") this.world.crowd.list.splice(j, 1);
    }
    if (this.random) this.next = Math.max(this.next, this.world.t + NEXT_S[0] + this.random() * (NEXT_S[1] - NEXT_S[0]));
  }

  // The ball rolls: rolling resistance, the kerbs either side and the parked cars, and any vehicle that
  // runs over it.
  roll(b, dt) {
    const world = this.world, e = world.map.edges.get(b.gap.edge);
    const v = Math.hypot(b.vx, b.vy);
    if (!b.burst) for (const o of [world.ego, ...world.npcs]) {
      if (Math.abs(o.x - b.x) > 8 || Math.abs(o.y - b.y) > 8) continue;
      const box = o.obb(), c = Math.cos(box.heading), s = Math.sin(box.heading), dx = b.x - box.center[0], dy = b.y - box.center[1];
      if (Math.abs(dx * c + dy * s) < box.halfLength && Math.abs(-dx * s + dy * c) < box.halfWidth - 0.2) { b.burst = true; b.vx = 0; b.vy = 0; b.phase = "stopped"; }
    }
    if (b.burst || v < REST_MPS) { b.vx = 0; b.vy = 0; b.phase = "stopped"; return; }
    const k = Math.max(0, v - ROLL_DECEL * dt) / v;
    b.vx *= k; b.vy *= k;
    let nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    // (the kerbs: off the edge of the asphalt either side, back it comes)
    const pr = projectPoint(e.pts, e.cum, [nx, ny]);
    const h = headingAt(e.pts, e.cum, pr.s), right = [Math.sin(h), -Math.cos(h)];
    const lo = e.asphalt[0] + BALL_R, hi = e.asphalt[1] - BALL_R;
    if (pr.lateral < lo || pr.lateral > hi) {
      const vr = b.vx * right[0] + b.vy * right[1];
      if ((pr.lateral > hi && vr > 0) || (pr.lateral < lo && vr < 0)) {
        b.vx -= (1 + RESTITUTION) * vr * right[0]; b.vy -= (1 + RESTITUTION) * vr * right[1];
        b.vx *= 0.85; b.vy *= 0.85;
      }
      const lat = Math.max(lo, Math.min(hi, pr.lateral)), back = lat - pr.lateral;
      nx += right[0] * back; ny += right[1] * back;
    }
    // (the side of a parked car)
    for (const p of world.parked.near(nx, ny, 4)) {
      const box = p.obb(), c = Math.cos(box.heading), s = Math.sin(box.heading), dx = nx - box.center[0], dy = ny - box.center[1];
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const px = box.halfLength + BALL_R - Math.abs(lx), py = box.halfWidth + BALL_R - Math.abs(ly);
      if (px <= 0 || py <= 0) continue;
      // (out along the shallower side, its speed that way turned back)
      const axis = px < py ? [c, s] : [-s, c], depth = Math.min(px, py), sign = Math.sign(px < py ? lx : ly) || 1;
      const vn = b.vx * axis[0] + b.vy * axis[1];
      if (vn * sign < 0) { b.vx -= (1 + RESTITUTION) * vn * axis[0]; b.vy -= (1 + RESTITUTION) * vn * axis[1]; }
      nx += axis[0] * sign * depth; ny += axis[1] * sign * depth;
    }
    const moved = Math.hypot(nx - b.x, ny - b.y);
    if (moved > 1e-6) { b.axis = [(nx - b.x) / moved, (ny - b.y) / moved]; b.spin += moved / BALL_R; }
    b.x = nx; b.y = ny;
    b.phase = Math.hypot(b.vx, b.vy) < REST_MPS ? "stopped" : "rolling";
  }

  // The child: out after the ball once its time comes, after it into the road, picking it up, and back
  // to the kerb and home with it.
  chase(b) {
    const world = this.world;
    if (b.childState === "hidden" && b.out !== null && world.t - b.out >= b.delay) {
      const g = b.gap, e = world.map.edges.get(g.edge);
      const ped = new Pedestrian({ id: `kid_ball_${b.id}`, x: g.x, y: g.y, psi: Math.atan2(g.n[1], g.n[0]), v: 0, speed: b.childSpeed, child: true, dart: true, ballChase: b.id,
        path: [{ p: [b.x, b.y], cross: { node: null, from: [g.x, g.y], to: farSide(e, g, [b.x, b.y]), jaywalk: true, ballChase: true } }],
        crossing: null, waiting: 0, phase: 0, look: b.look, at: null });
      ped.crossing = ped.path[0].cross;
      world.crowd.list.push(ped);
      b.child = ped; b.childState = "out";
      return;
    }
    const ped = b.child;
    if (!ped || b.childState === "gone") return;
    if (!world.crowd.list.includes(ped)) { b.childState = "gone"; if (b.phase === "carried") b.phase = "gone"; return; }
    if (ped.frozen > 0) return;   // (knocked down)
    if (b.phase === "carried") {
      b.x = ped.x; b.y = ped.y;
      // (back at the kerb: clear of the road)
      if (b.childState === "out" && !ped.crossing && ped.path.length <= 1) b.childState = "clear";
      return;
    }
    // (after the ball, wherever it has got to)
    const wp = ped.path[0];
    if (wp?.cross?.ballChase) { wp.p = [b.x, b.y]; wp.cross.to = farSide(world.map.edges.get(b.gap.edge), b.gap, [b.x, b.y]); }
    if (Math.hypot(ped.x - b.x, ped.y - b.y) < CATCH_M || (!ped.path.length && !ped.crossing)) {
      // picked up: a moment, then back the way they came, to the kerb, and home along the sidewalk
      const g = b.gap, e = world.map.edges.get(g.edge);
      const walk = offset(e, g.s, sidewalkOffset(e, g.side));
      ped.path = [{ p: [g.x, g.y], cross: { node: null, from: farSide(e, g, [ped.x, ped.y]), to: [g.x, g.y], jaywalk: true, ballBack: true } }, { p: walk }];
      ped.crossing = ped.path[0].cross;
      // (walking now, and looking: a car bearing down that could not stop, they wait for)
      ped.speed = RETURN_MPS; ped.home = true; ped.pause = PICKUP_S; ped.dart = false;
      b.phase = "carried"; b.vx = 0; b.vy = 0;
    }
  }

  // Who has seen the ball, and the child: the driven car (by `World.sees` for the child) and traffic near it.
  look(b) {
    const world = this.world, t = world.t;
    if (!activeBall(b)) return;
    const observers = [[EGO, world.ego], ...world.npcs.filter((n) => Math.abs(n.x - b.x) < LOOK_M + 10 && Math.abs(n.y - b.y) < LOOK_M + 10).map((n) => [n.id, n])];
    for (const [id, o] of observers) {
      if (!b.seenBy.has(id) && ballVisible(world, o, b)) b.seenBy.set(id, t);
      const ped = b.child;
      if (ped && b.seenBy.has(id) && !b.childSeenBy.has(id) && world.crowd.list.includes(ped) && (id === EGO ? world.sees(o, ped) : world.visibility.sees(o, ped))) b.childSeenBy.add(id);
    }
  }
}

// The point across the street from the gap, beyond the far kerb, along the line from the gap through
// `p` (the crossing a child chasing the ball is on, for everyone's pedestrian checks: sim/pedestrians.js
// crosswalkConflict; and, the way back, where it starts from).
function farSide(e, g, p) {
  let ux = p[0] - g.x, uy = p[1] - g.y, d = Math.hypot(ux, uy);
  if (d < 0.5 || ux * g.n[0] + uy * g.n[1] < 0.3 * d) { ux = g.n[0]; uy = g.n[1]; d = 1; }
  ux /= d; uy /= d;
  const width = e.asphalt[1] - e.asphalt[0] + 2, k = Math.min(STREET_M, width / Math.max(0.3, ux * g.n[0] + uy * g.n[1]));
  return [g.x + ux * k, g.y + uy * k];
}

// The driven car's sensing (brain/sensors.js `ball_in_road`): the nearest ball ahead it has seen, as long
// as it is in the road or its warning stands, or null. `limit_mps`: the cover speed while the warning
// stands and the gap's line is ahead.
export function ballInRoad(world, p, frontS) {
  const { ego, route } = world, balls = world.balls?.balls;
  if (!balls?.length || !route) return null;
  let best = null;
  for (const b of balls) {
    const seen = b.seenBy.get(EGO);
    if (seen === undefined || !activeBall(b)) continue;
    const warn = warningStands(world, b, EGO);
    if (!warn && !inRoad(b)) continue;
    const at = gapCrossing(b, route, Math.max(0, frontS - ego.spec.length - 10), frontS + LOOK_M);
    if (at === null) continue;
    const gap = at - frontS;
    if (best && gap >= best.gap_m) continue;
    const l = ego.toLocal(b.gap.x, b.gap.y), lb = ego.toLocal(b.x, b.y);
    const childSeen = b.childSeenBy.has(EGO);
    best = { id: b.id, side: l.right > 0 ? "right" : "left", gap_m: gap, stop_s_route: at, ball: b.phase === "carried" ? "picked up" : b.burst ? "squashed" : b.phase,
      ball_speed: Math.hypot(b.vx, b.vy), ball_ahead_m: lb.ahead, ball_right_m: lb.right, seen_for_s: world.t - seen,
      child: !childSeen ? "not_seen" : b.childState === "out" ? "in_road" : "clear", child_id: childSeen && b.child ? b.child.id : null,
      warning: warn, limit_mps: warn && gap > 0 ? coverSpeed(gap) : null, creep_mps: CREEP_MPS,
      cover_left_s: warn && !childSeen ? Math.max(0, COVER_S - (world.t - seen)) : null };
  }
  return best;
}

// The audit (World.audit): `ball_warnings_ignored`, once per ball (see above). The car's speed is
// checked against the cover speed from AUDIT_REACT_S after it saw the ball, and judged as its front
// passes the gap's line.
export function auditBalls(world) {
  const balls = world.balls?.balls;
  if (!balls?.length) return;
  const ego = world.ego, calls = world.ballCalls ||= new Map(), t = world.t;
  for (const b of balls) {
    const seen = b.seenBy.get(EGO);
    if (seen === undefined) continue;
    const call = calls.get(b.id) || { v0: null, over: 0, last: null, counted: false };
    calls.set(b.id, call);
    if (call.counted) continue;
    const d = frontToGap(b, ego), warn = warningStands(world, b, EGO);
    if (d === null) { call.last = null; continue; }
    const t0 = seen + AUDIT_REACT_S;
    if (warn && d > 0 && t >= t0) {
      if (call.v0 === null) call.v0 = { v: ego.v, t };
      const allowed = Math.max(coverSpeed(d), call.v0.v - comfort().decel * (t - call.v0.t)) + AUDIT_SLACK_MPS;
      if (ego.v > allowed) call.over = Math.max(call.over, ego.v - allowed + AUDIT_SLACK_MPS);
      call.allowed = allowed - AUDIT_SLACK_MPS;
    }
    if (call.last !== null && call.last > 0 && d <= 0 && warn && call.over > 0) {
      call.counted = true;
      world.violations.ball_warnings_ignored = (world.violations.ball_warnings_ignored || 0) + 1;
      world.events.push({ type: "ball_warning_ignored", ball: b.id, kmh: Math.round(ego.v * 36) / 10, over_kmh: Math.round(call.over * 36) / 10 });
    }
    call.last = d;
  }
}

// What the HUD says about a ball in the road ahead, or null: from the autopilot's sensing, or, driving by
// hand, a ball the car has seen.
export function ballNotice(world, snap = null) {
  const balls = world.balls?.balls;
  if (!balls?.length) return null;
  for (const b of balls) {
    if (!b.seenBy.has(EGO) || !activeBall(b)) continue;
    const s = snap?.ball_in_road?.id === b.id ? snap.ball_in_road : null;
    const childSeen = b.childSeenBy.has(EGO);
    if (childSeen && b.childState === "out") return { key: `${b.id}:child`, text: "CHILD CHASING THE BALL · STOP", wait: true };
    if (warningStands(world, b, EGO) && !childSeen) return { key: `${b.id}:ball`, text: `BALL IN THE ROAD · A CHILD MAY FOLLOW${s?.limit_mps ? ` · ${Math.round(s.limit_mps * 3.6)} KM/H` : " · SLOW DOWN"}`, wait: false };
  }
  return null;
}
