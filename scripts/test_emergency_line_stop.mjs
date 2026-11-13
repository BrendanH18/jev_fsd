// Giving way to an emergency vehicle at or just over a control line (docs/validation/merged-emergency-2026-11-12.md).
// A car stopped exactly at its line, a little over it, or crept past a stop sign's line to look, used to count
// as already in the junction: the plan was to clear it, 30-40 m on through a red light or a stop sign, every
// candidate was rejected, and the car stood in its lane while the vehicle went by (Montréal, Mount Pleasant,
// Calgary, Victoria, Kitsilano cover row 9). Junction nodes were placed by summed edge lengths, metres past the
// polyline's own after rounded corners. The audit took a line stop at the call only from behind the line, and
// the forward sims sent an oncoming ambulance, still angled from its turn, straight into a car at the kerb.
// Node 22, no server. node --experimental-default-type=module scripts/test_emergency_line_stop.mjs
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { World } = await import("../static/js/sim/world.js");
const { Vehicle, CAR, AMBULANCE } = await import("../static/js/sim/vehicle.js");
const { EV_BOX_M } = await import("../static/js/sim/emergency.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");

const ARM = 150, LINE = 135, FRONT = CAR.length - CAR.rearOverhang;
// A four-way junction at the origin; the car comes in from the west along `w_in` (`control` on it, or none).
// `drift` makes the summed edge length of `w_in` run past its polyline, as rounded corners do along a route.
function setup({ control = "signal", drift = 0, front = LINE - 0.5, v = 0, lateral = 0, line = LINE, crossHalf = 3.2 } = {}) {
  const nodes = [{ id: "w", x: -ARM, y: 0 }, { id: "c", x: 0, y: 0 }, { id: "e", x: ARM, y: 0 }, { id: "n", x: 0, y: ARM }, { id: "s", x: 0, y: -ARM }];
  const edges = [], lanes = [];
  for (const arm of ["w", "e", "n", "s"]) for (const inbound of [true, false]) {
    const from = inbound ? arm : "c", to = inbound ? "c" : arm, a = nodes.find((n) => n.id === from), b = nodes.find((n) => n.id === to);
    const id = `${arm}_${inbound ? "in" : "out"}`, pts = [[a.x, a.y], [b.x, b.y]], rx = (b.y - a.y) / ARM, ry = -(b.x - a.x) / ARM;
    const ctl = inbound && control ? { control: { type: control, id: control === "signal" ? "sig" : `stop_${arm}`, s_line: line, group: ["w", "e"].includes(arm) ? "A" : "B" } } : {};
    edges.push({ id, from, to, pts, length: ARM + (id === "w_in" ? drift : 0), lanes: 1, lane_width: 3.2, lane_offsets: [1.6], asphalt: ["n", "s"].includes(arm) ? [-crossHalf, crossHalf] : [-3.2, 3.2], parking: [0, 0],
      cls: "residential", limit: 13.9, oneway: false, name: `${arm} Street`, ...ctl });
    lanes.push({ edge: id, idx: 0, pts: pts.map(([x, y]) => [x + rx * 1.6, y + ry * 1.6]) });
  }
  const intersections = control === "signal" ? [{ id: "sig", x: 0, y: 0, offset_s: 0, vertices: ["c"], approaches: edges.filter((e) => e.control).map((e) => ({ edge: e.id, group: e.control.group, s_line: line })) }] : [];
  const map = new MapData({ bbox: [0, 0, 1, 1], extent: [-170, -170, 170, 170], edges, lanes, nodes, buildings: [], stops: [], intersections });
  const world = new World(map, { parked: 0, pedestrians: 0 });
  Object.assign(world.ego, { x: -ARM + front - FRONT, y: -1.6 - lateral, psi: 0, v });
  world.route = new Route({ id: "east", polyline: [[-ARM, -1.6], [ARM, -1.6]], edges: ["w_in", "e_out"], turns: [] }, map);
  return { world, map };
}
// An ambulance with its siren on along a lane polyline `pts` (sim/emergency.js), at (x, y) heading `psi`.
function ambulance(world, x, y, psi, v, pts) {
  const path = { pts, cum: cumulative(pts) };
  path.length = path.cum.at(-1);
  path.s = Math.hypot(x - pts[0][0], y - pts[0][1]);
  const ev = Object.assign(new Vehicle(x, y, psi, v, AMBULANCE), { id: "ambulance", kind: "ambulance", siren: true, path });
  world.npcs.push(ev);
  return ev;
}
// one coming the other way down the street, 60 m ahead
const oncoming = (world) => ambulance(world, world.ego.x + 60, 1.6, Math.PI, 8, [[ARM, 1.6], [-ARM, 1.6]]);
const lineAt = -ARM + LINE, nodeAt = 0;
const plan = (world) => buildSnapshot(world).emergency;

