// Drive-on authorization belongs to the physical emergency-yield audit, not the stop plan.
// node --experimental-default-type=module scripts/test_emergency_lead.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Route } = await import("../static/js/map/route.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");

function setup(right, atLine = false, speed = 0) {
  const street = { id: "street", from: "a", to: "b", pts: [[0, 0], [120, 0]], length: 120,
    cls: "residential", lanes: 1, lane_offsets: [0], lane_width: 3.5, asphalt: [-5, 5], parking: [0, 0], limit: 13.9 };
  const edges = [street, { ...street, id: "exit", from: "b", to: "c", pts: [[120, 0], [200, 0]], length: 80 },
    { ...street, id: "right", from: "b", to: "d", pts: [[120, 0], [120, -100]], length: 100 }];
  const map = new MapData({ extent: [-10, -110, 210, 10],
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 120, y: 0 }, { id: "c", x: 200, y: 0 }, { id: "d", x: 120, y: -100 }],
    edges, lanes: edges.map(e => ({ edge: e.id, idx: 0, pts: e.pts })), intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0, weather: "snow" });
  Object.assign(world.ego, { x: 100, y: -right, v: speed });
  if (atLine) {
    const front = world.ego.spec.length - world.ego.spec.rearOverhang;
    world.map.edges.get("street").control = { type: "stop", id: "line", s_line: 100 + front + 0.368, all_way: false };
  }
  world.route = new Route({ id: "straight", polyline: [[0, 0], [200, 0]], edges: ["street", "exit"], turns: [] }, world.map);
  const fleet = new NpcFleet(world, { count: 0, bikes: 0 });
  const ev = fleet.dispatchEmergency({ relation: "behind", kind: "fire_truck", distance: 60 });
  assert.equal(ev?.kind, "fire_truck");
  ev.psi = world.ego.psi; ev.blockedBy = [world.ego]; ev.blockedFor = 4;
  world.auditEmergency(world.roadInfo());
  return { world, ev };
}
{
  // With room to pull over, the request alone must not release the stop.
  const { world, ev } = setup(0.0134);
  const snap = buildSnapshot(world);
  assert.equal(world.evCalls.get(ev.id)?.lead === true, false, "the physical audit has not authorized driving on");
  assert.equal(snap.emergency?.lead, false, "sensing cannot release the stop before that authorization");
  assert.equal(sampleCandidates(snap, world).some(c => c.id === "pull_over"), true, "keep the pull-over available");
  assert.equal(sampleCandidates(snap, world).every(c => c.law.kind !== "lane" || c.law.vTarget <= snap.emergency.max_speed_mps), true,
    "every lane candidate retains the siren response ceiling");
  world.t = 10; world.ego.v = 3.1;
  world.auditEmergency(world.roadInfo());
  assert.equal(world.violations.failed_to_yield, 1, "driving on without pulling over still fails the late-yield audit");
}
{
  const { world, ev } = setup(0.3);
  assert.equal(world.evCalls.get(ev.id)?.lead, true);
  assert.equal(buildSnapshot(world).emergency?.lead, true, "a qualified drive-on instruction reaches sensing");
  // The instruction survives moving away from the curb and changing heading through a turn,
  // after the truck's original request has ended.
  world.t = 10; Object.assign(world.ego, { x: 105, y: 0, psi: -Math.PI / 2, v: 4 });
  ev.blockedBy = null; ev.blockedFor = 0;
  world.auditEmergency(world.roadInfo());
  assert.equal(buildSnapshot(world).emergency?.lead, true, "turning cannot create a second opinion about an authorized lead");
  assert.equal(world.violations.failed_to_yield, 0);
  // A stop plan is disposable. Replacing it must not lose the physical authorization.
  world.evYield = null;
  assert.equal(buildSnapshot(world).emergency?.lead, true, "rebuilding the stop plan reads the same authorization");
}
{
  // Snow city s1-4: an already constrained line stop cannot steer farther right.
  const { world, ev } = setup(0.0134, true);
  assert.equal(!!world.evCalls.get(ev.id)?.stoppedAtLine, true, "the call captured the physical constraint");
  assert.equal(world.evCalls.get(ev.id)?.lead, true, "the same valid stop may accept the truck's drive-on instruction");
  assert.equal(buildSnapshot(world).emergency?.lead, true);
  // Moving through the right turn ends the line constraint, but not the instruction.
  world.t = 10; Object.assign(world.ego, { x: 118, y: 0, psi: -Math.PI / 2, v: 4 });
  ev.blockedBy = null; ev.blockedFor = 0;
  world.auditEmergency(world.roadInfo());
  assert.equal(world.evJunction, "b", "the moving front has entered the junction with the siren now to its right");
  assert.equal(!!world.evCalls.get(ev.id)?.stoppedAtLine, false);
  assert.equal(buildSnapshot(world).emergency?.lead, true);
  assert.equal(world.violations.failed_to_yield, 0, "an authorized turn is neither a late yield nor a new crossing call");
}
{
  const { world, ev } = setup(0.0134, true, 8);
  world.t = 4; world.ego.v = 0;
  world.auditEmergency(world.roadInfo());
  assert.equal(!!world.evCalls.get(ev.id)?.stoppedAtLine, false, "a late stop cannot manufacture the captured constraint");
  assert.equal(buildSnapshot(world).emergency?.lead, false);
  world.t = 8; world.ego.v = 4;
  world.auditEmergency(world.roadInfo());
  assert.equal(world.violations.failed_to_yield, 1, "the shared state preserves penalties for a missed pull-over");
}
{
  const { world, ev } = setup(0.0134);
  world.evCalls.clear();
  Object.assign(world.ego, { x: 108, psi: -Math.PI / 2, v: 2 });
  ev.blockedBy = null; ev.blockedFor = 0;
  world.auditEmergency(world.roadInfo());
  world.t = 4; world.ego.x = 118;
  world.auditEmergency(world.roadInfo());
  assert.equal(world.evJunction, "b");
  assert.equal(world.violations.failed_to_yield, 1, "entering for a crossing siren without drive-on authorization still fails");
}
console.log("Emergency sensing and auditing share qualified drive-on authorization");
process.exit(0);
