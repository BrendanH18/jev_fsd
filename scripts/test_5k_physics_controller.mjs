import assert from "node:assert/strict";
import { test } from "node:test";
import { CAR, ROAD, Vehicle, comfort, wrapHeading } from "../static/js/sim/vehicle.js";
import { setWeather } from "../static/js/sim/weather.js";

globalThis.document = { querySelector: () => null };
const {
  applyLaw,
  curveProfileSpeed,
  detourAt,
  laneCenterAt,
  laneChangeLength,
  lateralAt,
  lookahead,
  purePursuit,
  speedControl,
  steerToward,
  stopSpeedFor,
} = await import("../static/js/sim/controller.js");

const DT = 1 / 60;
const route = {
  length: 500,
  curveSpeedAt: () => Infinity,
  offsetPointAt: (s, offset) => [s, -offset],
};
const lane = { kind: "lane", vTarget: 10, s0: 0 };
const car = () => new Vehicle(10, 0, 0, 5);

function commands(law, s = 10, vehicle = car(), path = route) {
  let command;
  vehicle.step = (_dt, input) => {
    command = input;
  };
  applyLaw(vehicle, law, path, s, DT);
  return command;
}

test("zero-duration laws skip all route, planner and vehicle reads", () => {
  applyLaw(null, null, null, NaN, 0);
});

test("an invalid law duration fails before touching route geometry", () => {
  assert.throws(() => applyLaw(null, lane, null, 0, NaN), /duration/);
});

test("law execution rejects non-record input explicitly", () => {
  assert.throws(() => applyLaw(car(), null, route, 10, DT), /law must be an object/);
  assert.throws(() => applyLaw(car(), [], route, 10, DT), /law must be an object/);
});

test("lookahead rejects a corrupt signed speed", () => {
  for (const v of [undefined, NaN, Infinity, "5"]) assert.throws(() => lookahead(v), /finite speed/);
});

test("lane-change length rejects non-finite speed", () => {
  assert.throws(() => laneChangeLength(NaN), /finite speed/);
});

test("pursuit validates its arc length and offset before looking up the path", () => {
  const unused = { ...route, offsetPointAt: () => assert.fail("queried route") };
  assert.throws(() => purePursuit(car(), unused, "10"), /route position/);
  assert.throws(() => purePursuit(car(), unused, 10, NaN), /offset/);
});

test("pursuit validates explicit lookahead independently of speed", () => {
  assert.throws(() => purePursuit(car(), route, 10, 1, -1), /lookahead/);
  assert.throws(() => purePursuit(car(), route, 10, 1, Infinity), /lookahead/);
});

test("pursuit requires the route lookup and a physically meaningful length", () => {
  assert.throws(() => purePursuit(car(), null, 10), /route geometry/);
  assert.throws(() => purePursuit(car(), { ...route, length: -1 }, 10), /route geometry/);
});

test("pursuit errors name the invalid target and its pose independently", () => {
  assert.throws(() => steerToward(car(), [NaN, 10]), /point/);
  assert.throws(() => steerToward(new Vehicle(0, 0, Infinity), [1, 0]), /pose/);
});

test("pursuit catches subtraction overflow before calculating the requested steering", () => {
  assert.throws(() => steerToward(new Vehicle(-Number.MAX_VALUE), [Number.MAX_VALUE, 1]), /too far/);
});

test("pursuit rejects an invalid vehicle wheelbase", () => {
  assert.throws(() => steerToward(new Vehicle(0, 0, 0, 5, { wheelbase: 0 }), [2, 1]), /wheelbase/);
});

test("pursuit caps the target at the end of a route while preserving its lateral offset", () => {
  const s = 499;
  let seen;
  const end = {
    ...route,
    offsetPointAt(pos, offset) {
      seen = pos;
      return [pos, -offset];
    },
  };
  assert.ok(purePursuit(new Vehicle(s, 0, 0, 5), end, s, 2) < 0);
  assert.equal(seen, route.length);
});

test("recovery steering handles a multiply unwrapped heading in bounded work", () => {
  const car = new Vehicle(0, 0, 1e100);
  assert.equal(steerToward(car, [1, 0]), Math.atan2(2 * CAR.wheelbase * Math.sin(wrapHeading(-car.psi)), 1));
});

test("steering recovers coherently when its target is closer than one metre", () => {
  assert.equal(steerToward(new Vehicle(), [0, 0.1]), Math.atan2(2 * CAR.wheelbase, 1));
});

test("right-of-route offsets give right steering on an eastbound path", () => {
  assert.ok(purePursuit(car(), route, 10, 2) < 0);
  assert.ok(purePursuit(car(), route, 10, -2) > 0);
});

