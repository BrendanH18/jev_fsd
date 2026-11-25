import assert from "node:assert/strict";
import { DeadlockDetector, safetyBrake } from "../static/js/brain/safety.js";
import { desiredSpeed, drivenMetricSnapshot, hazardFlags, waitsItsTurn } from "../static/js/brain/sensors.js";
import { flagText, isTrack, openTrack, TRACKS } from "../static/js/brain/tracks.js";
import { Vehicle } from "../static/js/sim/vehicle.js";

let checks = 0;
function test(description, run) {
  try {
    run();
    checks++;
  } catch (error) {
    throw new Error(description, { cause: error });
  }
}

const obstacle = (x, y = 0, psi = 0, v = 0, kind = "car") => Object.assign(new Vehicle(x, y, psi, v), { kind });
function scene(v, ...obstacles) {
  return { ego: new Vehicle(0, 0, 0, v), route: {}, visibleObstaclesNear: () => obstacles };
}

assert.equal(Object.isFrozen(TRACKS), true);
assert.equal(isTrack("open"), true);
assert.equal(isTrack("guarded"), true);
assert.equal(flagText("  "), "unknown road-rule check");

const applied = { eligible: [true], mustStop: true };
const simulated = (reject, eligible = false, collision = null) => ({
  reject,
  eligible,
  flagged: true,
  sim: { collision },
});
const collided = { id: "wall" };

const direct = simulated("collision", true);
assert.equal(openTrack([direct], applied).eligible.length, 0);
assert.equal(direct.flagged, undefined);
assert.equal(direct.eligible, false);

const collisionWithoutLabel = simulated({ other: "wrong shape" }, true, collided);
assert.equal(openTrack([collisionWithoutLabel], applied).rejected.collision, 1);
assert.equal(collisionWithoutLabel.reject, "collision");

const malformed = [simulated(1), simulated({}), simulated(Symbol("check")), simulated(" collision ")];
const invalidResult = openTrack(malformed, applied);
assert.equal(invalidResult.eligible.length, 0);
assert.equal(invalidResult.rejected.unknown, 4);
assert.equal(
  malformed.every((candidate) => candidate.flagged === undefined),
  true,
);

const collisionKeys = [
  simulated("__proto__", false, collided),
  simulated("constructor", false, collided),
  simulated("__proto__", false, collided),
];
const counted = openTrack(collisionKeys, applied);
assert.equal(Object.getPrototypeOf(counted.rejected) === Object.prototype, true);
assert.equal(Object.hasOwn(counted.rejected, "__proto__"), true);
assert.equal(Object.getOwnPropertyDescriptor(counted.rejected, "__proto__")?.value, 2);
assert.equal(counted.rejected.constructor, 1);

assert.equal(safetyBrake(scene(2), null, { hazard: { in_s: 0.1 } })?.reason, "predicted");
assert.equal(safetyBrake(scene(2), null, { law: {}, hazard: { in_s: null } }), null);
assert.equal(safetyBrake(scene(2), null, { law: {}, hazard: { in_s: -Infinity } }), null);
assert.equal(safetyBrake(scene(2), null, { law: {}, hazard: { in_s: "0.3" } }), null);
assert.equal(
  safetyBrake(scene(8, obstacle(9, 0, 0, 1)), { following: { gap_m: -Infinity, closing_mps: 8 } }, null)?.reason,
  "ahead",
);
assert.equal(safetyBrake(scene(8), { following: { gap_m: 1, closing_mps: Infinity } }, null), null);

const cached = scene(10, obstacle(8, 8, 0, 0, "door"), obstacle(9, 9, 0, 0, "door"));
const original = Object.freeze(cached.ego.obb());
let boxes = 0;
cached.ego.obb = () => {
  boxes++;
  return original;
};
assert.equal(safetyBrake(cached, null, null), null);
assert.equal(boxes, 1);
cached.ego.v = -2;
assert.equal(safetyBrake(cached, null, null), null);
assert.equal(boxes, 2);

const detector = new DeadlockDetector();
const emptyRoad = scene(0);
detector.update(emptyRoad, null, 0.5);
for (const bad of [NaN, Infinity, -1, "0.5"]) {
  assert.throws(() => detector.update(emptyRoad, null, bad), /finite, non-negative timestep/);
  assert.equal(detector.stoppedFor, 0.5);
  assert.equal(emptyRoad.stuckFor, 0.5);
}

const probe = (projection, heading = 0) =>
  drivenMetricSnapshot({
    ego: new Vehicle(0, 0, heading),
    route: { project: () => projection },
  });
for (const projection of [
  null,
  { heading: Infinity, distance: 0, s: 2 },
  { heading: 0, distance: NaN, s: 3 },
  { heading: 0, distance: 0, s: NaN },
]) {
  assert.equal(probe(projection), null);
}

const clear = { limit: 13, ego: { v: 0 }, traffic: [], road: { on_road: true } };
const flags = (fields, name) => hazardFlags({ ...clear, ...fields }).includes(name);
const speed = (fields) => desiredSpeed({ ...clear, ...fields });
const line = (distance) => ({ bumper_to_line_m: distance });

