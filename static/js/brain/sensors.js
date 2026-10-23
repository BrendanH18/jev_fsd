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

export const LOOK_AHEAD_CONTROL_M = 80;
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
    const frontS = p.s + FRONT;
    for (let k = 0; k < route.controls.length; k++) {
      const c = route.controls[k], control = c.control, next = route.controls[k + 1];
      const leftTurn = (control.type === "signal" || control.type === "stop") && (c.turn === "left" || c.turn === "uturn") && c.sJunction !== null;
      // already through this one (a left turn stays in view until the car is past oncoming traffic,
      // unless the next control is coming up)
      if (c.sRoute + 12 < frontS && !(leftTurn && frontS < c.sJunction + JUNCTION_BOX_M && !(next && next.sRoute - frontS < NEXT_CONTROL_M))) continue;
      if (c.sRoute - frontS > LOOK_AHEAD_CONTROL_M) break;
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
      // at a stop sign, oncoming traffic matters once the stop is made and it is the car's turn
      const turnNow = control.type === "stop" ? entered || (stopCompleted && !(priority?.arrived && !priority.go)) : entered || signal === "green" || signal === "yellow";
      snap.intersection = {
        id: control.id, control: control.type, signal, group: control.group || null,
        bumper_to_line_m: bumperToLine, s_line_route: c.sRoute,
        entered, turn: c.turn || "straight",
        oncoming: leftTurn && turnNow ? oncomingYield(world, c, frontS) : null,
        right_on_red: control.type === "signal" && map.rightOnRed && c.turn === "right" && signal === "red" && bumperToLine > -CLEARING_M && inter
          ? rightOnRed(world, c, inter, frontS, visible) : null,
        stop_completed: stopCompleted,
        all_way: control.type === "stop" ? !!control.all_way : null,
        priority,
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
    snap.roadside.push({ id: o.id, kind: o.kind === "door" ? "open door" : o.parking ? "parking" : o.pull ? "pulling out" : "parked car", right: local.right, ahead: local.ahead, signal: o.signal || null });
  }
  snap.roadside.sort((a, b) => a.ahead - b.ahead);
  snap.roadside = snap.roadside.slice(0, 6);
  snap.traffic.sort((a, b) => a.dist - b.dist);
  snap.traffic = snap.traffic.slice(0, 8);
  if (executing && executing.hazard) snap.current_path_hazard = executing.hazard;
  snap.target = desiredSpeed(snap);
  if (snap.lane) laneOptions(snap, world);
  return snap;
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
  const shifting = delta === planned && law.shift && p.s < law.shift.start + law.shift.len - 0.5;
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
// most TURN_MPS (holding its speed if already faster).
function clearTime(v, distance) {
  const v0 = Math.min(Math.max(0, v), TURN_MPS);
  const t1 = (TURN_MPS - v0) / TURN_ACCEL, d1 = (v0 + TURN_MPS) / 2 * t1;
  return d1 >= distance ? (Math.sqrt(v0 * v0 + 2 * TURN_ACCEL * distance) - v0) / TURN_ACCEL : t1 + (distance - d1) / TURN_MPS;
}

// Seconds until a vehicle covers `distance`: at its speed, or, while it speeds up, accelerating as it
// is now (at most ETA_ACCEL_MAX) until it reaches its street's limit.
function etaOf(world, n, distance) {
  if (distance <= 0) return 0;
  const v = Math.max(0, n.v), a = Math.min(ETA_ACCEL_MAX, Math.max(0, n.a || 0));
  if (a < 0.05) return v > 0.05 ? distance / v : Infinity;
  const vMax = Math.max(v, world.map.nearestLane(n.x, n.y, n.psi, 6)?.lane.edgeRef.limit || 13.9);
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
      const far = JUNCTION_BOX_M / 2 + (e.limit || 13.9) * need, L = e.cum[e.cum.length - 1], h = map.headingOut(e.id);
      const at = (back) => {
        const [x, y] = pointAt(e.pts, e.cum, Math.max(0, L - back)), beyond = Math.max(0, back - L);
        return [x - Math.cos(h) * beyond, y - Math.sin(h) * beyond];
      };
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
  const line = i ? i.bumper_to_line_m : Infinity;
  const inJunction = (limit) => line < limit && line > -12;
  const f = snap.following;
  // A car waiting at the junction is a queue, not something to pass, and so is a slow or stopped car
  // in the lane the route takes for a turn coming up: the car waits behind it rather than overtake.
  const turnLane = lane.route_ahead || (snap.nav && snap.nav.next_turn !== "none" && snap.nav.turn_in_m < PREPARE_LANE_M);
  const slowAhead = f && f.gap_m < 60 && (f.speed < 0.5 || f.speed < free - 2.5 || f.kind !== "car")
    && !(i && line < f.gap_m + 20) && !(turnLane && f.kind === "car");
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
    else side.offer = slowAhead && side.target_v > f.speed + 2 && room >= Math.max(80, 2 * laneChangeLength(v) + 30) && !inJunction(PASS_JUNCTION_M) ? "pass" : null;
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
  if (snap.traffic.some((t) => t.ahead > 0 && t.ahead < 25 && Math.abs(t.right) < 8)) f.push("traffic");
  if (snap.routeProj && Math.abs(snap.lane ? snap.lane.lateral : snap.routeProj.lateral) > 0.8) f.push("lane");
  if (snap.lane && (snap.lane.shift || snap.lane.delta)) f.push("lane change");
  if (!snap.road.on_road) f.push("off_road");
  if (snap.stuck) f.push("stuck");
  if (snap.current_path_hazard) f.push("hazard");
  if (snap.nav && snap.nav.remaining_m < 30) f.push("arriving");
  return f;
}
