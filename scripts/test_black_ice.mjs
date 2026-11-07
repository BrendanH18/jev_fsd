// Black ice: when conditions favour it (iceConditions); placement from its own stream, on the bridges
// layer's bridges and in the shade of tall buildings; the grip hook in the shared car model (the driven
// car, traffic, cyclists and the forward sims all feel it, rail vehicles do not, and with no ice it is
// never called); the car seeing a patch late (by day close up, at night in its headlights), slowing
// before it and crossing it steadily (sensing, candidates, the forward sims' rejections, closed-loop
// Rules); traffic doing the same; the audit of a crossing too fast or hard on the brakes, its metrics,
// coaching and failure; what models and the HUD are told; checkpoints; the "Bridges freeze first"
// challenge with Rules and the cautious agent; and with the option off, nothing placed, drawn, computed
// or reported, and every vehicle stepping exactly as before.
// node --experimental-default-type=module scripts/test_black_ice.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE, STREETCAR, ROAD, G } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const { rng } = await import("../static/js/common.js");
const ICE = await import("../static/js/sim/black-ice.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { getVehicleModel } = await import("../static/js/sim/vehicle-models.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key, utc = -6) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = utc;
  return new MapData(pack);
};
const SK = load("ca5573a8d934");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const lesson = CHALLENGES.find(c => c.id === "bridges-freeze-first");
const COMPACT = getVehicleModel("compact").spec;
// The Traffic Bridge's deck northbound (226 m, one lane each way, 50 km/h), and 3rd Avenue South past it.
const DECK = "e572", lane = SK.lane(DECK, 0), NEXT = "e475";
const MORNING = { hour: 6.5, sun_deg: -4, day: 340 };

// A world on the deck with ice on (or off), at dawn, the car `s` metres along it at `v` m/s, a route to
// past its end, and one patch from `from` to `to` (metres along the deck) in place of the world's own.
function deck({ ice = true, weather = "dry", s = 40, v = 0, from = 140, to = 200, mu = 0.11, brain = null, night = 0, clock = MORNING } = {}) {
  setWeather(weather);
  const world = new World(SK, { seed: 3, parked: 0, pedestrians: 0, weather, vehicleSpec: COMPACT, ice });
  world.setClock(clock); world.visibility.setNight(night);
  if (ice) world.ice.refresh(world);
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  world.placeOnLane(lane, s); world.ego.v = v;
  world.route = new Route(routeFromLanes(SK, [lane, SK.lane(NEXT, 0)], s, 20), SK, world.ego.spec);
  if (ice && from !== null) world.ice.setList([ICE.patchOn(SK, DECK, from, to, { id: "p1", kind: "bridge", name: "Traffic Bridge", mu, shape: 7 })]);
  let autopilot = idle;
  if (brain) { autopilot = new Autopilot(world, {}); autopilot.setBrain(brain); autopilot.setEnabled(true); }
  return { world, fleet, autopilot };
}
async function drive(ctx, seconds, each = () => {}, until = () => false) {
  for (let k = 0; k < seconds * 60; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    each();
    if (until()) return true;
  }
  return false;
}
// Whether either axle of `v` is on a patch.
const onIce = (world, v) => !!(world.ice.at(v.x + Math.cos(v.psi) * v.spec.wheelbase, v.y + Math.sin(v.psi) * v.spec.wheelbase) || world.ice.at(v.x, v.y));
// A traffic car on the deck, `s` along it, at `v`.
function trafficCar(world, fleet, s, v, spec = CAR, id = "npc") {
  const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, spec);
  Object.assign(car, { id, kind: spec === BIKE ? "bike" : "car", color: 0x777777, v0: spec === BIKE ? 5 : 13.9, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.8, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(SK, rng(9), { bike: spec === BIKE }), frozen: 0, waiting: 0 });
  car.path.start(DECK, 0, s, [[NEXT, 0]]);
  fleet.vehicles.push(car); world.npcs = fleet.vehicles;
  return car;
}

