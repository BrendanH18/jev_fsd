// School crossing guards: which crosswalks get one and when, the guard waiting for children and a gap,
// stepping out with the STOP sign, the children crossing and the guard walking back; traffic and
// cyclists stopping short of the crosswalk and waiting until everyone is off the road; the driven car's
// sensing, candidates and rejections; what models are told; the audit, coaching and the HUD; nothing
// computed or drawn with the option off; checkpoints; and the "Stop for the guard" challenge with Rules and
// the cautious agent.
// node --experimental-default-type=module scripts/test_crossing_guards.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { mapClock } = await import("../static/js/sim/speed-zones.js");
const { CrossingGuards, STOP_M, frontToCentre, guardNotice, guardSites } = await import("../static/js/sim/crossing-guard.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { cloneState, DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const MTL = load("bb9df59633e0"), HFX = load("49db0d437c8c"), KITS = load("623b012bc8b5");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const FRONT = CAR.length - CAR.rearOverhang;
// Rue Berri, Montréal: one-way, one lane, 30 km/h, past École Louis-Hippolyte-Lafontaine (its school
// zone from 91.8 m to 203.5 m), a marked crosswalk 138.1 m along, a signal's line at 215.9 m.
const EDGE = "e398", NEXT = "e439", CW = "x13264534476", BERRI = MTL.edges.get(EDGE);

// Rue Berri at `hour`, with guards (or not), no children coming on their own unless `arrivals`.
function berri({ guards = true, hour = 9, arrivals = false, seed = 3, traffic = 0 } = {}) {
  setWeather("dry");
  const world = new World(MTL, { seed, parked: 0, pedestrians: 0, guards });
  world.setClock(mapClock(hour, MTL));
  world.crossingGuards.arrivals = arrivals;
  const fleet = new NpcFleet(world, { count: traffic, bikes: 0, seed: 5 });
  world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  return { world, fleet, autopilot: idle };
}
// The driven car on Rue Berri, its front `front` metres along, at `v`, with a route to 190 m.
function egoAt(world, front, v = 0, goal = 190) {
  const lane = MTL.lane(EDGE, 0);
  world.placeOnLane(lane, front - FRONT);
  world.ego.v = v;
  world.route = new Route(routeFromLanes(MTL, [lane], front - FRONT, goal), MTL, world.ego.spec);
  world.destination = world.route.polyline?.at(-1) ?? null;
  world.route.project(world.ego.x, world.ego.y);
}
// A car (or a cyclist) on Rue Berri, its front `front` metres along, at `v`, going straight on.
function npcAt(world, fleet, { front, v = 8, id = "car", bike = false }) {
  const spec = bike ? BIKE : CAR, lane = MTL.lane(EDGE, 0), s = front - (spec.length - spec.rearOverhang);
  const p = pointAt(lane.pts, lane.cum, s), h = headingAt(lane.pts, lane.cum, s);
  const n = new Vehicle(p[0], p[1], h, v, spec);
  Object.assign(n, { id, v0: v, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(MTL, fleet.random, bike ? { bike: true } : {}), frozen: 0, waiting: 0,
    ...(bike ? { kind: "bike", side: 0, strip: false } : {}) });
  n.path.start(EDGE, 0, s, [[NEXT, 0]]);
  fleet.vehicles.push(n);
  return n;
}
const centreS = (o) => projectPoint(BERRI.pts, BERRI.cum, [o.x, o.y], null).s;
const frontS = (o) => centreS(o) + (o.spec.length - o.spec.rearOverhang);
const post = (world) => world.crossingGuards.posts.find((p) => p.cw.id === CW);
const CW_S = MTL.crosswalks.find((c) => c.id === CW) && projectPoint(BERRI.pts, BERRI.cum, [MTL.crosswalks.find((c) => c.id === CW).x, MTL.crosswalks.find((c) => c.id === CW).y]).s;
const holding = (world, p) => p.paddleUp || world.crossingGuards.inRoad(p).length > 0;

await test("posts: every marked crosswalk in a school zone, and no other; Rue Berri in Montréal and Trollope Street in Halifax, none in Kitsilano", () => {
  for (const [map, want] of [[MTL, ["x13264534476"]], [HFX, ["x5267204719"]], [KITS, []]]) {
    const w = new World(map, { seed: 1, parked: 0, pedestrians: 0, guards: true });
    assert.deepEqual(guardSites(w).map((s) => s.cw.id), want);
  }
  assert.ok(Math.abs(CW_S - 138.1) < 0.5, `the crosswalk ${CW_S.toFixed(1)} m along Rue Berri`);
  const { world } = berri();
  assert.equal(world.crossingGuards.posts.length, 0, "nobody on duty before the first step");
  step({ world, fleet: new NpcFleet(world, { count: 0, bikes: 0 }), autopilot: idle });
  const p = post(world);
  assert.ok(p && p.onDuty && p.zone?.name.includes("Louis-Hippolyte"), "on duty at 9:00, in the school's zone");
  assert.ok(world.crowd.list.includes(p.guard) && p.guard.worker && p.guard.crossingGuard === p.id && p.guard.paddle === "down");
  assert.ok(!world.crossingGuards.onRoad(p, p.guard), "waiting on the sidewalk");
  // (after school, at 18:00, nobody is on duty; and posts go off duty when the zone ends)
  const late = berri({ hour: 18 });
  for (let i = 0; i < 60; i++) step(late);
  assert.equal(late.world.crossingGuards.posts.length, 0, "no posts outside school hours");
  world.setClock(mapClock(17.5, MTL));
  step({ world, fleet: new NpcFleet(world, { count: 0, bikes: 0 }), autopilot: idle });
  assert.ok(!p.onDuty && !world.crowd.list.includes(p.guard), "off duty once the zone ends");
  world.setClock(mapClock(9, MTL));
  step({ world, fleet: new NpcFleet(world, { count: 0, bikes: 0 }), autopilot: idle });
  assert.ok(p.onDuty && world.crowd.list.includes(p.guard), "back on duty");
});

await test("a crossing: the guard waits for the children and a gap, steps out with the sign up, the children cross, the guard walks back and lowers it on the sidewalk", () => {
  const ctx = berri();
  egoAt(ctx.world, 20, 0);
  step(ctx);
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  for (let i = 0; i < 300; i++) step(ctx);
  assert.equal(p.phase, "idle", "nobody to take across: the guard stays at the curb");
  const kids = g.gather(p, { side: -1, count: 3, from: 12 });
  assert.ok(kids.every((k) => k.child && k.guard === p.id && ctx.world.crowd.list.includes(k)));
  const phases = [], seen = new Set();
  let stepOutAt = null, waitingAt = null, backAt = null, downAt = null, upWithNobody = 0, kidsInRoadWhileDown = 0;
  for (let i = 0; i < 60 * 40 && downAt === null; i++) {
    step(ctx);
    if (phases.at(-1) !== p.phase) phases.push(p.phase);
    if (waitingAt === null && g.waiting(p).length === 3) waitingAt = ctx.world.t;
    if (stepOutAt === null && p.paddleUp) stepOutAt = ctx.world.t;
    if (p.phase === "back" && backAt === null) { backAt = ctx.world.t; assert.ok(!kids.some((k) => g.onRoad(p, k)), "every child off the road before the guard walks back"); }
    if (!p.paddleUp && kids.some((k) => g.onRoad(p, k))) kidsInRoadWhileDown++;
    if (p.paddleUp && !g.inRoad(p).length && p.phase === "back") upWithNobody++;
    for (const k of kids) if (g.onRoad(p, k)) seen.add(k.id);
    if (stepOutAt !== null && !p.paddleUp) downAt = ctx.world.t;
  }
  assert.deepEqual(phases, ["idle", "out", "cross", "back", "idle"]);
  assert.ok(waitingAt !== null && stepOutAt >= waitingAt, `out at ${stepOutAt?.toFixed(1)} s, once all three were waiting (${waitingAt?.toFixed(1)} s)`);
  assert.equal(seen.size, 3, "all three crossed");
  assert.equal(kidsInRoadWhileDown, 0, "the sign is never down with a child in the road");
  assert.ok(downAt !== null && !g.onRoad(p, p.guard) && Math.hypot(p.guard.x - p.home[0], p.guard.y - p.home[1]) < 0.05, "the guard lowers the sign back on the sidewalk");
  assert.ok(upWithNobody > 0, "the sign stays up while the guard walks back, until the guard is off the road");
  assert.ok(ctx.world.guardsSeen, "a guard has worked");
  assert.equal(p.kids.length, 0, "the children are the crowd's now");
  for (const k of kids) assert.ok(!k.guard && k.home && k.path.length > 0, "walking off home along the far sidewalk");
  for (let i = 0; i < 60 * 40; i++) step(ctx);
  assert.ok(kids.every((k) => !ctx.world.crowd.list.includes(k)), "and gone home");
});

await test("the gap: the guard does not step out in front of a car too close to stop comfortably, and does once it is by", () => {
  const ctx = berri();
  egoAt(ctx.world, 20, 0);
  step(ctx);
  const p = post(ctx.world);
  const car = npcAt(ctx.world, ctx.fleet, { front: CW_S - 18, v: 8.3, id: "close" });
  ctx.world.crossingGuards.gather(p, { side: 1, count: 2 });
  let outWhileClose = 0, outAt = null;
  for (let i = 0; i < 60 * 10 && outAt === null; i++) {
    step(ctx);
    if (p.paddleUp) outAt = ctx.world.t;
    if (p.paddleUp && ctx.fleet.vehicles.includes(car) && frontS(car) < CW_S + 2) outWhileClose++;
  }
  assert.equal(outWhileClose, 0, "not while the car is coming up to the crosswalk");
  assert.ok(outAt !== null && outAt < 4, `out once it was by (${outAt?.toFixed(1)} s)`);
});

await test("the stopping gap uses the road's grip in snow", () => {
  const ctx = berri();
  egoAt(ctx.world, 20);
  step(ctx);
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  npcAt(ctx.world, ctx.fleet, { front: CW_S - 45, v: 8.3 });
  assert.equal(g.gap(p), true);
  setWeather("snow");
  assert.equal(g.gap(p), false);
  setWeather("dry");
});

await test("traffic: a car and a cyclist coming up stop short of the crosswalk while the sign is up, and go on only once the guard and every child are off the road", () => {
  const ctx = berri();
  egoAt(ctx.world, 10, 0);
  step(ctx);
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  g.gather(p, { side: 1, count: 4 });
  const car = npcAt(ctx.world, ctx.fleet, { front: CW_S - 45, v: 8.3, id: "car" });
  const bike = npcAt(ctx.world, ctx.fleet, { front: CW_S - 55, v: 4.5, id: "bike", bike: true });
  let maxFront = { car: -Infinity, bike: -Infinity }, stoppedFor = { car: 0, bike: 0 }, wentOnAt = {}, clearAt = null, collisions = 0;
  for (let i = 0; i < 60 * 45; i++) {
    step(ctx);
    collisions += ctx.world.events.filter((e) => e.type === "collision").length;
    const hold = holding(ctx.world, p);
    if (p.stops > 0 && !hold && clearAt === null) clearAt = ctx.world.t;
    for (const [k, n] of [["car", car], ["bike", bike]]) {
      if (!ctx.fleet.vehicles.includes(n)) continue;
      if (hold) { maxFront[k] = Math.max(maxFront[k], frontS(n)); if (n.v < 0.2) stoppedFor[k] += 1 / 60; }
      if (!hold && wentOnAt[k] === undefined && p.stops > 0 && n.v > 1 && frontS(n) > CW_S) wentOnAt[k] = ctx.world.t;
    }
  }
  assert.equal(p.stops, 1, "one crossing");
  assert.ok(maxFront.car <= CW_S - STOP_M + 0.5, `the car's front at most ${(CW_S - maxFront.car).toFixed(2)} m short of the crosswalk's centre while the sign was up`);
  assert.ok(maxFront.bike <= CW_S - STOP_M + 0.5 || maxFront.bike < maxFront.car, `the cyclist held back (${(CW_S - maxFront.bike).toFixed(2)} m short)`);
  assert.ok(stoppedFor.car > 1, `the car stood ${stoppedFor.car.toFixed(1)} s`);
  assert.ok(clearAt !== null && wentOnAt.car > clearAt && wentOnAt.bike > clearAt, `both went on (car ${wentOnAt.car?.toFixed(1)} s, cyclist ${wentOnAt.bike?.toFixed(1)} s) after the road was clear (${clearAt?.toFixed(1)} s)`);
  assert.equal(collisions, 0);
});

await test("the driven car: crossing_guard sensing, the stop_for_crossing_guard candidate, and every candidate past the stop point rejected while the sign is up or anyone is in the road", () => {
  const ctx = berri();
  egoAt(ctx.world, CW_S - 45, 8.3);
  step(ctx);
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  g.gather(p, { side: 1, count: 2 });
  ctx.world._road = ctx.world.roadInfo();
  // (children waiting, the sign down: ready to stop)
  let snap = buildSnapshot(ctx.world);
  assert.ok(snap.crossing_guard && snap.crossing_guard.ready && !snap.crossing_guard.wait && snap.crossing_guard.paddle === "down" && snap.crossing_guard.waiting === 2);
  // (the sign up: the guard steps out, the car 40 m off, at 30 km/h)
  for (let i = 0; i < 60 && !p.paddleUp; i++) { const v = ctx.world.ego.v; step(ctx); ctx.world.ego.v = v; }
  assert.ok(p.paddleUp, "out");
  egoAt(ctx.world, CW_S - 40, 8.3);
  ctx.world._road = ctx.world.roadInfo();
  snap = buildSnapshot(ctx.world);
  const cg = snap.crossing_guard;
  assert.ok(cg && cg.wait && cg.paddle === "up" && cg.guard_id === p.guard.id && cg.crosswalk_id === CW);
  assert.ok(Math.abs(cg.bumper_to_crosswalk_m - 40) < 0.6 && Math.abs(cg.bumper_to_stop_m - (40 - STOP_M)) < 0.6, `${cg.bumper_to_stop_m.toFixed(2)} m to the stop point`);
  const cands = sampleCandidates(snap, ctx.world);
  const stop = cands.find((c) => c.id === "stop_for_crossing_guard");
  assert.ok(stop, "the stop is on offer");
  simulateAll(cands, snap, ctx.world);
  assert.ok(stop.eligible, `the stop is clear (${stop.reject})`);
  // (close to the stop point at 22 km/h, the target is down to a stop there, and everything that goes on
  // past it is out)
  egoAt(ctx.world, CW_S - STOP_M - 6, 6);
  ctx.world._road = ctx.world.roadInfo();
  const near = buildSnapshot(ctx.world);
  assert.ok(near.target.v < 6 && near.target.reasons.includes("crossing guard holding up STOP"), JSON.stringify(near.target));
  const all = sampleCandidates(near, ctx.world);
  simulateAll(all, near, ctx.world);
  const past = all.filter((c) => c.reject === "passes_crossing_guard");
  assert.ok(past.length >= 2 && all.filter((c) => c.eligible).every((c) => c.sim.progress_m < 6 + 1.5 + 0.6 || c.law.kind === "hard_brake"), `${past.map((c) => c.id).join(", ")}`);
  // (the Rules brain and the cautious agent both stop)
  const elig = cands.filter((c) => c.eligible);
  assert.ok(["stop_for_crossing_guard", "keep_lane_stop", "keep_lane_slow"].includes(new RulesBrain().decideSync(snap, elig).candidateId));
  assert.equal(new CautiousAgent().decideSync(snap, elig).candidateId, "stop_for_crossing_guard");
  // (standing at the stop point, Rules holds still)
  egoAt(ctx.world, CW_S - STOP_M - 0.8, 0);
  ctx.world._road = ctx.world.roadInfo();
  const at = buildSnapshot(ctx.world), atC = sampleCandidates(at, ctx.world);
  simulateAll(atC, at, ctx.world);
  assert.equal(new RulesBrain().decideSync(at, atC.filter((c) => c.eligible)).motion, "stop");
});

await test("too close to stop when the sign goes up: the car is not held, and the audit does not count it", () => {
  const ctx = berri();
  egoAt(ctx.world, CW_S - 30, 0);
  step(ctx);
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  g.gather(p, { side: 1, count: 1 });
  p.held = true;
  // (the car 7 m short of the stop point at 30 km/h, which needs 9.8 m at 3.5 m/s^2; the guard told to go)
  egoAt(ctx.world, CW_S - STOP_M - 7, 8.3);
  Object.assign(p, { held: false, phase: "out", paddleUp: true, stops: p.stops + 1 }); p.guard.paddle = "up";
  ctx.world._road = ctx.world.roadInfo();
  const snap = buildSnapshot(ctx.world);
  assert.ok(snap.crossing_guard && !snap.crossing_guard.wait && snap.crossing_guard.paddle === "up");
  assert.ok(situationClauses(snap).join(" ").includes("too close to stop"));
  ctx.world.auditGuards();
  assert.equal([...ctx.world.guardCalls.values()][0]?.owed, false);
});

await test("the audit: driving past the guard's sign once owed counts once, fails the drive and is coached; it reaches the metrics only once a guard has worked", () => {
  const ctx = berri();
  egoAt(ctx.world, CW_S - 60, 0);
  const metrics = new DriveMetrics(ctx.world.route.length), score = new DriveScore(ctx.world, { title: "Rue Berri", map: "montreal", route: ctx.world.route });
  let road = step(ctx);
  assert.ok(!("guard_violations" in metrics.summary(ctx.world, { totals: { decisions: 0 } }, false)), "not before a guard has worked");
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  g.gather(p, { side: 1, count: 2 });
  for (let i = 0; i < 60 && !p.paddleUp; i++) { road = step(ctx); metrics.record(ctx.world, null, road, 1 / 60); score.record(ctx.world, road, 1 / 60); }
  assert.ok(p.paddleUp && ctx.world.guardsSeen);
  // (driven by hand, straight on at 30 km/h, into the sign)
  ctx.world.ego.v = 8.3;
  const events = [];
  for (let i = 0; i < 60 * 10 && !events.length; i++) {
    road = stepWorld({ ...ctx, input: {} }, 1 / 60, ctx.world.t * 1000);
    metrics.record(ctx.world, null, road, 1 / 60); score.record(ctx.world, road, 1 / 60);
    events.push(...ctx.world.events.filter((e) => e.type === "passed_crossing_guard"));
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].guard, p.id);
  const d = frontToCentre(p.cw, ctx.world.ego);
  assert.ok(d < STOP_M - 2 + 0.3 && d > STOP_M - 2 - 0.5, `counted ${d.toFixed(2)} m short of the centre`);
  for (let i = 0; i < 60; i++) { road = stepWorld({ ...ctx, input: { brake: true } }, 1 / 60, ctx.world.t * 1000); score.record(ctx.world, road, 1 / 60); }
  assert.equal(ctx.world.violations.guard_violations, 1, "once");
  const m = metrics.summary(ctx.world, { totals: { decisions: 0 } }, true);
  assert.equal(m.guard_violations, 1);
  assert.ok(failures(m).includes("drove past a crossing guard's stop sign"));
  const report = score.snapshot();
  assert.equal(report.guard_violations, 1);
  assert.ok(report.tips.some((t) => t.includes("crossing guard")) && report.incidents.some((i) => i.type === "guard_violation"));
});

