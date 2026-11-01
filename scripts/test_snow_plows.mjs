// Snow plows: the plow and where it is from other vehicles, the streets plows work, free-drive plows
// coming and going while it snows, traffic staying behind one rather than pass it on the right, the
// driven car's sensing, its stay-back speed, its lane options and candidates, passing on the left in
// clear weather and staying back in falling snow, the audit of passing one on the right, coaching,
// what models are told, the HUD, checkpoints, and the "Behind the plow" challenge.
// node --experimental-default-type=module scripts/test_snow_plows.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, SNOW_PLOW } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather, current: weather } = await import("../static/js/sim/weather.js");
const { PLOW_CLASSES, PLOW_COUNT, PLOW_GONE_M, PLOW_MPS, PLOW_SPAWN_M, STAY_BACK_M, isPlow, plowLanes, plowNotice, plowRelation, stayBack } = await import("../static/js/sim/snow-plow.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { getVehicleModel } = await import("../static/js/sim/vehicle-models.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -5;
  return new MapData(pack);
};
const KEYS = ["623b012bc8b5", "7165f1c807a8", "d7454a9751b7", "4a96d42cb3f2", "bb9df59633e0", "a53c5bcf6438", "d25b07def0d2", "19bb885c9cae", "8e99888cb743", "ca5573a8d934", "3e794edbefcb", "49db0d437c8c"];
const WPG = load("19bb885c9cae");
// William Avenue, Winnipeg: two lanes each way, 50 km/h, straight for 500 m to a signal (lane 0 the
// left lane, lane 1 the curb lane), carrying straight on as e343.
const EDGE = "e481", NEXT = "e343";
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const COMPACT = getVehicleModel("compact").spec;

// A world on William Avenue in `weather`, the car in lane `lane` with its rear axle at `s`, at `v`,
// routed straight on, and a fleet with no traffic.
function william({ weather: w = "snow", lane = 1, s = 100, v = 0, plows = 0, seed = 1 } = {}) {
  setWeather(w);
  const world = new World(WPG, { seed, weather: w, parked: 0, pedestrians: 0, vehicleSpec: COMPACT });
  const l = WPG.lane(EDGE, lane);
  world.placeOnLane(l, s);
  world.ego.v = v;
  world.route = new Route(routeFromLanes(WPG, [l, WPG.lane(NEXT, lane)], s, 60), WPG, world.ego.spec);
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed, plows });
  return { world, fleet };
}
// A plow on William Avenue in lane `lane`, its rear `gap` metres ahead of the car's front, at `v`.
function plowAhead(world, fleet, { lane = 0, gap = 25, v = PLOW_MPS } = {}) {
  const l = WPG.lane(EDGE, lane), front = world.ego.spec.length - world.ego.spec.rearOverhang;
  const egoS = projectOn(l, world.ego);
  return fleet.addPlow(l, egoS + front + gap + SNOW_PLOW.rearOverhang, v, [[NEXT, lane]]);
}
function projectOn(lane, v) {
  let best = 0, bestD = Infinity;
  for (let s = 0; s <= lane.length; s += 0.25) { const p = pointAt(lane.pts, lane.cum, s), d = Math.hypot(p[0] - v.x, p[1] - v.y); if (d < bestD) { bestD = d; best = s; } }
  return best;
}
// A car of the traffic on William Avenue, lane `lane`, rear axle `s`, at `v`.
function npc(world, fleet, { lane, s, v = 8, id, lcRate = 0 }) {
  const l = WPG.lane(EDGE, lane), p = pointAt(l.pts, l.cum, s);
  const n = new Vehicle(p[0], p[1], headingAt(l.pts, l.cum, s), v);
  Object.assign(n, { id, color: 0x8d9299, v0: 13.9, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate }, stopMem: new StopMemory(), path: new NpcPath(WPG, fleet.random), frozen: 0, waiting: 0 });
  n.path.start(EDGE, lane, s, [[NEXT, lane]]);
  fleet.vehicles.push(n);
  return n;
}
// The driven car closed loop with Rules for up to `limit` s: whether it drew level with the plow
// (and on which side: the plow's centre line right of the car's), the closest it came behind it once
// settled, and how far ahead of it the car was when it moved back into its lane.
async function closedLoop({ world, fleet }, plow, { limit = 60, settle = 20 } = {}) {
  const autopilot = new Autopilot(world, {}); autopilot.setBrain("rules"); autopilot.setEnabled(true);
  const ctx = { world, fleet, autopilot };
  let level = null, minGap = Infinity, backIn = null;
  while (world.t < limit && autopilot.enabled) {
    step(ctx);
    if (autopilot.firing) await autopilot.firing;
    const rel = plowRelation(world.ego, plow);
    if (!rel) continue;
    if (rel.ahead_m <= 0 && level === null) level = rel.right_m;
    if (level === null && world.t > settle) minGap = Math.min(minGap, rel.gap_m);
    if (level !== null && backIn === null && Math.abs(rel.right_m) < 1) backIn = rel.clear_m;
  }
  autopilot.setEnabled(false);
  return { level, minGap, backIn };
}

