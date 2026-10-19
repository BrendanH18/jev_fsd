// Lane changes on a two-lane one-way street: lane geometry beside the route, pass and return
// offers, gap acceptance, the lane-end rule, what models are told, and a closed-loop Rules drive
// that passes a stopped car and returns to its lane. Then the lane before a turn: the route moves
// to the left lane on the block before a left turn, and the car changes into it well before.
// node --experimental-default-type=module scripts/test_lane_change.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { Route, PREPARE_LANE_M } = await import("../static/js/map/route.js");
const { routeFromLanes, browserRoute } = await import("../static/js/demo/routing.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll, pathHazard } = await import("../static/js/brain/candidates.js");
const { lateralAt } = await import("../static/js/sim/controller.js");
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
  // a return close to where the left lane ends is made sharper to finish in time, and is not
  // offered once even the sharpest change would carry past that point
  const executing = { law: { kind: "lane", offset: -3.5, center: -3.5, lane: -1, vTarget: 8 } };
  const late = decide(setup({ x: 270, y: LEFT, v: 8 }), executing);
  const back = late.eligible.find((c) => c.id.startsWith("change_right_"));
  assert.ok(back && back.law.shift.start + back.law.shift.len + late.snap.ego.front_m <= LENGTH + 0.01);
  const tooLate = decide(setup({ x: 287, y: LEFT, v: 4 }), executing);
  assert.ok(tooLate.candidates.filter((c) => c.change).every((c) => c.reject === "lane_change_too_late"));
  console.log("✓ a return finishes before the lane it leaves ends, or waits");
}

{
  // where two lanes narrow to the route's one at a junction, a late return is offered only if the
  // predicted car is actually across before the left lane ends
  const lanes2 = { lanes: 2, lane_width: 3.5, lane_offsets: [-1.75, 1.75], asphalt: [-3.5, 3.5] };
  const edges = [
    { id: "wide", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300, ...lanes2 },
    { id: "narrow", from: "b", to: "c", pts: [[300, RIGHT], [500, RIGHT]], length: 200, lanes: 1, lane_width: 3.5, lane_offsets: [0], asphalt: [-1.75, 1.75] },
  ].map((e) => ({ ...e, parking: [0, 0], cls: "secondary", limit: 13.9, oneway: true, name: e.id }));
  const dropMap = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -60, 520, 60], edges,
    lanes: [{ edge: "wide", idx: 0, pts: [[0, LEFT], [300, LEFT]] }, { edge: "wide", idx: 1, pts: [[0, RIGHT], [300, RIGHT]] }, { edge: "narrow", idx: 0, pts: [[300, RIGHT], [500, RIGHT]] }],
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }, { id: "c", x: 500, y: 0 }], intersections: [], stops: [], buildings: [] });
  const drop = (x, v) => {
    const world = new World(dropMap, { parked: 0, pedestrians: 0 });
    Object.assign(world.ego, { x, y: LEFT, psi: 0, v });
    world.route = new Route({ id: "d", polyline: Array.from({ length: 501 }, (_, i) => [i, RIGHT]), edges: ["wide", "narrow"], turns: [], start_s: 0, goal_s: 200 }, dropMap);
    world._road = world.roadInfo();
    return decide(world, { law: { kind: "lane", offset: -3.5, center: -3.5, lane: -1, vTarget: v } });
  };
  assert.equal(drop(200, 10).snap.lane.until_s, 300);
  const fast = drop(284, 13.9);
  assert.ok(fast.candidates.some((c) => c.change));
  assert.ok(fast.candidates.filter((c) => c.change).every((c) => c.reject === "lane_change_too_late"), fast.candidates.filter((c) => c.change).map((c) => `${c.id}:${c.reject}`).join(" "));
  assert.ok(drop(230, 10).eligible.some((c) => c.id.startsWith("change_right_")));
  console.log("✓ a late return is offered only if the car is across before the lane ends");
}

{
  // a route that starts late on an edge still finds its lane from the part it drives (Winnipeg)
  const fs = await import("node:fs");
  const city = new MapData(JSON.parse(fs.readFileSync(new URL("../data/maps/19bb885c9cae.v5.pack.json", import.meta.url))));
  const a = city.lane("e0", 1), b = city.lane("e209", 1), start = 83.5357;
  const polyline = a.pts.filter((_, i) => a.cum[i] > start).concat(b.pts.slice(1));
  polyline.unshift(pointAt(a.pts, a.cum, start));
  const route = new Route({ id: "w", polyline, edges: ["e0", "e209"], turns: [], start_s: start, goal_s: b.length }, city);
  assert.deepEqual([route.laneInfo(0).idx, route.laneInfo(1).idx], [1, 1]);
  assert.ok(route.laneSpan(1, -1) && !route.laneSpan(1, 1));
  console.log("✓ a route starting late on an edge finds the lane it drives");
}

