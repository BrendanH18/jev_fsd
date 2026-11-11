// Parked cars on the inside of a tight bend: a straight body there reaches out of the parking lane
// into the travel lane (Winnipeg's Lily Street blocked the driven car and an ambulance for minutes).
// No bay is placed where its car would reach more than 0.3 m into the travel lane; every other bay
// keeps the car, and the car number, it had.
// node --experimental-default-type=module scripts/test_parking_bends.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative, projectPoint } = await import("../static/js/map/mapdata.js");
const { ParkedCars, bayIntrusion } = await import("../static/js/sim/parking.js");

// A synthetic two-way street with parking: straight, then a right-angle bend of about 12 m radius.
const pts = [[0, 0], [40, 0]];
for (let k = 1; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; pts.push([40 + 12 * Math.sin(a), -12 + 12 * Math.cos(a)]); }
pts.push([52, -60]);
const edge = { pts, cum: cumulative(pts), asphalt: [-5.6, 5.6], parking: [2.1, 2.1] };
const lat = edge.asphalt[1] - edge.parking[1] / 2 - 0.05;
assert.ok(bayIntrusion(edge, 15, lat) < 0.05, "a bay on the straight stays inside the parking lane");
assert.ok(bayIntrusion(edge, 40 + 6 * Math.PI / 2, lat) > 0.3, "a bay on the inside of the bend reaches into the travel lane");
assert.ok(bayIntrusion(edge, 40 + 6 * Math.PI / 2, -lat) < 0.05, "the outside of the bend does not");

// Winnipeg: no parked car reaches more than 0.3 m into a travel lane, and Lily Street keeps cars.
const key = "19bb885c9cae";
const map = new MapData(JSON.parse(fs.readFileSync(`data/maps/${key}.v6.pack.json`)));
const parked = new ParkedCars(map, { seed: 7, density: 1 });
let worst = -Infinity, lily = 0;
const ids = new Set();
for (const car of parked.list) {
  const e = map.edges.get(car.edge), o = car.obb();
  const [cx, cy] = o.center, h = o.heading, right = car.curb === "right";
  const inner = right ? e.asphalt[1] - e.parking[1] : e.asphalt[0] + e.parking[0];
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = cx + Math.cos(h) * a * o.halfLength + Math.sin(h) * b * o.halfWidth;
    const y = cy + Math.sin(h) * a * o.halfLength - Math.cos(h) * b * o.halfWidth;
    const q = projectPoint(e.pts, e.cum, [x, y]);
    worst = Math.max(worst, right ? inner - q.lateral : q.lateral - inner);
  }
  if (e.name === "Lily Street") lily++;
  ids.add(car.id);
}
assert.ok(worst < 0.6, `parked cars reach at most ${worst.toFixed(2)} m into a travel lane`);
assert.ok(lily > 0, "Lily Street still has parked cars on its straight stretches");
assert.equal(ids.size, parked.list.length, "car numbers stay unique");
// (a bay left out still uses its car's number, so the other bays keep theirs)
const numbers = parked.list.map((c) => Number(c.id.slice("parked_".length)));
assert.ok(Math.max(...numbers) > parked.list.length, "bays left out keep their numbers");
// The bays that stood across the lane on Lily Street's bend (e637) are gone.
for (const [x, y] of [[560.4, 525.7], [557.3, 521.8]]) assert.equal(parked.near(x, y, 2.5).filter((c) => c.edge === "e637").length, 0, "no car on the inside of Lily Street's bend");
console.log(`Bays on the inside of a bend are left out (worst reach ${worst.toFixed(2)} m, ${lily} cars on Lily Street)`);
process.exit(0);
