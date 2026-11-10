// A person waits at the curb for a car already occupying the crossing, so neither traps the other.
// node --experimental-default-type=module scripts/test_pedestrian_crossing_entry.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { Crowd, Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
for (const speed of [0, 1.2]) {
  const car = new Vehicle(0, 0, 0, speed);
  const cross = { node: null, from: [1, -6], to: [1, 6], jaywalk: true };
  const ped = new Pedestrian({ id: "walker", x: 1, y: -6, psi: Math.PI / 2, speed: 1.36, v: 0,
    path: [{ p: cross.to, cross }], crossing: null, home: true, phase: 0, waiting: 0 });
  const crowd = Object.create(Crowd.prototype);
  Object.assign(crowd, { list: [ped], world: { t: 0, ego: car, npcs: [] } });
  for (let k = 0; k < 8 * 60; k++) crowd.step(1 / 60);
  assert.equal(ped.crossing === null, true, `${speed}: waits before starting`);
  assert.equal(ped.y, -6, "stays on the sidewalk, letting the car clear");
  car.x = 50;
  let touched = false;
  for (let k = 0; k < 10 * 60; k++) { crowd.step(1 / 60); touched ||= obbOverlap(ped.obb(), car.obb()); }
  assert.equal(touched, false);
  assert.equal(!!ped.gone, true, `${speed}: crosses after the car clears`);
  ped.boarding = true; ped.streetcar = car.id = "tram"; car.x = 0;
  assert.equal(crowd.occupiedCrossing(ped, cross), false, "boarding one's own streetcar remains possible");
  ped.boarding = false;
  assert.equal(crowd.occupiedCrossing(ped, { ...cross, streetcar: car.id }), false, "alighting at one's own door remains possible");
}
console.log("Pedestrians wait at the curb for occupied crossings and resume after they clear");
process.exit(0);
