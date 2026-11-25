import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const start = performance.now();
globalThis.document = { querySelector: () => null };
const { Crowd, Pedestrian, crosswalkConflict, kerbConflict } = await import("../static/js/sim/pedestrians.js");
const {
  canStopShort,
  crosswalksAlong,
  distanceTo,
  frontTo,
  hiddenByTraffic,
  looked,
  noteStop,
  segmentHitsBox,
  stoppedAt,
} = await import("../static/js/sim/crosswalk.js");
const {
  ContraflowRiders,
  RiderPath,
  comingOut,
  contraControl,
  contraflowOf,
  entriesAhead,
  rideLateral,
  riderConflict,
  roomRight,
} = await import("../static/js/sim/contraflow.js");
const { CAR, Vehicle } = await import("../static/js/sim/vehicle.js");

const edge = {
  id: "e",
  from: "from",
  to: "to",
  length: 100,
  pts: [
    [0, 0],
    [100, 0],
  ],
  cum: [0, 100],
  asphalt: [-3.2, 3.2],
  cls: "primary",
};
const twin = { ...edge, id: "twin", from: edge.to, to: edge.from };
const signal = { id: "first", vertices: [edge.from], approaches: [] };
const map = {
  edges: new Map([
    [edge.id, edge],
    [twin.id, twin],
    ["bad", { ...edge, id: "bad", length: NaN }],
  ]),
  crosswalks: [
    { id: "later", edge: edge.id, x: 60, y: 0 },
    { id: "near", edge: twin.id, x: 30, y: 0 },
    { id: "invalid", edge: edge.id, x: Infinity, y: 0 },
  ],
  intersections: new Map([
    [signal.id, signal],
    ["second", { id: "second", vertices: [edge.from] }],
  ]),
  contraflow: new Map([[edge.id, { side: "left" }]]),
  inn: new Map([[edge.from, ["ghost"]]]),
  out: new Map([[edge.from, [edge.id, "ghost"]]]),
  headingOut: () => 0,
};
const world = { map, t: 0, ego: new Vehicle(-150, 0), npcs: [] };
const crowd = new Crowd(world, { count: 0 });
assert.equal(crowd.streets.length, 1, "invalid edge lengths cannot poison spawn weights");
assert.equal(crowd.marked.length, 2, "unprojectable crossing coordinates are ignored");
assert.equal(crowd.streetOf(twin) === crowd.streetOf(edge), true);
assert.equal(crowd.streetOf(null), undefined);
assert.equal(crowd.leg("missing", crowd.streetOf(edge)), undefined);
assert.equal(crowd.legsAt.get(edge.from).inter.id, signal.id, "first signal wins when a vertex is listed twice");
assert.equal(crowd.leg(edge.from, crowd.streetOf(edge)).group === null, true);
crowd.spawn(Infinity);
assert.equal(crowd.list.length, 0);
const unlitCrowd = new Crowd({ ...world, map: { ...map, intersections: null } }, { count: 1 });
assert.equal(unlitCrowd.legsAt.get(edge.from).inter === null, true);
unlitCrowd.spawn(1);
assert.equal(unlitCrowd.list.map((walker) => walker.id).join(","), "ped_1,ped_2");

const ped = new Pedestrian({ x: 0, y: 0, v: 1 });
crowd.list.push(ped);
assert.throws(() => crowd.step(-0.1), /Invalid pedestrian step/);
assert.equal(ped.v, 1);
crowd.step(0);
assert.equal(ped.v, 1, "zero time leaves path and speed untouched");
crowd.step(0.1);
assert.equal(ped.v, 0, "a stand-in with no path or corner can remain still");
assert.equal(crowd.near(0, 0, Infinity).length, 0);
assert.equal(crowd.near(0, 0, 0).length, 0);
const st = crowd.streetOf(edge);
assert.throws(() => crowd.walkAlong(ped, st, 1, 0, 0), /Sidewalk direction/);
assert.throws(() => crowd.walkAlong(ped, st, 0, 0, 1), /Sidewalk side/);
assert.throws(() => crowd.walkAlong(ped, st, 1, NaN, 1), /Sidewalk position/);
assert.throws(
  () => crowd.walkAlong(ped, { edge: { ...edge, to: "unmapped", cum: [0, Infinity] } }, 1, 0, 1),
  /Sidewalk end/,
);
crowd.marking = () => 0;
crowd.walkAlong(ped, st, 1, 0, 1);
assert.equal(ped.path.find((wp) => wp.cross)?.cross.marked, "near");
crowd.walkAlong(ped, st, 1, 80, -1);
assert.equal(ped.path.find((wp) => wp.cross)?.cross.marked, "later");
const unknownLeg = { edge: { ...edge, to: "roundabout" } };
crowd.walkAlong(ped, unknownLeg, 1, 20, 1);
assert.equal(ped.at.turnBack, true);