await test("models are told: the guard in the state, a situation line, the motion criterion and the prompt line; and the HUD", () => {
  const ctx = berri();
  egoAt(ctx.world, CW_S - 35, 6);
  step(ctx);
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  g.gather(p, { side: -1, count: 3 });
  ctx.world._road = ctx.world.roadInfo();
  let snap = buildSnapshot(ctx.world);
  assert.ok(situationClauses(snap).join(" ").includes("3 children are waiting at the curb with the guard"));
  assert.equal(guardNotice(ctx.world)?.text, "SCHOOL CROSSING · CHILDREN WAITING · SLOW, READY TO STOP");
  for (let i = 0; i < 60 * 5 && !(p.phase === "cross" && g.inRoad(p).length > 1); i++) { const v = ctx.world.ego.v; step(ctx); egoAt(ctx.world, CW_S - 35, v); }
  ctx.world._road = ctx.world.roadInfo();
  snap = buildSnapshot(ctx.world);
  const cands = sampleCandidates(snap, ctx.world), sim = simulateAll(cands, snap, ctx.world);
  const state = toJevState(snap, cands, { rejected: sim.rejected });
  assert.ok(state.crossing_guard && state.crossing_guard.stop_sign === "held up" && state.crossing_guard.stop === true && state.crossing_guard.in_road.length >= 2 && state.crossing_guard.school.includes("Louis-Hippolyte"));
  const line = situationClauses(snap).join(" ");
  assert.ok(line.includes("school crossing guard") && line.includes("every child are off the road") && line.includes("`stop_for_crossing_guard`"), line);
  const { questions } = buildQuestions(snap, sim.eligible);
  assert.ok(questions.motion?.criteria.stop.includes("`crossing_guard.wait_in_m` under 2"));
  if (questions.vector) assert.ok(questions.vector.criteria.stop_for_crossing_guard?.includes("for the crossing guard"));
  assert.ok(SYSTEM_PROMPT.includes("`stop_for_crossing_guard`") && SYSTEM_PROMPT.includes("crossing_guard.stop"));
  assert.equal(guardNotice(ctx.world)?.text, "CROSSING GUARD · STOP · WAIT UNTIL EVERYONE IS ACROSS");
  assert.equal(guardNotice(ctx.world)?.stop, true);
});

