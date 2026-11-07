// node --experimental-default-type=module scripts/test_red_turn_signs.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { browserRoute } = await import("../static/js/demo/routing.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { NpcPath } = await import("../static/js/sim/npc.js");
const { StopMemory, approachPhase, movementSignal } = await import("../static/js/sim/signals.js");
const { redTurnBanned } = await import("../static/js/sim/red-turn-signs.js");
const { leftOnRedAllowed } = await import("../static/js/sim/left-on-red.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { rng } = await import("../static/js/common.js");

function loadMap(key) {
  const pack = JSON.parse(fs.readFileSync(new URL(`../data/maps/${key}.v6.pack.json`, import.meta.url)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks"]) {
    const file = [2, 1].map(v => new URL(`../data/maps/${key}.${name}.v${v}.json`, import.meta.url)).find(p => fs.existsSync(p));
    if (file) pack[name] = JSON.parse(fs.readFileSync(file));
  }
  return new MapData(pack);
}
const map = loadMap("4a96d42cb3f2"), challenge = CHALLENGES.find(c => c.id === "wait-for-green");
const from = "e355", to = "e179", inter = map.intersections.get(map.edges.get(from).control.id);
const phase = t => movementSignal(approachPhase(inter, from, t), "right");
const green = Array.from({ length: inter.plan.cycle }, (_, t) => t).find(t => phase(t) === "green");
function pose(w, path, s, v = 0) {
  const p = path.pointAt(s); Object.assign(w.ego, { x: p[0], y: p[1], psi: path.headingAt(s), v });
}
function stopped({ enabled = true, manual = false, time } = {}) {
  const ctx = setupChallenge(map, challenge), w = ctx.world, path = w.route;
  w.redTurnSigns = enabled;
  if (time != null) w.t = time;
  const control = path.controls.find(c => c.edge === from), front = w.ego.spec.length - w.ego.spec.rearOverhang;
  pose(w, path, control.sRoute - front - 0.8);
  if (manual) { w.route = null; w.destination = null; }
  for (let i = 0; i < 30; i++) w.audit(1 / 30, w.roadInfo());
  assert.equal(w.egoStop.completed, true, "fixture made a full stop");
  return { ...ctx, path };
}
function decide(w) {
  const snap = buildSnapshot(w), candidates = sampleCandidates(snap, w);
  return { snap, candidates, ...simulateAll(candidates, snap, w) };
}
const crosses = r => r.eligible.some(c => c.sim.progress_m + r.snap.routeProj.s + r.snap.ego.front_m > r.snap.intersection.s_line_route + 1);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log("✓ " + name); }

test("mapped sign blocks a stopped right turn; disabled feature preserves the previous behavior", () => {
  const on = stopped(), r = decide(on.world), off = decide(stopped({ enabled: false }).world);
  assert.equal(phase(on.world.t), "red");
  assert.equal(r.snap.intersection.no_turn_on_red, true);
  assert.equal(r.snap.intersection.right_on_red, null);
  assert.equal(crosses(r), false);
  assert.equal(off.snap.intersection.no_turn_on_red, undefined);
  assert.equal(off.snap.intersection.right_on_red.go, true);
  assert.equal(crosses(off), true);
  assert.equal(new RulesBrain().decideSync(r.snap, r.eligible).motion, "stop");
  assert.equal(new CautiousAgent().decideSync(r.snap, r.eligible).motion, "stop");
  const state = toJevState(r.snap, r.candidates, {}), { questions } = buildQuestions(r.snap, r.eligible);
  assert.equal(state.intersection.no_turn_on_red, true);
  assert.equal(situationClauses(r.snap).some(s => s.includes("sign prohibits this turn on red")), true);
  assert.equal(questions.motion.instructions.includes("sign prohibits this turn on red"), true);
  if (process.argv.includes("--write-snapshot")) {
    fs.writeFileSync(new URL("../data/snapshots/no_turn_on_red.json", import.meta.url), JSON.stringify({ name: "no_turn_on_red", state, questions, expect: { motion: "stop" } }, null, 2) + "\n");
  }
});

test("green permits the turn and routing keeps its direct movement", () => {
  const ctx = stopped({ time: green }), r = decide(ctx.world);
  assert.equal(r.snap.intersection.signal, "green");
  assert.equal(crosses(r), true);
  const start = ctx.path.pointAt(0), end = ctx.path.endPoint();
  const route = browserRoute(map, { x: start[0], y: start[1], heading: ctx.path.headingAt(0) }, { x: end[0], y: end[1] }, { restrictions: true });
  assert.equal(route?.edges.join(","), `${from},${to}`);
});

test("NPCs honor the same signed movement after a full stop", () => {
  const { world: w, fleet } = stopped();
  Object.assign(w.ego, { x: 1e6, y: 1e6, v: 0 });
  const edge = map.edges.get(from), lane = map.lane(from, edge.lanes - 1), n = new Vehicle(0, 0, 0, 0);
  n.id = "signed-npc"; n.stopMem = new StopMemory();
  const front = n.spec.length - n.spec.rearOverhang, s = edge.control.s_line - front - 0.8;
  const p = pointAt(lane.pts, lane.cum, s); Object.assign(n, { x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) });
  n.path = new NpcPath(map, rng(43)); n.path.start(from, lane.idx, s, [[to, map.edges.get(to).lanes - 1]]);
  fleet.vehicles.push(n);
  const approach = n.path.edges[0]; n.stopMem.update(approach.control, 0.8, 0, 1);
  assert.equal(fleet.rightOnRed(n, approach, 0.8, n.path.s + front, 1 / 30), false);
  w.redTurnSigns = false;
  assert.equal(fleet.rightOnRed(n, approach, 0.8, n.path.s + front, 1 / 30), true);
});

