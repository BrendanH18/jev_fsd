// Road closures (sim/road-closures.js): a block closed for an event, its barricades and where they stand;
// the one test along a route and along a driver's path; route requests that avoid the closed edges (the
// browser's router, which Node and the public demo use); the car learning of a closure only once it sees
// a barricade; sensing, the stop short of it, its rejection, Rules and the cautious agent; the re-plan,
// and stopping short when there is no detour; traffic never choosing a closed edge, re-planning round it,
// and moved off the block as it closes; the audit's closure entries; free drives' closures from the
// feature's own stream; the "Road closed" challenge with Rules and the cautious agent; checkpoints; and
// nothing computed, drawn or reported with the option off.
//   node --experimental-default-type=module scripts/test_road_closures.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const RC = await import("../static/js/sim/road-closures.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { failureCategory } = await import("../static/js/lab/examiner.js");
const { Route } = await import("../static/js/map/route.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { browserRoute, routeFromLanes } = await import("../static/js/demo/routing.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const HFX = load("49db0d437c8c");
const lesson = CHALLENGES.find(c => c.id === "road-closed");
// Spring Garden Road, westbound: the block before (e489), the one up to Queen Street (e491, its signal),
// the block on to Birmingham Street (e277, e278 the other way), and Birmingham Street on (e218, e172).
const START = "e489", APPROACH = "e491", CLOSED = "e277", BACK = "e278", CROSS = "e494";
const DT = 1 / 60;
const pose = (lane, s) => { const p = pointAt(lane.pts, lane.cum, s); return { x: p[0], y: p[1], heading: headingAt(lane.pts, lane.cum, s) }; };
const GOAL = (() => { const l = HFX.lane("e172", 0); return pointAt(l.pts, l.cum, 60); })();

// A world on Spring Garden Road, the driven car `s` along the block before the closure at `v`, routed down
// the closed block to Birmingham Street, with the block closed (unless `close` is false) and no traffic
// but what a test puts there.
function rig({ roadClosures = true, close = true, s = 20, v = 0, traffic = 0, seed = 3, brain = null } = {}) {
  setWeather("dry");
  const world = new World(HFX, { seed, parked: 0, pedestrians: 0, roadClosures });
  const fleet = new NpcFleet(world, { count: traffic, bikes: 0, seed: 5 });
  world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  const lane = HFX.lane(START, 0);
  world.placeOnLane(lane, s); world.ego.v = v;
  world.route = new Route(browserRoute(HFX, pose(lane, s), { x: GOAL[0], y: GOAL[1] }), HFX, world.ego.spec);
  world.destination = [GOAL[0], GOAL[1]];
  if (roadClosures) world.roadClosures.next = Infinity;   // (no closures of its own: the test places them)
  const closure = roadClosures && close ? world.roadClosures.close(world, fleet, CLOSED, { fixed: true }) : null;
  if (roadClosures && close) world.roadClosures.fixed = true;
  const autopilot = brain ? new Autopilot(world, {}) : { enabled: false, step() {} };
  if (brain) { autopilot.setBrain(brain); autopilot.setEnabled(true); }
  return { world, fleet, autopilot, closure };
}
async function drive(ctx, seconds, each = () => {}, until = () => false) {
  for (let k = 0; k < seconds * 60 && !until(); k++) {
    stepWorld(ctx, DT, ctx.world.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    if (ctx.autopilot.closureRouting) await ctx.autopilot.closureRouting;
    each();
  }
}
// Drive the car by its lane law (no autopilot) until it is `d` short of the closed block's barricade.
function rollUp(ctx, d, vTarget = 9) {
  const w = ctx.world;
  for (let k = 0; k < 60 * 60; k++) {
    const hit = RC.closureAhead(w, RC.routeWay(w.route), w.route.project(w.ego.x, w.ego.y).s + w.ego.spec.length - w.ego.spec.rearOverhang);
    if (hit && hit.distance_m < d) return hit;
    applyLaw(w.ego, { kind: "lane", vTarget, s0: 0 }, w.route, w.route.project(w.ego.x, w.ego.y).s, DT, w);
    stepWorld(ctx, DT, w.t * 1000);
  }
  throw new Error("never got there");
}

await test("a closure: both ways along the block, barricades across the street just past each junction's crosswalk", () => {
  const { world, closure } = rig();
  assert.equal(closure.street, "Spring Garden Road");
  assert.deepEqual([...closure.edges].sort(), [CLOSED, BACK].sort());
  assert.equal(world.roadClosures.closed.get(CLOSED), closure);
  assert.equal(world.roadClosures.closed.get(BACK), closure);
  const e = HFX.edges.get(CLOSED), width = e.asphalt[1] - e.asphalt[0];
  for (const end of closure.ends) {
    const boards = closure.boards.filter(b => b.end === end.k);
    const span = boards.reduce((a, b) => a + b.spec.width + 0.1, 0);
    assert.equal(Math.abs(span - width) < 0.01, true, `${span} ${width}`);
    assert.equal(boards.every(b => b.barricade && b.kind === "barricade" && b.v === 0), true);
  }
  // (each entry setback past the widest cross street's asphalt and its crosswalk, inside the block)
  for (const id of closure.edges) assert.equal(closure.entry[id] > RC.SETBACK_MIN_M - 0.01 && closure.entry[id] < e.length * RC.SETBACK_MAX_SHARE + 0.01, true);
  assert.equal(closure.entry[CLOSED] >= HFX.edges.get(CROSS).asphalt[1] + RC.PAST_KERB_M - 0.01, true);
  // (barricades are obstacles: in world.obstaclesNear)
  const near = world.obstaclesNear(closure.ends[0].x, closure.ends[0].y, 5);
  assert.equal(near.filter(o => o.barricade).length, closure.boards.filter(b => b.end === 0).length);
  // (a one-way street's block closes the one way)
  const oneway = RC.buildClosure(HFX, "e24", "x");
  assert.deepEqual(oneway.edges, ["e24"]);
});

await test("the one test: the first barricade ahead along the route and along a driver's path", () => {
  const { world } = rig();
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  const s = world.route.project(world.ego.x, world.ego.y).s + front;
  const hit = RC.closureAhead(world, RC.routeWay(world.route), s, 400);
  assert.equal(hit.edge, CLOSED);
  assert.equal(hit.index, 2);
  const at = world.route.laneEdgeStarts()[2] + hit.closure.entry[CLOSED];
  assert.equal(Math.abs(hit.line_s - at) < 0.01, true);
  assert.equal(RC.closureAhead(world, RC.routeWay(world.route), s), null);   // beyond the look
  // (a driver's path: the same barricade line, measured along its lanes)
  const path = new NpcPath(HFX, () => 0.5, { world }); path.start(APPROACH, 0, 10, [[CLOSED, 0]]);
  const p = RC.closureAhead(world, RC.pathWay(path, HFX), 14);
  assert.equal(p.edge, CLOSED);
  assert.equal(Math.abs(p.line_s - (path.edges[1].sStart + hit.closure.entry[CLOSED] * (path.edges[1].sEnd - path.edges[1].sStart) / HFX.edges.get(CLOSED).length)) < 0.01, true);
  // (none with no closures)
  assert.equal(RC.closureAhead(rig({ close: false }).world, RC.routeWay(world.route), s, 400), null);
});

await test("route requests avoid the closed edges; without any the route is exactly as before", () => {
  const lane = HFX.lane(START, 0), from = pose(lane, 20), to = { x: GOAL[0], y: GOAL[1] };
  const plain = browserRoute(HFX, from, to);
  assert.equal(plain.edges.includes(CLOSED), true);
  assert.equal(JSON.stringify(browserRoute(HFX, from, to, { avoid: [] })), JSON.stringify(plain));
  assert.equal(JSON.stringify(browserRoute(HFX, from, to, { avoid: null })), JSON.stringify(plain));
  const round = browserRoute(HFX, from, to, { avoid: [CLOSED, BACK] });
  assert.equal(round.edges.includes(CLOSED) || round.edges.includes(BACK), false);
  assert.equal(round.edges[0], START);
  assert.equal(Math.hypot(...round.polyline.at(-1).map((v, i) => v - plain.polyline.at(-1)[i])) < 1, true);
  // (a destination on a closed block is never routed to)
  const on = HFX.lane(CLOSED, 0), q = pointAt(on.pts, on.cum, 40);
  assert.equal(browserRoute(HFX, from, { x: q[0], y: q[1] }, { avoid: [CLOSED, BACK] }), null);
});

await test("the car learns of a closure only once it sees a barricade; sensing then reports it, with where it stops", () => {
  const ctx = rig(), w = ctx.world;
  stepWorld(ctx, DT, 0);
  assert.equal(w.roadClosures.known.size, 0);
  assert.equal(w.roadClosuresSeen, false);
  assert.equal(buildSnapshot(w).road_closed, null);
  const hit = rollUp(ctx, 75);
  assert.equal(w.roadClosures.known.has(hit.closure.id), true, "seen within sight");
  assert.equal(w.roadClosuresSeen, true);
  const snap = buildSnapshot(w), rc = snap.road_closed;
  assert.equal(rc.on_route, true);
  assert.equal(rc.detour_planned, false);
  assert.equal(rc.street, "Spring Garden Road");
  // (it stops at the signal's line before the block, not out in the junction)
  const line = w.route.controls.find(c => c.edge === APPROACH);
  assert.equal(Math.abs(rc.stop_s_route - (line.sRoute - 0.5)) < 0.01, true);
  assert.equal(rc.line_s_route > rc.stop_s_route + 10, true);
  assert.equal(snap.target.reasons.includes("road closed ahead; replan route"), true);
  assert.equal(snap.target.v <= Math.sqrt(2 * 2.5 * Math.max(0, rc.bumper_to_stop_m)) + 0.01, true);
});

await test("candidates: stop for the closure, never past its barricade; Rules and the cautious agent stop", () => {
  const ctx = rig({ v: 0 }), w = ctx.world;
  rollUp(ctx, 60);
  const snap = buildSnapshot(w), cs = sampleCandidates(snap, w), { eligible } = simulateAll(cs, snap, w);
  assert.equal(eligible.some(c => c.id === "stop_for_closure"), true);
  assert.equal(new RulesBrain().decideSync(snap, eligible).candidateId, "stop_for_closure");
  assert.equal(new CautiousAgent().decideSync(snap, eligible).candidateId, "stop_for_closure");
  // (close to the barricade, past the junction, driving on is rejected as entering the closed road)
  const c2 = rig({ v: 0 }), w2 = c2.world;
  const lane = HFX.lane(CLOSED, 0), s = 1, p = pointAt(lane.pts, lane.cum, s);
  rollUp(c2, 60);   // (to have seen it)
  w2.ego.x = p[0]; w2.ego.y = p[1]; w2.ego.psi = headingAt(lane.pts, lane.cum, s); w2.ego.v = 6;
  w2.route.hint = 0;
  const s2 = buildSnapshot(w2), c3 = sampleCandidates(s2, w2), sim = simulateAll(c3, s2, w2);
  assert.equal(s2.road_closed.on_route, true);
  assert.equal(c3.some(c => c.reject === "enters_closed_road"), true);
  const front = w2.ego.spec.length - w2.ego.spec.rearOverhang, room = s2.road_closed.line_s_route - (s2.routeProj.s + front);
  assert.equal(sim.eligible.filter(c => c.law.kind !== "hard_brake").every(c => c.sim.progress_m < room), true);
});

await test("the re-plan: a route round the closed block (the browser's router without a server), and it is followed", async () => {
  const ctx = rig({ brain: "rules" }), w = ctx.world;
  const events = [];
  ctx.autopilot.onEvent = e => events.push(e.type);
  await drive(ctx, 30, () => {}, () => w.route.edges.every(id => !w.roadClosures.closed.has(id)));
  assert.equal(events.includes("reroute"), true);
  assert.equal(w.route.edges.includes(CLOSED) || w.route.edges.includes(BACK), false);
  assert.equal(w.route.edges.includes(CROSS), true, w.route.edges.join(","));
  const snap = buildSnapshot(w);
  assert.equal(snap.road_closed?.detour_planned, true);
  assert.equal(snap.road_closed.on_route, false);
  // (and the car drives the detour to the destination: no entry, no collision)
  await drive(ctx, 120, () => {}, () => !ctx.autopilot.enabled);
  assert.equal(ctx.autopilot.enabled, false, "arrived");
  assert.equal(w.violations.closure_entries || 0, 0);
  assert.equal(w.violations.collisions, 0);
});

await test("no detour: the car stops short of the junction before the barricade, and never hits it", async () => {
  for (const brain of ["rules", "cautious"]) {
    const ctx = rig({ brain, v: 8 }), w = ctx.world;
    ctx.autopilot.reroute = async () => {};   // (navigation finds nothing)
    await drive(ctx, 45);
    const hit = RC.closureAhead(w, RC.routeWay(w.route), w.route.project(w.ego.x, w.ego.y).s + w.ego.spec.length - w.ego.spec.rearOverhang);
    assert.equal(w.ego.v < 0.1, true, `${brain}: stopped`);
    assert.equal(hit.distance_m > 8, true, `${brain}: ${hit.distance_m} m short of the barricade`);
    assert.equal(w.violations.collisions, 0, brain);
    assert.equal(w.violations.closure_entries || 0, 0, brain);
    assert.equal(w.violations.red_lights_run, 0, brain);
  }
});

await test("traffic: never chooses a closed edge, re-plans a way through one, and keeps short of a barricade", () => {
  const { world } = rig();
  // (a thousand paths from the junction before the block, none into it; without closures, many)
  let into = 0, before = 0;
  for (let k = 0; k < 400; k++) {
    let x = k * 7919 + 1; const random = () => (x = (x * 16807) % 2147483647) / 2147483647;
    const a = new NpcPath(HFX, random, { world }); a.closures = world.roadClosures; a.start(APPROACH, 0, 60);
    if (a.edges.some(e => world.roadClosures.closed.has(e.id))) into++;
    x = k * 7919 + 1;
    const b = new NpcPath(HFX, random, { world }); b.start(APPROACH, 0, 60);
    if (b.edges.some(e => e.id === CLOSED)) before++;
  }
  assert.equal(into, 0);
  assert.equal(before > 50, true, `${before}`);
  // (a car whose way was planned through it re-plans, from the street it is on)
  const car = new Vehicle(0, 0, 0, 8, CAR);
  const lane = HFX.lane(START, 0), p = pointAt(lane.pts, lane.cum, 30);
  Object.assign(car, { id: "t1", x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, 30), path: new NpcPath(HFX, () => 0.3, { world }), stopMem: new StopMemory(), frozen: 0, waiting: 0 });
  car.path.start(START, 0, 30, [[APPROACH, 0], [CLOSED, 0]]);
  assert.equal(RC.avoidClosure(world, car), true);
  assert.equal(car.path.edges.some(e => world.roadClosures.closed.has(e.id)), false);
  assert.equal(car.path.edges[0].id, START);
  // (one committed to it, with no room left to change its way, holds short of the barricade)
  car.path.start(APPROACH, 0, HFX.lane(APPROACH, 0).length - 5, [[CLOSED, 0]]);
  const hold = RC.closureHold(world, car, car.path.s + 4);
  assert.equal(hold.hold < car.path.edges[1].sStart + world.roadClosures.list[0].entry[CLOSED], true);
  assert.equal(RC.avoidClosure(world, car), false);
});

await test("traffic on the block, or committed to it, as it closes is moved elsewhere, out of the car's sight", () => {
  const ctx = rig({ close: false, traffic: 0 }), { world, fleet } = ctx;
  const put = (edge, s, id, planned = []) => {
    const l = HFX.lane(edge, 0), p = pointAt(l.pts, l.cum, s), car = new Vehicle(p[0], p[1], headingAt(l.pts, l.cum, s), 6, CAR);
    Object.assign(car, { id, path: new NpcPath(HFX, () => 0.4, { world }), stopMem: new StopMemory(), frozen: 0, waiting: 0, v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 } });
    car.path.start(edge, 0, s, planned); fleet.vehicles.push(car); return car;
  };
  const on = put(BACK, 40, "on_block"), committed = put("e80", HFX.lane("e80", 0).length - 6, "committed", [[CLOSED, 0]]);
  world.npcs = fleet.vehicles;
  const closure = world.roadClosures.close(world, fleet, CLOSED, { fixed: true });
  assert.ok(closure);
  for (const car of [on, committed]) {
    assert.equal(car.path.edges.some(e => world.roadClosures.closed.has(e.id)), false, car.id);
    assert.equal(Math.hypot(car.x - world.ego.x, car.y - world.ego.y) >= RC.AWAY_M, true, car.id);
  }
  // (and from then on, traffic steps round it: nobody crosses a barricade)
  const free = rig({ close: true, traffic: 30, seed: 11 });
  free.world.roadClosures.fixed = true;
  const inside = () => free.fleet.vehicles.filter(n => n.path && free.world.roadClosures.closed.has(n.path.currentEdge().id)).length;
  for (let k = 0; k < 60 * 40; k++) { stepWorld(free, DT, free.world.t * 1000); }
  assert.equal(inside(), 0);
});