{
  // the router's own lane choice wins: an Ottawa route blends from the right lane of a three-lane
  // street toward the left lane of the next, which the polyline alone misreads
  const fs = await import("node:fs");
  const city = new MapData(JSON.parse(fs.readFileSync(new URL("../data/maps/8e99888cb743.v5.pack.json", import.meta.url))));
  const a = city.lane("e668", 2), b = city.lane("e142", 0), start = 63.14;
  const polyline = [pointAt(a.pts, a.cum, start), ...a.pts.filter((_, i) => a.cum[i] > start), ...b.pts.slice(1)];
  const data = { id: "o", polyline, edges: ["e668", "e142"], turns: [], start_s: start, goal_s: b.length };
  const route = new Route({ ...data, lanes: [2, 0] }, city);
  assert.deepEqual([route.laneInfo(0).idx, route.laneInfo(1).idx], [2, 0]);
  // the route moves from the right lane to the left one on the next block, so the left lane is
  // already the route's lane and the right lane runs beside it
  assert.deepEqual([route.laneAt(1).idx, route.laneAt(1).ahead], [0, true]);
  assert.equal(route.laneSpan(1, -1), null);
  assert.ok(Math.abs(route.laneSpan(1, 2).offset) < 0.01 && route.laneSpan(1, 2).until === route.length);
  assert.equal(new Route(data, city).edgeLanes, null);  // an older route without lanes infers them
  console.log("✓ the route follows the lane the router chose on each edge");
}

{
  // a route that comes back through a junction places the later edges at the second visit
  const one = { lanes: 1, lane_width: 3.5, lane_offsets: [0], asphalt: [-1.75, 1.75] };
  const two = { lanes: 2, lane_width: 3.5, lane_offsets: [-1.75, 1.75], asphalt: [-3.5, 3.5] };
  const legs = [["a", "o", "j", [[0, 0], [100, 0]], one], ["b", "j", "p", [[100, 0], [100, 100]], one], ["c", "p", "q", [[100, 100], [200, 100]], one],
    ["d", "q", "r", [[200, 100], [200, 0]], one], ["e", "r", "j", [[200, 0], [100, 0]], two], ["f", "j", "s", [[100, 0], [100, -100]], one]];
  const edges = legs.map(([id, from, to, pts, l]) => ({ id, from, to, pts, length: 100, ...l, parking: [0, 0], cls: "secondary", limit: 13.9, oneway: true, name: id }));
  const loopMap = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -120, 220, 120], edges,
    lanes: edges.flatMap((e) => e.lane_offsets.map((o, idx) => {
      const [[x0, y0], [x1, y1]] = e.pts, L = Math.hypot(x1 - x0, y1 - y0), rx = (y1 - y0) / L, ry = -(x1 - x0) / L;
      return { edge: e.id, idx, pts: [[x0 + rx * o, y0 + ry * o], [x1 + rx * o, y1 + ry * o]] };
    })),
    nodes: [["o", 0, 0], ["j", 100, 0], ["p", 100, 100], ["q", 200, 100], ["r", 200, 0], ["s", 100, -100]].map(([id, x, y]) => ({ id, x, y })),
    intersections: [], stops: [], buildings: [] });
  const polyline = [];
  for (const [, , , [[x0, y0], [x1, y1]]] of legs) for (let k = polyline.length ? 1 : 0; k <= 100; k++) polyline.push([x0 + (x1 - x0) * k / 100, y0 + (y1 - y0) * k / 100]);
  const route = new Route({ id: "loop", polyline, edges: legs.map((l) => l[0]), turns: [], start_s: 0, goal_s: 100 }, loopMap);
  const starts = route.laneEdgeStarts();
  assert.ok(Math.abs(starts[5] - 500) < 1, starts.join(","));
  assert.equal(route.laneEdgeAt(450), 4);
  assert.ok(route.laneSpan(450, -1) || route.laneSpan(450, 1));
  console.log("✓ a route that loops back through a junction keeps its edges in order");
}

