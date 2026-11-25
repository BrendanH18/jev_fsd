import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  ModelRecording,
  RECORDING_FORMAT,
  canonicalJson,
  checkMap,
  comparableResult,
  recordingHeader,
  requestKey,
} from "../static/js/brain/recording.js";

let checks = 0;
async function test(name, run) {
  await run();
  checks++;
  console.log(name);
}

const driver = "llm:tape-test";
const header = recordingHeader({ driver });
const document = (fields = {}) => ({ format: RECORDING_FORMAT, header, ...fields });
const newTape = () => new ModelRecording({ header });
const path = "/api/llm/decide";
const body = { tick: 1, epoch: 1, messages: [] };
const pilot = { epoch: 1 };
const valid = { answer: { motion: "drive" } };
const tapeWith = (outcomes) =>
  ModelRecording.parse(document({ drives: { d: { [requestKey(header, path, body)]: outcomes } } }));

await test("Canonical request JSON encodes holes as null without using a custom array iterator", () => {
  const value = [];
  value[1] = 3;
  value[Symbol.iterator] = function* () {
    yield 7;
  };
  assert.equal(canonicalJson(value), "[null,3]");
});
await test("Canonical request JSON omits symbol-valued object properties", () => {
  assert.equal(canonicalJson({ a: Symbol(), b: null }), '{"b":null}');
});
await test("Canonical request JSON encodes boxed JSON primitives by value", () => {
  const wrap = (value) => Object(value);
  assert.equal(canonicalJson([wrap(2), wrap("2"), wrap(false)]), '[2,"2",false]');
});
await test("Canonical request JSON evaluates each enumerable getter once", () => {
  let reads = 0;
  assert.equal(
    canonicalJson({
      get traffic() {
        return ++reads;
      },
    }),
    '{"traffic":1}',
  );
  assert.equal(reads, 1);
});
await test("A recording key distinguishes an identical body sent to another API path", () => {
  assert.notEqual(requestKey(header, path, body), requestKey(header, "/api/decision/decide", body));
});
await test("A recording key distinguishes identical requests made by different driver IDs", () => {
  assert.notEqual(requestKey(header, path, body), requestKey({ ...header, driver: "llm:another" }, path, body));
});
await test("Recording headers store public endpoint identifiers without provider connection details", () => {
  const endpoint = {
    id: driver,
    name: "tape-test",
    label: "Tape test",
    model: "model",
    timeout_s: 2,
    key: "secret",
    endpoint: "internal",
  };
  const saved = recordingHeader({ driver, brain: { endpoint } }).endpoint;
  assert.deepEqual(saved, { id: driver, name: "tape-test", label: "Tape test", model: "model", timeout_s: 2 });
});
await test("Map checks skip fingerprinting for older recordings without a map hash", () => {
  checkMap(
    { header: {} },
    {
      get pack() {
        return assert.fail("no map read expected");
      },
    },
  );
});
await test("A map mismatch fingerprints the loaded pack only once even when reporting its hash", () => {
  let reads = 0;
  assert.throws(
    () =>
      checkMap(
        { header: { map_sha: "other" } },
        {
          get pack() {
            reads++;
            return {};
          },
        },
      ),
    /other map data/,
  );
  assert.equal(reads, 1);
});
await test("A published tape keeps its shape under stricter import validation", () => {
  const dir = new URL("../data/recordings/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json.gz"));
  assert.ok(files.length > 0);
  for (const name of files) {
    const tape = ModelRecording.parse(gunzipSync(readFileSync(new URL(name, dir))).toString());
    assert.ok(Object.keys(tape.drives).length > 0, name);
  }
});
await test("Tape import rejects a malformed top-level table before replay", () => {
  for (const field of ["drives", "results", "scenarios"])
    assert.throws(() => ModelRecording.parse(document({ [field]: [] })), new RegExp(field));
});
await test("Tape import identifies a drive with a malformed answer table", () => {
  assert.throws(
    () => ModelRecording.parse(document({ drives: { downtown: null } })),
    /Drive "downtown".*object of answers/,
  );
});
await test("Tape import identifies a request whose outcomes are not an array", () => {
  assert.throws(
    () => ModelRecording.parse(document({ drives: { d: { req: { response: valid } } } })),
    /Drive "d" request "req".*answer list/,
  );
});
await test("Tape import reports the position of an invalid result within repeated requests", () => {
  assert.throws(() => tapeWith([{ response: valid }, null]), /invalid outcome at answer 2/);
});
await test("Tape import rejects outcomes with contradictory terminal states", () => {
  assert.throws(() => tapeWith([{ response: valid, timeout: true }]), /invalid outcome/);
});
await test("Tape import rejects errors without a replayable message", () => {
  assert.throws(() => tapeWith([{ error: { status: 503 } }]), /invalid outcome/);
});
await test("Tape import rejects cancellation and timeout markers that are not true", () => {
  for (const marker of ["timeout", "cancelled"])
    assert.throws(() => tapeWith([{ [marker]: false }]), /invalid outcome/);
});
await test("Tape import identifies a malformed stored drive result", () => {
  assert.throws(() => ModelRecording.parse(document({ results: { d: null } })), /Drive "d".*as its result/);
});
await test("Tape import identifies a malformed stored route scenario", () => {
  assert.throws(() => ModelRecording.parse(document({ scenarios: { d: [] } })), /Drive "d".*as its scenario/);
});
await test("Drive IDs that match object properties can be recorded and reloaded", async () => {
  const recording = newTape();
  const id = "__proto__";
  await recording.tape(id, "record").record(pilot, () => valid, path, body);
  recording.keepResult(id, { pass: true }, { id });
  const saved = ModelRecording.parse(recording.serialize());
  assert.equal(saved.suite()[0].id, id);
  assert.equal(saved.results[id].pass, true);
  const tape = saved.tape(id, "replay");
  assert.equal((await tape.replay(pilot, path, body)).answer.motion, "drive");
  assert.equal(tape.exact, true);
});
await test("An explicitly recorded drive with zero calls is an exact replay", () => {
  assert.equal(ModelRecording.parse(document({ drives: { d: {} } })).tape("d", "replay").exact, true);
});
await test("A missing drive can never be reported as an exact replay", () => {
  assert.equal(newTape().tape("toString", "replay").exact, false);
});
await test("Tape diagnostics identify the unused answers by request key without consuming them", async () => {
  const tape = tapeWith([{ response: valid }, { response: valid }]).tape("d", "replay");
  const key = requestKey(header, path, body);
  await tape.replay(pilot, path, body);
  assert.deepEqual(tape.remainingAnswers(), { [key]: 1 });
  assert.equal(tape.exact, false);
  await tape.replay(pilot, path, body);
  assert.deepEqual(tape.remainingAnswers(), {});
});
await test("Concurrent identical tape requests replay their outcomes in invocation order", async () => {
  const recording = newTape();
  const tape = recording.tape("d", "record");
  let complete;
  const first = tape.record(
    pilot,
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    path,
    body,
  );
  await tape.record(pilot, () => ({ order: 2 }), path, body);
  complete({ order: 1 });
  await first;
  const replay = ModelRecording.parse(recording.serialize()).tape("d", "replay");
  assert.equal((await replay.replay(pilot, path, body)).order, 1);
  assert.equal((await replay.replay(pilot, path, body)).order, 2);
});
await test("Wrapping a model for one tape leaves the original transport reusable by other drives", async () => {
  const recording = newTape();
  const original = { transport: () => valid };
  const first = recording.tape("first", "record");
  const second = recording.tape("second", "record");
  const a = first.brainFor(pilot, driver, original);
  const b = second.brainFor(pilot, driver, original);
  await a.transport(path, body);
  await b.transport(path, body);
  await original.transport(path, body);
  assert.equal(first.stats.calls, 1);
  assert.equal(second.stats.calls, 1);
});
await test("A wrapped transport still receives its original model instance", async () => {
  const brain = {
    endpoint: "local",
    transport() {
      return { endpoint: this.endpoint };
    },
  };
  const wrapped = newTape().tape("d", "record").brainFor(pilot, driver, brain);
  assert.equal((await wrapped.transport(path, body)).endpoint, "local");
});
await test("A tape never dispatches the underlying transport when its signal has already aborted", async () => {
  const signal = AbortSignal.abort();
  const tape = newTape().tape("d", "record");
  let called = false;
  await assert.rejects(
    tape.record(
      pilot,
      () => {
        called = true;
        return valid;
      },
      path,
      body,
      { signal },
    ),
    { name: "AbortError" },
  );
  assert.equal(called, false);
});
await test("Successful tape requests release their abort listener before it can accumulate", async () => {
  const controller = new AbortController();
  const { getEventListeners } = await import("node:events");
  const tape = newTape().tape("d", "record");
  await tape.record(pilot, () => valid, path, body, { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
await test("A cancelled tape answer without a replay signal reports drift instead of hanging", async () => {
  const tape = tapeWith([{ cancelled: true }]).tape("d", "replay");
  await assert.rejects(tape.replay(pilot, path, body), /no cancellation signal/);
  assert.equal(tape.stats.drift, 1);
});
await test("A malformed null transport response replays as null instead of turning into a successful envelope", async () => {
  const recording = newTape();
  await recording.tape("d", "record").record(pilot, () => null, path, body);
  const replay = ModelRecording.parse(recording.serialize()).tape("d", "replay");
  assert.equal(await replay.replay(pilot, path, body), null);
});
await test("Literal echo-marker strings without matching request or metadata fields survive replay", async () => {
  const recording = newTape();
  const response = { trace: { request: { custom: "$body" }, meta: "$meta" } };
  await recording.tape("d", "record").record(pilot, () => response, path, body);
  const replay = ModelRecording.parse(recording.serialize()).tape("d", "replay");
  assert.deepEqual((await replay.replay(pilot, path, body)).trace, response.trace);
});
await test("Replay comparison leaves the caller's arena report and its start time untouched", () => {
  const report = { started_at: "now", decisions: 1 };
  const clean = comparableResult({ report });
  assert.deepEqual(clean.report, { decisions: 1 });
  assert.equal(report.started_at, "now");
});

console.log(`${checks} tape edge checks passed.`);
