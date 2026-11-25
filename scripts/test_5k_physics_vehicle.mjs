import assert from "node:assert/strict";
import { test } from "node:test";
import { BIKE, CAR, HERITAGE_STREETCAR, ROAD, Vehicle, comfort, wrapHeading } from "../static/js/sim/vehicle.js";

const DT = 1 / 60;
const motion = ["x", "y", "psi", "v", "delta", "a", "vy", "r", "ax", "latAccel", "slipping"];

function assertMotion(actual, expected) {
  for (const key of motion) assert.equal(actual[key], expected[key], key);
}

function withRoad(settings, work) {
  const original = { ...ROAD };
  Object.assign(ROAD, settings);
  try {
    work();
  } finally {
    Object.assign(ROAD, original);
  }
}

test("a zero-duration probe does not inspect its command or touch the surface hook", () => {
  const car = new Vehicle(0, 0, 0, 8);
  withRoad({ gripAt: () => assert.fail("sampled grip at zero dt") }, () => car.step(0, null));
  assert.equal(car.v, 8);
});

test("a positive-duration tick rejects a non-record command", () => {
  for (const input of [null, 2, "brake", []]) assert.throws(() => new Vehicle().step(DT, input), /command must be/);
});

test("only an explicit boolean can enable reverse", () => {
  const car = new Vehicle();
  for (const reverse of ["false", 1, null]) assert.throws(() => car.step(DT, { reverse, accel: -2 }), /reverse/);
  assert.equal(car.v, 0);
});

for (const [fields, message] of [
  [["a", "delta"], "actuator state"],
  [["vy", "r"], "lateral motion"],
  [["ax", "latAccel"], "load-transfer acceleration"],
]) {
  test(`reject contaminated ${message} before changing the finite components`, () => {
    for (const field of fields) {
      const car = new Vehicle(3, 4, 0.1, 8);
      car[field] = NaN;
      const before = car.clone();
      assert.throws(() => car.step(DT, { accel: 3, steer: 0.2 }), new RegExp(message));
      assertMotion(car, before);
    }
  });
}

test("global friction corruption fails explicitly for both integration and speed planning", () => {
  for (const mu of [-0.1, NaN, Infinity, "0.9"]) {
    withRoad({ mu }, () => {
      assert.throws(() => new Vehicle().step(DT), /ROAD.mu/);
      assert.throws(comfort, /ROAD.mu/);
    });
  }
});

test("a non-function local grip hook fails before either actuator moves", () => {
  withRoad({ gripAt: 3 }, () => {
    const car = new Vehicle();
    const before = car.clone();
    assert.throws(() => car.step(DT, { steer: 0.4, accel: 2 }), /ROAD.gripAt/);
    assertMotion(car, before);
  });
});

test("a failed grip sample in the second dynamic substep rolls back the first one", () => {
  let samples = 0;
  const car = new Vehicle(2, 6, 0.2, 8);
  car.vy = 0.2;
  car.r = 0.1;
  car.ax = -0.2;
  car.latAccel = 0.3;
  car.slipping = 0.12;
  const before = car.clone();
  withRoad(
    {
      gripAt() {
        if (++samples === 3) throw new Error("unavailable surface");
        return 0.55;
      },
    },
    () => assert.throws(() => car.step(0.03, { steer: 0.3, accel: -2 }), /unavailable surface/),
  );
  assert.equal(samples, 3);
  assertMotion(car, before);
  const command = { steer: 0.25, accel: 1 };
  car.step(DT, command);
  before.step(DT, command);
  assertMotion(car, before);
});

test("overflowing the integrated pose fails and preserves all motion fields", () => {
  const spec = { ...CAR, mass: 0, power: 0, cgToFront: undefined };
  const car = new Vehicle(Number.MAX_VALUE, 0, 0, Number.MAX_VALUE, spec);
  const before = car.clone();
  assert.throws(() => car.step(1), /produced non-finite/);
  assertMotion(car, before);
});

