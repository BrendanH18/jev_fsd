// Model recordings (static/js/brain/recording.js, ROADMAP 2.6): a model drive recorded once replays
// exactly, with no model call, no key and no server.
// node --experimental-default-type=module scripts/test_model_recording.mjs           (no server, no network)
// node --experimental-default-type=module scripts/test_model_recording.mjs --write   (rewrite the committed recording)
//
// The model is a deterministic stub served in-process through the real api() path: it answers every
// request the same way (stubAnswer: the prompt's rules of thumb), except that its 2nd
// call is an invalid answer, its 3rd times out and its 5th is an HTTP error. Routes come from the browser's router (demo/routing.js) through the same stub.
// The committed recording (data/recordings/stub-llm-kitsilano-s1.json) was made by `--write` from
// this stub, not from a real model. A change to physics, traffic, sensing, candidates, the decision
// state or the LLM prompt changes what the model is asked, so its replay drifts and this test fails:
// check the change is intended, then rewrite the recording with --write.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { browserRoute } = await import("../static/js/demo/routing.js");
const { buildSuite } = await import("../static/js/bench/scenarios.js");
const { runScenario } = await import("../static/js/bench/runner.js");
const { registerLlmAgents } = await import("../static/js/brain/llm.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { ModelRecording, recordingHeader, canonicalJson, hashText, requestKey, sameResult, comparableResult, mapFingerprint, checkMap, RECORDING_FORMAT } = await import("../static/js/brain/recording.js");

const WRITE = process.argv.includes("--write");
const COMMITTED = new URL("../data/recordings/stub-llm-kitsilano-s1.json", import.meta.url);
// Kitsilano as /api/map serves it: the pack, every layer beside it, the bbox and the UTC offset, so
// the committed recording also replays with bench_node.mjs --replay against the local server.
function serverMap(key, bbox, utcOffset) {
  const dir = new URL("../data/maps/", import.meta.url), pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, dir)));
  for (const file of fs.readdirSync(dir).filter(f => f.startsWith(`${key}.`) && f.endsWith(".json") && !f.includes(".pack."))) {
    const [, layer, version] = file.split(".");
    if (version === "v1" && fs.existsSync(new URL(`${key}.${layer}.v2.json`, dir))) continue;   // (loaders prefer v2)
    pack[layer] = JSON.parse(fs.readFileSync(new URL(file, dir)));
  }
  return new MapData({ ...pack, utc_offset: utcOffset, routing_bbox: bbox });
}
const map = serverMap("623b012bc8b5", [-123.17, 49.26, -123.15, 49.27], -7);
const BENCH = { map: "kitsilano", count: 1, seed: 1, npcs: 12, mode: "lockstep", weather: "dry" };
const INVALID_CALL = 2, TIMEOUT_CALL = 3, ERROR_CALL = 5;
let assertions = 0;
async function test(name, fn) { await fn(); assertions++; console.log(`✓ ${name}`); }

