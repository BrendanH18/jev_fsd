// The compound drive (ROADMAP 9.3; lab/challenges/rush-hour.js): listed apart from the challenges and
// the road tests, so the numbered suites are as they were; one deterministic drive through its five situations in
// order; Rules and the cautious agent on both tracks; a driver who brakes for the stale green and is
// caught short by the amber fails with a red light; what two saved arena runs of it take; and the
// saved model case.
//   node --experimental-default-type=module scripts/test_compound_drive.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { load } = await import("./drive_lab_maps.mjs");
const { CHALLENGES, COMPOUND_DRIVES, challengeById, challengeScenario } = await import(
  "../static/js/lab/challenges.js"
);
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { EVALUATION_SCHEMA, validateEvaluation } = await import("../static/js/lab/history.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions } = await import("../static/js/brain/state.js");
const { approachPhase } = await import("../static/js/sim/signals.js");
const { activeSuite } = await import("./canonical_suite.mjs");
const drive = await import("../static/js/lab/challenges/rush-hour.js");

let checks = 0;
async function test(name, fn) {
  await fn();
  checks++;
  console.log(`✓ ${name}`);
}
const lesson = drive.challenge,
  map = load(lesson.map),
  DT = 1 / 60;

await test("the compound drive is listed apart, and the numbered suites do not know it", () => {
  assert.equal(COMPOUND_DRIVES.length, 1);
  assert.equal(COMPOUND_DRIVES[0] === lesson && challengeById("rush-hour") === lesson, true);
  assert.equal(lesson.compound, true);
  assert.equal(
    [...CHALLENGES, ...ROAD_TESTS].some((c) => c.id === lesson.id || c.seed === lesson.seed),
    false,
  );
  assert.equal(CHALLENGES.length, 60);
  assert.equal(Object.keys(activeSuite.arena.drives).length, CHALLENGES.length + ROAD_TESTS.length);
  assert.equal(Object.hasOwn(activeSuite.arena.drives, lesson.id), false);
  // (only features that exist already, switched on through setupChallenge's own flags)
  assert.deepEqual(
    Object.keys(lesson)
      .filter((k) => lesson[k] === true)
      .sort(),
    ["amberLights", "compound", "followingDistance", "tailgaters"],
  );
});

await test("its scenario is the same every time: West 4th Avenue east and left up Maple Street", () => {
  const a = challengeScenario(map, lesson),
    b = challengeScenario(map, lesson);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.route.edges, ["e197", "e199", "e201", "e163", "e436", "e434"]);
  // (the curb lane, and the left lane on the block before the left turn)
  assert.deepEqual(a.route.lanes, [1, 1, 1, 0, 0, 0]);
  assert.deepEqual(a.tags, { length_m: a.tags.length_m, signals: 4, stops: 1, lefts: 1, rights: 0 });
  assert.equal(a.tags.length_m > 800 && a.tags.length_m < 900, true, String(a.tags.length_m));
  assert.equal(a.compound.bus.edge, "e201");
  assert.equal(a.compound.stop.cars.length, 2);
});

// --- the drive, as the arena runs it
const results = {},
  stages = {};
for (const brain of ["rules", "cautious"])
  for (const track of ["guarded", "open"]) {
    const key = `${brain}:${track}`;
    results[key] = await evaluateChallenge(map, lesson, {
      brain,
      track,
      onStep: ({ world, fleet }) => {
        const c = world.challenge.compound,
          s = (stages[key] ||= { amberAt: c.amberAt, start: world.t, tailgater: !!world.tailgatersSeen });
        Object.assign(s, c.stage, { tailgater: s.tailgater || !!world.tailgatersSeen });
        s.oncoming = c.oncomingIds?.length ?? 0;
        s.through = c.throughIds?.length ?? 0;
        s.bus = c.stage.bus ?? null;
        s.cars = fleet.vehicles.length;
      },
    });
    const r = results[key];
    console.log(
      `  ${key}: ${r.pass ? "PASS" : `FAIL (${r.failures.join("; ")})`} in ${r.time_s} s, ${r.distance_m} m, ${r.decisions} decisions`,
    );
  }

