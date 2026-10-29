// What the car "senses" each decision: everything below is computed by code from the world and
// handed to the brains. Distances in meters, speeds in m/s, ego frame: ahead (+forward), right (+).

import { CAR, comfort } from "../sim/vehicle.js";
import { corridorQuery } from "../sim/collision.js";
import { signalFor, STOP_ZONE_M } from "../sim/signals.js";
import { wrap } from "../sim/world.js";
import { curveProfileSpeed, laneCenterAt, laneChangeLength } from "../sim/controller.js";
import { ringBusy } from "../sim/roundabout.js";
import { crosswalkConflict, kerbConflict } from "../sim/pedestrians.js";
import { PREPARE_LANE_M } from "../map/route.js";
import { pointAt } from "../map/mapdata.js";
import { current as weather } from "../sim/weather.js";
import { DAYLIGHT_RANGE_M } from "../sim/visibility.js";
import { approachTo, outranks, PEEK_AT_M } from "../sim/priority.js";
import { TURN_ROUND_START_M, TURN_ROUND_OFFER_MPS, turnaroundStopS } from "../sim/turnaround.js";
import { EMERGENCY_NAMES, FOLLOW_M, IN_WAY_M, isEmergency, isJunction, leadsEmergency, nearestCall, pullOverOffset } from "../sim/emergency.js";
import { busYield, canStopFor, isBus } from "../sim/bus.js";
import { HOLD_M, canStopShort, crosswalksAlong, looked, stoppedAt } from "../sim/crosswalk.js";
import { canStopFor as canStopForSchool, isSchoolBus, schoolBusHold } from "../sim/school-bus.js";
import { STOP_M as STREETCAR_STOP_M, IN_LANE_M as STREETCAR_IN_LANE_M, SIDE_M as STREETCAR_SIDE_M, canStopFor as canStopForStreetcar, doorsOpen, holdFromRear, isStreetcar, stoppingAt, streetcarHold, streetcarRelation } from "../sim/streetcar.js";
import { ZONE_LIMIT_MPS, ZONE_NAMES, inEffect } from "../sim/speed-zones.js";
import { ADJACENT_M, APPROACH_M, ROADSIDE_LIGHTS, ROADSIDE_NAMES, SIDE_M as ROADSIDE_SIDE_M, endsOf, flashing, passLimit } from "../sim/roadside.js";

export const LOOK_AHEAD_CONTROL_M = 80;
// Coming up to a school bus showing its ambers (about to stop): no faster than it could stop where it
// would stop for the reds, comfortably, but at least this.
const AMBER_MIN_MPS = 4;
export const TRAFFIC_RADIUS_M = 60;
const YIELD_ENTRY_MPS = 4.0;
const PED_LOOK_M = 45;
const CROSS_ETA_S = 4.5;
export const CROSSWALK_STOP_M = 2.0;   // stop this far short of a crosswalk centerline
// Lane changes: no new pass within 25 m of a stop line or inside a junction, and no change at all in
// the last 8 m before a line. A gap needs 6 m plus 2 s of closing speed ahead and 2.5 s behind.
const PASS_JUNCTION_M = 25;
const CHANGE_JUNCTION_M = 8;
const LANE_GAP_M = 6;
const GAP_AHEAD_S = 2.0;
const GAP_BEHIND_S = 2.5;
export const LANE_CLEAR_M = 2.2;   // a car this far across has left its old lane
const SHIFT_DONE_M = 0.15;         // a lane change this close to the new lane's centre is over
// Moving over for a vehicle stopped at the roadside: not once the car's front is this close to its
// rear, and only into a lane that runs on this far past its front.
const MOVE_OVER_MIN_M = 5;
const MOVE_OVER_PAST_M = 10;
// Turning left at a signal: oncoming traffic has the right of way. The car turns in front of an
// oncoming vehicle only if it would clear that vehicle's path (6 m past the junction's centre, plus
// its own length, taking the turn at up to 6 m/s and pulling away at 2 m/s^2) 1.5 s before the
// vehicle gets there, or 0.75 s once it is already moving through the turn. Otherwise it waits
// 1.5 m short of that path: at the line, or inside the junction if it is already in it. A vehicle
// counts while it heads within 60 deg of straight at the car's approach and comes toward the
// junction, and while it is in the junction (12 m of its centre) turning, unless it signals a left
// turn of its own from its leftmost lane within 40 m (opposing left turns pass in front of each
// other), is braking to stop short, or
// is better aligned with coming down the street the car turns into (on a street that bends at the
// junction, that is the oncoming lane of the car's own street and never crosses its path).
const ONCOMING_LOOK_M = 90;
const ONCOMING_CONE = Math.PI / 3;
const JUNCTION_BOX_M = 12;
const TURN_MPS = 6;
const TURN_ACCEL = 2.0;
const CLEAR_PAST_M = 6;
const GAP_MARGIN_S = 1.5;
const GAP_KEEP_S = 0.75;
export const ONCOMING_STOP_M = 1.5;
const NEXT_CONTROL_M = 30;
const LEFT_SIGNAL_M = 40;
// A car this far past a stop line is inside the junction and clears it: a light that changes or a
// stop it overshot no longer holds it. Just past the line (an overshoot) it still does.
export const CLEARING_M = 3;
// An oncoming vehicle pulling away from its line (or any vehicle speeding up) is assumed to keep
// accelerating, at no more than this, up to its street's limit.
const ETA_ACCEL_MAX = 2.5;
// Turning right on a red light, where the map allows it: after a full stop at the line, the car
// turns only when nothing it must yield to is in the way. Traffic from the left (heading within
// 45 deg of the street the car turns into, coming toward the junction) must not be due at the
// junction before the car's rear has passed its centre (pulling away as for a left turn) plus 2 s,
// about 6 s from a stop; nothing may be moving across the junction itself (12 m of its centre); no
// pedestrian may be crossing ahead of it in the junction or waiting at a crosswalk it crosses whose
// walk signal comes on within 4 s; and the car must see along the street to its left as far as
// traffic at that street's limit covers in that time, or as far as it ever sees (80 m in clear
// daylight), so fog, rain, snow and darkness rule it out. Once moving past the line it carries on.
const RTOR_MARGIN_S = 2;
const RTOR_CONE = Math.PI / 4;
const RTOR_LOOK_M = 150;
const RTOR_WALK_S = 4;
const RTOR_PAST_M = 20;
// Giving way at a two-way stop, once the stop is made, and at a junction without a sign or signal
// (sim/priority.js). The car waits for a vehicle with the right of way over it that would reach the
// junction (within 6 m of its centre) before the car has crossed it (its rear past the far side of
// the widest crossing road, pulling away at 2 m/s^2 up to its street's limit, or at most 6 m/s
// turning) plus 1.5 s, or 2 s from a stop; for anything moving across the junction; and for any
// vehicle crossing its path due there within 2 s, whoever has the right of way. Within 40 m of the
// line it also looks along each street with the right of way over it, as far as that traffic
// covers in the same time (at its street's limit, slowed for the weather), within what it can see
// at all (so fog and darkness shorten the look rather than rule the junction out). Where a building
// hides that view, it slows so it can stop, then creeps forward at 1.5 m/s to look, no further than
// 0.3 m short of the crossing road's asphalt. Stopped there (within 1 m of it), it goes once nothing
// it can see is coming. Past that point it has committed and carries on.
const GIVE_WAY_MARGIN_S = 1.5;
const GIVE_WAY_REST_S = 2.0;
const IMMEDIATE_S = 2.0;
const VIEW_CHECK_M = 40;
const VIEW_STEP_M = 5;
export const PEEK_MPS = 1.5;
// Turning right, the car yields to a cyclist on its right going its way (a right hook): one clear
// of the car's lane line, so passing it on the right rather than following it, heading within 30
// deg of the street the car turns from, and coming toward the corner. The car turns in front of it
// only if it would clear the cyclist's line of travel (the car's front at the first point of its
// path within half the two widths plus 0.5 m of that line, then twice that and its own length,
// taking the turn as for a left one) 1.5 s before the cyclist gets there, or 0.75 s once moving
// into the turn. Otherwise it waits 1 m short of that point. It looks for the turn within 45 m and
// for cyclists up to 30 m behind its rear; only cyclists it can see count.
const HOOK_TURN_M = 45;
const HOOK_BEHIND_M = 30;
const HOOK_CONE = Math.PI / 6;
export const HOOK_STOP_M = 1.0;
const HOOK_SIDE_M = 6;   // (on its street: no further right than this)
// Giving way to an emergency vehicle (sim/emergency.js) calling on the car: it hears the siren
// within 100 m whether or not it can see the vehicle. When the call comes it picks where to stop:
// its stopping distance braking at 1.5 m/s^2 (at least 4 m on; chosen again from where it is if it
// could no longer stop there even braking at 6 m/s^2), or short of the next junction (2.5 m short
// of the crossing street, or of the stop line) if it can stop there braking at up to 3.5 m/s^2,
// else past it with its rear 1 m clear (and likewise clear of a junction it is in). It pulls over
// to the right as it stops (across into the curb lane where there are several, then into an empty
// parking lane beside it, see pullOverOffset)
// and waits there until the vehicle has gone by. If the vehicle is stuck behind the car for 3 s,
// going its way, the car drives on ahead of it instead. Once one has gone by, the car stays 150 m behind it.
export const EV_STOP_DECEL = 1.5;
const EV_FIRM_DECEL = 3.5;
const EV_SHORT_M = 2.5;
const EV_HARD_DECEL = 6;

