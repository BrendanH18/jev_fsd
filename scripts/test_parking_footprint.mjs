// Parked cars near a bend: the bay check (`bayIntrusion`) places a car square in the middle of its bay,
// but the car actually parked there is jittered along the kerb, sideways and in heading, and on the
// inside of a bend that can carry its body past the 0.3 m limit into the travel lane although its bay
// passed. The placed car's own footprint is checked too; a car that fails it is not placed (its bay
// stays empty for traffic to park in), and it still makes its draws and uses its number, so every
// other car keeps its place and number.
// node --experimental-default-type=module scripts/test_parking_footprint.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, projectPoint } = await import("../static/js/map/mapdata.js");
const { ParkedCars } = await import("../static/js/sim/parking.js");

const LIMIT_M = 0.3;
// How far a parked car's real body (its OBB) reaches past the parking lane into the travel lanes.
function reach(map, car) {
  const e = map.edges.get(car.edge), o = car.obb(), right = car.curb === "right";
  const inner = right ? e.asphalt[1] - e.parking[1] : e.asphalt[0] + e.parking[0];
  let worst = -Infinity;
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = o.center[0] + Math.cos(o.heading) * a * o.halfLength + Math.sin(o.heading) * b * o.halfWidth;
    const y = o.center[1] + Math.sin(o.heading) * a * o.halfLength - Math.cos(o.heading) * b * o.halfWidth;
    const q = projectPoint(e.pts, e.cum, [x, y]);
    worst = Math.max(worst, right ? inner - q.lateral : q.lateral - inner);
  }
  return worst;
}

let over = 0, cars = 0, emptied = 0, worst = -Infinity;
for (const file of fs.readdirSync("data/maps").filter((f) => f.endsWith(".v6.pack.json")).sort()) {
  const map = new MapData(JSON.parse(fs.readFileSync(`data/maps/${file}`)));
  for (const seed of [1, 7]) {
    const parked = new ParkedCars(map, { seed, density: 1 });
    const ids = new Set();
    for (const car of parked.list) {
      const r = reach(map, car);
      worst = Math.max(worst, r);
      if (r > LIMIT_M + 1e-9) over++;
      ids.add(car.id);
      cars++;
    }
    assert.equal(ids.size, parked.list.length, `${file} seed ${seed}: car numbers stay unique`);
    // With every bay filled, an empty bay is one whose car was left out for its footprint alone; it
    // still used its number, so the highest number covers every bay.
    const empty = parked.slots.filter((slot) => !slot.occupant).length;
    assert.equal(parked.list.length + empty, parked.slots.length, `${file} seed ${seed}: one car per bay, or none`);
    const top = Math.max(...parked.list.map((c) => Number(c.id.slice("parked_".length))));
    assert.ok(top >= parked.slots.length, `${file} seed ${seed}: a car left out still uses its number`);
    emptied += empty;
  }
}
assert.equal(over, 0, `no parked car reaches more than ${LIMIT_M} m into a travel lane (${over} of ${cars} did; worst ${worst.toFixed(3)} m)`);
assert.ok(emptied > 0, "some bays that pass the bay check are left empty for their car's footprint");

console.log(`Parked cars keep their jittered bodies within ${LIMIT_M} m of the travel lane (${cars} cars, worst ${worst.toFixed(3)} m; ${emptied} bays left empty)`);
process.exit(0);