test("a near-frictionless straight has no lateral Fiala force and does not poison the pose", () => {
  const car = new Vehicle(0, 0, 0, 10);
  withRoad({ mu: 1e-180 }, () => car.step(DT, { accel: 1 }));
  assert.equal(car.v, 10);
  assert.equal(car.r, 0);
  assert.equal(car.latAccel, 0);
  assert.ok(car.x > 0);
});

test("each dynamic axle samples its own contact position before the substep", () => {
  const car = new Vehicle(20, 30, Math.PI / 2, 10);
  const calls = [];
  withRoad(
    {
      gripAt(x, y, spec) {
        calls.push({ x, y, kind: spec.kind });
        return null;
      },
    },
    () => car.step(0.01),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].x, 20);
  assert.equal(calls[0].y, 30 + CAR.wheelbase);
  assert.equal(calls[0].kind, "car");
  assert.equal(calls[1].x, 20);
  assert.equal(calls[1].y, 30);
});

test("the 3 m/s boundary samples grip for every dynamic substep and only once below it", () => {
  let calls = 0;
  withRoad(
    {
      gripAt() {
        calls++;
        return null;
      },
    },
    () => {
      new Vehicle(0, 0, 0, 2.999).step(0.03);
      assert.equal(calls, 2);
      calls = 0;
      new Vehicle(0, 0, 0, 3).step(0.03);
      assert.equal(calls, 6);
    },
  );
});

test("the lighter axle limits low-speed motion on split friction", () => {
  const car = new Vehicle(0, 0, 0, 2);
  withRoad({ gripAt: (x) => (x > 1 ? 0.1 : 0.7) }, () => car.step(0.1, { accel: -7 }));
  assert.equal(car.ax, -0.1 * 9.81);
});

test("steering actuators limit a step by radians per second even when the target saturates", () => {
  const car = new Vehicle();
  car.step(0.01, { steer: 20 });
  assert.equal(car.delta, CAR.steerRate * 0.01);
});

test("jerk limits commanded acceleration before tyre grip is applied", () => {
  const car = new Vehicle();
  const spec = { ...CAR, accelLag: 0.001 };
  car.spec = spec;
  car.step(0.02, { accel: CAR.maxAccel });
  assert.equal(car.a, CAR.jerkMax * 0.02);
});

test("the actuator supports zero lag and a zero steering limit", () => {
  const car = new Vehicle(0, 0, 0, 0, { ...CAR, accelLag: 0, maxSteer: 0 });
  car.step(0.1, { accel: 0.5, steer: 1 });
  assert.equal(car.a, 0.5);
  assert.equal(car.delta, 0);
});

test("zero command sheds speed through the rolling drag path", () => {
  const car = new Vehicle(0, 0, 0, 2);
  car.step(DT);
  assert.ok(car.v < 2 && car.ax < 0);
});

test("power divided by speed can turn positive throttle into a drag-limited net demand", () => {
  const spec = { ...CAR, power: 10 };
  const car = new Vehicle(0, 0, 0, 20, spec);
  car.step(DT, { accel: 3 });
  assert.ok(car.a < 0 && car.v < 20);
});

test("braking a reversing car to a stop cannot immediately propel it forward", () => {
  const car = new Vehicle(0, 0, 0, -0.01);
  car.a = 2;
  car.step(DT, { accel: 2, reverse: true });
  assert.equal(car.v, 0);
});

test("reverse speed is capped by the selected vehicle's reverse limit", () => {
  const car = new Vehicle(0, 0, 0, -CAR.maxReverse);
  car.step(DT, { accel: -3, reverse: true });
  assert.equal(car.v, -CAR.maxReverse);
});

test("below the sideslip display threshold the getter reports zero", () => {
  const car = new Vehicle(0, 0, 0, -0.5);
  car.vy = 0.4;
  assert.equal(car.beta, 0);
  car.v = -2;
  assert.equal(car.beta, Math.atan2(0.4, 2));
});

test("heading wrapping uses the interval open at minus pi", () => {
  assert.equal(wrapHeading(Math.PI), Math.PI);
  assert.equal(wrapHeading(-Math.PI), Math.PI);
  const car = new Vehicle(0, 0, 29 * Math.PI);
  car.step(DT);
  assert.ok(Math.abs(Math.abs(car.psi) - Math.PI) < 1e-13);
  assert.ok(car.psi > -Math.PI && car.psi <= Math.PI);
});

