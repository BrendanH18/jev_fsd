// City dry s1-11: a bicycle stopped across a walk trapped a pedestrian at its rear.
// Clear an already-entered crossing only when the pedestrian is clear of the bicycle's body/path.
// node --experimental-default-type=module scripts/test_cyclist_crosswalk_clearance.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, BIKE } = await import("../static/js/sim/vehicle.js");
const { Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const edge = { id: "street", from: "a", to: "b", pts: [[0, 0], [400, 0]], length: 400,
  lanes: 1, lane_width: 3.2, lane_offsets: [0], asphalt: [-1.6, 1.6], parking: [0, 0],
  cls: "residential", limit: 11.1, oneway: true };
const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-20, -50, 420, 50], edges: [edge],
  lanes: [{ edge: edge.id, idx: 0, pts: edge.pts }], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 400, y: 0 }],
  intersections: [], stops: [], buildings: [] });
for (const [x, started] of [[40.2, true], [47, true], [40.2, false]]) {
  const world = new World(map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: -1000, y: -1000 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 1 });
  fleet.nextPull = fleet.nextPark = Infinity;
  const bike = Object.assign(new Vehicle(40, -0.85, 0, 0, BIKE), { id: "bike", kind: "bike", side: 0.85,
    v0: 4, frozen: 0, waiting: 0, stopMem: new StopMemory(), path: new NpcPath(map, () => 0.5) });
  bike.path.start(edge.id, 0, 40); fleet.vehicles.push(bike);
  const cross = { node: null, from: [x, 6], to: [x, -6], jaywalk: true };
  const ped = new Pedestrian({ id: "walker", x, y: 1, psi: -Math.PI / 2, v: 0, speed: 1.36,
    path: [{ p: cross.to, cross }], crossing: started ? cross : null, home: true, phase: 0, waiting: 0 });
  world.crowd.list = [ped];
  let touched = false;
  for (let k = 0; k < 12 * 60; k++) {
    fleet.step(1 / 60); world.crowd.step(1 / 60); world.t += 1 / 60;
    touched ||= obbOverlap(bike.obb(), ped.obb());
  }
  assert.equal(touched, false, `${x}: bicycle and pedestrian remain apart`);
  assert.equal(!!ped.gone, true, `${x}: pedestrian completes the crossing`);
  assert.equal(bike.x > 55, true, `${x}: cyclist carries on after the crossing clears`);
}
console.log("Cyclists clear an occupied crossing safely and still yield before entering one");
process.exit(0);
