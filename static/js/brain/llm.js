// LLM endpoint drivers. Every OpenAI-compatible endpoint configured on the server
// (data/llm-endpoints.json or JEV_FSD_LLM_* in .env) becomes an agent `llm:<name>`. The prompt is
// built here in the browser (llm-prompt.js); the server holds the URL and key, calls the endpoint,
// enforces the shared budget and rate limit, and parses the reply (jev/llm.py).
//
// Like Jev, the model only picks among candidates that passed the safety filter. An unusable reply
// (not JSON, an id that was not offered), a timeout, an HTTP error or an exhausted budget falls back
// to Rules for that decision; the reason shows in the HUD, the Inspect drawer and arena timelines.

import { api } from "../common.js";
import { agentDefinition, agentDefinitions } from "./registry.js";
import { syncEndpointAgents, checkEndpoints, checkedStatus, defaultFrom } from "./endpoints.js";
import { buildLlmPrompt } from "./llm-prompt.js";

import {
  callModel,
  checkCoordinates,
  endpointTimeout,
  invalidRequest,
  isObject,
  limitedText,
  own,
  replyError,
} from "./model-contract.js";

export class LlmBrain {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.name = endpoint.id;
    this.questionDriven = true; // like Jev: nothing to ask means a local decision, no call
    this.transport = api; // the server call; a model recording (recording.js) swaps it
    this.timeoutMs = endpointTimeout(endpoint.timeout_s, 10);
  }

  async decide(snap, eligible, request, signal) {
    signal?.throwIfAborted();
    const body = { endpoint: this.endpoint.name, tick: snap.tick ?? 0, epoch: request.epoch ?? 0 };
    checkCoordinates(body);
    const { messages, expect } = buildLlmPrompt(snap, request);
    if (!Object.keys(expect).length) invalidRequest("at least one question is required");
    if (expect.candidate?.some((id) => !eligible.some((c) => c.id === id)))
      invalidRequest("a candidate choice is outside the eligible set");
    const { response, meta, trace, invalid } = await callModel(
      this,
      "/api/llm/decide",
      { ...body, messages, expect },
      signal,
    );
    const raw = own(response, "answer");
    if (!isObject(raw)) invalid(replyError(response) ?? "missing answer object");
    const answer = {};
    for (const [field, choices] of Object.entries(expect)) {
      const choice = own(raw, field);
      if (choices.includes(choice)) answer[field] = choice;
      else if (field === "motion" || field === "candidate") invalid(`missing or invalid ${field}`);
    }
    const reason = own(raw, "reason");
    if (typeof reason === "string") answer.reason = limitedText(reason, 200);
    return llmDecision(answer, request, meta, trace);
  }
}

// The server's parsed answer as an autopilot decision. Questions that were resolved locally (one
// eligible candidate, no motion question) keep their local answers, exactly as for Jev.
export function llmDecision(answer, request, meta, trace = null) {
  const local = request.local || {};
  const pick = (choice) => ({ type: "choice", choice, probabilities: { [choice]: 1 }, confidence: null });
  const answers = { ...local };
  for (const [field, question] of [
    ["motion", "motion"],
    ["candidate", "vector"],
    ["headlights", "headlights"],
    ["route", "route"],
  ]) {
    const choice = own(answer, field);
    if (typeof choice === "string" && choice && !Object.hasOwn(answers, question)) answers[question] = pick(choice);
  }
  if (typeof own(answer, "reason") === "string" && answer.reason) meta = { ...meta, reason: answer.reason };
  return {
    motion: answers.motion?.choice ?? "drive",
    candidateId: answers.vector?.choice ?? null,
    routeId: answers.route?.choice ?? null,
    answers,
    meta,
    trace,
  };
}

// Register the endpoints listed in /api/status (or returned by the setup dialog). Safe to call more
// than once: changed endpoints are updated and endpoints no longer configured are removed. The
// public demo has no server, so it lists none. Returns the ids that were added, changed or removed.
export const registerLlmAgents = (llm) => syncEndpointAgents("llm", llm?.endpoints ?? [], llmBrainFor);
export const llmBrainFor = (id) => {
  const e = agentDefinition(id)?.llm;
  return e ? new LlmBrain(e) : null;
};

// The LLM button drives with the last LLM chosen, else the first usable one.
export const defaultLlmId = (remembered) =>
  defaultFrom(
    agentDefinitions()
      .filter((d) => d.llm)
      .map((d) => d.id),
    remembered,
  );

// Probe the endpoints (GET /models on the server side: no tokens, no spend) and label each agent
// "ready", "unreachable", "key rejected" or "no key". Returns the statuses.
export const checkLlmEndpoints = () => checkEndpoints("llm:", "/api/llm/check");

// One line for Settings and the arena: what is configured and how to add more.
export function llmSummary(status) {
  if (status?.demo)
    return "LLM endpoint drivers need the local app (uv run server.py); this demo has no server to hold keys.";
  const llm = status?.llm;
  const problems = llm?.problems?.length ? ` Config problem: ${llm.problems[0]}` : "";
  if (!llm?.endpoints?.length)
    return `Test your own model: choose Connect a model, or list OpenAI-compatible endpoints in ${llm?.config_file || "data/llm-endpoints.json"} (see docs/agents.md).${problems}`;
  const parts = agentDefinitions()
    .filter((d) => d.llm)
    .map((d) => `${d.label} (${d.llm.model}) · ${checkedStatus(d.id) || d.note || "configured"}`);
  return `LLM endpoints: ${parts.join("; ")}.${problems}`;
}
