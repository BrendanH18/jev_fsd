// LLM endpoint drivers in the browser: prompt building, answer handling and the Rules fallback.
// node --experimental-default-type=module scripts/test_llm_agent.mjs   (no server, no network)
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT, buildLlmPrompt } = await import("../static/js/brain/llm-prompt.js");
const { LlmBrain, llmDecision, registerLlmAgents, llmSummary, defaultLlmId, llmBrainFor } = await import("../static/js/brain/llm.js");
const { agentDefinitions, agentAvailable, agentOptionLabel } = await import("../static/js/brain/registry.js");

const map = new MapData(JSON.parse(fs.readFileSync(new URL("../data/maps/623b012bc8b5.v6.pack.json", import.meta.url))));
let assertions = 0;
async function test(name, fn) { await fn(); assertions++; console.log(`✓ ${name}`); }

// The decision request the autopilot would build at the start of a challenge.
function decisionRequest(challenge = CHALLENGES[0]) {
  const { world } = setupChallenge(map, challenge);
  const snap = buildSnapshot(world, null);
  const candidates = sampleCandidates(snap, world);
  const { eligible, rejected } = simulateAll(candidates, snap, world);
  const state = toJevState(snap, candidates, { rejected }, "test style");
  const { questions, local } = buildQuestions(snap, eligible, {});
  return { snap, eligible, request: { epoch: 0, state, questions, local, candidates, eligible, flags: [] } };
}

const ENDPOINT = { id: "llm:mock", name: "mock", label: "Mock model", model: "mock-1", endpoint: "http://127.0.0.1:9/v1", usable: true, timeout_s: 2, api_key_env: null };
const NO_KEY = { ...ENDPOINT, id: "llm:nokey", name: "nokey", label: "Keyless", usable: false, api_key_env: "MOCK_KEY" };
registerLlmAgents({ endpoints: [ENDPOINT, NO_KEY] });

// A stand-in for /api/llm/decide. `reply(body)` returns the server's JSON or { status, error }.
const calls = [];
function serve(reply) {
  globalThis.fetch = async (path, { body, signal } = {}) => {
    const parsed = JSON.parse(body);
    calls.push({ path, body: parsed });
    const out = await reply(parsed, signal);
    const status = out.status || 200;
    return { ok: status < 400, status, json: async () => (status < 400 ? out : { error: out.error }) };
  };
}
const meta = { model: "mock-1", endpoint: "mock", latency_ms: 42, input_tokens: 900, output_tokens: 9, cost_usd: 0.0002, cost_known: true, live_call: true };
const preferred = expect => expect.candidate?.find(id => id.endsWith("_target")) || expect.candidate?.[0];
const good = body => ({ tick: body.tick, epoch: body.epoch, invalid: null, meta, trace: { request: { model: "mock-1", messages: body.messages, url: "http://127.0.0.1:9/v1/chat/completions" }, response: {} },
  answer: { ...(body.expect.motion ? { motion: "drive" } : {}), ...(body.expect.candidate ? { candidate: preferred(body.expect) } : {}) } });

const { snap, eligible, request } = decisionRequest();
const prompt = buildLlmPrompt(snap, request);
const input = JSON.parse(prompt.messages[1].content);

