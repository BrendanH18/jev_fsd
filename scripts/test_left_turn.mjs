// Left turns at a signal: oncoming traffic has the right of way. On a four-way signalled junction
// of two-way streets, the car turning left waits for an oncoming car that would arrive before it
// could clear, at the line or inside the junction, and goes once the gap is long enough. Also what
// models are told, the commit point, what does not count (an oncoming car signalling its own left
// turn, braking to stop, hidden by fog), the audit, and a car caught in the junction by a red light.
// node --experimental-default-type=module scripts/test_left_turn.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
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

// Two-way streets crossing at the origin, one lane each way 3.2 m wide; stop lines 8 m before the
// centre. The car comes from the west (travel +x, its lane at y = -1.6) and turns left to go north
// (x = +1.6). Oncoming traffic comes from the east in the westbound lane (y = +1.6). `junction`
// also builds two lanes each way (the inner lanes at 1.6 m, the outer at 4.8 m) and arms at other
// angles (degrees counter-clockwise from east).
const ARM = 150, LINE = ARM - 8, HALF = 1.6;
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
const names = { w: "West Street", e: "West Street", n: "North Street", s: "North Street" };
const groups = { w: "A", e: "A", n: "B", s: "B" };
function junction({ count = 1, arms = { w: 180, e: 0, n: 90, s: -90 } } = {}) {
  const ends = { c: [0, 0] }, edges = [], lanes = [];
  for (const [arm, deg] of Object.entries(arms)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  const offsets = Array.from({ length: count }, (_, i) => HALF + i * 3.2);
  for (const arm of Object.keys(arms)) {
    for (const [id, from, to, control] of [[`${arm}_in`, arm, "c", true], [`${arm}_out`, "c", arm, false]]) {
      const pts = [ends[from], ends[to]];
      const [rx, ry] = right(...pts);
      edges.push({ id, from, to, pts, length: ARM, lanes: count, lane_width: 3.2, lane_offsets: offsets, asphalt: [-3.2 * count, 3.2 * count], parking: [0, 0],
        cls: "secondary", limit: 13.9, oneway: false, name: names[arm] || "Bent Street",
        ...(control ? { control: { type: "signal", id: "sig", s_line: LINE, group: groups[arm] || "A" } } : {}) });
      offsets.forEach((o, idx) => lanes.push({ edge: id, idx, pts: pts.map(([x, y]) => [x + rx * o, y + ry * o]) }));
    }
  }
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })),
    intersections: [{ id: "sig", x: 0, y: 0, offset_s: 0, vertices: ["c"], approaches: Object.keys(arms).map((a) => ({ edge: `${a}_in`, group: groups[a] || "A", s_line: LINE })) }],
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
  const turning = decide(setup({ x: -30, npcs: [oncoming(45, 11, { signal: "left" })] })).snap.intersection.oncoming;
  assert.equal(turning, null, "an oncoming car signalling its own left turn passes in front");
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
  console.log("✓ no wait for a long gap, an oncoming left turn, a braking car, a car already through, a straight route, a red, or a car hidden by fog");
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
  // nor does the audit count it, 12 m from the centre with the car's front just past the line
  const close = pointAt(lane.pts, lane.cum, ARM - 12), audited = setup({ x: -6, route, on: bent.map, npcs: [car("bend", close[0], close[1], 220 * Math.PI / 180, 11)] });
  audited.audit(1 / 30, audited.roadInfo());
  assert.equal(audited.violations.failed_to_yield, 0);
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
    if (turnedAt === null && w.ego.y > HALF + 2) turnedAt = Math.min(...w.npcs.map((n) => n.x));
    minX = Math.min(minX, w.ego.x);
  } });
  assert.equal(world.violations.collisions, 0, "no collision");
  assert.equal(world.violations.failed_to_yield, 0, "no failure to yield");
  assert.equal(world.violations.safety_brakes, 0, "no safety brake");
  assert.ok(waited > 1, `waited ${waited.toFixed(1)} s`);
  assert.ok(waitX > -8 && waitX < 0, `waited inside the junction (x=${waitX?.toFixed(2)})`);
  assert.ok(turnedAt < -5, `turned only after the last oncoming car had gone by (it was at x=${turnedAt?.toFixed(1)})`);
  assert.equal(world.route, null, "arrived");
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
  assert.equal(world.route, null, "arrived");
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
  assert.equal(world.route, null, "arrived");
  console.log(`✓ with a long gap Rules turns without stopping (min ${minV.toFixed(1)} m/s)`);
}

{
  // the audit: a car taken through the turn in front of an oncoming car fails to yield (the car is
  // moved along its route at 6 m/s, as a driver who ignores the oncoming car would take it)
  const world = setup({ x: -6, v: 6, npcs: [oncoming(14)] });
  const dt = 1 / 30;
  let s = world.route.project(world.ego.x, world.ego.y).s, events = [];
  for (let i = 0; i < 3 / dt; i++) {
    s += 6 * dt;
    const [x, y] = world.route.pointAt(s);
    Object.assign(world.ego, { x, y, psi: world.route.headingAt(s), v: 6 });
    for (const n of world.npcs) n.x += Math.cos(n.psi) * n.v * dt;
    world.t += dt;
    world.audit(dt, world.roadInfo());
    events = events.concat(world.events.filter((e) => e.type === "failed_to_yield"));
  }
  assert.equal(world.violations.failed_to_yield, 1, JSON.stringify(world.violations));
  assert.deepEqual(events.map((e) => [e.to, e.with]), [["oncoming traffic", "oncoming"]]);
  console.log("✓ turning left in front of an oncoming car counts as a failure to yield");
}

console.log("All left-turn checks passed.");
