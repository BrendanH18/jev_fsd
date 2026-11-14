// Keep going safely: the same light turns amber too late to stop
// (shared/amber.js, shared with Room to stop).
import { amberScenario, installAmber } from "./shared/amber.js";

export const challenge = { id: "amber-clear", title: "Keep going safely", map: "kitsilano", weather: "dry", time: "afternoon", seed: 45042, icon: "◉", difficulty: "Judgement", hazard: "amber", amberLights: true, street: "West 4th Avenue",
  description: "The same light turns amber when you are too close to stop safely. Keep a steady speed and clear the junction cautiously.", lesson: "If a safe stop is no longer possible when amber appears, continue cautiously without speeding up. Yield to anyone in your path; an amber decision never permits entering on red." };

export const scenario = amberScenario;

export function install(world, fleet, challenge, scenario) {
  installAmber(world, scenario);
}
