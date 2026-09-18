// Traffic: NPC cars that follow lanes, pick turns at junctions, keep gaps with the Intelligent
// Driver Model, and obey lights and stop signs. They also react to the ego car.

import { Vehicle, CAR } from "./vehicle.js";
import { purePursuit } from "./controller.js";
import { cumulative, pointAt, headingAt, projectPoint, dist } from "../map/mapdata.js";
import { phaseOf, StopMemory } from "./signals.js";
import { rng } from "../common.js";
import { wrap } from "./world.js";

const IDM = { aMax: 1.5, b: 2.0, s0: 2.0, T: 1.2 };
const PALETTE = [0xd94f4f, 0xf2b84b, 0xe8e8e8, 0x8a8f99, 0x3fb783, 0xc57bd9, 0x2a2e35];
const LOOK_M = 60;
const BOX_M = 9;

class NpcPath {
  // A path is a chain of lane polylines; we keep the current lane and the next one joined.
  constructor(map, random) { this.map = map; this.random = random; this.edges = []; this.pts = []; this.cum = [0]; this.length = 0; }
  start(edgeId, laneIdx, s) {
    this.edges = [];
    this.pts = []; this.cum = [0]; this.length = 0;
    this.append(edgeId, laneIdx);
    this.s = s;
    this.extend();
  }
  append(edgeId, laneIdx) {
    const lane = this.map.lane(edgeId, laneIdx) || this.map.lane(edgeId, 0);
    const start = this.pts.length;
    const pts = lane.pts;
    if (this.pts.length && dist(this.pts[this.pts.length - 1], pts[0]) > 0.05) this.pts.push(pts[0]);
    for (let i = this.pts.length ? 1 : 0; i < pts.length; i++) this.pts.push(pts[i]);
    if (this.pts.length === pts.length && start === 0) { /* first lane */ }
    this.cum = cumulative(this.pts);
    this.length = this.cum[this.cum.length - 1];
    const edge = this.map.edges.get(edgeId);
    const sStart = this.edges.length ? this.edges[this.edges.length - 1].sEnd : 0;
    this.edges.push({ id: edgeId, lane: laneIdx, sStart, sEnd: this.length, control: edge.control || null, to: edge.to, limit: edge.limit });
  }
  extend() {
    while (this.length - this.s < LOOK_M * 2.5) {
      const last = this.edges[this.edges.length - 1];
      const succ = this.map.successors(last.id);
      if (!succ.length) return false;
      const noU = succ.filter((e) => this.map.classifyTurn(this.map.turnAngle(last.id, e)) !== "uturn");
      const pool = noU.length ? noU : succ;
      const next = pool[Math.floor(this.random() * pool.length)];
      const edge = this.map.edges.get(next);
      this.append(next, Math.floor(this.random() * edge.lanes));
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

export class NpcFleet {
  constructor(world, { count = 40, seed = 7 } = {}) {
    this.world = world;
    this.map = world.map;
    this.random = rng(seed);
    this.vehicles = [];
    this.spawn(count);
    world.npcs = this.vehicles;
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
      v.stopMem = new StopMemory();
      v.frozen = 0;
      v.waiting = 0;
      this.vehicles.push(v);
    }
  }

  step(dt) {
    const world = this.world;
    const all = [world.ego, ...this.vehicles];
    for (const n of this.vehicles) {
      if (n.frozen > 0) { n.frozen -= dt; n.v = 0; continue; }
      const path = n.path;
      const proj = projectPoint(path.pts, path.cum, [n.x, n.y], null);
      path.s = proj.s;
      if (proj.distance > 6) { this.respawn(n); continue; }
      path.extend();
      path.trim();
      const edge = path.currentEdge();
      const front = path.s + (CAR.length - CAR.rearOverhang);

      // leader: nearest vehicle ahead on our path within LOOK_M
      let gap = Infinity, leadV = n.v0;
      for (const o of all) {
        if (o === n) continue;
        const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
        if (!p || p.distance > 1.6 + 1.5 || p.s <= path.s + 0.5 || p.s > path.s + LOOK_M) continue;
        const g = p.s - path.s - CAR.length;
        if (g < gap) { gap = g; leadV = o.v; }
      }
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
          const canStop = bumperToLine > n.v * n.v / (2 * 4) + 1;
          if (st === "red" || (st === "yellow" && canStop)) stopAt = bumperToLine;
        } else {
          const state = n.stopMem.update(e.control, bumperToLine, n.v, dt);
          if (state !== "completed") stopAt = bumperToLine;
          else if (this.boxBusy(n, e)) stopAt = Math.max(0, bumperToLine);
        }
        break;
      }
      if (stopAt !== null && stopAt < gap) { gap = Math.max(0.05, stopAt); leadV = 0; }
      // intersection box rule for signals too: don't enter while a crossing car is inside
      if (stopAt === null && edge.control && edge.control.type === "signal") {
        const lineS = edge.sStart + (edge.control.s_line / Math.max(1, this.map.edges.get(edge.id).length)) * (edge.sEnd - edge.sStart);
        const b = lineS - front;
        if (b > -1 && b < 6 && this.boxBusy(n, edge)) { gap = Math.min(gap, Math.max(0.05, b)); leadV = 0; }
      }
      // deadlock release
      if (n.v < 0.2 && gap < 3) n.waiting += dt; else n.waiting = 0;
      if (n.waiting > 15 && stopAt !== null && stopAt < 1 && leadV === 0 && !this.blockedByVehicle(n)) { gap = Infinity; leadV = n.v0; n.waiting = 0; }

      // curvature-limited desired speed
      const h0 = path.headingAt(path.s), h1 = path.headingAt(Math.min(path.length, path.s + 12));
      const dh = Math.abs(wrap(h1 - h0));
      const vCurve = dh > 0.05 ? Math.sqrt(2.2 * 12 / dh) : Infinity;
      const v0 = Math.min(n.v0, edge.limit * 1.05, vCurve);
      let a;
      if (gap === Infinity) a = IDM.aMax * (1 - Math.pow(n.v / v0, 4));
      else {
        const dv = n.v - leadV;
        const sStar = IDM.s0 + Math.max(0, n.v * IDM.T + n.v * dv / (2 * Math.sqrt(IDM.aMax * IDM.b)));
        a = IDM.aMax * (1 - Math.pow(n.v / v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
      }
      a = Math.max(-6, Math.min(IDM.aMax, a));
      if (n.v < 0.05 && a < 0) a = 0;
      const steer = purePursuit(n, path, path.s, 0);
      n.step(dt, { steer, accel: a });
      if (n.v < 0) n.v = 0;
    }
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
    n.x = near.point[0]; n.y = near.point[1]; n.psi = near.heading; n.v = 0; n.delta = 0;
    n.path.start(near.lane.edge, near.lane.idx, near.s);
    n.stopMem.reset();
  }
}
