// Long traffic vehicles must check their actual body's swept path far enough ahead to stop.
// node --experimental-default-type=module scripts/test_traffic_body_sweep.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, FIRE_TRUCK } = await import("../static/js/sim/vehicle.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");

const edge = { id: "main", from: "a", to: "b", pts: [[0, 0], [400, 0]], length: 400, lanes: 1,
  lane_width: 3.5, lane_offsets: [0], asphalt: [-5, 5], parking: [0, 0], cls: "residential", limit: 14, oneway: true };
function mapFor(turn) {
  const first = turn ? { ...edge, pts: [[0, 0], [100, 0]], length: 100 } : edge;
  const edges = turn ? [first, { ...first, id: "next", from: "b", to: "c", pts: [[100, 0], [100, -100]] }] : [first];
  return new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -120, 420, 60], edges,
    lanes: edges.map((e) => ({ edge: e.id, idx: 0, pts: e.pts })),
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: turn ? 100 : 400, y: 0 }, { id: "c", x: 100, y: -100 }],
    intersections: [], stops: [], buildings: [] });
}
function context(weather, turn = false) {
  const map = mapFor(turn), world = new World(map, { parked: 0, pedestrians: 0, weather });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 4 });
  fleet.nextPull = fleet.nextPark = Infinity;
  return { map, world, fleet };
}
function staysClear(world, fleet, vehicle) {
  let touched = false;
  for (let k = 0; k < 12 * 60; k++) {
    fleet.step(1 / 60);
    world.t += 1 / 60;
    touched ||= obbOverlap(vehicle.obb(), world.ego.obb());
  }
  return !touched;
}

function addFireTruck(world, fleet, { y = 2.5, psi = -0.05 } = {}) {
  const truck = new Vehicle(100, y, psi, 3, FIRE_TRUCK);
  Object.assign(truck, { id: "fire", kind: "fire_truck", side: -2.35, siren: true, age: 0, v0: 16.7, blockedFor: 0,
    driver: { aMax: 1.53, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 } });
  truck.path = new NpcPath(world.map, () => 0.5);
  truck.path.start("main", 0, 100);
  fleet.vehicles.push(truck);
  return truck;
}

{
  // Fog s1-7: the car's axle is outside the leader band; its angled nose occupies the bus's lane.
  const { map, world, fleet } = context("fog");
  Object.assign(world.ego, { x: 139.4085, y: 3.3569, psi: -152 * Math.PI / 180, v: 0 });
  const bus = fleet.addSchoolBus(map.lane("main", 0), 100, 8.2);
  bus.school.every = Infinity;
  assert.equal(staysClear(world, fleet, bus), true, "bus brakes for the angled car's body before six metres is too late");
}
{
  // Snow s1-7: the rear axle follows the corner while the long front swings outside the lane.
  const { map, world, fleet } = context("snow", true);
  Object.assign(world.ego, { x: 106, y: -8, psi: Math.PI / 2, v: 0 });
  const bus = fleet.addSchoolBus(map.lane("main", 0), 70, 3.4);
  bus.school.every = Infinity;
  assert.equal(staysClear(world, fleet, bus), true, "turning bus keeps its real front clear of a car outside its lane");
}
{
  // Rain s1-7: the fire truck's desired offset clears the car, but its real nose still points into it.
  const { world, fleet } = context("rain");
  Object.assign(world.ego, { x: 110, y: 0, psi: 0, v: 0 });
  const truck = addFireTruck(world, fleet);
  assert.equal(staysClear(world, fleet, truck), true, "fire truck checks its actual motion while squeezing past");
}
{
  // No lateral gap: do not fall back to the preferred road position through the driven car.
  const { world, fleet } = context("rain");
  Object.assign(world.ego, { x: 110, y: 0, psi: 0, v: 0 });
  const truck = addFireTruck(world, fleet, { y: 2.35, psi: -0.01 });
  world.parked.add(new Vehicle(112, 4.5, 0, 0));
  fleet.step(1 / 60);
  assert.equal(truck.side, -2.35, "no safe gap: hold the current line instead of steering toward the ego");
  assert.equal(staysClear(world, fleet, truck), true, "wait safely where the fire truck cannot squeeze past");
  assert.equal(!!truck.blockedBy?.includes(world.ego), true, "the obstructing driver is still asked to drive on ahead");
}
console.log("Long traffic bodies keep clear while approaching, turning and squeezing past");
process.exit(0);
