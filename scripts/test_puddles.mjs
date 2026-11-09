// Puddles at the kerb (sim/puddles.js): placement from their own stream, in the gutter of the kerb lane
// only; when they lie (rain, and after it until snow); the splash speed and who is within reach (the one
// shared test); the driven car easing left inside its lane round one with people beside it, slowing
// below its splash speed where there is no room, and not slowing for one with nobody near (sensing,
// candidates, the forward sims' rejection, closed-loop Rules); traffic doing the same; a pothole full of
// rain water splashing like a puddle; the audit of a splash, its metrics, coaching and the drive's
// failure; what models and the HUD are told; checkpoints; the "Don't splash" challenge with Rules and
// the cautious agent; and with the option off, nothing placed, drawn, computed or reported.
// node --experimental-default-type=module scripts/test_puddles.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { sidewalkOffset, GUTTER, CURB } = await import("../static/js/map/streets.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { Pedestrian } = await import("../static/js/sim/pedestrians.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const PD = await import("../static/js/sim/puddles.js");
const PH = await import("../static/js/sim/potholes.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes, browserRoute } = await import("../static/js/demo/routing.js");
const { getVehicleModel } = await import("../static/js/sim/vehicle-models.js");
const { rng } = await import("../static/js/common.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -7;
  return new MapData(pack);
};
const MP = load("7165f1c807a8");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const lesson = CHALLENGES.find(c => c.id === "dont-splash");
const COMPACT = getVehicleModel("compact").spec;
// Main Street northbound, two blocks (e708, e666), three lanes each way, 50 km/h, no parking lane: the
// kerb lane is lane 2, and the sidewalk is right at the kerb.
const CHAIN = ["e708", "e666"], KERB = 2, lanes = CHAIN.map((id) => MP.lane(id, KERB));
// A puddle there with room to ease round it in the lane, one too wide for that, and a shallow one.
const ROOM = { width: 1.3, a: 2.5, depth: 0.03 }, WIDE = { width: 2.0, a: 2.4, depth: 0.05 }, SHALLOW = { width: 1.4, a: 3.5, depth: 0.012 };
const sideAt = (edge, s, out) => { const e = MP.edges.get(edge), p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s); return [p[0] + Math.sin(h) * out, p[1] - Math.cos(h) * out]; };
// Someone standing `out` metres from the kerb face, `s` along `edge` (on its right).
function person(world, edge, s, out = 0.8, id = `p_${s}`) {
  const e = MP.edges.get(edge), [x, y] = sideAt(edge, s, e.asphalt[1] + GUTTER + CURB + out);
  const p = new Pedestrian({ id, x, y, psi: 0, v: 0, speed: 1.2, path: [], crossing: null, waiting: 0, phase: 0, look: 7, held: true });
  world.crowd.list.push(p);
  return p;
}
// A world on Main Street with puddles on (or off), the car `s` metres along the first block in the kerb
// lane at `v` m/s, a route to near the end of the second, and the puddles given ({ edge, s, ...shape })
// in place of the world's own.
function street({ puddles = true, weather = "rain", s = 5, v = 0, list = [], brain = null, seed = 3, potholes = false } = {}) {
  setWeather(weather);
  const world = new World(MP, { seed, parked: 0, pedestrians: 0, weather, vehicleSpec: COMPACT, puddles, potholes });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  world.placeOnLane(lanes[0], s); world.ego.v = v;
  world.route = new Route(routeFromLanes(MP, lanes, s, 92), MP, world.ego.spec);
  if (puddles) world.puddles.setList(list.map((q, i) => PD.puddleOnLane(MP, q.edge || "e708", KERB, q.s, { id: `t${i + 1}`, ...q, shape: 7 + i })));
  if (potholes) world.potholes.setList([]);
  let autopilot = idle;
  if (brain) { autopilot = new Autopilot(world, {}); autopilot.setBrain(brain); autopilot.setEnabled(true); }
  return { world, fleet, autopilot };
}
const lateralOf = (w) => w.route.project(w.ego.x, w.ego.y, w.route.hint).lateral;
async function drive(ctx, seconds, each = () => {}, until = () => false) {
  for (let k = 0; k < seconds * 60; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    each();
    if (until()) return true;
  }
  return false;
}
// The speed a vehicle's tyres first go into puddle `h` at, or null if they never do.
const entry = (v, h) => (PH.wheelPoints(v).some(([x, y]) => PH.inPothole(h, x, y)) ? v.v : null);

