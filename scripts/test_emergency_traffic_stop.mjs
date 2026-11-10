// The city following policy must not stop traffic an extra IDM gap before its chosen pull-over.
// node --experimental-default-type=module scripts/test_emergency_traffic_stop.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
for (const weather of ["dry", "rain", "snow"]) {
  const w = fixtureWorld({ weather }); w.followingDistance = true;
  Object.assign(w.ego, { x: 120, v: 0 });
  const f = new NpcFleet(w, { count: 0, bikes: 0 }); f.nextPull = f.nextPark = Infinity;
  assert.equal(!!f.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 }), true);
  f.emergencyStep = () => {};
  Object.assign(w.ego, { x: -1000, y: -1000 });
  const n = Object.assign(new Vehicle(100, 0, 0, 2), { id: "yielding", v0: 8, frozen: 0, waiting: 0,
    stopMem: new StopMemory(), path: new NpcPath(w.map, () => 0.5),
    driver: { s0: 2.4, aMax: 1.5, b: 2, T: 1.5, react: 0.5, lcRate: 0 } });
  n.path.start("street", 0, 100); f.vehicles.push(n);
  let goal = null;
  for (let k = 0; k < 16 * 60; k++) {
    f.step(1 / 60); w.t += 1 / 60;
    if (n.yieldEv?.stop) goal = n.yieldEv.stop[0];
  }
  assert.equal(typeof goal, "number");
  assert.equal(n.v < 0.1, true);
  const bumper = n.x + n.spec.length - n.spec.rearOverhang;
  assert.equal(Math.abs(bumper - goal) < 0.6, true, `${weather}: reached the chosen stop: bumper=${bumper}, goal=${goal}`);
}
console.log("City traffic reaches its physical emergency pull-over stop in every grip condition");
process.exit(0);
