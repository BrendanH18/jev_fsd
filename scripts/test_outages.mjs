// Power cuts (sim/outage.js): a signal whose lights are out is an all-way stop. The stand-in control,
// traffic stopping at the line and taking turns there (and a driver caught too close to stop when the
// lights go out going on through), a soak with every light in Halifax out, the driven car's sensing
// (honest: only once it can see the junction), what models are told, the audit of a missed stop and
// of going out of turn, coaching, people on foot crossing on a gap, the HUD, free-drive power cuts,
// checkpoints, and the "Lights out" challenge.
// node --experimental-default-type=module scripts/test_outages.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, wrapAngle } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { StopMemory, advanceNotice, approachPhase, pedPhase, phaseOf } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { OUTAGE_COUNT, controlAt, darkControl, outageNotice } = await import("../static/js/sim/outage.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const HFX = load("49db0d437c8c");
// Barrington Street at Morris Street, Halifax: northbound Barrington (the challenge's approach), Morris
// from its right (westbound), and Barrington southbound opposite.
const SIG = "sig24", NORTH = "e153", FROM_RIGHT = "e334", SOUTH = "e156";
const INTER = HFX.intersections.get(SIG);
const CHALLENGE = CHALLENGES.find((c) => c.id === "lights-out");
const FRONT = CAR.length - CAR.rearOverhang;
const dt = 1 / 20;
const straightOn = (edge) => HFX.successors(edge).find((o) => HFX.classifyTurn(HFX.turnAngle(edge, o)) === "straight");
const idle = { enabled: false, step() {} };
const step = (ctx, input = null) => stepWorld({ ...ctx, input }, 1 / 60, ctx.world.t * 1000);

function quiet(seed = 3) {
  setWeather("dry");
  const world = new World(HFX, { seed, parked: 0, pedestrians: 0 });
  world.ego.x = 1e5; world.ego.y = 1e5;   // out of the way
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed });
  fleet.nextPull = fleet.nextPark = 1e9;
  return { world, fleet };
}
// A car `back` metres (its front) short of `edge`'s line, at `v`, going straight on.
function car(world, fleet, id, edge, back, v) {
  const e = HFX.edges.get(edge), lane = HFX.lane(edge, e.lanes - 1), s = e.control.s_line - back - FRONT;
  const p = pointAt(lane.pts, lane.cum, s), n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
  Object.assign(n, { id, color: 0x9b1e1e, v0: Math.min(11, e.limit), driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.6, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(HFX, fleet.random), frozen: 0, waiting: 0 });
  const then = straightOn(edge);
  n.path.start(edge, lane.idx, s, [[then, Math.min(lane.idx, HFX.edges.get(then).lanes - 1)]]);
  fleet.vehicles.push(n);
  return n;
}
const toLine = (n, edge) => {
  const e = n.path.edges.find((x) => x.id === edge);
  if (!e) return -Infinity;   // (behind it now)
  return e.sStart + HFX.edges.get(edge).control.s_line / HFX.edges.get(edge).length * (e.sEnd - e.sStart) - (n.path.s + FRONT);
};
// A time at which the group of `edge` shows green.
const greenFor = (edge) => { for (let t = 0; ; t += 0.5) if (phaseOf(INTER, t)[HFX.edges.get(edge).control.group] === "green" && phaseOf(INTER, t - 0.5)[HFX.edges.get(edge).control.group] !== "green") return t; };

await test("a dark signal's control is an all-way stop with the signal's id, line and group; other controls are untouched", () => {
  const { world } = quiet();
  const sig = HFX.edges.get(NORTH).control, stop = [...HFX.edges.values()].find((e) => e.control?.type === "stop").control;
  assert.equal(controlAt(world, sig), sig);
  assert.equal(world.light(SIG, NORTH) === "dark", false);
  assert.ok(world.outages.cut(SIG));
  assert.equal(world.outages.cut(SIG), null, "already out");
  assert.equal(world.outages.cut("nowhere"), null, "no such signal");
  const d = controlAt(world, sig, NORTH);
  assert.deepEqual({ ...d }, { type: "stop", all_way: true, dark: true, id: `${SIG}@${NORTH}`, junction: SIG, s_line: sig.s_line, group: sig.group });
  assert.equal(controlAt(world, sig, NORTH), d, "the same object each time");
  assert.equal(darkControl(sig, NORTH), d);
  // (each approach its own stop, as with stop signs: a stop made at one is not a stop at the next)
  assert.equal(controlAt(world, HFX.edges.get(FROM_RIGHT).control, FROM_RIGHT).id, `${SIG}@${FROM_RIGHT}`);
  assert.equal(controlAt(world, stop, "e0"), stop);
  const other = [...HFX.edges.values()].find((e) => e.control?.type === "signal" && e.control.id !== SIG);
  assert.equal(controlAt(world, other.control, other.id), other.control, "another signal keeps its lights");
  assert.equal(world.light(SIG, NORTH), "dark");
  world.outages.restore(SIG);
  assert.equal(controlAt(world, sig, NORTH), sig);
  assert.equal(world.outages.since(SIG), null);
});

