import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const start = performance.now();
globalThis.document = { querySelector: () => null };
const { CAR, Vehicle } = await import("../static/js/sim/vehicle.js");
const { ParkedCars, releaseSlot, reserveAvailableSlots, reserveSlot } = await import("../static/js/sim/parking.js");
const {
  ParkPlanner,
  blockerOut,
  freeStretches,
  leftSpace,
  legalStretches,
  parkingObstructed,
  parkRoom,
  planSpaceOn,
  solveS,
  spacesAlong,
  stepParking,
  straight,
} = await import("../static/js/sim/parallel-park.js");
const { auditParkers, commitParker, createParkers, manageParkers, parkerConflict, parkerSensing } = await import(
  "../static/js/sim/parkers.js"
);

const edge = {
  id: "right",
  from: "west",
  to: "east",
  length: 90,
  pts: [
    [0, 0],
    [90, 0],
  ],
  cum: [0, 90],
  asphalt: [-3.2, 5.2],
  parking: [0, 2],
};
const map = { edges: new Map([[edge.id, edge]]), inn: new Map(), out: new Map() };
const slot = { edge: edge.id, x: 12, y: -3, occupant: null, reserved: null };
const owner = {};
const rival = {};
const initial = reserveSlot(map, slot, owner);
assert.equal(initial.owner === owner, true);
assert.equal(initial.sFrom, 12 - CAR.rearOverhang - 0.5);
assert.equal(initial.sTo, 12 - CAR.rearOverhang + CAR.length + 0.5);
assert.throws(() => reserveSlot(map, slot, null), /requires an owner/);
assert.throws(() => reserveSlot(map, slot, "unowned"), /requires an owner/);
assert.throws(() => reserveSlot(map, null, owner), /requires a bay/);
assert.throws(() => reserveSlot(map, { ...slot, edge: "absent" }, owner), /Unknown parking bay edge/);
const unmappedKerb = { ...map, edges: new Map([[edge.id, { pts: [], cum: [] }]]) };
assert.throws(() => reserveSlot(unmappedKerb, slot, owner), /no projectable kerb/);
assert.throws(() => reserveSlot(map, { ...slot, x: Infinity }, owner), /coordinates must be finite/);
assert.throws(() => reserveSlot(map, slot, owner, { spec: { rearOverhang: -1 } }), /nonnegative rear overhang/);
assert.throws(() => reserveSlot(map, slot, owner, { spec: { rearOverhang: 1, length: 1 } }), /length greater/);
assert.throws(() => reserveSlot(map, slot, owner, { sFrom: 20, sTo: 10 }), /increasing finite span/);
assert.throws(() => reserveSlot(map, slot, owner, { sFrom: 2, sTo: 2 }), /increasing finite span/);
assert.throws(() => reserveSlot(map, slot, owner, { sFrom: 0, sTo: Infinity }), /increasing finite span/);
assert.throws(() => reserveSlot(map, slot, owner, { sFrom: NaN, sTo: 12 }), /increasing finite span/);
assert.equal(slot.reserved === initial, true, "invalid replacement leaves the prior record intact");
const frontOnly = reserveSlot(map, slot, owner, { spec: { rearOverhang: 2 }, sTo: 17 });
assert.equal(frontOnly.sFrom, 9.5, "the custom overhang locates the inferred rear endpoint");
const explicit = reserveSlot(null, slot, rival, { spec: null, sFrom: -1, sTo: 91 });
assert.equal(explicit.sFrom, -1, "bumper clearance may extend past an edge endpoint");
assert.equal(explicit.sTo, 91);
assert.equal(releaseSlot(slot, owner), false);
assert.equal(slot.reserved === explicit, true);
assert.equal(releaseSlot(slot, rival), true);
assert.equal(slot.reserved === null, true);
assert.equal(releaseSlot(slot, rival), false);
const occupied = { ...slot, occupant: rival };
const taken = { ...slot, reserved: explicit };
reserveAvailableSlots(map, [slot, occupied, taken], owner);
assert.equal(slot.reserved?.owner === owner, true);
assert.equal(occupied.reserved === null, true);
assert.equal(taken.reserved === explicit, true);
releaseSlot(slot, owner);