await test("the plow: a single-axle plow truck with its blade, its stay-back distance, and where it is from another vehicle", () => {
  assert.equal(SNOW_PLOW.kind, "snow_plow");
  assert.ok(SNOW_PLOW.length > 9 && SNOW_PLOW.length < 10.5 && SNOW_PLOW.width === 2.6 && SNOW_PLOW.mass > 10000);
  assert.equal(stayBack(50 / 3.6), 30);
  assert.equal(stayBack(80 / 3.6), 30, "80 km/h or less: 30 m");
  assert.equal(stayBack(90 / 3.6), 100, "above 80 km/h: 100 m");
  assert.ok(Math.abs(PLOW_MPS * 3.6 - 18) < 1e-9);
  const { world, fleet } = william();
  const left = plowAhead(world, fleet, { lane: 0, gap: 20 }), rel = plowRelation(world.ego, left);
  assert.equal(rel.lane, "left");
  assert.ok(Math.abs(rel.gap_m - 20) < 0.5, `20 m ahead: ${rel.gap_m.toFixed(2)}`);
  assert.ok(Math.abs(rel.right_m + 3.5) < 0.05 && rel.clear_m < 0);
  const same = plowAhead(world, fleet, { lane: 1, gap: 40 });
  assert.equal(plowRelation(world.ego, same).lane, "same");
  const back = new Vehicle(world.ego.x, world.ego.y, world.ego.psi + Math.PI, 0, SNOW_PLOW);
  assert.equal(plowRelation(world.ego, back), null, "not one going the other way");
  assert.ok(isPlow(left) && !isPlow(world.ego) && left.beacons);
});

await test("plows work the primary, secondary and tertiary streets, on every map", () => {
  for (const key of KEYS) {
    const map = key === "19bb885c9cae" ? WPG : load(key), lanes = plowLanes(map);
    assert.ok(lanes.length > 10, `${key}: ${lanes.length} lanes`);
    assert.ok(lanes.every((l) => PLOW_CLASSES.has(l.edgeRef.cls) && !l.edgeRef.ring && l.length > 40), key);
  }
});

