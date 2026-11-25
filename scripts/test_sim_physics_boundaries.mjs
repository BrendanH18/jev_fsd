import assert from "node:assert/strict";
import { test } from "node:test";
import { BIKE, G, ROAD, Vehicle, comfort } from "../static/js/sim/vehicle.js";
import { setWeather } from "../static/js/sim/weather.js";
import { WorldClock, parseHour } from "../static/js/sim/world-clock.js";
import { capturePose, interpolatePose } from "../static/js/sim/interpolate.js";

globalThis.document = { querySelector: () => null };
const { applyLaw, curveProfileSpeed, laneCenterAt, laneChangeLength, lookahead, speedControl, stopSpeedFor } =
  await import("../static/js/sim/controller.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const DT = 1 / 60;

test("Reject invalid vehicle step durations before mutating the integrator", () => {
  const car = new Vehicle(0, 0, 0, 5);
  for (const dt of [NaN, Infinity, -1, Number.MAX_VALUE]) assert.throws(() => car.step(dt), /duration/);
  assert.equal(car.delta, 0);
  assert.equal(car.v, 5);
  assert.equal(car.x, 0);
});

test("Leave the physical state untouched on a zero-duration vehicle step", () => {
  const car = new Vehicle(0, 0, -Math.PI);
  car.slipping = 0.5;
  car.step(0);
  assert.equal(car.psi, -Math.PI);
  assert.equal(car.slipping, 0.5);
});

test("Fail a non-finite vehicle command before applying steering or throttle", () => {
  const car = new Vehicle();
  assert.throws(() => car.step(DT, { steer: 0.1, accel: NaN }), /command/);
  assert.throws(() => car.step(DT, { steer: Infinity, accel: 1 }), /command/);
  assert.equal(car.delta, 0);
  assert.equal(car.a, 0);
});

test("Detect a poisoned starting pose before integrating a vehicle", () => {
  const car = new Vehicle(1, 2, Infinity, 0);
  assert.throws(() => car.step(DT, { accel: 1 }), /pose/);
  assert.equal(car.x, 1);
  assert.equal(car.a, 0);
});

test("Fall back to global road grip when a local surface returns invalid coefficients", () => {
  setWeather("rain");
  for (const speed of [2, 8]) {
    const wet = new Vehicle(1, 2, 0.1, speed);
    const mixed = wet.clone();
    const command = { steer: 0.2, accel: -6 };
    wet.step(DT, command);
    ROAD.gripAt = (x) => (x > 2 ? NaN : -0.1);
    try {
      mixed.step(DT, command);
      for (const key of ["x", "y", "psi", "v", "ax", "a", "latAccel"]) assert.equal(mixed[key], wet[key], key);
    } finally {
      ROAD.gripAt = null;
      setWeather("rain");
    }
  }
  setWeather("dry");
});

test("Keep a true zero-grip patch distinct from missing surface data", () => {
  const car = new Vehicle(0, 0, 0, 2);
  ROAD.gripAt = () => 0;
  try {
    car.step(DT, { accel: -4, steer: 0.2 });
    assert.equal(car.v, 2);
    assert.equal(car.psi, 0);
  } finally {
    ROAD.gripAt = null;
  }
});

test("Keep massless bicycles kinematic above the car's dynamic threshold", () => {
  const bike = new Vehicle(0, 0, 0, 6, BIKE);
  bike.step(DT, { steer: 0.1, accel: 1 });
  assert.equal(bike.x, 6 * DT);
  assert.ok(bike.psi > 0 && Number.isFinite(bike.r));
});

test("Clear residual yaw and lateral velocity when braking reaches a standstill", () => {
  const car = new Vehicle(0, 0, 0, 0.01);
  car.vy = 0.3;
  car.r = 0.5;
  car.a = -4;
  car.step(DT, { accel: -4, steer: 0.3 });
  assert.equal(car.v, 0);
  assert.equal(car.vy, 0);
  assert.equal(car.r, 0);
});

test("Allow explicit reverse from a stationary rear axle", () => {
  const car = new Vehicle();
  car.step(DT, { accel: -2, reverse: true });
  car.step(DT, { accel: -2, reverse: true });
  assert.ok(car.v < 0 && car.x < 0);
});

test("Keep hard braking opposed to reverse motion", () => {
  const car = new Vehicle(0, 0, 0, -1);
  applyLaw(car, { kind: "hard_brake" }, null, 0, DT);
  assert.ok(car.a > 0 && car.v > -1);
});

test("Bound pure-pursuit lookahead equally in forward and reverse", () => {
  assert.equal(lookahead(0), 4);
  assert.equal(lookahead(-10), 8);
  assert.equal(lookahead(40), 15);
});

test("Bound lane-change length for crawling and highway approaches", () => {
  assert.equal(laneChangeLength(1), 18);
  assert.equal(laneChangeLength(8), 28);
  assert.equal(laneChangeLength(25), 50);
});

test("Respect asymmetric pedal limits in the proportional speed controller", () => {
  const limits = { gain: 2, maxAccel: 1, maxBrake: 3 };
  assert.equal(speedControl(4, 6, limits), 1);
  assert.equal(speedControl(6, 4, limits), -3);
  assert.equal(speedControl(4, 4.25, limits), 0.5);
});

test("Report the active upcoming curve and its current braking speed ceiling", () => {
  const route = { length: 200, curveSpeedAt: (_s, d) => (d === 9 ? 4 : Infinity) };
  const cap = curveProfileSpeed(route, 40);
  assert.equal(cap.at, 9);
  assert.equal(cap.v, Math.sqrt(4 ** 2 + 2 * comfort().decel * 0.8 * 9));
});

test("Stop sampling the curve profile at the route endpoint", () => {
  const offsets = [];
  const route = {
    length: 10,
    curveSpeedAt(_s, d) {
      offsets.push(d);
      return Infinity;
    },
  };
  assert.equal(curveProfileSpeed(route, 7).v, Infinity);
  assert.deepEqual(offsets, [0]);
});

test("Recover the lane centre through a route frame change without including the nudge", () => {
  const route = { frameMove: (from, to) => (to > from ? 3 : 0) };
  assert.equal(laneCenterAt({ offset: 4, center: 3.5, s0: 10 }, 20, route), 0.5);
});

test("Fallback to dry grip for inherited or non-string weather selectors", () => {
  for (const invalid of ["toString", "__proto__", ["rain"], null]) {
    setWeather("snow");
    assert.equal(setWeather(invalid).name, "dry");
    assert.equal(ROAD.mu, 0.9);
  }
});

test("Keep the shared weather profile and physical grip in sync across preset changes", () => {
  const profile = setWeather("rain");
  assert.equal(profile.visibility, 55);
  assert.equal(setWeather("snow") === profile, true);
  assert.equal(profile.visibility, 40);
  assert.equal(ROAD.mu, 0.25);
  setWeather("dry");
});

test("Reduce comfortable stopping speed with weather while keeping full dry emergency demand", () => {
  setWeather("snow");
  const snow = stopSpeedFor(25);
  assert.equal(comfort().hardDecel, 0.25 * G * 0.8);
  setWeather("dry");
  assert.ok(stopSpeedFor(25) > snow);
  assert.equal(comfort().hardDecel, 7);
  assert.equal(stopSpeedFor(-1), 0);
});

test("Parse trimmed named presets and negative decimal hours", () => {
  assert.equal(parseHour("  afternoon  "), 15.5);
  assert.equal(parseHour(-0.5), 23.5);
  assert.equal(parseHour("23:45"), 23.75);
});

test("Reject malformed clock strings and inherited time preset names", () => {
  for (const invalid of ["15:99", "6:5", "6pm", "7.5foo", "constructor", "__proto__", ""]) {
    assert.equal(parseHour(invalid, 4), 4, invalid);
  }
});

test("Carry positive elapsed time through multiple days and a Sunday rollover", () => {
  const clock = new WorldClock(23.5, 60, 6);
  clock.update(0);
  clock.update(1500);
  assert.equal(clock.hour, 0.5);
  assert.equal(clock.weekday, 1);
});

test("Ignore an invalid elapsed timestamp without moving the clock anchor", () => {
  const clock = new WorldClock(10, 60);
  clock.update(20);
  clock.update(NaN);
  clock.update(80);
  assert.equal(clock.hour, 11);
});

test("Snap visualization away from an invalid interpolation sample", () => {
  const current = { x: 4, y: 6, psi: 0.1 };
  assert.equal(interpolatePose(current, { x: NaN, y: 5, psi: 0 }, 0.5) === current, true);
  assert.equal(interpolatePose(current, { x: 2, y: 5, psi: 0 }, undefined) === current, true);
  assert.equal(interpolatePose(current, { x: 2, y: 5, psi: 0 }, NaN) === current, true);
});

test("Use a stable zero heading when capturing render-only actors without a valid heading", () => {
  assert.equal(capturePose({ x: 1, y: 2 }).psi, 0);
  assert.equal(capturePose({ x: 1, y: 2, psi: Infinity }).psi, 0);
});

test("Snap a large in-place heading reset without rendering an artificial turn", () => {
  const current = { x: 4, y: 6, psi: Math.PI };
  assert.equal(interpolatePose(current, { x: 4, y: 6, psi: 0 }, 0.5) === current, true);
});

test("Reject invalid world steps before moving traffic or advancing its clock", () => {
  const world = fixtureWorld();
  const ctx = { world, autopilot: { enabled: false }, fleet: { step: () => assert.fail("moved traffic") } };
  for (const dt of [0, -DT, NaN, Infinity, Number.MAX_VALUE]) assert.throws(() => stepWorld(ctx, dt, 0), /duration/);
  assert.throws(() => stepWorld(ctx, DT, Infinity), /clock/);
  assert.equal(world.t, 0);
  assert.equal(world.tick, 0);
});

test("Stop a driver that writes a non-finite ego pose before the traffic step", () => {
  const world = fixtureWorld();
  const ctx = {
    world,
    autopilot: {
      enabled: true,
      step: () => {
        world.ego.x = NaN;
      },
    },
    fleet: { step: () => assert.fail("moved traffic") },
  };
  assert.throws(() => stepWorld(ctx, DT, 0), /ego pose/);
  assert.equal(world.t, 0);
  assert.equal(world.tick, 0);
});

test("Carry current tyre slip into a vehicle clone and let its physics advance independently", () => {
  const car = new Vehicle(0, 0, 0, 2);
  car.slipping = 0.6;
  const clone = car.clone();
  assert.equal(clone.slipping, 0.6);
  clone.step(DT);
  assert.equal(clone.slipping, 0);
  assert.equal(car.slipping, 0.6);
});
