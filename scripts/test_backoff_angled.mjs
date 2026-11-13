// A driver backing out of a nose-to-nose standoff stops short of a car standing behind it at an angle
// (Ottawa city, seed 1, s1-1, McLeod Street). `car_p3`, just pulled out of the kerb and still angled
// 14 degrees from its lane, met an ambulance stopped facing it and backed off (sim/npc.js `backOff`)
// into the driven car, stopped behind it and to its left: the room behind was measured only for
// vehicles whose centre lay in a 1.6 m strip straight behind, and the driven car's centre was 2.6 m to
// the side while its front corner was right behind the reversing car. It backed into it twice. The
// room behind is now the reversing car's own body moved back, so a corner in it counts.
// node --experimental-default-type=module scripts/test_backoff_angled.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { setWeather } = await import("../static/js/sim/weather.js");

setWeather("dry");
// (its frame: x forward, y to its left; the driven car 5.9 m back and 2.6 m to its left, its nose
// turned 0.25 rad toward the reversing car's line, as on McLeod Street)
function backOff(ego) {
  const n = new Vehicle(0, 0, 0, 0);
  n.backoff = { left: 6, t: 0 };
  const fleet = { world: { ego, obstaclesNear: () => [n] } };
  let touched = false, gap = Infinity;
  for (let k = 0; k < 8 * 60 && n.backoff; k++) {
    NpcFleet.prototype.backOff.call(fleet, n, 1 / 60);
    touched ||= obbOverlap(n.obb(), ego.obb());
  }
  for (let m = 0; m < 3; m += 0.02) if (obbOverlap(n.obb(), ego.obb(), m)) { gap = m; break; }
  return { touched, done: !n.backoff, x: n.x, gap };
}
const angled = backOff(new Vehicle(-5.9, 2.6, -0.25, 0));
assert.equal(angled.touched, false, "reversed clear of the car standing behind it at an angle");
assert.equal(angled.done, true, "finished backing off");
assert.ok(angled.gap > 1, `kept room behind (${angled.gap.toFixed(2)} m)`);
// (the same car well off to the side: not in the way, it reverses the full distance)
const beside = backOff(new Vehicle(-5.9, 5.5, -0.25, 0));
assert.equal(beside.touched, false);
assert.ok(beside.x < -5, `reversed past a car standing well to the side (x=${beside.x.toFixed(2)})`);
console.log(`Backing off stops ${angled.gap.toFixed(2)} m short of a car standing behind at an angle, and passes one well to the side`);
process.exit(0);
