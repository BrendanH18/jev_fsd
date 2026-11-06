// Node 22: low sun glare (sim/sun-glare.js). The solar math against reference values, the shared
// policy (sight, ceiling, traffic, sensing, model wording), the "Into the sun" challenge with Rules and
// the cautious agent, a driver who ignores the glare, checkpoint replay, and the option off.
//   node --experimental-default-type=module scripts/test_sun_glare.mjs [--write-snapshot]
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet, NpcPath } = await import("../static/js/sim/npc.js");
const { Vehicle, comfort } = await import("../static/js/sim/vehicle.js");
const { StopMemory } = await import("../static/js/sim/signals.js");
const { sunAngles, mapClock } = await import("../static/js/sim/speed-zones.js");
const { pointAt, headingAt } = await import("../static/js/map/mapdata.js");
const { buildSnapshot } = await import("../static/js/brain/sensors.js");
const { sampleCandidates, simulateAll } = await import("../static/js/brain/candidates.js");
const { toJevState, buildQuestions } = await import("../static/js/brain/state.js");
const { RulesBrain } = await import("../static/js/brain/rules.js");
const { CautiousAgent } = await import("../static/js/agents/cautious.js");
const { DriveMetrics, failures } = await import("../static/js/bench/metrics.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { Route } = await import("../static/js/map/route.js");
const G = await import("../static/js/sim/sun-glare.js");

const key = "a53c5bcf6438";   // Calgary, Beltline
const pack = JSON.parse(fs.readFileSync(new URL(`../data/maps/${key}.v6.pack.json`, import.meta.url)));
for (const layer of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow"]) {
  const url = [2, 1].map(v => new URL(`../data/maps/${key}.${layer}.v${v}.json`, import.meta.url)).find(url => fs.existsSync(url));
  if (url) pack[layer] = JSON.parse(fs.readFileSync(url));
}
const map = new MapData(pack), lesson = CHALLENGES.find(c => c.id === "into-the-sun");
const CALGARY = { latitude: pack.origin.lat, longitude: pack.origin.lon };
const DEG = 180 / Math.PI;
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`); }
const near = (a, b, tol, what) => assert.equal(Math.abs(a - b) <= tol, true, `${what}: ${a} vs ${b} ± ${tol}`);
const westbound = () => { const lane = map.lane("e267", 1); return { lane, s: 60 }; };
// A world on 17 Avenue SW at the challenge's date and time unless told otherwise.
function glareWorld({ sunGlare = true, weather = "dry", hour = 18.25, day = 281, utc_offset = -6, psi = null } = {}) {
  const world = new World(map, { parked: 0, pedestrians: 0, weather, sunGlare });
  world.setClock({ ...mapClock(hour, map), day, utc_offset });
  const { lane, s } = westbound();
  world.placeOnLane(lane, s);
  if (psi !== null) world.ego.psi = psi;
  return world;
}
const ahead = (world, d, side = 0) => [world.ego.x + Math.cos(world.ego.psi) * d + Math.sin(world.ego.psi) * side, world.ego.y + Math.sin(world.ego.psi) * d - Math.cos(world.ego.psi) * side];

await test("dates turn into days of the year", () => {
  assert.equal(G.dayOfYear("01-01"), 1); assert.equal(G.dayOfYear("10-08"), 281); assert.equal(G.dayOfYear("11-05"), 309);
  assert.equal(G.dayOfYear("12-31"), 365); assert.equal(G.dayOfYear("02-30"), null); assert.equal(G.dayOfYear("tomorrow"), null);
});

await test("solar math matches reference declinations, equation of time, noon and sunset", () => {
  // Declination at the solstices and equinox (±23.44°, 0°).
  near(G.solarAngles(12, { ...CALGARY, utcOffset: -7, day: 172 }).declination * DEG, 23.44, 0.15, "June solstice");
  near(G.solarAngles(12, { ...CALGARY, utcOffset: -7, day: 355 }).declination * DEG, -23.44, 0.15, "December solstice");
  near(G.solarAngles(12, { ...CALGARY, utcOffset: -7, day: 80 }).declination * DEG, 0, 0.6, "March equinox");
  // The equation of time peaks near +16.4 min on 3 November and bottoms near -14.2 min on 11 February.
  near(G.solarAngles(12, { ...CALGARY, day: 307 }).eot_min, 16.4, 0.3, "EoT 3 November");
  near(G.solarAngles(12, { ...CALGARY, day: 42 }).eot_min, -14.2, 0.4, "EoT 11 February");
  // At true solar noon the sun is due south at 90° - |latitude - declination|.
  for (const day of [80, 172, 281, 355]) {
    const probe = G.solarAngles(12, { ...CALGARY, day }), noon = 12 - probe.eot_min / 60;   // local mean solar time
    const a = G.solarAngles(noon, { ...CALGARY, day });
    near(a.elevation * DEG, 90 - Math.abs(CALGARY.latitude - a.declination * DEG), 0.05, `noon elevation, day ${day}`);
    near(G.azimuthOf(a) * DEG, 180, 0.5, `noon azimuth, day ${day}`);
  }
  // At an equinox on the equator the sun sets due west, about 18:00 local solar time.
  const equator = { latitude: 0, longitude: 0, utcOffset: 0, day: 80 }, eot = G.solarAngles(18, equator).eot_min;
  const sunset = G.solarAngles(18 - eot / 60, equator);
  near(sunset.elevation * DEG, 0, 0.6, "equinox sunset elevation"); near(G.azimuthOf(sunset) * DEG, 270, 0.6, "equinox sunset azimuth");
  // Without a day, the sky's late-September sun (sim/speed-zones.js), unchanged.
  const legacy = sunAngles(18.25, { ...CALGARY, utcOffset: -6 });
  const w = glareWorld(); w.setClock({ hour: 18.25, sun_deg: 0, utc_offset: -6 });
  near(G.sunOf(w).elevation_deg, legacy.elevation * DEG, 1e-9, "legacy elevation");
});

await test("the challenge's low sun really faces 17 Avenue SW westbound; November's does not", () => {
  const w = glareWorld(), sun = G.sunOf(w), off = Math.abs(G.bearingOf(w.ego.psi) - sun.azimuth_deg);
  assert.equal(sun.elevation_deg > 4 && sun.elevation_deg < 8, true, `elevation ${sun.elevation_deg}`);
  assert.equal(sun.azimuth_deg > 250 && sun.azimuth_deg < 256, true, `azimuth ${sun.azimuth_deg}`);
  assert.equal(off < 20, true, `off ${off}`);
  // (5 November, 16:45 MST: low in the south-west, beyond the glare cone of a westbound street)
  const november = G.solarAngles(16.75, { ...CALGARY, utcOffset: -7, day: 309 });
  assert.equal(270 - G.azimuthOf(november) * DEG > G.GLARE_HALF_ANGLE_DEG - 5, true);
});

await test("glare needs a low sun ahead, clear weather and daylight; severity grows into the sun", () => {
  const w = glareWorld(), g = G.glareFor(w);
  assert.equal(!!g, true);
  assert.equal(g.severity > 0.6 && g.severity <= 1, true, `severity ${g.severity}`);
  assert.equal(g.sight_m < w.visibility.range, true);
  near(g.ceiling_mps, G.glareCeiling(g.sight_m, w.ego.spec.length - w.ego.spec.rearOverhang), 1e-9, "ceiling");
  // (into the sun's azimuth itself: worse)
  const straight = glareWorld({ psi: (90 - g.sun_azimuth_deg) / DEG });
  assert.equal(G.glareFor(straight).severity > g.severity, true);
  assert.equal(G.glareFor(straight).sight_m < g.sight_m, true);
  assert.equal(G.glareFor(glareWorld({ psi: 0 })), null, "heading east, away from it");
  assert.equal(G.glareFor(glareWorld({ psi: Math.PI / 2 })), null, "heading north");
  for (const weather of ["rain", "fog", "snow"]) assert.equal(G.glareFor(glareWorld({ weather })), null, weather);
  assert.equal(G.glareFor(glareWorld({ hour: 15 })), null, "sun too high");
  assert.equal(G.glareFor(glareWorld({ hour: 19.5 })), null, "sun set");
  const dark = glareWorld(); dark.visibility.setNight(1); assert.equal(G.glareFor(dark), null, "night");
  assert.equal(G.glareFor(glareWorld({ sunGlare: false })), null, "option off");
  const none = glareWorld(); none.setClock(null); assert.equal(G.glareFor(none), null, "no clock");
});

await test("the ceiling is the speed to stop within sight after a second, at comfort braking", () => {
  const decel = comfort().decel, sight = 40, front = 3.6, v = G.glareCeiling(sight, front);
  near(v * 1 + v * v / (2 * decel), sight - front - G.GLARE_MARGIN_M, 1e-9, "stopping distance");
  assert.equal(G.glareCeiling(30, front) < v, true);
});

await test("sight towards the sun shortens for the driven car only", () => {
  const w = glareWorld(), g = G.glareFor(w), far = g.sight_m + 10, close = g.sight_m - 10;
  assert.equal(w.visibility.canSee(w.ego, ...ahead(w, far)), false, "beyond the glare, ahead");
  assert.equal(w.visibility.canSee(w.ego, ...ahead(w, close)), true, "inside it");
  assert.equal(w.visibility.canSee(w.ego, ...ahead(w, -far)), true, "behind, away from the sun");
  const other = new Vehicle(w.ego.x, w.ego.y, w.ego.psi, 0);
  assert.equal(w.visibility.canSee(other, ...ahead(w, far)), true, "another observer is not dazzled by the car's glare");
  const off = glareWorld({ sunGlare: false });
  assert.equal(off.visibility.glare, null);
  assert.equal(off.visibility.canSee(off.ego, ...ahead(off, far)), true);
});

await test("sensing, target speed and model wording share the ceiling", () => {
  const w = glareWorld(); w.ego.v = 13;
  w.route = new Route(challengeScenario(map, lesson).route, map, w.ego.spec);
  w.placeOnLane(map.lane("e267", 1), 45); w.ego.v = 13;
  const snap = buildSnapshot(w), g = G.glareFor(w);
  assert.equal(!!snap.sun_glare, true);
  near(snap.sun_glare.ceiling_mps, g.ceiling_mps, 1e-9, "sensed ceiling");
  assert.equal(snap.limit <= g.ceiling_mps + 1e-9, true);
  assert.equal(snap.target.v <= g.ceiling_mps + 1e-9, true);
  const candidates = sampleCandidates(snap, w), { eligible, rejected } = simulateAll(candidates, snap, w);
  const state = toJevState(snap, candidates, { rejected }), { questions } = buildQuestions(snap, eligible);
  assert.equal(state.sun_glare.sight_m, snap.sun_glare.sight_m);
  assert.equal(JSON.stringify(questions).includes("low sun"), true);
  for (const brain of [new RulesBrain(), new CautiousAgent()]) {
    const picked = eligible.find(c => c.id === brain.decideSync(snap, eligible).candidateId);
    assert.equal(picked.sim.end_speed < w.ego.v, true, `${brain.constructor.name} slows from 13 m/s`);
  }
  const off = glareWorld({ sunGlare: false }); off.route = w.route; off.placeOnLane(map.lane("e267", 1), 45);
  const offSnap = buildSnapshot(off);
  assert.equal("sun_glare" in offSnap, false);
  assert.equal("sun_glare" in toJevState(offSnap, [], {}), false);
});

await test("traffic heading into the sun keeps to the same ceiling", () => {
  function run(sunGlare) {
    const w = glareWorld({ sunGlare }), fleet = new NpcFleet(w, { count: 0, bikes: 0, seed: 7 });
    w.placeOnLane(map.lane("e275", 1), 5);
    const lane = map.lane("e267", 1), s = 10, p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 13);
    Object.assign(car, { id: "sun_npc", color: 0x777777, v0: 13.9, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.5, react: 0.5, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
    car.path.start(lane.edge, lane.idx, s); fleet.vehicles.push(car);
    let late = 0, ceiling = Infinity;
    for (let k = 0; k < 6 * 60; k++) {
      fleet.step(1 / 60); w.t += 1 / 60; w.tick++;
      if (k > 4 * 60) { late = Math.max(late, car.v); ceiling = Math.min(ceiling, G.npcGlareCeiling(w, car)); }
    }
    return { late, ceiling, east: G.npcGlareCeiling(w, Object.assign(new Vehicle(0, 0, 0, 0), { psi: 0 })) };
  }
  const on = run(true), off = run(false);
  assert.equal(Number.isFinite(on.ceiling), true);
  assert.equal(on.late <= on.ceiling + 0.3, true, `${on.late} vs ${on.ceiling}`);
  assert.equal(on.east, Infinity, "eastbound traffic is not dazzled");
  assert.equal(off.ceiling, Infinity);
  assert.equal(off.late > on.ceiling + 1, true, `without glare it keeps ${off.late}`);
});

await test("the challenge is deterministic, on a long straight westbound avenue with two signals", () => {
  const a = challengeScenario(map, lesson), b = challengeScenario(map, lesson);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.tags.length_m > 350, true);
  const ctx = setupChallenge(map, lesson);
  assert.equal(ctx.world.sunGlare, true);
  assert.equal(ctx.world.clock.day, 281); assert.equal(ctx.world.clock.utc_offset, -6);
  assert.equal(ctx.world.route.controls.filter(c => c.control.type === "signal").length, 2);
  assert.equal(!!G.glareFor(ctx.world), true, "dazzled from the start");
});

for (const brain of ["rules", "cautious"]) await test(`into-the-sun, ${brain}: slows to what it can see and passes`, async () => {
  const ctx = setupChallenge(map, lesson, { brain }), { world, autopilot } = ctx;
  let maxOver = -Infinity, stoppedForRed = false, yieldedToPed = false, unseenSignal = false;
  for (let k = 0; k < 120 * 60 && autopilot.enabled; k++) {
    stepWorld(ctx, 1 / 60, world.t * 1000);
    if (autopilot.firing) await autopilot.firing;
    const g = G.glareFor(world), snap = autopilot.snap;
    if (g && world.t > 30) maxOver = Math.max(maxOver, world.ego.v - g.ceiling_mps);
    if (snap?.intersection?.signal === "unknown" && snap.intersection.bumper_to_line_m > g?.sight_m - 5) unseenSignal = true;
    if (snap?.intersection?.signal === "red" && world.ego.v < 0.1) stoppedForRed = true;
    if (snap?.target?.reasons.includes("pedestrian crossing") && world.ego.v < 2) yieldedToPed = true;
  }
  assert.equal(world.sunGlareSeen, true);
  assert.equal(unseenSignal, true, "a signal beyond the glare is unknown");
  assert.equal(stoppedForRed && yieldedToPed, true, `stopped for the red ${stoppedForRed}, for the pedestrian ${yieldedToPed}`);
  assert.equal(maxOver < G.GLARE_TOLERANCE_MPS, true, `over the ceiling by ${maxOver}`);
  const result = await evaluateChallenge(map, lesson, { brain });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.glare_speeding_seconds, 0);
  assert.equal(result.report.glare_speeding_seconds, 0);
  assert.equal(result.report.qualified, true);
  assert.equal(result.collisions, 0);
});

await test("a driver who ignores the glare fails the drive", async () => {
  const ctx = setupChallenge(map, lesson), { world, autopilot } = ctx;
  autopilot.setEnabled(false);
  const metrics = new DriveMetrics(world.route.length);
  for (let k = 0; k < 14 * 60; k++) {
    const road = stepWorld({ ...ctx, input: { throttle: world.ego.v < 13.5 } }, 1 / 60, world.t * 1000);
    metrics.record(world, null, road, 1 / 60);
  }
  const summary = metrics.summary(world, autopilot, false);
  assert.equal(summary.glare_speeding_seconds > G.GLARE_SPEEDING_THRESHOLD_S, true, `${summary.glare_speeding_seconds}`);
  assert.equal(failures(summary).includes("too fast for sun glare"), true);
});

await test("replay restores the glare and repeats the same drive", async () => {
  const ctx = setupChallenge(map, lesson), recorder = new DriveRecorder(), clock = {};
  for (let k = 0; k < 600; k++) { stepWorld(ctx, 1 / 60, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
  recorder.record({ ...ctx, drive: null, clock }, true);
  const run = async () => {
    for (let k = 0; k < 900; k++) { stepWorld(ctx, 1 / 60, ctx.world.t * 1000); if (ctx.autopilot.firing) await ctx.autopilot.firing; }
    return JSON.stringify({ ego: [ctx.world.ego.x, ctx.world.ego.y, ctx.world.ego.v], call: ctx.world.sunGlareCall, v: ctx.world.violations, t: ctx.world.t });
  };
  const first = await run();
  recorder.restore(0, { ...ctx, clock, setDrive: () => {} }); ctx.world.paused = false;
  assert.equal(await run(), first);
});

await test("with the option off nothing is computed, drawn or reported", async () => {
  const off = { ...lesson, sunGlare: false };
  const ctx = setupChallenge(map, off);
  assert.equal(ctx.world.sunGlare, false);
  assert.equal(ctx.world.visibility.glare, null);
  assert.equal("day" in ctx.world.clock || "utc_offset" in ctx.world.clock, false, "the clock keeps its old shape");
  const result = await evaluateChallenge(map, off);
  assert.equal("glare_speeding_seconds" in result, false);
  assert.equal("glare_speeding_seconds" in result.report, false);
  assert.equal(ctx.world.sunGlareSeen, false);
  // the module draws no random numbers at all: there is no stream to draw from
  assert.equal(/Math\.random|rng\(|\.random\b/.test(fs.readFileSync(new URL("../static/js/sim/sun-glare.js", import.meta.url), "utf8")), false);
});

if (process.argv.includes("--write-snapshot")) {
  const ctx = setupChallenge(map, lesson), w = ctx.world;
  w.placeOnLane(map.lane("e267", 1), 45); w.ego.v = 13; w.t = 30;
  const snap = buildSnapshot(w), candidates = sampleCandidates(snap, w), { eligible, rejected } = simulateAll(candidates, snap, w);
  const { questions, local } = buildQuestions(snap, eligible), state = toJevState(snap, candidates, { rejected });
  // (slowing to the ceiling or below in its lane, but not stopping: nothing is in the way)
  const slowing = eligible.filter(c => c.sim.end_speed <= snap.sun_glare.ceiling_mps + 0.05 && c.sim.end_speed > 3 && Math.abs(c.sim.lane_err_end) < 0.3).map(c => c.id);
  fs.writeFileSync(new URL("../data/snapshots/into_the_sun.json", import.meta.url), JSON.stringify({ name: "into_the_sun", state, questions, local,
    expect: { vector_in: slowing } }, null, 2) + "\n");
  console.log(`wrote data/snapshots/into_the_sun.json (slowing: ${slowing.join(", ")})`);
}

console.log(`${checks} sun glare checks passed`);
process.exit(0);