{
  // lane geometry follows the route's own polyline, which rounds a left turn off the edge lengths
  const edges = [
    { id: "west", from: "w", to: "j", pts: [[0, 0], [100, 0]], length: 100 },
    { id: "north", from: "j", to: "n", pts: [[100, 0], [100, 200]], length: 200 },
  ].map((e) => ({ ...e, lanes: 2, lane_width: 3.5, lane_offsets: [-1.75, 1.75], asphalt: [-3.5, 3.5], parking: [0, 0], cls: "secondary", limit: 13.9, oneway: true, name: e.id }));
  const turnMap = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -20, 140, 220], edges,
    lanes: [{ edge: "west", idx: 0, pts: [[0, 1.75], [100, 1.75]] }, { edge: "west", idx: 1, pts: [[0, -1.75], [100, -1.75]] },
      { edge: "north", idx: 0, pts: [[98.25, 0], [98.25, 200]] }, { edge: "north", idx: 1, pts: [[101.75, 0], [101.75, 200]] }],
    nodes: [{ id: "w", x: 0, y: 0 }, { id: "j", x: 100, y: 0 }, { id: "n", x: 100, y: 200 }], intersections: [], stops: [], buildings: [] });
  // left lane up to a 12 m fillet, then the left lane of the new street
  const polyline = [];
  for (let x = 0; x <= 86; x++) polyline.push([x, 1.75]);
  for (let k = 1; k <= 18; k++) { const a = (k / 18) * Math.PI / 2; polyline.push([86 + 12 * Math.sin(a), 1.75 + 12 * (1 - Math.cos(a))]); }
  for (let y = 15; y <= 200; y++) polyline.push([98.25, y]);
  const route = new Route({ id: "t", polyline, edges: ["west", "north"], turns: [{ at_m: 100, dir: "left", street: "north" }], start_s: 0, goal_s: 200 }, turnMap);
  assert.deepEqual([route.laneInfo(0).idx, route.laneInfo(1).idx], [0, 0]);
  const corner = route.project(100, 0, 0).s;
  assert.ok(Math.abs(route.laneEdgeStarts()[1] - corner) < 0.5 && route.edgeStarts[1] - corner > 3, `${route.laneEdgeStarts()[1]} vs ${corner}`);
  assert.ok(Math.abs(route.laneSpan(20, 1).until - corner) < 0.5);
  console.log("✓ lanes beside the route end where the rounded route turns, not at summed edge lengths");
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

// A one-way two-lane street, a 60 m block (`e2`) and a left turn. The router takes the right lane,
// then the left lane on the block before the turn, so its polyline slides across the lanes over a
// few metres at the junction at x = 250.
const TURN_X = 310;
// `xs`: where the street's junctions are before the turn (the route moves across at the last one)
function buildTurnMap(xs = [0, 250]) {
  const two = { lanes: 2, lane_width: 3.5, lane_offsets: [-1.75, 1.75], asphalt: [-3.5, 3.5], parking: [0, 0], cls: "secondary", limit: 13.9, oneway: true };
  const stops = [...xs, TURN_X];
  const edges = [
    ...stops.slice(0, -1).map((x, k) => ({ id: `e${k + 1}`, from: `n${k}`, to: `n${k + 1}`, pts: [[x, 0], [stops[k + 1], 0]], length: stops[k + 1] - x, name: "Main Street" })),
    { id: "north", from: `n${stops.length - 1}`, to: "d", pts: [[TURN_X, 0], [TURN_X, 150]], length: 150, name: "North Street" },
  ].map((e) => ({ ...e, ...two }));
  const lanes = edges.flatMap((e) => e.lane_offsets.map((o, idx) => {
    const [[x0, y0], [x1, y1]] = e.pts, L = Math.hypot(x1 - x0, y1 - y0), rx = (y1 - y0) / L, ry = -(x1 - x0) / L;
    return { edge: e.id, idx, pts: [[x0 + rx * o, y0 + ry * o], [x1 + rx * o, y1 + ry * o]] };
  }));
  return new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -60, TURN_X + 40, 170], edges, lanes,
    nodes: [...stops.map((x, k) => ({ id: `n${k}`, x, y: 0 })), { id: "d", x: TURN_X, y: 150 }], intersections: [], stops: [], buildings: [] });
}
const turnMap = buildTurnMap();
const routeOn = (m) => {
  const ids = [...m.edges.keys()];
  return new Route(routeFromLanes(m, ids.map((id, k) => m.lane(id, k < ids.length - 2 ? 1 : 0)), 0, 100), m);
};
const turnRoute = () => routeOn(turnMap);
function turnSetup({ x, y = RIGHT, v = 10, npcs = [], m = turnMap }) {
  const world = new World(m, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x, y, psi: 0, v });
  world.route = routeOn(m);
  world.destination = world.route.endPoint();
  world.npcs = npcs;
  world._road = world.roadInfo();
  return world;
}