function drivePast(ctx, afterAudit = () => {}) {
  const w = ctx.world, path = ctx.path, dt = 1 / 30;
  let s = path.project(w.ego.x, w.ego.y, 0).s;
  for (let i = 0; i < 12 / dt; i++) {
    s += 6 * dt; pose(w, path, s, 6); w.t += dt;
    w.audit(dt, w.roadInfo()); afterAudit(w);
  }
}
test("audit uses the actual exit with or without navigation, and allows green and unsigned turns", () => {
  for (const manual of [false, true]) {
    for (const [enabled, time, expected] of [[true, undefined, 1], [false, undefined, 0], [true, green, 0]]) {
      const ctx = stopped({ enabled, time, manual }); drivePast(ctx);
      assert.equal(ctx.world.violations.red_lights_run, expected, `manual=${manual}, signed=${enabled}, time=${time}`);
    }
  }
});

test("a sign expiring after entry does not pardon a prohibited turn", () => {
  const original = map.redTurns;
  map.redTurns = original.map(r => r.from === from ? { ...r, condition: { days: [0], start: 420, end: 540 } } : r);
  try {
    const ctx = stopped(); ctx.world.clock.hour = 8; ctx.world.clock.weekday = 0;
    assert.equal(redTurnBanned(ctx.world, from, to), true);
    let captured = false;
    drivePast(ctx, w => {
      if (!captured && w.lastSignal?.rightOnRed) {
        captured = true; assert.equal(w.lastSignal.rightOnRed.bannedExits.includes(to), true);
        w.clock.hour = 9; assert.equal(redTurnBanned(w, from, to), false);
      }
    });
    assert.equal(captured, true); assert.equal(ctx.world.violations.red_lights_run, 1);
  } finally { map.redTurns = original; }
});

test("a left-turn-on-red sign blocks the otherwise eligible Calgary movement", () => {
  const calgary = loadMap("a53c5bcf6438"), ctx = setupChallenge(calgary, CHALLENGES.find(c => c.id === "left-on-red"));
  const w = ctx.world; w.redTurnSigns = true;
  assert.equal(leftOnRedAllowed(w, "e594", "e593"), true);
  calgary.redTurns.push({ id: "left-sign-test", from: "e594", to: ["e593"], kind: "no_left_turn_on_red" });
  assert.equal(leftOnRedAllowed(w, "e594", "e593"), false);
  assert.equal(buildSnapshot(w).intersection.no_turn_on_red, true);
  assert.equal(buildSnapshot(w).intersection.left_on_red, undefined);
  w.redTurnSigns = false; assert.equal(leftOnRedAllowed(w, "e594", "e593"), true);
});

async function advance(ctx, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
  }
}
{
  const ctx = stopped(), recorder = new DriveRecorder();
  recorder.record(ctx, true);
  const summary = () => JSON.stringify([ctx.world.t, ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v, ctx.world.violations, ctx.autopilot.lastDecision?.chosenId]);
  await advance(ctx, 44); const expected = summary();
  ctx.world.redTurnSigns = false;
  recorder.restore(0, { ...ctx, clock: {}, setDrive: () => {} });
  assert.equal(ctx.world.redTurnSigns, true);
  assert.equal(buildSnapshot(ctx.world).intersection.no_turn_on_red, true);
  ctx.world.paused = false; await advance(ctx, 44);
  assert.equal(summary(), expected, "checkpoint continuation must be exact");
  assert.equal(ctx.world.violations.red_lights_run, 0);
  assert.equal(ctx.world.route.project(ctx.world.ego.x, ctx.world.ego.y, 0).s > ctx.world.route.controls.find(c => c.edge === from).sRoute, true, "continued through the green");
  checks++; console.log("✓ replay restores the enabled sign and reproduces waiting through green");
}
for (const brain of ["rules", "cautious"]) {
  const result = await evaluateChallenge(map, challenge, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.red_lights, 0);
  checks++; console.log(`✓ ${brain} completes Wait for green (${result.time_s.toFixed(1)} s)`);
}
console.log(`${checks} red-turn-sign checks passed.`);
process.exit(0);
