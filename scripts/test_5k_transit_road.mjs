import assert from "node:assert/strict";
import { test } from "node:test";
import { cumulative } from "../static/js/map/mapdata.js";
import * as bus from "../static/js/sim/bus.js";
import * as school from "../static/js/sim/school-bus.js";
import * as tram from "../static/js/sim/streetcar.js";
import { BUS, CAR, SCHOOL_BUS, STREETCAR, Vehicle } from "../static/js/sim/vehicle.js";

const street = {
  id: "road",
  from: "a",
  to: "b",
  lanes: 1,
  asphalt: [-4, 6],
  lane_offsets: [0],
  lane_width: 3.5,
  length: 200,
  limit: 12,
  pts: [
    [0, 0],
    [200, 0],
  ],
  cum: [0, 200],
};

function mapOf(edge = street) {
  return {
    edges: new Map([
      [edge.id, edge],
      ["reverse", { ...edge, id: "reverse", from: "b", to: "a" }],
    ]),
    inn: new Map([
      ["a", ["reverse"]],
      ["b", ["road"]],
    ]),
    out: new Map([
      ["a", ["road"]],
      ["b", ["reverse"]],
    ]),
  };
}

function busAt(transit = {}) {
  const coach = new Vehicle(50, 0, 0, 0, BUS);
  coach.kind = "bus";
  coach.transit = { phase: "leaving", t: 2, limit: 12, shift: 0, ...transit };
  return coach;
}

const actor = (x, y = 0, heading = 0, speed = 0) => new Vehicle(x, y, heading, speed, CAR);
const route = (y = 0) => [
  [0, y],
  [200, y],
];

test("reject bus signs outside the mapped edge", () => {
  assert.equal(bus.busStopFront(mapOf(), "road", -5), null);
  assert.equal(bus.busStopFront(mapOf(), "road", 201), null);
  assert.equal(bus.busStopFront(mapOf(), "road", NaN), null);
});

test("reject an invalid transit vehicle length at a stop", () => {
  assert.equal(bus.busStopFront(mapOf(), "road", 40, -1), null);
  assert.equal(bus.busStopFront(mapOf(), "road", 40, Infinity), null);
});

test("fall back to the street length when no cumulative length exists", () => {
  assert.equal(bus.busStopFront(mapOf({ ...street, cum: [] }), "road", 40), 41);
});

test("ignore a non-stop control while placing a bus stop", () => {
  assert.equal(bus.busStopFront(mapOf({ ...street, control: { type: "yield" } }), "road", 40), 41);
});

test("cut off transit stops half a metre before a stop line", () => {
  const map = mapOf({ ...street, control: { s_line: 70 } });
  assert.equal(bus.busStopFront(map, "road", 68.5), 69.5);
  assert.equal(bus.busStopFront(map, "road", 68.51), null);
});

test("skip holes and incomplete runs while building parking exclusions", () => {
  const map = mapOf();
  map.transit = {
    routes: [null, { mode: "tram" }, { mode: "bus", runs: [null, {}, { stops: [null, { edge: "road", s: 40 }] }] }],
  };
  assert.equal(bus.busZones(map).get("road").length, 1);
});

test("cache the parking exclusions of a map", () => {
  const map = mapOf();
  const zones = bus.busZones(map);
  assert.equal(bus.busZones(map) === zones, true);
});

test("exclude stops whose coach cannot fit behind the end of the street", () => {
  const map = mapOf();
  map.transit = { routes: [{ mode: "bus", runs: [{ stops: [{ edge: "road", s: 199 }] }] }] };
  assert.equal(bus.busZones(map).size, 0);
});

test("cover the length of the coach and the two ends of its parking exclusion", () => {
  const map = mapOf();
  map.transit = { routes: [{ mode: "bus", runs: [{ stops: [{ edge: "road", s: 40 }] }] }] };
  const [from, to] = bus.busZones(map).get("road")[0];
  assert.equal(from, 41 - BUS.length - 10);
  assert.equal(to, 44);
});

test("fall back to the lane centre for curb shifts with no geometry", () => {
  assert.equal(bus.curbShift({ lanes: 1 }, 0), 0);
  assert.equal(bus.curbShift({ ...street, lane_offsets: [NaN] }, 0), 0);
});

test("reject a nonpositive or infinite curb-shift vehicle width", () => {
  assert.equal(bus.curbShift(street, 0, -1), 0);
  assert.equal(bus.curbShift(street, 0, Infinity), 0);
});

test("keep buses in their lanes on roundabout rings and inner lanes", () => {
  assert.equal(bus.curbShift({ ...street, ring: true }, 0), 0);
  assert.equal(bus.curbShift({ ...street, lanes: 2 }, 0), 0);
});

