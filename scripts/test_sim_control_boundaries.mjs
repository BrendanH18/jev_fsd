import assert from "node:assert/strict";
import { test } from "node:test";
import { BUS, HERITAGE_STREETCAR, Vehicle } from "../static/js/sim/vehicle.js";
globalThis.document = { querySelector: () => null };
const S = await import("../static/js/sim/signals.js");
const { Outages, controlAt, darkControl } = await import("../static/js/sim/outage.js");
const { flashControl, flashMain, setNightFlash } = await import("../static/js/sim/night-flash.js");
const { approachTo } = await import("../static/js/sim/priority.js");
const { busLaneActive, legalBusLane, reservedLane, routeBusLane } = await import("../static/js/sim/bus-lanes.js");
const { BUS_SIGNAL_S, busMayPullOut, busRelation } = await import("../static/js/sim/bus.js");
const { isEmergencyVehicle } = await import("../static/js/sim/emergency.js");
const { approach, trainAt, trainSpan, trainState } = await import("../static/js/sim/rail.js");
const { ringBusy, ringJoining } = await import("../static/js/sim/roundabout.js");

const signal = (options = {}) => ({
  id: "signal",
  cycle_s: 48,
  approaches: [
    { edge: "main", group: "A" },
    { edge: "side", group: "B" },
  ],
  ...options,
});
const advanced = (style = "arrow") =>
  signal({
    approaches: [...signal().approaches, { edge: "other", group: "A" }],
    plan: {
      cycle: 60,
      A: { start: 0, green: 32, yellow: 3, allRed: 1 },
      B: { start: 36, green: 20, yellow: 3, allRed: 1 },
      advance: { group: "A", edge: "main", length: 8, clear: 4, style },
    },
  });
const stop = (id) => ({ id, type: "stop" });
const control = (group = "B") => ({ id: "signal", type: "signal", group, s_line: 20 });
const flashWorld = (inter = signal()) => ({
  t: 10,
  nightFlash: true,
  clock: { hour: 23 },
  map: {
    intersections: new Map([[inter.id, inter]]),
    edges: new Map([
      ["main", { cls: "primary" }],
      ["side", { cls: "residential" }],
    ]),
  },
});
const track = { id: "bridge", stops: [] };
const crossing = { track: track.id, s: 80, half_m: 4 };
const train = (id, front, dir = 1, v = 5) => ({
  id,
  kind: "train",
  spec: HERITAGE_STREETCAR,
  ...trainState(track, front, dir, v),
});

test("Fail closed if an approach's advance phase has a non-finite clock", () => {
  assert.equal(S.approachPhase(advanced("flash"), "main", NaN), "red");
  assert.equal(S.approachPhase(advanced("arrow"), "main", Infinity), "red");
});

test("Keep an unmapped approach red during overnight flashing", () => {
  const world = flashWorld();
  setNightFlash(world);
  try {
    assert.equal(S.approachPhase(world.map.intersections.get("signal"), "unknown", 10), "red");
  } finally {
    setNightFlash(null);
  }
});

test("Skip overnight flash selection when any mapped approach edge is missing", () => {
  const inter = signal();
  const world = flashWorld(inter);
  world.map.edges.delete("side");
  assert.equal(flashMain(inter, world.map), null);
  world.map.edges.set("side", { cls: "residential" });
  assert.equal(flashMain(inter, world.map), "A");
});

test("Preserve fixed signal timing for negative elapsed time and positive offsets", () => {
  const inter = signal({ offset_s: 3 });
  const phase = S.phaseOf(inter, -4);
  assert.deepEqual(phase, { A: "red", B: "red", u: 47 });
  assert.equal(S.approachPhase(inter, "main", -3), "green");
});

test("Expose red and amber flashes together without mixing in the normal cycle", () => {
  const world = flashWorld();
  setNightFlash(world);
  try {
    const inter = world.map.intersections.get("signal");
    assert.deepEqual(S.phaseOf(inter, 7), { A: "flashing_amber", B: "flashing_red", u: 0 });
    assert.equal(S.pedPhase(inter, "A", 7), "dark");
  } finally {
    setNightFlash(null);
  }
});

