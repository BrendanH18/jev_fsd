// A right turn into a street ends in its curb lane (BC MVA s. 165), and where that lane is reserved the
// car moves out at once: the lane change out is not driving in the bus lane. Mount Pleasant's city smoke
// s1-2 turned right onto Main Street (curb lane reserved all day), 75 m before its next right turn, and
// was failed for the 23 m it took to move over. Staying in the lane longer than a lane change, or being
// in it on a block the car did not turn into, still counts.
// node --experimental-default-type=module scripts/test_bus_lane_turn_in.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { auditBusLanes, routeBusLane } = await import("../static/js/sim/bus-lanes.js");
const { laneChangeLength } = await import("../static/js/sim/controller.js");

const key = "7165f1c807a8";   // Mount Pleasant
const pack = JSON.parse(fs.readFileSync(`data/maps/${key}.v6.pack.json`));
pack.buslanes = JSON.parse(fs.readFileSync(`data/maps/${key}.buslanes.v1.json`));
const map = new MapData(pack);
assert.equal(map.classifyTurn(map.turnAngle("e123", "e452")), "right", "Main Street bends right into e452");
assert.equal(map.buslanes.some((l) => l.edge === "e452" && l.lane === 2 && !l.hours), true, "whose curb lane is reserved all day");

// Metres of bus-lane driving the audit counts for one second at `v`, `s` metres into Main Street (e452).
function audit(chain, s, v) {
  const world = new World(map, { seed: 1, parked: 0, pedestrians: 0, busLanes: true });
  world.setClock({ hour: 15.5, weekday: 0 });
  world.route = new Route(routeFromLanes(map, chain.map(([id, k]) => map.lane(id, k)), 2, 30), map, world.ego.spec);
  world.placeOnLane(map.lane("e452", 2), s); world.ego.v = v;
  auditBusLanes(world, 1);
  return { metres: world.violations.bus_lane_driving || 0, turned: routeBusLane(world.route, world.route.project(world.ego.x, world.ego.y, 0).s, world.clock)?.turned_in_m ?? null };
}
const turned = [["e123", 2], ["e452", 2], ["e704", 0]];
const near = audit(turned, 10, 10);
assert.ok(near.turned !== null && Math.abs(near.turned - 10) < 2, `10 m into the street it turned into (${near.turned})`);
assert.equal(near.metres, 0, "moving out of the curb lane it turned into is not bus-lane driving");
assert.ok(laneChangeLength(5) < 20);
assert.equal(audit(turned, 20, 5).metres, 5, "still in it beyond a lane change's length, it is");
// (the last 50 m before the next right turn is the turn's approach, as before)
assert.equal(audit(turned, 30, 5).metres, 0);
// Starting on Main Street, with no turn into it, the curb lane is out of bounds from the start.
assert.equal(audit([["e452", 2], ["e704", 0]], 10, 10).metres, 10, "a block not turned into gets no allowance");
console.log("Turning right into a reserved curb lane: moving straight out of it is not bus-lane driving");
process.exit(0);
