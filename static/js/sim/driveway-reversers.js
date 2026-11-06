// Cars backing out of driveways (World option `driveways`). Now and then, from its own random stream, a
// car parked nose-in in a driveway (jev/osm/driveways.py) near the driven car's way backs out: reverse
// lamps on, it creeps back across the sidewalk at walking pace (CREEP_MPS), stops with its rear just
// short of the near lane to look (LOOK_S), and, once nothing it can see or hear is coming along that
// lane within COMMIT_M or COMMIT_S, reverses into it on an arc (REVERSE_MPS) until it faces the way the
// traffic goes, stops, shifts into drive (lamps off) and, after a moment, drives off with the traffic as
// an ordinary car (sim/npc.js). It drives the one car model (sim/vehicle.js) in reverse, steering along
// the arc the way `turnaround.js` and `parallel-park.js` reverse, and stops for anything about to be in
// its way. Its driver looks out of the rear window: cars parked at the kerb hide the street from it just
// as they hide it from the street (with hidden hazards on, `World.sees` and `reverserHidden`), so it may
// start out while the driven car is still a moderate distance off and out of its sight. People on the
// sidewalk wait for it to go by (`holdPedestrians`).
//
// Everyone gives it room. `reverserConflict` is the one test, shared by the driven car's sensing
// (`reversingVehicle`, `reversing_vehicle` in brain/sensors.js), the forward sims (brain/candidates.js
// `yield_to_reversing` and the `passes_reversing_vehicle_too_close` rejection), traffic (`reverserYield`,
// sim/npc.js) and the audit: while it is backing out toward a lane (creeping or looking) a driver coming
// along that lane slows to CAUTION_MPS by CAUTION_AT_M short of it; once it is in or entering the lane
// (or stopped there, about to drive off) a driver stops STOP_BACK_M short of the room it needs, and goes
// on once it has driven off. The audit (`auditReversers`) counts passing it closer than PASS_CLEAR_M
// while it backs out, and failing to stop for it once it is in the lane, as `reversing_conflicts`,
// reported only once a car has backed out near the driven car (`World.drivewaysSeen`).
//
// With the option off nothing here is built, stepped or drawn from a random stream: no cars back out,
// and `world.obstaclesNear`, sensing and traffic see nothing new.

import { Vehicle, CAR, comfort } from "./vehicle.js";
import { pointAt, headingAt, cumulative, projectPoint } from "../map/mapdata.js";
import { rng } from "../common.js";
import { obbOverlap } from "./collision.js";
import { segmentHitsBox } from "./crosswalk.js";
import { speedControl, stopSpeedFor } from "./controller.js";
import { StopMemory } from "./signals.js";
import { NpcPath } from "./npc.js";
import { GUTTER, CURB, streetOf } from "../map/streets.js";

// Free drives: one at a time, the first FIRST_S in, then NEXT_S after the last; in a driveway AHEAD_M
// along the car's route, starting out once the car's front is TRIGGER_M short of it.
export const FIRST_S = [12, 30];
export const NEXT_S = [30, 70];
export const AHEAD_M = [110, 200];
export const TRIGGER_M = [50, 105];
const RETIRE_M = 220;
const GIVE_UP_S = 120;
// Backing out: walking pace across the sidewalk, a little faster into the lane, on an arc of this
// radius (rear axle), stopping to look with the rear bumper this far short of the near lane.
export const CREEP_MPS = 0.8;
export const REVERSE_MPS = 1.5;
export const ARC_R = 6;
export const LOOK_GAP_M = 0.8;
export const LOOK_S = 0.8;
const PAUSE_S = [1.0, 2.0];
const BACK_ROOM_M = 0.4;            // the car's rear bumper stands this far behind the sidewalk
const MAX_ANGLE = 15 * Math.PI / 180;
// It goes into the lane once whatever it can see or hear coming along it is further than COMMIT_M and
// COMMIT_S away; anything within HEAR_M it notices, seen or not.
export const COMMIT_M = 12;
export const COMMIT_S = 2.5;
export const HEAR_M = 8;
// It stops for anything within this of where it will be in the next second.
const BLOCK_M = 0.4;
// Others: from CAUTION_M away, slow so as to be at CAUTION_MPS by CAUTION_AT_M short of it while it backs
// out toward the lane; stop STOP_BACK_M short of the room it needs once it is coming in.
export const CAUTION_M = 50;
export const CAUTION_MPS = 4.5;
export const CAUTION_AT_M = 10;
export const STOP_BACK_M = 2.5;
const CLAIM_CLEAR_M = 0.5;
// Passing one backing out, the bodies keep at least this far apart.
export const PASS_CLEAR_M = 1.0;
const AUDIT_SLACK_M = 0.1;
const AUDIT_STOP_M = 1.5;
const SEEN_M = 60;
const COLORS = [0x8d9299, 0x2b3a55, 0xeeeeea, 0x1a1c20, 0x6b7f5e, 0x9b1e1e, 0xc4c8cc, 0x3a5f7d];

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
export const isReverser = (o) => !!o?.reverser;
// Backing out, or about to: what others give room to (`parked`, in the driveway, is nothing yet; `drive`
// has handed over to traffic).
const ACTIVE = new Set(["creep", "look", "out", "pause"]);
export const activeReverser = (r) => ACTIVE.has(r?.phase);

