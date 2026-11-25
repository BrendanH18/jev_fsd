import assert from "node:assert/strict";
import { Autopilot } from "../static/js/brain/brain.js";
import { DecisionTrace, startDecisionTrace } from "../static/js/brain/decision-trace.js";
import { buildSnapshot } from "../static/js/brain/sensors.js";
import { Route } from "../static/js/map/route.js";
import { MapData } from "../static/js/map/mapdata.js";
import { Vehicle } from "../static/js/sim/vehicle.js";
import { World } from "../static/js/sim/world.js";

const points = [
  [0, 0],
  [90, 0],
  [180, 0],
];
const map = new MapData({
  bbox: [0, 0, 1, 1],
  extent: [0, -5, 180, 5],
  nodes: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 180, y: 0 },
  ],
  edges: [
    {
      id: "in",
      from: "a",
      to: "b",
      pts: points,
      length: 180,
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
const route = { polyline: points, edges: ["in"], lanes: [0], turns: [] };
const make = (driver, decide) => {
  const world = new World(map, { parked: 0, pedestrians: 0 });
  world.route = new Route(route, map);
  world.ego.x = 20;
  world.ego.v = 4;
  const autopilot = new Autopilot(world);
  if (decide) autopilot.brains[driver] = { decide };
  autopilot.setBrain(driver);
  return autopilot;
};
const fire = (pilot, simMs = 125) => pilot.fire(buildSnapshot(pilot.world), simMs, ["test"]);
const choose = (_snap, eligible) => ({ motion: "drive", candidateId: eligible[0].id });

assert.throws(() => new DecisionTrace(0), /capacity/);
assert.throws(() => new DecisionTrace(501), /capacity/);
assert.throws(() => new DecisionTrace(2.5), /capacity/);
const autopilot = make("rules");
const trace = autopilot.startDecisionTrace(2);
assert.equal(trace.latest, null);
assert.equal(trace.summarize().decisions, 0);
await fire(autopilot);
let entry = trace.latest;
assert.equal(entry.driver, "rules");
assert.equal(entry.epoch, autopilot.epoch);
assert.equal(entry.simMs, 125);
assert.equal(entry.track, "guarded");
assert.equal(entry.decidedBy, "local");
assert.equal(entry.source, "rules");
assert.equal(entry.reason, "rules");
assert.equal(entry.mustStop, false);
assert.equal(entry.requestedId, autopilot.lastDecision.answers.vector.choice);
assert.equal(entry.selectedId, entry.requestedId);
assert.equal(entry.executedId, autopilot.lastDecision.chosenId);
assert.equal(entry.motion, autopilot.lastDecision.motion);
assert.equal(entry.route.disposition, "none");
assert.equal(entry.headlights, null);
assert.equal(entry.partial, false);
assert.equal(entry.hazards.join(), "test");
assert.equal(entry.pathHazard, null);
assert.equal(entry.asked.join(), "vector");
assert.equal(entry.resolvedLocally.join(), "motion");
assert.equal(entry.unflagged.join(), entry.offered.join());
assert.equal(entry.predictions.length, autopilot.lastDecision.candidates.length);
assert.equal(entry.predictions.at(-1).id, "hard_brake");
assert.equal(entry.predictions.at(-1).kind, "hard_brake");
assert.equal(entry.predictions.at(-1).speedCeilingMps, null);
assert.equal(entry.predictions[0].minGapM, null);
assert.equal(entry.predictions[0].clearanceM, null);
assert.equal(entry.predictions[0].offRoad, false);
assert.equal(entry.predictions[0].leftLane, false);
assert.equal(entry.predictions[0].crossedStopLine, false);
assert.equal(entry.predictions[0].collision, null);
assert.equal(entry.predictions[0].staticCollision, null);
assert.equal(entry.policy.candidateId, entry.selectedId);
assert.equal(entry.policy.driver, "rules");
assert.ok(entry.policy.standing.margin >= 0);
assert.equal(entry.spend.callCounted, false);
assert.equal(Object.hasOwn(entry, "answers"), false);
assert.equal(Object.hasOwn(entry, "state"), false);
assert.equal(Object.hasOwn(autopilot.lastDecision, "policy"), false);

entry.predictions[0].id = "changed";
entry.offered.length = 0;
assert.notEqual(trace.latest.predictions[0].id, "changed");
assert.ok(trace.latest.offered.length > 0);
await fire(autopilot, 275);
autopilot.setBrain("cautious");
await fire(autopilot, 425);
assert.equal(
  trace
    .entries()
    .map((x) => x.sequence)
    .join(),
  "2,3",
);
assert.equal(trace.latest.policy.driver, "cautious");
assert.equal(trace.latest.reason, "driver_choice");
assert.equal(trace.latest.source, "cautious");
assert.equal(trace.latest.decidedBy, "model");
assert.equal(trace.entries({ driver: "rules" }).length, 1);
assert.equal(trace.entries({ reason: "rules" }).length, 1);
assert.equal(trace.entries({ decidedBy: "model" }).length, 1);
assert.equal(trace.entries({ motion: trace.latest.motion }).length >= 1, true);
assert.equal(trace.entries({ sinceMs: 275, untilMs: 275 }).length, 1);
assert.equal(trace.entries({ sinceMs: 276 }).length, 1);
assert.equal(trace.entries({ untilMs: 274 }).length, 0);
assert.equal(trace.entries({ hazard: "test", question: "vector" }).length, 2);
assert.equal(trace.entries({ question: "motion" }).length, 0);
assert.equal(trace.entries({ candidate: "hard_brake" }).length, 2);
assert.equal(trace.entries({ candidate: "missing" }).length, 0);
assert.equal(trace.entries({ candidate: "hard_brake", driver: "rules", sinceMs: 400 }).length, 0);
assert.equal(trace.summarize().questionCounts.vector, 2);
assert.equal(trace.summarize().drivers.cautious, 1);
assert.equal(trace.summarize().dispositions.local, 1);
assert.equal(trace.summarize().reasons.driver_choice, 1);
assert.equal(trace.summarize().motions.drive, 2);
assert.equal(trace.summarize({ driver: "rules" }).decisions, 1);
assert.equal(trace.summarize({ driver: "cautious" }).applied[trace.latest.executedId], 1);
trace.clear();
assert.equal(trace.latest, null);
await fire(autopilot, 600);
assert.equal(trace.latest.sequence, 4);
autopilot.stopDecisionTrace();
await fire(autopilot);
assert.equal(trace.latest.sequence, 4);

const run = async (driver, decide, configure) => {
  const pilot = make(driver, decide);
  configure?.(pilot);
  const capture = pilot.startDecisionTrace();
  await fire(pilot);
  return { pilot, capture, entry: capture.latest };
};
const invalidVector = await run("jev", () => ({ motion: "drive", candidateId: null }));
assert.equal(invalidVector.entry.reason, "invalid_vector");
assert.equal(invalidVector.entry.requestedId, null);
assert.ok(invalidVector.entry.selectedId);
assert.equal(invalidVector.entry.policy.driver, "rules");
assert.equal(invalidVector.pilot.totals.calls, 1);
assert.equal(invalidVector.pilot.decidedBy.fallback, 1);
assert.equal(invalidVector.pilot.world.violations.fallbacks, 1);
const invalidMotion = await run("jev", () => ({ motion: "accelerate", candidateId: null }));
assert.equal(invalidMotion.entry.reason, "invalid_motion");
assert.equal(invalidMotion.pilot.lastDecision.meta.error, "Agent returned an invalid motion");
assert.equal(invalidMotion.pilot.world.violations.fallbacks, 1);
const notOffered = await run("custom", () => ({ motion: "drive", candidateId: "unknown_pick" }));
assert.equal(notOffered.entry.reason, "ineligible_candidate");
assert.equal(notOffered.entry.requestedId, "unknown_pick");
assert.notEqual(notOffered.entry.selectedId, "unknown_pick");
const reported = await run("custom", (s, eligible) => ({
  ...choose(s, eligible),
  meta: { fallback: "driver fallback" },
}));
assert.equal(reported.entry.reason, "driver_reported_fallback");
assert.equal(reported.pilot.decidedBy.fallback, 1);
// (as before: only an invalid vector or a failed call counts against the drive's audit)
assert.equal(reported.pilot.world.violations.fallbacks, 0);
const timed = await run(
  "custom",
  () => new Promise(() => {}),
  (pilot) => {
    pilot.brain.timeoutMs = 5;
  },
);
assert.equal(timed.entry.reason, "timeout");
assert.equal(timed.entry.spend.callCounted, false);
assert.equal(timed.pilot.inFlight, null);
const thrown = await run("custom", () => {
  throw new Error("driver disconnected");
});
assert.equal(thrown.entry.reason, "error");
const bad = await run("custom", () => {
  throw Object.assign(new Error("malformed"), {
    meta: { live_call: true, input_tokens: 11, output_tokens: 3, cost_usd: 0.003, cost_known: true },
    trace: { text: "provider detail" },
  });
});
assert.equal(bad.entry.reason, "unusable_reply");
assert.equal(bad.entry.spend.callCounted, true);
assert.equal(bad.entry.spend.costKnown, true);
assert.equal(bad.capture.summarize().spend.calls, 1);
assert.equal(bad.capture.summarize().spend.inputTokens, 11);
assert.equal(bad.capture.summarize().spend.outputTokens, 3);
assert.equal(bad.capture.summarize().spend.costUsd, 0.003);
assert.equal(bad.capture.summarize().spend.unknownCosts, 0);
assert.equal(JSON.stringify(bad.entry).includes("provider detail"), false);
const metered = await run("custom", (snap, eligible) => ({
  ...choose(snap, eligible),
  meta: { live_call: true, input_tokens: 4, output_tokens: -1 },
}));
assert.equal(metered.entry.spend.outputTokens, 0);
assert.equal(metered.capture.summarize().spend.unknownCosts, 1);
const missingMeter = await run("custom", (snap, eligible) => ({
  ...choose(snap, eligible),
  meta: { live_call: true },
}));
assert.equal(missingMeter.entry.spend.outputTokens, null);

let respond;
const pending = make(
  "custom",
  (snap, eligible) =>
    new Promise((resolve) => {
      respond = () => resolve(choose(snap, eligible));
    }),
);
const original = pending.startDecisionTrace();
const request = fire(pending);
const replacement = pending.startDecisionTrace();
respond();
await request;
assert.equal(original.latest, null);
assert.equal(replacement.latest, null);
await Promise.resolve();
const cancelled = fire(pending);
pending.bumpEpoch();
respond();
await cancelled;
assert.equal(replacement.latest, null);
assert.equal(pending.world.violations.fallbacks, 0);
const discardOnStop = fire(pending);
pending.stopDecisionTrace();
respond();
await discardOnStop;
assert.equal(replacement.latest, null);
const unobserved = fire(pending);
const laterCapture = pending.startDecisionTrace();
respond();
await unobserved;
assert.equal(laterCapture.latest, null);

const blocked = make("rules");
const blockedTrace = blocked.startDecisionTrace();
const stoppedCar = new Vehicle(blocked.world.ego.x + 0.1, 0);
stoppedCar.id = "parked_across_lane";
await blocked.fire({ ...buildSnapshot(blocked.world), observed: [stoppedCar] }, 100, ["traffic"]);
assert.equal(blockedTrace.latest.reason, "no_eligible");
assert.equal(blockedTrace.latest.offered.length, 0);
assert.equal(blockedTrace.latest.executedId, "hard_brake");
assert.equal(blocked.world.violations.fallbacks, 0);

const routePilot = make("rules");
routePilot.world.highBeams = true;
routePilot.pendingRoutes = [
  { ...route, id: "original" },
  { ...route, id: "other" },
];
const routeTrace = routePilot.startDecisionTrace();
const brake = { id: "hard_brake", law: { kind: "hard_brake" }, eligible: true };
const go = {
  id: "lane",
  law: { kind: "lane", vTarget: 4, offset: -1, stopAtRoute: 38, slowTo: [{}], detour: {} },
  change: { offer: "return", dir: "left" },
  eligible: true,
};
const snap = { routeProj: { s: 20 }, headlights: { high_allowed: true } };
const options = { questions: { route: {}, headlights: {} }, flags: [] };
const meta = { source: "replay_choice" };
routePilot.apply(
  { motion: "drive", candidateId: "lane", routeId: "other", headlights: "low", meta },
  snap,
  [go, brake],
  options,
);
assert.equal(routeTrace.latest.reason, "external_choice");
assert.equal(routeTrace.latest.route.offered, 2);
assert.equal(routeTrace.latest.route.requested, "other");
assert.equal(routeTrace.latest.route.installed, "other");
assert.equal(routeTrace.latest.route.disposition, "selected");
assert.equal(routeTrace.latest.headlights.requested, "low");
assert.equal(routeTrace.latest.headlights.applied, "low");
assert.equal(routeTrace.latest.headlights.defaulted, false);
assert.equal(routeTrace.latest.predictions[0].lateralTargetM, -1);
assert.equal(routeTrace.latest.predictions[0].stopAtRouteM, 38);
assert.equal(routeTrace.latest.predictions[0].speedCeilingMps, 4);
assert.equal(routeTrace.latest.predictions[0].laneChange.offer, "return");
assert.equal(routeTrace.latest.predictions[0].laneChange.direction, "left");
assert.equal(routeTrace.latest.predictions[0].detour, true);
assert.equal(routeTrace.latest.predictions[0].speedRestrictions, 1);
assert.equal(routePilot.executing.law.stopAt, 18);
routePilot.pendingRoutes = [
  { ...route, id: "original" },
  { ...route, id: "other" },
];
const external = () => ({ state: {}, questions: options.questions, flags: [] });
routePilot.apply(
  { motion: "stop", candidateId: "lane", routeId: "absent", meta },
  snap,
  [go, brake],
  external(),
  "model",
);
assert.equal(routeTrace.latest.route.disposition, "first_option");
assert.equal(routeTrace.latest.route.installed, "original");
assert.equal(routeTrace.latest.executedId, "hard_brake");
assert.equal(routeTrace.latest.selectedId, "lane");
assert.equal(routeTrace.latest.partial, true);
assert.equal(routeTrace.latest.headlights.applied, "high");
assert.equal(routeTrace.latest.headlights.defaulted, true);
routePilot.pendingRoutes = [
  { ...route, id: "original" },
  { ...route, id: "other" },
];
routePilot.world.ego.v = 0;
routePilot.apply({ motion: "stop", candidateId: "lane", meta }, snap, [go, brake], external(), "model");
assert.equal(routeTrace.latest.route.disposition, "kept_current");
assert.equal(routeTrace.latest.executedId, "hold");
assert.equal(routeTrace.summarize().partial, 2);
routePilot.pendingRoutes = [
  { ...route, id: "original" },
  { ...route, id: "other" },
];
routePilot.apply(
  { motion: "stop", candidateId: "lane", meta: { source: "rules_fallback" } },
  snap,
  [go, brake],
  external(),
  "fallback",
);
assert.equal(routeTrace.latest.route.disposition, "pending");
assert.equal(routePilot.pendingRoutes.length, 2);
routePilot.pendingRoutes = [];
routePilot.apply({ motion: "drive", candidateId: "lane", routeId: "absent", meta }, snap, [go, brake], external());
assert.equal(routeTrace.latest.route.disposition, "none");
assert.equal(routeTrace.latest.route.installed, null);

const observed = new DecisionTrace();
const advisory = {
  id: "__proto__",
  law: { kind: "lane" },
  eligible: true,
  flagged: true,
  reject: "__proto__",
  sim: {
    progress_m: 9,
    end_speed: 3,
    max_decel: 3.2,
    max_lateral_accel: 1.2,
    min_gap_m: 2.7,
    min_clearance_m: 0.9,
    stays_on_road: false,
    stays_in_lane: false,
    crosses_stop_line: true,
    collision: { id: "wall", t: 1.8, kind: "building" },
    static_collision: { id: "wall" },
  },
};
const open = { epoch: 2, track: "open", eligible: [advisory] };
const context = startDecisionTrace(open, observed, "custom", 83, [], { id: "wall", in_s: 1.8, kind: "building" });
context.policy = {
  driver: "rules",
  candidateId: "__proto__",
  scores: [
    { id: "__proto__", cost: 1 },
    { id: "next", cost: 1 },
    { id: "third", cost: 1 },
  ],
};
observed.record({ candidates: [advisory], chosenId: "__proto__", decidedBy: "model", motion: "drive" }, context, open, {
  selectedId: "__proto__",
  route: null,
  headlights: null,
});
entry = observed.latest;
assert.equal(entry.track, "open");
assert.equal(entry.pathHazard.in_s, 1.8);
assert.equal(entry.unflagged.length, 0);
assert.equal(entry.predictions[0].eligible, true);
assert.equal(entry.predictions[0].flagged, true);
assert.equal(entry.predictions[0].rejectedBy, "__proto__");
assert.equal(entry.predictions[0].progressM, 9);
assert.equal(entry.predictions[0].endSpeedMps, 3);
assert.equal(entry.predictions[0].minGapM, 2.7);
assert.equal(entry.predictions[0].clearanceM, 0.9);
assert.equal(entry.predictions[0].peakBrakeMps2, 3.2);
assert.equal(entry.predictions[0].peakLateralMps2, 1.2);
assert.equal(entry.predictions[0].offRoad, true);
assert.equal(entry.predictions[0].leftLane, true);
assert.equal(entry.predictions[0].crossedStopLine, true);
assert.equal(entry.predictions[0].collision.atS, 1.8);
assert.equal(entry.predictions[0].staticCollision, "wall");
assert.equal(entry.policy.standing.runnerUp, "next");
assert.equal(entry.policy.standing.tied, true);
assert.equal(entry.policy.standing.margin, 0);
assert.equal(Object.getOwnPropertyDescriptor(observed.summarize().rejections, "__proto__").value, 1);
assert.equal(Object.getOwnPropertyDescriptor(observed.summarize().applied, "__proto__").value, 1);
assert.equal(observed.entries({ rejectedBy: "__proto__" }).length, 1);

console.log("Planning trace and fallback accounting passed.");
process.exit(0);
