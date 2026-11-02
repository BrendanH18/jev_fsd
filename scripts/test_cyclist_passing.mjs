// Passing cyclists with room: which streets, the minimum passing distance, the pass and its marks, when
// a pass is not on, when the way is clear, traffic passing (and waiting for the oncoming lane to
// clear), the driven car's sensing, candidates and rejections, sight by night and in fog, closed-loop
// Rules, what models are told, the audit and coaching, nothing at all with the option off, and the
// "Give them room" challenge with Rules and the cautious agent.
// node --experimental-default-type=module scripts/test_cyclist_passing.mjs
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
const { obbOverlap } = await import("../static/js/sim/collision.js");
const { curbOffset } = await import("../static/js/sim/roadside.js");
const { AIM_M, LEAD_M, MARGIN_S, RETURN_M, cyclistNotice, egoPassing, isCyclistPass, minPassM, passStreet, planPass, ridingIn, sightFor, wayClear } = await import("../static/js/sim/cyclist-pass.js");
const { onStreet } = await import("../static/js/sim/double-parked.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { PASS_SIGHT_M } = await import("../static/js/sim/visibility.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
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
  pack.utc_offset = -7;
  return new MapData(pack);
};
const KEYS = ["623b012bc8b5", "7165f1c807a8", "d7454a9751b7", "4a96d42cb3f2", "bb9df59633e0", "a53c5bcf6438", "d25b07def0d2", "19bb885c9cae", "8e99888cb743", "ca5573a8d934", "3e794edbefcb", "49db0d437c8c"];
const KITS = load("623b012bc8b5");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const FRONT = CAR.length - CAR.rearOverhang;
// West 10th Avenue, Kitsilano (the 10th Avenue bikeway): two-way, one lane each way, 30 km/h, parking
// both sides. Westbound from Vine Street to Balsam Street (no sign at Balsam), then on to Larch Street.
const EDGE = "e127", OPP = "e128", NEXT = "e129", W10 = KITS.edges.get(EDGE), LANE_C = W10.lane_offsets[0];
const IN_LANE = W10.lane_width / 2 - 0.75;   // (where a cyclist rides in the lane: sim/npc.js curbside)

// West 10th, both kerbs lined with parked cars (so a cyclist rides out in the lane), and `pass` or not.
function street({ pass = true, line = true, seed = 3, hazards = false } = {}) {
  setWeather("dry");
  const world = new World(KITS, { seed, parked: 0, pedestrians: 0, passCyclists: pass, hazards });
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: 5 });
  if (line) for (const id of [EDGE, OPP]) {
    const e = KITS.edges.get(id), lat = curbOffset(e, CAR);
    for (let rear = 8, i = 0; rear + CAR.length < e.length - 10; rear += CAR.length + 1.6, i++) {
      const s = rear + CAR.rearOverhang, p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
      const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
      Object.assign(car, { id: `parked_${id}_${i}`, curb: "right", edge: id, stay: true });
      world.parked.add(car);
    }
  }
  world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  return { world, fleet };
}
// A cyclist out in the westbound lane, its rear wheel `rear` metres along it, riding straight on.
function cyclist(world, fleet, { rear = 40, v = 4.5, id = "bike", map = KITS, edge = EDGE, next = NEXT, side = IN_LANE } = {}) {
  const e = map.edges.get(edge), lane = map.lane(edge, 0), s = (rear + BIKE.rearOverhang) * lane.length / e.length;
  const p = pointAt(lane.pts, lane.cum, s), h = headingAt(lane.pts, lane.cum, s);
  const b = new Vehicle(p[0] + Math.sin(h) * side, p[1] - Math.cos(h) * side, h, v, BIKE);
  Object.assign(b, { id, kind: "bike", v0: v, side, strip: false, driver: { aMax: 0.9, b: 2, s0: 2, T: 1.5, react: 0.6, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(map, fleet.random, { bike: true }), frozen: 0, waiting: 0 });
  b.path.start(edge, 0, s, next ? [[next, 0]] : []);
  fleet.vehicles.push(b);
  return b;
}
// A car of the traffic, westbound with its front `front` metres along West 10th, or eastbound (coming
// the other way) with its front `front` metres along it in the westbound edge's own `s`.
function car(world, fleet, { front, v = 0, id, oncoming = false }) {
  const e = oncoming ? KITS.edges.get(OPP) : W10, lane = KITS.lane(e.id, 0);
  const s = (oncoming ? W10.length - front + FRONT : front - FRONT) * lane.length / e.length, p = pointAt(lane.pts, lane.cum, s);
  const n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
  Object.assign(n, { id, color: 0x8d9299, v0: 8.3, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(KITS, fleet.random), frozen: 0, waiting: 0 });
  n.path.start(e.id, 0, s, oncoming ? [] : [[NEXT, 0]]);
  fleet.vehicles.push(n);
  return n;
}
// The driven car with its front `front` metres along West 10th, at `v`, on a route on to Larch.
function drive(world, { front = 20, v = 0 } = {}) {
  const lane = KITS.lane(EDGE, 0), next = KITS.lane(NEXT, 0), s = (front - FRONT) * lane.length / W10.length;
  world.placeOnLane(lane, s);
  world.ego.v = v;
  world.resetContactHistory();
  world.route = new Route(routeFromLanes(KITS, [lane, next], s, 80), KITS, world.ego.spec);
}
const on = (v, e = W10) => projectPoint(e.pts, e.cum, [v.x, v.y], null);
const frontOn = (v) => on(v).s + (v.spec.length - v.spec.rearOverhang);
// The gap between two bodies while one is alongside the other (any longitudinal overlap), or null.
function beside(a, b) {
  const p = a.obb(), q = b.obb(), c = Math.cos(q.heading), s = Math.sin(q.heading), dx = p.center[0] - q.center[0], dy = p.center[1] - q.center[1];
  if (Math.abs(dx * c + dy * s) >= p.halfLength + q.halfLength) return null;
  return Math.abs(dx * s - dy * c) - p.halfWidth - q.halfWidth;
}
function contacts(list, seen) {
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    if (Math.hypot(list[a].x - list[b].x, list[a].y - list[b].y) < 12 && obbOverlap(list[a].obb(), list[b].obb(), 0)) seen.add(`${list[a].id}|${list[b].id}`);
  }
  return seen;
}
// The plan for the driven car past cyclist `b`.
const planFor = (world, b, others = []) => planPass(world, W10, { front: frontOn(world.ego), v: world.ego.v, spec: world.ego.spec, bike: b, on: ridingIn(W10, b), others });