test("a negative recovery steering command is inverted when the law reverses", () => {
  const vehicle = car();
  const point = [11, -2];
  const command = commands({ kind: "reverse", target: point }, 10, vehicle, null);
  assert.equal(command.steer, -steerToward(vehicle, point));
  assert.equal(command.reverse, true);
});

test("hard braking without route geometry retains the current steering angle", () => {
  const vehicle = car();
  vehicle.delta = 0.23;
  assert.equal(commands({ kind: "hard_brake" }, 10, vehicle, null).steer, 0.23);
});

test("speed control rejects coercion of the target or a corrupt current speed", () => {
  assert.throws(() => speedControl(5, "4"), /numeric target/);
  assert.throws(() => speedControl(Infinity, 4), /current speed/);
});

test("speed control names an invalid gain or pedal limit", () => {
  assert.throws(() => speedControl(5, 4, { gain: -1 }), /gain/);
  assert.throws(() => speedControl(5, 4, { maxAccel: -1 }), /pedal limits/);
  assert.throws(() => speedControl(5, 4, { maxBrake: NaN }), /pedal limits/);
});

test("a finite gain saturates an infinite target, and disabling gain requests no pedal", () => {
  assert.equal(speedControl(5, Infinity), 2.5);
  assert.equal(speedControl(5, -Infinity), -7);
  assert.equal(speedControl(5, Infinity, { gain: 0 }), 0);
});

test("a finite speed error larger than the numeric range is scaled before saturation", () => {
  const gain = 1 / Number.MAX_VALUE;
  assert.ok(Math.abs(speedControl(-Number.MAX_VALUE, Number.MAX_VALUE, { gain }) - 2) < 1e-12);
});

test("stopping calculations reject malformed distances and decelerations", () => {
  assert.throws(() => stopSpeedFor("10", 2), /distance/);
  assert.throws(() => stopSpeedFor(10, -1), /deceleration/);
  assert.throws(() => stopSpeedFor(10, Infinity), /deceleration/);
});

test("with no available deceleration even unbounded room produces zero stopping speed", () => {
  assert.equal(stopSpeedFor(Infinity, 0), 0);
});

test("a finite stopping speed survives overflow or underflow of its square", () => {
  assert.ok(Math.abs(stopSpeedFor(2, 1e308) / 2e154 - 1) < 1e-12);
  assert.ok(Math.abs(stopSpeedFor(1e-200, 2e-200) / 2e-200 - 1) < 1e-12);
});

test("curve profile rejects invalid route geometry and progress", () => {
  assert.throws(() => curveProfileSpeed(null, 0), /route geometry/);
  assert.throws(() => curveProfileSpeed({ ...route, length: Infinity }, 0), /route geometry/);
  assert.throws(() => curveProfileSpeed(route, NaN), /route position/);
});

test("curve profiles ignore negative or unavailable samples and prefer the earliest equal limit", () => {
  const capped = { ...route, curveSpeedAt: (_s, at) => (at === 0 ? -3 : at === 3 ? NaN : at === 6 ? 5 : Infinity) };
  assert.equal(curveProfileSpeed(capped, 0).at, 6);
  const tiny = { ...route, curveSpeedAt: () => 1e-200 };
  assert.equal(curveProfileSpeed(tiny, 0).at, 0);
  assert.equal(curveProfileSpeed(tiny, 0).v, 1e-200);
});

test("curve profile keeps a large usable speed even when squaring it would overflow", () => {
  assert.equal(curveProfileSpeed({ ...route, curveSpeedAt: () => 1e200 }, 0).v, 1e200);
});

test("curve profile samples the 60 m horizon inclusively in 3 m increments", () => {
  const positions = [];
  const track = {
    ...route,
    curveSpeedAt(_s, d) {
      positions.push(d);
      return Infinity;
    },
  };
  curveProfileSpeed(track, 7);
  assert.equal(positions.join(","), "0,3,6,9,12,15,18,21,24,27,30,33,36,39,42,45,48,51,54,57,60");
});

test("curve profile passes the weather-adjusted lateral acceleration to the route", () => {
  setWeather("snow");
  try {
    const track = {
      ...route,
      curveSpeedAt(_s, _d, lat) {
        assert.equal(lat, comfort().lat);
        return 4;
      },
    };
    assert.equal(curveProfileSpeed(track, 0).v, 4);
  } finally {
    setWeather("dry");
  }
});

test("lateral targets validate position, requested offset, and reported route frame motion", () => {
  assert.throws(() => lateralAt(lane, Infinity), /route position/);
  assert.throws(() => lateralAt({ ...lane, offset: "2" }, 1), /target offset/);
  assert.throws(() => lateralAt(lane, 1, { frameMove: () => Infinity }), /frame shift/);
});

