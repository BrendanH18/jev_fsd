// A pothole shift must leave room beside parked cars. City s1-4 queued behind a car
// that shifted toward the kerb, then treated a parked car as an immovable leader.
// node --experimental-default-type=module scripts/test_pothole_traffic_clearance.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { npcPothole, potholeOnLane, safeSpeed, wheelPoints, inPothole } = await import("../static/js/sim/potholes.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const edge = { id: "street", from: "a", to: "b", pts: [[0, 0], [400, 0]], length: 400,
  lanes: 1, lane_width: 3.2, lane_offsets: [0], asphalt: [-1.6, 3.7], parking: [0, 2.1],
  cls: "residential", limit: 11.1, oneway: true, name: "Curb Street" };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -50, 420, 50], edges: [edge],
  lanes: [{ edge: edge.id, idx: 0, pts: edge.pts }], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 400, y: 0 }],
  intersections: [], stops: [], buildings: [] });
const world = new World(map, { parked: 0, pedestrians: 0, potholes: true, followingDistance: true });
Object.assign(world.ego, { x: -1000, y: -1000 });
const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
fleet.nextPull = fleet.nextPark = Infinity;
const car = Object.assign(new Vehicle(80, 0, 0, 4), { id: "traffic", v0: 10,
  driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 },
  stopMem: new StopMemory(), frozen: 0, waiting: 0 });
car.path = new NpcPath(map, fleet.random); car.path.start(edge.id, 0, 80); fleet.vehicles.push(car);
const hole = potholeOnLane(map, edge.id, 0, 110, { id: "hole", offset: -0.95, b: 0.3, depth: 0.07 });
world.potholes.setList([hole]);
assert.ok(npcPothole(world, car, 83.6).shift > 0.3, "with room, ease right round the hole");
const parked = Object.assign(new Vehicle(100, -2.55, 0, 0), { id: "parked", edge: edge.id, curb: "right" });
world.parked.add(parked);
const plan = npcPothole(world, car, 83.6);
assert.equal(plan.shift, 0, "with that way occupied, stay in the lane centre");
assert.ok(Number.isFinite(plan.limit), "plan to slow over the hole");
let touched = false, crossed = false, crossingSpeed = 0;
for (let k = 0; k < 30 * 60 && car.x < 145; k++) {
  fleet.step(1 / 60); world.t += 1 / 60;
  touched ||= obbOverlap(car.obb(), parked.obb(), 0);
  if (wheelPoints(car).some(([x, y]) => inPothole(hole, x, y))) { crossed = true; crossingSpeed = Math.max(crossingSpeed, car.v); }
}
assert.ok(car.x > 140, `traffic carried on past the parked car and hole: x=${car.x}`);
assert.equal(touched, false);
assert.equal(crossed, true, "took the hole slowly instead of squeezing toward the parked car");
assert.ok(crossingSpeed <= safeSpeed(hole) + 0.5, `crossed at ${crossingSpeed} m/s`);
console.log("✓ traffic slows over a pothole when easing round it would block it behind a parked car");
process.exit(0);