// The stub model and router, behind the same fetch the app uses.
const ENDPOINT = { id: "llm:stub", name: "stub", label: "Stub model (deterministic, no network)", model: "stub-1", endpoint: "stub://local", usable: true, timeout_s: 0.05, api_key_env: null };
let modelCalls = 0;
function stubModel(body, n, signal) {
  if (n === TIMEOUT_CALL) return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  if (n === ERROR_CALL) return { status: 429, error: "LLM endpoint 'stub': rate limited by the endpoint (429)" };
  const meta = { model: "stub-1", latency_ms: 80 + ((n * 37) % 120), input_tokens: Math.round(body.messages[1].content.length / 4), output_tokens: 12, cost_usd: 0, cost_known: true, live_call: true };
  const trace = { request: { model: "stub-1", messages: body.messages }, response: { call: n } };
  if (n === INVALID_CALL) return { tick: body.tick, epoch: body.epoch, answer: null, invalid: "reply was not a JSON object", content: "not json", meta: { ...meta, invalid: "reply was not a JSON object" }, trace };
  const answer = stubAnswer(JSON.parse(body.messages[1].content), body.expect);
  return { tick: body.tick, epoch: body.epoch, answer, invalid: null, content: JSON.stringify(answer), meta, trace };
}
// The prompt's own rules of thumb: any stop the car is offered; else the centred candidate at target,
// else the one closest below it; hold still when the target is to stand still and the car has.
function stubAnswer(input, expect) {
  const car = input.observed?.car || {}, target = car.target_speed ?? 0, offered = input.candidates || [];
  const below = offered.filter(c => c.end_speed <= target + 0.1).sort((a, b) => b.end_speed - a.end_speed);
  const pick = offered.find(c => c.id.startsWith("stop_")) || offered.find(c => c.vs_target === "at target" && c.lane === "centered")
    || offered.find(c => c.vs_target === "at target") || below[0] || offered[0];
  return { ...(expect.motion ? { motion: target < 0.1 && (car.speed ?? 0) < 0.5 ? "stop" : "drive" } : {}), ...(pick ? { candidate: pick.id } : {}),
    ...(expect.headlights ? { headlights: "low" } : {}), ...(expect.route ? { route: expect.route[0] } : {}) };
}
globalThis.fetch = async (path, { body, signal } = {}) => {
  const parsed = body ? JSON.parse(body) : undefined;
  let out;
  if (path === "/api/route") { const route = browserRoute(map, parsed.from, parsed.to, parsed); out = { routes: route ? [route] : [] }; }
  else if (path === "/api/llm/decide") out = await stubModel(parsed, ++modelCalls, signal);
  else throw new Error(`unexpected request ${path}`);
  const status = out.status || 200;
  return { ok: status < 400, status, json: async () => (status < 400 ? out : { error: out.error }) };
};

await test("keys are a stable hash of what the model sees, without tick and epoch", () => {
  assert.equal(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined }), '{"a":[1,{"c":3,"d":2}],"b":1}');
  assert.match(hashText("x"), /^[0-9a-f]{16}$/);
  assert.notEqual(hashText("ab"), hashText("ba"));
  const who = { driver: "llm:stub", model: "stub-1" }, body = { endpoint: "stub", messages: [{ role: "user", content: "hi" }], expect: { motion: ["drive", "stop"] } };
  const key = requestKey(who, "/api/llm/decide", { ...body, tick: 1, epoch: 2 });
  assert.equal(requestKey(who, "/api/llm/decide", { expect: body.expect, tick: 9, epoch: 7, messages: body.messages, endpoint: "stub" }), key);
  assert.notEqual(requestKey({ ...who, model: "stub-2" }, "/api/llm/decide", body), key);
  assert.notEqual(requestKey(who, "/api/llm/decide", { ...body, expect: { motion: ["drive"] } }), key);
});

await test("only model drivers can be recorded", () => {
  assert.throws(() => recordingHeader({ driver: "rules" }), /Only model drivers/);
  assert.throws(() => ModelRecording.parse({ format: "other" }), /Not a model recording/);
});

await test("a call cancelled by a new epoch replays as cancelled, and only when the epoch moves again", async () => {
  const recording = new ModelRecording({ header: recordingHeader({ driver: "llm:stub", brain: { endpoint: ENDPOINT } }) });
  const autopilot = { epoch: 4 }, body = { endpoint: "stub", tick: 0, epoch: 4, messages: [], expect: { motion: ["drive"] } };
  const recorder = recording.tape("d", "record").brainFor(autopilot, "llm:stub", { transport: () => new Promise(() => {}) });
  let controller = new AbortController();
  const recorded = recorder.transport("/api/llm/decide", body, { signal: controller.signal });
  autopilot.epoch = 5; controller.abort();
  await assert.rejects(recorded, err => err.name === "AbortError");
  assert.deepEqual(Object.values(recording.drives.d)[0], [{ cancelled: true }]);
  for (const [moveEpoch, pattern] of [[true, /^AbortError$/], [false, /^Error$/]]) {
    const tape = ModelRecording.parse(JSON.parse(JSON.stringify(recording))).tape("d", "replay");
    autopilot.epoch = 4; controller = new AbortController();
    const replayed = tape.brainFor(autopilot, "llm:stub").transport("/api/llm/decide", body, { signal: controller.signal });
    if (moveEpoch) autopilot.epoch = 5;
    controller.abort();
    await assert.rejects(replayed, err => pattern.test(err.name) && (moveEpoch || /recording drift/.test(err.message)));
    assert.equal(tape.stats.drift, moveEpoch ? 0 : 1);
  }
});