await test("the prompt is a fixed system message plus the decision state as compact JSON", () => {
  assert.equal(prompt.messages.length, 2);
  assert.deepEqual(prompt.messages[0], { role: "system", content: SYSTEM_PROMPT });
  assert.equal(prompt.messages[1].role, "user");
  assert.ok(prompt.messages[1].content.length < 24 * 1024);
  assert.ok(!prompt.messages[1].content.includes("\n"), "compact JSON");
  assert.match(SYSTEM_PROMPT, /stop_at_line/); assert.match(SYSTEM_PROMPT, /at target/); assert.match(SYSTEM_PROMPT, /one JSON object/);
});
await test("the prompt carries what Jev sees: observations, situation rules and every eligible candidate", () => {
  assert.equal(input.driving_style, "test style");
  assert.ok(Array.isArray(input.situation));
  assert.ok(Number.isFinite(input.observed.car.speed) && input.observed.road);
  assert.ok(!("candidates" in input.observed) && !("units" in input.observed) && !("rejected" in input.observed));
  assert.ok(eligible.length >= 2);
  assert.deepEqual(input.candidates.map(c => c.id), eligible.map(c => c.id));
  for (const c of input.candidates) for (const key of ["steer", "speed", "end_speed", "vs_target", "progress_m", "outcome"]) assert.ok(key in c, `${c.id} ${key}`);
});
await test("the expected answer lists exactly the asked fields and offered ids", () => {
  assert.deepEqual(prompt.expect.candidate, Object.keys(request.questions.vector.criteria));
  assert.deepEqual(input.answer, prompt.expect);
  assert.equal("motion" in prompt.expect, !!request.questions.motion);
  assert.equal("motion_options" in input, !!request.questions.motion);
  const motionOnly = buildLlmPrompt(snap, { ...request, questions: { motion: { type: "choice", instructions: "x", criteria: { drive: "go", stop: "halt" } } } });
  assert.deepEqual(motionOnly.expect, { motion: ["drive", "stop"] });
  assert.ok(!("candidates" in JSON.parse(motionOnly.messages[1].content)));
  const routed = buildLlmPrompt(snap, { ...request, questions: { ...request.questions, route: { type: "choice", instructions: "x", criteria: { r1: "short", r2: "long" } } } });
  assert.deepEqual(routed.expect.route, ["r1", "r2"]);
});
await test("parsed answers become decisions; locally resolved questions keep their local answers", () => {
  const local = { motion: { type: "choice", choice: "drive", probabilities: { drive: 1 }, confidence: 1, local: true } };
  const d = llmDecision({ candidate: "keep_lane_target", reason: "clear road" }, { local }, { source: "llm:mock" });
  assert.equal(d.motion, "drive"); assert.equal(d.candidateId, "keep_lane_target");
  assert.equal(d.answers.motion.local, true); assert.equal(d.answers.vector.choice, "keep_lane_target");
  assert.equal(d.meta.reason, "clear road");
  const single = llmDecision({ motion: "stop" }, { local: { vector: { choice: "hard_brake" } } }, {});
  assert.deepEqual([single.motion, single.candidateId, single.routeId], ["stop", "hard_brake", null]);
  assert.equal(llmDecision({ candidate: "a", route: "r2" }, { local: {} }, {}).routeId, "r2");
});
await test("endpoints register as llm:<name> agents; missing keys are listed but unavailable", () => {
  const ids = agentDefinitions().map(a => a.id);
  assert.ok(ids.includes("llm:mock") && ids.includes("llm:nokey"));
  assert.ok(agentAvailable("llm:mock")); assert.ok(!agentAvailable("llm:nokey"));
  assert.match(agentOptionLabel(agentDefinitions().find(a => a.id === "llm:nokey")), /no key: set MOCK_KEY/);
  assert.deepEqual(registerLlmAgents({ endpoints: [ENDPOINT, NO_KEY] }), []);   // idempotent
  assert.equal(agentDefinitions().filter(a => a.id === "llm:mock").length, 1);
  assert.match(llmSummary({ llm: { endpoints: [ENDPOINT, NO_KEY], problems: [] } }), /Mock model \(mock-1\)/);
  assert.match(llmSummary({ demo: true }), /local app/);
  assert.match(llmSummary({ llm: { endpoints: [], problems: [], config_file: "data/llm-endpoints.json" } }), /data\/llm-endpoints\.json/);
});

const brain = new LlmBrain(ENDPOINT);
await test("the brain posts the prompt with the endpoint name only and returns the server's choice", async () => {
  serve(good); calls.length = 0;
  const d = await brain.decide(snap, eligible, request);
  assert.equal(calls[0].path, "/api/llm/decide");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["endpoint", "epoch", "expect", "messages", "tick"]);
  assert.equal(calls[0].body.endpoint, "mock");
  assert.ok(!JSON.stringify(calls[0].body).includes("127.0.0.1:9"), "the browser never sends a URL");
  assert.equal(d.candidateId, preferred(prompt.expect));
  assert.equal(d.meta.source, "llm:mock"); assert.equal(d.meta.live_call, true); assert.equal(d.meta.input_tokens, 900);
  assert.equal(brain.timeoutMs, 2750); assert.ok(brain.questionDriven);
});
await test("an unusable reply throws with its spend and trace attached", async () => {
  serve(body => ({ ...good(body), answer: null, invalid: "candidate \"teleport\" is not an eligible manoeuvre" }));
  await assert.rejects(brain.decide(snap, eligible, request), err => {
    assert.match(err.message, /invalid output: candidate "teleport"/);
    assert.equal(err.meta.input_tokens, 900); assert.ok(err.trace.request.messages);
    return true;
  });
  serve(() => ({ status: 429, error: "LLM endpoint 'mock': rate limited by the endpoint (429)" }));
  await assert.rejects(brain.decide(snap, eligible, request), err => err.status === 429 && /rate limited/.test(err.message));
});

