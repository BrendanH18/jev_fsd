import assert from "node:assert/strict";
import {
  activeSuite,
  arenaSuiteIssues,
  arenaSuiteVersion,
  benchSuiteIssues,
  benchSuiteVersion,
  explainSuite,
} from "./canonical_suite.mjs";
import { compatibleSuiteVersions, replaySuiteVersion } from "../static/js/bench/suite-version.js";

const bench = activeSuite.bench;
const metadata = {
  kind: "bench",
  config: { ...bench.config, weather: "dry" },
  ids: [...bench.ids],
  route_sha: bench.route_sha,
  map_sha: activeSuite.maps[bench.config.map],
};
const results = bench.ids.map((id) => ({ id, pass: true }));
const paths = (value) => value.map(({ path }) => path).join(",");
assert.equal(benchSuiteVersion(metadata, results), "v1");
assert.equal(
  benchSuiteVersion(
    metadata,
    results.map((r) => ({ ...r, pass: false })),
  ),
  "v1",
);
assert.equal(benchSuiteVersion(metadata, results.toReversed()), "custom");
for (const weather of bench.weathers)
  assert.equal(benchSuiteVersion({ ...metadata, config: { ...metadata.config, weather } }, results), "v1");
const issues = (change) => benchSuiteIssues({ ...metadata, config: { ...metadata.config, ...change } }, results);
for (const [field, value] of [
  ["weather", "mist"],
  ["map", "different"],
  ["mode", "realtime"],
  ["features", "bare"],
  ["count", 8],
  ["seed", 2],
  ["npcs", 0],
  ["park", true],
  ["cover", 0],
  ["without", ["ice"]],
  ["track", "open"],
  ["hour", 12],
  ["stopped", true],
]) {
  assert.match(paths(issues({ [field]: value })), new RegExp(`config\\.${field}`));
}
assert.equal(paths(issues({ track: "guarded", without: [] })), "");
assert.equal(paths(benchSuiteIssues({ ...metadata, map_sha: "wrong" }, results)), "map_sha");
assert.equal(paths(benchSuiteIssues({ ...metadata, route_sha: "wrong" }, results)), "route_sha");
assert.equal(paths(benchSuiteIssues({ ...metadata, ids: [] }, results)), "ids");
assert.equal(paths(benchSuiteIssues(metadata, results.with(0, { ...results[0], stopped: true }))), "results.ids");
const heldout = bench.heldout;
const heldoutIds = heldout.seeds.flatMap((seed) =>
  Array.from({ length: heldout.count }, (_, i) => `s${seed}-${i + 1}`),
);
const heldoutConfig = {
  ...metadata.config,
  heldout: true,
  count: heldoutIds.length,
  seed: heldout.seeds[0],
  seeds: heldout.seeds,
};
const heldoutMetadata = { ...metadata, config: heldoutConfig, ids: heldoutIds, route_sha: heldout.route_sha };
const heldoutResults = heldoutIds.map((id) => ({ id, pass: true }));
assert.equal(benchSuiteVersion(heldoutMetadata, heldoutResults), "v1");
assert.equal(
  paths(
    benchSuiteIssues(
      {
        ...heldoutMetadata,
        config: { ...heldoutConfig, seed: 999, count: 3, seeds: heldout.seeds.toReversed() },
      },
      heldoutResults,
    ),
  ),
  "config.seed,config.count,config.seeds",
);
assert.equal(paths(benchSuiteIssues({ ...heldoutMetadata, route_sha: bench.route_sha }, heldoutResults)), "route_sha");

const drives = activeSuite.arena.drives;
const authored = Object.entries(drives).map(([challenge, drive]) => ({ challenge, ...drive }));
const arena = { set: "all", drives, maps: activeSuite.maps };
const id = authored[0].challenge;
assert.equal(arenaSuiteVersion(arena, authored.toReversed()), "v1");
assert.equal(paths(arenaSuiteIssues({ ...arena, set: "challenges" }, authored)), "set");
assert.equal(
  paths(arenaSuiteIssues({ ...arena, drives: { ...drives, extra: authored[0] } }, authored)),
  "drives.extra",
);
assert.equal(paths(arenaSuiteIssues({ ...arena, maps: { ...arena.maps, extra: "x" } }, authored)), "maps.extra");
assert.equal(paths(arenaSuiteIssues(arena, [authored[0], ...authored])), `results.${id}.duplicate`);
assert.equal(paths(arenaSuiteIssues(arena, authored.slice(1))), `results.${id}`);
assert.equal(paths(arenaSuiteIssues(arena, [...authored, { challenge: "extra" }])), "results.challenge");
assert.equal(
  paths(arenaSuiteIssues(arena, authored.with(0, { ...authored[0], stopped: true }))),
  `results.${id}.stopped`,
);
assert.equal(paths(arenaSuiteIssues(arena, authored.with(0, { ...authored[0], seed: -1 }))), `results.${id}.authored`);
assert.throws(() => {
  activeSuite.bench.ids[0] = "wrong";
}, TypeError);
assert.throws(() => {
  activeSuite.arena.drives[id].seed = -1;
}, TypeError);

const manifest = { suite: metadata, maps: { [metadata.config.map]: { fingerprint: metadata.map_sha } } };
const artifact = { suite_version: "v1", manifest, results };
assert.equal(explainSuite(artifact).eligible, "v1");
assert.equal(explainSuite({ ...artifact, suite_version: undefined }).declared, "legacy");
assert.equal(
  paths(
    explainSuite({
      ...artifact,
      config: { ...metadata.config, mode: "realtime" },
      stopped: true,
      manifest: { ...manifest, suite: { ...metadata, only: true } },
    }).issues,
  ),
  "config,manifest.suite.only,stopped",
);
assert.throws(() => explainSuite({}), /manifest and results/);
assert.throws(
  () => explainSuite({ ...artifact, manifest: { ...manifest, suite: { kind: "bad" } } }),
  /Unknown suite kind/,
);
assert.throws(
  () => explainSuite({ ...artifact, manifest: { ...manifest, suite: { kind: "bench" } } }),
  /missing its config/,
);
assert.equal(replaySuiteVersion({ suite_version: "v1" }, false), "custom");
assert.equal(replaySuiteVersion({}, false), "legacy");
assert.equal(replaySuiteVersion({ suite_version: "v1" }, true), "v1");
assert.equal(compatibleSuiteVersions({}, { suite_version: "custom" }), true);
assert.equal(compatibleSuiteVersions({ suite_version: "v1" }, { suite_version: "v2" }), false);
console.log("Canonical benchmark and arena eligibility diagnostics passed.");
