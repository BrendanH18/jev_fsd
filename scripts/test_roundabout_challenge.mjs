// Node 22: node --experimental-default-type=module scripts/test_roundabout_challenge.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { ringBusy } = await import("../static/js/sim/roundabout.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");

const pack = JSON.parse(fs.readFileSync(new URL("../data/maps/49db0d437c8c.v6.pack.json", import.meta.url)));
for (const layer of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks"]) {
  const url = [2, 1].map(v => new URL(`../data/maps/49db0d437c8c.${layer}.v${v}.json`, import.meta.url)).find(url => fs.existsSync(url));
  if (url) pack[layer] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack), challenge = CHALLENGES.find(c => c.id === "roundabout-gap");
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
async function advance(ctx, steps) {
  for (let k = 0; k < steps; k++) {
    stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
  }
}

await test("the authored route takes the third exit on the real Halifax ring", () => {
  const scenario = challengeScenario(map, challenge), again = challengeScenario(map, challenge);
  assert.equal(scenario.start.edge, "e300");
  assert.equal(scenario.route.edges.at(-1), "e358");
  assert.equal(scenario.route.turns.length, 1);
  assert.equal(scenario.route.turns[0].dir, "roundabout");
  assert.equal(scenario.route.turns[0].exit, 3);
  const ringEdges = scenario.route.edges.filter(id => !!map.edges.get(id).ring);
  assert.equal(ringEdges.filter(id => map.successors(id).some(next => !map.edges.get(next).ring)).length, 3);
  assert.equal(scenario.tags.length_m > 100, true);
  assert.equal(JSON.stringify(scenario), JSON.stringify(again));
  const { world, fleet } = setupChallenge(map, challenge), snap = buildSnapshot(world);
  assert.equal(fleet.vehicles.length, 3);
  assert.equal(world.challenge.triggered, true);
  assert.equal(snap.intersection.control, "yield");
  assert.equal(snap.intersection.cross_traffic_moving, true);
  assert.equal(snap.nav.exit, 3);
});

await test("circulating traffic keeps priority at the entry vertices", async () => {
  const ctx = setupChallenge(map, challenge);
  ctx.autopilot.setEnabled(false); ctx.world.ego.x -= 100; ctx.world.ego.y -= 100;
  let lowest = Infinity;
  for (let k = 0; k < 300; k++) {
    await advance(ctx, 1);
    lowest = Math.min(lowest, ...ctx.fleet.vehicles.map(n => n.v));
  }
  assert.equal(lowest > 1, true, `circulating cars slowed to ${lowest} m/s for another car farther around the ring`);
});

await test("circulating traffic still stops behind a car obstructing its own lane", async () => {
  const ctx = setupChallenge(map, challenge);
  ctx.autopilot.setEnabled(false); ctx.world.ego.x -= 100; ctx.world.ego.y -= 100;
  ctx.fleet.vehicles[0].frozen = 1e6;
  let collision = false;
  for (let k = 0; k < 720; k++) {
    await advance(ctx, 1);
    const cars = ctx.fleet.vehicles;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      collision ||= obbOverlap(cars[i].obb(), cars[j].obb());
    }
  }
  assert.equal(collision, false);
  assert.equal(ctx.fleet.vehicles[1].v < 0.2, true);
  assert.equal(ctx.fleet.vehicles[1].lead?.gap > 0, true);
});

await test("entering in front of circulating traffic fails the yield audit", () => {
  const { world } = setupChallenge(map, challenge), c = world.route.controls[0];
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  const place = s => {
    const [x, y] = world.route.pointAt(s);
    Object.assign(world.ego, { x, y, psi: world.route.headingAt(s), v: 4 });
  };
  place(c.sRoute - front - 0.3); world.audit(1 / 60, world.roadInfo());
  place(c.sRoute - front + 0.3); world.audit(1 / 60, world.roadInfo());
  assert.equal(world.violations.failed_to_yield, 1);
  assert.equal(world.events.some(e => e.type === "failed_to_yield" && e.to === "roundabout traffic"), true);
});

for (const brain of ["rules", "cautious"]) await test(`${brain} waits outside the occupied ring, enters a gap and reaches the planned exit`, async () => {
  const ctx = setupChallenge(map, challenge, { brain }), { world, autopilot } = ctx;
  const route = world.route, c = route.controls[0], rb = map.roundabouts.get("rb0"), entry = map.nodes.get(map.edges.get(c.edge).to);
  const front = world.ego.spec.length - world.ego.spec.rearOverhang;
  let waited = false, entered = false, busyAtEntry = null;
  for (let k = 0; k < 60 * 60 && autopilot.enabled; k++) {
    await advance(ctx, 1);
    const bumper = route.project(world.ego.x, world.ego.y, 0).s + front;
    const busy = ringBusy(rb, entry, world.npcs);
    if (busy && bumper <= c.sRoute && bumper > c.sRoute - 8 && world.ego.v < 0.2) waited = true;
    if (!entered && bumper >= c.sRoute) { entered = true; busyAtEntry = busy; }
  }
  assert.equal(waited, true);
  assert.equal(entered, true);
  assert.equal(busyAtEntry, false);
  assert.equal(autopilot.enabled, false, "the driver completes the route");
  assert.equal(world.roadInfo().edge?.id, "e358");
  assert.equal(Math.hypot(world.ego.x - ctx.scenario.goal[0], world.ego.y - ctx.scenario.goal[1]) < 5, true);
  assert.equal(world.violations.collisions, 0);
  assert.equal(world.violations.failed_to_yield, 0);
  assert.equal(world.violations.off_road_s < 1, true);
  const result = await evaluateChallenge(map, challenge, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.report.qualified, true);
  assert.equal(result.events.some(e => e.type === "hazard"), true);
  assert.equal(result.events.some(e => e.type === "arrived"), true);
});

await test("rewinding the occupied approach reproduces the same traffic and gap", async () => {
  const ctx = setupChallenge(map, challenge), recorder = new DriveRecorder(), clock = {};
  await advance(ctx, 180);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const signature = () => JSON.stringify({
    ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.psi, ctx.world.ego.v],
    cars: ctx.fleet.vehicles.map(n => [n.id, n.x, n.y, n.psi, n.v, n.path.s]),
    failures: ctx.world.violations.failed_to_yield,
    choice: ctx.autopilot.executing?.id,
  });
  await advance(ctx, 480); const first = signature();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  await advance(ctx, 480);
  assert.equal(signature(), first);
});
console.log(`${checks} roundabout challenge checks passed`);
process.exit(0);