test("overflow in the lane position and shift origin reports which expression failed", () => {
  const offset = Number.MAX_VALUE;
  assert.throws(() => lateralAt({ ...lane, offset }, 1, { frameMove: () => -offset }), /Lateral target exceeds/);
  assert.throws(
    () =>
      lateralAt({ ...lane, shift: { from: offset, start: 5, len: 3 } }, 1, {
        frameMove: (s0) => (s0 === 5 ? -offset : 0),
      }),
    /Lane-change origin exceeds/,
  );
});

test("lane-change starts are validated and zero-length changes snap at the start", () => {
  const shift = { start: 10, len: 0, from: 3 };
  assert.equal(lateralAt({ offset: 1, shift }, 9), 3);
  assert.equal(lateralAt({ offset: 1, shift }, 10), 1);
  assert.equal(lateralAt({ offset: 1, shift }, 11), 1);
  assert.throws(() => lateralAt({ shift: { ...shift, len: -1 } }, 11), /lane-change geometry/);
  assert.throws(() => lateralAt({ shift: { ...shift, start: NaN } }, 11), /lane-change geometry/);
});

test("lane-change easing survives a difference larger than the finite range", () => {
  const far = Number.MAX_VALUE;
  assert.equal(lateralAt({ offset: far, shift: { from: -far, start: 0, len: 2 } }, 1), 0);
});

test("a lane-change moves the source and target by their respective route-frame offsets", () => {
  const path = { frameMove: (s0, s) => (s - s0) / 4 };
  const law = { offset: 5, s0: 12, shift: { from: 0, start: 8, len: 8 } };
  assert.equal(lateralAt(law, 12, path), 2);
});

test("lane centre validates bad offsets and distinguishes arithmetic overflow", () => {
  assert.throws(() => laneCenterAt({ center: NaN }, 0), /centre offset/);
  assert.throws(() => laneCenterAt({ offset: -Number.MAX_VALUE, center: Number.MAX_VALUE }, 0), /exceeds/);
});

const detour = { from: 5, full: 9, back: 13, to: 17, shift: -2 };

test("detour preserves neutral endpoints, symmetric ramps, and the signed plateau", () => {
  assert.equal([5, 7, 9, 11, 13, 15, 17].map((s) => detourAt(detour, s)).join(","), "0,-1,-2,-2,-2,-1,0");
});

test("a detour can have instantaneous entry and exit and still be neutral at the boundaries", () => {
  const abrupt = { ...detour, full: detour.from, back: detour.to };
  assert.equal(detourAt(abrupt, 5), 0);
  assert.equal(detourAt(abrupt, 5.001), -2);
  assert.equal(detourAt(abrupt, 16.999), -2);
  assert.equal(detourAt(abrupt, 17), 0);
});

test("detour geometry is rejected when the plateau points cross or the shift is invalid", () => {
  assert.throws(() => detourAt({ ...detour, back: 8 }, 9), /geometry/);
  assert.throws(() => detourAt({ ...detour, shift: Infinity }, 9), /geometry/);
  assert.throws(() => detourAt(detour, NaN), /route position/);
});

test("detour interpolation can divide a finite advance by an otherwise overflowing span", () => {
  const far = Number.MAX_VALUE;
  assert.equal(detourAt({ from: -far, full: far, back: far, to: far, shift: 2 }, 0), 1);
  assert.equal(detourAt({ from: -far, full: -far, back: -far, to: far, shift: 2 }, 0), 1);
});

test("lane law validation names an invalid target, route origin, stop, lag, or braking limit", () => {
  for (const [fields, message] of [
    [{ vTarget: "5" }, /target speed/],
    [{ s0: Infinity }, /starting route/],
    [{ stopAt: NaN }, /stop distance/],
    [{ stopAt: 20, stopReaction: -1 }, /reaction time/],
    [{ stopAt: 20, stopDecel: Infinity }, /stopping deceleration/],
  ]) {
    assert.throws(() => commands({ ...lane, ...fields }), message);
  }
});

test("lane law validation requires valid slow-zone entries", () => {
  assert.throws(() => commands({ ...lane, slowTo: {} }), /must be an array/);
  for (const slow of [null, { from: 20, to: 10, mps: 3 }, { from: 0, to: 10, mps: -1 }]) {
    assert.throws(() => commands({ ...lane, slowTo: [slow] }), /slow zone/);
  }
});

test("a lane law obeys overlapping slow zones and clears a cap after leaving its interval", () => {
  const law = {
    ...lane,
    slowTo: [
      { from: 2, to: 10, mps: 3 },
      { from: 8, to: 12, mps: 4 },
    ],
  };
  assert.equal(commands(law, 10).accel, -3);
  assert.equal(commands(law, 11).accel, -1.5);
  assert.equal(commands(law, 13).accel, 2.5);
});

