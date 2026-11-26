// Emergency vehicles in traffic (sim/emergency.js), the fleet's side of the emergency record
// (sim/features/emergency.js): dispatching them now and then, stepping one with its siren on, and how
// other drivers give way to one and hang back behind it. Its state is `fleet.emergency`.

import { rng } from "../common.js";
import { headingAt, pointAt, projectPoint } from "../map/mapdata.js";
import { CAR, Vehicle, comfort } from "./vehicle.js";
import { purePursuit } from "./controller.js";
import { StopMemory, approachPhase, movementSignal } from "./signals.js";
import { obbOverlap } from "./collision.js";
import { crosswalkConflict } from "./pedestrians.js";
import { current as weather } from "./weather.js";
import { pathLine } from "./traffic-geometry.js";
import { controlAt } from "./features/index.js";
import {
  IDM,
  LEADER_MARGIN_M,
  LOOK_M,
  NpcPath,
  bodySweepLook,
  curveSpeed,
  featureTrafficSpeed,
  sweptBodyGap,
} from "./npc.js";
import {
  EMERGENCY_SPECS,
  EV_JUNCTION_MPS,
  EV_LIMIT_FACTOR,
  EV_MAX_MPS,
  EV_PASS_LOOK_M,
  EV_SQUEEZE_M,
  EV_SQUEEZE_MPS,
  EV_STAND_DOWN_S,
  FOLLOW_M,
  IN_WAY_M,
  closestOnPath,
  evOffset,
  isEmergency,
  isEmergencyVehicle,
  isJunction as junctionAt,
  leadsEmergency,
  nearestCall,
  planBehind,
  planCrossing,
  planOncoming,
  pullOverOffset,
  threadGap,
} from "./emergency.js";

// Giving way to an emergency vehicle (sim/emergency.js): a driver eases over at up to 0.8 m/s and
// stops within its stopping distance braking at 1.5 m/s^2 (3.5 m/s^2 for one coming toward it or
// across its way; at least 4 m on), short of the next junction
// (2.5 m short of its crossing street) if it can stop there braking at up to 3.5 m/s^2, else just
// past it, its rear clear. It carries on 1.5 s after the vehicle no longer calls on it.
const EV_SHIFT_MPS = 0.8;
const EV_STOP_DECEL = 1.5;
const EV_FIRM_DECEL = 3.5;
const EV_RELEASE_S = 1.5;
const EV_CROSSING_M = 1.5;
const EV_BODY_LOOK_M = 4; // an emergency vehicle passes something moving across its way at least this far off
// Emergency vehicles in free drives: the first 60 to 120 s in, then one every 2.5 to 5 minutes;
// one leaves once it is more than 220 m from the car, or after 4 minutes.
const EV_FIRST_S = [60, 120];
const EV_EVERY_S = [150, 300];
const EV_GONE_M = 220;
const EV_MAX_AGE_S = 240;
// Stood down beside another car, an emergency vehicle eases back to its lane's line at EV_SHIFT_MPS once its
// body, rolled on along that line this far or its braking distance, clears what is near by the usual margin.
const REJOIN_LOOK_M = 6;

export class EmergencyTraffic {
  constructor(fleet, enabled, seed) {
    this.fleet = fleet;
    this.enabled = enabled;
    // (their own stream, so dispatching them leaves the rest of the traffic as it was; the first dispatch
    // time is drawn from it even with dispatch off)
    this.sirens = rng(seed * 92821 + 7);
    this.next = EV_FIRST_S[0] + this.sirens() * (EV_FIRST_S[1] - EV_FIRST_S[0]);
    this.dispatched = 0;
    this.evs = [];
  }

  // Each step, before the transit: send one now and then (one at a time, stood down or not), and take
  // off those that have done.
  manage(dt) {
    const fleet = this.fleet;
    if (this.enabled) {
      this.next -= dt;
      // (one at a time, stood down or not)
      if (this.next <= 0 && !fleet.vehicles.some(isEmergencyVehicle)) {
        this.next = EV_EVERY_S[0] + this.sirens() * (EV_EVERY_S[1] - EV_EVERY_S[0]);
        this.dispatch();
      }
    }
    this.retire();
    this.evs = fleet.vehicles.filter(isEmergency);
  }

