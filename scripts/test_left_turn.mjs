// Left turns at a signal: oncoming traffic has the right of way. On a four-way signalled junction
// of two-way streets, the car turning left waits for an oncoming car that would arrive before it
// could clear, at the line or inside the junction, and goes once the gap is long enough. Also what
// models are told, the commit point, what does not count (an oncoming car signalling its own left
// turn, braking to stop, hidden by fog), one pulling away from its line, the audit, and a car caught
// in the junction by a red light.
// node --experimental-default-type=module scripts/test_left_turn.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt, headingAt, wrapAngle } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { phaseOf } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { buildLlmPrompt } = await import("../static/js/brain/llm-prompt.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { NpcPath } = await import("../static/js/sim/npc.js");
const { rng } = await import("../static/js/common.js");
const fs = await import("node:fs");

// Two-way streets crossing at the origin, one lane each way 3.2 m wide; stop lines 8 m before the
// centre. The car comes from the west (travel +x, its lane at y = -1.6) and turns left to go north
// (x = +1.6). Oncoming traffic comes from the east in the westbound lane (y = +1.6). `junction`
// also builds two lanes each way (the inner lanes at 1.6 m, the outer at 4.8 m) and arms at other
// angles (degrees counter-clockwise from east).
const ARM = 150, LINE = ARM - 8, HALF = 1.6;
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
const names = { w: "West Street", e: "West Street", n: "North Street", s: "North Street" };
const groups = { w: "A", e: "A", n: "B", s: "B" };
function junction({ count = 1, arms = { w: 180, e: 0, n: 90, s: -90 }, nodes = {}, streets = [] } = {}) {
  const ends = { c: [0, 0], ...nodes }, edges = [], lanes = [];
  for (const [arm, deg] of Object.entries(arms)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  const offsets = Array.from({ length: count }, (_, i) => HALF + i * 3.2);
  // each arm in and out of the junction, then any other streets (`streets`: [id, from, to])
  // (a street marked `approach` also comes into the signal)
  const all = Object.keys(arms).flatMap((arm) => [[`${arm}_in`, arm, "c", true, arm], [`${arm}_out`, "c", arm, false, arm]]).concat(streets.map(([id, from, to, approach]) => [id, from, to, !!approach, null]));
  {
    for (const [id, from, to, control, arm] of all) {
      const pts = [ends[from], ends[to]];
      const [rx, ry] = right(...pts);
      edges.push({ id, from, to, pts, length: Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), lanes: count, lane_width: 3.2, lane_offsets: offsets, asphalt: [-3.2 * count, 3.2 * count], parking: [0, 0],
        cls: "secondary", limit: 13.9, oneway: false, name: names[arm] || "Bent Street",
        ...(control ? { control: { type: "signal", id: "sig", s_line: Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) - 8, group: groups[arm] || "A" } } : {}) });
      offsets.forEach((o, idx) => lanes.push({ edge: id, idx, pts: pts.map(([x, y]) => [x + rx * o, y + ry * o]) }));
    }
  }
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })),
    intersections: [{ id: "sig", x: 0, y: 0, offset_s: 0, vertices: ["c"], approaches: Object.keys(arms).map((a) => ({ edge: `${a}_in`, group: groups[a] || "A", s_line: LINE }))
      .concat(streets.filter((st) => st[3]).map(([id, from]) => ({ edge: id, group: "A", s_line: Math.hypot(ends[from][0], ends[from][1]) - 8 }))) }],
    stops: [], buildings: [] });
  // the route turns from the west arm's inner lane into `exit`'s inner lane
  const routeData = (exit, dir) => {
    const polyline = resample(joinLanes(map.lane("w_in", 0).pts, map.lane(exit, 0).pts));
    return { id: `to_${exit}`, polyline, edges: ["w_in", exit], turns: dir ? [{ at_m: ARM, dir, street: names[exit[0]] }] : [], start_s: 0, goal_s: 120 };
  };
  return { map, routeData };
}
function resample(pts) {
  const cum = cumulative(pts), out = [];
  for (let s = 0; s < cum.at(-1); s += 1) out.push(pointAt(pts, cum, s));
  out.push(pts.at(-1));
  return out;
}
const { map, routeData } = junction();
const LEFT = routeData("n_out", "left"), STRAIGHT = routeData("e_out", null);
const green = phaseOf(map.intersections.get("sig"), 0).A === "green" ? 0 : null;
assert.equal(green, 0, "group A starts green");

