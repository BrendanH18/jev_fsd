import assert from "node:assert/strict";
import { EVALUATION_SCHEMA, EVALUATION_HISTORY_KEY, validateEvaluation, readEvaluations, saveEvaluation,
  compareResult, summarizeResults } from "../static/js/lab/history.js";
import { EvaluationTrace } from "../static/js/lab/trace.js";

const result = { challenge: "door-zone", version: 1, map: "kitsilano", pack: 5, seed: 1042, weather: "dry", time: "afternoon", car: "compact",
  brain: "rules", mode: "lockstep", engine_version: "drive-lab-2", limit_s: 180, arrived: true, stopped: false, pass: true, failures: [],
  time_s: 30, collisions: 0, red_lights: 0, stop_signs: 0, failed_to_yield: 0, off_road_s: 0, hard_brakes: 1, latency_p50_ms: 0, cost_usd: 0,
  report: { model_version: 1, status: "arrived", score: 95, qualified: true, incidents: [] } };
const run = { schema: EVALUATION_SCHEMA, challenge_version: 2, created_at: "2026-10-03T12:00:00Z", status: "complete", results: [result] };
let checks = 0;
function test(label, fn) { fn(); checks++; console.log(`✓ ${label}`); }
const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
test("saved evaluations survive reload and retain original timestamps", () => {
  saveEvaluation(run, storage); assert.deepEqual(readEvaluations(storage), [run]);
});
test("history is bounded and deleting one persisted run keeps the others", () => {
  for (let i = 0; i < 15; i++) saveEvaluation({ ...run, created_at: new Date(Date.UTC(2026, 9, 3, 12, i)).toISOString() }, storage);
  const history = readEvaluations(storage); assert.equal(history.length, 10);
  storage.setItem(EVALUATION_HISTORY_KEY, JSON.stringify(history.slice(1)));
  assert.equal(readEvaluations(storage).length, 9); assert.equal(readEvaluations(storage)[0].created_at, history[1].created_at);
});
test("corrupt or inaccessible storage does not break history reads", () => {
  assert.deepEqual(readEvaluations({ getItem() { throw new Error("blocked"); } }), []);
  assert.deepEqual(readEvaluations({ getItem: () => '{"broken":true}' }), []);
  assert.deepEqual(readEvaluations({ getItem: () => JSON.stringify([run, { schema: "other" }]) }), [run]);
});
test("storage write failures are reported without destroying prior history", () => {
  assert.throws(() => saveEvaluation(run, { getItem: () => "[]", setItem() { throw new Error("quota"); } }), /quota/);
});
test("a shared browser quota trims older evaluations before giving up", () => {
  const quota = { getItem: () => JSON.stringify([run, run]), setItem(k, json) {
    if (JSON.parse(json).length > 1) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
  } };
  assert.equal(saveEvaluation(run, quota).length, 1);
});
test("untrusted pass labels cannot bypass the audited pass criteria", () => {
  assert.equal(validateEvaluation({ ...run, results: [{ ...result, collisions: 1 }] }).results[0].pass, false);
  assert.equal(validateEvaluation({ ...run, results: [{ ...result, stopped: true, report: { ...result.report, status: "stopped" } }] }).results[0].pass, false);
  assert.throws(() => validateEvaluation({ ...run, results: [{ ...result, report: { ...result.report, status: "timeout" } }] }));
});
test("malformed and unsupported imports are rejected before storage", () => {
  for (const bad of [{ ...run, schema: "other" }, { ...run, results: [] }, { ...run, created_at: "oops" },
    { ...run, results: [{ ...result, cost_usd: -1 }] }, { ...run, results: [{ ...result, mode: "fast" }] }]) assert.throws(() => validateEvaluation(bad));
});
test("comparison can use a different driver on identical conditions", () => {
  const match = compareResult({ ...result, brain: "my-agent" }, run, "rules");
  assert.deepEqual(match.before, result); assert.deepEqual(match.reasons, []);
});
test("every experiment condition mismatch prevents a delta", () => {
  for (const [key, value] of Object.entries({ version: 2, pack: 6, seed: 11, map: "victoria", weather: "rain", time: "night",
    car: "pickup", mode: "realtime", engine_version: "other", limit_s: 60 })) {
    const comparison = compareResult({ ...result, [key]: value }, run, "rules");
    assert.equal(comparison.before, undefined, key); assert.ok(comparison.reasons.length, key);
  }
  assert.deepEqual(compareResult({ ...result, report: { ...result.report, model_version: 2 } }, run, "rules").reasons, ["scoring version"]);
});
test("missing challenges, duplicates and stopped attempts cannot generate misleading comparisons", () => {
  assert.ok(compareResult({ ...result, challenge: "blind-crossing" }, run, "rules").reasons.includes("challenge absent from baseline"));
  assert.ok(compareResult(result, { ...run, results: [result, result] }, "rules").reasons.includes("duplicate baseline results"));
  assert.ok(compareResult({ ...result, stopped: true }, run, "rules").reasons.includes("stopped attempt"));
});
test("legacy exports remain readable and flag unknown simulation conditions", () => {
  const legacy = structuredClone(run); legacy.schema = "jev-agent-evaluation-v1"; legacy.challenge_version = 1;
  delete legacy.results[0].engine_version; delete legacy.results[0].limit_s;
  const imported = validateEvaluation(legacy);
  assert.equal(imported.results.length, 1);
  assert.deepEqual(compareResult(result, imported, "rules").reasons, ["time limit", "simulation version"]);
});
test("summary reports pass rate, safety and measured costs; missing latency stays unknown", () => {
  const summary = summarizeResults([result, { ...result, pass: false, collisions: 2, cost_usd: .1, hard_brakes: 3, latency_p50_ms: null }]);
  assert.deepEqual(summary, { count: 2, pass_rate: .5, incidents: 2, hard_brakes: 4, latency_p50_ms: 0, cost_usd: .1 });
  assert.equal(summarizeResults([{ ...result, latency_p50_ms: null }]).latency_p50_ms, null);
});
test("incident context is an immutable copy of the preceding executed decision", () => {
  const trace = new EvaluationTrace(), decision = { chosenId: "hold", motion: "stop", meta: { source: "rules" }, flags: ["pedestrian"], state: { car: { speed: 5 } }, candidates: [] };
  trace.event("safety", "Emergency brake", .5); trace.decision(decision, 1); trace.event("collisions", "Collision", 1.2);
  decision.state.car.speed = 99;
  assert.equal(trace.decisions[0].state.car.speed, 5); assert.equal(trace.events[0].decision_id, null);
  assert.equal(trace.events[1].decision_id, 1); assert.equal(trace.events[1].decision_age_s, .2);
  validateEvaluation({ ...run, results: [{ ...result, ...trace.export() }] });
});
test("malformed trace data and links to future decisions are rejected", () => {
  const trace = new EvaluationTrace(); trace.decision({ motion: "stop", chosenId: "hold", meta: { source: "rules" }, candidates: [] }, 2); trace.event("collisions", "Collision", 3);
  const r = { ...result, ...trace.export() };
  assert.throws(() => validateEvaluation({ ...run, results: [{ ...r, events: [{ ...r.events[0], at_s: 1 }] }] }));
  assert.throws(() => validateEvaluation({ ...run, results: [{ ...r, decisions_trace: [{ ...r.decisions_trace[0], flags: "bad" }] }] }));
});
test("event-linked snapshots are retained while unassociated choices remain compact", () => {
  const trace = new EvaluationTrace(), decision = { chosenId: "hold", motion: "stop", meta: { source: "rules" }, candidates: [], state: { car: { speed: 5 } } };
  trace.decision(decision, 1); trace.event("safety", "Emergency brake", 1.1);
  trace.decision(decision, 2); trace.decision(decision, 3); trace.event("arrived", "Arrived", 3.1);
  assert.equal(trace.decisions[0].state.car.speed, 5); assert.equal(trace.decisions[0].context_recorded, true);
  assert.equal(trace.decisions[1].state, null); assert.equal(trace.decisions[1].candidates, null);
  assert.equal(trace.decisions[2].context_recorded, true);
  validateEvaluation({ ...run, results: [{ ...result, ...trace.export() }] });
});
test("later audited failures remain visible after the coaching incident log is full", () => {
  const trace = new EvaluationTrace(), world = { t: 1, violations: { collisions: 0, red_lights_run: 0, stop_signs_run: 0, failed_to_yield: 0, off_road_s: 0 } };
  const score = { hardBrakes: 100, incidents: Array(100).fill({ type: "hard_brake" }) };
  trace.measurements(world, score);
  world.t = 2; world.violations.collisions = 1; world.violations.off_road_s = 1;
  trace.measurements(world, score); trace.measurements(world, score);
  assert.equal(trace.events.filter(e => e.type === "collisions").length, 1);
  assert.equal(trace.events.find(e => e.type === "hard_brake").count, 100);
  assert.equal(trace.events.filter(e => e.type === "off_road").length, 1);
});
test("trace limits explicitly label missing later context", () => {
  const trace = new EvaluationTrace();
  for (let i = 0; i < 602; i++) trace.decision({ motion: "stop", chosenId: "hold", meta: { source: "rules" }, candidates: [] }, i);
  trace.event("timeout", "Time limit", 605);
  assert.equal(trace.decisions.length, 600); assert.equal(trace.events[0].decision_id, null); assert.equal(trace.export().trace_truncated, true);
});
console.log(`${checks} arena history checks passed`);