await test("only two-way streets with one lane each way; the minimum passing distance is 1 m up to 50 km/h and 1.5 m above, on every map", () => {
  let total = 0, fast = 0;
  for (const key of KEYS) {
    const map = key === "623b012bc8b5" ? KITS : load(key);
    for (const e of map.edges.values()) {
      const ps = passStreet(map, e.id);
      if (!ps) continue;
      const o = map.edges.get(ps.opposite);
      assert.ok(!e.oneway && e.lanes === 1 && o.lanes === 1 && o.from === e.to && o.to === e.from, `${key} ${e.id}`);
      total++; if (minPassM(e.limit) === 1.5) fast++;
    }
  }
  assert.ok(total > 3000, `${total} streets`);
  assert.ok(fast > 0, `${fast} of them over 50 km/h`);
  assert.equal(passStreet(KITS, EDGE).opposite, OPP);
  assert.ok([...KITS.edges.values()].some((e) => (e.oneway || e.lanes > 1) && passStreet(KITS, e.id) === null), "one-way and multi-lane streets are not");
  assert.equal(minPassM(30 / 3.6), 1); assert.equal(minPassM(50 / 3.6), 1); assert.equal(minPassM(60 / 3.6), 1.5);
  // (marked crosswalks and level crossings, along the street either way)
  assert.ok(passStreet(KITS, "e149").crosswalks.some((s) => Math.abs(s - 189.3) < 0.1) && passStreet(KITS, "e150").crosswalks.some((s) => Math.abs(s - (KITS.edges.get("e150").length - 189.3)) < 0.1));
  const EDM = load("3e794edbefcb");
  assert.ok(passStreet(EDM, "e154").rails.some((s) => Math.abs(s - 51) < 1), "105 Street NW's level crossing");
});

await test("the pass: across the minimum passing distance clear of the cyclist, its marks in order, and not on near a junction, a crosswalk, a level crossing, a van, too fast, without room, or not needed at all", () => {
  const { world, fleet } = street();
  const b = cyclist(world, fleet, { rear: 45 });
  drive(world, { front: 30, v: 4.5 });
  const plan = planFor(world, b);
  assert.ok(plan.possible, plan.why);
  const clearance = (LANE_C + IN_LANE) - BIKE.width / 2 - (LANE_C + plan.shift) - CAR.width / 2;
  assert.ok(Math.abs(clearance - (1 + AIM_M)) < 0.02 && plan.min_pass_m === 1, `${clearance.toFixed(2)} m clear`);
  assert.ok(LANE_C + plan.shift < 0.3 && LANE_C + plan.shift - CAR.width / 2 > -(KITS.edges.get(OPP).lane_offsets[0] + W10.lane_width / 2), "straddling the centre line, inside the oncoming lane");
  assert.ok(plan.from < plan.full && plan.full < plan.back && plan.back < plan.to, "from, full, back, to");
  assert.ok(Math.abs(plan.pass_mps - W10.limit) < 1e-9, "at the street's limit");
  // (at the pass speed already, across by where its front gets LEAD_M short of the cyclist's rear)
  world.ego.v = plan.pass_mps;
  const steady = planFor(world, b), vb = 4.5, gain = (steady.gap_m - LEAD_M) * steady.pass_mps / (steady.pass_mps - vb);
  assert.ok(Math.abs(steady.full - steady.front - gain) < 0.6, `${(steady.full - steady.front).toFixed(1)} vs ${gain.toFixed(1)}`);
  assert.ok(steady.need_s > 5 && steady.need_s < 12, `${steady.need_s.toFixed(1)} s`);
  // (riding the empty parking lane, there is room in the lane: no pass)
  b.y = on(b).point[1]; b.x = on(b).point[0];
  const h = headingAt(W10.pts, W10.cum, on(b).s);
  Object.assign(b, { x: b.x + Math.sin(h) * (LANE_C + 2.6), y: b.y - Math.cos(h) * (LANE_C + 2.6) });
  assert.equal(ridingIn(W10, b), null, "not in the travel lane");
  const strip = planPass(world, W10, { front: frontOn(world.ego), v: 4.5, spec: CAR, bike: b, on: onStreet(W10, b) });
  assert.equal(strip, null, "in the parking lane, room enough to pass in the lane");
  // (not on)
  const why = (opts) => {
    const w = street(), c = cyclist(w.world, w.fleet, opts.bike);
    drive(w.world, { front: opts.front, v: 4.5 });
    if (opts.van) w.world.doubleParked.place({ edge: EDGE, rear: opts.van });
    if (opts.left) { const q = on(c), hh = headingAt(W10.pts, W10.cum, q.s); Object.assign(c, { x: q.point[0] + Math.sin(hh) * (LANE_C - opts.left), y: q.point[1] - Math.cos(hh) * (LANE_C - opts.left) }); }
    return planFor(w.world, c).why;
  };
  assert.equal(why({ bike: { rear: 135 }, front: 120 }), "junction", "the junction ahead");
  assert.equal(why({ bike: { rear: 45, v: 6.5 }, front: 30 }), "too_fast", "riding near the limit");
  assert.equal(why({ bike: { rear: 45, side: -1.3 }, front: 30 }), "no_room", "riding out by the centre line");
  assert.equal(why({ bike: { rear: 45 }, front: 30, van: 110 }), "double_parked", "a van stopped further on");
  // (a marked crosswalk: West 8th Avenue's, 483.7 m along its westbound edge)
  { const w = street({ line: false }), c = cyclist(w.world, w.fleet, { edge: "e150", next: null, rear: 450 }), e = KITS.edges.get("e150");
    w.world.placeOnLane(KITS.lane("e150", 0), 430); w.world.ego.v = 4.5;
    assert.equal(planPass(w.world, e, { front: on(w.world.ego, e).s + FRONT, v: 4.5, spec: CAR, bike: c, on: ridingIn(e, c) }).why, "crosswalk"); }
  // (a level crossing: 105 Street NW, Edmonton)
  { const EDM = load("3e794edbefcb"), e = EDM.edges.get("e154"), w = new World(EDM, { seed: 3, parked: 0, pedestrians: 0, passCyclists: true }), f = new NpcFleet(w, { count: 0, bikes: 0, seed: 5 });
    const c = cyclist(w, f, { map: EDM, edge: "e154", next: null, rear: 20, side: e.lane_width / 2 - 0.75 });
    w.placeOnLane(EDM.lane("e154", 0), 2); w.ego.v = 4.5;
    assert.equal(planPass(w, e, { front: on(w.ego, e).s + FRONT, v: 4.5, spec: CAR, bike: c, on: ridingIn(e, c) }).why, "level_crossing"); }
  // (1.5 m above 50 km/h: Cogswell Street, Halifax, 65 km/h)
  { const HFX = load("49db0d437c8c"), e = HFX.edges.get("e3"), w = new World(HFX, { seed: 3, parked: 0, pedestrians: 0, passCyclists: true }), f = new NpcFleet(w, { count: 0, bikes: 0, seed: 5 });
    const c = cyclist(w, f, { map: HFX, edge: "e3", next: null, rear: 30, side: e.lane_width / 2 - 0.75 });
    w.placeOnLane(HFX.lane("e3", 0), 10); w.ego.v = 8;
    const p = planPass(w, e, { front: on(w.ego, e).s + FRONT, v: 8, spec: CAR, bike: c, on: ridingIn(e, c) });
    assert.equal(p.min_pass_m, 1.5);
    assert.ok(Math.abs((e.lane_offsets[0] + e.lane_width / 2 - 0.75) - BIKE.width / 2 - (e.lane_offsets[0] + p.shift) - CAR.width / 2 - 1.5 - AIM_M) < 0.02, "1.5 m clear"); }
});

