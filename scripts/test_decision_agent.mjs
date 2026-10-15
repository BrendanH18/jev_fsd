// Decision-model drivers in the browser: registration, the Decision button's default, answer handling
// and the Rules fallback. node --experimental-default-type=module scripts/test_decision_agent.mjs
// (no server, no network: /api/decision/decide is a stand-in).
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions } = await import("../static/js/brain/state.js");
const { DecisionBrain, registerDecisionAgents, defaultDecisionId, decisionBrainFor, decisionIds, decisionSummary } = await import("../static/js/brain/decision.js");
const { agentDefinitions, agentAvailable, agentOptionLabel, isDecisionAgent, pillarOf } = await import("../static/js/brain/registry.js");

const map = new MapData(JSON.parse(fs.readFileSync(new URL("../data/maps/623b012bc8b5.v5.pack.json", import.meta.url))));
let assertions = 0;
async function test(name, fn) { await fn(); assertions++; console.log(`✓ ${name}`); }

function decisionRequest(challenge = CHALLENGES[0]) {
  const { world } = setupChallenge(map, challenge);
  const snap = buildSnapshot(world, null);
  const candidates = sampleCandidates(snap, world);
  const { eligible, rejected } = simulateAll(candidates, snap, world);
  const state = toJevState(snap, candidates, { rejected }, "test style");
  const { questions, local } = buildQuestions(snap, eligible, {});
  return { snap, eligible, request: { epoch: 0, state, questions, local, candidates, eligible, flags: [] } };
}

const D1 = { id: "decision:d1", name: "d1", label: "LiquidAI: d1 (OpenRouter)", model: "liquid/d1", endpoint: "https://openrouter.ai", path: "/api/alpha/decisions",
  usable: true, timeout_s: 2, api_key_env: "OPENROUTER_API_KEY" };
const NO_KEY = { ...D1, id: "decision:nokey", name: "nokey", label: "Keyless", usable: false, api_key_env: "MOCK_KEY" };
const JEV_OFF = { configured: false, model: "jev-latest" };

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
const meta = { model: "liquid/d1", endpoint: "d1", latency_ms: 31, input_tokens: 1800, output_tokens: 0, cost_usd: 0.000036, cost_known: true, live_call: true };
// System One answers: the last option of each question with most of the probability.
const answersFor = questions => Object.fromEntries(Object.entries(questions).map(([qid, q]) => {
  const options = Object.keys(q.criteria), choice = qid === "motion" ? "drive" : options.find(id => id.endsWith("_target")) || options[0];
  return [qid, { type: "choice", choice, probabilities: Object.fromEntries(options.map(o => [o, o === choice ? 0.9 : 0.1 / Math.max(1, options.length - 1)])), confidence: 0.8 }];
}));
const good = body => ({ tick: body.tick, epoch: body.epoch, invalid: null, answers: answersFor(body.questions), meta,
  trace: { request: { model: "liquid/d1", state: body.state, questions: body.questions, url: "https://openrouter.ai/api/alpha/decisions", api_key_env: "OPENROUTER_API_KEY" }, response: {} } });

registerDecisionAgents({ endpoints: [D1, NO_KEY], jev: JEV_OFF });
const { snap, eligible, request } = decisionRequest();