// Through the autopilot: the same harness as Jev, with the fallback reason recorded.
async function firstDecision(reply, configure = () => {}) {
  serve(reply);
  const ctx = setupChallenge(map, CHALLENGES[0], { brain: "llm:mock" });
  configure(ctx.autopilot);
  ctx.autopilot.step(1 / 60, 0); await ctx.autopilot.firing;
  return ctx;
}
await test("a valid answer executes the chosen eligible candidate and counts the live call", async () => {
  const { autopilot, world } = await firstDecision(good);
  const d = autopilot.lastDecision;
  assert.equal(d.meta.source, "llm:mock"); assert.ok(d.candidates.find(c => c.id === d.chosenId)?.eligible);
  assert.equal(autopilot.totals.calls, 1); assert.equal(autopilot.totals.tokens, 900); assert.equal(world.violations.fallbacks, 0);
});
for (const [name, reply, configure, pattern] of [
  ["invalid output", body => ({ ...good(body), answer: null, invalid: "reply was not a JSON object" }), undefined, /invalid output: reply was not a JSON object/],
  ["a malformed completion", body => ({ ...good(body), answer: null, invalid: "malformed completion (no choices)" }), undefined, /invalid output: malformed completion/],
  ["an HTTP error", () => ({ status: 502, error: "LLM endpoint 'mock': HTTP 500: overloaded" }), undefined, /HTTP 500/],
  ["an exhausted budget", () => ({ status: 402, error: "This server run has spent its $1.00 budget" }), undefined, /budget/],
  ["a timeout", (body, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))), a => { a.brain.timeoutMs = 40; }, /timeout after 40 ms/],
]) {
  await test(`${name} falls back to Rules and records why`, async () => {
    const { autopilot, world } = await firstDecision(reply, configure);
    const d = autopilot.lastDecision;
    assert.equal(d.meta.source, "rules_fallback"); assert.match(d.meta.error, pattern);
    assert.ok(d.candidates.find(c => c.id === d.chosenId)?.eligible);
    assert.equal(world.violations.fallbacks, 1);
    if (/invalid|malformed/.test(name)) {   // the call happened: it counts its call, tokens and cost
      assert.equal(d.meta.input_tokens, 900); assert.equal(autopilot.totals.calls, 1); assert.ok(d.trace.request.messages);
      assert.equal(autopilot.totals.tokens, 900); assert.equal(autopilot.totals.cost, 0.0002);
    }
  });
}
await test("an arena evaluation runs the LLM agent in lockstep and reports its calls and tokens", async () => {
  serve(good); calls.length = 0;
  const result = await evaluateChallenge(map, CHALLENGES[0], { brain: "llm:mock", limit: 4 });
  assert.equal(result.brain, "llm:mock");
  assert.ok(result.calls > 0 && result.calls === calls.length, `${result.calls} calls`);
  assert.equal(result.tokens, 900 * result.calls);
  assert.ok(result.decisions_trace.some(d => d.source === "llm:mock"));
  assert.equal(result.fallbacks, 0);
});
await test("the setup dialog's changes add, update and remove drivers, and the LLM button picks a sensible default", async () => {
  assert.equal(defaultLlmId("llm:nokey"), "llm:mock");   // a remembered model without a key is skipped
  assert.equal(defaultLlmId("llm:gone"), "llm:mock");
  const added = { ...ENDPOINT, id: "llm:luna", name: "luna", label: "GPT-6 Luna (OpenRouter)", model: "openai/gpt-6-luna" };
  assert.deepEqual(registerLlmAgents({ endpoints: [ENDPOINT, NO_KEY, added] }), ["llm:luna"]);
  assert.equal(defaultLlmId("llm:luna"), "llm:luna");
  assert.deepEqual(registerLlmAgents({ endpoints: [ENDPOINT, NO_KEY, added] }), []);   // unchanged: brains are kept
  const moved = { ...added, model: "openai/gpt-6-luna-20260922", timeout_s: 15 };
  assert.deepEqual(registerLlmAgents({ endpoints: [ENDPOINT, NO_KEY, moved] }), ["llm:luna"]);
  assert.equal(agentDefinitions().find(d => d.id === "llm:luna").llm.model, "openai/gpt-6-luna-20260922");
  assert.equal(llmBrainFor("llm:luna").timeoutMs, 15750);   // a fresh brain uses the new settings
  assert.deepEqual(registerLlmAgents({ endpoints: [ENDPOINT, NO_KEY] }), ["llm:luna"]);
  assert.ok(!agentDefinitions().some(d => d.id === "llm:luna"));
  assert.equal(llmBrainFor("llm:luna"), null);
  assert.ok(agentDefinitions().some(d => d.id === "rules") && agentDefinitions().some(d => d.id === "jev"));   // built-ins stay
});
console.log(`${assertions} LLM agent checks passed.`);
process.exit(0);   // the runner's MessageChannel would otherwise keep Node alive
