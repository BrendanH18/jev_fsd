import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SNOW_PLOW } from "../static/js/sim/vehicle.js";
import {
  FEATURES,
  featureOptionalDetour,
  firstHookResult,
  laneControlDetour,
  primaryDetour,
  promptLines,
} from "../static/js/sim/features/index.js";
import { DriveRecorder } from "../static/js/lab/recorder.js";
import { EvaluationTrace } from "../static/js/lab/trace.js";
import { hazardFlags } from "../static/js/brain/sensors.js";
import { situationClauses, toJevState } from "../static/js/brain/state.js";

const byKey = (key) => FEATURES.find((feature) => feature.key === key);
const plows = byKey("plows");
const closures = byKey("closures");
const cycling = byKey("passCyclists");
const lane = { id: "at_target", law: { kind: "lane" } };
const hardBrake = { id: "hard_brake", law: { kind: "hard_brake" } };
const travel = { ...lane, change: { dir: "right" } };
const makePlow = (fields) => ({
  id: "plow",
  kind: "snow plow",
  speed: 5,
  lane: "same",
  holds: true,
  gap_m: 20,
  s_rear_route: 25,
  lateral_route: 0,
  keep_back_m: 30,
  ...fields,
});
const makeClosure = (fields) => ({
  id: "zone",
  side: "closed",
  closed_lane: "right",
  turn: "open",
  wait: true,
  stop_s_route: 20,
  bumper_to_stop_m: 4,
  bumper_to_merge_m: 4,
  limit_mps: 8,
  ...fields,
});
const makePass = (fields) => ({
  id: "passing",
  cyclist_id: "bike",
  min_pass_m: 1,
  possible: false,
  why: "junction",
  centre_line_route: 0,
  follow_gap_m: 6,
  follow_mps: 3,
  limit_mps: 7,
  gap_m: 10,
  speed: 2,
  ...fields,
});

const plowTarget = (fields, v = 12) => {
  const reasons = [];
  return { v: plows.target.run({ snow_plow: makePlow(fields) }, v, reasons), reasons };
};
test("Require a halt at one third of the plow’s stay-back distance", () =>
  assert.equal(plowTarget({ gap_m: 10 }).v, 0));
test("Interpolate the plow following target inside the keep-back distance", () =>
  assert.equal(plowTarget({ gap_m: 20 }).v, 2.5));
test("Use the alongside-plow drop-back reason", () =>
  assert.equal(plowTarget({ gap_m: -2 }).reasons[0], "dropping back behind the snow plow"));
test("Clamp the plow drop-back speed to zero for a nearly stationary plow", () =>
  assert.equal(plowTarget({ gap_m: -2, speed: 1 }).v, 0));
test("Keep an already tighter target without adding a plow reason", () =>
  assert.equal(plowTarget({}, 1).reasons.length, 0));
test("Leave the target alone when the plow is outside its keep-back distance", () =>
  assert.equal(plowTarget({ gap_m: 30 }).v, 12));

const plowActor = { kind: SNOW_PLOW.kind };
test("Keep the ordinary headway for a plow driver following another plow", () => {
  assert.equal(plows.trafficLeadPolicy(plowActor, plowActor, 12, 3).extraGap, undefined);
});
test("Preserve the longer high-speed headway after subtracting the standard gap", () => {
  assert.equal(plows.trafficLeadPolicy({}, plowActor, 25, 2).extraGap, 98);
});
test("Allow an exact keep-back distance when returning ahead of a plow", () => {
  assert.equal(!!plows.laneGapBlocked({ snow_plow: makePlow() }, { rear: { id: "plow", gap_m: 30 } }), false);
});
test("Keep the ordinary gap rule when a plow is ahead, not behind the lane change", () => {
  assert.equal(plows.trafficMergeGap(plowActor, 1, 12), 0);
});
test("Keep the lane offer available when the plow is not its leader", () => {
  assert.equal(
    plows.lanePassBlocked({ snow_plow: makePlow({ may_pass: false }) }, { dir: "right" }, { id: "car" }),
    false,
  );
});
test("Retain the plow constraint for an adjacent lane until the offset puts it far enough right", () => {
  const snap = { snow_plow: makePlow({ lateral_route: 3 }) };
  plows.laneTargetFields(snap, 1.4);
  assert.equal(snap.snow_plow.id, "plow");
  plows.laneTargetFields(snap, 1);
  assert.equal(snap.snow_plow, null);
});