// The way a car backs out of driveway `d` (map.driveways): its near lane, the path its rear axle takes
// (in the order it travels it, backwards), where it stops to look (`sCheck`) and where it ends (`sEnd`),
// and its pose there. Null where the street has no lane on that side.
export function drivewayGeometry(map, d, spec = CAR) {
  const e = map.edges.get(d.edge);
  if (!e) return null;
  const sigma = d.side === "left" ? -1 : 1;
  if (sigma < 0 && !e.oneway) return null;
  const laneIdx = sigma > 0 ? e.lanes - 1 : 0, lane = map.lane(e.id, laneIdx);
  if (!lane) return null;
  const sEdge = Math.max(0, Math.min(e.length, d.s)), sScaled = sEdge * e.cum[e.cum.length - 1] / Math.max(1e-6, e.length);
  const q = pointAt(e.pts, e.cum, sScaled), h = headingAt(e.pts, e.cum, sScaled);
  const t = [Math.cos(h), Math.sin(h)], nR = [Math.sin(h), -Math.cos(h)], n = [nR[0] * sigma, nR[1] * sigma];
  // (outward from the street, on the driveway's side: lane centre, its outer edge and the asphalt's)
  const laneOut = sigma * e.lane_offsets[laneIdx], laneEdgeOut = laneOut + e.lane_width / 2;
  const kerbOut = sigma > 0 ? e.asphalt[1] : -e.asphalt[0];
  const [blvd, walk] = streetOf(e);
  const backOut = kerbOut + GUTTER + CURB + blvd + walk + BACK_ROOM_M + spec.rearOverhang;
  const p1Out = laneOut + ARC_R;
  if (backOut < p1Out + 0.5) return null;
  const at = (out, along) => [q[0] + n[0] * out + t[0] * along, q[1] + n[1] * out + t[1] * along];
  // straight back toward the street, then a quarter circle into the lane, then on back a little
  const pts = [];
  for (let o = backOut; o > p1Out; o -= 0.5) pts.push(at(o, 0));
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * Math.PI / 2;
    // (centre at p1 - R t; from p1 = C + R t round to C - R n)
    pts.push(at(p1Out - ARC_R * Math.sin(a), -ARC_R + ARC_R * Math.cos(a)));
  }
  for (const extra of [1, 2, 3, 4]) pts.push(at(laneOut, -ARC_R - extra));
  const cum = cumulative(pts);
  const path = { pts, cum, length: cum[cum.length - 1], pointAt: (s) => pointAt(pts, cum, s), headingAt: (s) => headingAt(pts, cum, s) };
  const sEnd = cum[cum.length - 5] + 0.5;
  // where it stops to look: the nearest corner of its body LOOK_GAP_M short of the near lane's outer edge
  let sCheck = 0;
  for (let s = 0; s <= sEnd; s += 0.1) {
    const out = Math.min(...boxCorners(poseBox(path, s, spec)).map((c) => (c[0] - q[0]) * n[0] + (c[1] - q[1]) * n[1]));
    if (out <= laneEdgeOut + LOOK_GAP_M) { sCheck = Math.max(0, s - 0.1); break; }
  }
  const end = path.pointAt(sEnd);
  // (along the near lane: where the driveway is, in the lane's own arc length)
  const lp = projectPoint(lane.pts, lane.cum, q);
  return { e, lane, laneIdx, sigma, q, h, n, t, path, sCheck, sEnd, laneS: lp.s, start: { x: pts[0][0], y: pts[0][1], psi: Math.atan2(n[1], n[0]) },
    end: { x: end[0], y: end[1], psi: h }, kerbOut, laneOut };
}