await test("conditions: snow at any hour, freezing fog, rain and frost by night and early morning in the cold season, only snow without a winter date", () => {
  const at = (w, hour, day = 340) => ICE.iceConditions(w, hour === null ? null : { hour, day })?.kind ?? null;
  // (free drives' clock has no day, and keeps the sky's late-September sun: only snow; nor in September)
  assert.equal(ICE.iceConditions("dry", { hour: 6.5 }), null); assert.equal(ICE.iceConditions("rain", { hour: 5 }), null);
  assert.equal(at("dry", 6.5, 265), null); assert.equal(at("fog", 7, 200), null); assert.equal(at("snow", 14, 200), "snow");
  assert.equal(at("dry", 6.5, 20), "frost"); assert.equal(at("dry", 6.5, 305), "frost"); assert.equal(at("dry", 6.5, 91), null);
  assert.equal(at("snow", 14), "snow"); assert.equal(at("snow", null), "snow");
  assert.equal(at("dry", 6.5), "frost"); assert.equal(at("dry", 23), "frost"); assert.equal(at("dry", 15.5), null); assert.equal(at("dry", null), null);
  assert.equal(at("fog", 7), "freezing_fog"); assert.equal(at("fog", 13), null);
  assert.equal(at("rain", 5), "freezing_rain"); assert.equal(at("rain", 12), null);
  // (the safe speed: about 29 km/h on a glaze of 0.12, a little less on a slipperier one)
  assert.equal(Math.round(ICE.safeSpeed({ mu: 0.12 }) * 3.6), 29);
  assert.equal(ICE.safeSpeed({ mu: 0.10 }) < ICE.safeSpeed({ mu: 0.15 }), true);
});

await test("placement: from its own stream, on the bridges and in the shade of tall buildings, lying on the road only while conditions favour ice", () => {
  setWeather("dry");
  const mk = (seed, hour = 6.5) => { const w = new World(SK, { seed, parked: 0, pedestrians: 0, ice: true }); w.setClock({ hour, sun_deg: 0, day: 340 }); w.ice.refresh(w); return w; };
  const a = mk(3), b = mk(3), c = mk(4);
  assert.equal(a.ice.enabled, true);
  assert.equal(JSON.stringify(a.ice.all.map(p => [p.edge, p.from, p.to, p.mu])), JSON.stringify(b.ice.all.map(p => [p.edge, p.from, p.to, p.mu])));
  assert.notEqual(JSON.stringify(a.ice.all.map(p => p.from)), JSON.stringify(c.ice.all.map(p => p.from)));
  const bridges = new Set(SK.bridges.map(sp => sp.edge));
  const kinds = { bridge: 0, shade: 0 };
  for (const p of a.ice.all) {
    kinds[p.kind]++;
    assert.equal(p.mu >= ICE.MU_MIN && p.mu <= ICE.MU_MAX, true, p.id);
    if (p.kind === "bridge") assert.equal(bridges.has(p.edge) || SK.bridges.some(sp => SK.edges.get(sp.edge).from === SK.edges.get(p.edge).to && SK.edges.get(sp.edge).to === SK.edges.get(p.edge).from), true, p.id);
    else assert.equal(bridges.has(p.edge), false, p.id);
    const e = SK.edges.get(p.edge);
    assert.equal(p.from >= 0 && p.to <= e.length + 1e-6 && p.to > p.from, true, p.id);
  }
  assert.equal(kinds.bridge >= 1, true, JSON.stringify(kinds));
  assert.equal(kinds.shade >= 1, true, JSON.stringify(kinds));
  // (on the road at dawn; none in the afternoon, and none again when the weather turns to snow)
  assert.equal(a.ice.list.length, a.ice.all.length);
  const pm = mk(3, 15.5);
  assert.equal(pm.ice.list.length, 0);
  assert.equal(pm.ice.conditions, null);
  pm.weather = setWeather("snow").name; pm.ice.refresh(pm);
  assert.equal(pm.ice.list.length, pm.ice.all.length);
  setWeather("dry");
  // (a point on a patch is on it, one beside the road is not)
  const p = a.ice.all.find(x => x.kind === "bridge"), q = pointAt(p.pts, p.cum, p.len / 2);
  assert.equal(a.ice.at(q[0], q[1])?.id, p.id);
  assert.equal(a.ice.at(q[0] + 40, q[1] + 40), null);
  console.log(`  (Saskatoon, seed 3: ${kinds.bridge} patches on bridges, ${kinds.shade} in the shade)`);
});

