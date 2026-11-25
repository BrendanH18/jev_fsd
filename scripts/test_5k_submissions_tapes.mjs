import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { DriveTape, ModelRecording, canonicalJson, requestKey, sameResult } from "../static/js/brain/recording.js";
import { parseArenaTape, tapeCounts } from "./arena_tape.mjs";
import { LocalRecording, checkedLocalDefinition } from "./local_recording.mjs";
import {
  parseArtifactJson,
  readArtifactBytes,
  readArtifactJson,
  readRecordingJson,
  writeJsonArtifact,
  writeNewJson,
} from "./recording_artifacts.mjs";

const model = { driver: "jev" };
const arena = { set: "all", ids: ["a", "b"] };
const makeModel = () =>
  new ModelRecording({
    header: { ...model, kind: "jev", arena, maps: { kit: "fingerprint" } },
    drives: { a: {}, b: {} },
    results: { a: { challenge: "a", map: "kit", pass: true }, b: { challenge: "b", map: "kit", pass: false } },
  }).toJSON();

for (const [change, diagnostic] of [
  [
    (r) => {
      r.header.kind = "llm";
    },
    /driver and kind/,
  ],
  [
    (r) => {
      r.header.endpoint = [];
    },
    /endpoint must be an object/,
  ],
  [
    (r) => {
      r.header.endpoint = { id: "another" };
    },
    /endpoint and driver/,
  ],
  [
    (r) => {
      r.drives[""] = {};
    },
    /empty drive ID/,
  ],
  [
    (r) => {
      r.drives.a[" "] = [{ response: 1 }];
    },
    /empty request key/,
  ],
  [
    (r) => {
      r.drives.a.key = [];
    },
    /nonempty answer list/,
  ],
  [
    (r) => {
      r.drives.a.key = [{ timeout: true, raw_response: true }];
    },
    /invalid outcome/,
  ],
  [
    (r) => {
      r.header.arena = { ...arena, set: "invalid" };
    },
    /unknown Arena set/,
  ],
  [
    (r) => {
      r.header.arena = { ...arena, track: "invalid" };
    },
    /unknown Arena track/,
  ],
  [
    (r) => {
      r.header.arena = { ...arena, ids: ["a", "a"] };
    },
    /distinct Arena drive IDs/,
  ],
  [
    (r) => {
      r.header.maps = [];
    },
    /map fingerprint table/,
  ],
  [
    (r) => {
      r.results = {};
    },
    /no finished drives/,
  ],
  [
    (r) => {
      r.results.c = { challenge: "c", pass: true };
    },
    /outside.*drive plan/,
  ],
  [
    (r) => {
      r.results.a.challenge = "b";
    },
    /different challenge/,
  ],
  [
    (r) => {
      r.results.a.pass = 0;
    },
    /boolean verdict/,
  ],
  [
    (r) => {
      delete r.drives.a;
    },
    /no decision tape/,
  ],
  [
    (r) => {
      r.results.a.map = "missing";
    },
    /unrecorded map/,
  ],
  [
    (r) => {
      r.results.a.track = "open";
    },
    /different track/,
  ],
  [
    (r) => {
      r.drives.c = {};
    },
    /has no result/,
  ],
  [
    (r) => {
      r.scenarios.c = {};
    },
    /seeded benchmark scenarios/,
  ],
]) {
  const recording = makeModel();
  change(recording);
  assert.throws(() => parseArenaTape(recording), diagnostic);
}
const partial = makeModel();
delete partial.results.b;
delete partial.drives.b;
assert.equal(parseArenaTape(partial).header.arena.ids.length, 2);
assert.equal(tapeCounts(parseArenaTape(partial)).drives, 1);
const counts = makeModel();
counts.drives.a.key = [{ response: null }, { timeout: true }, { cancelled: true }, { error: { message: "failed" } }];
const tally = tapeCounts(parseArenaTape(counts));
for (const field of ["requests", "responses", "timeouts", "cancellations", "errors"]) assert.equal(tally[field], 1);
assert.equal(tally.answers, 4);