await test("Jev and every decision:<name> are the Decision pillar; llm:<name> and Rules are not", () => {
  assert.ok(isDecisionAgent("jev") && isDecisionAgent("decision:d1"));
  assert.ok(!isDecisionAgent("rules") && !isDecisionAgent("llm:luna") && !isDecisionAgent("cautious"));
  assert.deepEqual(["jev", "decision:d1", "llm:luna", "rules", "cautious"].map(pillarOf), ["decision", "decision", "llm", "rules", "cautious"]);
});
await test("endpoints register as decision:<name> agents; Jev and missing keys are listed but unavailable", () => {
  assert.deepEqual(decisionIds(), ["jev", "decision:d1", "decision:nokey"]);
  assert.ok(agentAvailable("decision:d1")); assert.ok(!agentAvailable("decision:nokey")); assert.ok(!agentAvailable("jev"));
  assert.match(agentOptionLabel(agentDefinitions().find(a => a.id === "jev")), /no TypeSafe key/);
  assert.deepEqual(registerDecisionAgents({ endpoints: [D1, NO_KEY], jev: JEV_OFF }), []);   // idempotent
  registerDecisionAgents({}, { demo: true });
  assert.match(agentOptionLabel(agentDefinitions().find(a => a.id === "jev")), /needs the local app/);
  assert.ok(!agentDefinitions().some(a => a.decision));   // the demo lists no endpoints
  registerDecisionAgents({ endpoints: [D1, NO_KEY], jev: JEV_OFF });
});
await test("the Decision button prefers the remembered model, then Jev, then the first usable one", () => {
  assert.equal(defaultDecisionId(null), "decision:d1");             // Jev has no key yet
  assert.equal(defaultDecisionId("decision:nokey"), "decision:d1"); // a remembered model without a key is skipped
  registerDecisionAgents({ endpoints: [D1, NO_KEY], jev: { configured: true, model: "jev-latest" } });
  assert.ok(agentAvailable("jev"));
  assert.equal(defaultDecisionId(null), "jev");
  assert.equal(defaultDecisionId("decision:d1"), "decision:d1");
  assert.equal(defaultDecisionId("decision:gone"), "jev");
  registerDecisionAgents({ endpoints: [NO_KEY], jev: JEV_OFF });
  assert.equal(defaultDecisionId(null), "jev");                     // nothing usable: Jev, to offer its key
  registerDecisionAgents({ endpoints: [D1, NO_KEY], jev: JEV_OFF });
});
await test("the summary names Jev's state and the connected models", () => {
  const text = decisionSummary({ decision: { endpoints: [D1, NO_KEY], problems: [], jev: JEV_OFF } });
  assert.match(text, /Jev · no TypeSafe key yet/); assert.match(text, /LiquidAI: d1 \(OpenRouter\) \(liquid\/d1\)/);
  assert.match(decisionSummary({ demo: true }), /local app/);
});

const brain = new DecisionBrain(D1);
await test("the brain posts Jev's state and questions with the endpoint name only", async () => {
  serve(good); calls.length = 0;
  const d = await brain.decide(snap, eligible, request);
  assert.equal(calls[0].path, "/api/decision/decide");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["endpoint", "epoch", "questions", "state", "tick"]);
  assert.equal(calls[0].body.endpoint, "d1");
  assert.equal(JSON.stringify(calls[0].body.state), JSON.stringify(request.state));   // exactly what Jev is sent
  assert.equal(JSON.stringify(calls[0].body.questions), JSON.stringify(request.questions));
  assert.ok(!JSON.stringify(calls[0].body).includes("openrouter.ai"), "the browser never sends a URL");
  assert.ok(eligible.some(c => c.id === d.candidateId));
  assert.equal(d.answers.vector.probabilities[d.candidateId], 0.9);
  assert.equal(d.meta.source, "decision:d1"); assert.equal(d.meta.live_call, true);
  assert.equal(brain.timeoutMs, 2750); assert.ok(brain.questionDriven);
});
await test("an invalid answer throws with its spend and trace attached; HTTP errors keep their status", async () => {
  serve(body => ({ ...good(body), answers: {}, invalid: "the answer for vector, \"fly\", is not one of the options" }));
  await assert.rejects(brain.decide(snap, eligible, request), err => {
    assert.match(err.message, /invalid answer: the answer for vector/);
    assert.equal(err.meta.input_tokens, 1800); assert.ok(err.trace.request.questions);
    return true;
  });
  serve(() => ({ status: 402, error: "Decision endpoint 'd1': the provider says this account is out of credits (402)" }));
  await assert.rejects(brain.decide(snap, eligible, request), err => err.status === 402 && /out of credits/.test(err.message));
});

