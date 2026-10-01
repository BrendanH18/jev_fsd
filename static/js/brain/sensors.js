// What the car "senses" each decision: everything below is computed by code from the world and
// handed to the brains. Distances in meters, speeds in m/s, ego frame: ahead (+forward), right (+).

import { CAR, comfort } from "../sim/vehicle.js";
import { corridorQuery } from "../sim/collision.js";
import { signalFor, STOP_ZONE_M } from "../sim/signals.js";
import { wrap } from "../sim/world.js";
import { curveProfileSpeed } from "../sim/controller.js";
import { ringBusy } from "../sim/roundabout.js";
import { crosswalkConflict } from "../sim/pedestrians.js";
import { current as weather } from "../sim/weather.js";

export const LOOK_AHEAD_CONTROL_M = 80;
export const TRAFFIC_RADIUS_M = 60;
const YIELD_ENTRY_MPS = 4.0;
const PED_LOOK_M = 45;
const CROSS_ETA_S = 4.5;
export const CROSSWALK_STOP_M = 2.0;   // stop this far short of a crosswalk centerline

export function buildSnapshot(world, executing = null) {
  const { ego, map, route } = world;
  const FRONT = ego.spec.length - ego.spec.rearOverhang;
  const visible = world.visibleObstaclesNear(ego.x, ego.y, TRAFFIC_RADIUS_M);
  const visibleNpcs = world.npcs.filter((n) => visible.includes(n));
  const road = world._road || world.roadInfo();
  const snap = {
    t: world.t, tick: world.tick,
    ego: { x: ego.x, y: ego.y, psi: ego.psi, v: ego.v, front_m: FRONT },
    road, route, routeProj: null, onRoute: false, nav: null, intersection: null, following: null, pedestrian: null,
    rear_follower: null, traffic: [], current_path_hazard: null, stuck: world.stuckFor > 6 ? { for_s: world.stuckFor } : null,
    limit: road.limit || 11.2,
    observed: visible, visibility: { range_m: world.visibility.range, safe_speed_mps: visibilitySpeed(world.visibility.range, FRONT), building_occlusion: true },
    roadside: [],
  };
  if (route) {
    const p = route.project(ego.x, ego.y);
    const headingErr = wrap(ego.psi - p.heading);
    snap.routeProj = { s: p.s, lateral: p.lateral, headingErr, distance: p.distance, point: p.point };
    let clearPath = Math.min(world.visibility.range, route.length - p.s);
    for (let d = 6; d <= Math.min(world.visibility.range, 60, route.length - p.s); d += 3) {
      if (!world.visibility.canSee(ego, ...route.pointAt(p.s + d))) { clearPath = d - 3; break; }
    }
    snap.visibility.clear_path_m = clearPath;
    // At a blind corner retain a walking pace so the car can expose the sight line gradually.
    snap.visibility.safe_speed_mps = visibilitySpeed(Math.max(12, clearPath), FRONT);
    snap.onRoute = p.distance < 25 && Math.abs(headingErr) < Math.PI * 100 / 180;
    const remaining = route.remaining(p.s);
    const turns = route.turnsAfter(p.s);
    const dest = ego.toLocal(route.endPoint()[0], route.endPoint()[1]);
    snap.nav = {
      next_turn: turns.length ? turns[0].dir : "none",
      exit: turns.length && turns[0].exit ? turns[0].exit : null,
      turn_in_m: turns.length ? turns[0].at_m - p.s : remaining,
      turn_street: turns.length ? turns[0].street : "",
      remaining_m: remaining,
      destination: { right: dest.right, ahead: dest.ahead },
      arrived: remaining < 3.5,
    };
    // next traffic control along the route within LOOK_AHEAD_CONTROL_M of the front bumper
    const frontS = p.s + FRONT;
    for (const c of route.controls) {
      if (c.sRoute + 12 < frontS) continue;          // already through this one
      if (c.sRoute - frontS > LOOK_AHEAD_CONTROL_M) break;
      const bumperToLine = c.sRoute - frontS;
      const control = c.control;
      const inter = control.type === "signal" ? map.intersections.get(control.id) : null;
      const junction = inter ? [inter.x, inter.y] : c.junction;
      const signal = control.type === "signal" ? (junction && world.visibility.canSee(ego, ...junction) ? signalFor(map, control, world.t) : "unknown") : null;
      let crossTraffic = false;
      const rb = control.type === "yield" ? map.roundabouts.get(control.roundabout) : null;
      // yielding at a roundabout: look further round the ring the longer the car needs to reach the line
      if (rb) crossTraffic = ringBusy(rb, map.nodes.get(map.edges.get(c.edge).to), visibleNpcs, null, Math.min(4, Math.max(0, bumperToLine) / Math.max(1, ego.v)));
      else if (junction) {
        // crossing traffic in the junction, or heading for it and due within a few seconds (at a
        // two-way stop the through road does not stop, so its traffic must be waited for)
        for (const n of visibleNpcs) {
          if (Math.abs(n.v) < 0.5) continue;
          const diff = Math.abs(wrap(n.psi - ego.psi));
          if (diff <= Math.PI / 6 || diff >= Math.PI * 5 / 6) continue;
          const dx = junction[0] - n.x, dy = junction[1] - n.y, d = Math.hypot(dx, dy);
          const closing = (dx * Math.cos(n.psi) + dy * Math.sin(n.psi)) / Math.max(d, 1e-6);
          if (d < 20 || (closing > 0.7 && d < 60 && d / n.v < CROSS_ETA_S)) { crossTraffic = true; break; }
        }
      }
      const stopMem = world.egoStop;
      snap.intersection = {
        id: control.id, control: control.type, signal, group: control.group || null,
        bumper_to_line_m: bumperToLine, s_line_route: c.sRoute,
        entered: bumperToLine < 0,
        stop_completed: control.type === "stop" ? (stopMem.controlId === control.id && stopMem.completed) : null,
        all_way: control.type === "stop" ? !!control.all_way : null,
        roundabout: rb ? { exit: snap.nav && snap.nav.next_turn === "roundabout" ? snap.nav.exit : null } : null,
        cross_traffic_moving: crossTraffic,
        seconds_to_green: c.secondsToGreen ? c.secondsToGreen(world.t) : null,
      };
      break;
    }
    // a pedestrian on a crosswalk the route crosses, whom the car must let across
    const cw = crosswalkConflict(route.pts, route.cum, p.s + FRONT - 3, p.s + FRONT + PED_LOOK_M, { list: world.crowd.list.filter((p) => visible.includes(p)) });
    if (cw) snap.pedestrian = { id: cw.ped.id, bumper_to_crosswalk_m: cw.s - (p.s + FRONT), s_route: cw.s, to_path_m: cw.toPath, speed: cw.ped.v, mid_block: !!cw.ped.crossing?.jaywalk };
    // vehicles in the route corridor
    const vehicles = visible.filter((o) => o.kind !== "pedestrian");
    // ahead means in front of the bumper: a cyclist alongside is passed or waited for, not followed
    // a car coming the other way and passing is traffic, not a car to follow (one stopped in the
    // lane, facing us, is still in the way)
    const ahead = corridorQuery(route, p.s + FRONT - 1, p.s + TRAFFIC_RADIUS_M, 3.2, vehicles, p.index)
      .filter((a) => Math.abs(a.lateral) <= 1.7 || (a.vehicle.pull && a.vehicle.v > 0.2) || a.vehicle.parking)
      .filter((a) => !(Math.abs(a.vehicle.v) > 1 && Math.abs(wrap(a.vehicle.psi - ego.psi)) > Math.PI * 5 / 6));
    if (ahead.length) {
      const lead = ahead[0];
      const gap = lead.s - p.s - FRONT - (lead.vehicle.spec || CAR).rearOverhang;
      snap.following = { id: lead.vehicle.id, gap_m: gap, speed: lead.vehicle.v, closing_mps: ego.v - lead.vehicle.v, vehicle: lead.vehicle, s: lead.s,
        kind: lead.vehicle.pull ? "pulling out" : lead.vehicle.parking ? "parking car" : lead.vehicle.kind === "door" ? "open door" : lead.vehicle.kind === "bike" ? "cyclist" : lead.vehicle.parked ? "parked car" : "car" };
    }
    const behind = corridorQuery(route, p.s - 14, p.s - 1, 1.7, visibleNpcs, p.index);
    if (behind.length) {
      const b = behind[behind.length - 1];
      const bs = b.vehicle.spec || CAR;
      snap.rear_follower = { id: b.vehicle.id, gap_m: p.s - b.s - (bs.length - bs.rearOverhang) - ego.spec.rearOverhang, closing_mps: b.vehicle.v - ego.v };
    }
  }
  // nearby traffic in the ego frame
  for (const n of visibleNpcs) {
    const d = Math.hypot(n.x - ego.x, n.y - ego.y);
    if (d > TRAFFIC_RADIUS_M) continue;
    const local = ego.toLocal(n.x, n.y);
    const rel = wrap(n.psi - ego.psi);
    const absRel = Math.abs(rel);
    const heading = absRel < Math.PI / 6 ? "same" : absRel > Math.PI * 5 / 6 ? "oncoming" : rel > 0 ? "crossing_right_to_left" : "crossing_left_to_right";
    snap.traffic.push({ id: n.id, kind: n.kind === "bike" ? "cyclist" : "car", right: local.right, ahead: local.ahead, speed: n.v, heading, moving: Math.abs(n.v) > 0.5, dist: d, vehicle: n });
  }
  for (const o of visible) {
    if (!o.parked && o.kind !== "door" && !o.parking && !o.pull) continue;
    const local = ego.toLocal(o.x, o.y);
    if (local.ahead < -5 || local.ahead > 40 || Math.abs(local.right) > 8) continue;
    snap.roadside.push({ id: o.id, kind: o.kind === "door" ? "open door" : o.parking ? "parking" : o.pull ? "pulling out" : "parked car", right: local.right, ahead: local.ahead, signal: o.signal || null });
  }
  snap.roadside.sort((a, b) => a.ahead - b.ahead);
  snap.roadside = snap.roadside.slice(0, 6);
  snap.traffic.sort((a, b) => a.dist - b.dist);
  snap.traffic = snap.traffic.slice(0, 8);
  if (executing && executing.hazard) snap.current_path_hazard = executing.hazard;
  snap.target = desiredSpeed(snap);
  return snap;
}

