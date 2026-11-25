// Submission files contain recorded data only. Replay never loads a submitted agent module.
import { canonicalJson, RECORDING_FORMAT } from "../static/js/brain/recording.js";
import { jsonDifferences } from "./cli_tools.mjs";
import { isArenaSet, isFingerprint, isId, isRecord, isTrack } from "./recording_artifacts.mjs";
import { parseArenaTape } from "./arena_tape.mjs";
import { runCost } from "./run_manifest.mjs";
import { LOCAL_RECORDING_FORMAT } from "./local_recording.mjs";

export const SUBMISSION_FORMAT = "jev-submission/1";
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const keys = (value) => Object.keys(value ?? {}).sort();

export function readSubmission(bundle) {
  if (bundle?.format !== SUBMISSION_FORMAT) throw new Error(`Expected ${SUBMISSION_FORMAT}.`);
  const { recording, report } = bundle;
  if (![RECORDING_FORMAT, LOCAL_RECORDING_FORMAT].includes(recording?.format) || !recording.header?.arena)
    throw new Error("The submission needs an arena recording.");
  if (report?.manifest?.format !== "jev-run-manifest/2" || !same(report.manifest, recording.header.manifest))
    throw new Error("The report and recording must include the same v2 run manifest.");
  if (!Array.isArray(report.results) || !report.results.length) throw new Error("The report has no drives.");
  if (report.results.some((drive) => !isId(drive?.challenge)))
    throw new Error("Every report drive needs a challenge ID.");
  if (report.results.some((drive) => typeof drive.pass !== "boolean"))
    throw new Error("Every report drive needs a boolean verdict.");
  const reported = report.results.map((drive) => drive.challenge).sort();
  const declared = recording.header.arena.ids;
  if (new Set(reported).size !== reported.length) throw new Error("The report repeats a challenge ID.");
  if (!Array.isArray(declared) || !same([...declared].sort(), reported))
    throw new Error("The report must cover the challenge IDs declared by the recording.");
  return bundle;
}

// Compare the common published fields without requiring legacy exports to expose every tape metric.
export function verifyPublishedRows(report, recording, comparableResult) {
  for (const drive of report.results) {
    const id = drive.challenge;
    const recorded = recording.results?.[id];
    if (!Object.hasOwn(recording.results ?? {}, id) || recorded?.pass !== drive.pass)
      throw new Error(`The published report verdict for ${id} differs from the recording.`);
    const saved = comparableResult(recorded);
    for (const [field, value] of Object.entries(comparableResult(drive))) {
      if (!Object.hasOwn(saved, field))
        throw new Error(`The published report field ${id}.${field} is missing from the recording.`);
      if (!same(saved[field], value))
        throw new Error(`The published report field ${id}.${field} differs from the recording.`);
    }
  }
}

export function preflightSubmission(bundle) {
  const { recording, report } = bundle;
  const tape = parseArenaTape(recording);
  const { header, results } = tape;
  const { manifest, summary } = report;
  if (report.stopped) throw new Error("The submitted Arena run was stopped.");
  if (!isArenaSet(manifest.suite?.set) || manifest.suite.kind !== "arena" || manifest.suite.set !== header.arena.set)
    throw new Error("The manifest and recording must agree on the Arena set.");
  if (manifest.driver !== header.driver) throw new Error("The manifest and recording drivers disagree.");
  if ((manifest.model ?? null) !== (header.model ?? null))
    throw new Error("The manifest and recording models disagree.");
  if (manifest.engine !== header.engine) throw new Error("The manifest and recording engines disagree.");
  if (!isTrack(manifest.track) || manifest.track !== (header.arena.track ?? "guarded"))
    throw new Error("The manifest and recording tracks disagree.");
  if (report.suite_version !== manifest.suite_version ||
    header.suite_version !== manifest.suite_version ||
    report.results.some((drive) => drive.suite_version !== manifest.suite_version) ||
    Object.values(results).some((drive) => drive.suite_version !== manifest.suite_version))
    throw new Error("The submission disagrees on its suite version.");
  if (!isRecord(manifest.suite.drives) || !same(keys(manifest.suite.drives), keys(results)))
    throw new Error("The manifest's authored drives differ from the finished recording.");
  if (!isRecord(manifest.maps) || !same(keys(manifest.maps), keys(header.maps)))
    throw new Error("The manifest's map list differs from the recording.");
  for (const [map, entry] of Object.entries(manifest.maps)) {
    if (!isFingerprint(entry?.fingerprint) || entry.fingerprint !== header.maps[map])
      throw new Error(`Map ${map} has a different fingerprint in the manifest and tape.`);
  }
  for (const drive of report.results) {
    const id = drive.challenge;
    const recorded = results[id];
    const authored = manifest.suite.drives[id];
    if (drive.stopped || recorded.stopped || drive.simulation_error || recorded.simulation_error)
      throw new Error(`Drive ${id} stopped or encountered a simulation error.`);
    if (!isRecord(authored) || !Object.hasOwn(manifest.maps, authored.map) ||
      drive.map !== authored.map || recorded.map !== authored.map)
      throw new Error(`Drive ${id} disagrees with its authored map.`);
    if (!Number.isSafeInteger(authored.seed) || drive.seed !== authored.seed || recorded.seed !== authored.seed)
      throw new Error(`Drive ${id} disagrees with its authored seed.`);
    if (drive.version !== authored.version || recorded.version !== authored.version)
      throw new Error(`Drive ${id} disagrees with its authored version.`);
    if ((drive.track ?? "guarded") !== manifest.track) throw new Error(`Drive ${id} disagrees with its report track.`);
    if (recorded.mode !== "lockstep") throw new Error(`Drive ${id} must have been recorded in lockstep.`);
    if (!isFingerprint(recorded.result_sha)) throw new Error(`Drive ${id} is missing a valid result fingerprint.`);
    if (!Array.isArray(drive.failures) || drive.failures.some((reason) => !isId(reason)))
      throw new Error(`Drive ${id} needs a list of failure reasons.`);
    if (drive.pass !== (drive.failures.length === 0)) throw new Error(`Drive ${id} has an inconsistent verdict.`);
    for (const share of ["model_share", "local_share", "fallback_share"]) {
      const value = drive[share];
      if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0 || value > 1))
        throw new Error(`Drive ${id} has an invalid ${share}.`);
    }
  }
  if (!isRecord(summary) || summary.brain !== manifest.driver || summary.set !== manifest.suite.set ||
    summary.engine !== manifest.engine || (summary.track ?? "guarded") !== manifest.track)
    throw new Error("The report summary disagrees with its run manifest.");
  if (summary.drives !== report.results.length) throw new Error("The summary has the wrong drive count.");
  if (summary.passed !== report.results.filter((drive) => drive.pass).length)
    throw new Error("The summary has the wrong pass count.");
  if (manifest.track === "open" &&
    summary.flagged_choices !== report.results.reduce((sum, drive) => sum + (drive.flagged_choices ?? 0), 0))
    throw new Error("The summary has the wrong flagged choice count.");
  if (summary.cost_usd !== manifest.cost_usd ||
    runCost(report.results) !== manifest.cost_usd || runCost(Object.values(results)) !== manifest.cost_usd)
    throw new Error("The reported costs disagree with the manifest.");
  return tape;
}

