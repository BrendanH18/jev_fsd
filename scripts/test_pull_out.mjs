// Cars pulling out of a parking spot, and a destination with a car parked across it. A pull-out
// boxed in by the car parked in front cannot move off when its gap check passes; it must look
// again before it moves, not cut in front of a car that has come up meanwhile. Near the
// destination, a car that cannot get any closer because something parked is in the way has
// arrived; one held up by traffic has not.
// node --experimental-default-type=module scripts/test_pull_out.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { Autopilot, goalBlocker } = await import("../static/js/brain/brain.js");

// One lane eastbound (+x) with a parking lane on its right (-y).
const LENGTH = 400, CURB_Y = -3.05;
const edge = { id: "main", from: "a", to: "b", pts: [[0, 0], [LENGTH, 0]], length: LENGTH, lanes: 1, lane_width: 3.5,
  lane_offsets: [0], asphalt: [-2, 4.2], parking: [0, 2.2], cls: "residential", limit: 11.2, oneway: true, name: "Curb Street" };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -60, LENGTH + 20, 60], edges: [edge],
  lanes: [{ edge: "main", idx: 0, pts: [[0, 0], [LENGTH, 0]] }],
  nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: LENGTH, y: 0 }], intersections: [], stops: [], buildings: [] });

function parkedCar(world, id, x, y = CURB_Y) {
  const car = new Vehicle(x, y, 0, 0);
  Object.assign(car, { id, edge: "main", curb: "right" });
  world.parked.add(car);
  return car;
}

