import assert from "node:assert/strict";
import { assertCandidateBatch, assertPrediction } from "../static/js/brain/candidate-validation.js";
import { HORIZON_S, SIM_DT, sampleCandidates, simulateAll, speedVsTarget } from "../static/js/brain/candidates.js";
import { buildQuestions, needsMotionQuestion, toJevState } from "../static/js/brain/state.js";
import { buildSnapshot } from "../static/js/brain/sensors.js";
import { MapData } from "../static/js/map/mapdata.js";
import { Route } from "../static/js/map/route.js";
import { World } from "../static/js/sim/world.js";

const candidate = (fields) => ({ id: "merge_left", law: { kind: "lane", vTarget: 5, ...fields } });
const shift = { from: -1, start: 5, len: 10 };
const detour = { from: -1, full: 6, back: 6, to: 10, shift: -2 };
const turnaround = {
  kind: "turnaround",
  vTarget: 2,
  id: "uturn@31",
  phase: "forward",
  sTurn: 31,
  psiOut: Math.PI,
  side: 1,
  outLo: 4,
  outHi: 8,
  legs: 0,
  travelled: 0,
};
const parking = {
  kind: "park",
  mode: "in",
  vTarget: 0,
  phase: "align",
  id: "bay",
  ox: 10,
  oy: 20,
  h: Math.PI / 2,
  kerbW: 2,
  R: 5.8,
  phi1: 0.5,
  backU: 12,
  frontU: 17,
  goalU: 14,
  goalW: 2,
  startU: 20,
  legs: 0,
  travelled: 0,
};
const pullOut = { ...parking, mode: "out", phase: "out_wait", laneW: -1, startW: 1.1, endU: 19 };
const prediction = {
  max_accel: 1.5,
  max_decel: 2,
  max_lateral_accel: 1.2,
  min_clearance_m: Infinity,
  end_speed: -0.3,
  progress_m: -1,
  lane_err_end: -0.5,
  heading_err_deg: -4,
  min_gap_m: Infinity,
  off_road_fraction: 0,
  end: [0, 7],
};

assert.throws(() => assertCandidateBatch({}), /batch must be an array/);
assert.throws(() => assertCandidateBatch(Array(1)), /index 0 needs an id/);
assert.throws(() => assertCandidateBatch([{ id: " " }]), /index 0 needs an id/);
assert.throws(() => assertCandidateBatch([candidate(), candidate()]), /Duplicate candidate id: merge_left/);
assert.throws(() => assertCandidateBatch([{ id: "empty", law: [] }]), /empty has invalid law$/);
assert.throws(() => assertCandidateBatch([{ ...candidate(), laneUntil: -Infinity }]), /laneUntil/);
assert.throws(() => assertCandidateBatch([{ ...candidate(), laneTarget: -2 }]), /laneTarget/);
assert.doesNotThrow(() => assertCandidateBatch([{ ...candidate(), laneUntil: Infinity, laneTarget: 0 }]));