await test("the five situations come in order, from the unchanged signal plan", () => {
  for (const [key, s] of Object.entries(stages)) {
    assert.equal(s.tailgater, true, `${key}: the tailgater closed up`);
    assert.equal(Math.abs(s.amberAt - s.start - drive.AMBER_IN_S) < 0.02, true, `${key}: the amber's cue`);
    assert.equal(s.amberAt < s.bus && s.bus < s.left && s.left < s.stop, true, `${key}: ${JSON.stringify(s)}`);
    assert.equal(s.oncoming, 2, key);
    assert.equal(s.through, 2, key);
  }
  const ctx = setupChallenge(map, lesson, { brain: "rules" }),
    vine = map.intersections.get(map.edges.get("e197").control.id),
    at = ctx.world.challenge.compound.amberAt;
  assert.equal(approachPhase(vine, "e197", at - 0.05), "green");
  assert.equal(approachPhase(vine, "e197", at + 0.05), "yellow");
  ctx.autopilot.setEnabled(false);
});

await test("Rules and the cautious agent complete it cleanly, with a hazard event, on both tracks", () => {
  for (const [key, r] of Object.entries(results)) {
    assert.equal(r.report.status, "arrived", key);
    assert.equal(r.pass, true, `${key}: ${JSON.stringify(r.failures)}`);
    assert.equal(
      r.events.some((e) => e.type === "hazard"),
      true,
      key,
    );
    assert.equal(r.time_s < lesson.limit_s * 0.75, true, `${key}: ${r.time_s} s of ${lesson.limit_s}`);
    // (the tailgater's metric is reported, as it has followed the car)
    assert.equal(r.brake_checks, 0, key);
    assert.equal(r.amber_lights_run, 0, key);
  }
});

await test("the built-in drivers drive the open track exactly as the guarded one", () => {
  const strip = ({ track, flagged_choices, flagged_by_check, decisions_trace, wall_ms, report, ...rest }) => rest;
  for (const brain of ["rules", "cautious"]) {
    assert.equal(
      JSON.stringify(strip(results[`${brain}:open`])),
      JSON.stringify(strip(results[`${brain}:guarded`])),
      brain,
    );
    assert.equal(results[`${brain}:open`].flagged_choices, 0, brain);
  }
});

