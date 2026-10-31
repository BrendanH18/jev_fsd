// Work zones with a flagger (Ontario HTA s. 146.1): where they can go, the flaggers' turns, traffic
// stopping for STOP and going round the work under SLOW, the driven car's sensing, its stop and its
// detour, what models are told, the audit of a missed STOP, coaching, free-drive zones, and the
// "Follow the flagger" challenge, where waiting for SLOW is what keeps the car out of the oncoming
// cars' way.
// node --experimental-default-type=module scripts/test_work_zones.mjs
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
const { detourAt, lateralAt } = await import("../static/js/sim/controller.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { CLEAR_S, SLOW_MAX_S, SLOW_MIN_S, SPAN_M, WORK_ZONE_COUNT, WZ_LIMIT_MPS, marksOn, paddle, stopKey, workZoneNotice, workZoneSites } = await import("../static/js/sim/work-zone.js");
const { DriveScore, SPEED_GRACE_MPS } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
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
  pack.utc_offset = -4;
  return new MapData(pack);
};
const OTT = load("d25b07def0d2");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const FRONT = CAR.length - CAR.rearOverhang;
// Queen Street, Ottawa: two-way, one lane each way, 40 km/h. Its eastbound edge's lane is the one
// closed, the stop line for that side 90 m along it.
const CLOSED = "e103", OPEN = "e104", A = 90;
const QUEEN = OTT.edges.get(CLOSED);
function queen({ phase = "open", parked = 0 } = {}) {
  setWeather("dry");
  const world = new World(OTT, { seed: 3, parked, pedestrians: 0 });
  const zone = world.workZones.place({ closed: CLOSED, open: OPEN, a: A, phase });
  return { world, zone };
}
// The car with its front `back` metres short of side `side`'s stop line, at `v`, on a route straight on.
function drive(world, zone, { side = "closed", back = 40, v = 0 } = {}) {
  const edge = side === "closed" ? CLOSED : OPEN, lane = OTT.lane(edge, 0), s = marksOn(zone, side).line - back - FRONT;
  world.placeOnLane(lane, s);
  world.ego.v = v;
  world.resetContactHistory();
  const next = OTT.successors(edge).map((id) => OTT.lane(id, 0)).sort((a, b) => Math.abs(OTT.turnAngle(edge, a.edge)) - Math.abs(OTT.turnAngle(edge, b.edge)))[0];
  world.route = new Route(routeFromLanes(OTT, [lane, next], s, next.length - 5), OTT, world.ego.spec);
  return lane;
}
// A car of the traffic on `edge`, its front `back` metres short of that side's stop line.
function car(world, fleet, zone, side, back, id) {
  const edge = side === "closed" ? CLOSED : OPEN, lane = OTT.lane(edge, 0), s = marksOn(zone, side).line - back - FRONT;
  const p = pointAt(lane.pts, lane.cum, s), n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
  Object.assign(n, { id, color: 0x8d9299, v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(OTT, fleet.random), frozen: 0, waiting: 0 });
  n.path.start(edge, 0, s);
  fleet.vehicles.push(n);
  return n;
}
// Where a vehicle's front is along its side's edge.
const frontOn = (zone, side, v) => { const e = OTT.edges.get(zone[side]); return projectPoint(e.pts, e.cum, [v.x, v.y], null).s + FRONT; };
// How far right of the closed side's centre line a vehicle is.
const lateralOn = (v, zone = null) => { const e = zone ? OTT.edges.get(zone.closed) : QUEEN; return projectPoint(e.pts, e.cum, [v.x, v.y], null).lateral; };

