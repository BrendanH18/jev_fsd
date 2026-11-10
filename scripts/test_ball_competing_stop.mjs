// A sign or pedestrian stop still has to anticipate the ball warning's falling cover speed.
import assert from "node:assert/strict";
globalThis.document = { querySelector: () => null };
const { fixtureWorld } = await import("../static/tests/jev-fixtures.js");
const { BallChase, coverAfter } = await import("../static/js/sim/ball-chase.js");
const { Route } = await import("../static/js/map/route.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates } = await import("../static/js/brain/candidates.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const world = fixtureWorld({ weather: "rain" }), edge = world.map.edges.get("street");
edge.limit = 8.3; edge.control = { type: "stop", id: "stop", s_line: 67.5, all_way: false };
world.route = new Route({ id: "straight", polyline: [[0, 0], [200, 0]], edges: ["street"], turns: [] }, world.map);
world.ego.v = 6.54;
world.balls = new BallChase(world, { enabled: true }); world.balls.target = 0;
world.balls.place({ edge: "street", s: 60, lat: -5.3, side: -1 }, { speed: 3.92, delay: 1.5, childSpeed: 2.6 });
const fleet = new NpcFleet(world, { count: 0, bikes: 0 }); fleet.nextPark = fleet.nextPull = Infinity;
const autopilot = new Autopilot(world); autopilot.setBrain("rules"); autopilot.setEnabled(true);
let competing = false;
for (let k = 0; k < 18 * 60; k++) {
  stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
  if (autopilot.firing) await autopilot.firing;
  const snap = buildSnapshot(world), b = snap.ball_in_road;
  if (b?.limit_mps == null || b.gap_m <= 0) continue;
  const candidates = sampleCandidates(snap, world), cap = coverAfter(b.gap_m, Math.max(0, world.ego.v), 3);
  for (const c of candidates) if (c.law.kind === "lane") assert.ok(c.law.vTarget <= cap + 1e-9, `${c.id} keeps the anticipatory ball ceiling`);
  competing ||= candidates.some(c => c.id === "stop_at_line" || c.id === "stop_for_pedestrian");
}
assert.equal(competing, true);
assert.equal(world.violations.ball_warnings_ignored || 0, 0);
assert.equal(world.violations.collisions, 0);
console.log("✓ competing stops retain the ball's anticipatory speed ceiling and the audit stays clean");
process.exit(0);
