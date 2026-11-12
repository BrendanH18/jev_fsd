// A vehicle behind the start of a route is behind the car, not alongside it. A route starts where the
// car is, and anything behind it projects onto the route's first point: lane sensing took a car standing
// 51 m back in the lane beside it for one alongside, so the change into the route's lane was never clear,
// every other manoeuvre had to return to that lane, and the car stood still for 12 s until the deadlock
// creep moved it (Kitsilano city seed 3 s3-1, Arbutus Street). Beyond the route's start a vehicle is
// placed along the line the route starts on.
// node --experimental-default-type=module scripts/test_lane_side_route_start.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");

// A one-way street with two lanes, east from x = 0; the route keeps to the right lane (y = -1.75).
const offsets = [-1.75, 1.75];
const main = { id: "main", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300, cls: "secondary", lanes: 2, oneway: true,
  lane_offsets: offsets, lane_width: 3.5, asphalt: [-3.5, 3.5], parking: [0, 0], limit: 13.9 };
const map = new MapData({ extent: [-10, -20, 310, 20], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }],
  edges: [main], lanes: offsets.map((o, k) => ({ edge: "main", idx: k, pts: [[0, -o], [300, -o]] })), intersections: [], stops: [], buildings: [] });

// The car stands in the left lane at x = 100, where its route starts, with a car stopped `back` metres
// behind it (from rear axle to rear axle) in the right lane.
function start(back) {
  const world = new World(map, { parked: 0, pedestrians: 0 });
  world.placeOnLane(map.lane("main", 0), 100);
  world.route = new Route(routeFromLanes(map, [map.lane("main", 1)], 100, 290), map, world.ego.spec);
  world.destination = world.route.endPoint();
  const other = new Vehicle(100 - back, -1.75, 0, 0);
  other.id = "car_behind";
  world.npcs = [other];
  world._road = world.roadInfo();
  const snap = buildSnapshot(world);
  return { world, snap, right: snap.lane.sides.right };
}

{
  const { world, snap, right } = start(51);
  assert.equal(snap.lane.delta, -1, "a lane left of the route's lane");
  assert.equal(right.alongside, false, "51 m behind is not alongside");
  assert.equal(right.rear?.id, "car_behind", "it is the car behind in that lane");
  assert.ok(right.rear.gap_m > 40, `${right.rear.gap_m.toFixed(1)} m back`);
  assert.equal(right.gap_ok, true, "the change into the route's lane is clear");
  const ids = simulateAll(sampleCandidates(snap, world), snap, world).eligible.map((c) => c.id);
  assert.ok(ids.some((id) => id.startsWith("change_right")), `the change right is eligible (${ids.join(", ")})`);
}
{
  const { right } = start(1);
  assert.equal(right.alongside, true, "a car beside it is alongside");
  assert.equal(right.gap_ok, false);
}
{
  const { right } = start(6);
  assert.equal(right.alongside, false);
  assert.equal(right.rear?.id, "car_behind", "just behind, still the car behind");
  assert.equal(right.gap_ok, false, "too close behind to change in front of it");
}
console.log("A vehicle behind the start of the route is behind the car, not alongside it");
process.exit(0);
