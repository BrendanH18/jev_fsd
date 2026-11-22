import assert from "node:assert/strict";
import { linkSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureTrace, compareTraces, readTraceScenario } from "./bench_trace.mjs";

const left = {
  version: 1,
  inputs: { scenario: { id: "s1-1" }, map_sha: "test" },
  steps: [
    { ego: { x: 10 }, traffic: [], decision: null },
    { ego: { x: 11 }, traffic: [], decision: { count: 1, choice: "lane" } },
    { ego: { x: 12 }, traffic: [], decision: { count: 2, choice: "lane" } },
  ],
};
const right = structuredClone(left);
right.steps[0].ego.x += 2e-12;
right.steps[1].ego.x += 1e-6;
right.steps[2].decision.choice = "brake";
right.steps.push(right.steps[2]);

const diff = compareTraces(left, right);
assert.deepEqual([diff.exactState.tick, diff.exactState.path], [0, "ego.x"]);
assert.deepEqual([diff.stateOverTolerance.tick, diff.stateOverTolerance.path], [1, "ego.x"]);
assert.deepEqual(diff.decision, { tick: 2, path: "decision.choice", left: "lane", right: "brake" });
assert.deepEqual(diff.steps, [2, 3]);

const same = compareTraces(left, structuredClone(left));
assert.deepEqual([same.exactState, same.stateOverTolerance, same.decision], [null, null, null]);
right.inputs.scenario.id = "s1-2";
assert.throws(() => compareTraces(left, right), /inputs differ at scenario.id/);

const directory = mkdtempSync(join(tmpdir(), "jev-bench-trace-"));
try {
  const v8 = join(directory, "v8.json");
  const jsc = join(directory, "jsc.json");
  const config = { seed: 1, engine: "node v22" };
  const scenario = { id: "s1-1", start: { s: 12.345678901234567 } };
  const world = { ego: { x: 0, y: 0, psi: 0, v: 0 }, npcs: [] };
  const autopilot = {
    totals: { decisions: 1 },
    lastDecision: { motion: "drive", chosenId: "lane", headlights: "high" },
  };
  const first = captureTrace(config, "map", scenario);
  first.sample(world, autopilot);
  first.write(v8, { pass: true, arrived: true, time_s: 1 });
  const otherConfig = { ...config, engine: "bun" };
  const pinned = readTraceScenario(v8, jsc, otherConfig, "map");
  assert.deepEqual(pinned, scenario);
  assert.throws(() => readTraceScenario(v8, jsc, otherConfig, "other"), /inputs differ at map_sha/);
  assert.throws(() => readTraceScenario(v8, jsc, { ...otherConfig, seed: 2 }, "map"), /inputs differ at settings.seed/);
  assert.throws(() => readTraceScenario(v8, v8, otherConfig, "map"), /different files/);
  const alias = join(directory, "alias.json");
  linkSync(v8, alias);
  assert.throws(() => readTraceScenario(v8, alias, otherConfig, "map"), /different files/);

  const second = captureTrace(otherConfig, "map", pinned);
  autopilot.lastDecision.headlights = "low";
  second.sample(world, autopilot);
  second.write(jsc, { pass: true, arrived: true, time_s: 1 });
  const captures = [v8, jsc].map((path) => JSON.parse(readFileSync(path, "utf8")));
  assert.deepEqual(compareTraces(...captures).decision, {
    tick: 0,
    path: "decision.headlights",
    left: "high",
    right: "low",
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("Benchmark traces distinguish floating-point drift, decisions and mismatched inputs.");
