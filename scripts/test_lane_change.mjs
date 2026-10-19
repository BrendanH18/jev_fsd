// Lane changes on a two-lane one-way street: lane geometry beside the route, pass and return
// offers, gap acceptance, the lane-end rule, what models are told, and a closed-loop Rules drive
// that passes a stopped car and returns to its lane.
// node --experimental-default-type=module scripts/test_lane_change.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { DriveMetrics } = await import("../static/js/bench/metrics.js");

const LENGTH = 300, RIGHT = -1.75, LEFT = 1.75;  // travel is +x, so right of travel is -y
const edge = { id: "main", from: "a", to: "b", pts: [[0, 0], [LENGTH, 0]], length: LENGTH, lanes: 2, lane_width: 3.5,
  lane_offsets: [-1.75, 1.75], asphalt: [-3.5, 3.5], parking: [0, 0], cls: "secondary", limit: 13.9, oneway: true, name: "Test Street" };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -60, LENGTH + 20, 60], edges: [edge],
  lanes: [{ edge: "main", idx: 0, pts: [[0, LEFT], [LENGTH, LEFT]] }, { edge: "main", idx: 1, pts: [[0, RIGHT], [LENGTH, RIGHT]] }],
  nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: LENGTH, y: 0 }], intersections: [], stops: [], buildings: [] });
const routeData = { id: "r", polyline: Array.from({ length: LENGTH + 1 }, (_, i) => [i, RIGHT]), edges: ["main"], turns: [], start_s: 0, goal_s: LENGTH };

function car(id, x, y, v = 0) {
  const n = new Vehicle(x, y, 0, v);
  n.id = id;
  return n;
}
function setup({ x = 20, y = RIGHT, v = 10, npcs = [] } = {}) {
  const world = new World(map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x, y, psi: 0, v });
  world.route = new Route(routeData, map);
  world.destination = [LENGTH, RIGHT];
  world.npcs = npcs;
  world._road = world.roadInfo();
  return world;
}
function decide(world, executing = null) {
  const snap = buildSnapshot(world, executing);
  const candidates = sampleCandidates(snap, world);
  const result = simulateAll(candidates, snap, world);
  return { snap, candidates, ...result };
}

{
  const route = new Route(routeData, map);
  assert.deepEqual(route.laneInfo(0), { lanes: 2, idx: 1, offsets: [-1.75, 1.75], ring: false });
  assert.deepEqual(route.laneSpan(10, -1), { offset: -3.5, until: LENGTH });
  assert.equal(route.laneSpan(10, 1), null);
  console.log("✓ the route follows the right lane and the left lane runs beside it to the destination");
}

{
  const world = setup({ npcs: [car("stalled", 70, RIGHT)] });
  const { snap, candidates, eligible } = decide(world);
  assert.equal(snap.lane.delta, 0);
  assert.equal(snap.lane.sides.left.offer, "pass");
  assert.ok(snap.lane.sides.left.gap_ok);
  assert.equal(snap.lane.sides.right, undefined);
  const change = eligible.filter((c) => c.id.startsWith("change_left_"));
  assert.ok(change.length, candidates.map((c) => `${c.id}:${c.reject}`).join(" "));
  assert.equal(change[0].law.lane, -1);
  assert.equal(change[0].law.offset, -3.5);
  assert.ok(Math.abs(change[0].law.shift.from) < 0.01);
  const choice = new RulesBrain().decideSync(snap, eligible);
  assert.match(choice.candidateId, /^change_left_/);
  const state = toJevState(snap, candidates, {}, "test");
  assert.deepEqual({ ...state.lanes, left: undefined }, { count: 2, car_lane: "right", route_lane: "right", left: undefined });
  assert.equal(state.lanes.left.gap_ok, true);
  assert.ok(situationClauses(snap).some((c) => c.includes("change_left_*")));
  assert.ok(buildQuestions(snap, eligible).questions.vector.criteria[change[0].id].includes("change to the left lane to pass"));
  console.log("✓ a stopped car ahead offers a pass into the clear left lane, and Rules takes it");
}

{
  // a car coming up fast in the left lane closes the gap
  const world = setup({ npcs: [car("stalled", 70, RIGHT), car("overtaker", 8, LEFT, 15)] });
  const { snap, candidates, rejected } = decide(world);
  assert.equal(snap.lane.sides.left.gap_ok, false);
  assert.ok(candidates.filter((c) => c.change).every((c) => c.reject === "lane_change_gap" || c.reject === "collision"));
  assert.ok(rejected.lane_change_gap || rejected.collision);
  assert.ok(!situationClauses(snap).some((c) => c.includes("change_left_*")));
  console.log("✓ no lane change into a lane with traffic closing from behind");
}

{
  // a car ahead moving at about the speed this car would drive anyway
  const world = setup({ npcs: [car("cruiser", 60, RIGHT, 13)] });
  const { snap } = decide(world);
  assert.equal(snap.lane.sides.left.offer, null);
  console.log("✓ a car ahead at the speed the car would drive anyway is not passed");
}

