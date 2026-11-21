// Reassemble a complete seeded benchmark from disjoint --only runs. Each input report has a
// recording with the same stem beside it. The outputs can be replayed and published as one run.
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { aggregate } from "../static/js/bench/metrics.js";
import { LEGACY_SUITE, setRecordingSuiteVersion, suiteVersion } from "../static/js/bench/suite-version.js";
import { canonicalJson, ModelRecording, sameResult } from "../static/js/brain/recording.js";
import { benchRouteFingerprint, benchRunName } from "./run_manifest.mjs";
import { benchSuiteVersion } from "./canonical_suite.mjs";

const mismatched = (file, detail) => new Error(`${file}: ${detail}`);

function readPart(path) {
  if (!path.endsWith(".json")) throw mismatched(path, "expected a benchmark JSON report");
  const report = JSON.parse(readFileSync(path, "utf8"));
  const tape = ModelRecording.parse(gunzipSync(readFileSync(path.replace(/\.json$/, ".json.gz"))).toString("utf8"));
  const { header } = tape;
  const { manifest, config } = report;
  if (
    manifest?.source_dirty !== false ||
    !/^[a-f0-9]{40}$/.test(manifest.source_commit) ||
    manifest.suite?.kind !== "bench" ||
    manifest.suite.only !== true ||
    config?.heldout ||
    report.stopped ||
    !report.results?.length
  )
    throw mismatched(path, "expected a finished seeded --only recording from a clean checkout");
  if (
    canonicalJson(manifest) !== canonicalJson(header.manifest) ||
    canonicalJson(config) !== canonicalJson(header.bench) ||
    canonicalJson(config) !== canonicalJson(manifest.suite.config) ||
    manifest.cost_usd !== aggregate(report.results).cost_usd ||
    report.suite_version !== header.suite_version ||
    report.results.some((result) => result.suite_version !== report.suite_version) ||
    header.map_sha !== manifest.maps?.[config.map]?.fingerprint
  )
    throw mismatched(path, "report, tape and manifest disagree");
  const { recorded_at: _recordedAt, manifest: _manifest, ...identity } = header;
  return {
    report,
    tape,
    identity: canonicalJson({ identity, config, maps: manifest.maps, source: manifest.source_commit }),
  };
}

function writePair(outputs) {
  const temporary = [];
  const published = [];
  try {
    for (const [path, data] of outputs) {
      const directory = mkdtempSync(join(dirname(path), ".bench-merge-"));
      temporary.push(directory);
      const file = join(directory, "output");
      writeFileSync(file, data);
      linkSync(file, path);
      published.push(path);
    }
  } catch (error) {
    for (const path of published) unlinkSync(path);
    throw error;
  } finally {
    for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
  }
}

function merge(paths, reportPath, recordingPath, suitePath) {
  if (!reportPath?.endsWith(".json") || !recordingPath?.endsWith(".json.gz") || paths.length < 2)
    throw new Error(
      "Usage: merge_bench_recordings.mjs --json RUN.json --record RUN.json.gz [--suite ROUTES.json] PART.json PART.json [...]",
    );
  if (existsSync(reportPath) || existsSync(recordingPath)) throw new Error("The merged output files must be new.");
  const parts = paths.map(readPart);
  const first = parts[0];
  const { config } = first.report;
  const reference = suitePath ? JSON.parse(readFileSync(suitePath, "utf8")) : null;
  if (suitePath && !Array.isArray(reference)) throw new Error("--suite must name a regenerated scenario array.");
  const routeSha = reference ? benchRouteFingerprint(reference) : first.report.manifest.suite.route_sha;
  if (!routeSha) throw new Error("These parts need --suite with the regenerated seeded scenarios.");
  const ids = reference ? reference.map((scenario) => scenario.id) : first.report.manifest.suite.generated_ids;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
    throw new Error("These parts need a generated drive list or --suite with regenerated scenarios.");
  const results = new Map();
  const merged = new ModelRecording({ header: { ...first.tape.header } });
  for (const part of parts) {
    const { report, tape } = part;
    if (part.identity !== first.identity)
      throw new Error("The parts must share source, engine, driver, map and suite.");
    const partSha = report.manifest.suite.route_sha;
    if (partSha ? partSha !== routeSha : !reference) throw new Error("A part generated a different seeded suite.");
    const generatedIds = report.manifest.suite.generated_ids;
    if (generatedIds && canonicalJson(generatedIds) !== canonicalJson(ids))
      throw new Error("A part generated a different drive list.");
    const partIds = report.results.map((result) => result.id);
    if (
      canonicalJson(partIds) !== canonicalJson(report.manifest.suite.ids) ||
      partIds.length !== Object.keys(tape.results).length
    )
      throw new Error("A part's report, tape and selected drives disagree.");
    for (const result of report.results) {
      const id = result.id;
      if (!ids.includes(id) || results.has(id)) throw new Error(`Unexpected or repeated drive ${id}.`);
      if (!Object.hasOwn(tape.drives, id) || tape.scenarios[id]?.id !== id || !sameResult(result, tape.results[id]))
        throw new Error(`Tape for ${id} disagrees with its report or lacks the scenario or answers.`);
      results.set(id, { result, tape });
    }
  }
  const missing = ids.filter((id) => !results.has(id));
  if (missing.length) throw new Error(`Missing drives: ${missing.join(", ")}.`);
  const ordered = ids.map((id) => {
    const { result, tape } = results.get(id);
    merged.keepResult(id, result, tape.scenarios[id]);
    merged.drives[id] = tape.drives[id];
    return result;
  });
  const scenarios = ids.map((id) => merged.scenarios[id]);
  if (reference ? canonicalJson(scenarios) !== canonicalJson(reference) : benchRouteFingerprint(scenarios) !== routeSha)
    throw new Error("The recorded routes do not match the complete seeded suite.");
  const summary = aggregate(ordered);
  const manifest = {
    ...first.report.manifest,
    suite: { kind: "bench", config, ids, generated_ids: ids, route_sha: routeSha },
    cost_usd: summary.cost_usd,
  };
  merged.header.manifest = manifest;
  let suite_version;
  if (suiteVersion(first.tape.header) !== LEGACY_SUITE) {
    suite_version = benchSuiteVersion({ ...manifest.suite, map_sha: merged.header.map_sha }, ordered);
    setRecordingSuiteVersion(merged, suite_version);
    for (const result of ordered) result.suite_version = suite_version;
  }
  merged.header.recorded_at = parts
    .map(({ tape }) => tape.header.recorded_at)
    .sort()
    .at(0);
  const saved_at = parts
    .map(({ report }) => report.saved_at)
    .sort()
    .at(-1);
  const output = {
    suite_version,
    name: benchRunName(saved_at, config.brain),
    saved_at,
    config,
    summary,
    results: ordered,
    manifest,
  };
  writePair([
    [recordingPath, gzipSync(merged.serialize(), { level: 9 })],
    [reportPath, `${JSON.stringify(output, null, 1)}\n`],
  ]);
  console.log(`Merged ${ids.length} drives from ${parts.length} parts.`);
}

try {
  const { values, positionals } = parseArgs({
    options: { json: { type: "string" }, record: { type: "string" }, suite: { type: "string" } },
    allowPositionals: true,
  });
  merge(positionals, values.json, values.record, values.suite);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
