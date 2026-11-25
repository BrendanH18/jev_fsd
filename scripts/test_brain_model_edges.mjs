import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { decisionResult, JevBrain } from "../static/js/brain/jev.js";
import { LlmBrain, llmDecision, registerLlmAgents, checkLlmEndpoints } from "../static/js/brain/llm.js";
import { registerDecisionAgents } from "../static/js/brain/decision.js";
import { checkedStatus } from "../static/js/brain/endpoints.js";
import { agentAvailable, agentDefinition } from "../static/js/brain/registry.js";
import { MapData } from "../static/js/map/mapdata.js";
import { CHALLENGES } from "../static/js/lab/challenges.js";
import { setupChallenge } from "../static/js/lab/evaluation.js";
import { stepWorld } from "../static/js/sim/step.js";

globalThis.document = { querySelector: () => null };
let checks = 0;
async function test(name, run) {
  await run();
  checks++;
  console.log(name);
}
const endpoint = {
  id: "llm:edges",
  name: "edges",
  label: "Edge-case endpoint",
  model: "stub",
  endpoint: "http://127.0.0.1:9/v1",
  usable: true,
  timeout_s: 1,
};
const choose = (choice) => ({ type: "choice", choice, confidence: 0.8, probabilities: { [choice]: 0.8 } });
const question = (...ids) => ({
  type: "choice",
  instructions: "Choose an option.",
  criteria: Object.fromEntries(ids.map((id) => [id, id])),
});
const request = {
  epoch: 3,
  state: { candidates: [{ id: "keep" }, { id: "slow" }] },
  questions: {
    motion: question("drive", "stop"),
    vector: question("keep", "slow"),
    headlights: question("high", "low"),
    route: question("a", "b"),
  },
};
const required = { motion: "drive", candidate: "keep" };
const full = { motion: choose("drive"), vector: choose("keep"), headlights: choose("low"), route: choose("a") };
const eligible = [{ id: "keep" }, { id: "slow" }];
const meta = { input_tokens: 55, latency_ms: 20 };
const trace = { response: "provider payload" };
const snap = { tick: 3, road: { on_road: true }, traffic: [] };
const decideLlm = (res, req = request) => {
  const brain = new LlmBrain(endpoint);
  brain.transport = async () => res;
  return brain.decide(snap, eligible, req);
};

