// Traffic parallel parking (sim/parkers.js): the one test; a traffic car ahead of the driven car becoming
// a parker from the feature's own random stream, parking on the driven car's own geometry and car model,
// and becoming a parked car; traffic and cyclists behind it keeping back from the room it reverses into,
// and not going round it; giving up when blocked; sensing, the candidate and its rejection, Rules and the
// cautious agent; what models are told; the audit (blocking it, going round it, absent with it off) and a
// parker's reverse into the stationary car being the parker's fault; the "Room to park" challenge, with
// Rules, the cautious agent and a driver who crowds it; checkpoints; and nothing computed, drawn or
// reported with the option off.
//   node --experimental-default-type=module scripts/test_parkers.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const P = await import("../static/js/sim/parkers.js");
const { frameOf } = await import("../static/js/sim/parallel-park.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot, desiredSpeed } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { failureCategory } = await import("../static/js/lab/examiner.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { RP_GAP_M } = await import("../static/js/lab/parker-challenge.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const KITS = load("623b012bc8b5");
const lesson = CHALLENGES.find(c => c.id === "room-to-park");
const DT = 1 / 60;
const REASON = "blocked or went round a car parallel parking";

// The challenge's world with the autopilot off: the driven car on `law` each step.
function challenge({ brain = "rules" } = {}) {
  const ctx = setupChallenge(KITS, lesson, { brain });
  ctx.autopilot.setEnabled(false);
  return ctx;
}
const parkerOf = (w) => w.npcs.find(n => n.id === "challenge_parker") || w.parked.list.find(c => c.id === "challenge_parker");
function drive(ctx, law, steps, each = () => {}) {
  const w = ctx.world;
  for (let k = 0; k < steps; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    if (law.s0 === undefined) law.s0 = p.s;
    applyLaw(w.ego, law, w.route, p.s, DT, w);
    stepWorld(ctx, DT, w.t * 1000);
    if (each(k) === true) return k;
  }
  return steps;
}
// The driven car's front bumper to the hold line, along its route.
const toHold = (w) => {
  const p = w.route.project(w.ego.x, w.ego.y);
  return P.parkerConflict(w, w.ego, w.route, p.s + w.ego.spec.length - w.ego.spec.rearOverhang, { lat: p.lateral, hint: p.index });
};
// A traffic car `back` metres behind the driven car's rear bumper in its lane (or a cyclist), at `v`.
function follower(ctx, back, v, { bike = false, id = "follower" } = {}) {
  const { world: w, fleet } = ctx, e = KITS.edges.get(ctx.scenario.start.edge), l = KITS.lane(e.id, e.lanes - 1), spec = bike ? BIKE : CAR;
  const s = projectPoint(l.pts, l.cum, [w.ego.x, w.ego.y]).s - w.ego.spec.rearOverhang - back - (spec.length - spec.rearOverhang);
  const p = pointAt(l.pts, l.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(l.pts, l.cum, s), v, spec);
  Object.assign(car, { id, color: 0, v0: v, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 1 }, stopMem: new StopMemory(),
    path: new NpcPath(KITS, fleet.random, bike ? { bike: true } : {}), frozen: 0, waiting: 0, ...(bike ? { kind: "bike", side: 0 } : {}) });
  car.path.start(e.id, l.idx, s);
  fleet.vehicles.push(car);
  return car;
}

await test("\"Room to park\": a stable scenario on Larch Street, the parker signalling for the gap from the start", () => {
  const a = challengeScenario(KITS, lesson), b = challengeScenario(KITS, lesson);
  assert.deepEqual(a, b);
  assert.equal(lesson.seed, 58042); assert.equal(lesson.map, "kitsilano"); assert.equal(lesson.difficulty, "Patience");
  assert.equal(KITS.edges.get(a.start.edge).name, "Larch Street");
  assert.equal(KITS.edges.get(a.start.edge).cls, "residential");
  assert.equal(KITS.edges.get(a.start.edge).lanes, 1);
  assert.deepEqual(CHALLENGES.filter(c => c.parkers).map(c => c.id), ["room-to-park"]);
  const { world: w } = challenge(), n = parkerOf(w);
  assert.equal(w.parkers.enabled, true);
  assert.equal(n.parker.phase, "approach");
  assert.equal(n.signal, "right");
  assert.equal(w.parkers.active.length, 1);
  // (challenges place their own parked cars, without kerb slots)
  assert.equal(n.parker.plan.slots.length, 0);
  // (its hold line: its reverse's length and margins behind its rear bumper where it stops)
  assert.equal(n.parker.hold > 7 && n.parker.hold < 12, true, String(n.parker.hold));
  assert.equal(Math.abs(n.parker.plan.sTo - n.parker.plan.sFrom - RP_GAP_M) < 1, true, String(n.parker.plan.sTo - n.parker.plan.sFrom));
});

await test("the one test: behind it in its lane, going its way, short of its rear bumper", () => {
  const { world: w } = challenge(), n = parkerOf(w), route = w.route;
  const c = toHold(w);
  assert.equal(c?.parker.id, "challenge_parker");
  assert.equal(c.to_hold_m > 30, true, String(c.to_hold_m));
  assert.equal(Math.abs(c.hold_m - n.parker.hold) < 1e-9, true);
  // (going the other way, it is not)
  const back = w.ego.psi;
  w.ego.psi += Math.PI;
  assert.equal(toHold(w), null);
  w.ego.psi = back;
  // (nor in the oncoming lane)
  const p = route.project(w.ego.x, w.ego.y);
  assert.equal(P.parkerConflict(w, w.ego, route, p.s + 3.6, { lat: p.lateral - 3.4, hint: p.index }), null);
  // (nor once past its rear bumper)
  const q = projectPoint(route.pts, route.cum, [n.x, n.y]);
  assert.equal(P.parkerConflict(w, w.ego, route, q.s + 1, { lat: p.lateral, hint: p.index }), null);
});

await test("the parker stops alongside the car in front of the gap, pauses, reverses in on the shared geometry, and becomes a parked car", () => {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w), plan = n.parker.plan;
  const phases = [];
  let sawLamps = false, stopAt = null;
  // (the driven car simply waits where it is, well back)
  drive(ctx, { kind: "hard_brake" }, 60 * 60, () => {
    const pk = n.parker;
    const ph = pk ? `${pk.phase}${pk.law ? ":" + pk.law.phase : ""}` : "done";
    if (phases.at(-1) !== ph) phases.push(ph);
    if (pk?.phase === "stop" && !stopAt) stopAt = frameOf(n, pk.plan);
    if (n.reverseLamps) sawLamps = true;
    if (!pk) return true;
  });
  assert.equal(phases[0], "approach");
  assert.equal(phases.includes("stop"), true, phases.join(" "));
  assert.equal(phases.includes("reverse:in1"), true, phases.join(" "));
  assert.equal(phases.includes("reverse:in2"), true, phases.join(" "));
  assert.equal(sawLamps, true, "reverse lamps lit");
  // (it stopped alongside the car parked in front of the gap, about a metre out from it)
  assert.equal(Math.abs(stopAt.u - plan.startU) < 2.5, true, `${stopAt.u - plan.startU} m from where it starts`);
  assert.equal(Math.abs(stopAt.w - plan.startW) < 0.5, true, `${stopAt.w - plan.startW} m out from where it starts`);
  assert.equal(w.npcs.includes(n), false, "left the traffic");
  assert.equal(w.parked.list.includes(n), true, "a parked car");
  assert.equal(n.parked, true);
  assert.equal(n.signal, null); assert.equal(n.reverseLamps, false);
  // (parallel to the kerb, within 30 cm of it)
  const e = KITS.edges.get(ctx.scenario.parker.edge), proj = projectPoint(e.pts, e.cum, n.center);
  assert.equal(Math.abs(Math.atan2(Math.sin(n.psi - headingAt(e.pts, e.cum, proj.s)), Math.cos(n.psi - headingAt(e.pts, e.cum, proj.s)))) < 4 * Math.PI / 180, true);
  assert.equal(e.asphalt[1] - (proj.lateral + CAR.width / 2) < 0.45, true, `${e.asphalt[1] - proj.lateral - CAR.width / 2} m from the kerb`);
  // (and still an obstacle, through the parked cars' grid)
  assert.equal(w.obstaclesNear(n.x, n.y, 5).includes(n), true);
  assert.equal(w.parkers.parked, 1);
  assert.equal(w.violations.collisions, 0);
});