await test("traffic at a dark signal stops at the line and goes in turn: the car from the right, there first, goes first", () => {
  const { world, fleet } = quiet();
  world.outages.cut(SIG);
  world.t = greenFor(NORTH);   // (green for Barrington, had the lights been on)
  const north = car(world, fleet, "north", NORTH, 45, 9), right = car(world, fleet, "right", FROM_RIGHT, 25, 7);
  let stopped = {}, crossed = {}, northWaited = false;
  for (let k = 0; k < 40 / dt; k++) {
    fleet.step(dt); world.t += dt; world.tick++;
    for (const [n, edge] of [[north, NORTH], [right, FROM_RIGHT]]) {
      const b = toLine(n, edge);
      if (n.stopMem.completed && b > -1) stopped[n.id] ??= world.t;
      if (b < -1) crossed[n.id] ??= world.t;
    }
    const st = world.allWay.status(north, world);
    if (st && !st.go && st.wait_for === right) northWaited = true;
  }
  assert.ok(stopped.north && stopped.right, `both stopped at their lines: ${JSON.stringify(stopped)}`);
  assert.ok(stopped.north < crossed.north && stopped.right < crossed.right, "before crossing them");
  assert.ok(stopped.right < stopped.north, "the car from the right stopped first");
  assert.ok(crossed.right < crossed.north, `and went first: ${JSON.stringify(crossed)}`);
  assert.ok(northWaited, "Barrington waited its turn, on what would have been its green");
  // (with the lights on, Barrington's green: it does not stop)
  const lit = quiet();
  lit.world.t = greenFor(NORTH);
  const through = car(lit.world, lit.fleet, "north", NORTH, 45, 9);
  for (let k = 0; k < 12 / dt; k++) { lit.fleet.step(dt); lit.world.t += dt; lit.world.tick++; assert.ok(!through.stopMem.completed); }
  assert.ok(toLine(through, NORTH) < -5, "through on the green");
});

await test("a stop made at one approach of a dark signal is not a stop at the next: a driver back round the block stops again", () => {
  const { world, fleet } = quiet();
  world.outages.cut(SIG);
  const n = car(world, fleet, "again", FROM_RIGHT, 40, 9);
  // (as if it had stopped at Barrington's line on its way round)
  n.stopMem.update(controlAt(world, HFX.edges.get(NORTH).control, NORTH), 1, 0, 1);
  assert.ok(n.stopMem.completed);
  let stopped = false;
  for (let k = 0; k < 15 / dt && toLine(n, FROM_RIGHT) > -1; k++) {
    fleet.step(dt); world.t += dt; world.tick++;
    if (n.v < 0.2 && toLine(n, FROM_RIGHT) > -1) stopped = true;
  }
  assert.ok(stopped, "it stops at Morris Street's line too");
});

await test("a driver too close to its line to stop when the lights go out goes on through; one further back stops", () => {
  const { world, fleet } = quiet();
  world.t = greenFor(NORTH);
  const near = car(world, fleet, "near", NORTH, 9, 11), far = car(world, fleet, "far", NORTH, 70, 11);
  fleet.step(dt); world.t += dt; world.tick++;
  world.outages.cut(SIG);
  let nearStopped = false, farStopped = false;
  for (let k = 0; k < 12 / dt; k++) {
    fleet.step(dt); world.t += dt; world.tick++;
    if (near.v < 0.2) nearStopped = true;
    if (far.stopMem.completed && toLine(far, NORTH) > -1) farStopped = true;
  }
  assert.ok(!nearStopped && toLine(near, NORTH) < -20, "on through");
  assert.ok(farStopped, "the one 70 m back stops at the line");
  // (a driver that only comes up to the line later, too fast, still stops: the lights have been out a while)
  const late = car(world, fleet, "late", NORTH, 12, 9);
  let lateStopped = false;
  for (let k = 0; k < 6 / dt; k++) { fleet.step(dt); world.t += dt; world.tick++; if (late.v < 0.2) lateStopped = true; }
  assert.ok(lateStopped, "a late arrival stops");
});

