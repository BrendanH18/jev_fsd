// Submission files contain recorded data only. Replay never loads a submitted agent module.
import { canonicalJson, RECORDING_FORMAT } from "../static/js/brain/recording.js";
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
  return bundle;
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
    !Array.isArray(declared) ||
    !same([...declared].sort(), sorted) ||
    !same(keys(results), sorted) ||
    !same(keys(drives), sorted)
  )
    throw new Error("The submission must contain every declared drive and only those drives.");
  if (Object.values(results).some((result) => result?.stopped || result?.simulation_error))
    throw new Error("The submission includes a stopped drive or simulation error.");
}

export function verifySubmissionReport(submitted, replayed) {
  if (!same(submitted, replayed)) throw new Error("The submitted report differs from the replayed report.");
}