function car(id, x, y, psi, v = 0) {
  const n = new Vehicle(x, y, psi, v);
  n.id = id;
  return n;
}
const oncoming = (x, v = 11, extra = {}) => Object.assign(car("oncoming", x, HALF, Math.PI, v), extra);
function setup({ x = -40, v = 8, npcs = [], route = LEFT, weather = "dry", t = 0, on = map } = {}) {
  setWeather(weather);
  const world = new World(on, { parked: 0, pedestrians: 0, weather });
  world.t = t;
  Object.assign(world.ego, { x, y: -HALF, psi: 0, v });
  world.route = new Route(route, on);
  world.destination = world.route.endPoint();
  world.npcs = npcs;
  world._road = world.roadInfo();
  return world;
}
function decide(world, executing = null) {
  const snap = buildSnapshot(world, executing);
  const candidates = sampleCandidates(snap, world);
  return { snap, candidates, ...simulateAll(candidates, snap, world) };
}
// Move the car along `path` at a steady speed, as a driver who ignores everyone else would, with
// traffic going straight on at its own speed, and audit every tick. Returns the failures to yield,
// with `armed` set when the car crossed a signal's line (so the audit actually ran).
function driveThrough(world, path, { speed = 6, seconds = 3 } = {}) {
  const dt = 1 / 30;
  let s = path.project(world.ego.x, world.ego.y).s, events = [], armed = false;
  for (let i = 0; i < seconds / dt; i++) {
    s += speed * dt;
    const [x, y] = path.pointAt(s);
    Object.assign(world.ego, { x, y, psi: path.headingAt(s), v: speed });
    for (const n of world.npcs) {
      // along its planned lanes when it has them, else straight on
      if (n.path) { n.path.s += n.v * dt; n.path.extend(); const [px, py] = n.path.pointAt(n.path.s); Object.assign(n, { x: px, y: py, psi: n.path.headingAt(n.path.s) }); }
      else { n.x += Math.cos(n.psi) * n.v * dt; n.y += Math.sin(n.psi) * n.v * dt; }
    }
    world.t += dt;
    world.audit(dt, world.roadInfo());
    armed ||= !!world.lastSignal;
    events = events.concat(world.events.filter((e) => e.type === "failed_to_yield"));
  }
  return Object.assign(events, { armed });
}

{
  const route = new Route(LEFT, map);
  assert.equal(route.controls.length, 1);
  assert.equal(route.controls[0].turn, "left");
  assert.ok(Math.abs(route.controls[0].sJunction - route.controls[0].sRoute - 8) < 2, `junction centre ${route.controls[0].sJunction} vs line ${route.controls[0].sRoute}`);
  assert.equal(new Route(STRAIGHT, map).controls[0].turn, "straight");
  console.log("✓ a route's signal knows the route turns left there and where the junction's centre is");
}

{
  // nothing coming: no wait
  const { snap } = decide(setup());
  assert.equal(snap.intersection.signal, "green");
  assert.equal(snap.intersection.turn, "left");
  assert.equal(snap.intersection.oncoming, null);
  console.log("✓ a left turn on a green with no oncoming traffic does not wait");
}

{
  // an oncoming car 45 m from the junction at 11 m/s (3.5 s): too soon to turn in front of it
  const world = setup({ x: -30, v: 8, npcs: [oncoming(45)] });
  const { snap, candidates, eligible, rejected } = decide(world);
  const o = snap.intersection.oncoming;
  assert.ok(o, "must yield");
  assert.equal(o.id, "oncoming");
  assert.ok(o.eta_s < o.need_s, `${o.eta_s} < ${o.need_s}`);
  assert.ok(o.yield_s_route > snap.intersection.s_line_route, "waits inside the junction, past the line");
  assert.ok(o.yield_s_route < world.route.controls[0].sJunction, "and short of the centre");
  // the car stops with its front corner clear of the oncoming lane
  const [, py] = world.route.pointAt(o.yield_s_route);
  assert.ok(py < HALF - 1.8, `yield point y=${py.toFixed(2)} is clear of the westbound lane`);
  assert.ok(snap.target.reasons.includes("oncoming traffic"));
  assert.ok(eligible.some((c) => c.id === "stop_for_oncoming"), candidates.map((c) => `${c.id}:${c.reject}`).join(" "));
  assert.ok(rejected.fails_to_yield_to_oncoming > 0, JSON.stringify(rejected));
  assert.ok(eligible.every((c) => c.sim.progress_m + snap.ego.front_m + snap.routeProj.s <= o.yield_s_route + 0.3 + 0.5));
  const choice = new RulesBrain().decideSync(snap, eligible);
  assert.equal(choice.candidateId, "stop_for_oncoming");
  console.log(`✓ an oncoming car due in ${o.eta_s.toFixed(1)} s (the turn needs ${o.need_s.toFixed(1)} s) makes the car wait in the junction, and Rules waits`);
}

