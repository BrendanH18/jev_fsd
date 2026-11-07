// Tailgaters (sim/tailgaters.js): the one test; a traffic car closing up behind the car and holding a
// gap well under a second, from the feature's own random stream; its late reaction, so that gentle
// braking is fine and a brake check rear-ends it (the follower's fault); what the situation ahead
// requires; the audit's brake checks; sensing, the doubled gap ahead, the candidates and their
// rejection, Rules and the cautious agent; what models are told; the "On your bumper" challenge, with a
// driver who brake-checks; checkpoints; and nothing computed, drawn or reported with the option off.
//   node --experimental-default-type=module scripts/test_tailgaters.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, comfort } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const { followingPolicy } = await import("../static/js/sim/following.js");
const T = await import("../static/js/sim/tailgaters.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { practiceOutcome } = await import("../static/js/lab/practice.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");

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
const WPG = load("19bb885c9cae");
const lesson = CHALLENGES.find(c => c.id === "on-your-bumper");
const EDGE = "e481", EXIT = "e343";   // William Avenue, eastbound: two lanes each way, 50 km/h, its signal at Isabel Street
const DT = 1 / 60;
const idle = { enabled: false, step() {} };

// A world on William Avenue with the driven car in lane `lane`, `s` along it at `v`, on a route along that
// lane, and no traffic but what a test puts there.
function world({ tailgaters = true, seed = 3, traffic = 0, s = 60, v = 12, lane = 0, weather = "dry" } = {}) {
  setWeather(weather);
  const w = new World(WPG, { seed, parked: 0, pedestrians: 0, weather, tailgaters });
  const fleet = new NpcFleet(w, { count: traffic, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  const l = WPG.lane(EDGE, lane);
  w.placeOnLane(l, s); w.ego.v = v;
  w.route = new Route(routeFromLanes(WPG, [l, WPG.lane(EXIT, lane)], s, 60), WPG, w.ego.spec); w.destination = w.route.endPoint();
  return { world: w, fleet, autopilot: idle };
}
// A traffic car `gap` behind the driven car's rear bumper in its lane, at `v`.
function behind(ctx, gap, v, { lane = 0, id = "behind" } = {}) {
  const { world: w, fleet } = ctx, l = WPG.lane(EDGE, lane), ego = w.ego;
  const egoS = projectPoint(l.pts, l.cum, [ego.x, ego.y]).s;
  const s = egoS - ego.spec.rearOverhang - gap - (CAR.length - CAR.rearOverhang), p = pointAt(l.pts, l.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(l.pts, l.cum, s), v, CAR);
  Object.assign(car, { id, color: 0, v0: WPG.edges.get(EDGE).limit, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(WPG, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start(EDGE, lane, s, [[EXIT, lane]]);
  fleet.vehicles.push(car);
  return car;
}
// One step, the driven car on `law` (or holding `v` along its lane).
function step(ctx, law = { kind: "lane", vTarget: ctx.world.ego.v }) {
  const w = ctx.world, p = w.route.project(w.ego.x, w.ego.y);
  if (!law.s0) law.s0 = p.s;
  applyLaw(w.ego, law, w.route, p.s, DT, w);
  return stepWorld(ctx, DT, w.t * 1000);
}
const gapOf = (w, car) => T.behindInLane(w.ego, car, 60);
const decide = (w, brain = new RulesBrain()) => {
  const snap = buildSnapshot(w), candidates = sampleCandidates(snap, w), r = simulateAll(candidates, snap, w);
  return { snap, candidates, ...r, choice: brain.decideSync(snap, r.eligible) };
};

await test("the one test: a car close behind in the car's lane, going its way", () => {
  const ctx = world(), w = ctx.world;
  const near = behind(ctx, 6, 12, { id: "near" });
  const t = T.tailgaterThreat(w, w.ego, w.npcs);
  assert.equal(t?.vehicle.id, "near");
  assert.equal(Math.abs(t.gap_m - 6) < 0.3, true, String(t.gap_m));
  assert.equal(t.headway_s < T.TAIL_THREAT_S, true);
  // (one further back, in the next lane, slow, or going the other way is not)
  near.x -= Math.cos(near.psi) * 8; near.y -= Math.sin(near.psi) * 8;
  assert.equal(T.tailgaterThreat(w, w.ego, w.npcs), null, "14 m back at 12 m/s is over a second");
  const b = world(), side = behind(b, 5, 12, { lane: 1, id: "side" });
  assert.equal(T.tailgaterThreat(b.world, b.world.ego, b.world.npcs), null, "next lane");
  assert.equal(side.id, "side"); const c = world(), slow = behind(c, 3, 2, { id: "slow" });
  assert.equal(T.tailgaterThreat(c.world, c.world.ego, c.world.npcs), null, "crawling in a queue");
  slow.v = 12; slow.psi += Math.PI;
  assert.equal(T.tailgaterThreat(c.world, c.world.ego, c.world.npcs), null, "the other way");
});

await test("a traffic car behind becomes a tailgater from the feature's own stream, and holds well under a second", () => {
  const ctx = world({ s: 20, v: 13 }), w = ctx.world;
  const car = behind(ctx, 25, 13);
  w.tailgaters.next = 0;
  let k = 0;
  for (; k < 20 * 60 && !car.tailgate; k++) step(ctx, { kind: "lane", vTarget: 13 });
  assert.equal(!!car.tailgate, true, "the car behind became a tailgater");
  assert.equal(w.tailgaters.committed, 1);
  const committedAt = w.t;
  let minHw = Infinity, maxHw = 0, peeked = false, flashed = false;
  for (let j = 0; j < 22 * 60; j++) {
    step(ctx, { kind: "lane", vTarget: 13 });
    if (w.t > committedAt + 10) { const g = gapOf(w, car); minHw = Math.min(minHw, g / car.v); maxHw = Math.max(maxHw, g / car.v); if (process.env.TG_DEBUG && j % 30 === 0) console.log((w.t - committedAt).toFixed(1), g.toFixed(1), car.v.toFixed(2), (g / car.v).toFixed(2), car.driver.T.toFixed(2)); }
    // (it drifts left in its lane now and then to look past the car, and flashes its lights)
    if ((car.tgPeek || 0) < -0.3) peeked = true;
    if (T.tailgaterFlash(w, car)) flashed = true;
  }
  assert.equal(w.tailgatersSeen, true);
  assert.equal(minHw > 0.3 && maxHw < T.TAIL_THREAT_S, true, `headway ${minHw.toFixed(2)}–${maxHw.toFixed(2)} s`);
  assert.equal(minHw < maxHw - 0.05, true, "it edges in and out");
  assert.equal(peeked, true); assert.equal(flashed, true);
  assert.equal(w.violations.collisions, 0);
});

await test("gentle braking: the tailgater follows the car down to a stop at a red light without touching it", () => {
  const edge = WPG.edges.get(EDGE), inter = WPG.intersections.get(edge.control.id), phase = inter.plan[edge.control.group], cyc = inter.plan.cycle;
  const ctx = world({ s: edge.control.s_line - 130, v: 12 }), w = ctx.world, car = behind(ctx, 7, 12);
  w.t = ((phase.start + phase.green + phase.yellow + 1 - (inter.offset_s || 0)) % cyc + cyc) % cyc;
  T.commitTailgater(w, car);
  for (let k = 0; k < 5 * 60; k++) step(ctx, { kind: "lane", vTarget: 12 });
  assert.equal(T.tailgaterThreat(w, w.ego, w.npcs)?.vehicle.id, "behind");
  assert.equal(T.brakingNeed(w).why, "red light");
  // (down to a stop at the line, braking at the comfortable 2.5 m/s^2)
  const p = w.route.project(w.ego.x, w.ego.y), line = w.route.controls[0].sRoute - (w.ego.spec.length - w.ego.spec.rearOverhang) - 0.5;
  const law = { kind: "lane", vTarget: 12, stopAt: line - p.s, s0: p.s };
  let maxDecel = 0;
  for (let k = 0; k < 15 * 60; k++) { step(ctx, law); maxDecel = Math.max(maxDecel, -(w.ego.ax || 0)); }
  assert.equal(w.ego.v < 0.1, true);
  assert.equal(w.violations.collisions, 0);
  assert.equal(w.violations.brake_checks || 0, 0, `braked at up to ${maxDecel}`);
  assert.equal(gapOf(w, car) > 0.5, true, `stopped ${gapOf(w, car)} m behind`);
});

await test("a brake check: the tailgater rear-ends the car, at its own fault, and the audit counts a brake check", () => {
  const ctx = world({ v: 13 }), w = ctx.world, car = behind(ctx, 7, 13);
  T.commitTailgater(w, car);
  for (let k = 0; k < 6 * 60; k++) step(ctx, { kind: "lane", vTarget: 13 });
  const events = [];
  for (let k = 0; k < 5 * 60; k++) { step(ctx, { kind: "hard_brake" }); events.push(...w.events.map(e => ({ ...e }))); }
  const hit = events.find(e => e.type === "collision");
  assert.equal(hit?.with, "behind", "rear-ended");
  assert.equal(hit.fault === "other" && hit.at_fault === false, true, JSON.stringify(hit));
  assert.equal(w.violations.collisions_at_fault, 0);
  const bc = events.filter(e => e.type === "brake_check");
  assert.equal(bc.length, 1, JSON.stringify(bc));
  assert.equal(bc[0].with, "behind");
  assert.equal(bc[0].decel_mps2 > T.BRAKE_CHECK_DECEL && bc[0].need_mps2 < 1, true, JSON.stringify(bc[0]));
  assert.equal(w.violations.brake_checks, 1);
});

await test("braking hard when something ahead calls for it is not a brake check", () => {
  const ctx = world({ v: 13 }), w = ctx.world, car = behind(ctx, 7, 13);
  T.commitTailgater(w, car);
  for (let k = 0; k < 4 * 60; k++) step(ctx, { kind: "lane", vTarget: 13 });
  // (a car stopped in the lane 16 m ahead: it needs about 6 m/s^2)
  const l = WPG.lane(EDGE, 0), egoS = projectPoint(l.pts, l.cum, [w.ego.x, w.ego.y]).s, s = egoS + w.ego.spec.length - w.ego.spec.rearOverhang + 16 + CAR.rearOverhang, p = pointAt(l.pts, l.cum, s);
  const stopped = new Vehicle(p[0], p[1], headingAt(l.pts, l.cum, s), 0, CAR);
  Object.assign(stopped, { id: "stopped", parked: true });
  w.parked.add(stopped);
  const need = T.brakingNeed(w);
  assert.equal(need.why, "vehicle ahead");
  assert.equal(need.decel > 4.5, true, String(need.decel));
  for (let k = 0; k < 4 * 60; k++) step(ctx, { kind: "hard_brake" });
  assert.equal(w.violations.brake_checks || 0, 0);
});

await test("what the situation ahead requires: a green asks nothing, a red light, an amber it can stop for (and not one it cannot)", () => {
  const edge = WPG.edges.get(EDGE), inter = WPG.intersections.get(edge.control.id), ctx = world({ s: edge.control.s_line - 62, v: 13 }), w = ctx.world;
  const phase = inter.plan[edge.control.group], c = inter.plan.cycle;
  const amberAt = ((phase.start + phase.green - (inter.offset_s || 0)) % c + c) % c;
  const toLine = w.route.controls[0].sRoute - w.route.project(w.ego.x, w.ego.y).s - (w.ego.spec.length - w.ego.spec.rearOverhang);
  w.t = amberAt - 5;
  assert.equal(T.brakingNeed(w).why, null, "a green");
  w.t = amberAt + 0.5;
  const amber = T.brakingNeed(w);
  assert.equal(amber.why, "amber light");
  assert.equal(Math.abs(amber.decel - 13 * 13 / (2 * (toLine - 0.5))) < 0.05, true, JSON.stringify(amber));
  w.t = amberAt + phase.yellow + 1;
  assert.equal(T.brakingNeed(w).why, "red light");
  // (an amber too close to stop for asks for nothing)
  const near = world({ s: edge.control.s_line - 15, v: 13 });
  near.world.t = amberAt + 0.5;
  assert.equal(T.brakingNeed(near.world).why, null);
});

await test("sensing: the tailgater, what the car may brake at, and twice the following gap ahead", () => {
  const ctx = world({ v: 12 }), w = ctx.world, car = behind(ctx, 6, 12);
  T.commitTailgater(w, car);
  const lead = behind(ctx, -40, 12, { id: "lead" });   // (40 m ahead of the car's rear bumper: in front)
  assert.equal(lead !== null, true);
  const snap = buildSnapshot(w);
  assert.equal(snap.tailgater?.id, "behind");
  assert.equal(snap.tailgater.headway_s < T.TAIL_THREAT_S, true);
  assert.equal(snap.tailgater.gentle_mps2 >= T.TAIL_GENTLE_DECEL, true);
  assert.equal(snap.tailgater.lane_right, true);
  assert.equal(snap.tailgater.can_move_right, true, "the right lane is clear");
  assert.equal(snap.following?.id, "lead");
  const usual = followingPolicy(w.ego, snap.following);
  assert.equal(Math.abs(snap.following.policy.target_gap_m - 3 - 2 * (usual.target_gap_m - 3)) < 1e-9, true);
  // (the right lane is the one it can move into; from there, none)
  const r = world({ lane: 1, v: 12 }), rc = behind(r, 6, 12, { lane: 1 });
  T.commitTailgater(r.world, rc);
  const rs = buildSnapshot(r.world);
  assert.equal(rs.tailgater.lane_right, false); assert.equal(rs.tailgater.can_move_right, false);
  assert.equal(buildSnapshot(world({ tailgaters: false }).world).tailgater, undefined);
});

await test("candidates: let it pass on the right, or ease off; no brake check; Rules and the cautious agent", () => {
  const ctx = world({ v: 13 }), w = ctx.world, car = behind(ctx, 6, 13);
  T.commitTailgater(w, car);
  const d = decide(w);
  const pass = d.candidates.find(c => c.id === "let_tailgater_pass");
  assert.equal(pass?.eligible, true, JSON.stringify(d.rejected));
  assert.equal(pass.law.vTarget <= w.ego.v + 1e-9, true, "never faster");
  assert.equal(d.choice.candidateId, "let_tailgater_pass");
  assert.equal(new CautiousAgent().decideSync(d.snap, d.eligible).candidateId, "let_tailgater_pass");
  // (stopping dead is a brake check it could not match; braking hard stays on offer)
  assert.equal(d.candidates.find(c => c.id === "keep_lane_stop")?.reject, "brakes_hard_with_tailgater");
  assert.equal(d.candidates.find(c => c.id === "hard_brake")?.eligible, true);
  // (and the tailgater is not predicted to drive on into the car: slowing down is not a "collision")
  assert.equal(d.candidates.filter(c => c.reject === "collision").length, 0);
  assert.equal(d.eligible.every(c => c.law.kind === "hard_brake" || c.sim.max_decel <= Math.max(d.snap.tailgater.gentle_mps2, Math.min(...d.eligible.filter(e => e.law.kind !== "hard_brake").map(e => e.sim.max_decel)) + T.TAIL_GENTLEST_SLACK) + 1e-9), true);
  // (in the right lane, with nowhere to move to: ease off, gently)
  const r = world({ lane: 1, v: 13.9 }), rc = behind(r, 6, 13.9, { lane: 1 });
  T.commitTailgater(r.world, rc);
  const e = decide(r.world);
  const ease = e.candidates.find(c => c.id === "ease_off_for_tailgater");
  assert.equal(ease?.eligible, true, JSON.stringify(e.rejected));
  assert.equal(ease.sim.max_decel < T.TAIL_GENTLE_DECEL, true);
  assert.equal(Math.abs(ease.law.vTarget - (e.snap.target.v - T.TAIL_EASE_MPS)) < 0.06, true);
  assert.equal(e.choice.candidateId, "ease_off_for_tailgater");
  assert.equal(e.candidates.some(c => c.id === "let_tailgater_pass"), false);
  // (a stop at a line ahead, tailgated, starts earlier and brakes more gently)
  const s = world({ s: WPG.edges.get(EDGE).control.s_line - 60, v: 12 }), sc = behind(s, 6, 12);
  T.commitTailgater(s.world, sc);
  const edge = WPG.edges.get(EDGE), inter = WPG.intersections.get(edge.control.id), phase = inter.plan[edge.control.group], cyc = inter.plan.cycle;
  s.world.t = ((phase.start + phase.green + phase.yellow + 2 - (inter.offset_s || 0)) % cyc + cyc) % cyc;
  const line = decide(s.world).candidates.find(c => c.id === "stop_at_line");
  assert.equal(line?.law.stopDecel, T.TAIL_STOP_DECEL);
});

await test("what models are told", () => {
  const ctx = world({ v: 13 }), w = ctx.world, car = behind(ctx, 6, 13);
  T.commitTailgater(w, car);
  const d = decide(w), state = toJevState(d.snap, d.candidates, { rejected: d.rejected });
  assert.equal(state.tailgater.id, "behind");
  assert.equal(state.tailgater.move_right_to_let_it_pass, true);
  assert.equal(state.tailgater.gap_ahead, "twice the usual");
  assert.equal("vehicle" in state.tailgater, false);
  const clause = situationClauses(d.snap).find(s => s.includes("tailgating"));
  assert.equal(!!clause && clause.includes("let_tailgater_pass") && clause.includes("brake-check"), true, clause);
  assert.equal(state.candidates.find(c => c.id === "let_tailgater_pass").outcome.includes("lets the tailgater by"), true);
  assert.equal(SYSTEM_PROMPT.includes("let_tailgater_pass") && SYSTEM_PROMPT.includes("ease_off_for_tailgater"), true);
  const { questions } = buildQuestions(d.snap, d.eligible);
  assert.equal(Object.keys(questions.vector.criteria).includes("let_tailgater_pass"), true);
  assert.equal(T.tailgaterNotice(w, d.snap).text, "TAILGATER · MOVE RIGHT AND LET THEM BY");
  assert.equal(T.tailgaterNotice(w, null).text, "TAILGATER · LEAVE MORE ROOM AHEAD");
});

await test("brake_checks reaches the metrics, the drive score and the practice verdict only once a tailgater has followed the car", () => {
  const ctx = world(), w = ctx.world;
  const metrics = new DriveMetrics(w.route.length), score = new DriveScore(w, {});
  metrics.record(w, buildSnapshot(w), w.roadInfo(), DT); score.record(w, w.roadInfo(), DT);
  assert.equal("brake_checks" in metrics.summary(w, { totals: {} }, false), false);
  assert.equal("brake_checks" in score.snapshot(), false);
  w.tailgatersSeen = true; w.violations.brake_checks = 1;
  w.events.push({ type: "brake_check", with: "behind", decel_mps2: 7, need_mps2: 0 });
  score.record(w, w.roadInfo(), DT);
  const m = metrics.summary(w, { totals: {} }, true);
  assert.equal(m.brake_checks, 1);
  assert.equal(failures(m).includes("braked hard with a tailgater close behind"), true);
  const report = score.snapshot();
  assert.equal(report.brake_checks, 1);
  assert.equal(report.tips.some(t => t.includes("brake-check")), true);
  assert.equal(report.incidents.some(i => i.type === "brake_check"), true);
  const clean = { config: { version: lesson.version || 1, challenge: lesson.id, map: lesson.map, seed: lesson.seed, weather: lesson.weather, time: lesson.time, traffic: 0, car: "compact", clock: 0 },
    driver: "manual", branched: false, modified: false, started_at: "2026-11-07T10:00:00Z", status: "arrived", score: 95, qualified: true,
    collisions: 0, red_lights: 0, stop_signs: 0, failed_to_yield: 0, off_road_s: 0, resets: 0 };
  assert.equal(practiceOutcome(lesson, clean), "completed");
  assert.equal(practiceOutcome(lesson, { ...clean, brake_checks: 1 }), "attempted");
});

await test("\"On your bumper\": a stable scenario on William Avenue, and the tailgater on cue", () => {
  const a = challengeScenario(WPG, lesson), b = challengeScenario(WPG, lesson);
  assert.deepEqual(a, b);
  assert.equal(lesson.seed, 56042);
  assert.equal(WPG.edges.get(a.start.edge).name, "William Avenue");
  assert.equal(WPG.edges.get(a.start.edge).lanes, 2);
  assert.equal(a.start.lane, 0, "starts in the left lane");
  assert.deepEqual(CHALLENGES.filter(c => c.tailgaters).map(c => c.id), ["on-your-bumper"]);
  const ctx = setupChallenge(WPG, lesson);
  assert.equal(ctx.world.tailgaters.enabled, true);
  assert.equal(ctx.world.npcs.find(n => n.id === "challenge_tailgater")?.tailgate !== undefined, true);
});

for (const brain of ["rules", "cautious"]) await test(`"On your bumper", ${brain}: lets the tailgater by in the right lane, no brake check, a clean drive`, async () => {
  const ctx = setupChallenge(WPG, lesson, { brain }), { world: w, autopilot } = ctx;
  const car = w.npcs.find(n => n.id === "challenge_tailgater");
  let chosePass = false, passed = false, maxDecelTailgated = 0;
  for (let k = 0; k < 180 * 60 && autopilot.enabled; k++) {
    stepWorld(ctx, DT, w.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    if (autopilot.executing?.candidate?.id === "let_tailgater_pass") chosePass = true;
    if (w.ego.toLocal(car.x, car.y).ahead > w.ego.spec.length) passed = true;
    if (autopilot.snap?.tailgater) maxDecelTailgated = Math.max(maxDecelTailgated, -(w.ego.ax || 0));
  }
  assert.equal(w.challenge.triggered, true);
  assert.equal(chosePass, true, "moved over to let it by");
  assert.equal(passed, true, "the tailgater got by");
  assert.equal(maxDecelTailgated < T.TAIL_GENTLE_DECEL + 0.5, true, `braked at ${maxDecelTailgated} with it behind`);
  assert.equal(w.violations.collisions, 0);
  assert.equal(w.violations.brake_checks || 0, 0);
  const result = await evaluateChallenge(WPG, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.brake_checks, 0);
  assert.equal(result.report.brake_checks, 0);
  assert.equal(result.events.some(e => e.type === "hazard"), true);
});

await test("\"On your bumper\": a driver who stays in the lane and brake-checks is rear-ended, and fails", async () => {
  const ctx = setupChallenge(WPG, lesson), { world: w, autopilot } = ctx;
  autopilot.setEnabled(false);
  const p = w.route.project(w.ego.x, w.ego.y), law = { kind: "lane", vTarget: 13.9, s0: p.s };
  let k = 0, hit = null;
  for (; k < 30 * 60 && !w.tailgatersSeen; k++) { applyLaw(w.ego, law, w.route, w.route.project(w.ego.x, w.ego.y).s, DT, w); stepWorld(ctx, DT, w.t * 1000); }
  for (let j = 0; j < 3 * 60; j++) { applyLaw(w.ego, law, w.route, w.route.project(w.ego.x, w.ego.y).s, DT, w); stepWorld(ctx, DT, w.t * 1000); }
  for (let j = 0; j < 5 * 60 && !hit; j++) { applyLaw(w.ego, { kind: "hard_brake" }, w.route, w.route.project(w.ego.x, w.ego.y).s, DT, w); stepWorld(ctx, DT, w.t * 1000); hit = w.events.find(e => e.type === "collision") || null; }
  assert.equal(hit?.with, "challenge_tailgater");
  assert.equal(hit.at_fault, false);
  assert.equal(w.violations.brake_checks, 1);
  const m = new DriveMetrics(w.route.length);
  m.record(w, null, w.roadInfo(), DT);
  assert.equal(failures(m.summary(w, { totals: {} }, true)).includes("braked hard with a tailgater close behind"), true);
});

await test("checkpoints: a replay from a checkpoint repeats the tailgater exactly", async () => {
  const ctx = setupChallenge(WPG, lesson), recorder = new DriveRecorder(), clock = {};
  for (let k = 0; k < 240; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], cars: ctx.world.npcs.map(n => [n.id, n.x, n.y, n.v, n.driver?.T, n.tgPeek || 0, !!n.tailgate]),
    state: { ...ctx.world.tailgaters, random: ctx.world.tailgaters.random.getState() }, v: ctx.world.violations, t: ctx.world.t });
  for (let k = 0; k < 900; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  for (let k = 0; k < 900; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  assert.equal(sig(), first);
});

await test("with the option off nothing is built, drawn or reported", () => {
  const ctx = world({ tailgaters: false, traffic: 20, v: 13 }), w = ctx.world;
  assert.equal(w.tailgaters.enabled, false);
  assert.equal(w.tailgaters.random, null);
  assert.equal(w.tailgaters.next, Infinity);
  const car = behind(ctx, 6, 13);
  for (let k = 0; k < 600; k++) step(ctx, { kind: "lane", vTarget: 13 });
  assert.equal(car.tailgate, undefined);
  assert.equal(w.npcs.some(n => n.tailgate), false);
  assert.equal(w.tailgatersSeen, false);
  for (let k = 0; k < 120; k++) step(ctx, { kind: "hard_brake" });
  assert.equal("brake_checks" in w.violations, false);
  const snap = buildSnapshot(w);
  assert.equal("tailgater" in snap, false);
  const metrics = new DriveMetrics(w.route.length);
  metrics.record(w, snap, w.roadInfo(), DT);
  assert.equal("brake_checks" in metrics.summary(w, { totals: {} }, false), false);
  // (and a world without it steps exactly as one built before the option existed: the same random draws)
  const run = (make) => { const c = world({ tailgaters: false, traffic: 20, v: 13, seed: 9 }); make(c.world); for (let k = 0; k < 600; k++) step(c, { kind: "lane", vTarget: 13 }); return JSON.stringify([c.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v]), c.world.ego.x, c.world.ego.y]); };
  const plain = run(() => {});
  assert.equal(run((x) => { x.tailgaters = { enabled: false }; }), plain);
  // (on, but never picking one: the other streams draw the same, since the tailgaters have their own)
  const on = (() => { const c = world({ tailgaters: true, traffic: 20, v: 13, seed: 9 }); c.world.tailgaters.next = Infinity; for (let k = 0; k < 600; k++) step(c, { kind: "lane", vTarget: 13 }); return JSON.stringify([c.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v]), c.world.ego.x, c.world.ego.y]); })();
  assert.equal(on, plain);
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/on_your_bumper.json`), from the
// challenge once the tailgater is close behind and the car can move right, generated by the production
// pipeline.
if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(WPG, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  let snap = null, candidates = null, eligible = null, rejected = null;
  const p = w.route.project(w.ego.x, w.ego.y), law = { kind: "lane", vTarget: 13.9, s0: p.s };
  for (let k = 0; k < 30 * 60 && !snap; k++) {
    applyLaw(w.ego, law, w.route, w.route.project(w.ego.x, w.ego.y).s, DT, w);
    stepWorld(ctx, DT, w.t * 1000);
    const s = buildSnapshot(w);
    if (!s.tailgater?.can_move_right || s.tailgater.headway_s > 0.7) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "let_tailgater_pass")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible);
  const state = toJevState(snap, candidates, { rejected });
  fs.writeFileSync(new URL("../data/snapshots/on_your_bumper.json", import.meta.url), JSON.stringify({ name: "on_your_bumper", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: ["let_tailgater_pass"] } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/on_your_bumper.json (tailgater ${snap.tailgater.gap_m} m, ${snap.tailgater.headway_s} s behind, ${eligible.length} eligible)`);
}
console.log(`${checks} tailgater checks passed`);
process.exit(0);
