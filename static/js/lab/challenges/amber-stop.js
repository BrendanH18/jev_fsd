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
  description:
    "The light turns amber on West 4th Avenue, with room to stop safely. Ease off, stop before the line, and wait for green.",
  lesson:
    "Amber means stop if you can do so safely. Decide when the light changes, allow for grip and braking response, and never speed up to beat it.",
};

export const scenario = amberScenario;

export function install(world, _fleet, _challenge, scenario) {
  installAmber(world, scenario);
}
