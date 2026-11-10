// City s1-11: a collection truck's following policy held it behind a kerbside car
// just inside its normal clearance. It must ease left within its lane, or wait if
// the lane leaves insufficient room; never relax the clearance or cross a line.
// node --experimental-default-type=module scripts/test_collection_clearance.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const edge = { id: "street", from: "a", to: "b", pts: [[0, 0], [400, 0]], length: 400,
  lanes: 1, lane_width: 3.2, lane_offsets: [0], asphalt: [-1.6, 3.7], parking: [0, 2.1],
  cls: "residential", limit: 11.1, oneway: true, name: "Curb Street" };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -50, 420, 50], edges: [edge],
  lanes: [{ edge: edge.id, idx: 0, pts: edge.pts }], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 400, y: 0 }],
  intersections: [], stops: [], buildings: [] });

function drive(parkedLateral) {
  const world = new World(map, { parked: 0, pedestrians: 0, followingDistance: true });
  Object.assign(world.ego, { x: -1000, y: -1000 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  fleet.nextPull = fleet.nextPark = Infinity;
  const truck = fleet.collection.add(map.lane(edge.id, 0), 70, 4);
  truck.collect.every = Infinity;
  const parked = Object.assign(new Vehicle(100, -parkedLateral, 0, 0), { id: "parked", edge: edge.id, curb: "right" });
  world.parked.add(parked);
  let touched = false, maxLeft = 0, minClearance = Infinity;
  for (let k = 0; k < 30 * 60 && truck.x < 140; k++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    touched ||= obbOverlap(truck.obb(), parked.obb(), 0);
    maxLeft = Math.max(maxLeft, truck.y);
    if (Math.abs(truck.x - parked.x) < 4) minClearance = Math.min(minClearance, parkedLateral + truck.y - (truck.spec.width + parked.spec.width) / 2);
  }
  return { x: truck.x, v: truck.v, touched, maxLeft, minClearance };
}
const passed = drive(2.49);
assert.ok(passed.x > 135, `the truck carried on: x=${passed.x}`);
assert.equal(passed.touched, false);
assert.ok(passed.maxLeft > 0.01 && passed.maxLeft < 0.25, `eased left inside its lane: ${passed.maxLeft}`);
assert.ok(passed.minClearance >= 0.3, `kept the traffic clearance: ${passed.minClearance}`);
console.log("✓ a wide collection truck eases left within its lane past a car parked just inside its clearance");
const blocked = drive(1.8);
assert.ok(blocked.x < 95 && blocked.v < 0.1, `waited where there is no room: x=${blocked.x}, v=${blocked.v}`);
assert.equal(blocked.touched, false);
assert.equal(blocked.maxLeft, 0, "does not move into the opposing lane to squeeze past");
console.log("✓ the truck still waits when passing would require leaving its lane");
process.exit(0);
