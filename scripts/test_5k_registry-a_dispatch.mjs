import assert from "node:assert/strict";
import { test } from "node:test";
import { failures } from "../static/js/bench/metrics.js";
import { FLAG_TEXT } from "../static/js/brain/tracks.js";
import { DriveRecorder } from "../static/js/lab/recorder.js";
import { EvaluationTrace } from "../static/js/lab/trace.js";
import { DriveScore } from "../static/js/sim/drive-score.js";
import {
  featureCoachCap,
  featureCoachDeduct,
  featureCoachEvent,
  featureCoachReport,
  featureCoachTips,
  observeFeatureCoach,
} from "../static/js/sim/feature-coach.js";
import { announceFeatureNotices, hooks, firstHookResult } from "../static/js/sim/features/index.js";

test("registered reserved-lane legality preserves independent stopping exemptions", () => {
  const lane = { in_effect: true, entering_allowed: false, lanes: [1] };
  const snap = { bus_lane: lane };
  const law = { laneIdx: 1, kind: "lane", vTarget: 5 };
  const candidate = { law };
  const [reject] = hooks("candidateLaneReject");
  assert.equal(reject(snap, candidate, false), "bus_lane_driving");
  assert.equal(reject(snap, candidate, true), null, "a compulsory hold can remain in the lane");
  assert.equal(reject(snap, { law: { ...law, kind: "hard_brake" } }, false), null);
  assert.equal(reject(snap, { law: { ...law, vTarget: 0.1 } }, false), null);
  assert.equal(reject(snap, { law: { ...law, vTarget: 0.10001 } }, false), "bus_lane_driving");
  assert.equal(reject(snap, { law: { ...law, laneIdx: 0 } }, false), null);
  assert.equal(reject(snap, { law, change: { offer: "return" } }, false), null);
  assert.equal(reject({ bus_lane: { ...lane, entering_allowed: true } }, candidate, false), null);
  assert.equal(reject({ bus_lane: { ...lane, in_effect: false } }, candidate, false), null);
  assert.equal(reject({}, candidate, false), null);
  assert.match(FLAG_TEXT.bus_lane_driving, /reserved bus lane while the lane is in effect/);
});

test("reserved-lane preferences only reward an eligible move that exits an active reservation", () => {
  const stay = { law: { laneIdx: 1 } };
  const changeIn = { law: { laneIdx: 1 }, change: true };
  const exit = { law: { laneIdx: 0 }, change: true };
  const snap = { lane: { index: 1 }, bus_lane: { in_effect: true, entering_allowed: false, lanes: [1] } };
  const [cost] = hooks("rulesCost", "beforeSpeedCost");
  const cautious = hooks("cautious", "reservedLane");
  assert.equal(cost(exit, snap), -20);
  assert.equal(cost(stay, snap), 0);
  assert.equal(cost(changeIn, snap), 0);
  assert.equal(firstHookResult(cautious, snap, [stay, changeIn, exit]) === exit, true);
  assert.equal(firstHookResult(cautious, snap, [stay, changeIn]), null);
  snap.lane.index = 0;
  assert.equal(cost(exit, snap), 0);
  assert.equal(firstHookResult(cautious, snap, [exit]), null);
  snap.lane.index = 1;
  snap.bus_lane.entering_allowed = true;
  assert.equal(cost(exit, snap), 0);
  assert.equal(firstHookResult(cautious, snap, [exit]), null);
});

test("amber and reserved-lane failures stay in the established verdict positions", () => {
  const reasons = failures({
    arrived: true,
    red_lights: 1,
    amber_lights_run: 1,
    stop_signs: 1,
    failed_to_yield: 1,
    close_passes: 1,
    bus_lane_driving: 1.5,
    illegal_turns: 1,
  });
  assert.equal(reasons.indexOf("failed to stop safely for amber"), reasons.indexOf("red light") + 1);
  assert.equal(reasons.indexOf("stop sign"), reasons.indexOf("failed to stop safely for amber") + 1);
  assert.equal(reasons.indexOf("drove in a reserved bus lane"), reasons.indexOf("passed a cyclist too close") + 1);
  assert.equal(reasons.indexOf("drove in a reserved bus lane") < reasons.length - 1, true);
});

test("trace and rewind preserve distinct amber and aggregate bus-lane event behavior", () => {
  const trace = new EvaluationTrace();
  const world = {
    t: 1,
    busLanesSeen: true,
    amberLightsSeen: true,
    violations: { bus_lane_driving: 2, amber_lights_run: 1, red_lights_run: 1 },
  };
  trace.measurements(world, {});
  assert.equal(trace.events.length, 2);
  assert.equal(trace.events[0].type, "amber_lights_run");
  assert.equal(trace.events[0].count, 1);
  assert.equal(trace.events[1].type, "red_lights_run");
  trace.measurements(world, {});
  assert.equal(trace.events.length, 2, "already observed counters do not emit a second event");
  world.violations.bus_lane_driving += 4;
  trace.measurements(world, {});
  assert.equal(trace.events.length, 2, "metre samples stay out of the decision trace");
  const recorder = new DriveRecorder();
  recorder.mark(1, "amber_light");
  recorder.mark(2, "bus_lane_driving");
  assert.equal(recorder.markers.length, 1);
  assert.equal(recorder.markers[0].type, "amber_light");
  assert.equal(recorder.markers[0].t, 1);
});