await test("the audit: the car's front crossing a barricade onto the closed block, once; the metric only once it has come up to one", () => {
  const ctx = rig(), w = ctx.world, closure = ctx.closure;
  stepWorld(ctx, DT, 0);
  const metrics = new DriveMetrics(w.route.length);
  metrics.record(w, buildSnapshot(w), w.roadInfo(), DT);
  assert.equal("closure_entries" in metrics.summary(w, { totals: {} }, false), false);
  // (driven by hand straight across the line, through a gap between boards, as it were)
  const end = closure.ends[0], front = w.ego.spec.length - w.ego.spec.rearOverhang;
  const put = (d) => { w.ego.psi = end.psi; w.ego.x = end.x + Math.cos(end.psi) * (d - front); w.ego.y = end.y + Math.sin(end.psi) * (d - front); w.ego.v = 3; };
  for (const d of [-2, -1, -0.2, 0.3, 1, 2]) { put(d); RC.auditRoadClosures(w); }
  assert.equal(w.violations.closure_entries, 1);
  assert.equal(w.roadClosuresSeen, true);
  const summary = metrics.summary(w, { totals: {} }, false);
  assert.equal(summary.closure_entries, 1);
  assert.equal(failures(summary).includes("drove onto a closed road"), true);
  assert.equal(failureCategory("drove onto a closed road"), "observation");
  // (backing out again, or crossing beyond the street's width, is not an entry)
  for (const d of [1, 0.2, -1]) { put(d); RC.auditRoadClosures(w); }
  assert.equal(w.violations.closure_entries, 1);
  // (driving into the barricade itself is a collision, at the car's fault)
  const c2 = rig(), w2 = c2.world, e2 = c2.closure.ends[0];
  w2.ego.psi = e2.psi; w2.ego.x = e2.x - Math.cos(e2.psi) * (front + 0.1); w2.ego.y = e2.y - Math.sin(e2.psi) * (front + 0.1); w2.ego.v = 4;
  stepWorld(c2, DT, 0);
  for (let k = 0; k < 30; k++) { w2.ego.v = Math.max(w2.ego.v, 2); stepWorld(c2, DT, w2.t * 1000); }
  assert.equal(w2.violations.collisions >= 1, true);
  assert.equal(w2.violations.collisions_at_fault >= 1, true);
});

