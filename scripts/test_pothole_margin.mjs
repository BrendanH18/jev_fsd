// Easing round a pothole inside the lane, the forward simulations keep a 10 cm margin round it
// (SIM_PAD_M): their prediction runs a few centimetres from what the car does (coming out of a turn its
// nose still points across the lane), and Victoria's city smoke s1-2 clipped the edge of one at 26 km/h
// on a wheel predicted to pass just clear. And a hard brake while easing round one carries on round it,
// rather than steering back across it to the lane's centre.
// node --experimental-default-type=module scripts/test_pothole_margin.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const PH = await import("../static/js/sim/potholes.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");

// A tyre passing 5 cm outside a pothole's edge: clear exactly, not clear with the margin.
const h = { x: 0, y: 0, heading: 0, a: 0.4, b: 0.35 };
const edge = h.b + PH.TYRE_HALF_M + 0.05;
assert.equal(PH.crossesPothole(h, -3, edge, 3, edge), false, "exactly: clear");
assert.equal(PH.crossesPothole(h, -3, edge, 3, edge, PH.SIM_PAD_M), true, "with the simulations' margin: too close");
assert.equal(PH.crossesPothole(h, -3, edge + PH.SIM_PAD_M + 0.01, 3, edge + PH.SIM_PAD_M + 0.01, PH.SIM_PAD_M), false);

// A hard brake while easing round one keeps the ease.
const street = { id: "street", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300, cls: "residential", lanes: 1,
  lane_offsets: [1.75], lane_width: 3.5, asphalt: [-5.6, 5.6], parking: [0, 0], limit: 13.9 };
const map = new MapData({ extent: [-10, -20, 310, 20], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }],
  edges: [street], lanes: [{ edge: "street", idx: 0, pts: [[0, -1.75], [300, -1.75]] }], intersections: [], stops: [], buildings: [] });
const world = new World(map, { parked: 0, pedestrians: 0, potholes: true });
world.potholes.setList([PH.potholeOnLane(map, "street", 0, 120, { id: "p1", offset: -0.83, a: 0.43, b: 0.47, depth: 0.066 })]);
world.route = new Route({ id: "straight", polyline: [[0, -1.75], [300, -1.75]], edges: ["street"], turns: [] }, map);
const brakeAt = (x, lateral) => {
  Object.assign(world.ego, { x, y: -1.75 - lateral, psi: 0, v: 7 });
  world.route.hint = 0;
  const snap = buildSnapshot(world), list = sampleCandidates(snap, world);
  return { snap, ease: list.find((c) => c.id === "ease_round_pothole"), brake: list.find((c) => c.id === "hard_brake") };
};
const far = brakeAt(60, 0);
assert.ok(far.ease, "the car can ease round it");
assert.equal(far.brake.law.detour ?? null, null, "short of the ease, a hard brake keeps to the lane");
const close = brakeAt(far.ease.law.detour.full - 2, 0.6);
assert.equal(close.brake.law.detour?.pothole, "p1", "easing round it, a hard brake carries on round it");
console.log("Pothole margin in the forward simulations; a hard brake keeps easing round");
process.exit(0);