await test("traffic and a cyclist behind it stop short of its hold line, and do not go round it", () => {
  for (const bike of [false, true]) {
    const ctx = challenge(), w = ctx.world, n = parkerOf(w);
    // (the driven car is put out of the way, behind; the follower comes up in its place)
    const f = follower(ctx, -2, bike ? 4 : 8.3, { bike });
    w.ego.x -= Math.cos(w.ego.psi) * 30; w.ego.y -= Math.sin(w.ego.psi) * 30; w.ego.v = 0;
    let minToHold = Infinity, lane = 0;
    drive(ctx, { kind: "hard_brake" }, 60 * 60, () => {
      if (!n.parker) return true;
      const c = P.parkerConflict(w, f, f.path, f.path.s + f.spec.length - f.spec.rearOverhang);
      if (c && n.parker.phase !== "approach") minToHold = Math.min(minToHold, c.to_hold_m);
      lane = Math.max(lane, Math.abs(projectPoint(f.path.pts, f.path.cum, [f.x, f.y]).lateral) - (bike ? 1.6 : 0));
    });
    assert.equal(w.parked.list.includes(n), true, `parked (${bike ? "cyclist" : "car"} behind)`);
    assert.equal(minToHold > -0.3, true, `${bike ? "cyclist" : "car"} came ${-minToHold} m into its room`);
    assert.equal(lane < 1.2, true, `kept to its lane (${lane})`);
    assert.equal(w.violations.collisions, 0);
  }
});

