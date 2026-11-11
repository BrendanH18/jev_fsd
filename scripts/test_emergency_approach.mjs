// Clearing a junction for a siren still requires a timely deceleration on rain grip.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const world = fixtureWorld({ weather: "rain" });
Object.assign(world.ego, { x: 100, v: 3.6633 });
const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPull = fleet.nextPark = Infinity;
const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 80 });
assert.equal(!!ev, true);
fleet.emergencyStep = () => {};
// The approach is already latched to a stop beyond a junction, leaving room to steer over.
world.evYield = { id: ev.id, route: world.route, stop: 160, speed: world.ego.v, since: 0, clearing: true, lead: false };
// The full pull-over is unavailable beside this parked car; a lane manoeuvre wins.
const parked = new Vehicle(108, -2.3, 0, 0); world.parked.add(parked);
const autopilot = new Autopilot(world); autopilot.setBrain("rules"); autopilot.setEnabled(true);
for (let k = 0; k < 5 * 60; k++) {
  stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
  if (autopilot.firing) await autopilot.firing;
}
assert.equal(world.violations.failed_to_yield, 0, "extra clearing room does not postpone slowing for a siren");
assert.equal(world.ego.v < 3, true, "actual vehicle response reaches yielding speed");
world.parked.remove(parked);
world.evCalls.get(ev.id).lead = true;
const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world);
simulateAll(candidates, snap, world);
assert.equal(candidates.some(c => c.eligible && c.law.vTarget > 3), true, "a drive-on instruction releases the response ceiling");
console.log("Emergency junction clearing slows promptly through real wet-road actuator response");
process.exit(0);