{
  // what decision models and LLMs see
  const world = setup({ x: -30, v: 8, npcs: [oncoming(45)] });
  const { snap, candidates, eligible } = decide(world);
  const state = toJevState(snap, candidates, {}, "test");
  assert.equal(state.intersection.turn, "left");
  assert.equal(state.intersection.oncoming.id, "oncoming");
  assert.equal(state.intersection.oncoming.yield, true);
  assert.ok(state.intersection.oncoming.wait_in_m > 0);
  const clause = situationClauses(snap).find((c) => c.includes("oncoming traffic has the right of way"));
  assert.ok(clause && clause.includes("stop_for_oncoming"), clause);
  const { questions } = buildQuestions(snap, eligible);
  assert.ok(questions.motion.criteria.stop.includes("waits for oncoming traffic"));
  assert.ok(questions.vector.criteria.stop_for_oncoming.includes("short of oncoming traffic's path"));
  const { messages } = buildLlmPrompt(snap, { state, questions });
  assert.ok(messages[0].content.includes("`stop_for_oncoming`"));
  // the motion criteria are unchanged when no wait applies
  const plain = decide(setup({ x: -20 }));
  assert.ok(!buildQuestions(plain.snap, plain.eligible).questions.motion.criteria.stop.includes("oncoming"));
  assert.equal(toJevState(plain.snap, plain.candidates, {}, "test").intersection.oncoming, undefined);
  console.log("✓ models get the turn, the oncoming car, a situation line and a stop_for_oncoming candidate");
}

{
  // gaps that are long enough, and vehicles that do not count
  const far = decide(setup({ x: -12, v: 0, npcs: [oncoming(88)] })).snap.intersection.oncoming;
  assert.equal(far, null, "an oncoming car 7.5 s away leaves time to turn from the line");
  const turning = decide(setup({ x: -30, npcs: [oncoming(30, 11, { signal: "left" })] })).snap.intersection.oncoming;
  assert.equal(turning, null, "an oncoming car signalling its own left turn passes in front");
  // but a left indicator from the outer lane of two is a lane change: that car may come straight on
  const two = junction({ count: 2 });
  const changing = decide(setup({ x: -30, route: two.routeData("n_out", "left"), on: two.map, npcs: [Object.assign(car("changing", 30, HALF + 3.2, Math.PI, 11), { signal: "left" })] })).snap.intersection.oncoming;
  assert.equal(changing?.id, "changing", "a car changing lanes with its left indicator on is still waited for");
  const pullingOut = decide(setup({ x: -30, npcs: [oncoming(30, 4, { signal: "left", pull: { lat: 2, t: 1, T: 3.5, wait: 0, moving: true } })] })).snap.intersection.oncoming;
  assert.equal(pullingOut?.id, "oncoming", "a car pulling out of a parking spot signals the pull-out, not a left turn");
  const braking = decide(setup({ x: -30, npcs: [oncoming(45, 8, { a: -3 })] })).snap.intersection.oncoming;
  assert.equal(braking, null, "an oncoming car braking to stop short of the junction");
  const passed = decide(setup({ x: -30, npcs: [car("gone", -20, HALF, Math.PI, 11)] })).snap.intersection.oncoming;
  assert.equal(passed, null, "a car that has already gone through");
  const straight = decide(setup({ x: -30, route: STRAIGHT, npcs: [oncoming(45)] })).snap.intersection;
  assert.equal(straight.oncoming, null, "going straight does not yield to oncoming traffic");
  assert.equal(straight.turn, "straight");
  const red = decide(setup({ x: -30, npcs: [oncoming(45)], t: 40 })).snap.intersection;
  assert.equal(red.signal, "red");
  assert.equal(red.oncoming, null, "at a red the car stops at the line anyway");
  const fog = decide(setup({ x: -30, npcs: [oncoming(45)], weather: "fog" })).snap.intersection.oncoming;
  assert.equal(fog, null, "a car hidden by fog is not sensed");
  const foggy = decide(setup({ x: -10, v: 4, npcs: [oncoming(20, 8.8)], weather: "fog" })).snap.intersection.oncoming;
  assert.ok(foggy, "it is once it comes into view");
  setWeather("dry");
  console.log("✓ no wait for a long gap, an oncoming left turn (but a car pulling out from the curb is waited for), a braking car, a car already through, a straight route, a red, or a car hidden by fog");
}

{
  // an oncoming car pulling away from its own line on the green, signalling a right turn into the
  // street the car turns into: it is due sooner than its speed says
  const pulling = decide(setup({ x: -12, v: 0, npcs: [oncoming(12, 0.3, { a: 1.5, signal: "right" })] })).snap.intersection.oncoming;
  assert.equal(pulling?.id, "oncoming", "a car speeding up from its line is waited for");
  assert.ok(pulling.eta_s < 3, `due in ${pulling.eta_s.toFixed(1)} s`);
  assert.equal(decide(setup({ x: -12, v: 0, npcs: [oncoming(12, 0.3)] })).snap.intersection.oncoming, null, "one creeping at its line is not");
  const steady = decide(setup({ x: -30, npcs: [oncoming(45, 6)] })).snap.intersection.oncoming;
  const faster = decide(setup({ x: -30, npcs: [oncoming(45, 6, { a: 2 })] })).snap.intersection.oncoming;
  assert.ok(steady && faster && faster.eta_s < steady.eta_s - 1, "and speeding up makes a car due sooner");
  console.log("✓ an oncoming car pulling away from its line on the green is waited for, allowing for it speeding up");
}