function plowCheck(fields, frameMove = () => 0) {
  const check = plows.sim.run({ route: { frameMove } }, { snow_plow: makePlow(fields) }, [], { startS: 0, horizon: 3 });
  check?.start();
  return check;
}
test("Skip plow prediction checks when sensing puts the plow alongside", () =>
  assert.equal(plowCheck({ gap_m: -0.01 }), null));
test("Keep the plow pass rejection if the route frame moves sideways", () => {
  const check = plowCheck({ speed: 0 }, () => 3);
  check.along(25, 3, null, 0, 0.5);
  assert.equal(check.reject(lane, 25, 3, 0), "passes_plow_on_right");
});
test("Keep plow pass permission on the left when visibility is adequate", () => {
  const check = plowCheck({ lane: "same", speed: 0 });
  check.along(25, 3, null, -3, 0.5);
  assert.equal(check.reject(lane, 25, 3, -3), null);
});
test("Apply the all-sides plow prediction restriction in poor sight", () => {
  const check = plowCheck({ lane: "right", speed: 0 });
  check.along(25, 3, null, -3, 0.5);
  assert.equal(check.reject(lane, 25, 3, -3), "passes_plow_on_right");
});
test("Release a plow prediction latch before evaluating another candidate", () => {
  const check = plowCheck();
  check.along(30, 3, null, 3, 0.5);
  check.start();
  assert.equal(check.reject(lane, 0, 3, 0), null);
});
test("Use projected plow motion to distinguish shrinking and growing headway", () => {
  const check = plowCheck();
  assert.equal(check.reject(lane, 16, 3, 0), null);
  assert.equal(check.reject(lane, 18, 3, 0), "follows_plow_too_close");
});
test("Keep hard braking eligible when its predicted plow headway shrinks", () => {
  assert.equal(plowCheck().reject(hardBrake, 18, 3, 0), null);
});

