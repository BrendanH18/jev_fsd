// Scenery in the car's lane during a detour (brain/candidates.js): with scenery standing in the lane
// ahead, the stops and the hard brake keep to the line the car is on (to the nearest half metre)
// rather than steering back to the lane's centre. `lane.lateral` already includes a detour's move
// (round a work zone, a double-parked van, a pothole...), and every such law carries the detour as
// well, so rounding `lane.lateral` counted the move twice: a car a metre left round a work zone
// braked toward two metres left. The line is now taken less the move of the detour the law carries.
// node --experimental-default-type=module scripts/test_detour_scenery_line.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");
const { lateralAt } = await import("../static/js/sim/controller.js");

// `lateral`: the car's offset right of its lane's centre; `shift`: the detour's move (metres right),
// all of it in effect where the car is; `scenery`: whether something stands in the lane ahead.
function rig(lateral, shift, { scenery = true, line = false } = {}) {
  // a two-way street with two lanes each way: the car's lane centre 1.75 m right of the centreline
  const street = { id: "street", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300, cls: "secondary", lanes: 2,
    lane_offsets: [1.75, 5.25], lane_width: 3.5, asphalt: [-7, 7], parking: [0, 0], limit: 13.9 };
  const map = new MapData({ extent: [-10, -20, 310, 20], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }],
    edges: [street], lanes: [{ edge: "street", idx: 0, pts: [[0, -1.75], [300, -1.75]] }, { edge: "street", idx: 1, pts: [[0, -5.25], [300, -5.25]] }],
    intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: 100, y: -1.75 - lateral, psi: 0, v: 7 });
  world.route = new Route({ id: "straight", polyline: [[0, -1.75], [300, -1.75]], edges: ["street"], turns: [] }, map);
  // (a building's corner over the lane ahead, as far as the candidates can tell)
  if (scenery) world.staticObstacles.touching = () => ({ id: "corner" });
  const snap = buildSnapshot(world);
  snap.work_zone = { detour: { id: "wz:test", from: 40, full: 70, back: 200, to: 230, shift } };
  // (and a stop line ahead, for the stops that keep to the line too)
  if (line) snap.intersection = { bumper_to_line_m: 30, s_line_route: snap.routeProj.s + 33 };
  const list = sampleCandidates(snap, world);
  // Where each law steers the car now, metres right of the route's lane centre.
  const aim = (id) => {
    const c = list.find((k) => k.id === id);
    return c ? Math.round(lateralAt({ ...c.law, s0: snap.routeProj.s }, snap.routeProj.s, world.route) * 100) / 100 : null;
  };
  return { brake: aim("hard_brake"), stop: aim("stop_at_line"), laneLateral: Math.round(snap.lane.lateral * 100) / 100 };
}

// A metre left round a work zone, right on its detour line: brake and stop on that line, not a metre
// further left.
const round = rig(-1, -1, { line: true });
assert.equal(round.laneLateral, -1, "the car's offset from its lane centre includes the detour's move");
assert.equal(round.brake, -1, `the hard brake keeps to the detour's line (aims at ${round.brake})`);
assert.equal(round.stop, -1, `the stop at the line keeps to it too (aims at ${round.stop})`);
// Half a metre left of the detour line: to the nearest half metre of where it is, round the detour.
const beyond = rig(-1.5, -1);
assert.equal(beyond.brake, -1.5, `half a metre off the detour's line, it brakes there (aims at ${beyond.brake})`);
// Without a detour, as before: scenery in the lane keeps the line the car is on.
assert.equal(rig(-1, 0).brake, -1, "no detour: the line it is on");
assert.equal(rig(0.4, 0).brake, 0.5, "to the nearest half metre");
// Without scenery the hard brake during a detour follows the detour, as before.
assert.equal(rig(-1, -1, { scenery: false }).brake, -1, "no scenery: the detour's line");
console.log("With scenery in the lane during a detour, stops and the hard brake count the detour's move once");
process.exit(0);
