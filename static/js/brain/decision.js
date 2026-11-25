// Decision-model drivers: the second pillar, beside Rules and LLMs. Jev is the built-in one (jev.js);
// every endpoint configured on the server (data/decision-endpoints.json, or the Connect a model
// dialog) becomes an agent `decision:<name>`: Perplexity Decider, Liquid d1 or Jev itself through
// OpenRouter, an open model on llama.cpp, and so on.
//
// Each one receives exactly the state and questions Jev does (state.js), so results compare fairly.
// The server holds the URL and key, enforces the shared budget and rate limit, and checks every answer
// against the options offered (jev/decision.py). An unusable answer, a timeout, an HTTP error or an
// exhausted budget falls back to Rules for that decision, and a call that happened still counts.

import { api } from "../common.js";
import { agentDefinition, agentDefinitions, setAgentAvailability } from "./registry.js";
import { syncEndpointAgents, checkEndpoints, checkedStatus, defaultFrom } from "./endpoints.js";
import { decisionResult } from "./jev.js";

import { callModel, checkCoordinates, checkJevRequest, endpointTimeout } from "./model-contract.js";

export class DecisionBrain {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.name = endpoint.id;
    this.questionDriven = true; // like Jev: nothing to ask means a local decision, no call
    this.transport = api; // the server call; a model recording (recording.js) swaps it
    this.timeoutMs = endpointTimeout(endpoint.timeout_s, 5);
  }

  async decide(snap, eligible, request, signal) {
    signal?.throwIfAborted();
    const body = {
      endpoint: this.endpoint.name,
      tick: snap.tick ?? 0,
      epoch: request.epoch ?? 0,
      state: request.state,
      questions: request.questions,
    };
    checkCoordinates(body);
    checkJevRequest(body);
    const { response, meta } = await callModel(this, "/api/decision/decide", body, signal);
    return decisionResult(response, request, eligible, meta);
  }
}

// Register the endpoints in /api/status's `decision` block (or a setup reply) and Jev's availability.
// Returns the endpoint ids that were added, changed or removed. The public demo has no server: Jev
// stays listed but unavailable, and there are no endpoints.
export function registerDecisionAgents(decision, { demo = false } = {}) {
  const jev = decision?.jev;
  setAgentAvailability(
    "jev",
    !!jev?.configured,
    demo ? "needs the local app" : jev?.configured ? "" : "no TypeSafe key",
  );
  return syncEndpointAgents("decision", decision?.endpoints ?? [], decisionBrainFor);
}
export const decisionBrainFor = (id) => {
  const e = agentDefinition(id)?.decision;
  return e ? new DecisionBrain(e) : null;
};
export const decisionIds = () => [
  "jev",
  ...agentDefinitions()
    .filter((d) => d.decision)
    .map((d) => d.id),
];

// The Decision button drives with the last decision model chosen, else Jev, else the first usable one.
export const defaultDecisionId = (remembered) => defaultFrom(decisionIds(), remembered);

export const checkDecisionEndpoints = () => checkEndpoints("decision:", "/api/decision/check");

// One line for Settings and the arena.
export function decisionSummary(status) {
  if (status?.demo)
    return "Decision models need the local app (uv run server.py); this demo has no server to hold keys.";
  const decision = status?.decision;
  const problems = decision?.problems?.length ? ` Config problem: ${decision.problems[0]}` : "";
  const jev = decision?.jev?.configured ? `Jev (${decision.jev.model}) · key set` : "Jev · no TypeSafe key yet";
  const parts = agentDefinitions()
    .filter((d) => d.decision)
    .map((d) => `${d.label} (${d.decision.model}) · ${checkedStatus(d.id) || d.note || "configured"}`);
  const more = parts.length
    ? `; ${parts.join("; ")}`
    : ". Add Perplexity Decider, Liquid d1 and others with Connect a model";
  return `Decision models: ${jev}${more}.${problems}`;
}
