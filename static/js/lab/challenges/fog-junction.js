// Into the unknown: a signalled junction in fog, the car starting on one of the map's signalled
// approaches. The weather is the hazard.
import { laneScenario } from "./shared/kit.js";

export const challenge = { id: "fog-junction", title: "Into the unknown", map: "victoria", weather: "fog", time: "morning", seed: 2042, icon: "◌", difficulty: "Visibility", hazard: "signal",
  description: "A Victoria junction with only 28 metres of sight. Can you stop within what you can see?", lesson: "An unseen signal is unknown. Slow early, then observe." };

export const scenario = (map, challenge) => laneScenario(map, challenge);
