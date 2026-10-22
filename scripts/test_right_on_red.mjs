// Right turns on red: legal across Canada after a full stop, except on the island of Montréal. On
// a four-way signalled junction of two-way streets, the car turning right at a red light stops at
// the line, then turns once nothing it must yield to is in the way: traffic from the left on its
// green, anything crossing the junction, a pedestrian crossing or about to, or a view to the left too
// short to know. Also what models are told, the audit, traffic cars doing the same, and the
// challenge.
// node --experimental-default-type=module scripts/test_right_on_red.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const fs = await import("node:fs");
const { MapData, joinLanes, cumulative, pointAt, rightOnRedAllowed } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { phaseOf, pedPhase, StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { buildLlmPrompt } = await import("../static/js/brain/llm-prompt.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { rng } = await import("../static/js/common.js");

// Two-way streets crossing at the origin, one lane each way 3.2 m wide; stop lines 8 m before the
// centre. The car comes from the west (travel +x, its lane at y = -1.6) and turns right to go south
// (x = -1.6). Traffic from its left comes from the north, southbound in the same lane line.
const ARM = 150, LINE = ARM - 8, HALF = 1.6;
const FRONT = CAR.length - CAR.rearOverhang;
const right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); return [dy / d, -dx / d]; };
const names = { w: "West Street", e: "West Street", n: "North Street", s: "North Street" };
const groups = { w: "A", e: "A", n: "B", s: "B" };
// (`arms` sets the angle of each arm, degrees counter-clockwise from east; `buildings` are footprints)
function junction({ arms = { w: 180, e: 0, n: 90, s: -90 }, buildings = [] } = {}) {
  const ends = { c: [0, 0] }, edges = [], lanes = [];
  for (const [arm, deg] of Object.entries(arms)) ends[arm] = [ARM * Math.cos(deg * Math.PI / 180), ARM * Math.sin(deg * Math.PI / 180)].map((v) => Math.round(v * 1e6) / 1e6);
  for (const [id, from, to, control, arm] of Object.keys(arms).flatMap((arm) => [[`${arm}_in`, arm, "c", true, arm], [`${arm}_out`, "c", arm, false, arm]])) {
    const pts = [ends[from], ends[to]], [rx, ry] = right(...pts);
    edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [HALF], asphalt: [-3.2, 3.2], parking: [0, 0],
      cls: "secondary", limit: 13.9, oneway: false, name: names[arm], ...(control ? { control: { type: "signal", id: "sig", s_line: LINE, group: groups[arm] } } : {}) });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * HALF, y + ry * HALF]) });
  }
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-ARM - 20, -ARM - 20, ARM + 20, ARM + 20], edges, lanes,
    nodes: Object.entries(ends).map(([id, [x, y]]) => ({ id, x, y })),
    intersections: [{ id: "sig", x: 0, y: 0, offset_s: 0, vertices: ["c"], approaches: Object.keys(arms).map((a) => ({ edge: `${a}_in`, group: groups[a], s_line: LINE })) }],
    stops: [], buildings });
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
const RIGHT = routeData("s_out", "right"), STRAIGHT = routeData("e_out", null), LEFT = routeData("n_out", "left");
const plan = map.intersections.get("sig").plan;
// red for the car (group A), green for the street from the left (group B), walk for people crossing
// the car's street beside it; and a red with that walk already over
const RED = plan.B.start + 1, LATE_RED = plan.B.start + 12;
assert.equal(phaseOf(map.intersections.get("sig"), RED).A, "red");
assert.equal(phaseOf(map.intersections.get("sig"), RED).B, "green");
assert.equal(phaseOf(map.intersections.get("sig"), LATE_RED).A, "red");
assert.notEqual(pedPhase(map.intersections.get("sig"), "B", LATE_RED + 4), "walk");

