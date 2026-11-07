// Snowbanks: the banks along the kerbs, higher at the corners; the narrowings where they push the parked
// cars out, and the one turn-taking test shared by sensing, candidates, traffic and the audit; traffic
// taking turns and moving over; corner piles hiding people and the side street from the car; what models
// are told; the "One car at a time" challenge with Rules and the cautious agent, and a driver who goes in
// out of turn; checkpoints; and nothing built, drawn or reported with the option off.
//   node --experimental-default-type=module scripts/test_snowbanks.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const SB = await import("../static/js/sim/snowbanks.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { Route } = await import("../static/js/map/route.js");

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
const MTL = load("bb9df59633e0");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const lesson = CHALLENGES.find(c => c.id === "one-car-at-a-time");
const scenario = challengeScenario(MTL, lesson);
const SITE = scenario.snowbank;   // { edge, a, b }
const FRONT = CAR.length - CAR.rearOverhang;
const lengthOf = (e) => e.cum[e.cum.length - 1];

function world({ snowbanks = true, seed = 3, traffic = 0, parked = 0, weather = "snow", narrowing = SITE } = {}) {
  setWeather(weather);
  const w = new World(MTL, { seed, parked, pedestrians: 0, weather, snowbanks });
  if (snowbanks && narrowing && weather === "snow") w.snowbanks.build({ narrowings: [narrowing] });
  const fleet = new NpcFleet(w, { count: traffic, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  return { world: w, fleet, autopilot: idle };
}
// A car on lane 0 of `edge`, its front `front` metres along the edge (cum frame), at `v`, held to `v`.
function addCar(ctx, edge, front, v, id) {
  const e = MTL.edges.get(edge), lane = MTL.lane(edge, 0), s = (front - FRONT) * lane.length / lengthOf(e);
  const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
  Object.assign(car, { id, color: 0x8d9299, v0: v / 0.62, driver: { aMax: 1.2, b: 1.5, s0: 2, T: 1.4, react: 0.6, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(MTL, () => 0.5), frozen: 0, waiting: 0 });
  car.path.start(edge, 0, s);
  ctx.fleet.vehicles.push(car);
  return car;
}
const twin = (id) => SB.narrowingSites(MTL).flatMap(s => [[s.edge, s.opposite], [s.opposite, s.edge]]).find(([a]) => a === id)[1];

await test("banks along every kerb in snow, high at the corners; narrowings only on two-way residential blocks with parking at both kerbs", () => {
  const { world: w } = world({ narrowing: null, parked: 0.5 });
  const sb = w.snowbanks;
  assert.equal(sb.enabled, true);
  assert.equal(sb.geo.runs.length > 500, true);
  assert.equal(sb.piles.length > 100, true);
  assert.equal(sb.narrowings.length >= 1, true);
  const sites = new Map(SB.narrowingSites(MTL).map(s => [s.edge, s]));
  for (const nw of sb.narrowings) {
    const site = sites.get(nw.edge), e = MTL.edges.get(nw.edge);
    assert.equal(!!site, true);
    assert.equal(nw.a >= site.lo - 1e-9 && nw.b <= site.hi + 1e-9 && nw.b - nw.a >= Math.min(SB.NARROW_LEN_M[0], site.hi - site.lo) - 1e-9, true);
    assert.equal(e.oneway, false); assert.equal(e.lanes, 1); assert.equal(e.parking[1] > 0 && MTL.edges.get(nw.opposite).parking[1] > 0, true);
  }
  // (corner piles that hide are on quiet streets, and as high as HIDE_H; banks never reach a lane's middle)
  for (const pile of sb.piles) {
    assert.equal(["residential", "unclassified", "living_street"].includes(MTL.edges.get(pile.edge).cls), true);
    assert.equal(Math.max(...pile.run.h) >= SB.HIDE_H * 0.55, true);
  }
  for (const run of sb.geo.runs) {
    const e = MTL.edges.get(run.edge), lane = Math.abs(e.lane_offsets.at(run.side > 0 ? -1 : 0));
    assert.equal(Math.abs(run.inner) > lane + CAR.width / 2, true, `${run.edge} ${run.inner}`);
    if (run.corner) assert.equal(run.h.reduce((a, b) => a + b, 0) / run.h.length > SB.BANK_H.main[0], true);
  }
  // (the same seed builds the same; in dry weather, nothing)
  const again = world({ narrowing: null }).world.snowbanks;
  assert.equal(JSON.stringify(again.narrowings.map(n => [n.id, n.a, n.b])), JSON.stringify(sb.narrowings.map(n => [n.id, n.a, n.b])));
  const dry = world({ narrowing: null, weather: "dry" }).world.snowbanks;
  assert.equal(dry.geo.runs.length + dry.piles.length + dry.narrowings.length, 0);
});

await test("in a narrowing the banks push the parked cars out; elsewhere they stay at the kerb; everyone keeps clear of them", () => {
  const { world: w } = world({ narrowing: null, parked: 0.5 });
  const nws = w.snowbanks.narrowings;
  let pushed = 0, kerb = 0;
  for (const c of w.parked.list) {
    const e = MTL.edges.get(c.edge), p = projectPoint(e.pts, e.cum, [c.x, c.y], null);
    const nw = nws.find(n => n.edge === e.id || n.opposite === e.id), dir = nw?.edge === e.id ? 1 : -1;
    const inside = nw && p.s >= (dir > 0 ? nw.a : nw.L - nw.b) - 0.5 && p.s <= (dir > 0 ? nw.b : nw.L - nw.a) + 0.5;
    const normal = c.curb === "left" ? e.asphalt[0] + e.parking[0] / 2 + 0.05 : e.asphalt[1] - e.parking[1] / 2 - 0.05;
    if (inside) { pushed++; assert.equal(Math.abs(p.lateral - SB.pushedLat(e)) < 0.15, true); }
    else { kerb++; assert.equal(Math.abs(p.lateral - normal) < 0.15, true, `${c.id} ${c.edge} ${c.curb} ${p.lateral} ${normal}`); }
    // (and the grid still finds it)
    assert.equal(w.parked.near(...c.center, 1).includes(c), true);
  }
  assert.equal(pushed > 5 && kerb > 100, true, `${pushed} ${kerb}`);
  // (a car keeping to keepAt clears them by SIDE_CLEAR_M; two meeting there could only squeeze past)
  const e = MTL.edges.get(SITE.edge), keep = SB.keepAt(e, CAR);
  assert.equal(Math.abs(SB.pushedLat(e) - CAR.width / 2 - (keep + CAR.width / 2) - SB.SIDE_CLEAR_M) < 1e-9, true);
  const between = 2 * (keep - CAR.width / 2);
  assert.equal(between > 0.2 && between < 1.0, true, `${between}`);
  assert.equal(keep < e.lane_offsets[0], true);
});

await test("taking turns: one in the stretch has the way; of two arriving, the first; a driver too close to stop goes on", () => {
  const ctx = world(), w = ctx.world, sb = w.snowbanks, nw = sb.narrowings[0], o = nw.opposite;
  // (one coming the other way already in it; the car arriving on its own side waits for it)
  const inside = addCar(ctx, o, nw.L - nw.b + 20, 3, "in_it");
  const arriving = addCar(ctx, nw.edge, nw.a - 15, 3, "arriving");
  sb.step(1 / 60);
  const c = sb.claims(nw).find(x => x.v === arriving), turn = SB.narrowingTurn(sb, nw, c);
  assert.equal(c.dir, 1); assert.equal(c.inside, false);
  assert.equal(turn.mayEnter, false); assert.equal(turn.reason, "inside"); assert.equal(turn.oncoming.id, "in_it");
  assert.equal(SB.narrowingTurn(sb, nw, sb.claims(nw).find(x => x.v === inside)).mayEnter, true);
  // (it holds its front WAIT_M short of the stretch)
  const y = SB.snowbankYield(w, arriving, arriving.path.s + FRONT);
  assert.equal(y.hold !== null && Math.abs(y.hold - sb.claims(nw).find(x => x.v === arriving).en + SB.WAIT_M) < 1e-6, true);
  // (two arriving at either end: the one that came within ZONE_M first goes first)
  const ctx2 = world(), w2 = ctx2.world, sb2 = w2.snowbanks, nw2 = sb2.narrowings[0];
  const first = addCar(ctx2, nw2.edge, nw2.a - 6, 0, "first");
  for (let k = 0; k < 30; k++) { w2.t += 1 / 60; w2.tick++; sb2.step(1 / 60); }
  const second = addCar(ctx2, nw2.opposite, nw2.L - nw2.b - 6, 0, "second");
  w2.t += 1 / 60; w2.tick++; sb2.step(1 / 60);
  const t1 = SB.narrowingTurn(sb2, nw2, sb2.claims(nw2).find(x => x.v === first)), t2 = SB.narrowingTurn(sb2, nw2, sb2.claims(nw2).find(x => x.v === second));
  assert.equal(t1.mayEnter, true); assert.equal(t2.mayEnter, false); assert.equal(t2.reason, "turn");
  // (one too close to stop, even braking hard, has the way)
  second.v = 12;
  const c2 = sb2.claimFor(nw2, second);
  c2.gap = 3;
  assert.equal(sb2.committed(nw2, c2, true), true);
  assert.equal(SB.narrowingTurn(sb2, nw2, c2).mayEnter, true);
});

await test("traffic from both ends takes turns through the stretch, moved over toward the middle, and never meets in it", () => {
  const ctx = world(), w = ctx.world, sb = w.snowbanks, nw = sb.narrowings[0];
  w.ego.x = 1e5; w.ego.y = 1e5;
  const a = addCar(ctx, nw.edge, nw.a - 35, 5, "north_1"), a2 = addCar(ctx, nw.edge, nw.a - 50, 5, "north_2");
  const b = addCar(ctx, nw.opposite, nw.L - nw.b - 33, 5, "south_1"), b2 = addCar(ctx, nw.opposite, nw.L - nw.b - 48, 5, "south_2");
  // (the cars parked along it, pushed out)
  for (const [edge, from, to] of [[nw.edge, nw.a, nw.b], [nw.opposite, nw.L - nw.b, nw.L - nw.a]]) {
    const e = MTL.edges.get(edge), lat = SB.pushedLat(e);
    for (let s = from + 3; s < to - 3; s += 6.5) {
      const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
      w.parked.add(Object.assign(new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0), { id: `p_${edge}_${s}`, curb: "right", edge, stay: true }));
    }
  }
  let both = 0, hit = 0, minShift = 0;
  const through = new Set();
  for (let k = 0; k < 80 * 60; k++) {
    step(ctx);
    const claims = sb.claims(nw);
    const ins = claims.filter(c => c.inside);
    if (ins.some(c => c.dir > 0) && ins.some(c => c.dir < 0)) both++;
    for (const c of ins) { through.add(c.id); minShift = Math.min(minShift, c.v.sbShift || 0); }
    for (const v of w.npcs) for (const p of w.parked.near(v.x, v.y, 8)) if (obbOverlap(v.obb(), p.obb())) hit++;
    for (const v of [a, a2]) for (const u of [b, b2]) if (obbOverlap(v.obb(), u.obb())) hit++;
  }
  assert.equal(both, 0);
  assert.equal(hit, 0);
  assert.deepEqual([...through].sort(), ["north_1", "north_2", "south_1", "south_2"]);
  assert.equal(minShift < -0.3, true, `${minShift}`);
  for (const v of [a, a2, b, b2]) assert.equal(sb.claimFor(nw, v), null);
});

await test("a high corner pile hides a person waiting at the corner, and the side street, from the car; not once they are in the road", () => {
  const ctx = setupChallenge(MTL, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const e = MTL.edges.get(SITE.edge), L = lengthOf(e), ped = w.crowd.list.find(p => p.id === "challenge_pedestrian");
  const lane = MTL.lane(e.id, 0);
  w.placeOnLane(lane, (L - 30) * lane.length / L);
  assert.equal(w.visibility.sees(w.ego, ped), true);
  assert.equal(w.sees(w.ego, ped), false);
  assert.equal(SB.bankHidden(w, w.ego, ped), true);
  // (out in the road it is in plain view)
  const h = headingAt(e.pts, e.cum, L - 7), q = pointAt(e.pts, e.cum, L - 7);
  ped.x = q[0] + Math.sin(h) * 4; ped.y = q[1] - Math.cos(h) * 4;
  assert.equal(w.sees(w.ego, ped), true);
  // (a car is hidden behind it too, a bus is not)
  // (on the side street, coming out of it from the right)
  const hn = headingAt(e.pts, e.cum, L - 1), qn = pointAt(e.pts, e.cum, L - 1);
  const car = new Vehicle(qn[0] + Math.sin(hn) * 11, qn[1] - Math.cos(hn) * 11, hn + Math.PI / 2, 0);
  const bus = Object.assign(new Vehicle(car.x, car.y, car.psi, 0), { kind: "bus" });
  assert.equal(SB.bankHidden(w, w.ego, car), true);
  assert.equal(SB.bankHidden(w, w.ego, bus), false);
  // (sensing: creep up to the corner)
  const snap = buildSnapshot(w);
  assert.equal(!!snap.snowbank?.corner, true);
  assert.equal(snap.snowbank.corner.limit_mps < 5, true);
  assert.equal(snap.limit <= snap.snowbank.corner.limit_mps + 1e-9, true);
});

await test("sensing, candidates and wording: wait short of the stretch while it is the oncoming car's turn", () => {
  const ctx = setupChallenge(MTL, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null;
  for (let k = 0; k < 30 * 60 && !snap; k++) { step(ctx); const s = buildSnapshot(w); if (s.snowbank?.narrowing?.wait && s.snowbank.narrowing.bumper_to_stop_m < 12) snap = s; }
  assert.equal(!!snap, true);
  const n = snap.snowbank.narrowing;
  assert.equal(n.priority, "oncoming"); assert.equal(n.reason, "inside"); assert.equal(n.oncoming.id, "challenge_oncoming");
  assert.equal(n.street, "Avenue Laval");
  assert.equal(n.detour.shift < 0, true);
  const cs = sampleCandidates(snap, w), { eligible, rejected } = simulateAll(cs, snap, w);
  assert.equal(eligible.some(c => c.id === "wait_for_oncoming_narrowing"), true);
  for (const c of eligible) assert.equal(c.law.detour?.id, `sb:${n.id}`);
  // (nothing that would take it past where it waits is on offer)
  assert.equal(rejected.enters_narrowing_out_of_turn > 0 || eligible.every(c => c.sim.progress_m < n.bumper_to_stop_m + 1), true);
  const state = toJevState(snap, cs, { rejected });
  assert.equal(state.snowbank.narrowing.turn, "oncoming");
  assert.equal(state.snowbank.narrowing.wait, true);
  assert.equal(state.snowbank.narrowing.oncoming.in_it, true);
  const clauses = situationClauses(snap).join(" ");
  assert.equal(clauses.includes("only one moving car at a time"), true);
  assert.equal(clauses.includes("wait_for_oncoming_narrowing"), true);
  const { questions } = buildQuestions(snap, eligible);
  if (questions.motion) assert.equal(JSON.stringify(questions.motion).includes("snowbank.narrowing.wait"), true);
  assert.equal(SYSTEM_PROMPT.includes("wait_for_oncoming_narrowing"), true);
});

for (const brain of ["rules", "cautious"]) await test(`"One car at a time", ${brain}: waits for the oncoming car, creeps up to the hidden corner, and arrives cleanly`, async () => {
  const ctx = setupChallenge(MTL, lesson, { brain }), { world: w, autopilot } = ctx, sb = w.snowbanks, nw = sb.narrowings[0];
  assert.equal(nw.edge, SITE.edge);
  let waited = false, both = 0, seenAt = null;
  const ped = w.crowd.list.find(p => p.id === "challenge_pedestrian");
  for (let k = 0; k < 120 * 60 && autopilot.enabled; k++) {
    step(ctx);
    if (autopilot.firing) await autopilot.firing;
    const claims = sb.claims(nw), on = claims.find(c => c.id === "challenge_oncoming");
    if (on?.inside && w.ego.v < 0.05 && claims.find(c => c.v === w.ego && !c.inside)) waited = true;
    if (claims.some(c => c.inside && c.dir > 0) && claims.some(c => c.inside && c.dir < 0)) both++;
    if (seenAt === null && w.challenge.triggered && w.sees(w.ego, ped)) seenAt = w.ego.v;
  }
  assert.equal(waited, true);
  assert.equal(both, 0);
  assert.equal(seenAt !== null && seenAt < 4.5, true, `${seenAt}`);
  const result = await evaluateChallenge(MTL, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.snowbank_conflicts, 0);
  assert.equal(result.collisions, 0);
  assert.equal(result.report.snowbank_conflicts, 0);
  console.log(`  (${brain}: arrived in ${Math.round(result.time_s ?? 0)} s)`);
});

await test(`"One car at a time": a driver who goes in while the oncoming car is in the stretch fails, with snowbank_conflicts`, () => {
  const ctx = setupChallenge(MTL, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const blind = { ...ctx, autopilot: idle }, metrics = new DriveMetrics(w.route.length);
  const events = [];
  for (let k = 0; k < 40 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { kind: "lane", offset: 0, vTarget: 3.5, s0: p.s }, w.route, p.s, 1 / 60, w);
    const road = step(blind);
    metrics.record(w, null, road, 1 / 60);
    events.push(...w.events.filter(e => e.type === "snowbank_conflict"));
    if (p.s > SITE.b) break;
  }
  assert.equal(w.snowbanksSeen, true);
  assert.equal(w.violations.snowbank_conflicts, 1, JSON.stringify(w.violations));
  assert.equal(events.length, 1);
  assert.equal(events[0].with, "challenge_oncoming"); assert.equal(events[0].reason, "oncoming_inside");
  const summary = metrics.summary(w, ctx.autopilot, true);
  assert.equal(summary.snowbank_conflicts, 1);
  assert.equal(failures(summary).includes("entered a stretch narrowed by snowbanks out of turn"), true);
});

await test("the drive score reports snowbank_conflicts once the car has come up to a narrowing", () => {
  const ctx = world(), w = ctx.world;
  const score = new DriveScore(w, {});
  score.record(w, w.roadInfo(), 1 / 60);
  assert.equal("snowbank_conflicts" in score.snapshot(), false);
  w.snowbanksSeen = true; score.record(w, w.roadInfo(), 1 / 60);
  assert.equal(score.snapshot().snowbank_conflicts, 0);
  w.events.push({ type: "snowbank_conflict", with: "x", reason: "out_of_turn" }); score.record(w, w.roadInfo(), 1 / 60);
  assert.equal(score.snapshot().snowbank_conflicts, 1);
});

await test("checkpoints: a restored drive replays the turn-taking exactly", () => {
  const ctx = setupChallenge(MTL, lesson, { brain: "rules" }), recorder = new DriveRecorder(), clock = {};
  for (let k = 0; k < 6 * 60; k++) step(ctx);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], npcs: ctx.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v, n.sbShift]), since: [...ctx.world.snowbanks.since], go: [...ctx.world.snowbanks.go], t: ctx.world.t });
  for (let k = 0; k < 900; k++) step(ctx);
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(ctx.world.snowbanks.world, ctx.world);
  for (let k = 0; k < 900; k++) step(ctx);
  assert.equal(sig(), first);
});