await test("zones go only on straight two-way blocks with one lane each way, clear of crosswalks, transit, level crossings and junctions", () => {
  const sites = workZoneSites(OTT);
  assert.ok(sites.length > 10, `${sites.length} sites in Centretown`);
  const routed = new Set((OTT.transit?.routes || []).flatMap((r) => r.runs.flatMap((run) => run.edges)));
  for (const s of sites) {
    const e = OTT.edges.get(s.closed), o = OTT.edges.get(s.open);
    assert.ok(!e.oneway && e.lanes === 1 && o.lanes === 1 && o.from === e.to && o.to === e.from);
    assert.ok(!OTT.crosswalks.some((c) => c.edge === e.id || c.edge === o.id) && !routed.has(e.id) && !routed.has(o.id));
    assert.ok(s.lo >= 20 && s.hi + SPAN_M <= Math.min(e.length, e.control?.s_line ?? e.length) - 20 + 1e-6, "clear of the junctions and their lines");
  }
  assert.ok(sites.some((s) => s.closed === CLOSED) && sites.some((s) => s.closed === OPEN), "either side of Queen Street can be the one closed");
});

await test("the layout: a stop line at each end, a 30 m taper each way, and the closed stretch over the closed lane and its parking lane", () => {
  const { world, zone } = queen({ parked: 0.9 });
  assert.equal(zone.b - zone.a, SPAN_M);
  assert.equal(zone.shift, -(QUEEN.lane_offsets[0] + OTT.edges.get(OPEN).lane_offsets[0]), "from the closed lane's centre to the open one's");
  const box = zone.closure.obb(), e = QUEEN, h = headingAt(e.pts, e.cum, zone.r);
  const local = (s, lat) => { const p = pointAt(e.pts, e.cum, s); return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat]; };
  const inside = ([x, y]) => obbOverlap(box, { center: [x, y], heading: h, halfLength: 0.05, halfWidth: 0.05 });
  const lane = QUEEN.lane_offsets[0];
  assert.ok(inside(local(zone.r + 1, lane)) && inside(local(zone.f - 1, QUEEN.asphalt[1] - 0.5)), "the closed lane and its parking lane");
  assert.ok(!inside(local((zone.r + zone.f) / 2, -0.3)) && !inside(local(zone.r - 1, lane)), "not the open lane, nor short of the work");
  assert.ok(world.parked.list.includes(zone.closure));
  const bays = world.parked.slots.filter((slot) => zone.bays.includes(slot));
  assert.ok(bays.length > 4 && bays.every((b) => b.reserved === zone.closure && !b.occupant), "nobody parked along it, and nobody parks there");
  world.workZones.retire(zone);
  assert.ok(!world.parked.list.includes(zone.closure) && bays.every((b) => !b.reserved));
});

await test("the detour: across over the taper, all the way past the work, back over the taper; nothing outside it", () => {
  const d = { from: 10, full: 40, back: 70, to: 100, shift: -3.5 };
  assert.equal(detourAt(d, 5), 0); assert.equal(detourAt(d, 100), 0); assert.equal(detourAt(null, 50), 0);
  assert.equal(detourAt(d, 40), -3.5); assert.equal(detourAt(d, 55), -3.5);
  assert.ok(Math.abs(detourAt(d, 25) + 1.75) < 1e-9 && Math.abs(detourAt(d, 85) + 1.75) < 1e-9, "halfway across at the taper's middle");
  assert.equal(lateralAt({ kind: "lane", offset: 0.5, detour: d }, 55), -3);
  assert.equal(lateralAt({ kind: "lane", offset: 0.5 }, 55), 0.5, "a law without one is unchanged");
});

