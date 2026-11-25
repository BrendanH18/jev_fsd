import { strict as assert } from "node:assert";
import {
  FEATURE_METRICS,
  FEATURES,
  featureFailures,
  featureMetrics,
  hooks,
  recordProblem,
  recordsAt,
  registryProblem,
} from "../static/js/sim/features/index.js";
import { flagText } from "../static/js/brain/tracks.js";
import { freeDriveOptions } from "../static/js/sim/free-drive.js";

const record = { key: "example", build: () => false };
const metric = { at: "late", name: "violation", label: "Violation", failure: "failed" };
const auditRecord = { ...record, seen: "seen", metric };
const notice = { read: () => null, order: 0, duration: 1000, style: "" };
const noop = () => null;

// A misspelled field often leaves a valid-looking record that never runs the intended behavior.
for (const [fields, field] of [
  [{ obstacle: { test: noop, parkedClearence: noop } }, "obstacle"],
  [{ notice: { ...notice, durationMs: 1000 } }, "notice"],
  [{ prompt: { at: "headlights", text: "Instruction", lines: 1 } }, "prompt"],
  [{ sense: { at: "parking", run: noop, priority: 42 } }, "sense"],
  [{ seen: "seen", metric: { ...metric, precision: 3 } }, "metric"],
  [{ coach: { reports: [{ at: "end", order: 0, read: noop, format: noop }] } }, "coach.reports"],
  [{ coach: { guidance: [{ at: "afterBlind", order: 0, read: noop, state: true }] } }, "coach.guidance"],
  [{ coach: { tips: [{ at: "afterMerge", order: 0, when: noop, text: "Tip", advice: true }] } }, "coach.tips"],
  [{ coach: { deductions: [{ at: "safety", order: 0, counter: "count", weight: 2, scale: 1 }] } }, "coach.deductions"],
]) {
  assert.ok(recordProblem({ ...record, ...fields }).includes(`${field} has an unknown field`));
}

const lazyLabel = {
  test: noop,
  get label() {
    throw new Error("label read during validation");
  },
};
assert.equal(recordProblem({ ...record, obstacle: lazyLabel }), null);
const writableLabel = { test: noop, set label(_value) {} };
assert.match(recordProblem({ ...record, obstacle: writableLabel }), /label must be read-only/);
assert.match(recordProblem({ ...record, priority: Array(1) }), /priority must contain/);
assert.match(registryProblem([{ ...record, priority: ["stop", "stop"] }]), /priority candidate "stop"/);
assert.match(registryProblem([record, null]), /record must be an object/);
assert.match(registryProblem(new Set([record])), /records must be an array/);
assert.match(recordProblem({ ...record, sense: { at: Symbol("parking"), run: noop } }), /Symbol\(parking\)/);
assert.match(
  recordProblem({ ...record, coach: { reports: [{ at: Symbol("end"), order: 0, read: noop }] } }),
  /Symbol\(end\)/,
);

assert.match(recordProblem({ ...auditRecord, metric: { ...metric, traceType: "warning" } }), /needs a threshold/);
assert.match(
  recordProblem({ ...auditRecord, metric: { ...metric, traceType: "warning", threshold: 0, eventType: "stop" } }),
  /choose traceType or eventType/,
);
assert.match(recordProblem({ ...auditRecord, metric: { ...metric, initial: Infinity } }), /metric.initial/);
assert.match(recordProblem({ ...record, metric: { ...metric, reportWhenEnabled: "yes" } }), /reportWhenEnabled/);
assert.match(
  recordProblem({ ...auditRecord, metric: { ...metric, reportWhenEnabled: true } }),
  /cannot also use a seen flag/,
);
assert.equal(recordProblem({ ...record, metric: { ...metric, reportWhenEnabled: true } }), null);
assert.match(
  registryProblem([
    { ...auditRecord, metric: { ...metric, traceType: "sameMarker", threshold: 1 } },
    {
      ...auditRecord,
      key: "another",
      seen: "anotherSeen",
      metric: { ...metric, name: "anotherMetric", eventType: "sameMarker" },
    },
  ]),
  /replay marker "sameMarker"/,
);