await test("with the option off nothing is built, drawn or reported, and the other streams draw the same", () => {
  const ctx = world({ snowbanks: false, traffic: 12, parked: 0.5 }), w = ctx.world;
  assert.equal(w.snowbanks.enabled, false);
  assert.equal(w.snowbanks.random, null);
  assert.equal(w.snowbanks.geo.runs.length + w.snowbanks.narrowings.length + w.snowbanks.piles.length, 0);
  for (let k = 0; k < 300; k++) step(ctx);
  assert.equal(w.snowbanksSeen, false);
  assert.equal("snowbank_conflicts" in w.violations, false);
  const snap = buildSnapshot(w);
  assert.equal("snowbank" in snap, false);
  const metrics = new DriveMetrics(1000);
  metrics.record(w, snap, w.roadInfo(), 1 / 60);
  assert.equal("snowbank_conflicts" in metrics.summary(w, { totals: {} }, false), false);
  // (no other challenge turns it on)
  assert.deepEqual(CHALLENGES.filter(c => c.snowbanks).map(c => c.id), ["one-car-at-a-time"]);
  // (on in dry weather, nothing is built, and the traffic and the parked cars are as with it off)
  const a = world({ snowbanks: false, traffic: 12, parked: 0.5, weather: "dry", seed: 9 }), b = world({ snowbanks: true, traffic: 12, parked: 0.5, weather: "dry", seed: 9, narrowing: null });
  for (let k = 0; k < 300; k++) { step(a); step(b); }
  assert.equal(JSON.stringify(a.fleet.vehicles.map(n => [n.x, n.y])), JSON.stringify(b.fleet.vehicles.map(n => [n.x, n.y])));
  assert.equal(JSON.stringify(a.world.parked.list.map(c => [c.x, c.y])), JSON.stringify(b.world.parked.list.map(c => [c.x, c.y])));
});

