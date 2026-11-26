// An emergency pull-over still not begun a second after it was planned, with less than half the steering
// distance (8 m) left before its stop, finishes its move right within that stop, as one planned short
// does (`steer_at_stop`, emergencyYield in brain/sensors.js; `steerAtStop` in controller.applyLaw).
// In Kitsilano's city suite at 06:30, s1-4, an ambulance called just after the car had turned into
// Vine Street, 0.4 m left of its lane's centre, cars parked close at the kerb. The pull-over planned
// with 9 m to steer in, but its forward simulations passed within 0.3 m of a parked car's corner at
// that speed, so the car slowed in its lane first and only began to pull over 3.6 m short of its stop,
// 2.3 s after the call. Pursuing the ordinary lookahead it stopped 0.17 m right of its lane's centre
// (rear axle), short of the 0.19 m the parked cars left the audit to ask, and the ambulance drawing level
// counted as a failure to yield. A pull-over begun on time, or late with more room (Kitsilano city rain
// s1-9 began 6.2 m short and got over; the shorter pursuit there swung its nose into a parked car's
// margin), keeps the ordinary pursuit.
// node --experimental-default-type=module scripts/test_emergency_late_pull_over.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");

// As in Kitsilano s1-4 when the pull-over began: the car 0.05 m left of its lane's centre at `v` m/s,
// 3.4 m short of its stop, an ambulance 80 m behind, cars parked close at the kerb behind it, and a
// pull-over planned at the call with ordinary steering room. Pursuing the ordinary lookahead from here
// the car stops 0.18 m right of its lane's centre, as on Vine Street.
function setup({ weather = "dry", room = 3.4, v = 1.33, age = 2.3 } = {}) {
  const world = fixtureWorld({ weather }),
    front = world.ego.spec.length - world.ego.spec.rearOverhang;
  Object.assign(world.ego, { x: 100, y: 0.05, v });
  const parked = [];
  for (const x of [88, 94.5]) {
    const car = new Vehicle(x, -2.54, 0, 0);
    car.id = `parked_${x}`;
    parked.push(car);
    world.parked.add(car);
  }
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 });
  fleet.nextPull = fleet.nextPark = Infinity;
  const ev = fleet.emergency.dispatch({ relation: "behind", kind: "ambulance", distance: 80 });
  assert.equal(!!ev, true);
  fleet.emergency.step = () => {};
  world.evYield = {
    id: ev.id,
    route: world.route,
    stop: 100 + front + room,
    speed: v,
    since: -age,
    tight: false,
    clearing: false,
    reach: 0,
  };
  return { world, fleet, ev, parked };
}

{
  // a pull-over under way keeps the ordinary pursuit as it nears its stop, and so does one begun earlier
  // and dropped for a moment
  const { world } = setup();
  let snap = buildSnapshot(world, { candidate: { id: "pull_over" } });
  assert.equal(snap.emergency.steer_at_stop, false, "a pull-over under way keeps its pursuit");
  assert.equal(sampleCandidates(snap, world).find((c) => c.id === "pull_over").law.steerAtStop, undefined);
  snap = buildSnapshot(world, { candidate: { id: "keep_lane_stop" } });
  assert.equal(snap.emergency.steer_at_stop, false, "one begun and dropped keeps it");
}
for (const [room, age, why] of [
  [6.2, 2.3, "begun late with more than half the steering distance left (rain s1-9)"],
  [3.4, 0.5, "planned only half a second ago"],
]) {
  const { world } = setup({ room, age });
  const snap = buildSnapshot(world, { candidate: { id: "keep_lane_stop" } });
  assert.equal(snap.emergency.steer_at_stop, false, `ordinary pursuit: ${why}`);
}
{
  // one still not begun 2.3 s after it was planned, 3.4 m short of its stop, finishes within it
  const { world } = setup();
  const snap = buildSnapshot(world, { candidate: { id: "keep_lane_stop" } });
  assert.equal(snap.emergency.steer_at_stop, true, "a late pull-over finishes within its stop");
  assert.equal(sampleCandidates(snap, world).find((c) => c.id === "pull_over").law.steerAtStop, true);
  // (and stays so once it is under way)
  assert.equal(buildSnapshot(world, { candidate: { id: "pull_over" } }).emergency.steer_at_stop, true);
}
console.log("✓ a pull-over begun late with less than half the steering distance left steers for its stop");

for (const weather of ["dry", "rain"]) {
  // closed loop, the late start in Kitsilano s1-4
  const { world, fleet, ev, parked } = setup({ weather });
  const autopilot = new Autopilot(world);
  autopilot.setBrain("rules");
  autopilot.setEnabled(true);
  let touched = false;
  for (let k = 0; k < 8 * 60; k++) {
    stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    touched ||= parked.some((car) => obbOverlap(world.ego.obb(), car.obb(), 0));
  }
  assert.equal(touched, false, `${weather}: clear of the parked cars`);
  assert.equal(Math.abs(world.ego.v) < 0.05, true, `${weather}: stopped`);
  const road = world.roadInfo();
  assert.equal(road.lateral >= 0.2, true, `${weather}: pulled over (${road.lateral.toFixed(2)} m right)`);
  assert.equal(Math.abs(road.heading_error) < 0.1, true, `${weather}: nearly square to the lane`);
  // the ambulance draws level, in the other half of the street
  const middle = world.ego.spec.length / 2 - world.ego.spec.rearOverhang;
  for (const [t, ahead] of [
    [world.t + 0.1, -0.1],
    [world.t + 0.2, 0.1],
  ]) {
    ev.x = world.ego.x + middle + ahead - (ev.spec.length / 2 - ev.spec.rearOverhang);
    ev.y = world.ego.y + 3.4;
    ev.psi = 0;
    ev.path.s = ev.x;
    world.t = t;
    world.auditEmergency(world.roadInfo());
  }
  assert.equal(world.violations.failed_to_yield, 0, `${weather}: yields as the ambulance draws level`);
}
console.log("✓ pulling over late, the car still stops pulled over, clear of the parked cars");
process.exit(0);