await test("off: nothing placed, drawn, computed or reported; the grip hook is cleared; every vehicle steps exactly as before", async () => {
  const ctx = deck({ ice: false, s: 100, v: 11, brain: "rules" }), w = ctx.world;
  assert.equal(w.ice.enabled, false);
  assert.equal(w.ice.list.length, 0);
  assert.equal(ROAD.gripAt, null);
  await drive(ctx, 6);
  assert.equal(w.iceSeen, false);
  assert.equal("ice_overspeed" in w.violations, false);
  const snap = buildSnapshot(w);
  for (const key of ["black_ice", "black_ice_ahead", "ice_caution", "ice_limit_mps"]) assert.equal(key in snap, false, key);
  const cands = sampleCandidates(snap, w);
  assert.equal(cands.some(c => c.id === "slow_for_ice"), false);
  const metrics = new DriveMetrics(w.route.length);
  metrics.record(w, snap, w.roadInfo(), 1 / 60);
  assert.equal("ice_overspeed" in metrics.summary(w, { totals: {} }, false), false);
  const score = new DriveScore(w, {}); score.record(w, w.roadInfo(), 1 / 60);
  assert.equal("ice_overspeed" in score.snapshot(), false);
  assert.equal(toJevState(snap, cands, {}).black_ice, undefined);
  assert.equal(toJevState(snap, cands, {}).ice_caution, undefined);
  // (no other challenge turns it on)
  assert.deepEqual(CHALLENGES.filter(c => c.ice).map(c => c.id), ["bridges-freeze-first"]);
  // (free traffic, with cyclists, steps bit for bit the same with ice off, and with ice on in the
  // afternoon, when none lies on the road and the hook is installed but finds none)
  const mk = (ice) => { setWeather("dry"); const world = new World(SK, { seed: 9, pedestrians: 10, ice }); world.setClock({ hour: 15.5, sun_deg: 30 }); const fleet = new NpcFleet(world, { count: 16, bikes: 3, seed: 15 }); return { world, fleet, autopilot: idle }; };
  const a = mk(false);
  const runA = []; for (let k = 0; k < 900; k++) step(a);
  runA.push(JSON.stringify(a.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v, n.psi, n.r, n.vy])));
  const b = mk(true);
  assert.equal(typeof ROAD.gripAt, "function");
  assert.equal(b.world.ice.list.length, 0);
  for (let k = 0; k < 900; k++) step(b);
  assert.equal(JSON.stringify(b.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v, n.psi, n.r, n.vy])), runA[0]);
  // (and a world without ice, built after one with it, clears the hook)
  new World(SK, { seed: 1, parked: 0, pedestrians: 0 });
  assert.equal(ROAD.gripAt, null);
});