test("reject non-finite headings and normalize large ones without an unbounded loop", () => {
  const coach = busAt();
  assert.equal(bus.busRelation(actor(20, 0, Infinity), coach), null);
  assert.equal(bus.busRelation(actor(20, 0, 2 ** 55 * (2 * Math.PI)), coach)?.inLane, true);
});

test("a one-revolution heading difference still goes the bus's way", () => {
  assert.equal(bus.busRelation(actor(20, 0, 2 * Math.PI), busAt()).inLane, true);
});

test("default the transit width and unstarted curb shift for an authored relation", () => {
  const coach = busAt({ laneWidth: -1, shift: null });
  assert.equal(bus.busRelation(actor(20, 1.9), coach).inLane, true);
  assert.equal(bus.busRelation(actor(20, 2.1), coach).inLane, false);
});

test("skip a bus relation with an invalid driver position", () => {
  assert.equal(bus.busRelation(actor(NaN), busAt()), null);
});

test("stop describing a driver more than 90 m behind the bus axle", () => {
  const coach = busAt();
  assert.equal(bus.busRelation(actor(-40), coach)?.inLane, true);
  assert.equal(bus.busRelation(actor(-40.01), coach), null);
});

test("use the observer's vehicle length to measure the front-to-rear gap", () => {
  const coach = busAt();
  const driver = { ...actor(20), spec: { length: 7, rearOverhang: 2 } };
  assert.ok(Math.abs(bus.busRelation(driver, coach).behind_m - (25 - BUS.rearOverhang)) < 1e-9);
});

test("do not grant a bus right of way from an invalid speed limit", () => {
  assert.equal(bus.busHasRightOfWay(busAt({ limit: null })), false);
  assert.equal(bus.busHasRightOfWay(busAt({ limit: -5 })), false);
});

test("include a bus at the configured speed-limit tolerance and exclude one beyond it", () => {
  assert.equal(bus.busHasRightOfWay(busAt({ limit: bus.BUS_YIELD_LIMIT_MPS })), true);
  assert.equal(bus.busHasRightOfWay(busAt({ limit: bus.BUS_YIELD_LIMIT_MPS + 0.001 })), false);
});

test("reject a bus pullout without finite signal time and road limit", () => {
  assert.equal(bus.busMayPullOut(busAt({ t: NaN }), []), false);
  assert.equal(bus.busMayPullOut(busAt({ limit: Infinity }), []), false);
});

test("wait for a driver in the target lane whose speed is unknown", () => {
  assert.equal(bus.busMayPullOut(busAt(), [null, actor(20, 0, 0, NaN)]), false);
});

test("keep the fast-road time gap even if the driver behind yields", () => {
  const coach = busAt({ limit: 20 });
  const driver = actor(20, 0, 0, 5);
  assert.equal(
    bus.busMayPullOut(coach, [driver], () => true),
    false,
  );
  driver.x = 0;
  assert.equal(bus.busMayPullOut(coach, [driver]), true);
});

test("slowing and already yielding both clear a close bus pullout", () => {
  const coach = busAt();
  const driver = actor(30, 0, 0, 3);
  assert.equal(bus.busMayPullOut(coach, [driver]), false);
  assert.equal(
    bus.busMayPullOut(coach, [driver], () => true),
    true,
  );
  driver.a = -0.31;
  assert.equal(bus.busMayPullOut(coach, [driver]), true);
});

test("keep watching a beside vehicle even when it is stationary", () => {
  assert.equal(bus.busMayPullOut(busAt(), [actor(50)]), false);
});

test("measure a yielding driver's stop against the rear bumper with room for the gap", () => {
  const coach = busAt();
  const driver = actor(20);
  const relation = bus.busYield(driver, coach);
  assert.equal(relation.stop_m, relation.behind_m - bus.BUS_YIELD_GAP_M);
  coach.transit.phase = "dwell";
  assert.equal(bus.busYield(driver, coach), null);
});

test("ignore reserved bus lanes outside the edge's lane range", () => {
  const map = { buslanes: [null, { edge: "road", lane: -1 }, { edge: "road", lane: 2 }] };
  assert.equal(bus.busTravelLane(map, { ...street, lanes: 2 }, { hour: 9, weekday: 0 }), 1);
});

const coach = { x: 60, y: 0, psi: 0, spec: SCHOOL_BUS };
const streetcar = new Vehicle(60, 0, 0, 0, STREETCAR);

