// Ordinary cars, like buses, must account for their real nose swinging through a turn.
// node --experimental-default-type=module scripts/test_traffic_turn_clearance.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const main = { id: "main", from: "a", to: "b", pts: [[0, 0], [100, 0]], length: 100,
  lanes: 1, lane_width: 3.2, lane_offsets: [0], asphalt: [-5, 5], parking: [0, 0], cls: "residential", limit: 11, oneway: true };
const next = { ...main, id: "next", from: "b", to: "c", pts: [[100, 0], [100, 100]] };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -30, 150, 150], edges: [main, next],
  lanes: [main, next].map(e => ({ edge: e.id, idx: 0, pts: e.pts })),
  nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }, { id: "c", x: 100, y: 100 }], intersections: [], stops: [], buildings: [] });
for (const weather of ["dry", "rain", "snow"]) {
  const world = new World(map, { parked: 0, pedestrians: 0, weather, followingDistance: true });
  Object.assign(world.ego, { x: 104, y: 4, psi: Math.PI, v: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 1 });
  fleet.nextPull = fleet.nextPark = Infinity;
  const car = Object.assign(new Vehicle(70, 0, 0, 4), { id: "turner", v0: 8, frozen: 0, waiting: 0,
    stopMem: new StopMemory(), path: new NpcPath(map, () => 0.5) });
  car.path.start("main", 0, 70); fleet.vehicles.push(car);
  let touched = false;
  for (let k = 0; k < 15 * 60; k++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    touched ||= obbOverlap(car.obb(), world.ego.obb());
  }
  assert.equal(touched, false, `${weather}: turning car leaves the stopped car's body clear`);
  assert.equal(car.v < 0.1, true, `${weather}: waits for the occupied turn`);
  Object.assign(world.ego, { x: -1000, y: -1000 });
  for (let k = 0; k < 30 * 60; k++) { fleet.step(1 / 60); world.t += 1 / 60; }
  assert.equal(car.y > 25, true, `${weather}: resumes once the obstruction clears`);
}
console.log("Ordinary cars stop for their swept bodies on turns in dry, rain and snow");
process.exit(0);