function car(id, x, y, psi, v = 0, extra = {}) {
  const n = new Vehicle(x, y, psi, v);
  return Object.assign(n, { id }, extra);
}
// from the left: southbound on North Street, `y` m north of the centre
const fromLeft = (y, v = 11, extra = {}) => car("cross", -HALF, y, -Math.PI / 2, v, extra);
const AT_LINE = -8 - 0.8 - FRONT;   // rear axle with the front bumper 0.8 m short of the line
function setup({ x = AT_LINE, v = 0, npcs = [], route = RIGHT, weather = "dry", t = RED, on = map, stopped = false } = {}) {
  setWeather(weather);
  const world = new World(on, { parked: 0, pedestrians: 0, weather });
  world.t = t;
  Object.assign(world.ego, { x, y: -HALF, psi: 0, v });
  world.route = route ? new Route(route, on) : null;
  world.destination = world.route ? world.route.endPoint() : null;
  world.npcs = npcs;
  world._road = world.roadInfo();
  if (stopped) for (let i = 0; i < 30; i++) world.audit(1 / 30, world.roadInfo());
  world._road = world.roadInfo();
  return world;
}
function decide(world) {
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  return { snap, candidates, ...simulateAll(candidates, snap, world) };
}
const passesLine = (r) => r.eligible.some((c) => c.sim.progress_m + r.snap.ego.front_m + r.snap.routeProj.s > r.snap.intersection.s_line_route + 1);

{
  assert.equal(rightOnRedAllowed([-73.59, 45.516, -73.574, 45.528]), false, "Le Plateau, on the island of Montréal");
  for (const bbox of [[-71.235, 46.805, -71.218, 46.815], [-73.52, 45.52, -73.50, 45.54], [-73.75, 45.56, -73.70, 45.58], [-123.17, 49.26, -123.15, 49.27]]) assert.equal(rightOnRedAllowed(bbox), true, String(bbox));
  const packs = fs.readdirSync(new URL("../data/maps/", import.meta.url)).filter((f) => f.endsWith(".pack.json"));
  const banned = packs.map((f) => new MapData(JSON.parse(fs.readFileSync(new URL(`../data/maps/${f}`, import.meta.url))))).filter((m) => !m.rightOnRed).map((m) => m.pack.name);
  assert.deepEqual(banned, ["bb9df59633e0"], "of the bundled maps, only Montréal bans it");
  console.log("✓ right turns on red are allowed everywhere but the island of Montréal (Québec City, Longueuil and Laval allow them)");
}

{
  const route = new Route(RIGHT, map);
  assert.equal(route.controls[0].turn, "right");
  // approaching the red: stop at the line first
  const coming = decide(setup({ x: -40, v: 8 }));
  const r = coming.snap.intersection.right_on_red;
  assert.ok(r, "a right turn at a red light");
  assert.equal(r.stop_completed, false);
  assert.equal(r.go, false);
  assert.ok(coming.snap.target.reasons.includes("red light"));
  assert.ok(!passesLine(coming), "no manoeuvre crosses the line before the stop");
  // stopped at the line, nothing coming: it may turn
  const ready = decide(setup({ stopped: true }));
  const g = ready.snap.intersection.right_on_red;
  assert.equal(g.stop_completed, true);
  assert.equal(g.clear, true, JSON.stringify(g.wait_for));
  assert.equal(g.go, true);
  assert.ok(!ready.snap.target.reasons.includes("red light"), ready.snap.target.reasons.join());
  assert.ok(ready.snap.target.v > 2);
  assert.ok(!ready.rejected.runs_red, JSON.stringify(ready.rejected));
  assert.ok(passesLine(ready), "it can pull away into the turn");
  const choice = new RulesBrain().decideSync(ready.snap, ready.eligible);
  assert.equal(choice.motion, "drive");
  assert.notEqual(choice.candidateId, "stop_at_line");
  console.log("✓ at a red light the car stops at the line first; then, with nothing coming, Rules turns right on red");
}

{
  // what does not get a right turn on red
  assert.equal(decide(setup({ stopped: true, route: STRAIGHT })).snap.intersection.right_on_red, null, "going straight on");
  assert.equal(decide(setup({ stopped: true, route: LEFT })).snap.intersection.right_on_red, null, "turning left");
  assert.equal(decide(setup({ stopped: true, t: 1 })).snap.intersection.right_on_red, null, "a green light");
  const montreal = junction();
  montreal.map.rightOnRed = false;
  const held = decide(setup({ stopped: true, on: montreal.map, route: montreal.routeData("s_out", "right") }));
  assert.equal(held.snap.intersection.right_on_red, null, "where it is not allowed");
  assert.ok(!passesLine(held));
  assert.equal(new RulesBrain().decideSync(held.snap, held.eligible).motion, "stop");
  console.log("✓ no right on red going straight, turning left, on a green, or where the map does not allow it");
}

