import assert from "node:assert/strict";
import { CautiousAgent } from "../static/js/agents/cautious.js";
import { RulesBrain } from "../static/js/brain/rules.js";
import { buildQuestions, needsMotionQuestion } from "../static/js/brain/state.js";

const clear = { ego: { v: 3 }, limit: 10, target: { v: 7, reasons: [] }, traffic: [], road: { on_road: true } };
const candidate = (id, { sim, law, ...other } = {}) => ({
  id,
  steer: "hold lane",
  speed: "keep 7.0",
  law: { kind: "lane", offset: 0, center: 0, ...law },
  sim: {
    end_speed: 7,
    progress_m: 10,
    lane_err_end: 0,
    heading_err_deg: 0,
    min_gap_m: 9,
    stays_in_lane: true,
    stays_on_road: true,
    ...sim,
  },
  ...other,
});
const rules = new RulesBrain();
const cautious = new CautiousAgent();
const keep = candidate("keep");
const stop = { control: "stop", bumper_to_line_m: 1 };
const yellow = { control: "signal", signal: "yellow", amber: { stop: true }, bumper_to_line_m: 1 };
const lane = { index: 0, delta: -1, route_ahead: true, sides: { right: { delta: 0, target_v: 4 } } };
const exitBusLane = { lane, bus_lane: { in_effect: true, entering_allowed: false, lanes: [0] } };

const costTester =
  (driver) =>
  (option, key, expected, props = {}) => {
    const { scores } = driver.explain({ ...clear, ...props }, [option]);
    assert.equal(scores[0].terms[key], expected, key);
    const terms = Object.values(scores[0].terms).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(terms - scores[0].cost) < 1e-12, key);
  };
const cost = costTester(rules);
cost(candidate("keep", { sim: { progress_m: 13 } }), "progress", -13);
cost(candidate("keep", { sim: { lane_err_end: -1.5 } }), "lateral_error", 3);
cost(candidate("keep", { sim: { heading_err_deg: -20 } }), "heading_error", 1);
cost(candidate("keep", { sim: { end_speed: 6 } }), "speed_error", 0.8);
cost(candidate("keep", { sim: { end_speed: 8.5 } }), "overspeed", 2);
cost(candidate("keep", { sim: { end_speed: 7.5 } }), "overspeed", undefined);
cost(
  candidate("return", { change: { offer: "return" }, law: { laneIdx: 1 } }),
  "feature_before_speed_cost_0",
  -20,
  exitBusLane,
);
cost(candidate("stop_at_line"), "feature_before_signal_stop_0", -12, { intersection: yellow });
cost(candidate("stop_at_line"), "feature_before_signal_stop_0", undefined, { intersection: yellow, emergency: {} });
cost(candidate("stop_at_line"), "control_line_stop", -6, { intersection: stop });
cost(candidate("stop_at_line"), "control_line_stop", undefined, {
  intersection: { ...stop, control: "signal", signal: "red", right_on_red: { go: true } },
});
cost(candidate("stop_at_destination"), "destination_stop", -6, { nav: { remaining_m: 39 } });
cost(candidate("stop_at_destination"), "destination_stop", undefined, { nav: { remaining_m: 40 } });
cost(candidate("stop_for_pedestrian"), "pedestrian_stop", -6);
for (const id of [
  "stop_for_oncoming",
  "stop_for_cyclist",
  "stop_to_turn_round",
  "yield_to_bus",
  "stop_at_crosswalk",
  "stop_for_school_bus",
  "stop_for_streetcar",
  "stop_before_tracks",
  "wait_short_of_junction",
])
  cost(candidate(id), "required_wait", -6);
