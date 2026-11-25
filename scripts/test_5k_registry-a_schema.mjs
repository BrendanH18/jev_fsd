import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEATURES,
  FEATURE_METRICS,
  FEATURE_OPTIONS,
  FEATURE_SNAPSHOT_FIELDS,
  SLOTS,
  announceFeatureNotices,
  buildFeatures,
  featureEventBadge,
  featureFailures,
  featureMetrics,
  featureNeedsDay,
  featureNeedsUtcOffset,
  hooks,
  recordProblem,
  registryProblem,
} from "../static/js/sim/features/index.js";

const record = { key: "example", build: () => false };
const metric = { at: "late", name: "example_count", label: "Example count", failure: "example failed" };
const notice = { read: () => null, order: 0, duration: 500, style: "stop" };
const tip = { at: "afterSpeed", order: 1, when: () => true, text: "Slow down" };

test("registry declarations reject properties the dispatcher would silently skip", () => {
  assert.match(recordProblem({ ...record, [Symbol("hidden")]: true }), /record has a symbol field/);
  const hidden = Object.defineProperty({ ...record }, "sense", { value() {} });
  assert.match(recordProblem(hidden), /record.sense must be enumerable/);
  assert.match(
    recordProblem({
      ...record,
      get sense() {
        throw new Error("getter called");
      },
    }),
    /record.sense must be a value/,
  );
  assert.match(
    recordProblem({ ...record, obstacle: { test: () => false, fixedObstacle: true } }),
    /unknown field "fixedObstacle"/,
  );
  assert.match(recordProblem({ ...record, sense: { at: "end", run() {}, around() {} } }), /unknown field "around"/);
  assert.match(
    recordProblem({ ...record, prompt: { at: "headlights", text: "Guidance", indent: 2 } }),
    /unknown field "indent"/,
  );
  assert.match(recordProblem({ ...record, seen: "met", metric: { ...metric, minimum: 2 } }), /unknown field "minimum"/);
  assert.match(recordProblem({ ...record, notice: { ...notice, sticky: true } }), /unknown field "sticky"/);
  assert.match(recordProblem({ ...record, coach: { tips: [{ ...tip, unused: true }] } }), /unknown field "unused"/);
  assert.match(recordProblem({ ...record, coach: { [Symbol("tip")]: tip } }), /coach has a symbol field/);
});

test("record validation catches ineffective and contradictory declarations", () => {
  assert.match(recordProblem({ ...record, sense: { at: null, run() {} } }), /at "null"/);
  assert.match(recordProblem({ ...record, key: "foo_bar" }), /lowercase query/);
  assert.equal(recordProblem({ ...record, key: "foo_bar", flag: "foobar" }), null);
  assert.match(recordProblem({ ...record, priority: new Array(1) }), /contain candidate names/);
  assert.match(recordProblem({ ...record, priority: ["stop", "stop"] }), /repeats a candidate/);
  assert.match(recordProblem({ ...record, snapshot: { field: {} } }), /invalid value for "field"/);
  assert.match(recordProblem({ ...record, snapshot: { field: Infinity } }), /invalid value for "field"/);
  assert.match(recordProblem({ ...record, snapshot: { field: Symbol("unknown") } }), /invalid value for "field"/);
  assert.match(
    recordProblem({ ...record, seen: "met", metric: { ...metric, traceType: "marker" } }),
    /needs a threshold/,
  );
  assert.match(
    recordProblem({ ...record, seen: "met", metric: { ...metric, trace: false, traceType: "marker", threshold: 1 } }),
    /requires trace to be enabled/,
  );
  assert.match(recordProblem({ ...record, notice: { ...notice, style: "  " } }), /must be empty or nonblank/);
  assert.match(recordProblem({ ...record, coach: { tips: [tip, tip] } }), /repeats order "afterSpeed\/1"/);
  assert.match(
    recordProblem({
      ...record,
      coach: { deductions: [{ at: "firstLegality", order: 0, counter: "points", weight: 2, category: "legality" }] },
    }),
    /only applies at "post"/,
  );
});

test("registry rejects declarations that collide at downstream consumers", () => {
  const other = { ...record, key: "other" };
  assert.match(registryProblem(null), /must be an array/);
  assert.match(
    registryProblem([
      { ...record, priority: ["turn"] },
      { ...other, priority: ["turn"] },
    ]),
    /priority candidate "turn"/,
  );
  assert.match(
    registryProblem([
      { ...record, seen: "met", metric },
      { ...other, seen: "otherMet", metric: { ...metric, name: "other_count" } },
    ]),
    /failure reason "example failed"/,
  );
  const withMarker = { ...record, seen: "met", metric: { ...metric, traceType: "marker", threshold: 1 } };
  const metric2 = { ...metric, name: "other_count", failure: "other failed", threshold: 1 };
  assert.match(
    registryProblem([withMarker, { ...other, seen: "otherMet", metric: { ...metric2, traceType: "marker" } }]),
    /trace marker "marker"/,
  );
  assert.match(
    registryProblem([withMarker, { ...other, seen: "otherMet", metric: { ...metric2, eventType: "marker" } }]),
    /replay marker "marker"/,
  );
  assert.match(
    registryProblem([
      { ...record, seen: "met", coach: { seen: "metDuringCoaching" } },
      { ...other, seen: "otherMet", coach: { seen: "metDuringCoaching" } },
    ]),
    /coach seen flag "metDuringCoaching"/,
  );
});