{
  // the commit point: too fast and too close to stop short of the oncoming lane, the car carries on
  const world = setup({ x: -6, v: 7, npcs: [oncoming(30)] });
  const { snap } = decide(world);
  assert.equal(snap.intersection.oncoming, null);
  // but stopped right at the yield point it holds
  const held = decide(setup({ x: -6.3, v: 0, npcs: [oncoming(30)] }));
  assert.ok(held.snap.intersection.oncoming, "still waiting");
  assert.equal(new RulesBrain().decideSync(held.snap, held.eligible).motion, "stop");
  console.log("✓ a car that can no longer stop short of the oncoming lane carries on; one stopped at the wait point holds");
}

{
  // a car inside the junction when the light turns red is clearing it, not running the red
  const world = setup({ x: -6, v: 3, t: 40 });
  const { snap, eligible, rejected } = decide(world);
  assert.equal(snap.intersection.signal, "red");
  assert.ok(snap.intersection.entered);
  assert.ok(!rejected.runs_red, JSON.stringify(rejected));
  assert.ok(eligible.some((c) => c.sim.progress_m > 3), "drives on through");
  console.log("✓ a car caught in the junction by a red light clears it");
}

{
  // the turn comes from the streets either side of the junction, wherever the router measured its
  // turn instruction (its distances add up edge lengths, not the rounded polyline)
  for (const turns of [[], [{ at_m: ARM + 45, dir: "left" }]]) assert.equal(new Route({ ...LEFT, turns }, map).controls[0].turn, "left");
  console.log("✓ the turn at a junction comes from the route's streets, not from the turn instruction's distance");
}

{
  // stopped just past the line at a red (an overshoot) it still holds; well inside, it clears
  const FRONT = new Vehicle(0, 0, 0, 0).spec.length - new Vehicle(0, 0, 0, 0).spec.rearOverhang;
  const over = decide(setup({ x: -8 + 0.3 - FRONT, v: 0, t: 40 }));
  assert.ok(over.snap.intersection.entered && over.snap.intersection.bumper_to_line_m > -1);
  assert.ok(over.eligible.every((c) => c.sim.progress_m < 0.5), over.eligible.map((c) => c.id).join(" "));
  const inside = decide(setup({ x: -6, v: 3, t: 40 }));
  assert.ok(situationClauses(inside.snap).some((c) => c.startsWith("The car is already inside the intersection")));
  assert.ok(!situationClauses(over.snap).some((c) => c.startsWith("The car is already inside the intersection")));
  // held 2.5 m past the line through a long red: it waits for the green without a deadlock creep
  const held = setup({ x: -8 + 2.5 - FRONT, v: 0, t: 31, route: STRAIGHT });
  const autopilot = drive(held, { seconds: 16 });
  assert.equal(held.violations.deadlock_overrides, 0);
  assert.ok(held.ego.x < -8 + 3 - FRONT, `still at the line (x=${held.ego.x.toFixed(2)})`);
  assert.notEqual(phaseOf(map.intersections.get("sig"), held.t).A, "green");
  assert.equal(autopilot.snap.target.v, 0);
  console.log("✓ a car that overshot the line at a red still holds, without a deadlock creep; one well inside the junction is told to clear it");
}

{
  // two lanes each way: a car in the far oncoming lane is waited for short of the near lane too
  const two = junction({ count: 2 }), route = two.routeData("n_out", "left");
  const far = decide(setup({ x: -30, route, on: two.map, npcs: [Object.assign(car("far", 45, HALF + 3.2, Math.PI, 11))] }));
  const near = decide(setup({ x: -30, route, on: two.map, npcs: [Object.assign(car("near", 45, HALF, Math.PI, 11))] }));
  const [, fy] = far.snap.route.pointAt(far.snap.intersection.oncoming.yield_s_route);
  assert.ok(fy < -0.2, `waits clear of the near oncoming lane (y=${fy.toFixed(2)})`);
  assert.ok(Math.abs(far.snap.intersection.oncoming.yield_s_route - near.snap.intersection.oncoming.yield_s_route) < 0.6);
  console.log("✓ with two oncoming lanes, a car in the far lane is waited for short of the near lane");
}