{
  // things to wait for, at the line after the stop
  const wait = (opts) => decide(setup({ stopped: true, ...opts }));
  const near = wait({ npcs: [fromLeft(50)] });
  assert.equal(near.snap.intersection.right_on_red.wait_for?.id, "cross", "a car from the left 50 m out (4 s)");
  assert.equal(near.snap.intersection.right_on_red.go, false);
  assert.ok(!passesLine(near), JSON.stringify(near.eligible.map((c) => c.id)));
  assert.equal(new RulesBrain().decideSync(near.snap, near.eligible).motion, "stop");
  assert.equal(wait({ npcs: [fromLeft(78)] }).snap.intersection.right_on_red.go, true, "one 78 m out leaves time (6.5 s)");
  // beyond the 60 m traffic radius but within sight: 70 m out at 13.9 m/s is 4.6 s away
  assert.equal(wait({ npcs: [fromLeft(70, 13.9)] }).snap.intersection.right_on_red.wait_for?.id, "cross", "one 70 m out at 50 km/h is too close");
  assert.equal(wait({ npcs: [car("across", 3, HALF, Math.PI, 8)] }).snap.intersection.right_on_red.wait_for?.kind, "junction", "a car crossing the junction");
  assert.equal(wait({ npcs: [fromLeft(40, 9, { a: -4 })] }).snap.intersection.right_on_red.go, true, "a car from the left braking to stop");
  assert.equal(wait({ npcs: [car("away", HALF, 40, Math.PI / 2, 11)] }).snap.intersection.right_on_red.go, true, "a car going the other way");
  assert.equal(wait({ npcs: [fromLeft(-20)] }).snap.intersection.right_on_red.go, true, "a car from the left already through");
  // pulling away from its own line on the green counts too
  assert.equal(wait({ npcs: [fromLeft(12, 0.3, { a: 1.5 })] }).snap.intersection.right_on_red.wait_for?.id, "cross");
  // a building beside North Street hiding it from about 63 m out, short of the 79 m the car could see
  const hidden = junction({ buildings: [{ pts: [[-2.8, 62], [-2.1, 62], [-2.1, 70], [-2.8, 70]], h: 10 }] });
  const blind = decide(setup({ stopped: true, on: hidden.map, route: hidden.routeData("s_out", "right") })).snap.intersection.right_on_red;
  assert.equal(blind.wait_for?.kind, "view", "a building hiding the street to its left from about 63 m out");
  const fog = wait({ weather: "fog" }).snap.intersection.right_on_red;
  assert.equal(fog.wait_for?.kind, "view", "in fog it cannot see far enough to its left");
  for (const w of ["rain", "snow"]) assert.equal(wait({ weather: w }).snap.intersection.right_on_red.wait_for?.kind, "view", w);
  setWeather("dry");
  const night = setup({ stopped: true });
  night.visibility.setNight(1);
  assert.equal(decide(night).snap.intersection.right_on_red.wait_for?.kind, "view", "nor in the dark");
  console.log("✓ it waits for a car from the left, a car in the junction and a short view; not for a braking car, one going away or one already through");
}

// A pedestrian at the curb on the car's side of the junction, about to cross West Street in front of
// it (with the green for North Street), or one already on that crosswalk.
function pedestrian(world, { crossing = false } = {}) {
  const info = world.crowd.legsAt.get("c"), leg = info.list.find((l) => l.st.edge.id.startsWith("w"));
  const side = leg.ends[1][1] < 0 ? 1 : -1, from = leg.ends[side], to = leg.ends[-side];
  const cross = { node: "c", leg, from, to };
  const at = crossing ? [from[0] + (to[0] - from[0]) * 0.3, from[1] + (to[1] - from[1]) * 0.3] : from;
  const ped = new Pedestrian({ id: "ped", x: at[0], y: at[1], psi: Math.PI / 2, v: crossing ? 1.3 : 0, speed: 1.3, path: [{ p: to, cross }], crossing: crossing ? cross : null, waiting: 0, phase: 0, look: 1 });
  world.crowd.list.push(ped);
  return ped;
}

