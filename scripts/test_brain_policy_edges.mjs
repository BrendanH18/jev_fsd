import assert from "node:assert/strict";
import { CautiousAgent } from "../static/js/agents/cautious.js";
import { RulesBrain } from "../static/js/brain/rules.js";
import { buildSnapshot, desiredSpeed, hazardFlags, waitsItsTurn } from "../static/js/brain/sensors.js";
import { pathHazard, sampleCandidates, simulateAll } from "../static/js/brain/candidates.js";
import { buildQuestions, needsMotionQuestion, toJevState } from "../static/js/brain/state.js";
import { DeadlockDetector, safetyBrake } from "../static/js/brain/safety.js";
import { OPEN_SYSTEM_PROMPT, buildLlmPrompt } from "../static/js/brain/llm-prompt.js";
import { flagText, openTrack, unflagged } from "../static/js/brain/tracks.js";
import { CAR, Vehicle } from "../static/js/sim/vehicle.js";
import { World } from "../static/js/sim/world.js";
import { MapData } from "../static/js/map/mapdata.js";
import { Route } from "../static/js/map/route.js";
import { goalBlocker } from "../static/js/brain/brain.js";

let checks = 0;
async function test(name, run) {
  await run();
  checks++;
  console.log(name);
}
const clear = {
  ego: { v: 0 },
  target: { v: 8, reasons: [] },
  limit: 13.9,
  traffic: [],
  road: { on_road: true },
};
const candidate = (id, sim = {}, law = {}) => ({
  id,
  law: { kind: "lane", vTarget: 8, ...law },
  steer: "keep lane",
  speed: "target",
  eligible: true,
  sim: {
    end_speed: 8,
    lane_err_end: 0,
    min_gap_m: 10,
    progress_m: 12,
    heading_err_deg: 0,
    stays_in_lane: true,
    stays_on_road: true,
    ...sim,
  },
});
const rules = new RulesBrain();
const cautious = new CautiousAgent();
const stop = (m, fields = {}) => ({ control: "stop", bumper_to_line_m: m, ...fields });

