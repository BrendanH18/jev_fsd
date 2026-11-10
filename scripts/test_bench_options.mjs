// Focused, offline tooling checks; assertions only receive primitives and small option records.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { freeDriveOptions } = await import("../static/js/sim/free-drive.js");
const { FEATURE_NAMES, coveringArray, validFeatureSet } = await import("../static/js/bench/features.js");
const { benchmarkConfig, presetOptions, setupScenario, runScenario, suiteOptions } = await import("../static/js/bench/runner.js");
const { soakPlan, classifyResults, soakFailed } = await import("./soak.mjs");
const { failures } = await import("../static/js/bench/metrics.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");

assert.equal(JSON.stringify(benchmarkConfig()), "{}");
assert.equal(JSON.stringify(benchmarkConfig({ features: "city", park: false, hour: 15.5 })), '{"features":"city"}');
assert.equal(JSON.stringify(presetOptions()), '{"world":{},"fleet":{}}');
assert.equal(JSON.stringify(presetOptions("city")), JSON.stringify(freeDriveOptions(new URLSearchParams("park=0"), { hour: 15.5 })));
assert.equal(presetOptions("bare", { park: true }).world.park, true);
assert.equal(presetOptions("city", { park: true }).world.park, true);
assert.equal(presetOptions("city", { hour: 23.5 }).world.pedestrians, 18);
assert.equal(presetOptions("city", { hour: 23.5 }).fleet.schoolBuses, 0);
assert.equal(presetOptions("city", { hour: 6.5 }).world.pedestrians, undefined);
assert.equal(presetOptions("city", { hour: 6.5 }).fleet.schoolBuses, 0);
assert.equal(presetOptions("bare", { hour: 23.5 }).world.pedestrians, 18);
assert.equal(suiteOptions("city", { hour: 23.5 }).restrictions.hour, 23.5);
assert.equal(JSON.stringify(suiteOptions("city", { without: ["restrictions"] })), "{}");
assert.equal(presetOptions("city", { without: ["hazards"] }).world.stepOuts, 0);
assert.equal(presetOptions("city", { without: ["stepOuts"] }).world.hazards, true);
assert.equal(presetOptions("city", { without: ["stepOuts"] }).world.stepOuts, 0);
for (const options of [{ hour: -1 }, { hour: 24 }, { hour: NaN }, { hour: "23" }, { park: 1 }, { features: "typo" },
  { features: "city", without: "gooses" }, { without: "ice" }, { cover: 0 }, { features: "city", cover: -1 }, { features: "city", cover: 999 }, { features: "city", cover: 0.5 }]) {
  assert.throws(() => benchmarkConfig(options));
}
console.log("✓ defaults, independent parking/hour, route hours, dependencies and validation");

const rows = coveringArray();
assert.ok(rows.length < 24, `${rows.length} rows should remain a small covering array`);
assert.equal(JSON.stringify(rows), JSON.stringify(coveringArray()));
assert.notEqual(JSON.stringify(rows), JSON.stringify(coveringArray(2)));
const bits = rows.map(row => FEATURE_NAMES.filter(name => !row.without.includes(name)));
for (const [i, row] of rows.entries()) {
  assert.equal(validFeatureSet(bits[i]), true);
  const config = benchmarkConfig({ features: "city", cover: i });
  assert.equal(JSON.stringify(benchmarkConfig(config)), JSON.stringify(config), "saved/replayed configs normalize idempotently");
  const options = presetOptions("city", config);
  for (const name of FEATURE_NAMES) for (const group of ["world", "fleet"]) if (Object.hasOwn(options[group], name))
    assert.equal(!!options[group][name], bits[i].includes(name), `${row.id}: ${group}.${name}`);
}
for (let i = 0; i < FEATURE_NAMES.length; i++) for (let j = i + 1; j < FEATURE_NAMES.length; j++) {
  const a = FEATURE_NAMES[i], b = FEATURE_NAMES[j];
  for (const av of [false, true]) for (const bv of [false, true]) {
    if (a === "hazards" && b === "stepOuts" && !av && bv) continue;
    assert.equal(bits.some(on => on.includes(a) === av && on.includes(b) === bv), true, `missing ${a}=${av},${b}=${bv}`);
  }
}
console.log(`✓ ${rows.length} deterministic rows cover all feasible binary pairs of ${FEATURE_NAMES.length} features`);