const crossing = { from: [4, -6], to: [4, 6], node: "missing" };
assert.equal(crowd.mayCross({}, 0), false);
assert.equal(crowd.mayCross(crossing, 0), true, "unmapped corners use a traffic gap");
assert.equal(crowd.occupiedCrossing(ped, {}), true);
assert.equal(crowd.canStopFor({}), false);
assert.equal(crowd.clearFor({}, 4, 30), false);
assert.equal(crowd.clearFor(crossing, -1, 30), false);
assert.equal(crowd.clearFor(crossing, 4, NaN), false);
world.ego.x = -12;
world.ego.v = 10;
assert.equal(crowd.canStopFor(crossing), false);
assert.equal(crowd.clearFor(crossing, 5, 60), false);
world.ego.x = -50;
assert.equal(crowd.canStopFor(crossing), true);
assert.equal(crowd.clearFor(crossing, 5, 40), true, "the gap check honors its search radius");
world.ego.v = 0;
ped.path = [{ p: crossing.to, cross: crossing }];
ped.x = 4;
ped.y = -6;
ped.speed = 1;
ped.crossing = null;
world.ego.x = 0;
world.ego.y = 0;
crowd.step(0.1);
assert.equal(ped.waiting, 0.1, "an authored pedestrian can accumulate a wait without explicitly initializing it");
assert.equal(ped.crossing === null, true);
world.ego.x = -150;
crowd.step(0.1);
assert.equal(ped.phase > 0, true);
assert.equal(ped.crossing === crossing, true);
ped.path = [{ p: [4, ped.y + 0.01], cross: crossing, wait: 2 }];
crowd.step(0.1);
assert.equal(ped.crossing, null, "completing the crossing clears it before other actors see the pedestrian");
assert.equal(ped.pause, 2, "the stop at the destination starts on waypoint completion");
crowd.step(0.1);
assert.equal(ped.pause, 1.9);
ped.pause = 0;
ped.path = [{ p: [Infinity, 2] }];
assert.throws(() => crowd.step(0.1), /Invalid waypoint/);
ped.path = [{ p: [4, 0] }];
ped.speed = NaN;
assert.throws(() => crowd.step(0.1), /Invalid speed/);
ped.speed = 1;
ped.held = true;
const beforeHold = ped.y;
crowd.step(0.1);
assert.equal(ped.y, beforeHold);
ped.held = false;
ped.frozen = 0.2;
crowd.step(0.1);
assert.equal(ped.frozen, 0.1);
assert.equal(ped.v, 0);
ped.frozen = 0;

const route = {
  pts: [
    [0, 0],
    [4, 0],
  ],
  cum: [0, 4],
};
ped.crossing = crossing;
ped.y = -1;
assert.equal(crosswalkConflict(route.pts, route.cum, 4, 4, crowd).s, 4);
assert.equal(crosswalkConflict(route.pts, route.cum, 0, 3.9, crowd) === null, true);
assert.equal(crosswalkConflict(route.pts, route.cum, 4, 3, crowd) === null, true);
assert.equal(crosswalkConflict(route.pts, [0], 0, 4, crowd) === null, true);
const tie = { ...ped, x: 4 };
assert.equal(crosswalkConflict(route.pts, route.cum, 0, 4, { list: [ped, tie] }).ped === ped, true);
const early = { ...ped, x: 2, crossing: { from: [2, -6], to: [2, 6] } };
assert.equal(crosswalkConflict(route.pts, route.cum, 0, 4, { list: [ped, early] }).s, 2);
assert.equal(crosswalkConflict(route.pts, route.cum, 0, 4, { list: [ped, early] }).toPath, 1);
assert.equal(crosswalkConflict(route.pts, route.cum, 0, 4, { list: [{ ...ped, x: NaN }] }) === null, true);
ped.y = 2;
assert.equal(crosswalkConflict(route.pts, route.cum, 0, 4, crowd), null, "beyond the travel lane the car has room");
ped.crossing = { ...crossing, from: [Infinity, 0] };
assert.equal(crosswalkConflict(route.pts, route.cum, 0, 4, crowd) === null, true);
assert.equal(kerbConflict(route.pts, route.cum, 0, 4, crowd, [{ x: 0, y: 0 }], 0, 1) === null, true);
assert.equal(kerbConflict(route.pts, route.cum, 0, 4, crowd, null, NaN, 1) === null, true);
assert.equal(kerbConflict(route.pts, route.cum, 0, 4, crowd, null, 0, -1) === null, true);
const signalled = { ...crossing, node: edge.from, leg: { group: "B" } };
const kerbWalker = { x: 4, y: -6, path: [{ p: crossing.from }, { p: crossing.to, cross: signalled }] };
const unknownKerb = { ...kerbWalker, path: [{ p: crossing.to, cross: { ...signalled, from: null } }] };
assert.equal(kerbConflict(route.pts, route.cum, 0, 4, crowd, [unknownKerb], 0, 1) === null, true);
assert.equal(crowd.mayCross(signalled, 0), true, "walk uses the signal group parallel to the crossing");
assert.equal(crowd.mayCross(signalled, 7), false, "the flashing clearance interval does not admit new pedestrians");
assert.equal(kerbConflict(route.pts, route.cum, 0, 4, crowd, [kerbWalker], 47, 1) === kerbWalker, true);
assert.equal(kerbConflict(route.pts, route.cum, 0, 4, crowd, [kerbWalker], 47, 0.5) === null, true);
kerbWalker.y = -12.1;
assert.equal(kerbConflict(route.pts, route.cum, 0, 4, crowd, [kerbWalker], 0, 1) === null, true);
kerbWalker.y = -6;
kerbWalker.frozen = 1;
assert.equal(kerbConflict(route.pts, route.cum, 0, 4, crowd, [kerbWalker], 0, 1) === null, true);

