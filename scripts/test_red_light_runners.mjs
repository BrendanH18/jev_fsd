// Node 22: node --experimental-default-type=module scripts/test_red_light_runners.mjs
// Red-light runners (sim/red-light-runner.js): the shared test, sensing, candidates, Rules and the
// cautious agent, traffic on both sides of it, the audit, the "Fresh green" challenge, and nothing at
// all with the option off.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, joinLanes, cumulative, pointAt } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { StopMemory, approachPhase } = await import("../static/js/sim/signals.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, needsMotionQuestion } = await import("../static/js/brain/state.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { CHALLENGES, challengeById, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { canStopAt, commitRunner, runnerThreat, runsLight, RUNNER_COOLDOWN_S } = await import("../static/js/sim/red-light-runner.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }

// A four-way signal: west and east arms in group A, north and south in group B.
const ARM = 150, LINE = 142, FRONT = CAR.length - CAR.rearOverhang;
const nodes = [{ id: "w", x: -ARM, y: 0 }, { id: "c", x: 0, y: 0 }, { id: "e", x: ARM, y: 0 }, { id: "n", x: 0, y: ARM }, { id: "s", x: 0, y: -ARM }];
const edges = [], lanes = [];
for (const arm of ["w", "e", "n", "s"]) for (const inbound of [true, false]) {
  const from = inbound ? arm : "c", to = inbound ? "c" : arm, a = nodes.find(n => n.id === from), b = nodes.find(n => n.id === to);
  const id = `${arm}_${inbound ? "in" : "out"}`, pts = [[a.x, a.y], [b.x, b.y]], rx = (b.y - a.y) / ARM, ry = -(b.x - a.x) / ARM;
  edges.push({ id, from, to, pts, length: ARM, lanes: 1, lane_width: 3.2, lane_offsets: [1.6], asphalt: [-3.2, 3.2], parking: [0, 0], cls: "secondary", limit: 13.9, oneway: false, name: `${arm} Street`, ...(inbound ? { control: { type: "signal", id: "sig", s_line: LINE, group: ["w", "e"].includes(arm) ? "A" : "B" } } : {}) });
  lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * 1.6, y + ry * 1.6]) });
}
const grid = new MapData({ bbox: [0, 0, 1, 1], extent: [-170, -170, 170, 170], edges, lanes, nodes, buildings: [], stops: [],
  intersections: [{ id: "sig", x: 0, y: 0, offset_s: 0, vertices: ["c"], approaches: edges.filter(e => e.control).map(e => ({ edge: e.id, group: e.control.group, s_line: LINE })) }] });