{
  // a street that bends 40 deg left at the signal: its oncoming traffic follows the bend in its own
  // lane and never crosses the car's path
  const bent = junction({ arms: { w: 180, b: 40, s: -90 } }), route = bent.routeData("b_out", "left");
  assert.equal(new Route(route, bent.map).controls[0].turn, "left");
  const lane = bent.map.lane("b_in", 0), p = pointAt(lane.pts, lane.cum, ARM - 45);
  const world = setup({ x: -30, route, on: bent.map, npcs: [car("bend", p[0], p[1], 220 * Math.PI / 180, 11)] });
  assert.equal(decide(world).snap.intersection.oncoming, null);
  // nor does the audit count it as the car follows the bend past it, on its route or on a free
  // drive, while the other car follows the bend in its own lane
  for (const free of [false, true]) for (const from of [27, 30, 33, 36]) {
    const p0 = pointAt(lane.pts, lane.cum, ARM - from), other = car("bend", p0[0], p0[1], 220 * Math.PI / 180, 11);
    other.path = new NpcPath(bent.map, rng(1)); other.path.start("b_in", 0, ARM - from, [["w_out", 0]]);
    const audited = setup({ x: -14, route, on: bent.map, npcs: [other] }), path = audited.route;
    if (free) audited.route = audited.destination = null;
    assert.deepEqual([...driveThrough(audited, path)], [], `${free ? "free drive" : "route"}, other car ${from} m out`);
  }
  console.log("✓ on a street that bends at the junction, its own oncoming lane is not waited for or counted");
}

// closed loop: traffic moves at constant speed in its lane; the light stays green
function drive(world, { seconds = 40, watch = () => {} } = {}) {
  const autopilot = new Autopilot(world);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const fleet = { step(dt) { for (const n of world.npcs) { n.x += Math.cos(n.psi) * n.v * dt; n.y += Math.sin(n.psi) * n.v * dt; } } };
  const dt = 1 / 30;
  for (let i = 0; i < seconds / dt && world.route; i++) {
    stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
    watch(world, autopilot);
  }
  return autopilot;
}

{
  // three oncoming cars 25 m apart: the car waits in the junction for all of them, then turns
  const npcs = [oncoming(50), Object.assign(oncoming(75), { id: "second" }), Object.assign(oncoming(100), { id: "third" })];
  const world = setup({ x: -60, v: 10, npcs });
  let waited = 0, minX = Infinity, waitX = null, turnedAt = null;
  drive(world, { watch: (w, ap) => {
    if (w.ego.v < 0.2 && ap.snap?.intersection?.oncoming) { waited += 1 / 30; waitX = w.ego.x; }
    if (turnedAt === null && w.ego.y > HALF + 2) turnedAt = Math.max(...w.npcs.map((n) => n.x));
    minX = Math.min(minX, w.ego.x);
  } });
  assert.equal(world.violations.collisions, 0, "no collision");
  assert.equal(world.violations.failed_to_yield, 0, "no failure to yield");
  assert.equal(world.violations.safety_brakes, 0, "no safety brake");
  assert.ok(waited > 1, `waited ${waited.toFixed(1)} s`);
  assert.ok(waitX > -8 && waitX < 0, `waited inside the junction (x=${waitX?.toFixed(2)})`);
  assert.ok(turnedAt < -5, `turned only after the last oncoming car had gone by (it was at x=${turnedAt?.toFixed(1)})`);
  assert.ok(world.route === null, "arrived");
  assert.ok(world.ego.y > 100, `on North Street (y=${world.ego.y.toFixed(1)})`);
  console.log(`✓ Rules waits ${waited.toFixed(1)} s in the junction for three oncoming cars, then turns left and arrives`);
}

{
  // two lanes each way: a stream in the far oncoming lane, then one car in the near lane
  const two = junction({ count: 2 }), route = two.routeData("n_out", "left");
  const npcs = [50, 70, 90].map((x, i) => car(`far_${i}`, x, HALF + 3.2, Math.PI, 11)).concat(car("near", 135, HALF, Math.PI, 11));
  const world = setup({ x: -60, v: 10, route, on: two.map, npcs });
  drive(world);
  assert.equal(world.violations.collisions, 0, "no collision");
  assert.equal(world.violations.failed_to_yield, 0, "no failure to yield");
  assert.ok(world.route === null, "arrived");
  console.log("✓ Rules waits short of both oncoming lanes for a far-lane stream and a near-lane car, then turns");
}

{
  // a long gap: the car turns without stopping
  const world = setup({ x: -40, v: 8, npcs: [oncoming(140)] });
  let minV = Infinity;
  drive(world, { watch: (w) => { if (w.ego.x > -12 && w.ego.y < HALF + 2) minV = Math.min(minV, w.ego.v); } });
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.failed_to_yield, 0);
  assert.ok(minV > 2, `kept moving through the turn (min ${minV.toFixed(1)} m/s)`);
  assert.ok(world.route === null, "arrived");
  console.log(`✓ with a long gap Rules turns without stopping (min ${minV.toFixed(1)} m/s)`);
}

