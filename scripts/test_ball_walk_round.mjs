// A child bringing the ball back walks round a vehicle standing across their way to the kerb (Ottawa
// city, seed 1, s1-1, McLeod Street). An ambulance on its call at 11 m/s saw the ball roll out only 21 m
// ahead, too late to stop short of the gap, braked hard and stopped with its body beside the gap. The
// child picked the ball up on the far side, walked back toward the gap, came up against the ambulance's
// side and waited for it to move (sim/pedestrians.js `threat`), while it waited for the child in the
// road: both stood there for the rest of the drive, with the driven car and a car just pulled out of the
// kerb stuck behind. The child now walks round the nearer end of a vehicle standing across the way back
// (sim/ball-chase.js `walkRound`). Here the standing vehicle is the driven car, stood still across the
// child's way once they have the ball, which on the old code they waited for for ever.
// node --experimental-default-type=module scripts/test_ball_walk_round.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { curbOffset } = await import("../static/js/sim/roadside.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");

const root = new URL("../data/maps/", import.meta.url);
const KITS = new MapData(JSON.parse(fs.readFileSync(new URL("623b012bc8b5.v6.pack.json", root))));
const scenario = challengeScenario(KITS, CHALLENGES.find((c) => c.id === "chasing-the-ball"));
const E = KITS.edges.get(scenario.ball.edge), AT = scenario.ball.at;
const lane = KITS.lane(E.id, E.lanes - 1), k = lane.length / E.length;

// `across`: where the driven car's body centre stands, along the street from the gap (metres), once the
// child has the ball; null leaves it well back.
function run(across) {
  setWeather("dry");
  const world = new World(KITS, { seed: 3, parked: 0, pedestrians: 0, balls: true });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9; world.balls.target = 0;
  const ctx = { world, fleet, autopilot: { enabled: false, step() {} } };
  world.placeOnLane(lane, (AT - 140) * k);
  const lat = curbOffset(E, CAR);
  for (const rear of [AT + 1.1, AT + 6.9, AT + 12.7, AT - 5.5, AT - 11.3, AT - 17.1, AT - 22.9]) {
    const s = rear + CAR.rearOverhang, p = pointAt(E.pts, E.cum, s), h = headingAt(E.pts, E.cum, s);
    world.parked.add(Object.assign(new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0), { id: `kerb_${rear}`, curb: "right", edge: E.id, stay: true }));
  }
  const b = world.balls.place({ edge: E.id, s: AT, lat: lat - CAR.width / 2 + 0.6, side: 1 }, { speed: 4.4, drift: 0, delay: 1.2, childSpeed: 2.5 });
  let placed = null, crossed = false, home = null, touched = false, blocked = false;
  for (let i = 0; i < 60 * 60 && home === null; i++) {
    stepWorld(ctx, 1 / 60, world.t * 1000);
    if (b.phase === "carried" && placed === null && b.child?.pause > 0) {
      placed = world.t;
      if (across !== null) world.placeOnLane(lane, (AT + across) * k - (CAR.length / 2 - CAR.rearOverhang));
    }
    const ped = b.child;
    if (ped && placed !== null) {
      touched ||= obbOverlap(ped.obb(), world.ego.obb());
      // (whether the straight way from where they picked it up to the gap ran through the car)
      if (world.t - placed < 0.1) blocked = ped.path.length > 0 && segmentThrough(ped, ped.path[0].p, world.ego.obb());
      crossed ||= !!ped.rounds;
    }
    if (b.childState === "gone" || b.childState === "clear") home = world.t;
  }
  return { placed, home, touched, blocked, rounds: b.child?.rounds || 0, collisions: world.violations.collisions };
}
function segmentThrough(ped, to, box) {
  for (let f = 0; f <= 1; f += 0.02) {
    const p = [ped.x + (to[0] - ped.x) * f, ped.y + (to[1] - ped.y) * f];
    if (obbOverlap({ center: p, heading: 0, halfLength: 0.3, halfWidth: 0.3 }, box)) return true;
  }
  return false;
}

const free = run(null);
assert.ok(free.placed !== null && free.home !== null, "the child picks the ball up and gets home");
assert.equal(free.rounds, 0, "with nothing in the way, straight back");
const stood = run(0);
assert.equal(stood.blocked, true, "the car stands across the child's way back");
assert.ok(stood.home !== null, "the child still gets home");
assert.ok(stood.rounds >= 1, "round the car");
assert.equal(stood.touched, false, "never walking into it");
assert.equal(stood.collisions, 0);
console.log(`A child walks round a car standing across their way back (home ${(stood.home - stood.placed).toFixed(1)} s after picking the ball up, ${(free.home - free.placed).toFixed(1)} s with the way clear)`);
process.exit(0);
