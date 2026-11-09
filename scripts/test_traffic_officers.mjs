// Police officers directing traffic (sim/traffic-officer.js): the one test, `officerDirection`; the officer's
// phases (holding everyone between waves until the box is empty, and waving on whoever is too close to stop);
// people on foot walking with the waved axis; traffic obeying the officer rather than the light; sensing, the
// candidates and their rejection, Rules and the cautious agent; what models are told; the audit, which counts
// going on while held and no longer faults a wave through a red; a free drive's officer from the feature's own
// random stream; the "Follow the officer" challenge, with a driver who ignores the officer; checkpoints; and
// nothing computed, drawn or reported with the option off.
//   node --experimental-default-type=module scripts/test_traffic_officers.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE } = await import("../static/js/sim/vehicle.js");
const { StopMemory, approachPhase } = await import("../static/js/sim/signals.js");
const { controlAt } = await import("../static/js/sim/outage.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const O = await import("../static/js/sim/traffic-officer.js");
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
const { failureCategory } = await import("../static/js/lab/examiner.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { mapClock } = await import("../static/js/sim/speed-zones.js");
const { DeadlockDetector } = await import("../static/js/brain/safety.js");
const { Autopilot } = await import("../static/js/brain/brain.js");

let checks = 0;
async function test(name, fn) { if (process.env.ONLY && !name.includes(process.env.ONLY)) return; await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const TOR = load("4a96d42cb3f2");
const lesson = CHALLENGES.find(c => c.id === "follow-the-officer");
// Bloor Street West at Spadina (sig7): Spadina Avenue northbound (group B) and Bloor eastbound (group A).
const SIG = "sig7", SPADINA = ["e177", "e344", "e221", "e218"], BLOOR = ["e182", "e336", "e388", "e184", "e390", "e264"];
const DT = 1 / 60;
const idle = { enabled: false, step() {} };
const inter = TOR.intersections.get(SIG);
const lineOf = (id) => TOR.edges.get(id).control.s_line;
// The first time from 0 at which edge `edge`'s light is `state`, after `after`.
const firstAt = (edge, state, after = 0) => { for (let t = after; t < after + 200; t += 0.1) if (approachPhase(inter, edge, t) === state) return t; return null; };

// A world with officers (or not) and the driven car `toLine` short of Spadina's line at Bloor, at `v`, on a
// route on up Spadina Road; the clock at `t`; no traffic but what a test puts there.
function world({ officers = true, toLine = 40, v = 8, t = 0, seed = 3, traffic = 0, extra = {} } = {}) {
  setWeather("dry");
  const w = new World(TOR, { seed, parked: 0, pedestrians: 0, weather: "dry", officers, ...extra });
  w.setClock(mapClock(15.5, TOR));
  const fleet = new NpcFleet(w, { count: traffic, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  const lanes = [TOR.lane("e177", 1), TOR.lane("e344", 0), TOR.lane("e221", 0), TOR.lane("e218", 0)];
  const s = lineOf("e344") - (CAR.length - CAR.rearOverhang) - toLine;
  w.placeOnLane(lanes[1], Math.max(1, s)); w.ego.v = v; w.t = t;
  w.route = new Route(routeFromLanes(TOR, lanes.slice(1), Math.max(1, s), 20), TOR, w.ego.spec); w.destination = w.route.endPoint();
  return { world: w, fleet, autopilot: idle };
}
// A traffic car on `ids` (its first street, `s` along it, at `v`).
function car(ctx, ids, s, v, id) {
  const { world: w, fleet } = ctx, lane = TOR.lane(ids[0], TOR.edges.get(ids[0]).lanes - 1), p = pointAt(lane.pts, lane.cum, s);
  const n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, CAR);
  Object.assign(n, { id, color: 0, v0: TOR.edges.get(ids[0]).limit, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(TOR, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  n.path.start(ids[0], lane.idx, s, ids.slice(1).map((e) => [e, TOR.edges.get(e).lanes - 1]));
  fleet.vehicles.push(n);
  return n;
}
// One step, the driven car on `law` (or holding still).
function step(ctx, law = { kind: "lane", vTarget: 0 }) {
  const w = ctx.world, p = w.route.project(w.ego.x, w.ego.y);
  if (!law.s0) law.s0 = p.s;
  applyLaw(w.ego, law, w.route, p.s, DT, w);
  return stepWorld(ctx, DT, w.t * 1000);
}
const decide = (w, brain = new RulesBrain()) => {
  const snap = buildSnapshot(w), candidates = sampleCandidates(snap, w), r = simulateAll(candidates, snap, w);
  return { snap, candidates, ...r, choice: brain.decideSync(snap, r.eligible) };
};
// Times at which Spadina (B) is green and Bloor (A) red, and the other way round.
const B_GREEN = firstAt("e344", "green") + 5, A_GREEN = firstAt("e184", "green", B_GREEN) + 3;

await test("the one test: the officer's direction for each approach, and people on foot", () => {
  const ctx = world({ t: B_GREEN }), w = ctx.world;
  assert.equal(O.officerDirection(w, w.ego, "e344"), null, "no officer yet");
  const o = O.placeOfficer(w, SIG, { phase: "A" });
  assert.equal(o?.inter, SIG);
  assert.equal(approachPhase(inter, "e344", w.t), "green");
  assert.equal(O.officerDirection(w, w.ego, "e344"), "stop", "held on the green");
  assert.equal(O.officerDirection(w, { id: "x" }, "e184"), "go", "Bloor waved on its red");
  assert.equal(O.officerDirection(w, w.ego, "e177"), null, "no signal there");
  assert.equal(O.officerDirection(w, w.ego, "e372"), null, "another junction (Huron)");
  o.committed.x = o.turn;
  assert.equal(O.officerDirection(w, { id: "x" }, "e344"), "go", "waved on as the officer turned");
  o.committed = {};
  assert.equal(O.officerWalk(w, SIG, "A"), true, "walk alongside the waved axis, early in the wave");
  assert.equal(O.officerWalk(w, SIG, "B"), false);
  assert.equal(O.officerWalk(w, "sig8", "A"), null, "no officer there");
  // (people on foot at a corner: across Spadina, alongside Bloor, yes; across Bloor, no)
  const node = TOR.edges.get("e344").to, info = w.crowd.legsAt.get(node);
  assert.equal(info?.inter?.id, SIG);
  const across = (group) => w.crowd.mayCross({ node, leg: info.list.find(l => l.group === group), from: [0, 0], to: [1, 1] }, w.t);
  assert.equal(across("B"), true, "crossing Spadina alongside waved Bloor");
  assert.equal(across("A"), false, "crossing Bloor in front of it");
  w.t += O.OFFICER_WALK_S + 1;
  assert.equal(across("B"), false, "not starting late in the wave");
  // (in a power cut the officer still governs: the junction stays a signal for everyone)
  w.outages.cut(SIG);
  assert.equal(controlAt(w, TOR.edges.get("e344").control, "e344").type, "signal");
  O.removeOfficer(w, o);
  assert.equal(controlAt(w, TOR.edges.get("e344").control, "e344").type, "stop", "a dark signal without one is an all-way stop");
  assert.equal(O.officerSite(TOR, inter), true);
  assert.equal(O.officerSite(TOR, TOR.intersections.get("sig2")), false, "Bathurst's streetcar line");
});

await test("phases: everyone held between waves until the box is empty, a car too close to stop waved on", () => {
  const ctx = world({ t: B_GREEN, toLine: 1, v: 0 }), w = ctx.world;
  const o = O.placeOfficer(w, SIG, { phase: "A" });
  o.phaseSince = w.t - O.GO_MIN_S - 1;
  // a car on Bloor, 9 m short of its line at 10 m/s, too close to stop for the officer turning: the officer
  // keeps waving while it can (before GO_MAX_S), then turns anyway and waves it on
  const near = car(ctx, BLOOR.slice(3), lineOf("e184") - 9 - (CAR.length - CAR.rearOverhang), 10, "near");
  step(ctx);
  assert.equal(o.phase, "A", "not while a car is too close to stop, early in the wave");
  o.phaseSince = w.t - O.GO_MAX_S - 1;
  step(ctx);
  assert.equal(o.phase, "clear", "the car waits on Spadina: the officer turns");
  assert.equal(o.committed.near, o.turn, "waved on");
  assert.equal(O.officerDirection(w, near, "e184"), "go");
  assert.equal(O.officerDirection(w, w.ego, "e344"), "stop");
  const clearAt = w.t;
  let wavedAt = null, nearOutAt = null;
  for (let k = 0; k < 20 * 60 && wavedAt === null; k++) {
    step(ctx);
    if (nearOutAt === null && Math.hypot(near.x - o.x, near.y - o.y) > o.boxR + CAR.length) nearOutAt = w.t;
    if (o.phase === "B") wavedAt = w.t;
  }
  assert.notEqual(wavedAt, null);
  assert.equal(wavedAt - clearAt >= O.CLEAR_S - 1e-9, true, "a short all-stop first");
  assert.equal(nearOutAt !== null && nearOutAt <= wavedAt, true, "only once the waved-on car is through");
  assert.equal(near.v > 5, true, "it never stopped");
  assert.equal(O.officerDirection(w, w.ego, "e344"), "go");
  assert.equal(w.violations.collisions, 0);
});

await test("a vehicle in the box holds the switch however long the all-stop has lasted", () => {
  const ctx = world({ t: B_GREEN, toLine: 30, v: 0 }), w = ctx.world;
  const o = O.placeOfficer(w, SIG), start = [w.ego.x, w.ego.y];
  o.phaseSince = w.t - O.CLEAR_MAX_S - 5;
  // the driven car standing in the middle of the junction: the officer keeps everyone held
  w.ego.x = o.x; w.ego.y = o.y;
  for (let k = 0; k < 10; k++) O.stepOfficers(w, DT);
  assert.equal(o.phase, "clear", "never waves the next axis while the box is occupied");
  // out of the box, but a contraflow cyclist (not in world.npcs) is still in it: still held
  [w.ego.x, w.ego.y] = start;
  const rider = new Vehicle(o.x, o.y, 0, 4, BIKE), riders = w.contraflow.riders;
  w.contraflow.riders = [rider];
  O.stepOfficers(w, DT);
  assert.equal(o.phase, "clear", "a contraflow cyclist in the box holds the switch too");
  // the box empty: the next axis is waved
  w.contraflow.riders = riders;
  O.stepOfficers(w, DT);
  assert.notEqual(o.phase, "clear", "the next axis is waved once the box is empty");
});

await test("traffic and cyclists take the officer's direction, not the light's, and a held driver never gives up waiting", () => {
  const ctx = world({ t: B_GREEN, toLine: 60, v: 0 }), w = ctx.world;
  const o = O.placeOfficer(w, SIG, { phase: "A", holdUntil: B_GREEN + 40 });
  const sp = car(ctx, ["e344", "e221", "e218"], 5, 9, "spadina");
  const bl = car(ctx, BLOOR, 5, 10, "bloor");
  let blCrossedOnRed = false, spMinToLine = Infinity;
  for (let k = 0; k < 35 * 60; k++) {
    step(ctx);
    const a = O.approachOf(w, inter, bl);
    if (a && a.toLine < 0 && approachPhase(inter, "e184", w.t) === "red") blCrossedOnRed = true;
    const b = O.approachOf(w, inter, sp);
    if (b) spMinToLine = Math.min(spMinToLine, b.toLine);
  }
  assert.equal(o.phase, "A");
  assert.equal(approachPhase(inter, "e344", w.t) === "green" || approachPhase(inter, "e344", w.t) === "yellow" || approachPhase(inter, "e344", w.t) === "red", true);
  assert.equal(blCrossedOnRed, true, "Bloor goes through on its red, waved");
  assert.equal(spMinToLine > -0.5 && sp.v < 0.2, true, `Spadina held at its line, on its green (${spMinToLine.toFixed(1)} m)`);
  assert.equal(sp.officerHeld, true);
  // (well over the 15 s after which traffic gives up on an empty junction's virtual leader: still waiting)
  for (let k = 0; k < 6 * 60 && o.phase === "A"; k++) step(ctx);
  const until = o.holdUntil;
  for (let k = 0; k < 15 * 60 && o.phase !== "B"; k++) step(ctx);
  assert.equal(o.phase, "B");
  assert.equal(w.t >= until, true);
  for (let k = 0; k < 8 * 60; k++) step(ctx);
  assert.equal(O.approachOf(w, inter, sp) === null || O.approachOf(w, inter, sp).toLine < 0, true, "Spadina goes once waved");
  assert.equal(w.violations.collisions, 0);
});

await test("sensing, candidates, Rules and the cautious agent: stop when held on a green, go when waved on a red", () => {
  const held = world({ t: B_GREEN, toLine: 30, v: 8 }), w = held.world;
  O.placeOfficer(w, SIG, { phase: "A" });
  const d = decide(w);
  assert.equal(d.snap.traffic_officer?.direction, "stop");
  assert.equal(d.snap.traffic_officer.signal, "green");
  assert.equal(d.snap.traffic_officer.against_light, true);
  assert.equal(d.snap.intersection.officer.direction, "stop");
  assert.equal(d.mustStop, true);
  assert.equal(d.eligible.some(c => c.id === "wait_for_officer"), true);
  assert.equal(d.candidates.find(c => c.id === "keep_lane_target")?.reject, "passes_officer_stop");
  assert.equal(d.choice.candidateId, "wait_for_officer");
  assert.equal(new CautiousAgent().decideSync(d.snap, d.eligible).candidateId, "wait_for_officer");
  const close = world({ t: B_GREEN, toLine: 10, v: 8 });
  O.placeOfficer(close.world, SIG, { phase: "A" });
  const cs = buildSnapshot(close.world);
  assert.equal(cs.target.v < 7, true, String(cs.target.v));
  assert.equal(cs.target.reasons.includes("police officer: stop"), true);
  // waved through, on a red: go, without stopping for the light, turning on red or an amber call
  const waved = world({ t: A_GREEN, toLine: 25, v: 8, extra: { amberLights: true, leftOnRed: true, redRunners: true } }), x = waved.world;
  assert.equal(approachPhase(inter, "e344", x.t), "red");
  O.placeOfficer(x, SIG, { phase: "B" });
  const e = decide(x);
  assert.equal(e.snap.traffic_officer.direction, "go");
  assert.equal(e.snap.traffic_officer.signal, "red");
  assert.equal(e.mustStop, false);
  assert.equal(e.snap.intersection.right_on_red, null);
  assert.equal("amber" in e.snap.intersection, false);
  assert.equal(e.snap.intersection.seconds_to_green, null);
  assert.equal(e.eligible.some(c => c.id === "go_on_officer_wave"), true);
  assert.equal(e.eligible.some(c => c.id === "wait_for_officer"), false);
  assert.equal(e.choice.motion, "drive");
  assert.equal(e.eligible.find(c => c.id === e.choice.candidateId).sim.end_speed > 5, true, e.choice.candidateId);
  const cautious = new CautiousAgent().decideSync(e.snap, e.eligible);
  assert.equal(cautious.motion, "drive");
  assert.equal(e.eligible.find(c => c.id === cautious.candidateId).sim.end_speed > 3, true);
  // (held at the line on a green is a reason to wait, not a deadlock: the recovery creep would take the car
  // over the line in front of the officer)
  const stalled = world({ t: B_GREEN, toLine: 2, v: 0 }), sw = stalled.world;
  O.placeOfficer(sw, SIG, { phase: "A" });
  const detector = new DeadlockDetector(), ss = buildSnapshot(sw);
  ss.target = { v: 11, reasons: [] };
  for (let k = 0; k < 20 * 60; k++) detector.update(sw, ss, DT);
  assert.equal(sw.stuckFor, 0);
  // and without the officer the same car stops for its red
  const plain = world({ officers: false, t: A_GREEN, toLine: 25, v: 8 }), f = decide(plain.world);
  assert.equal(f.mustStop, true);
  assert.equal("traffic_officer" in f.snap, false);
});

await test("the deadlock creep stops at the line where the officer holds the car, even with no decision coming", () => {
  // (a driver whose answer never comes: the car stands 18 m short of the line, held on its green, until the
  // recovery creep takes over; it must creep up to the line and stop there, not on into the junction)
  const ctx = world({ t: B_GREEN, toLine: 18, v: 0 }), w = ctx.world;
  const o = O.placeOfficer(w, SIG, { phase: "A", holdUntil: Infinity });
  const autopilot = new Autopilot(w);
  autopilot.brains.silent = { decide: () => new Promise(() => {}), timeoutMs: 1e9 };
  autopilot.setBrain("silent"); autopilot.setEnabled(true);
  ctx.autopilot = autopilot;
  let crept = false, minToLine = Infinity;
  for (let k = 0; k < 45 * 60; k++) {
    stepWorld(ctx, DT, w.t * 1000);
    if (autopilot.executing?.candidate?.id === "creep") crept = true;
    const toLine = buildSnapshot(w).intersection?.bumper_to_line_m;
    if (toLine !== undefined) minToLine = Math.min(minToLine, toLine);
  }
  assert.equal(crept, true, "the creep took over");
  assert.equal(w.violations.deadlock_overrides >= 1, true);
  assert.equal(O.officerDirection(w, w.ego, "e344"), "stop");
  assert.equal(minToLine > 0, true, `crept over the line: ${minToLine.toFixed(2)} m`);
  assert.equal(minToLine < 2.5, true, `stopped ${minToLine.toFixed(2)} m short`);
  assert.equal(w.ego.v < 0.1, true);
  assert.equal(w.violations.officer_violations || 0, 0);
  // (the officer, free to turn, sees the car waiting at the held line and waves it on; the creep, still with
  // no decision, goes on through)
  o.holdUntil = 0;
  let wavedAt = null;
  for (let k = 0; k < 40 * 60; k++) {
    stepWorld(ctx, DT, w.t * 1000);
    if (wavedAt === null && o.phase === "B") wavedAt = w.t;
  }
  assert.notEqual(wavedAt, null, "the officer waved the waiting car on");
  assert.equal(O.approachOf(w, inter, w.ego) === null || O.approachOf(w, inter, w.ego).toLine < -5, true, "through the junction");
  assert.equal(w.violations.officer_violations || 0, 0);
  assert.equal(w.violations.collisions, 0);
});

await test("what models are told", () => {
  const held = world({ t: B_GREEN, toLine: 25, v: 5 }), w = held.world;
  O.placeOfficer(w, SIG, { phase: "A" });
  const d = decide(w), state = toJevState(d.snap, d.candidates, { rejected: d.rejected });
  assert.equal(state.traffic_officer.direction, "stop");
  assert.equal(state.traffic_officer.officer_waves, "the crossing street");
  assert.equal(state.traffic_officer.against_the_light, true);
  const said = situationClauses(d.snap).join(" ");
  assert.equal(said.includes("police officer") && said.includes("wait_for_officer") && said.includes("though its light is green"), true, said);
  assert.equal(said.includes("m ahead is green"), false, "the light's own clause gives way to the officer's");
  assert.equal(SYSTEM_PROMPT.includes("traffic_officer") && SYSTEM_PROMPT.includes("go_on_officer_wave"), true);
  const { questions } = buildQuestions(d.snap, d.eligible);
  assert.equal(Object.keys(questions.vector.criteria).includes("wait_for_officer"), true);
  assert.equal(questions.motion.criteria.stop.includes("police officer"), true);
  assert.equal(O.officerNotice(w, d.snap).text, "OFFICER DIRECTING TRAFFIC · STOP");
  const waved = world({ t: A_GREEN, toLine: 25, v: 8 }), x = waved.world;
  O.placeOfficer(x, SIG, { phase: "B" });
  const e = decide(x);
  assert.equal(situationClauses(e.snap).join(" ").includes("though its light is red"), true);
  assert.equal(O.officerNotice(x, null).text, "OFFICER DIRECTING TRAFFIC · GO", "the HUD while driving by hand");
});

// Drive the car on through the line at `v`, whatever it is told, for `s` seconds.
function driveThrough(ctx, v = 8, s = 8) { const seen = []; for (let k = 0; k < s * 60; k++) { step(ctx, { kind: "lane", vTarget: v }); seen.push(...ctx.world.events); } return seen; }

await test("the audit: going on while held is an officer violation; going on when waved through a red is not a red light", () => {
  const held = world({ t: B_GREEN, toLine: 30, v: 8, extra: { amberLights: true, redRunners: true } }), w = held.world;
  O.placeOfficer(w, SIG, { phase: "A" });
  const events = driveThrough(held);
  assert.equal(w.officersSeen, true, "seen");
  assert.equal(w.violations.officer_violations, 1, JSON.stringify(w.violations));
  assert.equal(w.violations.red_lights_run, 0);
  assert.equal(events.some(e => e.type === "officer_violation" && e.junction === SIG), true);
  const waved = world({ t: A_GREEN, toLine: 30, v: 8, extra: { amberLights: true, redRunners: true, leftOnRed: true } }), x = waved.world;
  O.placeOfficer(x, SIG, { phase: "B" });
  driveThrough(waved);
  assert.equal(x.violations.officer_violations || 0, 0);
  assert.equal(x.violations.red_lights_run, 0, "waved through the red");
  assert.equal(x.violations.amber_lights_run || 0, 0);
  assert.equal(x.violations.fresh_green_conflicts || 0, 0);
  assert.equal(x.violations.stop_signs_run, 0);
  // (the same drive without an officer runs the red)
  const plain = world({ officers: false, t: A_GREEN, toLine: 30, v: 8 });
  driveThrough(plain);
  assert.equal(plain.world.violations.red_lights_run, 1);
  // (and in a power cut, waved through, it owes no stop at the dark signal)
  const dark = world({ t: A_GREEN, toLine: 30, v: 8 }), y = dark.world;
  y.outages.cut(SIG); O.placeOfficer(y, SIG, { phase: "B" });
  driveThrough(dark);
  assert.equal(y.violations.stop_signs_run + y.violations.failed_to_yield + y.violations.red_lights_run + (y.violations.officer_violations || 0), 0);
});

await test("officer_violations reaches the metrics, the drive score, the practice verdict and the examiner only once the car has come up to an officer", () => {
  const ctx = world({ t: B_GREEN, toLine: 30, v: 8 }), w = ctx.world;
  const metrics = new DriveMetrics(w.route.length), score = new DriveScore(w, {});
  metrics.record(w, buildSnapshot(w), w.roadInfo(), DT); score.record(w, w.roadInfo(), DT);
  assert.equal("officer_violations" in metrics.summary(w, { totals: {} }, false), false);
  assert.equal("officer_violations" in score.snapshot(), false);
  w.officersSeen = true; w.violations.officer_violations = 1;
  w.events.push({ type: "officer_violation", officer: "officer_1", junction: SIG });
  score.record(w, w.roadInfo(), DT);
  const m = metrics.summary(w, { totals: {} }, true);
  assert.equal(m.officer_violations, 1);
  const reason = "went on when a police officer signalled stop";
  assert.equal(failures(m).includes(reason), true);
  assert.equal(failureCategory(reason), "right_of_way");
  const report = score.snapshot();
  assert.equal(report.officer_violations, 1);
  assert.equal(report.tips.some(t => t.includes("police officer")), true);
  assert.equal(report.incidents.some(i => i.type === "officer_violation"), true);
  const clean = { config: { version: lesson.version || 1, challenge: lesson.id, map: lesson.map, seed: lesson.seed, weather: lesson.weather, time: lesson.time, traffic: 0, car: "compact", clock: 0 },
    driver: "manual", branched: false, modified: false, started_at: "2026-11-08T10:00:00Z", status: "arrived", score: 95, qualified: true,
    collisions: 0, red_lights: 0, stop_signs: 0, failed_to_yield: 0, off_road_s: 0, resets: 0 };
  assert.equal(practiceOutcome(lesson, clean), "completed");
  assert.equal(practiceOutcome(lesson, { ...clean, officer_violations: 1 }), "attempted");
});

await test("a free drive's officer: from the feature's own stream, well ahead and out of sight, with a cruiser; leaving once the car is away", () => {
  setWeather("dry");
  const w = new World(TOR, { seed: 7, parked: 0, pedestrians: 0, weather: "dry", officers: true });
  w.setClock(mapClock(15.5, TOR));
  const fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 5 }), ctx = { world: w, fleet, autopilot: idle };
  const lanes = ["e174", "e175", "e176", "e177"].map(id => TOR.lane(id, 1)).concat([TOR.lane("e344", 0), TOR.lane("e221", 0)]);
  w.placeOnLane(lanes[0], 5);
  w.route = new Route(routeFromLanes(TOR, lanes, 5, 40), TOR, w.ego.spec); w.destination = w.route.endPoint();
  assert.equal(w.officers.random !== null && w.officers.next === O.OFFICER_FIRST_S, true);
  w.officers.next = 0;
  let k = 0;
  for (; k < 120 * 60 && !w.officers.list.length; k++) stepWorld(ctx, DT, w.t * 1000);
  const o = w.officers.list[0];
  assert.equal(o?.inter, SIG, "the signal 150 to 450 m ahead on the route");
  const c = w.route.controls.find(x => x.control.id === SIG), ahead = c.sRoute - w.route.project(w.ego.x, w.ego.y).s;
  assert.equal(ahead >= O.SPAWN_M[0] && ahead <= O.SPAWN_M[1] + 10, true, String(ahead));
  assert.equal(w.visibility.canSee(w.ego, o.x, o.y), false);
  assert.equal(Number.isFinite(o.left) && o.left >= O.STAY_S[0] - 1 && o.left <= O.STAY_S[1], true);
  assert.equal(o.cruiser?.vehicle.kind, "police");
  assert.equal(o.cruiser.vehicle.flashing, true);
  assert.equal(o.cruiser.parked, false, "no parking bays on Spadina: up on the kerb");
  assert.equal(TOR.roadDistance(...o.cruiser.vehicle.center).distance > o.cruiser.vehicle.spec.width / 2, true, "out of the lanes");
  assert.equal(w.officersSeen, false);
  // (one at a time: no second)
  for (let j = 0; j < 30 * 60; j++) stepWorld(ctx, DT, w.t * 1000);
  assert.equal(w.officers.list.length, 1);
  // leaving: its time up, the car well away and out of sight, nobody near
  o.left = 0;
  w.placeOnLane(TOR.lane("e174", 1), 5);
  stepWorld(ctx, DT, w.t * 1000);
  assert.equal(w.officers.list.length, 0);
  assert.equal(w.officers.next >= w.t + O.OFFICER_COOLDOWN_S - 1, true);
});

await test("a cruiser in a parking bay is parked like any car, and goes with the officer", () => {
  // (Huron Street at Bloor has parking lanes)
  setWeather("dry");
  const w = new World(TOR, { seed: 3, weather: "dry", officers: true, pedestrians: 0 });
  const before = w.parked.list.length;
  const o = O.placeOfficer(w, "sig8", { phase: "A" });
  assert.equal(o.cruiser?.parked, true);
  assert.equal(w.parked.list.includes(o.cruiser.vehicle), true);
  assert.equal(o.cruiser.slot.reserved, o.cruiser.vehicle);
  assert.equal(w.obstaclesNear(o.cruiser.vehicle.x, o.cruiser.vehicle.y, 3).includes(o.cruiser.vehicle), true);
  O.removeOfficer(w, o);
  assert.equal(w.parked.list.includes(o.cruiser.vehicle), false);
  assert.equal(o.cruiser.slot.reserved, null);
  assert.equal(w.parked.list.length <= before, true);
});

await test("\"Follow the officer\": a stable scenario at Bloor and Spadina, the officer and the lights on cue", () => {
  const a = challengeScenario(TOR, lesson), b = challengeScenario(TOR, lesson);
  assert.deepEqual(a, b);
  assert.equal(lesson.seed, 57042);
  assert.equal(lesson.map, "toronto");
  assert.equal(lesson.difficulty, "Judgement");
  assert.equal(TOR.edges.get(a.start.edge).name, "Spadina Avenue");
  assert.deepEqual(CHALLENGES.filter(c => c.officers).map(c => c.id), ["follow-the-officer"]);
  assert.equal(CHALLENGES.at(-1).id, "follow-the-officer");
  const ctx = setupChallenge(TOR, lesson);
  assert.equal(ctx.world.officers.enabled, true);
  assert.equal(ctx.world.officers.list.length, 1);
  assert.equal(ctx.world.officers.list[0].phase, "A");
  assert.equal(approachPhase(inter, "e344", ctx.world.t), "green");
});

for (const brain of ["rules", "cautious"]) await test(`"Follow the officer", ${brain}: stops on the green when held, goes on the red when waved, a clean drive`, async () => {
  const ctx = setupChallenge(TOR, lesson, { brain }), { world: w, autopilot } = ctx;
  let heldOnGreen = false, wentOnRed = false, heldBraking = 0;
  for (let k = 0; k < 120 * 60 && autopilot.enabled; k++) {
    const v0 = w.ego.v;
    stepWorld(ctx, DT, w.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    const s = autopilot.snap?.traffic_officer;
    // (stopping for the officer smoothly, right at the line: never a hard stop short of it)
    if (s?.direction === "stop" && s.bumper_to_line_m > 0) heldBraking = Math.max(heldBraking, (v0 - w.ego.v) / DT);
    if (s?.direction === "stop" && s.signal === "green" && s.bumper_to_line_m < 3 && s.bumper_to_line_m > 0 && w.ego.v < 0.2) heldOnGreen = true;
    if (s?.direction === "go" && s.signal === "red" && s.bumper_to_line_m < 0) wentOnRed = true;
  }
  assert.equal(w.challenge.triggered, true);
  assert.equal(heldOnGreen, true, "stopped at the line on its green");
  assert.equal(heldBraking < 3, true, `braked at ${heldBraking.toFixed(2)} m/s² for the officer`);
  assert.equal(wentOnRed, true, "went on its red when waved");
  assert.equal(w.violations.collisions, 0);
  assert.equal(w.violations.officer_violations || 0, 0);
  assert.equal(w.violations.deadlock_overrides, 0);
  const result = await evaluateChallenge(TOR, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.officer_violations, 0);
  assert.equal(result.red_lights, 0);
  assert.equal(result.report.officer_violations, 0);
  assert.equal(result.events.some(e => e.type === "hazard"), true);
});

await test("\"Follow the officer\": a driver who goes on the green while held fails", () => {
  const ctx = setupChallenge(TOR, lesson), { world: w, autopilot } = ctx;
  autopilot.setEnabled(false);
  for (let k = 0; k < 20 * 60; k++) step(ctx, { kind: "lane", vTarget: 8 });
  assert.equal(w.violations.officer_violations, 1);
  const m = new DriveMetrics(w.route.length);
  m.record(w, null, w.roadInfo(), DT);
  assert.equal(failures(m.summary(w, { totals: {} }, true)).includes("went on when a police officer signalled stop"), true);
});

await test("checkpoints: a replay from a checkpoint repeats the officer exactly", async () => {
  const ctx = setupChallenge(TOR, lesson), recorder = new DriveRecorder(), clock = {};
  for (let k = 0; k < 600; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], cars: ctx.world.npcs.map(n => [n.id, n.x, n.y, n.v, !!n.officerHeld]),
    officers: ctx.world.officers.list.map(o => [o.id, o.phase, o.phaseSince, o.turn, o.committed, o.face, o.cruiser?.id]), seen: ctx.world.officersSeen, v: ctx.world.violations, t: ctx.world.t });
  for (let k = 0; k < 30 * 60; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  for (let k = 0; k < 30 * 60; k++) { stepWorld(ctx, DT, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  assert.equal(sig(), first);
});

await test("with the option off nothing is built, drawn or reported, and traffic runs exactly as before", () => {
  const run = (officers, hold = false) => {
    const ctx = world({ officers, t: B_GREEN, toLine: 120, v: 8, traffic: 25, seed: 9 }), w = ctx.world;
    if (hold) w.officers.next = Infinity;
    for (let k = 0; k < 40 * 60; k++) step(ctx, { kind: "lane", vTarget: 8 });
    return { w, sig: JSON.stringify([ctx.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v]), w.ego.x, w.ego.y, w.violations]) };
  };
  const off = run(false);
  assert.equal(off.w.officers.enabled, false);
  assert.equal(off.w.officers.random, null);
  assert.equal(off.w.officers.next, Infinity);
  assert.equal(off.w.officers.list.length, 0);
  assert.equal(off.w.officersSeen, false);
  assert.equal("officer_violations" in off.w.violations, false);
  const snap = buildSnapshot(off.w);
  assert.equal("traffic_officer" in snap, false);
  const metrics = new DriveMetrics(off.w.route.length);
  metrics.record(off.w, snap, off.w.roadInfo(), DT);
  assert.equal("officer_violations" in metrics.summary(off.w, { totals: {} }, false), false);
  assert.equal(off.w.npcs.some(n => "officerHeld" in n), false);
  // (on, but never placing one: the other streams draw the same, since the officers have their own)
  assert.equal(run(true, true).sig, off.sig);
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/follow_the_officer.json`), from
// the challenge as the car comes up to the officer holding it on its green, generated by the production
// pipeline.
if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(TOR, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 30 * 60 && !snap; k++) {
    stepWorld(ctx, DT, w.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const s = buildSnapshot(w);
    if (s.traffic_officer?.direction !== "stop" || s.traffic_officer.signal !== "green" || s.traffic_officer.bumper_to_line_m > 25 || s.traffic_officer.bumper_to_line_m < 12) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "wait_for_officer")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible);
  const state = toJevState(snap, candidates, { rejected });
  fs.writeFileSync(new URL("../data/snapshots/follow_the_officer.json", import.meta.url), JSON.stringify({ name: "follow_the_officer", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: ["wait_for_officer", "stop_at_line"] } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/follow_the_officer.json (officer holding the car ${snap.traffic_officer.bumper_to_line_m} m short of the line on green, ${eligible.length} eligible)`);
}
console.log(`${checks} traffic officer checks passed`);
process.exit(0);