cost(candidate("creep_to_look"), "creep_or_give_way", -6);
cost(candidate("wait_to_give_way"), "creep_or_give_way", -6);
cost(candidate("pull_over", { law: { offset: 2, center: 1 }, sim: { lane_err_end: 1 } }), "lateral_error", 0);
cost(candidate("pull_over"), "feature_special_0", -15);
cost(candidate("turn_around", { law: { kind: "turnaround" } }), "turnaround", -50);
cost(candidate("pull_out", { law: { kind: "park" } }), "parking", -50);
cost(candidate("wait_to_park"), "parking_approach", -12);
// Passing cyclists is a registered feature (sim/features/cyclist-pass.js): its costs are named by slot.
const featureTerm = (option, props, slot) => {
  const { scores } = rules.explain({ ...clear, ...props }, [option]);
  const terms = Object.values(scores[0].terms).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(terms - scores[0].cost) < 1e-12, slot);
  const keys = Object.keys(scores[0].terms).filter((term) => term.startsWith(slot));
  assert.ok(keys.length <= 1, slot);
  return keys.length ? scores[0].terms[keys[0]] : undefined;
};
const passing = candidate("pass_cyclist", { law: { detour: { id: "cyclist:one" } } });
assert.equal(featureTerm(passing, { cyclist_pass: {} }, "feature_after_special_"), 1.5);
assert.equal(featureTerm(passing, { cyclist_pass: { going: true } }, "feature_after_special_"), undefined);
assert.equal(featureTerm(candidate("follow_cyclist"), { cyclist_pass: { go: false } }, "feature_after_special_"), -1);
assert.equal(
  featureTerm(candidate("follow_cyclist"), { cyclist_pass: { go: true } }, "feature_after_special_"),
  undefined,
);
for (const id of ["wait_to_merge", "let_merge_in"])
  assert.equal(featureTerm(candidate(id), {}, "feature_stops_"), -6, id);
cost(candidate("hard_brake", { law: { kind: "hard_brake" } }), "hard_brake", 3);
cost(candidate("reverse", { law: { kind: "reverse" } }), "reverse", 2);
cost(candidate("drift", { sim: { stays_in_lane: false } }), "leave_lane", 2);
cost(candidate("change", { change: { offer: "return" } }), "lane_change", 1);
cost(candidate("change", { change: { offer: "abort" } }), "lane_change", 5);
cost(candidate("left", { law: { lane: -2 } }), "outside_route_lane", 4);
cost(candidate("close", { sim: { min_gap_m: 2 } }), "close_gap", 3);
cost(candidate("gap", { sim: { min_gap_m: 3 } }), "close_gap", undefined);

for (const [id, props, slot, expected] of [
  ["stop_for_turn_restriction", {}, "feature_before_stops_", -30],
  ["stop_for_crossing_guard", {}, "feature_stops_", -6],
  ["slow_for_ball", {}, "feature_", -4],
  ["keep", { roadside_stop: { other_lane: true, adjacent_delta: 0 } }, "feature_before_passing_", 6],
]) {
  const { terms } = rules.explain({ ...clear, ...props }, [candidate(id, { law: { lane: 0 } })]).scores[0];
  const [key] = Object.keys(terms).filter((term) => term.startsWith(slot));
  assert.ok(key);
  assert.equal(terms[key], expected);
}

