// The frozen input definition used by the Node writers and the publication builder.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import v1 from "../data/suites/v1.json" with { type: "json" };
import v2 from "../data/suites/v2.json" with { type: "json" };
import { CUSTOM_SUITE } from "../static/js/bench/suite-version.js";
import { canonicalJson } from "../static/js/brain/recording.js";
import { readJson } from "./cli_tools.mjs";

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Every numbered definition stays loadable, so an artifact that declares an earlier version is
// still checked against the definition it declares. The Node writers label new runs with the
// active one. v2 has v1's members: it exists because the lane joins traffic follows changed
// (docs/validation/lane-join-parity-2026-11-26.md), which changed results under v1's conditions.
export const SUITES = freeze({ v1, v2 });
export const activeSuite = SUITES.v2;
export const suiteDefinition = (version) => (Object.hasOwn(SUITES, version) ? SUITES[version] : null);
// The definition an artifact is checked against: the one it declares, or the active one when it
// declares none (legacy, custom, or a run still being written).
export const definitionFor = (artifact) => suiteDefinition(artifact?.suite_version) ?? activeSuite;
// The definition a set of shards may be merged into: the numbered suite they declare, or the one
// their writer was recording for (`suite_target`, written beside the `custom` label of a partial
// run). Shards with neither predate suite v2 and may have been driven before the change that made
// it, so their merge stays custom.
export const mergeDefinition = (header) =>
  suiteDefinition(header?.suite_version) ?? suiteDefinition(header?.suite_target);

export const authoredDrive = (challenge) => ({
  map: challenge.map,
  seed: challenge.seed,
  version: challenge.version || 1,
});

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const versionFor = (issues, canonical) => (issues.length ? CUSTOM_SUITE : canonical.version);
const issue = (path, expected, actual) => ({ path, expected: expected ?? null, actual: actual ?? null });

export function arenaSuiteIssues({ set, drives, maps }, results, canonical = activeSuite) {
  const issues = [];
  if (set !== "all") issues.push(issue("set", "all", set));
  const expected = canonical.arena.drives;
  for (const [id, drive] of Object.entries(expected))
    if (!same(drives?.[id], drive)) issues.push(issue(`drives.${id}`, drive, drives?.[id]));
  for (const id of Object.keys(drives || {}).sort())
    if (!Object.hasOwn(expected, id)) issues.push(issue(`drives.${id}`, null, drives[id]));
  for (const [id, sha] of Object.entries(canonical.maps))
    if (maps?.[id] !== sha) issues.push(issue(`maps.${id}`, sha, maps?.[id]));
  for (const id of Object.keys(maps || {}).sort())
    if (!Object.hasOwn(canonical.maps, id)) issues.push(issue(`maps.${id}`, null, maps[id]));

  const ids = new Set();
  for (const r of results) {
    const id = r?.challenge;
    if (!Object.hasOwn(expected, id)) {
      issues.push(issue("results.challenge", "authored challenge ID", id));
      continue;
    }
    if (ids.has(id)) issues.push(issue(`results.${id}.duplicate`, false, true));
    ids.add(id);
    if (r.stopped) issues.push(issue(`results.${id}.stopped`, false, true));
    const actual = authoredDrive(r);
    if (!same(actual, expected[id])) issues.push(issue(`results.${id}.authored`, expected[id], actual));
  }
  for (const id of Object.keys(expected))
    if (!ids.has(id)) issues.push(issue(`results.${id}`, "completed drive", null));
  return issues;
}

export function arenaSuiteVersion(metadata, results, canonical = activeSuite) {
  return versionFor(arenaSuiteIssues(metadata, results, canonical), canonical);
}

export function benchSuiteIssues({ config, ids, route_sha, map_sha }, results, canonical = activeSuite) {
  const { bench, maps } = canonical;
  const issues = [];
  const check = (key, wanted, actual) => {
    if (!same(wanted, actual)) issues.push(issue(key, wanted, actual));
  };
  for (const [key, value] of Object.entries(bench.config))
    if (!config.heldout || !["count", "seed"].includes(key)) check(`config.${key}`, value, config[key]);
  if (!bench.weathers.includes(config.weather)) issues.push(issue("config.weather", bench.weathers, config.weather));
  check("map_sha", maps[bench.config.map], map_sha);
  if (config.park) issues.push(issue("config.park", false, config.park));
  if (config.hour !== undefined) issues.push(issue("config.hour", "omitted", config.hour));
  if (config.cover !== undefined) issues.push(issue("config.cover", "omitted", config.cover));
  if (config.without?.length) issues.push(issue("config.without", [], config.without));
  if (config.track && config.track !== "guarded") issues.push(issue("config.track", "guarded", config.track));
  if (config.stopped) issues.push(issue("config.stopped", false, config.stopped));

  const { seeds, count } = bench.heldout;
  const expected = config.heldout
    ? seeds.flatMap((seed) => Array.from({ length: count }, (_, i) => `s${seed}-${i + 1}`))
    : bench.ids;
  if (config.heldout) {
    check("config.seed", seeds[0], config.seed);
    check("config.count", expected.length, config.count);
    check("config.seeds", seeds, config.seeds);
  }
  check("route_sha", config.heldout ? bench.heldout.route_sha : bench.route_sha, route_sha);
  check("ids", expected, ids);
  check(
    "results.ids",
    expected,
    results.filter((result) => !result?.stopped).map((result) => result?.id),
  );
  return issues;
}

export function benchSuiteVersion(metadata, results, canonical = activeSuite) {
  return versionFor(benchSuiteIssues(metadata, results, canonical), canonical);
}

// An artifact may be custom even when its drives match, for example when it was produced
// by only/skip filters. Report that distinction alongside the actual input mismatches.
export function explainSuite(report) {
  const { suite, maps } = report?.manifest || {};
  if (!suite || !maps || !Array.isArray(report.results))
    throw new Error("Expected a completed benchmark or arena report with a run manifest and results.");
  const canonical = definitionFor(report);
  let issues;
  if (suite.kind === "bench") {
    if (!suite.config) throw new Error("Benchmark manifest is missing its config.");
    issues = benchSuiteIssues({ ...suite, map_sha: maps[suite.config.map]?.fingerprint }, report.results, canonical);
    if (report.config && !same(report.config, suite.config)) issues.push(issue("config", suite.config, report.config));
  } else if (suite.kind === "arena") {
    issues = arenaSuiteIssues(
      { ...suite, maps: Object.fromEntries(Object.entries(maps).map(([id, map]) => [id, map?.fingerprint])) },
      report.results,
      canonical,
    );
  } else throw new Error(`Unknown suite kind "${suite.kind}".`);
  if (suite.only) issues.push(issue("manifest.suite.only", false, suite.only));
  if (report.stopped) issues.push(issue("stopped", false, report.stopped));
  return {
    declared: report.suite_version ?? "legacy",
    eligible: versionFor(issues, canonical),
    issues,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values, positionals } = parseArgs({
      options: { check: { type: "boolean" }, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    });
    const usage = "Usage: node scripts/canonical_suite.mjs [--check] REPORT.json[.gz]";
    if (values.help) console.log(usage);
    else {
      if (positionals.length !== 1) throw new Error(usage);
      const explanation = explainSuite(readJson(positionals[0]));
      console.log(JSON.stringify(explanation, null, 2));
      if (values.check && (!suiteDefinition(explanation.eligible) || explanation.declared !== explanation.eligible))
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
