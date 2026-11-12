// A U-turn is where the route's own polyline turns. The server gives a turn's place in summed edge
// lengths, which drift from the polyline (its corners are rounded) by metres over a long route: on
// Victoria's Menzies Street (city seed 2 s2-2) the dead end's U-turn was given 15 m past where the polyline
// turns round, so the turnaround (offered within 12 m of it, stopping 9 m short of it) never came: the car
// drove into the polyline's tight hairpin, every candidate was rejected as off road, and it stood there
// until the drive timed out. The route places a U-turn on its polyline, where it passes the dead end's
// node, and the car stops and turns round as it does without the drift.
// node --experimental-default-type=module scripts/test_turnaround_drift.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { turnaroundStopS } = await import("../static/js/sim/turnaround.js");

// test_turnaround.mjs's dead end: a two-way street from x = 0 to its dead end at x = 60, in along
// y = -1.6 and back out along y = +1.6.
const END = 60, LANE = 1.6, DRIFT = 15, GOAL_X = 15;
const street = { lanes: 1, lane_width: 3.2, width: 6.4, lane_offsets: [LANE], asphalt: [-3.2, 3.2], parking: [0, 0], cls: "residential", limit: 11.2, oneway: false, name: "Dead End" };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -40, END + 20, 40],
  edges: [{ id: "in", from: "a", to: "b", pts: [[0, 0], [END, 0]], length: END, ...street }, { id: "out", from: "b", to: "a", pts: [[END, 0], [0, 0]], length: END, ...street }],
  lanes: [{ edge: "in", idx: 0, pts: [[0, -LANE], [END, -LANE]] }, { edge: "out", idx: 0, pts: [[END, LANE], [0, LANE]] }],
  nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: END, y: 0 }], intersections: [], stops: [], buildings: [] });
const polyline = [];
for (let x = 0; x <= END; x++) polyline.push([x, -LANE]);
for (let x = END; x >= GOAL_X; x--) polyline.push([x, LANE]);
// (the U-turn given DRIFT metres past where the polyline turns, as summed edge lengths put it after
// rounded corners earlier on a long route; another turn stays as it was given)
const data = { id: "r", polyline, edges: ["in", "out"], start_s: 0, goal_s: END - GOAL_X,
  turns: [{ at_m: 20, dir: "right", street: "Dead End" }, { at_m: END + DRIFT, dir: "uturn", street: "Dead End" }] };

{
  const route = new Route(data, map);
  const uturn = route.turns.find((t) => t.dir === "uturn");
  assert.ok(Math.abs(uturn.at_m - END) < LANE + 0.1, `the U-turn is where the polyline turns round (${uturn.at_m.toFixed(1)} m)`);
  assert.equal(route.turns[0].at_m, 20, "other turns are as the router gave them");
  assert.equal(data.turns[1].at_m, END + DRIFT, "the route data is left as it was");
  assert.ok(turnaroundStopS(route, uturn) < END - 6, "the car stops to turn round well short of the dead end");
}
{
  // closed loop: Rules drives up to the dead end, turns round and drives back to its destination
  const world = new World(map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: 20, y: -LANE, psi: 0, v: 5, delta: 0 });
  world.route = new Route(data, map);
  world.destination = [GOAL_X, LANE];
  world._road = world.roadInfo();
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const dt = 1 / 30;
  let turned = false;
  for (let i = 0; i < 90 / dt && world.route; i++) {
    stepWorld({ world, fleet: { step() {} }, autopilot }, dt, world.t * 1000);
    if (world.turnaround) turned = true;
  }
  assert.ok(turned, "the car turns round");
  assert.ok(world.route === null, `arrived (car at ${world.ego.x.toFixed(1)}, ${world.ego.y.toFixed(1)})`);
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.deadlock_overrides, 0);
  assert.equal(world.violations.off_road_s, 0);
}
console.log("A U-turn given past where the route's polyline turns is turned at the polyline's turn");
process.exit(0);
