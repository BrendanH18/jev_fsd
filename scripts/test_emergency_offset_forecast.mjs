// A fire truck must forecast both the line it holds and the opening its side is easing toward.
// City dry s1-8's approach at 150 s; retaining only the current side missed the later nose sweep.
// node --experimental-default-type=module scripts/test_emergency_offset_forecast.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, projectPoint, cumulative } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, FIRE_TRUCK } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { freeDriveOptions } = await import("../static/js/sim/free-drive.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const root = new URL("../data/maps/", import.meta.url), key = "623b012bc8b5";
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
  if (url) pack[name] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack), opts = freeDriveOptions(new URLSearchParams({ park: "0" }));
const w = new World(map, { seed: 754945, ...opts.world, pedestrians: 0 });
Object.assign(w.ego, { x: -341.54937258449326, y: -92.46876863583265, psi: -1.5907947512244291, v: 0 });
const f = new NpcFleet(w, { count: 0, bikes: 0 }); f.nextPull = f.nextPark = Infinity;
const n = Object.assign(new Vehicle(-338.8532757110691, -66.02121313000883, -1.476982132975999, 8.501921907426286, FIRE_TRUCK), {
  id: "fire", kind: "fire_truck", siren: true, side: -3.0333333333333283, age: 43.3, v0: 11.205,
  delta: 0.024200825019478556, a: 0.3223271326305107, vy: 0.10038717935379193, r: 0.0483994014509405,
  ax: 0.32447676597895664, latAccel: 0.15126041062518758, frozen: 0, waiting: 0, blockedFor: 0, stopMem: new StopMemory(),
  driver: { aMax: 1.53, b: 3, s0: 3, T: 0.9, react: 0.3, lcRate: 0 }, path: new NpcPath(map, () => 0.5) });
const lane = map.lane("e553", 0);
n.path.start(lane.edge, 0, projectPoint(lane.pts, lane.cum, [n.x, n.y]).s, [["e350", 0]]);
// Retain the short entry blend and edge distances from the observed path.
n.path.pts = [
  [-340.26623700716885, -17.33020923666664],
  [-340.1262908217751, -18.75096355126132],
  [-340.0996633744311, -20.224347876854743],
  [-341.86, -108.13],
  [-344.4620551013662, -204.51999736812644],
  [-344.4214995202409, -205.97698221326146],
  [-344.21887704741476, -207.3490292526159],
  [-343.85418768288787, -208.63613848618968],
  [-343.3274314266602, -209.8383099139828],
  [-342.63860827873185, -210.95554353599533],
  [-341.78771823910273, -211.9878393522272],
  [-340.77476130777285, -212.93519736267845],
  [-339.5997374847422, -213.79761756734905],
  [-336.9, -215.56],
  [-333.4, -216.88],
  [-178.14, -220.59],
];
n.path.cum = cumulative(n.path.pts);
n.path.s = 48.52321395722591;
n.path.edges = [
  {"id": "e553", "lane": 0, "sStart": -0.95676291207229, "sEnd": 90.82453102147726, "control": {"type": "signal", "id": "sig12", "s_line": 83.9, "group": "B"}, "to": "n11186338645", "limit": 8.3},
  {"id": "e350", "lane": 0, "sStart": 90.82453102147726, "sEnd": 192.36150753742447, "control": null, "to": "n249634282", "limit": 8.3},
  {"id": "e445", "lane": 0, "sStart": 192.36150753742447, "sEnd": 360.50819983038156, "control": null, "to": "n250887920", "limit": 8.3},
];
f.vehicles.push(n);
// Replay the observed short creep while the truck selects a gap. Signal phase uses sim time.
w.t = 150;
const observed = [
  [-341.54937258449326, -92.46876863583265, -1.5907947512244291, 0],
  [-341.54937258449326, -92.46876863583265, -1.5907947512244291, 0],
  [-341.5496102218982, -92.48053202008812, -1.5912318199338196, 0.09700572956807987],
  [-341.5538112144959, -92.65859684686636, -1.5975508900425943, 0.1217471924990848],
  [-341.5551425840211, -92.70691732764008, -1.599167160744717, 0],
];
let touched = false, heldForBody = false;
for (let k = 0; k < 12 * 60; k++) {
  const t = Math.min(4, k / 60), i = Math.min(3, Math.floor(t)), u = t - i;
  ["x", "y", "psi", "v"].forEach((key, j) => { w.ego[key] = observed[i][j] + (observed[i + 1][j] - observed[i][j]) * u; });
  f.step(1 / 60); w.t += 1 / 60; heldForBody ||= n.blockedFor > 3 && n.blockedBy?.includes(w.ego); touched ||= obbOverlap(n.obb(), w.ego.obb());
}
assert.equal(heldForBody, true, "the body obstruction uses the shared blocked-car handoff");
assert.equal(touched, false, "the coming lateral move is forecast before steering into the stopped car");
Object.assign(w.ego, { x: -300, y: -200 });
for (let k = 0; k < 6 * 60; k++) { f.step(1 / 60); w.t += 1 / 60; }
assert.equal(n.v > 1, true, "does not remain held after the car clears");
console.log("Emergency traffic forecasts the selected opening as well as its present lateral line");
process.exit(0);
