// Lane closures and the zipper merge (as Manitoba's driver's handbook teaches it): where they can go, the
// layout, traffic taking turns one from each lane at the merge point and keeping its lane on the way up,
// the driven car's sensing, its wait, its turn and its letting someone in, what models are told, the
// audit of merging out of turn, coaching, the HUD, free-drive closures, checkpoints, and the "Take turns"
// challenge, where the car merges after the third car in the open lane, not straight after the second
// car in its own.
// node --experimental-default-type=module scripts/test_lane_closures.mjs
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
const { detourAt } = await import("../static/js/sim/controller.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { AHEAD_M, GIVE_UP_S, LANE_CLOSURE_COUNT, LC_LIMIT_MPS, LET_IN_M, SPAN_M, TAPER_M, detourOf, laneClosureNotice, laneClosureSites } = await import("../static/js/sim/lane-closure.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, needsMotionQuestion } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  pack.utc_offset = -6;
  return new MapData(pack);
};
const CAL = load("a53c5bcf6438");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const FRONT = CAR.length - CAR.rearOverhang;
// 14 Avenue SW, Calgary: one-way, two lanes, 50 km/h, 222 m to the signal at 4 Street SW (its line 209 m
// along). Lane 1 (the right, curb lane) is the one closed.
const EDGE = "e592", NEXT = "e594", M = 70, E = CAL.edges.get(EDGE), CLOSED = 1, OPEN = 0;
function street({ parked = 0 } = {}) {
  setWeather("dry");
  const world = new World(CAL, { seed: 3, parked, pedestrians: 0 });
  const zone = world.laneClosures.place({ edge: EDGE, m: M });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  world.npcs = fleet.vehicles;
  return { world, fleet, zone };
}
// A car of the traffic in `lane`, its front at `front` along the street, at `v`.
function car(ctx, lane, front, id, { v = 0, lcRate = 0, v0 = 11 } = {}) {
  const L = CAL.lane(EDGE, lane), s = front - FRONT, p = pointAt(L.pts, L.cum, s);
  const n = new Vehicle(p[0], p[1], headingAt(L.pts, L.cum, s), v);
  Object.assign(n, { id, color: 0x8d9299, v0, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate }, stopMem: new StopMemory(), path: new NpcPath(CAL, ctx.fleet.random), frozen: 0, waiting: 0 });
  n.path.start(EDGE, lane, s, [[NEXT, lane]]);
  ctx.fleet.vehicles.push(n);
  return n;
}
// The driven car with its front at `front` in `lane`, at `v`, on a route along the street and on.
function drive(world, lane, front, v = 0) {
  const L = CAL.lane(EDGE, lane);
  world.placeOnLane(L, front - FRONT);
  world.ego.v = v;
  world.resetContactHistory();
  world.route = new Route(routeFromLanes(CAL, [L, CAL.lane(NEXT, lane)], front - FRONT, 60), CAL, world.ego.spec);
}
const along = (v) => projectPoint(E.pts, E.cum, [v.x, v.y], null);
const frontOf = (v) => along(v).s + ((v.spec || CAR).length - (v.spec || CAR).rearOverhang);
// Run until `until(world)` or `limit` s, with the car on Rules (or not driven, `idle`): returns the
// order through the merge point and the car's events.
async function run(ctx, { limit = 60, idle = false, until = () => false } = {}) {
  const autopilot = idle ? { enabled: false, step() {} } : new Autopilot(ctx.world, {});
  if (!idle) { autopilot.setBrain("rules"); autopilot.setEnabled(true); }
  const c = { ...ctx, autopilot }, events = [];
  let overlap = false;
  while (ctx.world.t < limit && !until(ctx.world)) {
    step(c);
    if (autopilot.firing) await autopilot.firing;
    events.push(...ctx.world.events);
    // (nobody in the closed stretch)
    for (const n of [ctx.world.ego, ...ctx.fleet.vehicles]) if (obbOverlap(n.obb(), ctx.zone.closure.obb(), 0)) overlap = true;
  }
  return { order: [...ctx.zone.passed], events, overlap, autopilot };
}