await test("placement: from its own stream, in the gutter of kerb lanes only, more on main streets", () => {
  setWeather("rain");
  const a = new World(MP, { seed: 3, parked: 0, pedestrians: 0, weather: "rain", puddles: true }), b = new World(MP, { seed: 3, parked: 0, pedestrians: 0, weather: "rain", puddles: true });
  const c = new World(MP, { seed: 4, parked: 0, pedestrians: 0, weather: "rain", puddles: true });
  assert.equal(a.puddles.enabled, true);
  assert.equal(a.puddles.list.length > 100, true, `${a.puddles.list.length}`);
  assert.equal(JSON.stringify(a.puddles.list), JSON.stringify(b.puddles.list));
  assert.notEqual(JSON.stringify(a.puddles.list.map(h => h.s)), JSON.stringify(c.puddles.list.map(h => h.s)));
  for (const h of a.puddles.list) {
    const lane = MP.lane(h.edge, h.lane), e = lane.edgeRef;
    assert.equal(h.lane, e.lanes - 1, h.id);
    // (its kerb-side edge against the kerb)
    assert.equal(Math.abs(h.offset + h.b - (e.asphalt[1] - lane.offset + GUTTER)) < 1e-9, true, h.id);
    assert.equal(h.s - h.a >= 0.9 && h.s + h.a <= lane.length - 0.9, true, h.id);
  }
  for (const list of a.puddles.byLane.values()) for (let i = 1; i < list.length; i++) assert.equal(list[i].s - list[i].a >= list[i - 1].s + list[i - 1].a + 2 - 1e-6, true);
  const per = (set) => {
    let km = 0, n = 0;
    for (const e of MP.edges.values()) if (set.includes(e.cls)) { km += e.length / 1000; n += a.puddles.list.filter(h => h.edge === e.id).length; }
    return n / km;
  };
  const main = per(["secondary", "tertiary", "primary"]), quiet = per(["residential"]);
  assert.equal(main > quiet, true, `main ${main.toFixed(1)}/km, quiet ${quiet.toFixed(1)}/km`);
  const h = a.puddles.list[11];
  assert.equal(a.puddles.near(h.x, h.y, 2).some(x => x.id === h.id), true);
  console.log(`  (${a.puddles.list.length} puddles in Mount Pleasant: ${main.toFixed(1)} per km of main street's kerb, ${quiet.toFixed(1)} on quiet ones)`);
});

await test("when they lie: in the rain, and on after it until it snows; never with the option off", () => {
  const w = street({ weather: "dry" }).world;
  assert.equal(PD.puddlesLie(w), false);
  w.weather = setWeather("rain").name; step({ world: w, fleet: new NpcFleet(w, { count: 0, bikes: 0 }), autopilot: idle });
  assert.equal(w.puddlesRained, true); assert.equal(PD.puddlesLie(w), true);
  w.weather = setWeather("dry").name;
  assert.equal(PD.puddlesLie(w), true, "still there once the rain has stopped");
  w.weather = setWeather("snow").name;
  assert.equal(PD.puddlesLie(w), false);
  assert.equal(PD.puddlesLie(street({ puddles: false }).world), false);
});

await test("the splash speed, from the depth: about 25 km/h for a shallow one, less for a deep one", () => {
  const kmh = (depth) => PD.splashSpeed({ depth }) * 3.6;
  assert.equal(Math.round(kmh(0.02)), 25);
  assert.equal(kmh(0.05) < 17 && kmh(0.05) > 14, true);
  assert.equal(kmh(0.01) > kmh(0.02) && kmh(0.02) > kmh(0.04) && kmh(0.04) > kmh(0.1), true);
  assert.equal(kmh(0.001) <= 32 + 1e-9 && kmh(0.5) >= 12 - 1e-9, true);
});

