// A ball rolls out, then a child chases it (sim/ball-chase.js): the ball's rolling, bouncing and rest; the
// child after it from the same gap, at a child's running pace, and home again; the driven car's sensing
// seeing the ball while the parked cars hide the child; the cover speed in sensing, candidates and
// rejections; traffic slowing; what models are told; the audit's `ball_warnings_ignored`; the "Chasing
// the ball" challenge with Rules and the cautious agent, and a driver who ignores the ball; free-drive
// spawning from its own stream; checkpoints; and nothing computed, drawn or reported with the option off.
// node --experimental-default-type=module scripts/test_ball_chase.mjs [--write-snapshot]
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
const { curbOffset } = await import("../static/js/sim/roadside.js");
const B = await import("../static/js/sim/ball-chase.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
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
const KITS = load("623b012bc8b5");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const lesson = CHALLENGES.find(c => c.id === "chasing-the-ball");
const scenario = challengeScenario(KITS, lesson);
const E = KITS.edges.get(scenario.ball.edge), AT = scenario.ball.at;
const FRONT = CAR.length - CAR.rearOverhang;

function world({ balls = true, seed = 3, hazards = false, traffic = 0, parked = 0, pedestrians = 0 } = {}) {
  setWeather("dry");
  const w = new World(KITS, { seed, parked, pedestrians, balls, hazards });
  const fleet = new NpcFleet(w, { count: traffic, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  if (balls) w.balls.target = 0;
  return { world: w, fleet, autopilot: idle };
}
// The driven car in its lane of the challenge's street, its front `back` metres short of the gap's line,
// with a route along it past it.
function egoAt(ctx, back, v = 0) {
  const lane = KITS.lane(E.id, E.lanes - 1), k = lane.length / E.length;
  const s = (AT - back) * k - FRONT;
  ctx.world.placeOnLane(lane, s);
  ctx.world.ego.v = v;
  ctx.world.route = new Route(routeFromLanes(KITS, [lane], s, Math.min(lane.length - 1, (AT + 40) * k)), KITS, ctx.world.ego.spec);
  return lane;
}
// Cars parked along the right kerb either side of the gap, and the gap's spot between them.
function lineKerb(ctx) {
  const lat = curbOffset(E, CAR);
  let n = 0;
  for (const rear of [AT + 1.1, AT + 1.1 + 5.8, AT + 1.1 + 11.6, AT - 1.1 - 4.4, AT - 1.1 - 10.2, AT - 1.1 - 16, AT - 1.1 - 21.8, AT - 1.1 - 27.6]) {
    const s = rear + CAR.rearOverhang, p = pointAt(E.pts, E.cum, s), h = headingAt(E.pts, E.cum, s);
    const c = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
    Object.assign(c, { id: `kerb_${++n}`, curb: "right", edge: E.id, stay: true });
    ctx.world.parked.add(c);
  }
  return { edge: E.id, s: AT, lat: lat - CAR.width / 2 + 0.6, side: 1 };
}
const GAP = { edge: E.id, s: AT, lat: curbOffset(E, CAR) - CAR.width / 2 + 0.6, side: 1 };
function runUntil(ctx, cond, seconds) {
  for (let k = 0; k < seconds * 60; k++) { step(ctx); if (cond()) return true; }
  return false;
}
const lateral = (x, y) => projectPoint(E.pts, E.cum, [x, y]).lateral;

await test("the challenge's street: residential, two-way, one lane each way, parking on the right, 50 km/h", () => {
  assert.equal(E.name, "West 7th Avenue");
  assert.equal(E.cls, "residential"); assert.equal(!!E.oneway, false); assert.equal(E.lanes, 1);
  assert.equal(E.parking[1] > 0, true); assert.equal(Math.round(E.limit * 3.6), 50);
  assert.equal(lesson.balls, true); assert.equal(lesson.hidden, true); assert.equal(lesson.seed, 52042); assert.equal(lesson.map, "kitsilano");
});

await test("the ball rolls out on cue, slows on its own, bounces off the far kerb and comes to rest in the road", () => {
  const ctx = world();
  egoAt(ctx, 120);
  // (no child after it here: just the ball)
  const b = ctx.world.balls.place(GAP, { trigger: 30, speed: 4, drift: 0, delay: 1e9 });
  assert.equal(b.phase, "waiting");
  runUntil(ctx, () => false, 1);
  assert.equal(b.phase, "waiting");   // (the car is still 120 m off)
  egoAt(ctx, 29.5, 0);
  step(ctx);
  assert.equal(b.phase, "rolling");
  assert.equal(ctx.world.ballsSeen, true);
  let last = Infinity, slowedOnItsOwn = true, bounced = false, minLat = Infinity, maxLat = -Infinity, prevSide = null;
  runUntil(ctx, () => {
    const v = Math.hypot(b.vx, b.vy), side = Math.sign(b.vx * Math.sin(b.gap.h) - b.vy * Math.cos(b.gap.h));
    if (prevSide !== null && side !== prevSide && side !== 0) bounced = true;
    else if (v > last + 1e-9) slowedOnItsOwn = false;
    prevSide = side || prevSide; last = v;
    const l = lateral(b.x, b.y); minLat = Math.min(minLat, l); maxLat = Math.max(maxLat, l);
    return b.phase === "stopped";
  }, 30);
  assert.equal(b.phase, "stopped");
  assert.equal(slowedOnItsOwn, true);
  assert.equal(bounced, true);
  assert.equal(minLat >= E.asphalt[0] + B.BALL_R - 0.01 && maxLat <= E.asphalt[1] - B.BALL_R + 0.01, true, `${minLat} ${maxLat}`);
  // (it stays in the road, at rest, until someone fetches it)
  runUntil(ctx, () => false, 10);
  assert.equal(b.phase, "stopped");
  assert.equal(ctx.world.balls.balls.includes(b), true);
  // (it is no obstacle: nothing near it is one)
  assert.equal(ctx.world.obstaclesNear(b.x, b.y, 2).some(o => o.kind === "ball" || o === b), false);
});

await test("a ball rolling into a parked car's side bounces back off it", () => {
  const ctx = world();
  egoAt(ctx, 200);
  // (a car parked on the far side, right across its way)
  const twin = [...KITS.edges.values()].find(o => o.from === E.to && o.to === E.from);
  const L = twin.cum.at(-1), tl = curbOffset(twin, CAR), s = L - AT, p = pointAt(twin.pts, twin.cum, s), h = headingAt(twin.pts, twin.cum, s);
  const c = new Vehicle(p[0] + Math.sin(h) * tl, p[1] - Math.cos(h) * tl, h, 0);
  Object.assign(c, { id: "far_parked", stay: true, edge: twin.id }); ctx.world.parked.add(c);
  const b = ctx.world.balls.place(GAP, { speed: 4.5, drift: 0, delay: 1e9 });
  let reach = -Infinity;
  runUntil(ctx, () => { reach = Math.max(reach, -lateral(b.x, b.y)); return b.phase === "stopped"; }, 30);
  // (it never got further across than the parked car's traffic side)
  assert.equal(reach < -E.asphalt[0] - 2.1 + 0.3, true, `reached ${reach}`);
});

await test("a child runs out after it from the same gap, 1 to 2 s later at a running pace, fetches it and goes home", () => {
  const ctx = world({ hazards: true });
  egoAt(ctx, 200);
  lineKerb(ctx);
  ctx.world.balls.random = (() => { let k = 0; const r = [0.5, 0.5, 0.5, 0.5]; return () => r[k++ % r.length]; })();
  const b = ctx.world.balls.place(GAP);
  assert.equal(b.delay >= B.CHILD_DELAY_S[0] && b.delay <= B.CHILD_DELAY_S[1], true);
  let child = null, out = null, fastest = 0, inObstacles = false, carried = false, clearAt = null;
  runUntil(ctx, () => {
    if (!child && b.child) { child = b.child; out = ctx.world.t; }
    if (child && b.childState === "out") {
      fastest = Math.max(fastest, child.v);
      if (ctx.world.obstaclesNear(child.x, child.y, 1).includes(child)) inObstacles = true;
    }
    if (b.phase === "carried") carried = true;
    if (b.childState === "clear" && clearAt === null) clearAt = ctx.world.t;
    return b.childState === "gone";
  }, 60);
  assert.equal(!!child, true);
  assert.equal(child.child, true); assert.equal(child.kind, "pedestrian"); assert.equal(child.id, `kid_ball_${b.id}`);
  assert.equal(Math.abs(out - b.out - b.delay) < 0.05, true, `${out - b.out} vs ${b.delay}`);
  // (a child's running pace: 2.6 to 3.1 m/s, crossing)
  assert.equal(fastest > 2.5 && fastest < 3.2, true, `ran at ${fastest}`);
  assert.equal(inObstacles, true);
  assert.equal(carried, true);
  assert.equal(clearAt !== null, true);
  assert.equal(b.childState, "gone");
  assert.equal(ctx.world.crowd.list.includes(child), false);
  runUntil(ctx, () => false, 1);
  assert.equal(ctx.world.balls.balls.length, 0);
});

await test("the driven car sees the ball in the open road while the parked cars still hide the child", () => {
  const ctx = world({ hazards: true });
  egoAt(ctx, 45, 9);
  const gap = lineKerb(ctx);
  const b = ctx.world.balls.place(gap, { speed: 3.6, drift: 0, delay: 1.5, childSpeed: 2.5 });
  // (between the cars at first, it is hidden too)
  assert.equal(B.ballHidden(ctx.world, ctx.world.ego, b), true);
  ctx.world.ego.v = 0;
  runUntil(ctx, () => !!b.child, 3);
  assert.equal(!!b.child, true);
  // (the child, just out of the gap, between the parked cars: hidden; the ball, out in the road: seen)
  assert.equal(B.ballVisible(ctx.world, ctx.world.ego, b), true);
  assert.equal(ctx.world.sees(ctx.world.ego, b.child), false);
  assert.equal(b.seenBy.has(B.EGO), true);
  const snap = buildSnapshot(ctx.world);
  const s = snap.ball_in_road;
  assert.equal(s.id, b.id); assert.equal(s.side, "right"); assert.equal(s.warning, true);
  assert.equal(s.child, "not_seen");
  assert.equal(Math.abs(s.gap_m - 45) < 1.5, true, `gap ${s.gap_m}`);
  assert.equal(Math.abs(s.limit_mps - B.coverSpeed(s.gap_m)) < 1e-9, true);
  assert.equal(snap.limit <= s.limit_mps + 1e-9, true);
  assert.equal(snap.target.v <= s.limit_mps + 1e-9, true);
  // (with hazards off the parked cars hide no one; the ball is still the warning, and with no blind spot
  // to keep to, the cover speed is what the car slows to)
  ctx.world.hazards = false;
  assert.equal(ctx.world.sees(ctx.world.ego, b.child), true);
  const open = buildSnapshot(ctx.world);
  assert.equal(open.ball_in_road.warning, true);
  assert.equal(open.target.reasons.includes("ball in the road: a child may follow"), true, JSON.stringify(open.target.reasons));
});

await test("the cover speed: from comfort(), so it follows the weather; a crawl at the gap", () => {
  setWeather("dry");
  const dry = [B.coverSpeed(40), B.coverSpeed(20), B.coverSpeed(10), B.coverSpeed(0)];
  assert.equal(dry[0] > dry[1] && dry[1] > dry[2] && dry[2] > dry[3], true);
  assert.equal(dry[3], B.CREEP_MPS);
  // (from 20 m it stops short of the line after reacting, at the comfortable deceleration)
  const a = 2.5, v = dry[1];
  assert.equal(Math.abs(v * B.COVER_REACT_S + v * v / (2 * a) - (20 - B.COVER_MARGIN_M)) < 1e-6, true);
  setWeather("snow");
  assert.equal(B.coverSpeed(20) < dry[1], true);
  setWeather("dry");
});

await test("candidates: slow_for_ball offered and taken; driving on past the gap fast is rejected; what models are told", () => {
  const ctx = world({ hazards: true });
  egoAt(ctx, 30, 9);
  const gap = lineKerb(ctx);
  const b = ctx.world.balls.place(gap, { speed: 3.6, drift: 0, delay: 30 });
  ctx.world.ego.v = 0;
  runUntil(ctx, () => false, 0.6);
  ctx.world.ego.v = 9;
  const snap = buildSnapshot(ctx.world), s = snap.ball_in_road;
  assert.equal(s.warning, true);
  const cands = sampleCandidates(snap, ctx.world);
  const { eligible } = simulateAll(cands, snap, ctx.world);
  const slow = cands.find(c => c.id === "slow_for_ball");
  assert.equal(!!slow && slow.eligible, true);
  assert.equal(slow.law.vTarget <= s.limit_mps + 1e-9, true);
  // (every speed on offer is within the cover speed, to the 0.1 m/s they are offered at)
  assert.equal(cands.filter(c => c.law.kind === "lane").every(c => c.law.vTarget <= snap.limit + 0.051), true, JSON.stringify(cands.filter(c => c.law.kind === "lane" && c.law.vTarget > snap.limit + 0.051).map(c => [c.id, c.law.vTarget, snap.limit])));
  // (a driver keeping on at 50 past the gap)
  const on = { id: "keep_on", law: { kind: "lane", offset: slow.law.offset, vTarget: 13.9 } };
  ctx.world.ego.v = 13.9;
  simulateAll([on], snap, ctx.world);
  assert.equal(on.reject, "passes_ball_gap_too_fast");
  // what models are told
  const state = toJevState(snap, eligible, {});
  assert.equal(state.ball_in_road.warning, true);
  assert.equal(state.ball_in_road.slow_to, Math.round(s.limit_mps * 10) / 10);
  assert.equal(state.ball_in_road.child.startsWith("not seen"), true);
  assert.equal(situationClauses(snap).some(c => c.includes("`slow_for_ball`") && c.includes("child may run out")), true);
  assert.equal(SYSTEM_PROMPT.includes("`slow_for_ball`"), true);
  assert.equal(SYSTEM_PROMPT.includes("`ball_in_road`"), true);
  const q = buildQuestions(snap, eligible).questions.vector;
  assert.equal(q.criteria.slow_for_ball.includes("able to stop short of where the ball came out"), true);
  assert.equal(b.phase === "rolling" || b.phase === "stopped", true);
});

await test("the warning lifts once the child is back at the kerb, or after COVER_S with no child", () => {
  const ctx = world();
  egoAt(ctx, 70, 0);
  const b = ctx.world.balls.place(GAP, { speed: 3.6, drift: 0, delay: 1e9 });
  runUntil(ctx, () => b.seenBy.has(B.EGO), 2);
  const seen = b.seenBy.get(B.EGO);
  runUntil(ctx, () => false, 1);
  assert.equal(B.warningStands(ctx.world, b, B.EGO), true);
  runUntil(ctx, () => ctx.world.t - seen > B.COVER_S + 0.1, B.COVER_S + 1);
  assert.equal(B.warningStands(ctx.world, b, B.EGO), false);
  assert.equal(buildSnapshot(ctx.world).ball_in_road.limit_mps, null);
  // (and with a child: until they are back at the kerb)
  const ctx2 = world();
  egoAt(ctx2, 70, 0);
  const b2 = ctx2.world.balls.place(GAP, { speed: 3.6, drift: 0, delay: 1.2, childSpeed: 2.5 });
  let outWarned = true;
  runUntil(ctx2, () => { if (b2.childState === "out" && b2.childSeenBy.has(B.EGO) && !B.warningStands(ctx2.world, b2, B.EGO)) outWarned = false; return b2.childState === "clear"; }, 30);
  assert.equal(outWarned, true);
  assert.equal(b2.childState, "clear");
  assert.equal(B.warningStands(ctx2.world, b2, B.EGO), false);
});

await test("traffic that sees the ball slows to the cover speed, stops for the child and goes on", () => {
  const ctx = world({ hazards: true });
  // (the driven car standing well back, behind it)
  egoAt(ctx, 110);
  const gap = lineKerb(ctx);
  const lane = KITS.lane(E.id, E.lanes - 1), k = lane.length / E.length;
  const s0 = (AT - 75) * k, p = pointAt(lane.pts, lane.cum, s0);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s0), 12);
  Object.assign(car, { id: "through", color: 0, v0: 13.9, driver: { aMax: 1.3, b: 2, s0: 2, T: 1.4, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(KITS, ctx.fleet.random), frozen: 0, waiting: 0 });
  car.path.start(E.id, lane.idx, s0); ctx.fleet.vehicles.push(car);
  let b = null, over = 0, stopped = false, v0 = null;
  runUntil(ctx, () => {
    if (!b) {
      // (the ball rolls out once the through car's front is 40 m short of the gap)
      if (AT - (projectPoint(E.pts, E.cum, [car.x, car.y]).s + FRONT) > 40) return false;
      b = ctx.world.balls.place(gap, { speed: 3.6, drift: 0, delay: 1.3, childSpeed: 2.5 });
      return false;
    }
    // (as the audit allows the driven car: from a moment after it saw the ball, no faster than the cover
    // speed or the speed it would be down to, braking comfortably from then)
    const dg = B.frontToGap(b, car), seen = b.seenBy.get("through");
    if (seen !== undefined && ctx.world.t >= seen + B.AUDIT_REACT_S && B.warningStands(ctx.world, b, car.id) && dg > 0) {
      v0 ??= { v: car.v, t: ctx.world.t };
      over = Math.max(over, car.v - Math.max(B.coverSpeed(dg), v0.v - comfort().decel * (ctx.world.t - v0.t)));
    }
    if (b.childState === "out" && car.v < 0.1) stopped = true;
    return b.childState === "gone";
  }, 60);
  assert.equal(!!b && b.seenBy.has("through"), true);
  assert.equal(b.childSeenBy.has("through"), true);
  assert.equal(over < B.AUDIT_SLACK_MPS, true, `over by ${over}`);
  assert.equal(stopped, true);
  assert.equal(ctx.world.violations.collisions, 0);
  runUntil(ctx, () => false, 8);
  assert.equal(car.v > 3, true, `on at ${car.v}`);
});

for (const brain of ["rules", "cautious"]) await test(`"Chasing the ball", ${brain}: slows for the ball, gives the child room, arrives cleanly`, async () => {
  const ctx = setupChallenge(KITS, lesson, { brain }), { world: w, autopilot } = ctx;
  assert.equal(w.balls.enabled, true); assert.equal(w.hazards, true);
  let atRoll = null, minChild = Infinity, slowedFor = false, chose = false, stoppedFor = false;
  for (let k = 0; k < 90 * 60 && autopilot.enabled; k++) {
    step(ctx);
    if (autopilot.firing) await autopilot.firing;
    const b = w.balls.balls.find(x => x.id === "challenge_ball");
    if (b && b.out !== null && atRoll === null) atRoll = { v: w.ego.v, d: B.frontToGap(b, w.ego) };
    if (autopilot.executing?.candidate?.id === "slow_for_ball") chose = true;
    if (b?.child && w.crowd.list.includes(b.child)) {
      const l = w.ego.toLocal(b.child.x, b.child.y);
      minChild = Math.min(minChild, Math.hypot(Math.max(0, Math.abs(l.ahead - (CAR.length / 2 - CAR.rearOverhang)) - CAR.length / 2), Math.max(0, Math.abs(l.right) - CAR.width / 2)));
    }
    if (b && b.childState === "hidden" && b.out !== null && w.ego.v < atRoll.v - 0.5) slowedFor = true;
    if (b?.childState === "out" && w.ego.v < 0.2) stoppedFor = true;
  }
  assert.equal(atRoll !== null && atRoll.d > 20 && atRoll.d < 30, true, JSON.stringify(atRoll));
  assert.equal(slowedFor, true);
  assert.equal(chose, true);
  assert.equal(minChild > 0.8, true, `came within ${minChild} m of the child`);
  const result = await evaluateChallenge(KITS, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.ball_warnings_ignored, 0);
  assert.equal(result.collisions, 0);
  assert.equal(result.report.ball_warnings_ignored, 0);
  console.log(`  (${brain}: ${atRoll.v.toFixed(1)} m/s as the ball rolled out ${atRoll.d.toFixed(1)} m ahead; stopped for the child: ${stoppedFor}; closest ${minChild.toFixed(1)} m)`);
});

await test(`"Chasing the ball": a driver who ignores the ball fails, with ball_warnings_ignored`, () => {
  const ctx = setupChallenge(KITS, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const blind = { ...ctx, autopilot: idle };
  const metrics = new DriveMetrics(w.route.length);
  const law = { kind: "lane", offset: 0, vTarget: 13.9 };
  for (let k = 0; k < 25 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { ...law, s0: p.s }, w.route, p.s, 1 / 60, w);
    const road = step(blind);
    metrics.record(w, null, road, 1 / 60);
  }
  assert.equal(w.ballsSeen, true);
  assert.equal(w.violations.ball_warnings_ignored, 1, JSON.stringify(w.violations));
  const summary = metrics.summary(w, ctx.autopilot, true);
  assert.equal(summary.ball_warnings_ignored, 1);
  assert.equal(failures(summary).includes("ignored a ball rolling into the street"), true);
  console.log(`  (the driver who kept going: ${JSON.stringify({ ball_warnings_ignored: w.violations.ball_warnings_ignored, collisions: w.violations.collisions })})`);
});

await test("a car the ball rolls out too close to, too late to react, is not counted", () => {
  const ctx = world();
  egoAt(ctx, 10, 9);
  const law = { kind: "lane", offset: 0, vTarget: 9 };
  const b = ctx.world.balls.place(GAP, { speed: 3.6, drift: 0, delay: 1e9 });
  for (let k = 0; k < 4 * 60; k++) {
    const p = ctx.world.route.project(ctx.world.ego.x, ctx.world.ego.y);
    applyLaw(ctx.world.ego, { ...law, s0: p.s }, ctx.world.route, p.s, 1 / 60, ctx.world);
    step(ctx);
  }
  assert.equal(b.seenBy.has(B.EGO), true);
  assert.equal(ctx.world.violations.ball_warnings_ignored || 0, 0);
});

await test("the challenge's ball waits however long the driver takes to come along", () => {
  const ctx = { ...setupChallenge(KITS, lesson, { brain: "rules" }), autopilot: idle };
  for (let k = 0; k < 125 * 60; k++) step(ctx);
  const b = ctx.world.balls.balls.find(x => x.id === "challenge_ball");
  assert.equal(!!b, true);
  assert.equal(b.phase, "waiting");
});

await test("checkpoints: a restored drive replays the ball and the child exactly", () => {
  const ctx = setupChallenge(KITS, lesson, { brain: "rules" }), recorder = new DriveRecorder(), clock = {};
  for (let k = 0; k < 11 * 60; k++) step(ctx);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], balls: ctx.world.balls.balls.map(b => [b.id, b.phase, b.x, b.y, b.childState, b.child ? [b.child.x, b.child.y] : null]), t: ctx.world.t });
  for (let k = 0; k < 600; k++) step(ctx);
  const first = sig();
  assert.equal(first.includes("kid_ball") || first.includes("\"out\"") || first.includes("clear") || first.includes("carried"), true);
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  for (let k = 0; k < 600; k++) step(ctx);
  assert.equal(sig(), first);
});