const cw = { id: "c", ends: { 1: crossing.from, [-1]: crossing.to } };
assert.equal(distanceTo(cw, [4, 0], 1, 0), 0);
assert.equal(distanceTo(cw, [5, 0], 1, 0), -1);
assert.equal(distanceTo(cw, [0, -6], 1, 0), 4);
assert.equal(distanceTo(cw, [0, 7], 1, 0) === null, true);
assert.equal(distanceTo(cw, [0, 0], 0, 1) === null, true);
assert.equal(distanceTo({ ends: { 1: [4, 0] } }, [0, 0], 1, 0) === null, true);
assert.equal(distanceTo({ ends: { 1: [Infinity, -2], [-1]: [Infinity, 2] } }, [0, 0], 1, 0) === null, true);
assert.equal(distanceTo(cw, null, 1, 0) === null, true);
assert.equal(frontTo(cw, null) === null, true);
const marked = { marked: [cw] };
assert.equal(crosswalksAlong(route, marked).length, 1);
assert.equal(crosswalksAlong(route, marked)[0].s, 4);
marked.marked.push({ id: "farther", ends: { 1: [2, -6], [-1]: [2, 6] } });
assert.equal(crosswalksAlong(route, marked).length, 2);
assert.equal(crosswalksAlong(route, marked)[0].cw.id, "farther");
assert.equal(crosswalksAlong({ ...route, cum: [0] }, marked).length, 0);
assert.equal(crosswalksAlong({}, marked).length, 0);

const stopped = { ego: new Vehicle(-3, 0), t: 0, crowd: { marked: [{}, cw] } };
noteStop(stopped);
assert.equal(stopped.crosswalkStop?.id, "c");
stopped.t = 1;
assert.equal(looked(stopped, cw), false);
stopped.t = 2;
assert.equal(looked(stopped, cw), true);
stopped.ego.v = 1;
noteStop(stopped);
assert.equal(stopped.crosswalkStop?.done, true, "a completed look remains valid while resuming");
stopped.ego.x = 4;
noteStop(stopped);
assert.equal(stopped.crosswalkStop, null, "once past the crossing the earlier look expires");
stopped.ego.x = -3;
stopped.ego.v = 0;
stopped.t = 3;
noteStop(stopped);
assert.equal(stopped.crosswalkStop?.since, 3);
stopped.t = NaN;
noteStop(stopped);
assert.equal(stopped.crosswalkStop === null, true);
stopped.t = 10;
noteStop(stopped);
stopped.ego.v = 0.5;
stopped.t = 11;
noteStop(stopped);
assert.equal(stopped.crosswalkStop, null, "resuming before two seconds cancels the stop");
stopped.ego.v = 0;
assert.equal(canStopShort(0, 3.5), true);
assert.equal(canStopShort(0, Infinity), false);
assert.equal(canStopShort(-Infinity, 4), false);
const unknownSpeed = new Vehicle(0, 2, 0, NaN);
const stationary = new Vehicle(0, -2, 0, 0);
const near = stoppedAt({}, cw, stopped.ego, [unknownSpeed, stationary]);
assert.equal(near.length, 1);
assert.equal(near[0] === stationary, true);
stationary.kind = "bike";
assert.equal(stoppedAt({}, cw, stopped.ego, [stationary]).length, 0);
stationary.kind = "car";
stationary.psi = Math.PI;
assert.equal(stoppedAt({}, cw, stopped.ego, [stationary]).length, 0, "opposing traffic is not passed");
stationary.psi = 0;
stationary.x = -7;
assert.equal(stoppedAt({}, cw, stopped.ego, [stationary]).length, 0);
assert.equal(
  stoppedAt({}, cw, stopped.ego, [stationary], false).length,
  1,
  "audit queries may include a stopped car that was passed",
);