await test("who is within reach (splashRisk): at the kerb or on the sidewalk beside it, not across a boulevard, nor far along", () => {
  const ctx = street({ list: [{ s: 40, ...ROOM }] }), w = ctx.world, h = w.puddles.list[0];
  assert.equal(PD.splashRisk(w, h).length, 0, "just water");
  const kerb = person(w, "e708", 41, 0.7, "kerb"), walk = person(w, "e708", 38, sidewalkOffset(MP.edges.get("e708"), 1) - MP.edges.get("e708").asphalt[1] - GUTTER - CURB, "walk");
  person(w, "e708", 60, 0.7, "far");
  assert.deepEqual(PD.splashRisk(w, h).map(p => p.id).sort(), ["kerb", "walk"]);
  // (someone a little along, who could walk into reach before the car gets there: counted while planning)
  const coming = person(w, "e708", 49, 0.7, "coming");
  assert.equal(PD.splashRisk(w, h).some(p => p === coming), false);
  assert.equal(PD.splashRisk(w, h, 3).some(p => p === coming), true);
  assert.equal(PD.splashRisk(w, h, 3, (p) => p !== coming).some(p => p === coming), false, "only those the driver sees");
  void kerb; void walk;
  // (on a residential street, the boulevard keeps the sidewalk out of reach)
  const res = MP.edges.get("e81"), rl = MP.lane("e81", 0), q = PD.puddleOnLane(MP, "e81", 0, 60, { id: "r", width: 1, a: 2, depth: 0.03 });
  const p = rl.pts && (() => { const pt = pointAt(res.pts, res.cum, 60), hd = headingAt(res.pts, res.cum, 60), o = sidewalkOffset(res, 1); return new Pedestrian({ id: "res", x: pt[0] + Math.sin(hd) * o, y: pt[1] - Math.cos(hd) * o, psi: 0, v: 0, speed: 1, path: [], crossing: null, waiting: 0, phase: 0, look: 1, held: true }); })();
  w.crowd.list.push(p);
  assert.equal(PD.splashRisk(w, q).some(x => x.id === "res"), false);
});

await test("sensing and candidates: room means `ease_round_puddle`; keeping the middle slows for it; too fast through it is rejected", () => {
  const ctx = street({ s: 10, v: 11, list: [{ s: 46, ...ROOM }] }), w = ctx.world;
  // (nobody near: just water, nothing sensed, nobody slows)
  let snap = buildSnapshot(w);
  assert.equal(snap.puddle_splash, null);
  assert.equal(snap.limit, 13.9);
  person(w, "e708", 45, 0.8);
  snap = buildSnapshot(w);
  assert.equal(snap.puddle_splash.id, "t1");
  assert.equal(snap.puddle_splash.people, 1);
  assert.equal(snap.puddle_splash.room, true);
  assert.equal(snap.puddle_splash.shift_m < -0.1 && snap.puddle_splash.shift_m > -0.5, true, `${snap.puddle_splash.shift_m}`);
  assert.equal(snap.limit, 13.9, "room: no slowing");
  const cands = sampleCandidates(snap, w), { eligible } = simulateAll(cands, snap, w);
  const ease = cands.find(c => c.id === "ease_round_puddle");
  assert.equal(!!ease && ease.eligible, true);
  assert.equal(ease.law.slowTo, undefined);
  assert.equal(cands.find(c => c.id === "keep_lane_target").law.slowTo?.length, 1);
  assert.equal(new RulesBrain().decideSync(snap, eligible).candidateId, "ease_round_puddle");
  assert.equal(new CautiousAgent().decideSync(snap, eligible).candidateId, "ease_round_puddle");
  // (closer, a manoeuvre that kept to the middle at speed would splash: rejected)
  const near = street({ s: 30, v: 11, list: [{ s: 46, ...ROOM }] }), wn = near.world;
  person(wn, "e708", 45, 0.8);
  const fast = { id: "blind", law: { kind: "lane", offset: 0, center: 0, vTarget: 11 } }, sn = buildSnapshot(wn), cn = sampleCandidates(sn, wn);
  const rn = simulateAll([...cn, fast], sn, wn);
  assert.equal(rn.eligible.some(c => c.law.kind !== "hard_brake"), true);
  assert.equal(fast.reject, "splashes_pedestrian");
  // (a wide one: no room, the limit comes down, and everything that keeps going slows for it)
  const wide = street({ s: 10, v: 11, list: [{ s: 50, ...WIDE }] }), ww = wide.world;
  person(ww, "e708", 50, 1.5);
  const sw = buildSnapshot(ww);
  assert.equal(sw.puddle_splash.room, false);
  assert.equal(sw.limit < 13.9, true);
  const cw = sampleCandidates(sw, ww);
  assert.equal(cw.some(c => c.id === "ease_round_puddle"), false);
  assert.equal(cw.filter(c => c.law.kind === "lane" && c.law.vTarget > 0.1 && c.law.stopAtRoute === undefined).every(c => c.law.slowTo?.length >= 1), true);
  // (no manoeuvre can help it, someone stepped up too late: braking hard is not forced on the car)
  const late = street({ s: 38, v: 11, list: [{ s: 50, ...WIDE }] }), wl = late.world;
  person(wl, "e708", 50, 1.5);
  const sl = buildSnapshot(wl), cl = sampleCandidates(sl, wl), rl = simulateAll(cl, sl, wl);
  assert.equal(rl.eligible.some(c => c.law.kind !== "hard_brake"), true);
});

