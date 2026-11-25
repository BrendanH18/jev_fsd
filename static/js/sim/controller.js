// The one control law used by the autopilot, the NPCs, and every candidate forward-simulation:
// pure pursuit on a route (with a lateral offset) plus a proportional speed controller.

import { CAR, ROAD, comfort, validateStepDuration, wrapHeading } from "./vehicle.js";
import { gentleOnIce } from "./black-ice.js";
import { clamp } from "../common.js";
import { stepTurnaround } from "./turnaround.js";
import { stepParking } from "./parallel-park.js";
import { slowCap } from "./potholes.js";

export function lookahead(v) {
  if (!Number.isFinite(v)) throw new RangeError("Lookahead requires a finite speed (m/s)");
  return clamp(0.8 * Math.abs(v), 4, 15);
}

// Steering angle (rad) to reach the route point Ld metres ahead, shifted offset metres to the right.
export function purePursuit(vehicle, route, s, offset = 0, Ld = lookahead(vehicle.v)) {
  if (!Number.isFinite(s) || !Number.isFinite(offset)) throw new RangeError("Invalid pursuit route position or offset");
  if (!Number.isFinite(Ld) || Ld < 0) throw new RangeError("Invalid pursuit lookahead distance");
  if (typeof route?.offsetPointAt !== "function" || !Number.isFinite(route.length) || route.length < 0)
    throw new TypeError("Pursuit requires route geometry with a finite length");
  const target = route.offsetPointAt(Math.min(s + Ld, route.length), offset);
  return pursuitAngle(vehicle, target, false);
}

// steer toward an arbitrary point (used for recovery when off the route)
export function steerToward(vehicle, point) {
  return pursuitAngle(vehicle, point, true);
}

function pursuitAngle(vehicle, point, normalize) {
  if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1]))
    throw new RangeError("Pursuit point must have finite coordinates");
  if (!Number.isFinite(vehicle.x) || !Number.isFinite(vehicle.y) || !Number.isFinite(vehicle.psi))
    throw new RangeError("Pursuit requires a finite vehicle pose");
  const dx = point[0] - vehicle.x,
    dy = point[1] - vehicle.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new RangeError("Pursuit point is too far from the vehicle");
  const bearingError = Math.atan2(dy, dx) - vehicle.psi;
  const alpha = normalize ? wrapHeading(bearingError) : bearingError;
  const wheelbase = (vehicle.spec || CAR).wheelbase;
  if (!Number.isFinite(wheelbase) || wheelbase <= 0) throw new RangeError("Pursuit requires a positive wheelbase");
  const dist = Math.max(1, Math.hypot(dx, dy));
  return Math.atan2(2 * wheelbase * Math.sin(alpha), dist);
}

// v and vTarget in m/s, gain in 1/s, and both pedal limits as nonnegative m/s².
export function speedControl(v, vTarget, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("Speed-control options must be an object");
  const { gain = 1.5, maxAccel = 2.5, maxBrake = 7 } = options;
  if (!Number.isFinite(v) || typeof vTarget !== "number" || Number.isNaN(vTarget))
    throw new RangeError("Speed control requires a finite current speed and a numeric target");
  if (!Number.isFinite(gain) || gain < 0) throw new RangeError("Invalid speed-control gain");
  if (!Number.isFinite(maxAccel) || maxAccel < 0 || !Number.isFinite(maxBrake) || maxBrake < 0)
    throw new RangeError("Speed-control pedal limits must be finite nonnegative accelerations");
  const error = vTarget - v;
  if (!Number.isFinite(error)) {
    if (gain === 0) return 0;
    if (Number.isFinite(vTarget)) return clamp(gain * vTarget - gain * v, -maxBrake, maxAccel);
  }
  return clamp(gain * error, -maxBrake, maxAccel);
}

