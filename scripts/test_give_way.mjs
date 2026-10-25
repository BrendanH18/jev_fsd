// Giving way where there is no signal: at a two-way stop once the stop is made, and at junctions
// without a sign, where traffic gives way to the right or to the larger road. The rules
// (sim/priority.js), what the car senses, creeping forward to look past a building, what models are
// told, traffic giving way, closed-loop drives and the audit.
// node --experimental-default-type=module scripts/test_give_way.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { StopMemory, phaseOf } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { outranks, levelOf, approachTo } = await import("../static/js/sim/priority.js");
const { buildSnapshot, PEEK_MPS } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { buildLlmPrompt } = await import("../static/js/brain/llm-prompt.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { rng } = await import("../static/js/common.js");

// Two-way streets crossing at the origin, one lane each way 3.2 m wide. `stops` lists the arms with
// a stop sign (line 8 m before the centre); `cls` gives each arm's road class; `corner` puts a
// building on the south-west corner, 7.5 m from both centre lines, hiding the street to the
// south from the stop line but not from 3 m further on. The car comes from the west (travel +x,
// its lane at y = -1.6). Arms: w, e, n, s.
const ARM = 150, LINE = ARM - 8, HALF = 1.6;
const ARMS = { w: 180, e: 0, n: 90, s: -90 };
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
function junction({ stops = [], cls = {}, corner = false, intersections = [] } = {}) {
  const ends = { c: [0, 0] }, edges = [], lanes = [], stopList = [];
  for (const [arm, deg] of Object.entries(ARMS)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const [arm] of Object.entries(ARMS)) for (const [id, from, to, inbound] of [[`${arm}_in`, arm, "c", true], [`${arm}_out`, "c", arm, false]]) {
    const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
    const signed = inbound && stops.includes(arm);
    if (signed) stopList.push({ id: `stop_${arm}`, edge: id, s_line: LINE, all_way: false, junction: "c" });
    edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-3.2, 3.2], parking: [0, 0],
      cls: cls[arm] || "residential", limit: 11.1, oneway: false, name: arm === "w" || arm === "e" ? "West Street" : "North Street",
      ...(signed ? { control: { type: "stop", id: `stop_${arm}`, s_line: LINE, all_way: false } } : {}) });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
  }
  const buildings = corner ? [{ pts: [[-60, -60], [-7.5, -60], [-7.5, -7.5], [-60, -7.5]], h: 10 }] : [];
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })), intersections, stops: stopList, buildings });
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
const FRONT = (() => { const c = new Vehicle(0, 0, 0, 0); return c.spec.length - c.spec.rearOverhang; })();
// where the car's front bumper is at x = `front`
const egoX = (front) => front - FRONT;