// Stopped exactly where Rules stops for a red light, 0.5 m short of the line: not in the junction.
{
  const { world } = setup({ control: "signal" });
  oncoming(world);
  const em = plan(world);
  assert.ok(em && em.stop_s_route !== null, "a stop is planned");
  assert.equal(em.clearing, false, "stopped at the line, the car is short of the junction, not clearing it");
  assert.ok(em.stop_s_route <= LINE + 1e-6, `it stops behind the line (${(em.stop_s_route - LINE).toFixed(2)} m)`);
  // (and a hair nearer, as the real runs had it by rounding, likewise)
  const near = setup({ control: "signal", front: LINE - 0.5 + 1e-9 }).world;
  oncoming(near);
  const em2 = plan(near);
  assert.equal(em2.clearing, false);
  assert.ok(em2.stop_s_route <= LINE + 1e-6, "and stops behind the line");
}
// A little over a signal's line and still rolling, as a short stop overshoots (Calgary s2-2).
{
  const { world } = setup({ control: "signal", front: LINE + 0.26, v: 0.43 });
  oncoming(world);
  const em = plan(world);
  assert.equal(em.clearing, false, "a little over the line is still short of the junction");
  assert.ok(em.bumper_to_stop_m < 0.1, "and stops where it is, not further over the line");
}
// Crept past a stop sign's line to look (Mount Pleasant s1-1): it stops short of the junction, using the
// room up to it to pull over.
{
  const { world } = setup({ control: "stop", front: LINE + 1.5, v: 1.5 });
  oncoming(world);
  const em = plan(world);
  assert.equal(em.clearing, false, "crept up to look, it is short of the junction");
  const stopX = -ARM + em.stop_s_route;
  assert.ok(stopX <= nodeAt - EV_BOX_M - 0.5 + 1e-6 && stopX <= nodeAt - 3.2 + 1e-6, `its front stops out of the box (${(nodeAt - stopX).toFixed(1)} m from the node)`);
  assert.ok(em.bumper_to_stop_m > 0.3, "with room to pull over in");
}
// Stopped at a stop sign whose line is 8.7 m from the node, past the stop 2.5 m short of the crossing street:
// it holds there, not creeping on over the line toward the junction (Kitsilano snow s1-2, which an earlier
// version of this change broke: the creep gave up the line stop without room to pull over).
{
  const line = ARM - 8.7;
  const { world } = setup({ control: "stop", line, front: line - 0.59, crossHalf: 7 });
  oncoming(world);
  const em = plan(world);
  assert.equal(em.clearing, false);
  assert.ok(em.stop_s_route <= line - 0.5 + 1e-6, `it stops short of its line (${(em.stop_s_route - line).toFixed(2)} m)`);
}
// And at a signal 0.3 m short of its line, past the stop 0.5 m short of it: it holds there.
{
  const { world } = setup({ control: "signal", front: LINE - 0.3 });
  oncoming(world);
  const em = plan(world);
  assert.equal(em.clearing, false);
  assert.ok(em.bumper_to_stop_m < 0.05 && em.stop_s_route <= LINE, `it holds where it is (${em.bumper_to_stop_m.toFixed(2)} m)`);
}
// Moving off over its line on a green (Kitsilano city fog s1-10, 2.4 m/s, 0.1 m over: stopping there left it in
// the lane over the line) it is on its way through, and clears the junction as before; at a red it holds.
for (const light of ["green", "red"]) {
  const { world } = setup({ control: "signal", front: LINE + 0.1, v: 2.42 });
  oncoming(world);
  let t = 0;
  while (t < 200 && buildSnapshot(world).intersection?.signal !== light) world.t = ++t;
  assert.equal(buildSnapshot(world).intersection?.signal, light, `the light shows ${light}`);
  world.evYield = null;
  assert.equal(plan(world).clearing, light === "green", `moving off over the line at ${light}`);
}
// Coming up past the line at speed is still clearing the junction, as before.
{
  const { world } = setup({ control: "signal", front: LINE - 0.3, v: 8 });
  oncoming(world);
  assert.equal(plan(world).clearing, true, "at 8 m/s over the line it clears the junction");
}
console.log("✓ at or just over a control line, the car is short of the junction: it holds there, or pulls over before it");

