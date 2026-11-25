import assert from "node:assert/strict";
import { compareTraces } from "./bench_trace.mjs";

const pose = (x = 0, heading = 0) => ({ x, y: 0, heading, speed: 2 });
const fixture = () => ({
  version: 1,
  inputs: { scenario: { id: "s1-1" } },
  result: { pass: true, arrived: true, time_s: 1 },
  steps: [0, 1, 2].map((x) => ({
    ego: pose(x),
    traffic: [
      { id: 1, ...pose(x + 4) },
      { id: "npc-2", ...pose(x + 6) },
    ],
    decision: x ? { count: x, motion: "drive", choice: "lane" } : null,
  })),
});
const left = fixture();
const right = fixture();
right.steps[0].ego.x = -1;
right.steps[1].ego.speed = 9;
right.steps[2].traffic[0].x = 9;
right.steps[2].decision.choice = "brake";

const ranged = compareTraces(left, right, { fromTick: 1, toTick: 1, summary: true, window: 2 });
assert.equal(ranged.stateOverTolerance.tick, 1);
assert.equal(ranged.stateOverTolerance.path, "ego.speed");
assert.equal(ranged.summary.sharedTicks, 1);
assert.equal(ranged.summary.ego.maxSpeedTick, 1);
assert.equal(ranged.decision, null);
assert.equal(ranged.window.ticks.map(({ tick }) => tick).join(), "1");
assert.equal(ranged.scope.fromTick, 1);
assert.equal(ranged.scope.toTick, 1);
assert.equal(compareTraces(left, right, { state: "ego" }).stateOverTolerance.path, "ego.x");
assert.equal(compareTraces(left, right, { state: "traffic" }).stateOverTolerance.path, "traffic.0.x");
assert.equal(compareTraces(left, right, { actor: "1" }).stateOverTolerance.tick, 2);
assert.equal(compareTraces(left, right, { actor: "npc-2" }).stateOverTolerance, null);
assert.throws(() => compareTraces(left, right, { actor: "missing" }), /absent from the selected ticks/);
assert.throws(() => compareTraces(left, right, { state: "ego", actor: "1" }), /requires.*traffic/);
assert.throws(() => compareTraces(left, right, { state: "foo" }), /all, ego or traffic/);
assert.throws(() => compareTraces(left, right, { fromTick: -1 }), /Tick range/);
assert.throws(() => compareTraces(left, right, { fromTick: 2, toTick: 1 }), /ordered/);
assert.throws(() => compareTraces(left, right, { toTick: 3 }), /last captured tick/);

const reversed = fixture();
reversed.steps[0].traffic.reverse();
assert.equal(compareTraces(left, reversed).stateOverTolerance.path, "traffic.0.id");
assert.equal(compareTraces(left, reversed, { ignoreTrafficOrder: true }).exactState, null);
assert.equal(compareTraces(left, reversed, { ignoreTrafficOrder: true }).trafficMatchedById, true);
const headings = fixture();
left.steps[0].ego.heading = Math.PI - 0.01;
headings.steps[0].ego.heading = -Math.PI + 0.01;
const wrapping = compareTraces(left, headings, { headingTolerance: 0.03, wrapHeading: true, summary: true });
assert.equal(wrapping.stateOverTolerance, null);
assert.equal(wrapping.exactState.path, "ego.heading");
assert.ok(wrapping.summary.ego.maxHeadingDrift < 0.03);
assert.equal(wrapping.summary.ego.maxHeadingTick, 0);
assert.equal(compareTraces(left, headings, { headingTolerance: 0.03 }).stateOverTolerance.path, "ego.heading");

const extra = fixture();
extra.steps[1].ego.x = 8;
extra.steps[1].ego.y = 5;
extra.steps[1].traffic[0].speed = 6;
assert.equal(
  compareTraces(fixture(), extra, { explain: 2 })
    .firstStateDetails.map((r) => r.path)
    .join(),
  "ego.x,ego.y",
);
assert.equal(compareTraces(extra, extra, { explain: 1 }).firstStateDetails.length, 0);
assert.throws(() => compareTraces(left, right, { explain: 101 }), /0 to 100/);

const shortened = fixture();
shortened.steps.pop();
shortened.result.pass = false;
shortened.steps[1].decision = null;
const ignored = compareTraces(fixture(), shortened, { ignore: ["decision", "length", "result"], window: 2 });
assert.equal(ignored.ignored.join(), "decision,length,result");
assert.equal(ignored.window, null);
assert.equal(ignored.decision, null);
assert.equal(ignored.lengthDifference, null);
assert.equal(ignored.resultDifference, null);
assert.equal(compareTraces(fixture(), shortened, { toTick: 1 }).lengthDifference, null);
assert.equal(compareTraces(fixture(), shortened, { fromTick: 2 }).lengthDifference.tick, 2);
assert.throws(() => compareTraces(left, right, { ignore: ["bogus"] }), /Ignore accepts/);

const strict = { strictCapture: true };
assert.equal(compareTraces(fixture(), fixture(), strict).exactState, null);
const missingHeading = fixture();
delete missingHeading.steps[0].ego.heading;
assert.throws(() => compareTraces(fixture(), missingHeading, strict), /right at tick 0 \(ego pose\)/);
assert.equal(compareTraces(missingHeading, missingHeading).stateOverTolerance, null);
const unknownChoice = fixture();
delete unknownChoice.steps[1].decision.choice;
assert.throws(() => compareTraces(fixture(), unknownChoice, strict), /decision choice/);
unknownChoice.steps[1].decision.choice = null;
assert.equal(compareTraces(unknownChoice, unknownChoice, strict).decision, null);
for (const [change, expected] of [
  [
    (t) => {
      t.result.time_s = -1;
    },
    /on the right/,
  ],
  [
    (t) => {
      t.inputs.scenario.id = " ";
    },
    /on the right/,
  ],
  [
    (t) => {
      t.steps[0].ego = true;
    },
    /ego pose/,
  ],
  [
    (t) => {
      t.steps[0].ego.x = "0";
    },
    /ego pose/,
  ],
  [
    (t) => {
      t.steps[0].traffic = {};
    },
    /traffic list/,
  ],
  [
    (t) => {
      t.steps[0].traffic[0] = null;
    },
    /traffic pose/,
  ],
  [
    (t) => {
      t.steps[0].traffic[0].id = "";
    },
    /traffic actor ID/,
  ],
  [
    (t) => {
      t.steps[0].traffic[0].id = 1.5;
    },
    /traffic actor ID/,
  ],
  [
    (t) => {
      t.steps[0].traffic[1].id = 1;
    },
    /duplicate traffic actor/,
  ],
  [
    (t) => {
      t.steps[0].decision = [];
    },
    /decision\)/,
  ],
  [
    (t) => {
      t.steps[1].decision.count = -1;
    },
    /decision count/,
  ],
  [
    (t) => {
      t.steps[1].decision.motion = 1;
    },
    /decision motion/,
  ],
  [
    (t) => {
      t.steps[1].decision.headlights = false;
    },
    /decision headlights/,
  ],
]) {
  const trace = fixture();
  change(trace);
  assert.throws(() => compareTraces(fixture(), trace), expected);
}
console.log("Benchmark trace scope, validation and drift options passed.");
