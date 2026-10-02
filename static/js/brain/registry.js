import { RulesBrain } from "./rules.js";
import { JevBrain } from "./jev.js";
import { CautiousAgent } from "../agents/cautious.js";

const definitions = new Map();
export function registerAgent({ id, label, create, description = "", builtin = false }) {
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id) || typeof create !== "function" || !label || definitions.has(id)) throw new Error("Agent needs a unique id, a label and a create() factory.");
  definitions.set(id, { id, label, create, description, builtin });
}
export const agentDefinitions = () => [...definitions.values()];
export const createAgents = () => Object.fromEntries(agentDefinitions().map(d => [d.id, d.create()]));
registerAgent({ id: "rules", label: "Rules", create: () => new RulesBrain(), builtin: true });
registerAgent({ id: "jev", label: "Jev", create: () => new JevBrain(), builtin: true });
registerAgent({ id: "cautious", label: "Cautious starter", description: "A free example agent that favours clearance and gentle acceleration.", create: () => new CautiousAgent() });

export function validAgentChoice(result, eligible) {
  return result && ["drive", "stop", "reverse"].includes(result.motion) && eligible.some(c => c.id === result.candidateId);
}
