// City winter time allowances must leave every historical bare deadline unchanged.
// node --experimental-default-type=module scripts/test_bench_snow_limit.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { scenarioTimeLimit } = await import("../static/js/bench/runner.js");
const { WEATHER } = await import("../static/js/sim/weather.js");
for (const length_m of [0, 100, 300, 520, 662, 1400]) {
  const sc = { tags: { length_m } }, original = Math.max(120, length_m / 2.5);
  assert.equal(scenarioTimeLimit(sc), original);
  for (const weather of Object.keys(WEATHER)) assert.equal(scenarioTimeLimit(sc, { features: "bare", weather }), original);
  for (const weather of ["dry", "rain", "fog"]) assert.equal(scenarioTimeLimit(sc, { features: "city", weather }), original);
  assert.equal(scenarioTimeLimit(sc, { features: "city", weather: "snow" }), original / WEATHER.snow.speed);
  assert.equal(Number.isFinite(scenarioTimeLimit(sc, { features: "city", weather: "snow" })), true);
}
// The measured snow drive s1-2 arrives at 293.1 s rather than its old 264.8 s deadline.
const sc = { tags: { length_m: 662 } };
assert.equal(scenarioTimeLimit(sc) < 293.1, true);
assert.equal(scenarioTimeLimit(sc, { features: "city", weather: "snow" }) > 293.1, true);
console.log("City snow allowance and unchanged bare deadline checks passed");
process.exit(0);
