// One fixed physics step of the whole world. The interactive app and the benchmark runner both
// call this, so a benchmark measures exactly what you watch.

import { stepChallenge } from "../lab/challenges.js";

export function stepWorld({ world, fleet, autopilot, input = null }, dt, now) {
  stepChallenge(world, fleet);
  if (autopilot.enabled) autopilot.step(dt, now);
  else if (input) world.stepManual(dt, input);
  world.parked.step(dt, world);
  world.roadside.step(dt);
  world.workZones.step(dt);
  world.laneClosures.step(dt);
  world.outages.step(dt);
  world.doubleParked.step(dt);
  world.stepOuts.step(dt);
  world.crossingGuards.step(dt);
  fleet.step(dt);
  // (contraflow cyclists, with that option on: sim/contraflow.js)
  if (world.contraflow.enabled) world.contraflow.step(dt);
  // (cars backing out of driveways, with that option on: sim/driveway-reversers.js)
  if (world.driveways?.enabled) world.driveways.step(dt, fleet);
  // (Canada geese crossing the road, with that option on: sim/geese.js)
  if (world.geese?.enabled) world.geese.step(dt);
  world.crowd.step(dt);
  world.t += dt;
  world.tick++;
  const road = world.roadInfo();
  world.audit(dt, road);
  world._road = road;
  return road;
}
