import assert from "node:assert/strict";
import { test } from "node:test";
import { amberStoppingDistance, observeAmber } from "../static/js/sim/amber.js";
import { auditBusLanes, busLaneActive, legalBusLane, routeBusLane } from "../static/js/sim/bus-lanes.js";
import {
  applyTrafficPathPolicy,
  FEATURES,
  controlAt,
  extraRedTurn,
  featureMetrics,
  hooks,
  redTurnAllowed,
  signalDecision,
  specialSignalPhase,
  stopAtLineDrive,
} from "../static/js/sim/features/index.js";
import { leftOnRedAllowed, leftOnRedExit, leftOnRedRegion } from "../static/js/sim/left-on-red.js";
import { flashControl, flashMain, flashing, setNightFlash } from "../static/js/sim/night-flash.js";
import { approachPhase, phaseOf } from "../static/js/sim/signals.js";

const inter = {
  id: "x",
  x: 0,
  y: 0,
  approaches: [
    { edge: "major", group: "A" },
    { edge: "minor", group: "B" },
  ],
  plan: {
    cycle: 48,
    A: { start: 0, green: 20, yellow: 3, allRed: 1 },
    B: { start: 24, green: 20, yellow: 3, allRed: 1 },
  },
};
const primary = { cls: "primary" };
const residential = { cls: "residential" };
const flashMap = (a, b) => ({
  edges: new Map([
    ["major", a],
    ["minor", b],
  ]),
  intersections: new Map([[inter.id, inter]]),
});

test("flashing decisions are scoped to the map and require complete phase inputs", () => {
  const mapA = flashMap(primary, residential);
  const mapB = flashMap(residential, primary);
  assert.equal(flashMain(inter, mapA), "A");
  assert.equal(flashMain(inter, mapB), "B");
  assert.equal(flashMain(inter, mapA), "A");
  assert.equal(flashMain(inter, flashMap(residential, residential)), null);
  assert.equal(flashMain({ approaches: "A" }, mapA), null);
  assert.equal(flashMain({ approaches: [...inter.approaches, { edge: "major", group: "C" }] }, mapA), null);
  assert.equal(flashMain({ approaches: [null, ...inter.approaches] }, mapA), null);
  assert.equal(flashMain(inter, {}), null);
  const world = { nightFlash: true, map: mapA, clock: { hour: 23.5 } };
  assert.equal(flashing(inter, world), "A");
  for (const hour of [-1, 24, Infinity, NaN, "23.5"]) {
    assert.equal(flashing(inter, { ...world, clock: { hour } }), null, String(hour));
  }
  const old = { type: "signal", id: inter.id, group: "B" };
  assert.equal(flashControl(world, old) === old, true, "unidentified approaches retain their source control");
});

test("registry signal dispatch rebinds the clock and defers to outages", () => {
  const world = { nightFlash: true, map: flashMap(primary, residential), clock: { hour: 23.5 } };
  const ctl = { id: inter.id, type: "signal", group: "B" };
  try {
    setNightFlash(null);
    assert.equal(specialSignalPhase(inter, world).B, "flashing_red");
    assert.equal(phaseOf(inter, 1).A, "green");
    assert.equal(controlAt(world, ctl, "minor").type, "stop");
    // Exercise the actual record independently of other checkpoint callbacks.
    const record = FEATURES.find(({ key }) => key === "nightFlash");
    record.checkpoint(world);
    assert.equal(approachPhase(inter, "major", 1), "flashing_amber");
    assert.equal(phaseOf(inter, 1).B, "flashing_red");
    world.outages = { isDark: (id) => id === inter.id };
    assert.equal(specialSignalPhase(inter, world), null);
    assert.equal(controlAt(world, ctl, "minor").dark, true);
    assert.equal(phaseOf(inter, 1).A, "green");
  } finally {
    setNightFlash(null);
  }
});

