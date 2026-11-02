// Sample maneuvers, forward-sim 3 s with the real controller and car model, then reject unsafe
// ones. Brains only pick among survivors. Other agents use constant-velocity predictions from
// visible observations and can change behavior after a choice.

import { CAR, comfort } from "../sim/vehicle.js";
import { applyLaw, lateralAt, laneCenterAt, laneChangeLength } from "../sim/controller.js";
import { obbOverlap } from "../sim/collision.js";
import { wrap } from "../sim/world.js";
import { EV_STOP_DECEL, CROSSWALK_STOP_M, LANE_CLEAR_M, ONCOMING_STOP_M, HOOK_STOP_M, CLEARING_M, PEEK_MPS, waitsItsTurn } from "./sensors.js";
import { poseOf } from "../sim/static-obstacles.js";
import { STOP_ZONE_M } from "../sim/signals.js";
import { PEEK_AT_M } from "../sim/priority.js";
import { planTurnaround } from "../sim/turnaround.js";
import { TRY_START_M, planParking, planPullOut } from "../sim/parallel-park.js";
import { isEmergency } from "../sim/emergency.js";
import { SAME_LANE_M } from "../sim/snow-plow.js";
import { isCyclistPass, minPassM } from "../sim/cyclist-pass.js";

export const HORIZON_S = 3.0;
export const SIM_DT = 0.1;
const LANE_TOL = 1.2;
const CYCLIST_CLEARANCE_M = 1.0;
// Passing a cyclist through the oncoming lane (sim/cyclist-pass.js): no manoeuvre that goes round one
// may have the car, its far side across the centre line, meet a vehicle coming the other way in its way
// closer than this front to front, or this soon at the speed they close at (as the audit counts it).
const MEET_M = 8, MEET_S = 2, MEET_SIDE_M = 0.5;
const QUEUE_GAP_M = 2.5;
const LANE_RETURN_MARGIN_M = 8;
// Inside the stay-back distance behind a snow plow, a manoeuvre may not end up closer to it than now,
// give or take this.
const PLOW_CLOSING_M = 0.05;
const MIN_CHANGE_M = 12;
// Scenery standing in the car's lane ahead, as far as this, gets nudges of a full metre on offer.
const SCENERY_LOOK_M = 40;
// Pulling up where the car reverses into a space, it brakes at no more than this.
const PARK_STOP_DECEL = 1.2;   // the sharpest lane change offered, for leaving a lane about to end

function speedLabel(v, ego, limit) {
  if (v <= 0.05) return "stop";
  if (Math.abs(v - ego) < 0.3) return `keep ${v.toFixed(1)}`;
  if (v >= limit - 0.05) return `limit ${v.toFixed(1)}`;
  return v < ego ? `slow to ${v.toFixed(1)}` : `speed up to ${v.toFixed(1)}`;
}

export function speedVsTarget(v, target) {
  if (Math.abs(v - target) < 0.4) return "at target";
  return v < target ? (v <= 0.05 ? "stopped" : "below target") : "above target";
}

// Whether scenery stands in the car's lane within SCENERY_LOOK_M (a building's corner mapped over the
// curb lane, say): the car, centred in the lane (`center` metres right of the route), would touch it.
// A half-metre nudge may not clear it, and without a wider one the car could only stop short of it.
function sceneryInLane(snap, world, center) {
  const route = snap.route, p = snap.routeProj, obstacles = world.staticObstacles;
  if (!route || !p || !obstacles) return false;
  for (let d = 2; d <= SCENERY_LOOK_M && p.s + d < route.length; d += 2) {
    const [x, y] = route.pointAt(p.s + d), h = route.headingAt(p.s + d);
    if (obstacles.touching({ x: x + Math.sin(h) * center, y: y - Math.cos(h) * center, psi: h }, world.ego.spec)) return true;
  }
  return false;
}

