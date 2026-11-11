// Model recordings: every answer a model driver got from the server, keyed by what the model saw, so a
// published model run replays exactly with no key and no network call (ROADMAP 2.6).
//
// A recording wraps the brain's transport, the one `api` call each model brain makes (jev.js,
// decision.js, llm.js), not its decide(): the brain's own handling of the answer (decisionResult,
// llmDecision, its invalid-answer errors) runs unchanged on replay, and the autopilot's fallback
// accounting sees exactly what it saw when the answer was recorded.
//
// Keys. A call's key is a hash of the canonical JSON of the driver id, the model, the API path and the
// request body without `tick` and `epoch` (counters, not what the model sees): for decision models
// and Jev, the state and questions; for LLMs, the messages and expected fields, plus the endpoint
// name. Equal requests within a drive keep their answers in call order, so a model that answered the
// same request differently twice replays the same way. Each drive has its own answers, by scenario
// (or challenge) id, so any one drive replays on its own.
//
// Outcomes are recorded as they came, never re-timed: { response } (the server's JSON, including
// answers the server or brain then rejects as invalid), { error: { message, status } } (an HTTP error),
// { timeout: true } (the autopilot's timer gave up) or { cancelled: true } (a new epoch, say a fresh
// route, made the answer stale before it came). On replay a timeout fails at once as the same
// timeout fallback; a cancelled call waits until the autopilot cancels it again. A call the recording
// has no answer for fails with "not in recording", which the autopilot counts as a Rules fallback,
// so drift shows in the drive's fallbacks and in the tape's `missing` count instead of passing
// silently.
//
// Recording and replay need the lockstep clock (bench/runner.js, lab/evaluation.js): in realtime a
// late answer lands at a different sim time each run, so nothing could replay it.

import { api } from "../common.js";
import { LlmBrain } from "./llm.js";
import { DecisionBrain } from "./decision.js";
import { JevBrain } from "./jev.js";
import { SYSTEM_PROMPT } from "./llm-prompt.js";

export const RECORDING_FORMAT = "jev-model-recording/1";
const BODY = "$body";   // a trace field that only echoed the request: rebuilt from it on replay

