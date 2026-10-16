// LLM endpoint drivers. Every OpenAI-compatible endpoint configured on the server
// (data/llm-endpoints.json or JEV_FSD_LLM_* in .env) becomes an agent `llm:<name>`. The prompt is
// built here in the browser (llm-prompt.js); the server holds the URL and key, calls the endpoint,
// enforces the shared budget and rate limit, and parses the reply (jev/llm.py).
//
// Like Jev, the model only picks among candidates that passed the safety filter. An unusable reply
// (not JSON, an id that was not offered), a timeout, an HTTP error or an exhausted budget falls back
// to Rules for that decision; the reason shows in the HUD, the Inspect drawer and arena timelines.

import { api } from "../common.js";
import { agentDefinitions } from "./registry.js";
import { syncEndpointAgents, checkEndpoints, checkedStatus, defaultFrom } from "./endpoints.js";
import { buildLlmPrompt } from "./llm-prompt.js";

const TIMEOUT_MARGIN_MS = 750;   // the server's own timeout fires first and explains itself

export class LlmBrain {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.name = endpoint.id;
    this.questionDriven = true;   // like Jev: nothing to ask means a local decision, no call
    this.timeoutMs = Math.round((endpoint.timeout_s || 10) * 1000) + TIMEOUT_MARGIN_MS;
  }

  async decide(snap, eligible, request, signal) {
    const started = performance.now();
    const { messages, expect } = buildLlmPrompt(snap, request);
    const res = await api("/api/llm/decide", { endpoint: this.endpoint.name, tick: snap.tick || 0, epoch: request.epoch || 0, messages, expect }, { signal });
    const meta = { ...res.meta, source: this.name, live_call: true, round_trip_ms: Math.round(performance.now() - started) };
    // The call happened, so the error carries its tokens, cost and trace into the Rules fallback.
    if (!res.answer) throw Object.assign(new Error(`invalid output: ${res.invalid}`), { meta, trace: res.trace });
    return llmDecision(res.answer, request, meta, res.trace);
  }
}

// The server's parsed answer as an autopilot decision. Questions that were resolved locally (one
// eligible candidate, no motion question) keep their local answers, exactly as for Jev.
export function llmDecision(answer, request, meta, trace = null) {
  const local = request.local || {};
  const pick = choice => ({ type: "choice", choice, probabilities: { [choice]: 1 }, confidence: null });
  const answers = { ...local };
  if (answer.motion) answers.motion = pick(answer.motion);
  if (answer.candidate) answers.vector = pick(answer.candidate);
  if (answer.route) answers.route = pick(answer.route);
  if (answer.reason) meta = { ...meta, reason: answer.reason };
  return {
    motion: answer.motion || local.motion?.choice || "drive",
    candidateId: answer.candidate || local.vector?.choice || null,
    routeId: answer.route || null, answers, meta, trace,
  };
}

// Register the endpoints listed in /api/status (or returned by the setup dialog). Safe to call more
// than once: changed endpoints are updated and endpoints no longer configured are removed. The
// public demo has no server, so it lists none. Returns the ids that were added, changed or removed.
export const registerLlmAgents = llm => syncEndpointAgents("llm", llm?.endpoints || [], llmBrainFor);
export const llmBrainFor = id => { const e = agentDefinitions().find(d => d.id === id)?.llm; return e ? new LlmBrain(e) : null; };

// The LLM button drives with the last LLM chosen, else the first usable one.
export const defaultLlmId = remembered => defaultFrom(agentDefinitions().filter(d => d.llm).map(d => d.id), remembered);

// Probe the endpoints (GET /models on the server side: no tokens, no spend) and label each agent
// "ready", "unreachable", "key rejected" or "no key". Returns the statuses.
export const checkLlmEndpoints = () => checkEndpoints("llm:", "/api/llm/check");

// One line for Settings and the arena: what is configured and how to add more.
export function llmSummary(status) {
  if (status?.demo) return "LLM endpoint drivers need the local app (uv run server.py); this demo has no server to hold keys.";
  const llm = status?.llm;
  const problems = llm?.problems?.length ? ` Config problem: ${llm.problems[0]}` : "";
  if (!llm?.endpoints?.length) return `Test your own model: choose Connect a model, or list OpenAI-compatible endpoints in ${llm?.config_file || "data/llm-endpoints.json"} (see docs/agents.md).${problems}`;
  const parts = agentDefinitions().filter(d => d.llm).map(d => `${d.label} (${d.llm.model}) · ${checkedStatus(d.id) || d.note || "configured"}`);
  return `LLM endpoints: ${parts.join("; ")}.${problems}`;
}
