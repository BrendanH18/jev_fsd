import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DecisionBrain } from "../static/js/brain/decision.js";
import { JevBrain, decisionResult } from "../static/js/brain/jev.js";
import { LlmBrain, llmDecision } from "../static/js/brain/llm.js";
import { buildLlmPrompt, OPEN_SYSTEM_PROMPT, SYSTEM_PROMPT } from "../static/js/brain/llm-prompt.js";
import {
  characterCount,
  MAX_CHAT_CHARS,
  MAX_QUESTION_CHARS,
  MAX_STATE_BYTES,
  stateSizeFloor,
} from "../static/js/brain/model-contract.js";

import { CHALLENGES } from "../static/js/lab/challenges.js";
import { setupChallenge } from "../static/js/lab/evaluation.js";
import { MapData } from "../static/js/map/mapdata.js";

const endpoint = { id: "decision:stub", name: "stub", timeout_s: 2 };
const decision = () => new DecisionBrain(endpoint);
const llm = () => new LlmBrain({ ...endpoint, id: "llm:stub" });
const jev = () => new JevBrain();
const snap = { tick: 7, road: { on_road: true }, traffic: [] };
const q = (criteria, instructions = "Select a choice.") => ({ type: "choice", instructions, criteria });
const questions = {
  motion: q({ drive: "proceed", stop: "hold" }),
  vector: q({ slow: "reduce speed", keep: "continue" }),
  headlights: q({ low: "dip", high: "raise" }),
  route: q({ a: "first", b: "second" }),
};
const eligible = [{ id: "keep" }, { id: "slow" }];
const request = { epoch: 9, state: { candidates: eligible }, questions };
const choose = (choice) => ({ type: "choice", choice });
const answers = { motion: choose("drive"), vector: choose("keep"), headlights: choose("low"), route: choose("a") };
const answer = { motion: "drive", candidate: "keep", headlights: "low", route: "a" };
const meta = { input_tokens: 201, cost_usd: 0.001 };
const trace = { response: { finish: "done" } };

async function noCall(brain, req, pattern, snapshot = snap, options = eligible) {
  let calls = 0;
  brain.transport = async () => {
    calls++;
  };
  await assert.rejects(brain.decide(snapshot, options, req), pattern);
  assert.equal(calls, 0, String(pattern));
}

function serve(brain, response) {
  brain.transport = async () => response;
  return brain.decide(snap, eligible, request);
}

for (const driver of [jev, decision]) {
  for (const [change, error] of [
    [{ state: [] }, /state must be an object/],
    [{ state: null }, /state must be an object/],
    [{ state: { x: 1n } }, /state cannot be encoded/],
    [{ state: { toJSON: () => [] } }, /state cannot be encoded/],
    [{ state: { x: "a".repeat(MAX_STATE_BYTES) } }, /24576-byte limit/],
    [{ state: { x: "🚗".repeat(2200) } }, /at least \d+ bytes/],
    [{ questions: [] }, /questions must be an object/],
    [{ questions: {} }, /at least one question/],
    [{ questions: { unknown: q({ x: "" }) } }, /unknown question unknown/],
    [{ questions: { motion: { ...questions.motion, type: "number" } } }, /motion must be a choice/],
    [{ questions: { motion: q(null) } }, /criteria object/],
    [{ questions: { motion: q(["drive"]) } }, /criteria object/],
    [{ questions: { motion: q({}) } }, /got 0/],
    [{ questions: { motion: q(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i, ""]))) } }, /got 33/],
    [{ questions: { motion: q({ drive: "" }, "  ") } }, /needs text instructions/],
    [{ questions: { motion: q({ drive: "" }, 12) } }, /needs text instructions/],
    [{ questions: { motion: q({ drive: "" }, "🚗".repeat(MAX_QUESTION_CHARS + 1)) } }, /6001 characters/],
    [{ questions: { motion: q({ " ": "" }) } }, /blank choice id/],
    [{ questions: { motion: q({ drive: 4 }) } }, /descriptions must be strings or null/],
    [{ epoch: true }, /epoch must be a safe integer/],
    [{ epoch: 1.5 }, /epoch must be a safe integer/],
  ]) {
    await noCall(driver(), { ...request, ...change }, error);
  }
  await noCall(driver(), request, /tick must be a safe integer/, { ...snap, tick: Number.NaN });
  await noCall(driver(), request, /tick must be a safe integer/, { ...snap, tick: 1e16 });
  const brain = driver();
  const controller = new AbortController();
  let signalSeen;
  let instructions;
  let pathSeen;
  brain.transport = async (path, body, { signal }) => {
    signalSeen = signal;
    pathSeen = path;
    instructions = body.questions.motion.instructions;
    assert.equal(body.tick, 7);
    assert.equal(body.epoch, 9);
    assert.equal(Object.hasOwn(body, "endpoint"), path === "/api/decision/decide");
    return { tick: 7, epoch: 9, answers, meta, trace };
  };
  const result = await brain.decide(
    snap,
    eligible,
    { ...request, questions: { motion: q({ drive: null }, "🚗".repeat(MAX_QUESTION_CHARS)) } },
    controller.signal,
  );
  assert.equal(signalSeen === controller.signal, true);
  assert.equal(characterCount(instructions), MAX_QUESTION_CHARS);
  assert.equal(result.meta.source, brain.name);
  assert.equal(result.meta.input_tokens, 201);
  assert.equal(result.motion, "drive");
  assert.equal(pathSeen, brain.name === "jev" ? "/api/decide" : "/api/decision/decide");
}

