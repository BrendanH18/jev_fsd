// Rain s1-6: comfortable stopping and coasting both miss the line; a safe firmer stop is needed.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { kitsilano } = await import("./progress_helpers.mjs");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { comfort, Vehicle, ROAD } = await import("../static/js/sim/vehicle.js");
const { StopMemory, amberTimeLeft } = await import("../static/js/sim/signals.js");
const { observeAmber } = await import("../static/js/sim/amber.js");
const timing = { offset_s: 5, plan: { cycle: 28, A: { start: 0, green: 10, yellow: 3, allRed: 1 },
  B: { start: 14, green: 10, yellow: 3, allRed: 1 }, advance: { group: "A", length: 4 } } };
assert.equal(amberTimeLeft(timing, "yellow", 7.5), 0.5);
assert.equal(amberTimeLeft(timing, "arrow_yellow", -0.5), 2.5);
const map = kitsilano(), world = new World(map, { parked: 0, pedestrians: 0, weather: "rain", amberLights: true });
const lane = map.lane("e447", 0), edge = lane.edgeRef, inter = map.intersections.get("sig20");
world.t = (inter.plan.A.start + inter.plan.A.green - inter.offset_s + inter.plan.cycle) % inter.plan.cycle + 0.01;
const start = edge.control.s_line - 3.6 - 22.41;
world.placeOnLane(lane, start); world.ego.v = 7.41;
const next = map.successors(edge.id).find(id => map.classifyTurn(map.turnAngle(edge.id, id)) === "right");
world.route = new Route(routeFromLanes(map, [lane, map.lane(next, 0)], start, 80), map);
const choice = buildSnapshot(world).intersection.amber;
assert.equal(choice.stop, true);
assert.equal(choice.firm, true);
assert.ok(choice.stop_decel > comfort().decel && choice.stop_decel <= comfort().hardDecel);
const autopilot = new Autopilot(world); autopilot.setBrain("rules"); autopilot.setEnabled(true);
const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPark = fleet.nextPull = Infinity;
let crossed = false;
for (let k = 0; k < 8 * 60; k++) {
  stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
  if (autopilot.firing) await autopilot.firing;
  crossed ||= buildSnapshot(world).intersection?.entered === true;
}
assert.equal(crossed, false, "the firmer stop stays short of the line through red");
assert.equal(world.violations.red_lights_run, 0);
assert.equal(world.violations.amber_lights_run || 0, 0);
assert.ok(world.ego.v < 0.1);
// The same latched firm decision reaches ordinary traffic too.
map.rightOnRed = false;
const trafficWorld = new World(map, { parked: 0, pedestrians: 0, weather: "rain", amberLights: true });
trafficWorld.t = world.t - 8; Object.assign(trafficWorld.ego, { x: -1000, y: -1000 });
const trafficFleet = new NpcFleet(trafficWorld, { count: 0, bikes: 0 }); trafficFleet.nextPull = trafficFleet.nextPark = Infinity;
const p = lane.pts[0], car = new Vehicle(p[0], p[1], 0, 7.41);
trafficWorld.placeOnLane(lane, start);
Object.assign(car, { x: trafficWorld.ego.x, y: trafficWorld.ego.y, psi: trafficWorld.ego.psi,
  id: "amber_traffic", v0: 8.3, stopMem: new StopMemory(), frozen: 0, waiting: 0,
  driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 } });
Object.assign(trafficWorld.ego, { x: -1000, y: -1000 });
car.path = new NpcPath(map, () => 0.5); car.path.start(edge.id, 0, start, [[next, 0]]); trafficFleet.vehicles.push(car);
for (let k = 0; k < 12 * 60; k++) { trafficFleet.step(1 / 60); trafficWorld.t += 1 / 60; }
assert.equal(car.amberChoices.get(`${edge.id}:sig20`).firm, true);
assert.ok(car.path.s + car.spec.length - car.spec.rearOverhang < edge.control.s_line);
assert.ok(car.v < 0.1);
// An actual too-close case still clears: no stop is demanded beyond available grip.
const tooClose = world.ego.clone(); tooClose.v = 7.41;
const close = observeAmber(tooClose, "fresh", "yellow", 2, inter, "yellow", world.t - 8);
assert.equal(close.stop, false);
// Do not ask for firmer braking on a local ice patch.
const icy = world.ego.clone(); icy.v = 7.41;
ROAD.gripAt = () => 0.1;
assert.equal(observeAmber(icy, "ice", "yellow", 22.41, inter, "yellow", world.t - 8).stop, false);
ROAD.gripAt = null;
console.log("✓ wet-road amber dilemmas choose a safe firmer stop while too-close entries still clear");
process.exit(0);
