// Make room: a car merges into the gap ahead (shared/following.js, shared with Brakes ahead).
import { followingScenario, installFollowing, stepFollowing } from "./shared/following.js";

export const challenge = {
  id: "make-room",
  title: "Make room",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 47042,
  icon: "↘",
  difficulty: "Anticipation",
  hazard: "following",
  followingDistance: true,
  street: "West 4th Avenue",
  description:
    "A moving car merges from the next lane into your gap on West 4th Avenue. Ease off and rebuild your following room.",
  lesson:
    "When someone moves into the gap ahead, make room by easing off or braking as needed. A short gap forced on you is a reason to respond, not to accelerate and close it further.",
};

export const scenario = followingScenario;

export function install(world, fleet, challenge, scenario) {
  installFollowing(world, fleet, scenario);
}

export const step = (world, fleet) => stepFollowing(world, fleet);
