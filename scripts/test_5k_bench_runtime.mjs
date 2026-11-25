import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { benchmarkDownloadName, comparisonIssue, routeMatches } from "../static/js/bench/view-options.js";
import { aggregate, decidedByText, failures } from "../static/js/bench/metrics.js";
import { driveScores, driverScores, marginScore, rankDrivers } from "../static/js/bench/scores.js";

globalThis.document = { querySelector: () => null };
const { benchmarkConfig, FEATURE_PRESETS, validateScenarioOptions } = await import("../static/js/bench/options.js");
const { FEATURE_NAMES, coveringArray } = await import("../static/js/bench/features.js");
const { heldoutPlan, buildHeldoutSuite, HELDOUT_SEEDS } = await import("../static/js/bench/heldout.js");
const { buildSuite } = await import("../static/js/bench/scenarios.js");
const { runScenario, scenarioTimeLimit, setupScenario } = await import("../static/js/bench/runner.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");

assert.throws(() => FEATURE_PRESETS.pop(), TypeError);
assert.throws(() => FEATURE_NAMES.sort(), TypeError);
assert.throws(() => HELDOUT_SEEDS.reverse(), TypeError);
assert.throws(() => heldoutPlan("kitsilano").seeds.push(1), TypeError);
assert.throws(() => {
  heldoutPlan("other").count = 9;
}, TypeError);
assert.equal(benchmarkConfig({ features: "city", without: " ice, geese " }).without.join(), "geese,ice");
assert.equal(benchmarkConfig({ features: "city", without: " " }).without, undefined);
assert.throws(() => benchmarkConfig({ features: "city", without: Array(1) }), /Unknown feature/);
assert.throws(() => benchmarkConfig({ features: "city", without: "ice, " }), /Unknown feature/);
const firstPair = coveringArray()[0];
const original = firstPair.without.join();
firstPair.without.length = 0;
assert.equal(coveringArray()[0].without.join(), original);
const valid = { npcs: 0, weather: "dry", brain: "rules", diagnostics: false, mode: "lockstep" };
for (const [key, value, error] of [
  ["npcs", -1, /nonnegative integer/],
  ["npcs", 1.5, /nonnegative integer/],
  ["weather", "constructor", /Unknown benchmark weather/],
  ["brain", "", /valid ID/],
  ["brain", "__proto__", /valid ID/],
  ["diagnostics", "false", /true or false/],
  ["mode", "bad", /lockstep or realtime/],
])
  assert.throws(() => validateScenarioOptions({ ...valid, [key]: value }, ["dry"]), error);
assert.throws(() => scenarioTimeLimit({ id: "a" }), /Invalid route length.*a/);
assert.throws(() => scenarioTimeLimit({ id: "a", tags: { length_m: -1 } }), /Invalid route length/);
assert.equal(scenarioTimeLimit({ tags: { length_m: 350 } }, { features: "bare", weather: "snow" }), 140);

const pack = JSON.parse(readFileSync(new URL("../data/maps/623b012bc8b5.v6.pack.json", import.meta.url)));
const map = new MapData(pack);
const scenario = {
  ...challengeScenario(
    map,
    CHALLENGES.find((c) => c.id === "door-zone"),
  ),
  traffic_seed: 7,
};
assert.throws(() => setupScenario(map, scenario, { npcs: 0, brain: "invalid" }), /driver "invalid" is unavailable/);
assert.throws(() => setupScenario(map, scenario, { track: "invalid" }), /Unknown track/);
assert.throws(() => setupScenario(map, { ...scenario, start: { edge: "nonexistent" } }), /no starting lane/);
assert.throws(
  () => setupScenario(map, { ...scenario, start: { ...scenario.start, s: Infinity } }),
  /invalid starting position/,
);
const signal = AbortSignal.abort();
let samples = 0;
const stopped = await runScenario(map, scenario, {
  npcs: 0,
  signal,
  onStep: () => {
    samples++;
  },
});
assert.equal(stopped.stopped, true);
assert.equal(stopped.pass, false);
assert.equal(samples, 0);
assert.equal(await buildSuite(map, { signal }).then((rows) => rows.length), 0);
assert.equal(await buildHeldoutSuite(map, "kitsilano", { signal }).then((rows) => rows.length), 0);
await assert.rejects(buildSuite(map, { count: Number.MAX_SAFE_INTEGER }), /safe search limit/);
await assert.rejects(buildSuite(map, { seed: -1 }), /nonnegative integer/);
await assert.rejects(buildSuite(map, { restrictions: { hour: 24, weekday: 0 } }), /restrictions require/);
await assert.rejects(buildSuite(map, { restrictions: { hour: 12, weekday: 7 } }), /weekday/);
const savedFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => {
    throw new Error("offline example");
  };
  await assert.rejects(buildSuite(map, { count: 1 }), /suite seed 1 .*offline example/);
  globalThis.fetch = async () => Response.json({ routes: null });
  await assert.rejects(buildSuite(map, { count: 1 }), /expected routes/);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ routes: [] });
  };
  assert.equal(await buildSuite(map, { count: 1 }).then((rows) => rows.length), 0);
  assert.ok(calls > 1);
  const controller = new AbortController();
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.signal === controller.signal, true);
    controller.abort();
    return Response.json({ routes: [] });
  };
  assert.equal(await buildSuite(map, { count: 1, signal: controller.signal }).then((rows) => rows.length), 0);
  globalThis.fetch = async () =>
    Response.json({
      routes: [
        {
          polyline: [
            [0, 0],
            [600, 0],
          ],
          edges: [],
          turns: [],
        },
      ],
    });
  let progress = "";
  const route = await buildSuite(map, {
    count: 1,
    onRoute: ({ id, ready, count }) => {
      progress = `${id} ${ready}/${count}`;
    },
  });
  assert.equal(route.length, 1);
  assert.equal(progress, "s1-1 1/1");
} finally {
  globalThis.fetch = savedFetch;
}