const plan = soakPlan(), shards = Array.from({ length: 8 }, (_, shard) => soakPlan({ shard, shards: 8 })).flat();
assert.equal(plan.length, 12 + rows.length);
assert.equal(new Set(shards.map(t => t.id)).size, plan.length);
assert.equal(JSON.stringify(shards.map(t => t.id).sort()), JSON.stringify(plan.map(t => t.id).sort()));
assert.equal(soakPlan({ mode: "pairs", maps: ["kitsilano"], seeds: [1] }).length, rows.length);
for (const options of [{ shards: 0 }, { shard: 8, shards: 8 }, { mode: "nope" }, { count: 0 }, { seeds: [NaN] }, { maps: [] }]) assert.throws(() => soakPlan(options));
const categories = classifyResults([{ id: "audit", arrived: true, deadlocks: 0, collisions: 0, failures: ["red light"] },
  { id: "throw", arrived: false, simulation_error: "boom", failures: ["simulation error"] },
  { id: "stuck", arrived: true, deadlocks: 1, failures: [] }, { id: "timeout", arrived: false, failures: ["timeout"] },
  { id: "collision", arrived: true, collisions: 1, failures: ["collision"] }]);
assert.equal(categories.throws.join(), "throw"); assert.equal(categories.stuck.join(), "stuck,timeout");
assert.equal(categories.collisions.join(), "collision"); assert.equal(categories.audits[0].id, "audit");
assert.equal(soakFailed(categories), true);
assert.equal(soakFailed(classifyResults([{ id: "audit", arrived: true, failures: ["red light"] }])), false);
assert.equal(failures({ arrived: true, parked: false }).join(), "not parked");
console.log("✓ soak shards are exhaustive/disjoint; fatal failures and report-only audits stay separate");

const key = "623b012bc8b5", base = new URL("../data/maps/", import.meta.url);
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, base)));
for (const layer of ["transit", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const path = new URL(`${key}.${layer}.v1.json`, base);
  if (fs.existsSync(path)) pack[layer] = JSON.parse(fs.readFileSync(path));
}
const crossing = [2, 1].map(v => new URL(`${key}.crossings.v${v}.json`, base)).find(p => fs.existsSync(p));
if (crossing) pack.crossings = JSON.parse(fs.readFileSync(crossing));
const map = new MapData(pack), scenario = { ...challengeScenario(map, CHALLENGES.find(c => c.id === "door-zone")), traffic_seed: 7 };
const night = setupScenario(map, scenario, { npcs: 0, features: "city", hour: 23.5, park: true });
assert.equal(night.world.clock.hour, 23.5); assert.equal(night.world.clock.weekday, 0);
assert.equal(night.world.visibility.night, 1); assert.equal(night.world.parkAtGoal, true);
const bare = setupScenario(map, scenario, { npcs: 0 });
assert.equal(bare.world.clock === null, true); assert.equal(bare.world.visibility.night, 0); assert.equal(bare.world.parkAtGoal, false);
const stopped = await runScenario(map, scenario, { npcs: 0, park: true, shouldStop: () => true });
assert.equal(stopped.parked, false); assert.equal(stopped.pass, false);
const historical = await runScenario(map, scenario, { npcs: 0, shouldStop: () => true });
assert.equal(Object.hasOwn(historical, "parked"), false);
assert.equal(Object.hasOwn(historical, "diagnostics"), false);
console.log("✓ scenario setup actually turns on darkness and parking; default bare remains clock-free");
process.exit(0);