await test("free drive: while it snows one plow at a time, put down out of sight 150 to 450 m away, clearing at 18 km/h; gone once out of sight 500 m away; none in dry weather or unless asked for", () => {
  const { world, fleet } = william({ plows: PLOW_COUNT, seed: 7 });
  step({ world, fleet, autopilot: idle });
  const plows = fleet.vehicles.filter(isPlow);
  assert.equal(plows.length, 1, "one plow");
  const plow = plows[0], d = Math.hypot(plow.x - world.ego.x, plow.y - world.ego.y);
  assert.ok(d >= PLOW_SPAWN_M[0] && d <= PLOW_SPAWN_M[1], `${d.toFixed(0)} m away`);
  assert.ok(PLOW_CLASSES.has(WPG.edges.get(plow.path.currentEdge().id).cls), "on a main street");
  assert.ok(!world.visibility.canSee(world.ego, plow.x, plow.y), "out of sight");
  let top = 0;
  for (let i = 0; i < 60 * 25; i++) { step({ world, fleet, autopilot: idle }); top = Math.max(top, plow.v); }
  assert.equal(fleet.vehicles.filter(isPlow).length, 1, "still one");
  assert.ok(top > PLOW_MPS - 0.3 && top < PLOW_MPS + 0.2, `clears at ${(top * 3.6).toFixed(1)} km/h, not slowed by the snow`);
  // (the car far away: the plow is taken off, and another comes later)
  const far = WPG.laneList.find((l) => l.length > 30 && Math.hypot(pointAt(l.pts, l.cum, 10)[0] - plow.x, pointAt(l.pts, l.cum, 10)[1] - plow.y) > PLOW_GONE_M + 100);
  world.placeOnLane(far, 10);
  step({ world, fleet, autopilot: idle });
  assert.ok(!fleet.vehicles.includes(plow), "taken off out of sight");
  assert.ok(fleet.nextPlow >= world.t + 25, "another later");
  const dry = william({ weather: "dry", plows: PLOW_COUNT, seed: 7 });
  for (let i = 0; i < 60 * 5; i++) step({ world: dry.world, fleet: dry.fleet, autopilot: idle });
  assert.equal(dry.fleet.vehicles.filter(isPlow).length, 0, "none in dry weather");
  const off = william({ plows: 0, seed: 7 });
  for (let i = 0; i < 60 * 5; i++) step({ world: off.world, fleet: off.fleet, autopilot: idle });
  assert.equal(off.fleet.vehicles.filter(isPlow).length, 0, "none unless asked for");
  assert.equal(new NpcFleet(new World(WPG, { seed: 1, weather: "snow" }), { count: 0, bikes: 0 }).plowTarget, 0, "the benchmark and challenges ask for none");
  setWeather("dry");
});

await test("traffic stays behind a plow in the lane to its left, never passes one on the right, and passes one on the left only with a clear view", () => {
  // (a car in the curb lane behind a plow in the left lane, the curb lane empty ahead)
  for (const w of ["snow", "dry"]) {
    const { world, fleet } = william({ weather: w, s: 20 });
    const plow = fleet.addPlow(WPG.lane(EDGE, 0), 70, PLOW_MPS, [[NEXT, 0]]);
    const car = npc(world, fleet, { lane: 1, s: 40, v: 8, id: "curb" });
    let level = false;
    for (let i = 0; i < 60 * 30; i++) { step({ world, fleet, autopilot: idle }); if (plowRelation(car, plow)?.ahead_m <= 0) level = true; }
    assert.ok(!level, `${w}: the car in the curb lane stays behind`);
  }
  // (followers settle the stay-back distance behind it, in its lane or the lane to its right; in falling
  // snow, one in the lane to its left stays behind it too)
  for (const [lane, own] of [[1, 1], [0, 1], [1, 0]]) {
    const { world, fleet } = william({ weather: "snow", s: 20 });
    const plow = fleet.addPlow(WPG.lane(EDGE, lane), 90, PLOW_MPS, [[NEXT, lane]]);
    const car = npc(world, fleet, { lane: own, s: 50, v: 6, id: "follower" });
    let gap = Infinity, level = false;
    for (let i = 0; i < 60 * 40; i++) {
      step({ world, fleet, autopilot: idle });
      const r = plowRelation(car, plow);
      if (r?.ahead_m <= 0) level = true;
      if (i > 60 * 20 && r) gap = Math.min(gap, r.gap_m);
    }
    assert.ok(!level && gap > STAY_BACK_M - 1, `plow in lane ${lane}, car in lane ${own}: ${gap.toFixed(1)} m back`);
  }
  // (a car eager to pass, behind a plow in its own lane: in the left lane it never moves right to pass;
  // in the curb lane it moves out to the left, but only with a clear view ahead)
  for (const [w, lane, passes] of [["dry", 0, false], ["snow", 1, false], ["dry", 1, true]]) {
    const { world, fleet } = william({ weather: w, s: 20 });
    const plow = fleet.addPlow(WPG.lane(EDGE, lane), 75, PLOW_MPS, [[NEXT, lane]]);
    const car = npc(world, fleet, { lane, s: 45, v: 6, id: "eager", lcRate: 1000 });
    let side = null;
    for (let i = 0; i < 60 * 40 && side === null; i++) { step({ world, fleet, autopilot: idle }); const r = plowRelation(car, plow); if (r && r.ahead_m <= 0) side = r.right_m; }
    if (passes) assert.ok(side !== null && side > 1.7, `${w}, lane ${lane}: passes on the left (${side?.toFixed(2)})`);
    else assert.equal(side, null, `${w}, lane ${lane}: stays behind`);
  }
  setWeather("dry");
});

