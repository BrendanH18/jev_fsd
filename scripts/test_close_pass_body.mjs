// The close-pass audit (World.auditCyclistPasses, with passing cyclists on) measures the gap between the
// car's body and the cyclist's (Kitsilano city, seed 1, s1-7, West 8th Avenue). It took the car's centre
// line across the cyclist's heading less both half-widths, as if the two were side by side and parallel:
// going on past a cyclist stopped just round a corner, the car angled 5 degrees back into its lane, the
// rule put its centre line 0.84 m from the cyclist while its body never came within 0.95 m of them (the
// audit allows 0.1 m under the metre).
// Side by side and parallel, both measures agree.
// node --experimental-default-type=module scripts/test_close_pass_body.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { Vehicle, BIKE } = await import("../static/js/sim/vehicle.js");

// A two-way street, one 3.5 m lane each way, 50 km/h (a metre's passing distance); the car's lane
// centre at y = 0 and a cyclist stopped in it, 2.6 m to the right of it.
function street() {
  const e = { id: "in", from: "w", to: "c", pts: [[-200, 1.75], [200, 1.75]], length: 400, lanes: 1, lane_width: 3.5, lane_offsets: [1.75],
    asphalt: [-3.5, 3.5], parking: [0, 0], cls: "residential", limit: 13.8, oneway: false };
  const back = { ...e, id: "out", from: "c", to: "w", pts: [[200, 1.75], [-200, 1.75]] };
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-220, -20, 220, 20], nodes: [{ id: "w", x: -200, y: 1.75 }, { id: "c", x: 200, y: 1.75 }],
    edges: [e, back], lanes: [{ edge: "in", idx: 0, pts: [[-200, 0], [200, 0]] }, { edge: "out", idx: 0, pts: [[200, 3.5], [-200, 3.5]] }],
    intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0, passCyclists: true });
  world.route = new Route({ id: "r", polyline: [[-200, 0], [200, 0]], edges: ["in"], turns: [] }, map);
  world.npcs.push(Object.assign(new Vehicle(0, -2.6, 0, 0, BIKE), { id: "bike_t", kind: "bike" }));
  return world;
}
// The car going by on a straight line at heading `-angle` (toward the cyclist's side), its rear axle `y0`
// from the lane's centre where it is level with the cyclist: the close passes counted.
function pass(angle, y0) {
  const world = street(), road = { limit: 13.8 };
  for (let d = -16; d <= 16; d += 0.1) {
    Object.assign(world.ego, { x: d * Math.cos(angle), y: y0 - d * Math.sin(angle), psi: -angle, v: 5 });
    world.auditCyclistPasses(road);
  }
  return { count: world.violations.close_passes || 0, clearance: world.events.find((e) => e.type === "close_pass")?.clearance_m ?? null };
}

const parallel = pass(0, -0.5);
assert.equal(parallel.count, 1, "side by side and parallel, 0.83 m off: a close pass");
assert.ok(Math.abs(parallel.clearance - 0.83) < 0.01, `measured ${parallel.clearance} m`);
assert.equal(pass(0, -0.3).count, 0, "1.03 m off: not");
// Angled 0.08 rad toward the cyclist: its centre line 0.83 m from them as it leaves them behind, its body 1.00 m.
assert.equal(pass(0.08, -0.2).count, 0, "angled back into its lane, a metre off the cyclist: not a close pass");
assert.equal(pass(0.08, -0.5).count, 1, "angled, 0.70 m off: a close pass");
console.log("The close-pass audit measures the gap between the bodies");
process.exit(0);
