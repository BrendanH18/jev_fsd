import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LocalRecording } from "./local_recording.mjs";
import {
  readSubmission,
  SUBMISSION_FORMAT,
  verifySubmissionManifest,
  verifySubmissionReport,
} from "./submission_bundle.mjs";

const id = "right-on-red";
const manifest = {
  format: "jev-run-manifest/2",
  suite_version: "custom",
  source_commit: "1234",
  source_dirty: false,
  engine: "node v22",
  engine_version: "12",
  driver: "outside-driver",
  model: null,
  prompt_hash: "questions",
  track: "open",
  suite: { kind: "arena" },
  maps: { kitsilano: { fingerprint: "kit" } },
  cost_usd: 0.02,
};
const recording = new LocalRecording({
  header: {
    driver: manifest.driver,
    engine: manifest.engine,
    suite_version: manifest.suite_version,
    manifest,
    arena: { set: "challenges", ids: [id], track: "open" },
    maps: { kitsilano: "kit" },
  },
  results: { [id]: { challenge: id, pass: false, model_share: 0.5, cost_usd: 0.02 } },
});
const options = [{ id: "hold" }, { id: "drive" }];
const request = { epoch: 1, questions: {}, state: { target_speed: 0 }, track: "open" };
const autopilot = { epoch: 1 };
const signal = new AbortController().signal;
const answer = { motion: "stop", candidateId: "hold", meta: { cost_usd: 0.02 } };
const failure = Object.assign(new Error("bad answer"), { meta: { live_call: true, cost_usd: 0.01 } });
let calls = 0;
const recorder = recording.tape(id, "record").brainFor(autopilot, manifest.driver, {
  questionDriven: true,
  timeoutMs: 60,
  async decide() {
    if (calls++ === 0) return answer;
    throw failure;
  },
});
assert.deepEqual(await recorder.decide({}, options, request, signal), answer);
await assert.rejects(recorder.decide({}, options, request, signal), { message: failure.message, meta: failure.meta });

const replayRecording = new LocalRecording(JSON.parse(recording.serialize()));
const tape = replayRecording.tape(id, "replay");
const driver = tape.brainFor(autopilot, manifest.driver, null);
assert.equal(driver.questionDriven, true);
assert.equal(driver.timeoutMs, 60);
assert.deepEqual(await driver.decide({}, options, request, signal), answer);
await assert.rejects(driver.decide({}, options, request, signal), { message: failure.message, meta: failure.meta });
assert.equal(tape.exact, true);
assert.equal(calls, 2);
await assert.rejects(driver.decide({}, options, { ...request, track: "guarded" }, signal), /not in recording/);
assert.equal(tape.exact, false);

const report = { manifest, results: Object.values(replayRecording.results) };
const bundle = { format: SUBMISSION_FORMAT, recording: replayRecording, report };
assert.equal(readSubmission(bundle), bundle);
const current = { ...manifest, cost_usd: 0 };
verifySubmissionManifest(replayRecording, current, [id]);
verifySubmissionReport(report, structuredClone(report));
assert.throws(() => readSubmission({ ...bundle, format: "future" }), /jev-submission/);
assert.throws(() => readSubmission({ ...bundle, report: { ...report, manifest: current } }), /same v2 run manifest/);
assert.throws(() => verifySubmissionManifest(replayRecording, { ...current, source_dirty: true }, [id]), /clean/);
assert.throws(() => verifySubmissionManifest(replayRecording, { ...current, source_commit: "bad" }, [id]), /commit/);
assert.throws(() => verifySubmissionManifest(replayRecording, { ...current, engine_version: "0" }, [id]), /V8/);
assert.throws(() => verifySubmissionManifest(replayRecording, { ...current, prompt_hash: "bad" }, [id]), /prompt/);
assert.throws(
  () => verifySubmissionManifest(replayRecording, { ...current, maps: { kitsilano: { fingerprint: "bad" } } }, [id]),
  /manifest differs/,
);
assert.throws(() => verifySubmissionManifest(replayRecording, current, [id, "flagger"]), /declared drive/);
const merged = {
  ...replayRecording,
  header: { ...replayRecording.header, arena: { set: "challenges", ids: ["flagger", id], track: "open" } },
  drives: { ...replayRecording.drives, flagger: {} },
  results: { ...replayRecording.results, flagger: { challenge: "flagger" } },
};
verifySubmissionManifest(merged, current, [id, "flagger"]);
merged.header.arena.ids.push(id);
assert.throws(() => verifySubmissionManifest(merged, current, [id, "flagger"]), /declared drive/);
for (const [field, forged] of [
  ["model_share", 1],
  ["pass", true],
  ["cost_usd", 0],
]) {
  const tampered = { ...report, results: [{ ...report.results[0], [field]: forged }] };
  assert.throws(() => verifySubmissionReport(tampered, report), /differs from the replayed report/);
}
const cli = fileURLToPath(new URL("./driver_submission.mjs", import.meta.url));
for (const out of [
  "pilot.json",
  "data/submissions/2026-02-30/pilot.json",
  "other/data/submissions/2026-11-23/pilot.json",
]) {
  const processResult = spawnSync(
    process.execPath,
    [
      "--experimental-default-type=module",
      cli,
      "publish",
      "--submitter",
      "outside-driver",
      "--bundle",
      "missing.json.gz",
      "--out",
      out,
    ],
    { encoding: "utf8" },
  );
  assert.equal(processResult.status, 1);
  assert.match(processResult.stderr, /under data\/submissions\/YYYY-MM-DD/);
}
console.log("Submission tapes verify local decisions, share and cost, and reject drift or tampered provenance.");