await test("checkpoints: a copied world keeps its guard and children in its own crowd", () => {
  const ctx = berri();
  egoAt(ctx.world, 20, 0);
  step(ctx);
  const p = post(ctx.world);
  ctx.world.crossingGuards.gather(p, { side: 1, count: 2 });
  for (let i = 0; i < 60 * 4; i++) step(ctx);
  assert.ok(p.paddleUp);
  const copy = cloneState({ world: ctx.world, fleet: ctx.fleet }, new Set([MTL, ctx.world.crowd.marked, ...ctx.world.crowd.marked])).world;
  const q = copy.crossingGuards.posts[0];
  assert.ok(q !== p && q.guard !== p.guard && copy.crowd.list.includes(q.guard) && q.kids.every((k) => copy.crowd.list.includes(k)));
  assert.equal(q.phase, p.phase); assert.equal(q.stops, p.stops); assert.ok(q.cw === p.cw, "the crosswalk is the map's");
});

await test("stop obligations are fixed when the sign rises, even if a driver speeds up or slows down before sensing", () => {
  const ctx = berri();
  egoAt(ctx.world, CW_S - 40, 0);
  step(ctx);
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  g.gather(p, { count: 2 });
  step(ctx);
  assert.ok(p.paddleUp);
  assert.equal(p.calls.get("ego"), true);
  ctx.world.ego.v = 25;
  ctx.world._road = ctx.world.roadInfo();
  assert.equal(buildSnapshot(ctx.world).crossing_guard.wait, true);
  const sees = ctx.world.sees;
  ctx.world.sees = () => false;
  assert.equal(buildSnapshot(ctx.world).crossing_guard.wait, true, "a previously seen sign still binds when traffic hides the guard");
  ctx.world.sees = sees;
  const late = npcAt(ctx.world, ctx.fleet, { front: CW_S - 10, v: 12, id: "late" });
  assert.equal(g.owes(p, late, 5), false);
  late.v = 0;
  assert.equal(g.owes(p, late, 5), false);
});

