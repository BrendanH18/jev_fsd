// A broken step fails its own drive, preserves its error, and leaves the next drive runnable.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { runScenario } = await import("../static/js/bench/runner.js");
const { CHALLENGES, CHALLENGE_VERSION, challengeScenario } = await import("../static/js/lab/challenges.js");
const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { EVALUATION_SCHEMA, validateEvaluation, saveEvaluation, readEvaluations } = await import("../static/js/lab/history.js");
const { failures } = await import("../static/js/bench/metrics.js");

const key = "623b012bc8b5", base = new URL("../data/maps/", import.meta.url);
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, base)));
for (const layer of ["transit", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const path = new URL(`${key}.${layer}.v1.json`, base);
  if (fs.existsSync(path)) pack[layer] = JSON.parse(fs.readFileSync(path));
}
const crossings = [2, 1].map(v => new URL(`${key}.crossings.v${v}.json`, base)).find(path => fs.existsSync(path));
if (crossings) pack.crossings = JSON.parse(fs.readFileSync(crossings));
const map = new MapData(pack), challenge = CHALLENGES.find(c => c.id === "door-zone");
const route = challengeScenario(map, challenge);
const scenario = { ...route, id: "broken-step", traffic_seed: challenge.seed, tags: { length_m: 400 } };
const realStep = NpcFleet.prototype.step;
let benchmark, evaluation;
try {
  NpcFleet.prototype.step = function() { throw new TypeError("Injected parking-slot failure"); };
  benchmark = await runScenario(map, scenario, { npcs: 0 });
  assert.equal(benchmark.pass, false);
  assert.equal(benchmark.simulation_error, "Injected parking-slot failure");
  assert.equal(benchmark.failures.includes("simulation error"), true);
  assert.equal(benchmark.failures.includes("timeout"), false);
  assert.equal(benchmark.events.some(e => e.type === "simulation_error" && e.message === benchmark.simulation_error), true);
  console.log("✓ benchmark step errors return a failed route with its original error");
  evaluation = await evaluateChallenge(map, challenge);
  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.stopped, false);
  assert.equal(evaluation.report.status, "error");
  assert.equal(evaluation.report.simulation_error, evaluation.simulation_error);
  assert.equal(evaluation.report.qualified, false);
  assert.equal(evaluation.simulation_error, "Injected parking-slot failure");
  assert.equal(evaluation.failures.includes("simulation error"), true);
  assert.equal(evaluation.events.some(e => e.type === "simulation_error" && e.message === evaluation.simulation_error), true);
  assert.equal(evaluation.report.incidents.some(e => e.type === "simulation_error" && e.message === evaluation.simulation_error), true);
  console.log("✓ arena step errors return a failed attempt with a trace and report incident");
  NpcFleet.prototype.step = function() { throw "x".repeat(1000); };
  const longError = await evaluateChallenge(map, challenge);
  assert.equal(longError.simulation_error.length, 240);
  assert.equal(longError.report.incidents.at(-1).message.length, 240);
  console.log("✓ thrown strings and long messages remain valid saved evaluation data");
} finally {
  NpcFleet.prototype.step = realStep;
}
const run = { schema: EVALUATION_SCHEMA, challenge_version: CHALLENGE_VERSION, created_at: new Date().toISOString(), status: "complete", results: [evaluation] };
const imported = validateEvaluation(run).results[0];
assert.equal(imported.pass, false);
assert.equal(imported.simulation_error, evaluation.simulation_error);
const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
saveEvaluation(run, storage);
assert.equal(readEvaluations(storage)[0].results[0].report.status, "error");
assert.equal(readEvaluations(storage)[0].results[0].simulation_error, evaluation.simulation_error);
assert.throws(() => validateEvaluation({ ...run, results: [{ ...evaluation, simulation_error: {} }] }));
assert.deepEqual(failures({ arrived: true, simulation_error: "broken" }), ["simulation error"]);
console.log("✓ failed attempts survive export, import and saved history without becoming passes");
const followingBenchmark = await runScenario(map, { ...scenario, id: "after-error" }, { npcs: 0 });
assert.equal(Object.hasOwn(followingBenchmark, "simulation_error"), false);
assert.equal(followingBenchmark.arrived, true);
const followingEvaluation = await evaluateChallenge(map, challenge);
assert.equal(followingEvaluation.pass, true);
assert.equal(followingEvaluation.report.status, "arrived");
assert.equal(Object.hasOwn(followingEvaluation, "simulation_error"), false);
console.log("✓ the next benchmark route and arena challenge run normally after a failed step");
process.exit(0);