await test("the grip hook: a car, a cyclist and a forward sim on the ice have about its grip; a streetcar's steel wheels do not feel it", () => {
  const ctx = deck({ s: 20, from: 40, to: 200 }), w = ctx.world;
  const decelOver = (spec, s, seconds = 1) => {
    const p = pointAt(lane.pts, lane.cum, s), v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), spec === BIKE ? 6 : 12, spec);
    const v0 = v.v;
    for (let k = 0; k < seconds * 60; k++) v.step(1 / 60, { steer: 0, accel: -8 });
    return (v0 - v.v) / seconds;
  };
  const onCar = decelOver(CAR, 100), offCar = decelOver(CAR, 2);
  assert.equal(onCar < 0.11 * G * 1.15, true, `on the ice ${onCar}`);
  assert.equal(offCar > 4, true, `off it ${offCar}`);
  const onBike = decelOver(BIKE, 100), offBike = decelOver(BIKE, 2);
  assert.equal(onBike < 0.11 * G * 1.15, true, `bike on the ice ${onBike}`);
  assert.equal(offBike > 2.5, true, `bike off it ${offBike}`);
  // (rail vehicles)
  const mid = pointAt(lane.pts, lane.cum, 100);
  assert.equal(w.ice.muAt(mid[0], mid[1], CAR), 0.11);
  assert.equal(w.ice.muAt(mid[0], mid[1], STREETCAR), null);
  // (a forward sim braking hard on the ice slows only as the ice lets it)
  w.placeOnLane(lane, 90); w.ego.v = 10;
  const snap = buildSnapshot(w), brake = { id: "hard_brake", law: { kind: "hard_brake", offset: 0, center: 0 } };
  simulateAll([brake], snap, w);
  assert.equal(brake.sim.max_decel < 0.11 * G * 1.2, true, `${brake.sim.max_decel}`);
  // (and steering hard on it, the tyres slide: the car turns less than its wheels ask)
  const p = pointAt(lane.pts, lane.cum, 100), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, 100), 10, CAR), dry = car.clone();
  dry.x = pointAt(lane.pts, lane.cum, 2)[0]; dry.y = pointAt(lane.pts, lane.cum, 2)[1];
  for (let k = 0; k < 30; k++) { car.step(1 / 60, { steer: 0.15, accel: 0 }); dry.step(1 / 60, { steer: 0.15, accel: 0 }); }
  assert.equal(Math.abs(car.r) < Math.abs(dry.r) * 0.6, true, `yaw ${car.r} vs ${dry.r}`);
  assert.equal(car.slipping > 0, true);
});

await test("sensing: a patch is seen late, by day close up and at night in the headlights; the bridge caution caps the speed first", () => {
  // (36 m ahead: not yet by day; at night, yes)
  const day = deck({ s: 100, v: 11 }), sd = buildSnapshot(day.world);
  assert.equal(sd.black_ice, null);
  assert.equal(sd.ice_caution.bridge.on, true);
  assert.equal(sd.ice_caution.kind, "frost");
  assert.equal(sd.limit <= ICE.CAUTION_MPS + 1e-6, true, `${sd.limit}`);
  const night = deck({ s: 100, v: 11, night: 1 }), sn = buildSnapshot(night.world);
  assert.equal(sn.black_ice?.id, "p1");
  assert.equal(Math.abs(sn.black_ice.starts_in_m - (140 - 100 - (COMPACT.length - COMPACT.rearOverhang))) < 1, true, `${sn.black_ice.starts_in_m}`);
  // (16 m ahead by day: seen, and the speed comes down to cross it at)
  const near = deck({ s: 120, v: 11 }), w = near.world, s = buildSnapshot(w);
  assert.equal(s.black_ice?.id, "p1");
  assert.equal(s.black_ice.on_ice, false);
  assert.equal(Math.abs(s.black_ice.length_m - 60) < 2, true);
  assert.equal(s.limit < 11, true);
  assert.equal(s.target.reasons.includes("black ice ahead"), true, s.target.reasons.join());
  const cands = sampleCandidates(s, w), { eligible } = simulateAll(cands, s, w);
  assert.equal(eligible.some(c => c.id === "slow_for_ice"), true);
  assert.equal(cands.filter(c => c.law.kind === "lane" && c.law.vTarget > 0.1).every(c => c.law.slowTo?.length >= 1), true);
  // (an approach to the bridge in icy weather: the caution, before the car is on it)
  const before = deck({ s: 2, v: 13, from: null }), sb = buildSnapshot(before.world);
  // (the deck is all bridge from its start, where the car already is)
  assert.equal(sb.ice_caution.bridge !== null, true);
  // (no conditions, no caution: a dry afternoon)
  const pm = deck({ s: 100, v: 11, from: null, clock: { hour: 15.5, sun_deg: 30 } }), sp = buildSnapshot(pm.world);
  assert.equal(sp.ice_caution, null); assert.equal(sp.black_ice, null);
});

