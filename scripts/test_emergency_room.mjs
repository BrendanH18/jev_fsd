// Giving way to an emergency vehicle where the usual pull-over does not fit (Kitsilano's city suite):
// - beside cars parked close to a narrow lane's line, the plan pulls over only as far as they leave the
//   forward simulations' 0.3 m (otherwise every pull-over is rejected as a collision and the car stops
//   in the lane), and the audit takes a car that far over as pulled over (fog and rain s1-8);
// - in a lane short of the curb lane, with a vehicle alongside on the right closer than a lane's width,
//   the lane it would pull into is taken and stopping where it is, is yielding (snow s1-12);
// - told to drive on, the car still keeps still while the vehicle draws alongside to go round, as it may
//   turn across the car's nose (snow s1-11).
// node --experimental-default-type=module scripts/test_emergency_room.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, AMBULANCE, BUS } = await import("../static/js/sim/vehicle.js");
const { parkedRoom, PARKED_CLEAR_M } = await import("../static/js/sim/emergency.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");

// A two-way street, one 3.2 m lane each way and parking lanes, the car's lane centre at y = -1.6.
function street({ lanes = 1 } = {}) {
  const offsets = lanes === 1 ? [1.6] : [1.6, 4.8];
  const e = { id: "in", from: "w", to: "c", pts: [[-200, 0], [200, 0]], length: 400, lanes, lane_width: 3.2, lane_offsets: offsets,
    asphalt: [-5.3, lanes === 1 ? 5.3 : 8.5], parking: [2.1, 2.1], cls: "residential", limit: 11.1, oneway: false };
  const back = { ...e, id: "out", from: "c", to: "w", pts: [[200, 0], [-200, 0]], lanes: 1, lane_offsets: [1.6], asphalt: [-5.3, 5.3] };
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-220, -20, 220, 20], nodes: [{ id: "w", x: -200, y: 0 }, { id: "c", x: 200, y: 0 }],
    edges: [e, back], lanes: [...offsets.map((o, k) => ({ edge: "in", idx: k, pts: [[-200, -o], [200, -o]] })), { edge: "out", idx: 0, pts: [[200, 1.6], [-200, 1.6]] }],
    intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  world.route = new Route({ id: "r", polyline: [[-200, -1.6], [200, -1.6]], edges: ["in"], turns: [] }, map);
  return { map, world };
}
// An ambulance coming up behind in the other lane, drawing level with the car at 10 s.
function ambulance(world) {
  const pts = [[-200, 1.6], [200, 1.6]];
  const ev = Object.assign(new Vehicle(world.ego.x - 60, 1.6, 0, 6, AMBULANCE), { id: "ambulance", kind: "ambulance", siren: true,
    path: { pts, cum: cumulative(pts), length: 400, s: world.ego.x - 60 + 200 } });
  world.npcs.push(ev);
  return ev;
}
function passBy(world, ev) {
  const middle = world.ego.spec.length / 2 - world.ego.spec.rearOverhang;
  for (let k = 0; k <= 20; k++) {
    world.t = k * 0.5;
    ev.x = world.ego.x + middle + (k - 19.5) * 3 + ev.spec.length / 2 - ev.spec.rearOverhang; ev.path.s = ev.x + 200;
    world.auditEmergency(world.roadInfo());
  }
  return world.violations.failed_to_yield;
}
function parkBeside(world, right) {
  // a car at the kerb from 6 m behind to 6 m ahead of the car, its body reaching to `right` m right of the lane's centre
  for (const dx of [-6, 0, 6]) {
    const c = new Vehicle(world.ego.x + dx, 0, 0, 0); c.id = `parked_${dx}`; c.edge = "in"; c.curb = "right";
    c.y = -1.6 - right - c.obb().halfWidth;
    world.parked.add(c);
  }
}

{
  // Cars parked close to the line: their bodies 1.55 m right of the lane's centre.
  const { world } = street();
  world.placeOnLane(world.map.lane("in", 0), 0);
  parkBeside(world, 1.55);
  const room = parkedRoom(world, world.ego.x + 1.4, -1.6, 0, world.ego.spec);
  assert.ok(Math.abs(room - (1.55 - world.ego.spec.width / 2 - PARKED_CLEAR_M - 0.05)) < 0.02, `room beside them ${room.toFixed(2)} m`);
  assert.ok(room < 0.3, "less than the usual pull-over");
  // (a car parked only further ahead counts when the stretch ahead it pulls over into is asked for)
  assert.equal(parkedRoom(world, world.ego.x - 20, -1.6, 0, world.ego.spec), Infinity, "20 m back, none beside it");
  assert.ok(parkedRoom(world, world.ego.x - 20, -1.6, 0, world.ego.spec, 8) < 0.3, "with 8 m more ahead, the first of them");
  // (the plan aims no further)
  world.ego.v = 6;
  const ev = ambulance(world);
  const snap = buildSnapshot(world);
  assert.ok(snap.emergency.offset_m <= room + 1e-6, `aims ${snap.emergency.offset_m.toFixed(2)} m over`);
  // (the audit: that far over, less the usual settling allowance, is pulled over; in the lane's centre is not)
  world.ego.v = 0; world.ego.y = -1.6 - (room - 0.08);
  assert.equal(passBy(world, ev), 0, "pulled over as far as the parked cars allow");
}
{
  const { world } = street();
  world.placeOnLane(world.map.lane("in", 0), 0);
  parkBeside(world, 1.55);
  const ev = ambulance(world);
  assert.equal(passBy(world, ev), 1, "staying in the lane's centre beside them is not");
}
{
  // Two lanes the car's way, the car stopped in the left one, a bus alongside in the right lane.
  const { world } = street({ lanes: 2 });
  world.placeOnLane(world.map.lane("in", 0), 0);
  const bus = Object.assign(new Vehicle(world.ego.x - 3, -4.8 - 0.3, 0, 0, BUS), { id: "bus_1" });
  world.npcs.push(bus);
  const ev = ambulance(world);
  assert.equal(passBy(world, ev), 0, "the lane it would pull into is taken: stopping is yielding");
}
{
  const { world } = street({ lanes: 2 });
  world.placeOnLane(world.map.lane("in", 0), 0);
  const ev = ambulance(world);
  assert.equal(passBy(world, ev), 1, "with the right lane free, staying in the left lane is not");
}
{
  // Told to drive on (pulled over, the vehicle stuck behind), then the vehicle draws alongside.
  const { world } = street();
  world.placeOnLane(world.map.lane("in", 0), 0);
  world.ego.y = -1.6 - 0.3;
  const ev = ambulance(world);
  ev.x = world.ego.x - 12; ev.path.s = ev.x + 200;
  world.auditEmergency(world.roadInfo());
  // (the audit's drive-on latch, as World.auditEmergency sets it for a car pulled over that holds it up)
  world.evCalls.get(ev.id).lead = true;
  assert.equal(buildSnapshot(world).emergency?.lead, true, "told to drive on");
  ev.x = world.ego.x - 2; ev.path.s = ev.x + 200;
  const snap = buildSnapshot(world);
  assert.equal(snap.emergency?.alongside, true, "the vehicle alongside, going round");
  assert.equal(snap.emergency.lead, false, "the car does not lead off beside it");
  assert.equal(snap.emergency.bumper_to_stop_m, 0, "it keeps still where it is");
}
console.log("Emergency yields beside parked cars, boxed in on the right, and with the vehicle alongside");
process.exit(0);
