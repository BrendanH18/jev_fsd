// A stood-down ambulance can clear a car beside it before merging into ordinary traffic.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, AMBULANCE } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
for (const weather of ["dry", "rain", "snow"]) {
  const world = fixtureWorld({ weather }); world.followingDistance = true;
  Object.assign(world.ego, { x: 108, y: 0, psi: 0, v: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPull = fleet.nextPark = Infinity;
  const ambulance = Object.assign(new Vehicle(100, 2.4, 0, 0, AMBULANCE), {
    id: "stood_down", kind: "ambulance", side: -2.4, siren: false, age: 30, v0: 8,
    driver: { aMax: 2, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 },
    stopMem: new StopMemory(), frozen: 0, waiting: 0, path: new NpcPath(world.map, () => 0.5),
  });
  ambulance.path.start("street", 0, 100); fleet.vehicles.push(ambulance);
  let touched = false, passed = false;
  for (let k = 0; k < 30 * 60 && ambulance.x < 180; k++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    touched ||= obbOverlap(ambulance.obb(), world.ego.obb(), 0.05);
    passed ||= ambulance.x - ambulance.spec.rearOverhang > world.ego.x + world.ego.spec.length - world.ego.spec.rearOverhang;
  }
  assert.equal(touched, false, `${weather}: the merging body clears the stopped car`);
  assert.equal(passed, true, `${weather}: clears the car along the available passing line`);
  assert.equal(Math.abs(ambulance.y) < 0.1, true, `${weather}: rejoins the ordinary lane`);
  assert.equal(ambulance.evRejoin, null);
}
{
  // If the held line is occupied too, wait for that obstruction rather than
  // forcing a merge into the adjacent car. Removing it restores progress.
  const world = fixtureWorld(); world.followingDistance = true;
  Object.assign(world.ego, { x: 108, y: 0, psi: 0, v: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPull = fleet.nextPark = Infinity;
  const ambulance = Object.assign(new Vehicle(100, 2.4, 0, 0, AMBULANCE), {
    id: "blocked", kind: "ambulance", siren: false, age: 30, v0: 8,
    driver: { aMax: 2, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 },
    stopMem: new StopMemory(), frozen: 0, waiting: 0, path: new NpcPath(world.map, () => 0.5),
  });
  ambulance.path.start("street", 0, 100); fleet.vehicles.push(ambulance);
  const blocker = new Vehicle(116, 2.4, 0, 0); world.parked.add(blocker);
  let touched = false;
  for (let k = 0; k < 24 * 60; k++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    touched ||= [world.ego, blocker].some(o => obbOverlap(ambulance.obb(), o.obb(), 0.05));
  }
  assert.equal(touched, false);
  assert.equal(ambulance.v < 0.1, true, "an occupied passing line still requires a stop");
  world.parked.remove(blocker);
  for (let k = 0; k < 25 * 60 && ambulance.x < 180; k++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    touched ||= obbOverlap(ambulance.obb(), world.ego.obb(), 0.05);
  }
  assert.equal(touched, false);
  assert.equal(ambulance.x > 150, true, "resumes when the passing line opens");
}
console.log("Stood-down ambulances pass an adjacent car safely before rejoining their lane");
process.exit(0);
