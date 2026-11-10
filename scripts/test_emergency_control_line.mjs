// City s1-7: an ambulance passes a car already stopped at a dark signal's line. The line
// is farther from the junction centre than the emergency audit's 8 m box; the car cannot
// steer over without crossing it. Exercise the audit without the server or a planned law.
// node --experimental-default-type=module scripts/test_emergency_control_line.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, AMBULANCE } = await import("../static/js/sim/vehicle.js");

function setup(type = "signal", { speed = 0, midblock = false } = {}) {
  const control = { type, id: "line", s_line: 185, group: "A", all_way: true };
  const edge = { id: "in", from: "w", to: "c", pts: [[-200, 0], [0, 0]], length: 200,
    lanes: 1, lane_width: 3.2, lane_offsets: [1.6], asphalt: [-5.3, 5.3], parking: [2.1, 2.1],
    cls: "residential", limit: 11.1, oneway: false, control };
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-220, -20, 220, 20],
    nodes: [{ id: "w", x: -200, y: 0 }, { id: "c", x: 0, y: 0 }],
    edges: [edge], lanes: [{ edge: "in", idx: 0, pts: [[-200, -1.6], [0, -1.6]] }],
    intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  world.placeOnLane(map.lane("in", 0), (midblock ? 130 : control.s_line - 0.7) - front);
  world.ego.v = speed;
  const pts = [[100, 1.6], [-200, 1.6]];
  const ev = Object.assign(new Vehicle(world.ego.x + 70, 1.6, Math.PI, 4, AMBULANCE), {
    id: "ambulance", kind: "ambulance", siren: true,
    path: { pts, cum: cumulative(pts), length: 300, s: 100 - world.ego.x - 70 },
  });
  world.npcs.push(ev);
  world.auditEmergency(world.roadInfo());
  return { world, ev };
}

function pass(world, ev) {
  // Its centre crosses the car's centre after 10 s. No integration or route assumptions.
  const middle = world.ego.spec.length / 2 - world.ego.spec.rearOverhang;
  for (const [t, ahead] of [[9.9, 0.1], [10, -0.1]]) {
    ev.x = world.ego.x + middle + ahead + ev.spec.length / 2 - ev.spec.rearOverhang;
    ev.path.s = 100 - ev.x;
    world.t = t;
    world.auditEmergency(world.roadInfo());
  }
}

for (const type of ["signal", "stop"]) for (const speed of [0, 0.175]) {
  const { world, ev } = setup(type, { speed });
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 0, `holding the ${type} line is yielding`);
}
console.log("✓ a car already stopped at a signal or stop line may hold that stop as the ambulance passes");

{
  const { world, ev } = setup("signal", { speed: 8 });
  world.ego.v = 0;
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "stopping at the line after the call does not excuse failing to pull over");
}
{
  const { world, ev } = setup("signal", { midblock: true });
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "a stationary car with room to pull over must do so");
}
{
  const { world, ev } = setup();
  world.ego.x -= 3;
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "moving away ends the held-line exception");
}
{
  const { world, ev } = setup();
  world.ego.x += 1;
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "crossing the line ends the held-line exception");
}
{
  const { world, ev } = setup();
  ev.blockedBy = [world.ego]; ev.blockedFor = 7;
  world.t = 7;
  world.auditEmergency(world.roadInfo());
  assert.equal(world.violations.failed_to_yield, 1, "holding up the ambulance is still audited");
}
console.log("✓ late stops, mid-block stops, moving away and holding up the ambulance still fail the audit");
process.exit(0);