test("coaching reports independent seen flags and uses counter deltas across baseline changes", () => {
  const world = { ego: { v: 0 }, violations: { amber_lights_run: 2, bus_lane_driving: 10 } };
  const score = new DriveScore(world);
  const report = () => featureCoachReport("beforeFeatureSummary", score, Math.round);
  assert.equal(Object.keys(report()).length, 0);
  assert.equal(featureCoachCap(score), false, "an earlier driver’s violation is outside the baseline");
  world.amberLightsSeen = true;
  observeFeatureCoach(score, world);
  assert.equal(report().amber_lights_run, 0);
  assert.equal(Object.hasOwn(report(), "bus_lane_driving"), false);
  world.busLanesSeen = true;
  observeFeatureCoach(score, world);
  assert.equal(report().bus_lane_driving, 0);
  score.lastCounters.amber_lights_run = 3;
  score.lastCounters.bus_lane_driving = 11.5;
  assert.equal(featureCoachCap(score), true);
  assert.equal(featureCoachDeduct("firstLegality", score, 100), 75);
  assert.equal(featureCoachDeduct("beforeTrafficLegality", score, 75), 74.25);
  assert.equal(report().amber_lights_run, 1);
  assert.equal(report().bus_lane_driving, 1.5);
  assert.equal(Object.keys(report()).join(","), "bus_lane_driving,amber_lights_run");
  const tips = [];
  featureCoachTips("beforeGeneralJunction", score, tips);
  assert.match(tips[0], /stop if you can do so safely/);
  featureCoachTips("afterFollowing", score, tips);
  assert.match(tips[1], /Keep the bus lane clear/);
  score.lastCounters.amber_lights_run = NaN;
  score.lastCounters.bus_lane_driving = Infinity;
  assert.equal(featureCoachCap(score), false);
  assert.equal(featureCoachDeduct("beforeTrafficLegality", score, 100), 100);
  assert.equal(featureCoachDeduct("safety", Object.create(null), 100), 100, "missing optional counters cost no points");
});

test("coaching distinguishes the two reasons for an amber violation", () => {
  const score = {
    incident(type, message) {
      this.type = type;
      this.message = message;
    },
  };
  featureCoachEvent(score, { type: "amber_light", reason: "safe_stop" });
  assert.equal(score.type, "amber_light");
  assert.equal(score.message, "Passed amber when a safe stop was possible");
  featureCoachEvent(score, { type: "amber_light", reason: "sped_up" });
  assert.equal(score.message, "Sped up to beat an amber light");
});

test("left-on-red HUD messaging tracks the completion and gap separately", () => {
  const approach = { id: "signal" };
  const autopilot = { snap: { intersection: approach } };
  const announced = new Map();
  const badges = [];
  const hud = {
    badge(text, style, duration) {
      badges.push({ text, style, duration });
    },
  };
  const frame = () => announceFeatureNotices("afterTurnNotice", {}, autopilot, {}, announced, hud);
  frame();
  assert.equal(badges.length, 0);
  approach.left_on_red = { stop_completed: false, clear: false, go: false };
  frame();
  assert.equal(badges[0].text, "LEFT ON RED · FULL STOP FIRST");
  assert.equal(badges[0].style, "safety");
  assert.equal(badges[0].duration, 2500);
  frame();
  assert.equal(badges.length, 1);
  approach.left_on_red.stop_completed = true;
  frame();
  assert.equal(badges[1].text, "LEFT ON RED · YIELD TO PEDESTRIANS AND TRAFFIC");
  approach.left_on_red.clear = true;
  approach.left_on_red.go = true;
  frame();
  assert.equal(badges[2].text, "LEFT ON RED · CLEAR TO TURN");
  delete approach.left_on_red;
  frame();
  assert.equal(announced.size, 0);
});