// The body of a car of `spec` with its rear axle at path arc length s, backing along `path`.
function poseBox(path, s, spec) {
  const p = path.pointAt(s), back = path.headingAt(s), psi = back + Math.PI;
  const f = spec.length / 2 - spec.rearOverhang;
  return { center: [p[0] + Math.cos(psi) * f, p[1] + Math.sin(psi) * f], heading: psi, halfLength: spec.length / 2, halfWidth: spec.width / 2 };
}

// Where reversing car `r` will be `t` seconds from now, as a box: along its way out at the speed it
// backs out at (the forward sims' prediction, brain/candidates.js), not straight on at its velocity.
export function reverserBoxAt(r, t) {
  const g = r.geo;
  if (r.phase === "creep") return poseBox(g.path, Math.min(g.sCheck, r.ps + CREEP_MPS * t), r.spec);
  if (r.phase === "out") return poseBox(g.path, Math.min(g.sEnd, r.ps + Math.max(Math.abs(r.v), 0.5 * REVERSE_MPS) * t), r.spec);
  return r.obb();
}

// Distance from point p to box b (0 inside).
function pointBoxDist(p, b) {
  const c = Math.cos(b.heading), s = Math.sin(b.heading), dx = p[0] - b.center[0], dy = p[1] - b.center[1];
  const lx = Math.abs(dx * c + dy * s) - b.halfLength, ly = Math.abs(-dx * s + dy * c) - b.halfWidth;
  return Math.hypot(Math.max(0, lx), Math.max(0, ly));
}
const boxCorners = (b) => {
  const c = Math.cos(b.heading), s = Math.sin(b.heading);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([u, v]) => [b.center[0] + u * b.halfLength * c - v * b.halfWidth * s, b.center[1] + u * b.halfLength * s + v * b.halfWidth * c]);
};
// The gap between two boxes' bodies (0 when they touch or overlap).
export function boxGap(a, b) {
  if (obbOverlap(a, b)) return 0;
  return Math.min(...boxCorners(a).map((p) => pointBoxDist(p, b)), ...boxCorners(b).map((p) => pointBoxDist(p, a)));
}

// Whether parked cars at the kerb hide reversing car `r` from `observer` (or `observer` from it): every
// line between them (its middle, nose and tail) passes through one (with hidden hazards on).
export function reverserHidden(world, observer, r) {
  const box = r.obb(), dx = Math.cos(box.heading) * box.halfLength, dy = Math.sin(box.heading) * box.halfLength;
  const mx = (observer.x + r.x) / 2, my = (observer.y + r.y) / 2;
  const bodies = world.parked.near(mx, my, Math.hypot(r.x - observer.x, r.y - observer.y) / 2 + 6).filter((c) => c !== observer && c !== r);
  if (!bodies.length) return false;
  return [[0, 0], [dx, dy], [-dx, -dy]].every(([x, y]) => bodies.some((c) => segmentHitsBox([observer.x, observer.y], [box.center[0] + x, box.center[1] + y], c.obb())));
}

// The room reversing car `r` needs, as boxes, and what that asks of others: "coming" (backing out toward
// the lane: slow), "in_lane" (entering it, or stopped in it about to drive off: stop), or null.
export function reverserClaim(r) {
  if (!activeReverser(r)) return null;
  const g = r.geo, spec = r.spec;
  if (r.phase === "creep" || r.phase === "look") return { kind: "coming", boxes: [poseBox(g.path, Math.min(g.sEnd, g.sCheck + 2.5), spec), poseBox(g.path, g.sEnd, spec)] };
  if (r.phase === "out") {
    const s = r.ps, mid = (s + g.sEnd) / 2;
    return { kind: "in_lane", boxes: [r.obb(), poseBox(g.path, mid, spec), poseBox(g.path, g.sEnd, spec)] };
  }
  return { kind: "in_lane", boxes: [r.obb()] };
}

