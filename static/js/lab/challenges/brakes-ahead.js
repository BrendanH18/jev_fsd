// Brakes ahead: the car ahead brakes hard on a wet street (shared/following.js, shared with Make room).
import { followingScenario, installFollowing, stepFollowing } from "./shared/following.js";

export const challenge = {
  id: "brakes-ahead",
  title: "Brakes ahead",
  map: "kitsilano",
  weather: "rain",
  time: "afternoon",
  seed: 46042,
  icon: "⇣",
  difficulty: "Anticipation",
  hazard: "following",
  followingDistance: true,
  street: "West 6th Avenue",
  description:
    "The car ahead brakes hard on a wet West 6th Avenue. Leave room to stop, then follow it once it moves again.",
  lesson:
    "Your following gap needs to allow for road grip, braking response and the car ahead stopping suddenly. Leave more room on a wet road and brake while there is still space.",
};

export const scenario = followingScenario;

export function install(world, fleet, challenge, scenario) {
  installFollowing(world, fleet, scenario);
}

export const step = (world, fleet) => stepFollowing(world, fleet);