export function buildSnapshot(world, executing = null) {
  const { ego, map, route } = world;
  const FRONT = ego.spec.length - ego.spec.rearOverhang;
  const visible = world.visibleObstaclesNear(ego.x, ego.y, TRAFFIC_RADIUS_M);
  const visibleNpcs = world.npcs.filter((n) => visible.includes(n));
  const road = world._road || world.roadInfo();
  const snap = {
    t: world.t, tick: world.tick,
    ego: { x: ego.x, y: ego.y, psi: ego.psi, v: ego.v, front_m: FRONT },
    road, route, routeProj: null, onRoute: false, nav: null, intersection: null, control_line_m: null, following: null, pedestrian: null, right_hook: null, emergency: null, emergency_ahead: null, bus: null, crosswalk_stop: null, school_bus: null, streetcar: null, speed_zone: null, roadside_stop: null,
    rear_follower: null, traffic: [], current_path_hazard: null, lane: null, stuck: world.stuckFor > 6 ? { for_s: world.stuckFor } : null,
    limit: road.limit || 11.2,
    observed: visible, visibility: { range_m: world.visibility.range, safe_speed_mps: visibilitySpeed(world.visibility.range, FRONT), building_occlusion: true },
    roadside: [],
  };
  if (route) {
    const p = route.project(ego.x, ego.y);
    const headingErr = wrap(ego.psi - p.heading);
    snap.routeProj = { s: p.s, lateral: p.lateral, headingErr, distance: p.distance, point: p.point, index: p.index };
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
    // a U-turn next (at a dead end), still ahead: how far ahead the car stops to turn round, until
    // it starts
    if (turns.length && turns[0].dir === "uturn" && turns[0].at_m > p.s && !world.turnaround) snap.nav.turn_round_in_m = turnaroundStopS(route, turns[0]) - p.s;
    const frontS = p.s + FRONT;
    for (let k = 0; k < route.controls.length; k++) {
      const c = route.controls[k], control = c.control, next = route.controls[k + 1];
      const leftTurn = (control.type === "signal" || control.type === "stop" || control.type === "uncontrolled") && (c.turn === "left" || c.turn === "uturn") && c.sJunction !== null;
      // already through this one (a left turn stays in view until the car is past oncoming traffic,
      // unless the next control is coming up)
      if (c.sRoute + 12 < frontS && !(leftTurn && frontS < c.sJunction + JUNCTION_BOX_M && !(next && next.sRoute - frontS < NEXT_CONTROL_M))) continue;
      if (c.sRoute - frontS > LOOK_AHEAD_CONTROL_M) break;
      // (the nearest junction, for lane changes, even when a control beyond it is the one reported)
      if (snap.control_line_m === null) snap.control_line_m = c.sRoute - frontS;
      const bumperToLine = c.sRoute - frontS;
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
      const entered = bumperToLine < 0;
      const stopCompleted = control.type === "stop" ? (stopMem.controlId === control.id && stopMem.completed) : null;
      const priority = control.type === "stop" && control.all_way ? allWayPriority(world, control, visible) : null;
      // at a stop sign, oncoming traffic matters once the stop is made and it is the car's turn;
      // without a sign or signal, always
      const turnNow = control.type === "stop" ? entered || (stopCompleted && !(priority?.arrived && !priority.go))
        : control.type === "uncontrolled" || entered || signal === "green" || signal === "yellow";
      const giveWay = (control.type === "uncontrolled" && control.rule !== "major") || (control.type === "stop" && !control.all_way && stopCompleted)
        ? giveWayAt(world, c, frontS) : null;
      const oncoming = leftTurn && turnNow ? oncomingYield(world, c, frontS) : null;
      // A junction without a sign that asks nothing of the car right now (it has the right of way,
      // or nothing it gives way to is coming and it can see) does not hide a control further on:
      // a signal just beyond it, say.
      if (control.type === "uncontrolled" && (!giveWay || giveWay.go) && !oncoming && next && next.sRoute - frontS <= LOOK_AHEAD_CONTROL_M) continue;
      snap.intersection = {
        id: control.id, control: control.type, signal, group: control.group || null,
        bumper_to_line_m: bumperToLine, s_line_route: c.sRoute,
        entered, turn: c.turn || "straight",
        oncoming,
        right_on_red: control.type === "signal" && map.rightOnRed && c.turn === "right" && signal === "red" && bumperToLine > -CLEARING_M && inter
          ? rightOnRed(world, c, inter, frontS, visible) : null,
        stop_completed: stopCompleted,
        all_way: control.type === "stop" ? !!control.all_way : null,
        rule: control.type === "uncontrolled" ? control.rule : null,
        priority,
        give_way: giveWay,
        roundabout: rb ? { exit: snap.nav && snap.nav.next_turn === "roundabout" ? snap.nav.exit : null } : null,
        cross_traffic_moving: crossTraffic,
        seconds_to_green: c.secondsToGreen ? c.secondsToGreen(world.t) : null,
      };
      break;
    }
    const cw = crosswalkConflict(route.pts, route.cum, p.s + FRONT - 3, p.s + FRONT + PED_LOOK_M, { list: world.crowd.list.filter((p) => visible.includes(p)) });
    if (cw) snap.pedestrian = { id: cw.ped.id, bumper_to_crosswalk_m: cw.s - (p.s + FRONT), s_route: cw.s, to_path_m: cw.toPath, speed: cw.ped.v, mid_block: !!cw.ped.crossing?.jaywalk };
    const vehicles = visible.filter((o) => o.kind !== "pedestrian");
    const lane = snap.lane = laneState(route, p, executing && executing.law);
    snap.right_hook = rightHook(world, p, frontS, lane);
    snap.emergency = emergencyYield(world, p, frontS, lane, visible);
    snap.emergency_ahead = emergencyAhead(world, p, frontS);
    snap.bus = busPullingOut(world, frontS, visible);
    snap.crosswalk_stop = crosswalkHold(world, frontS, visibleNpcs);
    snap.school_bus = schoolBusStop(world, route, frontS, visibleNpcs);
    snap.streetcar = streetcarStop(world, route, frontS, visibleNpcs);
    snap.roadside_stop = roadsideStop(world, p, frontS, lane, road);
    // A right turn on red is made from the curb lane, and waits for a pedestrian crossing ahead too.
    // Once moving past the line the car has committed and carries on.
    const rtor = snap.intersection?.right_on_red;
    if (rtor && !rtor.wait_for && (lane.index !== lane.lanes - 1 || lane.shift)) rtor.wait_for = { kind: "lane" };
    if (rtor && snap.pedestrian && !rtor.wait_for && snap.pedestrian.s_route < snap.intersection.s_line_route + RTOR_PAST_M) rtor.wait_for = { kind: "pedestrian", id: snap.pedestrian.id };
    if (rtor) { rtor.clear = !rtor.wait_for; rtor.go = rtor.stop_completed && (rtor.clear || (rtor.entered && ego.v > 1.5)); }
    // Ahead means in front of the bumper: a cyclist alongside is passed or waited for, not followed.
    // Oncoming traffic that is passing is not a follow target; a stopped car facing us still is.
    // During a lane change the lane being left still counts while the car overlaps it, for vehicles
    // the car reaches before its planned path has cleared that lane.
    const clearS = lane.from_center !== null ? laneClearS(lane.shift, lane.from_center, lane.center) : -Infinity;
    const inOrigin = (a) => lane.from_center !== null && Math.abs(p.lateral - lane.from_center) < LANE_CLEAR_M
      && Math.abs(a.lateral - lane.from_center) <= 1.7 && a.s - (a.vehicle.spec || CAR).rearOverhang < clearS + FRONT + 2;
    const frame = (s) => route.frameMove(p.s, s);
    const ahead = corridorQuery(route, p.s + FRONT - 1, p.s + TRAFFIC_RADIUS_M, 3.2 + (lane.from_center !== null ? Math.abs(lane.center - lane.from_center) : 0), vehicles, p.index, lane.center, frame)
      .filter((a) => Math.abs(a.lateral - lane.center) <= 1.7 || inOrigin(a) || (a.vehicle.pull && a.vehicle.v > 0.2) || a.vehicle.parking)
      .filter((a) => !(Math.abs(a.vehicle.v) > 1 && Math.abs(wrap(a.vehicle.psi - ego.psi)) > Math.PI * 5 / 6));
    if (ahead.length) {
      const lead = ahead[0];
      const gap = lead.s - p.s - FRONT - (lead.vehicle.spec || CAR).rearOverhang;
      snap.following = { id: lead.vehicle.id, gap_m: gap, speed: lead.vehicle.v, closing_mps: ego.v - lead.vehicle.v, vehicle: lead.vehicle, s: lead.s,
        kind: lead.vehicle.pull ? "pulling out" : lead.vehicle.parking ? "parking car" : lead.vehicle.kind === "door" ? "open door" : lead.vehicle.kind === "bike" ? "cyclist" : lead.vehicle.parked ? "parked car" : "car" };
    }
    const behind = corridorQuery(route, p.s - 14, p.s - 1, 1.7, visibleNpcs, p.index, lane.center, frame);
    if (behind.length) {
      const b = behind[behind.length - 1];
      const bs = b.vehicle.spec || CAR;
      snap.rear_follower = { id: b.vehicle.id, gap_m: p.s - b.s - (bs.length - bs.rearOverhang) - ego.spec.rearOverhang, closing_mps: b.vehicle.v - ego.v };
    }
  }
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
    snap.roadside.push({ id: o.id, kind: o.kind === "door" ? "open door" : o.parking ? "parking" : o.pull ? "pulling out" : ROADSIDE_NAMES[o.kind] || "parked car", right: local.right, ahead: local.ahead, signal: o.signal || null });
  }
  snap.roadside.sort((a, b) => a.ahead - b.ahead);
  snap.roadside = snap.roadside.slice(0, 6);
  snap.traffic.sort((a, b) => a.dist - b.dist);
  snap.traffic = snap.traffic.slice(0, 8);
  if (executing && executing.hazard) snap.current_path_hazard = executing.hazard;
  snap.speed_zone = speedZone(world, snap, FRONT);
  // (coming up to a vehicle stopped at the roadside with its lights flashing, and passing it, the
  // speed to be down to by then is the limit, so that no manoeuvre goes faster)
  if (snap.roadside_stop) snap.limit = Math.min(snap.limit, roadsideSpeed(snap.roadside_stop));
  snap.turnaround = turnaroundState(world, snap, executing);
  snap.target = desiredSpeed(snap);
  if (snap.lane) laneOptions(snap, world);
  return snap;
}