export function sampleCandidates(snap, world) {
  const { ego, limit } = snap;
  const FRONT = world.ego.spec.length - world.ego.spec.rearOverhang;
  const v = Math.max(0, ego.v);
  const out = [];
  const offRoad = !snap.road.on_road;
  const lost = !snap.route || !snap.onRoute;

  // The plan for staying in the current lane: an unfinished lane change carries on. Lateral nudges
  // and stops keep the same lane.
  const lane = snap.lane;
  const s = snap.routeProj ? snap.routeProj.s : 0;
  const keep = { lane: lane ? lane.delta : 0, center: lane ? lane.center : 0, ...(lane ? { laneIdx: lane.index, chain: lane.chain } : {}) };
  const shifting = lane?.shift || null;
  const laneUntil = lane && lane.delta ? lane.until_s : null;
  // A continuing change keeps the lane it started from, so going back stays on offer.
  const carry = shifting ? { shift: shifting, ...(lane.from_delta !== null ? { fromLane: lane.from_delta, fromIdx: lane.route_index + lane.from_delta } : {}) } : {};
  // (round a work zone's closed stretch, through the other lane, whatever else the car does: see
  // brain/sensors.js workZone; and round a double-parked van, through the oncoming lane, once the way
  // round is clear or the car has started round it: see doubleParked)
  // (and, in a lane that is closed ahead, across into the open lane at the merge point: see laneClosure)
  // (round a cyclist, through the oncoming lane, only `pass_cyclist` goes, at the pass speed the way
  // round was worked out for, and `hard_brake` keeps to it: see cyclistPass)
  const detour = snap.work_zone?.detour ? { detour: snap.work_zone.detour } : snap.lane_closure?.detour ? { detour: snap.lane_closure.detour } : snap.double_parked?.detour ? { detour: snap.double_parked.detour } : {};
  const passing = snap.cyclist_pass?.detour && !detour.detour ? { detour: snap.cyclist_pass.detour } : {};
  const inLane = (law) => ({ ...law, offset: keep.center + (law.offset || 0), ...keep, ...(law.offset ? {} : carry), ...detour });
  // Scenery in the lane ahead: nudges of a full metre are offered, and the car stops at a line, or
  // brakes hard, where it is (to the nearest half metre either way), not back in the middle of the
  // lane beside it.
  const scenery = !shifting && !!lane && sceneryInLane(snap, world, keep.center);
  const nudge = scenery ? Math.round(Math.max(-1, Math.min(1, lane.lateral)) * 2) / 2 : 0;

  if (!lost && !offRoad) {
    // (with scenery in the lane the full-metre nudges come first, so the cap on candidates below
    // cuts half-metre ones rather than either of them)
    const offsets = shifting ? [0] : scenery ? [0, -1.0, 1.0, -0.5, 0.5] : [0, -0.5, 0.5];
    const lateral = lane ? Math.abs(lane.lateral) : snap.routeProj ? Math.abs(snap.routeProj.lateral) : 0;
    if (!shifting && !scenery && (lateral > 0.5 || snap.following || (snap.traffic.length || snap.roadside?.length))) offsets.push(-1.0, 1.0);
    const target = snap.target ? snap.target.v : limit;
    const speeds = new Set([0, Math.max(0, v - 3), v, Math.min(limit, v + 2), limit, target, target * 0.75].map((x) => Math.round(Math.max(0, Math.min(limit, x)) * 10) / 10));
    for (const d of offsets) {
      for (const vt of [...speeds].sort((a, b) => b - a)) {
        const name = Math.abs(vt - target) < 0.15 && vt > 0.05 ? "target" : vt <= 0.05 ? "stop" : Math.abs(vt - target * 0.75) < 0.06 ? "cautious" : Math.abs(vt - v) < 0.3 ? "hold" : vt >= limit - 0.05 ? "limit" : vt < v ? "slow" : "faster";
        const prefix = d === 0 ? "keep_lane" : `${d < 0 ? "left" : "right"}_${Math.abs(d)}`;
        if (d !== 0 && name !== "hold" && name !== "target") continue;  // lateral shifts only at hold/target speeds
        out.push({ id: `${prefix}_${name}`, law: inLane({ kind: "lane", offset: d, vTarget: vt }), laneUntil,
          steer: d === 0 ? (shifting ? `continue into the ${lane.from_center > keep.center ? "left" : "right"} lane` : "hold lane") : `shift ${Math.abs(d)} m ${d < 0 ? "left" : "right"}`, speed: speedLabel(vt, v, limit) });
      }
    }
    // Change into a lane beside this one: to pass, to move over for a vehicle stopped at the roadside
    // with its lights flashing, to return toward the route's lane, or to go back to the lane a change
    // started from. The car signals and eases across over about 3.5 s, or more sharply to finish
    // before the lane it is leaving ends; too late for that, it waits. The prediction checks the car
    // is actually across by then (`leave`).
    const leaving = lane && lane.delta ? lane.until_s - s - FRONT : Infinity;
    const leave = lane && lane.delta ? { by: lane.until_s, center: lane.center } : null;
    const len = Math.max(MIN_CHANGE_M, Math.min(laneChangeLength(v), leaving));
    for (const side of lane ? Object.values(lane.sides) : []) {
      if (!side.offer) continue;
      const prepare = side.delta === 0 && lane.route_ahead && side.offer === "return";
      const toRoute = side.delta === 0 ? (prepare ? " for the turn ahead" : " (the route's lane)") : "";
      // (moving over, also at the speed it could keep there: it is no time to hang back)
      const vs = new Set([v, Math.min(side.target_v, v + 2), ...(side.offer === "pass" ? [] : [Math.max(0, v - 3)]), ...(side.offer === "move_over" ? [side.target_v] : [])].map((x) => Math.round(Math.max(0, Math.min(limit, x)) * 10) / 10));
      for (const vt of [...vs].sort((a, b) => b - a)) {
        if (vt <= 0.05) continue;
        const name = Math.abs(vt - v) < 0.3 ? "hold" : vt > v ? "faster" : "slow";
        out.push({ id: `change_${side.dir}_${name}`, change: { dir: side.dir, offer: side.offer, ...(prepare ? { prepare } : {}), gap_ok: side.gap_ok, too_late: leaving < MIN_CHANGE_M, leave }, laneUntil: side.until_s, laneTarget: side.target_v,
          law: { kind: "lane", offset: side.center, center: side.center, lane: side.delta, laneIdx: lane.route_index + side.delta, chain: lane.chain, fromLane: lane.delta, fromIdx: lane.index, vTarget: vt,
            shift: { from: snap.routeProj.lateral, start: s, len } },
          steer: side.offer === "pass" ? `change to the ${side.dir} lane to pass` : side.offer === "abort" ? `move back to the ${side.dir} lane`
            : side.offer === "move_over" ? `move over to the ${side.dir} lane, away from the stopped ${snap.roadside_stop.name}` : `${prepare ? "change" : "return"} to the ${side.dir} lane${toRoute}`, speed: speedLabel(vt, v, limit) });
      }
    }
    // Stopping maneuvers stop at their mark or queue 2.5 m behind whoever is in front of it, and
    // approach no faster than the target speed (which already allows for a slowing car ahead).
    const approach = Math.min(limit, Math.max(target, 3));
    const f = snap.following;
    const queue = f ? f.s - (f.vehicle.spec || CAR).rearOverhang - FRONT - QUEUE_GAP_M : Infinity;
    const stopAt = (mark) => Math.min(mark, queue);
    if (snap.intersection && snap.intersection.bumper_to_line_m > 0.3) {
      out.push({ id: "stop_at_line", laneUntil, law: inLane({ kind: "lane", offset: nudge, vTarget: approach, stopAtRoute: stopAt(snap.intersection.s_line_route - FRONT - 0.5) }),
        steer: "hold lane", speed: "approach and stop at the line" });
    }
    // Giving way at a two-way stop or a junction without a sign: past the line, wait where the car
    // looks from; to look along a street it cannot see, creep up to that point.
    const give = snap.intersection?.give_way;
    if (give && give.bumper_to_hold_m !== null && give.bumper_to_hold_m > 0.3 && (give.hold_s_route > snap.intersection.s_line_route || !give.wait_for)) {
      const creep = !give.wait_for, zone = snap.intersection.bumper_to_line_m < STOP_ZONE_M;
      out.push({ id: creep ? "creep_to_look" : "wait_to_give_way", laneUntil,
        law: inLane({ kind: "lane", vTarget: creep ? (zone ? PEEK_MPS : Math.min(limit, Math.max(target, PEEK_MPS))) : approach, stopAtRoute: stopAt(give.hold_s_route - FRONT - (creep ? 0.3 : 0.5)) }),
        steer: "hold lane", speed: creep ? "creep forward to see along the crossing street, and stop there" : "stop and give way to crossing traffic" });
    }
    // Turning left with oncoming traffic coming: wait short of its path, at the line or in the junction.
    const oncoming = snap.intersection?.oncoming;
    if (oncoming && oncoming.bumper_to_yield_m > 0.3) {
      out.push({ id: "stop_for_oncoming", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(oncoming.yield_s_route - FRONT - 0.5) }),
        steer: "hold lane", speed: "stop and wait for oncoming traffic before turning" });
    }
    // Turning right with a cyclist coming up on the right: wait short of its line of travel.
    const hook = snap.right_hook;
    if (hook && hook.bumper_to_yield_m > 0.3) {
      out.push({ id: "stop_for_cyclist", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(hook.yield_s_route - FRONT - 0.5) }),
        steer: "hold lane", speed: "stop and let the cyclist on the right go by before turning" });
    }
    // An emergency vehicle calling on the car to give way: pull over to the right and stop there,
    // braking as gently as the stop was planned for.
    const ev = snap.emergency;
    if (ev && ev.stop_s_route !== null) {
      out.push({ id: "pull_over", laneUntil, law: inLane({ kind: "lane", offset: ev.offset_m, vTarget: approach, stopAtRoute: stopAt(ev.stop_s_route - FRONT - 0.5), stopDecel: EV_STOP_DECEL }),
        steer: `pull over ${ev.offset_m.toFixed(1)} m to the right`, speed: ev.bumper_to_stop_m > 0.3 ? `stop at the side of the road${ev.clearing ? ", past the junction" : ""}` : "hold still at the side of the road" });
    }
    // A bus pulling out from its stop ahead, with the right of way: stop behind it and let it out.
    if (snap.bus && snap.bus.bumper_to_stop_m > 0.3) {
      out.push({ id: "yield_to_bus", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(snap.bus.stop_s_route - FRONT - 0.5) }),
        steer: "hold lane", speed: "stop behind the bus and let it pull out" });
    }
    // A vehicle stopped at a marked crosswalk in the next lane: stop short of the crosswalk, beside
    // it, and look before passing it.
    const cwStop = snap.crosswalk_stop;
    if (cwStop && cwStop.bumper_to_stop_m > 0.3) {
      out.push({ id: "stop_at_crosswalk", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(cwStop.stop_s_route - FRONT) }),
        steer: "hold lane", speed: `stop short of the crosswalk beside the stopped ${cwStop.kind}` });
    }
    // A school bus with its reds flashing, ahead or coming toward the car: stop short of it, and stay
    // stopped while they flash.
    const school = snap.school_bus;
    if (school && school.lights === "red" && school.bumper_to_stop_m > 0.3) {
      out.push({ id: "stop_for_school_bus", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(school.stop_s_route - FRONT) }),
        steer: "hold lane", speed: school.relation === "behind" ? "stop behind the school bus" : "stop short of the school bus coming the other way" });
    }
    // A streetcar ahead with its doors open: stop behind its rear doors (behind it, in its lane), and
    // stay stopped while they are open.
    const tram = snap.streetcar;
    if (tram && tram.doors && tram.bumper_to_stop_m > 0.3) {
      out.push({ id: "stop_for_streetcar", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(tram.stop_s_route - FRONT) }),
        steer: "hold lane", speed: tram.beside ? "stop behind the streetcar's rear doors" : "stop behind the streetcar" });
    }
    // A level crossing to wait at (a train coming, or no room past the tracks): stop 7 m back from the
    // nearest rail, and stay stopped there until the train has passed and there is room.
    const lx = snap.level_crossing;
    if (lx?.wait && lx.bumper_to_stop_m > 0.3) {
      out.push({ id: "stop_before_tracks", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(lx.stop_s_route - FRONT) }),
        steer: "hold lane", speed: lx.wait === "train" ? "stop short of the level crossing for the train" : "wait short of the tracks for room past them" });
    }
    // A signal it could not clear, for traffic past the junction: wait at the line, even on a green,
    // until there is room for all of the car beyond it.
    const jb = snap.junction_box;
    if (jb && jb.bumper_to_stop_m > 0.3) {
      out.push({ id: "wait_short_of_junction", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(jb.stop_s_route - FRONT) }),
        steer: "hold lane", speed: "wait at the line for room past the junction" });
    }
    // A work zone's flagger showing STOP: stop at the line, and stay stopped until the paddle turns to SLOW.
    const wz = snap.work_zone;
    if (wz?.wait && wz.bumper_to_stop_m > 0.3) {
      out.push({ id: "stop_for_flagger", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(wz.stop_s_route - FRONT - 0.5) }),
        steer: "hold lane", speed: "stop at the line for the flagger's STOP paddle" });
    }
    // A lane closed ahead (sim/lane-closure.js): in the closed lane, wait at the merge point for the car's
    // turn; in the open lane, stop short of it to let in the one whose turn it is.
    const lz = snap.lane_closure;
    if (lz?.stop_s_route != null && lz.bumper_to_stop_m > 0.3) {
      // (a metre short of the merge point, and half a metre short of where it lets one in, as a stop
      // overshoots)
      out.push(lz.wait ? { id: "wait_to_merge", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(lz.stop_s_route - FRONT - 1) }),
        steer: "hold lane", speed: "stop at the merge point and wait for the car's turn" }
        : { id: "let_merge_in", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(lz.stop_s_route - FRONT - 0.5) }),
          steer: "hold lane", speed: "stop short of the merge point and let the car in the closed lane go first" });
    }
    // A van double-parked in the lane ahead, and no way round it yet: stop behind it, back far enough to
    // pull out round it, and wait there until the oncoming lane is clear.
    const dp = snap.double_parked;
    if (dp?.wait && dp.bumper_to_stop_m > 0.3) {
      out.push({ id: "wait_behind_van", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(dp.stop_s_route - FRONT) }),
        steer: "hold lane", speed: dp.queued ? "stop behind the car waiting at the double-parked van" : "stop behind the double-parked van and wait for the oncoming lane to clear" });
    }
    // A cyclist riding in the lane ahead that the car can pass only through the oncoming lane
    // (sim/cyclist-pass.js): go round it at the pass speed, once the way is clear (or carry on round it);
    // or, still behind it, stay behind it at the following gap, in the lane.
    const cp = snap.cyclist_pass;
    if (cp?.go) {
      out.push({ id: "pass_cyclist", laneUntil, laneTarget: cp.limit_mps, law: { ...inLane({ kind: "lane", vTarget: cp.limit_mps }), ...passing },
        steer: cp.going ? "carry on round the cyclist, then back into the lane ahead of it" : `pull out round the cyclist, ${cp.min_pass_m} m clear of it`, speed: speedLabel(cp.limit_mps, v, limit) });
    }
    if (cp && !cp.beside) {
      const behind = inLane({ kind: "lane", vTarget: Math.round(Math.min(limit, cp.follow_mps) * 10) / 10 });
      out.push({ id: "follow_cyclist", laneUntil, law: behind, steer: "hold lane, behind the cyclist", speed: `stay ${cp.follow_gap_m} m behind the cyclist` });
    }
    if (snap.pedestrian && snap.pedestrian.bumper_to_crosswalk_m > CROSSWALK_STOP_M + 0.3) {
      out.push({ id: "stop_for_pedestrian", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(snap.pedestrian.s_route - FRONT - CROSSWALK_STOP_M) }),
        steer: "hold lane", speed: snap.pedestrian.mid_block ? "stop short of the crossing pedestrian" : "stop before the crosswalk" });
    }
    // A U-turn ahead (at a dead end): stop where the car will turn round.
    const turnIn = snap.nav?.turn_round_in_m;
    if (turnIn !== undefined && turnIn > 0.3 && snap.nav.turn_in_m < 40) {
      out.push({ id: "stop_to_turn_round", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(s + turnIn) }),
        steer: "hold lane", speed: "stop where the car turns round" });
    }
    // A space to park in near the destination (sim/parallel-park.js): pull up alongside the car in front
    // of it, a little right of the lane's centre, signalling, and wait there until nothing is coming
    // from behind. The space is the destination now.
    const pk = snap.parking?.mode === "in" && !world.parking ? snap.parking : null;
    if (pk && pk.stop_in_m > -TRY_START_M) {
      // (the last few metres gently: the car stops alongside the car in front, near enough exactly)
      out.push({ id: "wait_to_park", laneUntil, law: inLane({ kind: "lane", offset: Math.round(pk.nudge_m * 10) / 10, vTarget: approach, stopAtRoute: stopAt(s + Math.max(0, pk.stop_in_m)), stopDecel: PARK_STOP_DECEL }),
        steer: `pull up ${Math.round(pk.nudge_m * 10) / 10} m right, alongside the car in front of the space`, speed: pk.stop_in_m > 0.3 ? "stop where the car reverses into the space" : "hold still, signalling right, until it is clear behind" });
    }
    if (snap.nav && snap.nav.remaining_m < 40 && !pk) {
      out.push({ id: "stop_at_destination", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(snap.route.length - 1.0) }),
        steer: "hold lane", speed: "slow and stop at the destination" });
    }
  } else {
    // off road or off route: creep in a fan of directions, or reverse toward the nearest lane
    const near = world.map.nearestLane(ego.x, ego.y, null, 80);
    const target = near ? near.point : null;
    for (const deg of [-30, -15, 0, 15, 30]) {
      out.push({ id: deg === 0 ? "creep_straight" : `creep_${deg < 0 ? "right" : "left"}_${Math.abs(deg)}`,
        law: { kind: "steer", steer: deg * Math.PI / 180, vTarget: 2.0 }, steer: deg === 0 ? "straight" : `${Math.abs(deg)} deg ${deg < 0 ? "right" : "left"}`, speed: "creep 2.0" });
    }
    out.push({ id: "reverse", law: { kind: "reverse", target }, steer: "reverse toward the road", speed: "reverse 2.0" });
  }
  // Turning round where the route makes a U-turn: on offer once the car is close and slow, and then
  // carried on until it is round, on or off the route, whatever it has stopped for meanwhile.
  if (snap.turnaround && world.route) {
    const turn = world.turnaround ? null : world.route.turnsAfter(s).find((t) => t.dir === "uturn");
    if (world.turnaround || turn) {
      out.push({ id: "turn_around", law: world.turnaround ? { ...world.turnaround } : planTurnaround(world.route, turn),
        steer: "turn round: a three-point turn, forward and back on full lock", speed: "walking pace" });
    }
  }
  // Parallel parking at the destination (sim/parallel-park.js): on offer once the car is where it starts
  // and nothing is coming from behind, and carried on until it is parked; and pulling out of the space
  // the car is parked in, at the start of the next drive.
  if (world.parking) {
    const out1 = world.parking.mode === "out";
    out.push({ id: out1 ? "pull_out" : "park", law: { ...world.parking }, steer: out1 ? "pull out of the space: back up, then out on full lock" : "reverse into the space: full lock toward the kerb, then the other way", speed: "walking pace" });
  } else if (snap.parking?.ready) {
    const out1 = snap.parking.mode === "out";
    out.push({ id: out1 ? "pull_out" : "park", law: out1 ? planPullOut(world.parkedIn) : planParking(world.park),
      steer: out1 ? "pull out of the space: back up, then out on full lock" : "reverse into the space: full lock toward the kerb, then the other way", speed: "walking pace" });
  }
  // Keep required stopping options when a busy street supplies many lateral alternatives, and lane
  // changes ahead of small nudges.
  const priority = (c) => c.law.stopAtRoute !== undefined || c.law.kind === "turnaround" || c.law.kind === "park" || c.id === "pass_cyclist" || c.id === "follow_cyclist" ? 0 : c.change ? 2 : (c.law.offset || 0) === (c.law.center || 0) ? 1 : 3;
  // (once round a cyclist has begun, the car carries on round it at the pass speed or, still behind it,
  // drops back in behind it: nothing else would get it by in the time the way round was clear for)
  const going = snap.cyclist_pass?.going ? out.filter((c) => c.id === "pass_cyclist" || c.id === "follow_cyclist") : out;
  const list = dedupe(going).sort((a, b) => priority(a) - priority(b)).slice(0, 15);
  list.push({ id: "hard_brake", law: { ...inLane({ kind: "hard_brake", offset: nudge }), ...(snap.cyclist_pass?.going ? passing : {}) }, steer: "hold lane", speed: "brake hard" });
  return list;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
}