await test("the way: clear with nobody coming; not with someone coming too soon, standing in the way or turning into the oncoming lane ahead; a long way off, standing beyond it or already past is no matter", () => {
  const { world, fleet } = street({ line: false });
  const b = cyclist(world, fleet, { rear: 45 });
  drive(world, { front: 30, v: 4.5 });
  const plan = planFor(world, b);
  const way = (list) => wayClear(world, plan, list);
  assert.ok(way([]).clear);
  const near = car(world, fleet, { front: 120, v: 8.3, id: "near", oncoming: true });
  const w = way([near]);
  assert.ok(!w.clear && w.oncoming?.vehicle.id === "near" && w.oncoming.eta_s < plan.need_s + MARGIN_S, `due in ${w.oncoming?.eta_s.toFixed(1)} s, needs ${plan.need_s.toFixed(1)} s`);
  near.v = 0;
  assert.ok(!way([near]).clear && way([near]).oncoming.eta_s === 0, "standing in the oncoming lane along the pass");
  const beyond = car(world, fleet, { front: plan.to + 12, v: 0, id: "beyond", oncoming: true });
  assert.ok(way([beyond]).clear, "standing beyond it");
  const past = car(world, fleet, { front: plan.start - 10, v: 8.3, id: "past", oncoming: true });
  assert.ok(way([past]).clear, "already past");
  // (coming straight on from far beyond the junction ahead; and turning into the oncoming lane there)
  const node = KITS.nodes.get(W10.to), o = KITS.edges.get(OPP), into = headingAt(o.pts, o.cum, 0);
  const far = new Vehicle(node.x - Math.cos(into) * 160, node.y - Math.sin(into) * 160, into, 8.3);
  far.id = "far";
  assert.ok(way([far]).clear, "160 m beyond the junction");
  const turner = new Vehicle(node.x - Math.cos(into - Math.PI / 2) * 25, node.y - Math.sin(into - Math.PI / 2) * 25, into - Math.PI / 2, 8);
  Object.assign(turner, { id: "turner", signal: "left" });
  assert.ok(!way([turner]).clear && way([turner]).oncoming.vehicle.id === "turner", "turning left into it");
  turner.signal = "right";
  assert.ok(way([turner]).clear, "turning the other way");
  // (and the driven car must see along the oncoming lane: by day it does, by night or in fog it cannot)
  assert.ok(wayClear(world, plan, [], sightFor(world, plan)).sees_far_enough, "by day");
  world.visibility.setNight(1);
  assert.ok(!wayClear(world, plan, [], sightFor(world, plan)).sees_far_enough, "by night");
  world.visibility.setNight(0);
  setWeather("fog");
  const fog = wayClear(world, plan, [], sightFor(world, plan));
  setWeather("dry");
  assert.ok(!fog.sees_far_enough && !fog.clear, "in fog");
});