// The speed code would like right now: limit, upcoming curvature, the gap ahead, a required stop
// line, and the destination. Brains see it as `target_speed`; the rules brain drives to it.
export function desiredSpeed(snap) {
  const FRONT = snap.ego?.front_m ?? CAR.length - CAR.rearOverhang;
  const decel = comfort().decel;
  let v = snap.limit;
  const reasons = [];
  if (weather.speed < 1) { v = snap.limit * weather.speed; reasons.push(weather.label); }
  if (snap.visibility) {
    const visibleSpeed = snap.visibility.safe_speed_mps ?? visibilitySpeed(snap.visibility.range_m, FRONT);
    if (visibleSpeed < v) { v = visibleSpeed; reasons.push("limited visibility"); }
  }
  if (snap.route && snap.routeProj) {
    const curve = curveProfileSpeed(snap.route, snap.routeProj.s);
    if (curve.v < v) { v = curve.v; reasons.push(curve.at < 4 ? "curve" : "upcoming turn"); }
    // a lower limit on the next street: be down to it, gently, a little before the car gets there
    for (const { at, limit } of snap.route.limitsAhead ? snap.route.limitsAhead(snap.routeProj.s) : []) {
      const lim = limit * (weather.speed < 1 ? weather.speed : 1);
      const vl = Math.sqrt(lim * lim + 2 * decel * 0.6 * Math.max(0, at - snap.routeProj.s - FRONT - 15));
      if (vl < v) { v = vl; reasons.push("lower limit ahead"); }
    }
  }
  if (snap.following) {
    // close in on the leader gently, and never faster than lets the car stop comfortably behind it
    // even if it brakes hard (it is assumed able to stop at 4 m/s^2)
    const f = snap.following, lead = Math.max(0, f.speed);
    const safe = Math.max(0, f.gap_m - 4);
    const room = Math.max(0, f.gap_m - 3 + lead * lead / (2 * 4));
    const vf = Math.min(lead + Math.min(2, safe / 3), stopSpeedFor(room, decel));
    if (vf < v) { v = vf; reasons.push("car ahead"); }
  }
  const i = snap.intersection;
  if (i && !i.entered && ((i.control === "signal" && (i.signal === "red" || i.signal === "yellow" || i.signal === "unknown")) || (i.control === "stop" && !i.stop_completed))) {
    // inside the stop zone the target is a full stop; before it, the speed from which the car can still stop at the line
    const vs = i.bumper_to_line_m < STOP_ZONE_M ? 0 : stopSpeedFor(Math.max(0, i.bumper_to_line_m - 0.5), decel);
    if (vs < v) { v = vs; reasons.push(i.control === "signal" ? `${i.signal} light` : "stop sign"); }
  }
  if (i && i.control === "stop" && i.stop_completed && i.cross_traffic_moving && !i.entered) { v = 0; reasons.push("cross traffic"); }
  if (i && i.control === "yield" && !i.entered) {
    const entry = YIELD_ENTRY_MPS * Math.sqrt(decel / 2.5);
    // roundabout: stop at the line for traffic in the ring, otherwise enter at a walking-plus pace
    const vy = i.cross_traffic_moving ? (i.bumper_to_line_m < STOP_ZONE_M ? 0 : stopSpeedFor(Math.max(0, i.bumper_to_line_m - 0.5), decel))
      : Math.sqrt(entry * entry + 2 * decel * Math.max(0, i.bumper_to_line_m));
    if (vy < v) { v = vy; reasons.push(i.cross_traffic_moving ? "yield to roundabout traffic" : "roundabout"); }
  }
  if (snap.pedestrian) {
    const room = snap.pedestrian.bumper_to_crosswalk_m - CROSSWALK_STOP_M;
    const vp = room < 1.0 ? 0 : stopSpeedFor(room, decel);
    if (vp < v) { v = vp; reasons.push("pedestrian crossing"); }
  }
  if (snap.nav) {
    const vd = stopSpeedFor(Math.max(0, snap.nav.remaining_m - 1), decel * 0.8);
    if (vd < v) { v = vd; reasons.push("destination"); }
  }
  return { v: Math.max(0, v), reasons };
}