await test("free drives: now and then from a gap between parked cars ahead on a residential street, from its own stream; by day, not in snow", () => {
  setWeather("dry");
  const w = new World(KITS, { seed: 4, parked: 0, pedestrians: 0, balls: true, hazards: true });
  const fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 5 });
  const ctx = { world: w, fleet, autopilot: idle };
  assert.equal(typeof w.balls.random, "function");
  assert.equal(w.balls.next >= B.FIRST_S[0] && w.balls.next <= B.FIRST_S[1], true);
  egoAt(ctx, 165);
  lineKerb(ctx);
  // (the gaps between the cars along the kerb are 135 to 175 m off: too far; at 80 m, in range)
  assert.equal(w.balls.spawn(), false);
  egoAt(ctx, 80);
  w.visibility.setNight(1);
  assert.equal(w.balls.spawn(), false);   // (not after dark)
  w.visibility.setNight(0);
  setWeather("snow"); w.weather = "snow";
  assert.equal(w.balls.spawn(), false);   // (not in snow)
  setWeather("dry"); w.weather = "dry";
  assert.equal(w.balls.spawn(), true);
  const b = w.balls.balls[0];
  assert.equal(b.phase, "waiting");
  // (in one of the gaps between the cars along the kerb, between two of them)
  assert.equal(b.gap.s > AT - 30 && b.gap.s < AT + 15, true, `gap at ${b.gap.s}`);
  assert.equal(b.gap.side, 1);
  assert.equal(ctx.world.parked.near(b.gap.x, b.gap.y, 4).length >= 2, true);
  assert.equal(b.trigger >= B.TRIGGER_M[0] && b.trigger <= B.TRIGGER_M[1], true);
  // (it rolls out once the car comes within its trigger distance)
  let rolled = false;
  const law = { kind: "lane", offset: 0, vTarget: 8 };
  for (let k = 0; k < 15 * 60 && !rolled; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { ...law, s0: p.s }, w.route, p.s, 1 / 60, w);
    step(ctx);
    if (b.phase !== "waiting") { rolled = true; assert.equal(Math.abs(B.frontToGap(b, w.ego) - b.trigger) < 0.5, true); }
  }
  assert.equal(rolled, true);
  // (the drive score reports ball_warnings_ignored once one has rolled out near the car)
  const w2 = new World(KITS, { seed: 4, parked: 0, pedestrians: 0, balls: true });
  const score = new DriveScore(w2, {});
  score.record(w2, w2.roadInfo(), 1 / 60);
  assert.equal("ball_warnings_ignored" in score.snapshot(), false);
  w2.ballsSeen = true; score.record(w2, w2.roadInfo(), 1 / 60);
  assert.equal(score.snapshot().ball_warnings_ignored, 0);
});

