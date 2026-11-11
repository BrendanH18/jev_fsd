// Ordinary cars need the same real-body forecast as long traffic at a corner.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { kitsilano } = await import("./progress_helpers.mjs");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const map = kitsilano();
for (const weather of ["rain", "snow"]) {
  const world = new World(map, { parked: 0, pedestrians: 0, weather, followingDistance: true });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPark = fleet.nextPull = Infinity;
  const rain = weather === "rain";
  Object.assign(world.ego, rain ? { x: -341.76, y: -103.01, psi: -1.59, v: 0 } : { x: -176.57, y: -114.48, psi: -1.01, v: 0 });
  const car = Object.assign(rain ? new Vehicle(-338.46, -119.04, 1.52, 4.44) : new Vehicle(-174.05, -128.23, 1.55, 0), {
    id: "turning", v0: 8.3, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0,
  });
  const edge = rain ? "e349" : "e447";
  const next = map.successors(edge).find(id => map.classifyTurn(map.turnAngle(edge, id)) === (rain ? "left" : "straight"));
  car.path = new NpcPath(map, () => 0.5); car.path.start(edge, 0, rain ? 90.63 : 90.76, [[next, 0]]);
  fleet.vehicles.push(car); world.t = rain ? 158 : 364;
  let hit = false;
  for (let k = 0; k < 12 * 60; k++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    hit ||= obbOverlap(car.obb(), world.ego.obb());
  }
  assert.equal(hit, false, `${weather}: the real nose stays clear of the stopped car outside the axle corridor`);
}
console.log("✓ ordinary traffic forecasts its real body at rain and snow junctions");
process.exit(0);