{
  // A car parked 1.2 m behind another signals and pulls out while the ego is 80 m back at 10 m/s,
  // just beyond its gap. Boxed in, it cannot move off for a few seconds, by which time the ego is
  // well inside that gap: it must wait for the ego to pass, then go.
  const world = new World(map, { parked: 0, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  const x = 150, front = x + CAR.length + 1.2;
  const leaving = parkedCar(world, "leaving", x);
  parkedCar(world, "in_front", front);
  Object.assign(world.ego, { x: x - 80, y: 0, psi: 0, v: 10 });
  const merging = fleet.startPullOut(leaving);
  assert.ok(merging, "the parked car starts to pull out");
  merging.pull.wait = 0.1;
  const dt = 1 / 60;
  let movedOffAt = null, cutIn = null;
  for (let i = 0; i < 30 / dt; i++) {
    world.ego.x += world.ego.v * dt;
    fleet.step(dt);
    world.t += dt;
    const behind = merging.x - world.ego.x;
    if (movedOffAt === null && merging.v > 0.3) movedOffAt = behind;
    if (!cutIn && merging.y > CURB_Y + 0.5 && behind > -2 && behind < 73) cutIn = { t: world.t, behind };
  }
  assert.equal(cutIn, null, `pulled into the lane ${cutIn?.behind.toFixed(1)} m in front of the ego at ${cutIn?.t.toFixed(1)} s`);
  assert.ok(movedOffAt !== null && movedOffAt < 0, `moved off once the ego had passed (ego ${(-movedOffAt)?.toFixed(1)} m ahead)`);
  assert.ok(Math.abs(merging.y) < 0.6 && !merging.pull, `merged into the lane (y=${merging.y.toFixed(2)})`);
  console.log(`✓ a boxed-in pull-out looks again before moving off and waits for the ego to pass (it moved off ${(-movedOffAt).toFixed(1)} m behind the ego)`);
}

{
  // With nobody coming, the same boxed-in car still gets out.
  const world = new World(map, { parked: 0, pedestrians: 0 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  const x = 150;
  const leaving = parkedCar(world, "leaving", x);
  parkedCar(world, "in_front", x + CAR.length + 1.2);
  Object.assign(world.ego, { x: 20, y: 0, psi: 0, v: 0 });
  const merging = fleet.startPullOut(leaving);
  const dt = 1 / 60;
  for (let i = 0; i < 15 / dt; i++) { fleet.step(dt); world.t += dt; }
  assert.ok(!merging.pull && merging.x > x + 10 && Math.abs(merging.y) < 0.6, `pulled out and away (x=${merging.x.toFixed(1)}, y=${merging.y.toFixed(2)})`);
  console.log("✓ with the street clear, a boxed-in car still pulls out");
}

{
  // However long the car in front holds it, a pull-out stays one (signalling, and checking for a
  // gap) until the car is moving: drivers who are slow to move off must not lose it at the curb.
  for (let seed = 1; seed <= 8; seed++) {
    const world = new World(map, { parked: 0, pedestrians: 0 });
    const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed });
    const x = 150;
    const leaving = parkedCar(world, "leaving", x);
    parkedCar(world, "in_front", x + CAR.length + 1.2);
    Object.assign(world.ego, { x: 20, y: 0, psi: 0, v: 0 });
    const merging = fleet.startPullOut(leaving);
    let movedOff = false;
    for (let i = 0; i < 15 * 60; i++) {
      fleet.step(1 / 60);
      world.t += 1 / 60;
      if (merging.v > 0.3) movedOff = true;
      assert.ok(merging.pull || movedOff, `seed ${seed}: the pull-out ended at ${world.t.toFixed(2)} s with the car still at the curb (v=${merging.v.toFixed(2)})`);
    }
    assert.ok(movedOff && !merging.pull, `seed ${seed}: pulled out`);
  }
  console.log("✓ a boxed-in car keeps signalling and checking for a gap until it is moving");
}

function drive(blocker) {
  const world = new World(map, { parked: 0, pedestrians: 0 });
  const goal = 300;
  const routeData = { id: "r", polyline: Array.from({ length: goal + 1 }, (_, i) => [i, 0]), edges: ["main"], turns: [], start_s: 0, goal_s: goal };
  Object.assign(world.ego, { x: goal - 70, y: 0, psi: 0, v: 8 });
  world.route = new Route(routeData, map);
  world.destination = [goal, 0];
  const fleet = { step() {} };
  world.npcs = [];
  blocker(world, goal);
  const autopilot = new Autopilot(world);
  const events = [];
  autopilot.onEvent = (e) => events.push({ t: world.t, ...e });
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  const dt = 1 / 30;
  for (let i = 0; i < 40 / dt && world.route; i++) stepWorld({ world, fleet, autopilot }, dt, world.t * 1000);
  return { world, events, remaining: world.destination ? world.route.remaining(world.route.project(world.ego.x, world.ego.y).s) : goal - world.ego.x };
}

{
  // A car parked half in the lane across the destination (as on Halifax's Chebucto Landing)
  const { world, events, remaining } = drive((world, goal) => parkedCar(world, "across", goal - 1, -1.2));
  const arrived = events.find((e) => e.type === "arrived");
  assert.ok(arrived, `arrived (events: ${events.map((e) => e.type).join(", ")})`);
  assert.equal(arrived.blocked_by, "across");
  assert.equal(world.violations.collisions, 0);
  assert.ok(remaining > 3.5 && remaining < 10, `stopped ${remaining.toFixed(1)} m short`);
  assert.equal(world.violations.deadlock_overrides, 0);
  console.log(`✓ a car parked across the destination: the car stops ${remaining.toFixed(1)} m short and has arrived`);
}

{
  // A stopped traffic car in the same place is not parked: it will move on, so the car waits
  const { world, events } = drive((world, goal) => {
    const car = new Vehicle(goal - 1, 0, 0, 0);
    car.id = "stalled";
    world.npcs.push(car);
  });
  assert.equal(events.some((e) => e.type === "arrived"), false);
  assert.ok(world.route, "still on its route");
  assert.equal(world.violations.collisions, 0);
  console.log("✓ held up near the destination by a stopped traffic car, the car waits and has not arrived");
}

{
  // Stopped 4 m from the end of the route but facing away from it, with a car parked in front: the
  // car is off its route, so a blocker found from there says nothing about the destination
  const world = new World(map, { parked: 0, pedestrians: 0 });
  parkedCar(world, "facing", 287, 0);
  Object.assign(world.ego, { x: 296, y: 0, psi: Math.PI, v: 0 });
  world.route = new Route({ id: "r", polyline: Array.from({ length: 301 }, (_, i) => [i, 0]), edges: ["main"], turns: [], start_s: 0, goal_s: 300 }, map);
  world.destination = [300, 0];
  world.npcs = [];
  const autopilot = new Autopilot(world);
  const events = [];
  autopilot.onEvent = (e) => events.push(e);
  autopilot.brainName = "rules";
  autopilot.setEnabled(true);
  autopilot.goalBlockedBy = "facing";
  autopilot.step(1 / 30, 0);
  assert.equal(autopilot.snap.onRoute, false);
  assert.ok(autopilot.snap.nav.remaining_m < 10);
  assert.equal(events.some((e) => e.type === "arrived"), false);
  assert.ok(world.route, "still has its route");
  console.log("✓ off its route near the end of it, a parked car in front does not count as arrival");
}

{
  // Nothing in the way: the ordinary arrival, with no blocker reported
  const { events, remaining } = drive(() => {});
  const arrived = events.find((e) => e.type === "arrived");
  assert.ok(arrived && arrived.blocked_by === undefined && remaining < 3.5);
  console.log("✓ with the destination clear the car arrives at it as before");
}

{
  // The decision behind a blocked destination, on the candidates themselves
  const world = new World(map, { parked: 0, pedestrians: 0 });
  parkedCar(world, "beyond", 307, 0);
  const hits = (id) => ({ id, t: 1, kind: "rear_end" });
  const lane = (id, progress, { collision = null, reject = null, lane = 0, center = 0, offset = center } = {}) =>
    ({ id, law: { kind: "lane", lane, center, offset, vTarget: 3 }, eligible: !reject && !collision, reject: reject || (collision ? "collision" : null),
      sim: { progress_m: progress, collision } });
  const stop = lane("keep_lane_stop", 0);
  assert.equal(goalBlocker([stop, lane("keep_lane_target", 6, { collision: hits("beyond") })], world), "beyond");
  // Stopped at a red light short of a clear destination: stopping there would get closer without
  // hitting anything, so the car waits for the green even though driving on past it would not.
  assert.equal(goalBlocker([stop, lane("stop_at_destination", 6.4, { reject: "runs_red" }), lane("keep_lane_limit", 9, { collision: hits("beyond") })], world), null);
  // In the lane beside the route's, a car parked ahead in that lane says nothing about the destination
  assert.equal(goalBlocker([lane("keep_lane_stop", 0, { lane: -1, center: -3.5 }), lane("keep_lane_target", 6, { lane: -1, center: -3.5, collision: hits("beyond") })], world), null);
  // A nudge around it does not count as a way on; traffic in the way does count against arrival
  assert.equal(goalBlocker([stop, lane("keep_lane_target", 6, { collision: hits("beyond") }), lane("left_1_target", 5, { offset: -1 })], world), "beyond");
  assert.equal(goalBlocker([stop, lane("keep_lane_target", 6, { collision: hits("car_3") })], world), null);
  // Off-route creeping has no lane to judge the destination by
  const creep = { id: "creep_straight", law: { kind: "steer", steer: 0, vTarget: 2 }, eligible: false, reject: "collision", sim: { progress_m: 4, collision: hits("beyond") } };
  assert.equal(goalBlocker([creep], world), null);
  console.log("✓ a blocked destination needs every move along the route's lane to hit something parked, not a red light or traffic");
}

