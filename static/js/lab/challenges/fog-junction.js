// Into the unknown: a signalled junction in fog, the car starting on one of the map's signalled
// approaches. The weather is the hazard.
import { laneScenario } from "./shared/kit.js";

export const challenge = {
  id: "fog-junction",
  title: "Into the unknown",
  map: "victoria",
  weather: "fog",
  time: "morning",
  seed: 2042,
  icon: "◌",
  difficulty: "Visibility",
  hazard: "signal",
  description:
    "In Victoria, fog limits your view of the junction ahead to about 28 metres. The signal is still hidden as you approach.",
  lesson:
    "Adjust speed while the signal is out of sight so you can stop within the visible road. Decide whether to proceed only once you can read the light and see your path.",
};

export const scenario = (map, challenge) => laneScenario(map, challenge);
