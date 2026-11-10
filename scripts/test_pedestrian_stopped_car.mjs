// A pedestrian must wait for a stopped car's occupied body, and continue once it clears.
// node --experimental-default-type=module scripts/test_pedestrian_stopped_car.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { Crowd, Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
for (const npc of [false, true]) {
  const car = new Vehicle(0, 0, 0, 0), far = new Vehicle(100, 100, 0, 0);
  const cross = { node: null, from: [1, -6], to: [1, 6], jaywalk: true };
  const ped = new Pedestrian({ id: "walker", x: 1, y: -6, psi: Math.PI / 2, speed: 1.36, v: 0, phase: 0, waiting: 0,
    path: [{ p: cross.to, cross }], crossing: cross, home: true });
  const crowd = Object.create(Crowd.prototype);
  Object.assign(crowd, { list: [ped], world: { t: 0, ego: npc ? far : car, npcs: npc ? [car] : [] } });
  let touched = false;
  for (let k = 0; k < 8 * 60; k++) {
    crowd.step(1 / 60);
    touched ||= obbOverlap(ped.obb(), car.obb());
  }
  assert.equal(touched, false, `${npc ? "traffic" : "ego"}: no pedestrian collision`);
  assert.equal(ped.v, 0, "waits short of the occupied body");
  assert.ok(ped.y < -1, "has not crossed through the car");
  car.x = 20;
  for (let k = 0; k < 8 * 60; k++) crowd.step(1 / 60);
  assert.ok(ped.y >= 6, "continues across once the car clears");
}
{
  const car = Object.assign(new Vehicle(0, 0, 0, 0), { id: "tram" });
  const cross = { node: null, from: [1, -6], to: [1, 0], streetcar: car.id, boarding: true };
  const rider = new Pedestrian({ id: "rider", x: 1, y: -6, psi: Math.PI / 2, speed: 1.36, v: 0, phase: 0, waiting: 0,
    path: [{ p: cross.to, cross }], crossing: cross, home: true, boarding: true, streetcar: car.id });
  const crowd = Object.create(Crowd.prototype);
  Object.assign(crowd, { list: [rider], world: { t: 0, ego: new Vehicle(100, 100, 0, 0), npcs: [car] } });
  for (let k = 0; k < 8 * 60; k++) crowd.step(1 / 60);
  assert.equal(!!rider.gone, true, "a rider can still board their own streetcar");
}
console.log("Pedestrians wait for stationary cars and resume after they clear");
process.exit(0);
