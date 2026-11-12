// A stop sign mapped well short of the junction its street leads to (Kitsilano's West 8th Avenue has
// one 48 m before Arbutus Street, at a crossing the street graph does not have): the car stops at the
// sign, then still gives way at the junction to the street without one (MapData.junctionPastStop).
// Before, the sign was the street's only control: 12 m past it the car forgot it and crossed the
// junction into traffic (city suite at 06:30, s1-7), and a route planned from between the sign and
// the junction (a detour round a road closure) had no control there at all.
// node --experimental-default-type=module scripts/test_midblock_stop.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { NpcPath } = await import("../static/js/sim/npc.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { rng } = await import("../static/js/common.js");

// Two-way residential streets crossing at the origin, one 3.2 m lane each way. West Street's arms
// (w, e) have stop signs `before` metres short of the centre; North Street (n, s) has none. The car
// comes from the west (travel +x, its lane at y = -1.6) and goes straight on.
const ARM = 150, HALF = 1.6;
const ARMS = { w: 180, e: 0, n: 90, s: -90 };
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
function junction(before) {
  const ends = { c: [0, 0] }, edges = [], lanes = [], stops = [];
  for (const [arm, deg] of Object.entries(ARMS)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const arm of Object.keys(ARMS)) for (const [id, from, to, inbound] of [[`${arm}_in`, arm, "c", true], [`${arm}_out`, "c", arm, false]]) {
    const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
    const signed = inbound && (arm === "w" || arm === "e");
    if (signed) stops.push({ id: `stop_${arm}`, edge: id, s_line: ARM - before, all_way: false, junction: "c" });
    edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-3.2, 3.2], parking: [0, 0],
      cls: "residential", limit: 11.1, oneway: false, name: arm === "w" || arm === "e" ? "West Street" : "North Street",
      ...(signed ? { control: { type: "stop", id: `stop_${arm}`, s_line: ARM - before, all_way: false } } : {}) });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
  }
  return new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })), intersections: [], stops, buildings: [] });
}
function resample(pts) {
  const cum = cumulative(pts), out = [];
  for (let s = 0; s < cum.at(-1); s += 1) out.push(pointAt(pts, cum, s));
  out.push(pts.at(-1));
  return out;
}
// straight on from the west arm, from `start` metres along it
function straight(map, start = 0) {
  const pts = resample(joinLanes(map.lane("w_in", 0).pts, map.lane("e_out", 0).pts)).filter(([x]) => x >= -ARM + start);
  return { id: "straight", polyline: pts, edges: ["w_in", "e_out"], turns: [], start_s: start, goal_s: 120 };
}
const FRONT = (() => { const c = new Vehicle(0, 0, 0, 0); return c.spec.length - c.spec.rearOverhang; })();

const FAR = junction(50), NEAR = junction(8);
{
  // the junction beyond a sign that stands well short of it
  const past = FAR.junctionPastStop("w_in");
  assert.deepEqual([past?.type, past?.rule, past?.junction], ["uncontrolled", "minor", "c"], "a sign 50 m short: the junction is still given way at");
  assert.ok(past.s_line > ARM - 10, `at the junction (${past.s_line.toFixed(1)} m along the 150 m street)`);
  assert.equal(NEAR.junctionPastStop("w_in"), null, "a sign at the junction is the junction's control");
  assert.equal(FAR.junctionPastStop("n_in"), null, "nor is there one on a street without a sign");
  assert.equal(FAR.priorityOf("w_in"), null, "the street's own control is still its stop sign");
  // a route through it stops at the sign, then gives way at the junction
  const route = new Route(straight(FAR), FAR);
  assert.deepEqual(route.controls.map((c) => c.control.type), ["stop", "uncontrolled"]);
  assert.ok(route.controls[1].sRoute - route.controls[0].sRoute > 35);
  assert.deepEqual(new Route(straight(NEAR), NEAR).controls.map((c) => c.control.type), ["stop"], "a sign at the junction: only the stop");
  // (a route planned from past the sign still has the junction: a detour, say)
  assert.deepEqual(new Route(straight(FAR, ARM - 30), FAR).controls.map((c) => c.control.type), ["uncontrolled"]);
  console.log("✓ a stop sign well short of its junction leaves the junction to give way at");
}

{
  // Past the sign, having stopped there, with a car coming down North Street from the car's left due
  // at the junction in 3 s: the car gives way to it at the junction.
  setWeather("dry");
  const world = new World(FAR, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: -50 - FRONT, y: -HALF, psi: 0, v: 0 });
  world.resetContactHistory();
  world.route = new Route(straight(FAR), FAR);
  world.destination = world.route.endPoint();
  world.npcs = [];
  for (let i = 0; i < 30; i++) { world.tick++; world.t += 1 / 30; world.audit(1 / 30, world.roadInfo()); }
  assert.ok(world.egoStop.completed, "the stop is made at the sign");
  // 20 m on, front 30 m short of the centre, at 6 m/s
  Object.assign(world.ego, { x: -30 - FRONT, v: 6 });
  world.resetContactHistory();
  const lane = FAR.lane("n_in", 0), s = ARM - 33 - FRONT, p = pointAt(lane.pts, lane.cum, s);
  const n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 11);
  Object.assign(n, { id: "crossing", v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
  n.path = new NpcPath(FAR, rng(1));
  n.path.start("n_in", 0, s, [["s_out", 0]]);
  world.npcs.push(n);
  world._road = world.roadInfo();
  const snap = buildSnapshot(world);
  const i = snap.intersection;
  assert.equal(i?.control, "uncontrolled", "the junction is ahead (before: no control at all)");
  assert.equal(i.give_way?.rule, "minor");
  assert.equal(i.give_way.wait_for?.id, "crossing", "the car crossing from the left is waited for");
  assert.equal(i.give_way.go, false);
  const candidates = sampleCandidates(snap, world), { eligible } = simulateAll(candidates, snap, world);
  const choice = new RulesBrain().decideSync(snap, eligible);
  const law = candidates.find((c) => c.id === choice.candidateId)?.law;
  assert.ok(choice.motion === "stop" || (law && law.stopAtRoute !== undefined && law.stopAtRoute <= world.route.controls[1].sJunction), `Rules stops short of the junction (${choice.candidateId})`);
  console.log("✓ past the sign, the car gives way at the junction to traffic on the street without one");
}
process.exit(0);