await test("creeping up to an end it cannot see past: held to the creep to the end, and one already in outranks a late claim it could still stop for", () => {
  // (a free drive in snow on Kent Street, Ottawa, found the car's own "too close to stop" claim, with a
  // metre to spare, lifting the creep 1.4 m short of the stretch and outranking a car already in it)
  const ctx = world(), w = ctx.world, sb = w.snowbanks, nw = sb.narrowings[0];
  const e = MTL.edges.get(SITE.edge), L = lengthOf(e), lane = MTL.lane(SITE.edge, 0);
  w.route = new Route(scenario.route, MTL, w.ego.spec);
  const at = (gap, v) => {
    w.placeOnLane(lane, (SITE.a - gap - FRONT) * lane.length / L); w.ego.v = v; w.tick++;
    return buildSnapshot(w);
  };
  // (nobody coming: the far end out of sight in the snow, the creep holds right up to the stretch)
  for (const [gap, v] of [[3, 1.4], [1.4, 1.66], [1.2, 1.2], [0.5, 1.2]]) {
    const n = at(gap, v).snowbank.narrowing;
    assert.equal(n.sees_through, false); assert.equal(n.wait, false);
    assert.equal(n.limit_mps <= SB.EDGE_MPS + 1e-9, true, `gap ${gap}: limit ${n.limit_mps}`);
  }
  assert.equal(at(8, 3).snowbank.narrowing.limit_mps < 2.5, true);
  // (one coming the other way already in it, seen only now, 1.1 m short at the creep: the car can still stop,
  // braking hard, so it waits, short of the stretch, and nothing on offer takes it in)
  addCar(ctx, nw.opposite, nw.L - nw.b + 40, 4.5, "late");
  const snap = at(1.1, SB.EDGE_MPS), n = snap.snowbank.narrowing;
  assert.equal(n.oncoming?.id, "late"); assert.equal(n.oncoming.inside, true);
  assert.equal(n.wait, true); assert.equal(n.priority, "oncoming"); assert.equal(n.reason, "inside");
  assert.equal(n.stop_s_route <= n.entry_s_route, true);
  assert.equal(n.bumper_to_stop_m > 0.3, true, `${n.bumper_to_stop_m}`);
  const { eligible } = simulateAll(sampleCandidates(snap, w), snap, w);
  assert.equal(eligible.length > 0, true);
  for (const c of eligible) assert.equal(c.sim.progress_m < 1.1, true, `${c.id} ${c.sim.progress_m}`);
  // (the shared test says the same: not committed, braking hard; traffic in its place would hold short too)
  const c = sb.claimFor(nw, w.ego);
  assert.equal(sb.committed(nw, c, true), false);
  assert.equal(SB.narrowingTurn(sb, nw, c).mayEnter, false);
  // (one that truly cannot stop, even braking hard, goes on)
  w.ego.v = 5;
  assert.equal(sb.committed(nw, sb.claimFor(nw, w.ego), true), true);
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/one_car_at_a_time.json`), from
// the challenge as the car comes up to where it waits for the oncoming car, generated by the production
// pipeline.
if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(MTL, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 40 * 60 && !snap; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const s = buildSnapshot(w);
    if (!s.snowbank?.narrowing?.wait || s.snowbank.narrowing.bumper_to_stop_m > 12) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "wait_for_oncoming_narrowing")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible);
  const state = toJevState(snap, candidates, { rejected });
  // (stopping short of the stretch, in the lane: waiting for the oncoming car, or any other candidate that ends stopped short of it)
  const stopping = eligible.filter(c => c.id === "wait_for_oncoming_narrowing" || (c.sim.end_speed < snap.ego.v - 0.5 && Math.abs(c.sim.lane_err_end) < 0.8 && c.sim.progress_m < snap.snowbank.narrowing.bumper_to_stop_m + 1)).map(c => c.id);
  fs.writeFileSync(new URL("../data/snapshots/one_car_at_a_time.json", import.meta.url), JSON.stringify({ name: "one_car_at_a_time", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: stopping } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/one_car_at_a_time.json (wait in ${snap.snowbank.narrowing.bumper_to_stop_m.toFixed(1)} m, ${eligible.length} eligible)`);
}
console.log(`${checks} snowbank checks passed`);
process.exit(0);
