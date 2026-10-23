// Stop signs: the order vehicles go in at an all-way stop, for the driven car and for traffic, and
// left turns at a stop sign yielding to oncoming traffic. The queue's rules (first to stop goes
// first, right before left on a tie, opposite sides together, a left turn waiting, four at once),
// what the car senses and models are told, closed-loop drives with traffic, and the audit.
// node --experimental-default-type=module scripts/test_all_way_stop.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt, headingAt, wrapAngle } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { AllWayStops, TIE_S } = await import("../static/js/sim/all-way.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { buildLlmPrompt } = await import("../static/js/brain/llm-prompt.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { DeadlockDetector } = await import("../static/js/brain/safety.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { rng } = await import("../static/js/common.js");
const fs = await import("node:fs");

// Two-way streets crossing at the origin, one lane each way 3.2 m wide, a stop sign on every arm
// (`allWay`: false makes it a two-way stop on the east-west street only) with its line 8 m before
// the centre. The car comes from the west (travel +x, its lane at y = -1.6). Arms: w, e, n, s.
const ARM = 150, LINE = ARM - 8, HALF = 1.6;
const ARMS = { w: 180, e: 0, n: 90, s: -90 };
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
function junction({ allWay = true } = {}) {
  const ends = { c: [0, 0] }, edges = [], lanes = [], stops = [];
  for (const [arm, deg] of Object.entries(ARMS)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const [arm] of Object.entries(ARMS)) for (const [id, from, to, inbound] of [[`${arm}_in`, arm, "c", true], [`${arm}_out`, "c", arm, false]]) {
    const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
    const signed = inbound && (allWay || arm === "w" || arm === "e");
    if (signed) stops.push({ id: `stop_${arm}`, edge: id, s_line: LINE, all_way: allWay, junction: "c" });
    edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-3.2, 3.2], parking: [0, 0],
      cls: "residential", limit: 11.1, oneway: false, name: arm === "w" || arm === "e" ? "West Street" : "North Street",
      ...(signed ? { control: { type: "stop", id: `stop_${arm}`, s_line: LINE, all_way: allWay } } : {}) });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
  }
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })), intersections: [], stops, buildings: [] });
  // routes from the west arm: straight on, left (north) or right (south)
  const routeData = (exit) => ({ id: `to_${exit}`, polyline: resample(joinLanes(map.lane("w_in", 0).pts, map.lane(exit, 0).pts)), edges: ["w_in", exit],
    turns: exit === "e_out" ? [] : [{ at_m: ARM, dir: exit === "n_out" ? "left" : "right" }], start_s: 0, goal_s: 120 });
  return { map, routeData };
}
function resample(pts) {
  const cum = cumulative(pts), out = [];
  for (let s = 0; s < cum.at(-1); s += 1) out.push(pointAt(pts, cum, s));
  out.push(pts.at(-1));
  return out;
}
const { map, routeData } = junction();
const STRAIGHT = routeData("e_out"), LEFT = routeData("n_out");
const FRONT = (() => { const c = new Vehicle(0, 0, 0, 0); return c.spec.length - c.spec.rearOverhang; })();
// where the car's front bumper is `toLine` metres short of its line
const egoX = (toLine) => -8 - toLine - FRONT;