{
  // the audit: a car taken through the turn in front of an oncoming car fails to yield, on its
  // route or on a free drive with no route at all; going straight on past it does not
  const world = setup({ x: -14, npcs: [oncoming(29)] });
  assert.deepEqual(driveThrough(world, world.route).map((e) => [e.to, e.with]), [["oncoming traffic", "oncoming"]]);
  assert.equal(world.violations.failed_to_yield, 1, JSON.stringify(world.violations));
  const free = setup({ x: -14, npcs: [oncoming(29)] }), path = free.route;
  free.route = null; free.destination = null;
  assert.equal(driveThrough(free, path).length, 1, "a free drive is audited too");
  const ahead = setup({ x: -14, route: STRAIGHT, npcs: [oncoming(29)] });
  assert.deepEqual([...driveThrough(ahead, ahead.route)], []);
  console.log("✓ turning left in front of an oncoming car counts as a failure to yield, with or without a route; going straight does not");
}

{
  // an oncoming car already turning right inside the junction, more than 60 deg off straight at the
  // car, still counts: the car's front enters its path 7 m ahead of it
  const world = setup({ x: -14 });
  driveThrough(world, world.route, { seconds: 1.4 });
  const FRONT = world.ego.spec.length - world.ego.spec.rearOverhang, psi = 115 * Math.PI / 180;
  const fx = world.ego.x + Math.cos(world.ego.psi) * FRONT, fy = world.ego.y + Math.sin(world.ego.psi) * FRONT;
  world.npcs = [car("turning", fx - Math.cos(psi) * 7, fy - Math.sin(psi) * 7, psi, 4)];
  assert.ok(Math.hypot(world.npcs[0].x, world.npcs[0].y) < 12, "inside the junction");
  world.audit(1 / 30, world.roadInfo());
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.failed_to_yield, 1, JSON.stringify(world.violations));
  console.log("✓ entering the path of an oncoming car already turning inside the junction counts too");
}

{
  // an oncoming car that goes straight through the signal and turns left at the next junction,
  // 10 m on, still has the right of way here: turning in front of it is a failure to yield
  // (also where the street back from that junction is a short approach of this signal, so that
  // junction's node counts as one of this junction's)
  for (const back of [false, true]) {
    const next = junction({ nodes: { x: [-10, 0], q: [-10, -ARM] }, streets: [["c_x", "c", "x"], ["x_q", "x", "q"], ...(back ? [["x_c", "x", "c", true]] : [])] });
    const other = car("then_left", 29, HALF, Math.PI, 11);
    other.path = new NpcPath(next.map, rng(1)); other.path.start("e_in", 0, ARM - 29, [["c_x", 0], ["x_q", 0]]);
    const world = setup({ x: -14, route: next.routeData("n_out", "left"), on: next.map, npcs: [other] });
    assert.deepEqual(driveThrough(world, world.route).map((e) => e.with), ["then_left"], back ? "with a short approach back from it" : "");
  }
  console.log("✓ an oncoming car turning left at the next junction, not this one, still counts");
}

{
  // nor does a left turn it made onto a short approach just before this junction: it now comes
  // straight through, and has the right of way
  const short = junction({ arms: { w: 180, n: 90, s: -90 }, nodes: { k: [30, 0], p: [30, -40] }, streets: [["p_k", "p", "k"], ["k_in", "k", "c", true]] });
  const other = car("turned_onto", 30, HALF, Math.PI, 11);
  other.path = new NpcPath(short.map, rng(1)); other.path.start("p_k", 0, 40, [["k_in", 0], ["w_out", 0]]);
  Object.assign(other, { x: other.path.pointAt(41)[0], y: other.path.pointAt(41)[1] }); other.path.s = 41;
  const world = setup({ x: -14, route: short.routeData("n_out", "left"), on: short.map, npcs: [other] });
  assert.deepEqual(driveThrough(world, world.route).map((e) => e.with), ["turned_onto"]);
  console.log("✓ a left turn an oncoming car made before this junction does not excuse cutting in front of it");
}

{
  // once the car is down the street it turned into, an oncoming car turning right into that street
  // behind it is following it, not being cut off (Kitsilano, snow, s1-5)
  const world = setup({ x: -14 });
  driveThrough(world, world.route, { seconds: 5.5 });
  assert.ok(world.lastSignal && world.ego.y > 15, `the car is ${world.ego.y.toFixed(1)} m up North Street`);
  const turning = car("turning_in", 10, HALF, Math.PI, 3.3);
  turning.path = new NpcPath(map, rng(1)); turning.path.start("e_in", 0, ARM - 10, [["n_out", 0]]);
  world.npcs = [Object.assign(turning, { signal: "right" })];
  world.audit(1 / 30, world.roadInfo());
  assert.equal(world.violations.failed_to_yield, 0);
  console.log("✓ a car turning in behind the car, down the street it turned into, is not a failure to yield");
}

