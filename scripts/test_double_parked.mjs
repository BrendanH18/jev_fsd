// Double-parked delivery vans: where they stop, the way round, when the way round is clear, traffic
// waiting behind one and going round it, the driven car's sensing, its wait and its detour, what
// models are told, the audit of going round into oncoming traffic, coaching, the HUD, free-drive vans,
// checkpoints, and the "Round the van" challenge, where waiting a car length back for the oncoming
// cars is what keeps the car out of their way.
// node --experimental-default-type=module scripts/test_double_parked.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt, projectPoint } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, DELIVERY_VAN } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { DECIDE_M, LEAD_M, PASS_MPS, RETURN_M, VAN_COUNT, WAIT_M, passTime, queuedAhead, vanNotice, vanSites, wayRound } = await import("../static/js/sim/double-parked.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
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
const KEYS = ["623b012bc8b5", "7165f1c807a8", "d7454a9751b7", "4a96d42cb3f2", "bb9df59633e0", "a53c5bcf6438", "d25b07def0d2", "19bb885c9cae", "8e99888cb743", "ca5573a8d934", "3e794edbefcb", "49db0d437c8c"];
const TOR = load("4a96d42cb3f2");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const FRONT = CAR.length - CAR.rearOverhang;
// Brunswick Avenue, The Annex: two-way, one lane each way, 30 km/h, parking both sides. The van stands
// in the lane of its northbound edge, its rear 120 m along it.
const EDGE = "e137", REAR = 120;
const BRUNSWICK = TOR.edges.get(EDGE);
function brunswick({ parked = 0 } = {}) {
  setWeather("dry");
  const world = new World(TOR, { seed: 3, parked, pedestrians: 0 });
  const van = world.doubleParked.place({ edge: EDGE, rear: REAR });
  van.held = true;
  return { world, van };
}
// The car with its front `back` metres short of the van's rear, at `v`, on a route straight on.
function drive(world, { back = 40, v = 0 } = {}) {
  const lane = TOR.lane(EDGE, 0), s = (REAR - back - FRONT) * lane.length / BRUNSWICK.length;
  world.placeOnLane(lane, s);
  world.ego.v = v;
  world.resetContactHistory();
  const next = TOR.successors(EDGE).map((id) => TOR.lane(id, 0)).sort((a, b) => Math.abs(TOR.turnAngle(EDGE, a.edge)) - Math.abs(TOR.turnAngle(EDGE, b.edge)))[0];
  world.route = new Route(routeFromLanes(TOR, [lane, next], s, next.length - 5), TOR, world.ego.spec);
  return lane;
}
// A car of the traffic: on the van's edge `back` metres (its front) short of the van's rear, or
// coming the other way with its front `past` metres past the van's front.
function npc(world, fleet, { back = null, past = null, v = 0, id }) {
  const own = back !== null, edge = own ? BRUNSWICK : TOR.edges.get(world.doubleParked.vans[0].opposite), lane = TOR.lane(edge.id, 0), d = world.doubleParked.vans[0];
  const sE = own ? REAR - back - FRONT : edge.length - (d.front + past) + FRONT;
  const s = sE * lane.length / edge.length, p = pointAt(lane.pts, lane.cum, s);
  const n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
  Object.assign(n, { id, color: 0x8d9299, v0: 8.3, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(TOR, fleet.random), frozen: 0, waiting: 0 });
  n.path.start(edge.id, 0, s);
  fleet.vehicles.push(n);
  return n;
}
// Where a vehicle's front is along the van's street, and how far right of its centre line it is.
const frontOn = (v) => projectPoint(BRUNSWICK.pts, BRUNSWICK.cum, [v.x, v.y], null).s + FRONT;
const lateralOn = (v) => projectPoint(BRUNSWICK.pts, BRUNSWICK.cum, [v.x, v.y], null).lateral;
// Any two of these touching, as "a|b".
function contacts(list, seen) {
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    if (Math.hypot(list[a].x - list[b].x, list[a].y - list[b].y) < 12 && obbOverlap(list[a].obb(), list[b].obb(), 0)) seen.add(`${list[a].id}|${list[b].id}`);
  }
  return seen;
}