assert.throws(() => hooks("prompt", "headlights"), /use recordsAt/);
assert.throws(() => hooks("metric", "vehiclePassing"), /use recordsAt/);
assert.throws(() => hooks("notice", "beforeMerge"), /use recordsAt/);
assert.throws(() => recordsAt("metric", "typo"), /no slot "typo"/);
assert.throws(() => recordsAt(Symbol("metric"), "vehiclePassing"), /Symbol\(metric\)/);
assert.equal(
  recordsAt("metric", "vehiclePassing")
    .map((f) => f.key)
    .join(","),
  "plows,closures,passCyclists",
);
const on = { plowsSeen: true, closuresSeen: true, passCyclists: true };
const violations = { plow_right_passes: 1, merge_cut_ins: 1, close_passes: 1 };
assert.equal(Object.keys(featureMetrics({}, violations, "vehiclePassing")).length, 0);
assert.equal(
  featureMetrics({ passCyclists: { enabled: false } }, violations, "vehiclePassing").close_passes,
  undefined,
);
assert.equal(
  Object.keys(featureMetrics(on, {}, "vehiclePassing")).join(","),
  "plow_right_passes,merge_cut_ins,close_passes",
);
assert.equal(
  featureFailures(featureMetrics(on, violations, "vehiclePassing"), "vehiclePassing").join("|"),
  "passed plow on the right|merged out of turn|passed a cyclist too close",
);
assert.equal(FEATURE_METRICS.find((m) => m.name === "merge_cut_ins").eventType, "merged_out_of_turn");
assert.equal(FEATURE_METRICS.find((m) => m.name === "close_passes").eventType, "close_pass");
assert.equal(flagText("passes_cyclist_too_close"), "it passes a cyclist with less than 1 m of room");
assert.equal(flagText("passes_cyclist_without_room"), "it passes a cyclist with less than the legal passing distance");
for (const [key, group, flag] of [
  ["plows", "fleet", "plows"],
  ["closures", "world", "closures"],
  ["passCyclists", "world", "cyclistpass"],
]) {
  const feature = FEATURES.find((feature) => feature.key === key);
  assert.equal(!!feature, true, key);
  assert.equal(freeDriveOptions()[group][key], feature.defaultCount ?? true, key);
  assert.equal(
    freeDriveOptions(new URLSearchParams({ [flag]: "0" }))[group][key],
    feature.defaultCount ? 0 : false,
    key,
  );
}
const hidden = (value, key, entry) => Object.defineProperty(value, key, { value: entry });
assert.match(recordProblem({ ...record, [Symbol("candidate")]: noop }), /invalid symbol field/);
assert.match(recordProblem(hidden({ ...record }, "sense", noop)), /hidden declaration "sense"/);
assert.match(recordProblem({ ...record, flagText: { [Symbol("stop")]: "Stop." } }), /invalid key "Symbol\(stop\)"/);
assert.match(recordProblem({ ...record, snapshot: hidden({}, "entry", null) }), /hidden entry "entry"/);
assert.match(recordProblem({ ...record, sense: { at: null, run: noop } }), /is at "null"/);
const enabledMetric = { ...metric, reportWhenEnabled: true };
assert.match(recordProblem({ ...record, metric: enabledMetric, buildFleet: noop }), /needs a World option/);
assert.match(recordProblem({ ...record, metric: enabledMetric, defaultCount: 1 }), /needs a boolean option/);
const deduction = { at: "safety", order: 0, counter: "count", weight: 2 };
assert.match(
  recordProblem({ ...record, coach: { deductions: [{ ...deduction, category: "control" }] } }),
  /category only at "post"/,
);
assert.match(
  registryProblem([
    { ...record, coach: { deductions: [deduction] } },
    { ...record, key: "another", coach: { deductions: [{ ...deduction, counter: "other" }] } },
  ]),
  /coach.deductions order "safety\/0" already belongs/,
);

console.log("Registry declarations, passing metrics, feature switches and fallback flags passed.");