await test("traffic waits behind the cyclist while cars come the other way, then passes it the minimum passing distance clear, never across with one near; with the option off it stays behind", () => {
  for (const pass of [true, false]) {
    const { world, fleet } = street({ pass });
    drive(world, { front: 5 });
    world.route = null;
    world.ego.x += 400;   // (the driven car out of the way)
    const b = cyclist(world, fleet, { rear: 45 });
    const n = car(world, fleet, { front: 30, v: 4.5, id: "follower" });
    const onc = [110, 124].map((front, i) => car(world, fleet, { front, v: 8.3, id: `onc_${i}`, oncoming: true }));
    const hits = new Set();
    let minGap = Infinity, metAcross = 0, firstAcross = null, lastBy = null, passed = false, everAcross = false;
    for (let i = 0; i < 60 * 30; i++) {
      step({ world, fleet, autopilot: idle });
      const g = beside(n, b);
      if (g !== null) minGap = Math.min(minGap, g);
      const q = on(n), across = q.lateral < LANE_C - 0.5 && n.path.currentEdge().id === EDGE;
      if (across) { everAcross = true; if (firstAcross === null) firstAcross = world.t; }
      for (const o of onc) {
        if (!fleet.vehicles.includes(o)) continue;
        const ahead = n.toLocal(o.x, o.y).ahead;
        if (across && ahead > -2 && ahead < 25) metAcross++;
        if (ahead < -2 && o === onc[1] && lastBy === null) lastBy = world.t;
      }
      if (n.path.currentEdge().id !== EDGE || frontOn(n) > on(b).s + BIKE.length + RETURN_M) passed ||= n.toLocal(b.x, b.y).ahead < -RETURN_M;
      if (i % 3 === 0) contacts([n, b, ...onc, ...world.parked.near(n.x, n.y, 20)], hits);
    }
    assert.equal([...hits].filter((k) => !k.split("|").every((id) => id.startsWith("parked"))).length, 0, `no contacts: ${[...hits]}`);
    if (pass) {
      assert.ok(passed, "it passed the cyclist");
      assert.ok(minGap >= 1 - 0.05, `${minGap.toFixed(2)} m clear beside it`);
      assert.equal(metAcross, 0, "never across with an oncoming car near");
      assert.ok(lastBy !== null && firstAcross !== null && firstAcross > lastBy, `across at ${firstAcross?.toFixed(1)} s, after the oncoming cars were by at ${lastBy?.toFixed(1)} s`);
    } else {
      assert.ok(!passed && !everAcross && n.cyc === undefined, "with the option off it stays behind the cyclist, in its lane");
    }
  }
});

await test("traffic: only the first driver behind the cyclist passes it; the next waits until that one is by, then passes too", () => {
  const { world, fleet } = street();
  drive(world, { front: 5 });
  world.route = null; world.ego.x += 400;
  const b = cyclist(world, fleet, { rear: 22, v: 4 });
  const first = car(world, fleet, { front: 14, v: 4, id: "first" }), second = car(world, fleet, { front: 4, v: 4, id: "second" });
  const hits = new Set();
  let both = 0, minGap = Infinity;
  for (let i = 0; i < 60 * 30; i++) {
    step({ world, fleet, autopilot: idle });
    // (both out in the oncoming lane, neither yet past the cyclist)
    if ([first, second].every((n) => n.cyc?.phase === "out" && n.toLocal(b.x, b.y).ahead > -n.spec.rearOverhang - BIKE.length)) both++;
    for (const n of [first, second]) { const g = beside(n, b); if (g !== null) minGap = Math.min(minGap, g); }
    if (i % 3 === 0) contacts([first, second, b], hits);
  }
  assert.equal(hits.size, 0, `no contacts: ${[...hits]}`);
  assert.equal(both, 0, "never both alongside it or behind it at once");
  assert.ok([first, second].every((n) => n.toLocal(b.x, b.y).ahead < 0), "both got by");
  assert.ok(minGap >= 0.95, `${minGap.toFixed(2)} m clear`);
});

