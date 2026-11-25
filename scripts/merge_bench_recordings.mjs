// Reassemble a complete seeded benchmark from disjoint --only runs. Each input report has a
// recording with the same stem beside it. The outputs can be replayed and published as one run.
import { lstatSync, linkSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { aggregate } from "../static/js/bench/metrics.js";
import { LEGACY_SUITE, setRecordingSuiteVersion, suiteVersion } from "../static/js/bench/suite-version.js";
import { canonicalJson, ModelRecording, sameResult } from "../static/js/brain/recording.js";
import { checkFiles } from "./cli_tools.mjs";
import { artifactBytes, isCommit, isDateTime, isId, isRecord, MAX_RECORDING_BYTES, readArtifactJson, readRecordingJson } from "./recording_artifacts.mjs";
import { benchRouteFingerprint, benchRunName, runCost } from "./run_manifest.mjs";
import { benchSuiteVersion } from "./canonical_suite.mjs";

const mismatched = (file, detail) => new Error(`${file}: ${detail}`);

function readPart(path) {
  if (!path.endsWith(".json")) throw mismatched(path, "expected a benchmark JSON report");
  const tapePath = `${path}.gz`;
  let report;
  let tape;
  try {
    report = readArtifactJson(path);
  } catch (error) {
    throw mismatched(path, `cannot read report: ${error.message}`);
  }
  try {
    tape = ModelRecording.parse(readRecordingJson(tapePath));
  } catch (error) {
    throw mismatched(tapePath, `cannot read recording: ${error.message}`);
  }
  const { header } = tape;
  if (!isRecord(report)) throw mismatched(path, "expected a benchmark report object");
  if (!isDateTime(report.saved_at)) throw mismatched(path, "invalid saved_at timestamp");
  const { manifest, config } = report;
  if (
    manifest?.source_dirty !== false ||
    !isCommit(manifest.source_commit) ||
    manifest.suite?.kind !== "bench" ||
    manifest.suite.only !== true ||
    !isId(config?.map) ||
    !isId(config?.brain) ||
    !Number.isSafeInteger(config.seed) ||
    !Number.isSafeInteger(config.count) ||
    config.count < 1 ||
    config.heldout ||
    report.stopped ||
    !Array.isArray(report.results) ||
    !report.results.length ||
    report.results.some((result) => result?.stopped || result?.simulation_error)
  )
    throw mismatched(path, "expected a finished seeded --only recording from a clean checkout");
  if (report.results.some((result) => !isId(result?.id) || typeof result.pass !== "boolean"))
    throw mismatched(path, "every result needs a drive ID and boolean verdict");
  if (header.arena) throw mismatched(tapePath, "an Arena recording cannot be merged into a seeded benchmark");
  if (header.driver !== config.brain) throw mismatched(tapePath, "tape driver differs from the report driver");
  if (header.recorded_at !== undefined && !isDateTime(header.recorded_at))
    throw mismatched(tapePath, "invalid recorded_at timestamp");
  let cost;
  try {
    cost = runCost(report.results);
  } catch (error) {
    throw mismatched(path, error.message);
  }
  if (
    canonicalJson(manifest) !== canonicalJson(header.manifest) ||
    canonicalJson(config) !== canonicalJson(header.bench) ||
    canonicalJson(config) !== canonicalJson(manifest.suite.config) ||
    manifest.cost_usd !== cost ||
    report.suite_version !== header.suite_version ||
    report.results.some((result) => result.suite_version !== report.suite_version) ||
    header.map_sha !== manifest.maps?.[config.map]?.fingerprint
  )
    throw mismatched(path, "report, tape and manifest disagree");
  const { recorded_at: _recordedAt, manifest: _manifest, ...identity } = header;
  return {
    report,
    tape,
    path,
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

const usage =
  "Usage: merge_bench_recordings.mjs --json RUN.json --record RUN.json.gz [--suite ROUTES.json] [--dry-run] PART.json PART.json [...]";

function merge(paths, reportPath, recordingPath, suitePath, dryRun) {
  if (!reportPath?.endsWith(".json") || !recordingPath?.endsWith(".json.gz") || paths.length < 2)
    throw new Error(usage);
  if ([reportPath, recordingPath].some((path) => lstatSync(path, { throwIfNoEntry: false })))
    throw new Error("The merged output files must be new.");
  checkFiles(
    Object.fromEntries(
      [...paths.flatMap((path) => [path, `${path}.gz`]), ...(suitePath ? [suitePath] : [])].map((path, index) => [
        `input ${index + 1}`,
        path,
      ]),
    ),
    { json: reportPath, record: recordingPath },
  );
  const parts = paths.map(readPart);
  const first = parts[0];
  const { config } = first.report;
  const reference = suitePath ? readArtifactJson(suitePath) : null;
  if (
    suitePath &&
    (!Array.isArray(reference) || reference.some((scenario) => !isRecord(scenario) || !isId(scenario.id)))
  )
    throw new Error("--suite must name a regenerated scenario array with drive IDs.");
  const routeSha = reference ? benchRouteFingerprint(reference) : first.report.manifest.suite.route_sha;
  if (!routeSha) throw new Error("These parts need --suite with the regenerated seeded scenarios.");
  const ids = reference ? reference.map((scenario) => scenario.id) : first.report.manifest.suite.generated_ids;
  if (!Array.isArray(ids) || !ids.length || !ids.every(isId) || new Set(ids).size !== ids.length)
    throw new Error("These parts need a generated drive list or --suite with regenerated scenarios.");
  const results = new Map();
  const merged = new ModelRecording({ header: { ...first.tape.header } });
  for (const part of parts) {
    const { report, tape } = part;
    if (part.identity !== first.identity)
      throw mismatched(part.path, "the parts must share source, engine, driver, map and suite");
    const partSha = report.manifest.suite.route_sha;
    if (partSha ? partSha !== routeSha : !reference)
      throw mismatched(part.path, "a part generated a different seeded suite");
    const generatedIds = report.manifest.suite.generated_ids;
    if (generatedIds && canonicalJson(generatedIds) !== canonicalJson(ids))
      throw mismatched(part.path, "a part generated a different drive list");
    const partIds = report.results.map((result) => result.id);
    if (
      canonicalJson(partIds) !== canonicalJson(report.manifest.suite.ids) ||
      [tape.results, tape.drives, tape.scenarios].some((entries) => Object.keys(entries).length !== partIds.length)
    )
      throw mismatched(part.path, "the report, tape and selected drives disagree");
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
  let suite_version = first.report.suite_version;
  if (suiteVersion(first.tape.header) !== LEGACY_SUITE) {
    suite_version = benchSuiteVersion({ ...manifest.suite, map_sha: merged.header.map_sha }, ordered);
    setRecordingSuiteVersion(merged, suite_version);
    for (const result of ordered) result.suite_version = suite_version;
  }
  merged.header.recorded_at = parts
    .map(({ tape }) => tape.header.recorded_at)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(0);
  const saved_at = parts
    .map(({ report }) => report.saved_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
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
  if (dryRun) {
    console.log(
      JSON.stringify({ report: reportPath, recording: recordingPath, ids, suite_version, cost_usd: summary.cost_usd }),
    );
    return;
  }
  writePair([
    [recordingPath, artifactBytes(recordingPath, merged.serialize(), MAX_RECORDING_BYTES)],
    [reportPath, artifactBytes(reportPath, `${JSON.stringify(output, null, 1)}\n`)],
  ]);
  console.log(`Merged ${ids.length} drives from ${parts.length} parts.`);
}

try {
  const { values, positionals, tokens } = parseArgs({
    options: {
      json: { type: "string" },
      record: { type: "string" },
      suite: { type: "string" },
      help: { type: "boolean", short: "h" },
      "dry-run": { type: "boolean" },
    },
    allowPositionals: true,
    tokens: true,
  });
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new Error(`Specify --${token.name} only once.`);
    seen.add(token.name);
  }
  if (values.help) console.log(usage);
  else merge(positionals, values.json, values.record, values.suite, values["dry-run"]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