// A driver who drives as Rules does, but takes `id` whenever it is on offer from `from` to `to` seconds
// into the drive: the forced choice of scripts/driver_latitude.mjs.
async function forced(id, from, to) {
  const ctx = setupChallenge(map, lesson, { brain: "rules" }),
    { world, autopilot } = ctx,
    start = world.t;
  const rules = autopilot.brains.rules,
    original = rules.decideSync.bind(rules);
  let taken = 0,
    arrived = false;
  rules.decideSync = (snap, eligible) => {
    const r = original(snap, eligible),
      t = world.t - start;
    if (t >= from && t < to && eligible.some((c) => c.id === id) && r.candidateId !== id) {
      taken++;
      Object.assign(r, { motion: "drive", candidateId: id });
    }
    return r;
  };
  autopilot.onEvent = (e) => {
    if (e.type === "arrived") arrived = true;
  };
  while (world.t - start < lesson.limit_s && autopilot.enabled) {
    stepWorld(ctx, DT, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
  }
  const { red_lights_run, stop_signs_run, ...rest } = world.violations;
  return { taken, failed: failures({ ...rest, arrived, red_lights: red_lights_run, stop_signs: stop_signs_run }) };
}

await test("a driver who brakes for the stale green is caught short by the amber and enters on red", async () => {
  // (an ordinary manoeuvre the safety filter offers: this is the latitude the drive was built for)
  const hesitant = await forced("stop_at_line", 6, 9);
  assert.equal(hesitant.taken > 0, true);
  assert.deepEqual(hesitant.failed, ["red light"]);
  // (the same driver with nothing forced is Rules, and passes)
  assert.deepEqual((await forced("stop_at_line", 0, 0)).failed, []);
});

// (two saved runs with Rules and the cautious agent, counted as UTF-16, as lab/history.js does)
const saved = [results["rules:guarded"], results["cautious:guarded"]];
const run = {
  schema: EVALUATION_SCHEMA,
  challenge_version: 2,
  created_at: "2026-11-26T00:00:00Z",
  status: "complete",
  results: saved,
};
const bytes = JSON.stringify([run, run]).length * 2;
await test("its results survive being saved, and two saved runs stay a small part of the history budget", () => {
  assert.equal(validateEvaluation(JSON.parse(JSON.stringify(run))).results.length, 2);
  assert.equal(bytes < 0.05 * 9 * 1024 * 1024, true, String(bytes));
});
console.log(
  `Compound drive history: ${bytes} bytes, ${((bytes / (9 * 1024 * 1024)) * 100).toFixed(1)}% of the 9 MB cap for 1 compound drive with two drivers, twice`,
);

// The saved model case (`uv run scripts/verify_jev.py data/snapshots/rush_hour.json`): the decision at
// the Vine Street amber with the tailgater close behind, from the production pipeline.
const snapshotUrl = new URL("../data/snapshots/rush_hour.json", import.meta.url);
async function modelCase() {
  const ctx = setupChallenge(map, lesson, { brain: "rules" }),
    w = ctx.world,
    vine = map.intersections.get(map.edges.get("e197").control.id);
  for (let k = 0; k < 30 * 60; k++) {
    stepWorld(ctx, DT, w.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    if (approachPhase(vine, "e197", w.t) !== "yellow") continue;
    const snap = buildSnapshot(w);
    if (!snap.tailgater) continue;
    const candidates = sampleCandidates(snap, w),
      { eligible, rejected } = simulateAll(candidates, snap, w);
    if (eligible.length < 3) continue;
    const { questions, local } = buildQuestions(snap, eligible);
    if (!questions.vector) continue;
    const choice = ctx.autopilot.brains.rules.decideSync(snap, eligible);
    // (as Rules decides here: to stop at the line, or to go on; any manoeuvre in the lane that does the same)
    const stopping = (c) => c.law.stopAtRoute !== undefined || c.law.stopAt !== undefined;
    const stops = stopping(eligible.find((c) => c.id === choice.candidateId));
    const same = eligible
      .filter((c) => c.law.kind !== "hard_brake" && Math.abs(c.sim.lane_err_end) < 0.8 && stopping(c) === stops)
      .map((c) => c.id);
    ctx.autopilot.setEnabled(false);
    return {
      name: "rush_hour",
      state: toJevState(snap, candidates, { rejected }),
      questions,
      local,
      expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: same },
    };
  }
  throw new Error("The compound drive never reached its amber with the tailgater behind.");
}
const built = await modelCase();
if (process.argv.includes("--write-snapshot")) {
  fs.writeFileSync(snapshotUrl, `${JSON.stringify(built, null, 2)}\n`);
  console.log(`wrote ${snapshotUrl.pathname}`);
}
await test("the saved model case is the amber decision with the tailgater behind, under the cost ceilings", () => {
  const saved = JSON.parse(fs.readFileSync(snapshotUrl, "utf8"));
  assert.equal(JSON.stringify(saved), JSON.stringify(built), "rewrite it with --write-snapshot");
  const instructions = Object.values(saved.questions)
    .map((q) => JSON.stringify(q))
    .join("").length;
  assert.equal(instructions < 4000, true, `question instructions: ${instructions} characters`);
  // (a Jev decision stays under 5,500 input tokens: at most four characters a token here)
  const request = JSON.stringify({ state: saved.state, questions: saved.questions }).length;
  assert.equal(request / 4 < 5500, true, `request: ${request} characters`);
  assert.equal(saved.expect.vector_in.length > 0, true);
  assert.equal(JSON.stringify(saved.state).includes("ailgat"), true, "the state says a tailgater is behind");
  console.log(
    `  model case: ${instructions} instruction characters, ${request} request characters, expect ${JSON.stringify(saved.expect)}`,
  );
});

console.log(`${checks} compound drive checks passed`);
process.exit(0);
