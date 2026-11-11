// A pothole move that already clears a snowbank corridor must not be cancelled in leader checks.
// node --experimental-default-type=module scripts/test_snowbank_potholes.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Snowbanks } = await import("../static/js/sim/snowbanks.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { potholeOnLane, wheelRoom } = await import("../static/js/sim/potholes.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { rng } = await import("../static/js/common.js");
const root = new URL("../data/maps/", import.meta.url), key = "623b012bc8b5";
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
  if (url) pack[name] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack);
function make(edge) {
  const w = new World(map, { seed: 3, parked: 0, pedestrians: 0, weather: "snow", potholes: true });
  const sb = w.snowbanks = new Snowbanks(w);
  sb.enabled = true; sb.random = rng(3);
  const L = map.edges.get(edge).cum.at(-1);
  sb.build({ narrowings: [{ edge, a: 25, b: L - 25 }] });
  return w;
}

for (const blocked of [false, true]) {
  const w = make("e285"), nw = w.snowbanks.narrowings[0], lane = map.lane(nw.opposite, 0);
  const fleet = new NpcFleet(w, { count: 0, bikes: 0 });
  fleet.nextPull = fleet.nextPark = 1e9;
  w.ego.x = w.ego.y = 10000;
  const s = 40, h = potholeOnLane(map, lane.edge, 0, s + 10, { id: "hole", offset: 0.86, a: 0.35, b: 0.34, depth: 0.07 });
  w.potholes.setList([h]);
  const shift = wheelRoom(h.offset, h, lane.edgeRef.lane_width, CAR);
  assert.equal(shift < -0.4, true);
  const at = (s, d) => { const p = pointAt(lane.pts, lane.cum, s), h = headingAt(lane.pts, lane.cum, s); return [p[0] + Math.sin(h) * d, p[1] - Math.cos(h) * d, h]; };
  const pose = at(s, shift), n = new Vehicle(...pose, 1.5);
  Object.assign(n, { id: "driver", v0: 5, driver: { aMax: 1.2, b: 1.5, s0: 2, T: 1.4, react: 0, lcRate: 0 }, stopMem: new StopMemory(), waiting: 0, frozen: 0, phShift: shift });
  n.path = new NpcPath(map, () => 0.5); n.path.start(lane.edge, 0, s);
  fleet.vehicles.push(n);
  const pos = at(s + 8, blocked ? shift : 2.1), parked = new Vehicle(...pos, 0);
  Object.assign(parked, { id: "parked", edge: lane.edge, curb: "right" }); w.parked.add(parked);
  assert.equal(obbOverlap(n.obb(), parked.obb(), 0.3), false);
  fleet.step(1 / 60);
  if (!blocked) assert.equal(n.lead === null, true, "the shifted corridor clears the kerb car; the unshifted lane is not a second path");
  else assert.equal(Number.isFinite(n.lead?.gap), true, "a car actually in the corridor remains a leader");
  let hit = false;
  for (let k = 0; k < 8 * 60; k++) {
    w.tick++; w.t += 1 / 60; w.snowbanks.step(1 / 60); fleet.step(1 / 60);
    hit ||= obbOverlap(n.obb(), parked.obb(), 0.05);
  }
  const progress = projectPoint(lane.pts, lane.cum, [n.x, n.y], null).s - s;
  assert.equal(hit, false, "the same clearance and collision checks still protect the parked car");
  assert.equal(blocked ? progress < 4 : progress > 12, true, `blocked=${blocked}, progress=${progress}`);
}
console.log("Snowbank/pothole corridor progress and real-obstacle stop checks passed");
process.exit(0);
