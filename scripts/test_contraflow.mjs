// Contraflow cyclists: the layer and the streets it marks; cyclists riding against the one-way at the
// driver's left, stopping for the stop signs and signals that face their way; traffic and the driven car
// waiting short of the junction for one coming out of the street they turn into, and moving over (or
// stopping, with no room to pass) for one coming the other way; the driven car's sensing, candidates and
// rejections; what models are told; the audit and the metrics; nothing computed, drawn or reported with
// the option off; checkpoints; and the "Both ways" challenge with Rules and the cautious agent.
// node --experimental-default-type=module scripts/test_contraflow.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { StopMemory, approachPhase, movementSignal } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { RIDERS, contraControl, contraflowNotice, riderConflict, rideLateral } = await import("../static/js/sim/contraflow.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { cloneState, DriveRecorder } = await import("../static/js/lab/recorder.js");
const { NIGHT_CAUTION_MPS } = await import("../static/js/sim/night-flash.js");
const { Route } = await import("../static/js/map/route.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const MTL = load("bb9df59633e0"), CGY = load("a53c5bcf6438"), YEG = load("3e794edbefcb");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const FRONT = CAR.length - CAR.rearOverhang;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Rue Villeneuve Est, Montréal: one-way, a painted contraflow lane. e336 (59 m) runs from Rue Drolet
// (e124, one-way, 186 m, no sign where it meets Villeneuve) to Avenue Henri-Julien; e337 (88 m) on from
// there; e303 ends at an all-way stop. Avenue Laurier Est's e159 starts at a signal.
const DROLET = "e124", VILLENEUVE = "e336", BEYOND = "e337";

function world({ contraflow = true, seed = 3, traffic = 0 } = {}) {
  setWeather("dry");
  const w = new World(MTL, { seed, parked: 0, pedestrians: 0, contraflow });
  const fleet = new NpcFleet(w, { count: traffic, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  if (contraflow) w.contraflow.target = 0;
  return { world: w, fleet, autopilot: idle };
}
// The driven car on edge `edge`, its front `front` metres along, at `v`, routed on through `next`.
function egoAt(w, edge, front, v = 0, next = [], goal = 30) {
  const lanes = [MTL.lane(edge, MTL.edges.get(edge).lanes - 1), ...next.map((id) => MTL.lane(id, MTL.edges.get(id).lanes - 1))];
  w.placeOnLane(lanes[0], front - FRONT);
  w.ego.v = v;
  w.route = new Route(routeFromLanes(MTL, lanes, front - FRONT, goal), MTL, w.ego.spec);
  w.destination = w.route.polyline?.at(-1) ?? null;
  w.route.project(w.ego.x, w.ego.y);
}
// The driven car parked out of the way, near (x, y): riders more than 340 m from it ride off.
function egoNear(w, x, y) {
  const lane = MTL.laneList.filter((l) => !MTL.contraflow.has(l.edge) && Math.hypot(l.pts[0][0] - x, l.pts[0][1] - y) > 40).sort((a, b) => Math.hypot(a.pts[0][0] - x, a.pts[0][1] - y) - Math.hypot(b.pts[0][0] - x, b.pts[0][1] - y))[0];
  w.placeOnLane(lane, Math.min(5, lane.length / 2));
}
const snapOf = (w) => { w._road = w.roadInfo(); return buildSnapshot(w); };

await test("the layer marks one-way streets cyclists may ride both ways, as MapData loads it", () => {
  assert.ok(MTL.contraflow.size >= 30, `${MTL.contraflow.size} contraflow edges in Montréal`);
  for (const [id, c] of MTL.contraflow) {
    assert.equal(MTL.edges.get(id).oneway, true, id);
    assert.ok(["lane", "track", "shared"].includes(c.kind) && ["left", "right"].includes(c.side), id);
  }
  assert.equal(MTL.contraflow.get(VILLENEUVE).kind, "lane");
  assert.equal(CGY.contraflow.size, 0);
});

await test("what faces a cyclist coming out of a contraflow block: the sign or signal on its street's axis", () => {
  const at = (id) => contraControl(MTL, MTL.edges.get(id));
  assert.equal(at(VILLENEUVE).type, "yield");
  assert.equal(at(VILLENEUVE).rule, "equal");
  assert.equal(at("e303").type, "stop");
  assert.equal(at("e303").all_way, true);
  assert.equal(at("e159").type, "signal");
  // (a bend in the street, no junction)
  assert.equal(contraControl(MTL, MTL.edges.get("e290")), null);
});

await test("with the option off nothing is built, stepped, drawn from a stream or reported", () => {
  const ctx = world({ contraflow: false, traffic: 8 });
  for (let k = 0; k < 60 * 20; k++) step(ctx);
  assert.equal(ctx.world.contraflow.enabled, false);
  assert.equal(ctx.world.contraflow.random, null);
  assert.equal(ctx.world.contraflow.riders.length, 0);
  assert.equal(ctx.world.contraflowSeen, false);
  assert.ok(!("contraflow_conflicts" in ctx.world.violations));
  assert.ok(ctx.fleet.vehicles.every((n) => n.cfShift === undefined));
  egoAt(ctx.world, DROLET, 150, 5, [VILLENEUVE]);
  assert.equal(snapOf(ctx.world).contraflow_cyclist, null);
  const m = new DriveMetrics(100).summary(ctx.world, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, false);
  assert.ok(!("contraflow_conflicts" in m));
  // (a map without contraflow streets: nothing either, with the option on)
  const calgary = new World(CGY, { seed: 3, parked: 0, pedestrians: 0, contraflow: true });
  assert.equal(calgary.contraflow.enabled, false);
});

await test("in a free drive they ride against the traffic at the driver's left, at cyclist speeds, a few at a time, from their own stream", () => {
  const ctx = world({ traffic: 20 });
  ctx.world.contraflow.target = RIDERS;
  egoAt(ctx.world, DROLET, 120);
  const seen = new Set();
  let samples = 0, against = 0, left = 0, fast = 0, max = 0;
  for (let k = 0; k < 60 * 120; k++) {
    step(ctx);
    max = Math.max(max, ctx.world.contraflow.riders.length);
    if (k % 30) continue;
    for (const n of ctx.world.contraflow.riders) {
      seen.add(n.id);
      if (n.v > 7) fast++;
      const seg = n.path.segs.find((g) => g.sEnd > n.path.s);
      if (!seg?.contra || n.v < 1) continue;
      const e = MTL.edges.get(seg.id), q = projectPoint(e.pts, e.cum, [n.x, n.y]);
      samples++;
      if (Math.abs(wrap(n.psi - q.heading)) > Math.PI * 2 / 3) against++;
      if (q.lateral < 0) left++;
    }
  }
  assert.ok(seen.size >= RIDERS && max <= RIDERS, `${seen.size} riders, at most ${max} at a time`);
  assert.ok(samples > 50 && against / samples > 0.95 && left / samples > 0.95, `${against}/${samples} against the traffic, ${left} on the left`);
  assert.equal(fast, 0);
  assert.ok(Math.abs(rideLateral(MTL.edges.get(VILLENEUVE)) + 1.0) < 0.01);
});

await test("a cyclist coming out at an all-way stop stops at the line before going on", () => {
  const ctx = world();
  const n = ctx.world.contraflow.place({ edge: "e303", at: 40, v: 4.5, v0: 4.5 });
  egoNear(ctx.world, n.x, n.y);
  const line = n.path.segs[0].line;
  let stood = 0, maxFront = -Infinity, wentOn = false;
  for (let k = 0; k < 60 * 25 && !wentOn; k++) {
    step(ctx);
    const front = n.path.s + n.spec.length - n.spec.rearOverhang;
    if (front < line + 0.5) { maxFront = Math.max(maxFront, front); if (n.v < 0.2) stood += 1 / 60; }
    else wentOn = true;
  }
  assert.ok(stood >= 0.7, `stood ${stood.toFixed(2)} s at the line`);
  assert.ok(wentOn, "then went on");
});

await test("a cyclist coming out at a signal waits for its green", () => {
  const e = MTL.edges.get("e159"), c = contraControl(MTL, e), inter = MTL.intersections.get(c.id);
  // (a moment its light turns red)
  let t0 = 0;
  while (t0 < 300 && !(movementSignal(approachPhase(inter, c.ref, t0), "straight") === "red" && movementSignal(approachPhase(inter, c.ref, t0 - 0.5), "straight") !== "red")) t0 += 0.5;
  const ctx = world();
  ctx.world.t = t0;
  const n = ctx.world.contraflow.place({ edge: "e159", at: e.length - 25, v: 4, v0: 4.5 });
  egoNear(ctx.world, n.x, n.y);
  const line = n.path.segs[0].line;
  let crossedOnRed = false, crossed = false;
  for (let k = 0; k < 60 * 90 && !crossed; k++) {
    step(ctx);
    const front = n.path.s + n.spec.length - n.spec.rearOverhang;
    if (front > line + 0.5) { crossed = true; crossedOnRed = movementSignal(approachPhase(inter, c.ref, ctx.world.t), "straight") === "red"; }
  }
  assert.ok(crossed && !crossedOnRed, `crossed ${crossed}, on red ${crossedOnRed}`);
});

await test("overnight, a cyclist coming out at a signal flashing red stops at the line, as at a stop sign, before going on", () => {
  // (Avenue Laurier Est's signal: the side street's light flashes red from 23:00 to 05:00, sim/night-flash.js)
  setWeather("dry");
  const w = new World(MTL, { seed: 3, parked: 0, pedestrians: 0, contraflow: true, nightFlash: true });
  w.setClock({ hour: 1 });
  const fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9; w.contraflow.target = 0;
  const ctx = { world: w, fleet, autopilot: idle };
  const e = MTL.edges.get("e159"), c = contraControl(MTL, e), inter = MTL.intersections.get(c.id);
  assert.equal(movementSignal(approachPhase(inter, c.ref, w.t), "straight"), "flashing_red");
  const n = w.contraflow.place({ edge: "e159", at: e.length - 25, v: 4, v0: 4.5 });
  egoNear(w, n.x, n.y);
  const line = n.path.segs[0].line;
  let stood = 0, wentOn = false;
  for (let k = 0; k < 60 * 25 && !wentOn; k++) {
    step(ctx);
    const front = n.path.s + n.spec.length - n.spec.rearOverhang;
    if (front < line + 0.5) { if (n.v < 0.2) stood += 1 / 60; }
    else wentOn = true;
  }
  assert.ok(stood >= 0.7, `stood ${stood.toFixed(2)} s at the line`);
  assert.ok(wentOn, "then went on");
});

await test("the driven car, turning into the street, waits short of the junction for one coming out, and no candidate goes on", () => {
  const ctx = world();
  // (in sight round the corner building)
  egoAt(ctx.world, DROLET, 176, 3, [VILLENEUVE]);
  ctx.world.contraflow.place({ edge: VILLENEUVE, at: 42, v: 4.5, v0: 4.5 });
  const snap = snapOf(ctx.world), cf = snap.contraflow_cyclist;
  assert.ok(cf && cf.wait && cf.relation === "turning_in", JSON.stringify(cf && { relation: cf.relation, wait: cf.wait }));
  const junction = ctx.world.route.edgeStarts[1];
  assert.ok(cf.stop_s_route < junction - 1.5, `waits ${(junction - cf.stop_s_route).toFixed(1)} m short of the street`);
  const cands = sampleCandidates(snap, ctx.world);
  simulateAll(cands, snap, ctx.world);
  assert.ok(cands.some((c) => c.id === "yield_to_contraflow_cyclist" && c.eligible));
  assert.ok(cands.filter((c) => c.eligible && c.law.kind === "lane").every((c) => c.sim.progress_m + snap.routeProj.s + FRONT <= cf.stop_s_route + 0.6));
  assert.ok(cands.some((c) => c.reject === "fails_to_yield_to_contraflow_cyclist"));
  assert.ok(contraflowNotice(ctx.world, snap).wait);
});

await test("meeting one along a narrow contraflow street: the car moves over and stops, and moving past it closer than the passing distance is rejected", async () => {
  const ctx = world();
  egoAt(ctx.world, VILLENEUVE, 8, 5, [BEYOND], 70);
  ctx.world.contraflow.place({ edge: BEYOND, at: 82, v: 4.5, v0: 4.5 });
  const snap = snapOf(ctx.world), cf = snap.contraflow_cyclist;
  assert.ok(cf && cf.relation === "oncoming" && cf.wait && cf.shift_m > 0.3, JSON.stringify(cf && { relation: cf.relation, wait: cf.wait, shift: cf.shift_m }));
  assert.ok(cf.min_pass_m === 1 && cf.room_m < 1);
  const cands = sampleCandidates(snap, ctx.world);
  assert.ok(cands.filter((c) => c.law.kind === "lane").every((c) => c.law.detour?.shift > 0.3));
  // (and a candidate that drives on past it is rejected)
  simulateAll(cands, snap, ctx.world);
  assert.ok(cands.every((c) => !c.eligible || c.law.kind === "hard_brake" || c.sim.progress_m + snap.routeProj.s + FRONT <= cf.stop_s_route + 0.6));
  // closed loop: it stops, moved over, lets the cyclist by, and goes on; no conflict
  const ap = new Autopilot(ctx.world, { onDecision() {}, onEvent() {} });
  ap.setBrain("rules"); ap.setEnabled(true);
  const c2 = { ...ctx, autopilot: ap };
  let stood = 0, by = false;
  for (let k = 0; k < 60 * 30 && ap.enabled; k++) {
    step(c2);
    if (ap.firing) await ap.firing;
    if (ctx.world.ego.v < 0.3) stood += 1 / 60;
    const n = ctx.world.contraflow.riders[0];
    if (n && ctx.world.ego.toLocal(n.x, n.y).ahead < -6) by = true;
  }
  const v = ctx.world.violations;
  assert.ok(stood > 1 && by, `stood ${stood.toFixed(1)} s, cyclist by ${by}`);
  assert.equal(v.collisions + v.failed_to_yield + (v.contraflow_conflicts || 0), 0, JSON.stringify(v));
  assert.equal(ctx.world.contraflowSeen, true);
});

await test("riderConflict: a car crossing its way clears it, or waits; one far enough to the right meets nothing", () => {
  const ctx = world();
  const n = ctx.world.contraflow.place({ edge: VILLENEUVE, at: 20, v: 4.5, v0: 4.5 });
  // (a straight line across the cyclist's way, 6 m ahead of it)
  const p = n.path.pointAt(n.path.s + 8), h = n.path.headingAt(n.path.s + 8) + Math.PI / 2;
  const line = { pts: [[p[0] - Math.cos(h) * 40, p[1] - Math.sin(h) * 40], [p[0] + Math.cos(h) * 40, p[1] + Math.sin(h) * 40]] };
  line.cum = [0, 80];
  const near = riderConflict(n, line, { front: 30, spec: CAR, v: 6 });
  assert.ok(near && !near.meet && Math.abs(near.at - 40) < 2, JSON.stringify(near));
  // (well past its way already, it is clear)
  assert.equal(riderConflict(n, line, { front: 50, spec: CAR, v: 6 }), null);
});

await test("traffic turning into the street waits for one coming out, and they never touch", () => {
  const ctx = world();
  const lane = MTL.lane(DROLET, 0), s = lane.length - 40;
  const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 6, CAR);
  Object.assign(car, { id: "car", v0: 8, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(MTL, ctx.fleet.random), frozen: 0, waiting: 0 });
  car.path.start(DROLET, 0, s, [[VILLENEUVE, 0], [BEYOND, 0]]);
  ctx.fleet.vehicles.push(car);
  egoAt(ctx.world, "e14", 5);
  const n = ctx.world.contraflow.place({ edge: VILLENEUVE, at: 18, v: 4.5, v0: 4.5 });
  const junction = MTL.nodes.get(MTL.edges.get(VILLENEUVE).from);
  let touched = 0, enteredBeforeOut = false, out = false;
  for (let k = 0; k < 60 * 30; k++) {
    step(ctx);
    const seg = n.path.segs.find((g) => g.sEnd > n.path.s);
    if (seg && seg.id !== VILLENEUVE) out = true;
    if (!out && car.path.currentEdge().id === VILLENEUVE && car.path.s - car.path.currentEdge().sStart > 2) enteredBeforeOut = true;
    const a = car.obb(), b = n.obb();
    if (Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) < 3.4 && Math.abs((a.center[0] - b.center[0]) * Math.sin(a.heading) - (a.center[1] - b.center[1]) * Math.cos(a.heading)) < 1.25) touched++;
  }
  assert.ok(out && !enteredBeforeOut, `out ${out}, entered first ${enteredBeforeOut}`);
  assert.equal(touched, 0);
  assert.ok(Math.hypot(car.x - junction.x, car.y - junction.y) > 10, "and then turned in");
});

await test("what models are told: the state, the situation, the prompt and the motion question", () => {
  const ctx = world();
  // (in sight round the corner building)
  egoAt(ctx.world, DROLET, 176, 3, [VILLENEUVE]);
  ctx.world.contraflow.place({ edge: VILLENEUVE, at: 42, v: 4.5, v0: 4.5 });
  const snap = snapOf(ctx.world), cands = sampleCandidates(snap, ctx.world);
  simulateAll(cands, snap, ctx.world);
  const eligible = cands.filter((c) => c.eligible), state = toJevState(snap, eligible, {});
  assert.ok(state.contraflow_cyclist && state.contraflow_cyclist.yield === true && state.contraflow_cyclist.wait_in_m > 0);
  assert.match(situationClauses(snap).join(" "), /against the one-way.*give way to it before entering/);
  assert.match(SYSTEM_PROMPT, /yield_to_contraflow_cyclist/);
  const q = buildQuestions(snap, eligible, {});
  assert.match(q.questions?.motion?.criteria?.stop ?? JSON.stringify(q), /contraflow_cyclist\.wait_in_m/);
});

await test("the audit: cutting one off fails to yield and is a contraflow conflict; meeting one too close is one too; the metrics and coaching say so", () => {
  const ctx = world();
  egoAt(ctx.world, VILLENEUVE, 8, 6, [BEYOND], 70);
  const n = ctx.world.contraflow.place({ edge: BEYOND, at: 70, v: 4.5, v0: 4.5 });
  const score = new DriveScore(ctx.world, { title: "Rue Villeneuve Est", map: "montreal", route: ctx.world.route }), metrics = new DriveMetrics(ctx.world.route.length);
  // (the car drives straight on at 6 m/s, as if it had not seen it)
  for (let k = 0; k < 60 * 8; k++) {
    const route = ctx.world.route, q = route.project(ctx.world.ego.x, ctx.world.ego.y);
    ctx.world.ego.step(1 / 60, { steer: Math.max(-0.5, Math.min(0.5, -q.lateral * 0.3 - wrap(ctx.world.ego.psi - q.heading))), accel: (6 - ctx.world.ego.v) });
    const road = step(ctx);
    score.record(ctx.world, road, 1 / 60);
    metrics.record(ctx.world, null, road, 1 / 60);
  }
  const v = ctx.world.violations;
  assert.ok((v.contraflow_conflicts || 0) >= 1, JSON.stringify(v));
  assert.equal(ctx.world.contraflowSeen, true);
  const m = metrics.summary(ctx.world, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, false);
  assert.ok(m.contraflow_conflicts >= 1 && failures(m).includes("cut off or squeezed a contraflow cyclist"), JSON.stringify(failures(m)));
  const report = score.snapshot();
  assert.ok(report.contraflow_conflicts >= 1 && report.tips.some((t) => /look both ways/.test(t)), JSON.stringify(report.contraflow_conflicts));
  assert.ok(n.id.startsWith("contra_bike_"));
});

await test("checkpoints keep the riders and their own stream", () => {
  const ctx = world();
  ctx.world.contraflow.target = 2;
  egoAt(ctx.world, DROLET, 120);
  for (let k = 0; k < 60 * 5; k++) step(ctx);
  const copy = cloneState({ world: ctx.world });
  assert.equal(copy.world.contraflow.riders.length, ctx.world.contraflow.riders.length);
  assert.equal(copy.world.contraflow.random(), ctx.world.contraflow.random());
  assert.equal(copy.world.contraflow.riders[0]?.id, ctx.world.contraflow.riders[0]?.id);
});

await test("restoring a recorder reconnects the riders' manager to the live world", () => {
  const ctx = setupChallenge(MTL, CHALLENGES.find((c) => c.id === "contraflow"), { brain: "rules" });
  const recorder = new DriveRecorder(), clock = {};
  recorder.record({ ...ctx, clock, drive: null }, true);
  recorder.restore(0, { ...ctx, clock, setDrive() {} });
  assert.equal(ctx.world.contraflow.world === ctx.world, true);
});

await test("overnight, a cyclist coming up to a signal flashing amber keeps to the caution speed", () => {
  // (Edmonton: the contraflow block e410 ends at a signal whose side it is on flashes amber, sim/night-flash.js)
  setWeather("dry");
  const w = new World(YEG, { seed: 3, parked: 0, pedestrians: 0, contraflow: true, nightFlash: true });
  w.setClock({ hour: 1 });
  const fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9; w.contraflow.target = 0;
  const ctx = { world: w, fleet, autopilot: idle };
  const e = YEG.edges.get("e410"), c = contraControl(YEG, e);
  assert.equal(movementSignal(approachPhase(YEG.intersections.get(c.id), c.ref, w.t), "straight"), "flashing_amber");
  const n = w.contraflow.place({ edge: "e410", at: e.length - 80, v: 6.5, v0: 6.5 });
  const lane = YEG.laneList.filter((l) => !YEG.contraflow.has(l.edge) && Math.hypot(l.pts[0][0] - n.x, l.pts[0][1] - n.y) > 40).sort((a, b) => Math.hypot(a.pts[0][0] - n.x, a.pts[0][1] - n.y) - Math.hypot(b.pts[0][0] - n.x, b.pts[0][1] - n.y))[0];
  w.placeOnLane(lane, Math.min(5, lane.length / 2));
  const line = n.path.segs[0].line;
  let fastest = 0, crossed = false;
  for (let k = 0; k < 60 * 30 && !crossed; k++) {
    step(ctx);
    const front = n.path.s + n.spec.length - n.spec.rearOverhang;
    if (front > line) crossed = true;
    else if (line - front < 20) fastest = Math.max(fastest, n.v);
  }
  assert.ok(crossed, "went through");
  assert.ok(fastest <= NIGHT_CAUTION_MPS + 0.05, `${(fastest * 3.6).toFixed(1)} km/h in the last 20 m`);
});

await test("the challenge: Rules and the cautious agent wait short of the junction while the cyclist comes out, then turn in", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "contraflow");
  assert.ok(challenge && challenge.map === "montreal" && challenge.contraflow && challenge.seed === 40042 && challenge.title === "Both ways");
  const scenario = challengeScenario(MTL, challenge);
  assert.equal(MTL.edges.get(scenario.start.edge).name, "Rue Drolet");
  assert.equal(MTL.edges.get(scenario.contraflow.junction ? VILLENEUVE : "").name, "Rue Villeneuve Est");
  for (const brain of ["rules", "cautious", "blind"]) {
    let arrived = false;
    const ctx = setupChallenge(MTL, challenge, { brain: brain === "blind" ? "rules" : brain, onEvent: (e) => { if (e.type === "arrived") arrived = true; } });
    const { world: w, fleet, autopilot } = ctx;
    // (a car that never sees the cyclist)
    if (brain === "blind") { const sees = w.sees.bind(w); w.sees = (a, o, r) => (o.contra ? false : sees(a, o, r)); }
    const n = w.contraflow.riders[0], metrics = new DriveMetrics(w.route.length), junction = w.route.edgeStarts[1];
    let maxFront = -Infinity, stood = 0;
    while (w.t < 90 && autopilot.enabled && !arrived) {
      const road = step({ world: w, fleet, autopilot });
      metrics.record(w, autopilot.snap, road, 1 / 60);
      if (autopilot.firing) await autopilot.firing;
      const seg = n.path.segs.find((g) => g.sEnd > n.path.s);
      if (w.route && (seg?.id === VILLENEUVE || seg?.id === BEYOND)) {
        maxFront = Math.max(maxFront, w.route.project(w.ego.x, w.ego.y, w.route.hint).s + FRONT);
        if (w.ego.v < 0.3) stood += 1 / 60;
      }
    }
    const v = w.violations, m = metrics.summary(w, autopilot, arrived);
    if (brain === "blind") { assert.ok((v.contraflow_conflicts || 0) + v.collisions > 0 && !m.pass, `a blind car fails: ${JSON.stringify(v)}`); continue; }
    assert.ok(arrived, `${brain} arrives`);
    assert.equal(v.collisions + v.failed_to_yield + (v.contraflow_conflicts || 0), 0, `${brain}: ${JSON.stringify(v)}`);
    assert.ok(m.pass && m.contraflow_conflicts === 0, `${brain}: ${failures(m)}`);
    assert.ok(maxFront < junction, `${brain}: front ${(junction - maxFront).toFixed(1)} m short of the street while the cyclist was in it`);
    assert.ok(stood > 1.5, `${brain} waited ${stood.toFixed(1)} s`);
  }
});

console.log(`${checks} contraflow checks passed`);
process.exit(0);