await test("the flaggers: SLOW stays while nobody waits at the other end; then STOP both ways until the one lane is clear, then SLOW for the other side", () => {
  const { world, zone } = queen();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  for (let i = 0; i < 60 * 40; i++) step({ world, fleet, autopilot: idle });
  assert.equal(zone.phase, "open", "nobody waiting on the closed side");
  const waiter = car(world, fleet, zone, "closed", 3, "waiter");
  const through = car(world, fleet, zone, "open", 0, "through");
  through.v = 6;
  let clearAt = null, slowAt = null, clearWhileOccupied = 0;
  for (let i = 0; i < 60 * 60 && slowAt === null; i++) {
    step({ world, fleet, autopilot: idle });
    if (zone.phase === "clear" && clearAt === null) clearAt = world.t;
    if (zone.phase === "closed") slowAt = world.t;
    if (zone.phase === "clear" && world.workZones.occupied(zone)) clearWhileOccupied++;
  }
  assert.ok(clearAt !== null && slowAt !== null, "the closed side gets its turn");
  assert.ok(slowAt - clearAt >= CLEAR_S, "after the clearance");
  assert.ok(clearWhileOccupied > 0, "the clearance waited for the car still in the one lane");
  assert.ok(frontOn(zone, "open", through) > marksOn(zone, "open").to, "which is through");
  assert.equal(stopKey(zone, "open"), `${zone.id}:open:1`, "the open side's paddle has turned to STOP once");
  assert.equal(stopKey(zone, "closed"), `${zone.id}:closed:0`, "STOP to STOP is no new stop for the closed side");
  // (and under SLOW the waiting car goes)
  for (let i = 0; i < 60 * 5; i++) step({ world, fleet, autopilot: idle });
  assert.ok(waiter.v > 1 || frontOn(zone, "closed", waiter) > zone.a + 3);
  assert.ok(SLOW_MIN_S < SLOW_MAX_S);
});

await test("traffic: it stops at its line for STOP, and under SLOW the closed side goes round the work through the other lane at 30 km/h", () => {
  const { world, zone } = queen({ phase: "open" });
  zone.held = true;
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  const n = car(world, fleet, zone, "closed", 60, "eastbound");
  n.v = 11;
  for (let i = 0; i < 60 * 20; i++) step({ world, fleet, autopilot: idle });
  const short = zone.a - frontOn(zone, "closed", n);
  assert.ok(n.v < 0.1 && short > -0.5 && short < 3, `stopped ${short.toFixed(1)} m short of its line`);
  zone.held = false;
  world.workZones.turn(zone, "closed");
  zone.held = true;
  let maxV = 0, minLat = Infinity, touched = false;
  for (let i = 0; i < 60 * 25; i++) {
    step({ world, fleet, autopilot: idle });
    const f = frontOn(zone, "closed", n);
    if (f > zone.d0 && f < zone.d1) maxV = Math.max(maxV, n.v);
    minLat = Math.min(minLat, lateralOn(n));
    if (obbOverlap(n.obb(), zone.closure.obb())) touched = true;
  }
  assert.ok(frontOn(zone, "closed", n) > zone.d1 + 5, "through");
  assert.ok(!touched, "never touching the closed stretch");
  assert.ok(minLat < -1.2, `round it in the other lane (${minLat.toFixed(2)} m right of the centre line)`);
  assert.ok(Math.abs(lateralOn(n) - QUEEN.lane_offsets[0]) < 0.4, "and back in its own lane");
  assert.ok(maxV < WZ_LIMIT_MPS + 0.6, `at ${(maxV * 3.6).toFixed(1)} km/h`);
});

await test("a driver too close to stop when the paddle turns goes on through, and the flaggers wait for it", () => {
  const { world, zone } = queen({ phase: "closed" });
  zone.held = true;
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  const n = car(world, fleet, zone, "closed", 4, "late");
  n.v = 8;
  zone.held = false;
  world.workZones.turn(zone, "clear");
  zone.next = "open";
  let sawOccupied = false;
  for (let i = 0; i < 60 * 20; i++) { step({ world, fleet, autopilot: idle }); if (zone.phase === "clear" && world.workZones.occupied(zone)) sawOccupied = true; }
  assert.ok(frontOn(zone, "closed", n) > zone.d1, "it carried on");
  assert.ok(sawOccupied && zone.phase === "open", "and the open side got SLOW only once it was out");
});