await test("free drive: from the feature's own stream, the traffic car ahead becomes a parker, parks in a free space, and takes its slot", () => {
  setWeather("dry");
  const w = new World(KITS, { seed: 21, weather: "dry", pedestrians: 0, parkers: true });
  const fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 4 }), ctx = { world: w, fleet, autopilot: { enabled: false, step() {} } };
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  const e = KITS.edges.get(challengeScenario(KITS, lesson).start.edge), l = KITS.lane(e.id, e.lanes - 1);
  w.placeOnLane(l, 12); w.ego.v = 8;
  w.route = new Route(routeFromLanes(KITS, [l], 12, l.length - 20), KITS, w.ego.spec); w.destination = w.route.endPoint();
  ctx.scenario = { start: { edge: e.id } };
  const n = follower(ctx, -(w.ego.spec.length + 16), 8, { id: "ahead" });
  n.lcCooldown = 1e6;
  assert.equal(w.parked.slots.length > 0, true);
  const before = w.parkers.random.getState();
  w.parkers.next = 0;
  let committedAt = null, slack = Infinity;
  // (a driver who stops at the hold line, once there is one)
  for (let k = 0; k < 90 * 60 && !w.parked.list.includes(n); k++) {
    const p = w.route.project(w.ego.x, w.ego.y), c = toHold(w);
    if (n.parker && committedAt === null) { committedAt = w.t; assert.equal(c.to_hold_m > w.ego.v ** 2 / (2 * P.EGO_DECEL), true, "room to stop for it"); }
    if (c) slack = Math.min(slack, c.to_hold_m);
    applyLaw(w.ego, { kind: "lane", vTarget: 8, s0: p.s, ...(c ? { stopAt: c.to_hold_m - 2 } : {}) }, w.route, p.s, DT, w);
    stepWorld(ctx, DT, w.t * 1000);
  }
  assert.equal(committedAt !== null, true, "it became a parker");
  assert.notEqual(w.parkers.random.getState(), before, "drawn from its own stream");
  assert.equal(w.parkers.committed, 1);
  assert.equal(w.parked.list.includes(n), true, "parked");
  assert.equal(n.slot?.occupant === n, true, "its slot taken");
  assert.equal(w.parked.slots.some(s => s.reserved?.owner === n), false, "its other slots let go");
  assert.equal(slack > -0.3, true, String(slack));
  assert.equal(w.violations.parking_conflicts || 0, 0);
  assert.equal(w.violations.collisions, 0);
  // (and one at a time, then none for a while)
  assert.equal(w.parkers.next >= w.t + P.PARKER_COOLDOWN_S - 1, true);
});

