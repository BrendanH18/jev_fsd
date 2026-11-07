// Canada geese crossing the road: the parks layer; where a gaggle crosses (only beside parks and water);
// the gaggle in loose single file, the lead looking at the kerb, pauses and one stopping in the road; the
// one conflict test shared by sensing, candidates, traffic (cyclists too) and the lead's look; waiting
// for the last goose; the audit, creeping in counted; what models are told; the "Goose crossing"
// challenge with Rules and the cautious agent, and a driver who goes once the first geese are across;
// checkpoints; and nothing computed, drawn or reported with the option off.
//   node --experimental-default-type=module scripts/test_geese.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, BIKE } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { setWeather } = await import("../static/js/sim/weather.js");
const { applyLaw } = await import("../static/js/sim/controller.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const G = await import("../static/js/sim/geese.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, situationClauses, buildQuestions } = await import("../static/js/brain/state.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const { routeFromLanes } = await import("../static/js/demo/routing.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");

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
const OTT = load("d25b07def0d2");
const step = (ctx) => stepWorld(ctx, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const lesson = CHALLENGES.find(c => c.id === "goose-crossing");
const scenario = challengeScenario(OTT, lesson);
const SITE = scenario.geese;   // { edge, s, sigma }
const FRONT = CAR.length - CAR.rearOverhang;

function world({ geese = true, seed = 3, traffic = 0, parked = 0, pedestrians = 0, weather = "dry" } = {}) {
  setWeather(weather);
  const w = new World(OTT, { seed, parked, pedestrians, geese, weather });
  const fleet = new NpcFleet(w, { count: traffic, bikes: 0, seed: 5 });
  w.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
  if (geese) w.geese.target = 0;
  return { world: w, fleet, autopilot: idle };
}
// The driven car in the lane of the challenge's street, `back` metres short of the crossing, with a route
// along it (from the edge before) past it.
function egoAt(ctx, back, v = 0) {
  const e = OTT.edges.get(SITE.edge), lane = OTT.lane(e.id, 0), k = lane.length / e.length;
  const before = OTT.edges.get(scenario.start.edge), laneB = OTT.lane(before.id, 0), kB = laneB.length / before.length;
  const w = ctx.world;
  let route;
  if (back <= SITE.s - 1) {
    const s = (SITE.s - back) * k - FRONT;
    w.placeOnLane(lane, s);
    route = routeFromLanes(OTT, [lane], s, (SITE.s + 30) * k);
  } else {
    const s = (before.length - (back - SITE.s)) * kB - FRONT;
    w.placeOnLane(laneB, s);
    route = routeFromLanes(OTT, [laneB, lane], s, (SITE.s + 30) * k);
  }
  w.ego.v = v;
  w.route = new Route(route, OTT, w.ego.spec);
  return lane;
}
function runUntil(ctx, cond, seconds) {
  for (let k = 0; k < seconds * 60; k++) { step(ctx); if (cond()) return true; }
  return false;
}
// A gaggle of `n` adults walking at `pace`, on the challenge's site, from its side, at once (no trigger).
const file = (n, pace = 0.6, extra = {}) => Array.from({ length: n }, (_, i) => ({ gosling: false, pace, spacing: i ? 1.2 : 0, ...(extra[i] || {}) }));
// (the file moved up so that the lead stands a step short of the kerb, as in the challenge)
function atKerb(w, g) {
  const shift = g.geo.uIn - 1.2 - g.geese[0].u;
  for (const o of g.geese) { o.u += shift; w.geese.pose(g, o); }
  return g;
}

await test("the layer: parks and water beside every pack, and the spans of street beside them", () => {
  assert.equal(OTT.parks.length > 10, true);
  assert.equal(OTT.parkSpans.length > 50, true);
  const areas = new Set(OTT.parks.map(a => a.id));
  for (const sp of OTT.parkSpans) {
    assert.equal(OTT.edges.has(sp.edge), true);
    assert.equal(!!(sp.left || sp.right), true);
    for (const side of [sp.left, sp.right]) if (side) assert.equal(areas.has(side), true, side);
  }
  // (the challenge's street, Clemow Avenue, between Central Park and Patterson's Creek Park)
  const e = OTT.edges.get(SITE.edge);
  assert.equal(e.name, "Clemow Avenue");
  const sp = OTT.parkSpans.find(x => x.edge === e.id && x.from <= SITE.s && x.to >= SITE.s);
  const names = [sp.left, sp.right].map(id => OTT.parks.find(a => a.id === id).name).sort();
  assert.deepEqual(names, ["Central Park", "Patterson's Creek Park"]);
});

await test("where they cross: from the grass beyond the sidewalk, kerb to kerb, across both directions' lanes", () => {
  const geo = G.crossingGeometry(OTT, SITE.edge, SITE.s, SITE.sigma, 0), e = geo.e;
  // (the kerb faces: the roadway's width apart, the start on the grass beyond the sidewalk)
  const road = e.asphalt[1] - e.asphalt[0] + 0.6;
  assert.equal(Math.abs(geo.uOut - geo.uIn - road) < 1e-6, true);
  assert.equal(geo.uIn > 3, true);
  assert.equal(geo.uEnd > geo.uOut + geo.uIn, true);
  // (it runs straight across: perpendicular to the street)
  assert.equal(Math.abs(Math.cos(geo.heading - geo.h)) < 1e-6, true);
  // (the corridor crosses this lane and the oncoming one)
  const twin = [...OTT.edges.values()].find(o => o.from === e.to && o.to === e.from);
  const g = { geo, phase: "crossing" };
  for (const lane of [OTT.lane(e.id, 0), OTT.lane(twin.id, 0)]) {
    const c = G.geeseConflict(g, lane, { front: 0, look: 200 });
    assert.equal(c.kind, "crossing");
  }
  // (a street it does not cross is not in its way)
  const other = OTT.lane(scenario.start.edge, 0);
  assert.equal(G.geeseConflict(g, { pts: other.pts.slice(0, 5), cum: other.cum.slice(0, 5) }, { front: 0 }), null);
});

await test("free drives: a gaggle now and then beside a park or water on the route, by day, not in snow, from its own stream", () => {
  const ctx = world({ seed: 4 }), w = ctx.world;
  w.geese.target = 1;
  assert.equal(typeof w.geese.random, "function");
  egoAt(ctx, 150);
  w.setClock({ hour: 14, sun_deg: 40 });
  const g = w.geese.spawn();
  assert.equal(!!g, true);
  assert.equal(g.phase, "waiting");
  // (on a span of the parks layer, with a park or water on the side it comes from)
  const sp = OTT.parkSpans.find(x => x.edge === g.geo.edge && x.from - 0.01 <= g.geo.s && x.to + 0.01 >= g.geo.s);
  assert.equal(!!sp, true);
  assert.equal(!!(g.geo.sigma > 0 ? sp.right : sp.left), true);
  assert.equal(g.geese.length >= G.GAGGLE[0] && g.geese.length <= G.GAGGLE[1], true);
  for (const o of g.geese) assert.equal(o.pace >= 0.4 && o.pace <= 0.8, true, `pace ${o.pace}`);
  w.geese.retire(g);
  // (many draws: every one beside a park or water, goslings now and then with adults)
  let young = 0, stoppers = 0;
  for (let k = 0; k < 40; k++) {
    const x = w.geese.spawn();
    if (!x) continue;
    assert.equal(OTT.parkSpans.some(sp2 => sp2.edge === x.geo.edge && sp2.from - 0.01 <= x.geo.s && sp2.to + 0.01 >= x.geo.s), true);
    if (x.geese.some(o => o.gosling)) { young++; assert.equal(x.geese[0].gosling, false); assert.equal(x.geese.at(-1).gosling, false); }
    if (x.geese.some(o => o.stopAt !== null)) stoppers++;
    w.geese.retire(x);
  }
  assert.equal(young > 3 && young < 37, true, `young ${young}`);
  assert.equal(stoppers > 3 && stoppers < 37, true, `stoppers ${stoppers}`);
  // (not at night, nor in snow)
  w.setClock({ hour: 23, sun_deg: -30 });
  assert.equal(w.geese.spawn(), null);
  const snowy = world({ seed: 4, weather: "snow" });
  egoAt(snowy, 150); snowy.world.setClock({ hour: 14, sun_deg: 40 });
  assert.equal(snowy.world.geese.spawn(), null);
  setWeather("dry");
  // (and none on a street with no park or water beside it)
  const bare = [...OTT.edges.values()].find(e => !e.ring && e.length > 150 && !OTT.parkSpans.some(sp2 => sp2.edge === e.id));
  const lane = OTT.lane(bare.id, 0);
  w.placeOnLane(lane, 2); w.setClock({ hour: 14, sun_deg: 40 });
  w.route = new Route(routeFromLanes(OTT, [lane], 2, lane.length - 2), OTT, w.ego.spec);
  assert.equal(w.geese.spawn(), null);
});

await test("the file: the lead looks at the kerb, they keep their spacing, pause, and one stops in the road; then across onto the grass", () => {
  const ctx = world();
  egoAt(ctx, 95);   // (the car well away: nothing for the lead to wait for)
  const w = ctx.world;
  const geo = G.crossingGeometry(OTT, SITE.edge, SITE.s, SITE.sigma, 0);
  const stopAt = (geo.uIn + geo.uOut) / 2;
  const g = w.geese.place(SITE, file(6, 0.6, { 3: { stopFor: 6, stopAt } }));
  assert.equal(g.phase, "coming");
  const seen = new Set(); let minSpacing = Infinity, looked = false, stoodStill = 0;
  runUntil(ctx, () => {
    seen.add(g.phase);
    if (g.phase === "look") looked = g.geese[0].u <= geo.uIn;
    for (let i = 1; i < g.geese.length; i++) minSpacing = Math.min(minSpacing, g.geese[i - 1].u - g.geese[i].u);
    const st = g.geese[3];
    if (G.onRoadway(g, st) && st.v === 0 && g.phase === "crossing") stoodStill++;
    return g.phase === "across";
  }, 120);
  assert.deepEqual([...seen], ["coming", "look", "crossing", "across"]);
  assert.equal(looked, true);
  assert.equal(minSpacing > 1.0, true, `spacing ${minSpacing}`);
  assert.equal(stoodStill / 60 > 5.5, true, `stood ${stoodStill / 60} s`);
  // (all off the roadway, on the far side)
  assert.equal(g.geese.every(o => o.u > geo.uOut + G.OFF_M), true);
  runUntil(ctx, () => false, 20);
  assert.equal(g.geese.every(o => o.v < 0.05 && o.u <= geo.uEnd + 0.05), true, JSON.stringify(g.geese.map(o => [o.u, o.v])));
  // (walking pace)
  assert.equal(g.geese.every(o => o.pace <= 0.8), true);
});

await test("the lead waits for a car too close to stop, and steps off ahead of one that can", () => {
  const ctx = world(), w = ctx.world;
  egoAt(ctx, 18, 11);
  const g = w.geese.place(SITE, file(4));
  g.phase = "look"; g.waited = 5;
  assert.equal(w.geese.roadClear(g), false);
  egoAt(ctx, 70, 11);
  assert.equal(w.geese.roadClear(g), true);
  egoAt(ctx, 9, 0);
  assert.equal(w.geese.roadClear(g), true);
});

await test("the conflict test: slow while they come up to the kerb, stop until the last is off the road", () => {
  const ctx = world(), w = ctx.world;
  egoAt(ctx, 60);
  const g = w.geese.place(SITE, file(5));
  const route = w.route, front = route.project(w.ego.x, w.ego.y).s + FRONT;
  const coming = G.geeseConflict(g, route, { front });
  assert.equal(coming.kind, "coming");
  assert.equal(coming.gap_m > 50 && coming.gap_m < 60, true, `gap ${coming.gap_m}`);
  g.phase = "crossing";
  const crossing = G.geeseConflict(g, route, { front });
  assert.equal(crossing.kind, "crossing");
  const ahead = G.geeseAhead(w, route, { front, spec: CAR, x: w.ego.x, y: w.ego.y });
  assert.equal(Math.abs(ahead.hold - (crossing.at - G.STOP_BACK_M)) < 1e-9, true);
  g.phase = "across";
  assert.equal(G.geeseConflict(g, route, { front }), null);
  g.phase = "waiting";
  assert.equal(G.geeseConflict(g, route, { front }), null);
  // (the caution speed: CAUTION_MPS by CAUTION_AT_M short of them, more further off)
  assert.equal(Math.abs(G.cautionSpeed(G.CAUTION_AT_M) - G.CAUTION_MPS) < 1e-9, true);
  assert.equal(G.cautionSpeed(40) > G.cautionSpeed(20), true);
});

await test("the driven car's sensing, candidates, rejection and what models are told", () => {
  const ctx = world(), w = ctx.world;
  egoAt(ctx, 45, 8);
  const g = w.geese.place(SITE, file(5));
  let snap = buildSnapshot(w);
  assert.equal(snap.geese_crossing.wait, false);
  assert.equal(snap.geese_crossing.phase, "about_to_cross");
  assert.equal(snap.limit <= snap.geese_crossing.limit_mps + 1e-9, true);
  g.phase = "crossing";
  egoAt(ctx, 32, 8);
  snap = buildSnapshot(w);
  const gc = snap.geese_crossing;
  assert.equal(gc.wait, true);
  assert.equal(gc.geese, 5);
  assert.equal(gc.from, "left");
  assert.equal(gc.bumper_to_stop_m > 20 && gc.bumper_to_stop_m < 30, true, `stop in ${gc.bumper_to_stop_m}`);
  const cands = sampleCandidates(snap, w);
  const { eligible } = simulateAll(cands, snap, w);
  const wait = cands.find(c => c.id === "wait_for_geese");
  assert.equal(!!wait && wait.eligible, true);
  assert.equal(Math.abs(wait.law.stopAtRoute - (gc.stop_s_route - FRONT - 0.5)) < 1e-6, true);
  // (driving on takes the car into their way)
  egoAt(ctx, 22, 8);
  const near = buildSnapshot(w), on = { id: "keep_on", law: { ...sampleCandidates(near, w).find(c => c.id === "wait_for_geese").law, vTarget: 9 } };
  delete on.law.stopAtRoute;
  simulateAll([on], near, w);
  assert.equal(on.reject, "drives_into_geese");
  egoAt(ctx, 32, 8);
  // (geese are waited for as a gaggle, never followed or passed as traffic)
  assert.equal(snap.following?.vehicle?.goose ?? false, false);
  const state = toJevState(snap, eligible, {});
  assert.equal(state.geese_crossing.wait, true);
  assert.equal(state.geese_crossing.geese, 5);
  assert.equal(situationClauses(snap).some(c => c.includes("`wait_for_geese`") && c.includes("last goose")), true);
  const q = buildQuestions(snap, eligible).questions;
  assert.equal(!!q.motion, true);
  assert.equal(q.motion.criteria.stop.includes("geese_crossing.wait_in_m"), true);
  assert.equal(SYSTEM_PROMPT.includes("`wait_for_geese`"), true);
  // (it cannot see them, it does not know)
  w.sees = () => false;
  assert.equal(buildSnapshot(w).geese_crossing, null);
});

await test("traffic and cyclists stop for them and wait for the last goose, then go on", () => {
  for (const kind of ["car", "bike"]) {
    const ctx = world(), w = ctx.world;
    egoAt(ctx, 95);
    const e = OTT.edges.get(SITE.edge), twin = [...OTT.edges.values()].find(o => o.from === e.to && o.to === e.from);
    // (coming the other way, in the lane the geese reach first: from the far end of its block)
    const lane = OTT.lane(twin.id, 0), k = lane.length / twin.length, sTwin = twin.length - SITE.s;
    const s0 = Math.max(1, (sTwin - 45) * k), p = pointAt(lane.pts, lane.cum, s0);
    const spec = kind === "bike" ? BIKE : CAR;
    const n = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s0), 4, spec);
    Object.assign(n, { id: `through_${kind}`, kind: kind === "bike" ? "bike" : n.kind, color: 0, v0: kind === "bike" ? 4.5 : 8, driver: { aMax: 1.3, b: 2, s0: 2, T: 1.4, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(), path: new NpcPath(OTT, ctx.fleet.random, { bike: kind === "bike" }), frozen: 0, waiting: 0 });
    n.path.start(twin.id, 0, s0); ctx.fleet.vehicles.push(n);
    const g = atKerb(w, w.geese.place(SITE, file(6, 0.6, { 2: { stopFor: 5, stopAt: G.crossingGeometry(OTT, SITE.edge, SITE.s, SITE.sigma).uIn + 2 } })));
    // (stepping off as it comes up the block)
    g.phase = "crossing";
    let stopped = false, movedEarly = false, minGap = Infinity;
    runUntil(ctx, () => {
      const onRoad = g.geese.some(o => G.onRoadway(g, o));
      if (g.phase === "crossing" && n.v < 0.05) stopped = true;
      if (stopped && onRoad && n.v > 0.3) movedEarly = true;
      for (const o of g.geese) if (G.onRoadway(g, o)) minGap = Math.min(minGap, Math.hypot(o.x - n.x, o.y - n.y));
      return g.phase === "across";
    }, 120);
    assert.equal(g.phase, "across", kind);
    assert.equal(stopped, true, kind);
    assert.equal(movedEarly, false, kind);
    assert.equal(minGap > 2.5, true, `${kind} came within ${minGap}`);
    runUntil(ctx, () => false, 8);
    assert.equal(n.v > 1.5, true, `${kind} went on: ${n.v}`);
    assert.equal(w.violations.collisions, 0);
  }
});

await test("geese are small obstacles: in world.obstaclesNear, and hitting one is a collision and a wildlife conflict", () => {
  const ctx = world(), w = ctx.world;
  egoAt(ctx, 95);
  const g = w.geese.place(SITE, file(1));
  const o = g.geese[0];
  assert.equal(w.obstaclesNear(o.x, o.y, 2).includes(o), true);
  assert.equal(w.npcs.includes(o), false);
  assert.equal(o.obb().halfLength * 2, G.GOOSE.length);
  // (the car driven into one, moving)
  w.ego.psi = o.psi + Math.PI / 2; w.ego.v = 4;
  w.ego.x = o.x - Math.cos(w.ego.psi) * (CAR.length - CAR.rearOverhang - 0.2); w.ego.y = o.y - Math.sin(w.ego.psi) * (CAR.length - CAR.rearOverhang - 0.2);
  assert.equal(obbOverlap(w.ego.obb(), o.obb()), true);
  w.audit(1 / 60, w.roadInfo());
  assert.equal(w.violations.collisions, 1);
  assert.equal(w.violations.collisions_at_fault, 1);
  assert.equal(w.events.some(ev => ev.type === "collision" && ev.kind === "goose"), true);
  assert.equal(w.violations.wildlife_conflicts >= 1, true);
  assert.equal(w.events.some(ev => ev.type === "wildlife_conflict" && ev.reason === "hit"), true);
});

await test("the audit: moving above a crawl near a goose on the road counts; standing back, or crawling, does not", () => {
  const ctx = world(), w = ctx.world;
  egoAt(ctx, 95);
  const g = w.geese.place(SITE, file(3));
  const o = g.geese[0];
  // (on the roadway, in the car's lane)
  const geo = g.geo;
  o.u = geo.uIn + 6.5; w.geese.pose(g, o);
  const placeEgo = (gap, v) => {
    const e = OTT.edges.get(SITE.edge), lane = OTT.lane(e.id, 0), k = lane.length / e.length;
    const p = lane.pts, cum = lane.cum;
    // (the car's front `gap` m short of the goose, along the lane)
    const sG = (SITE.s) * k, s = sG - gap - FRONT - G.GOOSE.length / 2;
    w.placeOnLane(lane, s); w.ego.v = v;
  };
  placeEgo(1.2, 0.5); w.audit(1 / 60, w.roadInfo());
  assert.equal(w.violations.wildlife_conflicts || 0, 0);
  placeEgo(5, 6); w.audit(1 / 60, w.roadInfo());
  assert.equal(w.violations.wildlife_conflicts || 0, 0);
  placeEgo(1.2, 2.5); w.audit(1 / 60, w.roadInfo());
  assert.equal(w.violations.wildlife_conflicts, 1);
  assert.equal(w.events[0].reason, "too_close");
  // (once per gaggle)
  w.audit(1 / 60, w.roadInfo());
  assert.equal(w.violations.wildlife_conflicts, 1);
});

for (const brain of ["rules", "cautious"]) await test(`"Goose crossing", ${brain}: stops short, waits for the last goose, and arrives cleanly`, async () => {
  const ctx = setupChallenge(OTT, lesson, { brain }), { world: w, autopilot } = ctx;
  assert.equal(w.geese.enabled, true);
  let stopped = false, movedEarly = false, minGap = Infinity, stopperStood = false;
  for (let k = 0; k < 120 * 60 && autopilot.enabled; k++) {
    step(ctx);
    if (autopilot.firing) await autopilot.firing;
    const g = w.geese.gaggles.find(x => x.id === "challenge_gaggle");
    if (!g) continue;
    const onRoad = g.geese.some(o => G.onRoadway(g, o));
    if (g.phase === "crossing" && w.ego.v < 0.05) stopped = true;
    if (stopped && g.phase === "crossing" && w.ego.v > G.CRAWL_MPS) movedEarly = true;
    if (onRoad) for (const o of g.geese) if (G.onRoadway(g, o)) minGap = Math.min(minGap, Math.hypot(o.x - w.ego.x, o.y - w.ego.y) - FRONT);
    const st = g.geese[4];
    if (G.onRoadway(g, st) && st.v === 0 && g.geese[0].u > g.geo.uOut) stopperStood = true;
  }
  assert.equal(stopped, true);
  assert.equal(movedEarly, false);
  assert.equal(stopperStood, true);
  assert.equal(minGap > G.NEAR_M, true, `gap ${minGap}`);
  const result = await evaluateChallenge(OTT, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.wildlife_conflicts, 0);
  assert.equal(result.collisions, 0);
  assert.equal(result.report.wildlife_conflicts, 0);
  console.log(`  (${brain}: arrived in ${Math.round(result.time_s ?? result.duration_s ?? 0)} s)`);
});

await test(`"Goose crossing": a driver who goes once the first geese have crossed its lane fails, with wildlife_conflicts`, () => {
  const ctx = setupChallenge(OTT, lesson, { brain: "rules" }), w = ctx.world;
  ctx.autopilot.setEnabled(false);
  const blind = { ...ctx, autopilot: idle };
  const metrics = new DriveMetrics(w.route.length);
  const g = w.geese.gaggles[0], geo = g.geo, e = geo.e;
  // (where the car's lane ends on the side they head for: past it, a goose is across the car's lane)
  const laneFar = geo.uIn + (-e.asphalt[0] + 0.3) + e.lane_offsets[0] + e.lane_width / 2;
  let went = false;
  for (let k = 0; k < 60 * 60; k++) {
    const p = w.route.project(w.ego.x, w.ego.y);
    const sensed = G.geeseAhead(w, w.route, { front: p.s + FRONT, spec: CAR, x: w.ego.x, y: w.ego.y });
    // (it slows and stops for them, and goes as soon as the lead is across its lane)
    if (!went && g.geese[0].u > laneFar + 0.5) went = true;
    const stopAt = !went && sensed?.hold != null ? sensed.hold - FRONT : undefined;
    const vTarget = went ? 8 : Math.min(8, sensed?.limit ?? 8);
    applyLaw(w.ego, { kind: "lane", offset: 0, vTarget, s0: p.s, ...(stopAt !== undefined ? { stopAtRoute: stopAt } : {}) }, w.route, p.s, 1 / 60, w);
    if (went && p.s > w.route.length - 8) break;
    const road = step(blind);
    metrics.record(w, null, road, 1 / 60);
  }
  assert.equal(went, true);
  assert.equal(w.geeseSeen, true);
  assert.equal((w.violations.wildlife_conflicts || 0) >= 1, true, JSON.stringify(w.violations));
  const summary = metrics.summary(w, ctx.autopilot, true);
  assert.equal(summary.wildlife_conflicts >= 1, true);
  assert.equal(failures(summary).includes("drove into or too close to geese crossing the road"), true);
  console.log(`  (the driver who went early: ${JSON.stringify({ wildlife_conflicts: w.violations.wildlife_conflicts, collisions: w.violations.collisions })})`);
});

await test("the challenge's geese wait on the grass however long the driver takes to come along", () => {
  const ctx = { ...setupChallenge(OTT, lesson, { brain: "rules" }), autopilot: idle };
  for (let k = 0; k < 125 * 60; k++) step(ctx);
  const g = ctx.world.geese.gaggles.find(x => x.id === "challenge_gaggle");
  assert.equal(!!g, true);
  assert.equal(g.phase, "waiting");
});

await test("checkpoints: a restored drive replays the geese exactly", () => {
  const ctx = setupChallenge(OTT, lesson, { brain: "rules" }), recorder = new DriveRecorder(), clock = {};
  for (let k = 0; k < 12 * 60; k++) step(ctx);
  recorder.record({ ...ctx, drive: null, clock }, true);
  const sig = () => JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], geese: ctx.world.geese.list.map(o => [o.id, o.u, o.v, o.pause]), phase: ctx.world.geese.gaggles.map(g => g.phase), t: ctx.world.t });
  for (let k = 0; k < 900; k++) step(ctx);
  const first = sig();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  for (let k = 0; k < 900; k++) step(ctx);
  assert.equal(sig(), first);
});