await test("soak: two minutes of Halifax traffic with every light out; no two crossing cars move in a junction together, and the queues drain", () => {
  const world = new World(HFX, { parked: 0, pedestrians: 0 });
  world.ego.x = 1e5; world.ego.y = 1e5;
  const fleet = new NpcFleet(world, { count: 80, bikes: 0, seed: 11 });
  fleet.nextPull = fleet.nextPark = 1e9;
  const inters = [...HFX.intersections.values()];
  for (const i of inters) world.outages.cut(i.id);
  let together = 0, entries = 0, longest = 0;
  const seen = new Set();
  for (let k = 0; k < 120 / dt; k++) {
    fleet.step(dt); world.t += dt; world.tick++;
    for (const node of inters) {
      const inside = fleet.vehicles.filter((n) => Math.abs(n.x - node.x) < 7 && Math.abs(n.y - node.y) < 7 && Math.hypot(n.x - node.x, n.y - node.y) < 7 && n.v > 0.5);
      for (const n of inside) if (!seen.has(`${n.id}@${node.id}`)) { seen.add(`${n.id}@${node.id}`); entries++; }
      const from = (n) => n.path.edges.find((e) => node.approaches.some((a) => a.edge === e.id) && e.sEnd > n.path.s - 25);
      for (const a of inside) for (const b of inside) if (a.id < b.id && from(a) && from(b)) {
        const rel = Math.abs(wrapAngle(HFX.headingIn(from(a).id) - HFX.headingIn(from(b).id)));
        if (rel > Math.PI / 4 && rel < Math.PI * 3 / 4) together++;
      }
    }
    for (const e of world.allWay.entries.values()) longest = Math.max(longest, world.t - e.arrived);
  }
  assert.ok(entries > 60, `${entries} entries into dark junctions`);
  assert.equal(together, 0, `${together} ticks with crossing cars moving in a junction together`);
  assert.ok(longest < 30, `the longest wait in a queue was ${longest.toFixed(1)} s`);
  console.log(`  (${entries} entries, longest wait ${longest.toFixed(1)} s)`);
});

await test("sensing: a dark signal is an all-way stop once the car can see it, and an unseen signal until then", () => {
  const { world } = setupChallenge(HFX, CHALLENGE);
  const i = buildSnapshot(world).intersection;
  assert.equal(i.id, `${SIG}@${NORTH}`);
  assert.equal(i.control, "stop");
  assert.equal(i.all_way, true);
  assert.equal(i.dark, true);
  assert.equal(i.signal, null);
  assert.equal(i.seconds_to_green, null);
  assert.equal(i.right_on_red, null);
  assert.deepEqual(i.priority, { arrived: false, go: false, wait_for: null, waiting: [] });
  const see = world.visibility.canSee;
  world.visibility.canSee = () => false;
  const hidden = buildSnapshot(world).intersection;
  assert.equal(hidden.control, "signal");
  assert.equal(hidden.signal, "unknown");
  assert.equal(hidden.dark, undefined);
  world.visibility.canSee = see;
  // (close to the line at speed, going on is ruled out as running the stop)
  const lane = HFX.lane(NORTH, 0);
  world.placeOnLane(lane, HFX.edges.get(NORTH).control.s_line - FRONT - 4);
  world.ego.v = 6;
  const snap = buildSnapshot(world), cands = sampleCandidates(snap, world);
  assert.ok(cands.some((c) => c.id === "stop_at_line"));
  simulateAll(cands, snap, world);
  assert.ok(cands.some((c) => c.reject === "runs_stop"), "going on is ruled out");
});

await test("models are told the lights are out, and to treat the junction as an all-way stop", () => {
  const { world } = setupChallenge(HFX, CHALLENGE);
  const snap = buildSnapshot(world), cands = sampleCandidates(snap, world);
  simulateAll(cands, snap, world);
  const state = toJevState(snap, cands, {});
  assert.equal(state.intersection.control, "stop");
  assert.equal(state.intersection.all_way, true);
  assert.equal(state.intersection.lights_out, true);
  const line = situationClauses(snap).find((c) => c.includes("lights"));
  assert.match(line, /traffic lights at the junction \d+ m ahead are out: treat it as an all-way stop/);
  assert.match(SYSTEM_PROMPT, /`intersection\.lights_out`/);
  // (with the lights on, nothing changes)
  world.outages.restore(SIG);
  const lit = buildSnapshot(world);
  assert.equal(lit.intersection.control, "signal");
  assert.equal("lights_out" in toJevState(lit, sampleCandidates(lit, world), {}).intersection, false);
  assert.ok(!situationClauses(lit).some((c) => c.includes("lights at the junction")));
});

