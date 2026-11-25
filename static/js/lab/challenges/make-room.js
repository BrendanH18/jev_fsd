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
    "A moving car changes lanes into the space ahead of you on West 4th Avenue, shortening your following gap.",
  lesson:
    "Ease off as soon as the car moves in. If coasting leaves too little room, brake gently until you have a usable gap again.",
};

export const scenario = followingScenario;

export function install(world, fleet, _challenge, scenario) {
  installFollowing(world, fleet, scenario);
}

export const step = (world, fleet) => stepFollowing(world, fleet);