await test("no parker whose hold line lies past the end of the driven car's route (found in a free-drive soak)", () => {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w);
  for (const slot of n.parker.plan.slots) if (slot.reserved?.owner === n) slot.reserved = null;
  delete n.parker; n.signal = null; w.parkers.active = [];
  w.parkers.random = () => 0;
  const pick = () => { w.parkers.next = 0; w.parkers.checkAt = 0; P.manageParkers(w, ctx.fleet); return !!n.parker; };
  // (the route ends short of where the car ahead would stop to park: the projection of its hold line lands
  // on the route's last point, which is no conflict for the driven car)
  const full = w.route, e = KITS.edges.get(ctx.scenario.start.edge), l = KITS.lane(e.id, e.lanes - 1);
  const egoS = projectPoint(l.pts, l.cum, [w.ego.x, w.ego.y]).s;
  w.route = new Route(routeFromLanes(KITS, [l], egoS, egoS + 40), KITS, w.ego.spec);
  assert.equal(pick(), false);
  w.route = full;
  assert.equal(pick(), true);
  assert.equal(toHold(w)?.parker.id, "challenge_parker");
});

await test("a space whose S would swing the front into a car standing across the street is not chosen (found in a free-drive soak)", () => {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w);
  for (const slot of n.parker.plan.slots) if (slot.reserved?.owner === n) slot.reserved = null;
  delete n.parker; n.signal = null; w.parkers.active = [];
  const found = P.parkerPlan(w, n);
  assert.equal(found?.plan.sTo === undefined, false);
  assert.equal(P.sClear(w, found.plan, n.spec), true);
  // (on a narrow street with cars parked at both kerbs, the front swings out over the far lane as the car
  // backs in on full lock: a car standing there, level with where it starts)
  const f = found.plan, h = f.h, u = f.startU + 1.5, wl = f.startW - 2.9;
  const car = new Vehicle(f.ox + u * Math.cos(h) + wl * Math.sin(h), f.oy + u * Math.sin(h) - wl * Math.cos(h), h, 0);
  Object.assign(car, { id: "standing_across", stay: true });
  w.parked.add(car);
  assert.equal(P.sClear(w, found.plan, n.spec), false);
  const again = P.parkerPlan(w, n);
  assert.equal(!again || again.plan.sTo !== found.plan.sTo, true, "not that space");
});

await test("stuck partway (a door opening beside it, say), it waits and tries again rather than giving up (found in a free-drive soak)", () => {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w);
  drive(ctx, { kind: "hard_brake" }, 30 * 60, () => n.parker?.phase === "reverse" || undefined);
  n.parker.law.phase = "stuck";
  drive(ctx, { kind: "hard_brake" }, 60 * 60, () => !n.parker || undefined);
  assert.equal(w.parked.list.includes(n), true, "parked after all");
  assert.equal(w.parkers.gaveUp, 0);
});