for (const [law, error] of [
  [{ kind: "constructor" }, /law.kind/],
  [{ vTarget: -1 }, /law.vTarget/],
  [{ kind: "steer", steer: Infinity }, /law.steer/],
  [{ kind: "reverse", target: [12, NaN] }, /law.target/],
  [{ offset: Infinity }, /law.offset/],
  [{ center: "0" }, /law.center/],
  [{ lane: 0.5 }, /law.lane$/],
  [{ laneIdx: -1 }, /law.laneIdx/],
  [{ s0: NaN }, /law.s0/],
  [{ stopAt: "2" }, /law.stopAt$/],
  [{ stopAtRoute: Infinity }, /law.stopAtRoute/],
  [{ stopDecel: -2 }, /law.stopDecel/],
  [{ stopReaction: -0.02 }, /law.stopReaction/],
  [{ shift: true }, /law.shift$/],
  [{ shift: { ...shift, from: NaN } }, /law.shift.from/],
  [{ shift: { ...shift, start: Infinity } }, /law.shift.start/],
  [{ shift: { ...shift, len: 0 } }, /law.shift.len/],
  [{ detour: 4 }, /law.detour$/],
  [{ detour: { ...detour, from: Infinity } }, /law.detour bounds/],
  [{ detour: { ...detour, to: 5 } }, /law.detour order/],
  [{ detour: { ...detour, shift: NaN } }, /law.detour.shift/],
  [{ slowTo: { from: 1, to: 2, mps: 2 } }, /law.slowTo$/],
  [{ slowTo: [null] }, /law.slowTo\[0\]$/],
  [{ slowTo: [{ from: 8, to: 1, mps: 0 }] }, /law.slowTo\[0\] bounds/],
  [{ slowTo: [{ from: 1, to: 8, mps: -1 }] }, /law.slowTo\[0\].mps/],
  [{ ...turnaround, id: "" }, /law.id/],
  [{ ...turnaround, phase: "paused" }, /law.phase/],
  [{ ...turnaround, sTurn: NaN }, /law.sTurn/],
  [{ ...turnaround, psiOut: Infinity }, /law.psiOut/],
  [{ ...turnaround, side: 0 }, /law.side/],
  [{ ...turnaround, outLo: -1 }, /law.outLo/],
  [{ ...turnaround, outHi: 8.4 }, /law.outHi$/],
  [{ ...turnaround, outHi: 4 }, /law.outHi range/],
  [{ ...turnaround, legs: 1.5 }, /law.legs/],
  [{ ...turnaround, travelled: -1 }, /law.travelled/],
  [{ ...parking, mode: "__proto__" }, /law.mode/],
  [{ ...parking, phase: "out_wait" }, /law.phase/],
  [{ ...parking, ox: Infinity }, /law.ox/],
  [{ ...parking, oy: NaN }, /law.oy/],
  [{ ...parking, h: "east" }, /law.h/],
  [{ ...parking, kerbW: Infinity }, /law.kerbW/],
  [{ ...parking, R: 0 }, /law.R/],
  [{ ...parking, phi1: -1 }, /law.phi1/],
  [{ ...parking, backU: NaN }, /law.backU/],
  [{ ...parking, frontU: Infinity }, /law.frontU/],
  [{ ...parking, frontU: 10 }, /law parking bounds/],
  [{ ...parking, goalW: NaN }, /law parking goal/],
  [{ ...parking, startU: Infinity }, /law.startU/],
  [{ ...pullOut, startW: false }, /law pull-out lateral frame/],
  [{ ...pullOut, endU: NaN }, /law.endU/],
]) {
  assert.throws(() => assertCandidateBatch([candidate(law)]), error, error.toString());
}
for (const law of [
  { shift, detour, offset: -2, stopAt: -1, stopAtRoute: -1 },
  { shift: null, detour: null, stopAt: null, slowTo: [] },
  { kind: "steer", steer: -0.3, vTarget: 0 },
  { kind: "reverse", target: null },
  { kind: "reverse", target: [-2, 0] },
  { kind: "hard_brake", vTarget: undefined },
  { ...turnaround, phase: "stuck" },
  { ...parking, phase: "parked" },
  { ...pullOut, phase: "done" },
  { slowTo: [{ from: -2, to: 3, mps: 0 }] },
]) {
  assert.doesNotThrow(() => assertCandidateBatch([candidate(law)]));
}
assert.doesNotThrow(() => assertPrediction({ id: "valid_reverse", sim: prediction }));
assert.throws(() => assertPrediction({ id: "absent" }), /absent has invalid prediction sim$/);
for (const [field, value] of [
  ["max_accel", -1],
  ["max_decel", Infinity],
  ["max_lateral_accel", "0"],
  ["min_clearance_m", -Infinity],
  ["end_speed", NaN],
  ["progress_m", Infinity],
  ["lane_err_end", null],
  ["heading_err_deg", NaN],
  ["min_gap_m", "unknown"],
  ["off_road_fraction", -0.1],
  ["off_road_fraction", 1.1],
  ["end", [10]],
]) {
  assert.throws(
    () => assertPrediction({ id: "named_candidate", sim: { ...prediction, [field]: value } }),
    new RegExp(`named_candidate has invalid prediction sim\\.${field}`),
  );
}