// Speed that lets the car stop exactly at `distance` meters ahead with a comfortable deceleration
// (2.5 m/s^2 on a dry road, less on a slippery one).
export function stopSpeedFor(distance, decel = comfort().decel) {
  if (typeof distance !== "number" || Number.isNaN(distance)) throw new RangeError("Invalid stopping distance");
  if (distance <= 0) return 0;
  if (!Number.isFinite(decel) || decel < 0) throw new RangeError("Invalid stopping deceleration");
  if (decel === 0) return 0;
  const speedSquared = 2 * decel * distance;
  if ((speedSquared === 0 || speedSquared === Infinity) && Number.isFinite(distance))
    return Math.SQRT2 * Math.sqrt(decel) * Math.sqrt(distance);
  return Math.sqrt(speedSquared);
}

const smoothstep = (u) => u * u * (3 - 2 * u);

// Subtract first on ordinary routes. Halve extreme inputs only when the span would overflow.
function segmentFraction(s, from, to) {
  const span = to - from;
  if (Number.isFinite(span)) return (s - from) / span;
  return (s / 2 - from / 2) / (to / 2 - from / 2);
}

// A lane law's lateral target in metres right of the route at route arc length s. With `shift` it
// eases from `shift.from` (at route s = shift.start) to `offset` over `shift.len` metres: a lane change.
// Offsets are measured from the route where the law was chosen (s0), and `shift.from` where the change
// started; where the route itself moves to another lane after that, the target moves back by as
// much, so the car holds its lane.
// With `detour` (route arc lengths, see detourAt) the target also moves across to go round a work
// zone's closed stretch (sim/work-zone.js).
export function lateralAt(law, s, route = null) {
  if (!law || typeof law !== "object" || Array.isArray(law)) throw new TypeError("Lateral law must be an object");
  if (!Number.isFinite(s)) throw new RangeError("Invalid lateral target route position");
  if (law.offset != null && !Number.isFinite(law.offset)) throw new RangeError("Invalid lateral target offset");
  const shift = law.shift;
  const move = (s0) => {
    if (route?.frameMove == null) return 0;
    if (typeof route.frameMove !== "function") throw new TypeError("Route frameMove must be a function");
    const metres = route.frameMove(s0, s);
    if (!Number.isFinite(metres)) throw new RangeError("Invalid route frame shift");
    return metres;
  };
  const to = (law.offset || 0) - move(law.s0) + detourAt(law.detour, s);
  if (!Number.isFinite(to)) throw new RangeError("Lateral target exceeds the supported range");
  if (!shift) return to;
  if (!Number.isFinite(shift.from) || !Number.isFinite(shift.start) || !Number.isFinite(shift.len) || shift.len < 0)
    throw new RangeError("Invalid lane-change geometry");
  if (shift.len === 0 && s >= shift.start) return to;
  const from = shift.from - move(shift.start);
  if (!Number.isFinite(from)) throw new RangeError("Lane-change origin exceeds the supported range");
  const u = clamp((s - shift.start) / shift.len, 0, 1);
  if (!Number.isFinite(to - from)) {
    const weight = smoothstep(u);
    return from * (1 - weight) + to * weight;
  }
  // Keep the original grouping for seeded lane changes.
  return from + (to - from) * u * u * (3 - 2 * u);
}

// How far a detour `{ from, full, back, to, shift }` moves the lateral target at arc length s: easing
// across from `from` to `full`, all of `shift` (metres right: negative goes left) until `back`, and
// easing back by `to`; nothing outside them.
export function detourAt(detour, s) {
  if (!detour) return 0;
  const { from, full, back, to, shift } = detour;
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(full) ||
    !Number.isFinite(back) ||
    !Number.isFinite(to) ||
    !Number.isFinite(shift) ||
    from > full ||
    full > back ||
    back > to
  )
    throw new RangeError("Invalid detour geometry");
  if (!Number.isFinite(s)) throw new RangeError("Invalid detour route position");
  if (s <= from || s >= to) return 0;
  const u =
    s < full ? smoothstep(segmentFraction(s, from, full)) : s > back ? smoothstep(segmentFraction(-s, -to, -back)) : 1;
  return shift * u;
}

