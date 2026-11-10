// Emergency-yield audits at control lines, close queues and snowbank narrowings.
// Capture constraints when the call begins, keep drive-on authorization, and retain
// penalties for avoidable stops and obstructions. Node 22; no server required.
// node --experimental-default-type=module scripts/test_emergency_control_line.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, AMBULANCE } = await import("../static/js/sim/vehicle.js");

function setup(type = "signal", { speed = 0, midblock = false, blockFront = 130, gap = 0.7, queueGap = null, narrowing = false } = {}) {
  const control = { type, id: "line", s_line: 185, group: "A", all_way: true };
  const edge = { id: "in", from: "w", to: "c", pts: [[-200, 0], [0, 0]], length: 200,
    lanes: 1, lane_width: 3.2, lane_offsets: [1.6], asphalt: [-5.3, 5.3], parking: [2.1, 2.1],
    cls: "residential", limit: 11.1, oneway: false, control };
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-220, -20, 220, 20],
    nodes: [{ id: "w", x: -200, y: 0 }, { id: "c", x: 0, y: 0 }],
    edges: [edge, { ...edge, id: "out", from: "c", to: "w", pts: [[0, 0], [-200, 0]], control: null }],
    lanes: [{ edge: "in", idx: 0, pts: [[-200, -1.6], [0, -1.6]] }, { edge: "out", idx: 0, pts: [[0, 1.6], [-200, 1.6]] }],
    intersections: [], stops: [], buildings: [] });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  world.placeOnLane(map.lane("in", 0), (midblock ? blockFront : control.s_line - gap) - front);
  world.ego.v = speed;
  const pts = [[100, 1.6], [-200, 1.6]];
  const ev = Object.assign(new Vehicle(world.ego.x + 70, 1.6, Math.PI, 4, AMBULANCE), {
    id: "ambulance", kind: "ambulance", siren: true,
    path: { pts, cum: cumulative(pts), length: 300, s: 100 - world.ego.x - 70 },
  });
  world.npcs.push(ev);
  if (queueGap !== null) world.npcs.push(Object.assign(new Vehicle(world.ego.x + world.ego.spec.length + queueGap, world.ego.y, 0, 0), { id: "queue" }));
  if (narrowing) {
    world.snowbanks.enabled = true; world.snowbanks.random = () => 0.5;
    world.snowbanks.build({ narrowings: [{ edge: "in", a: 100, b: 160 }] });
    world.ego.y = -1.6 - narrowing;
  }
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
// Lateral lane control and the pull-over audit use the rear axle. Yaw alone must
// neither create nor erase that lateral move; swept bodies are checked separately.
for (const [axleRight, heading, expected] of [[0.1, -0.2, 1], [0.3, 0.2, 0]]) {
  const { world, ev } = setup("signal", { midblock: true });
  world.ego.y -= axleRight; world.ego.psi = heading;
  world.evCalls.clear(); world.auditEmergency(world.roadInfo());
  const [cx, cy] = world.ego.center;
  for (const [t, along] of [[9.9, 0.1], [10, -0.1]]) {
    ev.x = cx + along * Math.cos(heading) - 3.2 * Math.sin(heading) + ev.spec.length / 2 - ev.spec.rearOverhang;
    ev.y = cy + along * Math.sin(heading) + 3.2 * Math.cos(heading);
    ev.path.s = 100 - ev.x; world.t = t;
    world.auditEmergency(world.roadInfo());
  }
  assert.equal(world.violations.failed_to_yield, expected,
    `rear-axle pull-over with axle ${axleRight} and heading ${heading}`);
}
console.log("✓ late stops, mid-block stops, moving away and holding up the ambulance still fail the audit");
// The siren can begin during the last crawl into a stop, not only after v reaches zero.
for (const [speed, gap, travel] of [[0.784, 2.323, 1.45], [1.254, 1.5, 0.9], [2.255, 3.295, 3.716]]) {
  const { world, ev } = setup("signal", { speed, gap });
  world.ego.x += travel; world.ego.v = 0; world.t = 2.5;
  world.auditEmergency(world.roadInfo());
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 0, `finishing the constrained ${speed} m/s stop is yielding`);
}
{
  const { world, ev } = setup("signal", { speed: 2, gap: 20 });
  world.ego.x += 19.3; world.ego.v = 0; world.t = 3;
  world.auditEmergency(world.roadInfo()); pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "room to pull over at the call cannot be excused by a later line stop");
}
console.log("✓ a constrained crawl may finish its line stop; an earlier opportunity to pull over is still audited");
for (const queueGap of [2.8, 8]) {
  const { world, ev } = setup("signal", { midblock: true, queueGap });
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, queueGap < 5 ? 0 : 1, "only an existing close queue excuses holding still");
}
{
  const { world, ev } = setup("signal", { midblock: true, queueGap: 2.8 });
  world.npcs = [ev]; pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "a queue that clears no longer prevents pulling over");
}
{
  const { world, ev } = setup("signal", { midblock: true, speed: 3, queueGap: 2.8 });
  world.ego.v = 0; world.t = 7; ev.blockedBy = [...world.npcs.filter(n => n !== ev), world.ego]; ev.blockedFor = 7;
  world.auditEmergency(world.roadInfo());
  assert.equal(world.violations.failed_to_yield, 0, "a car cannot drive on into the second blocker in front of it");
  ev.blockedBy = [world.ego]; world.auditEmergency(world.roadInfo());
  assert.equal(world.violations.failed_to_yield, 1, "blocking the ambulance alone still fails");
}
{
  const { world, ev } = setup("signal", { midblock: true });
  world.npcs.push(Object.assign(new Vehicle(world.ego.x + world.ego.spec.length + 2.8, world.ego.y, 0, 0), { id: "late-queue" }));
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "a queue encountered after the call cannot erase an earlier opportunity");
}
{
  const { world, ev } = setup("signal", { midblock: true, speed: 3, queueGap: 2.8 });
  ev.x = world.ego.x - 20; ev.y = world.ego.y + 2; ev.psi = world.ego.psi;
  ev.path = { pts: [[-200, ev.y], [100, ev.y]], cum: [0, 300], length: 300, s: ev.x + 200 };
  world.evCalls.clear(); world.auditEmergency(world.roadInfo());
  world.ego.v = 0; world.t = 4; ev.blockedFor = 4; ev.blockedBy = [world.ego, world.npcs.find(n => n.id === "queue")];
  world.auditEmergency(world.roadInfo());
  assert.equal(world.evCalls.get(ev.id)?.lead, true, "being unable to pull farther over still permits the instructed drive-on");
  world.npcs = [ev]; world.ego.v = 5; world.t = 8;
  world.auditEmergency(world.roadInfo());
  assert.equal(world.violations.failed_to_yield, 0, "the authorization survives the queue opening and the car starting to move");
}
console.log("✓ a close existing queue and a second blocker are distinguished from an avoidable obstruction");
for (const offset of [-0.4, -0.407, -0.49, -0.51, -1]) {
  const { world, ev } = setup("signal", { midblock: true, narrowing: offset });
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, offset >= -0.5 ? 0 : 1, "the narrowed target retains the normal pull-over settling allowance, but no more");
}
{
  const { world, ev } = setup("signal", { midblock: true, narrowing: -0.4 });
  world.ego.x -= 60; ev.x -= 60; ev.path.s += 60; world.evCalls.clear();
  world.auditEmergency(world.roadInfo()); pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "the narrowing exception cannot apply outside a narrowed stretch");
}
{
  const { world, ev } = setup("signal", { midblock: true, narrowing: -0.4 });
  world.snowbanks.enabled = false; pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "disabled snowbanks cannot change the audit's right edge");
}
{
  // City snow s1-7's front is 0.58 m before the parked cars: already at
  // the driving policy's full narrowing offset, not outside its corridor.
  const { world, ev } = setup("signal", { midblock: true, blockFront: 99.42, narrowing: 0.05 });
  pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 0, "the audit includes the full corridor's approach margin");
}
console.log("✓ snowbanks change the usable right edge; stopping farther left or outside the narrowing is still audited");
{
  const { world, ev } = setup("signal", { speed: 0.784, gap: 2.323 });
  const edge = world.map.edges.get("in");
  edge.control = { ...edge.control, id: "next-line", s_line: edge.control.s_line + 20 };
  world.ego.x += 21.45; world.ego.v = 0; world.t = 2.5;
  world.auditEmergency(world.roadInfo()); pass(world, ev);
  assert.equal(world.violations.failed_to_yield, 1, "an approach allowance cannot transfer to another control");
}
console.log("✓ the crawl allowance stays with the original physical approach");
process.exit(0);