test("only finite ordered bounds identify a supported left-on-red area", () => {
  const area = [-114.085, 51.035, -114.065, 51.044];
  assert.equal(leftOnRedRegion(area), true);
  assert.equal(leftOnRedRegion([area[2], area[1], area[0], area[3]]), false);
  assert.equal(leftOnRedRegion([area[0], area[3], area[2], area[1]]), false);
  assert.equal(leftOnRedRegion(area.map(String)), false);
  assert.equal(leftOnRedRegion([NaN, ...area.slice(1)]), false);
  const sparse = area.slice();
  delete sparse[1];
  assert.equal(leftOnRedRegion(sparse), false);
  assert.equal(leftOnRedAllowed(undefined, "a", "b"), false);
  assert.equal(leftOnRedAllowed({ leftOnRed: true }, "a", "b"), false);
  assert.equal(leftOnRedAllowed({ leftOnRed: true, map: { routingBbox: area } }, "a", "a"), false);
  assert.equal(leftOnRedExit(undefined, { edge: "a" }), false);
  assert.equal(leftOnRedExit({ route: { edges: ["a"] } }, null), false);
});

test("the registered red turn supplies lane, yielding and question metadata", () => {
  const move = { go: false };
  const extra = extraRedTurn({ left_on_red: move });
  assert.equal(extra.move === move, true);
  assert.equal(extra.direction, "left");
  assert.equal(extra.lane, 0);
  assert.equal(extra.motionCriterion, null);
  assert.equal(redTurnAllowed({ left_on_red: move }), false);
  const world = {};
  extra.observe(world);
  assert.equal(world.leftOnRedSeen, true);
  move.go = true;
  assert.equal(redTurnAllowed({ left_on_red: move }), true);
  assert.match(extraRedTurn({ left_on_red: move }).motionCriterion, /may turn left on red/);
  assert.equal(redTurnAllowed({ right_on_red: { go: true }, left_on_red: { go: false } }), true);
});

test("invalid amber samples cannot create or clear usable driving decisions", () => {
  const car = { v: 10, spec: { accelLag: 0.2, maxBrake: 7 } };
  const sample = (key = "major:x", distance = 65, shows = "yellow", time = 20.5) =>
    observeAmber(car, key, "yellow", distance, inter, shows, time);
  assert.equal(sample("", 65), null);
  assert.equal(sample("major:x", Infinity), null);
  assert.equal(sample("major:x", 65, "yellow", NaN), null);
  assert.equal(sample("major:x", 65, "red"), null);
  assert.equal(observeAmber(car, "major:x", "yellow", 65, null, "yellow", 20.5), null);
  assert.equal(sample("major:x", 65, "arrow_yellow"), null);
  const decision = sample();
  assert.equal(decision.stop, true);
  assert.equal(observeAmber(car, "major:x", "green", 65, inter, "green", NaN), null);
  assert.equal(car.amberChoices.get("major:x") === decision, true);
  assert.equal(observeAmber({ ...car, v: NaN }, "major:x", "yellow", 65, inter, "yellow", 20.5), null);
  assert.equal(amberStoppingDistance({ v: NaN }), Infinity);
  assert.equal(amberStoppingDistance({ v: 10, spec: { accelLag: -1 } }), amberStoppingDistance({ v: 10 }));
});

test("the registered amber profile retains the candidate's controlled stop", () => {
  const amber = { stop: true, stop_decel: 3, reaction_s: 0.6, firm: true };
  const snap = { intersection: { amber } };
  assert.equal(signalDecision(snap.intersection) === amber, true);
  const [atLine] = hooks("lineStop", "beforeFollower");
  const law = atLine(snap);
  assert.equal(law.stopDecel, 3);
  assert.equal(law.stopReaction, 0.6);
  assert.equal(law.stopFirm, true);
  assert.equal(stopAtLineDrive(snap, { id: "stop_at_line" }), true);
  assert.equal(stopAtLineDrive(snap, { id: "yield_to_bus" }), false);
  snap.intersection.right_on_red = { go: true };
  assert.equal(stopAtLineDrive(snap, { id: "stop_at_line" }), false);
  const [limit] = hooks("clearingLimit");
  assert.equal(limit(snap), null);
  snap.amber_clear = { stop: false, speed_mps: 7 };
  assert.equal(limit(snap).speed, 7);
  const [finish] = hooks("adjust", "finish");
  const actions = [{ law: { vTarget: 9 } }, { law: { vTarget: 4 } }, { law: {} }];
  finish({ snap }, actions);
  assert.equal(actions[0].law.vTarget, 7);
  assert.equal(actions[1].law.vTarget, 4);
  assert.equal(Object.hasOwn(actions[2].law, "vTarget"), false);
});

