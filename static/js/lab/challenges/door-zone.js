// The door zone: a car parked at the curb 65 m on, and a cyclist riding the lane 30 m ahead of the car.
// Once the car is 43 m from the parked car, its door opens.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, BIKE } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { laneScenario, placeCurbCar, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "door-zone",
  title: "The door zone",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 1042,
  icon: "↔",
  difficulty: "Anticipation",
  hazard: "door",
  description: "A cyclist. A parked car. One opening door. Leave room before you need it.",
  lesson: "Look for curb activity and give the cyclist room.",
};

export const scenario = (map, challenge) => laneScenario(map, challenge);

export function install(world, fleet, _challenge, scenario, at) {
  placeCurbCar(world, at);
  const lane = at.lane,
    bp = pointAt(lane.pts, lane.cum, scenario.start.s + 30);
  const bike = new Vehicle(bp[0], bp[1], headingAt(lane.pts, lane.cum, scenario.start.s + 30), 3, BIKE);
  Object.assign(bike, {
    id: "challenge_bike",
    kind: "bike",
    color: 0x4cc2ff,
    v0: 3.5,
    driver: { aMax: 0.8, b: 2, s0: 2, T: 1.5, react: 0.6, lcRate: 0 },
    stopMem: new StopMemory(),
    path: new NpcPath(world.map, fleet.random, { bike: true }),
    frozen: 0,
    waiting: 0,
  });
  bike.path.start(lane.edge, lane.idx, scenario.start.s + 30);
  fleet.vehicles.push(bike);
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    release: (world, _fleet, state) => world.parked.openDoor(world.parked.list.find((c) => c.id === state.carId)),
  });