await test("what models are told, and the drive score's report", () => {
  const ctx = rig(), w = ctx.world;
  rollUp(ctx, 60);
  const snap = buildSnapshot(w), cs = sampleCandidates(snap, w), sim = simulateAll(cs, snap, w);
  const state = toJevState(snap, cs, { rejected: sim.rejected });
  assert.equal(state.road_closed.on_route, true);
  assert.equal(state.road_closed.street, "Spring Garden Road");
  const clause = situationClauses(snap).find(c => c.includes("ROAD CLOSED"));
  assert.ok(clause && clause.includes("stop_for_closure"));
  const { questions } = buildQuestions(snap, sim.eligible);
  assert.ok(questions.motion.criteria.stop.includes("road_closed.on_route"));
  assert.ok(questions.vector.criteria.stop_for_closure.includes("waits for a detour"));
  assert.ok(SYSTEM_PROMPT.includes("stop_for_closure"));
  const score = new DriveScore(w, { title: "t", map: "halifax", driver: "rules", route: w.route });
  score.record(w, w.roadInfo(), DT);
  assert.equal(score.finish("stopped").closure_entries, 0);
});

await test("free drives: now and then a block on the route ahead closes, from the feature's own stream, out of sight", async () => {
  let made = 0, seen = 0;
  for (const seed of [1, 2, 3, 4]) {
    setWeather("dry");
    const world = new World(HFX, { seed, parked: 0, pedestrians: 0, roadClosures: true });
    const fleet = new NpcFleet(world, { count: 20, bikes: 0, seed });
    const lane = HFX.lane(START, 0);
    world.placeOnLane(lane, 5);
    const far = HFX.laneList.filter(l => l.length > 50).map(l => [l, pointAt(l.pts, l.cum, l.length / 2)]).filter(([, p]) => Math.hypot(p[0] - world.ego.x, p[1] - world.ego.y) > 700)[seed * 17 % 40];
    world.route = new Route(browserRoute(HFX, pose(lane, 5), { x: far[1][0], y: far[1][1] }), HFX, world.ego.spec);
    world.destination = far[1];
    const startEdge = world.route.edges[0], goalEdge = world.route.edges.at(-1);
    const autopilot = new Autopilot(world, {}); autopilot.setBrain("rules"); autopilot.setEnabled(true);
    const ctx = { world, fleet, autopilot };
    let first = null;
    await drive(ctx, 120, () => {
      const c = world.roadClosures.list[0];
      if (c && !first) {
        first = c;
        assert.equal(c.boards.some(b => world.visibility.sees(world.ego, b)), false, "out of sight");
        assert.equal(c.edges.includes(startEdge) || c.edges.includes(goalEdge), false);
        assert.equal(world.t >= RC.CLOSURE_FIRST_S, true);
      }
    }, () => !autopilot.enabled);
    if (first) made++;
    if (world.roadClosuresSeen) seen++;
    assert.equal(world.violations.closure_entries || 0, 0, `seed ${seed}`);
    assert.equal(world.violations.collisions_at_fault, 0, `seed ${seed}`);
  }
  assert.equal(made >= 2, true, `${made}`);
  console.log(`  (${made} of 4 drives had a closure; the car came up to ${seen})`);
});