await test("sensing and candidates: behind the cyclist while the way is not clear it follows, then only pass_cyclist goes round; it sees an oncoming car out to 250 m by clear daylight; by night or in fog it stays behind; near the junction no pass is on; abreast it carries on, behind it falls back in", () => {
  const { world, fleet } = street();
  const b = cyclist(world, fleet, { rear: 45 });
  drive(world, { front: 33, v: 4.5 });
  const onc = car(world, fleet, { front: 105, v: 8.3, id: "onc", oncoming: true });
  let snap = buildSnapshot(world);
  const cp = snap.cyclist_pass;
  assert.ok(cp && !cp.go && cp.possible && cp.way.oncoming?.id === "onc" && !cp.detour, "waits for the oncoming car");
  assert.equal(snap.following?.id, b.id, "and follows the cyclist");
  assert.ok(snap.target.v <= cp.follow_mps + 1e-9, "at the following speed");
  let cands = sampleCandidates(snap, world);
  assert.ok(cands.some((c) => c.id === "follow_cyclist") && !cands.some((c) => c.id === "pass_cyclist") && cands.every((c) => !isCyclistPass(c.law.detour)));
  // (the oncoming car gone: the way is clear)
  fleet.vehicles.splice(fleet.vehicles.indexOf(onc), 1);
  snap = buildSnapshot(world);
  const g = snap.cyclist_pass;
  assert.ok(g.go && g.way.clear && g.detour?.id === `cyclist:${b.id}` && Math.abs(g.detour.shift - g.shift_m) < 1e-9);
  assert.ok(snap.following?.id !== b.id, "the cyclist is passed, not followed");
  cands = sampleCandidates(snap, world);
  const pass = cands.find((c) => c.id === "pass_cyclist");
  assert.ok(pass && pass.laneTarget === g.limit_mps);
  assert.ok(pass.law.detour === g.detour && cands.filter((c) => c.id !== "pass_cyclist").every((c) => !isCyclistPass(c.law.detour)), "only pass_cyclist goes round, at the pass speed");
  assert.ok(!cands.find((c) => c.id === "follow_cyclist").law.detour, "or stay behind it");
  // (an oncoming car beyond the 80 m the car sees everything else in, but on the long look along the
  // street by clear daylight: the way is not clear; in rain the car cannot see far enough)
  const far = car(world, fleet, { front: 125, v: 8.3, id: "far", oncoming: true });
  const farSnap = buildSnapshot(world);
  assert.ok(!farSnap.cyclist_pass.go && farSnap.cyclist_pass.way.oncoming?.id === "far", "sees it coming");
  fleet.vehicles.splice(fleet.vehicles.indexOf(far), 1);
  setWeather("rain");
  const rain = buildSnapshot(world).cyclist_pass;
  setWeather("dry");
  assert.ok(rain && !rain.go && !rain.way.sees_far_enough, "in rain");
  const { eligible } = simulateAll(cands, snap, world);
  assert.ok(eligible.some((c) => c.id === "pass_cyclist"), "going round is clear");
  // (by night, or in fog, it cannot see far enough along the oncoming lane: it stays behind)
  world.visibility.setNight(1);
  const night = buildSnapshot(world).cyclist_pass;
  assert.ok(night && !night.go && !night.way.sees_far_enough && cyclistNotice(world)?.text === "CYCLIST AHEAD · CAN'T SEE FAR ENOUGH · STAY BEHIND", "by night");
  world.visibility.setNight(0);
  setWeather("fog");
  const fog = buildSnapshot(world).cyclist_pass;
  setWeather("dry");
  assert.ok(fog && !fog.go && !fog.way.sees_far_enough, "in fog");
  // (a squeeze past in the lane, 1.2 m clear: allowed by the metre without the option, not by 1.5 m above 50 km/h)
  drive(world, { front: 40, v: 6 });
  const squeeze = () => ({ id: "squeeze", law: { kind: "lane", offset: -(1.2 + (BIKE.width + CAR.width) / 2 - IN_LANE), vTarget: 8 } });
  // (with no pass planned, by the road's limit; with one, by the distance it was planned for, from the
  // street's own limit, not a school zone's)
  const fast = buildSnapshot(world); fast.road = { ...fast.road, limit: 60 / 3.6 };
  const planned = fast.cyclist_pass;
  fast.cyclist_pass = null;
  const s1 = squeeze(); simulateAll([s1], fast, world);
  assert.equal(s1.reject, "passes_cyclist_without_room", "1.5 m above 50 km/h");
  fast.cyclist_pass = { ...planned, min_pass_m: 1.5 };
  const s3 = squeeze(); simulateAll([s3], fast, world);
  assert.equal(s3.reject, "passes_cyclist_without_room", "planned for 1.5 m");
  const slow = buildSnapshot(world); slow.road = { ...slow.road, limit: 60 / 3.6 };
  const s4 = squeeze(); simulateAll([s4], slow, world);
  assert.ok(slow.cyclist_pass?.min_pass_m === 1 && s4.reject !== "passes_cyclist_without_room", `planned for 1 m on a 30 km/h street: ${s4.reject}`);
  world.passCyclists = false;
  const off = buildSnapshot(world), s2 = squeeze(); simulateAll([s2], off, world);
  world.passCyclists = true;
  assert.ok(off.cyclist_pass === null && s2.reject !== "passes_cyclist_too_close" && s2.reject !== "passes_cyclist_without_room", `the metre without the option: ${s2.reject}`);
  // (near the junction ahead, no pass is on)
  const { world: w2, fleet: f2 } = street();
  cyclist(w2, f2, { rear: 132 });
  drive(w2, { front: 120, v: 4.5 });
  const late = buildSnapshot(w2);
  assert.ok(late.cyclist_pass && !late.cyclist_pass.possible && late.cyclist_pass.why === "junction" && !late.cyclist_pass.go);
  assert.ok(!sampleCandidates(late, w2).some((c) => c.id === "pass_cyclist"));
  // (abreast of it, going round, an oncoming car turns up: it carries on, and no manoeuvre may meet it)
  drive(world, { front: 30, v: 4.5 });
  const law = sampleCandidates(buildSnapshot(world), world).find((c) => c.id === "pass_cyclist").law;
  const q = on(b), h = headingAt(W10.pts, W10.cum, q.s), at = q.s - 1.5;
  const p = pointAt(W10.pts, W10.cum, at);
  Object.assign(world.ego, { x: p[0] + Math.sin(h) * (LANE_C + g.shift_m), y: p[1] - Math.cos(h) * (LANE_C + g.shift_m), psi: h, v: 7 });
  const late2 = car(world, fleet, { front: q.s + 40, v: 8.3, id: "late", oncoming: true });
  const abreast = buildSnapshot(world, { law });
  assert.ok(abreast.cyclist_pass.going && abreast.cyclist_pass.go && abreast.cyclist_pass.detour, "committed");
  const ac = sampleCandidates(abreast, world);
  assert.ok(ac.every((c) => c.id === "pass_cyclist" || c.id === "follow_cyclist" || c.id === "hard_brake") && ac.find((c) => c.id === "hard_brake").law.detour === abreast.cyclist_pass.detour,
    `going round, it carries on round at the pass speed or brakes: ${ac.map((c) => c.id).join(" ")}`);
  simulateAll(ac, abreast, world);
  assert.ok(ac.some((c) => c.reject === "crosses_into_oncoming_traffic" || c.reject === "collision"), "meeting it is ruled out");
  // (abreast of it, the cyclist speeds up so the pass no longer works out: it keeps the marks it is going by)
  const v0 = b.v;
  b.v = 6.3;
  const faster = buildSnapshot(world, { law }).cyclist_pass;
  b.v = v0;
  assert.ok(faster.going && faster.go && faster.why === "too_fast" && faster.detour === law.detour && ["from", "full", "back", "to"].every((k) => Number.isFinite(faster.detour[k])), "keeps the way round it started");
  // (still behind it, moved half across: it falls back in)
  fleet.vehicles.splice(fleet.vehicles.indexOf(late2), 1);
  drive(world, { front: 35, v: 6 });
  const lane = KITS.lane(EDGE, 0), sp = projectPoint(lane.pts, lane.cum, [world.ego.x, world.ego.y], null);
  Object.assign(world.ego, { x: world.ego.x + Math.sin(sp.heading) * -0.8, y: world.ego.y - Math.cos(sp.heading) * -0.8 });
  car(world, fleet, { front: 95, v: 8.3, id: "late3", oncoming: true });
  const back = buildSnapshot(world, { law });
  assert.ok(back.cyclist_pass.going && !back.cyclist_pass.go && !back.cyclist_pass.detour, "falls back in behind");
  assert.ok(sampleCandidates(back, world).some((c) => c.id === "follow_cyclist"));
});