test("stop reaction room makes braking begin sooner on a shared lane law", () => {
  const stop = { ...lane, stopAt: 20 };
  assert.ok(commands({ ...stop, stopReaction: 1.5 }).accel < commands(stop).accel);
});

test("steer-at-stop moves the pursuit point within half the remaining stopping room", () => {
  let last;
  const track = {
    ...route,
    offsetPointAt(s, offset) {
      last = s;
      return route.offsetPointAt(s, offset);
    },
  };
  commands({ ...lane, stopAt: 12, steerAtStop: true }, 10, car(), track);
  assert.equal(last, 11);
  commands({ ...lane, stopAt: 12 }, 10, car(), track);
  assert.equal(last, 14);
});

test("steer-at-stop keeps a metre of geometric sight after the stop point", () => {
  assert.ok(Number.isFinite(commands({ ...lane, offset: 1, stopAt: 9, steerAtStop: true }).steer));
  assert.equal(commands({ ...lane, stopAt: 9, steerAtStop: true }).accel, -7);
});

test("the weather quick cap and the local grip hook are separate inputs", () => {
  const prior = ROAD.gripAt;
  ROAD.gripAt = () => 0.1;
  try {
    setWeather("rain");
    assert.equal(comfort().hardDecel, 0.55 * 9.81 * 0.8);
    assert.equal(ROAD.gripAt(0, 0), 0.1);
  } finally {
    ROAD.gripAt = prior;
    setWeather("dry");
  }
});

test("speed control rejects non-record option arguments", () => {
  for (const options of [10, null, []]) assert.throws(() => speedControl(5, 4, options), /options must be an object/);
});

test("standalone lateral and centre sampling reject missing law records", () => {
  assert.throws(() => lateralAt(undefined, 5), /Lateral law/);
  assert.throws(() => laneCenterAt(null, 5), /Lateral law/);
});

test("an invalid frame hook diagnoses the route property", () => {
  assert.throws(() => lateralAt(lane, 2, { frameMove: 3 }), /frameMove must be/);
});

test("a zero returned by the route leaves a positive-zero curve speed", () => {
  const profile = curveProfileSpeed({ ...route, curveSpeedAt: () => -0 }, 0);
  assert.equal(profile.v, 0);
});

test("lane control honours an explicit zero stop deceleration", () => {
  assert.equal(commands({ ...lane, stopAt: 50, stopDecel: 0 }).accel, -7);
  assert.equal(commands({ ...lane, stopAt: 50 }).accel, 2.5);
});

test("firm stops may use more of the grip available than comfortable stops", () => {
  const stop = { ...lane, stopAt: 14, stopDecel: 6 };
  assert.ok(commands({ ...stop, stopFirm: true }).accel > commands(stop).accel);
});

test("without a stop, steer-at-stop does not shorten the normal pursuit", () => {
  let last;
  const track = {
    ...route,
    offsetPointAt(s, offset) {
      last = s;
      return route.offsetPointAt(s, offset);
    },
  };
  commands({ ...lane, steerAtStop: true }, 10, car(), track);
  assert.equal(last, 14);
});

test("hard braking on a route still steers toward its offset line", () => {
  const braking = commands({ kind: "hard_brake", offset: 2 });
  assert.ok(braking.steer < 0);
  assert.equal(braking.accel, -comfort().hardDecel);
});

test("fixed-steer laws use the proportional command without consulting route geometry", () => {
  const steer = commands({ kind: "steer", steer: 0.2, vTarget: 4 }, 10, car(), null);
  assert.equal(steer.steer, 0.2);
  assert.equal(steer.accel, -1.5);
});

test("a zero speed limit from the curve profile forces the lane command to brake", () => {
  const track = { ...route, curveSpeedAt: () => 0 };
  assert.equal(commands(lane, 10, car(), track).accel, -7);
});

test("either pedal can be independently disabled without disabling the other pedal", () => {
  assert.equal(speedControl(5, 8, { maxAccel: 0 }), 0);
  assert.equal(speedControl(5, 3, { maxAccel: 0 }), -3);
  assert.equal(Math.abs(speedControl(5, 3, { maxBrake: 0 })), 0);
  assert.equal(speedControl(5, 8, { maxBrake: 0 }), 2.5);
});

test("recovery accepts a lightweight vehicle pose using the default wheelbase", () => {
  const pose = { x: 5, y: 10, psi: 0 };
  assert.equal(steerToward(pose, [5, 12]), Math.atan2(2 * CAR.wheelbase, 2));
});