{
  const route = turnRoute();
  const [shift] = route.laneShifts();
  assert.equal(route.laneShifts().length, 1);
  assert.deepEqual([shift.from, shift.to, shift.by], [1, 0, -3.5]);
  assert.ok(Math.abs(shift.at - 250) < 5, `${shift.at}`);
  // the route's lane is the right one until PREPARE_LANE_M before the move, then the left one
  assert.deepEqual([route.laneAt(shift.at - PREPARE_LANE_M - 5).idx, route.laneAt(shift.at - PREPARE_LANE_M - 5).ahead], [1, false]);
  assert.deepEqual([route.laneAt(shift.at - PREPARE_LANE_M + 5).idx, route.laneAt(shift.at - PREPARE_LANE_M + 5).ahead], [0, true]);
  assert.deepEqual([route.laneAt(shift.at + 20).idx, route.laneAt(shift.at + 20).ahead], [0, false]);
  // the right lane runs beside the route's lane until the turn
  assert.ok(Math.abs(route.laneSpan(shift.at - 50, 1).until - route.laneEdgeStarts()[2]) < 0.01);
  // each lane's centre stays on its lane line while the polyline slides across
  for (let s = shift.at - 20; s <= shift.at + 20; s += 0.5) {
    const p = route.pointAt(s);
    for (const k of [0, 1]) {
      const lane = turnMap.lane(s < route.laneEdgeStarts()[1] ? "e1" : "e2", k);
      const off = -projectPoint(lane.pts, lane.cum, p).lateral;
      assert.ok(Math.abs(route.laneOffsetAt(s, k) - off) < 0.1, `lane ${k} at ${(s - shift.at).toFixed(1)}: ${route.laneOffsetAt(s, k).toFixed(2)} vs ${off.toFixed(2)}`);
    }
  }
  assert.ok(Math.abs(route.frameShift(shift.at + 20) - -3.5) < 1e-9 && route.frameShift(shift.at - 20) === 0);
  console.log("✓ the route's lane becomes the turn lane well before the route itself moves across");
}

{
  // before that, the car keeps to the route's right lane; inside it, the left lane is the route's
  const early = decide(turnSetup({ x: 60 }));
  assert.equal(early.snap.lane.delta, 0);
  assert.equal(early.snap.lane.sides.left.offer, null);
  const world = turnSetup({ x: 130, v: 13.9 });
  const { snap, candidates, eligible } = decide(world);
  assert.deepEqual([snap.lane.delta, snap.lane.route_ahead, snap.lane.sides.left.offer], [1, true, "return"]);
  const change = eligible.find((c) => c.id.startsWith("change_left_"));
  assert.ok(change && change.change.prepare, candidates.map((c) => `${c.id}:${c.reject}`).join(" "));
  assert.equal(change.steer, "change to the left lane for the turn ahead");
  assert.match(new RulesBrain().decideSync(snap, eligible).candidateId, /^change_left_/);
  const state = toJevState(snap, candidates, {}, "test");
  assert.deepEqual([state.lanes.car_lane, state.lanes.route_lane], ["right", "left"]);
  assert.ok(situationClauses(snap).some((c) => c.includes("moves to the left lane ahead for the left turn onto North Street") && c.includes("change_left_*")), situationClauses(snap).join("\n"));
  console.log("✓ inside that stretch the car is offered a change into the turn lane, and Rules takes it");
}