await test("Cautious ranks equally good manoeuvres in their original offer order", () => {
  assert.equal(cautious.decideSync(clear, [candidate("first"), candidate("second")]).candidateId, "first");
});
await test("Cautious selects an explicit pull-over without evaluating the unused ranking", () => {
  const irrelevant = {
    id: "other",
    get sim() {
      return assert.fail("should not rank an unused option");
    },
  };
  assert.equal(cautious.decideSync(clear, [irrelevant, candidate("pull_over")]).candidateId, "pull_over");
});
await test("Cautious treats the shared speed target as stricter than its ordinary speed preference", () => {
  const options = [candidate("slow", { end_speed: 2 }), candidate("fast", { end_speed: 10 })];
  assert.equal(cautious.decideSync({ ...clear, target: { v: 2 } }, options).candidateId, "slow");
});
await test("Cautious prefers the extra gap to small gains in short-term progress", () => {
  const options = [candidate("close", { min_gap_m: 3, progress_m: 16 }), candidate("roomy", { min_gap_m: 5 })];
  assert.equal(cautious.decideSync(clear, options).candidateId, "roomy");
});
await test("Cautious keeps driving during a pull-out whose prediction ends almost still", () => {
  assert.equal(
    cautious.decideSync(clear, [candidate("pull_out", { end_speed: 0.1 }, { kind: "park" })]).motion,
    "drive",
  );
});
await test("Rules scores a lane change at the target speed of the new lane", () => {
  const atNewTarget = { ...candidate("new_target", { end_speed: 4 }), laneTarget: 4 };
  const faster = { ...candidate("over_target", { end_speed: 9, progress_m: 14 }), laneTarget: 4 };
  assert.equal(rules.decideSync(clear, [faster, atNewTarget]).candidateId, "new_target");
});
await test("Rules uses the shared sensing speed when a snapshot has no precomputed target", () => {
  const snap = { ...clear, target: undefined, visibility: { safe_speed_mps: 2 } };
  const options = [candidate("fast", { end_speed: 6 }), candidate("safe", { end_speed: 2 })];
  assert.equal(rules.decideSync(snap, options).candidateId, "safe");
});
await test("Rules still rolls to the line when a mandatory stop lies ahead", () => {
  const snap = { ...clear, intersection: stop(5, { stop_completed: false }) };
  assert.equal(rules.decideSync(snap, [candidate("stop_at_line", { end_speed: 0 })]).motion, "drive");
});
await test("Rules does not replace a clear three-point turn with a hold at a reached stop line", () => {
  const snap = { ...clear, intersection: stop(1) };
  const turn = candidate("turn_around", { end_speed: 0 }, { kind: "turnaround" });
  assert.equal(rules.decideSync(snap, [turn]).motion, "drive");
});
await test("Rules prefers finishing a lane change to aborting an equally good prediction", () => {
  const options = [
    { ...candidate("abort"), change: { offer: "abort" } },
    { ...candidate("continue"), change: { offer: "continue" } },
  ];
  assert.equal(rules.decideSync(clear, options).candidateId, "continue");
});
await test("The shared speed target uses the closest applicable stop when hazards overlap", () => {
  const red = { control: "signal", signal: "red", bumper_to_line_m: 12 };
  const snap = { ...clear, pedestrian: { bumper_to_crosswalk_m: 2.5 }, intersection: red };
  assert.ok(desiredSpeed({ ...snap, pedestrian: null }).v > 0);
  assert.equal(desiredSpeed(snap).v, 0);
  assert.ok(desiredSpeed(snap).reasons.includes("pedestrian crossing"));
});
await test("A reversing lead vehicle never produces a negative target speed", () => {
  const target = desiredSpeed({ ...clear, following: { gap_m: 0.5, speed: -3 } });
  assert.deepEqual(target, { v: 0, reasons: ["car ahead"] });
});
await test("An all-way stop ceases holding the car once it has crossed the clearing distance", () => {
  const f = (distance) =>
    waitsItsTurn(stop(distance, { stop_completed: true, priority: { arrived: true, go: false } }));
  assert.equal(f(-2.9), true);
  assert.equal(f(-3.1), false);
});
await test("Decision cadence ignores a roadside row of parked cars until an active hazard appears", () => {
  const roadside = [{ kind: "parked car", ahead: 5 }];
  assert.equal(hazardFlags({ ...clear, roadside }).includes("roadside activity"), false);
  assert.equal(
    hazardFlags({ ...clear, roadside: [...roadside, { kind: "door", ahead: 8 }] }).includes("roadside activity"),
    true,
  );
});
await test("Only traffic ahead within the driving corridor triggers a motion question", () => {
  const traffic = [
    { ahead: -1, right: 0 },
    { ahead: 10, right: 4 },
    { ahead: 25, right: 0 },
  ];
  assert.equal(needsMotionQuestion({ ...clear, traffic }), false);
  assert.equal(needsMotionQuestion({ ...clear, traffic: [...traffic, { ahead: 10, right: 3.9 }] }), true);
});
await test("A single eligible manoeuvre resolves the vector question locally even when motion remains undecided", () => {
  const snap = { ...clear, following: { id: "lead", kind: "car", closing_mps: 0, gap_m: 7 } };
  const { questions, local } = buildQuestions(snap, [candidate("keep")]);
  assert.ok(questions.motion);
  assert.equal(questions.vector, undefined);
  assert.equal(local.vector.choice, "keep");
  assert.equal(local.vector.local, true);
});
await test("A route whose ID matches an object property is offered safely in the route criteria", () => {
  const routeOptions = [
    { id: "__proto__", summary: "original road" },
    { id: "a", summary: "alternative" },
  ];
  const { questions } = buildQuestions(clear, [], { routeOptions });
  assert.deepEqual(Object.keys(questions.route.criteria), ["__proto__", "a"]);
  assert.equal(Object.getOwnPropertyDescriptor(questions.route.criteria, "__proto__").value, "original road");
});
await test("The LLM prompt offers precisely the beam criteria supplied by the active headlight question", () => {
  const questions = { headlights: { criteria: { low: "dip for oncoming traffic" } } };
  assert.deepEqual(buildLlmPrompt(clear, { questions }).expect, { headlights: ["low"] });
});
await test("The open-track LLM prompt keeps the candidate order and excludes unasked alternatives", () => {
  const questions = { vector: { criteria: { slow: "", keep: "" } } };
  const candidates = [{ id: "keep" }, { id: "hard_brake" }, { id: "slow" }];
  const { messages } = buildLlmPrompt(clear, { track: "open", questions, state: { candidates } });
  assert.equal(messages[0].content, OPEN_SYSTEM_PROMPT);
  assert.deepEqual(
    JSON.parse(messages[1].content).candidates.map((c) => c.id),
    ["keep", "slow"],
  );
});
await test("A rule flag remains enforceable as a collision even if an earlier road check won the rejection label", () => {
  const c = { eligible: true, reject: "runs_red", flagged: true, sim: { collision: { id: "blocker" } } };
  const out = openTrack([c], { mustStop: true });
  assert.equal(out.eligible.length, 0);
  assert.deepEqual(out.rejected, { runs_red: 1 });
  assert.equal(out.mustStop, true);
  assert.equal(c.flagged, undefined);
});
await test("A newly clear open-track prediction no longer carries a previous rule flag", () => {
  const c = { eligible: true, flagged: true, reject: null, sim: {} };
  assert.equal(unflagged(openTrack([c], {}).eligible).length, 1);
});
await test("An unrecognised road-rule identifier is readable even if it names an object property", () => {
  assert.equal(flagText("constructor"), "constructor");
  assert.equal(flagText("some_future_check"), "some future check");
  assert.equal(flagText(undefined), "unknown road-rule check");
});

