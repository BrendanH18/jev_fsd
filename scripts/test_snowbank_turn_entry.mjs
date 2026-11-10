// Snow s1-5: a bus must leave the junction clear while an oncoming car exits a narrowing.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { kitsilano } = await import("./progress_helpers.mjs");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { snowbankYield } = await import("../static/js/sim/snowbanks.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const map = kitsilano(), world = new World(map, { parked: 0, pedestrians: 0, weather: "snow", snowbanks: true, followingDistance: true });
Object.assign(world.ego, { x: -220, y: 120 });
world.snowbanks.build({ narrowings: [{ edge: "e111", a: 15, b: 67 }] });
const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPull = fleet.nextPark = Infinity;
const bus = fleet.addSchoolBus(map.lane("e331", 0), 140, 3);
bus.path.start("e331", 0, 140, [["e111", 0], ["e322", 0]]); bus.school.every = Infinity;
const lane = map.lane("e112", 0), at = 63, p = pointAt(lane.pts, lane.cum, at);
const car = Object.assign(new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, at), 2), {
  id: "oncoming", v0: 6, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 },
  stopMem: new StopMemory(), frozen: 0, waiting: 0,
});
car.path = new NpcPath(map, () => 0.5); car.path.start("e112", 0, at, [["e330", 0]]); fleet.vehicles.push(car);
world.snowbanks.step(1 / 60);
const plan = snowbankYield(world, bus, bus.path.s + bus.spec.length - bus.spec.rearOverhang);
assert.equal(plan.turn.mayEnter, false);
assert.ok(plan.hold < bus.path.edges[1].sStart - 5, "wait before the junction, not across the narrowing's exit");
// With the bank farther beyond the corner, an ordinary car can wait there.
world.snowbanks.build({ narrowings: [{ edge: "e111", a: 25, b: 77 }] });
for (const n of [bus, car]) for (const pe of n.path.edges) delete pe.snowbank;
const ordinary = Object.assign(new Vehicle(bus.x, bus.y, bus.psi, 3), { id: "ordinary", path: bus.path });
world.snowbanks.step(1 / 60);
const ordinaryPlan = snowbankYield(world, ordinary, ordinary.path.s + CAR.length - CAR.rearOverhang);
assert.ok(ordinaryPlan.hold > bus.path.edges[1].sStart, "with room beyond the corner, keep the usual hold point");
world.snowbanks.build({ narrowings: [{ edge: "e111", a: 15, b: 67 }] });
for (const n of [bus, car]) for (const pe of n.path.edges) delete pe.snowbank;
// A car already beyond the bank still needs to reach and leave its stop line.
const pose = { x: car.x, y: car.y, psi: car.psi, v: car.v, s: car.path.s };
Object.assign(car, { x: -169.86, y: 67.32, psi: 1.55, v: 0 }); car.path.s = 78.33;
world.snowbanks.step(1 / 60);
const exitPlan = snowbankYield(world, bus, bus.path.s + bus.spec.length - bus.spec.rearOverhang);
assert.equal(exitPlan.turn.mayEnter, true, "the opposing car is already out of the narrow stretch");
assert.ok(exitPlan.hold < bus.path.edges[1].sStart - 5, "keep the junction exit clear until that car leaves its approach");
Object.assign(car, { x: pose.x, y: pose.y, psi: pose.psi, v: pose.v }); car.path.s = pose.s;
let hit = false;
for (let k = 0; k < 45 * 60; k++) {
  world.snowbanks.step(1 / 60); fleet.step(1 / 60); world.t += 1 / 60; world.tick++;
  hit ||= obbOverlap(bus.obb(), car.obb());
}
assert.equal(hit, false);
assert.ok(car.x < -200, `the oncoming car leaves the narrowing and junction: x=${car.x}`);
assert.ok(bus.y < 45, `the bus then turns into the clear street: y=${bus.y}`);
console.log("✓ turning traffic waits before the junction and lets a snowbank corridor empty");
process.exit(0);