await test("vans stop only on straight two-way blocks with one lane each way, clear of crosswalks, transit, level crossings and junctions, on every map", () => {
  let total = 0;
  for (const key of KEYS) {
    const map = key === "4a96d42cb3f2" ? TOR : load(key), sites = vanSites(map);
    total += sites.length;
    const routed = new Set((map.transit?.routes || []).flatMap((r) => r.runs.flatMap((run) => run.edges)));
    for (const s of sites) {
      const e = map.edges.get(s.edge), o = map.edges.get(s.opposite);
      assert.ok(!e.oneway && e.lanes === 1 && o.lanes === 1 && o.from === e.to && o.to === e.from, key);
      assert.ok(!(map.crosswalks || []).some((c) => c.edge === e.id || c.edge === o.id) && !routed.has(e.id) && !routed.has(o.id), key);
      assert.ok(s.lo - LEAD_M >= e.length - (o.control?.s_line ?? e.length) + 12 - 1e-6 && s.hi + DELIVERY_VAN.length + RETURN_M <= (e.control?.s_line ?? e.length) - 12 + 1e-6, "clear of the junctions and their lines");
    }
    assert.ok(sites.length > 0, `${key} has somewhere for a van`);
  }
  assert.ok(total > 1000, `${total} places on the bundled maps`);
  assert.ok(vanSites(TOR).some((s) => s.edge === EDGE), "Brunswick Avenue");
});

await test("the van stands in the lane beside the parked cars, with the way round, where traffic waits, and the parked cars along it held", () => {
  const { world, van } = brunswick({ parked: 0.9 });
  assert.ok(Math.abs(van.front - van.rear - DELIVERY_VAN.length) < 1e-9);
  const lane = BRUNSWICK.lane_offsets[0], lat = lateralOn(van.van);
  assert.ok(Math.abs(lat - lane - 0.15) < 0.05, `in its lane, ${lat.toFixed(2)} m right of the centre line`);
  assert.ok(world.parked.list.includes(van.van) && van.van.stay && van.van.hazards);
  const d = van.detour;
  assert.ok(d.from === REAR - LEAD_M && d.full < REAR && d.back > van.front && Math.abs(d.to - van.front - RETURN_M) < 1e-9 && van.wait === REAR - WAIT_M);
  assert.equal(d.shift, -(lane + TOR.edges.get(van.opposite).lane_offsets[0]), "from its lane's centre to the oncoming one's");
  assert.ok(van.stayed.length >= 4 && van.stayed.every((c) => c.stay), `${van.stayed.length} parked cars held`);
  world.doubleParked.retire(van);
  assert.ok(!world.parked.list.includes(van.van) && van.stayed.every((c) => !c.stay), "and let go once it leaves");
});

