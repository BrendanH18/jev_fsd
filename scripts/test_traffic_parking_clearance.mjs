// The older parking-in controller still needs stopping room behind a stopped driven car.
// node --experimental-default-type=module scripts/test_traffic_parking_clearance.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { cumulative, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { setWeather } = await import("../static/js/sim/weather.js");
for (const weather of ["dry", "rain", "snow"]) {
  setWeather(weather);
  const n = new Vehicle(40, 0, 0, 0), ego = new Vehicle(47.63, 0, 0, 0);
  const pts = [[0, 0], [400, 0]], cum = cumulative(pts);
  n.path = { pts, cum, length: 400, pointAt: (s) => pointAt(pts, cum, s), headingAt: (s) => headingAt(pts, cum, s),
    offsetPointAt: (s, d) => [s, -d], project: (x, y) => projectPoint(pts, cum, [x, y]) };
  n.parking = { start: 40, end: 90, lat: 2, t: 0, slot: {} };
  const fleet = { world: { ego, followingDistance: true, obstaclesNear: () => [n] }, vehicles: [n] };
  let touched = false;
  for (let k = 0; k < 10 * 60; k++) {
    NpcFleet.prototype.parkStep.call(fleet, n, 1 / 60);
    touched ||= obbOverlap(n.obb(), ego.obb());
  }
  assert.equal(touched, false, `${weather}: parking car stops before the ego`);
  assert.ok(n.v < 0.1, `${weather}: parking waits behind the stopped car`);
  assert.ok(n.x > 40.1, `${weather}: still approaches the bay when there is room`);
}
console.log("Parking-in keeps stopping room in dry, rain and snow");
process.exit(0);
