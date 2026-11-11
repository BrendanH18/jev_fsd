// A car stopped at the hold line behind a traffic car reversing into a space (sim/parkers.js) has
// nowhere to pull over to: the room between them is the parker's. When an emergency vehicle comes up
// behind and goes round, holding that stop is yielding, as in a queue behind a stopped car
// (World.parkerQueue in auditEmergency). Winnipeg's city smoke s1-1 counted it as a failure to yield.
// Released from that queue just before the vehicle passes, the car has as long to pull over as it had
// from the call. Without the parker, staying in the lane as the vehicle passes still fails.
// node --experimental-default-type=module scripts/test_emergency_parker_queue.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");

function pass({ parker, phase = "reverse", hold = 0.2, parkedAt = Infinity }) {
  const street = { id: "street", from: "a", to: "b", pts: [[0, 0], [300, 0]], length: 300,
    cls: "residential", lanes: 1, lane_offsets: [1.75], lane_width: 3.5, asphalt: [-5.6, 5.6], parking: [2.1, 2.1], limit: 13.9 };
  const map = new MapData({ extent: [-10, -20, 310, 20], nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 300, y: 0 }],
    edges: [street], lanes: [{ edge: "street", idx: 0, pts: [[0, -1.75], [300, -1.75]] }], intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0, parkers: true });
  Object.assign(world.ego, { x: 100, y: -1.75, psi: 0, v: 0 });
  world.route = new Route({ id: "straight", polyline: [[0, -1.75], [300, -1.75]], edges: ["street"], turns: [] }, world.map);
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 });
  const FRONT = world.ego.spec.length - world.ego.spec.rearOverhang;
  if (parker) {
    // its rear bumper 7 m ahead of the car's front, reversing in; the car at its hold line
    const P = new Vehicle(100 + FRONT + 7 + world.ego.spec.rearOverhang, -1.75, 0, -0.8);
    P.id = "car_p1";
    P.parker = { phase, plan: { h: 0 }, line: [100 + FRONT + hold, -1.75], hold: 7 };
    world.parkers.active.push(P);
    world.npcs.push(P);
  }
  const ev = fleet.dispatchEmergency({ relation: "behind", kind: "ambulance", distance: 60 });
  assert.equal(ev?.kind, "ambulance");
  // It comes up behind, then goes round through the other lane, never held up by the car.
  for (let k = 0; k <= 40; k++) {
    world.t = k * 0.25;
    // (the parker finishes and leaves the street for its space)
    if (parker && world.t >= parkedAt && world.parkers.active.length) { world.parkers.active.length = 0; world.npcs.length = 0; world.npcs.push(ev); }
    Object.assign(ev, { x: 40 + k * 3, y: k > 12 ? 1.75 : -1.75, psi: 0, v: 12, blockedBy: null, blockedFor: 0 });
    world.auditEmergency(world.roadInfo());
  }
  return { failed: world.violations.failed_to_yield, queued: parker ? world.parkerQueue(FRONT)?.id ?? null : null };
}

const held = pass({ parker: true });
assert.equal(held.queued, "car_p1", "the car at the parker's hold line is queued behind it");
assert.equal(held.failed, 0, "holding the stop behind a reversing parker is yielding");
assert.equal(pass({ parker: true, phase: "stop" }).failed, 0, "and behind one stopped to start reversing");
// (not one still signalling on its way to the space: the car could still pull over short of it)
assert.equal(pass({ parker: true, phase: "approach" }).failed, 1, "a parker still approaching its space is no queue");
// (nor one whose hold line is well ahead: the car had room to pull over before it)
assert.equal(pass({ parker: true, hold: 6 }).failed, 1, "a hold line 6 m ahead leaves room to pull over");
// The parker gets into its space half a second before the vehicle draws level: released from the queue,
// the car has as long to pull over as it had from the call (Edmonton's city smoke s1-1).
assert.equal(pass({ parker: true, parkedAt: 2.75 }).failed, 0, "released just before the vehicle passes: no failure");
assert.equal(pass({ parker: true, parkedAt: -1 }).failed, 1, "released long before it passes: staying in the lane fails");
assert.equal(pass({ parker: false }).failed, 1, "with no parker ahead, staying in the lane as it passes is a failure to yield");
console.log("A car held behind a reversing parker yields to an emergency vehicle going round");
process.exit(0);