await test("the way round: clear with nobody coming; not with someone coming too soon, in the oncoming lane or turning into it ahead; a long way off, standing, or already past is no matter", () => {
  const { world, van } = brunswick();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  drive(world, { back: WAIT_M });
  const from = REAR - WAIT_M, need = passTime(van.detour.to - from, 0);
  assert.ok(need > 6 && need < 8, `${need.toFixed(1)} s to get round from a standstill`);
  assert.ok(Math.abs(passTime(30, PASS_MPS) - 30 / PASS_MPS) < 1e-9 && passTime(30, 12) === passTime(30, PASS_MPS), "at PASS_MPS, slowing to it first");
  const way = (list) => wayRound(world, van, from, 0, list);
  assert.ok(way([]).clear);
  const near = npc(world, fleet, { past: 40, v: 8.3, id: "near" });
  const w = way([near]);
  assert.ok(!w.clear && w.oncoming?.vehicle.id === "near" && w.oncoming.eta_s < need, `coming in ${w.oncoming.eta_s.toFixed(1)} s`);
  fleet.vehicles.length = 0;
  const far = npc(world, fleet, { past: 100, v: 8.3, id: "far" });
  assert.ok(way([far]).clear, "100 m past the van at 30 km/h leaves time");
  far.v = 0;
  const standing = npc(world, fleet, { past: 30, v: 0, id: "standing" });
  assert.ok(way([standing]).clear, "standing still beyond the way round");
  const past = npc(world, fleet, { past: -LEAD_M - DELIVERY_VAN.length - 12, v: 8.3, id: "past" });
  assert.ok(way([past]).clear, "already past it");
  const beside = npc(world, fleet, { past: -3, v: 1, id: "beside" });
  assert.ok(way([beside]).oncoming?.eta_s === 0, "beside the van in the oncoming lane");
  // (coming up to the junction ahead on the street across, signalling a turn into the oncoming lane,
  // past a van near that junction)
  const { world: w2, van: near2 } = (() => { setWeather("dry"); const w = new World(TOR, { seed: 3, parked: 0, pedestrians: 0 }); return { world: w, van: w.doubleParked.place({ edge: EDGE, rear: 180 }) }; })();
  const node = TOR.nodes.get(BRUNSWICK.to), o = TOR.edges.get(near2.opposite), into = headingAt(o.pts, o.cum, 0);
  const turner = new Vehicle(node.x - Math.cos(into - Math.PI / 2) * 25, node.y - Math.sin(into - Math.PI / 2) * 25, into - Math.PI / 2, 8);
  Object.assign(turner, { id: "turner", signal: "left" });
  const way2 = () => wayRound(w2, near2, 180 - WAIT_M, 0, [turner]);
  assert.ok(!way2().clear && way2().oncoming?.vehicle.id === "turner", "turning left into it");
  turner.signal = "right";
  assert.ok(way2().clear, "turning the other way");
  turner.signal = null;
  assert.ok(way2().clear, "going straight across");
  // (and coming straight on toward it from the street beyond, fast enough to arrive in time, from
  // further off than a turner is looked for)
  const onward = new Vehicle(node.x - Math.cos(into) * 70, node.y - Math.sin(into) * 70, into, 13);
  onward.id = "onward";
  assert.ok(wayRound(w2, near2, 180 - WAIT_M, 0, [onward]).oncoming?.vehicle.id === "onward", "coming straight on from 70 m beyond the junction at 13 m/s");
  // (and someone waiting behind the van ahead of a driver is waited for in turn)
  const queued = npc(world, fleet, { back: WAIT_M, v: 0, id: "queued" });
  assert.equal(queuedAhead(world, van, REAR - 20, null, [queued])?.id, "queued");
  assert.equal(queuedAhead(world, van, REAR - WAIT_M + 1, queued, [queued]), null, "nobody ahead of the one waiting");
});

