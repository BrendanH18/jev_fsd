// Pulling over for an emergency vehicle beside a car waiting at the kerb to pull out (Toronto city,
// seed 2, s2-2, Sussex Avenue). A car about to pull out leaves `world.parked` for traffic (sim/npc.js
// `startPullOut`) while it still stands in its space. The pull-over took that space for free kerb,
// aimed into it and stopped angled, its nose 1 m behind the waiting car: that car will not pull out
// with a car stopped so close, and the car would not pull away into it. Both waited for 516 deadlock
// recoveries. A car waiting at the kerb is parked for the pull-over (`kerbCars`, sim/emergency.js):
// the plan pulls over only to the edge of the lane beside it, as beside a parked car.
// node --experimental-default-type=module scripts/test_emergency_kerb_pullout.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { Vehicle, AMBULANCE } = await import("../static/js/sim/vehicle.js");
const { parkedRoom, kerbCars, PULL_INTO_PARKING_M } = await import("../static/js/sim/emergency.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");

// A two-way street, one 3.2 m lane each way and parking lanes, the car's lane centre at y = -1.6 and
// the right parking lane's centre at y = -4.25.
function street() {
  const e = { id: "in", from: "w", to: "c", pts: [[-200, 0], [200, 0]], length: 400, lanes: 1, lane_width: 3.2, lane_offsets: [1.6],
    asphalt: [-5.3, 5.3], parking: [2.1, 2.1], cls: "residential", limit: 11.1, oneway: false };
  const back = { ...e, id: "out", from: "c", to: "w", pts: [[200, 0], [-200, 0]] };
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-220, -20, 220, 20], nodes: [{ id: "w", x: -200, y: 0 }, { id: "c", x: 200, y: 0 }],
    edges: [e, back], lanes: [{ edge: "in", idx: 0, pts: [[-200, -1.6], [200, -1.6]] }, { edge: "out", idx: 0, pts: [[200, 1.6], [-200, 1.6]] }],
    intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  world.route = new Route({ id: "r", polyline: [[-200, -1.6], [200, -1.6]], edges: ["in"], turns: [] }, map);
  world.placeOnLane(map.lane("in", 0), 100);
  world.ego.v = 6;
  // an ambulance coming up behind in the other lane
  const pts = [[-200, 1.6], [200, 1.6]];
  world.npcs.push(Object.assign(new Vehicle(world.ego.x - 60, 1.6, 0, 6, AMBULANCE), { id: "ambulance", kind: "ambulance", siren: true,
    path: { pts, cum: cumulative(pts), length: 400, s: world.ego.x - 60 + 200 } }));
  return world;
}
// A car in the right parking lane just ahead of where the car stops for the ambulance.
function kerbCar(world, stopX) {
  const c = new Vehicle(stopX + 1, -4.25, 0, 0);
  c.id = "car_p1"; c.edge = "in"; c.curb = "right";
  return c;
}

const clear = buildSnapshot(street()).emergency;
assert.ok(clear && clear.stop_s_route !== null, "the car stops for the ambulance");
assert.equal(clear.offset_m, PULL_INTO_PARKING_M, "with the kerb free, it pulls over into the parking lane");
const stopX = clear.stop_s_route - 200;

// The same car parked there, and waiting there to pull out: the same pull-over, beside it.
const parkedWorld = street();
parkedWorld.parked.add(kerbCar(parkedWorld, stopX));
const parked = buildSnapshot(parkedWorld).emergency;
assert.ok(parked.offset_m < 0.5, `beside a parked car it keeps to its lane (${parked.offset_m.toFixed(2)} m over)`);

const world = street();
const waiting = Object.assign(kerbCar(world, stopX), { pull: { lat: 2.65, t: 0, T: 3.5, wait: 1 } });
world.npcs.push(waiting);
assert.equal(kerbCars(world, waiting.x, waiting.y, 5).filter((c) => c.id === "car_p1").length, 1, "a car waiting to pull out stands at the kerb");
const beside = buildSnapshot(world).emergency;
assert.ok(Math.abs(beside.offset_m - parked.offset_m) < 1e-9, `beside one waiting to pull out, the same (${beside.offset_m.toFixed(2)} m over)`);
const room = (w) => parkedRoom(w, stopX + 1, -1.6, 0, w.ego.spec);
assert.ok(Math.abs(room(world) - room(parkedWorld)) < 1e-9 && Number.isFinite(room(world)), "the audit's room beside it is the parked car's");

// Once it is moving off, it is traffic, no longer at the kerb.
waiting.pull.moving = true; waiting.v = 1;
assert.equal(kerbCars(world, waiting.x, waiting.y, 5).length, 0, "a car moving off is not at the kerb");
assert.equal(room(world), Infinity, "nor in the audit's room");
console.log(`A car waiting to pull out is pulled over beside as a parked car (${beside.offset_m.toFixed(2)} m over, not ${PULL_INTO_PARKING_M} m)`);
process.exit(0);
