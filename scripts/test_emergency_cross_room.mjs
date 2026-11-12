// Pulling over for an emergency vehicle from a lane further out, the car crosses into the curb lane. Its
// stop was at least 8 m on, room to steer over within a lane but not to change lanes: from the inner
// lane of West Broadway (Kitsilano city s1-12, after the Calgary school bus fix changed its traffic) the
// car reached its stop at an angle, short of the curb lane's middle, and was not counted as pulled over;
// standing in the left lane of three on 11 Avenue SW (Calgary city seed 2, s2-1) it stood across the
// middle lane, in a fire truck's way. The stop now leaves 12 m (the sharpest lane change offered) for
// each lane it crosses, and where a junction ahead leaves too little room for that, the car pulls over
// in the furthest lane it can reach.
// node --experimental-default-type=module scripts/test_emergency_cross_room.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World, wrap } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { pullOverOffset } = await import("../static/js/sim/emergency.js");

// Two-way streets crossing at the origin, two lanes each way 3.2 m wide with a 2.1 m parking lane,
// arms 200 m long (as in test_emergency.mjs); the car in the inner lane of West Street, going east.
const ARM = 200, ARMS = { w: 180, e: 0, n: 90, s: -90 }, offsets = [1.6, 4.8], outer = 2 * 3.2 + 2.1;
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
const ends = { c: [0, 0] }, edges = [], lanes = [];
for (const [arm, deg] of Object.entries(ARMS)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
for (const [arm] of Object.entries(ARMS)) for (const [id, from, to] of [[`${arm}_in`, arm, "c"], [`${arm}_out`, "c", arm]]) {
  const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
  edges.push({ id, from, to, pts, length: ARM, lanes: 2, lane_width: 3.2, lane_offsets: offsets, asphalt: [-outer, outer], parking: [2.1, 2.1],
    cls: arm === "w" || arm === "e" ? "secondary" : "residential", limit: 11.1, oneway: false, name: arm === "w" || arm === "e" ? "West Street" : "North Street" });
  offsets.forEach((d, idx) => lanes.push({ edge: id, idx, pts: pts.map(([x, y]) => [x + rx * d, y + ry * d]) }));
}
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
  nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })), intersections: [], stops: [], buildings: [] });
const line = joinLanes(map.lane("w_in", 0).pts, map.lane("e_out", 0).pts), cum = cumulative(line), polyline = [];
for (let s = 0; s < cum.at(-1); s += 1) polyline.push(pointAt(line, cum, s));
const routeData = { id: "east", polyline, edges: ["w_in", "e_out"], turns: [], start_s: 0, goal_s: 190 };
const FRONT = (() => { const c = new Vehicle(0, 0, 0, 0); return c.spec.length - c.spec.rearOverhang; })();
const inLane = pullOverOffset(map.edges.get("w_in"), 0, new Vehicle(0, 0, 0, 0).spec.width, false);

function setup(front, v) {
  setWeather("dry");
  const world = new World(map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: front - FRONT, y: -1.6, psi: 0, v });
  world.resetContactHistory();
  world.route = new Route(routeData, map);
  world.destination = world.route.endPoint();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  world._road = world.roadInfo();
  fleet.dispatchEmergency({ relation: "behind", kind: "fire_truck", distance: 60 });
  return { world, fleet };
}
function drive(world, fleet, seconds) {
  const autopilot = new Autopilot(world);
  autopilot.setBrain("rules");
  autopilot.setEnabled(true);
  const out = { failed: 0, level: null }, truck = fleet.vehicles[0];
  for (let k = 0; k < seconds * 60; k++) {
    stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
    for (const ev of world.events) if (ev.type === "failed_to_yield") out.failed++;
    // (where the car is, and how it is heading, as the fire truck draws level with it)
    if (out.level === null && truck.x >= world.ego.x) out.level = { right: -world.ego.y - 1.6, heading: Math.abs(wrap(world.ego.psi)) * 180 / Math.PI };
    if (!autopilot.enabled) break;
  }
  out.collisions = world.violations.collisions;
  return out;
}

{
  // moving at 10 m/s its stop is 33 m on: room to change into the curb lane and pull over there
  const { world } = setup(-110, 10);
  const e = buildSnapshot(world).emergency;
  assert.ok(Math.abs(e.offset_m - (3.2 + 1.5)) < 1e-9, `across and over: ${e.offset_m}`);
  console.log("✓ moving, the car crosses into the curb lane to pull over");
}

{
  // at 4 m/s, with nothing ahead, the stop leaves room for the lane change: the car is in the curb lane,
  // pulled over, as the fire truck goes by (with 8 m it stopped at an angle, short of the lane's middle)
  const { world, fleet } = setup(-110, 4);
  const e = buildSnapshot(world).emergency;
  assert.ok(e.bumper_to_stop_m >= 8 + 12 - 1e-9, `stops ${e.bumper_to_stop_m.toFixed(1)} m on`);
  assert.ok(Math.abs(e.offset_m - (3.2 + 1.5)) < 1e-9, `across and over: ${e.offset_m}`);
  const out = drive(world, fleet, 30);
  assert.ok(out.level && out.level.right > 3.2 + 0.2, `${out.level?.right.toFixed(2)} m right, in the curb lane`);
  assert.equal(out.failed, 0);
  assert.equal(out.collisions, 0);
  console.log("✓ slow, the stop leaves room to change into the curb lane, and the car is there as the truck goes by");
}

{
  // from a standstill 25 m short of the junction, the stop short of it leaves no room for a lane change:
  // the car pulls over in its own lane
  const { world, fleet } = setup(-25, 0);
  const e = buildSnapshot(world).emergency;
  assert.ok(e.bumper_to_stop_m < 8 + 12, `stops ${e.bumper_to_stop_m.toFixed(1)} m on, short of the junction`);
  assert.ok(Math.abs(e.offset_m - inLane) < 1e-9, `over in its own lane: ${e.offset_m}`);
  const out = drive(world, fleet, 30);
  assert.ok(out.level && out.level.right > 0.2 && out.level.right < 1.6 - 0.9, `${out.level?.right.toFixed(2)} m right, in its lane`);
  assert.equal(out.failed, 0);
  assert.equal(out.collisions, 0);
  console.log("✓ short of a junction, with no room to change lanes, the car pulls over in its own lane");
}
process.exit(0);