// The school or playground zone in effect that the car is in (the world's road info says so), or the
// next one along its route whose start its front is within ZONE_LOOK_M of (sim/speed-zones.js):
// where it starts (from the front) and ends (from the car), stretches in effect that meet counting
// as one.
const ZONE_LOOK_M = 80;
function speedZone(world, snap, FRONT) {
  const { road, route, routeProj: p } = snap;
  const marks = route && p && route.zonesAhead ? route.zonesAhead(p.s, ZONE_LOOK_M + FRONT).filter((m) => inEffect(m.zone.kind, world.clock)) : [];
  // (a school zone before a playground one starting at the same place, as where they overlap)
  const rank = (m) => m.zone.kind === "school" ? 0 : 1;
  marks.sort((a, b) => (Math.abs(a.from - b.from) < 1 ? rank(a) - rank(b) : a.from - b.from));
  const endOf = (i) => {
    let to = marks[i].to;
    for (let k = i + 1; k < marks.length && marks[k].from <= to + 1; k++) to = Math.max(to, marks[k].to);
    return to;
  };
  if (road.zone) {
    const i = marks.findIndex((m) => m.from <= p.s + 1);
    return { id: road.zone.id, kind: road.zone.kind, name: road.zone.name, limit_mps: road.limit, in_zone: true, starts_in_m: 0,
      ends_in_m: i >= 0 ? Math.max(0, endOf(i) - p.s) : null };
  }
  const i = marks.findIndex((m) => m.from > p.s - 1);
  if (i < 0) return null;
  const m = marks[i], limit = Math.min(ZONE_LIMIT_MPS, road.limit);
  return { id: m.zone.id, kind: m.zone.kind, name: m.zone.name, limit_mps: limit, in_zone: false, starts_in_m: m.from - (p.s + FRONT), ends_in_m: endOf(i) - p.s };
}

// A three-point turn where the route makes a U-turn (sim/turnaround.js): the one under way, or one
// on offer once the U-turn is just ahead and the car is slow. One that gave up is not offered again.
function turnaroundState(world, snap, executing) {
  const t = world.turnaround;
  if (t) return t.phase === "stuck" ? null : { phase: t.phase, legs: t.legs, executing: executing?.law === t, idle_s: t.idle || 0 };
  const nav = snap.nav;
  if (!nav || nav.next_turn !== "uturn" || nav.turn_in_m > TURN_ROUND_START_M || nav.turn_in_m < 0.5 || Math.abs(world.ego.v) > TURN_ROUND_OFFER_MPS) return null;
  return { phase: "start", legs: 0, executing: false };
}

// The car's lane relative to the route's lane. `delta` counts lanes right of it (negative: left),
// `center` is that lane's centre in metres right of the route and `lateral` the car's offset from the
// centre it is tracking (which moves during a lane change). A lane change in progress keeps its plan;
// otherwise, or when the planned lane has ended, the car is in the lane nearest to it. A law names
// its lanes by index within a straight run of the same lanes (`chain`), which holds where the route
// moves to another lane; a law from before a turn names them by lanes from the route's lane.
// `route_ahead` marks a route's lane that the route itself moves to only further on, for a turn.
function laneState(route, p, law) {
  const here = route.laneAt(p.s);
  const spanOf = (d) => d === 0 ? { offset: here.center, until: route.length } : route.laneSpan(p.s, d);
  // (a law from before lane indexes counted from the lane the route line is in)
  const toDelta = (idx, rel) => !Number.isInteger(idx) ? (Number.isInteger(rel) ? here.lineIdx + rel - here.idx : null)
    : law.chain === here.chain ? idx - here.idx : Number.isInteger(rel) ? rel : null;
  const planned = law && (law.kind === "lane" || law.kind === "hard_brake") ? toDelta(law.laneIdx, law.lane) : null;
  let delta = planned !== null && spanOf(planned) ? planned : null;
  if (delta === null) {
    delta = 0;
    for (let d = -here.idx; d < here.lanes - here.idx; d++) {
      const span = spanOf(d);
      if (span && Math.abs(p.lateral - span.offset) < Math.abs(p.lateral - spanOf(delta).offset)) delta = d;
    }
  }
  const span = spanOf(delta);
  // (a change ends once the car is across, even short of its end: one that stopped there would
  // otherwise never end, and never offer the next lane over)
  const shifting = delta === planned && law.shift && p.s < law.shift.start + law.shift.len - 0.5
    && Math.abs(laneCenterAt(law, p.s, route) - span.offset) > SHIFT_DONE_M;
  const fromDelta = shifting ? toDelta(law.fromIdx, law.fromLane) : null;
  const from = fromDelta !== null ? spanOf(fromDelta) : null;
  const centerNow = shifting ? laneCenterAt(law, p.s, route) : span.offset;
  return {
    lanes: here.lanes, index: here.idx + delta, route_index: here.idx, route_center: here.center, route_ahead: here.ahead, chain: here.chain, delta, center: span.offset,
    until_s: delta ? span.until : null, lateral: p.lateral - centerNow,
    shift: shifting ? law.shift : null, from_delta: fromDelta,
    from_center: shifting ? (from ? from.offset : law.shift.from - route.frameMove(law.shift.start, p.s)) : null, sides: {},
  };
}

// Turning left at a signal: the oncoming vehicle the car must wait for, or null when there is none
// or the car can no longer stop short of oncoming traffic's path (it has committed and clears the
// junction). Past the wait point but short of the path it still waits. `yield_s_route` is where
// the front bumper stops, ONCOMING_STOP_M before the first point where the car's path comes within
// half the two widths plus 0.5 m of the line of the innermost oncoming lane, measured from a
// conflicting vehicle's line of travel (so a car in a far lane is waited for short of the near
// lane too). Only vehicles the car can see count.
function oncomingYield(world, c, frontS) {
  const { ego, route } = world;
  const centre = route.pointAt(c.sJunction);
  const toClear = c.sJunction + CLEAR_PAST_M + ego.spec.length - frontS;
  if (toClear <= 0) return null;
  const need = clearTime(ego.v, toClear) + (ego.v > 1.5 && frontS > c.sRoute ? GAP_KEEP_S : GAP_MARGIN_S);
  const facing = route.headingAt(c.sRoute) + Math.PI, down = route.headingAt(Math.min(route.length, c.sJunction + 15)) + Math.PI;
  let best = null;
  for (const n of world.npcs) {
    // (moving, or pulling away from its own line on the green)
    if (n.v < 1 && !(n.v > 0.05 && n.a > 0.3)) continue;
    const dx = centre[0] - n.x, dy = centre[1] - n.y, d = Math.hypot(dx, dy);
    if (d > ONCOMING_LOOK_M) continue;
    // A left indicator means a left turn only from the leftmost lane near the junction: further
    // out, or from another lane, it is a lane change and the vehicle may well come straight on. A
    // car pulling out from the curb signals the pull-out, not a turn.
    const lane = world.map.nearestLane(n.x, n.y, n.psi, 6)?.lane;
    if (n.signal === "left" && !n.pull && d < LEFT_SIGNAL_M && lane && lane.idx === 0) continue;
    const rel = Math.abs(wrap(n.psi - facing));
    const closing = (dx * Math.cos(n.psi) + dy * Math.sin(n.psi)) / Math.max(d, 1e-6);
    const inBox = d < JUNCTION_BOX_M;
    if (!(rel < ONCOMING_CONE && (closing > 0.3 || inBox)) && !(inBox && rel < Math.PI * 7 / 12 && closing > -0.5)) continue;
    if (Math.abs(wrap(n.psi - down)) < rel) continue;
    // brake lights: a vehicle that will stop well short of the junction is not coming through
    if (!inBox && n.a < -0.5 && n.v * n.v / (-2 * n.a) < d - JUNCTION_BOX_M) continue;
    const eta = inBox ? 0 : etaOf(world, n, d - JUNCTION_BOX_M / 2);
    if (eta >= need || !world.visibility.sees(ego, n)) continue;
    const spec = n.spec || CAR;
    const reach = (ego.spec.width + spec.width) / 2 + 0.5;
    const ux = Math.cos(n.psi), uy = Math.sin(n.psi);
    // its lane's offset from the innermost lane of its street (lane 0 is leftmost), to its left
    const inner = lane ? Math.max(0, lane.offset - lane.edgeRef.lane_offsets[0]) : 0;
    const ox = n.x - uy * inner, oy = n.y + ux * inner;
    let hit = null;
    for (let s = Math.max(c.sRoute, frontS) - 2; s <= c.sJunction + JUNCTION_BOX_M; s += 0.5) {
      const [px, py] = route.pointAt(s);
      const ax = px - ox, ay = py - oy;
      if (ax * ux + ay * uy > -spec.length && Math.abs(ax * uy - ay * ux) < reach) { hit = s; break; }
    }
    if (hit === null) continue;
    const at = hit - ONCOMING_STOP_M;
    if (!best || at < best.yield_s_route) best = { id: n.id, eta_s: eta, need_s: need, yield_s_route: at, bumper_to_yield_m: at - frontS };
  }
  // too late to stop short of its path (not just of the wait point): carry on through
  if (!best || best.bumper_to_yield_m + ONCOMING_STOP_M < ego.v * ego.v / (2 * Math.min(4, comfort().hardDecel)) + 0.3) return null;
  return best;
}