function vehicleWorld(egoSpeed, obstacles = []) {
  return {
    ego: new Vehicle(0, 0, 0, egoSpeed),
    visibleObstaclesNear: () => obstacles,
  };
}
await test("The shared safety brake reports imminent following time and bumper gap", () => {
  const brake = safetyBrake(vehicleWorld(8), { following: { gap_m: 5, closing_mps: 10 } });
  assert.deepEqual(brake, { reason: "following", ttc: 0.5, gap: 5 });
});
await test("The shared safety brake lets a moving car go when a close leader is pulling away", () => {
  assert.equal(safetyBrake(vehicleWorld(2), { following: { gap_m: 1.8, closing_mps: -1 } }), null);
});
await test("The shared safety brake holds a stationary car without reporting a moving intervention", () => {
  const leader = new Vehicle(CAR.length + 0.2, 0);
  assert.deepEqual(safetyBrake(vehicleWorld(0, [leader]), {}), { reason: "blocked", hold: true });
});
await test("The shared safety brake changes a near-still reverse hold into an intervention once moving", () => {
  const blocker = new Vehicle(-CAR.length, 0);
  assert.deepEqual(safetyBrake(vehicleWorld(-0.1, [blocker]), {}), { reason: "blocked", hold: true });
  assert.deepEqual(safetyBrake(vehicleWorld(-1, [blocker]), {}), { reason: "behind" });
});
await test("The deadlock detector resets accumulated time when the car approaches its destination", () => {
  const detector = new DeadlockDetector();
  const world = { route: true, ego: { v: 0 } };
  assert.equal(detector.update(world, clear, 3), 3);
  assert.equal(detector.update(world, { ...clear, nav: { remaining_m: 5 } }, 1), 0);
  assert.equal(world.stuckFor, 0);
});
await test("A clear blind-junction peek counts as progress only once the car is actually creeping", () => {
  const detector = new DeadlockDetector();
  const world = { route: true, ego: { v: 0 } };
  const snap = { ...clear, target: { v: 1.5 }, intersection: { control: "none", give_way: { hold_s_route: 10 } } };
  assert.equal(detector.update(world, snap, 3), 3);
  world.ego.v = 0.4;
  assert.equal(detector.update(world, snap, 1), 0);
});

function straightWorld() {
  const points = [
    [0, 0],
    [80, 0],
    [160, 0],
  ];
  const map = new MapData({
    bbox: [0, 0, 1, 1],
    extent: [0, -6, 160, 6],
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 160, y: 0 },
    ],
    edges: [
      {
        id: "in",
        from: "a",
        to: "b",
        pts: points,
        length: 160,
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
  world.ego.x = 30;
  world.ego.v = 6;
  return world;
}
await test("A guarded resimulation removes flags left on reused candidates by the open track", () => {
  const world = straightWorld();
  const snap = buildSnapshot(world);
  const candidates = sampleCandidates(snap, world);
  candidates[0].flagged = true;
  simulateAll(candidates, snap, world);
  assert.equal(candidates[0].flagged, undefined);
});
await test("Rechecking an executing path reports the first visible obstacle without changing ego position or route hint", () => {
  const world = straightWorld();
  const blocker = new Vehicle(world.ego.x + 10, 0);
  blocker.id = "visible-blocker";
  const snap = { ...buildSnapshot(world), observed: [blocker] };
  const before = [world.ego.x, world.ego.y, world.ego.v, world.route.hint];
  const c = candidate("keep");
  const hazard = pathHazard({ candidate: c, law: c.law }, snap, world);
  assert.equal(hazard?.id, "visible-blocker");
  assert.ok(hazard.in_s > 0 && hazard.in_s <= 3);
  assert.deepEqual([world.ego.x, world.ego.y, world.ego.v, world.route.hint], before);
});
await test("Decision state omits unknown clearance instead of implying that a candidate measured it", () => {
  const world = straightWorld();
  const snap = buildSnapshot(world);
  const state = toJevState(
    snap,
    [candidate("unknown", { min_clearance_m: Infinity }), candidate("known", { min_clearance_m: 1.23 })],
    {},
  );
  assert.equal(Object.hasOwn(state.candidates[0], "min_clearance_m"), false);
  assert.equal(state.candidates[1].min_clearance_m, 1.2);
});
await test("A moving or potentially moving obstacle cannot qualify as a blocked destination", () => {
  const world = { parked: { list: [{ id: "parked" }] } };
  const parked = candidate("one", { collision: { id: "parked" } });
  const moving = candidate("two", { collision: { id: "moving" } });
  assert.equal(goalBlocker([parked], world), "parked");
  assert.equal(goalBlocker([parked, moving], world), null);
});

console.log(`${checks} policy edge checks passed.`);
process.exit(0);