await test("the long look along the street still stops at a vehicle in the way, with hidden traffic on, as far as it reaches; with no reach, nothing changes", () => {
  const { world, fleet } = street({ hazards: true });
  drive(world, { front: 20, v: 4.5 });
  const target = car(world, fleet, { front: 150, v: 0, id: "far" });
  assert.ok(world.sees(world.ego, target, PASS_SIGHT_M) && !world.sees(world.ego, target), "seen 130 m off only on the long look");
  const blocker = car(world, fleet, { front: 70, v: 0, id: "blocker" });
  assert.ok(!world.sees(world.ego, target, PASS_SIGHT_M), "hidden behind the car 50 m ahead");
  assert.ok(world.sees(world.ego, blocker, PASS_SIGHT_M) && world.sees(world.ego, blocker), "which it sees either way");
});

await test("closed loop: Rules waits behind the cyclist for the oncoming cars, then passes it 1 m clear and moves back in ahead of it; the HUD says so; nothing is counted", async () => {
  const { world, fleet } = street();
  const b = cyclist(world, fleet, { rear: 40 });
  drive(world, { front: 22 });
  const onc = [75, 87].map((front, i) => car(world, fleet, { front, v: 8.3, id: `onc_${i}`, oncoming: true }));
  let arrived = false;
  const autopilot = new Autopilot(world, { onEvent: (e) => { if (e.type === "arrived") arrived = true; } });
  autopilot.setBrain("rules"); autopilot.setEnabled(true);
  const score = new DriveScore(world), metrics = new DriveMetrics(world.route.length), texts = [];
  let minGap = Infinity, metAcross = 0, ahead = false, back = false;
  while (world.t < 60 && autopilot.enabled && !arrived) {
    const road = step({ world, fleet, autopilot });
    score.record(world, road, 1 / 60); metrics.record(world, autopilot.snap, road, 1 / 60);
    if (autopilot.firing) await autopilot.firing;
    const g = beside(world.ego, b);
    if (g !== null) minGap = Math.min(minGap, g);
    const across = on(world.ego).lateral < 0;
    for (const o of onc) if (fleet.vehicles.includes(o) && across && Math.hypot(o.x - world.ego.x, o.y - world.ego.y) < 25) metAcross++;
    if (world.ego.toLocal(b.x, b.y).ahead < -RETURN_M) ahead = true;
    if (ahead && Math.abs(on(world.ego).lateral - LANE_C) < 0.3) back = true;
    const n = cyclistNotice(world);
    if (n && texts.at(-1) !== n.text) texts.push(n.text);
  }
  const v = world.violations, m = metrics.summary(world, autopilot, arrived);
  assert.ok(arrived, "arrives");
  assert.equal(v.collisions + v.failed_to_yield + v.safety_brakes + (v.close_passes || 0), 0, JSON.stringify(v));
  assert.ok(ahead && back, "past it and back in its lane");
  assert.ok(minGap >= 1, `${minGap.toFixed(2)} m clear beside it`);
  assert.equal(metAcross, 0, "never across near an oncoming car");
  assert.ok(texts.includes("CYCLIST AHEAD · ONCOMING TRAFFIC · STAY BEHIND") && texts.includes("CYCLIST AHEAD · WAY CLEAR · PASS WITH 1 M") && texts.some((t) => t.startsWith("PASSING A CYCLIST")), texts.join(" / "));
  assert.ok(texts.indexOf("CYCLIST AHEAD · ONCOMING TRAFFIC · STAY BEHIND") < texts.indexOf("CYCLIST AHEAD · WAY CLEAR · PASS WITH 1 M"), "stay behind, then pass");
  assert.equal(m.close_passes, 0); assert.ok(m.pass, JSON.stringify(failures(m)));
  assert.equal(score.snapshot().wrong_way_s, 0, "passing is not driving the wrong way");
});