const parked = new ParkedCars(map, { density: 0 });
assert.throws(() => parked.add(new Vehicle(NaN, 0)), /finite center/);
assert.equal(parked.list.length, 0);
assert.equal(parked.remove(null), false);
const car = new Vehicle(26, 26);
const other = new Vehicle(-30, 26);
const third = new Vehicle(-28, -30);
parked.add(car);
parked.add(other);
parked.add(third);
assert.throws(() => parked.move(car, Infinity, 0), /finite destination/);
assert.equal(car.x, 26);
assert.equal(parked.near(26, 26, 5)[0] === car, true);
const all = parked.near(0, 0, 1e8);
assert.equal(all.length, 3);
assert.equal(all[0] === third && all[1] === other && all[2] === car, true);
const old = parked.openDoor(car, { duration: 1 });
assert.throws(() => parked.step(NaN), /Invalid parked car step/);
assert.equal(old.t, 0);
parked.step(0);
assert.equal(old.angle, 0);
car.door = null;
const replacement = parked.openDoor(car, { duration: 2 });
parked.step(1, { ego: car });
assert.equal(parked.activeDoors.length, 1);
assert.equal(car.door === replacement, true);
parked.near = () => {
  throw new Error("a fast car has no eligible door event in range");
};
parked.nextDoor = 0;
car.v = 40;
parked.step(0.1, { ego: car });
assert.equal(parked.nextDoor >= 12 && parked.nextDoor <= 28, true, "a missed door event still resets its timer");
car.v = 0;
const doorPool = new ParkedCars(map, { density: 0 });
const watcher = new Vehicle(0, 0);
const staying = new Vehicle(20, -3);
staying.stay = true;
const opened = new Vehicle(24, -3);
const eligible = new Vehicle(28, -3);
for (const candidate of [staying, opened, eligible]) doorPool.add(candidate);
doorPool.openDoor(opened);
const projections = [];
watcher.toLocal = (x, y) => {
  projections.push(x);
  return { ahead: x, right: -y };
};
doorPool.nextDoor = 0;
doorPool.step(0.1, { ego: watcher });
assert.equal(projections.join(","), "28");
assert.equal(!!eligible.door, true);

assert.throws(() => solveS(0, 5, 2), /turn radius/);
assert.throws(() => solveS(5, 5, 21), /outside the arc range/);
assert.throws(() => solveS(5, 5, -1), /outside the arc range/);
assert.throws(() => solveS(5, -1, 1), /longitudinal move/);
assert.equal(solveS(5, 6, 0).X, 0);
assert.equal(solveS(5, 6, 0.01).d, 0, "a sub-minimum full-lock angle cannot have a negative straight leg");
const loose = solveS(5, Infinity, 2);
assert.equal(solveS(5, 1, 2).X, loose.X, "insufficient room still reports the shortest feasible displacement");
const longer = solveS(5, loose.X + 0.5, 2);
const rebuilt = 2 * 5 * (1 - Math.cos(longer.phi1)) + longer.d * Math.sin(longer.phi1);
assert.equal(Math.abs(rebuilt - 2) < 1e-10, true, "the two arcs and straight recover the requested lateral shift");
assert.equal(Math.abs(longer.X - loose.X - 0.5) < 1e-10, true, "the longitudinal result matches the supplied room");
assert.equal(straight(edge, 4, 3), false);
assert.equal(straight(edge, 100, 120), false);
assert.equal(straight(edge, -2, 1), true);
assert.equal(straight(edge, 87, Infinity), false);
const bend = {
  ...edge,
  pts: [
    [0, 0],
    [4, 0],
    [4, 4],
  ],
  cum: [0, 4, 8],
};
assert.equal(straight(bend, 0, 8), false);
assert.equal(straight(bend, 4.1, 8), true, "a bend behind the space does not rule out the straight part");
assert.equal(spacesAlong({}, null, CAR).length, 0);
assert.equal(planSpaceOn({}, {}, edge, 9, 9, CAR, []) === null, true);
const lane = {
  pts: [
    [0, -1.6],
    [90, -1.6],
  ],
  cum: edge.cum,
};
const ordinaryPlan = planSpaceOn({ parked }, lane, edge, 5, 40, CAR, []);
assert.equal(ordinaryPlan !== null, true);
const outerCorner = planSpaceOn({ parked }, lane, edge, 5, 40, CAR, [[40, 45, -20]]);
assert.equal(Number.isFinite(outerCorner?.endU), true);
const tooCloseToKerb = {
  pts: [
    [0, -4.5],
    [90, -4.5],
  ],
  cum: edge.cum,
};
assert.equal(planSpaceOn({ parked }, tooCloseToKerb, edge, 5, 40, CAR, []) === null, true);
assert.equal(parkingObstructed({}, edge.id), false);
assert.equal(parkingObstructed({ workZones: { zones: [{ open: edge.id }] } }, edge.id), true);
assert.equal(parkingObstructed({ workZones: { zones: [{ closed: edge.id }] } }, edge.id), true);
assert.equal(parkingObstructed({ laneClosures: { zones: [{ edge: edge.id }] } }, edge.id), true);
assert.equal(parkingObstructed({ doubleParked: { vans: [{ opposite: edge.id }] } }, edge.id), true);
assert.equal(parkingObstructed({ laneClosures: { zones: [{ edge: "next" }] } }, edge.id), false);