// Turning right (see HOOK_TURN_M): the cyclist the car must wait for, or null when there is none or
// the car can no longer stop short of the cyclist's line of travel (it has committed and carries
// on). `yield_s_route` is where its front bumper stops.
function rightHook(world, p, frontS, lane) {
  const { ego, route } = world;
  const turn = route.turns.find((t) => t.at_m > frontS - JUNCTION_BOX_M);
  if (!turn || turn.dir !== "right" || turn.at_m - frontS > HOOK_TURN_M) return null;
  const inward = route.headingAt(Math.max(0, turn.at_m - 15));
  const toClear = (hit) => hit - frontS + ego.spec.length;
  let best = null;
  for (const n of world.npcs) {
    if (n.kind !== "bike" || (n.v < 0.5 && !(n.v > 0.05 && n.a > 0.3))) continue;
    if (Math.abs(wrap(n.psi - inward)) > HOOK_CONE || Math.hypot(n.x - ego.x, n.y - ego.y) > HOOK_BEHIND_M + 20) continue;
    const q = route.project(n.x, n.y, p.index), spec = n.spec || CAR;
    if (!q || q.s < p.s - ego.spec.rearOverhang - HOOK_BEHIND_M || q.s > turn.at_m) continue;
    // clear of the car's lane line on its right: beside it, not behind it
    const reach = (ego.spec.width + spec.width) / 2 + 0.5;
    const side = q.lateral + route.frameMove(p.s, q.s) - lane.center;
    if (side < reach - 0.4 || side > HOOK_SIDE_M || !world.visibility.sees(ego, n)) continue;
    const ux = Math.cos(n.psi), uy = Math.sin(n.psi);
    let hit = null;
    for (let s = Math.max(p.s, frontS - 2); s <= turn.at_m + JUNCTION_BOX_M; s += 0.5) {
      const [px, py] = route.pointAt(s), ax = px - n.x, ay = py - n.y;
      if (ax * ux + ay * uy > -spec.rearOverhang && Math.abs(ax * uy - ay * ux) < reach) { hit = s; break; }
    }
    if (hit === null) continue;
    const [hx, hy] = route.pointAt(hit);
    const eta = etaOf(world, n, (hx - n.x) * ux + (hy - n.y) * uy - (spec.length - spec.rearOverhang));
    const need = clearTime(ego.v, Math.max(0, toClear(hit) + 2 * reach)) + (ego.v > 1.5 && frontS > hit - 3 ? GAP_KEEP_S : GAP_MARGIN_S);
    if (eta >= need) continue;
    const at = hit - HOOK_STOP_M;
    if (!best || at < best.yield_s_route) best = { id: n.id, eta_s: eta, need_s: need, yield_s_route: at, bumper_to_yield_m: at - frontS };
  }
  // too late to stop short of its line: carry on through
  if (!best || best.bumper_to_yield_m + HOOK_STOP_M < ego.v * ego.v / (2 * Math.min(4, comfort().hardDecel)) + 0.3) return null;
  return best;
}

// An emergency vehicle calling on the car to give way (see EV_STOP_DECEL), or null: which one
// (`kind`), where it comes from relative to the car, how far away it is and when it gets to the
// car, whether the car can see it, and where the car stops (`stop_s_route`, front bumper) and how
// far right of its lane's centre it pulls over (`offset_m`); `clearing` when that is past a
// junction, and `lead` (no stop) when the vehicle is stuck behind the car. The stop is chosen once
// per call and remembered in `world.evYield`.
function emergencyYield(world, p, frontS, lane, visible) {
  const { ego, route, map } = world;
  const evs = world.npcs.filter(isEmergency);
  // where the car is and will be over the next 20 m, along its route
  const mid = ego.spec.length / 2 - ego.spec.rearOverhang;
  const pts = [0, 10, 20].map((d) => route.offsetPointAt(Math.min(route.length, p.s + mid + d), lane.center));
  pts[0] = [ego.x + Math.cos(ego.psi) * mid, ego.y + Math.sin(ego.psi) * mid];
  const call = evs.length ? nearestCall(ego, evs, pts) : null;
  if (!call) { world.evYield = null; return null; }
  const ev = call.ev;
  let plan = world.evYield;
  const v = Math.max(0, ego.v);
  // (and again if the car could no longer stop there, or within the 1.5 m a short stop overshoots,
  // even braking hard, having been slow to start)
  // (well past it is handled below)
  if (!plan || plan.id !== ev.id || plan.route !== route || (frontS <= plan.stop + 1.5 && (plan.stop + 1.5 - frontS) * 2 * EV_HARD_DECEL < v * v)) {
    let stop = frontS + Math.max(4, v * v / (2 * EV_STOP_DECEL)), clearing = false;
    // junctions along the route from here to there: stop short of the first, or clear it
    // (from the street before this one: the car may still be in the junction it has just come through)
    for (let i = Math.max(0, route.edgeIndexAt(p.s) - 1); i < route.edges.length - 1; i++) {
      const e = map.edges.get(route.edges[i]), sNode = route.edgeStarts[i + 1];
      if (sNode - frontS > stop - frontS + 40) break;
      if (!isJunction(map, e.to)) continue;
      const half = map.crossingHalfWidth(e.id), line = route.controls.find((c) => c.edge === e.id);
      const short = Math.min(sNode - half - EV_SHORT_M, line ? line.sRoute - 0.5 : Infinity);
      const clear = sNode + half + ego.spec.length + 1;
      if (frontS > short && frontS < clear) { stop = Math.max(stop, clear); clearing = true; continue; }
      if (short >= stop || short < frontS) continue;
      if (short - frontS >= v * v / (2 * EV_FIRM_DECEL)) stop = Math.max(frontS + 0.3, short);
      else { stop = Math.max(stop, clear); clearing = true; }
      break;
    }
    plan = world.evYield = { id: ev.id, route, stop: Math.min(stop, route.length - 1), clearing, lead: plan?.id === ev.id && plan.lead };
  }
  // well past the stop (overshot it, beyond what a short stop overshoots): stop where the car can,
  // braking firmly
  if (frontS > plan.stop + 1.5) plan.stop = Math.min(route.length - 1, frontS + (v > 0.3 ? v * v / (2 * EV_FIRM_DECEL) : 0));
  // stuck behind the car: from then on it drives on ahead of it
  plan.lead ||= leadsEmergency(ev, ego);
  const lead = plan.lead;
  // pulled over: into the parking lane where nothing is parked from 10 m behind the stop to 5 m on
  const i = route.edgeIndexAt(plan.stop - ego.spec.length / 2), e = map.edges.get(route.edges[i]);
  const at = route.pointAt(plan.stop), h = route.headingAt(plan.stop);
  const free = !world.parked.near(at[0], at[1], 20).some((c) => {
    const ahead = (c.x - at[0]) * Math.cos(h) + (c.y - at[1]) * Math.sin(h), right = (c.x - at[0]) * Math.sin(h) - (c.y - at[1]) * Math.cos(h);
    return ahead > -10 - ego.spec.length && ahead < 5 && right - lane.center - (lane.shift ? 0 : Math.max(0, lane.lanes - 1 - lane.index) * e.lane_width) > 1;
  });
  // (from a lane further out, across into the curb lane and over in it)
  const across = lane.shift ? 0 : Math.max(0, lane.lanes - 1 - lane.index) * e.lane_width;
  const offset = across + pullOverOffset(e, e.lanes - 1, ego.spec.width, !lane.shift && free);
  return { id: ev.id, kind: EMERGENCY_NAMES[ev.kind] || ev.kind, from: call.relation, distance_m: call.distance_m, eta_s: call.eta_s, seen: visible.includes(ev),
    stop_s_route: lead ? null : plan.stop, bumper_to_stop_m: lead ? null : plan.stop - frontS, offset_m: lead ? 0 : offset, clearing: plan.clearing, lead };
}

