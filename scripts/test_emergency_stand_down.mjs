// A stood-down emergency vehicle returns to its lane and ordinary driving, with its age advancing.
// node --experimental-default-type=module scripts/test_emergency_stand_down.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, FIRE_TRUCK } = await import("../static/js/sim/vehicle.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { EV_STAND_DOWN_S } = await import("../static/js/sim/emergency.js");
const edge = { id: "main", from: "a", to: "b", pts: [[0, 0], [400, 0]], length: 400, lanes: 1,
  lane_width: 3.5, lane_offsets: [0], asphalt: [-5, 5], parking: [0, 0], cls: "residential", limit: 11, oneway: true };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -40, 420, 40], edges: [edge],
  lanes: [{ edge: edge.id, idx: 0, pts: edge.pts }], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 400, y: 0 }],
  intersections: [], stops: [], buildings: [] });
for (const weather of ["dry", "rain", "snow"]) {
  const world = new World(map, { parked: 0, pedestrians: 0, weather, followingDistance: true });
  Object.assign(world.ego, { x: 200, y: -40 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPull = fleet.nextPark = Infinity;
  const n = Object.assign(new Vehicle(100, 2.35, 0, 0, FIRE_TRUCK), { id: "stood_down", kind: "fire_truck", side: -2.35,
    siren: true, age: 10, stuck: EV_STAND_DOWN_S + 0.1, v0: 16.7, blockedFor: 0, frozen: 0, waiting: 0, stopMem: new StopMemory(),
    driver: { aMax: 1.53, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 }, path: new NpcPath(map, () => 0.5) });
  n.path.start("main", 0, 100); fleet.vehicles.push(n);
  fleet.step(1 / 60); world.t += 1 / 60;
  assert.equal(n.siren, false, `${weather}: stands down after waiting`);
  const age = n.age;
  for (let k = 0; k < 18 * 60; k++) { fleet.step(1 / 60); world.t += 1 / 60; }
  assert.equal(Math.abs(n.y) < 0.1, true, `${weather}: returns to the traffic lane: ${n.y}`);
  assert.equal(n.x > 120, true, `${weather}: carries on`);
  assert.equal(n.age > age + 17, true, `${weather}: still ages toward retirement`);
  // Losing the siren also loses emergency exemptions from buses, school buses and streetcars.
  const far = Object.assign(new Vehicle(900, 900, 0, 0), { transit: { phase: "drive" } });
  fleet.buses = [far]; fleet.schoolBuses = [far]; fleet.streetcars = [far];
  fleet.manageBuses = fleet.manageSchoolBuses = () => {};
  const called = [];
  for (const method of ["yieldToBus", "yieldToSchoolBus", "yieldToStreetcar"]) fleet[method] = () => { called.push(method); return 30; };
  fleet.step(1 / 60);
  assert.equal(called.includes("yieldToBus"), true);
  assert.equal(called.includes("yieldToSchoolBus"), true);
  assert.equal(called.includes("yieldToStreetcar"), true);
}
console.log("Stood-down emergency vehicles resume ordinary lane driving and continue aging");
process.exit(0);