await test("blocked: with the driven car standing in its room, it waits, gives up and drives on", () => {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w);
  // (a driver who follows it close, 2 m back, and stops behind it)
  const p = w.route.project(w.ego.x, w.ego.y);
  let gaveUp = false;
  drive(ctx, { kind: "lane", vTarget: 8.3, s0: p.s }, 0);
  for (let k = 0; k < 50 * 60 && !gaveUp; k++) {
    const q = w.route.project(w.ego.x, w.ego.y), r = projectPoint(w.route.pts, w.route.cum, [n.x, n.y]);
    const stopAt = r.s - n.spec.rearOverhang - 2 - (w.ego.spec.length - w.ego.spec.rearOverhang);
    applyLaw(w.ego, { kind: "lane", vTarget: 8.3, stopAt: stopAt - q.s, s0: q.s }, w.route, q.s, DT, w);
    stepWorld(ctx, DT, w.t * 1000);
    if (!n.parker) gaveUp = true;
  }
  assert.equal(gaveUp, true);
  assert.equal(n.parkerTried, true);
  assert.equal(n.signal === "right", false);
  assert.equal(w.npcs.includes(n), true, "drives on as traffic");
  assert.equal(n.parker === undefined && w.parked.slots.some(s => s.reserved?.owner === n), false, "slots let go");
  assert.equal(w.parkers.gaveUp, 1);
  // (and the audit counted the driver who blocked it)
  assert.equal(w.violations.parking_conflicts, 1);
  assert.equal(w.parkersSeen, true);
  const m = new DriveMetrics(w.route.length);
  m.record(w, null, w.roadInfo(), DT);
  const summary = m.summary(w, { totals: {} }, true);
  assert.equal(summary.parking_conflicts, 1);
  assert.equal(failures(summary).includes(REASON), true);
  assert.equal(failureCategory(REASON), "space");
  // (it drives on in its lane and away)
  for (let k = 0; k < 10 * 60; k++) stepWorld(ctx, DT, w.t * 1000);
  assert.equal(n.v > 3, true);
  assert.equal(w.violations.collisions, 0);
});

await test("going round it in the oncoming lane while it signals or reverses is a conflict", () => {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w);
  // (hang back until it has stopped, then pull out and go by)
  drive(ctx, { kind: "lane", vTarget: 3 }, 30 * 60, () => n.parker?.phase === "reverse" || undefined);
  const events = [];
  drive(ctx, { kind: "lane", vTarget: 4, offset: -3.3 }, 20 * 60, () => { events.push(...w.events.filter(e => e.type === "parking_conflict").map(e => ({ ...e }))); });
  assert.equal(events.some(e => e.reason === "passed"), true, JSON.stringify(events));
  assert.equal(w.violations.parking_conflicts >= 1, true);
});

await test("a parker's reverse into the stationary driven car is the parker's fault", () => {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w);
  drive(ctx, { kind: "hard_brake" }, 30 * 60, () => n.parker?.phase === "reverse" || undefined);
  // (the driven car stands right behind it; the parker, as if it had not looked, backs straight into it)
  const back = n.spec.rearOverhang + 0.6 + (w.ego.spec.length - w.ego.spec.rearOverhang);
  w.ego.x = n.x - Math.cos(n.psi) * back; w.ego.y = n.y - Math.sin(n.psi) * back; w.ego.psi = n.psi; w.ego.v = 0;
  n.parker.phase = "stop"; n.parker.pause = -1e9;   // (held, so only the forced reverse below moves it)
  let hit = null;
  for (let k = 0; k < 4 * 60 && !hit; k++) {
    n.step(DT, { steer: 0, accel: -1.5, reverse: true });
    w.audit(DT, w.roadInfo());
    hit = w.events.find(e => e.type === "collision") || null;
  }
  assert.equal(hit?.with, "challenge_parker");
  assert.equal(hit.fault, "other");
  assert.equal(hit.at_fault, false);
  assert.equal(w.violations.collisions_at_fault, 0);
});