await test("Jev keeps the locally resolved motion even if a reply supplies another value", () => {
  const local = { motion: choose("drive") };
  const result = decisionResult(
    { answers: { ...full, motion: choose("stop") } },
    { ...request, local },
    eligible,
    meta,
  );
  assert.equal(result.motion, "drive");
  assert.equal(result.answers.motion, local.motion);
});
await test("Jev keeps the sole locally selected vector even if the model names another eligible vector", () => {
  const local = { vector: choose("slow") };
  const result = decisionResult({ answers: full }, { ...request, local }, eligible, meta);
  assert.equal(result.candidateId, "slow");
});
await test("Jev reports a malformed answers envelope with its spend and provider trace attached", async () => {
  const jev = new JevBrain();
  jev.transport = async () => ({ answers: [], meta, trace });
  await assert.rejects(
    jev.decide(snap, eligible, request),
    (err) =>
      /missing answers object/.test(err.message) &&
      err.meta.live_call &&
      err.meta.input_tokens === 55 &&
      err.trace === trace,
  );
});
await test("Jev requires a motion answer when motion was asked and preserves metadata on fallback", () => {
  assert.throws(
    () => decisionResult({ answers: { vector: full.vector } }, request, eligible, meta),
    (err) => /missing or invalid motion/.test(err.message) && err.meta.input_tokens === 55,
  );
});
await test("Jev rejects a motion value outside the current question's options", () => {
  assert.throws(
    () => decisionResult({ answers: { ...full, motion: choose("reverse") } }, request, eligible, meta),
    /missing or invalid motion/,
  );
});
await test("Jev treats a malformed vector object as an invalid vector rather than applying no manoeuvre", () => {
  const result = decisionResult({ answers: { ...full, vector: {} } }, request, eligible, meta);
  assert.equal(result.candidateId, null);
});
await test("Jev refuses a vector listed in the question when it is absent from the eligible set", () => {
  const result = decisionResult({ answers: full }, request, [{ id: "slow" }], meta);
  assert.equal(result.candidateId, null);
});
await test("Jev defers to the active route when a reply names a route outside the question", () => {
  const result = decisionResult({ answers: { ...full, route: choose("c") } }, request, eligible, meta);
  assert.equal(result.routeId, null);
  assert.equal(Object.hasOwn(result.answers, "route"), false);
});
await test("Jev defers to the default beam when a reply names a beam outside the question", () => {
  const result = decisionResult({ answers: { ...full, headlights: choose("off") } }, request, eligible, meta);
  assert.equal(Object.hasOwn(result.answers, "headlights"), false);
});
await test("Jev preserves provider confidence and probabilities on a valid choice", () => {
  const result = decisionResult({ answers: full }, request, eligible, meta);
  assert.equal(result.answers.vector.confidence, 0.8);
  assert.deepEqual(result.answers.vector.probabilities, { keep: 0.8 });
});
await test("Jev ignores unsolicited optional route and headlight answers", () => {
  const result = decisionResult(
    { answers: full },
    { questions: { motion: request.questions.motion, vector: request.questions.vector } },
    eligible,
    meta,
  );
  assert.deepEqual(Object.keys(result.answers), ["motion", "vector"]);
  assert.equal(result.routeId, null);
});
await test("Jev ignores inherited object names in a model's choice", () => {
  const result = decisionResult(
    { answers: { ...full, vector: choose("constructor") } },
    request,
    [...eligible, { id: "constructor" }],
    meta,
  );
  assert.equal(result.candidateId, null);
});
await test("LLM decisions reject malformed answer envelopes with a readable error and the original trace", async () => {
  await assert.rejects(
    decideLlm({ answer: [], trace, meta }),
    (err) => /missing answer object/.test(err.message) && err.trace === trace && err.meta.input_tokens === 55,
  );
});
await test("LLM decisions honour a server invalid-output verdict even if the envelope contains an answer", async () => {
  await assert.rejects(decideLlm({ answer: required, invalid: "provider refusal" }), /provider refusal/);
});
await test("LLM decisions reject missing required motion before the local default can mask it", async () => {
  await assert.rejects(decideLlm({ answer: { candidate: "keep" } }), /missing or invalid motion/);
});
await test("LLM decisions reject a required manoeuvre outside the asked options", async () => {
  await assert.rejects(decideLlm({ answer: { ...required, candidate: "steer_away" } }), /missing or invalid candidate/);
});
await test("LLM decisions ignore unsolicited primary answers when the only question is about headlights", async () => {
  const local = { motion: choose("drive"), vector: choose("slow") };
  const req = { ...request, local, questions: { headlights: request.questions.headlights } };
  const result = await decideLlm({ answer: { motion: "stop", candidate: "keep", headlights: "low" } }, req);
  assert.deepEqual([result.motion, result.candidateId, result.answers.headlights.choice], ["drive", "slow", "low"]);
});
await test("LLM decisions ignore invalid optional answers while still executing valid motion and vector choices", async () => {
  const result = await decideLlm({ answer: { ...required, route: "missing", headlights: "off" } });
  assert.deepEqual(Object.keys(result.answers), ["motion", "vector"]);
  assert.equal(result.routeId, null);
});
await test("LLM decisions limit the provider reason retained in decision metadata", async () => {
  const result = await decideLlm({ answer: { ...required, reason: "r".repeat(500) } });
  assert.equal(result.meta.reason.length, 200);
});
await test("The LLM decision adapter preserves a locally chosen route in its applied result", () => {
  const local = { route: choose("b") };
  assert.equal(llmDecision({ route: "a" }, { local }, meta).routeId, "b");
});

