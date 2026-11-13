// Someone part-way across, held up by a vehicle standing just short of their way, walks round it.
// Kitsilano rain seed 1 (s1-9, city) deadlocked on West 5th Avenue: a car stopped for a child bringing a
// ball back across the street with its bumper 0.26 m short of the child's line; the child would not walk
// into the bumper's margin, and the car waited for the child. Now, after ROUND_S, the child goes round the
// bumper, never touching the car. A car standing across the line itself is still waited for
// (scripts/test_pedestrian_stopped_car.mjs).
// node --experimental-default-type=module scripts/test_pedestrian_round.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { Crowd, Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");

const FRONT = CAR.length - CAR.rearOverhang;
// (the car heading east, its rear axle at the origin; the line across the street `gap` metres ahead of its
// bumper, walked from its right side, south, to the north)
function walk({ npc, gap, seconds = 20 }) {
  const car = Object.assign(new Vehicle(0, 0, 0, 0), { id: "stopped" }), far = new Vehicle(200, 200, 0, 0);
  const x = FRONT + gap, cross = { node: null, from: [x, -6], to: [x, 6], jaywalk: true };
  const ped = new Pedestrian({ id: "child", x, y: -1.6, psi: Math.PI / 2, speed: 1.5, v: 0, phase: 0, waiting: 0,
    path: [{ p: cross.to, cross }], crossing: cross, home: true, child: true });
  const crowd = Object.create(Crowd.prototype);
  Object.assign(crowd, { list: [ped], world: { t: 0, ego: npc ? far : car, npcs: npc ? [car] : [] } });
  let touched = false, at2 = null, across = null;
  for (let k = 0; k < seconds * 60; k++) {
    crowd.step(1 / 60);
    crowd.world.t += 1 / 60;
    touched ||= obbOverlap(ped.obb(), car.obb());
    if (k === 2 * 60) at2 = ped.y;
    if (across === null && (ped.gone || ped.y >= 5.9)) across = crowd.world.t;
  }
  return { touched, at2, across, gone: !!ped.gone };
}

for (const npc of [false, true]) {
  const who = npc ? "traffic" : "the driven car";
  const r = walk({ npc, gap: 0.26 });
  assert.equal(r.touched, false, `${who}: never touches it`);
  assert.ok(r.at2 < -CAR.width / 2, `${who}: waits for it a while first (${r.at2.toFixed(2)})`);
  assert.ok(r.across !== null && r.across > 3, `${who}: goes round and across (${r.across?.toFixed(1)} s)`);
  // (with room to walk by, they never stop)
  const clear = walk({ npc, gap: 1.2, seconds: 12 });
  assert.equal(clear.touched, false);
  assert.ok(clear.across !== null && clear.across < 6, `${who}: walks straight by with room (${clear.across?.toFixed(1)} s)`);
}
// A car still at the kerb waiting to pull out is parked, as far as people walking by are concerned (that
// s1-9 child's way home, round the stopped car, ran past the tail of one): they do not wait for it. Once
// it moves off, they do.
for (const moving of [false, true]) {
  const car = Object.assign(new Vehicle(0, 0, 0, 0), { id: "car_p1", pull: { lat: 2.5, t: 0, T: 3.5, wait: 1, moving } });
  const x = FRONT + 0.2, cross = { node: null, from: [x, -6], to: [x, 6], jaywalk: true };
  const ped = new Pedestrian({ id: "child", x, y: -1.6, psi: Math.PI / 2, speed: 1.5, v: 0, phase: 0, waiting: 0,
    path: [{ p: cross.to, cross }], crossing: cross, home: true, child: true });
  const crowd = Object.create(Crowd.prototype);
  Object.assign(crowd, { list: [ped], world: { t: 0, ego: new Vehicle(200, 200, 0, 0), npcs: [car] } });
  for (let k = 0; k < 2 * 60; k++) { crowd.step(1 / 60); crowd.world.t += 1 / 60; }
  if (moving) assert.ok(ped.y < -CAR.width / 2, "waits for a car that has moved off from the kerb");
  else assert.ok(ped.y > CAR.width / 2, `walks by a car still waiting at the kerb (${ped.y.toFixed(2)})`);
}
console.log("Pedestrians held up by a vehicle standing just short of their way walk round it");
process.exit(0);