await test("models are told: the cyclist in the state, a situation line, the motion criterion and the prompt", () => {
  const { world, fleet } = street();
  cyclist(world, fleet, { rear: 45 });
  drive(world, { front: 33, v: 4.5 });
  const onc = car(world, fleet, { front: 105, v: 8.3, id: "onc", oncoming: true });
  let snap = buildSnapshot(world), cands = sampleCandidates(snap, world);
  simulateAll(cands, snap, world);
  const state = toJevState(snap, cands, {});
  assert.ok(state.cyclist_pass.stay_behind && state.cyclist_pass.pass === "oncoming traffic" && state.cyclist_pass.oncoming.id === "onc" && state.cyclist_pass.min_passing_distance_m === 1, JSON.stringify(state.cyclist_pass));
  const line = situationClauses(snap).find((l) => /minimum passing distance/.test(l));
  assert.ok(line && /onc/.test(line) && /follow_cyclist/.test(line) && /Never squeeze past/.test(line), line);
  assert.ok(!situationClauses(snap).some((l) => /stay behind it at a safe gap; passing needs at least 1 m/.test(l)), "in place of the plain cyclist line");
  const { questions } = buildQuestions(snap, cands.filter((c) => c.eligible));
  assert.ok(/follow_cyclist/.test(questions.motion.criteria.drive));
  assert.ok(/pass_cyclist/.test(SYSTEM_PROMPT) && /follow_cyclist/.test(SYSTEM_PROMPT) && /min_passing_distance_m/.test(SYSTEM_PROMPT));
  fleet.vehicles.splice(fleet.vehicles.indexOf(onc), 1);
  snap = buildSnapshot(world); cands = sampleCandidates(snap, world);
  simulateAll(cands, snap, world);
  assert.ok(toJevState(snap, cands, {}).cyclist_pass.go_round);
  assert.ok(/clear for the whole pass now/.test(situationClauses(snap).find((l) => /minimum passing distance/.test(l))));
  assert.ok(toJevState(snap, cands, {}).candidates.some((c) => c.id === "pass_cyclist" && /goes round the cyclist/.test(c.outcome)));
});

await test("the audit counts passing a cyclist closer than the minimum passing distance, once, and crossing into an oncoming car while passing one as a failure to yield; with the option off neither reaches the metrics", () => {
  for (const pass of [true, false]) {
    const { world, fleet } = street({ pass, line: false });
    const b = cyclist(world, fleet, { rear: 60, v: 0 });
    b.frozen = 1e6;
    drive(world, { front: 40 });
    world.route = null;
    const score = new DriveScore(world), metrics = new DriveMetrics(100);
    // (straight past it, 0.5 m clear, at 5 m/s)
    const lat = LANE_C + IN_LANE - BIKE.width / 2 - 0.5 - CAR.width / 2;
    const pose = (s, l) => { const p = pointAt(W10.pts, W10.cum, s), h = headingAt(W10.pts, W10.cum, s); return { x: p[0] + Math.sin(h) * l, y: p[1] - Math.cos(h) * l, psi: h, v: 5 }; };
    for (let s = 40 - FRONT; s < 80; s += 5 / 60) {
      Object.assign(world.ego, pose(s, lat));
      const road = step({ world, fleet, autopilot: idle });
      score.record(world, road, 1 / 60); metrics.record(world, null, road, 1 / 60);
    }
    const m = metrics.summary(world, { totals: {} }, true);
    if (pass) {
      assert.equal(world.violations.close_passes, 1, "counted once");
      assert.equal(m.close_passes, 1);
      assert.ok(failures(m).includes("passed a cyclist too close"));
      const snap = score.snapshot();
      assert.equal(snap.close_passes, 1);
      assert.ok(snap.tips.some((t) => /at least 1 m when you pass/.test(t)));
    } else {
      assert.ok(world.violations.close_passes === undefined && !("close_passes" in m) && !failures(m).includes("passed a cyclist too close") && !("close_passes" in score.snapshot()), "nothing with the option off");
    }
  }
  // (1.3 m clear: no close pass)
  { const { world, fleet } = street({ line: false }), b = cyclist(world, fleet, { rear: 60, v: 0 });
    b.frozen = 1e6; drive(world, { front: 40 }); world.route = null;
    const lat = LANE_C + IN_LANE - BIKE.width / 2 - 1.3 - CAR.width / 2;
    for (let s = 40 - FRONT; s < 80; s += 5 / 60) { const p = pointAt(W10.pts, W10.cum, s), h = headingAt(W10.pts, W10.cum, s); Object.assign(world.ego, { x: p[0] + Math.sin(h) * lat, y: p[1] - Math.cos(h) * lat, psi: h, v: 5 }); step({ world, fleet, autopilot: idle }); }
    assert.equal(world.violations.close_passes || 0, 0); }
  // (across the centre line passing it, into an oncoming car standing ahead: a failure to yield, once)
  const { world, fleet } = street({ line: false });
  const b = cyclist(world, fleet, { rear: 60, v: 0 });
  b.frozen = 1e6;
  const o = car(world, fleet, { front: 75, v: 0, id: "onc", oncoming: true });
  o.frozen = 1e6;
  drive(world, { front: 50 }); world.route = null;
  const score = new DriveScore(world);
  for (let s = 50 - FRONT; s < 62; s += 5 / 60) {
    const p = pointAt(W10.pts, W10.cum, s), h = headingAt(W10.pts, W10.cum, s);
    Object.assign(world.ego, { x: p[0] + Math.sin(h) * -0.4, y: p[1] - Math.cos(h) * -0.4, psi: h, v: 5 });
    const road = step({ world, fleet, autopilot: idle });
    score.record(world, road, 1 / 60);
    assert.ok(egoPassing(world)?.bike === b);
  }
  assert.equal(world.violations.failed_to_yield, 1, "counted once");
  const snap = score.snapshot();
  assert.ok(snap.cyclist_cutoffs === 1 && snap.wrong_way_s === 0, JSON.stringify({ c: snap.cyclist_cutoffs, w: snap.wrong_way_s }));
});

