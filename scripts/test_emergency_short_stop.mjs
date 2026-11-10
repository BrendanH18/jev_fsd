// A crawl with room to steer before a line must actually pull right before stopping.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { Route } = await import("../static/js/map/route.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");
{
  const { kitsilano } = await import("./progress_helpers.mjs");
  const { World } = await import("../static/js/sim/world.js");
  const { routeFromLanes } = await import("../static/js/demo/routing.js");
  const map = kitsilano(), world = new World(map, { parked: 0, pedestrians: 0, weather: "fog" });
  const lane = map.lane("e553", 0);
  world.route = new Route(routeFromLanes(map, [lane, map.lane("e350", 0)]), map);
  world.placeOnLane(lane, 77.4); world.ego.v = 0.964;
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 });
  assert.equal(!!fleet.dispatchEmergency({ relation: "behind", kind: "fire_truck", distance: 70 }), true);
  let snap = buildSnapshot(world);
  assert.equal(snap.emergency.steer_at_stop, true, "the signal leaves less than normal steering room");
  assert.equal(sampleCandidates(snap, world).find(c => c.id === "pull_over").law.steerAtStop, true);
  world.placeOnLane(lane, 50); world.evYield = null;
  snap = buildSnapshot(world);
  assert.equal(snap.emergency.steer_at_stop, false, "an open approach keeps the ordinary pursuit distance");
}
for (const weather of ["dry", "fog", "rain", "snow"]) {
  const world = fixtureWorld({ weather }), front = world.ego.spec.length - world.ego.spec.rearOverhang;
  Object.assign(world.ego, { x: 100, v: 0.964 });
  const control = { type: "stop", id: "short", s_line: 100 + front + 2.89, all_way: false };
  Object.assign(world.map.edges.get("street"), { control, lane_width: 3.2 });
  // Rebuild the route's controls after adding the line.
  world.route = new Route({ id: "straight", polyline: [[0, 0], [200, 0]], edges: ["street"], turns: [] }, world.map);
  const parked = new Vehicle(105, -4.5, 0, 0); world.parked.add(parked);
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPull = fleet.nextPark = Infinity;
  const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 80 });
  assert.equal(!!ev, true); fleet.emergencyStep = () => {};
  world.evYield = { id: ev.id, route: world.route, stop: control.s_line - 0.5,
    speed: world.ego.v, since: 0, tight: true, clearing: false, lead: false };
  const autopilot = new Autopilot(world); autopilot.setBrain("rules"); autopilot.setEnabled(true);
  let touched = false;
  for (let k = 0; k < 8 * 60; k++) {
    stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    touched ||= obbOverlap(world.ego.obb(), parked.obb(), 0.3);
  }
  assert.equal(touched, false, `${weather}: preserves parked-car clearance`);
  assert.equal(world.ego.x + front < control.s_line, true, `${weather}: stays short of the line`);
  assert.equal(world.roadInfo().lateral >= 0.2, true, `${weather}: finishes pulling right before stopping`);
  const middle = world.ego.spec.length / 2 - world.ego.spec.rearOverhang;
  for (const [t, ahead] of [[9.9, 0.1], [10, -0.1]]) {
    ev.x = world.ego.x + middle + ahead - (ev.spec.length / 2 - ev.spec.rearOverhang);
    ev.y = world.ego.y + 3.2; ev.psi = 0; ev.path.s = ev.x;
    world.t = t; world.auditEmergency(world.roadInfo());
  }
  assert.equal(world.violations.failed_to_yield, 0, `${weather}: yields as the ambulance draws level`);
}
console.log("Short emergency stops finish steering before the control line with full clearance");
process.exit(0);
