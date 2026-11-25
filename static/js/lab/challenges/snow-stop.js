// Winter composure: a stop sign on a snowy street, the car starting on one of the map's approaches
// with one. The weather is the hazard.
import { laneScenario } from "./shared/kit.js";

export const challenge = {
  id: "snow-stop",
  title: "Winter composure",
  map: "toronto",
  weather: "snow",
  time: "afternoon",
  seed: 4042,
  icon: "❄",
  difficulty: "Control",
  hazard: "stop",
  description:
    "A stop sign lies ahead on a snow-covered Toronto block. The car needs more distance than usual to stop at the line.",
  lesson:
    "Lift early and brake progressively while there is room. Bring the wheels to a complete stop before the line, then accelerate gently to keep traction.",
};

export const scenario = (map, challenge) => laneScenario(map, challenge);