await test("with the option off nothing is built, drawn or reported", () => {
  const ctx = world({ balls: false, traffic: 10 }), w = ctx.world;
  assert.equal(w.balls.enabled, false);
  assert.equal(w.balls.random, null);
  assert.equal(w.balls.next, Infinity);
  egoAt(ctx, 60, 8);
  for (let k = 0; k < 300; k++) step(ctx);
  assert.equal(w.balls.balls.length, 0);
  assert.equal(w.ballsSeen, false);
  assert.equal("ball_warnings_ignored" in w.violations, false);
  const snap = buildSnapshot(w);
  assert.equal("ball_in_road" in snap, false);
  const metrics = new DriveMetrics(w.route.length);
  metrics.record(w, snap, w.roadInfo(), 1 / 60);
  assert.equal("ball_warnings_ignored" in metrics.summary(w, { totals: {} }, false), false);
  // (no other challenge turns it on)
  assert.deepEqual(CHALLENGES.filter(c => c.balls).map(c => c.id), ["chasing-the-ball"]);
  // (and a world without it steps exactly as one built before the option existed: the same random draws)
  const a = world({ balls: false, traffic: 10, seed: 9 }), b = world({ balls: false, traffic: 10, seed: 9 });
  b.world.balls = undefined;
  for (let k = 0; k < 300; k++) { step(a); step(b); }
  assert.equal(JSON.stringify(a.fleet.vehicles.map(n => [n.x, n.y])), JSON.stringify(b.fleet.vehicles.map(n => [n.x, n.y])));
  assert.equal(JSON.stringify(a.world.crowd.list.map(p => [p.x, p.y])), JSON.stringify(b.world.crowd.list.map(p => [p.x, p.y])));
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/chasing_the_ball.json`), from
// the challenge just after the ball has rolled out in plain view, with the child still hidden, generated
// by the production pipeline.
if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(KITS, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 40 * 60 && !snap; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const s = buildSnapshot(w);
    if (!s.ball_in_road?.warning || s.ball_in_road.child !== "not_seen") continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    // (once slowing for it is on offer, with others to choose from)
    if (sim.eligible.some(c => c.id === "slow_for_ball") && sim.eligible.length >= 2) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible);
  const state = toJevState(snap, candidates, { rejected });
  // (slowing for it, as slow_for_ball does, and still moving: no child is in sight yet)
  const slowEnd = eligible.find(c => c.id === "slow_for_ball").sim.end_speed;
  const slowing = eligible.filter(c => c.id === "slow_for_ball" || (c.sim.end_speed > 0.5 && c.sim.end_speed <= slowEnd + 1 && Math.abs(c.sim.lane_err_end) < 0.8)).map(c => c.id);
  fs.writeFileSync(new URL("../data/snapshots/chasing_the_ball.json", import.meta.url), JSON.stringify({ name: "chasing_the_ball", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: slowing } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/chasing_the_ball.json (gap ${snap.ball_in_road.gap_m.toFixed(1)} m, slow to ${snap.ball_in_road.limit_mps.toFixed(1)} m/s, ${eligible.length} eligible)`);
}
console.log(`${checks} ball chase checks passed`);
process.exit(0);