{
  const kerb = setup({ stopped: true });
  pedestrian(kerb);
  const k = decide(kerb).snap.intersection.right_on_red;
  assert.equal(k.wait_for?.kind, "pedestrian", "someone at the curb with the walk signal on");
  const late = setup({ stopped: true, t: LATE_RED });
  pedestrian(late);
  assert.equal(decide(late).snap.intersection.right_on_red.go, true, "after the walk signal, someone waiting at the curb does not step off");
  const on = setup({ stopped: true, t: LATE_RED });
  pedestrian(on, { crossing: true });
  const o = decide(on).snap;
  assert.equal(o.intersection.right_on_red.wait_for?.kind, "pedestrian", "someone already on the crosswalk");
  assert.ok(o.pedestrian, "and the car stops for them as for any crossing");
  console.log("✓ it waits for a pedestrian on the crosswalk ahead, or at the curb with the walk signal on or coming on");
}

{
  // what decision models and LLMs see
  const ready = decide(setup({ stopped: true }));
  const state = toJevState(ready.snap, ready.candidates, {}, "test");
  assert.equal(state.intersection.turn, "right");
  assert.deepEqual(state.intersection.right_on_red, { allowed: true, stop_completed: true, clear: true });
  assert.ok(situationClauses(ready.snap).some((c) => c.includes("a right turn on red is allowed") && c.includes("it may turn now")));
  const { questions } = buildQuestions(ready.snap, ready.eligible);
  assert.ok(questions.motion.criteria.stop.includes("the car may turn right on red"));
  const { messages } = buildLlmPrompt(ready.snap, { state, questions });
  assert.ok(messages[0].content.includes("turn right on red"));
  const blocked = decide(setup({ stopped: true, npcs: [fromLeft(50)] }));
  assert.equal(toJevState(blocked.snap, blocked.candidates, {}, "test").intersection.right_on_red.wait_for, "cross");
  assert.ok(situationClauses(blocked.snap).some((c) => c.includes("`cross` is coming from the left") && c.includes("Hold still")));
  assert.ok(!buildQuestions(blocked.snap, blocked.eligible).questions.motion.criteria.stop.includes("right on red"));
  const before = decide(setup({ x: -40, v: 8 }));
  assert.ok(situationClauses(before.snap).some((c) => c.includes("only after a full stop")));
  // a red going straight on reads exactly as before
  const plain = decide(setup({ x: -40, v: 8, route: STRAIGHT }));
  assert.equal(toJevState(plain.snap, plain.candidates, {}, "test").intersection.right_on_red, undefined);
  assert.equal(toJevState(plain.snap, plain.candidates, {}, "test").intersection.turn, undefined);
  assert.ok(situationClauses(plain.snap).includes("The signal 28 m ahead is red: keep rolling toward the line and stop just before it."), situationClauses(plain.snap).join(" | "));
  console.log("✓ models get the turn, whether the stop is made and the way clear, what to wait for, and a situation line");
}

// Move the car along `path` from where it is at a steady speed, with traffic moving along its
// planned lanes (or straight on), and audit every tick.
function driveThrough(world, path, { speed = 5, seconds = 5 } = {}) {
  const dt = 1 / 30;
  let s = path.project(world.ego.x, world.ego.y).s;
  const events = [];
  for (let i = 0; i < seconds / dt; i++) {
    s += speed * dt;
    const [x, y] = path.pointAt(s);
    Object.assign(world.ego, { x, y, psi: path.headingAt(s), v: speed });
    for (const n of world.npcs) {
      if (n.path) { n.path.s += n.v * dt; n.path.extend(); const [px, py] = n.path.pointAt(n.path.s); Object.assign(n, { x: px, y: py, psi: n.path.headingAt(n.path.s) }); }
      else { n.x += Math.cos(n.psi) * n.v * dt; n.y += Math.sin(n.psi) * n.v * dt; }
    }
    world.t += dt;
    world.audit(dt, world.roadInfo());
    events.push(...world.events.filter((e) => e.type === "red_light" || e.type === "failed_to_yield"));
  }
  return events;
}
const types = (events) => events.map((e) => e.type + (e.to ? `:${e.to}` : ""));