const sync = (e = endpoint) => registerLlmAgents({ endpoints: [e] });
const reply = (status) => ({ endpoints: [{ name: "edges", status }] });
const serve = (response) => {
  globalThis.fetch = async () => ({ ok: true, json: async () => response });
};
function pendingProbe() {
  let resolve;
  globalThis.fetch = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = checkLlmEndpoints();
  return { pending, respond: (result) => resolve({ ok: true, json: async () => result }) };
}
await test("Endpoint refresh retains the probe label through a stats-only update", async () => {
  sync();
  serve(reply("unreachable"));
  await checkLlmEndpoints();
  assert.deepEqual(sync({ ...endpoint, input_tokens: 55 }), []);
  assert.equal(checkedStatus(endpoint.id), "unreachable");
  assert.equal(agentDefinition(endpoint.id).note, "unreachable");
});
await test("An older probe finishing later cannot overwrite a newer endpoint status", async () => {
  const old = pendingProbe();
  const fresh = pendingProbe();
  fresh.respond(reply("ready"));
  await fresh.pending;
  old.respond(reply("key rejected"));
  await old.pending;
  assert.equal(checkedStatus(endpoint.id), "ready");
});
await test("An in-flight probe cannot restore the check status of a removed endpoint", async () => {
  const old = pendingProbe();
  registerLlmAgents({ endpoints: [] });
  old.respond(reply("ready"));
  await old.pending;
  assert.equal(checkedStatus(endpoint.id), undefined);
  assert.equal(agentDefinition(endpoint.id), undefined);
});
await test("A probe for an old model cannot label that endpoint after its model is replaced", async () => {
  sync();
  const old = pendingProbe();
  sync({ ...endpoint, model: "replacement" });
  old.respond(reply("unreachable"));
  await old.pending;
  assert.equal(checkedStatus(endpoint.id), undefined);
});
await test("Changing the configured key variable invalidates the prior reachability result", async () => {
  serve(reply("ready"));
  await checkLlmEndpoints();
  assert.deepEqual(sync({ ...endpoint, model: "replacement", api_key_env: "NEXT_KEY" }), [endpoint.id]);
  assert.equal(checkedStatus(endpoint.id), undefined);
});
await test("A stale ready status cannot make an endpoint available while it lacks its configured key", async () => {
  sync({ ...endpoint, usable: false });
  serve(reply("ready"));
  await checkLlmEndpoints();
  assert.equal(agentAvailable(endpoint.id), false);
  assert.equal(agentDefinition(endpoint.id).note, "no key");
});
await test("An unrecognised status value cannot replace an actionable endpoint probe result", async () => {
  sync();
  serve(reply("error"));
  await checkLlmEndpoints();
  serve(reply("bad status"));
  await checkLlmEndpoints();
  assert.equal(checkedStatus(endpoint.id), "error");
});
await test("Endpoint probes report a malformed response without losing the last known status", async () => {
  serve({ bad: true });
  await assert.rejects(checkLlmEndpoints(), /Invalid endpoint check response/);
  assert.equal(checkedStatus(endpoint.id), "error");
});
await test("An endpoint definition cannot replace a built-in driver or a driver in the other pillar", () => {
  assert.deepEqual(registerDecisionAgents({ endpoints: [{ ...endpoint, id: "rules" }, endpoint] }), []);
  assert.equal(agentDefinition("rules").builtin, true);
  assert.equal(agentDefinition(endpoint.id).decision, null);
});
await test("Duplicate endpoint definitions are reconciled using the last entry", () => {
  const replaced = { ...endpoint, label: "last configuration" };
  assert.deepEqual(registerLlmAgents({ endpoints: [endpoint, replaced] }), [endpoint.id]);
  assert.equal(agentDefinition(endpoint.id).label, replaced.label);
});

