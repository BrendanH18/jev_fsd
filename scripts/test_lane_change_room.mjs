// Two lanes from the route's lane before a turn, the car's first lane change leaves room for the
// second: it shares the room before its lane ends with the changes still to come. Planned at the full
// 50 m of a change at 50 km/h, the first left too little for the second in Winnipeg's city smoke s1-1
// (after a road-closure detour); the car slowed mid-change, stopped short of finishing it, and needed
// four deadlock recoveries. One lane away, a change is planned as before.
// node --experimental-default-type=module scripts/test_lane_change_room.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { laneChangeLength } = await import("../static/js/sim/controller.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");

// A one-way street with three lanes, then a left turn onto a one-lane street.
const offsets = [-3.5, 0, 3.5];
const main = { id: "main", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300, cls: "secondary", lanes: 3, oneway: true,
  lane_offsets: offsets, lane_width: 3.5, asphalt: [-5.25, 5.25], parking: [0, 0], limit: 13.9 };
const side = { id: "side", from: "b", to: "c", pts: [[300, 0], [300, 150]], length: 150, cls: "residential", lanes: 1, oneway: true,
  lane_offsets: [0], lane_width: 3.5, asphalt: [-1.75, 1.75], parking: [0, 0], limit: 13.9 };
const map = new MapData({ extent: [-10, -20, 320, 160], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }, { id: "c", x: 300, y: 150 }],
  edges: [main, side], lanes: [...offsets.map((o, k) => ({ edge: "main", idx: k, pts: [[0, -o], [300, -o]] })), { edge: "side", idx: 0, pts: [[300, 0], [300, 150]] }],
  intersections: [], stops: [], buildings: [] });
assert.equal(map.classifyTurn(map.turnAngle("main", "side")), "left");

function change(lane, toEnd, v = 14) {
  const world = new World(map, { parked: 0, pedestrians: 0 });
  // (the router's lane before a left turn: the leftmost)
  world.route = new Route(routeFromLanes(map, [map.lane("main", 0), map.lane("side", 0)], 5, 100), map, world.ego.spec);
  world.placeOnLane(map.lane("main", lane), 300 - toEnd); world.ego.v = v;
  const snap = buildSnapshot(world);
  const c = sampleCandidates(snap, world).find((c) => c.id.startsWith("change_left"));
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  return { delta: snap.lane.delta, len: c?.law.shift.len ?? null, leaving: snap.lane.until_s - snap.routeProj.s - front };
}

const two = change(2, 75);
assert.equal(two.delta, 2, "two lanes right of the route's lane");
assert.ok(two.len !== null, "a change left is on offer");
assert.ok(two.len <= two.leaving / 2 + 1e-6, `the first of two changes takes at most half the room left (${two.len.toFixed(1)} of ${two.leaving.toFixed(1)} m)`);
assert.ok(two.len < laneChangeLength(14), "shorter than an unhurried change at 50 km/h");
// (with room for both at their usual length, it keeps its usual length)
assert.ok(Math.abs(change(2, 200).len - laneChangeLength(14)) < 1e-6);
const one = change(1, 75);
assert.equal(one.delta, 1);
assert.ok(Math.abs(one.len - Math.min(laneChangeLength(14), one.leaving)) < 1e-6, "one lane away: as before");
console.log("A lane change that leaves the car a lane from its route leaves room for the next");
process.exit(0);
