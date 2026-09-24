// One fixed physics step of the whole world. The interactive app and the benchmark runner both
// call this, so a benchmark measures exactly what you watch.

export function stepWorld({ world, fleet, autopilot, input = null }, dt, now) {
  if (autopilot.enabled) autopilot.step(dt, now);
  else if (input) world.stepManual(dt, input);
  fleet.step(dt);
  world.t += dt;
  world.tick++;
  const road = world.roadInfo();
  world.audit(dt, road);
  world._road = road;
  return road;
}
