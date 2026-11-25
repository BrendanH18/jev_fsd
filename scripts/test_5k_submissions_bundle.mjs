import assert from "node:assert/strict";
import { comparableResult } from "../static/js/brain/recording.js";
import {
  preflightSubmission,
  readSubmission,
  SUBMISSION_FORMAT,
  verifyPublishedRows,
  verifySubmissionManifest,
  verifySubmissionReport,
} from "./submission_bundle.mjs";

const id = "door-zone";
const fingerprint = "0123456789abcdef";
const arena = { set: "challenges", ids: [id], track: "open" };
const row = {
  challenge: id,
  map: "kitsilano",
  seed: 17,
  version: 2,
  pass: true,
  track: "open",
  suite_version: "custom",
  failures: [],
  flagged_choices: 0,
  cost_usd: 0.1,
  model_share: 0.3,
};
const manifest = {
  format: "jev-run-manifest/2",
  source_commit: "f".repeat(40),
  source_dirty: false,
  engine: "node v22",
  engine_version: "12",
  driver: "outside",
  model: null,
  track: "open",
  suite_version: "custom",
  prompt_hash: "questions",
  cost_usd: 0.1,
  suite: { kind: "arena", set: arena.set, drives: { [id]: { map: row.map, seed: row.seed, version: row.version } } },
  maps: { [row.map]: { fingerprint } },
};
const create = () => {
  const report = {
    manifest: structuredClone(manifest),
    suite_version: "custom",
    summary: {
      brain: "outside",
      set: arena.set,
      engine: "node v22",
      track: "open",
      drives: 1,
      passed: 1,
      flagged_choices: 0,
      cost_usd: 0.1,
    },
    results: [structuredClone(row)],
  };
  const recording = {
    format: "jev-local-recording/1",
    header: {
      driver: manifest.driver,
      model: null,
      engine: manifest.engine,
      manifest: report.manifest,
      arena: structuredClone(arena),
      suite_version: "custom",
      maps: { [row.map]: fingerprint },
      behaviors: { [id]: { questionDriven: false, timeoutMs: null } },
    },
    drives: { [id]: {} },
    results: { [id]: { ...structuredClone(row), mode: "lockstep", result_sha: fingerprint } },
  };
  return { format: SUBMISSION_FORMAT, recording, report };
};

let bundle = create();
assert.equal(preflightSubmission(readSubmission(bundle)).header.driver, "outside");
verifyPublishedRows(bundle.report, bundle.recording, comparableResult);

for (const [change, diagnostic] of [
  [
    (b) => {
      b.report.stopped = "budget";
    },
    /Arena run was stopped/,
  ],
  [
    (b) => {
      b.report.manifest.suite.set = "all";
    },
    /agree on the Arena set/,
  ],
  [
    (b) => {
      b.report.manifest.driver = "other";
    },
    /recording drivers/,
  ],
  [
    (b) => {
      b.report.manifest.model = "other";
    },
    /recording models/,
  ],
  [
    (b) => {
      b.report.manifest.engine = "other";
    },
    /recording engines/,
  ],
  [
    (b) => {
      b.report.manifest.track = "guarded";
    },
    /recording tracks/,
  ],
  [
    (b) => {
      b.report.suite_version = "v1";
    },
    /suite version/,
  ],
  [
    (b) => {
      b.report.manifest.suite.drives = {};
    },
    /authored drives differ/,
  ],
  [
    (b) => {
      b.report.manifest.maps = {};
    },
    /map list differs/,
  ],
  [
    (b) => {
      b.report.manifest.maps.kitsilano.fingerprint = "different";
    },
    /different fingerprint/,
  ],
  [
    (b) => {
      b.report.results[0].stopped = true;
    },
    /stopped or encountered a simulation error/,
  ],
  [
    (b) => {
      b.recording.results[id].simulation_error = "error";
    },
    /stopped or encountered a simulation error/,
  ],
  [
    (b) => {
      b.report.results[0].map = "other";
    },
    /authored map/,
  ],
  [
    (b) => {
      b.report.results[0].seed++;
    },
    /authored seed/,
  ],
  [
    (b) => {
      b.report.results[0].version++;
    },
    /authored version/,
  ],
  [
    (b) => {
      b.report.results[0].track = "guarded";
    },
    /report track/,
  ],
  [
    (b) => {
      b.recording.results[id].mode = "realtime";
    },
    /recorded in lockstep/,
  ],
  [
    (b) => {
      delete b.recording.results[id].result_sha;
    },
    /result fingerprint/,
  ],
  [
    (b) => {
      b.report.results[0].failures = "timeout";
    },
    /list of failure reasons/,
  ],
  [
    (b) => {
      b.report.results[0].failures = ["time limit"];
    },
    /inconsistent verdict/,
  ],
  [
    (b) => {
      b.report.results[0].model_share = 2;
    },
    /invalid model_share/,
  ],
  [
    (b) => {
      b.report.results[0].fallback_share = "0";
    },
    /invalid fallback_share/,
  ],
  [
    (b) => {
      b.report.summary.set = "all";
    },
    /summary disagrees/,
  ],
  [
    (b) => {
      b.report.summary.drives = 2;
    },
    /wrong drive count/,
  ],
  [
    (b) => {
      b.report.summary.passed = 0;
    },
    /wrong pass count/,
  ],
  [
    (b) => {
      b.report.summary.flagged_choices = 1;
    },
    /wrong flagged choice count/,
  ],
  [
    (b) => {
      b.recording.results[id].cost_usd = 1;
    },
    /costs disagree/,
  ],
]) {
  const candidate = create();
  change(candidate);
  assert.throws(() => preflightSubmission(readSubmission(candidate)), diagnostic);
}

bundle = create();
bundle.report.results[0].new_field = 7;
assert.throws(() => verifyPublishedRows(bundle.report, bundle.recording, comparableResult), /new_field is missing/);
bundle.report.results[0].challenge = " door-zone";
assert.throws(() => readSubmission(bundle), /challenge ID/);
bundle = create();
bundle.report.results[0].wall_ms = 1234;
verifyPublishedRows(bundle.report, bundle.recording, comparableResult);
bundle.recording.results[id].future_tape_only_metric = 3;
verifyPublishedRows(bundle.report, bundle.recording, comparableResult);
bundle.recording.results[id].pass = false;
assert.throws(() => verifyPublishedRows(bundle.report, bundle.recording, comparableResult), /verdict for door-zone/);
verifySubmissionReport(bundle.report, structuredClone(bundle.report));
assert.throws(
  () => verifySubmissionReport({ ...bundle.report, summary: { ...bundle.report.summary, passed: 2 } }, bundle.report),
  /summary\.passed: expected 2, actual 1/,
);
const differences = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`change-${index}`, 0]));
try {
  verifySubmissionReport({ ...bundle.report, ...differences }, bundle.report);
  assert.fail("expected report mismatch");
} catch (error) {
  assert.equal((error.message.match(/actual <missing>/g) ?? []).length, 12);
}
bundle = create();
const tape = preflightSubmission(readSubmission(bundle));
const current = { ...manifest, cost_usd: 0 };
verifySubmissionManifest(tape, current, [id]);
for (const [change, diagnostic] of [
  [{ driver: "other" }, /driver differs/],
  [{ model: "other" }, /model differs/],
  [{ track: "guarded" }, /track differs/],
]) {
  assert.throws(() => verifySubmissionManifest(tape, { ...current, ...change }, [id]), diagnostic);
}
console.log("Submission preflight, attribution and report differences passed.");
