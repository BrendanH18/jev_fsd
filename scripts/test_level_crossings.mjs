// Level crossings (Alberta AR 304/2002 s. 42): the High Level Bridge Streetcar's track in Old
// Strathcona and its crossings, where drivers stop and how far back, the streetcar running its line
// and braking for what is in its way, traffic stopping for it and never on the tracks, sensing,
// candidates, what models are told, the audit and the score, the challenge with Rules, and the same
// drive with a driver who follows the queue onto the tracks.
// node --experimental-default-type=module scripts/test_level_crossings.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData, pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, CAR, HERITAGE_STREETCAR } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { obbOverlap } = await import("../static/js/sim/collision.js");
const rail = await import("../static/js/sim/rail.js");
const { EMERGENCY_SPECS } = await import("../static/js/sim/emergency.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions, situationClauses } = await import("../static/js/brain/state.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
const root = new URL("../data/maps/", import.meta.url);
const load = (key, without = []) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const name of ["transit", "crossings", "zones", "rail"]) {
    const url = new URL(`${key}.${name}.v1.json`, root);
    if (fs.existsSync(url) && !without.includes(name)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
const EDMONTON = load("3e794edbefcb");
const step = (ctx, input = null) => stepWorld({ ...ctx, input }, 1 / 60, ctx.world.t * 1000);
const idle = { enabled: false, step() {} };
const index = rail.railIndex(EDMONTON), TRACK = [...index.tracks.values()][0];
const at106 = index.crossings.find((c) => c.edges.some((on) => on.edge === "e228"));
const lane228 = EDMONTON.lane("e228", 0);
const CHALLENGE = CHALLENGES.find((c) => c.id === "level-crossing");
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("Old Strathcona has the High Level Bridge Streetcar's line, from the map's edge to its Whyte Avenue terminus, and its eight level crossings", () => {
  assert.equal(index.tracks.size, 1);
  assert.equal(TRACK.kind, "tram");
  assert.deepEqual(TRACK.ends, ["edge", "terminus"]);
  assert.deepEqual(TRACK.stops.map((s) => s.name), ["107 Street", "Old Strathcona", "Whyte Avenue"]);
  assert.equal(index.crossings.length, 8);
  const streets = new Set(index.crossings.flatMap((c) => c.edges.map((on) => EDMONTON.edges.get(on.edge).name)));
  assert.deepEqual([...streets].sort(), ["104 Street NW", "105 Street NW", "106 Street NW", "106A Street NW", "107 Street NW", "83 Avenue NW", "Gateway Boulevard NW"]);
  // (the track runs on past the map's edge, so a streetcar can come onto the map and leave it)
  const first = EDMONTON.rail.tracks[0].pts[0];
  near(Math.hypot(TRACK.pts[1][0] - first[0], TRACK.pts[1][1] - first[1]), 0, 1e-9, "the map's edge");
  near(TRACK.cum[1], 60, 1e-6, "60 m on past it");
  for (const c of index.crossings) assert.ok(c.s > 0 && c.s < TRACK.length && c.half_m > 1 && c.half_m < 15, c.id);
});

test("where a driver stops: 7 m back from the nearest rail along its street, short of the law's 5 m and of the train's envelope", () => {
  const [x] = rail.crossingsAhead(EDMONTON, lane228.pts, lane228.cum, 10, CAR);
  assert.equal(x.c, at106);
  near(x.angle * 180 / Math.PI, 71.1, 0.5, "the street crosses the track at 71 deg");
  const railAt = rail.alongStreet(rail.RAIL_HALF_M, x.angle, CAR.width), env = rail.alongStreet(rail.ENVELOPE_M, x.angle, CAR.width);
  near(x.stop_m, x.s - railAt - rail.STOP_M - 10, 1e-6, "stop");
  near(x.hold_m, x.s - railAt - rail.HOLD_M - 10, 1e-6, "the law's line");
  near(x.entry_m, x.s - env - 10, 1e-6, "into the envelope");
  near(x.exit_m, x.s + env + CAR.length - 10, 1e-6, "its rear out of it");
  assert.ok(x.stop_m < x.hold_m && x.hold_m < x.entry_m && !x.fouling);
  // (on the tracks: fouling; once its rear is clear: none)
  assert.ok(rail.crossingsAhead(EDMONTON, lane228.pts, lane228.cum, x.s + 1, CAR)[0].fouling);
  assert.equal(rail.crossingsAhead(EDMONTON, lane228.pts, lane228.cum, x.s + env + CAR.length + 0.5, CAR).length, 0);
  // the waiting rule: short of where it stops; a little past it, barely moving and short of the
  // envelope, still; on the tracks, or rolling on past where it stops, no longer
  assert.ok(rail.waitsAt({ stop_m: 2, entry_m: 6, fouling: false }, 8));
  assert.ok(rail.waitsAt({ stop_m: -1.5, entry_m: 2, fouling: false }, 0.5));
  assert.ok(!rail.waitsAt({ stop_m: -1.5, entry_m: 2, fouling: false }, 4));
  assert.ok(!rail.waitsAt({ stop_m: -6, entry_m: -1, fouling: true }, 0));
});

// A streetcar on the line at the 106 Street crossing: its front `gap` metres short of the road,
// coming from the east (going west, -s) at `v`.
const trainAt = (gap, v = 6, dir = -1) => {
  const n = Object.assign(new Vehicle(0, 0, 0, 0, HERITAGE_STREETCAR), { id: "train_t", kind: "train" }, rail.trainState(TRACK, at106.s - dir * (gap + at106.half_m), dir, v));
  rail.placeTrain(n, TRACK);
  return n;
};

test("a streetcar is approaching a crossing while it comes ringing within 150 m, or is on it; stopped short of it, or past it, it is not", () => {
  const coming = rail.approach(trainAt(100), at106);
  assert.ok(coming.coming && !coming.on && Math.abs(coming.gap_m - 100) < 1e-6 && Math.abs(coming.eta_s - 100 / 6) < 1e-6);
  assert.equal(rail.approach(trainAt(160), at106), null, "beyond its gong");
  assert.equal(rail.approach(trainAt(40, 0), at106), null, "stopped short of it");
  assert.ok(rail.approach(trainAt(-5), at106).on, "on it");
  assert.ok(rail.approach(trainAt(-5, 0), at106).on, "on it, stopped");
  assert.equal(rail.approach(trainAt(-(HERITAGE_STREETCAR.length + 2 * at106.half_m + 1)), at106), null, "passed by");
  assert.equal(rail.approach(trainAt(-(HERITAGE_STREETCAR.length + 2 * at106.half_m + 60)), at106), null, "well past it, going away");
  assert.ok(rail.approach(trainAt(100, 6, 1), at106).coming, "from the other side");
});

test("the streetcar runs its line: in from the map's edge, at each stop, its terminus, back, and off the map again", () => {
  const n = Object.assign(new Vehicle(0, 0, 0, 0, HERITAGE_STREETCAR), { id: "train_r", kind: "train" }, rail.trainState(TRACK, 1, 1, rail.LINE_MPS));
  let random = 1, rang = 0, rangFar = 0, top = 0;
  const stops = [];
  const next = () => (random = (random * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60 * 900 && !n.rail.gone; i++) {
    const was = n.rail.phase;
    rail.stepTrain(n, TRACK, 1 / 60, [], () => true, next);
    if (was === "run" && n.rail.phase === "dwell") stops.push(rail.trainSpan(n).front);
    top = Math.max(top, n.v);
    if (n.rail.gong) {
      rang++;
      const f = rail.trainSpan(n).front;
      if (!TRACK.crossings.some((c) => Math.abs(c.s - f) < rail.GONG_M + c.half_m + 1)) rangFar++;
    }
  }
  assert.ok(n.rail.gone, "off the map again");
  near(top, rail.LINE_MPS, 0.01, "at up to 25 km/h");
  // 107 Street, Old Strathcona, Whyte Avenue (where it turns back), Old Strathcona, 107 Street
  const want = [TRACK.stops[0].s, TRACK.stops[1].s, TRACK.stops[2].s, null, TRACK.stops[0].s];
  assert.equal(stops.length, 5, `stopped ${stops.length} times`);
  for (const [i, s] of want.entries()) if (s !== null) near(stops[i], s, 1, `stop ${i}`);
  assert.ok(rang > 60 * 60 && rangFar === 0, "it rings on the way to its crossings, and only then");
});

test("the streetcar brakes for a car standing on the tracks that its motorman can see, and stops short of it", () => {
  const n = trainAt(60, rail.LINE_MPS), car = new Vehicle(at106.x, at106.y, Math.PI / 2 + 0.3, 0);
  const random = () => 0.5;
  for (let i = 0; i < 60 * 20; i++) rail.stepTrain(n, TRACK, 1 / 60, [car], () => true, random);
  assert.equal(n.v, 0);
  assert.ok(!obbOverlap(n.obb(), car.obb()), "stopped short of it");
  // (one it cannot see, it does not brake for)
  const blind = trainAt(60, rail.LINE_MPS);
  for (let i = 0; i < 60 * 3; i++) rail.stepTrain(blind, TRACK, 1 / 60, [car], () => false, random);
  near(blind.v, rail.LINE_MPS, 0.01, "not seen");
});

test("past the tracks: a vehicle stopped there with too little room behind it for the car blocks it; one driving away, or far enough on, does not", () => {
  const [x] = rail.crossingsAhead(EDMONTON, lane228.pts, lane228.cum, 10, CAR);
  // (a car with its front `s` along the lane)
  const carAt = (s, v = 0) => { const s0 = s - (CAR.length - CAR.rearOverhang), p = pointAt(lane228.pts, lane228.cum, s0); return new Vehicle(p[0], p[1], headingAt(lane228.pts, lane228.cum, s0), v); };
  const farSide = 10 + x.exit_m - CAR.length;   // (the envelope's far side, along the lane)
  const tail = (room, v = 0) => carAt(farSide + room + CAR.length, v);   // its rear `room` past it
  assert.ok(rail.roomBlocker(lane228.pts, lane228.cum, 10, CAR, x, [tail(2.5)]), "2.5 m: no room");
  assert.equal(rail.roomBlocker(lane228.pts, lane228.cum, 10, CAR, x, [tail(CAR.length + rail.ROOM_M + 0.5)]), null, "room for all of the car");
  assert.equal(rail.roomBlocker(lane228.pts, lane228.cum, 10, CAR, x, [tail(2.5, 5)]), null, "driving away");
  assert.ok(rail.roomBlocker(lane228.pts, lane228.cum, 10, CAR, x, [carAt(10 + x.s + 2)]), "on the tracks");
});

// A free drive in Old Strathcona with the streetcar on: what each driver does at each crossing.
function soak(seconds, { seed = 3, count = 30, trains = true } = {}) {
  const world = new World(EDMONTON, { seed }), fleet = new NpcFleet(world, { count, seed: seed + 6, trains });
  const out = { world, fleet, trains: new Set(), hits: [], standing: 0, crossedOwed: 0, rang: 0, waits: new Map(), maxWait: 0 };
  for (let i = 0; i < seconds * 60; i++) {
    step({ world, fleet, autopilot: idle });
    for (const t of fleet.trains) {
      out.trains.add(t.id);
      if (t.rail.gong) out.rang++;
      for (const o of [world.ego, ...fleet.vehicles, ...world.crowd.list]) {
        if (o === t || rail.isTrain(o) || Math.abs(o.x - t.x) > 25 || Math.abs(o.y - t.y) > 25) continue;
        if (obbOverlap(t.obb(), o.obb())) out.hits.push(`${o.id} at ${world.t.toFixed(1)}`);
      }
    }
    if (i % 15) continue;
    for (const c of index.crossings) {
      const at = rail.trainAt(fleet.trains, c);
      for (const n of fleet.vehicles) {
        if (rail.isTrain(n) || !n.path) continue;
        // (standing on the tracks while one is approaching)
        if (at && Math.abs(n.v) < 1 && rail.fouling(n, c, EDMONTON)) out.standing++;
      }
    }
    // (how long each driver has waited at a crossing, stopped there)
    for (const n of fleet.vehicles) {
      if (rail.isTrain(n) || !n.path) continue;
      const x = rail.crossingsAhead(EDMONTON, n.path.pts, n.path.cum, n.path.s + n.spec.length - n.spec.rearOverhang, n.spec, 12)[0];
      const waiting = x && n.v < 0.2 && x.stop_m < 3 && x.stop_m > -2;
      out.waits.set(n.id, waiting ? (out.waits.get(n.id) || 0) + 0.25 : 0);
      out.maxWait = Math.max(out.maxWait, out.waits.get(n.id));
    }
  }
  return out;
}
const SOAK = process.env.SKIP_SOAK ? null : soak(420);
const soakTest = (name, fn) => SOAK ? test(name, fn) : console.log(`- ${name} (skipped)`);

soakTest("in a free drive the streetcar runs, rings, hits nothing, and comes back after leaving the map", () => {
  assert.ok(SOAK.trains.size >= 1);
  assert.ok(SOAK.rang > 60 * 60, `rang ${(SOAK.rang / 60).toFixed(0)} s`);
  assert.deepEqual(SOAK.hits, []);
});

soakTest("traffic never stands on the tracks while a streetcar is approaching, and no driver waits at a crossing for ever", () => {
  assert.equal(SOAK.standing, 0);
  assert.ok(SOAK.maxWait < 120, `waited ${SOAK.maxWait} s`);
});

test("on a map without level crossings, traffic runs exactly as before", () => {
  const run = (trains) => {
    const map = load("4a96d42cb3f2"), world = new World(map, { seed: 5 }), fleet = new NpcFleet(world, { count: 25, seed: 11, trains });
    for (let i = 0; i < 60 * 40; i++) step({ world, fleet, autopilot: idle });
    return fleet.vehicles.map((v) => [v.id, v.x.toFixed(6), v.y.toFixed(6), v.v.toFixed(6)]);
  };
  assert.deepEqual(run(true), run(false));
});

// The challenge's world, with the car placed `toStop` metres short of where it stops at the 106 Street
// crossing, at `v`, and the streetcar released (`train`: coming toward the crossing) or the queue past
// it gone (`queue`: false).
function at106Street({ toStop = 20, v = 8, train = false, queue = true } = {}) {
  const ctx = setupChallenge(EDMONTON, CHALLENGE), { world, fleet } = ctx;
  if (!queue) for (const id of world.challenge.queueIds) fleet.vehicles.splice(fleet.vehicles.findIndex((n) => n.id === id), 1);
  const [x] = rail.crossingsAhead(EDMONTON, lane228.pts, lane228.cum, 0, world.ego.spec);
  world.placeOnLane(lane228, x.stop_m - toStop - (world.ego.spec.length - world.ego.spec.rearOverhang));
  world.ego.v = v;
  world.challenge.triggered = true;   // (nothing set off by the car coming up)
  const t = fleet.vehicles.find((n) => n.id === world.challenge.trainId);
  if (train) { Object.assign(t.rail, { held: false, dwell: 0 }); for (let i = 0; i < 60 * 8; i++) rail.stepTrain(t, TRACK, 1 / 60, [], () => true, () => 0.5); }
  world.ego.v = v;
  return { ...ctx, train: t };
}
const decide = (ctx) => {
  const snap = buildSnapshot(ctx.world), cands = sampleCandidates(snap, ctx.world);
  simulateAll(cands, snap, ctx.world);
  return { snap, cands, by: (id) => cands.find((c) => c.id === id), drives: cands.filter((c) => c.id === "keep_lane_limit" || c.id === "keep_lane_hold") };
};

test("challenge: 106 Street at the tracks, a queue back from 86 Avenue to just past them, and the streetcar out of sight", () => {
  const ctx = setupChallenge(EDMONTON, CHALLENGE), { world, fleet, scenario } = ctx;
  assert.equal(scenario.start.edge, "e230");
  assert.ok(world.route.length > 200);
  assert.ok(world.challenge.queueIds.length >= 2);
  const [x] = rail.crossingsAhead(EDMONTON, lane228.pts, lane228.cum, 0, CAR);
  const tail = fleet.vehicles.find((n) => n.id === world.challenge.queueIds.at(-1));
  assert.ok(rail.roomBlocker(lane228.pts, lane228.cum, 0, CAR, x, [tail]), "no room past the tracks");
  const lead = fleet.vehicles.find((n) => n.id === world.challenge.queueIds[0]);
  assert.equal(lead.signal, "left");
  const train = fleet.vehicles.find((n) => n.id === world.challenge.trainId);
  assert.ok(train && train.rail.held && !world.visibility.sees(world.ego, train), "held, out of sight");
});

test("with the queue past the tracks the car is told to wait short of them for room, offered the stop, and driving on is rejected", () => {
  const { snap, by, drives } = decide(at106Street());
  const lx = snap.level_crossing;
  assert.equal(lx.wait, "room");
  assert.ok(lx.blocker && !lx.train);
  near(lx.bumper_to_stop_m, 20, 0.6, "20 m to where it stops");
  assert.ok(by("stop_before_tracks")?.eligible);
  assert.ok(snap.target.v < 11);
  assert.ok(drives.length && drives.every((c) => !c.eligible && c.reject === "no_room_past_tracks"), JSON.stringify(drives.map((c) => [c.id, c.reject])));
});

test("with the streetcar coming, ringing, the car stops 7 m back for it, though there is room past the tracks", () => {
  const { snap, by, drives } = decide(at106Street({ train: true, queue: false }));
  const lx = snap.level_crossing;
  assert.equal(lx.wait, "train");
  assert.ok(lx.train.heard && !lx.train.on && lx.train.eta_s > 0);
  assert.ok(snap.target.reasons.includes("train coming at the level crossing"));
  assert.ok(by("stop_before_tracks")?.eligible);
  assert.ok(drives.length && drives.every((c) => !c.eligible && c.reject === "crosses_in_front_of_train"), JSON.stringify(drives.map((c) => [c.id, c.reject])));
});

test("decision models and LLMs are told about the crossing, the streetcar and why to wait", () => {
  const { snap, cands } = decide(at106Street({ train: true }));
  const state = toJevState(snap, cands, {});
  assert.equal(state.level_crossing.track, "streetcar line");
  assert.ok(state.level_crossing.stop && state.level_crossing.wait_for === "train" && state.level_crossing.train.arrives_in_s > 0);
  const said = situationClauses(snap).join(" ");
  assert.ok(said.includes("no closer than 5 m from the nearest rail") && said.includes("stop_before_tracks"), said);
  const q = buildQuestions(snap, cands.filter((c) => c.eligible)).questions;
  assert.ok(q.motion.criteria.stop.includes("level_crossing.wait_in_m"));
});

test("a car too close to stop when it first hears the streetcar goes on across; one already on the tracks clears them", () => {
  const close = decide(at106Street({ toStop: 3, v: 11, train: true, queue: false })).snap.level_crossing;
  assert.ok(close.train && close.wait === null, "not held");
  const ctx = at106Street({ train: true, queue: false }), [x] = rail.crossingsAhead(EDMONTON, lane228.pts, lane228.cum, 0, CAR);
  ctx.world.placeOnLane(lane228, x.s - 1); ctx.world.ego.v = 2;
  const on = decide(ctx).snap.level_crossing;
  assert.ok(on.on_tracks && on.wait === null);
  assert.ok(situationClauses(decide(ctx).snap).join(" ").includes("Never stop on the tracks"));
});

test("an ambulance with its siren on stops short of the tracks for the streetcar too", () => {
  const ctx = at106Street({ train: true, queue: false }), { world, fleet, autopilot } = ctx;
  autopilot.setEnabled(false);
  // (the car out of the way, well past the tracks, and the ambulance coming down 106 Street toward them)
  world.placeOnLane(EDMONTON.lane("e226", 0), 70);
  const spec = EMERGENCY_SPECS.ambulance, p = pointAt(lane228.pts, lane228.cum, 8);
  const ev = Object.assign(new Vehicle(p[0], p[1], headingAt(lane228.pts, lane228.cum, 8), 10, spec), { id: "ambulance_t", kind: "ambulance", siren: true, side: 0, age: 0, relation: "behind",
    v0: 13, driver: { aMax: spec.maxAccel * 0.85, b: 3.0, s0: 3.0, T: 0.9, react: 0.3, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0, blockedBy: null, blockedFor: 0 });
  ev.path = new NpcPath(EDMONTON, () => 0.5);
  ev.path.start("e228", 0, 8, [["e226", 0]]);
  fleet.vehicles.push(ev);
  let closest = Infinity, waited = false;
  for (let i = 0; i < 60 * 25; i++) {
    step(ctx);
    const train = fleet.vehicles.find((n) => n.id === world.challenge.trainId), coming = train && rail.approach(train, at106);
    const x = rail.crossingsAhead(EDMONTON, ev.path.pts, ev.path.cum, ev.path.s + ev.spec.length - ev.spec.rearOverhang, ev.spec)[0];
    if (coming && x?.c === at106 && !x.fouling) { closest = Math.min(closest, x.hold_m + rail.HOLD_M); if (ev.v < 0.1) waited = true; }
    assert.ok(!(coming && rail.fouling(ev, at106, EDMONTON)), `on the tracks at ${world.t.toFixed(1)}`);
  }
  assert.ok(waited && closest >= rail.HOLD_M, `${closest.toFixed(2)} m from the nearest rail`);
});

test("the audit: crossing in front of the streetcar fails to yield once; crossing with none coming does not", () => {
  const run = (train) => {
    const ctx = at106Street({ toStop: 25, v: 9, train, queue: false });
    let events = [];
    for (let i = 0; i < 60 * 5; i++) { ctx.world.stepManual(1 / 60, { throttle: ctx.world.ego.v < 9 }); ctx.world.t += 1 / 60; ctx.world.audit(1 / 60, ctx.world.roadInfo()); events = events.concat(ctx.world.events.filter((e) => e.type === "failed_to_yield")); }
    return { events, n: ctx.world.violations.failed_to_yield };
  };
  const coming = run(true);
  assert.equal(coming.n, 1);
  assert.equal(coming.events[0].to, "train");
  assert.equal(run(false).n, 0);
});

// The challenge, closed loop: Rules (or a driver that just follows the car ahead, onto the tracks).
function drive({ follower = false } = {}) {
  const ctx = setupChallenge(EDMONTON, CHALLENGE, { brain: "rules" }), { world, fleet, autopilot } = ctx;
  const route = world.route, score = new DriveScore(world, { route });
  if (follower) autopilot.setEnabled(false);
  const out = { minRail: Infinity, standing: 0, fouledComing: false, arrived: false, waitedRoom: false, waitedTrain: false, events: [] };
  for (let i = 0; i < 60 * 150; i++) {
    let input = null;
    if (follower) {
      // (throttle up to 30 km/h, and brake to stop 2 m behind whatever is ahead in its lane)
      const ahead = fleet.vehicles.filter((n) => !rail.isTrain(n)).map((n) => world.ego.toLocal(n.x, n.y)).filter((l) => l.ahead > 0 && Math.abs(l.right) < 1.5).map((l) => l.ahead - CAR.rearOverhang - (world.ego.spec.length - world.ego.spec.rearOverhang) - 2);
      const room = Math.min(Infinity, ...ahead), want = Math.min(8.3, Math.sqrt(2 * 2.5 * Math.max(0, room)));
      input = { throttle: world.ego.v < want - 0.3, brake: world.ego.v > want + 0.3 };
    }
    step(ctx, input);
    score.record(world, world._road, 1 / 60);
    out.events.push(...world.events.filter((e) => e.type === "failed_to_yield" || e.type === "collision"));
    const lx = autopilot.snap?.level_crossing;
    if (lx?.wait === "room") out.waitedRoom = true;
    if (lx?.wait === "train") out.waitedTrain = true;
    const train = fleet.vehicles.find((n) => n.id === world.challenge.trainId), at = train && rail.approach(train, at106);
    const ego = world.ego, x = rail.crossingsAhead(EDMONTON, route.pts, route.cum, route.project(ego.x, ego.y).s + ego.spec.length - ego.spec.rearOverhang, ego.spec)[0];
    if (at && x?.c === at106 && !x.fouling) out.minRail = Math.min(out.minRail, x.hold_m + rail.HOLD_M);
    if (at && rail.fouling(ego, at106, EDMONTON)) out.fouledComing = true;
    if (world.onTracks?.still > 1) out.standing++;
    if (!follower && !autopilot.enabled) { out.arrived = true; break; }
  }
  return { ...out, violations: world.violations, report: score.finish("done"), world };
}

test("Rules waits short of the tracks for room, stops 5 m or more back while the streetcar passes, never stands on the tracks, and arrives", () => {
  const r = drive();
  assert.ok(r.arrived, "arrived");
  assert.ok(r.waitedRoom && r.waitedTrain);
  assert.ok(r.minRail >= rail.HOLD_M, `${r.minRail.toFixed(2)} m from the nearest rail`);
  assert.ok(!r.fouledComing);
  assert.equal(r.standing, 0);
  assert.deepEqual(r.events, []);
  assert.equal(r.violations.failed_to_yield + r.violations.collisions, 0);
  assert.equal(r.report.stopped_on_tracks, 0);
});

test("a driver who follows the queue onto the tracks is standing there when the streetcar comes: it fails to yield, and is coached", () => {
  const r = drive({ follower: true });
  assert.ok(r.fouledComing);
  const yields = r.events.filter((e) => e.type === "failed_to_yield");
  assert.equal(yields.length, 1);
  assert.equal(yields[0].to, "train");
  // (the streetcar stops short of it; the follower, which does not steer, may later leave the road)
  assert.ok(!r.events.some((e) => e.type === "collision" && e.with === r.world.challenge.trainId), "the streetcar stops short of it");
  assert.equal(r.report.stopped_on_tracks, 1);
  assert.ok(r.report.incidents.some((i) => i.type === "stopped_on_tracks"));
  assert.ok(r.report.tips.some((t) => t.startsWith("Never stop on the tracks")));
});

test("the HUD tells the car to wait for room, then for the streetcar", () => {
  const room = rail.crossingNotice(at106Street().world);
  assert.equal(room.text, "LEVEL CROSSING · NO ROOM PAST THE TRACKS · WAIT SHORT OF THEM");
  const train = rail.crossingNotice(at106Street({ train: true, queue: false }).world);
  assert.equal(train.text, "LEVEL CROSSING · STREETCAR COMING · STOP 5 M BACK");
});

test("a checkpoint and restore brings back the streetcar where it was, on its track", () => {
  const ctx = setupChallenge(EDMONTON, CHALLENGE), { world, fleet, autopilot } = ctx;
  const recorder = new DriveRecorder();
  for (let i = 0; i < 60 * 14; i++) step(ctx);
  const drive = { t: 0 }, clock = {};
  const context = { world, fleet, autopilot, drive, clock, setDrive() {} };
  recorder.record(context, true);
  const train = fleet.vehicles.find((n) => n.id === world.challenge.trainId), was = { s: train.rail.s, v: train.v, phase: train.rail.phase };
  for (let i = 0; i < 60 * 10; i++) step(ctx);
  assert.notEqual(train.rail.s, was.s);
  recorder.restore(0, context);
  const back = fleet.vehicles.find((n) => n.id === world.challenge.trainId);
  assert.deepEqual({ s: back.rail.s, v: back.v, phase: back.rail.phase }, was);
  assert.ok(world.npcs.includes(back));
  world.paused = false;
  for (let i = 0; i < 60; i++) step(ctx);
  assert.ok(rail.isTrain(back) && Number.isFinite(back.x));
});

console.log(`${checks} level crossing checks passed`);
process.exit(0);
