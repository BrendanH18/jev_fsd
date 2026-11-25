// Agents for endpoints configured on the server: decision models (`decision:<name>`, decision.js) and
// LLMs (`llm:<name>`, llm.js). The server's /api/status lists them; the Connect a model dialog adds,
// changes and removes them while the app runs; a free status probe labels each one.

import { api } from "../common.js";
import {
  agentDefinition,
  agentDefinitions,
  registerAgent,
  removeAgent,
  setAgentAvailability,
  updateAgent,
} from "./registry.js";

const checked = new Map(); // id -> "ready" | "unreachable" | "key rejected" | "no key"
const latestProbe = new Map();
const PROBE_STATUSES = new Set(["ready", "unreachable", "key rejected", "no key", "error"]);
export const checkedStatus = (id) => checked.get(id);

// Register the endpoints of one kind. Safe to call more than once: changed endpoints are updated and
// endpoints no longer configured are removed. Returns the ids that were added, changed or removed,
// whose brains must be rebuilt.
export function syncEndpointAgents(field, endpoints = [], create) {
  const changed = [];
  const configured = new Map(endpoints.map((e) => [e.id, e]));
  for (const d of agentDefinitions().filter((d) => d[field] && !configured.has(d.id))) {
    removeAgent(d.id);
    checked.delete(d.id);
    latestProbe.delete(d.id);
    changed.push(d.id);
  }
  for (const e of configured.values()) {
    const current = agentDefinition(e.id);
    if (typeof e.id !== "string" || !e.id.startsWith(`${field}:`) || (current && !current[field])) continue;
    const description = `${e.model} at ${e.endpoint}`;
    if (!current) {
      registerAgent({ id: e.id, label: e.label, description, create: () => create(e.id), [field]: e });
      changed.push(e.id);
    } else if (JSON.stringify(endpointShape(current[field])) !== JSON.stringify(endpointShape(e))) {
      updateAgent(e.id, { label: e.label, description, field, endpoint: e });
      checked.delete(e.id);
      latestProbe.delete(e.id);
      changed.push(e.id);
    } else updateAgent(e.id, { label: e.label, description, field, endpoint: e }); // fresh stats, same driver
    const status = checked.get(e.id);
    const available = e.usable && status !== "no key";
    const note = available
      ? status === "ready"
        ? ""
        : status
      : e.api_key_env
        ? `no key: set ${e.api_key_env}`
        : "no key";
    setAgentAvailability(e.id, available, note);
  }
  return changed;
}
const endpointShape = (e) =>
  e && {
    name: e.name,
    label: e.label,
    model: e.model,
    endpoint: e.endpoint,
    path: e.path,
    key: e.key,
    keyEnv: e.api_key_env,
    usable: e.usable,
    timeout_s: e.timeout_s,
  };

// Probe the endpoints (one free GET each on the server side: no tokens, no spend) and label each
// agent "ready", "unreachable", "key rejected" or "no key". Returns the statuses.
export async function checkEndpoints(prefix, url) {
  const probe = Symbol(prefix);
  const field = prefix.slice(0, -1);
  for (const d of agentDefinitions()) if (d[field]) latestProbe.set(d.id, probe);
  const { endpoints } = (await api(url, {})) ?? {};
  if (!Array.isArray(endpoints)) throw new Error("Invalid endpoint check response.");
  for (const s of endpoints) {
    const id = `${prefix}${s?.name}`;
    if (latestProbe.get(id) !== probe || !PROBE_STATUSES.has(s.status)) continue;
    const status = agentDefinition(id)?.[field]?.usable ? s.status : "no key";
    checked.set(id, status);
    setAgentAvailability(id, status !== "no key", status === "ready" ? "" : status);
  }
  return endpoints;
}

// The pillar button drives with the remembered choice if it can, else the first available one.
export function defaultFrom(ids, remembered) {
  const defs = ids.map(agentDefinition).filter(Boolean);
  return (
    (
      defs.find((d) => d.id === remembered && d.available !== false) ||
      defs.find((d) => d.available !== false) ||
      defs[0]
    )?.id || null
  );
}