await test("candidates: onto the ice too fast is rejected; braking hard on it is rejected; hard_brake stays", () => {
  const near = deck({ s: 128, v: 11 }), w = near.world, s = buildSnapshot(w);
  const blind = { id: "blind", law: { kind: "lane", offset: 0, center: 0, vTarget: 11 } };
  simulateAll([blind], s, w);
  assert.equal(blind.reject, "crosses_ice_too_fast");
  const on = deck({ s: 160, v: 7 }), wo = on.world, so = buildSnapshot(wo);
  assert.equal(so.black_ice.on_ice, true);
  const stop = { id: "stop", law: { kind: "lane", offset: 0, center: 0, vTarget: 0 } }, brake = { id: "hard_brake", law: { kind: "hard_brake", offset: 0, center: 0 } };
  simulateAll([stop, brake], so, wo);
  assert.equal(stop.reject, "brakes_on_ice");
  assert.equal(brake.eligible, true);
  // (on the ice, too fast: the car only eases off, no candidate brakes)
  const late = deck({ s: 150, v: 10 }), wl = late.world, sl = buildSnapshot(wl);
  assert.equal(sl.black_ice.on_ice, true);
  assert.equal(Math.abs(sl.black_ice.slow.mps - (10 - ICE.EASE_MPS)) < 1e-6, true);
  const cl = sampleCandidates(sl, wl), rl = simulateAll(cl, sl, wl);
  assert.equal(rl.eligible.some(c => c.id === "slow_for_ice"), true, JSON.stringify(rl.rejected));
});

await test("the driven car (Rules) eases off before the ice and crosses it steadily, at its speed, without braking on it", async () => {
  for (const night of [0, 1]) {
    const ctx = deck({ s: 30, v: 11, brain: "rules", night }), w = ctx.world, p = w.ice.list[0];
    let entry = null, hardest = 0, slip = 0;
    await drive(ctx, 30, () => {
      if (onIce(w, w.ego)) { entry ??= w.ego.v; if (w.ego.v > ICE.HARD_MIN_MPS) hardest = Math.max(hardest, Math.abs(w.ego.a)); slip = Math.max(slip, w.ego.slipping); }
    }, () => !ctx.autopilot.enabled);
    assert.equal(entry !== null, true, "never reached it");
    assert.equal(entry <= ICE.safeSpeed(p) + 0.3, true, `onto it at ${entry} (safe ${ICE.safeSpeed(p)})`);
    assert.equal(hardest < ICE.HARD_SHARE * p.mu * G, true, `${hardest}`);
    assert.equal(slip <= ICE.SKID, true);
    assert.equal(w.violations.ice_overspeed ?? 0, 0);
    assert.equal(w.iceSeen, true);
    console.log(`  (${night ? "night" : "day"}: onto it at ${(entry * 3.6).toFixed(1)} km/h, safe ${(ICE.safeSpeed(p) * 3.6).toFixed(1)}; hardest input on it ${hardest.toFixed(2)} m/s²)`);
  }
});

