// Reservations made by the other free-drive features must be safe for traffic's parking planner.
// Run with Node 22: node --experimental-default-type=module scripts/test_parking_reservations.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { freeStretches } = await import("../static/js/sim/parallel-park.js");
const { parkerPlan } = await import("../static/js/sim/parkers.js");
const { cloneState } = await import("../static/js/lab/recorder.js");

const root = new URL("../data/maps/", import.meta.url), key = "623b012bc8b5";
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
  if (url) pack[name] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack);

// Original failure: a driveway reserved a bay with "driveway", and taken() read its vehicle spec.
// This is the world combination used by free drives, not a hand-written reservation fixture.
const world = new World(map, { seed: 21, pedestrians: 0, parkers: true, driveways: true });
const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 4 });
const reserved = world.parked.slots.filter(s => s.reserved && s.curb === "right");
assert.equal(reserved.length > 0, true, "mapped driveways reserve parking bays");
let planned = 0;
for (const id of new Set(reserved.map(s => s.edge))) {
  const edge = map.edges.get(id), lane = map.lane(id, edge.lanes - 1);
  const p = pointAt(lane.pts, lane.cum, 2), n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, 2), 5);
  n.path = new NpcPath(map, fleet.random); n.path.start(id, lane.idx, 2);
  const spaces = freeStretches(world, edge, CAR);
  const plan = parkerPlan(world, n);
  if (plan) planned++;
  for (const slot of reserved.filter(s => s.edge === id)) {
    const r = slot.reserved;
    assert.equal(typeof r, "object");
    assert.equal(!!r.owner && Number.isFinite(r.sFrom) && r.sFrom < r.sTo, true, "a reservation states its owner and kerb span");
    assert.equal(spaces.every(s => s.b <= r.sFrom || s.a >= r.sTo), true, "a traffic car leaves driveway reservations clear");
    assert.equal(plan?.plan.slots.includes(slot) || false, false, "a traffic car never plans a reserved bay");
  }
}
assert.equal(planned > 0, true, "traffic can still find parking on blocks with driveways");
console.log(`✓ traffic parking plans around ${reserved.length} driveway reservations without throwing`);

const { reserveSlot } = await import("../static/js/sim/parking.js");
const slot = world.parked.slots.find(s => s.curb === "right" && !s.occupant && !s.reserved);
assert.equal(!!slot, true);
const edge = map.edges.get(slot.edge), owner = new Vehicle(slot.x, slot.y, slot.psi, 0);
const s = projectPoint(edge.pts, edge.cum, [slot.x, slot.y]).s;
reserveSlot(map, slot, owner);
assert.equal(slot.reserved.owner === owner, true);
assert.equal(slot.reserved.sFrom, s - owner.spec.rearOverhang - 0.5);
assert.equal(slot.reserved.sTo, s - owner.spec.rearOverhang + owner.spec.length + 0.5);
console.log("✓ vehicle reservations keep their previous bumper clearance");

// A reservation's span belongs to the bay's own direction, including opposite-side work-zone bays.
// The owner need not be a vehicle; readers never infer dimensions from its identity.
const plain = new World(map, { seed: 21, pedestrians: 0, parked: 0 });
plain.parked.slots.push(slot);
reserveSlot(map, slot, { id: "kerb-work" }, { sFrom: 0, sTo: edge.length });
assert.equal(freeStretches(plain, edge, CAR).length, 0);
reserveSlot(map, slot, plain.ego, { sFrom: 0, sTo: edge.length });
assert.equal(freeStretches(plain, edge, CAR).length > 0, true, "the car ignores its own parking reservation");
plain.park = { slots: [slot] };
plain.resetContactHistory();
assert.equal(slot.reserved, null, "moving the car releases its own bays");
console.log("✓ explicit kerb spans block other drivers and release for their owner");

// Checkpoint cloning keeps owner and slot identity together, so release still finds the restored car.
reserveSlot(map, slot, owner);
const copy = cloneState({ slot, owner });
assert.equal(copy.slot.reserved.owner === copy.owner, true);
assert.equal(copy.owner === owner, false);
assert.deepEqual([copy.slot.reserved.sFrom, copy.slot.reserved.sTo], [slot.reserved.sFrom, slot.reserved.sTo]);
console.log("✓ checkpoint copies preserve reservation ownership and span");
process.exit(0);