await test("sensing, the candidate and its rejection, Rules and the cautious agent; what models are told", async () => {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w);
  let snap = null, cs = null, sim = null;
  drive(ctx, { kind: "lane", vTarget: 4 }, 30 * 60, () => {
    if (n.parker?.phase !== "stop") return;
    const s = buildSnapshot(w);
    if (!s.parking_ahead || s.parking_ahead.bumper_to_stop_m > 14) return;
    snap = s; cs = sampleCandidates(s, w); sim = simulateAll(cs, s, w);
    return true;
  });
  assert.ok(snap, "came up behind it");
  const pa = snap.parking_ahead;
  assert.equal(pa.id, "challenge_parker"); assert.equal(pa.phase, "stopped"); assert.equal(pa.wait, true); assert.equal(pa.signal, "right");
  // (its hold line is a stop for the car's target speed, whatever the car ahead of it asks)
  assert.equal(desiredSpeed({ ...snap, following: null }).reasons.includes("car parking ahead"), true);
  const wait = sim.eligible.find(c => c.id === "wait_for_parker");
  assert.ok(wait, "wait_for_parker on offer");
  assert.equal(sim.rejected.blocks_parking_car > 0, true, JSON.stringify(sim.rejected));
  // (whatever the car chooses, it stops short of the hold line)
  const rules = new RulesBrain().decideSync(snap, sim.eligible), cautious = new CautiousAgent().decideSync(snap, sim.eligible);
  assert.equal(cautious.candidateId, "wait_for_parker");
  const chosen = sim.eligible.find(c => c.id === rules.candidateId);
  assert.equal(!chosen || chosen.sim.progress_m < pa.bumper_to_stop_m + 1, true, JSON.stringify(rules));
  const state = toJevState(snap, cs, { rejected: sim.rejected });
  assert.equal(state.parking_ahead.wait, true);
  assert.equal(state.parking_ahead.now.includes("about to reverse in"), true);
  assert.equal(situationClauses(snap).some(t => t.includes("`wait_for_parker`") && t.includes("Never creep up behind it")), true);
  assert.equal(SYSTEM_PROMPT.includes("`parking_ahead`") && SYSTEM_PROMPT.includes("`wait_for_parker`"), true);
  const { questions } = buildQuestions(snap, sim.eligible);
  assert.equal(!!questions.motion, true);
  assert.equal(questions.motion.criteria.stop.includes("parking_ahead"), true);
});

for (const brain of ["rules", "cautious"]) await test(`"Room to park", ${brain}: waits well back while it parks, then a clean drive`, async () => {
  const result = await evaluateChallenge(KITS, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.arrived, true);
  assert.equal(result.parking_conflicts, 0);
  assert.equal(result.report.parking_conflicts, 0);
  assert.equal(result.collisions, 0);
  assert.equal(result.deadlocks, 0);
  assert.equal(result.events.some(e => e.type === "hazard"), true);
});

