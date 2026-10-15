// Agents for endpoints configured on the server: decision models (`decision:<name>`, decision.js) and
// LLMs (`llm:<name>`, llm.js). The server's /api/status lists them; the Connect a model dialog adds,
// changes and removes them while the app runs; a free status probe labels each one.

import { api } from "../common.js";
import { agentDefinitions, registerAgent, removeAgent, setAgentAvailability, updateAgent } from "./registry.js";

const checked = new Map();   // id -> "ready" | "unreachable" | "key rejected" | "no key"
export const checkedStatus = id => checked.get(id);

// Register the endpoints of one kind. Safe to call more than once: changed endpoints are updated and
// endpoints no longer configured are removed. Returns the ids that were added, changed or removed,
// whose brains must be rebuilt.
export function syncEndpointAgents(field, endpoints = [], create) {
  const changed = [];
  for (const d of agentDefinitions().filter(d => d[field] && !endpoints.some(e => e.id === d.id))) {
    removeAgent(d.id); checked.delete(d.id); changed.push(d.id);
  }
  for (const e of endpoints) {
    const current = agentDefinitions().find(d => d.id === e.id);
    const description = `${e.model} at ${e.endpoint}`;
    if (!current) {
      registerAgent({ id: e.id, label: e.label, description, create: () => create(e.id), [field]: e });
      changed.push(e.id);
    } else if (JSON.stringify(endpointShape(current[field])) !== JSON.stringify(endpointShape(e))) {
      updateAgent(e.id, { label: e.label, description, field, endpoint: e });
      checked.delete(e.id); changed.push(e.id);
    } else updateAgent(e.id, { label: e.label, description, field, endpoint: e });   // fresh stats, same driver
    setAgentAvailability(e.id, e.usable, e.usable ? "" : `no key: set ${e.api_key_env}`);
  }
  return changed;
}
const endpointShape = e => e && { label: e.label, model: e.model, endpoint: e.endpoint, path: e.path, key: e.key, timeout_s: e.timeout_s };

// Probe the endpoints (one free GET each on the server side: no tokens, no spend) and label each
// agent "ready", "unreachable", "key rejected" or "no key". Returns the statuses.
export async function checkEndpoints(prefix, url) {
  const { endpoints } = await api(url, {});
  for (const s of endpoints) {
    const id = `${prefix}${s.name}`;
    checked.set(id, s.status);
    setAgentAvailability(id, s.status !== "no key", s.status === "ready" ? "" : s.status);
  }
  return endpoints;
}

// The pillar button drives with the remembered choice if it can, else the first available one.
export function defaultFrom(ids, remembered) {
  const defs = ids.map(id => agentDefinitions().find(d => d.id === id)).filter(Boolean);
  return (defs.find(d => d.id === remembered && d.available !== false) || defs.find(d => d.available !== false) || defs[0])?.id || null;
}