// A bus ahead signalling to pull out from its stop that the car must let out (sim/bus.js, BC MVA
// s. 169.1), or null: which bus (`id`, its route `ref`), how far ahead its rear is (`gap_m`) and
// where the car stops for it (`stop_s_route`, front bumper, 2 m behind it), and whether it is already
// moving out. The car owes it the right of way when it sees it signal from the lane it pulls out into,
// behind it, if it could stop there braking at no more than 3 m/s^2 then; from then on until the bus
// has pulled out. Decided once each time a bus pulls out, and remembered in `world.busYields`.
function busPullingOut(world, frontS, visible) {
  let best = null;
  world.busYields ||= new Map();
  for (const bus of world.npcs) {
    if (!isBus(bus) || !visible.includes(bus)) continue;
    const y = busYield(world.ego, bus);
    if (!y) continue;
    const key = `${bus.id}:${bus.transit.departures}`;
    if (!world.busYields.has(key)) {
      if (world.busYields.size > 20) world.busYields.delete(world.busYields.keys().next().value);
      world.busYields.set(key, canStopFor(world.ego.v, y.stop_m));
    }
    if (!world.busYields.get(key)) continue;
    if (!best || y.stop_m < best.bumper_to_stop_m) best = { id: bus.id, ref: bus.ref || "", gap_m: y.behind_m, stop_s_route: frontS + y.stop_m, bumper_to_stop_m: y.stop_m, moving_out: bus.transit.phase === "out" };
  }
  return best;
}

// A vehicle the car must not pass, stopped at a marked crosswalk ahead on its route, in another lane
// going its way (sim/crosswalk.js, BC MVA s. 179(3)): the car stops with its front HOLD_M short of
// the crosswalk's centre, and looks. Not when it could not have stopped there braking at OWED_DECEL
// once it saw the vehicle stopped, nor once it has stood still there for LOOK_S. The nearest
// crosswalk with one.
function crosswalkHold(world, frontS, visibleNpcs) {
  world.crosswalkYields ||= new Map();
  for (const { cw, s } of crosswalksAlong(world.route, world.crowd)) {
    if (s - frontS < -1) continue;
    if (s - frontS > LOOK_AHEAD_CONTROL_M) break;
    if (looked(world, cw)) continue;
    for (const n of stoppedAt(world, cw, world.ego, visibleNpcs)) {
      const key = `${cw.id}:${n.id}`;
      if (!world.crosswalkYields.has(key)) {
        if (world.crosswalkYields.size > 40) world.crosswalkYields.delete(world.crosswalkYields.keys().next().value);
        world.crosswalkYields.set(key, canStopShort(world.ego.v, s - frontS));
      }
      if (!world.crosswalkYields.get(key)) continue;
      return { id: n.id, kind: isBus(n) ? "bus" : isEmergency(n) ? (EMERGENCY_NAMES[n.kind] || n.kind) : "car", crosswalk: cw.id,
        stop_s_route: s - HOLD_M, bumper_to_stop_m: s - HOLD_M - frontS, bumper_to_crosswalk_m: s - frontS, stopped: Math.abs(n.v) < 0.3 };
    }
  }
  return null;
}

// A school bus the car must stop for (sim/school-bus.js, BC MVA s. 149): stopped with its reds
// flashing on the car's route, ahead of it going its way or coming toward it (`relation`). The car
// stops with its front 5 m behind the bus's rear, or 10 m short of its front coming toward it
// (`stop_s_route`), and stays stopped while the reds flash. Owed when the car, first seeing the reds,
// could stop there braking at no more than 3.5 m/s^2; decided once a stop and remembered in
// `world.schoolYields`. With none, the nearest showing its ambers (about to stop: `lights` "amber"),
// or null.
function schoolBusStop(world, route, frontS, visibleNpcs) {
  world.schoolYields ||= new Map();
  let red = null, amber = null;
  for (const bus of visibleNpcs) {
    if (!isSchoolBus(bus) || !bus.school?.lights) continue;
    const h = schoolBusHold(route.pts, route.cum, frontS, bus);
    if (!h) continue;
    const out = { id: bus.id, relation: h.relation, lights: bus.school.lights, gap_m: h.gap_m, stop_s_route: frontS + h.stop_m, bumper_to_stop_m: h.stop_m };
    if (bus.school.lights === "amber") { if (!amber || h.gap_m < amber.gap_m) amber = out; continue; }
    const key = `${bus.id}:${bus.school.stops}`;
    if (!world.schoolYields.has(key)) {
      if (world.schoolYields.size > 20) world.schoolYields.delete(world.schoolYields.keys().next().value);
      world.schoolYields.set(key, canStopForSchool(world.ego.v, h.stop_m));
    }
    if (world.schoolYields.get(key) && (!red || h.stop_m < red.bumper_to_stop_m)) red = out;
  }
  return red || amber;
}

// A streetcar the car must not pass (sim/streetcar.js, Ontario HTA s. 166): stopped with its doors
// open, ahead on the car's route going its way, with the car in its lane behind it or in the lane
// beside it on the side its riders use (`beside`). The car stops with its front 4 m behind its rear
// doors, short of the law's 2 m, or 4 m behind it in its lane (`stop_s_route`), and stays stopped
// while they are open. Owed
// when the car, first seeing them open, could stop there braking at no more than 3.5 m/s^2; decided
// once a stop and remembered in `world.streetcarYields`. With none, the nearest slowing for its stop
// (`doors` false, `stopping` true), or null.
function streetcarStop(world, route, frontS, visibleNpcs) {
  world.streetcarYields ||= new Map();
  let open = null, stopping = null;
  for (const car of visibleNpcs) {
    if (!isStreetcar(car) || !(doorsOpen(car) || stoppingAt(car))) continue;
    const h = streetcarHold(route.pts, route.cum, frontS, car), r = streetcarRelation(world.ego, car);
    if (!h || !r || r.right_m < -STREETCAR_IN_LANE_M || r.right_m > STREETCAR_SIDE_M) continue;
    // (in its lane or beside it, by where the car is now)
    const stop = h.gap_m + holdFromRear(r.right_m);
    // (until its front reaches the doors, or the streetcar in its lane: just past where it stops, it
    // stays stopped)
    if (stop + STREETCAR_STOP_M <= 0) continue;
    const out = { id: car.id, ref: car.ref || null, beside: r.beside, doors: doorsOpen(car), gap_m: h.gap_m, stop_s_route: frontS + stop, bumper_to_stop_m: stop };
    if (!out.doors) { if (!stopping || h.gap_m < stopping.gap_m) stopping = { ...out, stopping: true }; continue; }
    const key = `${car.id}:${car.transit.departures}`;
    if (!world.streetcarYields.has(key)) {
      if (world.streetcarYields.size > 20) world.streetcarYields.delete(world.streetcarYields.keys().next().value);
      world.streetcarYields.set(key, canStopForStreetcar(world.ego.v, stop));
    }
    if (world.streetcarYields.get(key) && (!open || stop < open.bumper_to_stop_m)) open = out;
  }
  return open || stopping;
}

// A vehicle stopped at the roadside with its lights flashing that the car must slow down and move over
// for (sim/roadside.js, BC MVA Regulations s. 47.02): the nearest it can see on the right of its route
// ahead, going its way, within ROADSIDE_LOOK_M, until the car's rear is past its front. `gap_m` is
// from the car's front to its rear (negative beside it), `limit_mps` the speed to pass it at (from
// APPROACH_M short of it), `adjacent_delta` the lane next to it (by lanes right of the route's, as
// `lane.delta`), `in_adjacent_lane` whether the car is in it, and `other_lane` whether there is a
// lane further from it going the car's way to move over into.
const ROADSIDE_LOOK_M = 100;
function roadsideStop(world, p, frontS, lane, road) {
  const { ego, route } = world;
  let best = null;
  for (const v of world.roadside?.vehicles || []) {
    if (!flashing(v) || Math.hypot(v.x - ego.x, v.y - ego.y) > ROADSIDE_LOOK_M + 20 || !world.sees(ego, v)) continue;
    const { rear, front } = endsOf(v), qr = route.project(rear[0], rear[1], p.index), qf = route.project(front[0], front[1], p.index);
    if (!qr || !qf || qr.distance > 15 || Math.abs(wrap(v.psi - qr.heading)) > Math.PI / 6) continue;
    const gap = qr.s - frontS;
    if (gap > ROADSIDE_LOOK_M || p.s - ego.spec.rearOverhang > qf.s) continue;
    // its near side, in metres right of the route where the car is
    const side = Math.min(qr.lateral + route.frameMove(p.s, qr.s), qf.lateral + route.frameMove(p.s, qf.s)) - v.spec.width / 2;
    if (side - lane.center < 0 || side - lane.center > ROADSIDE_SIDE_M) continue;
    if (best && gap >= best.gap_m) continue;
    // the lanes going the car's way, left of it: the one nearest it is next to it
    const here = route.laneAt(p.s), lanes = [];
    for (let d = -here.idx; d < here.lanes - here.idx; d++) {
      const span = d === 0 ? { offset: here.center } : route.laneSpan(p.s, d);
      if (span && span.offset < side) lanes.push({ d, offset: span.offset });
    }
    lanes.sort((a, b) => b.offset - a.offset);
    const adjacent = lanes.length && side - lanes[0].offset < ADJACENT_M ? lanes[0].d : null;
    best = { id: v.id, kind: v.kind, name: ROADSIDE_NAMES[v.kind] || v.kind, lights: ROADSIDE_LIGHTS[v.kind] || "flashing", gap_m: gap, s_rear_route: qr.s, s_front_route: qf.s,
      limit_mps: passLimit(road.limit || 11.2), adjacent_delta: adjacent, in_adjacent_lane: adjacent !== null && lane.delta === adjacent, other_lane: adjacent !== null && lanes.length > 1 };
  }
  return best;
}