await test("closed loop, Rules: round the one at the bus stop, below the splash speed through the wide one, no slowing for one with nobody near", async () => {
  const ctx = street({ s: 5, v: 11, brain: "rules", list: [{ s: 46, ...ROOM }, { edge: "e666", s: 40, ...WIDE }, { edge: "e666", s: 76, ...SHALLOW }] }), w = ctx.world;
  person(w, "e708", 44, 0.8, "a"); person(w, "e708", 48, 1.0, "b"); person(w, "e666", 41, 1.2, "c");
  const [p1, p2, p3] = w.puddles.list, into = [null, null, null];
  let lat1 = null, sawEmpty = false;
  await drive(ctx, 40, () => {
    [p1, p2, p3].forEach((h, i) => { into[i] ??= entry(w.ego, h); });
    if (ctx.autopilot.snap?.puddles_ahead?.some(a => a.id === p3.id)) sawEmpty = true;
    const ahead = (p1.x - w.ego.x) * Math.cos(w.ego.psi) + (p1.y - w.ego.y) * Math.sin(w.ego.psi);
    if (lat1 === null && ahead < w.ego.spec.wheelbase) lat1 = lateralOf(w);
  }, () => !ctx.autopilot.enabled);
  assert.equal(into[0], null, "round the first");
  assert.equal(lat1 < -0.15, true, `eased left: ${lat1}`);
  assert.equal(into[1] !== null && into[1] < PD.splashSpeed(p2), true, `through the wide one at ${into[1]}`);
  assert.equal(into[2] !== null && !sawEmpty, true, "the one with nobody near is just water");
  assert.equal(w.violations.pedestrians_splashed || 0, 0);
  assert.equal(w.puddlesSeen, true);
  console.log(`  (left ${lat1.toFixed(2)} m at the bus stop; ${(into[1] * 3.6).toFixed(1)} km/h through the wide one)`);
});

await test("a pothole full of rain water splashes like a puddle; the pothole's own handling is unchanged", () => {
  const ctx = street({ s: 10, v: 11, potholes: true }), w = ctx.world;
  const hole = PH.potholeOnLane(MP, "e708", KERB, 50, { id: "ph", offset: 0.1, a: 0.85, b: 0.8, depth: 0.1 });
  w.potholes.setList([hole]);
  person(w, "e708", 50, 0.6);
  const snap = buildSnapshot(w);
  assert.equal(snap.pothole.id, "ph");
  assert.equal(snap.puddle_splash?.id, "ph");
  assert.equal(snap.puddle_splash.kind, "pothole");
  assert.equal(snap.puddle_splash.detour, null, "the pothole's own way round, if any");
  w.weather = setWeather("dry").name; w.puddlesRained = false;
  assert.equal(buildSnapshot(w).puddle_splash, null, "dry: a pothole, not a puddle");
  assert.equal(buildSnapshot(w).pothole.id, "ph");
  setWeather("rain");
});