await test("checkpoints: a replay from a checkpoint repeats the parker exactly", async () => {
  const ctx = setupChallenge(KITS, lesson), recorder = new DriveRecorder(), clock = {};
  for (let k = 0; k < 12 * 60; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  assert.equal(parkerOf(ctx.world).parker?.phase !== "approach", true, "past its approach");
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => { const w = ctx.world, n = parkerOf(w); return JSON.stringify({ ego: [w.ego.x, w.ego.y, w.ego.v], n: [n.x, n.y, n.psi, n.v, n.parker?.phase, n.parker?.law?.phase, !!n.parked], active: w.parkers.active.map(o => o.id), t: w.t, v: w.violations }); };
  for (let k = 0; k < 20 * 60; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(parkerOf(ctx.world).parker?.plan.slots.every(s => ctx.world.parked.slots.includes(s)), true, "its slots are the restored world's");
  for (let k = 0; k < 20 * 60; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  assert.equal(sig(), first);
});

await test("with the option off nothing is built, drawn or reported", () => {
  const ctx = setupChallenge(KITS, { ...lesson, parkers: false, hazard: "none" }), w = ctx.world;
  assert.equal(w.parkers.enabled, false);
  assert.equal(w.parkers.random, null);
  assert.equal(w.parkers.next, Infinity);
  const make = (parkers, seed = 9) => {
    setWeather("dry");
    const x = new World(KITS, { seed, weather: "dry", parkers });
    const fleet = new NpcFleet(x, { count: 25, bikes: 3, seed: 4 });
    const e = KITS.edges.get(challengeScenario(KITS, lesson).start.edge), l = KITS.lane(e.id, e.lanes - 1);
    x.placeOnLane(l, 30); x.ego.v = 8;
    x.route = new Route(routeFromLanes(KITS, [l], 30, 250), KITS, x.ego.spec); x.destination = x.route.endPoint();
    return { world: x, fleet, autopilot: { enabled: false, step() {} } };
  };
  const run = (c, steps = 40 * 60) => { for (let k = 0; k < steps; k++) { const p = c.world.route.project(c.world.ego.x, c.world.ego.y); applyLaw(c.world.ego, { kind: "lane", vTarget: 8, s0: p.s }, c.world.route, p.s, DT, c.world); stepWorld(c, DT, c.world.t * 1000); } return JSON.stringify([c.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v]), c.world.parked.list.length, c.world.ego.x, c.world.ego.y]); };
  const off = make(false), plain = run(off);
  assert.equal(off.world.npcs.some(n => n.parker), false);
  assert.equal(off.world.parkersSeen, false);
  assert.equal("parking_conflicts" in off.world.violations, false);
  const snap = buildSnapshot(off.world);
  assert.equal("parking_ahead" in snap, false);
  const m = new DriveMetrics(off.world.route.length);
  m.record(off.world, snap, off.world.roadInfo(), DT);
  assert.equal("parking_conflicts" in m.summary(off.world, { totals: {} }, false), false);
  // (a world built without the option at all steps the same)
  const bare = (() => { setWeather("dry"); const x = new World(KITS, { seed: 9, weather: "dry" }); return x; })();
  assert.equal(bare.parkers.enabled, false);
  // (on, but never picking one: the other streams draw the same, since the parkers have their own)
  const on = make(true); on.world.parkers.next = Infinity;
  assert.equal(run(on), plain);
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/room_to_park.json`), from the
// challenge once the parker has stopped beside the gap and the car is coming up to its hold line,
// generated by the production pipeline.
if (process.argv.includes("--write-snapshot")) {
  const ctx = challenge(), w = ctx.world, n = parkerOf(w);
  let snap = null, candidates = null, eligible = null, rejected = null;
  const p = w.route.project(w.ego.x, w.ego.y), law = { kind: "lane", vTarget: 4, s0: p.s };
  for (let k = 0; k < 40 * 60 && !snap; k++) {
    applyLaw(w.ego, law, w.route, w.route.project(w.ego.x, w.ego.y).s, DT, w);
    stepWorld(ctx, DT, w.t * 1000);
    if (n.parker?.phase !== "stop") continue;
    const s = buildSnapshot(w);
    if (!s.parking_ahead?.wait || s.parking_ahead.bumper_to_stop_m > 16 || s.parking_ahead.bumper_to_stop_m < 6) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "wait_for_parker") && sim.eligible.length >= 2) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible);
  const state = toJevState(snap, candidates, { rejected });
  fs.writeFileSync(new URL("../data/snapshots/room_to_park.json", import.meta.url), JSON.stringify({ name: "room_to_park", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: ["wait_for_parker", "keep_lane_target", "keep_lane_cautious", "keep_lane_slow", "keep_lane_stop", "hard_brake"] } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/room_to_park.json (hold line ${snap.parking_ahead.bumper_to_stop_m} m ahead, ${eligible.length} eligible)`);
}
console.log(`${checks} parker checks passed`);
process.exit(0);
