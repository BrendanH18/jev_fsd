// Sample maneuvers, forward-sim 3 s with the real controller and car model, then reject unsafe
// ones. Brains only pick among survivors. Other agents use constant-velocity predictions from
// visible observations and can change behavior after a choice.

import { CAR, comfort } from "../sim/vehicle.js";
import { applyLaw, lateralAt, laneCenterAt, laneChangeLength } from "../sim/controller.js";
import { obbOverlap } from "../sim/collision.js";
import { wrap } from "../sim/world.js";
import { CROSSWALK_STOP_M, LANE_CLEAR_M } from "./sensors.js";
import { poseOf } from "../sim/static-obstacles.js";

export const HORIZON_S = 3.0;
export const SIM_DT = 0.1;
const LANE_TOL = 1.2;
const CYCLIST_CLEARANCE_M = 1.0;
const QUEUE_GAP_M = 2.5;
const LANE_RETURN_MARGIN_M = 8;
const MIN_CHANGE_M = 12;   // the sharpest lane change offered, for leaving a lane about to end

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
  const keep = { lane: lane ? lane.delta : 0, center: lane ? lane.center : 0, shift: lane?.shift || null };
  const laneUntil = lane && lane.delta ? lane.until_s : null;
  // A continuing change keeps the lane it started from, so going back stays on offer.
  const carry = keep.shift ? { shift: keep.shift, ...(lane.from_delta !== null ? { fromLane: lane.from_delta } : {}) } : {};
  const inLane = (law) => ({ ...law, offset: keep.center + (law.offset || 0), center: keep.center, lane: keep.lane, ...(law.offset ? {} : carry) });

  if (!lost && !offRoad) {
    const offsets = keep.shift ? [0] : [0, -0.5, 0.5];
    const lateral = lane ? Math.abs(lane.lateral) : snap.routeProj ? Math.abs(snap.routeProj.lateral) : 0;
    if (!keep.shift && (lateral > 0.5 || snap.following || (snap.traffic.length || snap.roadside?.length))) offsets.push(-1.0, 1.0);
    const target = snap.target ? snap.target.v : limit;
    const speeds = new Set([0, Math.max(0, v - 3), v, Math.min(limit, v + 2), limit, target, target * 0.75].map((x) => Math.round(Math.max(0, Math.min(limit, x)) * 10) / 10));
    for (const d of offsets) {
      for (const vt of [...speeds].sort((a, b) => b - a)) {
        const name = Math.abs(vt - target) < 0.15 && vt > 0.05 ? "target" : vt <= 0.05 ? "stop" : Math.abs(vt - target * 0.75) < 0.06 ? "cautious" : Math.abs(vt - v) < 0.3 ? "hold" : vt >= limit - 0.05 ? "limit" : vt < v ? "slow" : "faster";
        const prefix = d === 0 ? "keep_lane" : `${d < 0 ? "left" : "right"}_${Math.abs(d)}`;
        if (d !== 0 && name !== "hold" && name !== "target") continue;  // lateral shifts only at hold/target speeds
        out.push({ id: `${prefix}_${name}`, law: inLane({ kind: "lane", offset: d, vTarget: vt }), laneUntil,
          steer: d === 0 ? (keep.shift ? `continue into the ${lane.shift.from > keep.center ? "left" : "right"} lane` : "hold lane") : `shift ${Math.abs(d)} m ${d < 0 ? "left" : "right"}`, speed: speedLabel(vt, v, limit) });
      }
    }
    // Change into a lane beside this one: to pass, to return toward the route's lane, or to go back
    // to the lane a change started from. The car signals and eases across over about 3.5 s, or
    // more sharply to finish before the lane it is leaving ends; too late for that, it waits. The
    // prediction checks the car is actually across by then (`leave`).
    const leaving = lane && lane.delta ? lane.until_s - s - FRONT : Infinity;
    const leave = lane && lane.delta ? { by: lane.until_s, center: lane.center } : null;
    const len = Math.max(MIN_CHANGE_M, Math.min(laneChangeLength(v), leaving));
    for (const side of lane ? Object.values(lane.sides) : []) {
      if (!side.offer) continue;
      const toRoute = side.delta === 0 ? " (the route's lane)" : "";
      const vs = new Set([v, Math.min(side.target_v, v + 2), ...(side.offer === "pass" ? [] : [Math.max(0, v - 3)])].map((x) => Math.round(Math.max(0, Math.min(limit, x)) * 10) / 10));
      for (const vt of [...vs].sort((a, b) => b - a)) {
        if (vt <= 0.05) continue;
        const name = Math.abs(vt - v) < 0.3 ? "hold" : vt > v ? "faster" : "slow";
        out.push({ id: `change_${side.dir}_${name}`, change: { dir: side.dir, offer: side.offer, gap_ok: side.gap_ok, too_late: leaving < MIN_CHANGE_M, leave }, laneUntil: side.until_s, laneTarget: side.target_v,
          law: { kind: "lane", offset: side.center, center: side.center, lane: side.delta, fromLane: lane.delta, vTarget: vt,
            shift: { from: snap.routeProj.lateral, start: s, len } },
          steer: side.offer === "pass" ? `change to the ${side.dir} lane to pass` : side.offer === "abort" ? `move back to the ${side.dir} lane` : `return to the ${side.dir} lane${toRoute}`, speed: speedLabel(vt, v, limit) });
      }
    }
    // Stopping maneuvers stop at their mark or queue 2.5 m behind whoever is in front of it, and
    // approach no faster than the target speed (which already allows for a slowing car ahead).
    const approach = Math.min(limit, Math.max(target, 3));
    const f = snap.following;
    const queue = f ? f.s - (f.vehicle.spec || CAR).rearOverhang - FRONT - QUEUE_GAP_M : Infinity;
    const stopAt = (mark) => Math.min(mark, queue);
    if (snap.intersection && snap.intersection.bumper_to_line_m > 0.3) {
      out.push({ id: "stop_at_line", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(snap.intersection.s_line_route - FRONT - 0.5) }),
        steer: "hold lane", speed: "approach and stop at the line" });
    }
    if (snap.pedestrian && snap.pedestrian.bumper_to_crosswalk_m > CROSSWALK_STOP_M + 0.3) {
      out.push({ id: "stop_for_pedestrian", laneUntil, law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(snap.pedestrian.s_route - FRONT - CROSSWALK_STOP_M) }),
        steer: "hold lane", speed: snap.pedestrian.mid_block ? "stop short of the crossing pedestrian" : "stop before the crosswalk" });
    }
    if (snap.nav && snap.nav.remaining_m < 40) {
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
  // Keep required stopping options when a busy street supplies many lateral alternatives, and lane
  // changes ahead of small nudges.
  const priority = (c) => c.law.stopAtRoute !== undefined ? 0 : c.change ? 2 : (c.law.offset || 0) === (c.law.center || 0) ? 1 : 3;
  const list = dedupe(out).sort((a, b) => priority(a) - priority(b)).slice(0, 15);
  list.push({ id: "hard_brake", law: inLane({ kind: "hard_brake" }), steer: "hold lane", speed: "brake hard" });
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
  const npcs = (snap.observed || world.visibleObstaclesNear(world.ego.x, world.ego.y, 60)).map((n) => ({ n, x: n.x, y: n.y, vx: Math.cos(n.psi) * n.v, vy: Math.sin(n.psi) * n.v }));
  const startS = snap.routeProj ? snap.routeProj.s : 0;
  const control = snap.intersection;
  const mustStop = control && (
    (control.control === "signal" && (control.signal === "red" || control.signal === "unknown" || (control.signal === "yellow" && control.bumper_to_line_m > snap.ego.v * snap.ego.v / (2 * comfort().hardDecel) + 2))) ||
    (control.control === "stop" && !control.stop_completed) ||
    (control.control === "yield" && control.cross_traffic_moving && !control.entered));
  const currentlyOffRoad = !snap.road.on_road;
  const ped = snap.pedestrian;
  for (const c of candidates) {
    const car = world.ego.clone();
    const trace = [[car.x, car.y]];
    let s = startS, hint = snap.routeProj ? route.hint : 0;
    let maxAccel = 0, maxDecel = 0, maxLat = 0, minClearance = Infinity;
    let lateLeaving = false, pedCross = false, closePass = false, collision = null, minGap = Infinity, staysOnRoad = true, staysInLane = true, crosses = false, lateral = 0, headingErr = 0, offroadFrac = 0, offSteps = 0;
    const steps = Math.round(HORIZON_S / SIM_DT);
    const law = { ...c.law, s0: startS };
    if (law.stopAtRoute !== undefined) law.stopAt = law.stopAtRoute - startS;
    for (let k = 1; k <= steps; k++) {
      const t = k * SIM_DT;
      const previousPose = poseOf(car);
      applyLaw(car, law, route, s, SIM_DT);
      // Static map geometry is known even when fog or a corner hides moving traffic. Use the
      // same footprint sweep as execution, including reverse and sideways body motion.
      if (!collision && world.staticObstacles) {
        const hit = world.staticObstacles.sweep(previousPose, poseOf(car), car.spec);
        if (hit) collision = { id: hit.obstacle.id, t: Math.round((t - SIM_DT + hit.fraction * SIM_DT) * 10) / 10, kind: hit.obstacle.kind };
      }
      maxAccel = Math.max(maxAccel, car.ax || 0);
      maxDecel = Math.max(maxDecel, -(car.ax || 0));
      maxLat = Math.max(maxLat, Math.abs(car.latAccel || 0));
      if (route && snap.onRoute) {
        const p = route.project(car.x, car.y, hint);
        hint = p.index; s = p.s; lateral = p.lateral; headingErr = wrap(car.psi - p.heading);
        if (Math.abs(lateral - lateralAt(law, s)) > LANE_TOL && Math.abs(lateral - laneCenterAt(law, s)) > LANE_TOL) staysInLane = false;
        if (mustStop && !crosses && s + FRONT > control.s_line_route + 0.2) crosses = true;
        const leave = c.change?.leave;
        if (leave && s + FRONT > leave.by && Math.abs(lateral - leave.center) < LANE_CLEAR_M) lateLeaving = true;
        if (ped && !pedCross && s + FRONT > ped.s_route - 0.8) pedCross = true;
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
          // passing a cyclist needs a metre of space (BC's minimum passing distance)
          if (o.n.kind === "bike" && Math.abs(ahead) < box.halfLength + ob.halfLength && side - box.halfWidth - ob.halfWidth < CYCLIST_CLEARANCE_M) closePass = true;
          if (!collision && obbOverlap(box, ob, 0.3)) collision = { id: o.n.id, t: Math.round(t * 10) / 10, kind: Math.abs(wrap(o.n.psi - car.psi)) < Math.PI / 4 ? "rear_end" : "crossing" };
        }
      }
      trace.push([car.x, car.y]);
    }
    c.trace = trace;
    c.sim = {
      max_accel: maxAccel, max_decel: maxDecel, max_lateral_accel: maxLat, min_clearance_m: minClearance,
      end_speed: car.v, progress_m: (route && snap.onRoute) ? s - startS : Math.hypot(car.x - snap.ego.x, car.y - snap.ego.y) * (car.v >= 0 ? 1 : -1),
      lane_err_end: lateral - laneCenterAt(law, s), heading_err_deg: headingErr * 180 / Math.PI, stays_on_road: staysOnRoad, stays_in_lane: staysInLane,
      crosses_stop_line: crosses, collision, min_gap_m: minGap, off_road_fraction: offSteps / Math.ceil(steps / 3),
      end: [car.x, car.y],
    };
    // A lane beside the route's lane must leave room to change back before it ends (a turn, a
    // junction where the lanes change, or the destination). Braking is always allowed.
    const laneEnds = Number.isFinite(c.laneUntil) && (route && snap.onRoute) && c.law.kind !== "hard_brake"
      && s + FRONT + laneChangeLength(car.v) + LANE_RETURN_MARGIN_M > c.laneUntil;
    let reject = null;
    if (collision) reject = "collision";
    else if (c.change && !c.change.gap_ok) reject = "lane_change_gap";
    else if (c.change && (c.change.too_late || lateLeaving)) reject = "lane_change_too_late";
    else if (laneEnds) reject = "must_return_to_route_lane";
    else if (snap.visibility && car.v > snap.visibility.safe_speed_mps + 0.5 && car.v >= snap.ego.v - 0.5 && c.law.kind !== "hard_brake") reject = "visibility_stopping_distance";
    else if (closePass && c.law.kind !== "hard_brake") reject = "passes_cyclist_too_close";
    else if (!staysOnRoad && !currentlyOffRoad && c.law.kind !== "hard_brake") reject = "off_road";
    else if (crosses) reject = control.control === "signal" ? "runs_red" : control.control === "yield" ? "fails_to_yield" : "runs_stop";
    else if (pedCross && c.law.kind !== "hard_brake") reject = "fails_to_yield_to_pedestrian";
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
  const c = { id: executing.candidate.id, law: executing.candidate.law };
  simulateAll([c], snap, world);
  if (c.sim.collision) return { id: c.sim.collision.id, in_s: c.sim.collision.t, kind: c.sim.collision.kind };
  return null;
}
