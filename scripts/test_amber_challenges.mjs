// Node 22: paired real-map amber lessons, driver behavior and checkpoint replay.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { approachPhase } = await import("../static/js/sim/signals.js");
const { toJevState } = await import("../static/js/brain/state.js");
const pack = JSON.parse(fs.readFileSync(new URL("../data/maps/623b012bc8b5.v6.pack.json", import.meta.url)));
for (const layer of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks"]) {
  const url = [2, 1].map(v => new URL(`../data/maps/623b012bc8b5.${layer}.v${v}.json`, import.meta.url)).find(url => fs.existsSync(url));
  if (url) pack[layer] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack), lessons = CHALLENGES.filter(c => c.hazard === "amber");
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
async function advance(ctx, steps) {
  for (let k = 0; k < steps; k++) {
    stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
  }
}
await test("both lessons use the same real signal without changing its plan", () => {
  assert.equal(lessons.length, 2);
  const before = JSON.stringify([...map.intersections.values()].map(i => i.plan));
  for (const challenge of lessons) {
    const a = challengeScenario(map, challenge), b = challengeScenario(map, challenge);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.start.edge, "e163"); assert.equal(a.route.edges.at(-1), "e165");
    assert.equal(a.tags.length_m > 100, true);
    const ctx = setupChallenge(map, challenge);
    assert.equal(ctx.world.amberLights, true);
    assert.equal(ctx.world.ego.v, 10);
    assert.equal(approachPhase(map.intersections.get("sig2"), "e163", ctx.world.t), "green");
  }
  assert.equal(JSON.stringify([...map.intersections.values()].map(i => i.plan)), before);
});
for (const weather of ["dry", "snow"]) for (const lesson of lessons) for (const brain of ["rules", "cautious"]) {
  const challenge = { ...lesson, weather };
  await test(`${weather}, ${lesson.id}, ${brain}: makes the safe decision and arrives cleanly`, async () => {
    const ctx = setupChallenge(map, challenge, { brain }), { world, autopilot } = ctx;
    const route = world.route, line = route.controls[0].sRoute, front = world.ego.spec.length - world.ego.spec.rearOverhang;
    let choice = null, stopped = false, crossed = false, crossingSignal = null, slowestInside = Infinity, fastestAmber = 0;
    for (let k = 0; k < 120 * 60 && autopilot.enabled; k++) {
      await advance(ctx, 1);
      const snap = buildSnapshot(world), i = snap.intersection;
      if (i?.amber) { choice ||= { ...i.amber }; fastestAmber = Math.max(fastestAmber, world.ego.v); }
      const bumper = route.project(world.ego.x, world.ego.y, 0).s + front;
      if (world.ego.v < 0.2 && bumper < line && bumper > line - 6 && i?.signal !== "green") stopped = true;
      if (!crossed && bumper >= line) {
        crossed = true; crossingSignal = approachPhase(map.intersections.get("sig2"), "e163", world.t);
      }
      if (bumper >= line && bumper <= line + 12) slowestInside = Math.min(slowestInside, world.ego.v);
    }
    assert.equal(choice !== null, true);
    assert.equal(choice.stop, lesson.id === "amber-stop");
    assert.equal(crossed, true);
    if (lesson.id === "amber-stop") { assert.equal(stopped, true); assert.equal(crossingSignal, "green"); }
    else {
      assert.equal(stopped, false); assert.equal(crossingSignal, "yellow");
      assert.equal(slowestInside > choice.speed_mps * 0.65, true, `slowed to ${slowestInside} inside`);
      assert.equal(fastestAmber <= choice.speed_mps + 0.5, true, `accelerated from ${choice.speed_mps} to ${fastestAmber}`);
    }
    assert.equal(world.violations.amber_lights_run || 0, 0);
    const result = await evaluateChallenge(map, challenge, { brain });
    assert.equal(result.pass, true, JSON.stringify(result.failures));
    assert.equal(result.report.qualified, true);
    assert.equal(result.events.filter(e => e.type === "hard_brake" && e.at_s < 60).length, 0, "amber decision does not require harsh braking");
    assert.equal(result.events.some(e => e.type === "hazard"), true);
  });
}
for (const lesson of lessons) await test(`${lesson.id}: replay preserves the latched decision and reproduces the drive`, async () => {
  const ctx = setupChallenge(map, lesson), recorder = new DriveRecorder(), clock = {};
  await advance(ctx, 100);
  const amber = buildSnapshot(ctx.world).intersection?.amber;
  assert.equal(!!amber, true);
  const state = toJevState(buildSnapshot(ctx.world), [], {});
  assert.equal(state.intersection.amber.stop, amber.stop);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const signature = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.psi, ctx.world.ego.v],
    amber: [...(ctx.world.ego.amberChoices || [])], violations: ctx.world.violations, t: ctx.world.t });
  await advance(ctx, 600); const first = signature();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(buildSnapshot(ctx.world).intersection.amber.stop, amber.stop);
  await advance(ctx, 600); assert.equal(signature(), first);
});
console.log(`${checks} amber challenge checks passed`);
process.exit(0);