const dir = new URL("../data/maps/", import.meta.url);
const key = "623b012bc8b5";
const pack = JSON.parse(readFileSync(new URL(`${key}.v6.pack.json`, dir)));
for (const name of readdirSync(dir)
  .filter((name) => name.startsWith(`${key}.`) && /\.v[12]\.json$/.test(name))
  .sort()) {
  const [, layer] = name.split(".");
  pack[layer] = JSON.parse(readFileSync(new URL(name, dir)));
}
const map = new MapData(pack);
function makeDrive(decide) {
  const ctx = setupChallenge(map, CHALLENGES[0]);
  ctx.autopilot.brains.custom = { decide };
  ctx.autopilot.setBrain("custom");
  return ctx;
}
function fire(autopilot) {
  autopilot.step(1 / 60, 0);
  return autopilot.firing;
}
const valid = (_snap, choices) => ({ motion: "drive", candidateId: choices[0].id });
await test("The autopilot skips inherited properties when selecting a driver", () => {
  const { autopilot } = makeDrive(valid);
  autopilot.setBrain("constructor");
  assert.equal(autopilot.brainName, "custom");
});
await test("A valid frozen agent result can be applied without mutating the agent's metadata", async () => {
  const result = Object.freeze({ source: "immutable", input_tokens: 5 });
  const { autopilot } = makeDrive((s, choices) => Object.freeze({ ...valid(s, choices), meta: result }));
  await fire(autopilot);
  assert.equal(autopilot.lastDecision.meta.source, "immutable");
  assert.equal(Object.hasOwn(result, "latency_ms"), false);
  assert.equal(autopilot.totals.tokens, 5);
});
await test("A non-Error rejection is displayed as a fallback and leaves the request slot free", async () => {
  const { autopilot, world } = makeDrive(() => {
    throw "driver disconnected";
  });
  await fire(autopilot);
  assert.equal(autopilot.lastDecision.meta.error, "driver disconnected");
  assert.equal(world.violations.fallbacks, 1);
  assert.equal(autopilot.inFlight, null);
});
await test("A malformed provider failure cannot corrupt accumulated spend or latency", async () => {
  const { autopilot } = makeDrive(() => {
    throw Object.assign(new Error("invalid output"), {
      meta: { live_call: true, input_tokens: "unknown", cost_usd: -1, latency_ms: Infinity },
    });
  });
  await fire(autopilot);
  assert.equal(autopilot.totals.calls, 1);
  assert.equal(autopilot.totals.tokens, 0);
  assert.equal(autopilot.totals.cost, 0);
  assert.equal(autopilot.lastDecision.meta.latency_ms, 0);
});
await test("Decision diagnostics identify the applied driver and fallback paths independently of provider metadata", async () => {
  for (const [decide, by] of [
    [valid, "model"],
    [() => ({}), "fallback"],
  ]) {
    const { autopilot } = makeDrive(decide);
    await fire(autopilot);
    assert.equal(autopilot.lastDecision.decidedBy, by);
  }
  const { autopilot } = makeDrive(valid);
  autopilot.setBrain("rules");
  await fire(autopilot);
  assert.equal(autopilot.lastDecision.decidedBy, "local");
});
await test("A local Rules decision failure fails the step it happens in", async () => {
  const ctx = makeDrive(valid);
  const { autopilot, world } = ctx;
  autopilot.setBrain("rules");
  autopilot.onDecision = () => {
    throw new Error("local decision failed");
  };
  assert.throws(() => stepWorld(ctx, 1 / 60, 0), /local decision failed/);
  assert.equal(autopilot.totals.decisions, 1);
  assert.equal(world.violations.fallbacks, 0);
  assert.equal(autopilot.stepFailure, undefined);
});
await test("A decision observer failure reaches the next live step and also rejects in lockstep", async () => {
  const ctx = makeDrive(valid);
  const { autopilot, world } = ctx;
  autopilot.onDecision = () => {
    autopilot.bumpEpoch();
    throw new Error("observer failed");
  };
  stepWorld(ctx, 1 / 60, 0);
  await new Promise((resolve) => setImmediate(resolve));
  const t = world.t;
  assert.throws(() => stepWorld(ctx, 1 / 60, t * 1000), /observer failed/);
  assert.equal(world.t, t);
  await assert.rejects(autopilot.firing, /observer failed/);
  assert.equal(autopilot.totals.decisions, 1);
  assert.equal(autopilot.inFlight, null);
  assert.equal(world.violations.fallbacks, 0);
});

console.log(`${checks} model edge checks passed.`);
process.exit(0);