assert.equal(stateSizeFloor({ x: "é𝄞" }), 26);
assert.equal(stateSizeFloor({ x: 1e-100 }), 7);
assert.equal(stateSizeFloor({ x: String.fromCharCode(127) }), 14);
assert.equal(stateSizeFloor({ x: "a".repeat(MAX_STATE_BYTES - 8) }), MAX_STATE_BYTES);
const circular = {};
circular.self = circular;
await noCall(jev(), { ...request, state: circular }, /state cannot be encoded/);

for (const [change, error] of [
  [{ questions: {} }, /at least one question/],
  [{ questions: { extra: q({ id: "" }) } }, /unknown question extra/],
  [{ questions: { motion: q({ reverse: "" }) } }, /only accepts drive and stop/],
  [{ questions: { motion: q({ drive: [] }) } }, /choice descriptions/],
  [{ questions: { route: q({ "contains space": "" }) } }, /expect.route contains/],
  [{ questions: { route: q({ ["r".repeat(65)]: "" }) } }, /expect.route contains/],
  [{ questions: { route: q({ a: {} }) } }, /choice descriptions/],
  [{ questions: { headlights: q({}) } }, /got 0/],
  [{ state: [] }, /state must be an object/],
  [{ state: { candidates: null } }, /state.candidates must be an array/],
  [{ state: { candidates: [{ id: "keep" }] } }, /missing candidate observation for slow/],
  [{ state: { candidates: [...eligible, { id: "slow" }] } }, /duplicate candidate observation for slow/],
  [{ state: { candidates: [Object.create({ id: "slow" }), eligible[0]] } }, /missing candidate observation for slow/],
  [{ state: { candidates: eligible, observed: circular } }, /cannot be encoded as JSON/],
  [{ state: { candidates: eligible, observed: 2n } }, /cannot be encoded as JSON/],
  [{ state: { candidates: eligible, extra: "🚗".repeat(MAX_CHAT_CHARS) } }, /LLM prompt has .* characters/],
  [{ epoch: "9" }, /epoch must be a safe integer/],
])
  await noCall(llm(), { ...request, ...change }, error);
await noCall(llm(), request, /outside the eligible set/, snap, [{ id: "keep" }]);
await noCall(llm(), request, /tick must be a safe integer/, { ...snap, tick: false });