test("project the school-bus rear end for following drivers and front end for oncoming drivers", () => {
  const east = school.schoolBusHold(route(), [0, 200], 12, coach);
  const west = school.schoolBusHold(route().reverse(), [0, 200], 100, coach);
  assert.equal(east.relation, "behind");
  assert.ok(Math.abs(east.gap_m - (coach.x - SCHOOL_BUS.rearOverhang - 12)) < 1e-9);
  assert.equal(east.gap_m - east.stop_m, school.BEHIND_M);
  assert.equal(west.relation, "oncoming");
  assert.equal(Math.round(west.gap_m - west.stop_m), school.ONCOMING_M);
});

test("return the same school-bus approach on a straight path and in the audit frame", () => {
  const driver = actor(12);
  const front = driver.x + CAR.length - CAR.rearOverhang;
  const hold = school.schoolBusHold(route(), [0, 200], front, coach);
  const relation = school.schoolBusRelation(driver, coach);
  assert.equal(hold.relation, relation.relation);
  assert.ok(Math.abs(hold.gap_m - relation.ahead_m) < 1e-9);
});

test("ignore school buses across a perpendicular path", () => {
  assert.equal(school.schoolBusHold(route(), [0, 200], 0, { ...coach, psi: Math.PI / 2 }), null);
});

test("apply the school-bus sideways cutoff at the near end", () => {
  assert.equal(school.schoolBusHold(route(school.SIDE_M), [0, 200], 0, coach)?.relation, "behind");
  assert.equal(school.schoolBusHold(route(school.SIDE_M + 0.01), [0, 200], 0, coach), null);
});

test("disregard the school bus once the observer's nose has passed its near end", () => {
  assert.equal(school.schoolBusHold(route(), [0, 200], 60, coach), null);
});

test("do not accept a route that revisits the school bus after already passing it", () => {
  const pts = [
    [0, 0],
    [70, 0],
    [70, 5],
    [0, 5],
  ];
  assert.equal(school.schoolBusHold(pts, cumulative(pts), 61, coach), null);
});

test("skip a repeated vertex while locating a school-bus hold", () => {
  const pts = [
    [0, 0],
    [0, 0],
    [200, 0],
  ];
  assert.equal(school.schoolBusHold(pts, cumulative(pts), 0, coach)?.relation, "behind");
});

test("ignore invalid school-bus hold inputs", () => {
  assert.equal(school.schoolBusHold(route(), [0], 0, coach), null);
  assert.equal(school.schoolBusHold(route(), [0, 200], NaN, coach), null);
  assert.equal(school.schoolBusHold(route(), [0, 200], 0, { ...coach, x: NaN }), null);
  assert.equal(school.schoolBusHold(route(), [0, 200], 0, coach, -1), null);
});

test("ignore invalid audit geometry in a school-bus relation", () => {
  assert.equal(school.schoolBusRelation(null, coach), null);
  assert.equal(school.schoolBusRelation(actor(0), { ...coach, y: Infinity }), null);
});

test("do not choose a stop on a street with an unknown speed limit", () => {
  const edge = { ...street, limit: NaN };
  assert.equal(school.stopRange(mapOf(edge), edge), null);
});

test("derive school-bus crosswalk exclusions from valid crossings only", () => {
  const range = school.stopRange(mapOf(), street, [null, { x: NaN, y: 0 }, { x: 50, y: 0 }, { x: 70, y: -13 }]);
  assert.equal(range.blocked.length, 1);
  assert.equal(range.blocked[0][0], 50 - school.CLEAR_CROSSWALK_M);
  assert.equal(range.blocked[0][1], 50 + school.CLEAR_CROSSWALK_M + SCHOOL_BUS.length);
});

test("find the end of overlapping crosswalk exclusions regardless of order", () => {
  const range = {
    lo: 30,
    hi: 100,
    blocked: [
      [45, 70],
      [60, 80],
      [35, 50],
    ],
  };
  assert.equal(school.firstStop(range, 35), 80);
});

test("resume school-bus stopping at the exact exclusion endpoint", () => {
  assert.equal(school.firstStop({ lo: 20, hi: 60, blocked: [[25, 60]] }, 25), 60);
});

test("reject school-bus ranges with non-finite limits and accept an omitted exclusion list", () => {
  assert.equal(school.firstStop({ lo: 30, hi: Infinity }, 31), null);
  assert.equal(school.firstStop({ lo: 30, hi: 80 }, 31), 31);
});

test("stop behind the streetcar's doors in the curb lane and its rear in its own lane", () => {
  const same = tram.streetcarHold(route(), [0, 200], 12, streetcar);
  const curb = tram.streetcarHold(route(-3.2), [0, 200], 12, streetcar);
  assert.equal(same.beside, false);
  assert.equal(curb.beside, true);
  assert.ok(Math.abs(curb.stop_m - same.stop_m - tram.DOOR_M) < 1e-9);
});

