// Room to stop: the light on West 4th Avenue at Maple Street turns amber with room to stop
// (shared/amber.js, shared with Keep going safely).
import { amberScenario, installAmber } from "./shared/amber.js";

export const challenge = {
  id: "amber-stop",
  title: "Room to stop",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 44042,
  icon: "◉",
  difficulty: "Judgement",
  hazard: "amber",
  amberLights: true,
  street: "West 4th Avenue",
  description: "The light on West 4th Avenue turns amber while you're still far enough back to brake smoothly.",
  lesson:
    "Start braking as soon as you judge a safe stop is possible. Allow for grip and braking response, stop before the line, and hold there until the light changes.",
};

export const scenario = amberScenario;

export function install(world, _fleet, _challenge, scenario) {
  installAmber(world, scenario);
}