await test("sites: straight blocks with two lanes going the same way, no transit, crosswalk or level crossing, clear of their junctions; 14 Avenue SW among them", () => {
  const sites = laneClosureSites(CAL);
  assert.ok(sites.some((s) => s.edge === EDGE), "14 Avenue SW");
  const routed = new Set();
  for (const r of CAL.transit?.routes || []) for (const run of r.runs || []) for (const id of run.edges || []) routed.add(id);
  for (const s of sites) {
    const e = CAL.edges.get(s.edge);
    assert.equal(e.lanes, 2);
    assert.ok(!routed.has(s.edge) && !(CAL.crosswalks || []).some((c) => c.edge === s.edge));
    assert.ok(s.lo >= 40 && s.hi + SPAN_M <= Math.min(e.length, e.control?.s_line ?? e.length) - 20 + 1e-6);
  }
  let total = 0;
  for (const key of ["623b012bc8b5", "4a96d42cb3f2", "19bb885c9cae", "d25b07def0d2", "ca5573a8d934"]) total += laneClosureSites(load(key)).length;
  assert.ok(total >= 10, `${total} more on five other maps`);
});

await test("layout: the merge point, the taper, the closed stretch over the curb lane only, the way back; the detour moves the closed lane's traffic left into the open lane", () => {
  const { world, zone } = street();
  assert.equal(zone.closed, CLOSED); assert.equal(zone.open, OPEN);
  assert.equal(zone.r, M + TAPER_M + 2); assert.equal(zone.to, M + SPAN_M);
  assert.ok(Math.abs(zone.shift - (E.lane_offsets[OPEN] - E.lane_offsets[CLOSED])) < 1e-9 && zone.shift < -3);
  const c = zone.closure, p = along(c);
  assert.ok(Math.abs(p.s - zone.r) < 0.2 && c.spec.length === 24, "the work starts where the taper ends");
  const halfW = c.spec.width / 2, lat = p.lateral;
  assert.ok(lat - halfW > (E.lane_offsets[0] + E.lane_offsets[1]) / 2, "clear of the open lane");
  assert.ok(lat + halfW >= E.asphalt[1] - 0.2, "out to the curb");
  assert.ok(world.parked.list.includes(c));
  const d = detourOf(zone);
  assert.equal(detourAt(d, M), 0); assert.ok(Math.abs(detourAt(d, M + TAPER_M + 5) - zone.shift) < 1e-9); assert.equal(detourAt(d, zone.to), 0);
});

await test("taking turns: with both lanes queued, traffic goes one from each lane, the closed lane's cars wait at the merge point, nobody runs into the closed stretch", async () => {
  const ctx = street();
  car(ctx, CLOSED, M - 0.5, "c1"); car(ctx, CLOSED, M - 8.5, "c2"); car(ctx, CLOSED, M - 16.5, "c3");
  for (let i = 0; i < 5; i++) car(ctx, OPEN, M - 1 - i * 7.5, `o${i + 1}`);
  drive(ctx.world, OPEN, 5);
  const { order, overlap } = await run(ctx, { limit: 50, idle: true });
  assert.deepEqual(order.slice(0, 6), ["o1", "c1", "o2", "c2", "o3", "c3"], order.join(" "));
  assert.equal(overlap, false);
  // (and everyone ends up through the closed stretch and past it)
  for (const n of ctx.fleet.vehicles) assert.ok(frontOf(n) > ctx.zone.to || !CAL.edges.has(n.path.currentEdge().id) || n.path.currentEdge().id !== EDGE, `${n.id} through`);
});

