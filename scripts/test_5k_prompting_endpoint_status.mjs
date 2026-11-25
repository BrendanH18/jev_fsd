import assert from "node:assert/strict";
import { checkDecisionEndpoints, registerDecisionAgents } from "../static/js/brain/decision.js";
import { checkedStatus } from "../static/js/brain/endpoints.js";
import { checkLlmEndpoints, registerLlmAgents } from "../static/js/brain/llm.js";
import { agentDefinition } from "../static/js/brain/registry.js";

globalThis.document = { querySelector: () => null };
const endpoint = (name, kind = "llm") => ({
  id: `${kind}:${name}`,
  name,
  label: `Model ${name}`,
  model: "stub",
  endpoint: "http://127.0.0.1:9/v1",
  usable: true,
  timeout_s: 2,
});
const a = endpoint("alpha");
const b = endpoint("beta");
const c = endpoint("gamma", "decision");

const fetchStatuses = ({ endpoints }) => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ endpoints }) });
};

assert.equal(registerLlmAgents({ endpoints: [a] }).join(), a.id);
assert.equal(registerDecisionAgents({ endpoints: [c] }).join(), c.id);
fetchStatuses({
  endpoints: [
    { name: a.name, status: "ready" },
    { name: c.name, status: "unreachable" },
  ],
});
await checkLlmEndpoints();
await checkDecisionEndpoints();
assert.equal(checkedStatus(a.id), "ready");
assert.equal(checkedStatus(c.id), "unreachable");

for (const malformed of ["not an array", { endpoints: [] }, true, false, 0, ""]) {
  assert.equal(registerLlmAgents({ endpoints: malformed }).length, 0);
  assert.equal(agentDefinition(a.id).label, a.label);
  assert.equal(checkedStatus(a.id), "ready");
}
for (const incomplete of [
  { ...a, model: null },
  { ...a, label: "" },
  { ...a, endpoint: " " },
  { ...a, usable: "yes" },
  { ...a, name: "beta" },
]) {
  assert.equal(registerLlmAgents({ endpoints: [incomplete] }).length, 0);
  assert.equal(agentDefinition(a.id).label, a.label);
  assert.equal(checkedStatus(a.id), "ready");
}
const invalidEntries = [
  null,
  false,
  [],
  {},
  endpoint(""),
  endpoint("Invalid"),
  endpoint("n".repeat(33)),
  Object.create(a),
  { ...b, id: "decision:beta" },
];
assert.equal(registerLlmAgents({ endpoints: [a, ...invalidEntries, b] }).join(), b.id);
assert.equal(agentDefinition("llm:"), undefined);
assert.equal(agentDefinition("decision:beta"), undefined);
assert.equal(agentDefinition(b.id).available, true);
assert.equal(registerLlmAgents({ endpoints: [a, { ...a, model: null }, b] }).length, 0);
assert.equal(agentDefinition(a.id).llm.model, "stub");
fetchStatuses({
  endpoints: [
    null,
    {},
    {
      name: {
        toString: () => {
          throw new Error("should never run");
        },
      },
      status: "no key",
    },
    { name: a.name, status: "key rejected" },
    Object.create({ name: a.name, status: "unreachable" }),
    Object.assign(Object.create({ status: "no key" }), { name: a.name }),
  ],
});
await checkLlmEndpoints();
assert.equal(checkedStatus(a.id), "key rejected");
assert.equal(checkedStatus(c.id), "unreachable");
assert.equal(agentDefinition(a.id).available, true);
assert.equal(registerLlmAgents({ endpoints: [] }).sort().join(), [a.id, b.id].sort().join());
assert.equal(checkedStatus(a.id), undefined);
assert.equal(agentDefinition(c.id).available, true);
console.log("Model endpoint reconciliation and status checks passed.");
