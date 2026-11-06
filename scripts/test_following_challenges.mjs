// Node 22: real-map following lessons, ordinary traffic physics and checkpoint replay.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const pack = JSON.parse(fs.readFileSync(new URL("../data/maps/623b012bc8b5.v6.pack.json", import.meta.url)));
for (const layer of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways"]) {
  const url = [2, 1].map(v => new URL(`../data/maps/623b012bc8b5.${layer}.v${v}.json`, import.meta.url)).find(url => fs.existsSync(url));
  if (url) pack[layer] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack), lessons = CHALLENGES.filter(c => c.hazard === "following");
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
async function advance(ctx, steps = 1) {
  for (let k = 0; k < steps; k++) {
    stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
  }
}
function leaderOf(world) { return world.npcs.find(n => n.id === world.challenge.following.carId); }
function gapOf(world, route) {
  const car = leaderOf(world), p = route.project(car.x, car.y, 0), local = world.ego.toLocal(car.x, car.y);
  return { gap: local.ahead - (world.ego.spec.length - world.ego.spec.rearOverhang) - car.spec.rearOverhang, lateral: p.lateral };
}

await test("following lessons use deterministic real streets and moving starts", () => {
  assert.equal(lessons.length, 2);
  const before = JSON.stringify(pack);
  for (const lesson of lessons) {
    const a = challengeScenario(map, lesson), b = challengeScenario(map, lesson);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.tags.length_m >= 200, true);
    const ctx = setupChallenge(map, lesson);
    assert.equal(ctx.world.followingDistance, true);
    assert.equal(ctx.world.ego.v > 8, true);
    assert.equal(leaderOf(ctx.world).v, ctx.world.ego.v);
    assert.equal(ctx.world.challenge.triggered, false);
    assert.equal(ctx.world.route.controls.length, 0, "a mid-block lesson does not borrow a traffic-light stop");
  }
  assert.equal(JSON.stringify(pack), before);
});

for (const lesson of lessons) for (const brain of ["rules", "cautious"]) {
  await test(`${lesson.id}, ${brain}: reacts to the hazard and arrives safely`, async () => {
    const ctx = setupChallenge(map, lesson, { brain }), { world, autopilot } = ctx, route = world.route;
    let leaderStopped = false, slowedForStop = false, maxLeadBrake = 0, lastLeadV = leaderOf(world).v;
    let enteredGap = null, minGap = Infinity, recoveredGap = null, minEgoSpeed = Infinity;
    let previous = { x: leaderOf(world).x, y: leaderOf(world).y };
    for (let k = 0; k < 120 * 60 && autopilot.enabled; k++) {
      await advance(ctx);
      const car = leaderOf(world), measured = gapOf(world, route), f = world.challenge.following;
      // A scripted action may change a control target; it must never teleport a car.
      assert.equal(Math.hypot(car.x - previous.x, car.y - previous.y) < 0.3, true);
      previous = { x: car.x, y: car.y };
      maxLeadBrake = Math.max(maxLeadBrake, (lastLeadV - car.v) * 60); lastLeadV = car.v;
      if (world.challenge.triggered) {
        if (car.v < 0.05) leaderStopped = true;
        if (car.v < 0.05 && world.ego.v < 3 && !f.released) slowedForStop = true;
        if (Math.abs(measured.lateral) < 1.5 && measured.gap > 0) {
          enteredGap ??= measured.gap;
          minGap = Math.min(minGap, measured.gap);
          if (world.t < 10) minEgoSpeed = Math.min(minEgoSpeed, world.ego.v);
          if (world.t > 10 && world.t < 16) recoveredGap = Math.max(recoveredGap || 0, measured.gap);
        }
      }
    }
    assert.equal(world.challenge.triggered, true);
    assert.equal(world.violations.collisions, 0);
    if (lesson.id === "brakes-ahead") {
      assert.equal(maxLeadBrake > 3.5, true, `leader braking peaked at ${maxLeadBrake}`);
      assert.equal(leaderStopped, true); assert.equal(slowedForStop, true);
      assert.equal(world.challenge.following.released, true);
      assert.equal(minGap > 1, true, `stopped with ${minGap} m between bumpers`);
    } else {
      assert.equal(enteredGap !== null, true, "the moving merger actually enters the driven lane");
      assert.equal(leaderOf(world).path.currentEdge().lane, 1);
      assert.equal(minEgoSpeed < 10, true, "driver eases off for the merger");
      assert.equal(recoveredGap > minGap + 3, true, `gap grew from ${minGap} to ${recoveredGap}`);
    }
    const result = await evaluateChallenge(map, lesson, { brain });
    assert.equal(result.pass, true, JSON.stringify(result.failures));
    assert.equal(result.report.qualified, true);
    assert.equal(result.events.some(e => e.type === "hazard"), true);
    if (lesson.id === "make-room") {
      assert.equal(result.report.following_recovery_s > 0, true, "the physical cut-in earns time to recover");
      const recovery = result.report.incidents.find(e => e.type === "following_recovery");
      assert.equal(result.events.filter(e => e.type === "following_gap").every(e => e.at_s >= recovery.at_s + 5), true,
        "a later short gap does not erase the initial recovery allowance");
    }
  });
}

for (const lesson of lessons) await test(`${lesson.id}: replay restores the hazard and repeats the same response`, async () => {
  const ctx = setupChallenge(map, lesson), recorder = new DriveRecorder(), clock = {};
  await advance(ctx, 240);
  assert.equal(ctx.world.challenge.triggered, true);
  const snap = buildSnapshot(ctx.world);
  assert.equal(!!snap.following, true);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const signature = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.psi, ctx.world.ego.v],
    traffic: ctx.world.npcs.map(n => [n.id, n.x, n.y, n.psi, n.v, n.lc, n.v0]), challenge: ctx.world.challenge,
    violations: ctx.world.violations, t: ctx.world.t });
  await advance(ctx, 600); const first = signature();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  await advance(ctx, 600); assert.equal(signature(), first);
});

console.log(`${checks} following challenge checks passed`);
process.exit(0);