test("Intersection cadence activates inside the 60 m look-ahead boundary", () => {
  assert.equal(flags({ intersection: line(59.99) }, "intersection"), true);
  assert.equal(flags({ intersection: line(60) }, "intersection"), false);
});

test("An oncoming conflict remains a cadence flag beyond ordinary intersection look-ahead", () => {
  const fields = { intersection: { ...line(80), oncoming: { id: "opp" } } };
  assert.equal(flags(fields, "oncoming"), true);
  assert.equal(flags(fields, "intersection"), false);
});

test("A planned turn activates cadence only inside 50 m", () => {
  assert.equal(flags({ nav: { next_turn: "left", turn_in_m: 49.99 } }, "turn"), true);
  assert.equal(flags({ nav: { next_turn: "left", turn_in_m: 50 } }, "turn"), false);
});

test("A nearby destination never impersonates a planned turn", () => {
  assert.equal(flags({ nav: { next_turn: "none", turn_in_m: 2 } }, "turn"), false);
});

test("The following flag requires less than 15 m of bumper gap", () => {
  assert.equal(flags({ following: { gap_m: 14.99 } }, "following"), true);
  assert.equal(flags({ following: { gap_m: 15 } }, "following"), false);
});

test("A vehicle at or behind the ego axle does not activate forward traffic cadence", () => {
  assert.equal(
    flags(
      {
        traffic: [
          { ahead: 0, right: 0 },
          { ahead: -3, right: 0 },
        ],
      },
      "traffic",
    ),
    false,
  );
  assert.equal(flags({ traffic: [{ ahead: 0.01, right: 0 }] }, "traffic"), true);
});

test("A moving traffic reading exactly 25 m away is outside cadence range", () => {
  assert.equal(flags({ traffic: [{ ahead: 25, right: 0 }] }, "traffic"), false);
  assert.equal(flags({ traffic: [{ ahead: 24.99, right: 0 }] }, "traffic"), true);
});

test("Forward traffic cadence uses a symmetric lateral corridor", () => {
  for (const side of [-1, 1]) {
    assert.equal(flags({ traffic: [{ ahead: 12, right: side * 8 }] }, "traffic"), false);
    assert.equal(flags({ traffic: [{ ahead: 12, right: side * 7.99 }] }, "traffic"), true);
  }
});

test("Cadence measures lane error from the tracked lane center when available", () => {
  const routeProj = { lateral: 3.5 };
  assert.equal(flags({ routeProj, lane: { lateral: 0.1 } }, "lane"), false);
  assert.equal(flags({ routeProj }, "lane"), true);
});

test("The lane-error cadence threshold includes neither lateral boundary", () => {
  for (const lateral of [-0.8, 0.8]) assert.equal(flags({ routeProj: { lateral } }, "lane"), false);
});

test("A completed shift into another lane remains a lane-change cadence flag", () => {
  assert.equal(flags({ lane: { shift: null, delta: -1 } }, "lane change"), true);
  assert.equal(flags({ lane: { shift: null, delta: 0 } }, "lane change"), false);
});

test("An active return shift triggers cadence even with a zero target lane delta", () => {
  assert.equal(flags({ lane: { shift: {}, delta: 0 } }, "lane change"), true);
});

test("Near-destination cadence switches at 30 m remaining", () => {
  assert.equal(flags({ nav: { remaining_m: 30 } }, "arriving"), false);
  assert.equal(flags({ nav: { remaining_m: 29.99 } }, "arriving"), true);
});

test("Independent hazards retain their cadence priority order", () => {
  const active = {
    ...clear,
    intersection: { ...line(2), oncoming: {} },
    following: { gap_m: 4 },
    emergency: {},
    pedestrian: {},
    nav: { next_turn: "right", turn_in_m: 6, remaining_m: 20 },
  };
  assert.equal(
    hazardFlags(active).join("|"),
    "intersection|oncoming|turn|following|pedestrian|emergency vehicle|arriving",
  );
});

test("An explicit zero visibility target stays zero even with a long sight range", () => {
  const result = speed({ visibility: { safe_speed_mps: 0, range_m: 200 } });
  assert.equal(result.v, 0);
  assert.equal(result.reasons.includes("limited visibility"), true);
});

test("Visibility falling inside the stopping buffer yields a zero speed target", () => {
  assert.equal(speed({ visibility: { range_m: 5 } }).v, 0);
});

test("Visibility with room beyond the buffer yields a larger target", () => {
  const at = (range_m) => speed({ visibility: { range_m } }).v;
  assert.ok(at(20) > at(15));
});

test("The visibility cap adds no reason when the road limit is tighter", () => {
  assert.equal(speed({ limit: 2, visibility: { safe_speed_mps: 5 } }).reasons.includes("limited visibility"), false);
});

test("A moving bus with a stop point inside one metre requests a complete stop", () => {
  assert.equal(speed({ bus: { bumper_to_stop_m: 0.9, moving_out: true } }).v, 0);
  assert.ok(speed({ bus: { bumper_to_stop_m: 1, moving_out: true } }).v > 0);
});

