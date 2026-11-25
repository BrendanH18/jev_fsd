// One fixed physics step of the whole world. The interactive app and the benchmark runner both
// call this, so a benchmark measures exactly what you watch.

import { stepChallenge } from "../lab/challenges.js";
import { hooks } from "./features/index.js";

// The registered features' steps (sim/features/index.js): first of all, before the traffic moves, and
// after it, before the people on foot.
const FIRST = hooks("stepBeforeTraffic", "first");
const AFTER_PARKED = hooks("stepBeforeTraffic", "afterParked");
const AFTER_MERGE = hooks("stepBeforeTraffic", "afterMerge");
const AFTER_OUTAGES = hooks("stepBeforeTraffic", "afterOutages");
const BEFORE_TRAFFIC = hooks("stepBeforeTraffic");
const AFTER_TRAFFIC = hooks("stepAfterTraffic");

export function stepWorld({ world, fleet, autopilot, input = null }, dt, now) {
  // (what a registered feature sets up before anything moves: black ice's grip hook, say)
  for (const step of FIRST) step(world, fleet, dt);
  stepChallenge(world, fleet);
  if (autopilot.enabled) autopilot.step(dt, now);
  else if (input) world.stepManual(dt, input);
  world.parked.step(dt, world);
  for (const step of AFTER_PARKED) step(world, fleet, dt);
  world.laneClosures.step(dt);
  for (const step of AFTER_MERGE) step(world, fleet, dt);
  for (const step of AFTER_OUTAGES) step(world, fleet, dt);
  world.stepOuts.step(dt);
  for (const step of BEFORE_TRAFFIC) step(world, fleet, dt);
  fleet.step(dt);
  for (const step of AFTER_TRAFFIC) step(world, fleet, dt);
  world.crowd.step(dt);
  world.t += dt;
  world.tick++;
  const road = world.roadInfo();
  world.audit(dt, road);
  world._road = road;
  return road;
}