test("left-turn sensing only asks for gaps after geometry and the sign policy agree", () => {
  const from = { id: "from", to: "node", oneway: true };
  const to = { id: "to", oneway: true };
  const map = {
    routingBbox: [-114.085, 51.035, -114.065, 51.044],
    edges: new Map([
      [from.id, from],
      [to.id, to],
    ]),
    out: new Map([["node", [to.id]]]),
    nearestLane: () => ({ lane: { edge: "from", idx: 0 } }),
    classifyTurn: () => "left",
    turnAngle: () => Math.PI / 2,
    headingOut: () => Math.PI / 2,
    restrictions: [],
  };
  const world = { map, ego: {}, route: { edges: ["from", "to"] }, leftOnRed: true };
  const [sense] = hooks("senseRedTurn");
  let observations = 0;
  const scan = () => ({ stop_completed: ++observations > 2 });
  assert.equal(sense(world, { edge: "from", turn: "right" }, scan), null);
  assert.equal(observations, 0);
  assert.equal(sense(world, { edge: "from", turn: "left" }, scan).left_on_red.stop_completed, false);
  assert.equal(observations, 1);

  const [remember] = hooks("redTurnMemory");
  const [exit] = hooks("redTurnExit");
  const saved = remember(world, from, ["different-exit"]);
  assert.equal(saved.leftExits.join(","), "to");
  const live = remember(world, from, null);
  assert.equal(Object.hasOwn(live, "leftExits"), false);
  assert.equal(exit(world, { ...live, edge: "from" }, { id: "different-exit" }), null);

  map.restrictions.push({ from: "from", to: ["to"], kind: "no_left_turn" });
  assert.equal(sense(world, { edge: "from", turn: "left" }, scan), null);
  assert.equal(observations, 1);
  assert.equal(exit(world, { ...live, edge: "from" }, to), null);
  assert.equal(world.leftOnRedSeen, undefined);
  const crossing = { ...saved, edge: "from", exit: 0 };
  exit(world, crossing, to)();
  assert.equal(crossing.exit, Math.PI / 2);
  assert.equal(world.leftOnRedSeen, true);
});

test("traffic route policy distinguishes a bus, a bicycle and a car on the same lane", () => {
  const clock = { hour: 15.5 };
  const a = { id: "a", lanes: 2 };
  const b = { id: "b", lanes: 2 };
  const map = {
    edges: new Map([
      [a.id, a],
      [b.id, b],
    ]),
    buslanes: [
      { edge: "a", lane: 0, allowed: ["bus"] },
      { edge: "a", lane: 1, allowed: ["bus", "bicycle"] },
      { edge: "b", lane: 0, allowed: ["bus"] },
    ],
  };
  const path = { map, busLanePolicy: { clock } };
  const [choice] = hooks("trafficLaneInto");
  const [filter] = hooks("trafficSuccessorPool");
  assert.equal(choice(path, b, "left", 1).index, 1);
  assert.equal(choice(path, b, "right", 0), null, "a legal default remains the fleet's choice");
  assert.equal(choice(path, a, "left", 1), null, "with no legal alternate the fleet keeps the default");
  assert.equal(filter(path, ["a", "b"]).join(","), "b");
  assert.equal(filter(path, ["a"]).join(","), "a", "an all-reserved pool cannot strand traffic");
  path.bike = true;
  assert.equal(choice(path, a, "left", 1).index, 1);
  assert.equal(filter(path, ["a", "b"]).join(","), "a,b");
  path.busLanePolicy.bus = true;
  assert.equal(choice(path, a, "right", 1).index, 0);
  assert.equal(filter(path, ["a", "b"]).join(","), "a,b");

  const [spawnBlocked] = hooks("trafficSpawnLaneBlocked");
  const world = { map, busLanes: true, clock };
  const lane = { edge: "a", idx: 1 };
  assert.equal(spawnBlocked(world, lane, "car"), true);
  assert.equal(spawnBlocked(world, lane, "bicycle"), false);
  assert.equal(spawnBlocked({ ...world, busLanes: false }, lane, "car"), false);
});

test("a visible overnight policy changes only the side-road control or main-road speed", () => {
  const signal = {
    id: "signal",
    x: 0,
    y: 0,
    approaches: [
      { edge: "minor", group: "A" },
      { edge: "major", group: "B" },
    ],
  };
  const edges = new Map([
    ["minor", { cls: "residential" }],
    ["major", { cls: "primary" }],
  ]);
  const map = { edges, intersections: new Map([[signal.id, signal]]) };
  const [visible] = hooks("visibleSignalPolicy");
  let sight = 0;
  const world = {
    map,
    nightFlash: false,
    clock: { hour: 23.5 },
    visibility: {
      canSee() {
        sight++;
        return true;
      },
    },
  };
  const minor = { edge: "minor", control: { id: signal.id, type: "signal", group: "A" } };
  const major = { edge: "major", control: { id: signal.id, type: "signal", group: "B" } };
  assert.equal(visible(world, minor, signal), null);
  assert.equal(sight, 0, "disabled sensing avoids a visibility calculation");
  world.nightFlash = true;
  const red = visible(world, minor, signal);
  assert.equal(red.control.type, "stop");
  assert.equal(red.control.all_way, false);
  assert.equal(red.control.id, "signal@minor:flash");
  assert.equal(red.speed, undefined);
  const amber = visible(world, major, signal);
  assert.equal(amber.control, undefined);
  assert.equal(amber.speed, 20 / 3.6);
  assert.equal(amber.yieldControl.rule, "major");
  world.visibility.canSee = () => false;
  assert.equal(visible(world, minor, signal), null);
  assert.equal(visible(world, major, signal), null);

  const [traffic] = hooks("trafficSignalPolicy");
  const queued = traffic({ boxBusy: () => true }, null, major, "flashing_amber");
  assert.equal(queued.hold, true);
  assert.equal(queued.speed, 20 / 3.6);
  assert.equal(traffic({ boxBusy: () => false }, null, major, "flashing_amber").hold, false);
  assert.equal(traffic({}, null, major, "green"), null);
});