test("built-in specs are read-only and accept a non-steering rail axle", () => {
  assert.equal(Object.isFrozen(CAR), true);
  assert.equal(Object.isFrozen(BIKE), true);
  const rail = new Vehicle(0, 0, 0, 4, HERITAGE_STREETCAR);
  rail.step(DT, { steer: 1 });
  assert.equal(rail.delta, 0);
});

test("mutating an editable spec exposes the new invalid field on the next tick", () => {
  const spec = { ...CAR };
  const car = new Vehicle(0, 0, 0, 10, spec);
  car.step(DT);
  spec.wheelbase = 0;
  const before = car.clone();
  assert.throws(() => car.step(DT), /wheelbase/);
  assertMotion(car, before);
});

test("a frozen accessor-based spec still has its values checked each tick", () => {
  let track = CAR.track;
  const spec = Object.freeze({
    ...CAR,
    get track() {
      return track;
    },
  });
  const car = new Vehicle(0, 0, 0, 10, spec);
  car.step(DT);
  track = 0;
  assert.throws(() => car.step(DT), /track/);
});

test("a null or array specification fails at the motion boundary", () => {
  for (const spec of [null, [], "car"]) assert.throws(() => new Vehicle(0, 0, 0, 8, spec).step(DT), /spec must be/);
});

for (const [field, value] of [
  ["wheelbase", 0],
  ["maxSteer", Math.PI / 2],
  ["steerRate", -1],
  ["maxAccel", -1],
  ["maxBrake", -1],
  ["maxSpeed", Infinity],
  ["maxReverse", -1],
  ["accelLag", -1],
  ["jerkMax", NaN],
  ["mass", NaN],
  ["cgToFront", CAR.wheelbase],
  ["yawInertia", 0],
  ["track", 0],
  ["cgHeight", -1],
  ["frontStiffness", -1],
  ["rearStiffness", -1],
  ["brakeFront", 1.01],
  ["driveFront", -0.01],
  ["rollFront", Infinity],
  ["power", -1],
  ["cdA", -1],
  ["crr", -1],
]) {
  test(`reject invalid physical specification: ${field}`, () => {
    const car = new Vehicle(0, 0, 0, 10, { ...CAR, [field]: value });
    assert.throws(() => car.step(DT, { accel: 1 }), new RegExp(field));
    assert.equal(car.v, 10);
  });
}

test("allocating power to a massless spec is rejected instead of dividing by zero", () => {
  const bike = new Vehicle(0, 0, 0, 10, { ...BIKE, power: 20 });
  assert.throws(() => bike.step(DT, { accel: 1 }), /positive mass/);
});

test("a massless spec may use a defined rear-axle-to-CG distance without a yaw inertia", () => {
  const bike = new Vehicle(0, 0, 0, 5, { ...BIKE, cgToFront: 0.2 });
  bike.step(DT, { steer: 0.1 });
  assert.equal(bike.vy, (BIKE.wheelbase - 0.2) * bike.r);
  bike.spec.cgToFront = -0.1;
  assert.throws(() => bike.step(DT), /cgToFront/);
});

test("a zero-slip Fiala calculation tolerates overflow in expanded stiffness terms", () => {
  const car = new Vehicle(0, 0, 0, 10, { ...CAR, frontStiffness: 1e130, rearStiffness: 1e130 });
  car.step(DT);
  assert.equal(car.r, 0);
  assert.equal(Math.abs(car.latAccel), 0);
  assert.ok(car.x > 0);
});

test("collision footprint rejects an invalid body length separately from overhang", () => {
  const short = new Vehicle(0, 0, 0, 0, { ...CAR, length: 0 });
  const long = new Vehicle(0, 0, 0, 0, { ...CAR, rearOverhang: CAR.length + 1 });
  assert.throws(() => short.obb(), /body length/);
  assert.throws(() => long.front, /rear overhang/);
});

