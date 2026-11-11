// A reserved bus lane in the curb lane up to where a street's lanes end (Winnipeg's Disraeli Freeway,
// three lanes, the curb lane reserved, running into a one-lane ramp): the router follows the curb lane
// (jev/routing.py), so the polyline moves across to the lane the car keeps to at the join. Lane laws
// must move with it (map/route.js busMerges) rather than hold their offset off the ramp's asphalt; with
// no bus-lane policy nothing changes.
// node --experimental-default-type=module scripts/test_bus_lane_merge.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, projectPoint } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { lateralAt } = await import("../static/js/sim/controller.js");

const key = "19bb885c9cae";   // Winnipeg
const pack = JSON.parse(fs.readFileSync(`data/maps/${key}.v6.pack.json`));
pack.buslanes = JSON.parse(fs.readFileSync(`data/maps/${key}.buslanes.v1.json`));
const map = new MapData(pack);
assert.equal(map.buslanes.some((l) => l.edge === "e241" && l.lane === 2), true, "Disraeli Freeway's curb lane is reserved");
const chain = [map.lane("e363", 2), map.lane("e241", 2), map.lane("e323", 0), map.lane("e352", 0)];
const data = routeFromLanes(map, chain, 5, 20);
const route = new Route(data, map);
const join = route.laneEdgeStarts()[route.edges.indexOf("e323")];
const before = join - 20, after = join + 15;
const ramp = map.edges.get("e323");
// how far the lateral target `d` metres right of the route at s is from the ramp's centreline
const offRamp = (s, d) => projectPoint(ramp.pts, ramp.cum, route.offsetPointAt(s, d)).distance;

// Without a bus-lane policy: the route's own lane, no merge, laws hold their offset as before.
assert.equal(route.busMerges().length, 0);
assert.equal(route.laneAt(before).idx, 2);
assert.equal(route.frameMove(before, after), 0);

// At 15:30 on a Monday the curb lane is reserved: the car keeps to the middle lane, and that lane runs
// straight on into the ramp.
route.busLanePolicy = { clock: { hour: 15.5, weekday: 0 }, curb: false };
const here = route.laneAt(before);
assert.equal(here.idx, 1, "kept out of the reserved curb lane");
assert.ok(Math.abs(here.center + 3.5) < 0.05, `the middle lane is 3.5 m left of the route (${here.center})`);
const merges = route.busMerges();
assert.equal(merges.length, 1, "one merge, at the end of the freeway");
assert.ok(Math.abs(merges[0].by + 3.5) < 0.05);
assert.ok(Math.abs(route.laneAt(after).center) < 0.05, "on the ramp, the car's lane is the route's");
// A law chosen in the middle lane before the join follows the ramp after it.
const law = { kind: "lane", offset: here.center, center: here.center, laneIdx: 1, chain: here.chain, vTarget: 10, s0: before };
assert.ok(Math.abs(lateralAt(law, after, route)) < 0.3, `on the ramp's centre after the join (${lateralAt(law, after, route).toFixed(2)})`);
assert.ok(offRamp(after, lateralAt(law, after, route)) < 0.5, "and on its asphalt");
// (all the way across: the law's target is the centre of the lane the car keeps to, as sensing sees it)
let worst = 0;
for (let s = before; s <= after; s += 0.5) worst = Math.max(worst, Math.abs(lateralAt(law, s, route) - route.laneAt(s).center));
assert.ok(worst < 0.05, `the target stays on the lane's centre through the join (${worst.toFixed(3)} m)`);
// (without the merge the same law would end 3.5 m off the ramp's centre, off its 3.5 m of asphalt)
route.busLanePolicy = null;
assert.ok(offRamp(after, lateralAt(law, after, route)) > 3, "without the policy the old offset stays off the ramp");
// (the merge is remembered per policy: with the curb granted, parking, the curb lane is the car's)
route.busLanePolicy = { clock: { hour: 15.5, weekday: 0 }, curb: true };
assert.equal(route.busMerges().length, 0, "parking at the curb: the curb lane is the car's");
console.log("Bus-lane merge: lane laws follow the middle lane onto the ramp; nothing changes without a policy");
process.exit(0);
