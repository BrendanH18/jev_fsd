import { RulesBrain } from "./rules.js";
import { JevBrain } from "./jev.js";
import { CautiousAgent } from "../agents/cautious.js";

// Plain ids for built-in and local agents; `decision:<name>` and `llm:<name>` for endpoints configured on the server.
const AGENT_ID = /^(?:[a-z][a-z0-9_-]{0,39}|(?:decision|llm):[a-z0-9][a-z0-9_-]{0,31})$/;
const definitions = new Map();
export function registerAgent({ id, label, create, description = "", builtin = false, available = true, note = "", llm = null, decision = null }) {
  if (typeof id !== "string" || !AGENT_ID.test(id) || typeof create !== "function" || !label || definitions.has(id)) throw new Error("Agent needs a unique id, a label and a create() factory.");
  definitions.set(id, { id, label, create, description, builtin, available, note, llm, decision });
}
export const agentDefinitions = () => [...definitions.values()];
export const createAgents = () => Object.fromEntries(agentDefinitions().map(d => [d.id, d.create()]));
// An unavailable agent stays listed (people should know it exists) but cannot be selected.
export function setAgentAvailability(id, available, note = "") {
  const d = definitions.get(id);
  if (d) { d.available = !!available; d.note = note; }
}
export const agentAvailable = id => definitions.get(id)?.available === true;
// Server endpoints can be added, changed or removed while the app runs (the Connect a model dialog).
// `field` is "llm" or "decision": where the endpoint's public settings live on the definition.
export function updateAgent(id, { label, description, field = "llm", endpoint }) {
  const d = definitions.get(id);
  if (d) Object.assign(d, { label, description, [field]: endpoint });
}
export function removeAgent(id) { return !definitions.get(id)?.builtin && definitions.delete(id); }
export const agentOptionLabel = d => d.note ? `${d.label} · ${d.note}` : d.label;
// The three pillars: Rules, decision models (Jev and every decision:<name>) and LLMs (llm:<name>).
// Local agents such as the cautious starter are their own group.
export const isDecisionAgent = id => id === "jev" || String(id).startsWith("decision:");
export const pillarOf = id => (isDecisionAgent(id) ? "decision" : String(id).startsWith("llm:") ? "llm" : id);
registerAgent({ id: "rules", label: "Rules", create: () => new RulesBrain(), builtin: true });
registerAgent({ id: "jev", label: "Jev", description: "TypeSafe's Jev decision model, direct.", create: () => new JevBrain(), builtin: true });
registerAgent({ id: "cautious", label: "Cautious starter", description: "A free example agent that favours clearance and gentle acceleration.", create: () => new CautiousAgent() });

export function validAgentChoice(result, eligible) {
  return result && ["drive", "stop", "reverse"].includes(result.motion) && eligible.some(c => c.id === result.candidateId);
}
