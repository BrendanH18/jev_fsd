// Regression coverage for routing, authored hazards, agent safety and replay branching.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { browserRoute, browserDrives } = await import("../static/js/demo/routing.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder, cloneState } = await import("../static/js/lab/recorder.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { WorldClock } = await import("../static/js/sim/world-clock.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { rng } = await import("../static/js/common.js");
const { validAgentChoice, registerAgent } = await import("../static/js/brain/registry.js");
const { driveLink } = await import("../static/js/lab/share.js");
const names = { kitsilano: "623b012bc8b5", victoria: "d7454a9751b7", montreal: "bb9df59633e0", toronto: "4a96d42cb3f2" };
const load = id => new MapData(JSON.parse(fs.readFileSync(new URL(`../data/maps/${names[id]}.v5.pack.json`, import.meta.url))));
let assertions = 0;
function test(name, fn) { fn(); assertions++; console.log(`✓ ${name}`); }

test("random checkpoints retain their exact stream without consuming the live stream", () => {
  const random = rng(42); random(); const copy = random.clone();
  assert.equal(copy(), random()); assert.equal(copy(), random());
});
test("checkpoint copies retain accessors, cycles and shared random identity", () => {
  const a = { x: 4, random: rng(4), get center() { return [this.x, 0]; } }; a.self = a;
  const state = cloneState({ a, random: a.random }); state.a.x = 9;
  assert.deepEqual(state.a.center, [9, 0]); assert.equal(state.a.self, state.a); assert.equal(state.random, state.a.random); assert.equal(a.x, 4);
});
test("challenge links preserve a nested Pages root and omit unrelated parameters", () => {
  const url = new URL(driveLink({ challenge: "door-zone", drive: "rules", seed: 42, token: "secret" }, "https://example.com/jev_fsd/?old=1"));
  assert.equal(url.pathname, "/jev_fsd/"); assert.equal(url.searchParams.get("challenge"), "door-zone"); assert.ok(!url.searchParams.has("token")); assert.ok(!url.searchParams.has("old"));
});
test("agent validation rejects ineligible manoeuvres and malformed motions", () => {
  assert.ok(validAgentChoice({ candidateId: "safe", motion: "drive" }, [{ id: "safe" }]));
  assert.ok(!validAgentChoice({ candidateId: "unsafe", motion: "drive" }, [{ id: "safe" }]));
  assert.ok(!validAgentChoice({ candidateId: "safe", motion: "teleport" }, [{ id: "safe" }]));
  assert.throws(() => registerAgent({ id: "rules", label: "Overwrite", create: () => ({}) }));
});

for (const challenge of CHALLENGES) {
  const map = load(challenge.map), a = challengeScenario(map, challenge), b = challengeScenario(map, challenge);
  test(`${challenge.id}: stable route and matching control type`, () => {
    assert.deepEqual(a, b); assert.ok(cumulative(a.route.polyline).at(-1) > 100);
    const control = map.edges.get(a.start.edge).control;
    if (challenge.hazard === "signal") assert.equal(control.type, "signal");
    if (challenge.hazard === "stop") assert.equal(control.type, "stop");
  });
  for (const brain of ["rules", "cautious"]) {
    const result = await evaluateChallenge(map, challenge, { brain });
    test(`${challenge.id}: ${brain} completes a clean authored drive`, () => { assert.ok(result.pass, JSON.stringify(result.failures)); assert.ok(result.report.qualified); assert.equal(result.cost_usd, 0); });
  }
}

const map = load("kitsilano"), ctx = setupChallenge(map, CHALLENGES[0]);
const clock = new WorldClock(15.5), recorder = new DriveRecorder({ seconds: 3 }), drive = new DriveScore(ctx.world, { route: ctx.world.route });
let activeDrive = drive;
const context = () => ({ ...ctx, clock, drive: activeDrive });
for (let i = 0; i < 300; i++) { const road = stepWorld(ctx, 1 / 60, ctx.world.t * 1000); activeDrive.record(ctx.world, road, 1 / 60); clock.update(ctx.world.t); recorder.record(context()); }
test("recordings remain bounded and preserve authored actors", () => { assert.ok(recorder.frames.length <= recorder.capacity); assert.ok(Number.isFinite(ctx.world.parked.list[0].x)); assert.equal(ctx.fleet.vehicles[0].kind, "bike"); });
const index = Math.floor(recorder.frames.length / 2), target = { ...ctx, clock, setDrive: value => { activeDrive = value; } };
recorder.restore(index, target); ctx.world.paused = false;
const advance = async count => { for (let i = 0; i < count; i++) { const road = stepWorld(ctx, 1 / 60, ctx.world.t * 1000); activeDrive.record(ctx.world, road, 1 / 60); if (ctx.autopilot.firing) await ctx.autopilot.firing; } };
await advance(120);
const first = { x: ctx.world.ego.x, y: ctx.world.ego.y, v: ctx.world.ego.v, score: activeDrive.snapshot(), random: ctx.fleet.random.getState() };
recorder.restore(index, target); ctx.world.paused = false; await advance(120);
test("restoring and continuing yields identical traffic, physics and scoring", () => {
  assert.deepEqual({ x: ctx.world.ego.x, y: ctx.world.ego.y, v: ctx.world.ego.v, score: activeDrive.snapshot(), random: ctx.fleet.random.getState() }, first);
  assert.equal(ctx.fleet.world, ctx.world); assert.equal(ctx.world.crowd.world, ctx.world); assert.equal(ctx.world.npcs, ctx.fleet.vehicles);
});
recorder.branch(index);
test("branching discards future checkpoints and labels the alternate drive", () => { assert.equal(recorder.frames.length, index + 1); assert.ok(recorder.branched); });

const from = { x: ctx.world.ego.x, y: ctx.world.ego.y, heading: ctx.world.ego.psi };
const drives = browserDrives(map, from);
test("browser routing produces reachable, distinct suggested drives", () => {
  assert.equal(drives.length, 3);
  for (const drive of drives) { const route = browserRoute(map, from, { x: drive.destination[0], y: drive.destination[1] }); assert.ok(route); for (let i = 1; i < route.edges.length; i++) assert.ok(map.successors(route.edges[i - 1]).includes(route.edges[i])); }
  assert.equal(new Set(drives.map(d => d.destination.join(","))).size, 3);
});
registerAgent({ id: "invalid-test", label: "Invalid fixture", create: () => ({ async decide() { return { candidateId: "teleport", motion: "drive", meta: {} }; } }) });
const invalid = setupChallenge(map, CHALLENGES[0], { brain: "invalid-test" });
invalid.autopilot.step(1 / 60, 0); await invalid.autopilot.firing;
test("invalid custom-agent output falls back to Rules without executing it", () => { assert.equal(invalid.world.violations.fallbacks, 1); assert.equal(invalid.autopilot.lastDecision.meta.source, "rules_fallback"); assert.notEqual(invalid.autopilot.lastDecision.chosenId, "teleport"); });
console.log(`${assertions} drive lab checks passed`);
process.exit(0);