await test("the driven car's sensing: the plow, in which lane, the stay-back speed, and whether it may pass it on the left", () => {
  const { world, fleet } = william({ weather: "snow", v: 5 });
  const plow = plowAhead(world, fleet, { lane: 0, gap: 20 });
  let snap = buildSnapshot(world);
  const sp = snap.snow_plow;
  assert.equal(sp.id, plow.id);
  assert.equal(sp.lane, "left");
  assert.ok(sp.holds && !sp.passing && sp.keep_back_m === STAY_BACK_M && Math.abs(sp.gap_m - 20) < 0.6);
  assert.ok(snap.target.v < PLOW_MPS && snap.target.reasons.includes("staying 30 m behind the snow plow"), `${snap.target.v.toFixed(2)} m/s`);
  plow.signal = "left";
  snap = buildSnapshot(world);
  assert.ok(!snap.snow_plow.holds && snap.snow_plow.turning_left, "one turning left may be passed on the right");
  plow.signal = null;
  // (in its lane: followed as a snow plow; in falling snow it may not be passed)
  const b = william({ weather: "snow", v: 5 });
  plowAhead(b.world, b.fleet, { lane: 1, gap: 25 });
  snap = buildSnapshot(b.world);
  assert.equal(snap.snow_plow.lane, "same");
  assert.equal(snap.following.kind, "snow plow");
  assert.ok(!snap.snow_plow.may_pass, "not in falling snow");
  assert.ok(!Object.values(snap.lane.sides).some((side) => side.offer === "pass"), "no pass on offer");
  // (in clear weather: on the left only, the left lane at its own speed)
  const c = william({ weather: "dry", v: 5 });
  plowAhead(c.world, c.fleet, { lane: 1, gap: 25 });
  snap = buildSnapshot(c.world);
  assert.ok(snap.snow_plow.may_pass);
  assert.equal(snap.lane.sides.left.offer, "pass");
  assert.ok(snap.lane.sides.left.target_v > 13, "the left lane is free of the plow's stay-back");
  assert.ok(!snap.lane.sides.right, "no lane to its right");
  // (in the left lane behind a plow, no pass on the right)
  const d = william({ weather: "dry", lane: 0, v: 5 });
  plowAhead(d.world, d.fleet, { lane: 0, gap: 25 });
  snap = buildSnapshot(d.world);
  assert.ok(snap.lane.sides.right && snap.lane.sides.right.offer !== "pass", "never to the right to pass it");
  // (nothing without a plow)
  assert.equal(buildSnapshot(william({ weather: "snow" }).world).snow_plow, null);
  setWeather("dry");
});

await test("candidates: none takes the car past a plow on its right, nor closes in inside the stay-back distance", () => {
  const { world, fleet } = william({ weather: "dry", v: 10 });
  plowAhead(world, fleet, { lane: 0, gap: 6 });
  let snap = buildSnapshot(world), cands = sampleCandidates(snap, world), res = simulateAll(cands, snap, world);
  assert.ok(res.rejected.passes_plow_on_right > 0, JSON.stringify(res.rejected));
  assert.ok(res.eligible.length > 0 && res.eligible.every((c) => c.law.kind === "hard_brake" || c.sim.end_speed < 10), "only slowing down is left");
  const b = william({ weather: "dry", v: 8 });
  plowAhead(b.world, b.fleet, { lane: 1, gap: 22 });
  snap = buildSnapshot(b.world); cands = sampleCandidates(snap, b.world); res = simulateAll(cands, snap, b.world);
  assert.ok(res.rejected.follows_plow_too_close > 0, JSON.stringify(res.rejected));
  assert.ok(res.eligible.some((c) => c.id.startsWith("change_left")), "passing on the left stays on offer");
  setWeather("dry");
});