const box = { center: [0, 0], heading: 0, halfLength: 2, halfWidth: 1 };
assert.equal(segmentHitsBox([0, 0], [0, 0], box), true);
assert.equal(segmentHitsBox([2, -3], [2, 3], box), true);
assert.equal(segmentHitsBox([2.01, -3], [2.01, 3], box), false);
assert.equal(segmentHitsBox([0, 0], [0, 0], { ...box, halfLength: -1 }), false);
assert.equal(segmentHitsBox([0, 0], [0, 0], { ...box, halfWidth: Infinity }), false);
assert.equal(segmentHitsBox([0, 0], [0, 0], { ...box, center: null }), false);
assert.equal(segmentHitsBox([-3, 0], [3, 0], { ...box, heading: NaN }), false);
const observer = { x: -5, y: 0 };
const walker = { x: 5, y: 0 };
assert.equal(hiddenByTraffic(observer, walker, [{ x: 0, y: 0 }]), false);
assert.equal(hiddenByTraffic(observer, walker, [{ x: 0, y: 0, obb: () => box }]), true);
const roadside = { x: 0, y: 0, parked: true, obb: () => box };
assert.equal(hiddenByTraffic(observer, walker, [roadside]), false);
assert.equal(
  hiddenByTraffic(observer, walker, [], [roadside]),
  true,
  "explicit standing blockers can hide a pedestrian",
);
const narrow = { x: 0, y: 0, obb: () => ({ ...box, halfWidth: 0.06 }) };
assert.equal(
  hiddenByTraffic(observer, walker, [narrow]),
  false,
  "a clear line to either side keeps the person visible",
);
assert.equal(hiddenByTraffic(observer, { x: 100, y: 0 }, [roadside]), false);
assert.equal(hiddenByTraffic(observer, walker, [{ ...roadside, parked: false, kind: "bike" }]), false);
assert.equal(hiddenByTraffic(observer, { x: NaN, y: 0 }, []), false);