await test("the audit: through a dark signal without stopping is a missed stop, with a coaching tip", () => {
  const ctx = setupChallenge(HFX, CHALLENGE), { world } = ctx;
  ctx.autopilot.setEnabled(false);
  const score = new DriveScore(world), events = [];
  while (world.t < 20 && Math.hypot(world.ego.x - INTER.x, world.ego.y - INTER.y) > 3 || world.t < 5) {
    const road = step(ctx, { throttle: world.ego.v < 10 ? 0.5 : 0, brake: 0, steer: 0 });
    score.record(world, road, 1 / 60);
    events.push(...world.events.filter((e) => e.type === "stop_sign"));
  }
  assert.equal(world.violations.stop_signs_run, 1);
  assert.equal(world.violations.red_lights_run, 0);
  assert.ok(events.length === 1 && events[0].dark);
  assert.ok(score.snapshot().tips.some((t) => /lights are out, treat the junction as an all-way stop/.test(t)));
});

await test("the audit: stopping, then going before the car whose turn it is, is a failure to yield", () => {
  const ctx = setupChallenge(HFX, CHALLENGE), { world } = ctx;
  // (Rules to the line, until it waits its turn behind the car from the right)
  while (world.t < 30 && !(world.egoStop.completed && world.allWay.status(world.ego, world)?.go === false)) step(ctx);
  assert.equal(world.allWay.status(world.ego, world).wait_for.id, "challenge_right_1");
  ctx.autopilot.setEnabled(false);
  const events = [];
  for (let k = 0; k < 60 * 3; k++) { step(ctx, { throttle: world.ego.v < 3 ? 0.4 : 0, brake: 0, steer: 0 }); events.push(...world.events.filter((e) => e.type === "failed_to_yield")); }
  assert.equal(world.violations.stop_signs_run, 0);
  assert.equal(world.violations.failed_to_yield, 1);
  assert.ok(events[0].dark && events[0].to === "all-way stop" && events[0].with === "challenge_right_1");
});

await test("people on foot cross a dark junction on a gap, its walk signals out too", () => {
  const { world } = quiet();
  const crowd = world.crowd, info = crowd.legsAt.get(INTER.vertices[0]), leg = info.list.find((l) => l.group);
  assert.equal(info.inter.id, SIG);
  const cross = { node: INTER.vertices[0], leg, from: leg.ends[1], to: leg.ends[-1] };
  const group = leg.group === "A" ? "B" : "A";
  let t = 0;
  while (pedPhase(INTER, group, t) !== "dont") t += 0.5;
  assert.equal(crowd.mayCross(cross, t), false, "lights on: the hand says don't walk");
  world.outages.cut(SIG);
  assert.equal(crowd.mayCross(cross, t), true, "lights out: nothing coming, so they go");
});

await test("the HUD: stop at the line, wait your turn, your turn", () => {
  const ctx = setupChallenge(HFX, CHALLENGE), { world } = ctx;
  assert.deepEqual(outageNotice(world), { key: `${SIG}@${NORTH}:stop`, text: "LIGHTS OUT · ALL-WAY STOP · STOP AT THE LINE", stop: true });
  const said = new Set();
  while (world.t < 40 && Math.hypot(world.ego.x - INTER.x, world.ego.y - INTER.y) > 12 || world.t < 5) {
    step(ctx);
    const n = outageNotice(world);
    if (n) said.add(n.text);
  }
  assert.deepEqual([...said], ["LIGHTS OUT · ALL-WAY STOP · STOP AT THE LINE", "LIGHTS OUT · ALL-WAY STOP · WAIT YOUR TURN", "LIGHTS OUT · ALL-WAY STOP · YOUR TURN"]);
  world.outages.restore(SIG);
  assert.equal(outageNotice(world), null, "nothing with the lights on");
});

await test("no advance green is announced at a signal whose lights are out", () => {
  const winnipeg = load("19bb885c9cae"), ctx = setupChallenge(winnipeg, CHALLENGES.find((c) => c.id === "left-arrow")), { world } = ctx;
  const inter = winnipeg.intersections.get("sig16");
  while (world.t < 40 && approachPhase(inter, world.challenge.arrowEdge, world.t) !== "arrow") step(ctx);
  assert.ok(advanceNotice(world), "the arrow, with the lights on");
  world.outages.cut("sig16");
  assert.equal(advanceNotice(world), null);
});