// The junction's node where the polyline has it, not 7 m on by summed edge lengths (Montréal s1-2).
{
  const { world } = setup({ control: null, drift: 7, front: 100, v: 8 });
  assert.ok(world.route.edgeStarts[1] - world.route.laneEdgeStarts()[1] > 6, "the summed lengths run past the node");
  oncoming(world);
  const em = plan(world);
  assert.equal(em.clearing, false);
  const stopX = -ARM + em.stop_s_route;
  assert.ok(stopX <= nodeAt - EV_BOX_M - 0.5 + 1e-6, `it stops out of the box round the node (${(nodeAt - stopX).toFixed(1)} m from it)`);
}
console.log("✓ the stop short of a junction is placed by the polyline, out of the box round its node");

// The audit: stopped a little over a signal's line, or still rolling to that stop, when the siren arrives, holding
// the line stop as the vehicle goes by is yielding; well over it, with room to pull over, it is not.
function auditPass(front, v, settle) {
  const { world } = setup({ control: "signal", front, v });
  const ev = ambulance(world, world.ego.x + 70, 1.6, Math.PI, 4, [[ARM, 1.6], [-ARM, 1.6]]);
  world.auditEmergency(world.roadInfo());
  if (settle) { world.ego.x += settle; world.ego.v = 0; world.t = 1; world.auditEmergency(world.roadInfo()); }
  const middle = world.ego.spec.length / 2 - world.ego.spec.rearOverhang;
  for (const [t, ahead] of [[9.9, 0.1], [10, -0.1]]) {
    ev.x = world.ego.x + middle + ahead + ev.spec.length / 2 - ev.spec.rearOverhang;
    ev.path.s = ARM - ev.x;
    world.t = t;
    world.auditEmergency(world.roadInfo());
  }
  return world.violations.failed_to_yield;
}
assert.equal(auditPass(LINE + 0.4, 0, 0), 0, "stopped 0.4 m over the line at the call, holding it is yielding");
assert.equal(auditPass(LINE + 0.26, 0.43, 0.03), 0, "rolling the last centimetres of a stop 0.26 m over the line, likewise");
assert.equal(auditPass(LINE + 2.5, 0, 0), 1, "2.5 m over the line is not a line stop: it had room to pull over");
console.log("✓ the audit takes a line stop that overshot a little, at the call, as it does after an approach");

