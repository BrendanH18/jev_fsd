// Regression coverage for routing, authored hazards, agent safety and replay branching.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, cumulative } = await import("../static/js/map/mapdata.js");
const { browserRoute, browserDrives } = await import("../static/js/demo/routing.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder, cloneState } = await import("../static/js/lab/recorder.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { WorldClock } = await import("../static/js/sim/world-clock.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { rng } = await import("../static/js/common.js");
const { validAgentChoice, registerAgent } = await import("../static/js/brain/registry.js");
const { driveLink } = await import("../static/js/lab/share.js");
const { validateEvaluation, EVALUATION_SCHEMA } = await import("../static/js/lab/history.js");
const names = { kitsilano: "623b012bc8b5", mount_pleasant: "7165f1c807a8", victoria: "d7454a9751b7", montreal: "bb9df59633e0", toronto: "4a96d42cb3f2", ottawa: "d25b07def0d2", calgary: "a53c5bcf6438", edmonton: "3e794edbefcb", winnipeg: "19bb885c9cae" };
// (with its bus routes, crosswalks and school and playground zones, as the server and the demo serve it)
const load = id => {
  const pack = JSON.parse(fs.readFileSync(new URL(`../data/maps/${names[id]}.v6.pack.json`, import.meta.url)));
  const transit = new URL(`../data/maps/${names[id]}.transit.v1.json`, import.meta.url);
  if (fs.existsSync(transit)) pack.transit = JSON.parse(fs.readFileSync(transit));
  const crossings = new URL(`../data/maps/${names[id]}.crossings.v1.json`, import.meta.url);
  if (fs.existsSync(crossings)) pack.crossings = JSON.parse(fs.readFileSync(crossings));
  const zones = new URL(`../data/maps/${names[id]}.zones.v1.json`, import.meta.url);
  if (fs.existsSync(zones)) pack.zones = JSON.parse(fs.readFileSync(zones));
  return new MapData(pack);
};
let assertions = 0;
function test(name, fn) { fn(); assertions++; console.log(`✓ ${name}`); }

test("random checkpoints retain their exact stream without consuming the live stream", () => {
  const random = rng(42); random(); const copy = random.clone();
  assert.equal(copy(), random()); assert.equal(copy(), random());
});
test("checkpoint copies retain accessors, cycles and shared random identity", () => {
  const a = { x: 4, random: rng(4), get center() { return [this.x, 0]; } }; a.self = a;
  const state = cloneState({ a, random: a.random }); state.a.x = 9;
  assert.deepEqual(state.a.center, [9, 0]); assert.equal(state.a.self, state.a); assert.equal(state.random, state.a.random); assert.equal(a.x, 4);
});
test("challenge links preserve a nested Pages root and omit unrelated parameters", () => {
  const url = new URL(driveLink({ challenge: "door-zone", drive: "rules", seed: 42, token: "secret" }, "https://example.com/jev_fsd/?old=1"));
  assert.equal(url.pathname, "/jev_fsd/"); assert.equal(url.searchParams.get("challenge"), "door-zone"); assert.ok(!url.searchParams.has("token")); assert.ok(!url.searchParams.has("old"));
});
test("agent validation rejects ineligible manoeuvres and malformed motions", () => {
  assert.ok(validAgentChoice({ candidateId: "safe", motion: "drive" }, [{ id: "safe" }]));
  assert.ok(!validAgentChoice({ candidateId: "unsafe", motion: "drive" }, [{ id: "safe" }]));
  assert.ok(!validAgentChoice({ candidateId: "safe", motion: "teleport" }, [{ id: "safe" }]));
  assert.throws(() => registerAgent({ id: "rules", label: "Overwrite", create: () => ({}) }));
});

for (const challenge of CHALLENGES) {
  const map = load(challenge.map), a = challengeScenario(map, challenge), b = challengeScenario(map, challenge);
  test(`${challenge.id}: stable route and matching control type`, () => {
    assert.deepEqual(a, b); assert.ok(cumulative(a.route.polyline).at(-1) > 100);
    const control = map.edges.get(a.start.edge).control;
    if (challenge.hazard === "signal") assert.equal(control.type, "signal");
    if (challenge.hazard === "stop") assert.equal(control.type, "stop");
    if (challenge.hazard === "oncoming") {
      assert.equal(control.type, "signal"); assert.equal(a.route.turns[0].dir, "left");
      assert.equal(map.edges.get(a.oncoming.edge).control.id, control.id);
    }
    if (challenge.hazard === "all-way") {
      assert.equal(control.type, "stop"); assert.ok(control.all_way); assert.equal(a.route.turns.length ? a.route.turns[0].dir : "straight", "straight");
      assert.deepEqual(a.allWay.map(c => map.stops.get(map.edges.get(c.edge).control.id).junction), a.allWay.map(() => map.stops.get(control.id).junction));
    }
    if (challenge.hazard === "two-way") {
      assert.equal(control.type, "stop"); assert.ok(!control.all_way); assert.equal(a.route.turns.length ? a.route.turns[0].dir : "straight", "straight");
      assert.deepEqual(a.twoWay.map(c => map.edges.get(c.edge).to), a.twoWay.map(() => map.edges.get(a.start.edge).to));
      assert.deepEqual(a.twoWay.map(c => map.priorityOf(c.edge).rule), ["major", "major"]);
    }
    if (challenge.hazard === "bus") {
      assert.equal(map.edges.get(a.bus.edge).name, "West 4th Avenue"); assert.equal(a.route.edges[1], a.bus.edge);
      assert.ok(map.edges.get(a.bus.edge).limit <= 60 / 3.6 + 0.05);
    }
    if (challenge.hazard === "cross") {
      assert.equal(control.type, "signal"); assert.equal(a.route.turns[0].dir, "right"); assert.ok(map.rightOnRed);
      assert.equal(map.edges.get(a.oncoming.edge).control.id, control.id); assert.equal(a.oncoming.then, a.route.edges[1]);
    }
  });
  for (const brain of ["rules", "cautious"]) {
    const result = await evaluateChallenge(map, challenge, { brain });
    test(`${challenge.id}: ${brain} completes a clean authored drive`, () => { assert.ok(result.pass, JSON.stringify(result.failures)); assert.ok(result.report.qualified); assert.equal(result.cost_usd, 0); });
    test(`${challenge.id}: ${brain} exports inspectable decision and event context`, () => {
      assert.ok(result.decisions_trace.length); assert.ok(result.events.some(e => e.type === "arrived"));
      assert.ok(result.events.some(e => e.type === "hazard"));
      assert.equal(result.hard_brakes, result.events.filter(e => e.type === "hard_brake").length);
      validateEvaluation(JSON.parse(JSON.stringify({ schema: EVALUATION_SCHEMA, challenge_version: 2, created_at: new Date().toISOString(), results: [result] })));
    });
  }
}

{
  // Pulling out: the bus stands at its stop with its doors open until the car comes up, then
  // signals; Rules lets it out and follows it
  const challenge = CHALLENGES.find(c => c.hazard === "bus"), ctx = setupChallenge(load(challenge.map), challenge), { world, fleet } = ctx;
  const bus = fleet.vehicles.find(v => v.id === world.challenge.busId);
  test("bus-pulling-out: the bus stands at its stop, doors open, until the car comes up", () => {
    assert.ok(bus && bus.kind === "bus" && bus.transit.phase === "dwell" && bus.doors === true);
  });
  let signalledAt = null, outAt = null, carAtSignal = null, level = false;
  for (let k = 0; k < 60 * 60 && ctx.autopilot.enabled; k++) {
    stepWorld(ctx, 1 / 60, world.t * 1000);
    const gap = world.ego.toLocal(bus.x - Math.cos(bus.psi) * bus.spec.rearOverhang, bus.y - Math.sin(bus.psi) * bus.spec.rearOverhang).ahead - (world.ego.spec.length - world.ego.spec.rearOverhang);
    if (bus.transit.phase === "leaving" && signalledAt === null) { signalledAt = world.t; carAtSignal = gap; }
    if (bus.transit.phase === "leaving" && gap < 0) level = true;
    if (bus.transit.phase === "out" && outAt === null) outAt = world.t;
  }
  test("bus-pulling-out: it signals once the car is within 45 m, and Rules lets it pull out first", () => {
    assert.ok(signalledAt !== null && carAtSignal > 20 && carAtSignal < 45, `signalled with the car ${carAtSignal?.toFixed(1)} m behind`);
    assert.ok(outAt !== null && !level, "pulled out ahead of the car");
    assert.equal(world.violations.failed_to_yield, 0); assert.equal(world.violations.collisions, 0);
  });
}

for (const challenge of CHALLENGES.filter(c => ["pedestrian", "occluded-pedestrian", "pull"].includes(c.hazard))) {
  const ctx = setupChallenge(load(challenge.map), challenge), { world, fleet } = ctx;
  const ped = world.crowd.list[0];
  if (ped) {
    const initial = [ped.x, ped.y];
    ctx.autopilot.setEnabled(false);
    for (let i = 0; i < 60; i++) stepWorld(ctx, 1 / 60, i * 1000 / 60);
    test(`${challenge.id}: person waits for the authored approach trigger`, () => { assert.deepEqual([ped.x, ped.y], initial); assert.equal(world.challenge.triggered, false); });
    if (challenge.hazard === "occluded-pedestrian") {
      const lane = world.map.lane(ctx.scenario.start.edge, ctx.scenario.start.lane);
      world.placeOnLane(lane, ctx.scenario.crossing.hazardS - 43);
      test("blind crossing: the building hides the entire person and the walking path is clear", () => {
        assert.equal(world.visibility.sees(world.ego, ped), false);
        assert.equal(world.visibility.occluded(ctx.scenario.crossing.from, ctx.scenario.crossing.to), false);
      });
      world.placeOnLane(lane, ctx.scenario.crossing.hazardS - 20);
      test("blind crossing: the approaching driver's sight line opens", () => assert.equal(world.visibility.sees(world.ego, ped), true));
    }
  } else {
    for (let i = 0; i < 900; i++) { stepWorld(ctx, 1 / 60, world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
    test("curb merge: a parked car actually transitions to traffic and moves", () => {
      assert.equal(world.challenge.triggered, true); assert.ok(world.challenge.mergingId);
      const car = fleet.vehicles.find(c => c.id === world.challenge.mergingId);
      assert.ok(car); assert.equal(world.parked.list.length, 0); assert.ok(car.path.s > 86); assert.equal(car.door, undefined);
    });
  }
}

{
  const challenge = CHALLENGES.find(c => c.hazard === "oncoming"), ctx = setupChallenge(load(challenge.map), challenge), { world, fleet } = ctx;
  let yielded = new Set();
  while (world.t < 30 && ctx.autopilot.enabled) {
    stepWorld(ctx, 1 / 60, world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing;
    if (ctx.autopilot.snap?.intersection?.oncoming) yielded.add(ctx.autopilot.snap.intersection.oncoming.id);
  }
  test("unprotected left: two oncoming cars set off at the trigger, and the car waits for each in turn", () => {
    assert.equal(world.challenge.triggered, true);
    assert.deepEqual(world.challenge.oncomingIds, ["challenge_oncoming_1", "challenge_oncoming_2"]);
    assert.deepEqual([...yielded], world.challenge.oncomingIds);
    assert.equal(world.violations.failed_to_yield, 0); assert.equal(world.violations.collisions, 0);
    assert.equal(fleet.vehicles.length, 2);
  });
}

{
  const challenge = CHALLENGES.find(c => c.hazard === "cross"), ctx = setupChallenge(load(challenge.map), challenge), { world, fleet } = ctx;
  const waited = new Set();
  let turned = null;
  while (world.t < 40 && ctx.autopilot.enabled) {
    stepWorld(ctx, 1 / 60, world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const i = ctx.autopilot.snap?.intersection;
    if (i?.right_on_red?.wait_for?.id) waited.add(i.right_on_red.wait_for.id);
    if (!turned && i?.right_on_red?.go && world.ego.v > 1) turned = { signal: i.signal, stopped: i.right_on_red.stop_completed };
  }
  test("right on red: two cars set off from the left at the trigger; the car stops, waits for both, then turns on the red", () => {
    assert.deepEqual(world.challenge.oncomingIds, ["challenge_cross_1", "challenge_cross_2"]);
    assert.deepEqual([...waited].filter(id => id.startsWith("challenge")), world.challenge.oncomingIds);
    assert.deepEqual(turned, { signal: "red", stopped: true });
    assert.equal(world.violations.red_lights_run, 0); assert.equal(world.violations.failed_to_yield, 0); assert.equal(world.violations.collisions, 0);
    assert.equal(fleet.vehicles.length, 2);
  });
  test("right on red: the challenge is not offered where the map bans it", () => {
    const montreal = load("montreal");
    assert.equal(montreal.rightOnRed, false);
    assert.throws(() => challengeScenario(montreal, challenge), /not allowed/);
  });
}

{
  const challenge = CHALLENGES.find(c => c.hazard === "all-way"), ctx = setupChallenge(load(challenge.map), challenge), { world, fleet } = ctx;
  const node = world.map.nodes.get(world.map.stops.get(world.map.edges.get(ctx.scenario.start.edge).control.id).junction);
  const waitedFor = new Set(), entered = [];
  // (arriving is checked by the clean-drive test above; this one stops once all four are through)
  while (world.t < 70 && ctx.autopilot.enabled && world.route && entered.length < 4) {
    stepWorld(ctx, 1 / 60, world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const p = ctx.autopilot.snap?.intersection?.priority;
    if (p?.wait_for) waitedFor.add(p.wait_for);
    for (const n of [world.ego, ...fleet.vehicles]) if (Math.hypot(n.front[0] - node.x, n.front[1] - node.y) < 5 && !entered.includes(n.id ?? "ego")) entered.push(n.id ?? "ego");
  }
  test("four-way stop: the car waits for the car from its right that stopped first, then goes before the two that stopped after it", () => {
    assert.deepEqual(world.challenge.allWayIds, ["challenge_right_1", "challenge_right_2", "challenge_oncoming_left"]);
    assert.deepEqual([...waitedFor], ["challenge_right_1"]);
    assert.deepEqual(entered.slice(0, 2), ["challenge_right_1", "ego"]);
    assert.equal(world.violations.failed_to_yield, 0); assert.equal(world.violations.stop_signs_run, 0); assert.equal(world.violations.collisions, 0);
    assert.equal(entered.length, 4, entered.join(" "));
  });
}

{
  const challenge = CHALLENGES.find(c => c.hazard === "two-way"), ctx = setupChallenge(load(challenge.map), challenge), { world, fleet } = ctx;
  const node = world.map.nodes.get(world.map.edges.get(ctx.scenario.start.edge).to);
  const waitedFor = new Set(), entered = [];
  let crept = false, hidden = false;
  while (world.t < 60 && ctx.autopilot.enabled && world.route && entered.length < 3) {
    stepWorld(ctx, 1 / 60, world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const g = ctx.autopilot.snap?.intersection?.give_way;
    if (g?.wait_for?.id) waitedFor.add(g.wait_for.id);
    if (g?.view_clear === false) hidden = true;
    if (ctx.autopilot.executing?.candidate?.id === "creep_to_look") crept = true;
    for (const n of [world.ego, ...fleet.vehicles]) if (Math.hypot(n.front[0] - node.x, n.front[1] - node.y) < 5 && !entered.includes(n.id ?? "ego")) entered.push(n.id ?? "ego");
  }
  test("blind corner: the car stops, creeps forward to see past the building, and waits for through traffic from both sides", () => {
    assert.deepEqual(world.challenge.twoWayIds, ["challenge_through_right", "challenge_through_left"]);
    assert.ok(hidden && crept);
    assert.deepEqual([...waitedFor].filter(id => id.startsWith("challenge")), world.challenge.twoWayIds);
    assert.deepEqual(entered, ["challenge_through_right", "challenge_through_left", "ego"]);
    assert.equal(world.violations.failed_to_yield, 0); assert.equal(world.violations.stop_signs_run, 0); assert.equal(world.violations.collisions, 0);
  });
}

const timedOut = await evaluateChallenge(load("kitsilano"), CHALLENGES[0], { limit: 0.5 });
test("failed arrivals retain a timeout and the preceding decision", () => {
  assert.equal(timedOut.pass, false); assert.equal(timedOut.report.status, "timeout");
  const event = timedOut.events.at(-1); assert.equal(event.type, "timeout"); assert.ok(event.decision_id);
});
const stopped = await evaluateChallenge(load("kitsilano"), CHALLENGES[0], { shouldStop: () => true });
test("stopped runs cannot pass or claim arrival", () => { assert.equal(stopped.pass, false); assert.equal(stopped.stopped, true); assert.equal(stopped.report.status, "stopped"); assert.equal(stopped.events.at(-1).type, "stopped"); });

const map = load("kitsilano"), ctx = setupChallenge(map, CHALLENGES[0]);
const clock = new WorldClock(15.5), recorder = new DriveRecorder({ seconds: 3 }), drive = new DriveScore(ctx.world, { route: ctx.world.route });
let activeDrive = drive;
const context = () => ({ ...ctx, clock, drive: activeDrive });
for (let i = 0; i < 300; i++) { const road = stepWorld(ctx, 1 / 60, ctx.world.t * 1000); activeDrive.record(ctx.world, road, 1 / 60); clock.update(ctx.world.t); recorder.record(context()); }
test("recordings remain bounded and preserve authored actors", () => { assert.ok(recorder.frames.length <= recorder.capacity); assert.ok(Number.isFinite(ctx.world.parked.list[0].x)); assert.equal(ctx.fleet.vehicles[0].kind, "bike"); });
const index = Math.floor(recorder.frames.length / 2), target = { ...ctx, clock, setDrive: value => { activeDrive = value; } };
recorder.restore(index, target); ctx.world.paused = false;
const advance = async count => { for (let i = 0; i < count; i++) { const road = stepWorld(ctx, 1 / 60, ctx.world.t * 1000); activeDrive.record(ctx.world, road, 1 / 60); if (ctx.autopilot.firing) await ctx.autopilot.firing; } };
await advance(120);
const first = { x: ctx.world.ego.x, y: ctx.world.ego.y, v: ctx.world.ego.v, score: activeDrive.snapshot(), random: ctx.fleet.random.getState() };
recorder.restore(index, target); ctx.world.paused = false; await advance(120);
test("restoring and continuing yields identical traffic, physics and scoring", () => {
  assert.deepEqual({ x: ctx.world.ego.x, y: ctx.world.ego.y, v: ctx.world.ego.v, score: activeDrive.snapshot(), random: ctx.fleet.random.getState() }, first);
  assert.ok(ctx.fleet.world === ctx.world); assert.ok(ctx.world.crowd.world === ctx.world); assert.ok(ctx.world.npcs === ctx.fleet.vehicles);
});
recorder.branch(index);
test("branching discards future checkpoints and labels the alternate drive", () => { assert.equal(recorder.frames.length, index + 1); assert.ok(recorder.branched); });

const from = { x: ctx.world.ego.x, y: ctx.world.ego.y, heading: ctx.world.ego.psi };
const drives = browserDrives(map, from);
test("browser routing produces reachable, distinct suggested drives", () => {
  assert.equal(drives.length, 3);
  for (const drive of drives) { const route = browserRoute(map, from, { x: drive.destination[0], y: drive.destination[1] }); assert.ok(route); for (let i = 1; i < route.edges.length; i++) assert.ok(map.successors(route.edges[i - 1]).includes(route.edges[i])); }
  assert.equal(new Set(drives.map(d => d.destination.join(","))).size, 3);
});
registerAgent({ id: "invalid-test", label: "Invalid fixture", create: () => ({ async decide() { return { candidateId: "teleport", motion: "drive", meta: {} }; } }) });
const invalid = setupChallenge(map, CHALLENGES[0], { brain: "invalid-test" });
invalid.autopilot.step(1 / 60, 0); await invalid.autopilot.firing;
test("invalid custom-agent output falls back to Rules without executing it", () => { assert.equal(invalid.world.violations.fallbacks, 1); assert.equal(invalid.autopilot.lastDecision.meta.source, "rules_fallback"); assert.notEqual(invalid.autopilot.lastDecision.chosenId, "teleport"); });
const fallbackRun = await evaluateChallenge(map, CHALLENGES[0], { brain: "invalid-test", limit: 1 });
test("fallback timeline context shows the replacement Rules decision", () => {
  const event = fallbackRun.events.find(e => e.type === "fallback"); assert.ok(event);
  assert.equal(fallbackRun.decisions_trace.find(d => d.id === event.decision_id).source, "rules_fallback");
});

const routing = setupChallenge(map, CHALLENGES[0]), originalFetch = globalThis.fetch, pendingRoutes = [];
globalThis.fetch = () => new Promise(resolve => pendingRoutes.push(resolve));
try {
  const initialRoute = routing.world.route, stale = routing.autopilot.reroute();
  routing.autopilot.setBrain("cautious");
  test("switching drivers releases a pending reroute", () => { assert.equal(routing.autopilot.rerouting, false); });
  const current = routing.autopilot.reroute();
  const respond = (index, id) => pendingRoutes[index]({ ok: true, json: async () => ({ routes: [{ ...routing.scenario.route, id }] }) });
  respond(0, "stale-route"); await stale;
  test("stale reroutes cannot replace the route or release a newer request", () => { assert.equal(routing.world.route, initialRoute); assert.equal(routing.autopilot.rerouting, true); });
  respond(1, "current-route"); await current;
  test("the current reroute applies and releases its request", () => { assert.equal(routing.world.route.id, "current-route"); assert.equal(routing.autopilot.rerouting, false); });
} finally { globalThis.fetch = originalFetch; }

const { demoApi } = await import("../static/js/demo/api.js");
let catalogCalls = 0;
globalThis.fetch = async () => {
  if (++catalogCalls === 1) throw new Error("Transient catalog network failure");
  return { ok: true, json: async () => [{ id: "kitsilano" }] };
};
try {
  await assert.rejects(demoApi("/api/maps"), /Transient catalog network failure/);
  const catalogs = await Promise.all([demoApi("/api/maps"), demoApi("/api/maps")]);
  test("a failed demo catalog request can retry and share its successful result", () => {
    assert.equal(catalogCalls, 2); assert.deepEqual(catalogs, [{ maps: [{ id: "kitsilano" }] }, { maps: [{ id: "kitsilano" }] }]);
  });
} finally { globalThis.fetch = originalFetch; }

const { demoApi: cancellationApi } = await import("../static/js/demo/api.js?cancellation-regression");
const sharedRequests = [], catalogItem = { id: "kitsilano", bbox: map.bbox };
globalThis.fetch = (url, { signal } = {}) => new Promise((resolve, reject) => {
  sharedRequests.push({ url: String(url), resolve });
  signal?.addEventListener("abort", () => reject(new DOMException("Fetch aborted", "AbortError")), { once: true });
});
try {
  const firstCaller = new AbortController();
  const cancelled = assert.rejects(cancellationApi("/api/maps", undefined, { signal: firstCaller.signal }), { name: "AbortError" });
  firstCaller.abort();
  const replacement = cancellationApi("/api/maps");
  sharedRequests[0].resolve({ ok: true, json: async () => [catalogItem] });
  await cancelled;
  const result = await replacement;
  test("aborting one catalog caller leaves a concurrent replacement alive", () => { assert.deepEqual(result.maps, [catalogItem]); assert.equal(sharedRequests.length, 1); });

  const mapCaller = new AbortController();
  const cancelledMap = assert.rejects(cancellationApi("/api/map?map=kitsilano", undefined, { signal: mapCaller.signal }), { name: "AbortError" });
  await new Promise(resolve => setTimeout(resolve, 0));
  mapCaller.abort();
  const replacementMap = cancellationApi("/api/map?map=kitsilano");
  await new Promise(resolve => setTimeout(resolve, 0));
  sharedRequests[1].resolve({ ok: true, json: async () => map.pack });
  await cancelledMap;
  const pack = await replacementMap;
  test("aborting one map caller leaves the shared map fetch reusable", () => { assert.equal(pack, map.pack); assert.equal(sharedRequests.length, 2); });
} finally { globalThis.fetch = originalFetch; }
console.log(`${assertions} drive lab checks passed`);
process.exit(0);
