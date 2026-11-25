// The open track (brain/tracks.js, ROADMAP 4.2): the safety filter flags manoeuvres that fail a road-rule
// check instead of removing them, a predicted collision is still removed, models are told which check a
// flagged manoeuvre failed, Rules and the cautious agent drive it exactly as the guarded track, and a
// driver that goes with a flagged manoeuvre is judged by the audit as on any track. The challenge is
// "Not your arrow" (Winnipeg): a green left arrow for the cars beside the car while its own light is red.
// node --experimental-default-type=module scripts/test_open_track.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { registerAgent } = await import("../static/js/brain/registry.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { openTrack, unflagged, FLAG_TEXT, flagText, TRACKS } = await import("../static/js/brain/tracks.js");
const { FEATURES } = await import("../static/js/sim/features/index.js");
const { buildLlmPrompt, SYSTEM_PROMPT, OPEN_SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { benchmarkConfig } = await import("../static/js/bench/options.js");
const { comparableResult, canonicalJson, recordingHeader, hashText } = await import("../static/js/brain/recording.js");
const { validateEvaluation, conditionDifferences, EVALUATION_SCHEMA } = await import("../static/js/lab/history.js");

let checks = 0;
async function test(name, fn) {
  await fn();
  checks++;
  console.log(`✓ ${name}`);
}

// Winnipeg with every layer, as the server serves it.
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`../data/maps/${key}.v6.pack.json`, import.meta.url)));
  const crossings = [2, 1]
    .map((v) => new URL(`../data/maps/${key}.crossings.v${v}.json`, import.meta.url))
    .find((u) => fs.existsSync(u));
  if (crossings) pack.crossings = JSON.parse(fs.readFileSync(crossings));
  for (const name of [
    "transit",
    "zones",
    "rail",
    "calming",
    "scrambles",
    "buslanes",
    "restrictions",
    "contraflow",
    "driveways",
    "parks",
    "bridges",
  ]) {
    const url = new URL(`../data/maps/${key}.${name}.v1.json`, import.meta.url);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const WINNIPEG = load("19bb885c9cae");
const CHALLENGE = CHALLENGES.find((c) => c.id === "left-arrow");
const step = (ctx) => stepWorld({ ...ctx, input: null }, 1 / 60, ctx.world.t * 1000);

// (whether an agent module was asked to choose among flagged manoeuvres alone, as any driver but Rules and the
// cautious agent is)
let askedOnlyFlagged = false;
// (each request the driver is handed must say the track of the drive under way, as an LLM driver's prompt reads
// it: brain/llm-prompt.js)
const requests = { expected: null, seen: 0, wrong: 0 };
// A driver that ignores the flags: Rules' choice, unless a flagged manoeuvre gets further. On the guarded
// track, where nothing is flagged, it is Rules.
registerAgent({
  id: "flag_blind_test",
  label: "Flag-blind (test)",
  create: () => ({
    name: "flag_blind_test",
    rules: new RulesBrain(),
    decideSync(snap, eligible) {
      if (!unflagged(eligible).length) askedOnlyFlagged = true;
      const r = this.rules.decideSync(snap, unflagged(eligible));
      const pick = eligible.find((c) => c.id === r.candidateId);
      const further = eligible
        .filter((c) => c.flagged && c.sim.progress_m > (pick?.sim.progress_m ?? 0) + 1)
        .sort((a, b) => b.sim.progress_m - a.sim.progress_m)[0];
      if (further)
        return { ...r, motion: "drive", candidateId: further.id, meta: { ...r.meta, source: "flag_blind_test" } };
      return { ...r, meta: { ...r.meta, source: "flag_blind_test" } };
    },
    async decide(snap, eligible, request) {
      requests.seen++;
      if ((request?.track ?? "guarded") !== requests.expected) requests.wrong++;
      return this.decideSync(snap, eligible);
    },
  }),
});

// The first decision, Rules driving the open track, at which going on would run the car's red. A stalled car
// stands at the car's stop line across the lane line on its left, STALLED_LEFT_M from its lane's centre, so
// the forward sims of the manoeuvres that edge left must record a collision with it, while those that keep
// to the lane or edge right pass it with room and go on, flagged, through the red.
const STALLED_LEFT_M = 2.6;
function redDecision() {
  const ctx = setupChallenge(WINNIPEG, CHALLENGE, { track: "open" });
  const map = ctx.world.map,
    edge = map.edges.get(ctx.world.challenge.arrowEdge),
    lane = map.lane(edge.id, edge.lanes - 1),
    s = (edge.control.s_line * lane.length) / edge.length,
    [x, y] = pointAt(lane.pts, lane.cum, s),
    h = headingAt(lane.pts, lane.cum, s);
  const stalled = new Vehicle(x - STALLED_LEFT_M * Math.sin(h), y + STALLED_LEFT_M * Math.cos(h), h, 0);
  // (frozen: the fleet leaves it standing where it is)
  Object.assign(stalled, { id: "stalled_test", frozen: Infinity });
  ctx.fleet.vehicles.push(stalled);
  let found = null;
  ctx.autopilot.onDecision = (d) => {
    if (!found && d.candidates.some((c) => c.flagged && c.reject === "runs_red")) found = d;
  };
  while (!found && ctx.world.t < 40) step(ctx);
  return { ctx, decision: found };
}

await test("the tracks, and every check the filter can fail has words for a model", () => {
  assert.deepEqual(TRACKS, ["guarded", "open"]);
  const source = fs.readFileSync(new URL("../static/js/brain/candidates.js", import.meta.url), "utf8");
  const features = fs
    .readdirSync(new URL("../static/js/sim/features/", import.meta.url))
    .map((f) => fs.readFileSync(new URL(`../static/js/sim/features/${f}`, import.meta.url), "utf8"))
    .join("\n")
    // Examiner categories and audit event types are not manoeuvre rejections.
    .replace(/\b(?:category|traceType|type)\s*:\s*"[^"]*"/g, "");
  const ids = new Set();
  for (const text of [source, features])
    for (const m of text.matchAll(/(?:reject\s*=|\?|:)\s*"([a-z]+(?:_[a-z]+)+)"/g)) ids.add(m[1]);
  for (const m of source.matchAll(/c\.reject === "([a-z_]+)"/g)) ids.add(m[1]);
  // (what the scrape also finds: candidate ids, law and collision kinds, rider relations, event and metric names)
  const notChecks =
    /^(?:stop|wait|keep|change|creep|pull|let|ease|slow|go|yield|follow|pass|move|turn|hold|reverse)_|^(?:hard_brake|rear_end|turning_in|turning_off)$|_(?:conflicts|hits|entries|overspeed|splashed|violation)$/;
  // (a metric's name, its event and the examiner's incident id are audit words, not rejections)
  const auditIds = new Set(
    FEATURES.flatMap(({ metric }) =>
      [metric ?? []].flat().flatMap((m) => [m.name, m.eventType, m.examinerIncident]),
    ),
  );
  const missing = [...ids].filter(
    (id) => id !== "collision" && !FLAG_TEXT[id] && !auditIds.has(id) && !notChecks.test(id),
  );
  assert.deepEqual(missing, [], "a rejection without words");
  assert.equal(flagText("runs_red"), FLAG_TEXT.runs_red);
  assert.equal(flagText("some_new_check"), "some new check");
});

await test("open track: a red-light manoeuvre stays on offer, flagged, a collision does not, and Rules keeps to the unflagged", () => {
  const { decision } = redDecision();
  assert.ok(decision, "a decision with going on through the red flagged");
  const flagged = decision.candidates.filter((c) => c.flagged);
  assert.ok(flagged.every((c) => c.eligible && c.reject && c.reject !== "collision"));
  // (the forward sims recorded a collision with the stalled car, and no manoeuvre that hits it is on offer)
  const hits = decision.candidates.filter((c) => c.sim?.collision);
  assert.ok(
    hits.some((c) => c.sim.collision.id === "stalled_test"),
    "a forward sim records a collision with the stalled car",
  );
  assert.ok(hits.every((c) => !c.eligible && !c.flagged));
  assert.ok(decision.candidates.filter((c) => c.reject === "collision").every((c) => !c.eligible && !c.flagged));
  const chosen = decision.candidates.find((c) => c.id === decision.chosenId);
  assert.ok(!!chosen, `Rules chose ${decision.chosenId}, which is not among the candidates`);
  assert.equal(chosen.eligible, true, `Rules chose ${decision.chosenId}`);
  assert.equal(!!chosen.flagged, false, `Rules chose ${decision.chosenId}`);
  // (and the state counts as rejected only what is still removed)
  assert.equal(decision.state.rejected?.runs_red, undefined);
  // (openTrack itself: flags everything but collisions, and recounts)
  const cs = [
    { id: "a", reject: null, eligible: true },
    { id: "b", reject: "runs_red", eligible: false },
    { id: "c", reject: "collision", eligible: false },
    // (a barricade it would hit, rejected first for the closed road: still a collision, still removed)
    { id: "d", reject: "enters_closed_road", eligible: false, sim: { collision: { id: "barricade", t: 1.2 } } },
  ];
  const out = openTrack(cs, {
    eligible: [cs[0]],
    rejected: { runs_red: 1, collision: 1, enters_closed_road: 1 },
    mustStop: true,
  });
  assert.deepEqual(
    out.eligible.map((c) => c.id),
    ["a", "b"],
  );
  assert.equal(cs[3].flagged, undefined);
  assert.deepEqual(out.rejected, { collision: 1, enters_closed_road: 1 });
  assert.equal(out.mustStop, true);
  assert.deepEqual(
    unflagged(out.eligible).map((c) => c.id),
    ["a"],
  );
});

await test("open track: a model is told which rule a flagged manoeuvre breaks, and that only collisions were checked", () => {
  const { decision, ctx } = redDecision();
  const run = decision.candidates.find((c) => c.flagged && c.reject === "runs_red");
  const said = decision.state.candidates.find((c) => c.id === run.id);
  assert.equal(said.outcome, `flagged: ${FLAG_TEXT.runs_red}`);
  const q = decision.questions.vector;
  assert.ok(q, "the vector question is asked");
  assert.match(q.criteria[run.id], /flagged: it crosses the stop line where the signal requires the car to stop$/);
  assert.match(q.instructions, /not held to the road rules/);
  assert.ok(q.instructions.length < 4000, `${q.instructions.length} characters`);
  // (and an LLM gets the open track's system prompt, which differs from the guarded one in that paragraph alone)
  const prompt = buildLlmPrompt(ctx.autopilot.snap, {
    state: decision.state,
    questions: decision.questions,
    track: "open",
  });
  assert.equal(prompt.messages[0].content, OPEN_SYSTEM_PROMPT);
  assert.match(OPEN_SYSTEM_PROMPT, /begins "flagged:"/);
  assert.match(SYSTEM_PROMPT, /already passed a 3-second collision and road-rule check/);
  assert.equal(
    buildLlmPrompt(ctx.autopilot.snap, { state: decision.state, questions: decision.questions }).messages[0].content,
    SYSTEM_PROMPT,
  );
  const a = SYSTEM_PROMPT.split("\n"),
    b = OPEN_SYSTEM_PROMPT.split("\n");
  assert.equal(a.length, b.length);
  assert.equal(a.filter((line, i) => line !== b[i]).length, 1);
  // (a recording of an open-track run hashes the prompt it asked with)
  const header = recordingHeader({ driver: "llm:x", arena: { set: "challenges", track: "open" } });
  assert.equal(header.versions.llm_prompt, hashText(OPEN_SYSTEM_PROMPT));
  assert.equal(
    recordingHeader({ driver: "llm:x", arena: { set: "challenges" } }).versions.llm_prompt,
    hashText(SYSTEM_PROMPT),
  );
});

await test("Rules and the cautious agent drive the open track exactly as the guarded one", async () => {
  for (const brain of ["rules", "cautious"]) {
    const guarded = await evaluateChallenge(WINNIPEG, CHALLENGE, { brain });
    const open = await evaluateChallenge(WINNIPEG, CHALLENGE, { brain, track: "open" });
    assert.equal(guarded.pass, true, `${brain} guarded: ${guarded.failures}`);
    assert.equal(guarded.track, undefined);
    assert.equal(open.track, "open");
    assert.equal(open.flagged_choices, 0, `${brain} ${JSON.stringify(open.flagged_by_check)}`);
    // (every field but the track's own and the decision trace, which records the flagged manoeuvres as
    // offered; in the trace, every choice and the time it was made)
    const { track, flagged_choices, flagged_by_check, decisions_trace: openTrace, ...rest } = comparableResult(open);
    const { decisions_trace: guardedTrace, ...before } = comparableResult(guarded);
    assert.equal(canonicalJson(rest) === canonicalJson(before), true, `${brain}: the open-track result differs`);
    const choices = (trace) => canonicalJson(trace.map((d) => [d.at_s, d.motion, d.chosen_id, d.source]));
    assert.equal(choices(openTrace) === choices(guardedTrace), true, `${brain}: the choices differ`);
  }
});

await test("a driver that goes with flagged manoeuvres runs the red and fails, which the guarded track would have stopped", async () => {
  requests.expected = "guarded";
  const guarded = await evaluateChallenge(WINNIPEG, CHALLENGE, { brain: "flag_blind_test" });
  requests.expected = "open";
  const open = await evaluateChallenge(WINNIPEG, CHALLENGE, { brain: "flag_blind_test", track: "open" });
  requests.expected = null;
  assert.equal(guarded.red_lights, 0, "guarded: no red light run");
  assert.ok(open.red_lights > 0, "open: the red is run");
  assert.equal(open.pass, false);
  assert.ok(open.failures.includes("red light"), JSON.stringify(open.failures));
  assert.ok(open.flagged_choices > 0);
  assert.ok(open.flagged_by_check.runs_red > 0, JSON.stringify(open.flagged_by_check));
  assert.equal(askedOnlyFlagged, true, "an agent module chooses among flagged manoeuvres alone");
  assert.ok(
    requests.seen > 0 && requests.wrong === 0,
    `${requests.wrong} of ${requests.seen} requests said the wrong track`,
  );
  // (the drive saves and reloads in the arena's history with its open-track fields)
  const exported = {
    schema: EVALUATION_SCHEMA,
    challenge_version: 1,
    created_at: new Date().toISOString(),
    results: [open],
  };
  validateEvaluation(exported);
  // (and refuses counts that do not add up, or open-track fields on a guarded drive)
  const bad = (r) => () => validateEvaluation({ ...exported, results: [r] });
  assert.throws(bad({ ...open, flagged_choices: open.flagged_choices + 1 }), /invalid evaluation result/);
  assert.throws(bad({ ...open, flagged_by_check: [] }), /invalid evaluation result/);
  const { track, ...noTrack } = open;
  assert.throws(bad(noTrack), /invalid evaluation result/);
  // (an arena baseline on the other track is not a matching condition)
  assert.ok(conditionDifferences(open, guarded).includes("track"));
  assert.ok(!conditionDifferences(guarded, { ...guarded }).includes("track"));
});

await test("a model's invalid answer with nothing unflagged left falls back to a stop, not a flagged manoeuvre", async () => {
  // (the flag-blind driver up to the first decision with only flagged manoeuvres on offer, coming up to the
  // red too fast to stop; from there Jev, a model driver, who is asked among them and answers with no
  // usable vector)
  const ctx = setupChallenge(WINNIPEG, CHALLENGE, { track: "open", brain: "flag_blind_test" });
  const ap = ctx.autopilot;
  const onlyFlagged = (d) => d.candidates.some((c) => c.flagged) && !d.candidates.some((c) => c.eligible && !c.flagged);
  let cornered = false,
    seen = null;
  ap.onDecision = (d) => {
    if (onlyFlagged(d)) cornered = true;
    if (!seen && d.meta?.fallback === "invalid vector" && onlyFlagged(d)) seen = d;
  };
  while (!cornered && ctx.world.t < 40) {
    step(ctx);
    if (ap.firing) await ap.firing;
  }
  assert.ok(cornered, "only flagged manoeuvres left");
  const before = ap.flaggedChoices.runs_red || 0;
  ap.brainName = "jev";
  ap.brains.jev = {
    timeoutMs: 1000,
    async decide() {
      return { motion: "drive", candidateId: null, meta: { source: "jev", latency_ms: 5 } };
    },
  };
  const until = ctx.world.t + 3;
  while (!seen && ctx.world.t < until) {
    step(ctx);
    if (ap.firing) await ap.firing;
  }
  assert.ok(seen, "an invalid answer with only flagged manoeuvres on offer");
  assert.equal(seen.motion, "stop");
  assert.equal(seen.chosenId, "hard_brake");
  assert.equal(ap.flaggedChoices.runs_red || 0, before, JSON.stringify(ap.flaggedChoices));
});

await test("benchmark config: the open track is recorded, the guarded one leaves the config as before", () => {
  assert.deepEqual(benchmarkConfig({ features: "city" }), { features: "city" });
  assert.deepEqual(benchmarkConfig({ features: "city", track: "guarded" }), { features: "city" });
  assert.deepEqual(benchmarkConfig({ features: "city", track: "open" }), { features: "city", track: "open" });
  assert.throws(() => benchmarkConfig({ track: "loose" }), /Unknown track/);
});

console.log(`\n${checks} open track checks passed`);
process.exit(0);
