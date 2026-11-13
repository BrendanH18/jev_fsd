// A snow plow keeps to the main streets it works wherever the streets let it (Kitsilano city, snow, seed 1,
// s1-12). Plows are put down on primary, secondary and tertiary streets, but `NpcPath.extend` let them turn
// onto any street. On Kitsilano's residential streets (3.2 m lanes, 2.1 m parking lanes) a car parked at
// the kerb stands 2.5 m from the lane's middle, inside the 2.55 m a 2.6 m plow counts as in its way
// (sim/npc.js leader test): `plow_1` turned onto West 5th Avenue and stopped 3 m behind `parked_1263` for
// good, and `car_p2` (pulled out of the kerb behind it), then the driven car, queued behind for 670 s. A
// plow's path now keeps to PLOW_CLASSES where a junction offers one (NpcPath `classes`), with the same one
// random draw per turn; where none goes on, it takes what there is.
// node --experimental-default-type=module scripts/test_plow_main_streets.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { SNOW_PLOW, CAR } = await import("../static/js/sim/vehicle.js");
const { PLOW_CLASSES, plowLanes } = await import("../static/js/sim/snow-plow.js");
const { curbOffset } = await import("../static/js/sim/roadside.js");

const root = new URL("../data/maps/", import.meta.url);
const KITS = new MapData(JSON.parse(fs.readFileSync(new URL("623b012bc8b5.v6.pack.json", root))));
const SHARP = 130 * Math.PI / 180;

// Why: on a Kitsilano residential street a car parked at the kerb stands 2.6 m from the lane's middle
// (less where its parking jitter puts it in: `parked_1263` stood at 2.52 m), within 5 cm of what a plow
// counts as in its way, and far outside what a car does.
const fifth = KITS.edges.get("e217");
assert.equal(fifth.cls, "residential");
const parkedLat = curbOffset(fifth, CAR) - fifth.lane_offsets[0], plowReach = (SNOW_PLOW.width + CAR.width) / 2 + 0.3;
assert.ok(parkedLat - plowReach < 0.06 && 2.52 < plowReach, `a parked car is at the edge of a plow's way there (${parkedLat.toFixed(2)} m, reach ${plowReach.toFixed(2)} m)`);
assert.ok(parkedLat > CAR.width + 0.3 + 0.2, "and well clear of a car's");

// Plows put down on every main-street lane, each extending its path some 250 m ahead, several times over.
const world = new World(KITS, { seed: 4, parked: 0, pedestrians: 0 });
const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 9 });
let turns = 0, offered = 0, left = 0, forced = 0;
for (const [i, lane] of plowLanes(KITS).entries()) {
  const plow = fleet.addPlow(lane, Math.min(5, lane.length / 2), 0);
  // (walk the path on: every turn it planned, with what the junction offered)
  for (let hop = 0; hop < 4; hop++) {
    const edges = plow.path.edges;
    for (let k = 1; k < edges.length; k++) {
      const from = edges[k - 1].id, to = edges[k].id;
      const options = KITS.successors(from).filter((id) => Math.abs(KITS.turnAngle(from, id)) < SHARP);
      turns++;
      if (options.some((id) => PLOW_CLASSES.has(KITS.edges.get(id).cls))) {
        offered++;
        if (!PLOW_CLASSES.has(KITS.edges.get(to).cls)) left++;
      } else if (!PLOW_CLASSES.has(KITS.edges.get(to).cls)) forced++;
    }
    plow.path.s = plow.path.length - 1;
    plow.path.trim();
    plow.path.extend();
  }
  fleet.vehicles.splice(fleet.vehicles.indexOf(plow), 1);
  if (i > 60) break;
}
assert.ok(offered > 100, `checked ${offered} turns with a main street on`);
assert.equal(left, 0, `never off the main streets where one goes on (${left} of ${offered})`);
console.log(`Plows keep to the main streets: ${offered} of ${turns} turns had one to take, all taken (${forced} with none)`);
process.exit(0);
