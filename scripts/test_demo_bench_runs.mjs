// The public demo's saved benchmark runs (static/js/demo/api.js): /api/bench/runs lists them, and
// /api/bench/runs?name= returns one run with its results, as the local server does, so /bench can
// score a compared run (bench/main.js loadCompareScores).
// node --experimental-default-type=module scripts/test_demo_bench_runs.mjs   (no server, no network)
import assert from "node:assert/strict";
import { suiteVersion } from "../static/js/bench/suite-version.js";
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const { demoApi } = await import("../static/js/demo/api.js");

await assert.rejects(
  demoApi("/api/bench/save", {
    suite_version: "v1",
    config: { brain: "rules" },
    summary: {},
    results: [{ id: "s1-1", suite_version: "v1" }],
  }),
  /custom suite/,
);

const { saved } = await demoApi("/api/bench/save", {
  config: { brain: "rules" },
  summary: { pass_rate: 1 },
  results: [{ id: "s1-1", pass: true }],
});
const { runs } = await demoApi("/api/bench/runs");
assert.equal(runs.length, 1);
assert.equal(runs[0].name, saved);
assert.equal(suiteVersion(runs[0]), "legacy");
const one = await demoApi(`/api/bench/runs?name=${encodeURIComponent(saved)}`);
assert.equal(one.name, saved);
assert.equal(one.results?.length, 1);
assert.equal(one.results[0].id, "s1-1");
assert.equal(suiteVersion(one.results[0]), "legacy");
await demoApi("/api/bench/save", {
  suite_version: "custom",
  config: { brain: "rules" },
  summary: { pass_rate: 1 },
  results: [{ id: "s1-1", pass: true, suite_version: "custom" }],
});
const { runs: withCustom } = await demoApi("/api/bench/runs");
assert.equal(withCustom[0].suite_version, "custom");
assert.equal(withCustom[0].results[0].suite_version, "custom");
const missing = await demoApi("/api/bench/runs?name=nope");
assert.equal(missing.results, undefined);
console.log("✓ the demo lists saved runs and returns one by name, results and all");