await test("a driver too fast to stop, still short of the one lane when the clearance would end, holds it until it is through", () => {
  const { world, zone } = queen({ phase: "closed" });
  zone.held = true;
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  const n = car(world, fleet, zone, "closed", 25, "fast");
  n.v = 14;
  n.v0 = 14;
  zone.held = false;
  world.workZones.turn(zone, "clear");
  zone.next = "open";
  let early = 0;
  for (let i = 0; i < 60 * 20; i++) {
    step({ world, fleet, autopilot: idle });
    const f = frontOn(zone, "closed", n);
    if (zone.phase === "open" && f < zone.d1 + n.spec.length) early++;
  }
  assert.ok(frontOn(zone, "closed", n) > zone.d1, "it carried on through");
  assert.equal(early, 0, "the other side got SLOW only once it was out");
});

await test("a soak: traffic both ways through the zone for three minutes, with no collisions, nobody in the closed stretch, and the flaggers never stuck", () => {
  const { world, zone } = queen({ parked: 0.5 });
  const fleet = new NpcFleet(world, { count: 30, bikes: 4, seed: 11 });
  let k = 0;
  // (a car on each side 70 m short of its line, where that spot is free)
  const feed = () => {
    for (const side of ["closed", "open"]) {
      const lane = OTT.lane(side === "closed" ? CLOSED : OPEN, 0), p = pointAt(lane.pts, lane.cum, marksOn(zone, side).line - 70 - FRONT);
      if (fleet.vehicles.some((n) => Math.hypot(n.x - p[0], n.y - p[1]) < 12)) continue;
      car(world, fleet, zone, side, 70, `feed_${side}_${k++}`);
    }
  };
  let hits = 0, inside = 0, turns = 0, phase = zone.phase;
  const crossed = { closed: 0, open: 0 };
  const seen = new Map();
  for (let i = 0; i < 60 * 180; i++) {
    if (i % (60 * 9) === 0) feed();
    step({ world, fleet, autopilot: idle });
    if (zone.phase !== phase) { phase = zone.phase; turns++; }
    if (i % 6) continue;
    const near = fleet.vehicles.filter((n) => Math.hypot(n.x - zone.x, n.y - zone.y) < SPAN_M);
    for (const n of near) {
      if (obbOverlap(n.obb(), zone.closure.obb())) inside++;
      for (const m of near) if (m !== n && m.id < n.id && obbOverlap(n.obb(), m.obb())) hits++;
      if (n.id.startsWith("feed_")) { const side = n.id.split("_")[1]; if (frontOn(zone, side, n) > marksOn(zone, side).to && !seen.get(n.id)) { seen.set(n.id, true); crossed[side]++; } }
    }
  }
  assert.equal(inside, 0, "nobody in the closed stretch");
  assert.equal(hits, 0, "no two vehicles touching near the zone");
  assert.ok(turns >= 6, `${turns} turns of the paddles`);
  assert.ok(crossed.closed >= 5 && crossed.open >= 5, `${crossed.closed} cars through round the work, ${crossed.open} the other way`);
});

await test("sensing: on the closed side the car stops at the line for STOP, and every manoeuvre goes round the work", () => {
  const { world, zone } = queen({ phase: "open" });
  drive(world, zone, { side: "closed", back: 40, v: 8 });
  const snap = buildSnapshot(world);
  const w = snap.work_zone;
  assert.ok(w && w.side === "closed" && w.paddle === "stop" && w.wait, "a stop it owes");
  assert.ok(Math.abs(w.bumper_to_stop_m - 40) < 1.5, `${w.bumper_to_stop_m.toFixed(1)} m to the line`);
  assert.ok(w.detour && w.detour.shift === zone.shift && w.detour.from > w.stop_s_route && w.detour.to < w.one_lane.to_s + 0.5);
  assert.ok(snap.limit <= Math.sqrt(WZ_LIMIT_MPS ** 2 + 2 * 2.5 * 0.6 * 35) + 0.01, "slowing to the zone's limit");
  const cands = sampleCandidates(snap, world);
  assert.ok(cands.some((c) => c.id === "stop_for_flagger"));
  assert.ok(cands.filter((c) => c.law.kind === "lane" || c.law.kind === "hard_brake").every((c) => c.law.detour === w.detour), "round the work, whatever it does");
  const { eligible } = simulateAll(cands, snap, world);
  // (a manoeuvre that would carry it past the line is ruled out)
  world.ego.v = 11;
  drive(world, zone, { side: "closed", back: 6, v: 4 });
  const near = buildSnapshot(world), all = sampleCandidates(near, world);
  simulateAll(all, near, world);
  assert.ok(all.some((c) => c.reject === "runs_flagger_stop"), "going on is ruled out");
  assert.ok(eligible.length > 0);
});