await test("the drive score reports wildlife_conflicts once a gaggle has crossed near the car", () => {
  const ctx = world(), w = ctx.world;
  egoAt(ctx, 60);
  const score = new DriveScore(w, {});
  score.record(w, w.roadInfo(), 1 / 60);
  assert.equal("wildlife_conflicts" in score.snapshot(), false);
  w.geeseSeen = true; score.record(w, w.roadInfo(), 1 / 60);
  assert.equal(score.snapshot().wildlife_conflicts, 0);
});

await test("with the option off nothing is built, drawn or reported", () => {
  const ctx = world({ geese: false, traffic: 10 }), w = ctx.world;
  assert.equal(w.geese.enabled, false);
  assert.equal(w.geese.random, null);
  assert.equal(w.geese.next, Infinity);
  egoAt(ctx, 60, 8);
  for (let k = 0; k < 300; k++) step(ctx);
  assert.equal(w.geese.gaggles.length, 0);
  assert.equal(w.geeseSeen, false);
  assert.equal("wildlife_conflicts" in w.violations, false);
  const snap = buildSnapshot(w);
  assert.equal("geese_crossing" in snap, false);
  const metrics = new DriveMetrics(w.route.length);
  metrics.record(w, snap, w.roadInfo(), 1 / 60);
  assert.equal("wildlife_conflicts" in metrics.summary(w, { totals: {} }, false), false);
  // (no other challenge turns it on)
  assert.deepEqual(CHALLENGES.filter(c => c.geese).map(c => c.id), ["goose-crossing"]);
  // (and a world without it steps exactly as one built before the option existed: the same random draws)
  const a = world({ geese: false, traffic: 10, seed: 9 }), b = world({ geese: false, traffic: 10, seed: 9 });
  b.world.geese = { enabled: false, gaggles: [] };
  egoAt(a, 60, 8); egoAt(b, 60, 8);
  for (let k = 0; k < 300; k++) { step(a); step(b); }
  assert.equal(JSON.stringify(a.fleet.vehicles.map(n => [n.x, n.y])), JSON.stringify(b.fleet.vehicles.map(n => [n.x, n.y])));
  assert.equal(JSON.stringify([a.world.ego.x, a.world.ego.y]), JSON.stringify([b.world.ego.x, b.world.ego.y]));
  // (on, but never spawning: the other streams draw the same, since the geese have their own)
  const c = world({ geese: true, traffic: 10, seed: 9 });
  egoAt(c, 60, 8);
  for (let k = 0; k < 300; k++) step(c);
  assert.equal(JSON.stringify(a.fleet.vehicles.map(n => [n.x, n.y])), JSON.stringify(c.fleet.vehicles.map(n => [n.x, n.y])));
});