await test("closed loop: Rules passes a curb-lane plow on the left in clear weather and moves back in 30 m ahead; in snow, in rain, or with the plow in the left lane it stays 30 m back", async () => {
  const pass = william({ weather: "dry", s: 15 });
  const plow = pass.fleet.addPlow(WPG.lane(EDGE, 1), 60, PLOW_MPS, [[NEXT, 1]]);
  const r = await closedLoop(pass, plow, { limit: 40 });
  assert.ok(r.level !== null && r.level > 1.7, `passed it with the plow on its right (${r.level?.toFixed(2)})`);
  assert.ok(r.backIn !== null && r.backIn >= STAY_BACK_M, `back in ${r.backIn?.toFixed(1)} m ahead of it`);
  assert.equal(pass.world.violations.plow_right_passes, 0);
  assert.ok(!pass.world.events.some((e) => e.type === "cut_in_front_of_plow"));
  // (and in the left lane, with the plow in the curb lane on its right, in falling snow: no passing it
  // at all)
  for (const [w, lane, own = 1] of [["snow", 1], ["rain", 1], ["dry", 0], ["snow", 0], ["snow", 1, 0]]) {
    const ctx = william({ weather: w, lane: own, s: 15 });
    const p = ctx.fleet.addPlow(WPG.lane(EDGE, lane), 60, PLOW_MPS, [[NEXT, lane]]);
    const q = await closedLoop(ctx, p, { limit: 50 });
    assert.equal(q.level, null, `${w}, car in lane ${own}, plow in lane ${lane}: stays behind`);
    assert.ok(q.minGap > STAY_BACK_M - 1.5, `${w}, car in lane ${own}, plow in lane ${lane}: at least ${q.minGap.toFixed(1)} m back`);
  }
  // (above 80 km/h, as far back as it can see, toward 100 m)
  const fast = ["e481", "e343"].map((id) => [id, WPG.edges.get(id).limit]);
  for (const [id] of fast) WPG.edges.get(id).limit = 90 / 3.6;
  try {
    const ctx = william({ weather: "dry", s: 15 });
    const p = ctx.fleet.addPlow(WPG.lane(EDGE, 1), 150, PLOW_MPS, [[NEXT, 1]]);
    const q = await closedLoop(ctx, p, { limit: 60, settle: 25 });
    assert.equal(q.level, null, "stays behind");
    assert.ok(q.minGap > 70, `above 80 km/h, ${q.minGap.toFixed(1)} m back`);
    // (and traffic, which sees as far as it needs to, 100 m)
    const t = william({ weather: "dry", s: 15 });
    const tp = t.fleet.addPlow(WPG.lane(EDGE, 1), 160, PLOW_MPS, [[NEXT, 1]]);
    const car = npc(t.world, t.fleet, { lane: 1, s: 40, v: 10, id: "fast_follower" });
    let gap = Infinity;
    for (let i = 0; i < 60 * 50; i++) { step({ world: t.world, fleet: t.fleet, autopilot: idle }); if (i > 60 * 30) gap = Math.min(gap, plowRelation(car, tp)?.gap_m ?? Infinity); }
    assert.ok(gap > 98, `traffic above 80 km/h: ${gap.toFixed(1)} m back`);
  } finally { for (const [id, limit] of fast) WPG.edges.get(id).limit = limit; }
  setWeather("dry");
});