for (const [reason, props] of [
  ["red", { intersection: { ...yellow, signal: "red" } }],
  ["yellow", { intersection: yellow }],
  ["unknown", { intersection: { ...yellow, signal: "unknown" } }],
  ["stop_line", { intersection: stop }],
  ["stop_cross_traffic", { intersection: { ...stop, stop_completed: true, cross_traffic_moving: true } }],
  ["all_way_priority", { intersection: { ...stop, stop_completed: true, priority: { arrived: true, go: false } } }],
  ["roundabout_traffic", { intersection: { ...stop, control: "yield", cross_traffic_moving: true } }],
  ["oncoming_turn_traffic", { intersection: { control: "none", oncoming: { bumper_to_yield_m: 1 } } }],
  ["junction_give_way", { intersection: { control: "none", give_way: { wait_for: {}, bumper_to_hold_m: 1 } } }],
  ["stopped_leader", { following: { gap_m: 2, speed: 0.2 } }],
  ["crossing_pedestrian", { pedestrian: { bumper_to_crosswalk_m: 3 } }],
  ["cyclist_on_right", { right_hook: { bumper_to_yield_m: 1.9 } }],
  ["feature_stop", { lane_closure: { stop_s_route: 10, bumper_to_stop_m: 1 } }],
  ["feature_stop", { geese_crossing: { wait: true, bumper_to_stop_m: 1 } }],
  ["feature_before_signal", { road_closed: { on_route: true, bumper_to_stop_m: 1 } }],
  ["destination", { nav: { arrived: true } }],
]) {
  const explanation = rules.explain({ ...clear, ...props }, [keep]);
  assert.equal(explanation.holds.join(), reason);
  assert.equal(explanation.motion, "stop", reason);
}
const sameHolds = rules.explain({ ...clear, intersection: stop, pedestrian: { bumper_to_crosswalk_m: 2 } }, [keep]);
assert.equal(sameHolds.holds.join(), "stop_line,crossing_pedestrian");
const approached = rules.explain(
  {
    ...clear,
    road_closed: { on_route: true, bumper_to_stop_m: 1 },
    intersection: { ...yellow, bumper_to_line_m: 4 },
  },
  [keep],
);
assert.equal(approached.holds.length, 0);
assert.equal(approached.motion, "drive");
assert.equal(
  rules.explain({ ...clear, intersection: yellow }, [candidate("stop_at_line")]).holdOverride,
  "approach_signal",
);
for (const kind of ["turnaround", "park"]) {
  const explanation = rules.explain({ ...clear, intersection: stop }, [candidate("permitted", { law: { kind } })]);
  assert.equal(explanation.holdOverride, kind);
  assert.equal(explanation.motion, "drive");
}
assert.equal(rules.explain({ ...clear, nav: { arrived: true }, parking: { mode: "in" } }, [keep]).holds.length, 0);
assert.equal(rules.explain(clear, []).candidateId, null);
assert.equal(rules.explain(clear, [keep]).turnLaneSpeed, null);
assert.equal(
  rules.explain({ ...clear, lane }, [candidate("outside", { laneTarget: 6, law: { lane: -1 } })]).scores[0].targetSpeed,
  4,
);
assert.equal(
  rules.explain({ ...clear, lane }, [candidate("return", { laneTarget: 6, law: { lane: 0 } })]).scores[0].targetSpeed,
  6,
);
assert.equal(rules.explain(clear, [candidate("outside", { laneTarget: 24 })]).scores[0].targetSpeed, 10);
assert.equal(rules.explain(clear, [candidate("stopped", { laneTarget: 0 })]).scores[0].targetSpeed, 0);

const cautiousCost = costTester(cautious);
cautiousCost(candidate("keep", { sim: { end_speed: 5 } }), "speed_error", 4);
cautiousCost(candidate("keep", { sim: { lane_err_end: -0.5 } }), "lateral_error", 1.5);
cautiousCost(candidate("keep", { sim: { min_gap_m: 4 } }), "clearance", 6);
cautiousCost(candidate("slow", { sim: { progress_m: 5 } }), "progress", -1.5);
assert.equal(cautious.explain(clear, [keep]).targetReason, "sensing_target");
assert.equal(cautious.explain({ ...clear, target: undefined }, [keep]).targetReason, "cautious_speed_cap");
assert.equal(cautious.explain({ ...clear, limit: 5 }, [keep]).desiredSpeed, 4);
assert.equal(
  cautious.explain({ ...clear, road_closed: { on_route: true, bumper_to_stop_m: 8 } }, [keep]).targetReason,
  "feature_stop",
);
assert.equal(cautious.explain(clear, [{ ...keep, flagged: true }]).flagged.join(), "keep");
assert.equal(cautious.explain(clear, [{ ...keep, flagged: true }]).motionReason, "no_candidate");
assert.equal(cautious.explain(clear, [keep]).motionReason, "moving_prediction");