// Forward-simulate every candidate. Mutates each candidate with `sim` (features) and `trace` (points).
export function simulateAll(candidates, snap, world) {
  const { route, map } = world;
  const FRONT = world.ego.spec.length - world.ego.spec.rearOverhang;
  // (an emergency vehicle coming up behind stops for what it cannot get past: it is not predicted
  // to run into the car)
  const behindEv = (o) => isEmergency(o) && world.ego.toLocal(o.x, o.y).ahead < 0 && Math.abs(wrap(o.psi - world.ego.psi)) < Math.PI / 4;
  const npcs = (snap.observed || world.visibleObstaclesNear(world.ego.x, world.ego.y, 60)).filter((o) => !behindEv(o)).map((n) => ({ n, x: n.x, y: n.y, vx: Math.cos(n.psi) * n.v, vy: Math.sin(n.psi) * n.v }));
  const startS = snap.routeProj ? snap.routeProj.s : 0;
  const control = snap.intersection;
  // A car well past the line is clearing the junction: a light that changes now does not stop it.
  const mustStop = control && control.bumper_to_line_m > -CLEARING_M && (
    (control.control === "signal" && ((control.signal === "red" && !control.right_on_red?.go) || control.signal === "unknown" || (control.signal === "yellow" && control.bumper_to_line_m > snap.ego.v * snap.ego.v / (2 * comfort().hardDecel) + 2))) ||
    (control.control === "stop" && !control.stop_completed) || waitsItsTurn(control) ||
    (control.control === "yield" && control.cross_traffic_moving && !control.entered));
  const currentlyOffRoad = !snap.road.on_road;
  const ped = snap.pedestrian;
  const oncoming = control?.oncoming || null;
  const hook = snap.right_hook || null;
  // where the car stops for an emergency vehicle
  const evStop = snap.emergency?.stop_s_route ?? null;
  // where the car stops to let a bus pull out
  const busStop = snap.bus?.stop_s_route ?? null;
  // where the car stops short of a crosswalk a vehicle in the next lane is stopped at
  const cwStop = snap.crosswalk_stop?.stop_s_route ?? null;
  // where the car stops for a school bus with its reds flashing
  const schoolStop = snap.school_bus?.lights === "red" ? snap.school_bus.stop_s_route : null;
  // where the car stops for a streetcar with its doors open
  const tramStop = snap.streetcar?.doors ? snap.streetcar.stop_s_route : null;
  // where the car waits short of a level crossing
  const railStop = snap.level_crossing?.wait ? snap.level_crossing.stop_s_route : null;
  // where the car waits at a signal it could not clear
  const boxStop = snap.junction_box?.stop_s_route ?? null;
  // where the car stops for a flagger showing STOP
  const flaggerStop = snap.work_zone?.wait ? snap.work_zone.stop_s_route : null;
  // at a lane closure: where the car waits for its turn at the merge point, or stops to let one in; and
  // the lane changes the zipper rules out (sim/lane-closure.js)
  const lz = snap.lane_closure;
  const mergeStop = lz?.wait ? lz.stop_s_route : null, letInStop = lz?.let_in_for ? lz.stop_s_route : null;
  const zipper = lz ? lz.side : null;
  // where the car waits behind a double-parked van it cannot go round yet (still ahead of it)
  const vanStop = snap.double_parked?.wait && snap.double_parked.bumper_to_stop_m > 0.3 ? snap.double_parked.stop_s_route : null;
  // a snow plow the car must stay back of, still ahead of it (sim/snow-plow.js): no candidate takes the
  // car's front past its rear while the car is in a lane to its right (or, with the plow on its right
  // in poor sight, at all)
  const plow = snap.snow_plow?.holds && snap.snow_plow.gap_m >= 0 ? snap.snow_plow : null;
  const anySide = plow?.lane === "right";
  // where the front bumper must stop to give way, or to look before going on (see giveWayAt)
  const give = control?.give_way?.hold_s_route != null ? control.give_way : null;
  // where the car stops to turn round, still ahead (route arc length of the rear axle)
  const turnAt = snap.nav?.turn_round_in_m > 0.3 ? startS + snap.nav.turn_round_in_m : null;
  // where the car stops to reverse into a space, until it starts (likewise)
  const parkAt = snap.parking?.mode === "in" && !world.parking ? snap.parking.stop_s_route : null;
  // passing a cyclist leaves at least the minimum passing distance where the option is on (1.5 m above
  // 50 km/h: sim/cyclist-pass.js), and BC's metre otherwise
  const cyclistClearance = world.passCyclists ? minPassM(snap.road?.limit ?? snap.limit) : CYCLIST_CLEARANCE_M;
  const cp = snap.cyclist_pass;
  for (const c of candidates) {
    const car = world.ego.clone();
    const trace = [[car.x, car.y]];
    let s = startS, hint = snap.routeProj ? route.hint : 0;
    let maxAccel = 0, maxDecel = 0, maxLat = 0, minClearance = Infinity;
    let passesBus = false, passesCw = false, passesSchool = false, passesTram = false, passesRail = false, passesBox = false, passesFlagger = false, passesVan = false, passesMerge = false, passesLetIn = false, passesPlow = false, passesEv = false, pastTurnPoint = false, pastSpace = false, lateLeaving = false, pedCross = false, cutsOff = false, hooks = false, passesHold = false, pastHold = false, closePass = false, meets = false, collision = null, staticHit = null, minGap = Infinity, staysOnRoad = true, staysInLane = true, crosses = false, lateral = 0, headingErr = 0, offroadFrac = 0, offSteps = 0;
    const steps = Math.round(HORIZON_S / SIM_DT);
    // a law already executing keeps the frame it was chosen in (its s0)
    const law = { ...c.law, s0: c.law.s0 ?? startS };
    if (law.stopAtRoute !== undefined) law.stopAt = law.stopAtRoute - law.s0;
    for (let k = 1; k <= steps; k++) {
      const t = k * SIM_DT;
      const previousPose = poseOf(car);
      applyLaw(car, law, route, s, SIM_DT, world);
      // Static map geometry is known even when fog or a corner hides moving traffic. Use the
      // same footprint sweep as execution, including reverse and sideways body motion.
      // Keep sweeping after a predicted vehicle contact, so a later static hit is still known.
      if (!staticHit && world.staticObstacles) {
        const hit = world.staticObstacles.sweep(previousPose, poseOf(car), car.spec);
        if (hit) staticHit = { id: hit.obstacle.id, t: Math.round((t - SIM_DT + hit.fraction * SIM_DT) * 10) / 10, kind: hit.obstacle.kind, static: true };
        if (!collision) collision = staticHit;
      }
      maxAccel = Math.max(maxAccel, car.ax || 0);
      maxDecel = Math.max(maxDecel, -(car.ax || 0));
      maxLat = Math.max(maxLat, Math.abs(car.latAccel || 0));
      if (route && snap.onRoute) {
        const p = route.project(car.x, car.y, hint);
        hint = p.index; s = p.s; lateral = p.lateral; headingErr = wrap(car.psi - p.heading);
        if (Math.abs(lateral - lateralAt(law, s, route)) > LANE_TOL && Math.abs(lateral - laneCenterAt(law, s, route)) > LANE_TOL) staysInLane = false;
        if (mustStop && !crosses && s + FRONT > control.s_line_route + 0.2) crosses = true;
        const leave = c.change?.leave;
        if (leave && s + FRONT > leave.by && Math.abs(lateral + route.frameMove(startS, s) - leave.center) < LANE_CLEAR_M) lateLeaving = true;
        if (ped && !pedCross && s + FRONT > ped.s_route - 0.8) pedCross = true;
        // the wait point is ONCOMING_STOP_M short of oncoming traffic's path; stopping up to a metre
        // past it (a short, slow stop overshoots) still keeps the car out of that path
        if (oncoming && s + FRONT > oncoming.yield_s_route + ONCOMING_STOP_M - 0.5) cutsOff = true;
        // likewise turning right across a cyclist's line of travel
        if (hook && s + FRONT > hook.yield_s_route + HOOK_STOP_M - 0.5) hooks = true;
        // (1.5 m past it, as a short stop overshoots)
        if (evStop !== null && s + FRONT > evStop + 1.5) passesEv = true;
        // (1.5 m past where it stops, as a short stop overshoots: into the 2 m it leaves behind the bus)
        if (busStop !== null && s + FRONT > busStop + 1.5) passesBus = true;
        // (likewise: 1.5 m past where it stops is still a metre short of the crosswalk)
        if (cwStop !== null && s + FRONT > cwStop + 1.5) passesCw = true;
        // (and here: 1.5 m past where it stops is still well short of the bus)
        if (schoolStop !== null && s + FRONT > schoolStop + 1.5) passesSchool = true;
        // (and here: 1.5 m past where it stops is still short of the doors)
        if (tramStop !== null && s + FRONT > tramStop + 1.5) passesTram = true;
        // (and here: 1.5 m past where it waits is still 5.5 m back from the nearest rail)
        if (railStop !== null && s + FRONT > railStop + 1.5) passesRail = true;
        // (and here: 1.5 m past the line is still short of the street across)
        if (boxStop !== null && s + FRONT > boxStop + 1.5) passesBox = true;
        // (and here: 1.5 m past the line is still 4.5 m short of the one-lane section)
        if (flaggerStop !== null && s + FRONT > flaggerStop + 1.5) passesFlagger = true;
        // (and here: 1.5 m past where it waits still leaves room to pull out round the van)
        if (vanStop !== null && s + FRONT > vanStop + 1.5) passesVan = true;
        // (and here: a metre past the merge point has not gone through it, sim/lane-closure.js THROUGH_M; 1.5 m past
        // where it lets one in is still behind it)
        if (mergeStop !== null && s + FRONT > mergeStop + 1) passesMerge = true;
        if (letInStop !== null && s + FRONT > letInStop + 1.5) passesLetIn = true;
        // (its rear where it will be by then, going on at its speed)
        if (plow && s + FRONT > plow.s_rear_route + plow.speed * t + 0.5 && (anySide || lateral + route.frameMove(startS, s) - plow.lateral_route > SAME_LANE_M)) passesPlow = true;
        if (give && s + FRONT > give.hold_s_route + 0.2) pastHold = true;
        // (stopping within PEEK_AT_M of where it looks from counts as having looked there)
        if (give && s + FRONT > give.hold_s_route + (give.wait_for ? 0.2 : PEEK_AT_M)) passesHold = true;
        // (a metre past it, as a short, slow stop overshoots)
        if (turnAt !== null && s > turnAt + 1 && car.v > 0.5) pastTurnPoint = true;
        // (likewise)
        if (parkAt !== null && s > parkAt + 1 && car.v > 0.5) pastSpace = true;
      }
      if (k % 3 === 0 || k === steps) {
        const rd = map.roadDistance(car.x, car.y);
        if (rd.distance > 0.8) { staysOnRoad = false; offSteps++; }
        const box = car.obb();
        const c = Math.cos(car.psi), sn = Math.sin(car.psi);
        for (const o of npcs) {
          const ob = o.n.obb();
          ob.center = [o.x + o.vx * t + (ob.center[0] - o.n.x), o.y + o.vy * t + (ob.center[1] - o.n.y)];
          // gap to a vehicle in the car's path (one alongside, like a parked car, does not count)
          const dx = ob.center[0] - box.center[0], dy = ob.center[1] - box.center[1];
          const ahead = dx * c + dy * sn, side = Math.abs(dx * sn - dy * c);
          if (ahead > 0 && side < box.halfWidth + ob.halfWidth + 0.3) {
            const gap = ahead - box.halfLength - ob.halfLength;
            if (gap < minGap) minGap = gap;
          }
          if (Math.abs(ahead) < box.halfLength + ob.halfLength + 1) minClearance = Math.min(minClearance, Math.max(0, side - box.halfWidth - ob.halfWidth));
          // passing a cyclist needs the minimum passing distance: a metre (and with passing cyclists on,
          // 1.5 m above 50 km/h)
          if (o.n.kind === "bike" && Math.abs(ahead) < box.halfLength + ob.halfLength && side - box.halfWidth - ob.halfWidth < cyclistClearance) closePass = true;
          // going round a cyclist with its far side across the centre line, meeting a vehicle coming the
          // other way in its way (sim/cyclist-pass.js)
          if (cp && isCyclistPass(law.detour) && lateral - box.halfWidth < cp.centre_line_route && ahead > 0 && Math.abs(wrap(o.n.psi - car.psi)) > Math.PI * 3 / 4
            && side < box.halfWidth + ob.halfWidth + MEET_SIDE_M) {
            const gap = ahead - box.halfLength - ob.halfLength, closing = Math.max(0, car.v) + Math.max(0, o.n.v);
            if (gap < MEET_M || (closing > 0.5 && gap / closing < MEET_S)) meets = true;
          }
          if (!collision && obbOverlap(box, ob, 0.3)) collision = { id: o.n.id, t: Math.round(t * 10) / 10, kind: Math.abs(wrap(o.n.psi - car.psi)) < Math.PI / 4 ? "rear_end" : "crossing" };
        }
      }
      trace.push([car.x, car.y]);
    }
    // past the point it looks from and still moving: it has not stopped there to look
    if (pastHold && car.v > 0.2) passesHold = true;
    c.trace = trace;
    c.sim = {
      max_accel: maxAccel, max_decel: maxDecel, max_lateral_accel: maxLat, min_clearance_m: minClearance,
      end_speed: car.v, progress_m: (route && snap.onRoute) ? s - startS : Math.hypot(car.x - snap.ego.x, car.y - snap.ego.y) * (car.v >= 0 ? 1 : -1),
      lane_err_end: lateral - laneCenterAt(law, s, route), heading_err_deg: headingErr * 180 / Math.PI, stays_on_road: staysOnRoad, stays_in_lane: staysInLane,
      crosses_stop_line: crosses, collision, static_collision: staticHit, min_gap_m: minGap, off_road_fraction: offSteps / Math.ceil(steps / 3),
      end: [car.x, car.y],
    };
    // A lane beside the route's lane must leave room to change back before it ends (a turn, a
    // junction where the lanes change, or the destination): one lane change for each lane between
    // it and the route's. Braking is always allowed, and so is a change toward the route's lane,
    // which only leaves the car fewer lanes to cross.
    const laneEnds = Number.isFinite(c.laneUntil) && (route && snap.onRoute) && c.law.kind !== "hard_brake" && c.change?.offer !== "return"
      && s + FRONT + Math.max(1, Math.abs(c.law.lane || 0)) * laneChangeLength(car.v) + LANE_RETURN_MARGIN_M > c.laneUntil;
    let reject = null;
    if (collision) reject = "collision";
    else if (c.change && !c.change.gap_ok) reject = "lane_change_gap";
    else if (c.change && (c.change.too_late || lateLeaving)) reject = "lane_change_too_late";
    else if (laneEnds) reject = "must_return_to_route_lane";
    else if (snap.visibility && car.v > snap.visibility.safe_speed_mps + 0.5 && car.v >= snap.ego.v - 0.5 && c.law.kind !== "hard_brake") reject = "visibility_stopping_distance";
    else if (closePass && c.law.kind !== "hard_brake") reject = world.passCyclists ? "passes_cyclist_without_room" : "passes_cyclist_too_close";
    else if (meets && c.law.kind !== "hard_brake") reject = "crosses_into_oncoming_traffic";
    else if (!staysOnRoad && !currentlyOffRoad && c.law.kind !== "hard_brake") reject = "off_road";
    else if (crosses) reject = control.control === "signal" ? "runs_red" : control.control === "yield" || control.stop_completed ? "fails_to_yield" : "runs_stop";
    else if (pedCross && c.law.kind !== "hard_brake") reject = "fails_to_yield_to_pedestrian";
    else if (cutsOff && c.law.kind !== "hard_brake") reject = "fails_to_yield_to_oncoming";
    else if (hooks && c.law.kind !== "hard_brake") reject = "fails_to_yield_to_cyclist";
    else if (passesEv && c.law.kind !== "hard_brake") reject = "fails_to_yield_to_emergency";
    else if (passesBus && c.law.kind !== "hard_brake") reject = "fails_to_yield_to_bus";
    else if (passesCw && c.law.kind !== "hard_brake") reject = "passes_car_stopped_at_crosswalk";
    else if (passesSchool && c.law.kind !== "hard_brake") reject = "passes_stopped_school_bus";
    else if (passesTram && c.law.kind !== "hard_brake") reject = "passes_streetcar_doors";
    else if (passesRail && c.law.kind !== "hard_brake") reject = snap.level_crossing.wait === "train" ? "crosses_in_front_of_train" : "no_room_past_tracks";
    else if (passesBox && c.law.kind !== "hard_brake") reject = "blocks_junction";
    else if (passesFlagger && c.law.kind !== "hard_brake") reject = "runs_flagger_stop";
    else if (passesVan && c.law.kind !== "hard_brake") reject = "no_room_to_go_round";
    else if (passesMerge && c.law.kind !== "hard_brake") reject = "merges_out_of_turn";
    else if (passesLetIn && c.law.kind !== "hard_brake") reject = "takes_merge_turn";
    // (the zipper: in the closed lane, no moving across before the merge point, and past it no lane
    // change at all, the way across and back being the candidates' own; in the open lane, no moving into
    // the closed one, to the end of the closure)
    else if (zipper === "closed" && c.change) reject = lz.merged ? "into_closed_lane" : "merges_early";
    else if (zipper === "open" && c.change && c.change.dir === lz.closed_lane) reject = "into_closed_lane";
    else if (passesPlow && c.law.kind !== "hard_brake") reject = "passes_plow_on_right";
    // (ending up closer to a snow plow it must stay back of than the stay-back distance, and closer
    // than now: in its lane or a lane to its right, still behind it, the plow going on at its speed)
    else if (plow && c.law.kind !== "hard_brake" && (anySide || lateral + route.frameMove(startS, s) - plow.lateral_route > -SAME_LANE_M)
      && plow.s_rear_route + plow.speed * HORIZON_S - (s + FRONT) < Math.min(plow.keep_back_m, plow.gap_m - PLOW_CLOSING_M)) reject = "follows_plow_too_close";
    else if (passesHold && c.law.kind !== "hard_brake") reject = give.wait_for ? "fails_to_yield" : "enters_unseen_junction";
    else if (pastTurnPoint && c.law.kind === "lane") reject = "passes_turn_round_point";
    else if (pastSpace && c.law.kind === "lane") reject = "passes_parking_space";
    c.reject = reject;
    c.eligible = !reject;
  }
  const rejected = {};
  for (const c of candidates) if (c.reject) rejected[c.reject] = (rejected[c.reject] || 0) + 1;
  return { eligible: candidates.filter((c) => c.eligible), rejected, mustStop: !!mustStop };
}

// Re-simulate only the currently executing law against fresh traffic: returns a hazard or null.
export function pathHazard(executing, snap, world) {
  if (!executing || !executing.candidate) return null;
  const c = { id: executing.candidate.id, law: executing.law || executing.candidate.law };
  simulateAll([c], snap, world);
  if (c.sim.collision) return { id: c.sim.collision.id, in_s: c.sim.collision.t, kind: c.sim.collision.kind };
  return null;
}