test("Return no green countdown for an invalid signal group or elapsed timestamp", () => {
  assert.equal(S.secondsToGreen(signal(), "Z", 0), null);
  assert.equal(S.secondsToGreen(signal(), "A", NaN), null);
});

test("Choose the nearer of a left arrow and the following regular green after the signal wraps", () => {
  const inter = advanced();
  assert.equal(S.secondsToGreen(inter, "A", 59, "main", "left"), 1);
  assert.equal(S.secondsToGreen(inter, "A", 59, "main", "straight"), 13);
  assert.equal(S.secondsToGreen(inter, "A", 10, "main", "left"), 2);
});

test("Keep a zero or non-finite physics tick from counting as stop time", () => {
  const memory = new S.StopMemory();
  const ctl = stop("one");
  for (const dt of [0, Infinity, NaN, -1]) memory.update(ctl, 1, 0, dt);
  assert.equal(memory.state, "approaching");
  assert.equal(memory.stoppedFor, 0);
  assert.equal(memory.stops, 0);
  assert.equal(memory.update(ctl, 1, 0, 0.7), "completed");
});

test("Reset stop accumulation when a rolling driver interrupts the full stop", () => {
  const memory = new S.StopMemory();
  const ctl = stop("one");
  memory.update(ctl, 1, 0, 0.4);
  memory.update(ctl, 1, 0.3, 0.1);
  assert.equal(memory.update(ctl, 1, 0, 0.4), "stopped");
  assert.equal(memory.update(ctl, 1, 0, 0.31), "completed");
  assert.equal(memory.stops, 2);
});

test("Discard a completed stop after changing from a stop sign to a different signal", () => {
  const memory = new S.StopMemory();
  memory.update(stop("one"), 1, 0, 0.7);
  assert.equal(memory.update(control(), 1, 0, 0.1), "stopped");
  assert.equal(memory.completed, false);
  assert.equal(memory.controlId, "signal");
});

test("Preserve distinct outage stop identities when approaches share a source control object", () => {
  const ctl = control();
  const first = darkControl(ctl, "one");
  const second = darkControl(ctl, "two");
  assert.notEqual(first.id, second.id);
  assert.equal(darkControl(ctl, "one") === first, true);
  assert.equal(first.s_line, ctl.s_line);
});

test("Preserve distinct night flash stop identities when approaches share a source control object", () => {
  const world = flashWorld();
  const ctl = control();
  const first = flashControl(world, ctl, "one");
  const second = flashControl(world, ctl, "two");
  assert.notEqual(first.id, second.id);
  assert.equal(flashControl(world, ctl, "one") === first, true);
  assert.equal(second.all_way, false);
});

test("Reject invalid outage durations without installing an immortal cut", () => {
  const world = flashWorld();
  const outages = new Outages(world);
  for (const time of [0, -1, NaN]) assert.equal(outages.cut("signal", time), null);
  assert.equal(outages.isDark("signal"), false);
  assert.equal(outages.cut("signal").left, Infinity);
});

test("Return a flashing side street to its two-way stop after power is restored", () => {
  const world = flashWorld();
  world.outages = new Outages(world);
  const ctl = control();
  world.outages.cut("signal");
  assert.equal(controlAt(world, ctl, "side").all_way, true);
  assert.equal(world.outages.since("signal"), 10);
  world.outages.restore("signal");
  assert.equal(controlAt(world, ctl, "side").night_flash, true);
  assert.equal(world.outages.since("signal"), null);
});

test("Find an approach when a grouped signal includes a vertex with its own junction ID", () => {
  const inter = signal({ vertices: ["signal", "far"] });
  const world = flashWorld(inter);
  const v = new Vehicle();
  v.path = { s: 0, edges: [{ id: "side", to: "signal", sStart: 0, sEnd: 30 }] };
  const result = approachTo(world.map, v, "signal");
  assert.equal(result.edge, "side");
  assert.equal(result.to_node_m, 30 - (v.spec.length - v.spec.rearOverhang));
});

test("Skip turn and route geometry work on roads without reserved bus lanes", () => {
  const route = {
    edges: ["e"],
    map: { edges: new Map([["e", { id: "e" }]]) },
    laneEdgeStarts: () => assert.fail("unneeded route projection"),
  };
  assert.equal(routeBusLane(route, 10, { hour: 9 }, false, 0), null);
});