const twin = { id: "twin", from: edge.to, to: edge.from };
const zonedEdge = { ...edge, control: { s_line: 80 } };
const zoning = {
  ...map,
  edges: new Map([
    [edge.id, zonedEdge],
    [twin.id, twin],
  ]),
  out: new Map([[edge.from, ["unloaded", edge.id]]]),
  crosswalks: [
    { edge: edge.id, x: NaN, y: 0 },
    { edge: twin.id, x: 40, y: 0 },
  ],
};
const legal = legalStretches(zoning, zonedEdge);
assert.equal(legal.length, 2);
assert.equal(legal[0][0], 0);
assert.equal(legal[0][1], 32.5, "a marked crossing on the opposite edge includes the near-side approach buffer");
assert.equal(legal[1][0], 41.5, "the approach buffer is not added after the crossing");
assert.equal(legal[1][1], 74, "the foremost spot stops short of a control line");
assert.equal(legalStretches(zoning, null).length, 0);
const noRight = { ...edge, id: "left-only", parking: [2, 0] };
assert.equal(legalStretches(zoning, noRight).length, 0);
assert.equal(legalStretches(zoning, { ...edge, id: "ring", ring: true }).length, 0);
const thick = { id: "thick", from: edge.from, to: "north", asphalt: [-6, 6] };
const thin = { id: "thin", from: edge.from, to: "south", asphalt: [-2, 2] };
const corner = {
  ...map,
  edges: new Map([
    [edge.id, edge],
    [thick.id, thick],
    [thin.id, thin],
  ]),
  out: new Map([[edge.from, [edge.id, thick.id, thin.id, "absent"]]]),
};
assert.equal(legalStretches(corner, edge)[0][0], 9.1, "the widest street governs the corner parking setback");
const populated = new ParkedCars(corner, { seed: 54, density: 1 });
const noLength = new ParkedCars({ ...map, edges: new Map([[edge.id, { ...edge, cum: [0, Infinity] }]]) });
assert.equal(noLength.slots.length, 0);
assert.equal(
  populated.slots.some((bay) => bay.edge === edge.id),
  true,
);
const planning = { map: zoning, ego: car, parked: { slots: [{ ...slot, curb: "right" }] }, obstaclesNear: () => [] };
const bay = planning.parked.slots[0];
reserveSlot(null, bay, rival, { sFrom: 16, sTo: 22 });
const free = freeStretches(planning, zonedEdge, CAR);
assert.equal(free.length, 3);
assert.equal(free[0].b, 16);
assert.equal(free[1].a, 22);
assert.equal(freeStretches(planning, zonedEdge, { ...CAR, length: 40 }).length, 0);

const probe = {
  map: { roadDistance: () => ({ distance: NaN }) },
  obstaclesNear: () => [],
};
assert.equal(parkRoom(car, probe, 0, 1), false, "undefined road distance cannot approve a parking move");
assert.equal(parkRoom(car, null, Infinity, 1), false);
assert.equal(parkRoom(car, null, 0, NaN), false);
probe.map.roadDistance = () => ({ distance: 0 });
probe.obstaclesNear = () => [{ v: 0 }];
assert.equal(parkRoom(car, probe, 0, 1), true, "a nonphysical marker has no body to check");
const obstruction = new Vehicle(car.x + 2, car.y);
probe.obstaclesNear = () => [obstruction];
assert.equal(parkRoom(car, probe, 0, 1), false);
obstruction.v = 0.6;
assert.equal(parkRoom(car, probe, 0, 1), true, "an advancing obstacle is handled by the driving safety check");
probe.staticObstacles = { sweep: () => true };
assert.equal(parkRoom(car, probe, 0, 1), false, "scenery stops the maneuver independently of traffic");
probe.staticObstacles = null;
probe.obstaclesNear = () => [];
probe.map.roadDistance = (x) => ({ distance: Math.max(0, x * 0.02) });
assert.equal(parkRoom(car, probe, 0, 1), false);
assert.equal(parkRoom(car, probe, 0, -1), true, "recovery may bring a tyre back toward the asphalt");