// The conflict between a vehicle going along `line` ({ pts, cum }: its route or path; its front at arc
// length `front`, its centre `lat` metres right of the line) and reversing car `r`: the first arc length
// within `look` metres where its body would come within CLAIM_CLEAR_M of the room `r` needs (`at`, for
// its front), and what that asks of it (`kind`); or null.
export function reverserConflict(r, line, { front, spec = CAR, lat = 0, look = CAUTION_M + 10 }) {
  const claim = reverserClaim(r);
  if (!claim) return null;
  const { pts, cum } = line, L = cum[cum.length - 1];
  const reach = spec.width / 2 + CLAIM_CLEAR_M;
  // (cheaply: nothing near the line ahead)
  const [cx, cy] = claim.boxes[claim.boxes.length - 1].center;
  for (let s = Math.max(0, front - spec.length); s <= Math.min(L, front + look); s += 0.5) {
    const p = pointAt(pts, cum, s);
    if (Math.abs(p[0] - cx) > 12 || Math.abs(p[1] - cy) > 12) continue;
    const h = headingAt(pts, cum, s), q = [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat];
    // (going the other way, or across it: only a vehicle coming along the lane, its way)
    if (Math.abs(wrap(h - r.geo.h)) > Math.PI / 3) continue;
    if (claim.boxes.some((b) => pointBoxDist(q, b) < reach)) return { at: s, gap_m: s - front, kind: claim.kind };
  }
  return null;
}

// How fast a driver `gap` metres short of where a car backing out would come into its lane goes: slowing
// gently to CAUTION_MPS by CAUTION_AT_M short of it.
export function cautionSpeed(gap) {
  return Math.sqrt(CAUTION_MPS * CAUTION_MPS + 2 * 0.6 * comfort().decel * Math.max(0, gap - CAUTION_AT_M));
}

export class DrivewayReversers {
  constructor(world, { enabled = false, seed = 1 } = {}) {
    this.world = world;
    this.enabled = !!enabled && !!world.map.driveways?.length;
    this.cars = [];
    this.made = 0;
    this.target = this.enabled ? 1 : 0;
    // (their own stream, drawn from only while the option is on)
    this.random = this.enabled ? rng(seed * 179426549 + 53) : null;
    this.next = this.enabled ? FIRST_S[0] + this.random() * (FIRST_S[1] - FIRST_S[0]) : Infinity;
    if (this.enabled) this.clearDriveways();
  }

  // Nobody parks across a driveway (city bylaws keep the kerb clear there): the parked cars standing in
  // the way a car backs out of each one are taken away, before anything is drawn.
  clearDriveways() {
    const parked = this.world.parked;
    for (const d of this.world.map.driveways) {
      const geo = drivewayGeometry(this.world.map, d, CAR);
      if (!geo) continue;
      const near = parked.near(geo.q[0], geo.q[1], 20);
      if (!near.length) continue;
      for (let s = 0; s <= geo.sEnd; s += 0.5) {
        const b = poseBox(geo.path, s, CAR);
        for (const c of near) if (!c.stay && parked.list.includes(c) && obbOverlap(b, c.obb(), 0.3)) {
          parked.remove(c);
          // (and nobody parks there later)
          if (c.slot) c.slot.reserved = "driveway";
        }
      }
    }
    parked.removed.length = 0;
  }

  near(x, y, r) {
    if (!this.cars.length) return [];
    return this.cars.filter((n) => Math.abs(n.x - x) < r + 5 && Math.abs(n.y - y) < r + 5);
  }

  // A car nose-in in driveway `d` (an entry of map.driveways), backing out once the driven car's front is
  // `trigger` metres short of it along `routeS` (its route arc length), or at once with trigger null.
  // Returns it, or null.
  place(d, { trigger = null, routeS = null, color = null, style = null, id = null } = {}) {
    const geo = drivewayGeometry(this.world.map, d, CAR);
    if (!geo) return null;
    const r = new Vehicle(geo.start.x, geo.start.y, geo.start.psi, 0, CAR);
    this.made++;
    Object.assign(r, { id: id || `reversing_${this.made}`, kind: "car", reverser: true, reverseLamps: false, color: color ?? COLORS[this.made % COLORS.length], style: style ?? (this.made % 6),
      driveway: d.id, geo, phase: trigger === null ? "creep" : "parked", trigger, routeS, ps: 0, waited: 0, pause: 0, since: this.world.t, frozen: 0 });
    if (r.phase === "creep") r.reverseLamps = true;
    this.cars.push(r);
    return r;
  }