  // Send an emergency vehicle past the driven car (sim/emergency.js): up behind it along its street,
  // toward it down the street, or across the junction ahead of it, whichever the streets allow (in
  // a random order, or `relation`). Returns the vehicle, or null.
  dispatch({ relation = null, kind = null, distance = null } = {}) {
    const fleet = this.fleet;
    const ego = fleet.world.ego,
      map = fleet.map;
    const plans = { behind: planBehind, ahead: planOncoming, crossing: planCrossing };
    const order = relation ? [relation] : Object.keys(plans);
    for (let i = order.length - 1; i > 0 && !relation; i--) {
      const j = Math.floor(this.sirens() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const rel of order) {
      const plan = plans[rel](map, ego.x, ego.y, ego.psi, ...(distance ? [distance] : []));
      const lane = plan && (map.lane(plan.edge, plan.lane) || map.lane(plan.edge, 0));
      if (!lane) continue;
      const k = kind || (this.sirens() < 0.7 ? "ambulance" : "fire_truck"),
        spec = EMERGENCY_SPECS[k];
      const p = pointAt(lane.pts, lane.cum, plan.s),
        psi = headingAt(lane.pts, lane.cum, plan.s);
      const side = evOffset(lane.edgeRef, lane.idx, spec);
      const x = p[0] + Math.sin(psi) * side,
        y = p[1] - Math.cos(psi) * side;
      // (not on top of anything)
      if ([ego, ...fleet.vehicles].some((o) => Math.hypot(o.x - x, o.y - y) < spec.length + 2)) continue;
      const v = new Vehicle(x, y, psi, Math.min(10, lane.edgeRef.limit), spec);
      Object.assign(v, {
        id: `${k}_${++this.dispatched}`,
        kind: k,
        siren: true,
        color: k === "ambulance" ? 0xf2f2ee : 0xb3121b,
        side,
        age: 0,
        relation: plan.relation,
        v0: Math.min(EV_MAX_MPS, lane.edgeRef.limit * EV_LIMIT_FACTOR),
        driver: { aMax: spec.maxAccel * 0.85, b: 3.0, s0: 3.0, T: 0.9, react: 0.3, lcRate: 0 },
        stopMem: new StopMemory(),
        frozen: 0,
        waiting: 0,
        blockedBy: null,
        blockedFor: 0,
      });
      v.path = new NpcPath(map, this.sirens, { world: fleet.world });
      v.path.start(lane.edge, lane.idx, plan.s, plan.planned);
      fleet.vehicles.push(v);
      this.evs = fleet.vehicles.filter(isEmergency);
      return v;
    }
    return null;
  }

  // An emergency vehicle leaves once well away from the car, at the end of its streets, or after
  // EV_MAX_AGE_S.
  retire() {
    const fleet = this.fleet;
    const ego = fleet.world.ego;
    for (const n of fleet.vehicles.filter(isEmergencyVehicle)) {
      const far = Math.hypot(n.x - ego.x, n.y - ego.y) > EV_GONE_M;
      if ((far && n.age > 10) || n.age > EV_MAX_AGE_S || (n.path.length - n.path.s < 8 && n.v < 0.5))
        fleet.vehicles.splice(fleet.vehicles.indexOf(n), 1);
    }
  }

  // One step of an emergency vehicle: lights and siren on, along the middle of the road, slowing
  // through junctions where it has no right of way and squeezing past vehicles pulled over.
  step(n, dt, all) {
    const fleet = this.fleet;
    const world = fleet.world,
      map = fleet.map,
      path = n.path,
      spec = n.spec;
    n.age += dt;
    let proj = projectPoint(path.pts, path.cum, [n.x, n.y], null);
    path.s = proj.s;
    if (proj.distance > 8) {
      fleet.recoverPath(n);
      proj = projectPoint(path.pts, path.cum, [n.x, n.y], null);
      path.s = proj.s;
    }
    path.extend();
    path.trim();
    const pe = path.currentEdge(),
      e = map.edges.get(pe.id);
    const front = path.s + (spec.length - spec.rearOverhang);
    const near = all
      .concat(world.parked.near(n.x, n.y, LOOK_M), world.parked.doorsNear(n.x, n.y, LOOK_M))
      .filter((o) => o !== n && Math.abs(o.x - n.x) <= LOOK_M + 5 && Math.abs(o.y - n.y) <= LOOK_M + 5)
      // (only along the stretch of its path from beside it to LOOK_M ahead: a path that doubles back,
      // at a dead end, passes the same place again further on)
      .map((o) => ({ o, p: closestOnPath(path, ...o.obb().center, path.s - spec.length, path.s + LOOK_M) }))
      .filter(({ p }) => p && p.s > path.s - spec.length + 1e-6 && p.s < path.s + LOOK_M - 1e-6);
    // across the road: the nearest gap past what is beside it and in the next stretch (the vehicles'
    // bodies, as they lie across the path)
    // A body entirely behind our tail cannot close a lateral opening ahead.
    // The old full-length rear window kept a bicycle well behind the truck in
    // this search, stranding it beside the driven car with no usable opening.
    const rear = spec.rearOverhang + spec.width / 2 + EV_SQUEEZE_M;
    const spans = near
      .filter(({ o, p }) => {
        const os = o.spec || CAR,
          a = o.psi - path.headingAt(p.s);
        const along = (Math.abs(Math.cos(a)) * os.length) / 2 + (Math.abs(Math.sin(a)) * os.width) / 2;
        return p.s + along >= path.s - rear && p.s - path.s < EV_PASS_LOOK_M + spec.length;
      })
      .map(({ o, p }) => {
        const os = o.spec || CAR,
          h =
            (Math.abs(Math.sin(o.psi - path.headingAt(p.s))) * os.length) / 2 +
            (Math.abs(Math.cos(o.psi - path.headingAt(p.s))) * os.width) / 2;
        return [p.lateral - h, p.lateral + h];
      });
    const preferred = evOffset(e, pe.lane, spec);
    // No gap is a reason to wait on the line we hold, not steer back into an occupied one.
    const opening = threadGap(e, pe.lane, spec, preferred, spans),
      target = opening ?? n.side;
    n.side += Math.max(-dt, Math.min(dt, target - n.side));
    const offset = n.side;
    let gap = Infinity,
      leadV = n.v0,
      leader = null,
      squeeze = false;
    const blocking = [];
    for (const { o, p } of near) {
      if (p.s <= path.s + 0.5) continue;
      // (something moving across its way, or toward it, is given a wide berth: it will not stay
      // where it is)
      const across = Math.abs(o.v) > 0.3 && Math.cos(o.psi - path.headingAt(p.s)) < 0.85;
      const os = o.spec || CAR,
        clear = Math.abs(p.lateral - offset) - (spec.width + os.width) / 2;
      // (from its middle; coming the other way, it closes the gap)
      const g = p.s - path.s - (spec.length - spec.rearOverhang) - os.length / 2;
      // A failed gap search keeps the current line; lateral clearance still
      // decides what blocks it. Sideways parked rows can project beside its axle.
      const inWay = clear < (across ? EV_CROSSING_M : EV_SQUEEZE_M - 1e-6);
      if ((inWay || opening === null) && g < 15 && !o.parked) blocking.push(o);
      if (!inWay) {
        if (clear < 0.6 && p.s - path.s < 25) squeeze = true;
        continue;
      }
      if (g < gap) {
        gap = g;
        leadV = o.v * Math.cos(o.psi - path.headingAt(p.s));
        leader = o;
      }
    }
    // any part of a body in its way over the next few metres, its own body laid along its path there
    // (where it is heading across the road)
    // (everything close by, wherever it lies along the path)
    const body = n.obb(),
      reach = spec.length + EV_BODY_LOOK_M + 6;
    const close = all
      .concat(world.parked.near(n.x, n.y, reach), world.parked.doorsNear(n.x, n.y, reach))
      .filter((o) => o !== n && Math.abs(o.x - n.x) < reach && Math.abs(o.y - n.y) < reach);
    for (let d = 0.5; d <= EV_BODY_LOOK_M && d < gap; d += 0.5) {
      const mid = path.s + spec.length / 2 - spec.rearOverhang + d,
        [x, y] = path.offsetPointAt(Math.min(path.length, mid), target);
      const ahead = { ...body, center: [x, y], heading: path.headingAt(Math.min(path.length, mid)) };
      const hit = close.find((o) => obbOverlap(ahead, o.obb(), 0.05) && !obbOverlap(body, o.obb(), 0.05));
      if (hit) {
        gap = Math.min(gap, d - 0.5);
        leadV = Math.max(0, hit.v * Math.cos(hit.psi - n.psi));
        leader = hit;
        break;
      }
    }
    // The requested offset can clear the driven car while the real nose is still steering into it.
    const ego = world.ego,
      hereGap = sweptBodyGap(n, ego, offset, EV_BODY_LOOK_M);
    // Its side continues easing toward the selected opening on later ticks. Check that line
    // too, from the real pose, so a safe current offset cannot hide the coming lateral sweep.
    const toGap = target === offset ? null : sweptBodyGap(n, ego, target, EV_BODY_LOOK_M);
    const g = hereGap === null ? toGap : toGap === null ? hereGap : Math.min(hereGap, toGap);
    if (g !== null && g < gap) {
      gap = g;
      leader = ego;
      leadV = Math.max(0, ego.v * Math.cos(ego.psi - n.psi));
      // A body-sweep obstruction is a real blocker too. Ask a car going our way to lead
      // after the same wait, rather than holding a siren behind it until standing down.
      if (g < 15 && !blocking.includes(ego)) blocking.push(ego);
    }
    // stuck behind something it cannot get past
    // (`blocking`: everything in its way within 15 m, but what is parked)
    if (blocking.length && n.v < 1) {
      n.blockedFor += dt;
      n.blockedBy = blocking;
    } else {
      n.blockedFor = 0;
      n.blockedBy = null;
    }
    n.stuck = n.v < 0.5 ? (n.stuck || 0) + dt : 0;
    // stuck for good: stood down, it turns its siren off and carries on at the limit
    if (n.stuck > EV_STAND_DOWN_S) {
      n.siren = false;
      n.blockedBy = null;
      n.v0 = Math.min(n.v0, e.limit);
    }
    // (something coming toward it in its way: slow right down until it is out of the way)
    // With no verified lateral opening, keep the current line at squeeze speed.
    let vCap = squeeze || opening === null ? EV_SQUEEZE_MPS : Infinity,
      stopAt = null;
    if (leader && leadV < -0.3) vCap = Math.min(vCap, EV_JUNCTION_MPS);
    for (const c of path.edges) {
      if (c.sEnd < path.s) continue;
      const toNode = c.sEnd - front;
      if (toNode > 60) break;
      const half = map.crossingHalfWidth(c.id);
      if (toNode < -half - 3) continue;
      const control = controlAt(world, c.control, c.id);
      const lineS = control ? pathLine(c, map.edges.get(c.id).length, control.s_line) : c.sEnd - half;
      const toLine = lineS - front;
      if (!control && !junctionAt(map, c.to)) continue;
      const after = path.edges[path.edges.indexOf(c) + 1];
      const st =
        control?.type === "signal"
          ? movementSignal(
              approachPhase(map.intersections.get(control.id), c.id, world.t),
              after ? map.classifyTurn(map.turnAngle(c.id, after.id)) : "straight",
            )
          : null;
      const noWay = control && (control.type !== "signal" || st !== "green");
      // through a junction it has no right of way at, slow to a walking-plus pace; through any other,
      // to 8 m/s; and wait at the line for anything crossing
      vCap = Math.min(vCap, Math.sqrt((noWay ? EV_JUNCTION_MPS ** 2 : 64) + 2 * 2.5 * Math.max(0, toLine - 2)));
      if (toLine > -1 && (fleet.boxBusy(n, c, isEmergency(n)) || fleet.crossComing(n, c.to, -2.5)))
        stopAt = Math.max(0, toLine);
      break;
    }
    // crowd.pxo keeps a PXO occupied until the far curb, in every lane (sim/pxo.js).
    const cw = crosswalkConflict(
      path.pts,
      path.cum,
      front - 2,
      front + 35,
      world.crowd,
      spec.width / 2 + 0.9 + Math.abs(offset),
    );
    if (cw) stopAt = stopAt === null ? cw.s - front - 2 : Math.min(stopAt, cw.s - front - 2);
    // (and short of a level crossing for a train coming: sim/rail.js)
    const forRail = fleet.crossings ? fleet.yieldAtCrossing(n, front, isEmergency(n) ? [] : all) : null;
    if (forRail !== null) stopAt = stopAt === null ? forRail : Math.min(stopAt, forRail);
    if (stopAt !== null && stopAt < gap) {
      gap = Math.max(0.05, stopAt);
      leadV = 0;
    }
    const v0 = Math.min(
      n.v0 * weather.speed,
      e.limit * (n.siren ? EV_LIMIT_FACTOR : 1) * weather.speed,
      EV_MAX_MPS,
      curveSpeed(path, path.s),
      vCap,
      featureTrafficSpeed(world, n, front),
    );
    const D = n.driver;
    let a;
    if (gap === Infinity) a = D.aMax * (1 - (n.v / v0) ** 4);
    else {
      const dv = n.v - leadV,
        grip = Math.min(1, comfort().decel / 2.5);
      const sStar =
        D.s0 + Math.max(0, (n.v * D.T) / Math.max(0.5, grip) + (n.v * dv) / (2 * Math.sqrt(D.aMax * D.b * grip)));
      a = D.aMax * (1 - (n.v / v0) ** 4 - (sStar / Math.max(gap, 0.1)) ** 2);
    }
    a = Math.max(-Math.min(6, comfort().hardDecel * 1.1), Math.min(D.aMax, a));
    if (n.v < 0.05 && a < 0) a = -1;
    n.signal = null;
    n.step(dt, { steer: purePursuit(n, path, path.s, offset), accel: a });
    if (n.v < 0) n.v = 0;
  }

  // An emergency vehicle with its siren on ahead along a driver's path, going its way, within
  // FOLLOW_M of its front: the gap to its rear and its speed, or null.
  ahead(n, path, front) {
    let best = null;
    for (const ev of this.evs) {
      if (Math.abs(ev.x - n.x) > FOLLOW_M || Math.abs(ev.y - n.y) > FOLLOW_M || Math.cos(ev.psi - n.psi) < 0.7)
        continue;
      const p = closestOnPath(path, ev.x, ev.y, front, front + FOLLOW_M);
      if (!p || p.distance > IN_WAY_M) continue;
      const gap = p.s - ev.spec.rearOverhang - front;
      if (gap > 0 && (!best || gap < best.gap)) best = { gap, v: Math.max(0, ev.v) };
    }
    return best;
  }

  // How far right of its lane's centre a driver giving way to an emergency vehicle pulls over: into
  // the parking lane where nothing is parked from 10 m behind its front to 15 m ahead of it.
  pullOverTo(n, pe, front) {
    const fleet = this.fleet;
    const e = fleet.map.edges.get(pe.id);
    const scale = e.length / Math.max(1, pe.sEnd - pe.sStart),
      at = (front - pe.sStart) * scale;
    const free = fleet.parkedAlong(e).every(([a, b]) => b < at - 10 - n.spec.length || a > at + 15);
    return pullOverOffset(e, pe.lane, n.spec.width, free);
  }

  // Where a driver giving way to an emergency vehicle stops, as metres from its front bumper: chosen
  // when the call came (see EV_STOP_DECEL) and kept as a point on the road.
  yieldStop(n, y, front) {
    const fleet = this.fleet;
    const path = n.path;
    if (!y.stop) {
      // (sooner, braking firmly, for one coming toward it)
      let dist = Math.max(4, (n.v * n.v) / (2 * (y.toward ? EV_FIRM_DECEL : EV_STOP_DECEL)));
      const i = path.edges.findIndex((e) => e.sEnd > front),
        cur = path.edges[i],
        prev = path.edges[i - 1];
      // (in a junction: clear it first)
      if (prev && fleet.isJunction(prev.to))
        dist = Math.max(dist, prev.sEnd + fleet.map.crossingHalfWidth(prev.id) + n.spec.length + 1 - front);
      if (cur && fleet.isJunction(cur.to)) {
        const half = fleet.map.crossingHalfWidth(cur.id),
          toNode = cur.sEnd - front;
        const control = cur.control,
          toLine = control ? pathLine(cur, fleet.map.edges.get(cur.id).length, control.s_line) - front : Infinity;
        const short = Math.min(toNode - half - 2.5, toLine - 0.5);
        if (short < dist)
          dist = short >= (n.v * n.v) / (2 * EV_FIRM_DECEL) ? Math.max(0.3, short) : toNode + half + n.spec.length + 3;
      }
      y.stop = path.pointAt(Math.min(path.length, front + dist));
    }
    // The point is the physical front-bumper stop. IDM leaves s0 behind an obstacle, so place
    // that virtual obstacle s0 beyond it to preserve the planned rear clearance at a junction
    // or narrowing. Both following-distance settings use the same IDM standstill gap.
    return projectPoint(path.pts, path.cum, y.stop, null).s - front + (n.driver || IDM).s0;
  }

  // A traffic driver's call to give way, kept on it as `n.yieldEv`: null with none on it, else
  // `yielding`, the call it pulls over and stops for (null once it is to drive on ahead of the
  // vehicle). A vehicle stood down starts back to its lane's line from where it is (`n.evRejoin`).
  giveWay(n, proj, dt) {
    if (isEmergencyVehicle(n) && !n.siren && n.evRejoin === undefined) n.evRejoin = proj.lateral;
    // an emergency vehicle calling on this driver to give way (none while still at the curb)
    const call = this.evs.length && !n.pull ? nearestCall(n, this.evs) : null;
    if (call) {
      if (n.yieldEv?.ev !== call.ev)
        n.yieldEv = { ev: call.ev, stop: null, lead: false, clear: 0, toward: call.relation !== "behind" };
      n.yieldEv.clear = 0;
      // stuck behind it, unable to get past: drive on ahead of it
      if (leadsEmergency(call.ev, n)) n.yieldEv.lead = true;
    } else if (n.yieldEv && (n.yieldEv.clear += dt) > EV_RELEASE_S) n.yieldEv = null;
    return n.yieldEv ? { yielding: !n.yieldEv.lead ? n.yieldEv : null } : null;
  }

  // How far right a driver giving way has moved over in its lane so far (a cyclist already keeps right).
  pullOver(n, edge, front, dt, giveWay) {
    const pullTo = giveWay?.yielding && n.kind !== "bike" && !n.transit?.tram ? this.pullOverTo(n, edge, front) : 0;
    n.evShift = (n.evShift || 0) + Math.max(-EV_SHIFT_MPS * dt, Math.min(EV_SHIFT_MPS * dt, pullTo - (n.evShift || 0)));
    return n.evShift;
  }

  // Stood down beside another car: carry on along the line already held until the real body can merge
  // back. An immediate lane-centre target can trap both drivers at a signal even though the passing line
  // ahead is clear. Null once back on it, else the line it keeps to (`offset`) and whether that is still
  // its own (`own`).
  rejoin(n, offset, dt) {
    if (n.evRejoin == null) return null;
    const world = this.fleet.world;
    const next = n.evRejoin + Math.max(-EV_SHIFT_MPS * dt, Math.min(EV_SHIFT_MPS * dt, offset - n.evRejoin));
    const near = [
      world.ego,
      ...world.obstaclesNear(n.x, n.y, n.spec.length + bodySweepLook(n, REJOIN_LOOK_M) + 6),
    ].filter((o) => o !== n);
    const blocked = near.some((o) => sweptBodyGap(n, o, next, REJOIN_LOOK_M, LEADER_MARGIN_M + 0.05) !== null);
    const kept = blocked ? n.evRejoin : next;
    n.evRejoin = Math.abs(kept - offset) < 1e-6 ? null : kept;
    return { offset: kept, own: n.evRejoin != null };
  }

  // Giving way to an emergency vehicle: where it stops, chosen when the call came, or null.
  stopFor(n, front, giveWay) {
    return giveWay?.yielding ? this.yieldStop(n, giveWay.yielding, front) : null;
  }

  // An emergency vehicle ahead going its way, within FOLLOW_M: it hangs back from it as from a car FOLLOW_M
  // nearer, { gap, v }, or null.
  hangBack(n, path, front) {
    const evAhead = this.evs.length ? this.ahead(n, path, front) : null;
    return evAhead ? { gap: evAhead.gap - FOLLOW_M, v: evAhead.v } : null;
  }
}