await test("at a dark signal mapped as several nodes, a car that went has cleared it only past the farthest of them and the street there", () => {
  const kits = load("623b012bc8b5"), inter = kits.intersections.get("sig15"), world = new World(kits, { parked: 0, pedestrians: 0 });
  const spread = Math.max(...inter.vertices.map((id) => Math.hypot(kits.nodes.get(id).x - inter.x, kits.nodes.get(id).y - inter.y)));
  assert.ok(inter.vertices.length > 1 && spread > 11, `${inter.vertices.length} nodes, the farthest ${spread.toFixed(1)} m out`);
  const clear = world.allWay.clearM("sig15");
  for (const a of inter.approaches) assert.ok(clear >= spread + kits.crossingHalfWidth(a.edge) + 2 - 1e-9, `${clear.toFixed(1)} m clears ${a.edge}`);
  // (at a junction of one node, and at a stop sign's, as before)
  assert.equal(world.allWay.clearM([...kits.stops.values()][0].junction), 6);
});

await test("free drives: one signal at a time goes dark, out of the car's sight, and comes back on once the car is away", () => {
  assert.equal(OUTAGE_COUNT, 1);
  setWeather("dry");
  const world = new World(HFX, { seed: 5, parked: 0, pedestrians: 0, outages: OUTAGE_COUNT });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 }), ctx = { world, fleet, autopilot: idle };
  while (world.t < 19) stepWorld(ctx, dt, world.t * 1000);
  assert.equal(world.outages.list.length, 0, "not straight away");
  while (world.t < 25) stepWorld(ctx, dt, world.t * 1000);
  assert.equal(world.outages.list.length, 1);
  const o = world.outages.list[0], inter = HFX.intersections.get(o.id), d = Math.hypot(inter.x - world.ego.x, inter.y - world.ego.y);
  assert.ok(d >= 150 && d <= 450, `${d.toFixed(0)} m away`);
  assert.ok(!world.visibility.canSee(world.ego, inter.x, inter.y), "out of sight");
  assert.ok(o.left >= 240 - 6 && o.left <= 480, `${o.left.toFixed(0)} s to go`);
  // (its time up, with the car away: the lights come back on, and another goes out a while later)
  o.left = 0;
  stepWorld(ctx, dt, world.t * 1000);
  assert.equal(world.outages.list.length, 0);
  const back = world.t;
  while (world.outages.list.length === 0 && world.t < back + 200) stepWorld(ctx, dt, world.t * 1000);
  assert.ok(world.t - back >= 60 && world.t - back <= 181, `the next ${(world.t - back).toFixed(0)} s later`);
  // (a challenge's, or the benchmark's, world has none of its own)
  const none = new World(HFX, { seed: 5, parked: 0, pedestrians: 0 }), nctx = { world: none, fleet: new NpcFleet(none, { count: 0, bikes: 0, seed: 5 }), autopilot: idle };
  while (none.t < 40) stepWorld(nctx, dt, none.t * 1000);
  assert.equal(none.outages.list.length, 0);
});

await test("a restored checkpoint ties the power cut back to the live world", () => {
  const ctx = setupChallenge(HFX, CHALLENGE), { world } = ctx;
  const recorder = new DriveRecorder();
  recorder.record({ world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: {}, clock: {} }, true);
  world.outages.restore(SIG);
  assert.ok(!world.outages.isDark(SIG));
  recorder.restore(0, { world, fleet: ctx.fleet, autopilot: ctx.autopilot, clock: { setHour() {}, update() {} }, setDrive() {} });
  assert.ok(world.outages.isDark(SIG), "dark again");
  assert.ok(world.outages.world === world, "stepping it steps the live world");
});

await test("the challenge, closed loop: Rules and the cautious agent stop at the dark signal, let the two cars that stopped first go, then go", async () => {
  assert.equal(CHALLENGE.map, "halifax");
  const ctx = setupChallenge(HFX, CHALLENGE);
  assert.equal(ctx.scenario.start.edge, NORTH);
  assert.equal(ctx.scenario.outage.signal, SIG);
  assert.equal(HFX.edges.get(NORTH).name, "Barrington Street");
  assert.deepEqual(ctx.scenario.allWay.map((c) => c.edge), [FROM_RIGHT, FROM_RIGHT, SOUTH]);
  for (const brain of ["rules", "cautious"]) {
    const result = await evaluateChallenge(HFX, CHALLENGE, { brain });
    assert.ok(result.pass, `${brain}: ${JSON.stringify(result.failures)}`);
    assert.ok(result.arrived && result.stop_signs === 0 && result.failed_to_yield === 0 && result.collisions === 0);
    assert.ok(result.stopped_s > 8, `${brain} waited ${result.stopped_s} s`);
    assert.ok(result.events.some((e) => e.type === "hazard"));
  }
});

console.log(`\n${checks} power cut checks passed`);
process.exit(0);
