// node --experimental-default-type=module scripts/test_vehicle_models.mjs
import assert from 'node:assert/strict';
globalThis.document = { querySelector: () => null };
const { Vehicle, CAR, ROAD } = await import('../static/js/sim/vehicle.js');
const { VEHICLE_MODELS, getVehicleModel, vehicleOptions, PAINT_COLORS } = await import('../static/js/sim/vehicle-models.js');
const { World } = await import('../static/js/sim/world.js');
const { Route } = await import('../static/js/map/route.js');
const { setWeather } = await import('../static/js/sim/weather.js');
const { speedControl, purePursuit, steerToward } = await import('../static/js/sim/controller.js');
const { buildSnapshot } = await import('../static/js/brain/sensors.js');
const { sampleCandidates, simulateAll } = await import('../static/js/brain/candidates.js');
const { safetyBrake } = await import('../static/js/brain/safety.js');
const { fixtureWorld, crossingPedestrian } = await import('../static/tests/jev-fixtures.js');

let passed = 0;
const test = (name, fn) => { setWeather('dry'); fn(); passed++; console.log(`✓ ${name}`); };
const close = (actual, expected, tolerance = 1e-9) => assert(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
const front = spec => spec.length - spec.rearOverhang;
const compact = getVehicleModel('compact'), pickup = getVehicleModel('pickup');
const keys = ['x', 'y', 'psi', 'v', 'delta', 'a', 'vy', 'r', 'ax', 'latAccel'];
function worldFor(model, speed = 5, weather = 'dry') {
  const world = fixtureWorld({ weather });
  world.ego = new Vehicle(20, 0, 0, speed, model.spec);
  return world;
}
function leadAt(world, x, spec = CAR, speed = 0) {
  const lead = new Vehicle(x, 0, 0, speed, spec); lead.id = 'lead'; world.npcs.push(lead); return lead;
}
function stopLine(world, s = 42) {
  world.route.controls = [{ edge: 'street', sRoute: s, control: { id: 'stop', type: 'stop', all_way: true }, junction: [s, 0] }];
}
function drive(model, { speed = 0, steer = 0, seconds = 8, accel = model.spec.maxAccel, target = null } = {}) {
  const car = new Vehicle(0, 0, 0, speed, model.spec);
  let peakLat = 0, peakBeta = 0, peakSlip = 0;
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    car.step(1 / 120, { steer, accel: target === null ? accel : speedControl(car.v, target) });
    assert(keys.every(key => Number.isFinite(car[key])), `${model.id}: non-finite ${JSON.stringify(car)}`);
    peakLat = Math.max(peakLat, Math.abs(car.latAccel)); peakBeta = Math.max(peakBeta, Math.abs(car.beta)); peakSlip = Math.max(peakSlip, car.slipping);
  }
  return { car, peakLat, peakBeta, peakSlip };
}