await test("sensing: under SLOW nothing holds the car; on the open side there is no detour; with the flagger out of sight nothing is reported", () => {
  const { world, zone } = queen({ phase: "closed" });
  drive(world, zone, { side: "closed", back: 40, v: 8 });
  const slow = buildSnapshot(world).work_zone;
  assert.ok(slow && slow.paddle === "slow" && !slow.wait && slow.detour);
  drive(world, zone, { side: "open", back: 40, v: 8 });
  const open = buildSnapshot(world).work_zone;
  assert.ok(open && open.side === "open" && open.paddle === "stop" && open.wait && !open.detour);
  // (fog: 28 m of sight)
  setWeather("fog");
  drive(world, zone, { side: "open", back: 60, v: 8 });
  const hidden = buildSnapshot(world);
  setWeather("dry");
  assert.equal(hidden.work_zone, null);
});

await test("a car that turned up too close to stop when the paddle turned to STOP is not held; one standing at the line when STOP comes again is", () => {
  const { world, zone } = queen({ phase: "closed" });
  drive(world, zone, { side: "closed", back: 3, v: 10 });
  buildSnapshot(world);
  world.workZones.turn(zone, "clear");
  const late = buildSnapshot(world).work_zone;
  assert.ok(late.paddle === "stop" && !late.wait, "too close to stop at 3.5 m/s^2");
  const { world: w2, zone: z2 } = queen({ phase: "open" });
  drive(w2, z2, { side: "closed", back: -0.5, v: 0 });
  assert.ok(buildSnapshot(w2).work_zone.wait, "stopped just over the line, under STOP");
  w2.workZones.turn(z2, "clear");
  assert.ok(buildSnapshot(w2).work_zone.wait, "still waiting through the clearance");
});

await test("models are told: the zone in the state, a situation line, the motion criterion and the prompt", () => {
  const { world, zone } = queen({ phase: "open" });
  drive(world, zone, { side: "closed", back: 30, v: 6 });
  const snap = buildSnapshot(world), cands = sampleCandidates(snap, world);
  simulateAll(cands, snap, world);
  const state = toJevState(snap, cands, {});
  assert.equal(state.work_zone.flagger, "STOP");
  assert.ok(state.work_zone.stop && state.work_zone.wait_in_m > 25 && /closed/.test(state.work_zone.lane));
  const line = situationClauses(snap).find((c) => c.includes("work zone"));
  assert.ok(line && /Stop at the line/.test(line) && /stop_for_flagger/.test(line) && /through the other lane/.test(line), line);
  assert.ok(state.candidates.some((c) => c.id === "stop_for_flagger" && /short of the flagger/.test(c.outcome)));
  assert.ok(/stop_for_flagger/.test(SYSTEM_PROMPT));
  world.workZones.turn(zone, "closed");
  const go = situationClauses(buildSnapshot(world)).find((c) => c.includes("work zone"));
  assert.ok(/Go on with care at no more than 30 km\/h/.test(go), go);
});

