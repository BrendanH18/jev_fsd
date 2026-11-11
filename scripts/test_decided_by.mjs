// Who actually drove (ROADMAP 2.4): the autopilot counts each decision as the model's own, answered
// locally, or a Rules fallback (timeout, error, invalid vector), and the summary, the aggregate and
// the arena report the shares for every driver but Rules.
// node --experimental-default-type=module scripts/test_decided_by.mjs
// (no server, no network: the driver is a stub whose answers are scripted)
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { registerAgent } = await import("../static/js/brain/registry.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { aggregate, decidedBy, decidedByText, DECIDED_BY } = await import("../static/js/bench/metrics.js");
const { summarizeResults, validateEvaluation, EVALUATION_SCHEMA } = await import("../static/js/lab/history.js");

const names = { saskatoon: "ca5573a8d934", halifax: "49db0d437c8c" };
// (with every layer beside the pack, as the server serves it)
const load = id => {
  const pack = JSON.parse(fs.readFileSync(new URL(`../data/maps/${names[id]}.v6.pack.json`, import.meta.url)));
  const crossings = [2, 1].map(v => new URL(`../data/maps/${names[id]}.crossings.v${v}.json`, import.meta.url)).find(u => fs.existsSync(u));
  if (crossings) pack.crossings = JSON.parse(fs.readFileSync(crossings));
  for (const name of ["transit", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
    const url = new URL(`../data/maps/${names[id]}.${name}.v1.json`, import.meta.url);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
let assertions = 0;
async function test(name, fn) { await fn(); assertions++; console.log(`✓ ${name}`); }

// A question-driven decision agent whose answers follow a script, call by call: the Rules choice
// (valid), no answer before the timeout, no usable vector, or an error. It drives as Rules does.
const SCRIPT = ["valid", "valid", "timeout", "valid", "invalid_vector", "error", "valid"];
class ScriptedAgent {
  constructor({ omitHeadlights = false } = {}) {
    this.name = "decision:scripted"; this.questionDriven = true; this.timeoutMs = 40;
    this.rules = new RulesBrain(); this.omitHeadlights = omitHeadlights;
    this.calls = 0; this.produced = { valid: 0, timeout: 0, invalid_vector: 0, error: 0, no_headlights: 0 };
  }
  async decide(snap, eligible, request, signal) {
    const kind = SCRIPT[this.calls++ % SCRIPT.length];
    this.produced[kind]++;
    const meta = { source: this.name, live_call: true, latency_ms: 5, input_tokens: 10, cost_usd: 0 };
    if (kind === "timeout") return new Promise(() => {});   // the autopilot gives up on it
    if (kind === "error") throw Object.assign(new Error("scripted error"), { meta });
    const r = this.rules.decideSync(snap, eligible);
    // (every other answer leaves the headlight question unanswered: a partial answer)
    const skipBeam = this.omitHeadlights && this.calls % 2 === 0;
    if (kind === "valid" && skipBeam && request.questions.headlights) this.produced.no_headlights++;
    return { motion: r.motion, candidateId: kind === "invalid_vector" ? null : r.candidateId, routeId: null, meta,
      ...(r.headlights && !skipBeam ? { headlights: r.headlights } : {}), answers: { ...request.local } };
  }
}
let agent = new ScriptedAgent();
registerAgent({ id: "decision:scripted", label: "Scripted", create: () => agent });

// Nearly every decision asks the model something; a decision is local when nothing needs asking, or
// when no manoeuvre is eligible and the car brakes hard. Rules brakes so twice in "Waiting for a gap",
// and the stub, which always ends up with the Rules choice, drives that challenge exactly as Rules does.
const challenge = CHALLENGES.find(c => c.id === "roundabout-gap"), map = load(challenge.map);
const run = await evaluateChallenge(map, challenge, { brain: "decision:scripted" });
const produced = agent.produced;
console.log(`Waiting for a gap, scripted driver: ${decidedByText(run)} of ${run.decisions} decisions`);

await test("the stub drove: every scripted outcome happened, and some decisions were local", () => {
  assert.ok(produced.valid >= 3, `valid ${produced.valid}`);
  assert.ok(produced.timeout >= 1 && produced.invalid_vector >= 1 && produced.error >= 1, JSON.stringify(produced));
  assert.ok(run.local_decisions > 0, `local ${run.local_decisions}`);
});
await test("each outcome is counted where it happened: model, local or fallback", () => {
  // (a stale answer, from before the epoch changed, is discarded uncounted; the script never stalls one)
  assert.equal(run.model_decisions, produced.valid);
  assert.equal(run.fallback_decisions, produced.timeout + produced.invalid_vector + produced.error);
  assert.equal(run.partial_decisions, 0);
  assert.equal(run.model_decisions + run.local_decisions + run.fallback_decisions, run.decisions);
  assert.equal(run.fallbacks, run.fallback_decisions);   // world.violations.fallbacks agrees
  assert.equal(run.calls, agent.calls - produced.timeout);   // (a call that timed out is not counted as one)
});
await test("the shares are of all decisions, rounded to 0.001, and read as text", () => {
  assert.equal(run.model_share, Math.round(run.model_decisions / run.decisions * 1000) / 1000);
  assert.equal(run.local_share, Math.round(run.local_decisions / run.decisions * 1000) / 1000);
  assert.equal(run.fallback_share, Math.round(run.fallback_decisions / run.decisions * 1000) / 1000);
  assert.match(decidedByText(run), /^\d+% model · \d+% local · \d+% fallback$/);
});

// (who each of the Rules drive's decisions is counted as, seen where the autopilot applies it)
const { Autopilot } = await import("../static/js/brain/brain.js");
const applyOf = Autopilot.prototype.apply, rulesBy = {};
Autopilot.prototype.apply = function (result, snap, candidates, request, by) { rulesBy[by] = (rulesBy[by] || 0) + 1; return applyOf.apply(this, arguments); };
const rules = await evaluateChallenge(map, challenge, { brain: "rules" });
Autopilot.prototype.apply = applyOf;
await test("Rules decides locally, never as a model: a later driver's counts never credit Rules to its model", () => {
  assert.equal(rulesBy.model || 0, 0, JSON.stringify(rulesBy));
  assert.equal(rulesBy.local, rules.decisions);
});
await test("a Rules drive reports no new field, so earlier records compare; the stub drove it alike", () => {
  assert.equal(rules.decisions, run.decisions); assert.equal(rules.time_s, run.time_s); assert.equal(rules.arrived, run.arrived);
  for (const k of [...DECIDED_BY, "model_share", "local_share", "fallback_share"]) assert.equal(k in rules, false, k);
  assert.equal(decidedByText(rules), null);
  assert.equal(Object.keys(decidedBy({ brainName: "rules", decidedBy: { model: 3, partial: 0, local: 1, fallback: 0 } })).length, 0);
  assert.equal(Object.keys(decidedBy({ totals: {} })).length, 0);   // a stand-in autopilot, as other checks pass
  assert.equal("model_share" in aggregate([rules]), false);
  assert.equal("model_share" in summarizeResults([rules]), false);
});
await test("the bench aggregate and the arena summary add up the drives that report it", () => {
  const two = [run, { ...run }], all = aggregate([rules, ...two]), arena = summarizeResults([rules, ...two]);
  assert.equal(all.model_decisions, run.model_decisions * 2);
  assert.equal(all.fallback_decisions, run.fallback_decisions * 2);
  assert.equal(all.local_decisions, run.local_decisions * 2);
  assert.equal(all.model_share, run.model_share);
  assert.equal(arena.model_decisions, run.model_decisions * 2);
  assert.equal(arena.fallback_share, run.fallback_share);
});
await test("an arena export keeps the counts, and a malformed share is refused", () => {
  const exported = { schema: EVALUATION_SCHEMA, challenge_version: 1, created_at: new Date(0).toISOString(), results: [run] };
  assert.equal(validateEvaluation(JSON.parse(JSON.stringify(exported))).results[0].model_decisions, run.model_decisions);
  assert.throws(() => validateEvaluation({ ...exported, results: [{ ...run, model_share: 2 }] }), /invalid evaluation result/);
  assert.throws(() => validateEvaluation({ ...exported, results: [{ ...run, fallback_decisions: -1 }] }), /invalid evaluation result/);
  // (shares that disagree with the counts are derived again from them)
  const forged = validateEvaluation({ ...exported, results: [{ ...run, model_share: 1, local_share: 0, fallback_share: 0 }] }).results[0];
  assert.equal(forged.model_share, run.model_share); assert.equal(forged.fallback_share, run.fallback_share);
});

// At night with high beams on every decision asks which beam to use; an answer without one is partial.
agent = new ScriptedAgent({ omitHeadlights: true });
const dip = CHALLENGES.find(c => c.highBeams);
const night = await evaluateChallenge(load(dip.map), dip, { brain: "decision:scripted", limit: 20 });
await test("a model answer that leaves the headlight question to the default is partial", () => {
  assert.ok(agent.produced.no_headlights > 0, JSON.stringify(agent.produced));
  assert.equal(night.partial_decisions, agent.produced.no_headlights);
  assert.equal(night.model_decisions, agent.produced.valid);
  assert.ok(night.partial_decisions <= night.model_decisions);
  assert.match(decidedByText(night), /model \(\d+ partial\)/);
});

console.log(`\n${assertions} checks passed`);
process.exit(0);