await test("traffic waits a car length back while cars come the other way, then goes round on a gap, one after another, without touching anyone", () => {
  const { world, van } = brunswick({ parked: 0.6 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  drive(world, { back: 100 });
  const cars = [40, 52, 64].map((back, i) => npc(world, fleet, { back, v: 6, id: `same_${i}` }));
  const oncoming = [30, 55, 80].map((past, i) => npc(world, fleet, { past, v: 8.3, id: `onc_${i}` }));
  const hits = new Set();
  let waited = 0, minLat = Infinity, metInLane = 0;
  for (let i = 0; i < 60 * 50; i++) {
    step({ world, fleet, autopilot: idle });
    const first = cars[0];
    // (where it waits: at its mark, or up to the 2 m short of it that traffic keeps from a stop)
    if (first.v < 0.1 && frontOn(first) > van.wait - 3 && frontOn(first) < van.wait + 1) waited += 1 / 60;
    for (const c of cars) {
      const f = frontOn(c);
      if (f > van.detour.from && f < van.detour.to) minLat = Math.min(minLat, lateralOn(c));
      // (nobody across the centre line beside the van while an oncoming car is within 15 m of it)
      if (f > van.rear - 2 && f < van.front + 4 && lateralOn(c) < 0 && oncoming.some((o) => fleet.vehicles.includes(o) && Math.hypot(o.x - c.x, o.y - c.y) < 15)) metInLane++;
    }
    if (i % 3 === 0) contacts([...new Set([...fleet.vehicles, ...world.parked.near(van.x, van.y, 40)])].filter((v) => Math.hypot(v.x - van.x, v.y - van.y) < 40), hits);
  }
  assert.ok(waited > 2, `the first waited ${waited.toFixed(1)} s at its mark`);
  assert.ok(minLat < -1, "round through the oncoming lane");
  assert.equal(metInLane, 0, "never in the oncoming lane beside the van with one coming");
  assert.ok(cars.every((c) => !fleet.vehicles.includes(c) || frontOn(c) > van.detour.to || c.path.currentEdge().id !== EDGE), "all three got past");
  assert.equal([...hits].filter((k) => !k.split("|").every((id) => id.startsWith("parked"))).length, 0, `no contacts: ${[...hits]}`);
});

await test("a slow driver, slow to move off, waits for a gap it can use: the way round allows for its own pulling away", () => {
  const { world, van } = brunswick();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  drive(world, { back: 100 });
  const slow = npc(world, fleet, { back: WAIT_M + 2, v: 0, id: "slow" });
  Object.assign(slow.driver, { aMax: 0.7, react: 1.3 });
  const onc = npc(world, fleet, { past: 80, v: 6, id: "onc" });
  onc.v0 = 6;
  const hits = new Set();
  let went = null, by = null;
  for (let i = 0; i < 60 * 30; i++) {
    step({ world, fleet, autopilot: idle });
    // (the oncoming car past the way round: its rear short of where it starts)
    if (by === null && fleet.vehicles.includes(onc) && projectPoint(BRUNSWICK.pts, BRUNSWICK.cum, [onc.x, onc.y], null).s + onc.spec.rearOverhang < van.detour.from) by = i;
    if (went === null && lateralOn(slow) < 0) went = i;
    contacts([slow, onc, van.van], hits);
  }
  assert.equal(hits.size, 0, `no contacts: ${[...hits]}`);
  assert.ok(by !== null && went !== null && went > by, `across the centre line at step ${went}, after the oncoming car was by at ${by}`);
  assert.ok(frontOn(slow) > van.front, "and round the van");
});

await test("a driver too close behind the van to pull out round it waits for it to leave", () => {
  const { world, van } = brunswick();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  drive(world, { back: 100 });
  const close = npc(world, fleet, { back: 2.5, v: 0, id: "close" });
  for (let i = 0; i < 60 * 15; i++) step({ world, fleet, autopilot: idle });
  assert.ok(Math.abs(lateralOn(close) - BRUNSWICK.lane_offsets[0]) < 0.3 && frontOn(close) < van.rear, "still behind it, in its lane");
  assert.ok(!obbOverlap(close.obb(), van.van.obb(), 0));
});

await test("sensing: the car waits behind the van while the way round is not clear, and once it is every manoeuvre goes round", () => {
  const { world, van } = brunswick();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  drive(world, { back: 30, v: 6 });
  const onc = npc(world, fleet, { past: 35, v: 8.3, id: "onc" });
  let snap = buildSnapshot(world);
  const d = snap.double_parked;
  assert.ok(d && d.wait && !d.go && !d.detour && d.way.oncoming?.id === "onc", "waits for the oncoming car");
  assert.ok(Math.abs(d.bumper_to_stop_m - (30 - WAIT_M)) < 1, `${d.bumper_to_stop_m.toFixed(1)} m to where it waits`);
  assert.ok(snap.limit <= Math.sqrt(PASS_MPS ** 2 + 2 * 1.5 * d.bumper_to_stop_m) + 0.01, "slowing to the speed to go round at");
  assert.ok(snap.following?.id !== van.van.id, "the van is a stop, not a car to follow");
  const cands = sampleCandidates(snap, world);
  assert.ok(cands.some((c) => c.id === "wait_behind_van") && cands.every((c) => !c.law.detour));
  // (a manoeuvre that would carry it up closer to the van than where it waits is ruled out)
  drive(world, { back: WAIT_M + 5, v: 3 });
  const near = buildSnapshot(world), close = sampleCandidates(near, world);
  simulateAll(close, near, world);
  assert.ok(near.double_parked.wait && close.some((c) => c.reject === "no_room_to_go_round"), "pulling up closer is ruled out");
  assert.ok(close.some((c) => c.eligible && c.sim.end_speed < 0.3), "stopping is not");
  // (the oncoming car gone: the way is clear)
  fleet.vehicles.length = 0;
  world.ego.v = 0;
  drive(world, { back: WAIT_M });
  snap = buildSnapshot(world);
  const g = snap.double_parked;
  assert.ok(g.go && !g.wait && g.way.clear && g.detour?.id === van.id && g.detour.shift === van.detour.shift);
  const go = sampleCandidates(snap, world);
  assert.ok(!go.some((c) => c.id === "wait_behind_van"));
  assert.ok(go.filter((c) => c.law.kind === "lane" || c.law.kind === "hard_brake").every((c) => c.law.detour === g.detour), "round the van, whatever it does");
  const { eligible } = simulateAll(go, snap, world);
  assert.ok(eligible.some((c) => c.id.startsWith("keep_lane") && c.sim.progress_m > 2), "and going round is clear of the van");
  assert.ok(onc);
});

await test("sensing: the car cannot see far enough in fog, so it waits; once started round, it carries on; past the van nothing is reported", () => {
  const { world, van } = brunswick();
  new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  setWeather("fog");
  drive(world, { back: WAIT_M });
  const fog = buildSnapshot(world).double_parked;
  setWeather("dry");
  assert.ok(fog && fog.wait && !fog.way.sees_far_enough, "fog: it cannot know the way is clear");
  drive(world, { back: WAIT_M });
  const snap = buildSnapshot(world), cands = sampleCandidates(snap, world);
  const law = cands.find((c) => c.id.startsWith("keep_lane")).law;
  // (moved a metre and a half across, on the way round, a car turns up: it carries on)
  const lane = TOR.lane(EDGE, 0), s = projectPoint(lane.pts, lane.cum, [world.ego.x, world.ego.y], null).s + 2, p = pointAt(lane.pts, lane.cum, s), h = headingAt(lane.pts, lane.cum, s);
  Object.assign(world.ego, { x: p[0] - Math.sin(h) * 1.5, y: p[1] + Math.cos(h) * 1.5, psi: h + 0.3, v: 3 });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  npc(world, fleet, { past: 25, v: 8.3, id: "late" });
  const going = buildSnapshot(world, { law }).double_parked;
  assert.ok(going.going_round && going.go && going.detour, "committed");
  drive(world, { back: -(DELIVERY_VAN.length + RETURN_M + 2) });
  assert.ok(buildSnapshot(world).double_parked === null, "past it");
  assert.ok(van);
});

await test("models are told: the van in the state, a situation line, the motion criterion and the prompt", () => {
  const { world } = brunswick();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  drive(world, { back: WAIT_M + 1 });
  npc(world, fleet, { past: 35, v: 8.3, id: "onc" });
  const snap = buildSnapshot(world), cands = sampleCandidates(snap, world);
  simulateAll(cands, snap, world);
  const state = toJevState(snap, cands, {});
  assert.ok(state.double_parked.stop && state.double_parked.way_round === "oncoming traffic" && state.double_parked.oncoming.id === "onc", JSON.stringify(state.double_parked));
  const line = situationClauses(snap).find((l) => /double-parked/.test(l));
  assert.ok(line && /right of way/.test(line) && /onc/.test(line) && /wait_behind_van|Hold still/.test(line), line);
  const { questions } = buildQuestions(snap, cands.filter((c) => c.eligible));
  assert.ok(/double_parked\.wait_in_m/.test(questions.motion.criteria.stop));
  assert.ok(/wait_behind_van/.test(SYSTEM_PROMPT));
  fleet.vehicles.length = 0;
  const clear = buildSnapshot(world), all = sampleCandidates(clear, world);
  simulateAll(all, clear, world);
  assert.ok(toJevState(clear, all, {}).double_parked.go_round);
  assert.ok(/clear for the whole way round now/.test(situationClauses(clear).find((l) => /double-parked/.test(l))));
});

await test("the audit counts going round into an oncoming car as a failure to yield, once, and coaching says so; going round on a gap is not driving the wrong way", () => {
  const { world, van } = brunswick();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  drive(world, { back: WAIT_M });
  world.route = null;
  const onc = npc(world, fleet, { past: 12, v: 0, id: "onc" });
  onc.frozen = 1e6;
  const score = new DriveScore(world), d = van.detour, laneC = BRUNSWICK.lane_offsets[0];
  // (straight round through the oncoming lane at 5 m/s, along the way round)
  const pose = (s) => { const lat = laneC + (s < d.full ? (d.shift * (s - (REAR - WAIT_M - FRONT)) / (d.full - (REAR - WAIT_M - FRONT))) : d.shift); const p = pointAt(BRUNSWICK.pts, BRUNSWICK.cum, s), h = headingAt(BRUNSWICK.pts, BRUNSWICK.cum, s); return { x: p[0] + Math.sin(h) * lat, y: p[1] - Math.cos(h) * lat, psi: h, v: 5 }; };
  for (let s = REAR - WAIT_M - FRONT; s < van.front; s += 5 / 60) {
    Object.assign(world.ego, pose(s));
    const road = step({ world, fleet, autopilot: idle });
    score.record(world, road, 1 / 60);
  }
  assert.equal(world.violations.failed_to_yield, 1, "counted once");
  const snap = score.snapshot();
  assert.equal(snap.van_cutoffs, 1);
  assert.ok(snap.tips.some((t) => /oncoming lane is clear for the whole way round/.test(t)));
  // (and again on a gap: nothing counted, and not the wrong way)
  const { world: w2 } = brunswick();
  const f2 = new NpcFleet(w2, { count: 0, bikes: 0, seed: 5 }), s2 = new DriveScore(w2);
  drive(w2, { back: WAIT_M });
  w2.route = null;
  for (let s = REAR - WAIT_M - FRONT; s < d.to; s += 5 / 60) {
    Object.assign(w2.ego, pose(Math.min(s, van.front)));
    if (s > van.front) Object.assign(w2.ego, pose(van.front + (s - van.front)));
    const road = step({ world: w2, fleet: f2, autopilot: idle });
    s2.record(w2, road, 1 / 60);
  }
  assert.equal(w2.violations.failed_to_yield, 0);
  assert.equal(s2.snapshot().wrong_way_s, 0, "going round is not the wrong way");
});

await test("the HUD says to wait behind the van while the way round is not clear, and when it is", () => {
  const { world } = brunswick();
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  drive(world, { back: 30, v: 6 });
  const onc = npc(world, fleet, { past: 35, v: 8.3, id: "onc" });
  assert.equal(vanNotice(world).text, "DOUBLE-PARKED VAN · ONCOMING TRAFFIC · WAIT BEHIND IT");
  fleet.vehicles.length = 0;
  assert.equal(vanNotice(world).text, "DOUBLE-PARKED VAN · WAY CLEAR · GO ROUND IT");
  npc(world, fleet, { back: WAIT_M, v: 0, id: "queued" });
  assert.equal(vanNotice(world).text, "DOUBLE-PARKED VAN · WAIT YOUR TURN BEHIND IT");
  drive(world, { back: 70 });
  assert.ok(vanNotice(world) === null, "not until the car is near");
  assert.ok(onc);
});

await test("in a free drive one van stops 150 to 450 m away, out of the car's sight, by day; it drives off as traffic in sight, or goes once the car is well away", () => {
  setWeather("dry");
  const world = new World(TOR, { seed: 4, parked: 0.5, pedestrians: 0, vans: VAN_COUNT });
  const fleet = new NpcFleet(world, { count: 20, bikes: 0, seed: 9 });
  assert.equal(world.doubleParked.vans.length, 0, "not before the first step");
  step({ world, fleet, autopilot: idle });
  const van = world.doubleParked.vans[0];
  assert.ok(van, "one stops");
  const dist = Math.hypot(van.x - world.ego.x, van.y - world.ego.y);
  assert.ok(dist > 100 && dist < 500 && !world.visibility.canSee(world.ego, van.x, van.y), `${Math.round(dist)} m away, out of sight`);
  assert.ok(vanSites(TOR).some((s) => s.edge === van.edge && van.rear >= s.lo - 1e-6 && van.rear <= s.hi + 1e-6));
  van.left = 0;
  for (let i = 0; i < 60 * 30 && world.doubleParked.vans.includes(van); i++) step({ world, fleet, autopilot: idle });
  assert.ok(!world.doubleParked.vans.includes(van) && !world.parked.list.includes(van.van), "it goes");
  for (let i = 0; i < 60 * 12 && !world.doubleParked.vans.length; i++) step({ world, fleet, autopilot: idle });
  assert.equal(world.doubleParked.vans.length, 1, "and another stops");
  // (in sight, it switches its hazards off and drives away)
  const { world: w2, van: v2 } = brunswick();
  const f2 = new NpcFleet(w2, { count: 0, bikes: 0, seed: 5 });
  drive(w2, { back: 30 });
  v2.held = false; v2.left = 0;
  for (let i = 0; i < 60 * 8; i++) step({ world: w2, fleet: f2, autopilot: idle });
  const away = f2.vehicles.find((n) => n.id === `${v2.id}_away`);
  assert.ok(away && !w2.doubleParked.vans.length && away.kind === "delivery_van" && !away.hazards && frontOn(away) > v2.front + 5, "driving off as traffic");
  // (none at night, nor in fog)
  const night = new World(TOR, { seed: 4, parked: 0.5, pedestrians: 0, vans: VAN_COUNT });
  night.visibility.setNight(1);
  const nf = new NpcFleet(night, { count: 0, bikes: 0, seed: 9 });
  for (let i = 0; i < 60 * 12; i++) step({ world: night, fleet: nf, autopilot: idle });
  assert.equal(night.doubleParked.vans.length, 0, "deliveries are made by day");
  setWeather("fog");
  const fog = new World(TOR, { seed: 4, parked: 0.5, pedestrians: 0, vans: VAN_COUNT, weather: "fog" });
  const ff = new NpcFleet(fog, { count: 0, bikes: 0, seed: 9 });
  for (let i = 0; i < 60 * 12; i++) step({ world: fog, fleet: ff, autopilot: idle });
  setWeather("dry");
  assert.equal(fog.doubleParked.vans.length, 0, "nor in fog");
});

await test("a restored checkpoint ties the vans back to the live world", () => {
  const challenge = CHALLENGES.find((c) => c.id === "double-parked");
  const ctx = setupChallenge(TOR, challenge);
  const { world } = ctx;
  const recorder = new DriveRecorder();
  recorder.record({ world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: {}, clock: {} }, true);
  const before = world.doubleParked.vans.map((d) => d.id);
  world.doubleParked.retire(world.doubleParked.vans[0]);
  const target = { world, fleet: ctx.fleet, autopilot: ctx.autopilot, clock: { setHour() {}, update() {} }, setDrive() {} };
  recorder.restore(0, target);
  assert.deepEqual(world.doubleParked.vans.map((d) => d.id), before);
  assert.ok(world.parked.list.includes(world.doubleParked.vans[0].van), "the same van, still there");
  assert.ok(world.doubleParked.world === world, "stepping it steps the live world");
});

await test("the challenge, closed loop: Rules and the cautious agent wait a car length back while the oncoming cars come by, then go round and arrive", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "double-parked");
  assert.equal(challenge.map, "toronto");
  for (const brain of ["rules", "cautious"]) {
    let arrived = false;
    const ctx = setupChallenge(TOR, challenge, { brain, onEvent: (e) => { if (e.type === "arrived") arrived = true; } });
    const { world, fleet, autopilot } = ctx, van = world.doubleParked.vans[0], score = new DriveScore(world);
    assert.equal(TOR.edges.get(van.edge).name, "Brunswick Avenue", "on Brunswick Avenue");
    assert.equal(world.route.edges[0], van.edge, "in the car's lane");
    const e = TOR.edges.get(van.edge), on = (v) => projectPoint(e.pts, e.cum, [v.x, v.y], null);
    let waited = 0, minLat = Infinity, metAcross = 0, passed = 0;
    while (world.t < 90 && autopilot.enabled && !arrived) {
      const road = step({ world, fleet, autopilot });
      score.record(world, road, 1 / 60);
      if (autopilot.firing) await autopilot.firing;
      const p = on(world.ego), f = p.s + FRONT;
      if (world.ego.v < 0.1 && Math.abs(f - van.wait) < 2) waited += 1 / 60;
      if (f > van.detour.from && f < van.detour.to) minLat = Math.min(minLat, p.lateral);
      for (const id of world.challenge.vanCarIds) {
        const n = fleet.vehicles.find((v) => v.id === id);
        if (!n) continue;
        if (p.lateral < 0 && Math.hypot(n.x - world.ego.x, n.y - world.ego.y) < 20) metAcross++;
        if (on(n).s + n.spec.rearOverhang < van.detour.from) passed |= 1 << Number(id.at(-1));
      }
    }
    const v = world.violations;
    assert.ok(arrived, `${brain} arrives`);
    assert.equal(v.collisions + v.stop_signs_run + v.failed_to_yield + v.red_lights_run + v.safety_brakes, 0, `${brain}: ${JSON.stringify(v)}`);
    assert.ok(waited > 3, `${brain} waited ${waited.toFixed(1)} s a car length back`);
    assert.equal(passed, 6, "while both oncoming cars came by");
    assert.equal(metAcross, 0, `${brain} never across the centre line near them`);
    assert.ok(minLat < -1, `${brain} went round the van`);
    assert.equal(score.snapshot().wrong_way_s, 0, `${brain}: going round is not the wrong way`);
  }
});

console.log(`${checks} double-parked van checks passed`);
process.exit(0);
