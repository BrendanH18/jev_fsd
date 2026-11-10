// A blocked lateral-gap search must not turn off-path traffic into leaders.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { kitsilano } = await import("./progress_helpers.mjs");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, FIRE_TRUCK, BIKE } = await import("../static/js/sim/vehicle.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const map = kitsilano(), world = new World(map, { parked: 0, pedestrians: 0, weather: "fog" });
const fleet = new NpcFleet(world, { count: 0, bikes: 0 });
Object.assign(world.ego, { x: 334.901, y: 254.698, psi: -0.04677, v: 0 });
// Fog s1-9, just after the fire truck stands down. Hold the surrounding queue still.
const poses = [
  { id: "bike_6", x: 354.74411, y: 258.34087, psi: 3.137793, kind: "bike" },
  { id: "reversing_1_away", x: 327.32281, y: 254.97828, psi: -0.024607 },
];
for (const p of poses) {
  const body = Object.assign(new Vehicle(p.x, p.y, p.psi, 0, p.kind === "bike" ? BIKE : undefined), { id: p.id });
  world.parked.add(body);
}
const truck = Object.assign(new Vehicle(348.360578, 256.803788, 3.12309351, 0, FIRE_TRUCK), {
  id: "fire_truck", kind: "fire_truck", side: -0.875906, siren: false, age: 70, v0: 11.2, blockedFor: 0,
  driver: { aMax: 1.5, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 },
});
truck.path = new NpcPath(map, () => 0.5); truck.path.start("e519", 0, 173.4, [["e517", 0]]);
fleet.vehicles.push(truck);
let hit = false;
for (let k = 0; k < 8 * 60; k++) {
  fleet.emergencyStep(truck, 1 / 60, [world.ego, truck]); world.t += 1 / 60;
  hit ||= [world.ego, ...world.parked.list].some(o => obbOverlap(truck.obb(), o.obb()));
}
assert.equal(hit, false, "the actual body still keeps clear of the queue and parked cars");
assert.ok(truck.x < 343, `the fire truck carries on past the false leader: x=${truck.x}`);
// Cars beside the tail can close the lateral gap search while the forward line
// is empty. Until there is a verified opening, approach only at squeeze speed.
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const openWorld = fixtureWorld(), openFleet = new NpcFleet(openWorld, { count: 0, bikes: 0 });
Object.assign(openWorld.ego, { x: -1000, y: -1000 });
for (const y of [0, 4.6]) openWorld.parked.add(new Vehicle(90, y, 0, 0));
const cautious = Object.assign(new Vehicle(100, 2.35, 0, 6, FIRE_TRUCK), {
  id: "squeezing", kind: "fire_truck", side: -2.35, siren: true, age: 0, v0: 16.7, blockedFor: 0,
  driver: { aMax: 1.5, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 },
});
cautious.path = new NpcPath(openWorld.map, () => 0.5); cautious.path.start("street", 0, 100);
let command = null;
cautious.step = function(dt, input) { command = input.accel; return Vehicle.prototype.step.call(this, dt, input); };
openFleet.emergencyStep(cautious, 1 / 60, [openWorld.ego, cautious]);
assert.ok(command > 0, "bodies wholly behind the tail do not close the opening ahead");
for (const parked of [...openWorld.parked.list]) openWorld.parked.remove(parked);
for (const y of [0, 4.6]) openWorld.parked.add(new Vehicle(94, y, 0, 0));
Object.assign(cautious, { x: 100, y: 2.35, psi: 0, v: 6, a: 0, side: -2.35 });
openFleet.emergencyStep(cautious, 1 / 60, [openWorld.ego, cautious]);
assert.ok(command < 0, "slow down while holding a line with no lateral opening");
console.log("✓ a failed lateral gap search keeps real body clearance without a phantom leader");
process.exit(0);