{
  const run = ({ route = RIGHT, stopped = true, free = false, on = map, npcs = [] } = {}) => {
    const world = setup({ route, stopped, on, npcs }), path = world.route;
    if (free) world.route = world.destination = null;
    return { world, events: driveThrough(world, path) };
  };
  assert.deepEqual(types(run().events), [], "stopped, then turned right");
  assert.deepEqual(types(run({ free: true }).events), [], "the same on a free drive");
  assert.deepEqual(types(run({ stopped: false }).events), ["red_light"], "a rolling right on red");
  assert.deepEqual(types(run({ route: STRAIGHT }).events), ["red_light"], "stopped, then straight on");
  assert.deepEqual(types(run({ route: LEFT }).events), ["red_light"], "stopped, then left");
  assert.deepEqual(types(run({ route: STRAIGHT, free: true }).events), ["red_light"], "straight on, free drive");
  // a shallow right turn (35 deg) at a skewed junction is still a right turn
  const skew = junction({ arms: { w: 180, e: 0, n: 90, s: -35 } });
  const skewRoute = skew.routeData("s_out", "right");
  assert.equal(new Route(skewRoute, skew.map).controls[0].turn, "right");
  assert.equal(decide(setup({ stopped: true, on: skew.map, route: skewRoute })).snap.intersection.right_on_red?.go, true);
  assert.deepEqual(types(run({ on: skew.map, route: skewRoute }).events), [], "a 35 deg right turn on red after a full stop");
  const shallow = junction({ arms: { w: 180, e: 0, n: 90, s: -25.5 } }), shallowRoute = shallow.routeData("s_out", "right");
  assert.equal(new Route(shallowRoute, shallow.map).controls[0].turn, "right");
  assert.deepEqual(types(run({ on: shallow.map, route: shallowRoute }).events), [], "a 25.5 deg right turn on red");
  // a sharp lane change to the right just past the line, then straight on, is not a right turn
  const swerve = new Route({ id: "swerve", edges: ["w_in", "e_out"], turns: [], start_s: 0, goal_s: 120,
    polyline: resample([[-ARM, -HALF], [-8, -HALF], [-2, -HALF - 3.2], [ARM, -HALF - 3.2]]) }, map);
  const swerving = setup({ stopped: true, route: STRAIGHT });
  // (this one-lane street's curb posts would stop the car; only the audit is under test here)
  swerving.route = swerve; swerving.staticObstacles = { sweep: () => null, overlaps: () => [] };
  assert.ok(Math.max(...[1, 3, 5].map((d) => Math.abs(swerve.headingAt(swerve.project(-8, -HALF).s + d)))) > 25 * Math.PI / 180, "the swerve turns more than 25 deg");
  assert.deepEqual(types(driveThrough(swerving, swerve, { seconds: 8 })), ["red_light"], "a swerve to the right, then straight on");
  const montreal = junction();
  montreal.map.rightOnRed = false;
  assert.deepEqual(types(run({ on: montreal.map, route: montreal.routeData("s_out", "right") }).events), ["red_light"], "where it is not allowed");
  // in front of a car from the left due within 2 s, on its way down North Street
  const cutOff = () => {
    const n = fromLeft(26, 11);
    n.path = new NpcPath(map, rng(1)); n.path.start("n_in", 0, ARM - 26, [["s_out", 0]]);
    return n;
  };
  assert.deepEqual(types(run({ npcs: [cutOff()] }).events), ["failed_to_yield:cross traffic"]);
  assert.deepEqual(types(run({ npcs: [cutOff()], free: true }).events), ["failed_to_yield:cross traffic"]);
  console.log("✓ the audit: a right on red after a full stop is legal; rolling it, or going straight or left after the stop, runs the red; cutting off traffic from the left fails to yield");
}

// closed loop: traffic moves at constant speed in its lane
function drive(world, { seconds = 30, watch = () => {} } = {}) {
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
  // from 40 m out on a red: stop, wait for two cars from the left, turn, arrive, all before the green
  const world = setup({ x: -40, v: 9, t: LATE_RED - 6, npcs: [fromLeft(110), Object.assign(fromLeft(140), { id: "second" })] });
  let stoppedFor = 0, turnedAt = null;
  drive(world, { seconds: 45, watch: (w, ap) => {
    if (w.ego.v < 0.2 && w.ego.x < -8) stoppedFor += 1 / 30;
    if (turnedAt === null && w.ego.y < -HALF - 2) turnedAt = { t: w.t, light: phaseOf(map.intersections.get("sig"), w.t).A, last: Math.min(...w.npcs.map((n) => n.y)) };
  } });
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.red_lights_run, 0);
  assert.equal(world.violations.failed_to_yield, 0);
  assert.equal(world.violations.safety_brakes, 0);
  assert.ok(stoppedFor > 0.7, `stopped at the line for ${stoppedFor.toFixed(1)} s`);
  assert.equal(turnedAt?.light, "red", "turned on the red");
  assert.ok(turnedAt.last < -10, `after both cars from the left had gone by (the second was at y=${turnedAt?.last.toFixed(1)})`);
  assert.equal(world.route, null, "arrived");
  console.log(`✓ Rules stops for the red, waits for two cars from the left, and turns right on red ${(turnedAt.t - (LATE_RED - 6)).toFixed(1)} s after setting off`);
}