// Include one second of sensing, decision and actuator delay in the stopping envelope.
function visibilitySpeed(range, FRONT = CAR.length - CAR.rearOverhang) {
  const decel = comfort().decel, room = Math.max(0, range - FRONT - 5);
  return Math.sqrt(decel * decel + 2 * decel * room) - decel;
}

function stopSpeedFor(distance, decel) { return distance <= 0 ? 0 : Math.sqrt(2 * decel * distance); }


// Hazard flags decide the decision interval.
export function hazardFlags(snap) {
  const f = [];
  if (snap.intersection && snap.intersection.bumper_to_line_m < 60) f.push("intersection");
  if (snap.nav && snap.nav.next_turn !== "none" && snap.nav.turn_in_m < 50) f.push("turn");
  if (snap.following && snap.following.gap_m < 15) f.push("following");
  if (snap.roadside?.some((o) => o.kind !== "parked car")) f.push("roadside activity");
  if (snap.pedestrian) f.push("pedestrian");
  if (snap.traffic.some((t) => t.ahead > 0 && t.ahead < 25 && Math.abs(t.right) < 8)) f.push("traffic");
  if (snap.routeProj && Math.abs(snap.routeProj.lateral) > 0.8) f.push("lane");
  if (!snap.road.on_road) f.push("off_road");
  if (snap.stuck) f.push("stuck");
  if (snap.current_path_hazard) f.push("hazard");
  if (snap.nav && snap.nav.remaining_m < 30) f.push("arriving");
  return f;
}