await test("traffic and cyclists slow for the ice and the bridge, and cross it steadily", () => {
  for (const spec of [CAR, BIKE]) {
    const ctx = deck({ s: 10, from: 120, to: 200 }), w = ctx.world, p = w.ice.list[0];
    w.placeOnLane(SK.lane("e157", 0), 20);
    const car = trafficCar(w, ctx.fleet, 30, spec === BIKE ? 5 : 11, spec);
    let entry = null, slip = 0, maxOnBridge = 0;
    for (let k = 0; k < 40 * 60; k++) {
      step(ctx);
      if (onIce(w, car)) { entry ??= car.v; slip = Math.max(slip, car.slipping || 0); }
      if (car.path.currentEdge().id === DECK && car.path.s > 20) maxOnBridge = Math.max(maxOnBridge, car.v);
    }
    assert.equal(entry !== null && entry <= ICE.safeSpeed(p) + 0.3, true, `onto it at ${entry}`);
    assert.equal(slip <= ICE.SKID, true);
    assert.equal(maxOnBridge <= ICE.CAUTION_MPS + 0.6, true, `${maxOnBridge}`);
  }
});

await test("the audit: onto the ice too fast, or braking hard on it, is counted once a crossing, in the metrics, coaching and failures", () => {
  for (const [v, brakeAt, reason] of [[13, null, "fast"], [7, 70, "brake"], [7, null, null]]) {
    const ctx = deck({ s: 80, from: 140, to: 200 }), w = ctx.world;
    w.ego.v = v;
    const score = new DriveScore(w, { title: "test" }), metrics = new DriveMetrics(w.route.length);
    for (let k = 0; k < 60 * 12; k++) {
      const p = w.route.project(w.ego.x, w.ego.y);
      if (brakeAt !== null && p.s > brakeAt) w.ego.step(1 / 60, { steer: w.ego.delta, accel: -7 });
      else applyLaw(w.ego, { kind: "lane", offset: 0, vTarget: v, s0: p.s }, w.route, p.s, 1 / 60, w);
      const road = step(ctx);
      score.record(w, road, 1 / 60); metrics.record(w, null, road, 1 / 60);
    }
    const sum = metrics.summary(w, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true), report = score.snapshot();
    assert.equal(w.iceSeen, true);
    if (reason) {
      assert.equal(w.violations.ice_overspeed, 1, `${reason}: ${w.violations.ice_overspeed}`);
      assert.equal(sum.ice_overspeed, 1);
      assert.ok(failures(sum).includes("crossed black ice too fast, or braked or steered hard on it"));
      assert.equal(report.ice_overspeed, 1);
      assert.ok(report.incidents.some(x => x.type === "ice_overspeed" && x.reason === reason), reason);
      assert.ok(report.tips.some(t => /black ice/.test(t)));
    } else {
      assert.equal(w.violations.ice_overspeed ?? 0, 0);
      assert.equal(sum.ice_overspeed, 0);
      assert.equal(report.ice_overspeed, 0);
    }
  }
});

await test("models and the HUD are told: the state, the situation, the outcome labels, the prompt", () => {
  const near = deck({ s: 122, v: 10 }), w = near.world;
  const snap = buildSnapshot(w), cands = sampleCandidates(snap, w), { eligible } = simulateAll(cands, snap, w);
  const state = toJevState(snap, cands, {});
  assert.equal(state.black_ice.id, "p1");
  assert.equal(state.black_ice.on, "a bridge deck");
  assert.equal(state.black_ice.ahead_m > 0, true);
  assert.equal(state.black_ice.cross_at > 6, true);
  assert.equal(state.ice_caution.bridge.on_it, true);
  const text = situationClauses(snap).join(" ");
  assert.match(text, /slow_for_ice/);
  assert.match(text, /bridges, overpasses and shaded stretches/);
  const { questions } = buildQuestions(snap, eligible);
  assert.match(questions.vector.criteria.slow_for_ice, /without braking on it/);
  assert.match(SYSTEM_PROMPT, /slow_for_ice/);
  assert.equal(ICE.iceNotice(w, snap).text.startsWith("BLACK ICE AHEAD"), true);
  const on = deck({ s: 160, v: 7 }), so = buildSnapshot(on.world);
  assert.equal(toJevState(so, sampleCandidates(so, on.world), {}).black_ice.under_car, true);
  assert.match(situationClauses(so).join(" "), /Do not brake/);
  assert.equal(ICE.iceNotice(on.world, so).text.startsWith("ON BLACK ICE"), true);
  const far = deck({ s: 2, v: 11, from: null }), sf = buildSnapshot(far.world);
  assert.match(ICE.iceNotice(far.world, sf).text, /BRIDGES FREEZE FIRST/);
});