async function firstDecision(reply, configure = () => {}) {
  serve(reply);
  const ctx = setupChallenge(map, CHALLENGES[0], { brain: "decision:d1" });
  configure(ctx.autopilot);
  ctx.autopilot.step(1 / 60, 0); await ctx.autopilot.firing;
  return ctx;
}
await test("through the autopilot a valid answer executes and counts the live call, as for Jev", async () => {
  const { autopilot, world } = await firstDecision(good);
  const d = autopilot.lastDecision;
  assert.equal(autopilot.brainName, "decision:d1");
  assert.equal(d.meta.source, "decision:d1"); assert.ok(d.candidates.find(c => c.id === d.chosenId)?.eligible);
  assert.equal(autopilot.totals.calls, 1); assert.equal(autopilot.totals.tokens, 1800); assert.equal(world.violations.fallbacks, 0);
});
await test("a vector outside the eligible set keeps the model's motion and takes the Rules manoeuvre", async () => {
  const { autopilot, world } = await firstDecision(body => {
    const out = good(body);
    if (out.answers.vector) out.answers.vector.choice = "not_eligible";   // the server checks options, not eligibility
    return out;
  });
  const d = autopilot.lastDecision;
  assert.ok(d.questions.vector, "the first decision asks for a manoeuvre");
  assert.equal(d.meta.source, "decision:d1"); assert.equal(d.meta.fallback, "invalid vector"); assert.equal(world.violations.fallbacks, 1);
  assert.ok(d.candidates.find(c => c.id === d.chosenId)?.eligible);
});
await test("an answer without a route keeps the first route and stops asking; a fallback asks again", async () => {
  const routes = [{ id: "r0", summary: "shortest" }, { id: "r1", summary: "via Broadway" }];
  const asked = [];
  for (const [reply, cleared] of [[body => ({ ...good(body), answers: { ...good(body).answers, route: undefined } }), true],
                                  [() => ({ status: 502, error: "Decision endpoint 'd1': HTTP 500" }), false]]) {
    const { autopilot, world } = await firstDecision(reply, a => { a.pendingRoutes = routes; });
    asked.push(calls.at(-1).body.questions.route?.criteria);
    assert.equal(autopilot.pendingRoutes, cleared ? null : routes);
    assert.ok(world.route, "the car keeps the route it follows");
  }
  assert.deepEqual(Object.keys(asked[0]), ["r0", "r1"]);
  const { autopilot, world } = setupChallenge(map, CHALLENGES[0], { brain: "decision:d1" });   // nothing eligible: a local stop
  const snap0 = buildSnapshot(world, null), candidates = sampleCandidates(snap0, world);
  autopilot.pendingRoutes = routes;
  autopilot.apply({ motion: "stop", candidateId: "hard_brake", meta: { source: "local" }, answers: {} }, snap0, candidates,
    { state: {}, questions: { route: { type: "choice", instructions: "x", criteria: { r0: null, r1: null } } }, flags: [] });
  assert.equal(autopilot.pendingRoutes, routes, "an emergency stop never asked the model, so the route question stays");
});
for (const [name, reply, configure, pattern] of [
  ["an invalid answer", body => ({ ...good(body), answers: {}, invalid: "the reply has no answers" }), undefined, /invalid answer: the reply has no answers/],
  ["an HTTP error", () => ({ status: 502, error: "Decision endpoint 'd1': HTTP 422: noul criteria must be strings" }), undefined, /HTTP 422/],
  ["a timeout", (body, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))), a => { a.brain.timeoutMs = 40; }, /timeout after 40 ms/],
]) {
  await test(`${name} falls back to Rules and records why`, async () => {
    const { autopilot, world } = await firstDecision(reply, configure);
    const d = autopilot.lastDecision;
    assert.equal(d.meta.source, "rules_fallback"); assert.match(d.meta.error, pattern);
    assert.ok(d.candidates.find(c => c.id === d.chosenId)?.eligible);
    assert.equal(world.violations.fallbacks, 1);
    if (name === "an invalid answer") {   // the call happened: it counts its call, tokens and cost
      assert.equal(autopilot.totals.calls, 1); assert.equal(autopilot.totals.tokens, 1800); assert.ok(d.trace.request.questions);
    }
  });
}
await test("an arena evaluation runs a decision model in lockstep and reports its calls and tokens", async () => {
  serve(good); calls.length = 0;
  const result = await evaluateChallenge(map, CHALLENGES[0], { brain: "decision:d1", limit: 4 });
  assert.equal(result.brain, "decision:d1");
  assert.ok(result.calls > 0 && result.calls === calls.length, `${result.calls} calls`);
  assert.equal(result.tokens, 1800 * result.calls);
  assert.equal(result.fallbacks, 0);
});
await test("the setup dialog's changes add, update and remove decision drivers; Jev stays", () => {
  const added = { ...D1, id: "decision:jev-preview", name: "jev-preview", label: "Jev preview (TypeSafe)", model: "jev-preview", endpoint: "https://api.typesafe.ai", path: "/v1/systemone" };
  assert.deepEqual(registerDecisionAgents({ endpoints: [D1, NO_KEY, added], jev: JEV_OFF }), ["decision:jev-preview"]);
  const moved = { ...added, timeout_s: 4 };
  assert.deepEqual(registerDecisionAgents({ endpoints: [D1, NO_KEY, moved], jev: JEV_OFF }), ["decision:jev-preview"]);
  assert.equal(decisionBrainFor("decision:jev-preview").timeoutMs, 4750);
  assert.deepEqual(registerDecisionAgents({ endpoints: [D1, NO_KEY], jev: JEV_OFF }), ["decision:jev-preview"]);
  assert.equal(decisionBrainFor("decision:jev-preview"), null);
  assert.ok(agentDefinitions().some(d => d.id === "jev") && agentDefinitions().some(d => d.id === "rules"));
});
console.log(`${assertions} decision agent checks passed.`);
process.exit(0);   // the runner's MessageChannel would otherwise keep Node alive
