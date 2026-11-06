// Conservative simulator following targets, not statutory distances. All distances are
// bumper to bumper; road grip comes from the same module state as vehicle physics.
import { CAR, G, ROAD, comfort } from "./vehicle.js";

export const FOLLOWING_STANDSTILL_M = 3;
export const FOLLOWING_REACTION_S = 0.4;

export function followingPolicy(vehicle, lead) {
  const spec = vehicle.spec || CAR, leadSpec = lead.vehicle?.spec || CAR;
  const v = Math.max(0, vehicle.v), ahead = Math.max(0, lead.speed);
  const gap = Math.max(0, lead.gap_m), grip = Math.max(0.05, ROAD.mu);
  const braking = Math.min(spec.maxBrake, comfort().decel);
  // Reserve a decision interval, actuator lag and the whole jerk-limited ramp
  // from the present positive acceleration to comfortable braking. Give the
  // leader no corresponding delay: it may already be braking when observed.
  const reaction = FOLLOWING_REACTION_S + (spec.accelLag ?? CAR.accelLag)
    + (Math.max(0, vehicle.a || 0) + braking) / (spec.jerkMax || CAR.jerkMax);
  const headway = 2 * Math.sqrt(0.9 / Math.min(0.9, grip));
  // Stationary obstacles such as open doors have geometry-only specifications.
  const leadBraking = Math.min(leadSpec.maxBrake ?? CAR.maxBrake, grip * G);
  const leadStop = ahead * ahead / (2 * leadBraking);
  const stopping = v * reaction + v * v / (2 * braking) - leadStop;
  const target = FOLLOWING_STANDSTILL_M + Math.max(v * headway, stopping);
  const room = Math.max(0, gap - FOLLOWING_STANDSTILL_M);
  // Invert v*reaction + v²/(2*braking) <= room + leader stopping distance.
  const br = braking * reaction;
  const stopSpeed = Math.sqrt(br * br + 2 * braking * (room + leadStop)) - br;
  // Rebuild a lost time gap progressively instead of demanding gap/headway as
  // an immediate speed after a cut-in. Close or open at at most 2 m/s relative
  // to the leader; the stopping ceiling can demand firmer braking when needed.
  let approachSpeed = ahead + Math.max(-2, Math.min(2, (gap - target) / 3));
  if (gap < target) approachSpeed = Math.min(approachSpeed, v);
  const safeSpeed = room > 0 ? Math.max(0, Math.min(stopSpeed, approachSpeed)) : 0;
  return { target_gap_m: target, safe_speed_mps: safeSpeed, headway_s: headway,
    reaction_s: reaction, braking_mps2: braking };
}
