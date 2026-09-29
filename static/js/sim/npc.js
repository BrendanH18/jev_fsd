// Traffic: NPC cars that follow lanes, pick turns at junctions, keep gaps with the Intelligent
// Driver Model, and obey lights and stop signs. They also react to the ego car. Now and then a car
// parked up ahead of the ego signals, waits for a gap, and pulls out into the lane.

import { Vehicle, CAR, BIKE, comfort } from "./vehicle.js";
import { purePursuit } from "./controller.js";
import { cumulative, pointAt, headingAt, projectPoint, joinLanes } from "../map/mapdata.js";
import { phaseOf, StopMemory } from "./signals.js";
import { rng } from "../common.js";
import { wrap } from "./world.js";
import { ringBusy } from "./roundabout.js";
import { crosswalkConflict } from "./pedestrians.js";
import { current as weather } from "./weather.js";

const IDM = { aMax: 1.5, b: 2.0, s0: 2.0, T: 1.2 };

// Every driver is a little different: how hard they accelerate and brake, how much gap they keep,
// how long they take to get going when the car ahead moves off or the light changes, and how
// keen they are to change lanes. Drawn from their own seeded stream, so adding them does not move
// anyone's spawn point.
function driverProfile(random, bike = false) {
  const r = random();
  const assertive = r < 0.2, timid = r > 0.85;
  const pick = (lo, hi) => lo + random() * (hi - lo);
  return {
    aMax: bike ? pick(0.7, 1.1) : assertive ? pick(1.8, 2.4) : timid ? pick(1.0, 1.3) : pick(1.3, 1.8),
    b: assertive ? pick(2.4, 3.0) : timid ? pick(1.5, 1.9) : pick(1.8, 2.4),
    T: assertive ? pick(0.8, 1.05) : timid ? pick(1.5, 2.0) : pick(1.05, 1.5),
    s0: assertive ? pick(1.5, 2.0) : pick(2.0, 3.0),
    react: pick(0.4, 1.1) + (timid ? 0.4 : 0),
    lcRate: assertive ? 2.5 : timid ? 0.3 : 1,
  };
}
// Real-world paint mix: mostly white, grey, silver, and black, some blue and red.
const PALETTE = [0xeeeeea, 0x8d9299, 0x1a1c20, 0xc4c8cc, 0x2b3a55, 0x9b1e1e, 0xf2f2ee, 0x4a4f57, 0x0f1114, 0x6b7f5e, 0xb9b3a5];
const LOOK_M = 60;
export const BIKES = 12;
const BIKE_COLORS = [0x2b6cb0, 0xc53030, 0x2f855a, 0xd69e2e, 0x553c9a, 0x1a202c, 0xdd6b20];
const SHARP_TURN = 130 * Math.PI / 180;   // mirrors SHARP_TURN_DEG in jev/routing.py
const BOX_M = 9;
const LEADER_MARGIN_M = 0.3;    // beyond two half-widths: anything closer to the path is in the way

