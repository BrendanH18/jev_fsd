// Candidate maneuvers: sampled by code, forward-simulated 3 s with the real controller and car
// model, scored by code, and filtered for safety by code. A brain only ever picks among the
// survivors. Every prediction here is what the car will actually do if the candidate is chosen.

import { CAR } from "../sim/vehicle.js";
import { applyLaw } from "../sim/controller.js";
import { obbOverlap } from "../sim/collision.js";
import { wrap } from "../sim/world.js";

export const HORIZON_S = 3.0;
export const SIM_DT = 0.1;
const FRONT = CAR.length - CAR.rearOverhang;
const LANE_TOL = 1.2;

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
  const v = Math.max(0, ego.v);
  const out = [];
  const offRoad = !snap.road.on_road;
  const lost = !snap.route || !snap.onRoute;

  if (!lost && !offRoad) {
    const offsets = [0, -0.5, 0.5];
    const lateral = snap.routeProj ? Math.abs(snap.routeProj.lateral) : 0;
    if (lateral > 0.5 || snap.following || snap.traffic.length) offsets.push(-1.0, 1.0);
    const target = snap.target ? snap.target.v : limit;
    const speeds = new Set([0, Math.max(0, v - 3), v, Math.min(limit, v + 2), limit, target].map((x) => Math.round(Math.max(0, Math.min(limit, x)) * 10) / 10));
    for (const d of offsets) {
      for (const vt of [...speeds].sort((a, b) => b - a)) {
        const name = Math.abs(vt - target) < 0.15 && vt > 0.05 ? "target" : vt <= 0.05 ? "stop" : Math.abs(vt - v) < 0.3 ? "hold" : vt >= limit - 0.05 ? "limit" : vt < v ? "slow" : "faster";
        const prefix = d === 0 ? "keep_lane" : `${d < 0 ? "left" : "right"}_${Math.abs(d)}`;
        if (d !== 0 && name !== "hold" && name !== "target") continue;  // lateral shifts only at hold/target speeds
        out.push({ id: `${prefix}_${name}`, law: { kind: "lane", offset: d, vTarget: vt },
          steer: d === 0 ? "hold lane" : `shift ${Math.abs(d)} m ${d < 0 ? "left" : "right"}`, speed: speedLabel(vt, v, limit) });
      }
    }
    // approach and stop at the next stop line
    if (snap.intersection && snap.intersection.bumper_to_line_m > 0.3) {
      out.push({ id: "stop_at_line", law: { kind: "lane", offset: 0, vTarget: Math.min(limit, Math.max(v, 3)), stopAtRoute: snap.intersection.s_line_route - FRONT - 0.5 },
        steer: "hold lane", speed: "approach and stop at the line" });
    }
    if (snap.nav && snap.nav.remaining_m < 40) {
      out.push({ id: "stop_at_destination", law: { kind: "lane", offset: 0, vTarget: Math.min(limit, Math.max(v, 3)), stopAtRoute: snap.route.length - 1.0 },
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
  const list = dedupe(out).slice(0, 15);
  list.push({ id: "hard_brake", law: { kind: "hard_brake", offset: 0 }, steer: "hold lane", speed: "brake hard" });
  return list;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
}

// Forward-simulate every candidate. Mutates each candidate with `sim` (features) and `trace` (points).
export function simulateAll(candidates, snap, world) {
  const { route, map } = world;
  const npcs = world.npcs.map((n) => ({ n, x: n.x, y: n.y, vx: Math.cos(n.psi) * n.v, vy: Math.sin(n.psi) * n.v }));
  const startS = snap.routeProj ? snap.routeProj.s : 0;
  const control = snap.intersection;
  const mustStop = control && (
    (control.control === "signal" && (control.signal === "red" || (control.signal === "yellow" && control.bumper_to_line_m > snap.ego.v * snap.ego.v / 8 + 2))) ||
    (control.control === "stop" && !control.stop_completed));
  const currentlyOffRoad = !snap.road.on_road;
  for (const c of candidates) {
    const car = world.ego.clone();
    const trace = [[car.x, car.y]];
    let s = startS, hint = snap.routeProj ? route.hint : 0;
    let collision = null, minGap = Infinity, staysOnRoad = true, staysInLane = true, crosses = false, lateral = 0, headingErr = 0, offroadFrac = 0, offSteps = 0;
    const steps = Math.round(HORIZON_S / SIM_DT);
    const law = { ...c.law, s0: startS };
    if (law.stopAtRoute !== undefined) law.stopAt = law.stopAtRoute - startS;
    for (let k = 1; k <= steps; k++) {
      const t = k * SIM_DT;
      applyLaw(car, law, route, s, SIM_DT);
      if (route && snap.onRoute) {
        const p = route.project(car.x, car.y, hint);
        hint = p.index; s = p.s; lateral = p.lateral; headingErr = wrap(car.psi - p.heading);
        if (Math.abs(lateral - (law.offset || 0)) > LANE_TOL && Math.abs(lateral) > LANE_TOL) staysInLane = false;
        if (mustStop && !crosses && s + FRONT > control.s_line_route + 0.2) crosses = true;
      }
      if (k % 3 === 0 || k === steps) {
        const rd = map.roadDistance(car.x, car.y);
        if (rd.distance > 0.8) { staysOnRoad = false; offSteps++; }
        const box = car.obb();
        for (const o of npcs) {
          const ob = o.n.obb();
          ob.center = [o.x + o.vx * t + (ob.center[0] - o.n.x), o.y + o.vy * t + (ob.center[1] - o.n.y)];
          const gap = Math.hypot(ob.center[0] - box.center[0], ob.center[1] - box.center[1]) - CAR.length;
          if (gap < minGap) minGap = gap;
          if (!collision && obbOverlap(box, ob, 0.3)) collision = { id: o.n.id, t: Math.round(t * 10) / 10, kind: Math.abs(wrap(o.n.psi - car.psi)) < Math.PI / 4 ? "rear_end" : "crossing" };
        }
      }
      trace.push([car.x, car.y]);
    }
    c.trace = trace;
    c.sim = {
      end_speed: car.v, progress_m: (route && snap.onRoute) ? s - startS : Math.hypot(car.x - snap.ego.x, car.y - snap.ego.y) * (car.v >= 0 ? 1 : -1),
      lane_err_end: lateral, heading_err_deg: headingErr * 180 / Math.PI, stays_on_road: staysOnRoad, stays_in_lane: staysInLane,
      crosses_stop_line: crosses, collision, min_gap_m: minGap, off_road_fraction: offSteps / Math.ceil(steps / 3),
      end: [car.x, car.y],
    };
    if (route && snap.onRoute) {
      const p = route.project(snap.route ? car.x : 0, car.y, hint);
      c.sim.end_ahead = null;
    }
    // eligibility, decided by code
    let reject = null;
    if (collision) reject = "collision";
    else if (!staysOnRoad && !currentlyOffRoad && c.law.kind !== "hard_brake") reject = "off_road";
    else if (crosses) reject = control.control === "signal" ? "runs_red" : "runs_stop";
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