await test("\"Road closed\": a stable scenario on Spring Garden Road, and Rules and the cautious agent take the detour", async () => {
  const sc = challengeScenario(HFX, lesson);
  assert.equal(lesson.seed, 60042);
  assert.equal(lesson.map, "halifax");
  assert.equal(sc.route.edges.includes(CLOSED), true);
  assert.equal(sc.roadClosure.street, "Spring Garden Road");
  for (const brain of ["rules", "cautious"]) {
    const r = await evaluateChallenge(HFX, lesson, { brain });
    console.log(`  (${brain}: arrived ${r.arrived}, pass ${r.pass}, ${r.closure_entries} entries, ${r.collisions} collisions, ${r.deadlocks} deadlocks, ${r.duration_s ?? ""})`);
    assert.equal(r.arrived, true, brain);
    assert.equal(r.pass, true, `${brain}: ${r.failures}`);
    assert.equal(r.closure_entries, 0, brain);
    assert.equal(r.deadlocks, 0, brain);
    assert.equal(r.report.closure_entries, 0, brain);
  }
  // (a driver who drives straight on through it fails)
  const ctx = setupChallenge(HFX, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const metrics = new DriveMetrics(w.route.length);
  for (let k = 0; k < 40 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { kind: "lane", vTarget: 7, s0: 0 }, w.route, p.s, DT, w);
    const road = stepWorld(ctx, DT, w.t * 1000);
    metrics.record(w, null, road, DT);
  }
  const summary = metrics.summary(w, ctx.autopilot, false);
  assert.equal(summary.collisions >= 1, true);
  assert.equal(failures(summary).includes("collision"), true);
});

