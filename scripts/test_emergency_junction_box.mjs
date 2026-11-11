// Stopping for an emergency vehicle short of the junction ahead, the car keeps its front out of the box
// round the junction's node that the audit measures entering (EV_BOX_M, sim/emergency.js). It used to
// stop 2.5 m short of the crossing street's edge: across a street 10.6 m wide that is 7.8 m from the
// node, inside the 8 m box, and Québec City's city smoke s1-1 crept into it at 1.3 m/s while an
// ambulance came along the crossing street, a failure to yield.
// node --experimental-default-type=module scripts/test_emergency_junction_box.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { EV_BOX_M } = await import("../static/js/sim/emergency.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");

function plan(crossHalf, v) {
  const street = { id: "street", from: "a", to: "b", pts: [[0, 0], [120, 0]], length: 120, cls: "residential", lanes: 1,
    lane_offsets: [0], lane_width: 3.5, asphalt: [-1.75, 1.75], parking: [0, 0], limit: 13.9, oneway: true };
  const cross = { cls: "secondary", lanes: 1, lane_offsets: [0], lane_width: 3.5, asphalt: [-crossHalf, crossHalf], parking: [0, 0], limit: 13.9, oneway: true };
  const edges = [street, { ...street, id: "exit", from: "b", to: "c", pts: [[120, 0], [200, 0]], length: 80 },
    { ...cross, id: "south", from: "b", to: "d", pts: [[120, 0], [120, -100]], length: 100 },
    { ...cross, id: "north", from: "e", to: "b", pts: [[120, 100], [120, 0]], length: 100 }];
  const map = new MapData({ extent: [-10, -110, 210, 110],
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 120, y: 0 }, { id: "c", x: 200, y: 0 }, { id: "d", x: 120, y: -100 }, { id: "e", x: 120, y: 100 }],
    edges, lanes: edges.map((e) => ({ edge: e.id, idx: 0, pts: e.pts })), intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  const FRONT = world.ego.spec.length - world.ego.spec.rearOverhang;
  Object.assign(world.ego, { x: 98.7 - FRONT, y: 0, psi: 0, v });
  world.route = new Route({ id: "straight", polyline: [[0, 0], [200, 0]], edges: ["street", "exit"], turns: [] }, world.map);
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 });
  const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 60 });
  assert.equal(ev?.kind, "ambulance");
  ev.psi = 0;
  return buildSnapshot(world).emergency;
}

const wide = plan(5.3, 8);
assert.ok(wide && wide.stop_s_route !== null, "a stop is planned");
assert.equal(wide.clearing, false, "short of the junction, not through it");
assert.ok(wide.stop_s_route <= 120 - EV_BOX_M - 0.5 + 1e-6, `the front stops out of the ${EV_BOX_M} m box (${(120 - wide.stop_s_route).toFixed(1)} m from the node)`);
// (2.5 m short of the crossing street's edge would have been inside it)
assert.ok(120 - 5.3 - 2.5 > 120 - EV_BOX_M);
console.log("Stopping for an emergency vehicle, the car keeps out of the junction's box");
process.exit(0);