const parkedEgo = new Vehicle(0, 0);
const beside = new Vehicle(0, 3);
beside.id = "beside";
const pullOut = { ego: parkedEgo, visibleObstaclesNear: () => [beside] };
const spot = { kerbW: 5, laneW: 1 };
assert.equal(blockerOut(pullOut, spot), "beside");
beside.y = -3;
assert.equal(blockerOut(pullOut, spot), null, "a stopped car on the curb side does not block a left pull-out");
beside.y = 3;
beside.x = -22;
beside.v = 5;
assert.equal(blockerOut(pullOut, spot), "beside", "traffic approaching within the distance threshold holds a pull-out");
beside.x = -35;
beside.v = 1;
assert.equal(blockerOut(pullOut, spot), null, "a distant slow vehicle does not hold a pull-out");

const law = { mode: "out", id: "space:out", phase: "out_wait", idle: 0, kerbW: 3, laneW: 0 };
assert.equal(stepParking(null, law, null, 0), true);
assert.equal(law.idle, 0);
assert.throws(() => stepParking(null, law, null, -0.01), /Invalid parking step/);
assert.equal(stepParking(null, { ...law, phase: "done" }, null, 0), false);
const unknownPhase = { ...law, phase: "constructor", ox: 0, oy: 0, h: 0, R: 5, startW: 1 };
assert.equal(
  stepParking(car, unknownPhase, null, 0.02, () => 0),
  true,
);
assert.equal(unknownPhase.phase, "constructor");
const planner = new ParkPlanner();
const parkedOut = { ego: car, route: {}, parking: law, visibleObstaclesNear: () => [] };
assert.equal(planner.update(parkedOut, 0, 0.1).id, law.id);
assert.equal(parkedOut.park.status, "waiting");
assert.equal(law.go, true);
const orphan = { ego: car, route: {}, parking: { phase: "in1" }, parkAtGoal: true, parkHold: 25 };
assert.equal(planner.update(orphan, 0, 0.1) === null, true);
assert.equal(orphan.parking === null, true);
assert.equal(orphan.parkHold, 0);
const route = { length: 30 };
const none = { ego: car, route, parkAtGoal: true, parkHold: 10, park: { status: "none", route } };
assert.equal(planner.update(none, 0, 0.1).status, "none");
assert.equal(none.parkHold, 0);

const departure = { ego: { x: NaN, y: 0 }, parkedIn: { at: [0, 0], slots: [slot] } };
reserveSlot(map, slot, departure.ego);
leftSpace(departure);
assert.equal(slot.reserved.owner === departure.ego, true);
departure.ego.x = 10;
leftSpace(departure);
assert.equal(slot.reserved === null, true);
assert.equal(departure.parkedIn === null, true);
const newDeparture = { ego: car, parkedIn: { at: [0, 0], slots: [slot] } };
reserveSlot(map, slot, rival);
leftSpace(newDeparture);
assert.equal(slot.reserved?.owner === rival, true, "departure does not clear a newer reservation");
releaseSlot(slot, rival);

const plan = { id: "bay", startU: 40, startW: 1, laneW: 1, hold: 8, ox: 0, oy: 0, h: 0, slots: [slot] };
const traffic = { map, t: 25, parkers: createParkers({ enabled: true }) };
const malformed = { ...plan, slots: [slot, { edge: "missing" }] };
assert.throws(() => commitParker(traffic, car, malformed), /Unknown parking bay edge/);
assert.equal(slot.reserved === null, true);
assert.equal(car.parker, undefined);
assert.equal(traffic.parkers.committed, 0);
const committed = commitParker(traffic, car, plan);
assert.equal(commitParker(traffic, car, { ...plan, id: "other" }) === committed, true);
assert.equal(traffic.parkers.active.length, 1);
assert.equal(traffic.parkers.committed, 1);
assert.equal(car.signal, "right");
assert.equal(parkerConflict(traffic, other, edge, NaN) === null, true);
assert.equal(parkerConflict(traffic, other, edge, 1, { lat: NaN }) === null, true);
assert.equal(parkerSensing(traffic, null, 0) === null, true);
assert.equal(manageParkers({}, null), undefined);
assert.equal(auditParkers({}), undefined);
const stale = { ego: car, route: edge, parkers: { active: [other] }, events: [] };
auditParkers(stale);
assert.equal(stale.events.length, 0);
reserveSlot(map, slot, rival);
manageParkers(traffic, { vehicles: [] });
assert.equal(slot.reserved.owner === rival, true);
assert.equal(traffic.parkers.active.length, 0);
assert.equal(car.signal === null, true);

console.log(`Parking boundaries checked in ${((performance.now() - start) / 1000).toFixed(3)} s`);
process.exit(0);
