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
  description: "You're following a car along a wet stretch of West 6th Avenue when its brake lights come on sharply.",
  lesson:
    "Use a roadside marker to check your time gap before the lead car brakes. Build a longer gap in the rain, and start braking while there is room to stop smoothly.",
};

export const scenario = followingScenario;

export function install(world, fleet, _challenge, scenario) {
  installFollowing(world, fleet, scenario);
}

export const step = (world, fleet) => stepFollowing(world, fleet);