await test("school hours end only after the crossing is clear; guards return next morning without duplicates", () => {
  const ctx = berri();
  egoAt(ctx.world, 20);
  step(ctx);
  const g = ctx.world.crossingGuards, p = post(ctx.world);
  g.gather(p, { count: 2 });
  step(ctx);
  assert.ok(p.paddleUp);
  ctx.world.setClock(mapClock(19, MTL));
  for (let i = 0; i < 60 * 35; i++) step(ctx);
  assert.equal(p.paddleUp, false);
  assert.equal(p.onDuty, false);
  ctx.world.setClock(mapClock(9, MTL));
  step(ctx);
  assert.equal(p.onDuty, true);
  assert.equal(ctx.world.crowd.list.filter(k => k.id === p.id).length, 1);
});

await test("restoring a recorder reconnects the guard manager, its people and its stop obligations", () => {
  const ctx = setupChallenge(MTL, CHALLENGES.find(c => c.id === "crossing-guard"), { brain: "rules" });
  const recorder = new DriveRecorder(), clock = {};
  recorder.record({ ...ctx, clock, drive: null }, true);
  recorder.restore(0, { ...ctx, clock, setDrive() {} });
  const g = ctx.world.crossingGuards, p = g.posts.find(x => x.id === ctx.world.challenge.guardPostId);
  assert.equal(g.world === ctx.world, true);
  assert.equal(ctx.world.crowd.list.includes(p.guard), true);
  p.held = false;
  g.step(1 / 60);
  assert.equal(ctx.world.guardsSeen, true);
  assert.equal(p.calls.get("ego"), true);
});