await test("the audit: going past STOP once it was owed is a missed stop, counted once, with a tip; a car that could not stop is not counted", () => {
  const run = (back, v) => {
    const { world, zone } = queen({ phase: "open" });
    const lane = drive(world, zone, { side: "closed", back, v });
    world.route = null;
    const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
    let s = projectPoint(lane.pts, lane.cum, [world.ego.x, world.ego.y], null).s;
    const events = [], score = new DriveScore(world);
    for (let i = 0; i < 60 * 6; i++) {
      s += v / 60;
      const p = pointAt(lane.pts, lane.cum, s);
      world.ego.x = p[0]; world.ego.y = p[1]; world.ego.psi = headingAt(lane.pts, lane.cum, s); world.ego.v = v;
      const road = step({ world, fleet, autopilot: idle });
      score.record(world, road, 1 / 60);
      events.push(...world.events.filter((e) => e.type === "stop_sign"));
    }
    return { world, events, score: score.snapshot() };
  };
  const owed = run(30, 6);
  assert.equal(owed.world.violations.stop_signs_run, 1);
  assert.ok(owed.events.length === 1 && owed.events[0].flagger);
  assert.ok(owed.score.flagger_stops_run === 1 && owed.score.stop_signs === 1 && owed.score.tips.some((t) => /flagger’s STOP paddle/.test(t)));
  const late = run(4, 10);
  assert.equal(late.world.violations.stop_signs_run, 0, "4 m short at 36 km/h: it could not stop");
  assert.equal(late.score.flagger_stops_run, 0);
});

await test("coaching: too fast through a work zone, with a tip", () => {
  const { world, zone } = queen({ phase: "closed" });
  const lane = drive(world, zone, { side: "closed", back: 5, v: 11 });
  world.route = null;
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  const score = new DriveScore(world);
  let s = projectPoint(lane.pts, lane.cum, [world.ego.x, world.ego.y], null).s;
  for (let i = 0; i < 60 * 4; i++) {
    s += 11 / 60;
    const p = pointAt(lane.pts, lane.cum, s);
    Object.assign(world.ego, { x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s), v: 11 });
    const road = step({ world, fleet, autopilot: idle });
    score.record(world, road, 1 / 60);
  }
  const snap = score.snapshot();
  assert.ok(11 > WZ_LIMIT_MPS + SPEED_GRACE_MPS && snap.work_zone_speeding_s > 2, `${snap.work_zone_speeding_s} s too fast`);
  assert.ok(snap.incidents.some((i) => i.type === "work_zone_speeding"));
  assert.ok(snap.tips.some((t) => /30 km\/h through a work zone/.test(t)));
});

await test("the HUD says what the paddle shows, and to go round where the car's lane is closed", () => {
  const { world, zone } = queen({ phase: "open" });
  drive(world, zone, { side: "closed", back: 30, v: 6 });
  assert.equal(workZoneNotice(world).text, "WORK ZONE · FLAGGER SHOWS STOP · WAIT AT THE LINE");
  world.workZones.turn(zone, "closed");
  assert.equal(workZoneNotice(world).text, "WORK ZONE · SLOW · 30 · ONE LANE · GO ROUND IT");
  drive(world, zone, { side: "open", back: 30, v: 6 });
  world.workZones.turn(zone, "open");
  assert.equal(workZoneNotice(world).text, "WORK ZONE · SLOW · 30 · ONE LANE");
});

await test("in a free drive one zone goes up 150 to 450 m away, out of the car's sight, and packs up once the car is well away", () => {
  setWeather("dry");
  const world = new World(OTT, { seed: 4, parked: 0.5, pedestrians: 0, workZones: WORK_ZONE_COUNT });
  const fleet = new NpcFleet(world, { count: 20, bikes: 0, seed: 9 });
  assert.equal(world.workZones.zones.length, 0, "not before the first step");
  step({ world, fleet, autopilot: idle });
  const zone = world.workZones.zones[0];
  assert.ok(zone, "one goes up");
  const d = Math.hypot(zone.x - world.ego.x, zone.y - world.ego.y);
  assert.ok(d > 100 && d < 500 && !world.workZones.seen(zone), `${Math.round(d)} m away, out of sight`);
  assert.ok(workZoneSites(OTT).some((s) => s.closed === zone.closed && zone.a >= s.lo - 1e-6 && zone.a <= s.hi + 1e-6));
  zone.left = 0;
  for (let i = 0; i < 60 * 30 && world.workZones.zones.includes(zone); i++) step({ world, fleet, autopilot: idle });
  assert.ok(!world.workZones.zones.includes(zone), "it packs up");
  for (let i = 0; i < 60 * 12 && !world.workZones.zones.length; i++) step({ world, fleet, autopilot: idle });
  assert.equal(world.workZones.zones.length, 1, "and another goes up");
});