// Optional: the live-model case (`uv run scripts/verify_jev.py data/snapshots/goose_crossing.json`), from
// the challenge while the geese cross and the car comes up to where it waits for them, generated by the
// production pipeline.
if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(OTT, lesson, { brain: "rules" }), w = ctx.world;
  let snap = null, candidates = null, eligible = null, rejected = null;
  for (let k = 0; k < 40 * 60 && !snap; k++) {
    step(ctx);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    const s = buildSnapshot(w);
    if (!s.geese_crossing?.wait || s.geese_crossing.on_road < 2 || s.geese_crossing.bumper_to_stop_m > 25) continue;
    const cs = sampleCandidates(s, w), sim = simulateAll(cs, s, w);
    if (sim.eligible.some(c => c.id === "wait_for_geese")) { snap = s; candidates = cs; ({ eligible, rejected } = sim); }
  }
  const { questions, local } = buildQuestions(snap, eligible);
  const state = toJevState(snap, candidates, { rejected });
  // (stopping for them, in the lane: waiting for the geese, or any other candidate that ends stopped short of their way)
  const stopping = eligible.filter(c => c.id === "wait_for_geese" || (c.sim.end_speed < snap.ego.v - 0.5 && Math.abs(c.sim.lane_err_end) < 0.8)).map(c => c.id);
  fs.writeFileSync(new URL("../data/snapshots/goose_crossing.json", import.meta.url), JSON.stringify({ name: "goose_crossing", state, questions, local,
    expect: { ...(questions.motion ? { motion: "drive" } : {}), vector_in: stopping } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/goose_crossing.json (stop in ${snap.geese_crossing.bumper_to_stop_m.toFixed(1)} m, ${snap.geese_crossing.on_road} on the road, ${eligible.length} eligible)`);
}
console.log(`${checks} geese checks passed`);
process.exit(0);