{
  // a large junction (Kitsilano sig15): turning left across the far oncoming lane about 21 m from the
  // centre, in front of a car going straight through on it, still counts
  const real = new MapData(JSON.parse(fs.readFileSync(new URL("../data/maps/623b012bc8b5.v6.pack.json", import.meta.url))));
  const chain = ["e495", "e368", "e361"].map((id) => real.lane(id, 0));
  const route = new Route({ id: "sig15", polyline: resample(chain.slice(1).reduce((pts, l) => joinLanes(pts, l.pts), chain[0].pts)), edges: ["e495", "e368", "e361"], turns: [], start_s: 0, goal_s: chain[2].length - 2 }, real);
  const start = route.controls[0].sRoute - 12;
  let counted = 0, armed = 0;
  for (let s0 = 0; s0 <= 50; s0 += 2) {
    const world = new World(real, { parked: 0, pedestrians: 0 });
    const [x, y] = route.pointAt(start);
    Object.assign(world.ego, { x, y, psi: route.headingAt(start), v: 8 });
    world.route = route; world.resetContactHistory();
    // in the far lane, coming down Macdonald Street from the block before
    const lane = real.lane("e365", 1), [ox, oy] = pointAt(lane.pts, lane.cum, s0);
    const other = car("straight_on", ox, oy, headingAt(lane.pts, lane.cum, s0), 13.9);
    other.path = new NpcPath(real, rng(1)); other.path.start("e365", 1, s0, [["e490", 1], ["e369", 0], ["e496", 1]]);
    world.npcs = [other];
    const events = driveThrough(world, route, { speed: 8, seconds: 6 });
    counted += events.length; armed += events.armed ? 1 : 0;
  }
  assert.equal(armed, 26);
  assert.ok(counted > 0, "some of these timings cut across the far lane in front of it");
  console.log(`✓ at a large junction, turning across the far oncoming lane 21 m from the centre still counts (${counted} of 26 timings)`);
}

{
  // a car that overshot a stop sign's line holds, completes its stop there, and goes on
  const stops = junction();
  for (const e of stops.map.edges.values()) if (e.control) e.control = { type: "stop", id: `stop_${e.id}`, s_line: LINE, all_way: true };
  const FRONT = new Vehicle(0, 0, 0, 0).spec.length - new Vehicle(0, 0, 0, 0).spec.rearOverhang;
  for (const over of [0.3, 2.8]) {
    const world = setup({ x: -8 + over - FRONT, v: 0, route: stops.routeData("e_out", null), on: stops.map });
    drive(world, { seconds: 20 });
    assert.ok(world.route === null, `arrived after overshooting by ${over} m`);
    assert.equal(world.violations.deadlock_overrides, 0);
  }
  console.log("✓ a car that overshot a stop sign's line completes its stop there and goes on");
}

{
  // a junction mapped as several nodes: the turn is found across every short link that goes straight
  const pts = { a: [-100, 0], b: [0, 0], c: [10, 0], d: [20, 0], e: [20, 100] };
  const edge = (id, from, to, control) => ({ id, from, to, pts: [pts[from], pts[to]], length: Math.hypot(pts[to][0] - pts[from][0], pts[to][1] - pts[from][1]),
    lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-3.2, 3.2], parking: [0, 0], cls: "secondary", limit: 13.9, oneway: false, name: id,
    ...(control ? { control: { type: "signal", id: "sig", s_line: 92, group: "A" } } : {}) });
  const linked = (vertices) => new MapData({ bbox: [0, 0, 1, 1], extent: [-120, -20, 40, 120], edges: [edge("ab", "a", "b", true), edge("bc", "b", "c"), edge("cd", "c", "d"), edge("de", "d", "e")],
    lanes: [], nodes: Object.entries(pts).map(([id, [x, y]]) => ({ id, x, y })), stops: [], buildings: [],
    intersections: [{ id: "sig", x: 10, y: 0, offset_s: 0, vertices, approaches: [{ edge: "ab", group: "A", s_line: 92 }] }] });
  const polyline = resample([[-100, 0], [20, 0], [20, 100]]);
  const turnAt = (vertices) => new Route({ id: "links", polyline, edges: ["ab", "bc", "cd", "de"], turns: [], start_s: 0, goal_s: 90 }, linked(vertices)).controls[0].turn;
  assert.equal(turnAt(["b", "c", "d"]), "left");
  // where the links run on past the junction's own nodes, the turn is made at the next junction
  assert.equal(turnAt(["b"]), "straight");
  // a junction drawn as two nodes that lists one: the other is where another of its approaches starts
  pts.n = [10, 100];
  const two = new MapData({ bbox: [0, 0, 1, 1], extent: [-120, -20, 40, 120], stops: [], buildings: [], lanes: [],
    edges: [edge("ab", "a", "b", true), edge("bc", "b", "c"), { ...edge("cb", "c", "b", true), control: { type: "signal", id: "sig", s_line: 5, group: "A" } }, edge("cn", "c", "n")],
    nodes: Object.entries(pts).map(([id, [x, y]]) => ({ id, x, y })),
    intersections: [{ id: "sig", x: 5, y: 0, offset_s: 0, vertices: ["b"], approaches: [{ edge: "ab", group: "A", s_line: 92 }, { edge: "cb", group: "A", s_line: 5 }] }] });
  const twoRoute = new Route({ id: "two", polyline: resample([[-100, 0], [10, 0], [10, 100]]), edges: ["ab", "bc", "cn"], turns: [], start_s: 0, goal_s: 90 }, two);
  assert.equal(twoRoute.controls.find((c) => c.edge === "ab").turn, "left");
  console.log("✓ across short links inside a junction, a left turn is still a left turn; a turn at the next junction is not");
}

