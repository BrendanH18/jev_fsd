// A side-street car's tail beyond the asphalt no longer occupies the emergency vehicle's junction.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { kitsilano } = await import("./progress_helpers.mjs");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, AMBULANCE } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const map = kitsilano(), world = new World(map, { parked: 0, pedestrians: 0 });
const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPull = fleet.nextPark = Infinity;
Object.assign(world.ego, { x: -192.78629851944717, y: -525.9975575137584, psi: 3.1268159702751666, v: 0 });
const lane = map.lane("e574", 0); world.placeOnLane(lane, 70);
const ambulance = Object.assign(new Vehicle(world.ego.x, world.ego.y, world.ego.psi, 3, AMBULANCE), {
  id: "ambulance", kind: "ambulance", side: -1.6, siren: true, age: 0, v0: 11,
  driver: { aMax: 2, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 },
  stopMem: new StopMemory(), frozen: 0, waiting: 0, path: new NpcPath(map, () => 0.5), blockedFor: 0,
});
ambulance.path.start("e574", 0, 70, [["e386", 0]]); fleet.vehicles.push(ambulance);
Object.assign(world.ego, { x: -192.78629851944717, y: -525.9975575137584, psi: 3.1268159702751666, v: 0 });
const approach = ambulance.path.currentEdge();
assert.equal(fleet.boxBusy(ambulance, approach), false, "the whole body has left the crossing street");
world.ego.x += 1;
assert.equal(fleet.boxBusy(ambulance, approach), true, "a tail still over the asphalt holds the ambulance");
world.ego.x -= 1;
let touched = false;
for (let k = 0; k < 20 * 60; k++) {
  fleet.step(1 / 60); world.t += 1 / 60;
  touched ||= obbOverlap(ambulance.obb(), world.ego.obb());
}
assert.equal(touched, false);
assert.equal(ambulance.x > -170, true, "carries on through the clear junction");
console.log("Emergency vehicles distinguish a clear junction from an intruding tail");
process.exit(0);