const request = { tick: 4, epoch: 1, state: { lane: 2 }, messages: [] };
const modelRecording = new ModelRecording({ header: model });
const recording = modelRecording.tape("test", "record");
const autopilot = { epoch: 1 };
const path = "/api/decide";
const key = requestKey(model, path, request);
const response = {
  trace: { request: { state: "$body" }, meta: "$meta", anthropic_prompt: ["messages"] },
  meta: { model: "stub" },
};
await recording.record(autopilot, async () => response, path, request);
assert.equal(modelRecording.drives.test[key][0].raw_response, true);
const firstReplay = ModelRecording.parse(modelRecording.serialize()).tape("test", "replay");
const firstAnswer = await firstReplay.replay(autopilot, path, { ...request, tick: 6 });
assert.equal(firstAnswer.tick, 6);
assert.equal(firstAnswer.trace.request.state, "$body");
assert.equal(firstAnswer.trace.meta, "$meta");
assert.equal(firstAnswer.trace.anthropic_prompt[0], "messages");
assert.equal(firstReplay.exact, true);
// A reply whose echo did not match its request (refused when recorded) replays with the same echo.
const echoed = new ModelRecording({ header: model });
await echoed.tape("echo", "record").record(autopilot, async () => ({ tick: 5, epoch: 1, answers: {} }), path, request);
assert.equal(echoed.drives.echo[key][0].raw_response, true);
const echoReplay = await ModelRecording.parse(echoed.serialize()).tape("echo", "replay").replay(autopilot, path, request);
assert.equal(echoReplay.tick, 5);
assert.equal(echoReplay.epoch, 1);
const matched = new ModelRecording({ header: model });
await matched.tape("echo", "record").record(autopilot, async () => ({ tick: 4, epoch: 1, answers: {} }), path, request);
assert.equal(Object.hasOwn(matched.drives.echo[key][0], "raw_response"), false);
assert.throws(() => modelRecording.tape("", "replay"), /drive ID/);
assert.throws(() => modelRecording.tape("test", "other"), /tape mode/);
assert.equal(modelRecording.tape("constructor", "replay").exact, false);
assert.equal(recording.remainingAnswers(), null);

const twice = new ModelRecording({ header: model, drives: { attempt: { [key]: [{ response: 1 }, { response: 2 }] } } });
const queue = twice.tape("attempt", "replay");
assert.equal(await queue.replay(autopilot, path, request), 1);
assert.equal(await queue.replay(autopilot, path, request), 2);
await assert.rejects(queue.replay(autopilot, path, request), /asked 3 times, recorded 2/);
assert.equal(twice.tape("attempt", "replay").remainingAnswers()[key], 2);
assert.equal(await twice.tape("attempt", "replay").replay(autopilot, path, request), 1);
const inherited = new DriveTape(
  { header: model, drives: Object.create({ attempt: { [key]: [{ response: "inherited" }] } }) },
  "attempt",
  "replay",
);
await assert.rejects(inherited.replay(autopilot, path, request), /not in recording/);

const freshLocal = () => ({
  format: "jev-local-recording/1",
  header: { driver: "custom-driver", behaviors: { a: { questionDriven: false, timeoutMs: null } } },
  drives: { a: { key: [{ response: { answer: null } }] } },
  results: { a: { challenge: "a" } },
});
for (const [change, diagnostic] of [
  [
    (r) => {
      r.format = "other";
    },
    /jev-local-recording/,
  ],
  [
    (r) => {
      r.header = null;
    },
    /header, results and driver behavior/,
  ],
  [
    (r) => {
      r.header.driver = "rules";
    },
    /reserved/,
  ],
  [
    (r) => {
      r.results = [];
    },
    /results and driver behavior/,
  ],
  [
    (r) => {
      r.drives.a.key = false;
    },
    /answer list/,
  ],
  [
    (r) => {
      r.header.behaviors.a = null;
    },
    /questionDriven/,
  ],
  [
    (r) => {
      r.header.behaviors.a.timeoutMs = 0;
    },
    /timeoutMs/,
  ],
  [
    (r) => {
      r.header.behaviors.a.timeoutMs = 2 ** 31;
    },
    /timeoutMs/,
  ],
  [
    (r) => {
      r.drives.a.key[0].response = null;
    },
    /answer or a failure/,
  ],
  [
    (r) => {
      r.drives.a.key[0].response.failure = {};
    },
    /answer or a failure/,
  ],
  [
    (r) => {
      r.drives.a.key[0].response = { failure: {} };
    },
    /without a message/,
  ],
  [
    (r) => {
      r.header.behaviors.b = r.header.behaviors.a;
    },
    /without a tape/,
  ],
  [
    (r) => {
      r.results.a = "bad";
    },
    /invalid result/,
  ],
]) {
  const raw = freshLocal();
  change(raw);
  assert.throws(() => LocalRecording.parse(raw), diagnostic);
}
const local = LocalRecording.parse(freshLocal());
assert.equal(local.tape("a", "replay").remainingAnswers().key, 1);
assert.throws(() => local.tape("a", "invalid"), /Unknown tape mode/);
assert.throws(() => local.tape("missing", "replay").brainFor(autopilot, "custom-driver"), /lacks behavior metadata/);
assert.throws(() => local.tape("a", "replay").brainFor(autopilot, "other"), /recording is for custom-driver/);
assert.throws(() => local.tape("empty", "record").brainFor(autopilot, "custom-driver"), /no decide/);
delete local.drives.empty;
const error = new Error("circular");
error.meta = { self: error };
const localRecord = local.tape("broken", "record").brainFor(autopilot, "custom-driver", {
  async decide() {
    throw error;
  },
});
await assert.rejects(localRecord.decide({}, [], request, undefined), { message: "circular", name: "Error" });
const savedLocal = LocalRecording.parse(JSON.parse(local.serialize()));
assert.equal(tapeCounts(savedLocal).driver_failures, 1);
assert.equal(tapeCounts(savedLocal).responses, 1);
const localReplay = savedLocal.tape("broken", "replay").brainFor(autopilot, "custom-driver");
await assert.rejects(localReplay.decide({}, [], request, undefined), { message: "circular", name: "Error" });

