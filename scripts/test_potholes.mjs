// Spring potholes: placement from their own stream (more on main streets, every one inside its lane);
// the room in a lane to go round one; the driven car easing round one inside its lane where there is
// room and slowing to drive over one where there isn't (sensing, candidates, the forward sims'
// rejection, closed-loop Rules); traffic doing the same; the audit of a fast hit, its metrics, the
// coaching and the drive's failure; what models and the HUD are told; checkpoints; the "Pothole
// season" challenge with Rules and the cautious agent; and with the option off, nothing placed, drawn,
// computed or reported.
// node --experimental-default-type=module scripts/test_potholes.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, comfort } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const { rng } = await import("../static/js/common.js");
const PH = await import("../static/js/sim/potholes.js");
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
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways"]) {
    const url = [2, 1].map(v => new URL(`${key}.${name}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -4;
  return new MapData(pack);
};
const MTL = load("bb9df59633e0");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const lesson = CHALLENGES.find(c => c.id === "pothole-season");
const COMPACT = getVehicleModel("compact").spec;
// Rue Saint-Denis, the block the challenge drives: one lane each way, 3.5 m wide, 40 km/h.
const EDGE = "e212", lane = MTL.lane(EDGE, 0), NEXT = "e375";
const SMALL = { offset: 0.75, a: 0.35, b: 0.3, depth: 0.06 }, WIDE = { offset: 0.1, a: 0.85, b: 0.8, depth: 0.1 };

// A world on Saint-Denis with potholes on (or off), the car `s` metres along the block, `v` m/s, a route
// to the end of it, and the potholes given (by lane arc length) in place of the world's own.
function street({ potholes = true, weather = "dry", s = 10, v = 0, holes = [], brain = null, seed = 3 } = {}) {
  setWeather(weather);
  const world = new World(MTL, { seed, parked: 0, pedestrians: 0, weather, vehicleSpec: COMPACT, potholes });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  world.placeOnLane(lane, s); world.ego.v = v;
  world.route = new Route(routeFromLanes(MTL, [lane], s, lane.length - 6), MTL, world.ego.spec);
  if (potholes) world.potholes.setList(holes.map((h, i) => PH.potholeOnLane(MTL, EDGE, 0, h.s, { id: `t${i + 1}`, ...h, shape: 7 + i })));
  let autopilot = idle;
  if (brain) { autopilot = new Autopilot(world, {}); autopilot.setBrain(brain); autopilot.setEnabled(true); }
  return { world, fleet, autopilot };
}
// The car's (or a vehicle's) lateral offset from the lane's centre.
const lateralOf = (v) => {
  const c = Math.cos(headingAt(lane.pts, lane.cum, 0)), p = lane.pts[0];
  let best = null;
  for (let i = 0; i + 1 < lane.pts.length; i++) {
    const a = lane.pts[i], b = lane.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((v.x - a[0]) * dx + (v.y - a[1]) * dy) / (len * len))), qx = a[0] + dx * t, qy = a[1] + dy * t;
    const d = Math.hypot(v.x - qx, v.y - qy);
    if (!best || d < best.d) best = { d, lat: ((v.x - qx) * dy - (v.y - qy) * dx) / len };
  }
  return best.lat;
};
// Drive (lockstep) until `until` or `seconds`; per step, `each`.
async function drive(ctx, seconds, each = () => {}, until = () => false) {
  for (let k = 0; k < seconds * 60; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    each();
    if (until()) return true;
  }
  return false;
}
// The speed a vehicle's tyres first go into pothole `h` at, or null if they never do.
function entry(v, h) { return PH.wheelPoints(v).some(([x, y]) => PH.inPothole(h, x, y)) ? v.v : null; }

await test("placement: from its own stream, many more on main streets than quiet ones, every one inside its lane", () => {
  setWeather("dry");
  const a = new World(MTL, { seed: 3, parked: 0, pedestrians: 0, potholes: true }), b = new World(MTL, { seed: 3, parked: 0, pedestrians: 0, potholes: true });
  const c = new World(MTL, { seed: 4, parked: 0, pedestrians: 0, potholes: true });
  assert.equal(a.potholes.enabled, true);
  assert.equal(a.potholes.list.length > 50, true, `${a.potholes.list.length}`);
  assert.equal(JSON.stringify(a.potholes.list), JSON.stringify(b.potholes.list));
  assert.notEqual(JSON.stringify(a.potholes.list.map(h => h.s)), JSON.stringify(c.potholes.list.map(h => h.s)));
  // (per kilometre of lane)
  const per = (set) => {
    let km = 0, n = 0;
    for (const e of MTL.edges.values()) if (set.includes(e.cls)) { km += e.length * e.lanes / 1000; n += a.potholes.list.filter(h => h.edge === e.id).length; }
    return n / km;
  };
  const main = per(["secondary", "tertiary", "primary"]), quiet = per(["residential"]);
  assert.equal(main > 2.5 * quiet, true, `main ${main.toFixed(1)}/km, quiet ${quiet.toFixed(1)}/km`);
  for (const h of a.potholes.list) {
    assert.equal(Math.abs(h.offset) + h.b <= h.lane_w / 2 + 1e-6, true, h.id);
    const l = MTL.lane(h.edge, h.lane);
    assert.equal(h.s >= 12 && h.s <= l.length - 12, true, h.id);
  }
  // (none closer than 25 m to the next on its lane)
  for (const list of a.potholes.byLane.values()) for (let i = 1; i < list.length; i++) assert.equal(list[i].s - list[i - 1].s >= 25 - 1e-6, true);
  // (and the grid finds them)
  const h = a.potholes.list[17];
  assert.equal(a.potholes.near(h.x, h.y, 2).some(x => x.id === h.id), true);
  console.log(`  (${a.potholes.list.length} potholes on the Plateau: ${main.toFixed(1)} per lane-km of main street, ${quiet.toFixed(1)} on quiet ones)`);
});

await test("room in the lane: the smallest move that clears both wheels, the hole between them on a tie; none for a wide one; never over a lane line", () => {
  const lim = PH.maxShift(3.5, COMPACT);
  assert.equal(Math.abs(lim - (1.75 - 0.89 - 0.05)) < 1e-9, true);
  // (one in the right wheel path: 0.55 m right, between the wheels)
  assert.equal(PH.wheelRoom(0.75, SMALL, 3.5, COMPACT), 0.55);
  assert.equal(PH.wheelRoom(-0.75, SMALL, 3.5, COMPACT), -0.55);
  // (one in the middle, small: between the wheels as the car is)
  assert.equal(PH.wheelRoom(0, { b: 0.24 }, 3.5, COMPACT), 0);
  // (a wide one: no room; nor in a narrower lane for one a little smaller)
  assert.equal(PH.wheelRoom(0.1, WIDE, 3.5, COMPACT), null);
  assert.equal(PH.wheelRoom(0.75, { b: 0.45 }, 3.0, COMPACT), null);
  // (whatever it is, the move keeps the car inside its lane, and its wheels clear)
  const random = rng(11);
  for (let i = 0; i < 500; i++) {
    const h = { b: 0.15 + random() * 0.8 }, dl = (random() - 0.5) * 3, w = 3 + random() * 0.6;
    const m = PH.wheelRoom(dl, h, w, COMPACT);
    if (m === null) continue;
    assert.equal(Math.abs(m) + COMPACT.width / 2 <= w / 2 + 1e-6, true);
    assert.equal(PH.wheelsCross(m, dl, h, COMPACT), false);
  }
});

await test("off: nothing placed, drawn, computed or reported, and the world steps exactly as without the option", async () => {
  const ctx = street({ potholes: false, v: 9, brain: "rules" }), w = ctx.world;
  assert.equal(w.potholes.enabled, false);
  assert.equal(w.potholes.list.length, 0);
  await drive(ctx, 6);
  assert.equal(w.potholesSeen, false);
  assert.equal("pothole_hits" in w.violations, false);
  const snap = buildSnapshot(w);
  assert.equal("pothole" in snap, false); assert.equal("potholes_ahead" in snap, false);
  const cands = sampleCandidates(snap, w);
  assert.equal(cands.some(c => c.law.slowTo || c.id === "ease_round_pothole"), false);
  const metrics = new DriveMetrics(w.route.length);
  metrics.record(w, snap, w.roadInfo(), 1 / 60);
  assert.equal("pothole_hits" in metrics.summary(w, { totals: {} }, false), false);
  const score = new DriveScore(w, {}); score.record(w, w.roadInfo(), 1 / 60);
  assert.equal("pothole_hits" in score.snapshot(), false);
  assert.equal(toJevState(snap, cands, {}).pothole, undefined);
  // (no other challenge turns it on)
  assert.deepEqual(CHALLENGES.filter(c => c.potholes).map(c => c.id), ["pothole-season"]);
  // (a free drive's traffic steps exactly as in a world whose potholes object predates the option)
  const mk = () => { setWeather("dry"); const world = new World(MTL, { seed: 9, pedestrians: 10, potholes: false }); const fleet = new NpcFleet(world, { count: 12, bikes: 2, seed: 15 }); return { world, fleet, autopilot: idle }; };
  const a = mk(), b = mk();
  b.world.potholes = { enabled: false, list: [] };
  for (let k = 0; k < 600; k++) { step(a); step(b); }
  assert.equal(JSON.stringify(a.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v])), JSON.stringify(b.fleet.vehicles.map(n => [n.id, n.x, n.y, n.v])));
  assert.equal(a.fleet.vehicles.some(n => "phShift" in n), false);
});

await test("sensing and candidates: room means `ease_round_pothole`; keeping the middle slows for it; too fast over it is rejected", () => {
  const ctx = street({ s: 20, v: 9.5, holes: [{ s: 50, ...SMALL }] }), w = ctx.world;
  const snap = buildSnapshot(w);
  assert.equal(snap.pothole.id, "t1");
  assert.equal(snap.pothole.room, true);
  assert.equal(snap.pothole.shift_m, 0.55);
  assert.equal(Math.abs(snap.pothole.lateral_m - 0.75) < 0.05, true);
  assert.equal(snap.limit, 11.1, "room: no slowing");
  const cands = sampleCandidates(snap, w), { eligible, rejected } = simulateAll(cands, snap, w);
  const ease = cands.find(c => c.id === "ease_round_pothole");
  assert.equal(!!ease && ease.eligible, true);
  assert.equal(ease.law.slowTo, undefined);
  assert.equal(ease.law.detour.shift, 0.55);
  assert.equal(cands.find(c => c.id === "keep_lane_target").law.slowTo?.length, 1);
  assert.equal(eligible.length > 3, true);
  // (closer, a manoeuvre that kept to the middle at speed would put a wheel in it: rejected)
  const near = street({ s: 34, v: 9.5, holes: [{ s: 50, ...SMALL }] }), wn = near.world, sn = buildSnapshot(wn);
  const fast = { id: "blind", law: { kind: "lane", offset: 0, center: 0, vTarget: 9.5 } };
  simulateAll([fast], sn, wn);
  assert.equal(fast.reject, "hits_pothole_too_fast");
  // (a wide one: no room, the limit comes down, and everything that keeps going slows for it)
  const wide = street({ s: 100, v: 9.5, holes: [{ s: 128, ...WIDE }] }), ww = wide.world, sw = buildSnapshot(ww);
  assert.equal(sw.pothole.room, false);
  assert.equal(sw.limit < 11.1, true);
  const cw = sampleCandidates(sw, ww);
  assert.equal(cw.some(c => c.id === "ease_round_pothole"), false);
  const noSlow = cw.filter(c => c.law.kind === "lane" && c.law.vTarget > 0.1 && c.law.stopAtRoute === undefined && c.law.slowTo?.length !== 1).map(c => c.id);
  assert.deepEqual(noSlow, []);
  console.log(`  (rejected near the small one: ${JSON.stringify(rejected)}; wide: limit ${sw.limit.toFixed(2)} m/s at ${sw.pothole.starts_in_m.toFixed(0)} m)`);
});

await test("the driven car (Rules) eases round one inside its lane where there is room, without slowing", async () => {
  for (const [hole, side] of [[SMALL, 1], [{ ...SMALL, offset: -0.7 }, -1]]) {
    const ctx = street({ s: 10, v: 9.5, holes: [{ s: 70, ...hole }], brain: "rules" }), w = ctx.world, h = w.potholes.list[0];
    let into = null, maxLat = 0, slowest = Infinity, latAt = null;
    await drive(ctx, 9, () => {
      into ??= entry(w.ego, h);
      const lat = lateralOf(w.ego);
      maxLat = Math.max(maxLat, Math.abs(lat));
      const ahead = (h.x - w.ego.x) * Math.cos(w.ego.psi) + (h.y - w.ego.y) * Math.sin(w.ego.psi);
      if (ahead < 8 && ahead > -3) slowest = Math.min(slowest, w.ego.v);
      if (latAt === null && ahead < w.ego.spec.wheelbase) latAt = lat;
    });
    assert.equal(into, null, "a wheel went into it");
    assert.equal(Math.sign(latAt), side);
    assert.equal(maxLat + COMPACT.width / 2 <= 1.75 + 0.05, true, `body out of the lane: ${maxLat}`);
    assert.equal(slowest > 8.5, true, `slowed to ${slowest}`);
    assert.equal(w.violations.pothole_hits ?? 0, 0);
    assert.equal(w.potholesSeen, true);
  }
});

await test("the driven car (Rules) slows to the pothole-safe speed for one it can't go round, keeping its lane", async () => {
  for (const weather of ["dry", "rain"]) {
    const ctx = street({ s: 40, v: 9.5, weather, holes: [{ s: 128, ...WIDE }], brain: "rules" }), w = ctx.world, h = w.potholes.list[0];
    let into = null, maxLat = 0, after = 0;
    await drive(ctx, 18, () => {
      into ??= entry(w.ego, h);
      maxLat = Math.max(maxLat, Math.abs(lateralOf(w.ego)));
      if (into !== null) after = Math.max(after, w.ego.v);
    });
    assert.equal(into !== null, true, "it never got there");
    assert.equal(into <= PH.safeSpeed(h) + 0.3, true, `${weather}: into it at ${into} (safe ${PH.safeSpeed(h)})`);
    assert.equal(into > 2, true, `${weather}: all but stopped (${into})`);
    assert.equal(maxLat < 0.3, true);
    assert.equal(w.violations.pothole_hits ?? 0, 0);
    assert.equal(after > into + 1, true, "speeds up again once over it");
    console.log(`  (${weather}: into it at ${(into * 3.6).toFixed(1)} km/h, safe ${(PH.safeSpeed(h) * 3.6).toFixed(1)} km/h)`);
  }
});

await test("traffic does the same: round one with room, inside its lane, at speed; slow over one without", () => {
  for (const [hole, room] of [[SMALL, true], [{ ...SMALL, offset: -0.75 }, true], [WIDE, false]]) {
    const ctx = street({ s: 2, holes: [{ s: 100, ...hole }] }), w = ctx.world, h = w.potholes.list[0];
    // (the driven car out of the way, on another street)
    w.placeOnLane(MTL.lane("e157", 0), 20);
    const p = pointAt(lane.pts, lane.cum, 20), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, 20), 10, CAR);
    Object.assign(car, { id: "npc", kind: "car", color: 0x777777, v0: 11.1, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.8, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(MTL, rng(9)), frozen: 0, waiting: 0 });
    car.path.start(EDGE, 0, 20, [[NEXT, 0]]);
    ctx.fleet.vehicles.push(car); w.npcs = ctx.fleet.vehicles;
    let into = null, maxLat = 0, slowest = Infinity;
    for (let k = 0; k < 14 * 60; k++) {
      step(ctx);
      into ??= entry(car, h);
      maxLat = Math.max(maxLat, Math.abs(lateralOf(car)));
      const ahead = (h.x - car.x) * Math.cos(car.psi) + (h.y - car.y) * Math.sin(car.psi);
      if (ahead < 6 && ahead > -3) slowest = Math.min(slowest, car.v);
    }
    assert.equal(maxLat + CAR.width / 2 <= 1.75 + 0.1, true, `out of its lane: ${maxLat}`);
    if (room) {
      assert.equal(into, null, "its wheel went into it");
      assert.equal(slowest > 9, true, `slowed to ${slowest}`);
    } else {
      assert.equal(into !== null && into <= PH.safeSpeed(h) + 0.4, true, `into it at ${into}`);
      assert.equal(maxLat < 0.2, true);
    }
  }
});

await test("traffic: two it could each get round, too close together to shift between in time, it slows for the second", () => {
  const ctx = street({ s: 2, holes: [{ s: 100, ...SMALL }, { s: 125, ...SMALL, offset: -0.75 }] }), w = ctx.world, [h1, h2] = w.potholes.list;
  w.placeOnLane(MTL.lane("e157", 0), 20);
  const p = pointAt(lane.pts, lane.cum, 20), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, 20), 10, CAR);
  Object.assign(car, { id: "npc", kind: "car", color: 0x777777, v0: 11.1, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.8, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(MTL, rng(9)), frozen: 0, waiting: 0 });
  car.path.start(EDGE, 0, 20, [[NEXT, 0]]);
  ctx.fleet.vehicles.push(car); w.npcs = ctx.fleet.vehicles;
  let into1 = null, into2 = null;
  for (let k = 0; k < 16 * 60; k++) { step(ctx); into1 ??= entry(car, h1); into2 ??= entry(car, h2); }
  for (const [h, into] of [[h1, into1], [h2, into2]]) assert.equal(into === null || into <= PH.safeSpeed(h) + 0.4, true, `into ${h.id} at ${into} (safe ${PH.safeSpeed(h)})`);
  console.log(`  (first: ${into1 === null ? "round it" : `over at ${(into1 * 3.6).toFixed(1)} km/h`}; second: ${into2 === null ? "round it" : `over at ${(into2 * 3.6).toFixed(1)} km/h`})`);
});

await test("the audit: a wheel into one too fast is a hit, counted once, in the metrics, the coaching and the failures; slowly, none", () => {
  for (const v of [11, 4]) {
    const ctx = street({ s: 60, holes: [{ s: 100, ...WIDE }] }), w = ctx.world;
    const score = new DriveScore(w, { title: "test" }), metrics = new DriveMetrics(w.route.length);
    for (let k = 0; k < 60 * 10; k++) {
      const p = w.route.project(w.ego.x, w.ego.y);
      applyLaw(w.ego, { kind: "lane", offset: 0, vTarget: v, s0: p.s }, w.route, p.s, 1 / 60, w);
      const road = step(ctx);
      score.record(w, road, 1 / 60); metrics.record(w, null, road, 1 / 60);
    }
    const sum = metrics.summary(w, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true), report = score.snapshot();
    assert.equal(w.potholesSeen, true);
    if (v > 5) {
      assert.equal(w.violations.pothole_hits, 1);
      assert.equal(sum.pothole_hits, 1);
      assert.ok(failures(sum).includes("hit a pothole too fast"));
      assert.equal(report.pothole_hits, 1);
      assert.ok(report.incidents.some(x => x.type === "pothole_hit"));
      assert.ok(report.tips.some(t => /pothole/.test(t)));
    } else {
      assert.equal(w.violations.pothole_hits ?? 0, 0);
      assert.equal(sum.pothole_hits, 0);
      assert.equal(failures(sum).includes("hit a pothole too fast"), false);
      assert.equal(report.pothole_hits, 0);
    }
  }
});

await test("models and the HUD are told: the state, the situation, the outcome labels, the prompt", () => {
  const room = street({ s: 30, v: 9.5, weather: "rain", holes: [{ s: 60, ...SMALL }, { s: 78, ...WIDE }] }), w = room.world;
  const snap = buildSnapshot(w), cands = sampleCandidates(snap, w), { eligible } = simulateAll(cands, snap, w);
  const state = toJevState(snap, cands, {});
  assert.equal(state.pothole.id, "t1");
  assert.equal(state.pothole.room_in_lane, true);
  assert.equal(state.pothole.ease_to_m, 0.6);
  assert.equal(state.pothole.full_of_water, true);
  assert.equal(state.pothole.more_ahead, 1);
  const text = situationClauses(snap).join(" ");
  assert.match(text, /ease_round_pothole/);
  assert.match(text, /looks like any puddle/);
  const { questions } = buildQuestions(snap, eligible);
  assert.match(questions.vector.criteria.ease_round_pothole, /both wheels miss the pothole/);
  assert.match(SYSTEM_PROMPT, /ease_round_pothole/);
  assert.equal(PH.potholeNotice(w, snap).text.startsWith("POTHOLE"), true);
  setWeather("dry");
  const wide = street({ s: 100, v: 9.5, holes: [{ s: 128, ...WIDE }] }), ws = buildSnapshot(wide.world);
  const sc = sampleCandidates(ws, wide.world); simulateAll(sc, ws, wide.world);
  const st = toJevState(ws, sc, {});
  assert.equal(st.pothole.room_in_lane, false);
  assert.equal(st.pothole.drive_over_at > 4, true);
  assert.match(situationClauses(ws).join(" "), /no room to go round it/);
  assert.match(st.candidates.find(c => c.id === "keep_lane_target")?.outcome || st.candidates[0].outcome, /pothole/);
  assert.match(st.car.target_reason, /pothole/);
  assert.equal(PH.potholeNotice(wide.world, ws).slow, true);
});

await test("checkpoints: a restored drive replays exactly", async () => {
  const ctx = setupChallenge(MTL, lesson, { brain: "rules" }), recorder = new DriveRecorder(), clock = {};
  await drive(ctx, 4);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], t: ctx.world.t, hits: ctx.world.violations.pothole_hits ?? 0 });
  await drive(ctx, 8);
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(ctx.world.potholes.list.length, 4);
  await drive(ctx, 8);
  assert.equal(sig(), first);
});

for (const brain of ["rules", "cautious"]) await test(`"Pothole season", ${brain}: round the two in the wheel paths, slows over the wide one, arrives cleanly`, async () => {
  const ctx = setupChallenge(MTL, lesson, { brain }), w = ctx.world;
  assert.equal(w.potholes.enabled, true);
  assert.equal(w.weather, "rain");
  const holes = w.potholes.list, into = holes.map(() => null), lat = holes.map(() => null);
  await drive(ctx, 60, () => {
    holes.forEach((h, i) => {
      into[i] ??= entry(w.ego, h);
      const ahead = (h.x - w.ego.x) * Math.cos(w.ego.psi) + (h.y - w.ego.y) * Math.sin(w.ego.psi);
      if (lat[i] === null && ahead < w.ego.spec.wheelbase) lat[i] = lateralOf(w.ego);
    });
  }, () => !ctx.autopilot.enabled);
  assert.equal(into[0], null); assert.equal(into[1], null); assert.equal(into[3], null);
  assert.equal(lat[0] > 0.3, true, `round the first on the right: ${lat[0]}`);
  assert.equal(lat[1] < -0.2, true, `round the second on the left: ${lat[1]}`);
  assert.equal(into[2] !== null && into[2] <= PH.safeSpeed(holes[2]) + 0.3, true, `over the wide one at ${into[2]}`);
  const result = await evaluateChallenge(MTL, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.pothole_hits, 0);
  assert.equal(result.report.pothole_hits, 0);
  console.log(`  (${brain}: offsets ${lat.map(x => x.toFixed(2)).join(", ")} m; over the wide one at ${(into[2] * 3.6).toFixed(1)} km/h; ${result.duration_s ?? ""})`);
});

await test(`"Pothole season": a driver who keeps going hits the wide one, and fails`, () => {
  const ctx = setupChallenge(MTL, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const blind = { ...ctx, autopilot: idle }, metrics = new DriveMetrics(w.route.length);
  for (let k = 0; k < 30 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    applyLaw(w.ego, { kind: "lane", offset: 0, vTarget: 9.5, s0: p.s }, w.route, p.s, 1 / 60, w);
    metrics.record(w, null, step(blind), 1 / 60);
  }
  assert.equal(w.violations.pothole_hits >= 2, true, JSON.stringify(w.violations));
  const summary = metrics.summary(w, ctx.autopilot, true);
  assert.equal(failures(summary).includes("hit a pothole too fast"), true);
  console.log(`  (the driver who kept going: ${w.violations.pothole_hits} hits)`);
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/pothole_season.json`), from
// the challenge as the car comes up to the first pothole, with room to ease round it in the lane.
if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(MTL, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 20 * 60 && !snap; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const s = buildSnapshot(w);
    if (!s.pothole?.room || s.pothole.starts_in_m > 24) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "ease_round_pothole")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible), state = toJevState(snap, candidates, { rejected });
  // (round it, keeping its speed: no slowing to drive over it)
  const round = eligible.filter(c => c.id === "ease_round_pothole").map(c => c.id);
  fs.writeFileSync(new URL("../data/snapshots/pothole_season.json", import.meta.url), JSON.stringify({ name: "pothole_season", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: round } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/pothole_season.json (pothole in ${snap.pothole.starts_in_m.toFixed(1)} m, ${eligible.length} eligible)`);
}

console.log(`${checks} pothole checks passed`);
process.exit(0);
