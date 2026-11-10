// A driver backing out of a nose-to-nose standoff must see the driven car behind it.
// node --experimental-default-type=module scripts/test_traffic_backoff.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { setWeather } = await import("../static/js/sim/weather.js");

for (const weather of ["dry", "rain", "snow"]) {
  setWeather(weather);
  for (const blocked of [true, false]) {
    const ego = new Vehicle(blocked ? -7.63 : -30, 0, 0, 0);
    const n = new Vehicle(0, 0, 0, 0);
    n.backoff = { left: 6, t: 0 };
    const fleet = { world: { ego, obstaclesNear: () => [n] } };
    let touched = false;
    for (let k = 0; k < 8 * 60 && n.backoff; k++) {
      NpcFleet.prototype.backOff.call(fleet, n, 1 / 60);
      touched ||= obbOverlap(n.obb(), ego.obb());
    }
    assert.equal(touched, false, `${weather}: reversed clear of the ego`);
    assert.equal(!!n.backoff, false, `${weather}: finished backing off`);
    assert.equal(n.v, 0, `${weather}: stopped`);
    assert.ok(blocked ? n.x > -3 : n.x < -6, `${weather}: ${blocked ? "kept room behind" : "reversed when clear"}, x=${n.x}`);
  }
}
console.log("Traffic back-off sees the driven car and still reverses on a clear road");
process.exit(0);