const open = buildLlmPrompt(snap, {
  ...request,
  track: "open",
  state: { ...request.state, candidates: [null, ...eligible, { id: "brake" }] },
});
assert.equal(open.messages[0].content, OPEN_SYSTEM_PROMPT);
assert.equal(Object.keys(open.expect).join(), "motion,candidate,headlights,route");
assert.equal(open.expect.candidate.join(), "slow,keep");
assert.equal(
  JSON.parse(open.messages[1].content)
    .candidates.map((c) => c.id)
    .join(),
  "keep,slow",
);
const routeKey = "r".repeat(64);
assert.equal(buildLlmPrompt(null, { questions: { route: q({ [routeKey]: null }) } }).expect.route[0], routeKey);
const emptyUser = { ...request, state: { ...request.state, tag: "" } };
const baselineChars = buildLlmPrompt(snap, emptyUser).messages.reduce(
  (n, message) => n + characterCount(message.content),
  0,
);
const atLimit = { ...emptyUser, state: { ...emptyUser.state, tag: "🚗".repeat(MAX_CHAT_CHARS - baselineChars) } };
const atLimitPrompt = buildLlmPrompt(snap, atLimit);
assert.equal(atLimitPrompt.messages[0].content, SYSTEM_PROMPT);
assert.equal(
  atLimitPrompt.messages.reduce((n, message) => n + characterCount(message.content), 0),
  MAX_CHAT_CHARS,
);

for (const [make, kind] of [
  [jev, { answers }],
  [decision, { answers }],
  [llm, { answer }],
]) {
  for (const [echo, message] of [
    [{ tick: 6 }, /reply tick/],
    [{ epoch: 10 }, /reply epoch/],
    [{ tick: "7" }, /reply tick/],
    [{ epoch: null }, /reply epoch/],
  ]) {
    await assert.rejects(serve(make(), { ...kind, ...echo, meta, trace }), (error) => {
      assert.match(error.message, message);
      assert.equal(error.meta.input_tokens, 201);
      assert.equal(error.meta.live_call, true);
      assert.equal(error.trace === trace, true);
      return true;
    });
  }

  await assert.rejects(serve(make(), { ...kind, invalid: "provider refused" }), /provider refused/);
  await assert.rejects(serve(make(), { ...kind, invalid: true }), /malformed invalid-output verdict/);
  await assert.rejects(serve(make(), { error: "proxy returned non-JSON" }), /proxy returned non-JSON/);
  await assert.rejects(serve(make(), { invalid: "🚗".repeat(350) }), (error) => {
    assert.equal(characterCount(error.message.split(": ").at(-1)), 300);
    return true;
  });
  assert.equal((await serve(make(), { ...kind, invalid: null, meta: ["junk"] })).meta[0], undefined);
  assert.equal((await serve(make(), { ...kind, meta: { ...meta, source: "spoofed" } })).meta.source, make().name);
  assert.equal((await serve(make(), { ...kind, invalid: false })).candidateId, "keep");
  assert.equal((await serve(make(), { ...kind, invalid: "" })).candidateId, "keep");

  const before = new AbortController();
  before.abort();
  let sent = false;
  const cancelled = make();
  cancelled.transport = async () => {
    sent = true;
    return kind;
  };
  await assert.rejects(cancelled.decide(snap, eligible, request, before.signal), { name: "AbortError" });
  assert.equal(sent, false);

  const after = new AbortController();
  cancelled.transport = async () => {
    after.abort();
    return kind;
  };
  await assert.rejects(cancelled.decide(snap, eligible, request, after.signal), { name: "AbortError" });

  const failure = Object.assign(new Error("endpoint timed out"), { status: 504 });
  cancelled.transport = async () => {
    throw failure;
  };
  await assert.rejects(cancelled.decide(snap, eligible, request), (error) => error === failure && error.status === 504);
}

for (const [seconds, expected] of [
  [undefined, 5750],
  [0, 5750],
  [Infinity, 5750],
  [NaN, 5750],
  ["2", 5750],
  [-5, 5750],
  [0.4, 1150],
  [1.1, 1850],
  [1e200, 60750],
]) {
  assert.equal(new DecisionBrain({ ...endpoint, timeout_s: seconds }).timeoutMs, expected);
}
assert.equal(new LlmBrain({ name: "stub" }).timeoutMs, 10750);
assert.equal(jev().timeoutMs, 1500);

