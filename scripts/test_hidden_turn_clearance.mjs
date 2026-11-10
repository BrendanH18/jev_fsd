// Leave room for an opposing left-turner's nose while waiting for the lane it hides.
// node --experimental-default-type=module scripts/test_hidden_turn_clearance.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const root = new URL("../data/maps/", import.meta.url), key = "623b012bc8b5";
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
  if (url) pack[name] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack), lesson = CHALLENGES.find(c => c.id === "blind-left");
const ctx = setupChallenge(map, lesson, { brain: "rules" }), { world, autopilot } = ctx;
const control = world.route.controls.find(c => c.control.type === "signal");
const edge = control.sJunction - map.crossingHalfWidth(control.edge);
const front = world.ego.spec.length - world.ego.spec.rearOverhang;
let stoppedHidden = false, deepest = -Infinity;
for (let k = 0; k < 80 * 60 && autopilot.enabled; k++) {
  stepWorld(ctx, 1 / 60, world.t * 1000);
  if (autopilot.firing) await autopilot.firing;
  if (autopilot.snap?.intersection?.oncoming?.id === null && world.ego.v < 0.05) {
    stoppedHidden = true;
    deepest = Math.max(deepest, world.route.project(world.ego.x, world.ego.y).s + front - edge);
  }
}
assert.equal(stoppedHidden, true, "held by a vehicle hiding the oncoming lane");
assert.equal(deepest < -1.5, true, `left body clearance before the crossing street: ${deepest}`);
assert.equal(world.violations.collisions, 0);
assert.equal(world.violations.failed_to_yield, 0);
assert.equal(autopilot.enabled, false, "resumed and arrived after the view cleared");
console.log("A hidden-lane wait leaves room for an opposing left turn, then resumes safely");
process.exit(0);
