import { RulesBrain } from "./rules.js";
import { JevBrain } from "./jev.js";
import { CautiousAgent } from "../agents/cautious.js";

// Plain ids for built-in and local agents; `llm:<name>` for endpoints configured on the server.
const AGENT_ID = /^(?:[a-z][a-z0-9_-]{0,39}|llm:[a-z0-9][a-z0-9_-]{0,31})$/;
const definitions = new Map();
export function registerAgent({ id, label, create, description = "", builtin = false, available = true, note = "", llm = null }) {
  if (typeof id !== "string" || !AGENT_ID.test(id) || typeof create !== "function" || !label || definitions.has(id)) throw new Error("Agent needs a unique id, a label and a create() factory.");
  definitions.set(id, { id, label, create, description, builtin, available, note, llm });
}
export const agentDefinitions = () => [...definitions.values()];
export const createAgents = () => Object.fromEntries(agentDefinitions().map(d => [d.id, d.create()]));
// An unavailable agent stays listed (people should know it exists) but cannot be selected.
export function setAgentAvailability(id, available, note = "") {
  const d = definitions.get(id);
  if (d) { d.available = !!available; d.note = note; }
}
export const agentAvailable = id => definitions.get(id)?.available === true;
// LLM endpoints can be added, changed or removed while the app runs (the Connect a model dialog).
export function updateAgent(id, { label, description, llm }) {
  const d = definitions.get(id);
  if (d) Object.assign(d, { label, description, llm });
}
export function removeAgent(id) { return !definitions.get(id)?.builtin && definitions.delete(id); }
export const agentOptionLabel = d => d.note ? `${d.label} · ${d.note}` : d.label;
registerAgent({ id: "rules", label: "Rules", create: () => new RulesBrain(), builtin: true });
registerAgent({ id: "jev", label: "Jev", create: () => new JevBrain(), builtin: true });
registerAgent({ id: "cautious", label: "Cautious starter", description: "A free example agent that favours clearance and gentle acceleration.", create: () => new CautiousAgent() });

export function validAgentChoice(result, eligible) {
  return result && ["drive", "stop", "reverse"].includes(result.motion) && eligible.some(c => c.id === result.candidateId);
}