// A traffic car on Main Street's kerb lane, `s` along e708, at `v`.
function trafficCar(world, fleet, s, v) {
  const p = pointAt(lanes[0].pts, lanes[0].cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(lanes[0].pts, lanes[0].cum, s), v, COMPACT);
  Object.assign(car, { id: "npc_t", color: 0x888888, v0: 13.9, driver: { aMax: 1.3, b: 2, s0: 2.5, T: 1.6, react: 0.6, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(world.map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start("e708", KERB, s, [["e666", KERB]]);
  fleet.vehicles.push(car);
  return car;
}
await test("traffic: eases left round one with room, slows below the splash speed through one without, keeps on through one with nobody near", () => {
  const run = (shape, who) => {
    const ctx = street({ list: [{ s: 60, ...shape }] }), w = ctx.world;
    w.placeOnLane(MP.lane("e709", 0), 5);
    if (who) person(w, "e708", 60, 1.0);
    const n = trafficCar(w, ctx.fleet, 5, 12), h = w.puddles.list[0];
    let into = null, shift = 0;
    for (let k = 0; k < 12 * 60; k++) { step(ctx); into ??= entry(n, h); shift = Math.min(shift, n.pdShift || 0); }
    return { into, shift };
  };
  const room = run(ROOM, true), wide = run(WIDE, true), empty = run(WIDE, false);
  assert.equal(room.into, null, "round it"); assert.equal(room.shift < -0.15, true);
  assert.equal(wide.into !== null && wide.into < PD.splashSpeed({ depth: WIDE.depth }), true, `${wide.into}`);
  assert.equal(empty.into !== null && empty.into > 10, true, `${empty.into}`);
  console.log(`  (traffic: ${room.shift.toFixed(2)} m left round it; ${(wide.into * 3.6).toFixed(1)} km/h through the wide one; ${(empty.into * 3.6).toFixed(1)} km/h with nobody near)`);
  // (a soak in Kitsilano found a car easing right round a pothole in its right wheel path, which put
  // its right wheels into a puddle by the kerb just past it, someone beside it, too fast: it now slows
  // for where the pothole is taking it)
  const ctx = street({ potholes: true, list: [{ s: 54, width: 1.0, a: 2, depth: 0.03 }] }), w = ctx.world;
  w.potholes.setList([PH.potholeOnLane(MP, "e708", KERB, 50, { id: "ph", offset: 0.75, a: 0.35, b: 0.3, depth: 0.06 })]);
  w.placeOnLane(MP.lane("e709", 0), 5);
  person(w, "e708", 55, 0.8);
  const n = trafficCar(w, ctx.fleet, 5, 12), h = w.puddles.list[0];
  let into = null, ph = 0;
  for (let k = 0; k < 12 * 60; k++) { step(ctx); into ??= entry(n, h); ph = Math.max(ph, n.phShift || 0); }
  assert.equal(ph > 0.3, true, `round the pothole on the right: ${ph}`);
  assert.equal(into === null || into < PD.splashSpeed(h) + PD.SPLASH_OVER_MPS, true, `${into}`);
});

await test("the audit: a splash counts each person once, reaches the metrics and fails the drive; silent through one with nobody near", () => {
  const blind = (who) => {
    const ctx = street({ s: 5, v: 11, list: [{ s: 50, ...WIDE }] }), w = ctx.world, metrics = new DriveMetrics(w.route.length), score = new DriveScore(w, {});
    if (who) { person(w, "e708", 49, 0.6, "x"); person(w, "e708", 52, 1.4, "y"); }
    for (let k = 0; k < 8 * 60; k++) {
      const p = w.route.project(w.ego.x, w.ego.y);
      applyLaw(w.ego, { kind: "lane", offset: 0, vTarget: 11, s0: p.s }, w.route, p.s, 1 / 60, w);
      const road = step(ctx); metrics.record(w, null, road, 1 / 60); score.record(w, road, 1 / 60);
    }
    return { w, summary: metrics.summary(w, { totals: {} }, true), report: score.snapshot() };
  };
  const bad = blind(true);
  assert.equal(bad.w.violations.pedestrians_splashed, 2);
  assert.equal(bad.summary.pedestrians_splashed, 2);
  assert.equal(failures(bad.summary).includes("splashed a pedestrian from a puddle"), true);
  assert.equal(bad.report.pedestrians_splashed, 2);
  assert.deepEqual(bad.report.incidents.filter(i => i.type === "pedestrian_splashed").map(i => i.person).sort(), ["x", "y"]);
  assert.equal(bad.report.tips.some(t => t.includes("puddles by the kerb")), true);
  const empty = blind(false);
  assert.equal(empty.w.puddlesSeen, false);
  assert.equal("pedestrians_splashed" in empty.summary, false);
  assert.equal("pedestrians_splashed" in empty.report, false);
});

await test("what models and the HUD are told", () => {
  const ctx = street({ s: 10, v: 11, list: [{ s: 46, ...ROOM }] }), w = ctx.world;
  person(w, "e708", 45, 0.8);
  const snap = buildSnapshot(w), cands = sampleCandidates(snap, w), { eligible, rejected } = simulateAll(cands, snap, w);
  const state = toJevState(snap, cands, { rejected });
  assert.equal(state.puddle.id, "t1"); assert.equal(state.puddle.room_in_lane, true); assert.equal(state.puddle.people_within_splash_reach, 1);
  assert.equal(situationClauses(snap).some(c => c.includes("`ease_round_puddle`") && c.includes("careless driving")), true);
  assert.equal(SYSTEM_PROMPT.includes("`ease_round_puddle`"), true);
  void eligible;
  const wide = street({ s: 30, v: 11, list: [{ s: 50, ...WIDE }] }), ww = wide.world;
  person(ww, "e708", 50, 1.5);
  const sw = buildSnapshot(ww);
  assert.equal(PD.puddleNotice(ww, sw).text, "PUDDLE BY THE KERB · PEOPLE ON THE SIDEWALK · SLOW");
  assert.equal(toJevState(sw, sampleCandidates(sw, ww), {}).puddle.room_in_lane, false);
});

await test("off: nothing placed, drawn, computed or reported, and the world steps exactly as without the option", async () => {
  const ctx = street({ puddles: false, s: 5, v: 11, brain: "rules" }), w = ctx.world;
  person(w, "e708", 45, 0.8);
  assert.equal(w.puddles.enabled, false); assert.equal(w.puddles.list.length, 0);
  await drive(ctx, 6);
  assert.equal(w.puddlesSeen, false); assert.equal(w.puddleWarn, null);
  assert.equal("pedestrians_splashed" in w.violations, false);
  const snap = buildSnapshot(w);
  assert.equal("puddle_splash" in snap, false); assert.equal("puddles_ahead" in snap, false);
  assert.equal(sampleCandidates(snap, w).some(c => c.id === "ease_round_puddle"), false);
  const metrics = new DriveMetrics(w.route.length); metrics.record(w, snap, w.roadInfo(), 1 / 60);
  assert.equal("pedestrians_splashed" in metrics.summary(w, { totals: {} }, false), false);
  assert.equal(toJevState(snap, [], {}).puddle, undefined);
  assert.deepEqual(CHALLENGES.filter(c => c.puddles).map(c => c.id), ["dont-splash"]);
  // (a free drive's traffic steps exactly as in a world whose puddles object predates the option; and,
  // with the option on, in the rain, where nobody is near the water, exactly as with it off: the puddles
  // draw from no stream anything else draws from)
  const mk = (puddles, fake = false) => { setWeather("rain"); const world = new World(MP, { seed: 9, pedestrians: 0, weather: "rain", puddles }); if (fake) world.puddles = { enabled: false, list: [] }; const fleet = new NpcFleet(world, { count: 14, bikes: 2, seed: 15 }); return { world, fleet, autopilot: idle }; };
  const a = mk(false), b = mk(false, true), c = mk(true);
  for (let k = 0; k < 600; k++) { step(a); step(b); step(c); }
  const sig = (x) => JSON.stringify(x.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v]));
  assert.equal(sig(a), sig(b)); assert.equal(sig(a), sig(c));
  assert.equal(a.fleet.vehicles.some(n => "pdShift" in n), false);
  assert.equal(c.world.puddles.list.length > 0, true);
});

await test("checkpoints: a restored drive replays exactly", async () => {
  setWeather(lesson.weather);
  const ctx = setupChallenge(MP, lesson, { brain: "rules" }), recorder = new DriveRecorder(), clock = {};
  await drive(ctx, 3);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], t: ctx.world.t, splashed: ctx.world.violations.pedestrians_splashed ?? 0, seen: ctx.world.puddlesSeen, rained: ctx.world.puddlesRained });
  await drive(ctx, 8);
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(ctx.world.puddles.list.length, 3);
  await drive(ctx, 8);
  assert.equal(sig(), first);
});