await test("light traffic: a car alone in the closed lane is let in at once and merges without stopping; one in the open lane goes on by", async () => {
  const ctx = street();
  const c = car(ctx, CLOSED, M - 40, "c1", { v: 8 }), o = car(ctx, OPEN, M - 58, "o1", { v: 8 });
  drive(ctx.world, OPEN, 5);
  let slowest = Infinity, slowestOpen = Infinity;
  const { order } = await run(ctx, { limit: 25, idle: true, until: () => {
    if (frontOf(c) < M + 5) slowest = Math.min(slowest, c.v);
    if (frontOf(o) < M + 5) slowestOpen = Math.min(slowestOpen, o.v);
    return frontOf(o) > M + 10;
  } });
  assert.ok(slowest > 3, `slowest ${slowest.toFixed(2)} m/s`);
  assert.deepEqual(order.slice(0, 2), ["c1", "o1"]);
  assert.ok(slowestOpen > 2, `the open lane's slowest ${slowestOpen.toFixed(2)} m/s`);
});

await test("the zipper: on the way up to the merge nobody changes lanes into or out of the closed lane, even behind a slow car; past the closure, they may", async () => {
  const ctx = street();
  car(ctx, OPEN, M - 10, "slow", { v: 2, v0: 2 });
  const keen = car(ctx, OPEN, M - 40, "keen", { v: 8, lcRate: 1000 });
  const curb = car(ctx, CLOSED, M - 70, "curb", { v: 8, lcRate: 1000 });
  car(ctx, CLOSED, M - 50, "slow2", { v: 2, v0: 2 });
  drive(ctx.world, OPEN, 5);
  let changed = false;
  await run(ctx, { limit: 20, idle: true, until: () => { for (const n of [keen, curb]) if (n.lc && frontOf(n) < ctx.zone.to) changed = true; return false; } });
  assert.equal(changed, false);
});

await test("a 2-minute soak with traffic and cyclists round three closures: nobody in a closed stretch, nobody runs into anyone near them, nobody left stuck at a merge point", async () => {
  setWeather("dry");
  const world = new World(CAL, { seed: 4, pedestrians: 0 });
  const zones = ["e592", "e594", "e328"].map((edge) => world.laneClosures.place({ edge, m: 45 }));
  world.placeOnLane(CAL.lane("e248", 0), 5);
  const fleet = new NpcFleet(world, { count: 80, bikes: 20, seed: 4 }), ctx = { world, fleet, autopilot: { enabled: false, step() {} } };
  let into = 0, hits = 0;
  for (let i = 0; i < 60 * 120; i++) {
    step(ctx);
    if (i % 15) continue;
    const near = fleet.vehicles.filter((v) => zones.some((z) => Math.hypot(v.x - z.x, v.y - z.y) < 90));
    for (const v of near) for (const z of zones) if (obbOverlap(v.obb(), z.closure.obb(), 0)) into++;
    for (let a = 0; a < near.length; a++) for (let b = a + 1; b < near.length; b++) if (Math.hypot(near[a].x - near[b].x, near[a].y - near[b].y) < 6 && obbOverlap(near[a].obb(), near[b].obb(), 0)) hits++;
  }
  assert.equal(into, 0); assert.equal(hits, 0);
  assert.ok(zones.reduce((n, z) => n + z.passed.length, 0) >= 5, "traffic goes through");
  for (const z of zones) {
    const e = CAL.edges.get(z.edge);
    const stuck = fleet.vehicles.filter((v) => { const p = projectPoint(e.pts, e.cum, [v.x, v.y], null); return p && Math.abs(p.lateral) < 6 && p.s > z.m - 30 && p.s < z.m + 2 && v.waiting > 30; });
    assert.equal(stuck.length, 0, `${z.edge}: ${stuck.map((v) => v.id).join(" ")}`);
  }
});