test("validated registry tables and cached hook lists resist accidental mutation", () => {
  assert.equal(Object.isFrozen(FEATURES), true);
  assert.equal(Object.isFrozen(FEATURES.find((f) => f.key === "busLanes").metric), true);
  assert.equal(Object.isFrozen(FEATURES.find((f) => f.key === "collection").obstacle), true);
  assert.equal(Object.isFrozen(SLOTS), true);
  assert.equal(Object.isFrozen(SLOTS.cautious), true);
  assert.equal(Object.isFrozen(FEATURE_METRICS), true);
  assert.equal(Object.isFrozen(FEATURE_OPTIONS), true);
  assert.equal(Object.isFrozen(FEATURE_SNAPSHOT_FIELDS), true);
  const sense = hooks("sense");
  assert.equal(hooks("sense") === sense, true);
  assert.throws(() => hooks("notice"), /notice is data/);
  assert.equal(hooks("sense") === hooks("sense", "junctions"), false);
  assert.throws(() => hooks("sense").push(() => undefined), TypeError);
  assert.throws(() => hooks("constructor"), /no slot/);
  assert.throws(() => hooks("sense", "toString"), /no slot/);
  assert.throws(() => buildFeatures({}, {}, 0, {}, "constructor"), /unknown build position/);
  assert.throws(() => announceFeatureNotices("toString", {}, {}, {}, new Map(), {}), /no notice slot/);
  assert.equal(featureEventBadge(), undefined);
});

test("audit metrics remain finite, own-property counts with independent seen gates", () => {
  const world = { amberLightsSeen: true, busLanesSeen: true, sunGlareSeen: true };
  const seen = (value) => featureMetrics(world, { amber_lights_run: value }, "afterRedLights").amber_lights_run;
  assert.equal(seen(null), 0);
  assert.equal(seen(0), 0);
  assert.equal(seen(-1), null);
  assert.equal(seen(Infinity), null);
  assert.equal(seen(NaN), null);
  assert.equal(seen("2"), null);
  const inherited = Object.create({ amber_lights_run: 1 });
  assert.equal(featureMetrics(world, inherited, "afterRedLights").amber_lights_run, 0);
  assert.equal(featureFailures(inherited, "afterRedLights").length, 0);
  assert.equal(featureFailures({ amber_lights_run: NaN }, "afterRedLights").length, 0);
  assert.equal(featureFailures({ amber_lights_run: "2" }, "afterRedLights").length, 0);
  assert.equal(featureFailures({ amber_lights_run: -2 }, "afterRedLights").length, 0);
  assert.equal(featureFailures({ amber_lights_run: 1 }, "afterRedLights")[0], "failed to stop safely for amber");
  assert.equal(featureFailures({ bus_lane_driving: 1 }, "afterPassing").length, 0);
  assert.equal(featureFailures({ bus_lane_driving: 1.001 }, "afterPassing")[0], "drove in a reserved bus lane");
  assert.equal(
    featureMetrics(world, { glare_speeding_seconds: Number.MAX_VALUE }, "afterHeadlights").glare_speeding_seconds,
    Number.MAX_VALUE,
  );
  assert.equal(Object.hasOwn(featureMetrics({}, { amber_lights_run: 2 }, "afterRedLights"), "amber_lights_run"), false);
  assert.equal(Object.hasOwn(featureMetrics({}, { bus_lane_driving: 2 }, "afterPassing"), "bus_lane_driving"), false);
});

test("clock declarations accept enabled boolean and counted feature state", () => {
  assert.equal(featureNeedsDay({ sunGlare: true }), true);
  assert.equal(featureNeedsUtcOffset({ sunGlare: { count: 2 } }), true);
  assert.equal(featureNeedsDay({ sunGlare: { enabled: false, count: 2 } }), false);
  assert.equal(featureNeedsUtcOffset({ sunGlare: false }), false);
});

test("World construction ignores inherited feature settings", () => {
  const world = {};
  const options = Object.create({ nightFlash: true, amberLights: true });
  buildFeatures(world, options, 1, {}, "early");
  assert.equal(world.nightFlash, false);
  assert.equal(world.amberLights, false);
  assert.equal(world.nightFlashSeen, false);
  assert.equal(world.amberLightsSeen, false);
  options.amberLights = true;
  buildFeatures(world, options, 2, {}, "early");
  assert.equal(world.amberLights, true);
  assert.equal(world.pxoLines instanceof Map, true);
});