// An emergency vehicle with its siren on ahead of the car, going its way along its route, within
// FOLLOW_M (one it has let go by): the car drops back that far.
function emergencyAhead(world, p, frontS) {
  const { route } = world;
  let best = null;
  for (const ev of world.npcs) {
    if (!isEmergency(ev) || Math.hypot(ev.x - world.ego.x, ev.y - world.ego.y) > FOLLOW_M + 20) continue;
    const q = route.project(ev.x, ev.y, p.index);
    // (anywhere across the street: it drives along its middle)
    if (!q || q.distance > IN_WAY_M || Math.abs(wrap(ev.psi - q.heading)) > Math.PI / 4) continue;
    const gap = q.s - ev.spec.rearOverhang - frontS;
    if (gap < -1 || gap > FOLLOW_M) continue;
    if (!best || gap < best.gap_m) best = { id: ev.id, kind: EMERGENCY_NAMES[ev.kind] || ev.kind, gap_m: Math.max(0, gap), speed: Math.max(0, ev.v) };
  }
  return best;
}

// At an all-way stop (sim/all-way.js), the car's place in the queue as far as it can see: whether it
// has stopped at the line and joined it (`arrived`), whether it is its turn (`go`), the vehicle it
// waits for, and the vehicles already waiting there (`waiting`, before it arrives: they go first).
// Only vehicles it can see take part, so it may go before a hidden one that stopped first.
function allWayPriority(world, control, visible) {
  const st = world.allWay.status(world.ego, world, (v) => visible.includes(v));
  if (!st) {
    const junction = world.map.stops.get(control.id)?.junction;
    const queue = world.allWay.at(junction, world).filter((e) => e.vehicle !== world.ego && visible.includes(e.vehicle)).sort((a, b) => a.arrived - b.arrived);
    return { arrived: false, go: false, wait_for: null, waiting: queue.map((e) => e.vehicle.id) };
  }
  return { arrived: true, go: st.go, wait_for: st.wait_for ? st.wait_for.id : null, waiting: st.before.map((v) => v.id) };
}

// Seconds for the car to cover `distance` taking a turn: speeding up from `v` at TURN_ACCEL to at
// most `vMax` (holding its speed if already faster).
function clearTime(v, distance, vMax = TURN_MPS) {
  const v0 = Math.min(Math.max(0, v), vMax);
  const t1 = (vMax - v0) / TURN_ACCEL, d1 = (v0 + vMax) / 2 * t1;
  return d1 >= distance ? (Math.sqrt(v0 * v0 + 2 * TURN_ACCEL * distance) - v0) / TURN_ACCEL : t1 + (distance - d1) / vMax;
}

// Seconds until a vehicle covers `distance`: at its speed, or, while it speeds up, accelerating as it
// is now (at most ETA_ACCEL_MAX) until it reaches its street's limit.
function etaOf(world, n, distance) {
  if (distance <= 0) return 0;
  const v = Math.max(0, n.v), a = Math.min(ETA_ACCEL_MAX, Math.max(0, n.a || 0));
  if (a < 0.05) return v > 0.05 ? distance / v : Infinity;
  const vMax = Math.max(v, Math.min(n.spec?.maxSpeed ?? Infinity, world.map.nearestLane(n.x, n.y, n.psi, 6)?.lane.edgeRef.limit || 13.9));
  const tTop = (vMax - v) / a, dTop = (v + vMax) / 2 * tTop;
  return dTop >= distance ? (Math.sqrt(v * v + 2 * a * distance) - v) / a : tTop + (distance - dTop) / vMax;
}

// Turning right on a red light (see RTOR_MARGIN_S): whether the car has made its full stop at the
// line, and the first thing it must wait for, if any (`wait_for`: a vehicle crossing the junction or
// due from the left, a pedestrian about to cross, or the view to the left). The caller adds the
// curb lane and a pedestrian already crossing, and sets `clear` and `go`. Traffic from the left
// moves across the car's nose to its right: heading a right turn's worth (as classifyTurn reads
// it) off the way the car came in, or close to the street it turns into (at a skewed junction the
// street from the left need not run straight on into it).
function rightOnRed(world, c, inter, frontS, visible) {
  const { ego, route, map } = world;
  // traffic from the left is looked for as far as the car can see, beyond TRAFFIC_RADIUS_M
  const visibleNpcs = world.visibleObstaclesNear(ego.x, ego.y, DAYLIGHT_RANGE_M).filter((o) => world.npcs.includes(o));
  const entered = frontS > c.sRoute;
  const out = { stop_completed: world.egoStop.controlId === c.control.id && world.egoStop.completed, entered, need_s: null, wait_for: null, clear: false, go: false };
  const centre = [inter.x, inter.y];
  const sCentre = c.sJunction ?? c.sRoute + 8;
  const exit = route.headingAt(Math.min(route.length, sCentre + 15)), inward = route.headingAt(c.sRoute);
  const fromLeft = (h) => Math.abs(wrap(h - exit)) <= RTOR_CONE || map.classifyTurn(wrap(h - inward)) === "right";
  const need = clearTime(ego.v, Math.max(0, sCentre - frontS) + ego.spec.length) + RTOR_MARGIN_S;
  out.need_s = need;
  for (const n of visibleNpcs) {
    const dx = centre[0] - n.x, dy = centre[1] - n.y, d = Math.hypot(dx, dy);
    if (d < JUNCTION_BOX_M) {
      // moving across the junction (or pulling away); heading the car's way out of it, only short
      // of the centre (a car that turned the same way just ahead of it is a leader)
      const along = Math.abs(wrap(n.psi - exit)) <= Math.PI / 6, beforeCentre = dx * Math.cos(exit) + dy * Math.sin(exit) > 0;
      if ((Math.abs(n.v) > 0.5 || (n.v > 0.05 && n.a > 0.3)) && Math.abs(wrap(n.psi - ego.psi)) > Math.PI / 6 && (!along || beforeCentre)) { out.wait_for = { kind: "junction", id: n.id }; return out; }
      continue;
    }
    if (d > RTOR_LOOK_M || (n.v < 1 && !(n.v > 0.05 && n.a > 0.3)) || !fromLeft(n.psi)) continue;
    if ((dx * Math.cos(n.psi) + dy * Math.sin(n.psi)) / Math.max(d, 1e-6) < 0.3) continue;
    // stopping short of the junction (for its own light, say)
    if (n.a < -0.5 && n.v * n.v / (-2 * n.a) < d - JUNCTION_BOX_M) continue;
    const eta = etaOf(world, n, d - JUNCTION_BOX_M / 2);
    if (eta < need) { out.wait_for = { kind: "vehicle", id: n.id, eta_s: eta }; return out; }
  }
  const peds = world.crowd.list.filter((q) => visible.includes(q));
  const ped = kerbConflict(route.pts, route.cum, frontS - 3, sCentre + RTOR_PAST_M, world.crowd, peds, world.t, RTOR_WALK_S);
  if (ped) { out.wait_for = { kind: "pedestrian", id: ped.id }; return out; }
  // the view along each street coming in from the left, as far as traffic on it covers in `need`
  // (back along the approach, then straight on past its start)
  if (!entered) {
    for (const a of inter.approaches) {
      const e = map.edges.get(a.edge);
      if (!e || e.id === c.edge || !fromLeft(map.headingIn(e.id))) continue;
      const far = JUNCTION_BOX_M / 2 + (e.limit || 13.9) * need;
      const at = (back) => alongApproach(map, e, back);
      const reach = DAYLIGHT_RANGE_M - 1;
      for (let k = 1, last = 0; k <= 4; k++) {
        let back = far * k / 4, p = at(back);
        // past what the car can ever see: check as far as it can, then stop
        if (Math.hypot(p[0] - ego.x, p[1] - ego.y) > reach) {
          let lo = last, hi = back;
          for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2, q = at(mid); if (Math.hypot(q[0] - ego.x, q[1] - ego.y) > reach) hi = mid; else lo = mid; }
          back = lo; p = at(back);
        }
        if (!world.visibility.canSee(ego, ...p)) { out.wait_for = { kind: "view", sight_m: Math.round(last) }; return out; }
        if (back < far * k / 4) break;
        last = back;
      }
    }
  }
  return out;
}

// The point `back` metres before the end of street `e`, back along it and then straight on past its
// start.
function alongApproach(map, e, back) {
  const L = e.cum[e.cum.length - 1], h = map.headingOut(e.id);
  const [x, y] = pointAt(e.pts, e.cum, Math.max(0, L - back)), beyond = Math.max(0, back - L);
  return [x - Math.cos(h) * beyond, y - Math.sin(h) * beyond];
}