{
  // traffic cars: a car at the red turns right once stopped and clear, and waits for the driven car
  // (it sets off 30 m before the line at 6 m/s, turning right onto North Street)
  const queue = (world, on = map) => {
    const fleet = new NpcFleet(world, { count: 0, bikes: 0 });
    const n = car("npc", -8 - 30 - FRONT, -HALF, 0, 6, { v0: 12, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0 });
    n.path = new NpcPath(on, rng(2)); n.path.start("w_in", 0, LINE - 30 - FRONT, [["s_out", 0]]);
    fleet.vehicles.push(n);
    return { fleet, n };
  };
  const world = setup({ route: null });
  Object.assign(world.ego, { x: -HALF, y: 120, psi: -Math.PI / 2, v: 0 });
  const { fleet, n: npc } = queue(world);
  let stopped = 0;
  for (let i = 0; i < 20 * 60 && npc.y > -20; i++) { fleet.step(1 / 60); world.t += 1 / 60; if (npc.v < 0.2 && npc.x < -8) stopped += 1 / 60; }
  assert.ok(npc.y < -20, `turned right (at ${npc.x.toFixed(1)}, ${npc.y.toFixed(1)})`);
  assert.ok(stopped > 0.7, `after a full stop (${stopped.toFixed(1)} s)`);
  assert.equal(phaseOf(map.intersections.get("sig"), world.t).A, "red", "on the red");
  // with the driven car coming down North Street at 11 m/s, it waits for it
  const busy = setup({ route: null });
  Object.assign(busy.ego, { x: -HALF, y: 110, psi: -Math.PI / 2, v: 11 });
  const held = queue(busy);
  let ahead = -Infinity, waited = 0;
  for (let i = 0; i < 22 * 60 && held.n.y > -20; i++) {
    held.fleet.step(1 / 60); busy.t += 1 / 60; busy.ego.y -= 11 / 60;
    if (busy.ego.y > -6) { ahead = Math.max(ahead, held.n.x + FRONT); if (held.n.v < 0.2) waited += 1 / 60; }
  }
  assert.ok(ahead < -8 + 0.5, `held behind the line (front at x=${ahead.toFixed(1)}) until the car had gone by`);
  assert.ok(waited > 0.7, `waiting ${waited.toFixed(1)} s`);
  assert.ok(held.n.y < -20, "then turned");
  const banned = junction();
  banned.map.rightOnRed = false;
  const strict = setup({ route: null, on: banned.map });
  Object.assign(strict.ego, { x: -HALF, y: 120, psi: -Math.PI / 2, v: 0 });
  const none = queue(strict, banned.map);
  for (let i = 0; i < 15 * 60; i++) { none.fleet.step(1 / 60); strict.t += 1 / 60; }
  assert.ok(none.n.x < -8 - FRONT + 0.5, "and never where the map does not allow it");
  console.log("✓ traffic cars turn right on red after a full stop, wait for the driven car coming from the left, and never on a map that bans it");
}

{
  const challenge = CHALLENGES.find((c) => c.id === "right-on-red");
  const calgary = new MapData(JSON.parse(fs.readFileSync(new URL("../data/maps/a53c5bcf6438.v6.pack.json", import.meta.url))));
  const result = await evaluateChallenge(calgary, challenge);
  assert.equal(result.pass, true, JSON.stringify(result.report?.status));
  const ids = result.events.filter((e) => e.type === "collision" || e.type === "red_light" || e.type === "failed_to_yield");
  assert.deepEqual(ids, []);
  console.log(`✓ the Right on red challenge (Calgary) passes with Rules in ${result.report?.time_s ?? result.time_s} s`);
}

console.log("All right-on-red checks passed.");
process.exit(0);