await test("off: no posts, nothing computed and no random stream drawn, nothing sensed, and nothing in the metrics or the coaching", () => {
  const counts = {};
  for (const name of ["staff", "control", "gap", "inRoad", "holdAhead", "waiting", "arrive"]) {
    const original = CrossingGuards.prototype[name];
    CrossingGuards.prototype[name] = function (...args) { counts[name] = (counts[name] || 0) + 1; return original.apply(this, args); };
  }
  const ctx = berri({ guards: false, traffic: 12, arrivals: true });
  egoAt(ctx.world, 40, 0);
  const state = ctx.world.crossingGuards.random.getState();
  const metrics = new DriveMetrics(ctx.world.route.length), score = new DriveScore(ctx.world, { title: "Rue Berri", map: "montreal", route: ctx.world.route });
  let road;
  for (let i = 0; i < 60 * 30; i++) { road = step(ctx); metrics.record(ctx.world, null, road, 1 / 60); score.record(ctx.world, road, 1 / 60); }
  ctx.world._road = ctx.world.roadInfo();
  const snap = buildSnapshot(ctx.world);
  assert.equal(snap.crossing_guard, null);
  assert.equal(ctx.world.crossingGuards.random.getState(), state, "no random draws");
  assert.deepEqual(counts, {}, `nothing computed: ${JSON.stringify(counts)}`);
  assert.ok(!ctx.world.crowd.list.some((p) => p.crossingGuard || p.guard), "nobody in the crowd");
  assert.ok(!ctx.fleet.vehicles.some((n) => "guardStop" in n), "traffic never looked");
  assert.ok(!ctx.world.guardsSeen && !("guard_violations" in ctx.world.violations));
  assert.ok(!("guard_violations" in metrics.summary(ctx.world, { totals: { decisions: 0 } }, false)) && !("guard_violations" in score.snapshot()));
  // (and with guards on, the same streets out of school hours: nobody on duty, nothing drawn)
  const late = berri({ hour: 19, arrivals: true });
  egoAt(late.world, 40, 0);
  const lateState = late.world.crossingGuards.random.getState();
  for (let i = 0; i < 60 * 5; i++) step(late);
  assert.equal(late.world.crossingGuards.random.getState(), lateState);
  assert.equal(late.world.crossingGuards.posts.length, 0);
  // (only "Stop for the guard" turns guards on among the challenges)
  assert.deepEqual(CHALLENGES.filter((c) => c.guards).map((c) => c.id), ["crossing-guard"]);
});