test("both footprint views reject an invalid lateral body dimension", () => {
  const car = new Vehicle(0, 0, 0, 0, { ...CAR, width: NaN });
  assert.throws(() => car.obb(), /body width/);
  assert.throws(() => car.corners(), /body width/);
});

test("front projections validate heading before trigonometry and fail on coordinate overflow", () => {
  const far = new Vehicle(Number.MAX_VALUE, 10, 0, 0, { ...CAR, length: 1e307 });
  assert.throws(() => far.front, /projected vehicle position/);
  far.psi = "0";
  assert.throws(() => far.front, /heading/);
});

test("body corners may exceed the range even when their body centre is finite", () => {
  const car = new Vehicle(Number.MAX_VALUE, 0, 0, 0, { ...CAR, length: 1e307, rearOverhang: 5e306 });
  assert.equal(car.center[0], Number.MAX_VALUE);
  assert.throws(() => car.corners(), /corner exceeds/);
});

test("vehicle-local projection names invalid input, source pose, and overflowing result", () => {
  assert.throws(() => new Vehicle().toLocal("3", 2), /point for vehicle-local/);
  assert.throws(() => new Vehicle(0, 0, NaN).toLocal(3, 2), /pose for vehicle-local/);
  assert.throws(() => new Vehicle(-Number.MAX_VALUE).toLocal(Number.MAX_VALUE, 2), /Invalid vehicle-local/);
});

test("body coordinates share a rear-axle origin even for a custom short-overhang actor", () => {
  const car = new Vehicle(3, 4, Math.PI / 2, 0, { ...CAR, length: 6, rearOverhang: 1 });
  const front = car.toLocal(...car.front);
  const centre = car.toLocal(...car.center);
  assert.equal(front.ahead, 5);
  assert.equal(centre.ahead, 2);
  assert.ok(Math.abs(front.right) < 1e-14);
});

test("vehicle-local lateral direction is clockwise from the heading", () => {
  const car = new Vehicle(10, 10, Math.PI / 2);
  const local = car.toLocal(12, 13);
  assert.equal(local.ahead, 3);
  assert.ok(Math.abs(local.right - 2) < 1e-14);
});

test("dynamic substeps tolerate roundoff at a whole substep boundary", () => {
  let samples = 0;
  withRoad(
    {
      gripAt() {
        samples++;
        return null;
      },
    },
    () => {
      new Vehicle(0, 0, 0, 10).step(0.03 + 5e-12);
      assert.equal(samples, 6);
      samples = 0;
      new Vehicle(0, 0, 0, 10).step(0.03 + 5e-10);
      assert.equal(samples, 8);
    },
  );
});

test("a forward-only bicycle clamps the reverse velocity to zero", () => {
  const bike = new Vehicle(0, 0, 0, 0, BIKE);
  bike.step(0.1, { accel: -2, reverse: true });
  assert.equal(Math.abs(bike.v), 0);
  assert.equal(bike.x, 0);
});

test("the curved low-speed path applies a lateral traction bound", () => {
  const bike = new Vehicle(0, 0, 0, 5, BIKE);
  withRoad({ mu: 0.12 }, () => bike.step(0.1, { steer: BIKE.maxSteer }));
  assert.ok(bike.psi > 0);
  assert.ok(bike.latAccel <= 0.12 * 9.81);
  assert.ok(bike.latAccel > 1);
});

test("dry comfort remains a ceiling on a grippier surface", () => {
  const dry = comfort();
  withRoad({ mu: 1.6 }, () => {
    assert.equal(comfort().lat, dry.lat);
    assert.equal(comfort().decel, dry.decel);
    assert.equal(comfort().hardDecel, dry.hardDecel);
  });
});

test("comfort floors lateral and stopping targets while hard braking remains grip limited", () => {
  withRoad({ mu: 0.01 }, () => {
    assert.equal(comfort().lat, 2.2 * 0.35);
    assert.equal(comfort().decel, 2.5 * 0.35);
    assert.equal(comfort().hardDecel, 0.01 * 9.81 * 0.8);
  });
});
