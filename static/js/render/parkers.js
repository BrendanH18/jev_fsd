// Traffic parking (sim/parkers.js): a car reversing into a bay shows its reversing lamps.
import { syncReverseLamps } from "./driveway-reversers.js";

export const view = {
  car: {
    order: 3,
    effect(world, mesh, vehicle) {
      syncReverseLamps(mesh, vehicle, world.parkers?.enabled === true);
    },
  },
};