// JSON with object keys sorted, so equal values always give the same text. Like JSON.stringify,
// undefined members are dropped and non-finite numbers become null.
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined || typeof v === "function" ? "null" : canonicalJson(v))).join(",")}]`;
  if (typeof value.toJSON === "function") return canonicalJson(value.toJSON());
  const keys = Object.keys(value).filter(k => value[k] !== undefined && typeof value[k] !== "function").sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

// A 64-bit hash (two independent 32-bit lanes over the UTF-16 code units) as 16 hex digits.
// Synchronous and dependency-free, so it runs the same in the browser and Node.
export function hashText(text) {
  let a = 0x811c9dc5 ^ text.length, b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15;
  }
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b); a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35); a ^= a >>> 16;
  b = Math.imul(b ^ (b >>> 16), 0x85ebca6b); b = Math.imul(b ^ (b >>> 13), 0xc2b2ae35); b ^= b >>> 16;
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export function requestKey({ driver, model }, path, body) {
  const { tick, epoch, ...seen } = body || {};
  return hashText(canonicalJson({ driver, model: model ?? null, path, body: seen }));
}

// The map data a drive ran on (the pack with its layers, as /api/map serves it). A recording keeps it
// in its header, and a replay on other map data stops before driving rather than drifting.
export const mapFingerprint = map => hashText(canonicalJson(map.pack));
export function checkMap(recording, map) {
  const want = recording.header.map_sha;
  if (want && want !== mapFingerprint(map)) throw new Error(`The recording was made on other map data (${recording.header.map || "map"} ${want}, this one ${mapFingerprint(map)}): a map pack or layer has changed since.`);
}

// The kind of model brain behind a driver id, and what its header needs to rebuild it.
export const driverKind = id => (id === "jev" ? "jev" : String(id).startsWith("decision:") ? "decision" : String(id).startsWith("llm:") ? "llm" : null);
const ENDPOINT_FIELDS = ["id", "name", "label", "model", "timeout_s"];

// The header for a new recording. `brain` is the driver's brain (for its endpoint), `model` the model
// id when the brain does not know it (Jev's comes from the server's status).
export function recordingHeader({ driver, brain = null, model = null, ...context }) {
  const kind = driverKind(driver);
  if (!kind) throw new Error(`Only model drivers (jev, decision:<name>, llm:<name>) can be recorded, not "${driver}".`);
  const endpoint = brain?.endpoint ? Object.fromEntries(ENDPOINT_FIELDS.filter(k => brain.endpoint[k] !== undefined).map(k => [k, brain.endpoint[k]])) : null;
  return {
    driver, kind, model: endpoint?.model ?? model ?? null, ...(endpoint ? { endpoint } : {}),
    recorded_at: new Date().toISOString(),
    // (a recording replays exactly only on the JavaScript engine it was made on, as benchmark
    // baselines compare only within one engine: Math results differ in the last bits between engines)
    engine: globalThis.process?.versions?.node ? `node ${globalThis.process.version}` : globalThis.navigator?.userAgent || "unknown",
    // (what the key depends on besides the request itself: a changed LLM system prompt changes every key)
    versions: { format: RECORDING_FORMAT, ...(kind === "llm" ? { llm_prompt: hashText(SYSTEM_PROMPT) } : {}) },
    ...context,
  };
}

export class ModelRecording {
  constructor({ header, drives = {}, results = {}, scenarios = {} } = {}) {
    if (!header?.driver || !driverKind(header.driver)) throw new Error("A recording needs a header with a model driver id.");
    this.header = header;
    this.drives = drives;      // drive id -> { key: [outcome, ...] }
    this.results = results;    // drive id -> the drive's result as recorded, timings removed
    this.scenarios = scenarios;  // drive id -> the benchmark scenario driven (start, route, traffic seed)
  }

  static parse(data) {
    const json = typeof data === "string" ? JSON.parse(data) : data;
    if (json?.format !== RECORDING_FORMAT) throw new Error(`Not a model recording (format ${JSON.stringify(json?.format)}, expected ${RECORDING_FORMAT}).`);
    return new ModelRecording(json);
  }

  // A tape for one drive. `mode` is "record" (calls go to the server and are kept) or "replay"
  // (answers come from the recording; no call is made).
  tape(driveId, mode) {
    if (!["record", "replay"].includes(mode)) throw new Error(`Unknown tape mode "${mode}".`);
    if (mode === "record") this.drives[driveId] = {};
    return new DriveTape(this, String(driveId), mode);
  }

  // A drive's result, and its scenario: a replay drives the recorded route even if the router has
  // changed since.
  keepResult(driveId, result, scenario = null) {
    this.results[driveId] = comparableResult(result);
    if (scenario) this.scenarios[driveId] = JSON.parse(JSON.stringify(scenario));
  }
  // The recorded scenarios in drive order, or null when the recording has none (a challenge drive).
  suite() { const list = Object.values(this.scenarios); return list.length ? list : null; }

  toJSON() { return { format: RECORDING_FORMAT, header: this.header, results: this.results, scenarios: this.scenarios, drives: this.drives }; }

  // The file's text: one line for the header, one per drive's result and one per request key, so a
  // re-recording diffs by request.
  serialize() {
    const lines = (object, indent, each) => Object.entries(object).map(([k, v]) => `${indent}${JSON.stringify(k)}: ${each(v)}`).join(",\n");
    const drives = lines(this.drives, "  ", answers => `{\n${lines(answers, "   ", JSON.stringify)}\n  }`);
    return `{\n "format": ${JSON.stringify(RECORDING_FORMAT)},\n "header": ${JSON.stringify(this.header)},\n`
      + ` "results": {\n${lines(this.results, "  ", JSON.stringify)}\n },\n "scenarios": {\n${lines(this.scenarios, "  ", JSON.stringify)}\n },\n`
      + ` "drives": {\n${drives}\n }\n}\n`;
  }
}

// A drive's result without what measures the computer rather than the drive (the wall-clock time a
// drive took, and an arena report's wall-clock start) and the tape's own counts. Everything else,
// model latency included (it is part of the recorded answer), must replay exactly.
export function comparableResult(result) {
  const { wall_ms, model_recording, ...rest } = result || {};
  const out = JSON.parse(JSON.stringify(rest));
  if (out.report && typeof out.report === "object") delete out.report.started_at;
  return out;
}
export const sameResult = (a, b) => canonicalJson(comparableResult(a)) === canonicalJson(comparableResult(b));

export class DriveTape {
  constructor(recording, driveId, mode) {
    this.recording = recording;
    this.driveId = driveId;
    this.mode = mode;
    this.answers = mode === "record" ? recording.drives[driveId] : (recording.drives[driveId] || {});
    this.cursor = new Map();
    this.stats = { calls: 0, served: 0, missing: 0, drift: 0 };
  }

  get driver() { return this.recording.header.driver; }

  // The brain the autopilot drives with: `brain` (the registered one for this driver, if any) with
  // its transport recorded, or, on replay, a brain rebuilt from the header that answers from the
  // tape. The autopilot is needed to tell a timeout from a cancelled call.
  brainFor(autopilot, id, brain) {
    if (id !== this.driver) throw new Error(`The recording is for ${this.driver}; this drive asked for ${id}.`);
    if (this.mode === "record") {
      if (!brain || typeof brain.transport !== "function") throw new Error(`${id} has no model transport to record.`);
      const inner = brain.transport;
      brain.transport = (path, body, opts) => this.record(autopilot, inner, path, body, opts);
      return brain;
    }
    const replay = rebuildBrain(this.recording.header);
    replay.transport = (path, body, opts) => this.replay(autopilot, path, body, opts);
    return replay;
  }

  key(path, body) { return requestKey(this.recording.header, path, body); }

  async record(autopilot, inner, path, body, { signal } = {}) {
    const key = this.key(path, body);
    this.stats.calls++;
    let outcome;
    try {
      const res = await untilAborted(inner(path, body, { signal }), signal);
      outcome = { response: storedResponse(res, body) };
      return res;
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) outcome = autopilot.epoch !== body.epoch ? { cancelled: true } : { timeout: true };
      else outcome = { error: { message: String(err?.message ?? err), ...(err?.status !== undefined ? { status: err.status } : {}), ...(err?.jevStatus !== undefined ? { jev_status: err.jevStatus } : {}) } };
      throw err;
    } finally {
      (this.answers[key] ||= []).push(outcome);
    }
  }

  async replay(autopilot, path, body, { signal } = {}) {
    const key = this.key(path, body);
    this.stats.calls++;
    const n = this.cursor.get(key) || 0;
    const outcome = this.answers[key]?.[n];
    this.cursor.set(key, n + 1);
    if (!outcome) {
      this.stats.missing++;
      throw new Error(`not in recording: ${key}${n ? ` (asked ${n + 1} times, recorded ${n})` : ""}`);
    }
    this.stats.served++;
    if (outcome.timeout) throw new DOMException("Decision timed out", "AbortError");
    if (outcome.cancelled) {
      // Recorded as cancelled by a new epoch: wait for this run's autopilot to cancel it too.
      await new Promise((resolve) => (signal?.aborted ? resolve() : signal?.addEventListener("abort", resolve, { once: true })));
      if (autopilot.epoch === body.epoch) {
        this.stats.drift++;
        throw new Error(`recording drift: ${key} was cancelled when recorded, but timed out on replay`);
      }
      throw new DOMException("Decision cancelled", "AbortError");
    }
    if (outcome.error) throw Object.assign(new Error(outcome.error.message), { status: outcome.error.status, jevStatus: outcome.error.jev_status });
    return restoredResponse(outcome.response, body);
  }

  // Whether every call was answered from the recording and every recorded answer was used.
  get exact() {
    if (this.mode !== "replay") return null;
    const recorded = Object.values(this.answers).reduce((n, list) => n + list.length, 0);
    return this.stats.missing === 0 && this.stats.drift === 0 && this.stats.served === recorded;
  }
}

function untilAborted(promise, signal) {
  if (!signal) return promise;
  return Promise.race([promise, new Promise((_, reject) => {
    const abort = () => reject(new DOMException("Decision aborted", "AbortError"));
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  })]);
}

// The server's JSON as kept: without the tick and epoch it echoes, and with trace.request fields
// that only repeat the request body (the LLM's messages, Jev's state) marked to be rebuilt from it.
function storedResponse(res, body) {
  const { tick, epoch, ...kept } = JSON.parse(JSON.stringify(res ?? null)) ?? {};
  const request = kept.trace?.request;
  if (request && typeof request === "object") {
    for (const [k, v] of Object.entries(request)) {
      if (k in body && v !== null && typeof v === "object" && canonicalJson(v) === canonicalJson(body[k])) request[k] = BODY;
    }
  }
  return kept;
}
function restoredResponse(stored, body) {
  const res = JSON.parse(JSON.stringify(stored));
  const request = res.trace?.request;
  if (request && typeof request === "object") {
    for (const [k, v] of Object.entries(request)) if (v === BODY) request[k] = JSON.parse(JSON.stringify(body[k]));
  }
  return { tick: body.tick, epoch: body.epoch, ...res };
}

// A brain like the recorded one, from its header alone: the replay needs no registered endpoint.
function rebuildBrain(header) {
  const kind = driverKind(header.driver);
  if (kind === "jev") return new JevBrain();
  const endpoint = { usable: true, ...header.endpoint, id: header.driver, model: header.model };
  if (!endpoint.name) endpoint.name = header.driver.slice(header.driver.indexOf(":") + 1);
  return kind === "llm" ? new LlmBrain(endpoint) : new DecisionBrain(endpoint);
}

// Load a recording saved on the server (data/recordings/<name>.json) or given as JSON.
export async function loadRecording(source) {
  if (source instanceof ModelRecording) return source;
  if (typeof source === "string" && !source.trimStart().startsWith("{")) return ModelRecording.parse(await api(`/api/recordings?name=${encodeURIComponent(source)}`));
  return ModelRecording.parse(source);
}
export const saveRecording = recording => api("/api/recordings/save", recording.toJSON());