{
  // a car alongside in the left lane blocks the change; staying in the right lane is fine for now
  // but not so close to the turn that the car could no longer get across
  const blocked = decide(turnSetup({ x: 130, npcs: [car("beside", 131, LEFT, 10)] }));
  assert.equal(blocked.snap.lane.sides.left.gap_ok, false);
  assert.ok(blocked.candidates.filter((c) => c.change).every((c) => c.reject === "lane_change_gap" || c.reject === "collision"));
  assert.ok(blocked.eligible.some((c) => c.id === "keep_lane_target"));
  const lateWorld = turnSetup({ x: 262, v: 8 });
  // still in the right lane on a law chosen before the junction, when that was the route's lane
  const late = decide(lateWorld, { law: { kind: "lane", offset: 0, center: 0, lane: 0, laneIdx: 1, chain: 0, vTarget: 8, s0: lateWorld.route.project(200, RIGHT, 0).s } });
  assert.equal(late.snap.lane.delta, 1);
  assert.ok(late.candidates.filter((c) => c.id.startsWith("keep_lane_") && c.sim.end_speed >= 7.9).every((c) => c.reject === "must_return_to_route_lane"));
  console.log("✓ without a gap the car waits in its lane, but not past the point it must be across");
}

{
  // a lane law chosen before the route's move keeps the car in its lane through the junction
  const world = turnSetup({ x: 200, y: LEFT, v: 10 });
  const snap = buildSnapshot(world, { law: { kind: "lane", offset: -3.5, center: -3.5, lane: 0, laneIdx: 0, chain: 0, vTarget: 10, s0: world.route.project(200, LEFT).s } });
  assert.equal(snap.lane.delta, 0);
  const keep = sampleCandidates(snap, world).find((c) => c.id === "keep_lane_target");
  simulateAll([keep], snap, world);
  const ys = keep.trace.map(([, y]) => y);
  assert.ok(keep.trace.at(-1)[0] > 230 && ys.every((y) => Math.abs(y - LEFT) < 0.2), ys.map((y) => y.toFixed(2)).join(" "));
  assert.ok(keep.sim.stays_in_lane && Math.abs(keep.sim.lane_err_end) < 0.2);
  console.log("✓ a car already in the turn lane holds it while the route slides across to it");
}

{
  // closed loop: Rules signals and changes into the left lane well before the junction where the
  // route moves across, holds it, turns left and arrives
  const world = turnSetup({ x: 2, v: 8 });
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const metrics = new DriveMetrics(world.route.length);
  const fleet = { step() {} };
  let signalledAt = null, acrossAt = null, drift = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 60 / dt && world.route; i++) {
    const road = stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    if (autopilot.snap) metrics.record(world, autopilot.snap, road, dt);
    const { x, y } = world.ego;
    if (signalledAt === null && world.ego.signal === "left") signalledAt = x;
    if (acrossAt === null && Math.abs(y - LEFT) < 0.3) acrossAt = x;
    if (acrossAt !== null && x < TURN_X - 15) drift = Math.max(drift, Math.abs(y - LEFT));
  }
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.safety_brakes, 0);
  assert.equal(world.route, null, "arrived");
  assert.ok(signalledAt !== null && signalledAt < 150, `signalled left at x=${signalledAt}`);
  assert.ok(acrossAt !== null && acrossAt < 250 - 80, `in the left lane by x=${acrossAt?.toFixed(1)}`);
  assert.ok(drift < 0.3, `holds the left lane through the junction (drift ${drift.toFixed(2)} m)`);
  assert.equal(metrics.laneChanges, 1);
  console.log(`✓ Rules changes into the turn lane ${Math.round(250 - acrossAt)} m before the route moves across, then turns and arrives`);
}

{
  // closed loop: cars queued in the left lane before the turn; the car changes in behind them
  const queue = [200, 207, 214].map((x, k) => car(`queued${k}`, x, LEFT, 0));
  const world = turnSetup({ x: 2, v: 8, npcs: queue });
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const fleet = { step() {} };
  const dt = 1 / 30;
  for (let i = 0; i < 40 / dt; i++) stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.safety_brakes, 0);
  assert.ok(Math.abs(world.ego.y - LEFT) < 0.4 && world.ego.x < 200 - 4 && world.ego.x > 180 && world.ego.v < 0.3, `waits behind the queue in the left lane (${world.ego.x.toFixed(1)}, ${world.ego.y.toFixed(2)})`);
  console.log("✓ Rules joins the back of a queue in the turn lane");
}