export function verifySubmissionManifest(recording, current, ids) {
  const { header, results, drives } = recording;
  const { cost_usd, suite_version, ...provenance } = header.manifest ?? {};
  const { cost_usd: _cost, suite_version: _version, ...actual } = current;
  if (!actual.source_commit || actual.source_dirty || provenance.source_dirty !== false)
    throw new Error("Run submission verification in a clean checkout and submit a run made on a clean checkout.");
  if (provenance.source_commit !== actual.source_commit) throw new Error("Check out the recording's source commit.");
  if (provenance.engine !== actual.engine || provenance.engine_version !== actual.engine_version)
    throw new Error("Use the Node and V8 versions in the recording's manifest.");
  if (provenance.prompt_hash !== actual.prompt_hash) throw new Error("The prompt hash differs from the current tree.");
  if (provenance.driver !== actual.driver) throw new Error("The recording driver differs from the selected driver.");
  if (provenance.model !== actual.model) throw new Error("The recording model differs from the selected model.");
  if (provenance.track !== actual.track) throw new Error("The recording track differs from the selected track.");
  if (!same(provenance, actual) || header.engine !== actual.engine)
    throw new Error("The manifest differs from the recording or checkout.");
  const mapFingerprints = Object.fromEntries(Object.entries(current.maps).map(([id, map]) => [id, map.fingerprint]));
  if (!same(header.maps, mapFingerprints))
    throw new Error("The recording's map fingerprints differ from the checkout.");
  if (header.suite_version !== suite_version)
    throw new Error("The recording and manifest disagree on the suite version.");
  if (!Number.isFinite(cost_usd) || cost_usd < 0) throw new Error("The manifest must declare a nonnegative cost.");
  const sorted = [...ids].sort();
  const declared = header.arena.ids;
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    !Array.isArray(declared) ||
    !same([...declared].sort(), sorted) ||
    !same(keys(results), sorted) ||
    !same(keys(drives), sorted)
  )
    throw new Error("The submission must contain every declared drive and only those drives.");
  if (Object.values(results).some((result) => result?.stopped || result?.simulation_error))
    throw new Error("The submission includes a stopped drive or simulation error.");
  if (Object.entries(results).some(([id, result]) => result?.challenge !== id))
    throw new Error("A recording result does not identify its declared drive.");
}

export function verifySubmissionReport(submitted, replayed) {
  if (same(submitted, replayed)) return;
  const { results: submittedDrives, ...submittedMeta } = submitted ?? {};
  const { results: replayedDrives, ...replayedMeta } = replayed ?? {};
  const limit = 12;
  const details = [];
  if (Array.isArray(submittedDrives) && Array.isArray(replayedDrives)) {
    const driveKeys = (rows) => rows.map((drive, i) => [drive?.map, drive?.challenge ?? drive?.id ?? i]);
    const submittedKeys = driveKeys(submittedDrives);
    const replayedKeys = driveKeys(replayedDrives);
    if (!same(submittedKeys, replayedKeys)) {
      details.push(...jsonDifferences(submittedKeys, replayedKeys, canonicalJson, { limit, path: "drive order" }));
    } else {
      for (const [i, drive] of submittedDrives.entries()) {
        const remaining = limit - details.length;
        if (!remaining) break;
        const [map, id] = submittedKeys[i];
        const path = `drive ${map ? `${map}/` : ""}${id}`;
        details.push(...jsonDifferences(drive, replayedDrives[i], canonicalJson, { limit: remaining, path }));
      }
    }
  } else {
    details.push(...jsonDifferences(submittedDrives, replayedDrives, canonicalJson, { limit, path: "results" }));
  }
  details.push(...jsonDifferences(submittedMeta, replayedMeta, canonicalJson, { limit: limit - details.length }));
  const suffix = details.length ? `: ${details.join("; ")}` : "";
  throw new Error(`The submitted report differs from the replayed report${suffix}.`);
}