// The lane centre a law tracks at s, without its small lateral nudge (`center` is the target lane's
// centre; laws that predate lane changes track the route lane).
export function laneCenterAt(law, s, route = null) {
  const lateral = lateralAt(law, s, route);
  if (law.center != null && !Number.isFinite(law.center)) throw new RangeError("Invalid lane centre offset");
  const center = lateral - ((law.offset || 0) - (law.center ?? 0));
  if (!Number.isFinite(center)) throw new RangeError("Lane centre offset exceeds the supported range");
  return center;
}

// Distance over which a lane change completes: about 3.5 s of travel, at least 18 m and at most 50 m,
// which keeps lateral acceleration under about 1.6 m/s^2 for a 3.3 m lane.
export function laneChangeLength(v) {
  if (!Number.isFinite(v)) throw new RangeError("Lane-change length requires a finite speed (m/s)");
  return clamp(3.5 * Math.abs(v), 18, 50);
}

const CURVE_HORIZON_M = 60;

// Fastest speed now from which the car can slow comfortably to every point's safe cornering speed
// over the next 60 m, including the curve it is already in. Comfortable cornering is 2.2 m/s^2 and
// braking into a curve 2.0 m/s^2 on a dry road; both shrink with grip.
export function curveProfileSpeed(route, s) {
  if (!Number.isFinite(s)) throw new RangeError("Invalid curve-profile route position");
  if (typeof route?.curveSpeedAt !== "function" || !Number.isFinite(route.length) || route.length < 0)
    throw new TypeError("Curve profile requires route geometry with a finite length");
  const { lat, decel } = comfort();
  let best = { v: Infinity, at: 0 };
  for (let d = 0; d <= CURVE_HORIZON_M && s + d < route.length; d += 3) {
    const vc = route.curveSpeedAt(s, d, lat);
    if (!Number.isFinite(vc) || vc < 0) continue;
    const braking = 2 * decel * 0.8 * d;
    const squared = vc * vc + braking;
    const v =
      squared === Infinity ? Math.hypot(vc, Math.sqrt(braking)) : squared === 0 && vc > 0 ? vc : Math.sqrt(squared);
    if (v < best.v) best = { v, at: d };
  }
  return best;
}