{
  // Real junctions: on Kitsilano and Victoria, going straight on or turning right through every
  // signalled approach while an oncoming car goes straight on along its own lanes is never a
  // failure to yield, on a route or on a free drive (streets there jog and bend at junctions)
  const packs = { kitsilano: "623b012bc8b5", victoria: "d7454a9751b7" };
  let drives = 0, skipped = 0;
  for (const [name, hash] of Object.entries(packs)) {
    const real = new MapData(JSON.parse(fs.readFileSync(new URL(`../data/maps/${hash}.v6.pack.json`, import.meta.url))));
    for (const inter of real.intersections.values()) for (const { edge: a } of inter.approaches) {
      const approach = real.edges.get(a), mine = real.lane(a, approach.lanes - 1);
      const opposite = inter.approaches.map((x) => x.edge).find((o) => o !== a && Math.abs(Math.abs(wrapAngle(real.headingIn(o) - real.headingIn(a))) - Math.PI) < 0.35);
      const exits = (e) => (dir) => real.successors(e).find((y) => real.classifyTurn(real.turnAngle(e, y)) === dir);
      const through = opposite && exits(opposite)("straight");
      if (!mine || mine.length < 45 || !through || real.edges.get(opposite).length < 30) continue;
      for (const exit of real.successors(a).filter((x) => ["straight", "right"].includes(real.classifyTurn(real.turnAngle(a, x))))) {
        // the oncoming car goes straight on; with the car going straight, it may also turn either way
        const going = real.classifyTurn(real.turnAngle(a, exit)) === "straight" ? [through, exits(opposite)("left"), exits(opposite)("right")].filter(Boolean) : [through];
        const out = real.lane(exit, real.edges.get(exit).lanes - 1);
        if (!out || out.length < 20) continue;
        const polyline = resample(joinLanes(mine.pts, out.pts)), route = { id: "r", polyline, edges: [a, exit], turns: [], start_s: mine.length - 40, goal_s: out.length - 2 };
        for (const then of going) for (const free of [false, true]) for (const back of [10, 25, 40]) {
          const world = new World(real, { parked: 0, pedestrians: 0 });
          const path = new Route(route, real), [x, y] = path.pointAt(mine.length - 40);
          Object.assign(world.ego, { x, y, psi: path.headingAt(mine.length - 40), v: 8 });
          world.route = free ? null : path;
          const lane = real.lane(opposite, 0), s0 = Math.max(0, lane.length - back), [ox, oy] = pointAt(lane.pts, lane.cum, s0);
          const other = car("oncoming", ox, oy, headingAt(lane.pts, lane.cum, s0), 11);
          other.path = new NpcPath(real, rng(1)); other.path.start(opposite, 0, s0, [[then, 0]]);
          world.npcs = [other];
          world.resetContactHistory();
          const events = driveThrough(world, path, { speed: 8, seconds: 6 });
          assert.deepEqual([...events], [], `${name} ${inter.id}: ${a} -> ${exit} (${free ? "free drive" : "route"}), oncoming ${back} m out to ${then}`);
          if (events.armed) drives++; else skipped++;
        }
      }
    }
  }
  // (a few kerb lanes run into street furniture before the line, so the audit never starts there)
  assert.ok(drives > 1500 && skipped < drives / 20, `${drives} audited drives, ${skipped} that never crossed a line`);
  console.log(`✓ going straight on or turning right past oncoming traffic at real junctions, which goes straight or turns either way, is never a failure to yield (${drives} drives)`);
}

console.log("All left-turn checks passed.");
