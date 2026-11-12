// Calgary city seed 2, s2-1: a school bus turning left from the left lane of 11 Avenue SW (e478) into
// 7 Street SW (e546) swung its nose out over the parking lane, saw the car parked 6 m past the corner
// in the way, and stood in the junction for good: everything behind it, the driven car, an ambulance
// and a fire truck, stood too. A long vehicle's front corner sweeps far wider than its rear axle's path
// (rolled on its own model, a school bus's sweeps an 11.5 m circle), so no corner rounding lets it in.
// Once its lane changes are done, while there is room, a school bus whose next turn would sweep over a
// parked car goes the gentlest other way instead (here straight on, e479); with nothing parked there it
// still turns.
// node --experimental-default-type=module scripts/test_school_bus_corner.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");

const key = "a53c5bcf6438";
const map = new MapData(JSON.parse(fs.readFileSync(new URL(`../data/maps/${key}.v6.pack.json`, import.meta.url))));

function drive(parkedAtCorner) {
  const world = new World(map, { seed: 1, parked: 0, pedestrians: 0 });
  // (near enough that the fleet keeps the bus, off its way)
  Object.assign(world.ego, { x: -240, y: 420 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 3 });
  fleet.nextPull = fleet.nextPark = Infinity;
  // (where parked_1922 stood: its body's centre, heading south in 7 Street's west parking lane)
  let parked = null;
  if (parkedAtCorner) {
    const psi = -93.2 * Math.PI / 180, back = CAR.length / 2 - CAR.rearOverhang;
    parked = Object.assign(new Vehicle(-286.03 - Math.cos(psi) * back, 354.48 - Math.sin(psi) * back, psi, 0), { id: "parked_corner", edge: "e546", curb: "right" });
    world.parked.add(parked);
  }
  // in the left lane, planning the left turn, as the bus was once its lane change was done
  const bus = fleet.addSchoolBus(map.lane("e478", 0), 120, 6, [["e546", 0]]);
  bus.school.every = Infinity;
  let touched = false, turned = false, gaveUp = false, stood = 0;
  for (let k = 0; k < 90 * 60; k++) {
    fleet.step(1 / 60); world.t += 1 / 60;
    if (parked) touched ||= obbOverlap(bus.obb(), parked.obb(), 0);
    if (bus.path.edges.some((e) => e.id === "e479")) gaveUp = true;
    if (bus.y < 330) turned = true;
    if (Math.abs(bus.x + 280) < 8 && Math.abs(bus.y - 364) < 8 && bus.v < 0.1) stood += 1 / 60;
    if (bus.x < -330 || turned) break;
  }
  return { touched, turned, gaveUp, stood, x: bus.x };
}

const blocked = drive(true);
assert.equal(blocked.touched, false, "the bus never touches the car parked by the corner");
assert.equal(blocked.turned, false, "it does not turn into 7 Street over the parked car");
assert.equal(blocked.gaveUp, true, "it goes straight on along 11 Avenue instead");
assert.ok(blocked.x < -330, `it carries on through the junction: x=${blocked.x.toFixed(1)}`);
assert.ok(blocked.stood < 30, `it does not stand in the junction: ${blocked.stood.toFixed(1)} s`);
console.log("✓ a school bus whose left turn would sweep over a car parked by the corner goes straight on");
const clear = drive(false);
assert.equal(clear.turned, true, "with nothing parked there it turns left into 7 Street");
assert.equal(clear.gaveUp, false);
console.log("✓ with the corner clear it still turns");
process.exit(0);
