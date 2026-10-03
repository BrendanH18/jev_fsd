// One fixed physics step of the whole world. The interactive app and the benchmark runner both
// call this, so a benchmark measures exactly what you watch.

import { stepChallenge } from "../lab/challenges.js";

export function stepWorld({ world, fleet, autopilot, input = null }, dt, now) {
  stepChallenge(world, fleet);
  if (autopilot.enabled) autopilot.step(dt, now);
  else if (input) world.stepManual(dt, input);
  world.parked.step(dt, world);
  fleet.step(dt);
  world.crowd.step(dt);
  world.t += dt;
  world.tick++;
  const road = world.roadInfo();
  world.audit(dt, road);
  world._road = road;
  return road;
}