test("exclude the outside lane too far left of the streetcar", () => {
  assert.equal(tram.streetcarHold(route(3.2), [0, 200], 12, streetcar), null);
});

test("carry the adjacent-lane hold past the tail until reaching the rear doors", () => {
  const tail = streetcar.x - STREETCAR.rearOverhang;
  assert.equal(tram.streetcarHold(route(-3.2), [0, 200], tail + 0.1, streetcar)?.beside, true);
  assert.equal(tram.streetcarHold(route(-3.2), [0, 200], tail + tram.DOOR_M + 0.1, streetcar), null);
});

test("continue the streetcar hold just beyond its target while short of the doors", () => {
  const tail = streetcar.x - STREETCAR.rearOverhang;
  assert.ok(tram.streetcarHold(route(-3.2), [0, 200], tail, streetcar).stop_m < 0);
});

test("ignore a streetcar outside the lookahead", () => {
  assert.equal(tram.streetcarHold(route(), [0, 200], 12, streetcar, 10), null);
});

test("reject misaligned path distances in a streetcar hold", () => {
  assert.equal(tram.streetcarHold(route(), [0], 12, streetcar), null);
  assert.equal(tram.streetcarHold(route(), [0, Infinity], 12, streetcar), null);
});

test("ignore invalid streetcar audit geometry", () => {
  assert.equal(tram.streetcarRelation(actor(20, 0, Infinity), streetcar), null);
  assert.equal(tram.streetcarRelation(actor(20, Infinity), streetcar), null);
});

test("enumerate streetcar doors front to rear on the curb side", () => {
  const doors = tram.doorPoints(streetcar);
  assert.equal(doors.length, 4);
  assert.equal(
    doors.every(([x, y], i) => y < 0 && (i === 0 || x < doors[i - 1][0])),
    true,
  );
});

test("apply the door offset in the rotating streetcar frame", () => {
  const west = new Vehicle(60, 0, Math.PI, 0, STREETCAR);
  assert.ok(tram.doorPoints(west, 1).every(([, y]) => Math.abs(y - STREETCAR.width / 2 - 1) < 1e-9));
});

test("reject infinite braking speed even on an infinitely long approach", () => {
  for (const feature of [bus, school, tram]) assert.equal(feature.canStopFor(Infinity, Infinity), false);
});

test("distinguish the transit stopping distances for the same braking speed", () => {
  assert.equal(bus.canStopFor(7, 7), false);
  assert.equal(school.canStopFor(7, 7), true);
  assert.equal(tram.canStopFor(7, 7), true);
});

test("keep missing adjoining road entries from poisoning bus-stop clearance", () => {
  const map = mapOf();
  const cross = { ...street, id: "cross", from: "c", to: "a", asphalt: [-5, 6] };
  const link = { ...street, id: "link", from: "a", to: "d", asphalt: [NaN, Infinity] };
  map.edges.set(cross.id, cross);
  map.edges.set(link.id, link);
  map.inn.get("a").push("missing", cross.id);
  map.out.get("a").push(link.id);
  assert.equal(bus.busStopFront(map, "road", 1), 6 + BUS.length + 1);
});

test("use the bus's default dimensions when an authored coach omits them", () => {
  const coach = busAt();
  delete coach.spec;
  assert.ok(
    Math.abs(bus.busRelation(actor(20), coach).behind_m - (30 - BUS.rearOverhang - (CAR.length - CAR.rearOverhang))) <
      1e-9,
  );
});

test("release a school stop window only if the bus fits between its junction margins", () => {
  const edge = { ...street, cum: [0, SCHOOL_BUS.length + school.CLEAR_BEHIND_M + school.CLEAR_AHEAD_M] };
  assert.equal(school.stopRange(mapOf(edge), edge), null);
});

test("end a school-bus stop range early when a signal or stop line limits it", () => {
  const edge = { ...street, control: { s_line: 111 } };
  assert.equal(school.stopRange(mapOf(edge), edge).hi, 111 - school.CLEAR_AHEAD_M);
});

test("share the same curb-lane hold in streetcar sensing and auditing", () => {
  const driver = actor(20, -3.2);
  const front = driver.x + CAR.length - CAR.rearOverhang;
  const hold = tram.streetcarHold(route(-3.2), [0, 200], front, streetcar);
  const relation = tram.streetcarRelation(driver, streetcar);
  assert.equal(relation.beside, hold.beside);
  assert.ok(Math.abs(relation.ahead_m - hold.stop_m) < 1e-9);
});

test("ignore a streetcar when driving the opposite way", () => {
  assert.equal(tram.streetcarHold(route().reverse(), [0, 200], 12, streetcar), null);
  assert.equal(tram.streetcarRelation(actor(80, 0, Math.PI), streetcar), null);
});