// Giving way at a two-way stop or a junction without a sign or signal (see GIVE_WAY_MARGIN_S). The
// rule the car's street follows there ("stop", "minor" or "equal"), the first vehicle it must wait
// for (`wait_for`: one with the right of way, one due within 2 s, or one moving across the
// junction), whether it can see far enough along the streets with the right of way over it
// (`view_clear`, null further out than 40 m) and how far it can see along them (`sight_m`), where it
// would stop to look (`peek_s_route`), whether it has stopped there (`peeked`), and where its front
// bumper must stop now (`hold_s_route`, with `bumper_to_hold_m`), null when it may go (`go`).
// Only vehicles it can see count, and only where they are: not where they plan to go.
function giveWayAt(world, c, frontS) {
  const { ego, route, map } = world;
  const edge = map.edges.get(c.edge), node = edge.to, centre = c.junction;
  const rule = c.control.type === "stop" ? "stop" : c.control.rule;
  const sCentre = c.sJunction ?? c.sRoute + 8;
  const half = map.crossingHalfWidth(c.edge);
  const peekS = c.sPeek;
  const out = { rule, wait_for: null, need_s: null, view_clear: null, sight_m: null, peek_s_route: peekS, peeked: false, hold_s_route: null, bumper_to_hold_m: null, go: true };
  if (!centre || frontS > peekS + 0.5) return out;
  const turning = c.turn === "left" || c.turn === "right" || c.turn === "uturn";
  const vMax = turning ? TURN_MPS : Math.max(TURN_MPS, (edge.limit || 11.2) * weather.speed);
  const need = clearTime(ego.v, Math.max(0, sCentre + half - frontS) + ego.spec.length, vMax) + (ego.v > 1.5 ? GIVE_WAY_MARGIN_S : GIVE_WAY_REST_S);
  out.need_s = need;
  const inward = route.headingAt(c.sRoute), exit = route.headingAt(Math.min(route.length, sCentre + 15));
  for (const n of world.npcs) {
    if (n.v < 1 && !(n.v > 0.05 && n.a > 0.3)) continue;
    const dx = centre[0] - n.x, dy = centre[1] - n.y, d = Math.hypot(dx, dy);
    if (d > ONCOMING_LOOK_M || !world.visibility.sees(ego, n)) continue;
    const rel = wrap(n.psi - inward);
    if (d < JUNCTION_BOX_M) {
      // moving across the junction (not coming straight on toward the car, and heading the car's way
      // out of it only short of the centre: one just ahead of it, gone the same way, is a leader)
      const along = Math.abs(wrap(n.psi - exit)) <= Math.PI / 6, beforeCentre = dx * Math.cos(exit) + dy * Math.sin(exit) > 0;
      if (Math.abs(rel) > Math.PI / 6 && Math.abs(rel) < Math.PI * 5 / 6 && (!along || beforeCentre)) { out.wait_for = { kind: "junction", id: n.id }; break; }
      continue;
    }
    if (Math.abs(rel) < Math.PI / 6 || Math.abs(rel) > Math.PI * 5 / 6) continue;
    if ((dx * Math.cos(n.psi) + dy * Math.sin(n.psi)) / Math.max(d, 1e-6) < 0.3) continue;
    // brake lights: stopping short of the junction (giving way to the car, say)
    if (n.a < -0.5 && n.v * n.v / (-2 * n.a) < d - JUNCTION_BOX_M) continue;
    const eta = etaOf(world, n, d - JUNCTION_BOX_M / 2);
    // the street it is on (from the lane it is in, not where it plans to go); a vehicle between
    // streets has the right of way over a stop sign or a smaller road, and from the right
    const a = approachTo(map, n, node, false);
    const first = a ? outranks(map, a.edge, c.edge) : rule !== "equal" || rel > 0;
    if ((first && eta < need) || eta < IMMEDIATE_S) { out.wait_for = { kind: "vehicle", id: n.id, eta_s: eta }; break; }
  }
  // stopped where it looks from, now or since it last stopped there
  const atPeek = (frontS >= peekS - PEEK_AT_M && Math.abs(ego.v) < 0.2) || world.egoPeek === c.control.id;
  if (!out.wait_for && c.sRoute - frontS < VIEW_CHECK_M) {
    out.view_clear = true;
    for (const id of map.inn.get(node) || []) {
      if (!outranks(map, id, c.edge)) continue;
      const e = map.edges.get(id), far = JUNCTION_BOX_M / 2 + (e.limit || 13.9) * weather.speed * need;
      let last = 0, blocked = false;
      for (let back = JUNCTION_BOX_M / 2; ; back += VIEW_STEP_M) {
        const b = Math.min(back, far), p = alongApproach(map, e, b);
        // as far as the car can see at all, in this weather and light
        if (Math.hypot(p[0] - ego.x, p[1] - ego.y) > world.visibility.rangeAt(ego, ...p)) break;
        if (world.visibility.occluded([ego.x, ego.y], p)) { blocked = true; break; }
        last = b;
        if (b >= far) break;
      }
      // (how far it sees along the street it cannot see far enough along)
      if (blocked) { out.view_clear = false; out.sight_m = out.sight_m === null ? last : Math.min(out.sight_m, last); }
    }
    out.peeked = !out.view_clear && atPeek;
  }
  out.hold_s_route = out.wait_for ? (frontS < c.sRoute - 0.3 ? c.sRoute : peekS) : out.view_clear === false && !out.peeked ? peekS : null;
  if (out.hold_s_route !== null) out.bumper_to_hold_m = out.hold_s_route - frontS;
  out.go = out.hold_s_route === null;
  return out;
}

// Route arc length at which a lane change has moved the car LANE_CLEAR_M away from the lane it left.
function laneClearS(shift, fromCenter, toCenter) {
  const need = LANE_CLEAR_M / Math.max(LANE_CLEAR_M, Math.abs(toCenter - fromCenter));
  let u = 0;
  while (u < 1 && u * u * (3 - 2 * u) < need) u += 0.02;
  return shift.start + u * shift.len;
}

