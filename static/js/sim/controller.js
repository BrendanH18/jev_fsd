// The one control law used by the autopilot, the NPCs, and every candidate forward-simulation:
// pure pursuit on a route (with a lateral offset) plus a proportional speed controller.

import { CAR } from "./vehicle.js";
import { clamp } from "../common.js";

export function lookahead(v) { return clamp(0.8 * Math.abs(v), 4, 15); }

// steer command to reach the route point `Ld` ahead, shifted `offset` meters to the right
export function purePursuit(vehicle, route, s, offset = 0) {
  const Ld = lookahead(vehicle.v);
  const target = route.offsetPointAt(Math.min(s + Ld, route.length), offset);
  const dx = target[0] - vehicle.x, dy = target[1] - vehicle.y;
  const alpha = Math.atan2(dy, dx) - vehicle.psi;
  const dist = Math.max(1, Math.hypot(dx, dy));
  return Math.atan2(2 * CAR.wheelbase * Math.sin(alpha), dist);
}

// steer toward an arbitrary point (used for recovery when off the route)
export function steerToward(vehicle, point) {
  const dx = point[0] - vehicle.x, dy = point[1] - vehicle.y;
  let alpha = Math.atan2(dy, dx) - vehicle.psi;
  while (alpha > Math.PI) alpha -= 2 * Math.PI;
  while (alpha <= -Math.PI) alpha += 2 * Math.PI;
  const dist = Math.max(1, Math.hypot(dx, dy));
  return Math.atan2(2 * CAR.wheelbase * Math.sin(alpha), dist);
}

export function speedControl(v, vTarget, { gain = 1.5, maxAccel = 2.5, maxBrake = 7 } = {}) {
  return clamp(gain * (vTarget - v), -maxBrake, maxAccel);
}

// Speed that lets the car stop exactly at `distance` meters ahead with a comfortable deceleration.
export function stopSpeedFor(distance, decel = 2.5) {
  if (distance <= 0) return 0;
  return Math.sqrt(2 * decel * distance);
}

// The "law" a candidate or the autopilot executes between decisions.
//   kind: "lane" (follow route with offset, target speed) | "hard_brake" | "reverse" | "steer" (fixed angle)
export function applyLaw(vehicle, law, route, s, dt) {
  switch (law.kind) {
    case "hard_brake":
      return vehicle.step(dt, { steer: route ? purePursuit(vehicle, route, s, law.offset || 0) : vehicle.delta, accel: -7 });
    case "reverse": {
      const steer = law.target ? -steerToward(vehicle, law.target) : 0;
      return vehicle.step(dt, { steer, accel: speedControl(vehicle.v, -2, { maxAccel: 2, maxBrake: 4 }) });
    }
    case "steer":
      return vehicle.step(dt, { steer: law.steer, accel: speedControl(vehicle.v, law.vTarget) });
    case "lane":
    default: {
      const stopAt = law.stopAt;
      let vTarget = law.vTarget;
      if (stopAt !== undefined && stopAt !== null) vTarget = Math.min(vTarget, stopSpeedFor(stopAt - (s - (law.s0 ?? s))));
      return vehicle.step(dt, { steer: purePursuit(vehicle, route, s, law.offset || 0), accel: speedControl(vehicle.v, vTarget) });
    }
  }
}