try {
  test('six immutable model specifications retain a sedan fallback and validated paint', () => {
    assert.deepEqual(VEHICLE_MODELS.map(m => m.id), ['compact', 'sedan', 'sport', 'wagon', 'suv', 'pickup']);
    assert(VEHICLE_MODELS.every(m => Object.isFrozen(m) && Object.isFrozen(m.spec)));
    assert.equal(getVehicleModel('unknown').id, 'sedan');
    for (const color of PAINT_COLORS) assert.equal(vehicleOptions(new URLSearchParams({ car: 'pickup', paint: color.toUpperCase() })).paint, color);
    assert.equal(vehicleOptions(new URLSearchParams({ car: 'missing', paint: 'javascript:bad' })).paint, '1f5fd6');
  });
  for (const model of VEHICLE_MODELS) {
    test(`${model.name}: rotated footprint, corners and front bumper use its own dimensions`, () => {
      const car = new Vehicle(12, -3, Math.PI / 3, 7, model.spec), box = car.obb();
      close(box.halfLength * 2, model.spec.length); close(box.halfWidth * 2, model.spec.width);
      const corners = car.corners().map(([x, y]) => car.toLocal(x, y));
      close(Math.min(...corners.map(p => p.ahead)), -model.spec.rearOverhang);
      close(Math.max(...corners.map(p => p.ahead)), front(model.spec));
      close(Math.max(...corners.map(p => p.right)) - Math.min(...corners.map(p => p.right)), model.spec.width);
      const nose = car.toLocal(...car.front); close(nose.ahead, front(model.spec)); close(nose.right, 0);
    });
  }
  test('cloning preserves model and dynamic state while simulations evolve independently', () => {
    for (const model of VEHICLE_MODELS) {
      const car = drive(model, { speed: 8, target: 8, steer: 0.035, seconds: 1 }).car, clone = car.clone();
      assert.equal(clone.spec, model.spec);
      for (const key of keys) close(clone[key], car[key]);
      const command = { steer: 0.04, accel: 0.7 };
      car.step(1 / 60, command); clone.step(1 / 60, command);
      for (const key of keys) close(clone[key], car[key]);
      clone.x += 100; assert.notEqual(clone.x, car.x);
    }
  });
  test('sport powertrain accelerates measurably faster than sedan and pickup', () => {
    const sport = drive(getVehicleModel('sport')).car, sedan = drive(getVehicleModel('sedan')).car, truck = drive(pickup).car;
    assert(sport.v > sedan.v + 5 && sport.x > sedan.x + 20);
    assert(sport.v > truck.v + 5 && sport.x > truck.x + 20);
    assert(truck.v <= pickup.spec.maxSpeed && sport.v <= getVehicleModel('sport').spec.maxSpeed);
  });
  test('all six models remain stable in ordinary dry and wet turns', () => {
    for (const weather of ['dry', 'rain']) {
      setWeather(weather);
      for (const model of VEHICLE_MODELS) {
        const { car, peakBeta, peakLat } = drive(model, { speed: 10, target: 10, steer: 3 * Math.PI / 180 });
        assert(car.r > 0 && car.v > 9 && car.v < 11, `${model.id}/${weather}: unstable turn`);
        assert(peakBeta < 12 * Math.PI / 180, `${model.id}/${weather}: excessive sideslip`);
        assert(peakLat < ROAD.mu * 9.81 * 1.1, `${model.id}/${weather}: exceeds surface grip`);
      }
    }
  });
  test('wet grip limits every model during an aggressive fast turn', () => {
    for (const model of VEHICLE_MODELS) {
      setWeather('dry'); const dry = drive(model, { speed: 20, target: 20, steer: 10 * Math.PI / 180, seconds: 3 });
      setWeather('rain'); const wet = drive(model, { speed: 20, target: 20, steer: 10 * Math.PI / 180, seconds: 3 });
      assert(wet.peakLat < dry.peakLat, `${model.id}: wet turn must have lower available grip`);
      assert(wet.peakSlip > 0 && wet.peakLat < ROAD.mu * 9.81 * 1.1);
    }
  });
  test('world spawn and reset keep the selected vehicle specification', () => {
    const seedWorld = fixtureWorld(), world = new World(seedWorld.map, { parked: 0, pedestrians: 0, vehicleSpec: pickup.spec });
    assert.equal(world.ego.spec, pickup.spec); world.ego.v = 10; world.resetToLane();
    assert.equal(world.ego.spec, pickup.spec); close(world.ego.v, 0); close(world.ego.obb().halfLength, pickup.spec.length / 2);
  });
  test('steering laws use selected wheelbase for identical route and recovery geometry', () => {
    const small = worldFor(compact), large = worldFor(pickup);
    small.ego.y = large.ego.y = 2;
    assert(Math.abs(purePursuit(large.ego, large.route, 20)) > Math.abs(purePursuit(small.ego, small.route, 20)));
    assert(Math.abs(steerToward(large.ego, [40, 5])) > Math.abs(steerToward(small.ego, [40, 5])));
  });
  test('stop-line sensing and stop candidates account for the longer pickup nose', () => {
    const snapshots = [];
    for (const model of [compact, pickup]) {
      const world = worldFor(model); stopLine(world);
      const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world), stop = candidates.find(c => c.id === 'stop_at_line');
      close(snap.intersection.bumper_to_line_m, 42 - world.ego.front[0]);
      close(stop.law.stopAtRoute + front(model.spec), 41.5);
      simulateAll([stop], snap, world);
      assert.equal(stop.sim.collision, null);
      assert.equal(stop.eligible, !stop.sim.crosses_stop_line);
      if (stop.sim.crosses_stop_line) assert.equal(stop.reject, 'runs_stop');
      snapshots.push(snap);
    }
    close(snapshots[0].intersection.bumper_to_line_m - snapshots[1].intersection.bumper_to_line_m, front(pickup.spec) - front(compact.spec));
  });
  test('stop-line prediction rejects the longer nose before the hatch reaches the line', () => {
    const results = [];
    for (const model of [compact, pickup]) {
      const world = worldFor(model, 3); stopLine(world, 32.8);
      const snap = buildSnapshot(world), candidate = { id: 'coast', law: { kind: 'lane', offset: 0, vTarget: 3 } };
      simulateAll([candidate], snap, world); results.push(candidate);
    }
    assert.equal(results[0].sim.crosses_stop_line, false); assert.equal(results[0].eligible, true);
    assert.equal(results[1].sim.crosses_stop_line, true); assert.equal(results[1].reject, 'runs_stop');
  });
  test('lead and rear-following gaps use both vehicles actual bumper positions', () => {
    for (const model of [compact, pickup]) {
      const world = worldFor(model), lead = leadAt(world, 45, pickup.spec), rear = leadAt(world, 10, compact.spec, 7);
      const snap = buildSnapshot(world);
      close(snap.following.gap_m, lead.x - lead.spec.rearOverhang - world.ego.front[0]);
      close(snap.rear_follower.gap_m, world.ego.x - world.ego.spec.rearOverhang - rear.front[0]);
    }
  });
  test('queued stopping candidates leave the same bumper clearance with either model', () => {
    for (const model of [compact, pickup]) {
      const world = worldFor(model); stopLine(world, 80); const lead = leadAt(world, 40, pickup.spec);
      const snap = buildSnapshot(world), stop = sampleCandidates(snap, world).find(c => c.id === 'stop_at_line');
      close(lead.x - lead.spec.rearOverhang - (stop.law.stopAtRoute + front(model.spec)), 2.5);
    }
  });
  test('pedestrian stopping candidates leave a model-independent two-metre nose clearance', () => {
    for (const model of [compact, pickup]) {
      const world = worldFor(model); world.crowd.list = [crossingPedestrian(44)];
      const snap = buildSnapshot(world), stop = sampleCandidates(snap, world).find(c => c.id === 'stop_for_pedestrian');
      assert(stop); close(stop.law.stopAtRoute + front(model.spec), snap.pedestrian.s_route - 2);
    }
  });
  test('forward prediction uses selected footprints: pickup collides where compact clears', () => {
    const results = [];
    for (const model of [compact, pickup]) {
      const world = worldFor(model, 0); leadAt(world, 5 + world.ego.x, CAR, 0);
      const snap = buildSnapshot(world), candidate = { id: 'hold', law: { kind: 'lane', offset: 0, vTarget: 0 } };
      simulateAll([candidate], snap, world); results.push(candidate);
    }
    assert.equal(results[0].sim.collision, null); assert.equal(results[0].eligible, true);
    assert.equal(results[1].sim.collision?.id, 'lead'); assert.equal(results[1].reject, 'collision');
  });
  test('standstill safety holds the pickup at a gap that the shorter hatch can use', () => {
    const results = [];
    for (const model of [compact, pickup]) {
      const world = worldFor(model, 0); leadAt(world, world.ego.x + 6.9);
      results.push(safetyBrake(world, buildSnapshot(world), null));
    }
    assert.equal(results[0], null); assert.equal(results[1]?.hold, true);
  });
  test('limited visibility accounts for selected nose length', () => {
    const small = buildSnapshot(worldFor(compact, 5, 'fog')), large = buildSnapshot(worldFor(pickup, 5, 'fog'));
    assert(large.visibility.safe_speed_mps < small.visibility.safe_speed_mps);
  });
  test('goal-edge route control filtering respects the selected bumper reach', () => {
    const world = fixtureWorld(), edge = world.map.edges.get('street');
    edge.control = { id: 'near-goal', type: 'stop', s_line: 104.05 };
    const data = { id: 'near-goal', polyline: [[0, 0], [100, 0]], edges: ['street'], turns: [], goal_s: 100 };
    const small = new Route(data, world.map, compact.spec), large = new Route(data, world.map, pickup.spec);
    assert.equal(small.controls.length, 0); assert.equal(large.controls.length, 1);
    close(large.controls[0].sRoute, 104.05); // Keep the line beyond the truncated endpoint.
  });
  console.log(`${passed} vehicle model regression tests passed`);
} finally { setWeather('dry'); }
