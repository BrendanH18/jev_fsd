// Local safety brake and deadlock detection. Runs every physics tick, overrides any brain for
// imminent collisions only. It never intervenes for lights or signs: those are the brain's job,
// and mistakes there are counted as violations.

import { obbOverlap } from "../sim/collision.js";
import { CAR } from "../sim/vehicle.js";
import { CLEARING_M, waitsItsTurn } from "./sensors.js";

// Within this many metres of the destination a stop is not a deadlock, and a car that cannot get
// any closer because something is parked in the way has arrived.
export const DESTINATION_ZONE_M = 10;
// Turning round is slow on purpose; standing still this long in the middle of it is not.
const TURN_ROUND_IDLE_S = 5;

export function safetyBrake(world, snap, executing) {
  const ego = world.ego;
  const FRONT = ego.spec.length - ego.spec.rearOverhang;
  // A three-point turn moves at walking pace up to kerbs and parked cars on purpose, keeping clear
  // of them itself (sim/turnaround.js), so here only what is closer counts.
  const turning = executing?.law.kind === "turnaround" && world.turnaround === executing.law;
  if (ego.v < -0.05 || (turning && executing.law.phase === "reverse")) {
    // reversing: never back into something right behind (not counted while barely moving). A leg
    // of a turnaround ends further out on its own, so this only catches what it did not.
    const box = ego.obb(), reach = Math.max(0.25, -ego.v * 0.5);
    box.center = [box.center[0] - Math.cos(ego.psi) * reach / 2, box.center[1] - Math.sin(ego.psi) * reach / 2];
    box.halfLength += reach / 2;
    for (const n of world.visibleObstaclesNear(ego.x, ego.y, 12)) {
      if (obbOverlap(box, n.obb(), 0.1)) return ego.v < -0.3 ? { reason: "behind" } : { reason: "blocked", hold: true };
    }
    return null;
  }
  const gapStill = turning ? 0.5 : 2.0, gapMoving = turning ? 0.5 : 1.5, ttcMoving = turning ? 0.5 : 1.0;
  if (ego.v < 0.3) {
    // standing still: never pull away into a car right in front (not counted as an intervention)
    for (const n of world.visibleObstaclesNear(ego.x, ego.y, 12)) {
      const local = ego.toLocal(n.x, n.y);
      if (Math.abs(local.right) < ego.spec.width / 2 + 0.65 && local.ahead > -1 && local.ahead - FRONT - (n.spec || CAR).rearOverhang < gapStill) return { reason: "blocked", hold: true };
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
    if (gap < gapMoving || (closing > 0.1 && gap / closing < ttcMoving)) return { reason: "ahead", gap, closing };
  }
  if (executing && executing.hazard && executing.hazard.in_s < 1.0) return { reason: "predicted", hazard: executing.hazard };
  return null;
}

export class DeadlockDetector {
  constructor() { this.stoppedFor = 0; }
  update(world, snap, dt) {
    const ego = world.ego;
    const legit = (snap && snap.intersection && (
      (snap.intersection.control === "signal" && snap.intersection.signal !== "green" && snap.intersection.bumper_to_line_m < 12 && snap.intersection.bumper_to_line_m > -CLEARING_M) ||
      // A left-turn stop can stay in sensing after its stop memory is cleared. Once well past
      // its line it is no longer a reason to hold; an actual oncoming conflict still is below.
      (snap.intersection.control === "stop" && !snap.intersection.stop_completed && snap.intersection.bumper_to_line_m < 12 && snap.intersection.bumper_to_line_m > -CLEARING_M) ||
      (snap.intersection.control === "stop" && snap.intersection.cross_traffic_moving && snap.intersection.bumper_to_line_m < 8) ||
      (waitsItsTurn(snap.intersection) && snap.intersection.bumper_to_line_m < 8) ||
      (snap.intersection.control === "yield" && snap.intersection.cross_traffic_moving && snap.intersection.bumper_to_line_m < 8) ||
      (snap.intersection.oncoming && snap.intersection.oncoming.bumper_to_yield_m < 8) ||
      (snap.intersection.give_way?.wait_for && snap.intersection.give_way.bumper_to_hold_m < 8)))
      || (snap && snap.following && snap.following.gap_m < 8)
      || (snap && snap.pedestrian && snap.pedestrian.bumper_to_crosswalk_m < 12)
      || (snap && snap.right_hook && snap.right_hook.bumper_to_yield_m < 8)
      || (snap && snap.emergency && snap.emergency.bumper_to_stop_m !== null && snap.emergency.bumper_to_stop_m < 8)
      || (snap && snap.emergency_ahead && snap.emergency_ahead.speed < 1)
      || (snap && snap.bus && snap.bus.bumper_to_stop_m < 8)
      || (snap && snap.crosswalk_stop && snap.crosswalk_stop.bumper_to_stop_m < 8)
      || (snap && snap.nav && snap.nav.remaining_m < DESTINATION_ZONE_M)
      || (snap && snap.turnaround?.executing && snap.turnaround.idle_s < TURN_ROUND_IDLE_S)
      || !world.route;
    // (creeping forward to look past a building is slow on purpose, unless it is not moving at all)
    const g = snap?.intersection?.give_way, looking = g && !g.wait_for && g.hold_s_route !== null;
    const crawling = Math.abs(ego.v) < 1.0 && (!snap || !snap.target || snap.target.v > 2.0 || (looking && snap.target.v > 0 && Math.abs(ego.v) < 0.3));
    if (crawling && !legit) this.stoppedFor += dt;
    else this.stoppedFor = 0;
    world.stuckFor = this.stoppedFor;
    return this.stoppedFor;
  }
}