for (const brain of ["rules", "cautious"]) await test(`"Don't splash", ${brain}: round the bus stop's, slow through the wide one, arrives without splashing anyone`, async () => {
  setWeather(lesson.weather);
  const ctx = setupChallenge(MP, lesson, { brain }), w = ctx.world;
  assert.equal(w.puddles.enabled, true); assert.equal(w.weather, "rain");
  const [p1, p2] = w.puddles.list, into = [null, null];
  await drive(ctx, 60, () => { into[0] ??= entry(w.ego, p1); into[1] ??= entry(w.ego, p2); }, () => !ctx.autopilot.enabled);
  assert.equal(into[0], null);
  assert.equal(into[1] !== null && into[1] < PD.splashSpeed(p2), true, `${into[1]}`);
  setWeather(lesson.weather);
  const result = await evaluateChallenge(MP, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.pedestrians_splashed, 0);
  assert.equal(result.report.pedestrians_splashed, 0);
  console.log(`  (${brain}: through the wide one at ${(into[1] * 3.6).toFixed(1)} km/h)`);
});

await test(`"Don't splash": a driver who keeps going splashes the people at the bus stop and on the sidewalk, and fails`, () => {
  setWeather(lesson.weather);
  const ctx = setupChallenge(MP, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const blind = { ...ctx, autopilot: idle }, metrics = new DriveMetrics(w.route.length);
  for (let k = 0; k < 20 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { kind: "lane", offset: 0, vTarget: 11, s0: p.s }, w.route, p.s, 1 / 60, w);
    metrics.record(w, null, step(blind), 1 / 60);
  }
  assert.equal(w.violations.pedestrians_splashed >= 3, true, JSON.stringify(w.violations));
  assert.equal(failures(metrics.summary(w, ctx.autopilot, true)).includes("splashed a pedestrian from a puddle"), true);
  console.log(`  (the driver who kept going: ${w.violations.pedestrians_splashed} splashed)`);
});

