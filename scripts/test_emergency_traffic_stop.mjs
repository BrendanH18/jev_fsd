// Emergency stops are physical bumper positions, with enough room for the tail to clear a junction.
// node --experimental-default-type=module scripts/test_emergency_traffic_stop.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, SCHOOL_BUS } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");

function junctionWorld(weather) {
  const edges = [
    { id: "before", from: "a", to: "b", pts: [[0, 0], [100, 0]] },
    { id: "after", from: "b", to: "c", pts: [[100, 0], [200, 0]] },
    { id: "side", from: "b", to: "d", pts: [[100, 0], [100, 100]] },
  ].map(e => ({ ...e, length: 100, lanes: 1, lane_offsets: [0], lane_width: 3.5,
    asphalt: [-5, 5], parking: [0, 0], cls: "residential", limit: 13.9 }));
  const map = new MapData({ extent: [0, -10, 201, 110], buildings: [],
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }, { id: "c", x: 200, y: 0 }, { id: "d", x: 100, y: 100 }],
    edges, lanes: edges.map(e => ({ edge: e.id, idx: 0, pts: e.pts })), intersections: [], stops: [] });
  return new World(map, { parked: 0, pedestrians: 0, weather });
}

for (const followingDistance of [false, true]) for (const clearing of [false, true]) for (const weather of ["dry", "fog", "rain", "snow"]) {
  // City fog s1-9's school bus on Yew Street stopped short with its tail across West 5th Avenue.
  // Exercise that rear-clearance requirement as well as an ordinary mid-block pull-over.
  const w = clearing ? junctionWorld(weather) : fixtureWorld({ weather });
  w.followingDistance = followingDistance;
  Object.assign(w.ego, { x: 120, v: 0 });
  const f = new NpcFleet(w, { count: 0, bikes: 0 }); f.nextPull = f.nextPark = Infinity;
  assert.equal(!!f.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 70 }), true);
  f.emergencyStep = () => {};
  Object.assign(w.ego, { x: -1000, y: -1000 });
  const n = Object.assign(new Vehicle(100, 0, 0, 2, clearing ? SCHOOL_BUS : CAR), { id: "yielding", v0: 8, frozen: 0, waiting: 0,
    stopMem: new StopMemory(), path: new NpcPath(w.map, () => 0.5),
    driver: { s0: 2.4, aMax: 1.5, b: 2, T: 1.5, react: 0.5, lcRate: 0 } });
  if (clearing) n.path.start("before", 0, 100, [["after", 0]]);
  else n.path.start("street", 0, 100);
  f.vehicles.push(n);
  let goal = null;
  for (let k = 0; k < 16 * 60; k++) {
    f.step(1 / 60); w.t += 1 / 60;
    if (n.yieldEv?.stop) goal ??= n.yieldEv.stop[0];
  }
  assert.equal(typeof goal, "number");
  assert.equal(n.v < 0.1, true);
  assert.equal(n.yieldEv?.stop[0], goal, "keeps the original physical stop while braking");
  const label = `${weather}, followingDistance=${followingDistance}, clearing=${clearing}`;
  if (clearing) {
    const box = n.obb(), rear = box.center[0] - Math.abs(Math.cos(box.heading)) * box.halfLength - Math.abs(Math.sin(box.heading)) * box.halfWidth;
    assert.equal(rear > 100 + w.map.crossingHalfWidth("before"), true, `${label}: the whole bus clears the crossing street, rear=${rear}`);
  }
  const bumper = n.front[0];
  assert.equal(Math.abs(bumper - goal) < 0.6, true, `${label}: reached the chosen stop: bumper=${bumper}, goal=${goal}`);
}
console.log("Traffic reaches its physical emergency stop and clears the junction with either following policy in every grip condition");
process.exit(0);