await test("free drive: with children coming along now and then, the guard walks group after group across, and traffic waits each time", () => {
  const ctx = berri({ arrivals: true, seed: 11 });
  egoAt(ctx.world, 20, 0);
  for (let i = 0; i < 60 * 150; i++) {
    step(ctx);
    // (a car up Rue Berri every 25 s)
    if (i % (60 * 25) === 0) npcAt(ctx.world, ctx.fleet, { front: 30, v: 8.3, id: `car_${i}` });
  }
  const p = post(ctx.world);
  assert.ok(p.stops >= 2, `${p.stops} crossings in 150 s`);
  assert.equal(ctx.world.violations.collisions, 0);
});

await test("the challenge: Rules and the cautious agent stop short of the crosswalk while the guard walks the children across, wait until everyone is off the road, then go", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "crossing-guard");
  assert.ok(challenge && challenge.map === "montreal" && challenge.guards && challenge.title === "Stop for the guard" && challenge.time === "morning");
  const scenario = challengeScenario(MTL, challenge);
  assert.equal(MTL.edges.get(scenario.start.edge).name, "Rue Berri");
  assert.equal(scenario.crossingGuard.crosswalk, CW);
  for (const brain of ["rules", "cautious"]) {
    let arrived = false;
    const ctx = setupChallenge(MTL, challenge, { brain, onEvent: (e) => { if (e.type === "arrived") arrived = true; } });
    const { world, fleet, autopilot } = ctx, g = world.crossingGuards, p = g.posts.find((x) => x.id === world.challenge.guardPostId);
    assert.ok(p && p.held && p.kids.length === 3 && !g.arrivals);
    const metrics = new DriveMetrics(world.route.length);
    let maxFront = -Infinity, stood = 0, clearAt = null, wentOn = null, upAt = null;
    while (world.t < 90 && autopilot.enabled && !arrived) {
      const road = step({ world, fleet, autopilot });
      metrics.record(world, autopilot.snap, road, 1 / 60);
      if (autopilot.firing) await autopilot.firing;
      const hold = holding(world, p), f = frontS(world.ego);
      if (p.paddleUp && upAt === null) upAt = world.t;
      if (hold) { maxFront = Math.max(maxFront, f); if (world.ego.v < 0.5) stood += 1 / 60; }
      if (p.stops && !hold && clearAt === null) clearAt = world.t;
      if (clearAt !== null && wentOn === null && world.ego.v > 1) wentOn = world.t;
    }
    const v = world.violations, m = metrics.summary(world, autopilot, arrived);
    assert.ok(arrived, `${brain} arrives`);
    assert.ok(upAt !== null && upAt > 3, `${brain}: the guard stepped out at ${upAt?.toFixed(1)} s, as the car came up`);
    assert.equal(v.collisions + v.failed_to_yield + (v.guard_violations || 0), 0, `${brain}: ${JSON.stringify(v)}`);
    assert.ok(m.pass && m.guard_violations === 0, `${brain}: ${failures(m)}`);
    assert.ok(maxFront <= CW_S - STOP_M + 1.5, `${brain}: front at most ${(CW_S - maxFront).toFixed(2)} m short of the crosswalk's centre while the sign was up`);
    assert.ok(stood > 1.5, `${brain} waited ${stood.toFixed(1)} s, at walking pace or stopped`);
    assert.ok(clearAt !== null && wentOn !== null && wentOn >= clearAt, `${brain} went on at ${wentOn?.toFixed(1)} s, once everyone was off the road (${clearAt?.toFixed(1)} s)`);
  }
});

console.log(`${checks} crossing guard checks passed`);
process.exit(0);