test("Continue a Sunday overnight bus reservation into Monday but end it at its exact boundary", () => {
  const lane = { hours: [{ days: [6], start: 23 * 60, end: 5 * 60 }] };
  assert.equal(busLaneActive(lane, { hour: 23, weekday: 6 }), true);
  assert.equal(busLaneActive(lane, { hour: 4.999, weekday: 0 }), true);
  assert.equal(busLaneActive(lane, { hour: 5, weekday: 0 }), false);
  assert.equal(busLaneActive(lane, { hour: 4, weekday: 1 }), false);
});

test("Translate a bicycle actor's kind to the reserved lane's permitted vehicle class", () => {
  const lane = { edge: "e", lane: 1, allowed: ["bus", "bicycle"] };
  const map = { buslanes: [lane] };
  const clock = { hour: 9 };
  assert.equal(reservedLane(map, "e", 1, clock, "bike"), undefined);
  assert.equal(!!reservedLane(map, "e", 1, clock, "car"), true);
  assert.equal(reservedLane(map, "e", 1, null, "car"), undefined);
});

test("Apply the inclusive reserved-bus-lane right-turn distance only to right turns", () => {
  const map = { buslanes: [{ edge: "e", lane: 1, allowed: ["bus"] }] };
  const clock = { hour: 9 };
  assert.equal(legalBusLane(map, "e", 1, clock, "right", 50), true);
  assert.equal(legalBusLane(map, "e", 1, clock, "right", 50.01), false);
  assert.equal(legalBusLane(map, "e", 1, clock, "left", 10), false);
});

test("Check a transit yielding gap in the target lane after applying the bus's curb shift", () => {
  const bus = new Vehicle(15, -3, 0, 0, BUS);
  bus.transit = { phase: "out", shift: 3, laneWidth: 3.5 };
  const driver = new Vehicle(0, 0);
  assert.equal(busRelation(driver, bus).inLane, true);
  assert.equal(busRelation(new Vehicle(0, 3.5), bus).inLane, false);
});

test("Hold a transit bus at the curb until its full indicator interval has elapsed", () => {
  const bus = new Vehicle(0, 0, 0, 0, BUS);
  bus.transit = { phase: "leaving", t: BUS_SIGNAL_S - 0.01 };
  assert.equal(busMayPullOut(bus, []), false);
  bus.transit.t = BUS_SIGNAL_S;
  assert.equal(busMayPullOut(bus, []), true);
});

test("Recognize only registered emergency vehicle kinds", () => {
  assert.equal(isEmergencyVehicle({ kind: "ambulance" }), true);
  assert.equal(isEmergencyVehicle({ kind: "toString" }), false);
  assert.equal(isEmergencyVehicle({ kind: "__proto__" }), false);
});

test("Ignore a rail actor without a placed track state", () => {
  assert.equal(approach({ kind: "train" }, crossing), null);
});

test("Prioritize a train occupying the crossing over a zero-ETA approaching train", () => {
  const due = train("at-limit", 76);
  const occupied = train("on-crossing", 81);
  assert.equal(approach(due, crossing).eta_s, 0);
  assert.equal(trainAt([due, occupied], crossing).train.id, "on-crossing");
});

test("Choose a train's nearest eligible stop even when track stops are unsorted and travel is reversed", () => {
  const line = {
    id: "unsorted",
    stops: [
      { id: "far", s: 10 },
      { id: "near", s: 40 },
      { id: "passed", s: 65 },
      { id: "too-close", s: 59 },
    ],
  };
  const n = trainState(line, 60, -1);
  assert.equal(n.rail.next, "near");
  assert.equal(trainSpan({ ...n, spec: HERITAGE_STREETCAR }).front, 60);
});

test("Distinguish traffic inside an entry's passing envelope from a vehicle queueing at its own roundabout line", () => {
  const ring = { x: 0, y: 0, outer_r: 10, island_r: 6, lane_r: 8 };
  const entry = { x: 10, y: 0 };
  assert.equal(ringBusy(ring, entry, [{ x: 8, y: 0, v: 0 }]), true);
  assert.equal(ringJoining(ring, entry, [{ x: 15, y: 0, psi: Math.PI, v: 5 }]), false);
});