await test("a restored checkpoint ties the zones back to the live world", () => {
  const challenge = CHALLENGES.find((c) => c.id === "flagger");
  const ctx = setupChallenge(OTT, challenge);
  const { world } = ctx;
  const recorder = new DriveRecorder();
  recorder.record({ world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: {}, clock: {} }, true);
  const before = world.workZones.zones.map((z) => z.id);
  world.workZones.retire(world.workZones.zones[0]);
  const target = { world, fleet: ctx.fleet, autopilot: ctx.autopilot, clock: { setHour() {}, update() {} }, setDrive() {} };
  recorder.restore(0, target);
  assert.deepEqual(world.workZones.zones.map((z) => z.id), before);
  assert.ok(world.parked.list.includes(world.workZones.zones[0].closure), "the same closed stretch, still parked");
  assert.ok(world.workZones.world === world, "stepping it steps the live world");
});

await test("the challenge, closed loop: Rules and the cautious agent wait at the line while the oncoming cars come through, then go round the work on SLOW", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "flagger");
  assert.equal(challenge.map, "ottawa");
  for (const brain of ["rules", "cautious"]) {
    let arrived = false;
    const ctx = setupChallenge(OTT, challenge, { brain, onEvent: (e) => { if (e.type === "arrived") arrived = true; } });
    const { world, fleet, autopilot } = ctx, zone = world.workZones.zones[0], score = new DriveScore(world);
    assert.equal(OTT.edges.get(zone.closed).name, "Queen Street", "on Queen Street");
    assert.equal(world.route.edges[0], zone.closed, "the car's lane closed");
    let inOneLaneOnStop = 0, waited = 0, met = 0, minLat = Infinity;
    while (world.t < 120 && autopilot.enabled && !arrived) {
      const road = step({ world, fleet, autopilot });
      score.record(world, road, 1 / 60);
      if (autopilot.firing) await autopilot.firing;
      const f = frontOn(zone, "closed", world.ego);
      if (paddle(zone, "closed") === "stop" && f > zone.d0 && f < zone.d1) inOneLaneOnStop++;
      if (world.ego.v < 0.1 && f < zone.a + 1 && f > zone.a - 3) waited += 1 / 60;
      if (f > zone.d0 && f < zone.d1) minLat = Math.min(minLat, lateralOn(world.ego, zone));
      for (const id of world.challenge.zoneCarIds) { const n = fleet.vehicles.find((v) => v.id === id); if (n && Math.hypot(n.x - world.ego.x, n.y - world.ego.y) < 8) met++; }
    }
    const v = world.violations;
    assert.ok(arrived, `${brain} arrives`);
    assert.equal(v.collisions + v.stop_signs_run + v.failed_to_yield + v.red_lights_run + v.safety_brakes, 0, `${brain}: ${JSON.stringify(v)}`);
    assert.equal(inOneLaneOnStop, 0, `${brain} never in the one lane on STOP`);
    assert.ok(waited > 8, `${brain} waited ${waited.toFixed(1)} s at the line`);
    assert.ok(met > 0, "while the oncoming cars came by");
    assert.ok(minLat < -1, `${brain} went round the work`);
    // (going round on SLOW is not driving the wrong way)
    assert.equal(score.snapshot().wrong_way_s, 0, `${brain}: going round is not the wrong way`);
  }
});

console.log(`${checks} work zone checks passed`);
process.exit(0);