const points = [
  [0, 0],
  [60, 0],
  [110, 0],
];
const map = new MapData({
  bbox: [0, 0, 1, 1],
  extent: [0, -5, 110, 5],
  nodes: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 110, y: 0 },
  ],
  edges: [
    {
      id: "in",
      from: "a",
      to: "b",
      pts: points,
      length: 110,
      lanes: 1,
      lane_width: 3.5,
      width: 3.5,
      lane_offsets: [0],
      asphalt: [-1.75, 1.75],
      cls: "residential",
      limit: 13.9,
      oneway: true,
    },
  ],
  lanes: [{ edge: "in", idx: 0, pts: points }],
  intersections: [],
  stops: [],
  buildings: [],
});
const world = new World(map, { parked: 0, pedestrians: 0 });
world.route = new Route({ polyline: points, edges: ["in"], lanes: [0], turns: [] }, map);
world.ego.x = 15;
world.ego.v = 5;
const snap = buildSnapshot(world);
const options = sampleCandidates(snap, world);
assert.equal(options.at(-1).id, "hard_brake");
assert.equal(options.filter((c) => c.id === "hard_brake").length, 1);
assert.ok(options.length <= 16);
assert.equal(options.length, new Set(options.map((c) => c.id)).size);
const ratherStop = sampleCandidates({ ...snap, nav: { ...snap.nav, remaining_m: 8 } }, world);
assert.ok(ratherStop.some((c) => c.id === "stop_at_destination"));
const cap = { speed_mps: 2, stop: false };
const amber = sampleCandidates({ ...snap, amber_clear: cap }, world);
assert.ok(amber.some((c) => c.law.kind === "lane"));
assert.ok(amber.every((c) => c.law.vTarget === undefined || c.law.vTarget <= cap.speed_mps));
assert.equal(simulateAll([], snap, world).eligible.length, 0);
assert.throws(() => simulateAll([candidate({ vTarget: NaN })], snap, world), /merge_left has invalid law.vTarget/);
assert.throws(() => simulateAll([options[0], options[0]], snap, world), /Duplicate candidate id/);
assert.equal(options[0].sim, undefined);
const sim = simulateAll(options, snap, world);
assert.equal(sim.mustStop, false);
assert.ok(sim.eligible.length > 1);
const c = sim.eligible[0];
assert.equal(c.trace.length, Math.round(HORIZON_S / SIM_DT) + 1);
assert.equal(c.trace[0][0], world.ego.x);
assert.equal(c.trace.at(-1)[0], c.sim.end[0]);
assert.equal(c.trace.at(-1)[1], c.sim.end[1]);
assert.equal(c.sim.static_collision, null);
assert.equal(c.sim.crosses_stop_line, false);
assert.equal(c.sim.min_gap_m, Infinity);
assert.equal(c.sim.min_clearance_m, Infinity);
assert.equal(c.sim.off_road_fraction, 0);
assert.equal(c.sim.stays_on_road, true);
assert.equal(c.sim.stays_in_lane, true);
assert.equal(world.ego.x, 15);
assert.equal(world.ego.v, 5);
const state = toJevState({ ...snap, traffic: undefined }, options);
assert.equal(Object.hasOwn(state, "traffic"), false);
assert.equal(Object.hasOwn(state, "rejected"), false);
assert.equal(state.candidates.map((x) => x.id).join(), sim.eligible.map((x) => x.id).join());
assert.equal(needsMotionQuestion({ traffic: undefined }), false);
const named = { ...c, id: "__proto__" };
const { questions } = buildQuestions(snap, [c, named]);
assert.equal(Object.hasOwn(questions.vector.criteria, "__proto__"), true);
assert.match(Object.getOwnPropertyDescriptor(questions.vector.criteria, "__proto__").value, /m, clear/);
assert.equal(Object.getPrototypeOf(questions.vector.criteria) === Object.prototype, true);
const single = buildQuestions(snap, [named]);
assert.equal(Object.getOwnPropertyDescriptor(single.local.vector.probabilities, "__proto__").value, 1);
const cyclist = toJevState({ ...snap, cyclist_pass: { possible: false, why: "constructor", speed: 1 } }, []);
assert.equal(cyclist.cyclist_pass.pass, "not here: the passing conditions are not met");
const known = toJevState({ ...snap, cyclist_pass: { possible: false, why: "junction", speed: 1 } }, []);
assert.match(known.cyclist_pass.pass, /junction ahead/);
assert.equal(speedVsTarget(0, 0), "at target");
assert.equal(speedVsTarget(0.05, 4), "stopped");
assert.equal(speedVsTarget(0.06, 4), "below target");
assert.equal(speedVsTarget(4.6, 4), "above target");
console.log("Planning candidate validation and predictions passed.");
process.exit(0);
