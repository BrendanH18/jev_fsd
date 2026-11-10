// City dry s1-11: the half-metre offset grid could not leave a 0.3 m pull-over beside parked cars.
// Continuing at the actual offset must keep the original 0.3 m prediction clearance throughout.
// node --experimental-default-type=module scripts/test_pull_over_rejoin.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const root = new URL("../data/maps/", import.meta.url), key = "623b012bc8b5";
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
  if (url) pack[name] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack);
for (const weather of ["dry", "rain", "snow"]) {
  const w = new World(map, { parked: 0, pedestrians: 0, followingDistance: true, weather });
  const lane = map.lane("e574", 0);
  w.route = new Route(routeFromLanes(map, [lane], 0, lane.length - 2), map);
  Object.assign(w.ego, { x: -186.1638544315576, y: -460.52440543307387, psi: -1.6006758267802192, delta: 0.09960438193636989, v: 0 });
  const parked = Object.assign(new Vehicle(-188.41853389384687, -461.62827717158154, -1.6118606847374282, 0), { id: "kerb" });
  w.parked.add(parked);
  const snap = buildSnapshot(w), cs = sampleCandidates(snap, w); simulateAll(cs, snap, w);
  const hold = cs.find(c => c.id === "keep_present_line");
  assert.equal(!!hold, true, `${weather}: offers the actual lateral position`);
  assert.equal(hold.eligible, true, `${weather}: the existing safety filter accepts it: ${hold.reject}`);
  assert.equal(hold.sim.progress_m > 3, true);
  const s0 = snap.routeProj.s, law = { ...hold.law, s0 }; let touched = false;
  for (let k = 0; k < 6 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, law, w.route, p.s, 1 / 60, w);
    touched ||= obbOverlap(w.ego.obb(), parked.obb(), 0.3);
  }
  assert.equal(touched, false, `${weather}: keeps the full prediction margin in actual execution`);
  assert.equal(w.route.project(w.ego.x, w.ego.y).s - s0 > 8, true);
  w.followingDistance = false;
  assert.equal(sampleCandidates(buildSnapshot(w), w).some(c => c.id === "keep_present_line"), false, "legacy preset keeps its candidate set");
}
console.log("A car can leave its pull-over along the present line without reducing parked-car clearance");
process.exit(0);