class NpcPath {
  // A path is a chain of lane polylines; we keep the current lane and the next one joined.
  constructor(map, random, { bike = false } = {}) { this.map = map; this.random = random; this.bike = bike; this.edges = []; this.pts = []; this.cum = [0]; this.length = 0; }
  start(edgeId, laneIdx, s, planned = []) {
    this.edges = [];
    this.pts = []; this.cum = [0]; this.length = 0;
    this.append(edgeId, laneIdx);
    for (const [id, lane] of planned) this.append(id, lane);
    this.s = s;
    this.extend();
  }
  // Move onto another lane of the current edge, keeping the edges already planned after it.
  switchLane(laneIdx, s) {
    const i = this.edges.indexOf(this.currentEdge());
    const cur = this.edges[i];
    this.start(cur.id, laneIdx, s, this.edges.slice(i + 1).map((e) => [e.id, e.lane]));
  }
  append(edgeId, laneIdx) {
    const lane = this.map.lane(edgeId, laneIdx) || this.map.lane(edgeId, 0);
    this.pts = joinLanes(this.pts, lane.pts);
    this.cum = cumulative(this.pts);
    this.length = this.cum[this.cum.length - 1];
    const edge = this.map.edges.get(edgeId);
    const sStart = this.edges.length ? this.edges[this.edges.length - 1].sEnd : 0;
    this.edges.push({ id: edgeId, lane: laneIdx, sStart, sEnd: this.length, control: edge.control || null, to: edge.to, limit: edge.limit });
  }
  extend() {
    // bounded: joining a very short lane after a rounded corner can add almost no length
    for (let guard = 0; guard < 24 && this.length - this.s < LOOK_M * 2.5; guard++) {
      const last = this.edges[this.edges.length - 1];
      const succ = this.map.successors(last.id);
      if (!succ.length) return false;
      // no U-turns, nor turns so sharp they double back (the tip of a traffic island)
      const noU = succ.filter((e) => Math.abs(this.map.turnAngle(last.id, e)) < SHARP_TURN);
      let pool = noU.length ? noU : succ;
      // cyclists keep to bike routes where they can
      if (this.bike) {
        const routes = pool.filter((id) => this.map.edges.get(id).bike);
        if (routes.length && this.random() < 0.85) pool = routes;
      }
      const next = pool[Math.floor(this.random() * pool.length)];
      const edge = this.map.edges.get(next);
      // turn into the nearest lane (left turns into the leftmost, right into the rightmost), and
      // keep the same lane going straight; a cyclist rides the curb lane
      const turn = this.map.classifyTurn(this.map.turnAngle(last.id, next));
      const lane = this.bike ? edge.lanes - 1 : turn === "left" ? 0 : turn === "right" ? edge.lanes - 1 : Math.min(last.lane, edge.lanes - 1);
      this.append(next, lane);
    }
    return true;
  }
  trim() {
    // drop edges fully behind us to keep the polyline short
    while (this.edges.length > 2 && this.edges[1].sStart + 30 < this.s) {
      const drop = this.edges.shift();
      const cut = this.cum.findIndex((c) => c >= drop.sEnd);
      if (cut <= 0) break;
      const removed = this.cum[cut];
      this.pts = this.pts.slice(cut);
      this.cum = cumulative(this.pts);
      this.length = this.cum[this.cum.length - 1];
      this.s -= removed;
      for (const e of this.edges) { e.sStart -= removed; e.sEnd -= removed; }
    }
  }
  currentEdge() { return this.edges.find((e) => this.s < e.sEnd) || this.edges[this.edges.length - 1]; }
  offsetPointAt(s, d) {
    const p = pointAt(this.pts, this.cum, s), h = headingAt(this.pts, this.cum, s);
    return [p[0] + Math.sin(h) * d, p[1] - Math.cos(h) * d];
  }
  pointAt(s) { return pointAt(this.pts, this.cum, s); }
  headingAt(s) { return headingAt(this.pts, this.cum, s); }
}

const smooth = (u) => { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); };

// Fastest speed from which a driver can brake comfortably to every bend's cornering speed over the
// next 40 m of the path. NPCs corner a little harder than the ego's comfort target.
function curveSpeed(path, s) {
  const { lat, decel } = comfort();
  let best = Infinity;
  for (let d = 0; d <= 40 && s + d < path.length; d += 3) {
    const at = s + d;
    const dh = Math.abs(wrap(path.headingAt(Math.min(path.length, at + 6)) - path.headingAt(Math.max(0, at - 6))));
    if (dh < 0.02) continue;
    const vc = Math.sqrt(lat * 1.25 * 12 / dh);
    best = Math.min(best, Math.sqrt(vc * vc + 2 * decel * d));
  }
  return best;
}

export class NpcFleet {
  constructor(world, { count = 40, bikes = BIKES, seed = 7 } = {}) {
    this.world = world;
    this.map = world.map;
    this.random = rng(seed);
    this.drivers = rng(seed * 7919 + 3);
    this.events = rng(seed * 104729 + 17);
    this.nextPull = 10 + this.events() * 12;
    this.pulled = 0;
    this.target = count;
    this.vehicles = [];
    this.spawn(count);
    this.spawnBikes(bikes);
    world.npcs = this.vehicles;
  }