await test("sensing and candidates, closed lane: wait at the merge point on the open lane's turn (`wait_to_merge`), going through it rejected, no early lane change; once let in, the candidates take it across", async () => {
  const ctx = street(), { world, zone } = ctx;
  for (let i = 0; i < 4; i++) car(ctx, OPEN, M - 1 - i * 7.5, `o${i + 1}`);
  // (the car's own lane had the last turn)
  zone.last = "closed";
  drive(world, CLOSED, M - 0.8);
  await run(ctx, { limit: 0.2, idle: true });
  let snap = buildSnapshot(world);
  const lz = snap.lane_closure;
  assert.ok(lz, "reported");
  assert.equal(lz.side, "closed"); assert.equal(lz.closed_lane, "right");
  assert.ok(lz.at_merge && lz.turn === "open" && lz.wait && !lz.let_in, JSON.stringify({ ...lz, detour: null }));
  assert.equal(lz.wait_for, "o1");
  assert.ok(Math.abs(lz.bumper_to_merge_m - 0.8) < 0.6, `${lz.bumper_to_merge_m}`);
  assert.ok(lz.detour && lz.detour.shift < -3);
  assert.ok(snap.limit <= LC_LIMIT_MPS + 0.01);
  let cands = sampleCandidates(snap, world), { rejected } = simulateAll(cands, snap, world);
  assert.ok(cands.some((c) => c.id === "wait_to_merge" && c.eligible), "wait_to_merge on offer");
  assert.ok(rejected.merges_out_of_turn > 0, JSON.stringify(rejected));
  for (const c of cands.filter((c) => c.law.kind === "lane" && !c.change)) assert.ok(c.law.detour, `${c.id} carries the way across`);
  for (const c of cands.filter((c) => c.change?.dir === "left")) assert.equal(c.reject, "merges_early");
  // its turn, once o1 has gone and o2 holds back: let in
  const { order } = await run(ctx, { limit: 15, idle: true, until: () => zone.grant === "ego" });
  assert.equal(zone.grant, "ego");
  assert.deepEqual(order, ["o1"]);
  snap = buildSnapshot(world);
  assert.ok(snap.lane_closure.let_in && !snap.lane_closure.wait);
  cands = sampleCandidates(snap, world); simulateAll(cands, snap, world);
  assert.ok(!cands.some((c) => c.reject === "merges_out_of_turn"));
  // past the merge point, across in the taper, no lane change either way: the way across and back is the candidates' own
  {
    const ctx2 = street();
    // (its route in the open lane, so that going back to it is on offer)
    drive(ctx2.world, CLOSED, M + 6, 6);
    ctx2.world.route = new Route(routeFromLanes(CAL, [CAL.lane(EDGE, OPEN), CAL.lane(NEXT, OPEN)], M + 6 - FRONT, 60), CAL, ctx2.world.ego.spec);
    await run(ctx2, { limit: 0.1, idle: true });
    const snap2 = buildSnapshot(ctx2.world);
    assert.ok(snap2.lane_closure.merged && snap2.lane_closure.side === "closed");
    const c2 = sampleCandidates(snap2, ctx2.world); simulateAll(c2, snap2, ctx2.world);
    assert.ok(c2.some((c) => c.change), "a lane change on offer");
    for (const c of c2.filter((c) => c.change)) assert.equal(c.reject, "into_closed_lane", c.id);
  }
  assert.ok(!cands.some((c) => c.id === "wait_to_merge"));
});