function setup({ x = egoX(20), v = 6, route = STRAIGHT, on = map } = {}) {
  setWeather("dry");
  const world = new World(on, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x, y: -HALF, psi: 0, v });
  world.resetContactHistory();
  world.route = new Route(route, on);
  world.destination = world.route.endPoint();
  world.npcs = [];
  world._road = world.roadInfo();
  return world;
}
// A traffic car on `arm`'s inbound lane, `toLine` metres (front bumper) short of its line, planning
// to leave by `exit` ("e_out", ...). With a fleet, it drives itself.
function npc(world, id, arm, toLine, { v = 0, exit = null, fleet = null, react = 0.5 } = {}) {
  const lane = world.map.lane(`${arm}_in`, 0), s = LINE - toLine - FRONT, p = pointAt(lane.pts, lane.cum, s);
  const n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
  const out = exit || { w: "e_out", e: "w_out", n: "s_out", s: "n_out" }[arm];
  Object.assign(n, { id, v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
  n.path = new NpcPath(world.map, fleet?.random || rng(1));
  n.path.start(`${arm}_in`, 0, s, [[out, 0]]);
  (fleet ? fleet.vehicles : world.npcs).push(n);
  return n;
}
// Put a vehicle in the queue as having stopped at its line at time `t`.
function arrive(world, n, edge, t, turn = "straight") {
  const control = world.map.edges.get(edge).control, was = world.t;
  world.t = t;
  world.allWay.note(n, control, edge, turn, 1, 0, world);
  world.t = was;
}
function decide(world) {
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  return { snap, candidates, ...simulateAll(candidates, snap, world) };
}
// Stop the car at its line for a full second, as the audit sees it, without moving anything else.
function stopAtLine(world) {
  Object.assign(world.ego, { x: egoX(0.8), v: 0 });
  world.resetContactHistory();
  for (let i = 0; i < 30; i++) { world.tick++; world.t += 1 / 30; world.audit(1 / 30, world.roadInfo()); refresh(world); }
  world._road = world.roadInfo();
}
// keep test vehicles that stand still in the queue as the ticks pass
function refresh(world) {
  for (const [n, e] of world.allWay.entries) if (n !== world.ego) e.tick = world.tick;
}

{
  // the queue on its own: fake vehicles, headings from the arms
  const world = new World(map, { parked: 0, pedestrians: 0 });
  const q = new AllWayStops(map);
  const v = (id) => ({ id });
  const [a, b, c, d] = ["a", "b", "c", "d"].map(v);
  const go = (n) => q.status(n, world).go;
  q.note(a, map.edges.get("w_in").control, "w_in", "straight", 1, 0, world);
  world.t = 2;
  q.note(b, map.edges.get("s_in").control, "s_in", "straight", 1, 0, world);
  assert.ok(go(a) && !go(b), "the first to stop goes first");
  assert.equal(q.status(b, world).wait_for, a);
  // moving off on its turn: it keeps the right of way while it crosses, and leaves the queue once
  // it is 6 m past the junction's centre; then the next one goes
  Object.assign(a, { x: -12, y: -HALF, psi: 0 });
  q.note(a, map.edges.get("w_in").control, "w_in", "straight", 0.5, 1, world);
  assert.ok(q.status(a, world).going);
  a.x = -2;
  q.note(a, map.edges.get("w_in").control, "w_in", "straight", -6.5, 5, world);
  assert.ok(q.status(a, world).going && !go(b), "still crossing");
  a.x = 7;
  assert.equal(q.status(a, world), null);
  assert.ok(go(b));
  // a vehicle that never stopped is not in the queue
  q.note(c, map.edges.get("n_in").control, "n_in", "straight", 3, 5, world);
  assert.equal(q.status(c, world), null);
  console.log("✓ the first vehicle to stop goes first, and the next goes once it has crossed the junction");
}

{
  // stopped together (within TIE_S): the one on the right goes first
  const world = new World(map, { parked: 0, pedestrians: 0 });
  const q = world.allWay, a = { id: "west" }, b = { id: "south" };
  arrive(world, a, "w_in", 10); arrive(world, b, "s_in", 10 + TIE_S * 0.8);
  assert.ok(!q.status(a, world).go && q.status(b, world).go, "the car from the south is on the right of the car from the west");
  // but one that stopped later than that waits whatever side it is on
  const world2 = new World(map, { parked: 0, pedestrians: 0 });
  arrive(world2, a, "w_in", 10); arrive(world2, b, "s_in", 10 + TIE_S * 1.2);
  assert.ok(world2.allWay.status(a, world2).go && !world2.allWay.status(b, world2).go);
  console.log("✓ two that stop together go right before left; a later one waits wherever it is");
}

{
  // opposite sides: straight on (or right) together; a left turn waits on a tie; opposing lefts together
  const pair = (ta, turnA, tb, turnB) => {
    const world = new World(map, { parked: 0, pedestrians: 0 }), a = { id: "west" }, b = { id: "east" };
    arrive(world, a, "w_in", ta, turnA); arrive(world, b, "e_in", tb, turnB);
    return [world.allWay.status(a, world).go, world.allWay.status(b, world).go];
  };
  assert.deepEqual(pair(10, "straight", 12, "straight"), [true, true], "straight on from opposite sides together");
  assert.deepEqual(pair(10, "right", 12, "straight"), [true, true]);
  assert.deepEqual(pair(10, "left", 10.5, "straight"), [false, true], "a left turn waits for the other side on a tie");
  assert.deepEqual(pair(10, "left", 12, "straight"), [true, false], "but goes first if it stopped first");
  assert.deepEqual(pair(10, "left", 10, "left"), [true, true], "opposing left turns pass in front of each other");
  console.log("✓ from opposite sides vehicles go together, unless one turns left, which waits on a tie");
}

{
  // four at once, each with one on its right: the first to stop goes, then the rest in turn
  const world = new World(map, { parked: 0, pedestrians: 0 }), q = world.allWay;
  const cars = ["w", "s", "e", "n"].map((arm, i) => { const n = { id: arm }; arrive(world, n, `${arm}_in`, 10 + i * 0.1); return n; });
  assert.deepEqual(cars.map((n) => q.status(n, world).go), [true, false, false, false], "the first to stop goes");
  q.forget(cars[0]);
  assert.deepEqual(cars.slice(1).map((n) => q.status(n, world).go), [false, false, true], "then the one it held up, and so on round");
  console.log("✓ four vehicles stopping together do not deadlock: the first to stop goes, then the rest");
}

{
  // the driven car's sensing: a car from its right stopped first, so the car waits
  const world = setup({ x: egoX(0.8), v: 0 });
  const other = npc(world, "from_right", "s", 0.8);
  arrive(world, other, "s_in", -5);
  stopAtLine(world);
  const { snap, eligible, rejected } = decide(world);
  const i = snap.intersection;
  assert.equal(i.control, "stop");
  assert.ok(i.stop_completed);
  assert.deepEqual([i.priority.arrived, i.priority.go, i.priority.wait_for], [true, false, "from_right"]);
  assert.equal(snap.target.v, 0);
  assert.ok(snap.target.reasons.includes("waiting its turn"));
  assert.ok(rejected.fails_to_yield > 0, JSON.stringify(rejected));
  assert.ok(eligible.every((c) => !c.sim.crosses_stop_line));
  assert.equal(new RulesBrain().decideSync(snap, eligible).motion, "stop");
  // once it has gone, it is the car's turn
  world.allWay.forget(other); world.npcs = [];
  world.tick++; world.audit(1 / 30, world.roadInfo());
  const after = decide(world);
  assert.equal(after.snap.intersection.priority.go, true);
  assert.ok(after.eligible.some((c) => c.sim.progress_m > 2), "drives on");
  assert.equal(new RulesBrain().decideSync(after.snap, after.eligible).motion, "drive");
  console.log("✓ stopped at an all-way stop after a car on its right, the car waits for it, then goes");
}

{
  // what decision models and LLMs see
  const world = setup({ x: egoX(0.8), v: 0 });
  arrive(world, npc(world, "first", "e", 0.8), "e_in", -5, "left");
  arrive(world, npc(world, "second", "s", 0.8), "s_in", -4);
  stopAtLine(world);
  const { snap, candidates, eligible } = decide(world);
  const state = toJevState(snap, candidates, {}, "test");
  assert.deepEqual(state.intersection.priority, { stopped_at_line: true, your_turn: false, wait_for: "first", goes_first: ["first", "second"] });
  const clause = situationClauses(snap).find((c) => c.includes("all-way stop"));
  assert.ok(clause && clause.includes("`first` goes first") && clause.includes("Hold still"), clause);
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.stop.includes("`intersection.priority.your_turn` is false"));
  const { messages } = buildLlmPrompt(snap, { state, questions });
  assert.ok(messages[0].content.includes("all-way stop where it is not the car's turn"));
  // approaching: who is already waiting there goes first
  const coming = setup({ x: egoX(20), v: 6 });
  arrive(coming, npc(coming, "waiting", "n", 0.8), "n_in", -2);
  const early = decide(coming);
  assert.deepEqual(toJevState(early.snap, early.candidates, {}, "test").intersection.priority, { stopped_at_line: false, waiting_at_junction: ["waiting"] });
  assert.ok(situationClauses(early.snap).some((c) => c.startsWith("An all-way stop is") && c.includes("`waiting` stopped at its line before the car")));
  // a two-way stop has no queue, and the motion criteria read as before
  const two = junction({ allWay: false });
  const plain = decide(setup({ x: egoX(20), on: two.map, route: two.routeData("e_out") }));
  assert.equal(plain.snap.intersection.priority, null);
  assert.equal(toJevState(plain.snap, plain.candidates, {}, "test").intersection.priority, undefined);
  assert.ok(!buildQuestions(plain.snap, plain.eligible).questions.motion.criteria.stop.includes("all-way"));
  console.log("✓ models get the car's place in the queue, a situation line and a motion criterion while it waits its turn");
}

{
  // honest sensing: a vehicle the car cannot see does not hold it back
  const world = setup({ x: egoX(0.8), v: 0 });
  const hidden = npc(world, "hidden", "s", 0.8);
  arrive(world, hidden, "s_in", -5);
  stopAtLine(world);
  world.visibility.sees = (observer, o) => o !== hidden;
  world.visibleObstaclesNear = (x, y, r) => world.obstaclesNear(x, y, r).filter((o) => o !== hidden);
  const { snap } = decide(world);
  assert.equal(snap.intersection.priority.go, true);
  assert.equal(world.allWay.status(world.ego, world).go, false, "though it is not the car's turn");
  console.log("✓ a vehicle the car cannot see does not hold it at an all-way stop");
}

{
  // nor do hidden vehicles decide its turn: four stop together, each with one on its right, and the
  // car sees only the one on its right. In the full order the car stopped first and goes; from what
  // it can see, the car on its right goes first.
  const world = setup({ x: egoX(0.8), v: 0 });
  stopAtLine(world);
  const t0 = world.allWay.status(world.ego, world).arrived;
  const right = npc(world, "visible_right", "s", 0.8), across = npc(world, "hidden_across", "e", 0.8), left = npc(world, "hidden_left", "n", 0.8);
  arrive(world, right, "s_in", t0 + 0.1); arrive(world, across, "e_in", t0 + 0.2); arrive(world, left, "n_in", t0 + 0.3);
  assert.equal(world.allWay.status(world.ego, world).go, true, "in the full order the car goes");
  const hidden = new Set([across, left]);
  world.visibility.sees = (observer, o) => !hidden.has(o);
  world.visibleObstaclesNear = (x, y, r) => world.obstaclesNear(x, y, r).filter((o) => !hidden.has(o));
  const { snap } = decide(world);
  assert.deepEqual([snap.intersection.priority.go, snap.intersection.priority.wait_for], [false, "visible_right"]);
  console.log("✓ the car's turn is worked out from the vehicles it can see, not from hidden ones");
}

{
  // the audit: going out of turn fails to yield, seen or not; on its turn it does not
  const run = (first) => {
    const world = setup({ x: egoX(0.8), v: 0 });
    const other = npc(world, "other", "s", 0.8);
    arrive(world, other, "s_in", first ? -5 : world.t + 0.5 + TIE_S * 2);
    stopAtLine(world);
    for (let k = 0; k < 45; k++) {
      world.ego.v = 4; world.ego.x += 4 / 30; world.tick++; world.t += 1 / 30;
      refresh(world);
      world.audit(1 / 30, world.roadInfo());
      if (world.events.some((e) => e.type === "failed_to_yield")) return world.events.filter((e) => e.type === "failed_to_yield");
    }
    return [];
  };
  assert.deepEqual(run(true).map((e) => [e.to, e.with]), [["all-way stop", "other"]]);
  assert.deepEqual(run(false), []);
  // a car that overshot the line and made its stop past it, then went out of turn, counts too
  const over = setup({ x: egoX(-0.8), v: 0 });
  arrive(over, npc(over, "first", "s", 0.8), "s_in", -5);
  for (let i = 0; i < 30; i++) { over.tick++; over.t += 1 / 30; refresh(over); over.audit(1 / 30, over.roadInfo()); }
  assert.ok(over.egoStop.completed && over.allWay.status(over.ego, over).go === false, "stopped past the line, not its turn");
  const counted = [];
  for (let k = 0; k < 45; k++) {
    over.ego.v = 4; over.ego.x += 4 / 30; over.tick++; over.t += 1 / 30;
    refresh(over); over.audit(1 / 30, over.roadInfo());
    counted.push(...over.events.filter((e) => e.type === "failed_to_yield").map((e) => [e.to, e.with]));
  }
  assert.deepEqual(counted, [["all-way stop", "first"]]);
  // creeping over the line out of turn counts as it crosses, and only once however it then moves
  const creep = setup({ x: egoX(0.8), v: 0 });
  arrive(creep, npc(creep, "first", "s", 0.8), "s_in", -5);
  stopAtLine(creep);
  const crept = [];
  for (let k = 0; k < 150; k++) {
    // 0.4 m/s for 3 s, then stop and go, twice
    const v = k < 90 ? 0.4 : [1, 0, 1, 0, 2][Math.floor((k - 90) / 12)] ?? 2;
    creep.ego.v = v; creep.ego.x += v / 30; creep.tick++; creep.t += 1 / 30;
    refresh(creep); creep.audit(1 / 30, creep.roadInfo());
    crept.push(...creep.events.filter((e) => e.type === "failed_to_yield").map((e) => [e.to, e.with, k < 90]));
  }
  assert.deepEqual(crept, [["all-way stop", "first", true]]);
  // nor again when the route ends beside the line (the audit then reads the stop from the lane)
  const ended = setup({ x: egoX(0.8), v: 0 });
  arrive(ended, npc(ended, "first", "s", 0.8), "s_in", -5);
  stopAtLine(ended);
  const again = [];
  for (let k = 0; k < 90; k++) {
    if (k === 45) ended.route = null;
    const v = k < 45 ? 0.8 : k < 60 ? 0 : 2;   // over the line, stop past it, route ends, go
    ended.ego.v = v; ended.ego.x += v / 30; ended.tick++; ended.t += 1 / 30;
    refresh(ended); ended.audit(1 / 30, ended.roadInfo());
    again.push(...ended.events.filter((e) => e.type === "failed_to_yield").map((e) => e.with));
  }
  assert.deepEqual(again, ["first"]);
  // but a new placement before the same stop starts a new visit, which counts again
  ended.route = new Route(STRAIGHT, map);
  ended.placeOnLane(map.lane("w_in", 0), LINE - FRONT - 0.8);
  stopAtLine(ended);
  const replaced = [];
  for (let k = 0; k < 45; k++) {
    ended.ego.v = 2; ended.ego.x += 2 / 30; ended.tick++; ended.t += 1 / 30;
    refresh(ended); ended.audit(1 / 30, ended.roadInfo());
    replaced.push(...ended.events.filter((e) => e.type === "failed_to_yield").map((e) => e.with));
  }
  assert.deepEqual(replaced, ["first"]);
  console.log("✓ going out of turn at an all-way stop counts as a failure to yield once, also after a stop made past the line; on the car's turn it does not");
}

{
  // Without a route the driver's indicator supplies the turn. A left turn that stopped first
  // holds an opposing straight-going car; on a tie the left turn waits instead.
  for (const [signal, delay, egoGoes, otherGoes] of [["left", 2, true, false], ["left", 0.5, false, true], [null, 2, true, true], ["right", 2, true, true]]) {
    const world = setup({ x: egoX(0.8), v: 0 });
    world.route = null;
    world.ego.signal = signal;
    stopAtLine(world);
    const other = npc(world, "opposite", "e", 0.8);
    arrive(world, other, "e_in", world.allWay.status(world.ego, world).arrived + delay);
    assert.deepEqual([world.allWay.status(world.ego, world).go, world.allWay.status(other, world).go], [egoGoes, otherGoes], `manual ${signal}, arrival gap ${delay}`);
    // Changing the indicator at the line updates the queue too.
    world.ego.signal = signal === "left" ? null : "left";
    world.audit(1 / 30, world.roadInfo());
    assert.equal(world.allWay.status(other, world).go, signal === "left" || delay < TIE_S);
  }
  const routed = setup({ x: egoX(0.8), v: 0, route: LEFT });
  routed.ego.signal = "right";
  stopAtLine(routed);
  const other = npc(routed, "opposite", "e", 0.8);
  arrive(routed, other, "e_in", routed.allWay.status(routed.ego, routed).arrived + 2);
  assert.equal(routed.allWay.status(other, routed).go, false, "the route's left turn takes precedence over an indicator");
  console.log("✓ manual left turns use the indicator for all-way priority, while routed turns use the route");
}

{
  // Sensing retains a left-turn stop after the audit has cleared its stop memory, to check for
  // oncoming traffic. An old line behind the car must not hide a stall (Toronto s1-2).
  const two = junction({ allWay: false });
  const world = setup({ x: egoX(0.8), v: 0, on: two.map, route: two.routeData("n_out") });
  stopAtLine(world);
  const s = world.route.controls[0].sRoute + 16 - FRONT;
  const [x, y] = world.route.pointAt(s);
  Object.assign(world.ego, { x, y, psi: world.route.headingAt(s), v: 0 });
  world._road = world.roadInfo();
  world.audit(1 / 30, world._road);
  const snap = buildSnapshot(world);
  assert.equal(snap.intersection?.control, "stop", "left-turn stop remains in sensing");
  assert.ok(snap.intersection.bumper_to_line_m < -12);
  assert.equal(snap.intersection.stop_completed, false, "audit has cleared the old stop memory");
  assert.equal(snap.intersection.oncoming, null);
  assert.ok(snap.target.v > 2, "the road ahead permits progress");
  const detector = new DeadlockDetector();
  detector.update(world, snap, 13);
  assert.ok(world.stuckFor > 12, "a stall past the old line permits deadlock recovery");
  // A real oncoming conflict still resets the timer, even after clearing the stop line.
  snap.intersection.oncoming = { bumper_to_yield_m: 1 };
  detector.update(world, snap, 1);
  assert.equal(world.stuckFor, 0, "yielding to oncoming traffic remains a legitimate wait");
  // An incomplete stop at the line or a small overshoot also remains a legitimate wait.
  snap.intersection.oncoming = null;
  for (const bumper of [1, -2.5]) {
    snap.intersection.bumper_to_line_m = bumper;
    detector.update(world, snap, 13);
    assert.equal(world.stuckFor, 0, `still stopping at line distance ${bumper}`);
  }
  console.log("✓ a retained stop behind the car permits stall recovery, while stops and oncoming waits still hold");
}

// closed loop with real traffic drivers
function drive(world, fleet, { seconds = 40, watch = () => {} } = {}) {
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const dt = 1 / 30;
  for (let i = 0; i < seconds / dt && world.route; i++) {
    stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    watch(world, autopilot);
  }
  return autopilot;
}
function withFleet(world) {
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  fleet.nextPull = fleet.nextPark = 1e9;
  return fleet;
}
// the order vehicles enter the junction (front within 5 m of the centre), and any two from
// crossing approaches inside it together
function junctionLog(world) {
  const log = { order: [], overlaps: 0 };
  return Object.assign(log, { watch(w) {
    const inside = [w.ego, ...w.npcs].filter((n) => Math.hypot(n.front[0], n.front[1]) < 5);
    for (const n of inside) if (!log.order.includes(n.id ?? "ego")) log.order.push(n.id ?? "ego");
    for (const a of inside) for (const b of inside) {
      const d = Math.abs(Math.abs(((a.psi - b.psi) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) - Math.PI / 2);
      if (a !== b && d < Math.PI / 4 && Math.abs(a.v) > 0.3 && Math.abs(b.v) > 0.3) log.overlaps++;
    }
  } });
}

{
  // a car from the right stops just before the car and is slow to move off: it goes first all the same
  const world = setup({ x: egoX(30), v: 6 });
  const fleet = withFleet(world);
  npc(world, "from_right", "s", 22, { v: 6, fleet, react: 5 });
  const log = junctionLog(world);
  let waited = 0;
  drive(world, fleet, { watch: (w, ap) => { log.watch(w); if (w.ego.v < 0.1 && ap.snap?.intersection?.priority?.arrived && !ap.snap.intersection.priority.go) waited += 1 / 30; } });
  assert.deepEqual(log.order, ["from_right", "ego"]);
  assert.equal(log.overlaps, 0, "never in the junction together");
  assert.ok(waited > 0.3, `waited its turn for ${waited.toFixed(1)} s`);
  assert.deepEqual([world.violations.collisions, world.violations.failed_to_yield, world.violations.stop_signs_run, world.violations.deadlock_overrides], [0, 0, 0, 0]);
  assert.ok(world.route === null, "arrived");
  console.log(`✓ Rules waits ${waited.toFixed(1)} s for a car that stopped first on its right, then goes and arrives`);
}

{
  // the car stops first: traffic arriving after it, on its right, left and ahead, waits for it
  for (const [arm, exit] of [["s", "n_out"], ["n", "s_out"], ["e", "s_out"]]) {
    const world = setup({ x: egoX(12), v: 5, route: LEFT });
    const fleet = withFleet(world);
    npc(world, `from_${arm}`, arm, 40, { v: 7, exit, fleet });
    const log = junctionLog(world);
    drive(world, fleet, { watch: log.watch });
    assert.deepEqual(log.order, ["ego", `from_${arm}`], `traffic from ${arm}`);
    assert.equal(log.overlaps, 0);
    assert.deepEqual([world.violations.collisions, world.violations.failed_to_yield], [0, 0]);
    assert.ok(world.route === null, "arrived");
  }
  console.log("✓ traffic that stops after the car, on any side, waits while the car turns left");
}

{
  // four arrivals close together: everyone gets through, none in the junction with crossing traffic
  const world = setup({ x: egoX(25), v: 6, route: LEFT });
  const fleet = withFleet(world);
  npc(world, "south", "s", 24, { v: 6, fleet });
  npc(world, "east", "e", 26, { v: 6, fleet, exit: "s_out" });
  npc(world, "north", "n", 28, { v: 6, fleet, exit: "e_out" });
  const log = junctionLog(world);
  drive(world, fleet, { seconds: 60, watch: log.watch });
  assert.equal(log.order.length, 4, log.order.join(" "));
  assert.equal(log.overlaps, 0);
  assert.deepEqual([world.violations.collisions, world.violations.failed_to_yield, world.violations.deadlock_overrides], [0, 0, 0]);
  assert.ok(world.route === null, "arrived");
  console.log(`✓ four vehicles arriving together all get through in turn (${log.order.join(", ")})`);
}

{
  // a left turn at a two-way stop: an oncoming car pulling away from its own stop is waited for
  const two = junction({ allWay: false }), route = two.routeData("n_out");
  const world = setup({ x: egoX(0.8), v: 0, on: two.map, route });
  stopAtLine(world);
  const p = pointAt(two.map.lane("e_in", 0).pts, two.map.lane("e_in", 0).cum, LINE - 3);
  world.npcs = [Object.assign(new Vehicle(p[0], p[1], Math.PI, 3), { id: "oncoming", a: 1.5 })];
  const { snap, eligible, rejected } = decide(world);
  assert.equal(snap.intersection.turn, "left");
  assert.equal(snap.intersection.oncoming?.id, "oncoming");
  assert.ok(rejected.fails_to_yield_to_oncoming > 0, JSON.stringify(rejected));
  assert.equal(new RulesBrain().decideSync(snap, eligible).candidateId, "stop_for_oncoming");
  const state = toJevState(snap, eligible, {}, "test");
  assert.equal(state.intersection.turn, "left");
  assert.ok(situationClauses(snap).some((c) => c.includes("oncoming traffic has the right of way")));
  // before the stop is made, the stop comes first
  const approaching = setup({ x: egoX(10), on: two.map, route, v: 5 });
  approaching.npcs = world.npcs;
  assert.equal(decide(approaching).snap.intersection.oncoming, null);
  // going straight it does not wait
  const ahead = setup({ x: egoX(0.8), v: 0, on: two.map, route: two.routeData("e_out") });
  stopAtLine(ahead);
  ahead.npcs = world.npcs;
  assert.equal(decide(ahead).snap.intersection.oncoming, null);
  console.log("✓ turning left at a stop sign, the car waits for an oncoming car pulling away, once its own stop is made");
}

{
  // the audit: turning left at a stop sign in front of an oncoming car fails to yield
  const two = junction({ allWay: false });
  const world = setup({ x: egoX(0.8), v: 0, on: two.map, route: two.routeData("n_out") });
  stopAtLine(world);
  const path = world.route, lane = two.map.lane("e_in", 0), s0 = LINE + 8 - 22, p = pointAt(lane.pts, lane.cum, s0);
  const other = new Vehicle(p[0], p[1], Math.PI, 8);
  other.id = "oncoming"; other.path = new NpcPath(two.map, rng(1)); other.path.start("e_in", 0, s0, [["w_out", 0]]);
  world.npcs = [other];
  let events = [], s = path.project(world.ego.x, world.ego.y).s;
  for (let k = 0; k < 90; k++) {
    s += 6 / 30;
    const [x, y] = path.pointAt(s);
    Object.assign(world.ego, { x, y, psi: path.headingAt(s), v: 6 });
    other.path.s += other.v / 30; const [ox, oy] = other.path.pointAt(other.path.s); Object.assign(other, { x: ox, y: oy, psi: other.path.headingAt(other.path.s) });
    world.tick++; world.t += 1 / 30;
    world.audit(1 / 30, world.roadInfo());
    events = events.concat(world.events.filter((e) => e.type === "failed_to_yield"));
  }
  assert.deepEqual(events.map((e) => [e.to, e.with]), [["oncoming traffic", "oncoming"]]);
  console.log("✓ turning left at a stop sign in front of an oncoming car counts as a failure to yield");
}

{
  // Real maps: traffic alone, many cars, at The Annex's all-way stops (Toronto has the most). Two
  // cars from crossing approaches (read from their paths) are never both moving in a junction box,
  // and the queues drain.
  const real = new MapData(JSON.parse(fs.readFileSync(new URL("../data/maps/4a96d42cb3f2.v6.pack.json", import.meta.url))));
  const world = new World(real, { parked: 0, pedestrians: 0 });
  world.ego.x = 1e5; world.ego.y = 1e5;   // out of the way
  const fleet = new NpcFleet(world, { count: 120, bikes: 0, seed: 11 });
  fleet.nextPull = fleet.nextPark = 1e9;
  const junctions = new Map();
  for (const st of real.stops.values()) if (st.all_way) junctions.set(st.junction, real.nodes.get(st.junction));
  let together = 0, entries = 0, longest = 0;
  const seen = new Set();
  const dt = 1 / 20;
  for (let k = 0; k < 180 / dt; k++) {
    fleet.step(dt); world.t += dt; world.tick++;
    for (const node of junctions.values()) {
      const inside = fleet.vehicles.filter((n) => Math.hypot(n.x - node.x, n.y - node.y) < 6 && n.v > 0.5);
      for (const n of inside) if (!seen.has(`${n.id}@${node.id}`)) { seen.add(`${n.id}@${node.id}`); entries++; }
      const from = (n) => n.path.edges.find((e) => e.to === node.id && e.sEnd > n.path.s - 25);
      for (const a of inside) for (const b of inside) if (a.id < b.id && from(a) && from(b)) {
        const rel = Math.abs(wrapAngle(real.headingIn(from(a).id) - real.headingIn(from(b).id)));
        if (rel > Math.PI / 4 && rel < Math.PI * 3 / 4) together++;
      }
    }
    for (const e of world.allWay.entries.values()) longest = Math.max(longest, world.t - e.arrived);
  }
  assert.ok(entries > 100, `${entries} entries into all-way junctions`);
  assert.equal(together, 0, `${together} ticks with crossing cars moving in a junction together`);
  assert.ok(longest < 30, `the longest wait in a queue was ${longest.toFixed(1)} s`);
  console.log(`✓ in 3 minutes of Toronto traffic, ${entries} entries into all-way stops, never two crossing cars moving inside together (longest wait ${longest.toFixed(1)} s)`);
}

console.log("All all-way stop checks passed.");