const frozen = Object.freeze({
  ...choose("keep"),
  confidence: Infinity,
  probabilities: Object.freeze({ slow: 0, keep: 1, bogus: 0.2, toString: 1 }),
});
const clean = decisionResult({ answers: { ...answers, vector: frozen } }, request, eligible, meta);
assert.equal(clean.answers.vector.confidence, null);
assert.equal(clean.answers.vector.probabilities.slow, 0);
assert.equal(clean.answers.vector.probabilities.keep, 1);
assert.equal(Object.keys(clean.answers.vector.probabilities).join(), "slow,keep");
assert.equal(Object.keys(frozen.probabilities).length, 4);
for (const confidence of [-1, 1.001, "0.6", true, NaN, null]) {
  const result = decisionResult(
    { answers: { ...answers, motion: { ...answers.motion, confidence } } },
    request,
    eligible,
    meta,
  );
  assert.equal(result.answers.motion.confidence, null);
}
for (const value of [true, "0.5", -1, 2, NaN, Infinity, undefined]) {
  const result = decisionResult(
    { answers: { ...answers, vector: { choice: "keep", probabilities: { keep: value } } } },
    request,
    eligible,
    meta,
  );
  assert.equal(Object.keys(result.answers.vector.probabilities).length, 0);
}
for (const probabilities of [null, [], 1, "one"]) {
  const result = decisionResult(
    { answers: { ...answers, vector: { choice: "keep", probabilities } } },
    request,
    eligible,
    meta,
  );
  assert.equal(Object.keys(result.answers.vector.probabilities).length, 0);
}
assert.equal(
  decisionResult({ answers: { ...answers, vector: { choice: "keep" } } }, request, eligible, meta).candidateId,
  "keep",
);
assert.equal(
  decisionResult({ answers: { ...answers, vector: { type: "text", choice: "keep" } } }, request, eligible, meta)
    .candidateId,
  null,
);
assert.equal(
  decisionResult({ answers: { ...answers, route: Object.create({ choice: "b" }) } }, request, eligible, meta).routeId,
  null,
);
assert.equal(
  decisionResult({ answers: Object.create(answers) }, { questions: { route: questions.route } }, eligible, meta)
    .routeId,
  null,
);
assert.throws(
  () => decisionResult({ answers }, { ...request, local: { motion: choose("reverse") } }, eligible, meta),
  /motion must be drive or stop/,
);
assert.throws(() => decisionResult(Object.create({ answers }), request, eligible, meta), /missing answers object/);
assert.equal(
  decisionResult(
    { answers: { ...answers, route: choose("__proto__") } },
    { ...request, questions: { ...questions, route: q({ ["__proto__"]: "known route" }) } },
    eligible,
    meta,
  ).routeId,
  "__proto__",
);

await assert.rejects(serve(llm(), { answer: Object.create(answer) }), /missing or invalid motion/);
await assert.rejects(serve(llm(), Object.create({ answer })), /missing answer object/);
assert.equal((await serve(llm(), { answer: { ...answer, reason: "🚗".repeat(250) } })).meta.reason, "🚗".repeat(200));
assert.equal((await serve(llm(), { answer: { ...answer, reason: 123 } })).meta.reason, undefined);
assert.equal(llmDecision({ candidate: {}, route: false }, { local: {} }, {}).routeId, null);
assert.equal(llmDecision(Object.create(answer), { local: {} }, {}).candidateId, null);
assert.equal(llmDecision({ route: "a" }, { local: { route: null } }, {}).routeId, null);

const pack = JSON.parse(readFileSync(new URL("../data/maps/623b012bc8b5.v6.pack.json", import.meta.url)));
const map = new MapData(pack);
for (const preflight of [true, false]) {
  const { world, autopilot } = setupChallenge(map, CHALLENGES[0]);
  const brain = llm();
  let called = false;
  brain.transport = async (_path, body) => {
    called = true;
    return { tick: body.tick + 1, answer, meta, trace };
  };
  autopilot.brains[brain.name] = {
    decide: (snapshot, choices, req, signal) =>
      brain.decide(snapshot, choices, preflight ? { ...req, state: [] } : req, signal),
  };
  autopilot.setBrain(brain.name);
  autopilot.step(1 / 60, 0);
  await autopilot.firing;
  assert.equal(called, !preflight);
  assert.equal(world.violations.fallbacks, 1);
  assert.equal(autopilot.lastDecision.decidedBy, "fallback");
  assert.match(autopilot.lastDecision.meta.error, preflight ? /invalid model request/ : /reply tick/);
  assert.equal(autopilot.totals.calls, preflight ? 0 : 1);
  assert.equal(autopilot.totals.tokens, preflight ? 0 : meta.input_tokens);
  assert.equal(autopilot.inFlight, null);
}

console.log("Browser model request, response and fallback checks passed.");
process.exit(0);