await test("sensing and candidates, open lane: first in the lane, let the car at the merge in (`let_merge_in`), going past where it waits rejected, no moving into the closed lane; further back in the queue, nothing asked", async () => {
  const ctx = street(), { world, zone } = ctx;
  car(ctx, CLOSED, M - 0.5, "c1");
  zone.last = "open";
  drive(world, OPEN, M - LET_IN_M - 6, 1);
  await run(ctx, { limit: 0.1, idle: true });
  assert.equal(zone.turn, "closed");
  const snap = buildSnapshot(world), lz = snap.lane_closure;
  assert.equal(lz.side, "open"); assert.equal(lz.let_in_for, "c1"); assert.equal(lz.detour, null);
  assert.ok(Math.abs(lz.stop_s_route - lz.merge_s_route + LET_IN_M) < 0.6);
  const cands = sampleCandidates(snap, world), { rejected } = simulateAll(cands, snap, world);
  assert.ok(cands.some((c) => c.id === "let_merge_in" && c.eligible));
  assert.ok(rejected.takes_merge_turn > 0, JSON.stringify(rejected));
  for (const c of cands.filter((c) => c.change?.dir === "right")) assert.equal(c.reject, "into_closed_lane");
  // (behind another in the open lane, it is in the queue)
  const ctx2 = street();
  car(ctx2, CLOSED, M - 0.5, "c1"); car(ctx2, OPEN, M - 8, "o1");
  ctx2.zone.last = "open";
  drive(ctx2.world, OPEN, M - 25);
  await run(ctx2, { limit: 0.1, idle: true });
  assert.equal(buildSnapshot(ctx2.world).lane_closure.let_in_for, null);
});

await test("closed loop, Rules: in the closed lane it waits at the merge point for the open lane's car, then merges in its turn; in the open lane it lets the merging car in first", async () => {
  {
    const ctx = street();
    car(ctx, CLOSED, M - 0.5, "c1");
    for (let i = 0; i < 4; i++) car(ctx, OPEN, M - 1 - i * 7.5, `o${i + 1}`);
    drive(ctx.world, CLOSED, M - 14);
    const { order, events, overlap } = await run(ctx, { limit: 50, until: (w) => frontOf(w.ego) > ctx.zone.to + 5 });
    assert.deepEqual(order.slice(0, 4), ["o1", "c1", "o2", "ego"], order.join(" "));
    assert.equal(overlap, false);
    assert.ok(!events.some((e) => ["collision", "merged_out_of_turn", "merged_early"].includes(e.type)), JSON.stringify(events));
    assert.equal(ctx.world.violations.merge_cut_ins || 0, 0);
  }
  {
    const ctx = street();
    const c = car(ctx, CLOSED, M - 20, "c1", { v: 4 });
    drive(ctx.world, OPEN, M - 30, 4);
    const { order, events } = await run(ctx, { limit: 40, until: (w) => frontOf(w.ego) > ctx.zone.to });
    assert.deepEqual(order.slice(0, 2), ["c1", "ego"], order.join(" "));
    assert.ok(!events.some((e) => ["collision", "took_merge_turn"].includes(e.type)), JSON.stringify(events));
    assert.ok(frontOf(c) > ctx.zone.to - 30);
  }
});