{
  // with the right lane kept over two blocks before the move, the right lane still runs on to the turn
  const split = buildTurnMap([0, 150, 250]);
  const world = turnSetup({ x: 140, v: 5, m: split });
  const s0 = world.route.project(100, RIGHT, 0).s;
  const { snap, eligible } = decide(world, { law: { kind: "lane", offset: 0, center: 0, lane: 0, laneIdx: 1, chain: 0, vTarget: 5, s0 } });
  assert.equal(snap.lane.delta, 1);
  assert.ok(Math.abs(snap.lane.until_s - world.route.laneEdgeStarts()[3]) < 0.01, `${snap.lane.until_s}`);
  assert.ok(eligible.some((c) => c.id.startsWith("keep_lane_")) && eligible.some((c) => c.id.startsWith("change_left_")));
  // a law from before lane indexes counts lanes from the lane the route line is in
  const legacy = decide(turnSetup({ x: 130 }), { law: { kind: "lane", offset: 0, center: 0, lane: 0, vTarget: 10, s0: 60 } });
  assert.deepEqual([legacy.snap.lane.index, legacy.snap.lane.delta], [1, 1]);
  console.log("✓ the lane beside the turn lane runs on across blocks, and older laws keep their lane");
}

{
  // re-checking the executing law for hazards uses the frame it was chosen in: a car holding the
  // left lane through the route's move is not predicted to swerve further left
  const world = turnSetup({ x: 200, y: LEFT, v: 10 });
  const s200 = world.route.project(200, LEFT, 0).s;
  const law = { kind: "lane", offset: -3.5, center: -3.5, lane: 0, laneIdx: 0, chain: 0, vTarget: 10 };
  Object.assign(world.ego, { x: 260, y: LEFT });
  world.route.hint = 0;
  world.npcs = [car("beyond", 272, 5.6)];
  world._road = world.roadInfo();
  const executing = { candidate: { id: "keep_lane_target", law }, law: { ...law, s0: s200 } };
  const snap = buildSnapshot(world, executing);
  assert.equal(pathHazard(executing, snap, world), null);
  console.log("✓ the executing law is re-checked in the frame it was chosen in");
}

{
  // carrying a lane change on across the route's move keeps the same path
  const world = turnSetup({ x: 230, v: 10 });
  const first = decide(world).candidates.find((c) => c.id.startsWith("change_left_"));
  const s230 = world.route.project(230, RIGHT, 0).s;
  const executing = { law: { ...first.law, s0: s230 } };
  Object.assign(world.ego, { x: 249.5, y: RIGHT + 1.2 });
  world.route.hint = 0;
  world._road = world.roadInfo();
  const mid = decide(world, executing);
  const cont = mid.candidates.find((c) => c.id === "keep_lane_target" || c.id === "keep_lane_hold");
  assert.ok(cont && cont.law.shift, mid.candidates.map((c) => c.id).join(" "));
  const sNow = mid.snap.routeProj.s;
  for (const ds of [0, 4, 8, 12]) {
    const a = lateralAt(executing.law, sNow + ds, world.route), b = lateralAt({ ...cont.law, s0: sNow }, sNow + ds, world.route);
    assert.ok(Math.abs(a - b) < 0.05, `${ds} m ahead: ${a.toFixed(2)} vs ${b.toFixed(2)}`);
  }
  console.log("✓ a lane change carried on across the route's move keeps its path");
}

{
  // the public demo's browser router picks lanes as the server does: the left lane on the block
  // before a left turn, so its routes get the same early change into the turn lane
  const data = browserRoute(turnMap, { x: 5, y: RIGHT, heading: 0 }, { x: TURN_X + 1.75, y: 100 });
  assert.deepEqual(data.lanes, [1, 0, 1]);
  const route = new Route(data, turnMap);
  assert.deepEqual(route.laneShifts().map((sh) => [sh.from, sh.to]), [[1, 0]]);
  assert.deepEqual([route.laneAt(150).idx, route.laneAt(150).ahead], [0, true]);
  // the start is measured along the lane the route takes: on this curved Ottawa street the lane the
  // car snaps to is longer, and its distance once collapsed the route's first segment
  const fs = await import("node:fs");
  const city = new MapData(JSON.parse(fs.readFileSync(new URL("../data/maps/d25b07def0d2.v5.pack.json", import.meta.url))));
  const curved = browserRoute(city, { x: 692.19, y: -456.92, heading: -0.0427 }, { x: 779.29, y: -398.87 });
  const [p0, , , p3] = curved.polyline;
  assert.ok(Math.abs(Math.atan2(p3[1] - p0[1], p3[0] - p0[0])) < 0.15, `starts along the street (${curved.start_s})`);
  console.log("✓ the browser router takes the turn lane on the block before a left turn");
}
