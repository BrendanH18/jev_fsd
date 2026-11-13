// A traffic parker stuck at an angle, with no leg left it can take, gives up in the end and drives on
// (Edmonton city, seed 1, s1-2, 81 Avenue NW). `car_p2`, pulled out of the kerb earlier, became a parker
// (sim/parkers.js) on a one-lane one-way street. Reversing in on full lock, its front swung out to the
// far kerb at 31 degrees, the square-up leg ran its front into the car parked ahead, and the manoeuvre was
// stuck. It tried again from where it stood every 1.5 s, found no leg each time, and gave up only "while
// still near its start", which, angled 23 degrees across its lane, it never was: the driven car waited
// behind it for 350 s. Stuck that long (`STUCK_MAX_S`) it now gives up wherever it stands.
// node --experimental-default-type=module scripts/test_parker_stuck_angled.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const P = await import("../static/js/sim/parkers.js");
const { frameOf } = await import("../static/js/sim/parallel-park.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");

const root = new URL("../data/maps/", import.meta.url);
const pack = JSON.parse(fs.readFileSync(new URL("623b012bc8b5.v6.pack.json", root)));
for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const url = [2, 1].map(v => new URL(`623b012bc8b5.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
  if (url) pack[name] = JSON.parse(fs.readFileSync(url));
}
const KITS = new MapData(pack);
const DT = 1 / 60;
const ctx = setupChallenge(KITS, CHALLENGES.find(c => c.id === "room-to-park"), { brain: "rules" });
ctx.autopilot.setEnabled(false);
const w = ctx.world, n = w.npcs.find(v => v.id === "challenge_parker");
const step = () => { const p = w.route.project(w.ego.x, w.ego.y); applyLaw(w.ego, { kind: "hard_brake" }, w.route, p.s, DT, w); stepWorld(ctx, DT, w.t * 1000); };
// (into its reverse, until it is well off parallel)
for (let k = 0; k < 60 * 60 && !(n.parker?.law && Math.abs(frameOf(n, n.parker.plan).phi) > 15 * Math.PI / 180); k++) step();
assert.ok(n.parker?.law, "reversing in");
const angle = Math.abs(frameOf(n, n.parker.plan).phi) * 180 / Math.PI;
// Boxed in where it stands, angled: a car standing just off its front bumper and one just off its rear,
// so no leg the manoeuvre has is open.
const box = n.obb(), c = Math.cos(n.psi), s = Math.sin(n.psi), off = box.halfLength + CAR.length / 2 + 0.2;
const blockers = [1, -1].map((dir, i) => Object.assign(new Vehicle(box.center[0] + dir * off * c - (CAR.length / 2 - CAR.rearOverhang) * c, box.center[1] + dir * off * s - (CAR.length / 2 - CAR.rearOverhang) * s, n.psi, 0), { id: `box_${i}`, stay: true }));
for (const b of blockers) w.parked.add(b);
let stuckAt = null, releasedAt = null;
for (let k = 0; k < 60 * 60 && releasedAt === null; k++) {
  step();
  if (stuckAt === null && n.parker?.law?.phase === "stuck") stuckAt = w.t;
  if (!n.parker) releasedAt = w.t;
}
assert.ok(stuckAt !== null, "stuck");
assert.ok(releasedAt !== null, "gave up in the end");
const waited = releasedAt - stuckAt;
assert.ok(waited > P.GIVE_UP_S + 1, `tried again for a while first (${waited.toFixed(1)} s)`);
assert.ok(waited < P.STUCK_MAX_S + 2 * P.RETRY_S, `then gave up (${waited.toFixed(1)} s)`);
assert.equal(n.parkerTried, true);
assert.equal(w.parkers.gaveUp, 1);
assert.equal(w.parked.slots.some(sl => sl.reserved?.owner === n), false, "its slots let go");
assert.equal(w.npcs.includes(n), true, "traffic again");
// (with the way ahead clear again, it drives on)
for (const b of blockers) w.parked.remove(b);
const x0 = n.x, y0 = n.y;
for (let k = 0; k < 15 * 60; k++) step();
assert.ok(Math.hypot(n.x - x0, n.y - y0) > 10, "drives on");
assert.equal(w.violations.collisions, 0);
console.log(`A parker stuck at ${angle.toFixed(0)} degrees gives up after ${waited.toFixed(1)} s and drives on`);
process.exit(0);
