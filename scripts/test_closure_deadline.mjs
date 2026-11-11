// A road-closure detour extends the bench deadline only once its re-plan has replaced the route
// (bench/runner.js watchClosureReplans); a failed or empty re-plan, or any other re-plan, does not.
// node --experimental-default-type=module scripts/test_closure_deadline.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { watchClosureReplans } = await import("../static/js/bench/runner.js");
const settle = () => new Promise((r) => setTimeout(r, 0));
const setup = () => {
  const autopilot = { closureRouting: null }, world = { route: { length: 500 } }, metrics = { distance: 200 }, got = [];
  return { autopilot, world, metrics, got, step: watchClosureReplans(autopilot, world, metrics, (m) => got.push(m)) };
};
{ // a closure re-plan that replaces the route: driven + new route
  const t = setup();
  t.autopilot.closureRouting = Promise.resolve().then(() => { t.world.route = { length: 900 }; });
  t.step(); t.step(); await settle();
  assert.deepEqual(t.got, [1100]);
}
{ // one that finds no route, then an unrelated re-plan: no extension
  const t = setup();
  t.autopilot.closureRouting = Promise.resolve(); t.step(); await settle();
  t.autopilot.closureRouting = null; t.world.route = { length: 800 }; t.step(); await settle();
  assert.deepEqual(t.got, []);
}
{ // one that fails
  const t = setup();
  t.autopilot.closureRouting = Promise.reject(new Error("offline")); t.step(); await settle();
  assert.deepEqual(t.got, []);
}
{ // a re-plan with no closure at all
  const t = setup();
  t.world.route = { length: 800 }; t.step(); await settle();
  assert.deepEqual(t.got, []);
}
console.log("✓ only a closure re-plan that replaces the route extends the deadline");
process.exit(0);