function closureCheck(fields) {
  const check = closures.sim.run({}, { lane_closure: makeClosure(fields) });
  check.start();
  return check;
}
test("Accept the exact metre of zipper stop overshoot", () => {
  const check = closureCheck();
  check.along(18, 3);
  assert.equal(check.reject(lane), null);
});
test("Preserve the separate let-in overshoot threshold", () => {
  const check = closureCheck({ wait: false, let_in_for: "merger", side: "open" });
  check.along(18.5, 3);
  assert.equal(check.reject(lane), null);
  check.along(18.501, 3);
  assert.equal(check.reject(lane), "takes_merge_turn");
});
test("Prioritize a violated zipper hold over an early lane change", () => {
  const check = closureCheck();
  check.along(20, 3);
  assert.equal(check.reject(travel), "merges_out_of_turn");
});
test("Classify a lane change after merging differently from a premature merge", () => {
  const check = closureCheck({ merged: true, wait: false });
  assert.equal(check.reject(travel), "into_closed_lane");
});
test("Permit a lane change away from the closed lane when already in an open lane", () => {
  const check = closureCheck({ side: "open", wait: false });
  assert.equal(check.reject({ ...lane, change: { dir: "left" } }), null);
});
test("Keep the zipper hold’s hard-brake exception", () => {
  const check = closureCheck();
  check.along(22, 3);
  assert.equal(check.reject(hardBrake), null);
});
test("Clear the merge-line crossing latch before the next prediction", () => {
  const check = closureCheck();
  check.along(22, 3);
  check.start();
  assert.equal(check.reject(lane), null);
});
test("Leave the street speed limit in place if it is lower than the closure approach cap", () => {
  const snap = { limit: 5, lane_closure: makeClosure() };
  closures.limit.run(snap);
  assert.equal(snap.limit, 5);
});
test("Tag a granted zipper approach with the in-turn reason at its speed ceiling", () => {
  const reasons = [];
  const snap = { lane_closure: makeClosure({ wait: false, stop_s_route: null }) };
  assert.equal(closures.target.run(snap, 8, reasons, {}), 8);
  assert.equal(reasons[0], "lane closed: merge in turn");
});
test("Treat a near let-in stop as legitimate before Rules would hold motion", () => {
  const snap = { lane_closure: makeClosure({ wait: false, let_in_for: "merger" }) };
  assert.equal(closures.legitimateStop(snap), true);
  assert.equal(closures.rulesStop(snap), false);
});
test("Distinguish motion instructions for waiting to merge and letting a car merge", () => {
  const me = { lane_closure: makeClosure() };
  const other = { lane_closure: makeClosure({ wait: false, let_in_for: "merger" }) };
  assert.match(closures.holdStill.run(me), /it is not the car's turn/);
  assert.match(closures.holdStill.run(other), /letting a car/);
});

const combinedSnapshot = { snow_plow: makePlow(), lane_closure: makeClosure(), cyclist_pass: makePass() };
const road = { on_road: true, lateral: 0, heading_error: 0 };
test("Keep the three new hazards in their established relative order", () => {
  assert.equal(
    hazardFlags({ ...combinedSnapshot, road, traffic: [] }).join("|"),
    "lane closure|snow plow|cyclist ahead",
  );
});
test("Keep closure, plow and cyclist wording in their established situation order", () => {
  assert.equal(
    situationClauses({ ...combinedSnapshot, road })
      .map((line) => line.slice(0, 3))
      .join("|"),
    "A r|A s|A c",
  );
});
test("Keep closure, cyclist and plow model fields in their established serialized order", () => {
  const snap = { ...combinedSnapshot, ego: { v: 1 }, limit: 9, road, traffic: [] };
  const fields = Object.keys(toJevState(snap, [], {})).filter((field) => Object.hasOwn(combinedSnapshot, field));
  assert.equal(fields.join(","), "lane_closure,cyclist_pass,snow_plow");
});
test("Expose the work-zone, lane-control and optional detours independently", () => {
  const snap = {
    work_zone: { detour: { id: "flagger" } },
    lane_closure: { detour: { id: "zipper" } },
    cyclist_pass: { detour: { id: "pass" } },
  };
  assert.equal(primaryDetour(snap).id, "flagger");
  assert.equal(laneControlDetour(snap).id, "zipper");
  assert.equal(featureOptionalDetour(snap).id, "pass");
});
test("Separate zipper directions from parking directions in prompt assembly", () => {
  assert.match(promptLines("beforeParking"), /zipper merge/);
  assert.doesNotMatch(promptLines("parking"), /zipper merge/);
});
test("Keep the passing instruction after parking advice without replacing that advice", () => {
  assert.match(promptLines("afterParking"), /garbage truck/);
  assert.match(promptLines("afterParkingAdvice"), /follow_cyclist/);
});

const bikeSnap = (fields) => ({ cyclist_pass: makePass(fields) });
const bikeCandidate = { id: "pass_cyclist", law: { kind: "lane", detour: { id: "cyclist:bike" } } };
test("Keep an unstarted pass from narrowing the candidate list", () =>
  assert.equal(cycling.activeManeuver(bikeSnap(), {}), null));
test("Keep the fall-back option when an active pass stops being clear", () => {
  const plan = cycling.activeManeuver(bikeSnap({ going: true, go: false }), {});
  assert.equal(plan.keep({ id: "follow_cyclist" }), true);
  assert.equal(plan.keep(lane), false);
});
test("Forward the active passing detour to the braking law", () => {
  const plan = cycling.activeManeuver(bikeSnap({ going: true }), { detour: { id: "passing" } });
  assert.equal(plan.brake.detour.id, "passing");
});
test("Do not exempt an unrelated leading bike from following", () => {
  assert.equal(cycling.followingOmitted(bikeSnap({ go: true }), { id: "other" }), false);
});
test("Restore the target bike to following when a pass is no longer clear", () => {
  assert.equal(cycling.followingOmitted(bikeSnap({ go: false }), { id: "bike" }), false);
});
test("Read the passing clearance from the street limit ahead of the temporary speed cap", () => {
  const rules = cycling.passClearance({ passCyclists: true }, { road: { limit: 25 }, limit: 8 });
  assert.equal(rules.metres, 1.5);
});
test("Prefer the planned clearance over a newly sensed street limit during a pass", () => {
  const rules = cycling.passClearance({ passCyclists: true }, { ...bikeSnap({ min_pass_m: 1.5 }), road: { limit: 8 } });
  assert.equal(rules.metres, 1.5);
});
test("Do not charge Rules repeatedly for starting a pass already under way", () => {
  assert.equal(cycling.rulesCost.run(bikeCandidate, bikeSnap({ going: true })), 0);
});
test("Preserve Rules’ incentive to follow a cyclist waiting for a safe chance to pass", () => {
  assert.equal(cycling.rulesCost.run({ id: "follow_cyclist", law: lane.law }, bikeSnap({ go: false })), -1);
});
test("Do not report a stopped cyclist as a legitimate hold when there is room to keep moving", () => {
  assert.equal(cycling.legitimateStop(bikeSnap({ gap_m: 20 })), false);
});
test("Do not give an alongside passing candidate a redundant follow alternative", () => {
  const out = [];
  cycling.candidates.run(
    {
      snap: bikeSnap({ go: true, going: true, beside: true }),
      inLane: (law) => law,
      passing: {},
      speedLabel: () => "",
    },
    out,
  );
  assert.equal(out.map((candidate) => candidate.id).join(","), "pass_cyclist");
});
test("Keep model advice for a blocked pass distinct from a change of mind during a pass", () => {
  assert.match(cycling.clause.run(bikeSnap()), /would not be over before the junction/);
  assert.match(cycling.clause.run(bikeSnap({ going: true, go: false })), /fall back in behind/);
});
test("Keep plows out of cyclist overtaking even when the pass option is on", () => {
  assert.equal(cycling.trafficOvertaking({ passCyclists: true }, plowActor, null, [], 0.1, false), null);
});
test("Avoid looking up a traffic path while a new pass is temporarily held", () => {
  assert.equal(cycling.trafficOvertaking({ passCyclists: true }, {}, null, [], 0.1, true), null);
});

function encounter({
  ahead = 11,
  lateral = 0,
  side = 0,
  opposing = true,
  speed = 3,
  detour = bikeCandidate.law.detour,
} = {}) {
  const check = cycling.sim.run({}, bikeSnap());
  check.start();
  const box = { halfWidth: 1, halfLength: 2 };
  check.near(
    { psi: 0, v: speed },
    box,
    { psi: opposing ? Math.PI : 0, v: speed },
    box,
    ahead,
    side,
    true,
    false,
    lateral,
    { detour },
  );
  return check;
}
test("Reject an oncoming encounter based on distance even at low closing speed", () => {
  assert.equal(encounter({ speed: 0.25 }).reject(lane), "crosses_into_oncoming_traffic");
});
test("Reject a fast-closing encounter beyond the fixed distance threshold", () => {
  assert.equal(encounter({ ahead: 15, speed: 8 }).reject(lane), "crosses_into_oncoming_traffic");
});
test("Keep a passing candidate clear when the oncoming car is outside its lateral corridor", () => {
  assert.equal(encounter({ side: 2.5 }).reject(lane), null);
});
test("Keep ordinary lane following exempt from the cyclist-specific oncoming rejection", () => {
  assert.equal(encounter({ detour: null }).reject(lane), null);
});
test("Keep parallel vehicles outside the oncoming prediction check", () => {
  assert.equal(encounter({ opposing: false }).reject(lane), null);
});
test("Avoid an oncoming rejection when the ego body has not crossed the centre line", () => {
  assert.equal(encounter({ lateral: 1 }).reject(lane), null);
});
test("Avoid an oncoming rejection for a vehicle entirely behind the ego", () => {
  assert.equal(encounter({ ahead: -1 }).reject(lane), null);
});
test("Allow hard braking when the passing prediction has found oncoming traffic", () => {
  assert.equal(encounter().reject(hardBrake), null);
});

test("Keep the merge replay marker after the lane-closure record owns its declaration", () => {
  const recorder = new DriveRecorder();
  recorder.mark(2, "merged_out_of_turn");
  assert.equal(recorder.markers[0]?.t, 2);
});
test("Keep the cyclist replay marker after the passing record owns its declaration", () => {
  const recorder = new DriveRecorder();
  recorder.mark(3, "close_pass");
  assert.equal(recorder.markers[0]?.t, 3);
});
test("Keep the shared yield and all three passing events in trace counter order", () => {
  const trace = new EvaluationTrace();
  trace.measurements(
    {
      t: 1,
      violations: { failed_to_yield: 1, plow_right_passes: 1, merge_cut_ins: 1, close_passes: 1 },
    },
    {},
  );
  assert.equal(
    trace.events.map((event) => event.type).join(","),
    "failed_to_yield,plow_right_passes,merge_cut_ins,close_passes",
  );
});
test("Choose the first usable result from an ordered set of feature hooks", () => {
  let reachedLast = false;
  const last = () => {
    reachedLast = true;
    return "late";
  };
  const result = firstHookResult([() => null, (value) => value, last], "first");
  assert.equal(reachedLast, false);
  assert.equal(result, "first");
});