  // Free drives: a driveway along the car's route, AHEAD_M along it, on the side of the lane the route
  // keeps to, with nothing parked or standing across its way out. Returns the car, or null.
  spawn() {
    const world = this.world, route = world.route, map = world.map, ego = world.ego;
    if (!route || route.length < 50) return null;
    const p = route.project(ego.x, ego.y, route.hint ?? 0);
    if (!p) return null;
    const front = p.s + ego.spec.length - ego.spec.rearOverhang;
    const options = [];
    for (let i = 0; i < route.edges.length; i++) {
      const start = route.edgeStarts[i];
      if (start > front + AHEAD_M[1]) break;
      const id = route.edges[i], lane = route.laneInfo(i);
      for (const d of map.driveways) {
        if (d.edge !== id) continue;
        const geo = drivewayGeometry(map, d, CAR);
        if (!geo || geo.laneIdx !== lane.idx) continue;
        const q = route.project(geo.q[0], geo.q[1], p.index);
        if (!q || q.s - front < AHEAD_M[0] || q.s - front > AHEAD_M[1]) continue;
        if (!this.clearWay(geo)) continue;
        options.push({ d, s: q.s });
      }
    }
    if (!options.length) return null;
    const pick = options[Math.floor(this.random() * options.length)];
    return this.place(pick.d, { trigger: TRIGGER_M[0] + this.random() * (TRIGGER_M[1] - TRIGGER_M[0]), routeS: pick.s });
  }

  // Nothing parked, standing or moving across the way out of a driveway.
  clearWay(geo) {
    const world = this.world, [x, y] = geo.q;
    const bodies = [...world.parked.near(x, y, 20), ...world.npcs.filter((n) => Math.abs(n.x - x) < 20 && Math.abs(n.y - y) < 20), ...this.cars];
    for (let s = 0; s <= geo.sEnd; s += 0.5) {
      const b = poseBox(geo.path, s, CAR);
      if (bodies.some((o) => obbOverlap(b, o.obb(), 0.3))) return false;
    }
    return true;
  }

  step(dt, fleet = null) {
    if (!this.enabled) return;
    const world = this.world, ego = world.ego;
    for (const r of [...this.cars]) {
      const far = Math.hypot(r.x - ego.x, r.y - ego.y) > RETIRE_M;
      // (one still in its driveway the car has gone by, or never came near, stays where it is)
      const passed = r.phase === "parked" && (far || world.t - r.since > GIVE_UP_S || this.egoFrontS(r) > r.routeS + 5);
      if (passed || r.phase === "gone" || (far && r.phase !== "parked")) this.retire(r);
    }
    if (this.cars.length < this.target && world.t >= this.next) {
      if (!this.spawn()) this.next = world.t + 5;
    }
    for (const r of [...this.cars]) this.drive(r, dt, fleet);
    this.holdPedestrians();
  }

  retire(r) {
    const i = this.cars.indexOf(r);
    if (i >= 0) this.cars.splice(i, 1);
    if (this.random) this.next = Math.max(this.next, this.world.t + NEXT_S[0] + this.random() * (NEXT_S[1] - NEXT_S[0]));
  }

  // The driven car's front along its route (Infinity without one).
  egoFrontS(r) {
    const route = this.world.route, ego = this.world.ego;
    if (!route || r.routeS === null) return -Infinity;
    const p = route.project(ego.x, ego.y, route.hint ?? 0);
    return p ? p.s + ego.spec.length - ego.spec.rearOverhang : -Infinity;
  }

  // Whether `r` can see `o`: by the world's line of sight, and past the cars parked at the kerb.
  sees(r, o) {
    const world = this.world;
    return world.visibility.sees(r, o) && !(world.hazards && reverserHidden(world, o, r));
  }

  // Whether the near lane is clear for `r` to back into: nothing it can see (or hear, within HEAR_M)
  // coming along it within COMMIT_M or COMMIT_S of where it will be; a vehicle standing short of it is
  // waiting for it.
  laneClear(r) {
    const world = this.world, g = r.geo, e0 = g.path.pointAt(g.sEnd);
    // (the spot: its rear bumper once in the lane)
    const end = [e0[0] - g.t[0] * r.spec.rearOverhang, e0[1] - g.t[1] * r.spec.rearOverhang];
    const spot = g.laneS - ARC_R - r.spec.rearOverhang - 0.5;
    const others = [world.ego, ...world.npcs, ...(world.contraflow?.riders || [])];
    for (const o of others) {
      if (o === r || o.parked || Math.abs(o.x - end[0]) > 90 || Math.abs(o.y - end[1]) > 90) continue;
      const spec = o.spec || CAR, f = spec.length - spec.rearOverhang;
      const fx = o.x + Math.cos(o.psi) * f, fy = o.y + Math.sin(o.psi) * f;
      // (along the lane's way, within its width of its line; or heading for the spot)
      const toEnd = Math.hypot(end[0] - fx, end[1] - fy);
      const aligned = Math.abs(wrap(o.psi - g.h)) < Math.PI / 3;
      const lp = projectPoint(g.lane.pts, g.lane.cum, [fx, fy]);
      const onLane = aligned && lp && Math.abs(lp.lateral) < g.e.lane_width / 2 + 0.6 && lp.s > 0.05 && lp.s < g.lane.cum[g.lane.cum.length - 1] - 0.1;
      const ahead = onLane ? spot - lp.s : ((end[0] - fx) * Math.cos(o.psi) + (end[1] - fy) * Math.sin(o.psi));
      const heading = onLane || (aligned && ahead > 0 && ahead / Math.max(toEnd, 1e-6) > 0.8);
      // (gone by: its rear past the driveway)
      if (!heading || ahead < -(spec.length + ARC_R + 3)) continue;
      if (ahead <= 0) return false;
      if (Math.max(0, o.v) < 0.5 && ahead > 3) continue;
      if (toEnd > HEAR_M && !this.sees(r, o)) continue;
      if (ahead < COMMIT_M || ahead / Math.max(0.1, o.v) < COMMIT_S) return false;
    }
    return true;
  }