{
  // in the left lane near the destination: staying there is rejected, returning is offered
  const world = setup({ x: 240, y: LEFT, v: 8 });
  const executing = { law: { kind: "lane", offset: -3.5, center: -3.5, lane: -1, vTarget: 8 } };
  const { snap, candidates, eligible } = decide(world, executing);
  assert.equal(snap.lane.delta, -1);
  assert.equal(snap.lane.sides.right.offer, "return");
  assert.ok(candidates.filter((c) => c.id.startsWith("keep_lane_") && c.sim.end_speed >= 7.9).every((c) => c.reject === "must_return_to_route_lane"));
  assert.ok(eligible.some((c) => c.id.startsWith("change_right_")));
  assert.equal(new RulesBrain().decideSync(snap, eligible).candidateId.startsWith("change_right_"), true);
  const state = toJevState(snap, candidates, {}, "test");
  assert.equal(state.lanes.car_lane, "left");
  assert.ok(state.lanes.return_within_m > 0);
  assert.ok(situationClauses(snap).some((c) => c.includes("change_right_*")));
  console.log("✓ the car must return to its route's lane before the lane beside it ends");
}

{
  // halfway into a pass, a continuing manoeuvre keeps the lane the change began in, so going back
  // stays on offer when a fast car closes in the target lane
  const world = setup({ x: 40, y: 0, v: 10, npcs: [car("stalled", 90, RIGHT)] });
  const first = decide(world).candidates.find((c) => c.id.startsWith("change_left_"));
  const start = { law: { ...first.law, shift: { ...first.law.shift, start: 30 } } };
  const mid = decide(world, start);
  assert.equal(mid.snap.lane.from_delta, 0);
  const cont = mid.candidates.find((c) => c.id === "keep_lane_target" || c.id === "keep_lane_hold");
  assert.equal(cont.law.fromLane, 0);
  assert.equal(cont.law.shift, start.law.shift);
  world.npcs.push(car("overtaker", 22, LEFT, 18));
  const later = decide(world, { law: cont.law });
  assert.equal(later.snap.lane.from_delta, 0);
  assert.equal(later.snap.lane.sides.right.offer, "abort");
  assert.ok(later.candidates.some((c) => c.id.startsWith("change_right_")));
  console.log("✓ a lane change under way can still be abandoned after it is continued");
}

{
  // Rules finishes a pass it has started while the target lane stays clear, rather than flipping
  // back and forth (a slow car close ahead in the old lane once made it abandon and restart)
  const world = setup({ x: 40, y: RIGHT + 0.05, v: 8, npcs: [car("slow", 55, RIGHT, 7)] });
  const first = decide(world).candidates.find((c) => c.id.startsWith("change_left_"));
  const mid = decide(world, { law: { ...first.law, shift: { ...first.law.shift, start: 39 } } });
  assert.equal(mid.snap.lane.sides.right.offer, "abort");
  assert.ok(mid.eligible.some((c) => c.id.startsWith("change_right_")));
  assert.match(new RulesBrain().decideSync(mid.snap, mid.eligible).candidateId, /^keep_lane_/);
  console.log("✓ Rules finishes a lane change it has started while the new lane stays clear");
}

{
  // projecting traffic in the next lane leaves the route's own tracking hint alone
  const world = setup({ npcs: [car("stalled", 70, RIGHT), car("far", 250, LEFT, 5)] });
  const before = world.route.project(world.ego.x, world.ego.y).index;
  buildSnapshot(world);
  assert.equal(world.route.hint, before);
  console.log("✓ sensing the lanes beside the car does not move the route's tracking hint");
}

{
  // closed loop: Rules passes the stalled car, signals, returns to the right lane and arrives
  const world = setup({ x: 10, v: 8, npcs: [car("stalled", 90, RIGHT)] });
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const metrics = new DriveMetrics(world.route.length);
  const fleet = { step() {} };
  let minY = Infinity, signalled = false, passedAt = null;
  const dt = 1 / 30;
  for (let i = 0; i < 60 / dt && world.route; i++) {
    const road = stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    if (autopilot.snap) metrics.record(world, autopilot.snap, road, dt);
    minY = Math.min(minY, world.ego.y);
    if (world.ego.y > 0 && world.ego.signal === "left") signalled = true;
    if (passedAt === null && world.ego.x > 100) passedAt = world.ego.y;
  }
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.safety_brakes, 0);
  assert.ok(signalled, "signalled left while changing lanes");
  assert.ok(passedAt > 0.5, `passed the stalled car in the left lane (y=${passedAt})`);
  assert.ok(Math.abs(world.ego.y - RIGHT) < 0.6, `back in the right lane at the end (y=${world.ego.y.toFixed(2)})`);
  assert.equal(world.route, null, "arrived");
  assert.ok(metrics.laneChanges >= 2, `${metrics.laneChanges} lane changes`);
  assert.ok(metrics.maxLat < 1.5, `lane tracking error stays small (${metrics.maxLat.toFixed(2)} m)`);
  assert.ok(metrics.maxLatAccel < 2.5, `lateral acceleration ${metrics.maxLatAccel.toFixed(2)} m/s^2`);
  console.log(`✓ Rules passes a stalled car, returns to its lane and arrives (${metrics.laneChanges} changes, max lateral accel ${metrics.maxLatAccel.toFixed(2)} m/s^2)`);
}