test("uncertain reservation schedules retain the lane restriction safely", () => {
  const window = { start: 420, end: 540, days: [0] };
  assert.equal(busLaneActive({}, { hour: 9 }), true);
  assert.equal(busLaneActive({ hours: [window] }, { hour: 7 }), true);
  assert.equal(busLaneActive({ hours: [window] }, { hour: 9 }), false);
  assert.equal(busLaneActive({ hours: [window] }, { hour: 8, weekday: 1 }), false);
  assert.equal(busLaneActive({ hours: [] }, { hour: 8 }), false);
  assert.equal(busLaneActive({ hours: { unknown: true } }, { hour: 9 }), true);
  assert.equal(busLaneActive({ hours: [null] }, { hour: 9 }), true);
  assert.equal(busLaneActive({ hours: [{ ...window, start: "420" }] }, { hour: 9 }), true);
  assert.equal(busLaneActive({ hours: [{ ...window, end: 1441 }] }, { hour: 9 }), true);
  assert.equal(busLaneActive({ hours: [{ ...window, days: null }] }, { hour: 9 }), true);
  assert.equal(busLaneActive({ hours: [{ ...window, days: [7] }] }, { hour: 9 }), true);
  assert.equal(busLaneActive({ hours: [window] }, { hour: 9, weekday: -1 }), true);
  assert.equal(busLaneActive({}, { hour: 24 }), false);
  assert.equal(busLaneActive({}, { hour: -1 }), false);
  assert.equal(busLaneActive(null, { hour: 8 }), false);
});

test("reserved-lane routing ignores bad lookups and restricts unknown exemptions", () => {
  const clock = { hour: 15 };
  assert.equal(legalBusLane({ buslanes: "unavailable" }, "a", 0, clock), true);
  assert.equal(legalBusLane({ buslanes: [null] }, undefined, 0, clock), true);
  const map = { buslanes: [{ edge: "a", lane: 0 }] };
  assert.equal(legalBusLane(map, "a", 0, clock), false);
  assert.equal(legalBusLane(map, "a", 1, clock), true);
  assert.equal(legalBusLane(map, "a", 0, clock, "straight", 10, true), true);
  assert.equal(routeBusLane({}, NaN, clock), null);
  assert.equal(routeBusLane({}, 0, clock, false, -1), null);
  assert.equal(routeBusLane({}, 0, clock, false, 1.5), null);
  const route = {
    map: { ...map, edges: new Map([["a", { id: "a" }]]) },
    edges: ["a"],
    laneEdgeAt() {
      return 0;
    },
  };
  assert.equal(routeBusLane(route, 0, clock, false, 1), null);
});

test("bus-lane samples require forward motion and positive elapsed time before counting metres", () => {
  const world = {
    clock: { hour: 8 },
    ego: { v: 2 },
    map: {
      buslanes: [{ edge: "a", lane: 0, allowed: ["bus"] }],
      nearestLane: () => ({ lane: { edge: "a", idx: 0 } }),
    },
    violations: {},
    events: [],
  };
  for (const dt of [0, -1, NaN, Infinity]) auditBusLanes(world, dt);
  assert.equal(world.busLanesSeen, true);
  assert.equal(world.events.length, 0);
  assert.equal(featureMetrics(world, world.violations, "afterPassing").bus_lane_driving, 0);
  world.ego.v = NaN;
  auditBusLanes(world, 1);
  assert.equal(world.events.length, 0);
  world.ego.v = 2;
  auditBusLanes(world, 0.75);
  assert.equal(world.events[0].type, "bus_lane_driving");
  assert.equal(world.violations.bus_lane_driving, 1.5);
});

test("traffic paths use the existing policy shape with no disabled state", () => {
  const world = { busLanes: false, clock: { hour: 8 } };
  const path = {};
  applyTrafficPathPolicy(world, path, "bus");
  assert.equal(Object.keys(path).length, 0);
  world.busLanes = true;
  applyTrafficPathPolicy(world, path, "bus");
  assert.equal(path.busLanePolicy.clock === world.clock, true);
  assert.equal(path.busLanePolicy.bus, true);
  applyTrafficPathPolicy(world, path);
  assert.equal(Object.hasOwn(path.busLanePolicy, "bus"), false);
  world.clock = { hour: 9 };
  applyTrafficPathPolicy(world, path);
  assert.equal(path.busLanePolicy.clock === world.clock, true);
});
