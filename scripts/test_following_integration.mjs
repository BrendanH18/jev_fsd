// The same following policy reaches drivers, model observations, predictions and manual coaching.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { followingPolicy } = await import("../static/js/sim/following.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions } = await import("../static/js/brain/state.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { cloneState } = await import("../static/js/lab/recorder.js");
const { EvaluationTrace } = await import("../static/js/lab/trace.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
function setup(weather = "dry", gap = 16, speed = 8) {
  const w = fixtureWorld({ weather }); w.followingDistance = true; w.ego.v = 10;
  const front = w.ego.spec.length - w.ego.spec.rearOverhang;
  const lead = new Vehicle(w.ego.x + front + gap + w.ego.spec.rearOverhang, 0, 0, speed);
  lead.id = "leader"; w.npcs = [lead];
  return w;
}
function decision(w) {
  const snap = buildSnapshot(w), candidates = sampleCandidates(snap, w);
  const result = simulateAll(candidates, snap, w);
  return { snap, candidates, ...result };
}
test("weather targets reach sensing, model state and both local drivers", () => {
  for (const weather of ["dry", "rain", "snow"]) {
    const w = setup(weather), { snap, candidates, eligible } = decision(w);
    const expected = followingPolicy(w.ego, snap.following);
    assert.equal(snap.following.policy.target_gap_m, expected.target_gap_m);
    assert.equal(snap.target.v <= expected.safe_speed_mps, true);
    const state = toJevState(snap, candidates, {});
    assert.equal(state.following.target_gap_m > state.following.gap_m, true);
    assert.equal(state.following.gap, "short");
    assert.equal(candidates.some(c => c.reject === "following_distance"), true);
    for (const brain of [new RulesBrain(), new CautiousAgent()]) {
      const choice = brain.decideSync(snap, eligible), picked = eligible.find(c => c.id === choice.candidateId);
      assert.equal(!!picked, true);
      assert.equal(picked.sim.end_speed < w.ego.v, true);
    }
  }
});
test("feature off preserves legacy observation and candidate shape", () => {
  const w = setup(); w.followingDistance = false;
  const { snap, candidates } = decision(w), state = toJevState(snap, candidates, {});
  assert.equal("policy" in snap.following, false);
  assert.equal("target_gap_m" in state.following, false);
  assert.equal(candidates.some(c => c.reject === "following_distance"), false);
  assert.equal("following_policy" in new DriveScore(w).snapshot(), false);
});
test("ordinary traffic rebuilds more room under the shared wet-road policy", () => {
  function run(enabled) {
    const w = setup("rain", 16, 10); w.followingDistance = enabled;
    w.ego.x = 60; w.ego.v = 8;
    const fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 1 });
    const car = new Vehicle(40, 0, 0, 10); car.id = "follower";
    Object.assign(car, { v0: 12, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.5, react: 0.5, lcRate: 0 },
      path: new NpcPath(w.map, fleet.random), stopMem: new StopMemory(), frozen: 0, waiting: 0 });
    car.path.start("street", 0, 40); fleet.vehicles.push(car);
    for (let k = 0; k < 180; k++) { w.ego.x += w.ego.v / 60; fleet.step(1 / 60); w.t += 1 / 60; }
    return w.ego.x - car.x;
  }
  assert.equal(run(true) > run(false) + 1, true);
});
test("an open door keeps sensing and approaching traffic finite", () => {
  const w = fixtureWorld(); w.followingDistance = true;
  const parked = new Vehicle(38, -2.6, 0, 0); parked.id = "parked_test"; parked.curb = "right";
  w.parked.add(parked);
  const door = w.parked.openDoor(parked); door.t = 1; w.parked.poseDoor(door);
  const snap = buildSnapshot(w);
  assert.equal(snap.following.id, door.id);
  assert.equal(Object.values(snap.following.policy).every(Number.isFinite), true);
  assert.equal(Number.isFinite(snap.target.v), true);
  w.ego.x = 100;
  const fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 1 });
  const car = new Vehicle(20, 0, 0, 5); car.id = "door_follower";
  Object.assign(car, { v0: 12, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.5, react: 0.5, lcRate: 0 },
    path: new NpcPath(w.map, fleet.random), stopMem: new StopMemory(), frozen: 0, waiting: 0 });
  car.path.start("street", 0, 20); fleet.vehicles.push(car);
  for (let k = 0; k < 120; k++) {
    fleet.step(1 / 60); w.t += 1 / 60;
    assert.equal([car.x, car.y, car.v].every(Number.isFinite), true);
  }
  assert.equal(car.lead?.v, 0);
  assert.equal(car.v < 5, true);
  assert.equal(car.x < parked.x, true);
});
function scoreSteps(w, score, seconds, dt = 0.1) {
  for (let i = 0; i < Math.round(seconds / dt); i++) { w.t += dt; score.record(w, w.roadInfo(), dt); }
}
test("a cut-in gets recovery time; sustained short following then costs points", () => {
  const w = setup("dry", 16, 10), lead = w.npcs[0]; lead.y = 3.5;
  const score = new DriveScore(w); scoreSteps(w, score, 0.2);
  lead.y = 0; scoreSteps(w, score, 4);
  assert.equal(score.closeFollowing, 0);
  assert.equal(score.followingRecovery > 3.8, true);
  assert.equal(score.coach.includes("Rebuild space"), true);
  const saved = cloneState(score), t = w.t;
  scoreSteps(w, score, 4); const first = score.snapshot();
  w.t = t; scoreSteps(w, saved, 4);
  assert.equal(first.close_following_s, saved.snapshot().close_following_s);
  assert.equal(first.close_following_s > 2, true);
  assert.equal(first.categories.safety < 100, true);
  const trace = new EvaluationTrace(); trace.measurements(w, score);
  assert.equal(trace.events.some(e => e.type === "following_gap"), true);
  w.npcs = []; scoreSteps(w, score, 0.2); w.npcs = [lead];
  const before = score.closeFollowing; scoreSteps(w, score, 0.2);
  assert.equal(score.closeFollowing > before, true, "reacquiring the same leader does not renew grace");
});
test("rebuilding a cut-in gap avoids following deductions", () => {
  const w = setup("rain", 16, 10), lead = w.npcs[0]; lead.y = 3.5;
  const score = new DriveScore(w); scoreSteps(w, score, 0.2);
  lead.y = 0; scoreSteps(w, score, 1);
  lead.x += 35; scoreSteps(w, score, 4);
  assert.equal(score.closeFollowing, 0);
  assert.equal(score.snapshot().categories.safety, 100);
});
test("coaching sees gaps beyond the old 35 m radius and skips adjacent traffic", () => {
  const w = setup("snow", 39, 10), lead = w.npcs[0], score = new DriveScore(w);
  scoreSteps(w, score, 1);
  assert.equal(score.closeFollowing > 0.9, true);
  assert.equal(score.coach.includes("target for speed and grip"), true);
  lead.y = 3.5; const before = score.closeFollowing;
  scoreSteps(w, score, 1);
  assert.equal(score.closeFollowing, before);
});
test("the driver's own move into a short gap does not earn recovery grace", () => {
  const w = setup("dry", 16, 10), lead = w.npcs[0]; lead.y = 3.5;
  const score = new DriveScore(w); scoreSteps(w, score, 0.2);
  w.ego.y = 3.5; scoreSteps(w, score, 1);
  assert.equal(score.followingRecovery, 0);
  assert.equal(score.closeFollowing > 0.9, true);
});
test("stopped queues are not tailgating and emergency risk remains visible during recovery", () => {
  const w = setup("dry", 6, 0); w.ego.v = 0;
  const score = new DriveScore(w); scoreSteps(w, score, 5);
  assert.equal(score.closeFollowing, 0);
  w.ego.v = 10; scoreSteps(w, score, 0.1);
  assert.equal(score.coach.includes("gap is closing"), true);
  assert.equal(score.lastTtc < 1.5, true);
});
// Optional snapshots are generated by the production pipeline for live model verification.
if (process.argv.includes("--write-snapshots")) {
  for (const [name, weather, gap, speed] of [["following_brake", "rain", 22, 0], ["following_merge", "dry", 16, 8]]) {
    const w = setup(weather, gap, speed), { snap, candidates, eligible, rejected } = decision(w);
    const { questions, local } = buildQuestions(snap, eligible);
    const state = toJevState(snap, candidates, { rejected });
    const slowing = eligible.filter(c => c.sim.end_speed < snap.ego.v - 0.5 && Math.abs(c.sim.lane_err_end) < 0.8).map(c => c.id);
    fs.writeFileSync(new URL(`../data/snapshots/${name}.json`, import.meta.url), JSON.stringify({ name, state, questions, local,
      expect: { vector_in: slowing } }, null, 2) + "\n");
  }
}
console.log(`${checks} following integration checks passed`);
process.exit(0);