  // Cyclists start on bike routes, in the curb lane, riding its right-hand side.
  spawnBikes(count) {
    const lanes = this.map.laneList.filter((l) => l.length > 25 && l.edgeRef.bike && l.idx === l.edgeRef.lanes - 1 && !l.edgeRef.ring);
    if (!lanes.length) return;
    const totalLen = lanes.reduce((a, l) => a + l.length, 0);
    let made = 0, attempts = 0;
    while (made < count && attempts++ < count * 20) {
      let pick = this.random() * totalLen;
      let lane = lanes[0];
      for (const l of lanes) { pick -= l.length; if (pick <= 0) { lane = l; break; } }
      const s = 5 + this.random() * (lane.length - 10);
      const p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - this.world.ego.x, p[1] - this.world.ego.y) < 30) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < 10)) continue;
      const v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0, BIKE);
      v.id = `bike_${++made}`;
      v.kind = "bike";
      v.color = BIKE_COLORS[made % BIKE_COLORS.length];
      v.path = new NpcPath(this.map, this.random, { bike: true });
      v.path.start(lane.edge, lane.idx, s);
      v.v0 = 4.2 + this.random() * 2.3;
      v.driver = driverProfile(this.drivers, true);
      v.stopMem = new StopMemory();
      v.frozen = 0;
      v.waiting = 0;
      this.vehicles.push(v);
    }
  }

  spawn(count) {
    const lanes = this.map.laneList.filter((l) => l.length > 25);
    const totalLen = lanes.reduce((a, l) => a + l.length, 0);
    let attempts = 0;
    while (this.vehicles.length < count && attempts++ < count * 20) {
      let pick = this.random() * totalLen;
      let lane = lanes[0];
      for (const l of lanes) { pick -= l.length; if (pick <= 0) { lane = l; break; } }
      const s = 5 + this.random() * (lane.length - 10);
      const p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - this.world.ego.x, p[1] - this.world.ego.y) < 30) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < 14)) continue;
      const v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
      v.id = `car_${this.vehicles.length + 1}`;
      v.color = PALETTE[this.vehicles.length % PALETTE.length];
      v.path = new NpcPath(this.map, this.random);
      v.path.start(lane.edge, lane.idx, s);
      v.v0 = lane.edgeRef.limit * (0.85 + this.random() * 0.2);
      v.driver = driverProfile(this.drivers);
      v.stopMem = new StopMemory();
      v.frozen = 0;
      v.waiting = 0;
      this.vehicles.push(v);
    }
  }

  step(dt) {
    const world = this.world;
    this.nextPull -= dt;
    if (this.nextPull <= 0) { this.nextPull = 14 + this.events() * 18; this.maybePullOut(); }
    const all = [world.ego, ...this.vehicles];
    for (const n of this.vehicles) {
      if (n.frozen > 0) { n.frozen -= dt; n.v = 0; continue; }
      if (n.pull && n.pull.wait > 0) {
        // still parked: indicator on, waiting for a gap in the lane
        n.signal = n.pull.lat > 0 ? "left" : "right";
        if (this.pullClear(n)) n.pull.wait -= dt;
        n.v = 0;
        continue;
      }
      if (n.backoff) { this.backOff(n, dt); continue; }
      if (n.holdFor > 0) { n.holdFor -= dt; n.step(dt, { steer: n.delta, accel: -3 }); if (n.v < 0) n.v = 0; continue; }
      const path = n.path;
      if (n.lc && n.lc.t >= n.lc.T) {
        // the lane change is done: follow the new lane from here
        const lane = this.map.lane(n.lc.edge, n.lc.to);
        if (lane && path.currentEdge().id === n.lc.edge) path.switchLane(n.lc.to, projectPoint(lane.pts, lane.cum, [n.x, n.y], null).s);
        n.lc = null;
        n.lcCooldown = 6;
      }
      const proj = projectPoint(path.pts, path.cum, [n.x, n.y], null);
      path.s = proj.s;
      if (proj.distance > 6) { this.respawn(n); continue; }
      path.extend();
      path.trim();
      const edge = path.currentEdge();
      const spec = n.spec;
      const front = path.s + (spec.length - spec.rearOverhang);
      // lane change in progress: the lateral offset eases over the maneuver, then the path moves
      // onto the new lane
      if (n.lc) {
        n.lc.t += dt;
        if (n.lc.edge !== edge.id) n.lc = null;   // ran out of edge: the next junction's join takes over
      } else {
        n.lcCooldown = Math.max(0, (n.lcCooldown || 0) - dt);
        this.maybeChangeLane(n, edge, front);
      }
      // a cyclist rides the right-hand side of the lane, clear of the car doors
      const keepRight = n.kind === "bike" ? Math.max(0, this.map.edges.get(edge.id).lane_width / 2 - 0.75) : 0;
      let offset = keepRight + (n.lc ? n.lc.dir * n.lc.width * smooth(n.lc.t / n.lc.T) : 0);
      if (n.pull) {
        // easing out of the parking lane onto the lane's line
        n.pull.t += dt;
        offset += n.pull.lat * (1 - smooth(n.pull.t / n.pull.T));
        if (n.pull.t >= n.pull.T) n.pull = null;
      }

      // leader: nearest vehicle ahead on our path within LOOK_M (a parked car only when it sticks
      // out into the lane)
      let gap = Infinity, leadV = n.v0, leader = null;
      for (const o of all.concat(world.parked.near(n.x, n.y, LOOK_M))) {
        if (o === n) continue;
        if (Math.abs(o.x - n.x) > LOOK_M + 5 || Math.abs(o.y - n.y) > LOOK_M + 5) continue;
        const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
        if (!p || p.s <= path.s + 0.5 || p.s > path.s + LOOK_M) continue;
        // in the way on the current lane, or on the target lane of a lane change: closer to the
        // path than the two half-widths plus a margin
        const lat = p.lateral;
        const reach = (spec.width + (o.spec || CAR).width) / 2 + LEADER_MARGIN_M;
        if (Math.abs(lat - offset) > reach && (!n.lc || Math.abs(lat - n.lc.dir * n.lc.width) > reach) && Math.abs(lat - keepRight) > reach) continue;
        // rear axle to rear axle, less our axle-to-front-bumper and its rear overhang
        const g = p.s - path.s - (spec.length - spec.rearOverhang) - (o.spec || CAR).rearOverhang;
        if (g < gap) { gap = g; leadV = o.v; leader = o; }
      }
      n.lead = gap < Infinity ? { gap, v: leadV } : null;
      // virtual leaders: stop lines
      let stopAt = null;
      for (const e of path.edges) {
        if (!e.control || e.sEnd < path.s) continue;
        const sLine = e.sStart + e.control.s_line - (e === path.edges[0] ? 0 : 0);
        const lineS = e.sStart + (e.control.s_line / Math.max(1, this.map.edges.get(e.id).length)) * (e.sEnd - e.sStart);
        const bumperToLine = lineS - front;
        if (bumperToLine < -1) continue;
        if (bumperToLine > 70) break;
        if (e.control.type === "signal") {
          const st = phaseOf(this.map.intersections.get(e.control.id), world.t)[e.control.group];
          const canStop = bumperToLine > n.v * n.v / (2 * Math.min(4, comfort().hardDecel)) + 1;
          if (st === "red" || (st === "yellow" && canStop)) stopAt = bumperToLine;
        } else if (e.control.type === "yield") {
          // roundabout entry: wait at the line while someone in the ring would arrive first
          if (bumperToLine < 12 && ringBusy(this.map.roundabouts.get(e.control.roundabout), this.map.nodes.get(e.to), all, n)) stopAt = bumperToLine;
        } else {
          const state = n.stopMem.update(e.control, bumperToLine, n.v, dt);
          if (state !== "completed") stopAt = bumperToLine;
          // stopped: go when the junction is clear and, at a two-way stop, when nothing on the
          // through road would get there first
          else if (this.boxBusy(n, e) || (!e.control.all_way && this.crossComing(n, e.to))) stopAt = Math.max(0, bumperToLine);
        }
        break;
      }
      // a pedestrian crossing ahead on the path: stop short of the crosswalk
      const cw = crosswalkConflict(path.pts, path.cum, front - 2, front + 35, world.crowd, spec.width / 2 + 0.9);
      if (cw) stopAt = stopAt === null ? cw.s - front - 2 : Math.min(stopAt, cw.s - front - 2);
      if (stopAt !== null && stopAt < gap) { gap = Math.max(0.05, stopAt); leadV = 0; }
      // the next junction: which way we turn there, and the indicator for it
      const ji = path.edges.findIndex((e) => e.sEnd > front);
      const cur = path.edges[ji], after = path.edges[ji + 1];
      const toNode = cur ? cur.sEnd - front : Infinity;
      const turn = after ? this.map.classifyTurn(this.map.turnAngle(cur.id, after.id)) : "straight";
      n.signal = n.pull ? (n.pull.lat > 0 ? "left" : "right") : n.lc ? (n.lc.dir < 0 ? "left" : "right") : toNode < 35 && (turn === "left" || turn === "right") ? turn : null;
      // turning left: yield to oncoming traffic before crossing its lane
      if (stopAt === null && turn === "left" && toNode > 3 && toNode < 25 && this.oncoming(n, cur.to)) {
        gap = Math.min(gap, Math.max(0.05, toNode - 5)); leadV = 0;
      }
      // junction with no sign or signal ahead: yield to anyone already crossing it
      if (stopAt === null) {
        const next = path.edges.find((e) => e.sEnd > front);
        const toNode = next ? next.sEnd - front : Infinity;
        if (next && !next.control && toNode > 5 && toNode < 25 && this.isJunction(next.to) && this.boxBusy(n, next)) {
          gap = Math.min(gap, Math.max(0.05, toNode - 6)); leadV = 0;
        }
      }
      // intersection box rule for signals too: don't enter while a crossing car is inside
      if (stopAt === null && edge.control && edge.control.type === "signal") {
        const lineS = edge.sStart + (edge.control.s_line / Math.max(1, this.map.edges.get(edge.id).length)) * (edge.sEnd - edge.sStart);
        const b = lineS - front;
        if (b > -1 && b < 6 && this.boxBusy(n, edge)) { gap = Math.min(gap, Math.max(0.05, b)); leadV = 0; }
      }
      // nose to nose with someone stopped in our path who is waiting for us in turn (a car turning
      // across our lane, say): after a few seconds, back up and let them through
      if (leader && !leader.parked && n.v < 0.2 && gap < 5 && Math.abs(leader.v) < 0.3 && Math.abs(wrap(leader.psi - n.psi)) > 2.2) {
        n.standoff = (n.standoff || 0) + dt;
        if (n.standoff > 3) { n.standoff = 0; n.backoff = { left: 6, t: 0 }; }
      } else n.standoff = 0;
      // deadlock release
      if (n.v < 0.2 && gap < 3) n.waiting += dt; else n.waiting = 0;
      if (n.waiting > 15 && stopAt !== null && stopAt < 1 && leadV === 0 && !this.blockedByVehicle(n) && !(cur && this.crossComing(n, cur.to))) { gap = Infinity; leadV = n.v0; n.waiting = 0; }

      // curvature-limited desired speed: slow in time for every bend in the next 40 m
      const vCurve = curveSpeed(path, path.s);
      const v0 = Math.min(n.v0 * weather.speed, edge.limit * 1.05 * weather.speed, vCurve, n.pull ? 5 : Infinity);
      const D = n.driver || IDM;
      let a;
      if (gap === Infinity) a = D.aMax * (1 - Math.pow(n.v / v0, 4));
      else {
        const dv = n.v - leadV;
        // on a slippery road drivers leave more room and brake more gently
        const grip = Math.min(1, comfort().decel / 2.5);
        const b = D.b * grip, T = D.T / Math.max(0.5, grip);
        const sStar = D.s0 + Math.max(0, n.v * T + n.v * dv / (2 * Math.sqrt(D.aMax * b)));
        a = D.aMax * (1 - Math.pow(n.v / v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
      }
      a = Math.max(-Math.min(6, comfort().hardDecel * 1.1), Math.min(D.aMax, a));
      // standing still, a driver takes a moment to notice the way is clear and move off
      if (n.v < 0.3 && a > 0.2) { n.ready = (n.ready || 0) + dt; if (n.ready < (D.react || 0)) a = -1; }
      else if (n.v > 1) n.ready = 0;
      if (n.v < 0.05 && a < 0) a = -1;   // stopped: hold the brakes rather than creep
      // wedged at an angle to its lane (a turn taken wide, then blocked): put it back on the lane
      if (n.waiting > 10 && Math.abs(wrap(n.psi - path.headingAt(path.s))) > 0.35) { this.respawn(n); continue; }
      const steer = purePursuit(n, path, path.s, offset);
      n.step(dt, { steer, accel: a });
      if (n.v < 0) n.v = 0;
    }
  }

  // Reverse slowly, straight back, until clear by `left` meters, blocked behind, or out of time;
  // then hold a few seconds while the other vehicle goes.
  backOff(n, dt) {
    const b = n.backoff;
    b.t += dt;
    b.left -= Math.abs(n.v) * dt;
    let behind = Infinity;
    for (const o of this.world.obstaclesNear(n.x, n.y, 12)) {
      if (o === n) continue;
      const l = n.toLocal(o.x, o.y);
      if (l.ahead < 0 && Math.abs(l.right) < 1.6) behind = Math.min(behind, -l.ahead - n.spec.rearOverhang - (o.spec ? o.spec.length - o.spec.rearOverhang : 3.6));
    }
    const done = b.left <= 0 || b.t > 7 || behind < 1.5;
    n.step(dt, { steer: 0, accel: done ? (n.v < -0.05 ? 3 : 0) : Math.max(-1.5, (-1.5 - n.v) * 1.5), reverse: true });
    n.signal = null;
    if (done && n.v > -0.05) { n.v = 0; n.backoff = null; n.holdFor = 5; }
  }

  // A car parked 20 to 90 m ahead of the ego gets ready to pull out. It becomes traffic; to keep the
  // count steady, the traffic car farthest from the ego (well out of sight) leaves.
  maybePullOut() {
    const world = this.world, ego = world.ego, map = this.map;
    const cx = ego.x + Math.cos(ego.psi) * 55, cy = ego.y + Math.sin(ego.psi) * 55;
    const near = world.parked.near(cx, cy, 45).filter((c) => { const l = ego.toLocal(c.x, c.y); return l.ahead > 20 && l.ahead < 90 && c.edge; });
    if (!near.length) return null;
    const car = near[Math.floor(this.events() * near.length)];
    const e = map.edges.get(car.edge);
    const laneIdx = car.curb === "right" ? e.lanes - 1 : 0;
    const lane = map.lane(e.id, laneIdx);
    if (!lane) return null;
    const proj = projectPoint(lane.pts, lane.cum, [car.x, car.y], null);
    if (!proj || proj.s < 6 || proj.s > lane.length - 20 || Math.abs(proj.lateral) > 4.5) return null;
    if (!world.parked.remove(car)) return null;
    const v = new Vehicle(car.x, car.y, car.psi, 0);
    v.id = `car_p${++this.pulled}`;
    v.color = car.color;
    v.style = car.style;
    v.path = new NpcPath(map, this.random);
    v.path.start(e.id, laneIdx, proj.s);
    v.v0 = e.limit * (0.85 + this.events() * 0.2);
    v.driver = driverProfile(this.events);
    v.stopMem = new StopMemory();
    v.frozen = 0;
    v.waiting = 0;
    v.pull = { lat: proj.lateral, t: 0, T: 3.5, wait: 1.5 + this.events() * 2.5 };
    this.vehicles.push(v);
    const cars = this.vehicles.filter((k) => k.kind !== "bike");
    if (cars.length > this.target) {
      let far = null;
      for (const k of cars) {
        if (k.pull) continue;
        const d = Math.hypot(k.x - ego.x, k.y - ego.y);
        if (d > 150 && (!far || d > far.d)) far = { k, d };
      }
      if (far) this.vehicles.splice(this.vehicles.indexOf(far.k), 1);
    }
    return v;
  }

  // Nothing in the lane coming up behind within a few seconds (less for an assertive driver), and
  // nothing stopped right in front.
  pullClear(n) {
    const path = n.path;
    const gap = n.driver && n.driver.T < 1.05 ? 3.5 : 5;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || Math.abs(o.x - n.x) > 70 || Math.abs(o.y - n.y) > 70) continue;
      const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
      if (!p || Math.abs(p.lateral) > 2.6) continue;
      const ds = p.s - path.s;
      if (ds > -1 && ds < 8) return false;
      if (ds <= -1 && ds > -60 && o.v > 0.5 && (-ds - 5) / o.v < gap) return false;
    }
    return true;
  }

  // Start a lane change when the lane is wrong for the next turn, or, now and then, to get past a
  // slow car. Only mid-block on multi-lane edges, and only into a gap that is free well behind and
  // ahead in the target lane.
  maybeChangeLane(n, edge, front) {
    const e = this.map.edges.get(edge.id);
    if (!e || e.lanes < 2 || n.v < 3 || n.lcCooldown > 0 || n.kind === "bike" || n.pull) return;
    const toEnd = edge.sEnd - front;
    if (toEnd < 30) return;
    if (edge.control) {
      const lineS = edge.sStart + (edge.control.s_line / Math.max(1, e.length)) * (edge.sEnd - edge.sStart);
      if (lineS - front < 30 && lineS - front > -5) return;
    }
    const path = n.path;
    const i = path.edges.indexOf(edge), after = path.edges[i + 1];
    const turn = after ? this.map.classifyTurn(this.map.turnAngle(edge.id, after.id)) : "straight";
    let dir = 0;
    if (turn === "left" && edge.lane > 0) dir = -1;
    else if (turn === "right" && edge.lane < e.lanes - 1) dir = 1;
    else if (turn === "straight" && n.lead && n.lead.gap < 35 && n.lead.v < n.v0 - 2.5 && this.random() < 0.02 * (n.driver ? n.driver.lcRate : 1)) {
      dir = edge.lane > 0 ? -1 : 1;
    }
    if (!dir) return;
    const to = edge.lane + dir;
    if (to < 0 || to >= e.lanes) return;
    const lane = this.map.lane(edge.id, to);
    const me = projectPoint(lane.pts, lane.cum, [n.x, n.y], null);
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || Math.abs(o.x - n.x) > 60 || Math.abs(o.y - n.y) > 60) continue;
      const p = projectPoint(lane.pts, lane.cum, [o.x, o.y], null);
      if (!p || Math.abs(p.lateral) > 2.2) continue;
      const ds = p.s - me.s;
      const need = ds >= 0 ? 8 + Math.max(0, n.v - o.v) * 2 : 8 + Math.max(0, o.v - n.v) * 2.5;
      if (Math.abs(ds) < need + CAR.length) return;
    }
    n.lc = { dir, to, edge: edge.id, width: Math.abs(e.lane_offsets[to] - e.lane_offsets[edge.lane]), t: 0, T: 3.5 };
  }

  // Someone coming the other way who will reach this node within 6 s (a slow left turn needs
  // about that long to clear the oncoming lane).
  oncoming(n, nodeId) {
    const node = this.map.nodes.get(nodeId);
    if (!node) return false;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || o.v < 1) continue;
      if (Math.abs(wrap(o.psi - n.psi)) < Math.PI * 5 / 6) continue;
      const dx = node.x - o.x, dy = node.y - o.y, d = Math.hypot(dx, dy);
      if (d > 80 || dx * Math.cos(o.psi) + dy * Math.sin(o.psi) < 0) continue;
      if (d / o.v < 6) return true;
    }
    return false;
  }

  // Anyone moving who will reach this node before we could get across: within the driver's accepted
  // gap (4.5 to 6.5 s; the bolder the driver, the shorter).
  crossComing(n, nodeId) {
    const node = this.map.nodes.get(nodeId);
    if (!node) return false;
    const gapS = n.driver ? 3.2 + n.driver.T * 1.7 : 5;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n || o.v < 1) continue;
      if (Math.abs(wrap(o.psi - n.psi)) < Math.PI / 6) continue;   // going our way
      const dx = node.x - o.x, dy = node.y - o.y, d = Math.hypot(dx, dy);
      if (d > 90 || d < 1) continue;
      const closing = (dx * Math.cos(o.psi) + dy * Math.sin(o.psi)) / d;
      if (closing > 0.7 && d / o.v < gapS) return true;
    }
    return false;
  }

  isJunction(nodeId) {
    if (!this.junctions) this.junctions = new Map();
    if (!this.junctions.has(nodeId)) {
      const ids = [...(this.map.inn.get(nodeId) || []), ...(this.map.out.get(nodeId) || [])];
      const neighbors = new Set(ids.map((id) => { const e = this.map.edges.get(id); return e.from === nodeId ? e.to : e.from; }));
      this.junctions.set(nodeId, neighbors.size >= 3);
    }
    return this.junctions.get(nodeId);
  }

  boxBusy(n, e) {
    const node = this.map.nodes.get(e.to);
    if (!node) return false;
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n) continue;
      if (Math.hypot(o.x - node.x, o.y - node.y) > BOX_M) continue;
      const diff = Math.abs(wrap(o.psi - n.psi));
      if (diff > Math.PI / 6 && diff < Math.PI * 5 / 6) return true;
    }
    return false;
  }

  blockedByVehicle(n) {
    for (const o of [this.world.ego, ...this.vehicles]) {
      if (o === n) continue;
      const local = n.toLocal(o.x, o.y);
      if (local.ahead > 0 && local.ahead < 8 && Math.abs(local.right) < 2) return true;
    }
    return false;
  }

  respawn(n) {
    const near = this.map.nearestLane(n.x, n.y, n.psi, 40);
    if (!near) return;
    n.x = near.point[0]; n.y = near.point[1]; n.psi = near.heading; n.v = 0; n.delta = 0; n.a = 0;
    n.path.start(near.lane.edge, near.lane.idx, near.s);
    n.stopMem.reset();
    n.lc = null;
  }
}
