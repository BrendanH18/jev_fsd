// Joining the flow: a car parked at the curb 65 m on signals and pulls out into the car's lane once
// the car is 65 m from it.
import { laneScenario, placeCurbCar, reach, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "curb-merge",
  title: "Joining the flow",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 5042,
  icon: "↗",
  difficulty: "Anticipation",
  hazard: "pull",
  description: "A parked car signals and joins your lane. Notice the indicator and leave a gap.",
  lesson: "Ease off for a merging car rather than closing the gap.",
};

export const scenario = (map, challenge) => laneScenario(map, challenge);

export function install(world, _fleet, _challenge, _scenario, at) {
  placeCurbCar(world, at);
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: reach(65),
    release: (world, fleet, state) => {
      const car = world.parked.list.find((c) => c.id === state.carId);
      const merging = fleet.startPullOut(car);
      state.mergingId = merging?.id || null;
    },
  });
