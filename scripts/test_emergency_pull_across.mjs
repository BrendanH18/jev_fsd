// Rules judges a pull-over for an emergency vehicle by how near it ends to where it pulls over to, not
// by how far that is from the centre of the route's lane. Two lanes from the kerb the pull-over aims
// 7.5 m right of the lane's centre, and the lane-centre error (2 x 7.5) cancelled its whole bonus: on
// Victoria's Blanshard Street (city seed 2 s2-1), just after a right turn with the route's lane two lanes
// to the left, Rules dropped the pull-over for a stop in the route's lane, swung back across, stopped
// 0.3 m left of the curb lane's centre after a road-closure re-plan, and failed to yield to the
// ambulance. A pull-over within the lane is judged as before.
// node --experimental-default-type=module scripts/test_emergency_pull_across.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { RulesBrain } = await import("../static/js/brain/rules.js");

const V = 2.78;
const snap = { ego: { v: V }, limit: 11.1, target: { v: V, reasons: ["pulling over for the ambulance"] },
  lane: { lanes: 3, index: 0, route_index: 0, delta: 0, center: -7, lateral: 7.4, route_ahead: true, sides: {} }, nav: null };
const sim = (progress, laneErr, headingDeg, inLane) => ({ progress_m: progress, lane_err_end: laneErr, heading_err_deg: headingDeg, end_speed: V,
  stays_in_lane: inLane, stays_on_road: true, min_gap_m: null, collision: null, static_collision: null });
const lane = (offset) => ({ kind: "lane", offset, center: -7, lane: 0, laneIdx: 0 });
const decide = (pull) => new RulesBrain().decideSync(snap, [
  { id: "stop_at_line", law: lane(-7), sim: sim(8.5, 0.3, 5, true) },
  { id: "keep_lane_target", law: lane(-7), sim: sim(8.5, 0.3, 5, true) },
  pull,
]).candidateId;

// Across two lanes to the kerb: the pull-over ends at the curb lane's edge, 7.5 m right of the route's lane.
assert.equal(decide({ id: "pull_over", law: lane(0.5), sim: sim(7.7, 7.5, 3, true) }), "pull_over", "across two lanes, it pulls over");
// (still on its way over, it is judged by how far it has still to go)
assert.equal(decide({ id: "pull_over", law: lane(0.5), sim: sim(7.7, 5.5, 20, true) }), "pull_over", "partway across, it pulls over");
// Within the lane, as before: 0.5 m right of the lane's centre.
const within = { ...snap, lane: { ...snap.lane, lanes: 1, center: 0, lateral: 0 } };
const pullWithin = { id: "pull_over", law: { kind: "lane", offset: 0.5, center: 0, lane: 0, laneIdx: 0 }, sim: sim(7.7, 0.5, 3, true) };
assert.equal(new RulesBrain().decideSync(within, [{ id: "stop_at_line", law: { kind: "lane", offset: 0, center: 0, lane: 0, laneIdx: 0 }, sim: sim(8.5, 0, 0, true) }, pullWithin]).candidateId, "pull_over");
console.log("Rules pulls over across lanes to the kerb for an emergency vehicle");
process.exit(0);
