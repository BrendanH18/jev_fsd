// The one control law used by the autopilot, the NPCs, and every candidate forward-simulation:
// pure pursuit on a route (with a lateral offset) plus a proportional speed controller.

import { CAR, comfort } from "./vehicle.js";
import { clamp } from "../common.js";
import { stepTurnaround } from "./turnaround.js";
import { stepParking } from "./parallel-park.js";

export function lookahead(v) { return clamp(0.8 * Math.abs(v), 4, 15); }

// steer command to reach the route point `Ld` ahead, shifted `offset` meters to the right
export function purePursuit(vehicle, route, s, offset = 0) {
  const Ld = lookahead(vehicle.v);
  const target = route.offsetPointAt(Math.min(s + Ld, route.length), offset);
  const dx = target[0] - vehicle.x, dy = target[1] - vehicle.y;
  const alpha = Math.atan2(dy, dx) - vehicle.psi;
  const dist = Math.max(1, Math.hypot(dx, dy));
  return Math.atan2(2 * (vehicle.spec || CAR).wheelbase * Math.sin(alpha), dist);
}

// steer toward an arbitrary point (used for recovery when off the route)
export function steerToward(vehicle, point) {
  const dx = point[0] - vehicle.x, dy = point[1] - vehicle.y;
  let alpha = Math.atan2(dy, dx) - vehicle.psi;
  while (alpha > Math.PI) alpha -= 2 * Math.PI;
  while (alpha <= -Math.PI) alpha += 2 * Math.PI;
  const dist = Math.max(1, Math.hypot(dx, dy));
  return Math.atan2(2 * (vehicle.spec || CAR).wheelbase * Math.sin(alpha), dist);
}

export function speedControl(v, vTarget, { gain = 1.5, maxAccel = 2.5, maxBrake = 7 } = {}) {
  return clamp(gain * (vTarget - v), -maxBrake, maxAccel);
}

// Speed that lets the car stop exactly at `distance` meters ahead with a comfortable deceleration
// (2.5 m/s^2 on a dry road, less on a slippery one).
export function stopSpeedFor(distance, decel = comfort().decel) {
  if (distance <= 0) return 0;
  return Math.sqrt(2 * decel * distance);
}

// A lane law's lateral target in metres right of the route at route arc length s. With `shift` it
// eases from `shift.from` (at route s = shift.start) to `offset` over `shift.len` metres: a lane change.
// Offsets are measured from the route where the law was chosen (s0), and `shift.from` where the change
// started; where the route itself moves to another lane after that, the target moves back by as
// much, so the car holds its lane.
// With `detour` (route arc lengths, see detourAt) the target also moves across to go round a work
// zone's closed stretch (sim/work-zone.js).
export function lateralAt(law, s, route = null) {
  const shift = law.shift;
  const move = (s0) => (route && route.frameMove ? route.frameMove(s0, s) : 0);
  const to = (law.offset || 0) - move(law.s0) + detourAt(law.detour, s);
  if (!shift) return to;
  const from = shift.from - move(shift.start);
  const u = clamp((s - shift.start) / shift.len, 0, 1);
  return from + (to - from) * u * u * (3 - 2 * u);
}

// How far a detour `{ from, full, back, to, shift }` moves the lateral target at arc length s: easing
// across from `from` to `full`, all of `shift` (metres right: negative goes left) until `back`, and
// easing back by `to`; nothing outside them.
export function detourAt(detour, s) {
  if (!detour || s <= detour.from || s >= detour.to) return 0;
  const ease = (u) => u * u * (3 - 2 * u);
  const u = s < detour.full ? ease((s - detour.from) / (detour.full - detour.from)) : s > detour.back ? ease((detour.to - s) / (detour.to - detour.back)) : 1;
  return detour.shift * u;
}

// The lane centre a law tracks at s, without its small lateral nudge (`center` is the target lane's
// centre; laws that predate lane changes track the route lane).
export function laneCenterAt(law, s, route = null) {
  return lateralAt(law, s, route) - ((law.offset || 0) - (law.center ?? 0));
}

// Distance over which a lane change completes: about 3.5 s of travel, at least 18 m and at most 50 m,
// which keeps lateral acceleration under about 1.6 m/s^2 for a 3.3 m lane.
export function laneChangeLength(v) { return clamp(3.5 * Math.abs(v), 18, 50); }

const CURVE_HORIZON_M = 60;

// Fastest speed now from which the car can slow comfortably to every point's safe cornering speed
// over the next 60 m, including the curve it is already in. Comfortable cornering is 2.2 m/s^2 and
// braking into a curve 2.0 m/s^2 on a dry road; both shrink with grip.
export function curveProfileSpeed(route, s) {
  const { lat, decel } = comfort();
  let best = { v: Infinity, at: 0 };
  for (let d = 0; d <= CURVE_HORIZON_M && s + d < route.length; d += 3) {
    const vc = route.curveSpeedAt(s, d, lat);
    if (!Number.isFinite(vc)) continue;
    const v = Math.sqrt(vc * vc + 2 * decel * 0.8 * d);
    if (v < best.v) best = { v, at: d };
  }
  return best;
}

// The "law" a candidate or the autopilot executes between decisions. A lane law's vTarget is a
// ceiling: the curve profile lowers it through turns, the way a real speed controller would.
//   kind: "lane" (follow route with offset, target speed, and a stop at `stopAt`, braking at up to
//         `stopDecel` if given) | "hard_brake" | "reverse" | "steer" (fixed angle)
//         | "turnaround" (a three-point turn at a U-turn, sim/turnaround.js; it needs `world`)
//         | "park" (parallel parking at the destination, or pulling out again, sim/parallel-park.js;
//         it needs `world`)
// Lane and hard-brake laws aim at the lateral target where the pursuit point lies, so a lane change
// steers smoothly along its eased path.
export function applyLaw(vehicle, law, route, s, dt, world = null) {
  switch (law.kind) {
    case "hard_brake":
      // (reversing, the brakes push forward)
      return vehicle.step(dt, { steer: route ? purePursuit(vehicle, route, s, lateralAt(law, s + lookahead(vehicle.v), route)) : vehicle.delta, accel: (vehicle.v < 0 ? 1 : -1) * comfort().hardDecel });
    case "reverse": {
      const steer = law.target ? -steerToward(vehicle, law.target) : 0;
      return vehicle.step(dt, { steer, accel: speedControl(vehicle.v, -2, { maxAccel: 2, maxBrake: 4 }), reverse: true });
    }
    case "steer":
      return vehicle.step(dt, { steer: law.steer, accel: speedControl(vehicle.v, law.vTarget) });
    case "park":
      if (world && stepParking(vehicle, law, world, dt, speedControl)) return;
      // falls through: once out of the space, it follows the lane like any lane law
    case "turnaround":
      if (law.kind === "turnaround" && world && route && stepTurnaround(vehicle, law, route, world, dt, purePursuit, speedControl)) return;
      // falls through: once round, it follows the lane like any lane law
    case "lane":
    default: {
      const stopAt = law.stopAt;
      let vTarget = Math.min(law.vTarget, curveProfileSpeed(route, s).v);
      if (stopAt !== undefined && stopAt !== null) vTarget = Math.min(vTarget, stopSpeedFor(stopAt - (s - (law.s0 ?? s)), law.stopDecel ? Math.min(law.stopDecel, comfort().decel) : undefined));
      return vehicle.step(dt, { steer: purePursuit(vehicle, route, s, lateralAt(law, s + lookahead(vehicle.v), route)), accel: speedControl(vehicle.v, vTarget) });
    }
  }
}