// The "law" a candidate or the autopilot executes between decisions. A lane law's vTarget is a
// ceiling: the curve profile lowers it through turns, the way a real speed controller would.
//   kind: "lane" (follow route with offset, target speed, and a stop at `stopAt`, braking at up to
//         `stopDecel` if given (`stopFirm` permits grip-bounded amber braking); `stopReaction`
//         reserves seconds of travel for response lag; `steerAtStop` finishes a short pull-over
//         within its stopping room; `slowTo`,
//         potholes and black ice to slow for, sim/potholes.js; `ice`, black ice seen, on which the
//         inputs are gentle, sim/black-ice.js gentleOnIce) | "hard_brake" | "reverse" | "steer" (fixed angle)
//         | "turnaround" (a three-point turn at a U-turn, sim/turnaround.js; it needs `world`)
//         | "park" (parallel parking at the destination, or pulling out again, sim/parallel-park.js;
//         it needs `world`)
// Lane and hard-brake laws aim at the lateral target where the pursuit point lies, so a lane change
// steers smoothly along its eased path.
export function applyLaw(vehicle, law, route, s, dt, world = null) {
  validateStepDuration(dt);
  if (dt === 0) return;
  if (!law || typeof law !== "object" || Array.isArray(law)) throw new TypeError("Vehicle law must be an object");
  switch (law.kind) {
    case "hard_brake":
      // (reversing, the brakes push forward)
      return vehicle.step(dt, {
        steer: route ? purePursuit(vehicle, route, s, lateralAt(law, s + lookahead(vehicle.v), route)) : vehicle.delta,
        accel: (vehicle.v < 0 ? 1 : -1) * comfort().hardDecel,
      });
    case "reverse": {
      const steer = law.target ? -steerToward(vehicle, law.target) : 0;
      return vehicle.step(dt, {
        steer,
        accel: speedControl(vehicle.v, -2, { maxAccel: 2, maxBrake: 4 }),
        reverse: true,
      });
    }
    case "steer":
      return vehicle.step(dt, { steer: law.steer, accel: speedControl(vehicle.v, law.vTarget) });
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: falls through to the lane law on purpose
    case "park":
      if (world && stepParking(vehicle, law, world, dt, speedControl)) return;
    // falls through: once out of the space, it follows the lane like any lane law
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: falls through to the lane law on purpose
    case "turnaround":
      if (
        law.kind === "turnaround" &&
        world &&
        route &&
        stepTurnaround(vehicle, law, route, world, dt, purePursuit, speedControl)
      )
        return;
    // falls through: once round, it follows the lane like any lane law ("lane" and the rest)
    default: {
      const stopAt = law.stopAt;
      if (typeof law.vTarget !== "number" || Number.isNaN(law.vTarget))
        throw new RangeError("Invalid law target speed");
      if (law.s0 != null && !Number.isFinite(law.s0)) throw new RangeError("Invalid law starting route position");
      if (stopAt != null && !Number.isFinite(stopAt)) throw new RangeError("Invalid law stop distance");
      if (stopAt != null && law.stopReaction != null && (!Number.isFinite(law.stopReaction) || law.stopReaction < 0))
        throw new RangeError("Invalid law stopping reaction time");
      if (stopAt != null && law.stopDecel != null && (!Number.isFinite(law.stopDecel) || law.stopDecel < 0))
        throw new RangeError("Invalid law stopping deceleration");
      let vTarget = Math.min(law.vTarget, curveProfileSpeed(route, s).v);
      const stopRoom = stopAt != null ? stopAt - (s - (law.s0 ?? s)) : null;
      if (stopRoom != null)
        vTarget = Math.min(
          vTarget,
          stopSpeedFor(
            stopRoom - Math.max(0, vehicle.v) * (law.stopReaction || 0),
            law.stopDecel != null
              ? Math.min(law.stopDecel, law.stopFirm ? comfort().hardDecel : comfort().decel)
              : undefined,
          ),
        );
      // (down to the speed to drive over each pothole its wheels cross, by then, and no faster until its
      // rear wheels are over: sim/potholes.js; route arc lengths)
      if (law.slowTo) {
        if (!Array.isArray(law.slowTo)) throw new TypeError("Law slow zones must be an array");
        for (const slow of law.slowTo) {
          if (
            !Number.isFinite(slow?.from) ||
            !Number.isFinite(slow.to) ||
            slow.to < slow.from ||
            !Number.isFinite(slow.mps) ||
            slow.mps < 0
          )
            throw new RangeError("Invalid law slow zone");
          vTarget = Math.min(vTarget, slowCap(slow, s));
        }
      }
      // A short pull-over must finish steering within the room before its stop,
      // rather than aiming four metres ahead beyond the control line.
      const Ld =
        law.steerAtStop && stopRoom != null
          ? Math.max(1, Math.min(lookahead(vehicle.v), stopRoom / 2))
          : lookahead(vehicle.v);
      const steer = purePursuit(vehicle, route, s, lateralAt(law, s + Ld, route), Ld),
        accel = speedControl(vehicle.v, vTarget);
      // (on black ice it has seen, the driver only eases the pedals and the wheel: sim/black-ice.js)
      if (law.ice && ROAD.gripAt) return vehicle.step(dt, gentleOnIce(vehicle, steer, accel, dt));
      return vehicle.step(dt, { steer, accel });
    }
  }
}