await test("with the option off nothing is computed: no cyclist_pass, no pass state on any driver, no audit state, and a free drive plays out exactly as with no option at all", () => {
  const run = (opts, { count = 25, seconds = 60 } = {}) => {
    setWeather("dry");
    const world = new World(KITS, { seed: 11, pedestrians: 0, ...opts });
    const fleet = new NpcFleet(world, { count, bikes: 12, seed: 17 });
    let reported = 0, passing = 0, hits = new Set(), started = 0;
    const wasPassing = new Set();
    world.route = new Route(routeFromLanes(KITS, [KITS.lane(EDGE, 0), KITS.lane(NEXT, 0)], 10, 80), KITS, world.ego.spec);
    world.placeOnLane(KITS.lane(EDGE, 0), 10);
    for (let i = 0; i < 60 * seconds; i++) {
      step({ world, fleet, autopilot: idle });
      if (i % 30 === 0 && buildSnapshot(world).cyclist_pass) reported++;
      for (const n of fleet.vehicles) if (n.cyc) { passing++; if (!wasPassing.has(n.id)) { wasPassing.add(n.id); started++; } } else wasPassing.delete(n.id);
      if (i % 6 === 0) contacts(fleet.vehicles.filter((n) => n.cyc), hits);
    }
    const sig = fleet.vehicles.map((n) => `${n.id}:${n.x.toFixed(6)},${n.y.toFixed(6)},${n.v.toFixed(6)}`).join("|");
    return { reported, passing, started, hits: hits.size, sig, audit: world.bikePasses.size, close: world.violations.close_passes };
  };
  const plain = run({}), off = run({ passCyclists: false }), onRun = run({ passCyclists: true }, { count: 40, seconds: 180 });
  assert.ok(off.reported === 0 && off.passing === 0 && off.audit === 0 && off.close === undefined, JSON.stringify({ ...off, sig: undefined }));
  assert.equal(off.sig, plain.sig, "identical to a drive with no option");
  assert.ok(onRun.started > 0, `with it on, 40 cars started ${onRun.started} passes of cyclists in 3 minutes`);
  assert.equal(onRun.hits, 0, "and touched nobody doing it");
});

await test("the challenge: Rules and the cautious agent wait behind the cyclist while the oncoming cars come by, then pass it 1 m clear and arrive; without passing cyclists the car never gets by", async () => {
  const challenge = CHALLENGES.find((c) => c.id === "cyclist-pass");
  assert.ok(challenge && challenge.map === "kitsilano" && challenge.passCyclists && challenge.title === "Give them room");
  const scenario = challengeScenario(KITS, challenge);
  assert.equal(KITS.edges.get(scenario.start.edge).name, "West 10th Avenue");
  for (const brain of ["rules", "cautious", "off"]) {
    let arrived = false;
    const ch = brain === "off" ? { ...challenge, passCyclists: false } : challenge;
    const ctx = setupChallenge(KITS, ch, { brain: brain === "off" ? "rules" : brain, onEvent: (e) => { if (e.type === "arrived") arrived = true; } });
    const { world, fleet, autopilot } = ctx, e = KITS.edges.get(scenario.start.edge), bike = fleet.vehicles.find((v) => v.id === world.challenge.cyclistId);
    const metrics = new DriveMetrics(world.route.length);
    let waited = 0, minGap = Infinity, metAcross = 0, passedAt = null, lastBy = null;
    while (world.t < 90 && autopilot.enabled && !arrived) {
      const road = step({ world, fleet, autopilot });
      metrics.record(world, autopilot.snap, road, 1 / 60);
      if (autopilot.firing) await autopilot.firing;
      const cp = autopilot.snap?.cyclist_pass;
      if (cp && !cp.go && cp.way?.oncoming) waited += 1 / 60;
      const g = beside(world.ego, bike);
      if (g !== null) minGap = Math.min(minGap, g);
      const across = projectPoint(e.pts, e.cum, [world.ego.x, world.ego.y], null).lateral < 0;
      for (const id of world.challenge.cyclistCarIds) {
        const n = fleet.vehicles.find((v) => v.id === id);
        if (!n) continue;
        if (across && Math.hypot(n.x - world.ego.x, n.y - world.ego.y) < 25) metAcross++;
        if (id.endsWith("_2") && lastBy === null && world.ego.toLocal(n.x, n.y).ahead < -5) lastBy = world.t;
      }
      // (by on the challenge's block, where the cyclist rides out in the lane)
      const qe = projectPoint(e.pts, e.cum, [world.ego.x, world.ego.y], null);
      if (passedAt === null && qe.s < e.length - 1 && world.ego.toLocal(bike.x, bike.y).ahead < -RETURN_M) passedAt = world.t;
    }
    const v = world.violations, m = metrics.summary(world, autopilot, arrived);
    assert.ok(arrived, `${brain} arrives`);
    assert.equal(v.collisions + v.failed_to_yield + v.safety_brakes + (v.close_passes || 0), 0, `${brain}: ${JSON.stringify(v)}`);
    if (brain === "off") { assert.equal(passedAt, null, "without the option, the car stays behind the cyclist along the block"); continue; }
    assert.ok(m.pass && m.close_passes === 0, `${brain}: ${failures(m)}`);
    assert.ok(waited > 2, `${brain} stayed behind for the oncoming cars for ${waited.toFixed(1)} s`);
    assert.ok(passedAt !== null && lastBy !== null && passedAt > lastBy, `${brain} passed at ${passedAt?.toFixed(1)} s, after the oncoming cars were by at ${lastBy?.toFixed(1)} s`);
    assert.ok(minGap >= 1, `${brain}: ${minGap.toFixed(2)} m clear beside the cyclist`);
    assert.equal(metAcross, 0, `${brain} never across near an oncoming car`);
  }
});

console.log(`${checks} cyclist passing checks passed`);
process.exit(0);
