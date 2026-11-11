// The paved fill of a junction (map/junctions.js, drawn by render/roads.js) is road for the driving
// checks: the forward simulations' off-road rejection and the off-road audit. Where Toronto's Spadina
// Crescent turns right into the wide Spadina Avenue, the route through the corner crossed fill that is
// drawn as asphalt but lies outside both streets' strips: every candidate was rejected as off road, the
// car stopped short of the turn, and the deadlock creep then counted 1.6 s off road (city smoke s1-2).
// Beyond the fill (the outside of a corner), it is still off the road; scenery keeps to roadDistance.
// node --experimental-default-type=module scripts/test_junction_fill.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { junctionFills, onJunctionFill, surfaceDistance } = await import("../static/js/map/junctions.js");

const toronto = new MapData(JSON.parse(fs.readFileSync("data/maps/4a96d42cb3f2.v6.pack.json")));
assert.ok(junctionFills(toronto).length > 100, "Toronto's junctions have fills");
const corner = [-31.9, 79.9];   // on the route from the crescent into the avenue's curb lane
assert.ok(toronto.roadDistance(...corner).distance > 0.7, "outside both streets' strips");
assert.equal(onJunctionFill(toronto, ...corner), true, "inside the junction's fill");
assert.equal(surfaceDistance(toronto, ...corner).distance, 0, "so on the road for driving");

// An L-shaped corner: the fill covers the inside of the bend, not the outside corner.
const W = 3.5;
const east = { id: "east", from: "n", to: "e", pts: [[0, 0], [60, 0]], length: 60, cls: "residential", lanes: 1, lane_offsets: [1.75], lane_width: 3.5, asphalt: [-W, W], parking: [0, 0], limit: 13.9 };
const north = { ...east, id: "north", to: "m", pts: [[0, 0], [0, 60]] };
const bend = new MapData({ extent: [-10, -10, 70, 70], nodes: [{ id: "n", x: 0, y: 0 }, { id: "e", x: 60, y: 0 }, { id: "m", x: 0, y: 60 }],
  edges: [east, north], lanes: [east, north].map((e) => ({ edge: e.id, idx: 0, pts: e.pts })), intersections: [], stops: [], buildings: [] });
assert.equal(junctionFills(bend).length, 1);
assert.equal(onJunctionFill(bend, 2, 2), true, "the inside of the bend is paved");
assert.equal(onJunctionFill(bend, -3, -3), false, "the outside corner is not");
assert.ok(surfaceDistance(bend, -3, -3).distance > 0, "and is off the road");
assert.ok(surfaceDistance(bend, 30, 8).distance > 0, "away from the junction nothing changes");
console.log("Junction fills count as road for the driving checks");
process.exit(0);