await test("checkpoints: a restored drive replays exactly", async () => {
  const ctx = setupChallenge(SK, lesson, { brain: "rules" }), recorder = new DriveRecorder(), clock = {};
  await drive(ctx, 10);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], t: ctx.world.t, n: ctx.fleet.vehicles.map(v => [v.id, v.x, v.v]) });
  await drive(ctx, 10);
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(ctx.world.ice.list.length, 1);
  await drive(ctx, 10);
  assert.equal(sig(), first);
});

for (const brain of ["rules", "cautious"]) await test(`"Bridges freeze first", ${brain}: eases off for the bridge and the ice, crosses it steadily, arrives cleanly`, async () => {
  const ctx = setupChallenge(SK, lesson, { brain }), w = ctx.world, p = w.ice.list[0];
  assert.equal(w.ice.enabled, true);
  assert.equal(w.ice.conditions?.kind, "frost");
  let entry = null, hardest = 0;
  await drive(ctx, 70, () => { if (onIce(w, w.ego)) { entry ??= w.ego.v; if (w.ego.v > ICE.HARD_MIN_MPS) hardest = Math.max(hardest, Math.abs(w.ego.a)); } }, () => !ctx.autopilot.enabled);
  assert.equal(entry !== null && entry <= ICE.safeSpeed(p) + 0.3, true, `onto it at ${entry}`);
  assert.equal(w.violations.ice_overspeed ?? 0, 0);
  const result = await evaluateChallenge(SK, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.ice_overspeed, 0);
  assert.equal(result.report.ice_overspeed, 0);
  console.log(`  (${brain}: onto the ice at ${(entry * 3.6).toFixed(1)} km/h, safe ${(ICE.safeSpeed(p) * 3.6).toFixed(1)}; hardest input on it ${hardest.toFixed(2)} m/s²)`);
});

await test(`"Bridges freeze first": a driver who keeps to the limit goes onto the ice too fast, and fails`, () => {
  const ctx = setupChallenge(SK, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const blind = { ...ctx, autopilot: idle }, metrics = new DriveMetrics(w.route.length);
  for (let k = 0; k < 20 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { kind: "lane", offset: 0, vTarget: 13.9, s0: p.s }, w.route, p.s, 1 / 60, w);
    metrics.record(w, null, step(blind), 1 / 60);
  }
  assert.equal(w.violations.ice_overspeed >= 1, true, JSON.stringify(w.violations));
  assert.equal(failures(metrics.summary(w, ctx.autopilot, true)).includes("crossed black ice too fast, or braked or steered hard on it"), true);
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/bridges_freeze_first.json`),
// from the challenge as the car comes up to the ice it has just seen.
if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(SK, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 40 * 60 && !snap; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const s = buildSnapshot(w);
    if (!s.black_ice || s.black_ice.on_ice || s.black_ice.starts_in_m > 16) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "slow_for_ice")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible), state = toJevState(snap, candidates, { rejected });
  fs.writeFileSync(new URL("../data/snapshots/bridges_freeze_first.json", import.meta.url), JSON.stringify({ name: "bridges_freeze_first", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: eligible.filter(c => c.id === "slow_for_ice" || (c.sim.end_speed <= snap.black_ice.speed_mps + 0.5 && c.law.kind === "lane" && c.sim.end_speed > 2)).map(c => c.id) } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/bridges_freeze_first.json (black ice in ${snap.black_ice.starts_in_m.toFixed(1)} m, ${eligible.length} eligible)`);
}

console.log(`${checks} black ice checks passed`);
process.exit(0);