await test("checkpoints: a replay from a checkpoint repeats the closure, the re-plan and the detour exactly", async () => {
  const ctx = setupChallenge(HFX, lesson), recorder = new DriveRecorder(), clock = {};
  const step = async () => { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; if (ctx.autopilot.closureRouting) await ctx.autopilot.closureRouting; };
  for (let k = 0; k < 60 * 6; k++) await step();
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], route: ctx.world.route?.edges, known: [...ctx.world.roadClosures.known], list: ctx.world.roadClosures.list.map(c => c.id), v: ctx.world.violations, t: ctx.world.t });
  for (let k = 0; k < 60 * 12; k++) await step();
  const first = sig();
  assert.equal(JSON.parse(first).route.includes(CLOSED), false);
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(ctx.world.route.edges.includes(CLOSED), true, "before the re-plan");
  for (let k = 0; k < 60 * 12; k++) await step();
  assert.equal(sig(), first);
});

await test("with the option off nothing is built, drawn or reported, and traffic plays out exactly as before", () => {
  const ctx = rig({ roadClosures: false, traffic: 25, seed: 9 }), w = ctx.world;
  assert.equal(w.roadClosures.enabled, false);
  assert.equal(w.roadClosures.random, null);
  assert.equal(w.roadClosures.next, Infinity);
  for (let k = 0; k < 600; k++) stepWorld(ctx, DT, w.t * 1000);
  assert.equal(w.roadClosures.list.length, 0);
  assert.equal(w.roadClosuresSeen, false);
  assert.equal("closure_entries" in w.violations, false);
  const snap = buildSnapshot(w);
  assert.equal("road_closed" in snap, false);
  assert.equal(w.npcs.some(n => n.path?.closures), false);
  const metrics = new DriveMetrics(w.route.length);
  metrics.record(w, snap, w.roadInfo(), DT);
  assert.equal("closure_entries" in metrics.summary(w, { totals: {} }, false), false);
  // (on, but never closing anything: the other streams draw the same, since closures have their own)
  const run = (on) => { const c = rig({ roadClosures: on, close: false, traffic: 25, seed: 9 }); for (let k = 0; k < 900; k++) stepWorld(c, DT, c.world.t * 1000); return JSON.stringify([c.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v]), c.world.ego.x, c.world.ego.y]); };
  assert.equal(run(true), run(false));
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/road_closed.json`), from the
// challenge once the car has seen the barricade and has no detour yet, generated by the production pipeline.
if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(HFX, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 40 * 60 && !snap; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { kind: "lane", vTarget: 11, s0: 0 }, w.route, p.s, DT, w);
    stepWorld(ctx, DT, w.t * 1000);
    const s = buildSnapshot(w);
    if (!s.road_closed?.on_route || s.road_closed.bumper_to_stop_m > 45) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "stop_for_closure")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible);
  const state = toJevState(snap, candidates, { rejected });
  fs.writeFileSync(new URL("../data/snapshots/road_closed.json", import.meta.url), JSON.stringify({ name: "road_closed", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: ["stop_for_closure"] } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/road_closed.json (barricade ${Math.round(snap.road_closed.distance_m)} m ahead, ${eligible.length} eligible)`);
}
console.log(`${checks} road closure checks passed`);
process.exit(0);
