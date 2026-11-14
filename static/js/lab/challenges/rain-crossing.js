// Rain check: a person waits at the side of a wet street 65 m on, and walks across it once the car
// is 43 m from them.
import { laneScenario, placeCrossingPedestrian, releasePedestrian, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "rain-crossing", version: 2, title: "Rain check", map: "montreal", weather: "rain", time: "night", seed: 3042, icon: "☂", difficulty: "Patience", hazard: "pedestrian",
  description: "A person crosses a wet Montréal street after dark. Smooth braking matters.", lesson: "Leave extra braking room on wet roads." };

export const scenario = (map, challenge) => laneScenario(map, challenge);

export function install(world, fleet, challenge, scenario, at) {
  placeCrossingPedestrian(world, challenge, scenario, at);
}

export const step = (world, fleet) => stepAuthored(world, fleet, { release: (world, fleet, state) => releasePedestrian(world, state) });