const path = new RiderPath();
assert.equal(path.add("empty", [], false, null, ""), false);
assert.equal(
  path.add(
    "bad",
    [
      [0, 0],
      [NaN, 1],
    ],
    false,
    null,
    "",
  ),
  false,
);
assert.equal(path.add("bad", [[0, 0], null], false, null, ""), false);
assert.equal(path.add("bad", { length: 2 }, false, null, ""), false);
assert.equal(
  path.add(
    "point",
    [
      [0, 0],
      [0, 0],
    ],
    false,
    null,
    "",
  ),
  false,
);
assert.equal(
  path.add(
    "sign",
    [
      [0, 0],
      [30, 0],
    ],
    true,
    { setback: -1 },
    "",
  ),
  false,
);
assert.equal(path.segs.length, 0);
assert.equal(
  path.add(
    "opposite",
    [
      [0, 0],
      [30, 0],
    ],
    true,
    { setback: 4 },
    "far",
  ),
  true,
);
assert.equal(path.segs[0].line, 26);
assert.equal(comingOut({ path, spec: { length: 2, rearOverhang: 1 }, v: 1, stopS: null }, "opposite"), true);
const waiting = { path, spec: { length: 2, rearOverhang: 1 }, v: 0, held: true, stopS: null };
assert.equal(comingOut(waiting, "opposite"), false);
waiting.v = 1;
waiting.stopS = -1;
assert.equal(comingOut(waiting, "opposite"), false);
waiting.stopS = null;
path.s = 40;
assert.equal(
  comingOut(waiting, "opposite"),
  false,
  "a rider who has cleared the mouth no longer holds an entering car",
);
assert.equal(comingOut({}, "opposite"), false);
path.s = 0;
assert.equal(comingOut({ path, v: 1, stopS: null }, "opposite"), true);
assert.equal(comingOut({ path, v: 0, held: false, stopS: null }, "opposite"), true);
assert.equal(comingOut({ path, v: 1, stopS: null }, "another-block"), false);
assert.equal(contraflowOf(null, edge.id) === null, true);
assert.equal(contraControl(map, edge), null, "stale adjacency entries do not create a junction");
assert.equal(contraControl({ ...map, headingOut: () => Infinity }, edge) === null, true);
const disabled = new ContraflowRiders(world);
assert.equal(disabled.place({ edge: edge.id }) === null, true);
assert.equal(disabled.spawn() === null, true);
assert.equal(disabled.random === null, true);
const enabled = new ContraflowRiders(world, { enabled: true, count: 1.8 });
assert.equal(enabled.target, 1);
assert.equal(new ContraflowRiders(world, { enabled: true, count: Infinity }).target, 0);
assert.equal(enabled.place({ edge: edge.id, at: NaN }) === null, true);
assert.equal(enabled.place({ edge: edge.id, v: -1 }) === null, true);
assert.equal(enabled.place({ edge: edge.id, v0: Infinity }) === null, true);
assert.equal(enabled.made, 0);
assert.throws(() => enabled.step(NaN), /Invalid contraflow step/);
enabled.step(0);
assert.equal(enabled.made, 0);
assert.equal(enabled.place({ edge: edge.id, v: 0, v0: 4 })?.kind, "bike");
assert.equal(enabled.near(0, 0, -1).length, 0);
assert.equal(enabled.extend({ path: new RiderPath() }), false);
const noCenterline = new ContraflowRiders(
  { ...world, map: { ...map, edges: new Map([[edge.id, { ...edge, pts: null }]]) } },
  { enabled: true },
);
assert.equal(noCenterline.place({ edge: edge.id }) === null, true);
assert.equal(noCenterline.made, 0);
world.map.lane = () => null;
assert.equal(enabled.withLine(edge) === null, true);
const crossLine = {
  pts: [
    [0, 0],
    [100, 0],
  ],
  cum: [0, 100],
};
const crossPath = new RiderPath();
crossPath.add(
  "bike-path",
  [
    [45, -20],
    [45, 20],
  ],
  false,
  null,
  "to",
);
crossPath.s = 12;
const rider = { path: crossPath, v: 4 };
const approach = { front: 40, spec: CAR, v: 4 };
const conflict = riderConflict(rider, crossLine, approach);
assert.equal(conflict?.at, 45, "crossing trajectories can meet at the same time");
assert.equal(conflict?.meet, false, "a perpendicular trajectory is not an oncoming pass");
assert.equal(riderConflict(rider, crossLine, { ...approach, look: -1 }) === null, true);
assert.equal(riderConflict(rider, { ...crossLine, cum: [0] }, approach) === null, true);
rider.stopS = 13;
assert.equal(
  riderConflict(rider, crossLine, approach),
  null,
  "the rider stopping before the conflict gives the driver room",
);
crossPath.s = Infinity;
assert.equal(riderConflict(rider, crossLine, approach) === null, true);
assert.equal(riderConflict({}, crossLine, approach) === null, true);
const opposite = new RiderPath();
opposite.add(
  "incoming",
  [
    [65, 1.5],
    [42, 1.5],
  ],
  true,
  null,
  "from",
);
const roomCalls = [];
const room = (s) => {
  roomCalls.push(s);
  return 1;
};
const meeting = riderConflict({ path: opposite, v: 4 }, crossLine, { ...approach, room });
assert.equal(meeting?.meet, true);
assert.equal(meeting.shift > 0, true);
assert.equal(roomCalls.length, new Set(roomCalls).size, "the same sample does not probe room twice");
const parkingEdge = { ...edge, asphalt: [-4, 5], parking: [1, 2], lane_offsets: [1] };
assert.equal(rideLateral(parkingEdge), -2.4);
assert.equal(rideLateral(parkingEdge, "right"), 2.4);
assert.equal(Math.abs(roomRight(parkingEdge, 0, CAR) - 0.85) < 1e-9, true);
assert.equal(roomRight(parkingEdge, 0, { width: NaN }), 0);
const legs = [
  { id: edge.id, sStart: 25 },
  { id: edge.id, sStart: 50 },
  { id: "ordinary", sStart: 30 },
];
assert.equal(entriesAhead(map, legs, 20, 30).length, 1, "the look horizon excludes an entry exactly at its limit");
assert.equal(entriesAhead(map, legs, 20, 30)[0].start, 25);
assert.equal(entriesAhead(map, legs, 20, 0).length, 0);
assert.equal(entriesAhead(map, legs, 28, 20).length, 0, "a contraflow entry already behind the bumper is ignored");

console.log(`Pedestrian and cyclist boundaries checked in ${((performance.now() - start) / 1000).toFixed(3)} s`);
process.exit(0);