const sig = grid.intersections.get("sig");
const greenA = sig.plan.cycle + 0.3;   // group A has just turned green; B is red
const yellowB = sig.plan.B.start + sig.plan.B.green + 0.05;   // B has just turned amber
const straight = (a, b) => {
  const pts = joinLanes(grid.lane(a, 0).pts, grid.lane(b, 0).pts), cum = cumulative(pts), polyline = [];
  for (let s = 0; s < cum.at(-1); s++) polyline.push(pointAt(pts, cum, s));
  polyline.push(pts.at(-1));
  return { id: `${a}-${b}`, polyline, edges: [a, b], turns: [], start_s: 0, goal_s: 290 };
};
// The driven car on the west arm heading east, `toLine` short of its line.
function gridWorld({ toLine = 1, v = 0, t = greenA, enabled = true } = {}) {
  const world = new World(grid, { parked: 0, pedestrians: 0, redRunners: enabled });
  Object.assign(world.ego, { x: -8 - FRONT - toLine, y: -1.6, psi: 0, v });
  world.t = t;
  world.route = new Route(straight("w_in", "e_out"), grid); world.destination = world.route.endPoint();
  return world;
}
// Traffic on arm `edge`, `toLine` short of its line (front bumper), going on to `exit`.
function npc(world, fleet, edge, exit, toLine, v, id) {
  const lane = grid.lane(edge, 0), s = LINE - toLine - FRONT, p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], Math.atan2(lane.pts[1][1] - lane.pts[0][1], lane.pts[1][0] - lane.pts[0][0]), v, CAR);
  Object.assign(car, { id, color: 0, v0: Math.max(v, 11), driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(grid, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start(edge, 0, s, [[exit, 0]]);
  fleet.vehicles.push(car);
  return car;
}
function decide(world, brain = new RulesBrain()) {
  const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world), result = simulateAll(candidates, snap, world);
  return { snap, candidates, ...result, choice: brain.decideSync(snap, result.eligible) };
}

await test("can-stop test: amber stopping distance, or visibly braking hard enough", () => {
  const car = new Vehicle(0, 0, 0, 11, CAR);
  assert.equal(canStopAt(car, 10), false);
  assert.equal(canStopAt(car, 45), true);
  car.ax = -6.5;
  assert.equal(canStopAt(car, 10.5), true);
  car.ax = -1;
  assert.equal(canStopAt(car, 10.5), false);
});

await test("the shared test finds crossing traffic that cannot stop for its red, and nothing else", () => {
  const world = gridWorld(), fleet = new NpcFleet(world, { count: 0, seed: 3 });
  assert.equal(approachPhase(sig, "w_in", world.t), "green");
  assert.equal(approachPhase(sig, "n_in", world.t), "red");
  const runner = npc(world, fleet, "n_in", "s_out", 12, 11, "cross");
  const threat = runnerThreat(world, world.ego, sig, 0, [runner]);
  assert.equal(threat?.relation, "cannot_stop");
  assert.equal(threat.side, "left");
  // (far enough back to stop, or braking hard enough to, or slow: none is a threat)
  const far = npc(world, fleet, "s_in", "n_out", 60, 11, "far");
  assert.equal(runnerThreat(world, world.ego, sig, 0, [far]), null);
  runner.ax = -7; assert.equal(runnerThreat(world, world.ego, sig, 0, [runner]), null); runner.ax = 0;
  const crawl = npc(world, fleet, "s_in", "n_out", 2, 1.5, "crawl");
  assert.equal(runnerThreat(world, world.ego, sig, 0, [crawl]), null);
  // (oncoming traffic on the car's own green is not crossing its way)
  const oncoming = npc(world, fleet, "e_in", "w_out", 5, 11, "oncoming");
  assert.equal(runnerThreat(world, world.ego, sig, 0, [oncoming]), null);
  // (a committed runner inside the junction is a threat until it is through)
  commitRunner(world, runner, "n_in", "sig"); runner.runner.entered = true;
  assert.equal(runnerThreat(world, world.ego, sig, 0, [runner])?.relation, "in_junction");
});

await test("sensing, wording, candidates, Rules and the cautious agent wait at the line on a fresh green", () => {
  for (const brain of [new RulesBrain(), new CautiousAgent()]) {
    const world = gridWorld({ toLine: 20, v: 6 }), fleet = new NpcFleet(world, { count: 0, seed: 3 });
    world.npcs = fleet.vehicles;
    npc(world, fleet, "n_in", "s_out", 14, 11, "cross");
    const d = decide(world, brain), rr = d.snap.red_light_runner;
    assert.equal(rr?.id, "cross"); assert.equal(rr.wait, true); assert.equal(rr.relation, "cannot_stop");
    assert.equal(rr.green_for_s < 1, true);
    const wait = d.candidates.find(c => c.id === "wait_for_runner");
    assert.equal(!!wait && wait.eligible, true);
    const go = d.candidates.find(c => c.id === "keep_lane_target" || c.id === "keep_lane_limit");
    assert.equal(go.eligible, false);
    assert.equal(["enters_ahead_of_red_light_runner", "collision"].includes(go.reject), true, go.reject);
    assert.equal(d.eligible.every(c => c.sim.end_speed < 6.5), true);
    assert.equal(d.choice.candidateId, "wait_for_runner");
    const state = toJevState(d.snap, d.eligible, {});
    assert.equal(state.red_light_runner.wait, true);
    assert.equal(state.red_light_runner.cannot_stop_before_its_line, true);
    assert.equal(situationClauses(d.snap).some(s => s.includes("look both ways") && s.includes("wait_for_runner")), true);
    assert.equal(needsMotionQuestion(d.snap), true);
  }
  // with the option off: no key, no candidate
  const off = gridWorld({ toLine: 20, v: 6, enabled: false }), fleet = new NpcFleet(off, { count: 0, seed: 3 });
  off.npcs = fleet.vehicles; npc(off, fleet, "n_in", "s_out", 14, 11, "cross");
  const d = decide(off);
  assert.equal("red_light_runner" in d.snap, false);
  assert.equal(d.candidates.some(c => c.id === "wait_for_runner"), false);
});

await test("too close to stop, the car is not asked to wait at the line", () => {
  const world = gridWorld({ toLine: 3, v: 12 }), fleet = new NpcFleet(world, { count: 0, seed: 3 });
  world.npcs = fleet.vehicles; npc(world, fleet, "n_in", "s_out", 14, 11, "cross");
  const rr = buildSnapshot(world).red_light_runner;
  assert.equal(rr?.wait, false);
  assert.equal(sampleCandidates(buildSnapshot(world), world).some(c => c.id === "wait_for_runner"), false);
});

await test("a driver draws once per approach, only when it could stop, and commitments are spaced out", () => {
  const world = gridWorld({ t: yellowB }), fleet = new NpcFleet(world, { count: 0, seed: 3 });
  let draws = 0; world.redRunners.random = () => { draws++; return 0; };
  const car = npc(world, fleet, "n_in", "s_out", 30, 11, "late");
  const e = car.path.edges[0], ctl = e.control, clear = () => false;
  assert.equal(runsLight(world, car, e, ctl, "green", 30, true, clear), null);
  assert.equal(runsLight(world, car, e, ctl, "yellow", 30, false, clear), null);
  assert.equal(draws, 0);
  const r = runsLight(world, car, e, ctl, "yellow", 30, true, clear);
  assert.equal(draws, 1); assert.equal(r?.speed, 11); assert.equal(world.redRunnersSeen, true);
  assert.equal(runsLight(world, car, e, ctl, "red", 18, true, clear) === car.runner, true);
  assert.equal(draws, 1);
  const other = npc(world, fleet, "s_in", "n_out", 30, 11, "other");
  assert.equal(runsLight(world, other, other.path.edges[0], ctl, "yellow", 30, true, clear), null);
  assert.equal(draws, 1, "cooldown");
  world.t += RUNNER_COOLDOWN_S;
  const bike = npc(world, fleet, "s_in", "n_out", 30, 11, "bike"); bike.kind = "bike";
  assert.equal(runsLight(world, bike, bike.path.edges[0], ctl, "yellow", 30, true, clear), null);
  assert.equal(draws, 1, "cyclists never run");
  const busy = npc(world, fleet, "e_in", "w_out", 30, 11, "busy");
  assert.equal(runsLight(world, busy, busy.path.edges[0], ctl, "yellow", 30, true, () => true), null);
  assert.equal(draws, 1, "never into an occupied junction");
});

await test("a runner holds its speed through the red, and still stops for a car already in its path", () => {
  for (const blocked of [false, true]) {
    const world = gridWorld({ t: yellowB + 2.5, toLine: 60 }), fleet = new NpcFleet(world, { count: 0, seed: 3 });
    world.npcs = fleet.vehicles;
    const runner = npc(world, fleet, "n_in", "s_out", 25, 10, "runner");
    commitRunner(world, runner, "n_in", "sig");
    // (a car stopped across the runner's way inside the junction)
    const stuck = blocked ? npc(world, fleet, "w_in", "e_out", -7, 0, "stuck") : null;
    if (stuck) { stuck.v0 = 0; stuck.frozen = 1e6; }
    let crossedRed = false, fastest = 0, overlap = false;
    for (let k = 0; k < 8 * 60; k++) {
      fleet.step(1 / 60); world.t += 1 / 60;
      if (runner.runner) fastest = Math.max(fastest, runner.v);
      if (runner.runner?.entered && approachPhase(sig, "n_in", world.t) === "red") crossedRed = true;
      if (stuck && obbOverlap(runner.obb(), stuck.obb(), 0)) overlap = true;
    }
    assert.equal(fastest <= 10 + 1e-6, true, `sped up to ${fastest}`);
    assert.equal(overlap, false);
    if (!blocked) assert.equal(crossedRed, true);
    else assert.equal(runner.v < 0.5 && runner.y > stuck.y, true, "stopped short of the car in its path");
  }
});

await test("traffic on a fresh green waits at the line for the runner, then goes", () => {
  const world = gridWorld({ toLine: 60 }), fleet = new NpcFleet(world, { count: 0, seed: 3 });
  world.npcs = fleet.vehicles;
  Object.assign(world.ego, { x: -120, y: 40 });   // (out of the way)
  const runner = npc(world, fleet, "n_in", "s_out", 16, 11, "runner");
  commitRunner(world, runner, "n_in", "sig");
  const waiting = npc(world, fleet, "w_in", "e_out", 6, 0, "waiting");
  let heldWhileRunning = true, overlap = false, crossed = false;
  for (let k = 0; k < 10 * 60; k++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    const front = waiting.x + Math.cos(waiting.psi) * FRONT;
    if (runner.runner && front > -8 + 0.2) heldWhileRunning = false;
    if (front > 0) crossed = true;
    if (obbOverlap(runner.obb(), waiting.obb(), 0)) overlap = true;
  }
  assert.equal(heldWhileRunning, true); assert.equal(overlap, false); assert.equal(crossed, true);
});

// The real map, as the Lab loads it.
const pack = JSON.parse(fs.readFileSync(new URL("../data/maps/3e794edbefcb.v6.pack.json", import.meta.url)));
for (const layer of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways"]) {
  const url = [2, 1].map(v => new URL(`../data/maps/3e794edbefcb.${layer}.v${v}.json`, import.meta.url)).find(url => fs.existsSync(url));
  if (url) pack[layer] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack), lesson = challengeById("fresh-green");

await test("Fresh green: the real junction, its plan unchanged, starts on red with the runner committed", () => {
  assert.ok(CHALLENGES.some(c => c.id === "fresh-green"));
  assert.equal(CHALLENGES.filter(c => c.icon === lesson.icon).length, 1);
  const before = JSON.stringify(map.intersections.get("sig3").plan);
  const a = challengeScenario(map, lesson), b = challengeScenario(map, lesson);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const ctx = setupChallenge(map, lesson);
  assert.equal(ctx.world.redRunners.enabled, true); assert.equal(ctx.world.redRunnersSeen, true);
  assert.equal(approachPhase(map.intersections.get("sig3"), "e220", ctx.world.t), "red");
  assert.equal(ctx.fleet.vehicles.length, 1); assert.equal(ctx.fleet.vehicles[0].runner?.edge, "e309");
  assert.equal(JSON.stringify(map.intersections.get("sig3").plan), before);
});

for (const brain of ["rules", "cautious"]) await test(`Fresh green, ${brain}: waits for the runner, then goes, and passes`, async () => {
  const ctx = setupChallenge(map, lesson, { brain }), { world, autopilot } = ctx, runner = ctx.fleet.vehicles[0];
  const line = world.route.controls[0].sRoute, front = world.ego.spec.length - world.ego.spec.rearOverhang;
  let sawRunner = false, enteredEarly = false, enteredAt = null;
  for (let k = 0; k < 20 * 60; k++) {
    stepWorld(ctx, 1 / 60, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    if (autopilot.snap?.red_light_runner?.wait) sawRunner = true;
    const bumper = world.route.project(world.ego.x, world.ego.y, 0).s + front;
    if (bumper > line + 0.2 && enteredAt === null) { enteredAt = world.t; if (runner.runner) enteredEarly = true; }
  }
  assert.equal(sawRunner, true); assert.equal(enteredEarly, false); assert.equal(enteredAt !== null, true);
  assert.equal(world.violations.fresh_green_conflicts || 0, 0);
  const result = await evaluateChallenge(map, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.fresh_green_conflicts, 0); assert.equal(result.collisions, 0);
  assert.equal(result.report.fresh_green_conflicts, 0);
});

await test("Fresh green: a driver who just goes on green enters ahead of the runner and fails", () => {
  const ctx = setupChallenge(map, lesson); ctx.autopilot.setEnabled(false);
  const { world } = ctx, metrics = new DriveMetrics(world.route.length), score = new DriveScore(world, { title: lesson.title });
  for (let k = 0; k < 12 * 60; k++) {
    const road = stepWorld({ ...ctx, input: world.t >= world.challenge.freshGreen.greenAt ? { throttle: true } : { brake: true } }, 1 / 60, world.t * 1000);
    metrics.record(world, null, road, 1 / 60); score.record(world, road, 1 / 60);
  }
  const summary = metrics.summary(world, ctx.autopilot, true);
  assert.equal(summary.fresh_green_conflicts, 1);
  assert.equal(failures(summary).includes("entered on green ahead of a car running the red"), true);
  const report = score.finish();
  assert.equal(report.fresh_green_conflicts, 1); assert.equal(report.score <= 69, true);
});

await test("Fresh green: a replay checkpoint keeps the runner's commitment and reproduces the drive", async () => {
  const ctx = setupChallenge(map, lesson), recorder = new DriveRecorder(), clock = {};
  const advance = async (n) => { for (let k = 0; k < n; k++) { stepWorld(ctx, 1 / 60, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; } };
  await advance(120);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const signature = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], runner: ctx.fleet.vehicles.map(n => [n.x, n.y, n.v, !!n.runner]), v: ctx.world.violations, t: ctx.world.t });
  await advance(600); const first = signature();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(!!ctx.fleet.vehicles[0].runner, true);
  await advance(600); assert.equal(signature(), first);
});