  // Where `r` will be over the next second (and a little more) going on along its path.
  wayBoxes(r) {
    const g = r.geo, ahead = Math.min(g.sEnd, r.ps + 0.8 + Math.abs(r.v) * 1.0);
    return [poseBox(g.path, Math.min(g.sEnd, r.ps + 0.4), r.spec), poseBox(g.path, ahead, r.spec)];
  }

  // Whether something stands, or is about to be, in that way.
  blocked(r) {
    const world = this.world, boxes = this.wayBoxes(r);
    const [x, y] = r.center;
    const bodies = [world.ego, ...world.npcs, ...(world.contraflow?.riders || []), ...world.parked.near(x, y, 12), ...world.crowd.near(x, y, 10), ...this.cars];
    for (const o of bodies) {
      if (o === r || Math.abs(o.x - x) > 14 || Math.abs(o.y - y) > 14) continue;
      const margin = o.kind === "pedestrian" ? BLOCK_M + 0.5 : BLOCK_M;
      if (boxes.some((b) => obbOverlap(b, o.obb(), margin))) return true;
    }
    return false;
  }

  drive(r, dt, fleet) {
    const world = this.world, g = r.geo, path = g.path;
    if (r.frozen > 0) { r.frozen -= dt; r.v = 0; r.a = 0; return; }
    // (where it is along its way: near where it was)
    let best = null;
    for (let i = 0; i < path.pts.length - 1; i++) {
      if (path.cum[i + 1] < r.ps - 3 || path.cum[i] > r.ps + 4) continue;
      const [ax, ay] = path.pts[i], dx = path.pts[i + 1][0] - ax, dy = path.pts[i + 1][1] - ay, len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const u = Math.max(0, Math.min(1, ((r.x - ax) * dx + (r.y - ay) * dy) / (len * len)));
      const d = Math.hypot(r.x - ax - dx * u, r.y - ay - dy * u);
      if (!best || d < best.d) best = { s: path.cum[i] + u * len, d };
    }
    if (best) r.ps = Math.max(r.ps, best.s);
    if (r.phase === "parked") {
      r.v = 0;
      if (this.egoFrontS(r) >= r.routeS - r.trigger) { r.phase = "creep"; r.reverseLamps = true; }
      else return;
    }
    if (Math.hypot(r.x - world.ego.x, r.y - world.ego.y) < SEEN_M && activeReverser(r)) world.drivewaysSeen = true;
    let vt = 0;
    if (r.phase === "creep") {
      vt = r.ps < g.sCheck ? Math.min(CREEP_MPS, stopSpeedFor(g.sCheck - r.ps, 0.8) + 0.05) : 0;
      if (r.ps >= g.sCheck - 0.15 && Math.abs(r.v) < 0.05) { r.phase = "look"; r.waited = 0; }
    } else if (r.phase === "look") {
      r.waited += dt;
      if (r.waited >= LOOK_S && this.laneClear(r)) r.phase = "out";
    }
    if (r.phase === "out") {
      vt = Math.min(REVERSE_MPS, stopSpeedFor(g.sEnd - r.ps, 0.8) + 0.05);
      if (r.ps >= g.sEnd - 0.15) vt = 0;
      if (r.ps >= g.sEnd - 0.3 && Math.abs(r.v) < 0.05) {
        r.phase = "pause"; r.reverseLamps = false; r.pause = PAUSE_S[0] + this.random() * (PAUSE_S[1] - PAUSE_S[0]);
      }
    }
    if (r.phase === "pause") {
      r.pause -= dt;
      r.v = 0; r.a = 0;
      if (r.pause <= 0 && fleet) this.handOff(r, fleet);
      return;
    }
    if (vt > 0 && this.blocked(r)) vt = 0;
    // steering back along the path: pure pursuit with the car's rear as its nose
    const Ld = 2.5, [tx, ty] = path.pointAt(Math.min(path.length, r.ps + Ld));
    const alpha = wrap(Math.atan2(ty - r.y, tx - r.x) - (r.psi + Math.PI));
    const steer = -Math.atan2(2 * r.spec.wheelbase * Math.sin(alpha), Math.max(1, Math.hypot(tx - r.x, ty - r.y)));
    r.step(dt, { steer, accel: speedControl(r.v, -vt, { maxAccel: 1.5, maxBrake: 3 }), reverse: true });
    if (r.v > 0) r.v = 0;
  }