await test("free drives in the rain: Rules and the cautious agent never splash anyone", async () => {
  const MAIN = new Set(["primary", "secondary", "tertiary"]), starts = MP.laneList.filter(l => MAIN.has(l.edgeRef.cls) && l.idx === l.edgeRef.lanes - 1 && l.length > 60);
  let seen = 0;
  for (const [seed, brain] of [[1, "rules"], [2, "cautious"]]) {
    setWeather("rain");
    const random = rng(seed * 977 + 13), world = new World(MP, { seed, weather: "rain", pedestrians: 200, puddles: true, potholes: true });
    let route = null;
    for (let tries = 0; tries < 50 && !route; tries++) {
      const l = starts[Math.floor(random() * starts.length)], q = starts[Math.floor(random() * starts.length)], p = pointAt(l.pts, l.cum, 5), d = pointAt(q.pts, q.cum, q.length * 0.6);
      if (Math.hypot(d[0] - p[0], d[1] - p[1]) > 400) route = browserRoute(MP, { x: p[0], y: p[1] }, { x: d[0], y: d[1] });
    }
    world.placeOnLane(MP.lane(route.edges[0], route.lanes[0]), route.start_s);
    const fleet = new NpcFleet(world, { count: 10, seed: seed + 6 }), autopilot = new Autopilot(world, {}); autopilot.setBrain(brain);
    world.route = new Route(route, MP, world.ego.spec); world.destination = route.polyline.at(-1); autopilot.setEnabled(true);
    await drive({ world, fleet, autopilot }, 40, () => {}, () => !autopilot.enabled);
    assert.equal(world.violations.pedestrians_splashed || 0, 0, `${brain} seed ${seed}`);
    assert.equal(world.violations.collisions_at_fault || 0, 0);
    if (world.puddlesSeen) seen++;
  }
  console.log(`  (2 drives of 40 s, ${seen} came up to a puddle with someone near)`);
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/dont_splash.json`), from the
// challenge as the car comes up to the puddle at the bus stop, with room to ease round it in the lane.
if (process.argv.includes("--write-snapshot")) {
  setWeather(lesson.weather);
  const ctx = setupChallenge(MP, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 20 * 60 && !snap; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const s = buildSnapshot(w);
    if (!s.puddle_splash?.room || s.puddle_splash.starts_in_m > 30) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "ease_round_puddle")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible), state = toJevState(snap, candidates, { rejected });
  const round = eligible.filter(c => c.id === "ease_round_puddle").map(c => c.id);
  fs.writeFileSync(new URL("../data/snapshots/dont_splash.json", import.meta.url), JSON.stringify({ name: "dont_splash", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: round } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/dont_splash.json (puddle in ${snap.puddle_splash.starts_in_m.toFixed(1)} m, ${eligible.length} eligible)`);
}

console.log(`${checks} puddle checks passed`);
process.exit(0);
