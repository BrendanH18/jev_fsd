// Local safety brake and deadlock detection. Runs every physics tick, overrides any brain for
// imminent collisions only. It never intervenes for lights or signs: those are the brain's job,
// and mistakes there are counted as violations.

import { obbOverlap } from "../sim/collision.js";
import { CAR } from "../sim/vehicle.js";


export function safetyBrake(world, snap, executing) {
  const ego = world.ego;
  const FRONT = ego.spec.length - ego.spec.rearOverhang;
  if (ego.v < 0.3) {
    // standing still: never pull away into a car right in front (not counted as an intervention)
    for (const n of world.visibleObstaclesNear(ego.x, ego.y, 12)) {
      const local = ego.toLocal(n.x, n.y);
      if (Math.abs(local.right) < ego.spec.width / 2 + 0.65 && local.ahead > -1 && local.ahead - FRONT - (n.spec || CAR).rearOverhang < 2.0) return { reason: "blocked", hold: true };
    }
    return null;
  }
  if (snap && snap.following) {
    const gap = snap.following.gap_m, closing = snap.following.closing_mps;
    const ttc = closing > 0.1 ? gap / closing : Infinity;
    // too close and not pulling apart, or about to hit
    if ((gap < 2.0 && closing > -0.3) || ttc < 1.2) return { reason: "following", ttc, gap };
  }
  // anything directly ahead in the ego frame, regardless of route
  for (const n of world.visibleObstaclesNear(ego.x, ego.y, 26)) {
    if (n.kind === "door") {
      const box = ego.obb();
      const reach = Math.max(2, ego.v * 1.2);
      box.center = [box.center[0] + Math.cos(ego.psi) * reach / 2, box.center[1] + Math.sin(ego.psi) * reach / 2];
      box.halfLength += reach / 2;
      if (obbOverlap(box, n.obb(), 0.3)) return { reason: "open door" };
    }
    const local = ego.toLocal(n.x, n.y);
    if (local.ahead < 0 || local.ahead > 20 || Math.abs(local.right) > ego.spec.width / 2 + 0.45) continue;
    const gap = local.ahead - FRONT - (n.spec || CAR).rearOverhang;
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
      (snap.intersection.control === "stop" && snap.intersection.cross_traffic_moving && snap.intersection.bumper_to_line_m < 8) ||
      (snap.intersection.control === "yield" && snap.intersection.cross_traffic_moving && snap.intersection.bumper_to_line_m < 8)))
      || (snap && snap.following && snap.following.gap_m < 8)
      || (snap && snap.pedestrian && snap.pedestrian.bumper_to_crosswalk_m < 12)
      || (snap && snap.nav && snap.nav.remaining_m < 10)
      || !world.route;
    const crawling = Math.abs(ego.v) < 1.0 && (!snap || !snap.target || snap.target.v > 2.0);
    if (crawling && !legit) this.stoppedFor += dt;
    else this.stoppedFor = 0;
    world.stuckFor = this.stoppedFor;
    return this.stoppedFor;
  }
}