const suite = await buildSuite(map, { count: BENCH.count, seed: BENCH.seed });
assert.equal(suite.length, 1);
const sc = suite[0];
registerLlmAgents({ endpoints: [ENDPOINT] });

const recording = new ModelRecording({ header: recordingHeader({ driver: "llm:stub", brain: { endpoint: ENDPOINT },
  map: BENCH.map, map_sha: mapFingerprint(map), seed: BENCH.seed, preset: "bare", weather: BENCH.weather, bench: BENCH, stub: true,
  note: "Recorded from the deterministic stub model in scripts/test_model_recording.mjs, not a real model: no live model call was made. Rewrite it with that script's --write." }) });
const recorded = await runScenario(map, sc, { brain: "llm:stub", npcs: BENCH.npcs, tape: recording.tape(sc.id, "record") });
recording.keepResult(sc.id, recorded, sc);
const outcomes = Object.values(recording.drives[sc.id]).flat();

await test("recording keeps every call's outcome: answers, an invalid answer, a timeout and an HTTP error", () => {
  assert.equal(recorded.model_recording.mode, "record");
  assert.ok(modelCalls > ERROR_CALL, `${modelCalls} model calls`);
  assert.equal(outcomes.length, modelCalls);
  assert.equal(recorded.model_recording.calls, modelCalls);
  assert.equal(outcomes.filter(o => o.timeout).length, 1);
  assert.equal(outcomes.filter(o => o.response?.invalid).length, 1);
  assert.equal(outcomes.filter(o => o.error?.status === 429).length, 1);
  assert.ok(outcomes.filter(o => o.response?.answer).length >= modelCalls - 3);
  assert.ok(recorded.fallbacks >= 3, `${recorded.fallbacks} fallbacks`);
  // (the echoed request and the tick and epoch are not stored twice)
  const kept = outcomes.find(o => o.response?.answer).response;
  assert.equal(kept.trace.request.messages, "$body");
  assert.ok(!("tick" in kept) && !("epoch" in kept));
});

await test("a replay makes no model call, needs no registered endpoint and plays out exactly as recorded", async () => {
  registerLlmAgents({ endpoints: [] });   // the endpoint is gone: the header rebuilds the driver
  const before = modelCalls;
  const saved = ModelRecording.parse(recording.serialize());   // (through the file's text)
  const tape = saved.tape(sc.id, "replay");
  const replayed = await runScenario(map, sc, { brain: saved.header.driver, npcs: BENCH.npcs, tape });
  assert.equal(modelCalls, before);
  assert.equal(tape.stats.missing, 0); assert.equal(tape.stats.drift, 0);
  assert.equal(tape.stats.served, outcomes.length); assert.equal(tape.exact, true);
  assert.equal(replayed.fallbacks, recorded.fallbacks);
  assert.equal(replayed.calls, recorded.calls); assert.equal(replayed.decisions, recorded.decisions);
  assert.equal(replayed.time_s, recorded.time_s); assert.equal(replayed.arrived, recorded.arrived);
  assert.equal(sameResult(replayed, saved.results[sc.id]), true, firstDifference(replayed, saved.results[sc.id]));
  // (bench_node --diagnostics 1 is optional output: asking for it, or not, on replay is the same drive)
  assert.equal(sameResult({ ...replayed, diagnostics: [{ type: "collision", at_s: 1 }] }, saved.results[sc.id]), true);
});