// The lanes either side of the car's lane that run beside the route: the nearest vehicle ahead and
// behind in each, whether the gap fits a lane change, the speed the car could keep there, and
// whether a change is on offer: "pass" to get past a slow or stopped vehicle in this lane, "return"
// toward the route's lane, or "abort" to go back to the lane a change started from.
function laneOptions(snap, world) {
  const { route, lane, ego } = snap;
  const p = snap.routeProj, s = p.s, FRONT = ego.front_m, REAR = world.ego.spec.rearOverhang;
  const vehicles = snap.observed.filter((o) => o.kind !== "pedestrian");
  const free = desiredSpeed({ ...snap, following: null }).v;
  const i = snap.intersection;
  const line = snap.control_line_m ?? (i ? i.bumper_to_line_m : Infinity);
  const inJunction = (limit) => line < limit && line > -12;
  const f = snap.following;
  // A car waiting at the junction is a queue, not something to pass, and so is a slow or stopped car
  // in the lane the route takes for a turn coming up: the car waits behind it rather than overtake.
  const turnLane = lane.route_ahead || (snap.nav && snap.nav.next_turn !== "none" && snap.nav.turn_in_m < PREPARE_LANE_M);
  const slowAhead = f && f.gap_m < 60 && (f.speed < 0.5 || f.speed < free - 2.5 || f.kind !== "car")
    && !(i && line < f.gap_m + 20) && !(turnLane && f.kind === "car");
  // In the lane next to a vehicle stopped at the roadside with its lights flashing, still short of it:
  // move over, to the lane on the left, if it runs on past it.
  const rs = snap.roadside_stop;
  const moveOver = rs && rs.in_adjacent_lane && rs.other_lane && rs.gap_m > MOVE_OVER_MIN_M;
  for (const dir of ["left", "right"]) {
    const delta = lane.delta + (dir === "left" ? -1 : 1);
    const span = route.laneSpan(s, delta);
    if (!span) continue;
    const side = { delta, dir, center: span.offset, until_s: delta ? span.until : null, leader: null, rear: null, alongside: false };
    for (const o of vehicles) {
      const q = route.project(o.x, o.y, p.index);
      if (!q || Math.abs(q.lateral + route.frameMove(s, q.s) - span.offset) > 1.7 || Math.abs(q.s - s) > TRAFFIC_RADIUS_M) continue;
      if (Math.abs(o.v) > 0.5 && Math.abs(wrap(o.psi - q.heading)) > Math.PI / 2) continue;
      const spec = o.spec || CAR;
      const ahead = q.s - spec.rearOverhang - (s + FRONT), behind = s - REAR - (q.s + spec.length - spec.rearOverhang);
      if (ahead > 0) { if (!side.leader || ahead < side.leader.gap_m) side.leader = { id: o.id, gap_m: ahead, speed: Math.max(0, o.v) }; }
      else if (behind > 0) { if (!side.rear || behind < side.rear.gap_m) side.rear = { id: o.id, gap_m: behind, speed: Math.max(0, o.v) }; }
      else side.alongside = true;
    }
    const v = Math.max(0, ego.v);
    side.gap_ok = !side.alongside
      && (!side.leader || side.leader.gap_m >= LANE_GAP_M + Math.max(0, v - side.leader.speed) * GAP_AHEAD_S)
      && (!side.rear || side.rear.gap_m >= LANE_GAP_M + Math.max(0, side.rear.speed - v) * GAP_BEHIND_S);
    side.target_v = desiredSpeed({ ...snap, following: side.leader ? { gap_m: side.leader.gap_m, speed: side.leader.speed } : null }).v;
    const room = (side.until_s ?? route.length) - (s + FRONT);
    if (lane.shift) side.offer = delta === lane.from_delta && !inJunction(CHANGE_JUNCTION_M) ? "abort" : null;
    else if (Math.abs(delta) < Math.abs(lane.delta)) side.offer = inJunction(CHANGE_JUNCTION_M) ? null : "return";
    else side.offer = slowAhead && side.target_v > f.speed + 2 && room >= Math.max(80, 2 * laneChangeLength(v) + 30) && !inJunction(PASS_JUNCTION_M) ? "pass"
      : moveOver && dir === "left" && (side.until_s ?? route.length) > rs.s_front_route + MOVE_OVER_PAST_M && !inJunction(CHANGE_JUNCTION_M) ? "move_over" : null;
    lane.sides[dir] = side;
  }
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
  // a school or playground zone: down to its limit by the time the front reaches its sign, gently
  const z = snap.speed_zone;
  if (z?.in_zone) reasons.push(ZONE_NAMES[z.kind]);
  else if (z) {
    const lim = z.limit_mps * (weather.speed < 1 ? weather.speed : 1);
    const vz = Math.sqrt(lim * lim + 2 * decel * 0.6 * Math.max(0, z.starts_in_m - 2));
    if (vz < v) { v = vz; reasons.push(`${ZONE_NAMES[z.kind]} ahead`); }
  }
  // a vehicle stopped at the roadside with its lights flashing: down to the speed to pass it at a
  // little before APPROACH_M short of it, gently, and no faster until past it
  const rs = snap.roadside_stop;
  if (rs) {
    const vr = roadsideSpeed(rs, weather.speed < 1 ? weather.speed : 1);
    if (vr <= v + 0.05) { v = Math.min(v, vr); reasons.push(rs.gap_m <= APPROACH_M ? `passing a ${rs.name} with its lights flashing` : `${rs.name} ahead, lights flashing`); }
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
  // (a car just past a signal's line, short of CLEARING_M, still stops for it, unless it is turning
  // right on red)
  if (i && (i.control === "signal" ? i.bumper_to_line_m > -CLEARING_M : !i.entered) && ((i.control === "signal" && (i.signal === "red" || i.signal === "yellow" || i.signal === "unknown") && !i.right_on_red?.go) || (i.control === "stop" && !i.stop_completed))) {
    // inside the stop zone the target is a full stop; before it, the speed from which the car can still stop at the line
    const vs = i.bumper_to_line_m < STOP_ZONE_M ? 0 : stopSpeedFor(Math.max(0, i.bumper_to_line_m - 0.5), decel);
    if (vs < v) { v = vs; reasons.push(i.control === "signal" ? `${i.signal} light` : "stop sign"); }
  }
  if (i && i.control === "stop" && i.stop_completed && i.cross_traffic_moving && !i.entered) { v = 0; reasons.push("cross traffic"); }
  if (waitsItsTurn(i)) { v = 0; reasons.push("waiting its turn"); }
  // giving way at a two-way stop or a junction without a sign: stop where it must; to look along a
  // street it cannot see, slow so it can stop, then, from the stop zone before the line, creep up to
  // the point it looks from
  const g = i?.give_way;
  if (g && g.bumper_to_hold_m !== null) {
    const room = g.bumper_to_hold_m;
    const vg = g.wait_for ? (room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel))
      : room < PEEK_AT_M ? 0 : i.bumper_to_line_m < STOP_ZONE_M ? PEEK_MPS : Math.max(PEEK_MPS, stopSpeedFor(room - 0.3, decel));
    if (vg < v) { v = vg; reasons.push(g.wait_for ? "giving way" : "looking for traffic"); }
  }
  if (i && i.control === "yield" && !i.entered) {
    const entry = YIELD_ENTRY_MPS * Math.sqrt(decel / 2.5);
    // roundabout: stop at the line for traffic in the ring, otherwise enter at a walking-plus pace
    const vy = i.cross_traffic_moving ? (i.bumper_to_line_m < STOP_ZONE_M ? 0 : stopSpeedFor(Math.max(0, i.bumper_to_line_m - 0.5), decel))
      : Math.sqrt(entry * entry + 2 * decel * Math.max(0, i.bumper_to_line_m));
    if (vy < v) { v = vy; reasons.push(i.cross_traffic_moving ? "yield to roundabout traffic" : "roundabout"); }
  }
  if (i && i.oncoming) {
    const room = i.oncoming.bumper_to_yield_m;
    const vo = room < 1.5 ? 0 : stopSpeedFor(room - 1.0, decel);
    if (vo < v) { v = vo; reasons.push("oncoming traffic"); }
  }
  if (snap.right_hook) {
    const room = snap.right_hook.bumper_to_yield_m;
    const vh = room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel);
    if (vh < v) { v = vh; reasons.push("cyclist on the right"); }
  }
  if (snap.bus) {
    const room = snap.bus.bumper_to_stop_m;
    const vb = room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel);
    if (vb < v) { v = vb; reasons.push("bus pulling out"); }
  }
  const ev = snap.emergency;
  if (ev && ev.bumper_to_stop_m !== null) {
    const room = ev.bumper_to_stop_m;
    // (slowing from the start, as gently as it planned to)
    const ve = room < 1.0 ? 0 : stopSpeedFor(room - 0.5, Math.min(decel, EV_STOP_DECEL));
    if (ve < v) { v = ve; reasons.push(`pulling over for the ${ev.kind}`); }
  }
  // an emergency vehicle it let go by: drop back to FOLLOW_M behind it (standing still within 30 m)
  const ea = snap.emergency_ahead;
  if (ea) {
    const va = ea.speed * Math.max(0, Math.min(1, (ea.gap_m - 30) / (FOLLOW_M - 30)));
    if (va < v) { v = va; reasons.push(`keeping ${FOLLOW_M} m behind the ${ea.kind}`); }
  }
  if (snap.crosswalk_stop) {
    const room = snap.crosswalk_stop.bumper_to_stop_m;
    const vc = room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel);
    if (vc < v) { v = vc; reasons.push("car stopped at a crosswalk"); }
  }
  // a school bus with its reds flashing: stop short of it; with its ambers, slow down, ready to
  const sb = snap.school_bus;
  if (sb && (sb.lights === "red" || sb.bumper_to_stop_m > 0)) {
    const room = sb.bumper_to_stop_m;
    const vs = sb.lights === "red" ? (room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel)) : Math.max(AMBER_MIN_MPS, stopSpeedFor(room, decel));
    if (vs < v) { v = vs; reasons.push(sb.lights === "red" ? "school bus stopped, red lights flashing" : "school bus about to stop"); }
  }
  // a streetcar with its doors open: stop behind them; slowing for its stop, slow down, ready to
  const sc = snap.streetcar;
  if (sc) {
    const room = sc.bumper_to_stop_m;
    const vs = sc.doors ? (room < 1.0 ? 0 : stopSpeedFor(room - 0.5, decel)) : Math.max(AMBER_MIN_MPS, stopSpeedFor(room, decel));
    if (vs < v) { v = vs; reasons.push(sc.doors ? "streetcar stopped, doors open" : "streetcar stopping"); }
  }
  if (snap.pedestrian) {
    const room = snap.pedestrian.bumper_to_crosswalk_m - CROSSWALK_STOP_M;
    const vp = room < 1.0 ? 0 : stopSpeedFor(room, decel);
    if (vp < v) { v = vp; reasons.push("pedestrian crossing"); }
  }
  if (snap.nav && snap.nav.turn_round_in_m !== undefined) {
    const vr = stopSpeedFor(Math.max(0, snap.nav.turn_round_in_m), decel);
    if (vr < v) { v = vr; reasons.push("turning round ahead"); }
  }
  if (snap.nav) {
    const vd = stopSpeedFor(Math.max(0, snap.nav.remaining_m - 1), decel * 0.8);
    if (vd < v) { v = vd; reasons.push("destination"); }
  }
  return { v: Math.max(0, v), reasons };
}

// The speed to pass a vehicle stopped at the roadside at (see roadsideStop), or, short of it, the speed
// from which the car slows to that comfortably by 5 m before APPROACH_M short of it.
function roadsideSpeed(rs, factor = 1) {
  const lim = rs.limit_mps * factor;
  return Math.sqrt(lim * lim + 2 * comfort().decel * 0.6 * Math.max(0, rs.gap_m - APPROACH_M - 5));
}

// Stopped at an all-way stop, waiting for a vehicle that goes first (a car that overshot the line
// still waits there; one well into the junction is clearing it).
export function waitsItsTurn(i) {
  return !!(i && i.control === "stop" && i.stop_completed && i.priority?.arrived && !i.priority.go && i.bumper_to_line_m > -CLEARING_M);
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
  if (snap.intersection?.oncoming) f.push("oncoming");
  if (snap.nav && snap.nav.next_turn !== "none" && snap.nav.turn_in_m < 50) f.push("turn");
  if (snap.following && snap.following.gap_m < 15) f.push("following");
  if (snap.roadside?.some((o) => o.kind !== "parked car")) f.push("roadside activity");
  if (snap.pedestrian) f.push("pedestrian");
  if (snap.right_hook) f.push("cyclist");
  if (snap.emergency) f.push("emergency vehicle");
  if (snap.bus) f.push("bus");
  if (snap.crosswalk_stop) f.push("crosswalk");
  if (snap.school_bus) f.push("school bus");
  if (snap.streetcar) f.push("streetcar");
  if (snap.roadside_stop) f.push("roadside vehicle");
  if (snap.traffic.some((t) => t.ahead > 0 && t.ahead < 25 && Math.abs(t.right) < 8)) f.push("traffic");
  if (snap.routeProj && Math.abs(snap.lane ? snap.lane.lateral : snap.routeProj.lateral) > 0.8) f.push("lane");
  if (snap.lane && (snap.lane.shift || snap.lane.delta)) f.push("lane change");
  if (!snap.road.on_road) f.push("off_road");
  if (snap.stuck) f.push("stuck");
  if (snap.current_path_hazard) f.push("hazard");
  if (snap.nav && snap.nav.remaining_m < 30) f.push("arriving");
  return f;
}
