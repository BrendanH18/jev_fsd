import assert from "node:assert/strict";
import {
  aggregate,
  decidedBy,
  decidedByCounts,
  decidedByTotals,
  DriveMetrics,
  failures,
  trackFields,
} from "../static/js/bench/metrics.js";
import { driverScores, rankDrivers } from "../static/js/bench/scores.js";

const metrics = () => new DriveMetrics(100);
const defaults = { ego: { v: 0 }, violations: { off_road_s: 0 } };
const pilot = { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } };
const moving = (v, latAccel = 0) => ({ ...defaults, ego: { v, latAccel } });
const summary = (m) => m.summary(defaults, pilot, true);

// Measurement thresholds and fallback sampling policies are part of the saved artifact.
const reverse = metrics();
reverse.record(moving(-4), null, null, 0.5);
assert.equal(summary(reverse).distance_m, 2);
const stopped = metrics();
stopped.record(moving(0.29), null, null, 1);
stopped.record(moving(0.3), null, null, 1);
assert.equal(summary(stopped).stopped_s, 1);
const speeding = metrics();
speeding.record(moving(10 * 1.1), null, { limit: 10 }, 1);
speeding.record(moving(11.01), null, { limit: 10 }, 1);
speeding.record(moving(100), null, null, 1);
assert.equal(summary(speeding).speeding_s, 1);
const lateral = metrics();
lateral.record(moving(2, -3), { onRoute: true, routeProj: { s: 5, lateral: 0.75 } }, null, 0.1);
lateral.record(
  moving(2, 2),
  {
    onRoute: true,
    routeProj: { s: 2, lateral: 4 },
    lane: { from_delta: 0, shift: "right", lateral: 0.25 },
  },
  null,
  0.1,
);
lateral.record(
  moving(2),
  {
    onRoute: false,
    routeProj: { s: 2, lateral: 9 },
    lane: { from_delta: 0, shift: "right", lateral: 9 },
  },
  null,
  0.1,
);
assert.equal(summary(lateral).progress, 0.05);
assert.equal(summary(lateral).max_lat_accel, 3);
assert.equal(summary(lateral).lane_max_m, 0.75);
assert.equal(summary(lateral).lane_rms_m, 0.56);
assert.equal(summary(lateral).lane_changes, 1);
lateral.record(moving(1), { onRoute: false, routeProj: { s: 125 } }, null, 0.1);
assert.equal(summary(lateral).progress, 1);
const following = metrics();
const follow = (v, gap_m, closing_mps) => following.record(moving(v), { following: { gap_m, closing_mps } }, null, 0.1);
follow(0.5, 1, 3);
follow(3, -1, 3);
assert.equal(summary(following).min_gap_m, null);
follow(1, 2, 0.3);
assert.equal(summary(following).min_gap_m, 2);
assert.equal(summary(following).min_ttc_s, null);
assert.equal(summary(following).min_headway_s, null);
follow(2, 2, 1);
assert.equal(summary(following).min_ttc_s, 2);
assert.equal(summary(following).min_headway_s, null);
follow(4, 3, 0);
assert.equal(summary(following).min_headway_s, 0.75);
const braking = metrics();
for (const v of [5, 4.5]) braking.record(moving(v), null, null, 0.1);
assert.equal(summary(braking).hard_brakes, 0);
braking.record(moving(4), null, null, 0.1);
assert.equal(summary(braking).hard_brakes, 1);
braking.record(moving(3.5), null, null, 0.1);
assert.equal(summary(braking).hard_brakes, 1);
braking.record(moving(3.5), null, null, 0.1);
assert.equal(summary(braking).max_decel, -5);
assert.equal(summary(braking).max_jerk, 50);
const latency = metrics();
latency.latencies.push(90, 10, 30, 20);
assert.equal(summary(latency).latency_p50_ms, 30);
assert.equal(summary(latency).latency_p95_ms, 90);
assert.equal(latency.latencies.join(), "90,10,30,20");
assert.equal(summary(metrics()).latency_p50_ms, null);

const counts = decidedByCounts(
  { model: 7, partial: 3, local: 6, fallback: 2 },
  { model: 4, partial: 2, local: 3, fallback: 2 },
);
assert.equal(counts.model_decisions, 3);
assert.equal(counts.partial_decisions, 1);
assert.equal(counts.fallback_decisions, 0);
assert.equal(counts.model_share, 0.5);
const noDecisions = decidedByCounts({ model: 0, partial: 0, local: 0, fallback: 0 });
assert.equal(noDecisions.local_share, null);
assert.equal(Object.hasOwn(decidedBy({ brainName: "rules", decidedBy: {} }), "model_share"), false);
const total = decidedByTotals([{}, counts, { model_decisions: 0, local_decisions: 0, fallback_decisions: 1 }]);
assert.equal(total.model_share, 0.429);
assert.equal(total.fallback_share, 0.143);
assert.equal(Object.hasOwn(decidedByTotals([{}, {}]), "local_share"), false);
const flags = trackFields({ track: "open", flaggedChoices: { stop: 1, collision: 2 } });
assert.equal(flags.flagged_choices, 3);
assert.equal(Object.keys(flags.flagged_by_check).join(), "collision,stop");
assert.equal(Object.hasOwn(trackFields({ track: "guarded", flaggedChoices: { stop: 1 } }), "flagged_choices"), false);

const suite = aggregate([
  { distance_m: 1000, arrived: true, pass: false, collisions: 1, at_fault: 0, avg_kmh: 20, cost_usd: 0.0000008 },
  { distance_m: 1000, arrived: true, pass: true, stop_signs: 1, avg_kmh: null, cost_usd: 0.0000008 },
]);
assert.equal(suite.violations_per_km, 1);
assert.equal(suite.avg_kmh, 20);
assert.equal(suite.cost_usd, 0.000002);
assert.equal(aggregate([{ collisions: 1 }]).violations_per_km, null);
assert.equal(aggregate([]).pass_rate, 0);
assert.equal(
  failures({ arrived: false, deadlocks: 2, simulation_error: "boom", collisions: 1 }).join(),
  "simulation error,collision",
);

const result = (id, n) => ({ id, pass: true, arrived: true, time_s: n, tags: { length_m: 1000 }, distance_m: 1000 });
const unmatched = rankDrivers([
  { driver: "a", results: [result("a", 72)] },
  { driver: "b", results: [result("b", 72)] },
]);
assert.equal(unmatched.matched.length, 0);
assert.equal(unmatched.ranking[0].score, null);
assert.equal(rankDrivers([]).ranking.length, 0);
const weighted = driverScores([result("a", 144), { ...result("b", 144), tags: { length_m: 2000 } }]);
assert.equal(weighted.time_lost_s_per_km, 24);
console.log("Benchmark measurement thresholds and display aggregation invariants passed.");
