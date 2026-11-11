// Braking hard while nudged a metre off the lane's centre to keep clear of something beside it, the car
// brakes on the line it is on (to the nearest half metre), as it already did with scenery in the lane:
// steering back to the centre while braking swings its nose into what it was keeping clear of. In
// Kitsilano's city s1-5 the car, passing a fire truck backing out of a stand-off half in its lane, did
// exactly that and touched the truck. Near the centre, the hard brake aims at the centre as before.
// node --experimental-default-type=module scripts/test_hard_brake_line.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { Vehicle, FIRE_TRUCK } = await import("../static/js/sim/vehicle.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");

function rig(lateral, { truck = false } = {}) {
  // a two-way street, one lane each way: the car's lane centre 1.75 m right of the centreline
  const street = { id: "street", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300, cls: "residential", lanes: 1,
    lane_offsets: [1.75], lane_width: 3.5, asphalt: [-5.6, 5.6], parking: [0, 0], limit: 13.9 };
  const map = new MapData({ extent: [-10, -20, 310, 20], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }],
    edges: [street], lanes: [{ edge: "street", idx: 0, pts: [[0, -1.75], [300, -1.75]] }], intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: 100, y: -1.75 - lateral, psi: 0, v: 7 });
  world.route = new Route({ id: "straight", polyline: [[0, -1.75], [300, -1.75]], edges: ["street"], turns: [] }, map);
  if (truck) {
    // a fire truck backing slowly the car's way, its body across the centreline into the car's lane,
    // alongside the car's nose
    const t = new Vehicle(100 + 6 + (FIRE_TRUCK?.length ?? 9) / 2, 0.45, Math.PI, -1.2, FIRE_TRUCK);
    t.id = "fire_truck_1"; t.kind = "fire_truck";
    world.npcs.push(t);
  }
  const snap = buildSnapshot(world);
  return { world, snap, brake: sampleCandidates(snap, world).find((c) => c.id === "hard_brake") };
}

assert.equal(rig(0).brake.law.offset, 0, "on the centre: brake on the centre");
assert.equal(rig(0.5).brake.law.offset, 0, "half a metre over: still the centre");
assert.equal(rig(1.1).brake.law.offset, 1, "a metre right of the centre: brake on that line");
assert.equal(rig(-0.9).brake.law.offset, -1, "and a metre left");
// Beside the truck: the hard brake on its line keeps clear; steering back to the centre would not.
const { world, snap, brake } = rig(1.1, { truck: true });
const back = { id: "back_to_centre", law: { ...brake.law, offset: 0 } };
simulateAll([brake, back], snap, world);
assert.equal(brake.sim.collision, null, "braking on its line misses the truck");
assert.notEqual(back.sim.collision, null, "steering back to the centre while braking would hit it");
console.log("A hard brake well off the lane's centre keeps to its line");
process.exit(0);