const good = { id: "driver", label: "Driver", create: () => ({ decide() {} }) };
assert.equal(typeof checkedLocalDefinition(good).create().decide, "function");
for (const [definition, diagnostic] of [
  [undefined, /default export/],
  [{ ...good, id: "decision:external" }, /local driver id/],
  [{ ...good, label: " " }, /label/],
  [{ ...good, create: "drive" }, /factory/],
  [{ ...good, create: () => Promise.resolve({ decide() {} }) }, /object with decide/],
  [{ ...good, create: () => ({ decide() {}, questionDriven: "yes" }) }, /must be boolean/],
  [{ ...good, create: () => ({ decide() {}, timeoutMs: Infinity }) }, /supported duration/],
]) {
  assert.throws(() => checkedLocalDefinition(definition).create(), diagnostic);
}

const dir = mkdtempSync(join(tmpdir(), "jev-tape-"));
try {
  const raw = join(dir, "tape.json");
  const compressed = join(dir, "tape.json.gz");
  writeFileSync(raw, '{"x":1}');
  assert.equal(readArtifactBytes(raw, 7).length, 7);
  assert.throws(() => readArtifactBytes(raw, 6), /exceeds 6 bytes/);
  assert.throws(() => readArtifactBytes(dir), /regular file/);
  assert.throws(() => readArtifactBytes(join(dir, "missing")), /missing/);
  const invalidUtf8 = Buffer.from([0xff]);
  assert.throws(() => parseArtifactJson(raw, invalidUtf8), /utf-8/i);
  assert.throws(() => parseArtifactJson(compressed, gzipSync(Buffer.alloc(32)), 8), /8/);
  assert.equal(parseArtifactJson(raw, Buffer.from('\uFEFF{"x":1}')).x, 1);
  writeNewJson(compressed, { x: 2 });
  assert.equal(readArtifactJson(compressed).x, 2);
  assert.throws(() => writeNewJson(compressed, { x: 0 }), /EEXIST/);
  writeJsonArtifact(compressed, '{"x":3}');
  assert.equal(readArtifactJson(compressed).x, 3);
  assert.equal(readdirSync(dir).length, 2);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const customJson = { a: "ignored", toJSON: () => ({ z: 2, a: 1 }) };
assert.equal(canonicalJson(customJson), '{"a":1,"z":2}');
assert.equal(canonicalJson({ z: undefined, b: 2, a: 1 }), '{"a":1,"b":2}');
assert.equal(sameResult({ pass: true, wall_ms: 1 }, { wall_ms: 2, pass: true }), true);
assert.equal(sameResult({ pass: true }, { pass: false }), false);
// Existing artifacts can remain on historical source revisions, but their encodings must still parse.
const savedTapes = new URL("../data/recordings/", import.meta.url);
for (const name of readdirSync(savedTapes)) {
  if (!/\.json(?:\.gz)?$/.test(name)) continue;
  const artifact = readRecordingJson(new URL(name, savedTapes).pathname);
  const tape = artifact.header.arena ? parseArenaTape(artifact) : ModelRecording.parse(artifact);
  assert.ok(Object.keys(tape.results).length > 0, name);
}
console.log("Model and local tapes validate, preserve outcomes and read bounded artifacts.");
