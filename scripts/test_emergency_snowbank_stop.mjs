// A pull-over ending before a snowbank narrowing must not steer left into its approach detour.
// node --experimental-default-type=module scripts/test_emergency_snowbank_stop.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const w = fixtureWorld({ weather: "snow" });
w.map.edges.get("street").lane_width = 3.2;
Object.assign(w.ego, { x: 100, v: 2 });
for (let x = 90; x < 140; x += 7) w.parked.add(Object.assign(new Vehicle(x, -2.65, 0, 0), { id: `kerb_${x}` }));
const fleet = new NpcFleet(w, { count: 0, bikes: 0 });
const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 60 });
assert.equal(ev?.kind, "ambulance");
const snap = buildSnapshot(w);
const detour = { id: "sb:narrow", from: 90, full: 115, back: 150, to: 158, shift: -0.4 };
snap.snowbank = { narrowing: { entry_s_route: 116, detour, wait: false } };
const stop = sampleCandidates(snap, w).find(c => c.id === "pull_over");
assert.equal(!!stop, true);
assert.equal(stop.law.detour === null, true, "a stop before the corridor keeps the pull-over's rightward line");
const front = w.ego.spec.length - w.ego.spec.rearOverhang;
const law = { ...stop.law, s0: snap.routeProj.s, stopAt: stop.law.stopAtRoute - snap.routeProj.s };
for (let k = 0; k < 12 * 60; k++) {
  const p = w.route.project(w.ego.x, w.ego.y);
  applyLaw(w.ego, law, w.route, p.s, 1 / 60, w);
}
assert.equal(w.ego.v < 0.1, true);
assert.equal(w.roadInfo().lateral >= 0.25, true, `pulled right before stopping: ${w.roadInfo().lateral}`);
assert.equal(w.ego.x + front < 116, true, "stopped outside the narrowing");
snap.emergency.stop_s_route = 140;
assert.equal(sampleCandidates(snap, w).find(c => c.id === "pull_over").law.detour?.id, detour.id,
  "a stop inside the narrowing still keeps clear of its pushed-out parked cars");
{
  // A stop just beyond a corner must also leave distance for pure pursuit to settle right.
  const { MapData } = await import("../static/js/map/mapdata.js");
  const { World } = await import("../static/js/sim/world.js");
  const { Route } = await import("../static/js/map/route.js");
  const { routeFromLanes } = await import("../static/js/demo/routing.js");
  const before = { id: "before", from: "a", to: "b", pts: [[-100, 0], [0, 0]], length: 100,
    lanes: 1, lane_width: 3.2, lane_offsets: [0], asphalt: [-5, 5], parking: [0, 0], cls: "residential", limit: 11, oneway: true };
  const right = { ...before, id: "right", from: "b", to: "c", pts: [[0, 0], [0, -100]] };
  const other = { ...before, id: "other", from: "b", to: "d", pts: [[0, 0], [100, 0]] };
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-120, -120, 120, 40], edges: [before, right, other],
    lanes: [before, right, other].map(e => ({ edge: e.id, idx: 0, pts: e.pts })),
    nodes: [{ id: "a", x: -100, y: 0 }, { id: "b", x: 0, y: 0 }, { id: "c", x: 0, y: -100 }, { id: "d", x: 100, y: 0 }], intersections: [], stops: [], buildings: [] });
  const w = new World(map, { parked: 0, pedestrians: 0 });
  w.placeOnLane(map.lane("before", 0), 96); w.ego.v = 2;
  w.route = new Route(routeFromLanes(map, [map.lane("before", 0), map.lane("right", 0)]), map);
  const f = new NpcFleet(w, { count: 0, bikes: 0 });
  assert.equal(!!f.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 60 }), true);
  // (from where the polyline passes the node, as the stop is planned: the summed edge lengths run past it
  // round the rounded corner, scripts/test_emergency_line_stop.mjs)
  const needed = w.route.laneEdgeStarts()[1] + map.crossingHalfWidth("before") + w.ego.spec.length + 1 + 8;
  assert.equal(buildSnapshot(w).emergency.stop_s_route >= needed - 0.01, true, "steering room after clearing the corner");
  const en = needed - 3;
  w.snowbanks.narrowings = [{ id: "test" }]; w.snowbanks.alongRoute = () => ({ en, ex: en + 40 }); w.evYield = null;
  assert.equal(Math.abs(buildSnapshot(w).emergency.stop_s_route - (en - 2)) < 0.01, true, "extra steering room still stops before a narrowed corridor");
  const frontS = w.route.project(w.ego.x, w.ego.y).s + w.ego.spec.length - w.ego.spec.rearOverhang;
  w.ego.v = 12; w.evYield = null; w.snowbanks.alongRoute = () => ({ en: frontS + 3, ex: frontS + 43 });
  const fast = buildSnapshot(w).emergency;
  assert.equal(fast.stop_s_route >= needed - 0.01, true, "does not invent an impossible short stop before the corridor");
  w.t += 8;
  assert.equal(buildSnapshot(w).emergency.max_speed_mps < 3, true, "extra clearing distance does not hold driving speed after a siren call");
}
console.log("An emergency stop before a snowbank narrowing pulls right and stays outside it");
process.exit(0);