function setup(j, { front = -30, v = 6, exit = "e_out" } = {}) {
  setWeather("dry");
  const world = new World(j.map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: egoX(front), y: -HALF, psi: 0, v });
  world.resetContactHistory();
  world.route = new Route(j.routeData(exit), j.map);
  world.destination = world.route.endPoint();
  world.npcs = [];
  world._road = world.roadInfo();
  return world;
}
// A traffic car on `arm`'s inbound lane with its front bumper `toCentre` metres from the junction's
// centre, going straight on unless `exit` says otherwise. With a fleet, it drives itself.
function npc(world, id, arm, toCentre, { v = 0, exit = null, fleet = null, react = 0.5 } = {}) {
  const lane = world.map.lane(`${arm}_in`, 0), s = ARM - toCentre - FRONT, p = pointAt(lane.pts, lane.cum, s);
  const n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
  const out = exit || { w: "e_out", e: "w_out", n: "s_out", s: "n_out" }[arm];
  Object.assign(n, { id, v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
  n.path = new NpcPath(world.map, fleet?.random || rng(1));
  n.path.start(`${arm}_in`, 0, s, [[out, 0]]);
  (fleet ? fleet.vehicles : world.npcs).push(n);
  return n;
}
function decide(world) {
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  return { snap, candidates, ...simulateAll(candidates, snap, world) };
}
// Stop the car with its front at x = `front` for a second, as the audit sees it.
function stopAt(world, front) {
  Object.assign(world.ego, { x: egoX(front), v: 0 });
  world.resetContactHistory();
  for (let i = 0; i < 30; i++) { world.tick++; world.t += 1 / 30; world.audit(1 / 30, world.roadInfo()); }
  world._road = world.roadInfo();
}
const rules = new RulesBrain();

const EQUAL = junction();
const TWO_WAY = junction({ stops: ["w", "e"] });
const BLIND = junction({ stops: ["w", "e"], corner: true });
const MINOR = junction({ cls: { n: "secondary", s: "secondary" } });

{
  // the rules themselves
  const eq = EQUAL.map.priorityOf("w_in");
  assert.deepEqual([eq.type, eq.rule, eq.junction], ["uncontrolled", "equal", "c"]);
  assert.ok(Math.abs(eq.s_line - (ARM - 6.6)) < 1e-6, "the line sits 3.4 m short of the crossing road's asphalt");
  assert.equal(TWO_WAY.map.priorityOf("w_in"), null, "a stop sign is its own control");
  assert.equal(TWO_WAY.map.priorityOf("n_in").rule, "major", "the through road of a two-way stop");
  assert.equal(MINOR.map.priorityOf("w_in").rule, "minor");
  assert.equal(MINOR.map.priorityOf("n_in").rule, "major");
  assert.equal(EQUAL.map.priorityOf("w_out"), null, "an edge leading to a dead end is not at a junction");
  const m = EQUAL.map;
  assert.ok(outranks(m, "s_in", "w_in") && !outranks(m, "w_in", "s_in"), "from the right goes first");
  assert.ok(!outranks(m, "n_in", "w_in") && outranks(m, "w_in", "n_in"), "from the left gives way");
  assert.ok(!outranks(m, "e_in", "w_in"), "opposite directions do not cross");
  assert.ok(outranks(TWO_WAY.map, "n_in", "w_in") && outranks(TWO_WAY.map, "s_in", "w_in"), "the through road goes first both ways");
  assert.ok(outranks(MINOR.map, "n_in", "w_in") && !outranks(MINOR.map, "w_in", "s_in"));
  assert.deepEqual(["w_in", "n_in"].map((id) => levelOf(TWO_WAY.map, id)), [0, 1]);
  // between streets without a sign, the class decides, however many classes meet there
  const three = junction({ cls: { n: "tertiary", s: "secondary" } }).map;
  assert.ok(outranks(three, "n_in", "w_in") && !outranks(three, "w_in", "n_in"), "a tertiary road from the left goes before a residential one");
  assert.ok(outranks(three, "s_in", "w_in") && !outranks(three, "s_in", "n_in"), "opposite directions do not cross");
  // two streets of the same class crossing still give way to the right, even where a smaller one
  // also meets them
  const mains = junction({ cls: { w: "secondary", e: "secondary", s: "secondary" } }).map;
  assert.equal(mains.priorityOf("w_in").rule, "equal");
  assert.ok(outranks(mains, "s_in", "w_in") && !outranks(mains, "w_in", "s_in"));
  assert.equal(mains.priorityOf("n_in").rule, "minor");
  // a signal further along a street does not take the right of way away from the junction at its start
  const before = junction({ intersections: [{ id: "sig", x: ARM, y: 0, vertices: ["e"], approaches: [{ edge: "e_out", group: "A", s_line: ARM - 8 }], offset_s: 0 }] }).map;
  assert.equal(before.priorityOf("w_in")?.rule, "equal");
  // a route records a junction without a sign where it gives way, and where it turns left from the
  // major road; not where it goes straight on along it
  assert.deepEqual(new Route(EQUAL.routeData("e_out"), m).controls.map((c) => [c.control.type, c.control.rule, c.turn]), [["uncontrolled", "equal", "straight"]]);
  const major = junction({ cls: { w: "secondary", e: "secondary" } });
  assert.equal(new Route(major.routeData("e_out"), major.map).controls.length, 0);
  assert.deepEqual(new Route(major.routeData("n_out"), major.map).controls.map((c) => [c.control.rule, c.turn]), [["major", "left"]]);
  console.log("✓ junctions without a sign give way to the right or to the larger road; a two-way stop's through road goes first");
}

{
  // approaching a junction without a sign: a car from the right that would get there first holds
  // the car at the line; one from the left gives way to it
  const world = setup(EQUAL, { front: -20, v: 8 });
  npc(world, "from_right", "s", 30, { v: 9 });
  const { snap, eligible, rejected } = decide(world);
  const g = snap.intersection.give_way;
  assert.equal(snap.intersection.control, "uncontrolled");
  assert.equal(g.wait_for?.id, "from_right");
  assert.ok(Math.abs(g.hold_s_route - snap.intersection.s_line_route) < 1e-9, "it waits at the line");
  assert.ok(snap.target.reasons.includes("giving way"));
  assert.ok(rejected.fails_to_yield > 0, JSON.stringify(rejected));
  assert.ok(eligible.every((c) => c.sim.progress_m < snap.intersection.bumper_to_line_m + 0.5));
  const left = setup(EQUAL, { front: -20, v: 8 });
  npc(left, "from_left", "n", 30, { v: 9 });
  const l = decide(left).snap.intersection.give_way;
  assert.equal(l.wait_for, null, "the car from the left gives way");
  // whoever has the right of way, a car about to arrive is waited for
  const close = setup(EQUAL, { front: -8, v: 2 });
  npc(close, "from_left", "n", 12, { v: 9 });
  assert.equal(decide(close).snap.intersection.give_way.wait_for?.id, "from_left");
  // a car that has passed is not waited for, nor one that is far enough away
  const far = setup(EQUAL, { front: -20, v: 8 });
  npc(far, "far", "s", 85, { v: 9 });
  assert.equal(decide(far).snap.intersection.give_way.wait_for, null);
  console.log("✓ without a sign the car gives way to a car from the right, and to any car about to arrive");
}

{
  // a two-way stop: once the stop is made, the through road is waited for in both directions
  const world = setup(TWO_WAY, { front: -8.5, v: 0 });
  stopAt(world, -8.5);
  npc(world, "through", "n", 40, { v: 10 });
  const { snap, eligible } = decide(world);
  assert.ok(snap.intersection.stop_completed);
  assert.equal(snap.intersection.give_way.wait_for?.id, "through");
  assert.equal(snap.target.v, 0);
  assert.ok(eligible.every((c) => !c.sim.crosses_stop_line && c.sim.progress_m < 1));
  assert.equal(rules.decideSync(snap, eligible).motion, "stop");
  world.npcs = [];
  const clear = decide(world);
  assert.ok(clear.snap.intersection.give_way.go && clear.snap.intersection.give_way.view_clear);
  assert.ok(clear.eligible.some((c) => c.sim.progress_m > 2));
  assert.equal(rules.decideSync(clear.snap, clear.eligible).motion, "drive");
  console.log("✓ at a two-way stop the car waits for through traffic from either side, then goes");
}

{
  // a building hides the street to the right: the car creeps forward to look, stops where it can
  // see, then goes if nothing is coming
  const world = setup(BLIND, { front: -8.5, v: 0 });
  stopAt(world, -8.5);
  const { snap, eligible } = decide(world);
  const g = snap.intersection.give_way;
  assert.ok(snap.intersection.stop_completed);
  assert.equal(g.view_clear, false);
  assert.ok(g.sight_m < 30, `sees ${g.sight_m} m`);
  assert.ok(Math.abs(g.peek_s_route - (world.route.controls[0].sJunction - 3.5)) < 0.6, "it looks from 0.3 m short of the crossing road");
  assert.ok(snap.target.v <= PEEK_MPS + 1e-9 && snap.target.v > 0, `creeps at ${snap.target.v}`);
  assert.ok(snap.target.reasons.includes("looking for traffic"));
  const creep = eligible.find((c) => c.id === "creep_to_look");
  assert.ok(creep, eligible.map((c) => c.id).join());
  assert.equal(rules.decideSync(snap, eligible).candidateId, "creep_to_look");
  // crept up to the point it looks from: it can see now, and nothing is coming
  stopAt(world, -3.6);
  const there = decide(world).snap.intersection.give_way;
  assert.ok(there.go && there.view_clear, JSON.stringify({ go: there.go, view: there.view_clear, sight: there.sight_m }));
  console.log("✓ at a two-way stop where a building hides the through road, the car creeps forward to look, then goes");
}

{
  // with the view still hidden at the point it looks from, a stop there lets it go
  const deep = junction({ stops: ["w", "e"] });
  const world = setup(deep, { front: -3.6, v: 0 });
  stopAt(world, -8.5);
  Object.assign(world.ego, { x: egoX(-3.6), v: 0 });
  world.visibility.occluded = () => true;
  const g = decide(world).snap.intersection.give_way;
  assert.ok(g.peeked && g.go && g.view_clear === false);
  world.ego.v = 1;
  assert.equal(decide(world).snap.intersection.give_way.go, false, "still moving: not yet stopped to look");
  // once it has stopped there (as the audit records it), moving off does not make it stop again
  stopAt(world, -3.6);
  assert.equal(world.egoPeek, world.route.controls[0].control.id);
  world.ego.v = 1;
  assert.ok(decide(world).snap.intersection.give_way.go, "it has looked, and goes");
  console.log("✓ stopped as far forward as it can look from, the car goes even if a building still hides the street");
}

{
  // short of the point it looks from, a manoeuvre may stop up to 1 m past it, but not roll on past it
  const deep = junction({ stops: ["w", "e"] });
  const world = setup(deep, { front: -5.5, v: 0 });
  stopAt(world, -8.5);
  Object.assign(world.ego, { x: egoX(-5.5), v: 0 });
  world.visibility.occluded = () => true;
  const { snap, eligible } = decide(world);
  const g = snap.intersection.give_way;
  assert.ok(!g.go && !g.peeked && g.bumper_to_hold_m > 1.5);
  assert.ok(eligible.some((c) => c.id === "creep_to_look"));
  const rolls = eligible.filter((c) => c.sim.end_speed > 0.2 && c.sim.progress_m > g.bumper_to_hold_m + 0.2).map((c) => c.id);
  assert.deepEqual(rolls, [], "no eligible manoeuvre passes it still moving");
  console.log("✓ a manoeuvre may stop just past the point it looks from, but not drive on past it");
}

{
  // a smaller road meeting a bigger one without a sign: the car gives way to the bigger road's
  // traffic from both sides, without having to stop
  const world = setup(MINOR, { front: -20, v: 8 });
  npc(world, "main_left", "n", 35, { v: 11 });
  assert.equal(decide(world).snap.intersection.give_way.wait_for?.id, "main_left");
  const empty = setup(MINOR, { front: -20, v: 8 });
  const e = decide(empty);
  assert.ok(e.snap.intersection.give_way.go && e.snap.target.v > 7);
  console.log("✓ on a smaller road meeting a bigger one, the car gives way to traffic from both sides");
}

{
  // what decision models and LLMs see
  const world = setup(EQUAL, { front: -20, v: 8 });
  npc(world, "from_right", "s", 30, { v: 9 });
  const { snap, candidates, eligible } = decide(world);
  const state = toJevState(snap, candidates, {}, "test");
  assert.equal(state.intersection.control, "uncontrolled");
  assert.equal(state.intersection.right_of_way, "no sign: give way to traffic from the right");
  assert.deepEqual([state.intersection.give_way.clear, state.intersection.give_way.wait_for], [false, "from_right"]);
  const clause = situationClauses(snap).find((c) => c.includes("no sign or signal"));
  assert.ok(clause && clause.includes("`from_right` has the right of way") && clause.includes("from the right"), clause);
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.stop.includes("`intersection.give_way.stop_in_m` under 2"));
  const { messages } = buildLlmPrompt(snap, { state, questions });
  assert.ok(messages[0].content.includes("`creep_to_look`"));
  // creeping to look
  const blind = setup(BLIND, { front: -8.5, v: 0 });
  stopAt(blind, -8.5);
  const b = decide(blind);
  const bs = toJevState(b.snap, b.candidates, {}, "test").intersection.give_way;
  assert.equal(bs.view, "hidden by buildings");
  assert.ok(bs.candidates === undefined);
  assert.ok(situationClauses(b.snap).some((c) => c.includes("buildings hide the through road") && c.includes("`creep_to_look`")));
  assert.ok(toJevState(b.snap, b.candidates, {}, "test").candidates.some((c) => c.id === "creep_to_look"));
  // the major road: nothing to give way to, unless turning left across oncoming traffic
  const major = junction({ cls: { w: "secondary", e: "secondary" } });
  const left = setup(major, { front: -20, v: 8, exit: "n_out" });
  npc(left, "oncoming", "e", 30, { v: 10 });
  const ls = decide(left);
  assert.equal(ls.snap.intersection.give_way, null);
  assert.equal(ls.snap.intersection.oncoming?.id, "oncoming");
  assert.equal(toJevState(ls.snap, ls.candidates, {}, "test").intersection.turn, "left");
  console.log("✓ models get the right of way, whom the car gives way to, what it cannot see, and a situation line");
}

{
  // the audit: past the line, entering the path of a car with the right of way due within 2 s
  // fails to yield, seen or not; a car from the left at a junction without a sign does not count
  const run = (j, arm, toCentre, { front = -8.5, stop = false, late = false } = {}) => {
    const world = setup(j, { front, v: 0 });
    if (stop) stopAt(world, front);
    const other = npc(world, "other", arm, toCentre, { v: 10 });
    // (`late`: it joins the street only once the car has crossed its line, as a car pulling out does)
    if (late) world.npcs = [];
    world.visibility.sees = () => false;
    const out = [];
    for (let k = 0; k < 60; k++) {
      world.ego.v = 5; world.ego.x += 5 / 30; world.tick++; world.t += 1 / 30;
      if (late && k === 6) world.npcs = [other];
      other.path.s += 10 / 30;
      const [x, y] = other.path.pointAt(other.path.s);
      Object.assign(other, { x, y, psi: other.path.headingAt(other.path.s) });
      world.audit(1 / 30, world.roadInfo());
      out.push(...world.events.filter((e) => e.type === "failed_to_yield").map((e) => [e.to, e.with]));
    }
    return out;
  };
  assert.deepEqual(run(TWO_WAY, "n", 22, { stop: true }), [["through traffic", "other"]]);
  assert.deepEqual(run(TWO_WAY, "n", 60, { stop: true }), [], "far enough away");
  assert.deepEqual(run(TWO_WAY, "n", 22, { stop: true, late: true }), [], "it joined after the car had crossed its line");
  assert.deepEqual(run(EQUAL, "s", 22), [["traffic from the right", "other"]]);
  assert.deepEqual(run(EQUAL, "n", 22), [], "from the left it is the other car that gives way");
  assert.deepEqual(run(MINOR, "n", 22), [["through traffic", "other"]]);
  console.log("✓ pulling out in front of traffic with the right of way counts as a failure to yield, seen or not");
}

{
  // The shared emergency brake keeps steering along the manoeuvre's path. Braking for a car stopped
  // just off the path partway round a left turn, a held wheel would carry the car on into it.
  const world = setup(EQUAL, { front: -5, v: 7, exit: "n_out" });
  const s = world.route.project(world.ego.x, world.ego.y).s + 6, [x, y] = world.route.pointAt(s);
  Object.assign(world.ego, { x, y, psi: world.route.headingAt(s) - 0.15, delta: 0, v: 7 });
  world.resetContactHistory(); world._road = world.roadInfo();
  const ahead = (d, side) => [x + Math.cos(world.ego.psi) * d - Math.sin(world.ego.psi) * side, y + Math.sin(world.ego.psi) * d + Math.cos(world.ego.psi) * side];
  const [px, py] = ahead(9, 0.3);
  const parked = new Vehicle(px, py, world.ego.psi + Math.PI, 0);
  Object.assign(parked, { id: "standing", stopMem: new StopMemory(), frozen: 1e6, waiting: 0 });
  world.npcs.push(parked);
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules"; autopilot.setEnabled(true);
  const law = { kind: "lane", offset: 0, center: 0, vTarget: 7, s0: s - 3 };
  autopilot.executing = { candidate: { id: "keep_lane_target", law }, law, s0: s - 3 };
  autopilot.lastStart = Infinity;
  autopilot.step(1 / 30, 0);
  assert.equal(world.violations.safety_brakes, 1, "the emergency brake fires");
  assert.ok(world.ego.delta > 0.02, `and steers on round the turn (${world.ego.delta})`);
  console.log("✓ the emergency brake keeps steering along the path instead of holding the wheel");
}

{
  // A junction without a sign that asks nothing of the car does not hide a signal just beyond it,
  // in sensing or in the audit: here a crossroads without a sign, then a 30 m street to a signal.
  const pt = (x, y) => [x, y], N = { a: pt(-150, 0), c: pt(0, 0), d: pt(30, 0), e: pt(180, 0), n: pt(0, 150), s: pt(0, -150), dn: pt(30, 150), ds: pt(30, -150) };
  const signal = { type: "signal", id: "sig", s_line: 22, group: "A" };
  const legs = [["a_c", "a", "c"], ["c_d", "d", "d"], ["d_e", "d", "e"], ["n_c", "n", "c"], ["s_c", "s", "c"], ["c_n", "c", "n"], ["c_s", "c", "s"],
    ["dn_d", "dn", "d"], ["ds_d", "ds", "d"], ["d_dn", "d", "dn"], ["d_ds", "d", "ds"]].map(([id, from, to]) => [id, id === "c_d" ? "c" : from, to]);
  const edges = [], lanes = [];
  for (const [id, from, to] of legs) {
    const pts = [N[from], N[to]], [rx, ry] = right(...pts), length = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    const control = id === "c_d" ? signal : id === "dn_d" || id === "ds_d" ? { type: "signal", id: "sig", s_line: length - 8, group: "B" } : null;
    edges.push({ id, from, to, pts, length, lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-3.2, 3.2], parking: [0, 0], cls: "residential", limit: 11.1, oneway: false, name: id, ...(control ? { control } : {}) });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
  }
  const inter = { id: "sig", x: 30, y: 0, vertices: ["d"], approaches: [{ edge: "c_d", group: "A", s_line: 22 }, { edge: "dn_d", group: "B", s_line: 142 }, { edge: "ds_d", group: "B", s_line: 142 }], offset_s: 0 };
  const m = new MapData({ bbox: [0, 0, 1, 1], extent: [-170, -170, 200, 170], edges, lanes, nodes: Object.entries(N).map(([id, [x, y]]) => ({ id, x, y })), intersections: [inter], stops: [], buildings: [] });
  assert.equal(m.priorityOf("a_c")?.rule, "equal", "a 30 m street is not a link inside the signal's junction");
  const pts = resample(joinLanes(joinLanes(m.lane("a_c", 0).pts, m.lane("c_d", 0).pts), m.lane("d_e", 0).pts));
  const j = { map: m, routeData: () => ({ id: "through", polyline: pts, edges: ["a_c", "c_d", "d_e"], turns: [], start_s: 0, goal_s: 120 }) };
  const world = setup(j, { front: -2, v: 6 });
  assert.deepEqual(world.route.controls.map((c) => c.control.type), ["uncontrolled", "signal"]);
  let t = 0; while (phaseOf(m.intersections.get("sig"), t).A !== "red") t += 0.5;
  world.t = t;
  const i = decide(world).snap.intersection;
  assert.equal(i.control, "signal", "past the junction without a sign, the signal 24 m on is the one that counts");
  assert.equal(i.signal, "red");
  // lane changes still keep clear of the junction the car is in
  const near = decide(world).snap.control_line_m;
  assert.ok(Math.abs(near - (world.route.controls[0].sRoute - (world.route.project(world.ego.x, world.ego.y).s + FRONT))) < 1e-6 && near < 0, `nearest line ${near}`);
  // and the audit sees the car run it
  for (let k = 0; k < 150 && world.violations.red_lights_run === 0; k++) {
    world.ego.v = 8; world.ego.x += 8 / 30; world.tick++; world.t = t + k / 300;
    world.audit(1 / 30, world.roadInfo());
  }
  assert.equal(world.violations.red_lights_run, 1);
  console.log("✓ a junction without a sign does not hide a red light just beyond it");
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
// the order vehicles enter the junction (front within 5 m of the centre)
function entryOrder(world) {
  const order = [];
  return { order, watch(w) { for (const n of [w.ego, ...w.npcs]) if (Math.hypot(n.front[0], n.front[1]) < 5 && !order.includes(n.id ?? "ego")) order.push(n.id ?? "ego"); } };
}
const counts = (world) => [world.violations.collisions, world.violations.failed_to_yield, world.violations.stop_signs_run, world.violations.deadlock_overrides];

{
  // without a sign: a traffic car from the right goes first; one from the left gives way to the car
  for (const [arm, first] of [["s", "other"], ["n", "ego"]]) {
    const world = setup(EQUAL, { front: -45, v: 9 });
    const fleet = withFleet(world);
    npc(world, "other", arm, 47, { v: 9, fleet });
    const log = entryOrder(world);
    drive(world, fleet, { seconds: 30, watch: log.watch });
    assert.ok(world.route === null, `arrives (${arm})`);
    assert.equal(log.order[0], first, `${arm}: ${log.order.join()}`);
    assert.deepEqual(counts(world), [0, 0, 0, 0], `${arm}: ${counts(world).join()}`);
  }
  console.log("✓ closed loop without a sign: a car from the right goes first, a car from the left waits for the car");
}

{
  // at a blind two-way stop, a through car hidden by the building: the car stops, creeps to look,
  // sees it, waits, then goes
  const world = setup(BLIND, { front: -30, v: 6 });
  const fleet = withFleet(world);
  const through = npc(world, "through", "s", 120, { v: 10, fleet });
  const log = entryOrder(world);
  let crept = false;
  drive(world, fleet, { seconds: 40, watch: (w, a) => { log.watch(w); if (a.executing?.candidate?.id === "creep_to_look") crept = true; } });
  assert.ok(world.route === null, "arrives");
  assert.ok(crept, "crept forward to look");
  assert.equal(log.order[0], "through", log.order.join());
  assert.deepEqual(counts(world), [0, 0, 0, 0], counts(world).join());
  assert.ok(through.v > 5, "the through car kept going");
  console.log("✓ closed loop at a blind two-way stop: the car stops, creeps to look and lets the through car pass");
}

{
  // traffic gives way too: a traffic car on a smaller road waits for the car on the bigger one
  const world = setup(junction({ cls: { w: "secondary", e: "secondary" } }), { front: -40, v: 10 });
  const fleet = withFleet(world);
  const side = npc(world, "side", "s", 40, { v: 9, fleet });
  const log = entryOrder(world);
  drive(world, fleet, { seconds: 25, watch: log.watch });
  assert.equal(log.order[0], "ego", log.order.join());
  assert.deepEqual(counts(world), [0, 0, 0, 0]);
  assert.ok(side.x > -2 || side.y > -10, "and then goes");
  // approaching on the street from the car's left without a sign, a traffic car gives way to it
  const w2 = setup(EQUAL, { front: -40, v: 9 });
  const f2 = withFleet(w2);
  const l2 = npc(w2, "left", "n", 40, { v: 9, fleet: f2 });
  assert.equal(approachTo(w2.map, w2.ego, "c")?.edge, "w_in");
  const order2 = entryOrder(w2);
  let slowest = Infinity;
  drive(w2, f2, { seconds: 25, watch: (w) => { order2.watch(w); slowest = Math.min(slowest, l2.v); } });
  assert.equal(order2.order[0], "ego", order2.order.join());
  assert.ok(slowest < 3, `it slowed to ${slowest} m/s to let the car go`);
  console.log("✓ traffic on a smaller road, or from the car's left, gives way to the car");
}

console.log("All give-way checks passed.");