const stopping = (id, other) => candidate(id, { sim: { end_speed: 0 }, ...other });
for (const [id, fields, props, selection, motionReason] of [
  ["pull_over", {}, {}, "feature_first", "feature_planned_stop"],
  ["stop_for_closure", {}, {}, "feature_before_bus_lanes", "stationary_prediction"],
  [
    "return",
    { change: { offer: "return" }, law: { laneIdx: 1 } },
    exitBusLane,
    "feature_reserved_lane",
    "stationary_prediction",
  ],
  [
    "stop_for_pedestrian",
    {},
    { pxo: { bumper_to_crosswalk_m: 2 } },
    "feature_after_bus_lanes",
    "stationary_prediction",
  ],
  ["pull_out", {}, {}, "parking", "planned_stop"],
  ["pass_cyclist", {}, {}, "feature_passing", "stationary_prediction"],
  ["stop_for_crossing_guard", {}, {}, "feature_after_passing", "stationary_prediction"],
  ["wait_for_geese", {}, { geese_crossing: { wait: true } }, "feature", "stationary_prediction"],
  ["wait_for_officer", {}, { traffic_officer: { direction: "stop" } }, "feature_before_amber", "feature_planned_stop"],
  ["stop_at_line", {}, { intersection: yellow }, "approach_signal", "approach_signal"],
  [
    "ease_round_pothole",
    {},
    { pothole: { room: true }, target: { v: 0 } },
    "feature_after_amber",
    "stationary_prediction",
  ],
  ["wait_to_park", {}, {}, "score", "planned_stop"],
  ["stop", {}, {}, "score", "stationary_prediction"],
]) {
  const report = cautious.explain({ ...clear, ...props }, [stopping(id, fields)]);
  assert.equal(report.selection, selection, id);
  assert.equal(report.motionReason, motionReason, id);
  assert.equal(report.candidateId, id);
  assert.equal(report.scores.length, selection === "score" ? 1 : 0);
}
const flagged = { ...candidate("pull_over"), flagged: true };
assert.equal(cautious.explain(clear, [flagged, keep]).candidateId, "keep");
assert.equal(cautious.explain(clear, [candidate("at_threshold", { sim: { end_speed: 0.3 } })]).motion, "drive");

// Both diagnostic paths execute the ordinary policy and leave its result envelope alone.
for (const brain of [rules, cautious]) {
  const offers = [candidate("first"), candidate("second")];
  assert.equal(brain.decideSync(clear, offers).candidateId, "first");
  assert.equal(brain.explain(clear, offers).candidateId, "first");
  assert.equal(
    brain
      .explain(clear, offers)
      .scores.map((x) => x.id)
      .join(),
    "first,second",
  );
  assert.equal(Object.hasOwn(brain.decideSync(clear, offers), "policy"), false);
}

assert.equal(needsMotionQuestion({ ...clear, nav: { remaining_m: 30 } }), false);
assert.equal(needsMotionQuestion({ ...clear, nav: { remaining_m: 29.9 } }), true);
assert.equal(needsMotionQuestion({ ...clear, roadside: [{ kind: "parked car", ahead: 4 }] }), false);
assert.equal(needsMotionQuestion({ ...clear, roadside: [{ kind: "bin", ahead: 4 }] }), true);
const singleRoute = [{ id: "one", summary: "one way on" }];
assert.equal(Object.hasOwn(buildQuestions(clear, [keep], { routeOptions: singleRoute }).questions, "route"), false);
assert.equal(buildQuestions(clear, [keep]).local.motion.local, true);
assert.equal(buildQuestions(clear, []).local.vector, undefined);
const advisory = { ...keep, id: "advisory", flagged: true, reject: "runs_red" };
assert.match(buildQuestions(clear, [keep, advisory], { track: "open" }).questions.vector.criteria.advisory, /flagged:/);

console.log("Planning policy explanations and regressions passed.");