await test("the audit: passing a plow on the right fails the drive, once a pass; one turning left may be passed on the right; moving back in too soon after passing on the left is noted", () => {
  const { world, fleet } = william({ weather: "snow", s: 20 });
  const plow = fleet.addPlow(WPG.lane(EDGE, 0), 80, 0, [[NEXT, 0]]);
  const drive = (lane, from, to) => {
    const l = WPG.lane(EDGE, lane);
    for (let s = from; s <= to; s += 0.5) {
      const p = pointAt(l.pts, l.cum, s);
      Object.assign(world.ego, { x: p[0], y: p[1], psi: headingAt(l.pts, l.cum, s), v: 8 });
      world.auditPlows();
    }
  };
  drive(1, 40, 120);
  assert.equal(world.violations.plow_right_passes, 1, "passed on the right");
  assert.ok(world.plowsSeen && world.events.some((e) => e.type === "passed_plow_on_right" && e.plow === plow.id));
  drive(1, 100, 120);
  assert.equal(world.violations.plow_right_passes, 1, "once a pass");
  drive(1, 40, 120);
  assert.equal(world.violations.plow_right_passes, 2, "and again after dropping back behind it");
  plow.signal = "left";
  drive(1, 40, 120);
  assert.equal(world.violations.plow_right_passes, 2, "not a plow turning left");
  plow.signal = null;
  // (past a plow in the curb lane on its left, then straight back into its lane 10 m ahead of it)
  const curb = fleet.addPlow(WPG.lane(EDGE, 1), 220, 0, [[NEXT, 1]]);
  world.events.length = 0;
  drive(0, 180, 236);
  drive(1, 236, 240);
  assert.equal(world.violations.plow_right_passes, 2, "passing on the left is not passing on the right");
  assert.ok(world.events.some((e) => e.type === "cut_in_front_of_plow" && e.plow === curb.id), "cut in");
  const m = new DriveMetrics(500).summary(world, { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true);
  assert.equal(m.plow_right_passes, 2);
  assert.ok(m.failures.includes("passed plow on the right") && !m.pass);
  const none = new DriveMetrics(500).summary(new World(WPG, { seed: 1 }), { totals: { decisions: 0, calls: 0, tokens: 0, cost: 0 } }, true);
  assert.ok(!("plow_right_passes" in none), "reported only for a drive a plow worked in");
  assert.ok(!failures({ arrived: true, plow_right_passes: 0, off_road_s: 0 }).length);
  setWeather("dry");
});

await test("coaching: following a plow too closely, passing one on the right and cutting in, with tips; reported only for a drive a plow worked in", () => {
  const { world, fleet } = william({ weather: "snow", s: 100 });
  plowAhead(world, fleet, { lane: 1, gap: 12, v: 4 });
  world.ego.v = 4;
  const score = new DriveScore(world);
  world.plowsSeen = true;
  for (let i = 0; i < 120; i++) score.record(world, world.roadInfo(), 1 / 60);
  world.events.push({ type: "passed_plow_on_right", plow: "plow_1" }, { type: "cut_in_front_of_plow", plow: "plow_1" });
  score.record(world, world.roadInfo(), 1 / 60);
  const r = score.snapshot();
  assert.ok(r.plow_close_s > 1.5, `${r.plow_close_s} s too close`);
  assert.equal(r.plow_right_passes, 1);
  assert.equal(r.plow_cut_ins, 1);
  assert.ok(r.incidents.some((i) => i.type === "plow_close") && r.incidents.some((i) => i.type === "plow_right_pass"));
  assert.ok(r.tips.some((t) => t.includes("Never pass a snow plow on the right")) && r.tips.some((t) => t.includes("30 m behind a snow plow")));
  assert.ok(r.categories.legality < 100 && r.categories.safety < 100);
  const plain = new DriveScore(new World(WPG, { seed: 1 })).snapshot();
  assert.ok(!("plow_close_s" in plain), "nothing without plows");
  setWeather("dry");
});

await test("what models are told: the plow in the state, a situation line for each case, and a prompt line", () => {
  const { world, fleet } = william({ weather: "snow", v: 5 });
  plowAhead(world, fleet, { lane: 0, gap: 20 });
  let snap = buildSnapshot(world), cands = sampleCandidates(snap, world), res = simulateAll(cands, snap, world);
  let state = toJevState(snap, res.eligible, {});
  assert.equal(state.snow_plow.lane, "the lane to the car's left");
  assert.equal(state.snow_plow.keep_back_m, 30);
  assert.equal(state.snow_plow.pass, "do not pass");
  assert.ok(situationClauses(snap).some((l) => l.includes("Never pass a snow plow on the right")));
  const c = william({ weather: "dry", v: 5 });
  plowAhead(c.world, c.fleet, { lane: 1, gap: 25 });
  snap = buildSnapshot(c.world); cands = sampleCandidates(snap, c.world); res = simulateAll(cands, snap, c.world);
  state = toJevState(snap, res.eligible, {});
  assert.equal(state.snow_plow.pass, "on the left only");
  assert.ok(situationClauses(snap).some((l) => l.includes("Pass it only on the left")));
  assert.ok(SYSTEM_PROMPT.includes("snow_plow") && SYSTEM_PROMPT.includes("Never pass one on the right"));
  setWeather("dry");
});

await test("the HUD: stay back, never pass on the right, and back in only well ahead", () => {
  const a = william({ weather: "snow" });
  plowAhead(a.world, a.fleet, { lane: 0, gap: 20 });
  assert.equal(plowNotice(a.world).text, "SNOW PLOW · NEVER PASS ON THE RIGHT · STAY 30 M BACK");
  const b = william({ weather: "snow" });
  plowAhead(b.world, b.fleet, { lane: 1, gap: 20 });
  assert.equal(plowNotice(b.world).text, "SNOW PLOW AHEAD · STAY 30 M BACK");
  assert.ok(plowNotice(b.world).wait);
  const c = william({ weather: "dry", lane: 0 });
  plowAhead(c.world, c.fleet, { lane: 1, gap: -6 });
  assert.equal(plowNotice(c.world).text, "PASSING THE SNOW PLOW · BACK IN ONLY 30 M AHEAD OF IT");
  assert.equal(plowNotice(william({ weather: "snow" }).world), null);
  setWeather("dry");
});

await test("a restored checkpoint keeps the plow, and the fleet's list of plows points at it", () => {
  const challenge = CHALLENGES.find((c) => c.id === "snow-plow");
  const ctx = setupChallenge(WPG, challenge);
  const recorder = new DriveRecorder();
  recorder.record({ world: ctx.world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: {}, clock: {} }, true);
  for (let i = 0; i < 60; i++) step(ctx);
  const target = { world: ctx.world, fleet: ctx.fleet, autopilot: ctx.autopilot, clock: { setHour() {}, update() {} }, setDrive() {} };
  recorder.restore(0, target);
  const plow = ctx.fleet.vehicles.find(isPlow);
  assert.ok(plow && ctx.fleet.plows.length === 1 && ctx.fleet.plows[0] === plow, "the same plow");
  ctx.autopilot.setEnabled(false);
  setWeather("dry");
});

await test("the challenge, closed loop: Rules and the cautious agent stay 30 m behind the plow in the curb lane all the way, never passing it on the right; without the rule, Rules goes by on the right", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "snow-plow");
  assert.equal(challenge.map, "winnipeg");
  assert.equal(challenge.weather, "snow");
  for (const brain of ["rules", "cautious", "disguised"]) {
    let arrived = false;
    const ctx = setupChallenge(WPG, challenge, { brain: brain === "disguised" ? "rules" : brain, onEvent: (e) => { if (e.type === "arrived") arrived = true; } });
    const { world, fleet, autopilot } = ctx, plow = fleet.vehicles.find(isPlow);
    assert.equal(WPG.edges.get(world.route.edges[0]).name, "William Avenue");
    assert.equal(plowRelation(world.ego, plow).lane, "left", "the plow in the left lane");
    // (the same truck, not known to be a plow: clearing at the same speed)
    if (brain === "disguised") { plow.kind = "dump_truck"; plow.v0 = PLOW_MPS / weather.speed; fleet.plows = []; }
    let level = null, minGap = Infinity;
    while (world.t < 120 && autopilot.enabled && !arrived) {
      step(ctx);
      if (autopilot.firing) await autopilot.firing;
      const kind = plow.kind; plow.kind = "snow_plow";
      const rel = plowRelation(world.ego, plow);
      plow.kind = kind;
      if (rel && rel.ahead_m <= 0 && level === null) level = rel.right_m;
      if (rel && world.t > 15 && level === null) minGap = Math.min(minGap, rel.gap_m);
    }
    const v = world.violations;
    assert.ok(arrived, `${brain} arrives`);
    assert.equal(v.collisions + v.red_lights_run + v.stop_signs_run + v.failed_to_yield, 0, `${brain}: ${JSON.stringify(v)}`);
    if (brain === "disguised") { assert.ok(level !== null && level < -1.7, `goes by on the right (${level?.toFixed(2)})`); continue; }
    assert.equal(level, null, `${brain} never draws level with it`);
    assert.equal(v.plow_right_passes, 0);
    assert.ok(minGap > STAY_BACK_M - 1.5, `${brain} stays ${minGap.toFixed(1)} m back`);
  }
  setWeather("dry");
});

console.log(`${checks} snow plow checks passed`);
process.exit(0);