await test("a request missing from the recording is a visible Rules fallback, not a silent answer", async () => {
  const tampered = ModelRecording.parse(JSON.stringify(recording));
  const first = Object.keys(tampered.drives[sc.id])[0];
  delete tampered.drives[sc.id][first];
  const tape = tampered.tape(sc.id, "replay");
  const before = modelCalls;
  const r = await runScenario(map, sc, { brain: "llm:stub", npcs: BENCH.npcs, tape, shouldStop: () => tape.stats.calls >= 4 });
  assert.equal(modelCalls, before);
  assert.ok(tape.stats.missing >= 1); assert.equal(tape.exact, false);
  assert.ok(r.events.some(e => e.type === "fallback" && e.error === `not in recording: ${first}`));
  assert.ok(r.fallbacks >= 1);
});

await test("an arena evaluation records and replays a challenge drive the same way", async () => {
  registerLlmAgents({ endpoints: [ENDPOINT] });
  const challenge = CHALLENGES[0], arena = new ModelRecording({ header: recordingHeader({ driver: "llm:stub", brain: { endpoint: ENDPOINT }, challenge: challenge.id }) });
  const live = await evaluateChallenge(map, challenge, { brain: "llm:stub", limit: 6, tape: arena.tape(challenge.id, "record") });
  registerLlmAgents({ endpoints: [] });
  const before = modelCalls, tape = ModelRecording.parse(arena.serialize()).tape(challenge.id, "replay");
  const again = await evaluateChallenge(map, challenge, { brain: "llm:stub", limit: 6, tape });
  assert.equal(modelCalls, before);
  assert.ok(live.calls > 0); assert.equal(tape.exact, true);
  assert.equal(sameResult(live, again), true, firstDifference(live, again));
  await assert.rejects(evaluateChallenge(map, challenge, { brain: "llm:stub", mode: "realtime", tape: arena.tape(challenge.id, "replay") }), /lockstep/);
});

if (WRITE) {
  fs.mkdirSync(new URL(".", COMMITTED), { recursive: true });
  fs.writeFileSync(COMMITTED, recording.serialize());
  console.log(`wrote ${COMMITTED.pathname}`);
}

await test("the committed stub recording still replays to its saved result", async () => {
  const committed = ModelRecording.parse(fs.readFileSync(COMMITTED, "utf8"));
  assert.equal(committed.header.driver, "llm:stub"); assert.equal(committed.header.stub, true);
  assert.equal(committed.header.versions.format, RECORDING_FORMAT);
  checkMap(committed, map);   // (throws when a map pack or layer has changed since)
  assert.throws(() => checkMap(committed, { pack: { other: true } }), /other map data/);
  const b = committed.header.bench;
  const drives = committed.suite();
  assert.equal(drives.map(d => d.id).sort().join(","), Object.keys(committed.drives).sort().join(","));
  const before = modelCalls;
  for (const drive of drives) {
    const tape = committed.tape(drive.id, "replay");
    const r = await runScenario(map, drive, { brain: committed.header.driver, npcs: b.npcs, weather: b.weather, tape });
    const same = sameResult(r, committed.results[drive.id]);
    assert.equal(tape.stats.missing, 0, `${drive.id}: ${tape.stats.missing} calls not in the recording; if the change is intended, rewrite it with --write`);
    assert.equal(tape.exact, true);
    assert.equal(same, true, `${drive.id}: ${firstDifference(r, committed.results[drive.id])}; if the change is intended, rewrite it with --write`);
  }
  assert.equal(modelCalls, before);
});

// The first field where two results differ, as text (never the objects themselves: see AGENTS.md).
function firstDifference(a, b, path = "") {
  const x = path ? a : comparableResult(a), y = path ? b : comparableResult(b);
  if (x && y && typeof x === "object" && typeof y === "object") {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (canonicalJson(x[k]) !== canonicalJson(y[k])) return firstDifference(x[k], y[k], `${path}.${k}`);
    }
    return "same";
  }
  return `${path}: ${canonicalJson(x).slice(0, 120)} vs ${canonicalJson(y).slice(0, 120)}`;
}

console.log(`${assertions} model recording checks passed.`);
process.exit(0);   // the runner's MessageChannel would otherwise keep Node alive
