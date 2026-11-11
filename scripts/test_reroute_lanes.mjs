// A re-plan replaces the route under a lane manoeuvre that was planned on the old one. Its lanes are
// named by that route's chains and its arc lengths are along it, so on the new route it can name the
// wrong lane: in Winnipeg (city smoke s1-1) the car, in the curb lane of Disraeli Freeway, was taken
// to be two lanes to the left after a road-closure detour, lost sight of the pothole in its real lane
// and hit it at 58 km/h while steering across. The autopilot now drops a lane manoeuvre when its
// route is replaced and decides again at once, as the app does when the driver picks a destination.
// node --experimental-default-type=module scripts/test_reroute_lanes.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { browserRoute } = await import("../static/js/demo/routing.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { setWeather } = await import("../static/js/sim/weather.js");

const key = "19bb885c9cae";   // Winnipeg
const map = new MapData(JSON.parse(fs.readFileSync(`data/maps/${key}.v6.pack.json`)));
setWeather("dry");
const pose = (lane, s) => { const p = pointAt(lane.pts, lane.cum, s); return { x: p[0], y: p[1], heading: headingAt(lane.pts, lane.cum, s) }; };
const at = (id, k, f) => { const l = map.lane(id, k); return pose(l, l.length * f); };

function rig() {
  const world = new World(map, { seed: 1, parked: 0, pedestrians: 0 });
  const curb = map.lane("e10", 2);
  world.placeOnLane(curb, 20); world.ego.v = 10;
  // the route the car was on: onto the freeway from a side street, and on along it in the curb lane
  const from = at("e437", 0, 0.3), goal = at("e407", 2, 0.7);
  world.route = new Route(browserRoute(map, from, goal), map, world.ego.spec);
  world.destination = [at("e411", 0, 0.5).x, at("e411", 0, 0.5).y];
  const autopilot = new Autopilot(world, {}); autopilot.setBrain("rules"); autopilot.enabled = true;
  const old = world.route, p = old.project(world.ego.x, world.ego.y), lane = buildSnapshot(world).lane;
  assert.equal(lane.index, 2, "in the curb lane on the old route");
  // (the law the car was executing, as candidates name it: by the old route's chain)
  autopilot.executing = { candidate: { id: "keep_lane_target" }, law: { kind: "lane", offset: lane.center, center: lane.center, lane: lane.delta, laneIdx: lane.index, chain: lane.chain, vTarget: 10, s0: p.s }, s0: p.s };
  autopilot.lastStart = world.t * 1000;
  // A closure the car has seen sends the re-plan round it: without a server, through the browser's router.
  const real = world.roadClosures;
  world.roadClosures = { known: new Set(["seen"]), avoid: () => ["e513"] };
  const replan = async () => { await autopilot.reroute(); world.roadClosures = real; };
  return { world, autopilot, old, law: autopilot.executing.law, replan };
}

{
  const { world, autopilot, old, law, replan } = rig();
  assert.ok(law.chain > 0, "the old route's chain for the freeway is not its first");
  await replan();
  assert.ok(world.route !== old, "re-planned");
  assert.equal(world.route.edges.slice(0, 3).join(","), "e10,e407,e411", "onto Main Street, left from the freeway");
  assert.equal(world.route.laneAt(world.route.project(world.ego.x, world.ego.y, 0).s).idx, 0, "whose lane, ahead of the left turn, is the leftmost");
  assert.equal(autopilot.executing, null, "the old route's lane manoeuvre is dropped");
  assert.equal(autopilot.lastStart, -Infinity, "and the car decides again at once");
  const snap = buildSnapshot(world, autopilot.executing);
  assert.equal(snap.lane.index, 2, "sensing finds the car in the curb lane, where it is");
  assert.equal(snap.lane.delta, 2, "two lanes right of the route's lane");
  // (kept, the old law would have put the car in the route's lane, seven metres to its left)
  const misled = buildSnapshot(world, { candidate: { id: "keep_lane_target" }, law, s0: law.s0 });
  assert.equal(misled.lane.index, 0, "the old law names the wrong lane on the new route");
}
{
  // A manoeuvre that is not a lane law (parking, a turnaround) carries on as it was.
  const { autopilot, replan } = rig();
  const park = { kind: "park", id: "space", phase: "in" };
  autopilot.executing = { candidate: { id: "park" }, law: park, s0: 0 };
  await replan();
  assert.equal(autopilot.executing?.law, park);
}
console.log("Re-planning drops the old route's lane manoeuvre and finds the car in its own lane");
process.exit(0);
