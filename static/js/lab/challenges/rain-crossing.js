// Rain check: a person waits at the side of a wet street 65 m on, and walks across it once the car
// is 43 m from them.
import { laneScenario, placeCrossingPedestrian, releasePedestrian, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "rain-crossing",
  version: 2,
  title: "Rain check",
  map: "montreal",
  weather: "rain",
  time: "night",
  seed: 3042,
  icon: "☂",
  difficulty: "Patience",
  hazard: "pedestrian",
  description: "After dark in Montréal, a person crosses your path on a rain-soaked street with less grip for braking.",
  lesson:
    "Ease off while you still have a clear stretch ahead and brake progressively. Leave enough stopping room to yield before the crossing on the wet surface.",
};

export const scenario = (map, challenge) => laneScenario(map, challenge);

export function install(world, _fleet, challenge, scenario, at) {
  placeCrossingPedestrian(world, challenge, scenario, at);
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, { release: (world, _fleet, state) => releasePedestrian(world, state) });
