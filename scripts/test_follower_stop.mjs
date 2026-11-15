// A vehicle following the car in its lane (a tailgater just outside the one test, sim/tailgaters.js, say)
// is predicted to go on at its speed, so it runs into any stop the car makes in the forward sims. Where
// the car must stop at a line ahead, that is the follower's to avoid: it never makes stopping, or slowing
// short of the line, unsafe. In Kitsilano city rain s1-12, a car closing from behind at 0.95 s rejected
// every way of stopping for a stop sign on Vine Street as a rear-end collision, and the car fell back
// to a hard brake with it close behind (`brake_checks`). Without a line to stop at, braking in front of
// a follower is still a collision, as before; and so is any manoeuvre that runs the sign.
// node --experimental-default-type=module scripts/test_follower_stop.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");

const LINE = 130;
function rig({ sign }) {
  // a two-way street, one lane each way, the car's lane centre 1.75 m right of the centreline; with
  // `sign`, a stop sign at LINE (no junction beyond it)
  const street = { id: "street", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300, cls: "residential", lanes: 1,
    lane_offsets: [1.75], lane_width: 3.5, asphalt: [-5.6, 5.6], parking: [0, 0], limit: 11.1,
    ...(sign ? { control: { type: "stop", id: "stop_1", s_line: LINE, all_way: false } } : {}) };
  const map = new MapData({ extent: [-10, -20, 310, 20], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }],
    edges: [street], lanes: [{ edge: "street", idx: 0, pts: [[0, -1.75], [300, -1.75]] }], intersections: [],
    stops: sign ? [{ id: "stop_1", edge: "street", s_line: LINE, all_way: false }] : [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  // the car at 6.5 m/s, its front bumper 20 m short of the line
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  Object.assign(world.ego, { x: LINE - 20 - front, y: -1.75, psi: 0, v: 6.5 });
  world.route = new Route({ id: "straight", polyline: [[0, -1.75], [300, -1.75]], edges: ["street"], turns: [] }, map);
  // a car closing from behind in its lane, 5 m back at 8.5 m/s (tailgaters off: nothing leaves it out of
  // the forward sims as a tailgater)
  const f = new Vehicle(0, -1.75, 0, 8.5);
  f.x = world.ego.x - world.ego.spec.rearOverhang - 5 - (f.spec.length - f.spec.rearOverhang);
  f.id = "car_behind"; f.kind = "car";
  world.npcs.push(f);
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  const by = (id) => candidates.find((c) => c.id === id);
  return { snap, by, ids: candidates.map((c) => c.id) };
}

{
  const { snap, by } = rig({ sign: true });
  assert.equal(snap.tailgater ?? null, null, "no tailgater is sensed");
  assert.equal(snap.intersection?.control, "stop", "a stop sign ahead");
  const stop = by("stop_at_line");
  assert.ok(stop, "stopping at the line is on offer");
  assert.equal(stop.sim.collision, null, "the follower running into the stop is not the car's collision");
  assert.equal(stop.reject ?? null, null, "stopping at the line is eligible");
  // (the stop in the lane, short of the line, likewise)
  const inLane = by("keep_lane_stop");
  assert.ok(inLane, "stopping in the lane is on offer");
  assert.equal(inLane.sim.collision, null, "stopping in the lane short of the line: no collision either");
  assert.equal(inLane.sim.crosses_stop_line, false, "and it stops short of the line");
}
{
  // no sign: braking to a stop in front of the follower is still a rear-end collision
  const { by } = rig({ sign: false });
  const inLane = by("keep_lane_stop");
  assert.ok(inLane, "stopping in the lane is on offer");
  assert.equal(inLane.sim.collision?.id, "car_behind", "with nothing to stop for, the follower still counts");
  assert.equal(inLane.reject, "collision", "and the stop is rejected");
}
console.log("A follower never makes a stop the car must make unsafe; braking for nothing in front of it still is");
process.exit(0);
