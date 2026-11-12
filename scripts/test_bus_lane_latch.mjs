// Leaving the reserved curb lane a right turn ends in (sim/bus-lanes.js): the allowance is a lane
// change's length, and it used to be worked out from the car's speed at each moment, so it shrank as
// the car slowed on the way across (and grew as it sped up). It is now latched at the speed the car
// had when it started out of the lane (moved TURN_OUT_M, half a metre, from its centre), per street and route, on
// the world, where checkpoints keep it.
// node --experimental-default-type=module scripts/test_bus_lane_latch.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { auditBusLanes } = await import("../static/js/sim/bus-lanes.js");
const { laneChangeLength } = await import("../static/js/sim/controller.js");
const { cloneState } = await import("../static/js/lab/recorder.js");

const key = "7165f1c807a8";   // Mount Pleasant: Main Street (e452) bends right off e123 into a curb lane reserved all day
const pack = JSON.parse(fs.readFileSync(`data/maps/${key}.v6.pack.json`));
pack.buslanes = JSON.parse(fs.readFileSync(`data/maps/${key}.buslanes.v1.json`));
const map = new MapData(pack);
// (on to e148, straight on: no right-turn approach on e452)
const chain = [["e123", 2], ["e452", 2], ["e148", 2]];

function world() {
  const w = new World(map, { seed: 1, parked: 0, pedestrians: 0, busLanes: true });
  w.setClock({ hour: 15.5, weekday: 0 });
  w.route = new Route(routeFromLanes(map, chain.map(([id, k]) => map.lane(id, k)), 2, 30), map, w.ego.spec);
  return w;
}
// One audited second `s` metres into the curb lane, `left` metres left of its centre, at `v`;
// returns the metres counted in that second.
function tick(w, s, left, v) {
  w.placeOnLane(map.lane("e452", 2), s);
  w.ego.x -= Math.sin(w.ego.psi) * left; w.ego.y += Math.cos(w.ego.psi) * left;
  w.ego.v = v;
  const before = w.violations.bus_lane_driving || 0;
  auditBusLanes(w, 1);
  return (w.violations.bus_lane_driving || 0) - before;
}
assert.ok(laneChangeLength(3) < 22 && laneChangeLength(10) > 22 && laneChangeLength(14) > 30, "the lengths this check relies on");

// Starting out of the lane at 10 m/s, then slowing to 3 m/s while still in it, 22 m in: the allowance is
// the 35 m it had when it started, not the 18 m of 3 m/s.
const slowing = world();
assert.equal(tick(slowing, 8, 0, 10), 0);
assert.equal(tick(slowing, 14, 0.8, 6), 0, "moving out");
assert.equal(tick(slowing, 22, 1.2, 3), 0, "slowing on the way across does not shorten the allowance");
assert.ok(Math.abs(slowing.busTurnIn.allow_m - laneChangeLength(10)) < 1e-9, "latched at the speed it started out at");

// Starting out at 3 m/s and speeding up to 14 m/s, 30 m in and still in the lane: it no longer stretches.
const quick = world();
assert.equal(tick(quick, 6, 0.8, 3), 0, "moving out at once");
assert.equal(tick(quick, 30, 1.2, 14), 14, "speeding up does not stretch it either");

// A checkpoint keeps the latch: a restored world carries on with the allowance it had.
const saved = cloneState({ world: slowing }, new Set([map])).world;
assert.equal(tick(saved, 22, 1.2, 3), 0, "a restored checkpoint keeps the latched allowance");
assert.equal(tick(saved, 40, 1.2, 3), 3, "and beyond it still counts");

// Another route (a new drive) starts afresh.
const again = slowing; again.route = new Route(routeFromLanes(map, chain.map(([id, k]) => map.lane(id, k)), 2, 30), map, again.ego.spec);
assert.equal(tick(again, 22, 1.2, 3), 3, "a new route's turn-in latches afresh");
console.log("The allowance for leaving a reserved curb lane after a right turn is latched when the car starts out of it");
process.exit(0);
