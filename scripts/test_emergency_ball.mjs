// An emergency vehicle that sees a ball roll into the street keeps to the cover speed, as all traffic does
// (sim/ball-chase.js `ballYield`), siren or not (Kitsilano city, seed 1, s1-5, West 8th Avenue). A fire
// truck went on at 10 m/s, braked hard for the child and stopped with its front past the gap the child
// came from: the child's way back ran into the truck, so the child waited for it to move and it waited
// for the child, until it stood down in the middle of the road and blocked the driven car for 165 s.
// node --experimental-default-type=module scripts/test_emergency_ball.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, FIRE_TRUCK, comfort } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { curbOffset } = await import("../static/js/sim/roadside.js");
const B = await import("../static/js/sim/ball-chase.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");

const root = new URL("../data/maps/", import.meta.url);
const pack = JSON.parse(fs.readFileSync(new URL("623b012bc8b5.v6.pack.json", root)));
const KITS = new MapData(pack);
const scenario = challengeScenario(KITS, CHALLENGES.find((c) => c.id === "chasing-the-ball"));
const E = KITS.edges.get(scenario.ball.edge), AT = scenario.ball.at;
const lane = KITS.lane(E.id, E.lanes - 1), k = lane.length / E.length;

setWeather("dry");
const world = new World(KITS, { seed: 3, parked: 0, pedestrians: 0, balls: true });
const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9; world.balls.target = 0;
const ctx = { world, fleet, autopilot: { enabled: false, step() {} } };
// The driven car standing well back; cars parked along the right kerb either side of the gap.
world.placeOnLane(lane, (AT - 110) * k - (CAR.length - CAR.rearOverhang));
const lat = curbOffset(E, CAR);
for (const rear of [AT + 1.1, AT + 6.9, AT + 12.7, AT - 5.5, AT - 11.3, AT - 17.1, AT - 22.9]) {
  const s = rear + CAR.rearOverhang, p = pointAt(E.pts, E.cum, s), h = headingAt(E.pts, E.cum, s);
  world.parked.add(Object.assign(new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0), { id: `kerb_${rear}`, curb: "right", edge: E.id, stay: true }));
}
const gap = { edge: E.id, s: AT, lat: lat - CAR.width / 2 + 0.6, side: 1 };
// A fire truck answering a call along the street at 10 m/s, siren on.
const s0 = (AT - 75) * k, p = pointAt(lane.pts, lane.cum, s0);
const truck = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s0), 10, FIRE_TRUCK);
Object.assign(truck, { id: "fire_truck_t", kind: "fire_truck", siren: true, side: 0, age: 0, v0: 15, driver: { aMax: 2.2, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 },
  stopMem: new StopMemory(), frozen: 0, waiting: 0, blockedBy: null, blockedFor: 0 });
truck.path = new NpcPath(KITS, fleet.random);
truck.path.start(E.id, lane.idx, s0);
fleet.vehicles.push(truck);

let b = null, over = 0, v0 = null, pastGap = false, stoppedFor = false;
for (let i = 0; i < 60 * 60; i++) {
  stepWorld(ctx, 1 / 60, world.t * 1000);
  if (!b) {
    // (the ball rolls out once the truck's front is 40 m short of the gap; the child after it 1.3 s later)
    if (AT - (projectPoint(E.pts, E.cum, [truck.x, truck.y]).s + truck.spec.length - truck.spec.rearOverhang) <= 40) b = world.balls.place(gap, { speed: 3.6, drift: 0, delay: 1.3, childSpeed: 2.5 });
    continue;
  }
  // (from a moment after it saw the ball, no faster than the cover speed, or the speed it would be down
  // to braking comfortably from then: the audit's allowance for the driven car)
  const dg = B.frontToGap(b, truck), seen = b.seenBy.get(truck.id);
  if (seen !== undefined && world.t >= seen + B.AUDIT_REACT_S && B.warningStands(world, b, truck.id) && dg > 0) {
    v0 ??= { v: truck.v, t: world.t };
    over = Math.max(over, truck.v - Math.max(B.coverSpeed(dg), v0.v - comfort().decel * (world.t - v0.t)));
  }
  if (b.childState === "out" && dg < 0) pastGap = true;
  if (b.childState === "out" && truck.v < 0.1) stoppedFor = true;
  if (b.childState === "gone") break;
}
assert.equal(!!b && b.seenBy.has(truck.id), true, "the truck saw the ball");
assert.ok(over < B.AUDIT_SLACK_MPS, `kept to the cover speed (over by ${over.toFixed(2)} m/s)`);
assert.equal(stoppedFor, true, "stopped for the child");
assert.equal(pastGap, false, "its front stayed short of the gap while the child was out");
assert.equal(b.childState, "gone", "the child got home with the ball");
assert.equal(truck.siren, true, "still answering its call");
assert.equal(world.violations.collisions, 0);
console.log(`An emergency vehicle keeps to the cover speed for a ball and leaves the child their way home (over by ${over.toFixed(2)} m/s)`);
process.exit(0);