// The audit: queued behind a stopped car when the siren arrives, then the queue moves up and stops again
// (Kitsilano snow s1-4: 1.6 m, to a red light, 3.5 s after it moved). Stopped in it again within the time a
// release leaves to pull over, and having moved up a car's length or less, the car is as boxed in as before.
function queuePass(moveUp, requeueAt) {
  const { world } = setup({ control: null, front: 60 });
  const ev = ambulance(world, world.ego.x + 70, 1.6, Math.PI, 4, [[ARM, 1.6], [-ARM, 1.6]]);
  const lead = Object.assign(new Vehicle(world.ego.x + world.ego.spec.length + 2.8, world.ego.y, 0, 0), { id: "queue" });
  world.npcs.push(lead);
  world.auditEmergency(world.roadInfo());
  // (the queue moves off, and the car after it)
  lead.v = 1.5; world.t = 1; world.auditEmergency(world.roadInfo());
  lead.x += moveUp; world.ego.x += moveUp; world.ego.v = 0.5; world.t = requeueAt - 0.5; world.auditEmergency(world.roadInfo());
  lead.v = 0; world.ego.v = 0; world.t = requeueAt; world.auditEmergency(world.roadInfo());
  const middle = world.ego.spec.length / 2 - world.ego.spec.rearOverhang;
  for (const [t, ahead] of [[9.9, 0.1], [10, -0.1]]) {
    ev.x = world.ego.x + middle + ahead + ev.spec.length / 2 - ev.spec.rearOverhang;
    ev.path.s = ARM - ev.x;
    world.t = t;
    world.auditEmergency(world.roadInfo());
  }
  return world.violations.failed_to_yield;
}
assert.equal(queuePass(1.6, 4.5), 0, "moved up 1.6 m with the queue and stopped in it again: still queued");
assert.equal(queuePass(12, 4.5), 1, "moved up 12 m: it had the room to pull over");
assert.equal(queuePass(1.6, 6), 1, "stopped in it again only after the time a release leaves: it had that time to pull over");
// Still standing in the queue it was in at the call, the car is not what holds up a vehicle that has found a way
// past the queue's front but not past the car (Kitsilano snow s1-9, a fire truck coming the other way).
for (const queuedAtCall of [true, false]) {
  const { world } = setup({ control: null, front: 60, v: queuedAtCall ? 0 : 3 });
  const ev = ambulance(world, world.ego.x + 25, -0.7, Math.PI, 0, [[ARM, 1.6], [-ARM, 1.6]]);
  world.npcs.push(Object.assign(new Vehicle(world.ego.x + world.ego.spec.length + 2.8, world.ego.y, 0, 0), { id: "queue" }));
  world.auditEmergency(world.roadInfo());
  world.ego.v = 0; world.t = 7; ev.blockedBy = [world.ego]; ev.blockedFor = 7;
  world.auditEmergency(world.roadInfo());
  assert.equal(world.violations.failed_to_yield, queuedAtCall ? 0 : 1, queuedAtCall ? "held in its queue, it is not the cause" : "a car that came up to the queue after the call still is");
}
console.log("✓ a queue that moves up a little and stops again still leaves the car queued, and is not what holds a vehicle up");

// The forward sims: an ambulance coming the other way, still angled across the road from its turn into the
// street, is not predicted to drive into a car stopped at the kerb (Kitsilano snow s1-4).
{
  const { world } = setup({ control: null, front: 60 });
  const ev = ambulance(world, world.ego.x + 18, 1.6, Math.PI + 0.5, 4, [[ARM, 1.6], [-ARM, 1.6]]);
  const snap = buildSnapshot(world);
  assert.ok(snap.emergency, "the ambulance calls on the car");
  const candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  const hit = candidates.filter((c) => c.sim?.collision?.id === "ambulance").map((c) => c.id);
  assert.equal(hit.length, 0, `no candidate is predicted to be run into by the ambulance (${hit.join(", ")})`);
  assert.ok(candidates.some((c) => c.id === "pull_over" && c.eligible), "pulling over stays eligible");
  // (the same vehicle with its siren off is ordinary traffic, predicted straight on along its heading)
  ev.siren = false;
  const snap2 = buildSnapshot(world), plain = sampleCandidates(snap2, world);
  simulateAll(plain, snap2, world);
  assert.ok(plain.some((c) => c.sim?.collision?.id === "ambulance"), "ordinary traffic on that heading is still predicted to hit");
}
// ...but its body is still where it is: one stopped in the car's lane ahead is still in the way.
{
  const { world } = setup({ control: null, front: 60, v: 8 });
  ambulance(world, world.ego.x + 12, -1.6, Math.PI, 0, [[ARM, 1.6], [-ARM, 1.6]]);
  const snap = buildSnapshot(world), candidates = sampleCandidates(snap, world);
  simulateAll(candidates, snap, world);
  const pull = candidates.find((c) => c.id === "pull_over");
  assert.ok(pull, "pulling over is offered");
  assert.equal(pull.sim?.collision?.id, "ambulance", "pulling over at speed is predicted into the ambulance standing in the lane");
}
console.log("✓ an ambulance coming the other way is not predicted into a car at the kerb; ordinary traffic still is, and a standing one is in the way");
process.exit(0);
