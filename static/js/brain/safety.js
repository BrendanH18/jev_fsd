// Local safety brake and deadlock detection. Runs every physics tick, overrides any brain for
// imminent collisions only. It never intervenes for lights or signs: those are the brain's job,
// and mistakes there are counted as violations.

import { CAR } from "../sim/vehicle.js";

export function safetyBrake(world, snap, executing) {
  const ego = world.ego;
  if (ego.v < 0.3) return null;
  if (snap && snap.following) {
    const gap = snap.following.gap_m, closing = snap.following.closing_mps;
    const ttc = closing > 0.1 ? gap / closing : Infinity;
    if (gap < 2.0 || ttc < 1.2) return { reason: "following", ttc, gap };
  }
  // anything directly ahead in the ego frame, regardless of route
  for (const n of world.npcs) {
    const local = ego.toLocal(n.x, n.y);
    if (local.ahead < 0 || local.ahead > 20 || Math.abs(local.right) > 1.4) continue;
    const gap = local.ahead - CAR.length;
    const closing = ego.v - n.v * Math.cos(n.psi - ego.psi);
    if (gap < 1.5 || (closing > 0.1 && gap / closing < 1.0)) return { reason: "ahead", gap, closing };
  }
  if (executing && executing.hazard && executing.hazard.in_s < 1.0) return { reason: "predicted", hazard: executing.hazard };
  return null;
}

export class DeadlockDetector {
  constructor() { this.stoppedFor = 0; }
  update(world, snap, dt) {
    const ego = world.ego;
    const legit = (snap && snap.intersection && (
      (snap.intersection.control === "signal" && snap.intersection.signal !== "green" && snap.intersection.bumper_to_line_m < 12 && snap.intersection.bumper_to_line_m > -2) ||
      (snap.intersection.control === "stop" && !snap.intersection.stop_completed && snap.intersection.bumper_to_line_m < 12) ||
      (snap.intersection.control === "stop" && snap.intersection.cross_traffic_moving && snap.intersection.bumper_to_line_m < 8)))
      || (snap && snap.following && snap.following.gap_m < 8)
      || (snap && snap.nav && snap.nav.remaining_m < 10)
      || !world.route;
    if (Math.abs(ego.v) < 0.3 && !legit) this.stoppedFor += dt;
    else this.stoppedFor = 0;
    world.stuckFor = this.stoppedFor;
    return this.stoppedFor;
  }
}