const tags = { length_m: 350, signals: 0, stops: 0, lefts: 0, rights: 0 };
const drive = { id: "s1-1", arrived: true, pass: true, tags, time_s: 40, distance_m: 360, failures: [] };
const config = { map: "test", brain: "rules", features: "city", engine: "node v22", npcs: 40 };
const run = {
  config,
  results: [drive],
  manifest: { maps: { test: { fingerprint: "unchanged" } } },
};
assert.equal(comparisonIssue(run, { ...run, config: { ...config, hour: 15.5 } }), null);
assert.match(comparisonIssue(run, { ...run, config: { ...config, cover: 0 } }), /covering row/);
assert.match(comparisonIssue(run, { ...run, config: { ...config, engine: "bun 1" } }), /JavaScript engine/);
assert.match(
  comparisonIssue(run, { ...run, manifest: { maps: { test: { fingerprint: "other" } } } }),
  /map fingerprint/,
);
assert.match(comparisonIssue(run, { ...run, complete: false }), /in progress/);
assert.match(comparisonIssue(run, { ...run, config: null }), /conditions are unavailable/);
assert.match(comparisonIssue(run, { ...run, results: [null] }), /identity unavailable/);
const heldout = { ...run, config: { ...config, heldout: true, seeds: [101, 102] } };
assert.match(
  comparisonIssue(heldout, { ...heldout, config: { ...heldout.config, seeds: [102, 101] } }),
  /held-out seeds/,
);
assert.equal(routeMatches("verdict:pass", drive, drive), true);
assert.equal(routeMatches("verdict:fail", drive, drive), false);
assert.equal(routeMatches("verdict:pending", drive), true);
assert.equal(routeMatches("parking:parked", drive, { ...drive, parked: true }), true);
assert.equal(routeMatches("parking:no-space", drive, { ...drive, parked: null, no_space: true }), true);
assert.equal(routeMatches("parking:failed", drive, { ...drive, parked: false }), true);
assert.match(
  benchmarkDownloadName({ ...config, track: "open", park: true, hour: 2, cover: 0, mode: "realtime" }, "json"),
  /-open-park-hour-2-cover-0-realtime\.json$/,
);

const lots = Array.from({ length: 150_000 }, () => ({ min_gap_m: 2, min_ttc_s: 1 }));
assert.equal(aggregate(lots).min_gap_m, 2);
assert.equal(aggregate([]).min_ttc_s, null);
assert.equal(aggregate([{ min_ttc_s: null }, { min_ttc_s: 0 }]).min_ttc_s, 0);
assert.equal(aggregate([{ min_gap_m: Infinity }, { min_gap_m: NaN }]).min_gap_m, null);
assert.equal(aggregate([{ pass: true, arrived: false }]).arrived_rate, 0);
assert.equal(aggregate([{ track: "open", flagged_choices: 0 }]).flagged_choices, 0);
assert.equal(Object.hasOwn(aggregate([{ track: "guarded" }]), "flagged_choices"), false);
assert.equal(
  decidedByText({ model_share: 0, local_share: 1, fallback_share: 0 }),
  "0% model · 100% local · 0% fallback",
);
assert.equal(decidedByText({ model_share: null }), null);
assert.equal(failures({ arrived: true, off_road_s: 0.99 }).join(), "");
assert.equal(failures({ arrived: true, off_road_s: 1 }).join(), "off road");
assert.equal(failures({ arrived: true, bus_lane_driving: 1 }).join(), "");
assert.equal(failures({ arrived: true, bus_lane_driving: 1.1 }).join(), "drove in a reserved bus lane");
assert.equal(failures({ arrived: false, parked: false }).join(), "timeout");
assert.equal(driveScores({ ...drive, progress: 0.1 }).progress, 1);
assert.equal(driveScores({ ...drive, arrived: false, progress: 2 }).progress, 1);
assert.equal(driveScores({ ...drive, arrived: false, progress: -1 }).progress, 0);
assert.equal(driveScores({ time_s: 0, distance_m: 0 }).time_lost_s_per_km, null);
assert.equal(driverScores([]).score, null);
assert.equal(marginScore({ ...drive, collisions: 1 }), 0);
const ranked = rankDrivers([
  { driver: "zed", results: [drive, { ...drive, id: "extra" }] },
  { driver: "alpha", results: [drive] },
]);
assert.equal(ranked.matched.join(), drive.id);
assert.equal(ranked.ranking[0].driver, "alpha");
assert.equal(ranked.ranking[1].rank, 1);
console.log("Benchmark runtime validation, comparison and display metrics passed.");
process.exit(0);