  // In drive, it joins the traffic in its lane as an ordinary car (sim/npc.js), from its own stream.
  handOff(r, fleet) {
    const map = this.world.map, g = r.geo, lane = g.lane;
    const s = projectPoint(lane.pts, lane.cum, [r.x, r.y], null).s;
    const car = new Vehicle(r.x, r.y, r.psi, 0, CAR);
    Object.assign(car, { id: `${r.id}_away`, color: r.color, style: r.style, v0: g.e.limit * 0.85,
      driver: { aMax: 1.3, b: 2, s0: 2, T: 1.4, react: 0.8, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
    car.path = new NpcPath(map, rng(Math.floor(this.random() * 2 ** 31) + 1), { world: this.world });
    if (this.world.busLanes) car.path.busLanePolicy = { clock: this.world.clock };
    car.path.start(g.e.id, g.laneIdx, s);
    fleet.vehicles.push(car);
    r.phase = "gone";
    this.retire(r);
  }

  // People on the sidewalk wait for a car backing out across it: anyone walking toward it within reach
  // of its way, who is not yet in it.
  holdPedestrians() {
    for (const r of this.cars) {
      if (r.phase !== "creep" && r.phase !== "look" && r.phase !== "out") continue;
      const b = r.obb(), sweep = { ...b, halfLength: b.halfLength + 1.2, halfWidth: b.halfWidth + 0.6 }, way = this.wayBoxes(r);
      for (const p of this.world.crowd.near(b.center[0], b.center[1], 8)) {
        if (p.crossing || p.crew || p.guard || p.held || p.frozen > 0) continue;
        // (someone already in its way, whom it waits for, walks on by: holding them too would leave both waiting)
        if (way.some((w) => obbOverlap(w, p.obb(), BLOCK_M + 0.5))) continue;
        const d = pointBoxDist([p.x, p.y], sweep);
        if (d > 1.8 || pointBoxDist([p.x, p.y], b) < 0.3) continue;
        const toward = Math.cos(p.psi) * (b.center[0] - p.x) + Math.sin(p.psi) * (b.center[1] - p.y);
        if (toward > 0) p.pause = Math.max(p.pause || 0, 0.25);
      }
    }
  }
}

// What a driver going along `line` does about the cars backing out near it: { hold (arc length its
// front must stop at), limit (its speed ceiling), reverser, kind } for the first that asks something of
// it, or null. `seen(r)`: whether it can see that one (the driven car); traffic sees what is there.
export function reverserAhead(world, line, { front, spec, lat = 0, seen = () => true, x, y }) {
  const cars = world.driveways?.cars;
  if (!cars?.length) return null;
  let out = null;
  for (const r of cars) {
    if (!activeReverser(r) || Math.abs(r.x - x) > CAUTION_M + 20 || Math.abs(r.y - y) > CAUTION_M + 20 || !seen(r)) continue;
    const c = reverserConflict(r, line, { front, spec, lat });
    if (!c) continue;
    const hold = c.kind === "in_lane" ? c.at - STOP_BACK_M : null;
    const limit = c.kind === "coming" ? cautionSpeed(c.gap_m) : null;
    if (!out || c.at < out.at) out = { at: c.at, gap_m: c.gap_m, hold, limit, reverser: r, kind: c.kind };
  }
  return out;
}

// Traffic (sim/npc.js): where driver `n` stops for a car backing out (arc length along its path for its
// front, or null), and its speed ceiling while one backs out ahead.
export function reverserYield(world, n, front) {
  if (n.reverser) return null;
  return reverserAhead(world, n.path, { front, spec: n.spec || CAR, x: n.x, y: n.y });
}

// The driven car's sensing (brain/sensors.js `reversing_vehicle`): the car backing out it must give room
// to first, as far as it can see. `wait`: stop with the front at `stop_s_route` (route arc length) until
// it has driven off; otherwise slow to `limit_mps`. Or null.
export function reversingVehicle(world, p, frontS, lane) {
  const { ego, route } = world;
  const c = reverserAhead(world, route, { front: frontS, spec: ego.spec, lat: lane?.center || 0, seen: (r) => world.sees(ego, r), x: ego.x, y: ego.y });
  if (!c) return null;
  const r = c.reverser, wait = c.kind === "in_lane" && c.hold > frontS - 1;
  const stopS = wait ? Math.max(c.hold, frontS) : null;
  return { id: r.id, phase: r.phase === "pause" ? "stopped_in_lane" : r.phase === "out" ? "backing_into_lane" : "backing_out", reverse_lights: !!r.reverseLamps,
    side: r.geo.sigma > 0 ? "right" : "left", gap_m: Math.max(0, c.gap_m), wait, stop_s_route: stopS, bumper_to_stop_m: wait ? stopS - frontS : null,
    limit_mps: wait ? null : c.limit ?? CAUTION_MPS, min_pass_m: PASS_CLEAR_M, speed: Math.abs(r.v) };
}

// The audit (World.audit): a car backing out near the driven car (`World.drivewaysSeen`, set as it
// drives); passing one backing out with less than PASS_CLEAR_M between them, moving; and not stopping
// for one in the lane (the car's front coming within AUDIT_STOP_M of it while it backs in, still moving).
// Both are `reversing_conflicts`, once per car each.
export function auditReversers(world) {
  const cars = world.driveways?.cars;
  if (!cars?.length) return;
  const ego = world.ego, calls = world.drivewayCalls ||= new Map(), egoBox = ego.obb();
  const count = (ev) => { world.violations.reversing_conflicts = (world.violations.reversing_conflicts || 0) + 1; world.events.push(ev); };
  for (const r of cars) {
    if (!activeReverser(r) || Math.abs(r.x - ego.x) > 30 || Math.abs(r.y - ego.y) > 30) continue;
    const call = calls.get(r.id) || { pass: false, stop: false };
    calls.set(r.id, call);
    const gap = boxGap(egoBox, r.obb());
    const local = ego.toLocal(...r.center);
    if (!call.pass && r.reverseLamps && ego.v > 1.5 && gap < PASS_CLEAR_M - AUDIT_SLACK_M && Math.abs(local.ahead - (ego.spec.length / 2 - ego.spec.rearOverhang)) < (ego.spec.length + r.spec.length) / 2 + 0.5) {
      call.pass = true;
      count({ type: "reversing_conflict", with: r.id, reason: "close_pass", clearance_m: Math.round(gap * 100) / 100, min_m: PASS_CLEAR_M });
    }
    if (!call.stop && r.phase === "out" && ego.v > 1.5 && gap < AUDIT_STOP_M && local.ahead > 0 && Math.abs(wrap(ego.psi - r.geo.h)) < Math.PI / 3) {
      call.stop = true;
      count({ type: "reversing_conflict", with: r.id, reason: "did_not_stop", clearance_m: Math.round(gap * 100) / 100 });
    }
  }
}

// What the HUD says about a car backing out ahead, or null: from the autopilot's sensing, or, driving by
// hand, one the car can see backing out within CAUTION_M ahead.
export function reverserNotice(snap, world = null) {
  let r = snap?.reversing_vehicle;
  if (!r && world && !snap) {
    const ego = world.ego;
    const near = world.driveways?.cars.find((c) => activeReverser(c) && ego.toLocal(c.x, c.y).ahead > 0 && Math.hypot(c.x - ego.x, c.y - ego.y) < CAUTION_M && world.sees(ego, c));
    if (near) r = { id: near.id, wait: near.phase === "out" || near.phase === "pause" };
  }
  if (!r) return null;
  if (r.wait) return { key: `${r.id}:wait`, text: "CAR BACKING OUT · GIVE IT ROOM", wait: true };
  return { key: `${r.id}:slow`, text: "CAR BACKING OUT AHEAD", wait: false };
}