test("The stop behind a vehicle at a crosswalk remains distinct from a pedestrian hold", () => {
  const result = speed({ crosswalk_stop: { bumper_to_stop_m: 0.2 } });
  assert.equal(result.v, 0);
  assert.equal(result.reasons.at(-1), "car stopped at a crosswalk");
});

test("An amber school bus already behind the stop point no longer caps speed", () => {
  assert.equal(speed({ school_bus: { lights: "amber", bumper_to_stop_m: 0 } }).v, speed({}).v);
});

test("Red school-bus lamps still hold at a passed stop point", () => {
  assert.equal(speed({ school_bus: { lights: "red", bumper_to_stop_m: -0.2 } }).v, 0);
});

test("Streetcar doors replace the approach speed with a stop target", () => {
  const at = (doors) => speed({ streetcar: { doors, bumper_to_stop_m: 0.5 } }).v;
  assert.ok(at(false) > 0);
  assert.equal(at(true), 0);
});

test("A track-room hold and a train hold retain separate explanations", () => {
  const reason = (wait) => speed({ level_crossing: { wait, bumper_to_stop_m: 0.5 } }).reasons.at(-1);
  assert.equal(reason("room"), "no room past the tracks");
  assert.equal(reason("train"), "train coming at the level crossing");
});

test("Emergency drive-on authorization with no stop leaves the speed ceiling unchanged", () => {
  assert.equal(speed({ emergency: { lead: true, bumper_to_stop_m: null, max_speed_mps: 1 } }).v, speed({}).v);
});

test("Pull-over speed respects its own envelope before reaching the stop", () => {
  assert.equal(speed({ emergency: { kind: "ambulance", bumper_to_stop_m: 20, max_speed_mps: 1 } }).v, 1);
});

test("A lane-closure merge hold at route station zero remains a stop", () => {
  assert.equal(speed({ lane_closure: { stop_s_route: 0, bumper_to_stop_m: 0, wait: true } }).v, 0);
});

test("An all-way stop queue cannot hold before the stop is completed", () => {
  const intersection = { ...line(1), control: "stop", priority: { arrived: true, go: false } };
  assert.equal(waitsItsTurn({ ...intersection, stop_completed: false }), false);
  assert.equal(waitsItsTurn({ ...intersection, stop_completed: true }), true);
});

test("A completed stop keeps yielding to moving cross traffic until junction entry", () => {
  const intersection = { ...line(1), control: "stop", stop_completed: true, cross_traffic_moving: true };
  assert.equal(speed({ intersection: { ...intersection, entered: false } }).v, 0);
  assert.equal(speed({ intersection: { ...intersection, entered: true } }).v, speed({}).v);
});

test("An imminent executing hazard acts at walking speed and stops reporting at one second", () => {
  const hazard = (in_s) => ({ law: {}, hazard: { in_s } });
  assert.equal(safetyBrake(scene(0.8), null, hazard(0.99))?.reason, "predicted");
  assert.equal(safetyBrake(scene(0.8), null, hazard(1)), null);
});

test("A fresh physical obstruction takes priority over the executing prediction", () => {
  const hazard = { law: {}, hazard: { in_s: 0.1 } };
  assert.equal(safetyBrake(scene(5, obstacle(5)), null, hazard)?.reason, "ahead");
});

test("A reverse sweep does not hold for the same obstacle after it moves to the nose", () => {
  assert.equal(safetyBrake(scene(-2, obstacle(5)), null, null), null);
  assert.equal(safetyBrake(scene(-2, obstacle(-5)), null, null)?.reason, "behind");
});

test("A stopped turnaround uses reverse sensing only for the active execution law", () => {
  const law = { kind: "turnaround", phase: "reverse" };
  const world = scene(0, obstacle(-3));
  world.turnaround = law;
  assert.equal(safetyBrake(world, null, { law })?.reason, "blocked");
  assert.equal(safetyBrake(world, null, { law: { ...law } }), null);
});

test("A completed parking law restores the ordinary forward standstill clearance", () => {
  const world = scene(0, obstacle(5.4));
  const law = { kind: "park", phase: "done" };
  world.parking = law;
  assert.equal(safetyBrake(world, null, { law })?.reason, "blocked");
  law.phase = "start";
  assert.equal(safetyBrake(world, null, { law }), null);
});

test("The direct-ahead check excludes moving oncoming traffic during a parking approach", () => {
  const law = { kind: "park", phase: "start" };
  const world = scene(2, obstacle(4, 0, Math.PI, 3));
  world.parking = law;
  assert.equal(safetyBrake(world, null, { law }), null);
  assert.equal(safetyBrake(world, null, null)?.reason, "ahead");
});

test("Crawling in a planned turnaround records stalled time after five seconds of idling", () => {
  const world = scene(0.1);
  const detector = new DeadlockDetector();
  const turn = (idle_s) => ({ target: { v: 5 }, turnaround: { executing: true, idle_s } });
  assert.equal(detector.update(world, turn(4.99), 0.5), 0);
  assert.equal(detector.update(world, turn(5), 0.5), 0.5);
});

console.log(`${checks} sensing and brake regression cases passed.`);
