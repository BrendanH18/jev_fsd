// Keep going safely: the same light turns amber too late to stop
// (shared/amber.js, shared with Room to stop).
import { amberScenario, installAmber } from "./shared/amber.js";

export const challenge = {
  id: "amber-clear",
  title: "Keep going safely",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 45042,
  icon: "◉",
  difficulty: "Judgement",
  hazard: "amber",
  amberLights: true,
  street: "West 4th Avenue",
  description: "On West 4th Avenue, the light changes to amber later in your approach than in Room to stop.",
  lesson:
    "Judge whether you can stop before the line when the light changes. If there is too little room for a safe stop, continue at a steady speed, watch for people in your path, and clear the junction.",
};

export const scenario = amberScenario;

export function install(world, _fleet, _challenge, scenario) {
  installAmber(world, scenario);
}
