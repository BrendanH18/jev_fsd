// Winter composure: a stop sign on a snowy street, the car starting on one of the map's approaches
// with one. The weather is the hazard.
import { laneScenario } from "./shared/kit.js";

export const challenge = { id: "snow-stop", title: "Winter composure", map: "toronto", weather: "snow", time: "afternoon", seed: 4042, icon: "❄", difficulty: "Control", hazard: "stop",
  description: "A snowy Toronto block and a full stop. Stay composed when grip is limited.", lesson: "Lift off early. A complete stop beats a late hard brake." };

export const scenario = (map, challenge) => laneScenario(map, challenge);