await test("what models are told: `lane_closure` in the state, a situation line, the stop criterion while waiting, and the prompt line", async () => {
  const ctx = street(), { world, zone } = ctx;
  car(ctx, OPEN, M - 1, "o1");
  zone.last = "closed";
  drive(world, CLOSED, M - 1.2);
  await run(ctx, { limit: 0.1, idle: true });
  const snap = buildSnapshot(world), cands = sampleCandidates(snap, world), { eligible } = simulateAll(cands, snap, world);
  const state = toJevState(snap, eligible, {});
  assert.equal(state.lane_closure.lane.startsWith("closed"), true);
  assert.equal(state.lane_closure.stop, true); assert.equal(state.lane_closure.goes_first, "o1"); assert.equal(state.lane_closure.your_turn, false);
  const text = situationClauses(snap).join(" ");
  assert.match(text, /zipper merge/); assert.match(text, /not the car's turn yet: `o1`/);
  assert.equal(needsMotionQuestion(snap), true);
  assert.match(SYSTEM_PROMPT, /wait_to_merge/); assert.match(SYSTEM_PROMPT, /let_merge_in/);
  // (further back, coming up the closed lane, it is told to keep to it, not that it is too close to stop)
  drive(world, CLOSED, M - 60, 8);
  await run(ctx, { limit: world.t + 0.1, idle: true });
  const far = situationClauses(buildSnapshot(world)).join(" ");
  assert.match(far, /Keep to the car's lane up to the merge point/); assert.doesNotMatch(far, /too close to stop/);
});

await test("the audit: going through the merge point out of turn, forcing in, fails the drive; merging early and not letting someone in are coached", async () => {
  // forcing in: stopped at the merge point on the open lane's turn, then driven through by hand
  {
    const ctx = street(), { world, zone } = ctx;
    for (let i = 0; i < 3; i++) car(ctx, OPEN, M - 3 - i * 7.5, `o${i + 1}`);
    zone.last = "closed";
    drive(world, CLOSED, M - 1);
    const score = new DriveScore(world, { title: "t", map: "calgary", driver: "manual", route: world.route }), metrics = new DriveMetrics(world.route.length);
    const c = { ...ctx, autopilot: { enabled: false, step() {} }, input: { throttle: true } };
    let ev = null;
    while (world.t < 6 && !ev) {
      const road = step(c); score.record(world, road, 1 / 60); metrics.record(world, null, road, 1 / 60);
      ev = world.events.find((e) => e.type === "merged_out_of_turn") || null;
    }
    assert.ok(ev, "merged out of turn");
    assert.equal(world.violations.merge_cut_ins, 1);
    assert.ok(ev.cut && ev.cut.startsWith("o"), JSON.stringify(ev));
    const m = metrics.summary(world, { totals: { decisions: 0, fallbacks: 0 }, brainName: "manual" }, false);
    assert.equal(m.merge_cut_ins, 1);
    assert.ok(failures(m).includes("merged out of turn"));
    const report = score.snapshot();
    assert.equal(report.merge_cut_ins, 1);
    assert.ok(report.tips.some((t) => /zipper merge/.test(t)));
  }
  // let in, the same push through is fine
  {
    const ctx = street(), { world, zone } = ctx;
    car(ctx, OPEN, M - 30, "o1");
    zone.last = "open";
    drive(world, CLOSED, M - 1);
    const c = { ...ctx, autopilot: { enabled: false, step() {} }, input: { throttle: true } };
    let through = false;
    while (world.t < 6) { step(c); through ||= zone.passed.includes("ego"); }
    assert.ok(through);
    assert.equal(world.violations.merge_cut_ins || 0, 0);
  }
  // merging early: across into the open lane 40 m short of the merge point
  {
    const ctx = street(), { world } = ctx;
    drive(world, CLOSED, M - 50);
    const c = { ...ctx, autopilot: { enabled: false, step() {} } };
    step(c);
    const L = CAL.lane(EDGE, OPEN), p = pointAt(L.pts, L.cum, M - 50 - FRONT + 0.2);
    world.ego.x = p[0]; world.ego.y = p[1];
    step(c);
    assert.ok(world.events.some((e) => e.type === "merged_early"));
  }
  // not letting the car at the merge in: first in the open lane, driven past where it would wait
  {
    const ctx = street(), { world, zone } = ctx;
    car(ctx, CLOSED, M - 0.5, "c1");
    zone.last = "open";
    drive(world, OPEN, M - LET_IN_M - 15, 6);
    const score = new DriveScore(world, { title: "t", map: "calgary", driver: "manual", route: world.route });
    const c = { ...ctx, autopilot: { enabled: false, step() {} }, input: { throttle: true } };
    let took = null;
    while (world.t < 6 && !took) { const road = step(c); score.record(world, road, 1 / 60); took = world.events.find((e) => e.type === "took_merge_turn") || null; }
    assert.ok(took, "took its turn");
    assert.equal(world.violations.merge_cut_ins || 0, 0);
    assert.equal(score.snapshot().merge_turns_taken, 1);
  }
});

await test("a head that does not go on its turn, let in or stuck short of the merge point, loses it after GIVE_UP_S, and the open lane goes", async () => {
  {
    const ctx = street(), { world, zone } = ctx;
    car(ctx, OPEN, M - 3, "o1"); car(ctx, OPEN, M - 10.5, "o2");
    drive(world, CLOSED, M - 9);
    const { order } = await run(ctx, { limit: 3 * GIVE_UP_S + 10, idle: true, until: () => zone.passed.includes("o2") });
    assert.deepEqual(order, ["o1", "o2"]);
  }
  const ctx = street(), { world, zone } = ctx;
  car(ctx, OPEN, M - 20, "o1");
  drive(world, CLOSED, M - 0.5);
  const { order } = await run(ctx, { limit: GIVE_UP_S + 8, idle: true, until: () => zone.passed.includes("o1") });
  assert.deepEqual(order, ["o1"]);
  assert.ok(world.t > GIVE_UP_S, `${world.t.toFixed(1)} s`);
  // (and with nobody else coming in the open lane, it has its turn again, and is let in)
  await run(ctx, { limit: world.t + 10, idle: true, until: () => frontOf(ctx.fleet.vehicles[0]) > M + 60 });
  assert.equal(zone.turn, "closed"); assert.equal(zone.grant, "ego");
});

await test("the HUD: lane closed ahead, wait your turn, your turn, and letting one in", async () => {
  const ctx = street(), { world, zone } = ctx;
  drive(world, CLOSED, M - 60);
  step({ ...ctx, autopilot: { enabled: false, step() {} } });
  assert.match(laneClosureNotice(world).text, /RIGHT LANE CLOSED AHEAD · STAY IN LANE TO THE MERGE · TAKE TURNS/);
  car(ctx, OPEN, M - 3, "o1");
  zone.last = "closed";
  drive(world, CLOSED, M - 2);
  step({ ...ctx, autopilot: { enabled: false, step() {} } });
  assert.match(laneClosureNotice(world).text, /WAIT YOUR TURN/);
  zone.last = "open"; zone.grant = "ego";
  assert.match(laneClosureNotice(world).text, /YOUR TURN · MERGE NOW/);
  const ctx2 = street();
  car(ctx2, CLOSED, M - 0.5, "c1");
  ctx2.zone.last = "open";
  drive(ctx2.world, OPEN, M - LET_IN_M - 6);
  step({ ...ctx2, autopilot: { enabled: false, step() {} } });
  assert.match(laneClosureNotice(ctx2.world).text, /LET ONE CAR IN/);
});

await test("free drive: one closure at a time, put up out of sight 150 to 450 m away, packed up once it has stood its time and the car is away; none, and no random draws, when off", async () => {
  setWeather("dry");
  const world = new World(CAL, { seed: 4, parked: 0, pedestrians: 0, closures: LANE_CLOSURE_COUNT });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  world.npcs = fleet.vehicles;
  const L = CAL.lane("e328", 1);
  world.placeOnLane(L, 20);
  const ctx = { world, fleet, autopilot: { enabled: false, step() {} } };
  for (let i = 0; i < 60 * 30 && !world.laneClosures.zones.length; i++) step(ctx);
  const z = world.laneClosures.zones[0];
  assert.ok(z, "one stands");
  const d = Math.hypot(z.x - world.ego.x, z.y - world.ego.y);
  assert.ok(d > 100 && d < 500, `${d.toFixed(0)} m`);
  assert.equal(world.laneClosures.zones.length, 1);
  z.left = 0;
  // (far off and out of sight: the lane furthest from it)
  const away = [...CAL.lanes.values()].sort((a, b) => Math.hypot(b.pts[0][0] - z.x, b.pts[0][1] - z.y) - Math.hypot(a.pts[0][0] - z.x, a.pts[0][1] - z.y))[0];
  world.placeOnLane(away, 2);
  assert.ok(Math.hypot(z.x - world.ego.x, z.y - world.ego.y) > 150 && !world.laneClosures.seen(z));
  step(ctx);
  assert.ok(!world.laneClosures.zones.includes(z), "packed up");
  assert.ok(!world.parked.list.includes(z.closure));
  const off = new World(CAL, { seed: 4, parked: 0, pedestrians: 0 }), before = off.laneClosures.random();
  const off2 = new World(CAL, { seed: 4, parked: 0, pedestrians: 0 });
  for (let i = 0; i < 120; i++) stepWorld({ world: off2, fleet: new NpcFleet(off2, { count: 0, bikes: 0 }), autopilot: { enabled: false, step() {} } }, 1 / 60, 0);
  assert.equal(off2.laneClosures.zones.length, 0);
  assert.equal(off2.laneClosures.random(), before, "its random stream untouched");
});

await test("a checkpoint keeps the closure and whose turn it is", async () => {
  const ctx = street(), { world, fleet } = ctx;
  car(ctx, CLOSED, M - 0.5, "c1"); car(ctx, OPEN, M - 1, "o1"); car(ctx, OPEN, M - 8.5, "o2");
  drive(world, CLOSED, M - 20);
  const autopilot = new Autopilot(world, {}); autopilot.setBrain("rules"); autopilot.setEnabled(true);
  const c = { world, fleet, autopilot }, recorder = new DriveRecorder();
  for (let i = 0; i < 60 * 3; i++) { step(c); if (autopilot.firing) await autopilot.firing; }
  recorder.record({ world, fleet, autopilot, drive: null, clock: {} }, true);
  const saved = { passed: [...world.laneClosures.zones[0].passed], last: world.laneClosures.zones[0].last };
  for (let i = 0; i < 60 * 4; i++) { step(c); if (autopilot.firing) await autopilot.firing; }
  recorder.restore(0, { world, fleet, autopilot, setDrive() {}, clock: {} });
  const z = world.laneClosures.zones[0];
  assert.deepEqual([...z.passed], saved.passed); assert.equal(z.last, saved.last);
  assert.equal(world.laneClosures.world, world);
  assert.ok(world.parked.list.includes(z.closure));
});

await test("the challenge, closed loop: Rules and the cautious agent stay in the closed lane to the merge point and merge after the third car in the open lane, clean", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "zipper");
  assert.equal(challenge.map, "calgary"); assert.equal(challenge.title, "Take turns");
  for (const brain of ["rules", "cautious"]) {
    let arrived = false;
    const ctx = setupChallenge(CAL, challenge, { brain, onEvent: (e) => { if (e.type === "arrived") arrived = true; } });
    const { world, autopilot } = ctx, z = world.laneClosures.zones[0], events = [];
    assert.equal(CAL.edges.get(world.route.edges[0]).name, "14 Avenue SW");
    assert.equal(world.route.edges[0], z.edge);
    const score = new DriveScore(world, { title: challenge.title, map: challenge.map, driver: brain, route: world.route });
    while (world.t < 120 && autopilot.enabled && !arrived) {
      const road = step(ctx); score.record(world, road, 1 / 60);
      if (autopilot.firing) await autopilot.firing;
      events.push(...world.events);
    }
    const v = world.violations, i = z.passed.indexOf("ego");
    assert.ok(arrived, `${brain} arrives`);
    assert.equal(v.collisions + v.red_lights_run + v.stop_signs_run + v.failed_to_yield + (v.merge_cut_ins || 0), 0, `${brain}: ${JSON.stringify(v)}`);
    assert.deepEqual(z.passed.slice(0, i + 1), ["challenge_queue_1", "challenge_merging_1", "challenge_queue_2", "challenge_merging_2", "challenge_queue_3", "ego"], z.passed.join(" "));
    assert.ok(!events.some((e) => e.type === "merged_early" || e.type === "took_merge_turn"));
    const report = score.snapshot();
    assert.equal(report.merge_cut_ins, 0); assert.equal(report.early_merges, 0);
    assert.equal(report.wrong_way_s ?? 0, 0);
  }
});

console.log(`${checks} lane closure checks passed`);
process.exit(0);