await test("free drive traffic: runners now and then, never into anyone, and nothing at all with the option off", () => {
  const run = (enabled) => {
    const world = new World(map, { seed: 7, parked: 0, pedestrians: 0, redRunners: enabled });
    const fleet = new NpcFleet(world, { count: 45, seed: 13 });
    world.npcs = fleet.vehicles;
    let overlaps = 0, held = 0;
    for (let k = 0; k < 360 * 60; k++) {
      fleet.step(1 / 60); world.t += 1 / 60;
      if (k % 6) continue;
      for (const r of fleet.vehicles) if (r.runner) {
        const box = r.obb();
        for (const o of fleet.vehicles) if (o !== r && Math.abs(o.x - r.x) < 8 && Math.abs(o.y - r.y) < 8 && obbOverlap(box, o.obb(), 0)) overlaps++;
      }
    }
    for (const n of fleet.vehicles) if (n.runDrawn || n.runner) held++;
    return { world, overlaps, touched: held, committed: world.redRunners.committed };
  };
  const on = run(true);
  assert.equal(on.committed > 0, true, "no runner in 6 minutes of traffic");
  assert.equal(on.overlaps, 0);
  const off = run(false);
  assert.equal(off.world.redRunners.random, null);
  assert.equal(off.committed, 0); assert.equal(off.touched, 0);
  const metrics = new DriveMetrics(100).summary(off.world, { totals: {} }, false);
  assert.equal("fresh_green_conflicts" in metrics, false);
  assert.equal("fresh_green_conflicts" in new DriveScore(off.world).finish(), false);
  console.log(`  (${on.committed} runners committed in 6 minutes of traffic)`);
});

console.log(`${checks} red-light runner checks passed`);
process.exit(0);
