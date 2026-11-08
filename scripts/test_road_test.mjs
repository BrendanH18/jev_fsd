// Road tests (lab/road-tests.js, lab/examiner.js): the authored routes, the examiner's scoring and
// directions, manual-attempt eligibility and storage, a full Rules and cautious-agent run of each test,
// and what a run of them adds to saved arena history (lab/history.js).
// node --experimental-default-type=module scripts/test_road_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const { Route } = await import("../static/js/map/route.js");
const { CHALLENGES, challengeById, challengeConfig, challengeScenario } = await import("../static/js/lab/challenges.js");
const { ROAD_TESTS, roadTestScenario } = await import("../static/js/lab/road-tests.js");
const { examine, examinerScript, examinerTurns, instructionAt, failureCategory, MINOR_TYPES, CATEGORIES, MAX_REPEAT, RoadTestObserver } = await import("../static/js/lab/examiner.js");
const { ROAD_TEST_KEY, readRoadTests, roadTestStatus, saveRoadTest, practiceOutcome } = await import("../static/js/lab/practice.js");
const { failures } = await import("../static/js/bench/metrics.js");
const { setupChallenge, evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { validateEvaluation, EVALUATION_SCHEMA } = await import("../static/js/lab/history.js");

const names = { kitsilano: "623b012bc8b5", toronto: "4a96d42cb3f2", ottawa: "d25b07def0d2" };
// (with every layer, as the server serves it)
const load = id => {
  const at = name => new URL(`../data/maps/${names[id]}.${name}`, import.meta.url);
  const pack = JSON.parse(fs.readFileSync(at("v6.pack.json")));
  for (const [key, file] of [["transit", "transit.v1.json"], ["zones", "zones.v1.json"], ["rail", "rail.v1.json"]]) if (fs.existsSync(at(file))) pack[key] = JSON.parse(fs.readFileSync(at(file)));
  const crossings = ["crossings.v2.json", "crossings.v1.json"].map(at).find(u => fs.existsSync(u));
  if (crossings) pack.crossings = JSON.parse(fs.readFileSync(crossings));
  for (const name of ["calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) if (fs.existsSync(at(`${name}.v1.json`))) pack[name] = JSON.parse(fs.readFileSync(at(`${name}.v1.json`)));
  return new MapData(pack);
};
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`); };

// --- authored tests and routes
test("road tests are authored apart from the challenges, on committed maps, in BC and Ontario", () => {
  assert.ok(ROAD_TESTS.length >= 2);
  for (const t of ROAD_TESTS) {
    assert.ok(names[t.map], t.id); assert.ok(!CHALLENGES.some(c => c.id === t.id)); assert.equal(challengeById(t.id)?.id, t.id);
    assert.equal(t.roadTest, true); assert.equal(t.park, true); assert.ok(Number.isInteger(t.version) && t.version > 0);
    assert.equal(challengeConfig(t).challenge, t.id);
  }
  assert.ok(ROAD_TESTS.some(t => t.region === "British Columbia" && /Class 5-style/.test(t.style)));
  assert.ok(ROAD_TESTS.some(t => t.region === "Ontario" && /G2-style/.test(t.style)));
});
test("road test wording is generic: no licensing organisation is named", () => {
  const text = JSON.stringify(ROAD_TESTS);
  for (const name of ["ICBC", "DriveTest", "ServiceOntario", "Service Ontario", "MTO", "Insurance Corporation"]) assert.ok(!text.includes(name), name);
});
const maps = Object.fromEntries(ROAD_TESTS.map(t => [t.map, load(t.map)]));
for (const t of ROAD_TESTS) {
  const map = maps[t.map], a = roadTestScenario(map, t), b = challengeScenario(map, t), route = new Route(a.route, map);
  const turns = examinerTurns(route).filter(x => !x.bend), script = examinerScript(route);
  test(`${t.id}: the route is stable and long enough to be a test`, () => {
    assert.deepEqual(a, b); assert.ok(route.length > 1000, String(route.length)); assert.equal(a.tags.length_m, Math.round(route.length));
  });
  test(`${t.id}: the route takes a signalled left, stop signs, a school or playground zone, residential streets and a lane change on an arterial`, () => {
    assert.ok(turns.some(x => x.dir === "left" && x.control === "signal"));
    assert.ok(route.controls.filter(c => c.control.type === "stop").length >= 2);
    assert.ok(route.zoneMarks.some(z => z.zone.kind === "school"));
    assert.ok(a.route.edges.filter(id => map.edges.get(id).cls === "residential").length >= 4);
    const shifts = route.laneShifts();
    assert.ok(shifts.length >= 1);
    assert.ok(shifts.some(sh => ["primary", "secondary", "tertiary"].includes(map.edges.get(route.edges[sh.i]).cls)));
  });
  test(`${t.id}: it ends past a gap at the kerb of a residential street, between parked cars`, () => {
    const space = a.roadTest.space, e = map.edges.get(space.edge);
    assert.equal(space.edge, a.route.edges.at(-1)); assert.equal(e.cls, "residential"); assert.ok(e.parking[1] > 0);
    assert.ok(space.b - space.a >= 1.55 * 4.4);
    const ctx = setupChallenge(map, t), parked = ctx.world.parked.list.filter(c => c.id.startsWith("road_test_parked_"));
    assert.equal(parked.length, 4); assert.ok(ctx.fleet.vehicles.length >= 10); assert.ok(ctx.world.crowd.list.length >= 20);
  });
  test(`${t.id}: the examiner directs every turn, stop, lane change, zone and the parking in order`, () => {
    for (const x of turns) assert.ok(script.some(l => l.kind === "turn" && l.at === x.at_m && l.text.includes(x.dir)));
    assert.ok(script.some(l => l.kind === "turn" && /^At the lights, turn left onto /.test(l.text)));
    assert.ok(script.some(l => l.kind === "lane" && /move into the left lane/.test(l.text)));
    assert.ok(script.some(l => l.kind === "zone")); assert.equal(script.at(-1).kind, "park");
    assert.equal(instructionAt(script, 0).kind, "start");
    const turn = turns.find(x => x.control === "signal");
    assert.equal(instructionAt(script, turn.at_m - 2).at, turn.at_m);
    assert.equal(instructionAt(script, route.length - 5).kind, "park");
  });
}

// --- the examiner's sheet
const kits = ROAD_TESTS[0];
const report = (overrides = {}) => ({ config: challengeConfig(kits), driver: "manual", branched: false, modified: false, started_at: "2026-11-07T10:00:00Z",
  status: "arrived", score: 92, qualified: true, collisions: 0, red_lights: 0, stop_signs: 0, failed_to_yield: 0, off_road_s: 0, resets: 0,
  speeding_s: 0, zone_speeding_s: 0, wrong_way_s: 0, close_following_s: 0, danger_s: 0, hard_brakes: 0,
  parking: { result: "parked", kerb_m: 0.14, angle_deg: 0.2, within_kerb: true, legs: 3, kerb_strikes: 0 }, incidents: [], ...overrides });
const incident = (type, message = type, at_s = 10) => ({ type, message, at_s, at_m: 100 });
test("a clean drive passes with no demerits, and every category is on the sheet", () => {
  const sheet = examine(kits, report());
  assert.equal(sheet.available, true); assert.equal(sheet.pass, true); assert.equal(sheet.demerits, 0); assert.equal(sheet.fails.length, 0);
  assert.deepEqual(sheet.categories.map(c => c.key), Object.keys(CATEGORIES));
});
test("every dangerous action or violation the shared verdict fails is an immediate fail, in its category", () => {
  const cases = [["collisions", "space"], ["red_lights", "right_of_way"], ["stop_signs", "right_of_way"], ["failed_to_yield", "right_of_way"], ["off_road_s", "steering"]];
  for (const [key, category] of cases) {
    const sheet = examine(kits, report({ [key]: key === "off_road_s" ? 1.2 : 1 }));
    assert.equal(sheet.pass, false, key); assert.equal(sheet.fails.length, 1, key); assert.equal(sheet.fails[0].category, category, key);
  }
  assert.equal(examine(kits, report({ status: "finished" })).fails[0].remark, "Did not complete the route");
  assert.equal(examine(kits, report({ parking: { result: "stopped in lane", kerb_strikes: 0 } })).fails[0].category, "parking");
  // (and the ones only the coaching report counts)
  for (const [key, value, category] of [["zone_speeding_s", 2, "speed"], ["wrong_way_s", 2, "steering"], ["resets", 1, "steering"], ["speeding_s", 12, "speed"]]) {
    const sheet = examine(kits, report({ [key]: value }));
    assert.equal(sheet.pass, false, key); assert.ok(sheet.fails.some(f => f.category === category), key);
  }
});
test("every failure the shared verdict can give today has a category; one added later is filed under Other", () => {
  const all = failures({ arrived: false, deadlocks: 0, collisions: 1, red_lights: 1, amber_lights_run: 1, stop_signs: 1, failed_to_yield: 1, off_road_s: 2,
    plow_right_passes: 1, merge_cut_ins: 1, close_passes: 1, bus_lane_driving: 5, glare_seconds: 2, glare_speeding_seconds: 2, illegal_turns: 1, hump_hits: 1,
    pxo_early_goes: 1, crew_close_passes: 1, guard_violations: 1, contraflow_conflicts: 1, fresh_green_conflicts: 1, reversing_conflicts: 1, pothole_hits: 1,
    ball_warnings_ignored: 1, wildlife_conflicts: 1 });
  assert.ok(all.length >= 24);
  for (const reason of all) if (reason !== "timeout") assert.notEqual(failureCategory(reason), "other", reason);
  assert.equal(failureCategory("drove into a snowbank"), "other");
  assert.equal(failureCategory("constructor"), "other");
});
test("guard and other opt-in audits in a report fail the test through the shared verdict", () => {
  const sheet = examine(kits, report({ guard_violations: 1, pothole_hits: 1 }));
  assert.equal(sheet.pass, false); assert.deepEqual(sheet.fails.map(f => f.category).sort(), ["right_of_way", "speed"]);
});
test("minor errors are one demerit each, a repeated one marked at most three times, grouped by category with incidents linked", () => {
  const hard = [1, 2, 3, 4, 5].map(i => incident("hard_brake", "Hard braking", i * 10));
  const sheet = examine(kits, report({ hard_brakes: 5, incidents: [...hard, incident("turn_no_signal", "No signal for the left turn onto Larch Street", 60),
    incident("late_stop", "Stopped past the stop line on Larch Street", 70), incident("lane_change_space", "Changed lanes to the left into too small a gap", 80)] }));
  assert.equal(sheet.pass, true); assert.equal(sheet.demerits, MAX_REPEAT + 3);
  const speed = sheet.categories.find(c => c.key === "speed");
  assert.equal(speed.demerits, MAX_REPEAT); assert.equal(speed.remarks[0].incident.at_s, 10);
  assert.equal(sheet.categories.find(c => c.key === "right_of_way").demerits, 2);
  assert.equal(sheet.categories.find(c => c.key === "observation").demerits, 1);
  assert.equal(sheet.categories.find(c => c.key === "right_of_way").remarks[0].remark, "No signal for the left turn onto Larch Street");
});
test("speeding briefly, following closely and a parking attempt that needs correcting are demerits", () => {
  const sheet = examine(kits, report({ speeding_s: 4, close_following_s: 3, off_road_s: 0.4,
    parking: { result: "parked", kerb_m: 0.26, angle_deg: 6, within_kerb: true, legs: 8, kerb_strikes: 1 }, incidents: [incident("kerb", "Backed a wheel onto the kerb")] }));
  assert.equal(sheet.pass, true);
  const by = key => sheet.categories.find(c => c.key === key).demerits;
  assert.equal(by("speed"), 2); assert.equal(by("space"), 1); assert.equal(by("steering"), 1); assert.equal(by("parking"), 4);
});
test("more demerits than the test allows fails it", () => {
  const types = ["turn_no_signal", "lane_change_no_signal", "late_stop", "turn_too_fast", "wide_turn", "lane_position", "lane_change_space", "hesitation"];
  const many = types.flatMap(type => [1, 2].map(i => incident(type, type, i)));
  const sheet = examine(kits, report({ incidents: many }));
  assert.equal(sheet.demerits, 16); assert.equal(sheet.pass, false); assert.equal(sheet.fails.at(-1).reason, "demerits");
  assert.equal(examine({ ...kits, maxDemerits: 20 }, report({ incidents: many })).pass, true);
});
test("every examiner remark type is a known minor error and unknown incidents are not marked", () => {
  for (const type of ["turn_no_signal", "lane_change_no_signal", "late_stop", "turn_too_fast", "wide_turn", "lane_position", "lane_change_space", "hesitation"]) assert.ok(MINOR_TYPES.includes(type), type);
  assert.equal(examine(kits, report({ incidents: [incident("snowbank_brush", "Brushed a snowbank")] })).demerits, 0);
});
test("a report without the audit counters cannot be marked", () => {
  assert.equal(examine(kits, report({ off_road_s: undefined })).available, false);
});

// --- eligibility and storage
function storage(raw = null) {
  const data = new Map(raw === null ? [] : [[ROAD_TEST_KEY, raw]]);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
test("only an unchanged, unreplayed manual attempt is recorded, with challenge practice untouched", () => {
  const s = storage();
  for (const overrides of [{ driver: "rules" }, { driver: "llm:local" }, { branched: true }, { modified: true }, { resets: 1 }, { status: "active" },
    { config: { ...challengeConfig(kits), seed: 1 } }, { config: { ...challengeConfig(kits), version: 99 } }]) {
    const r = report(overrides), result = saveRoadTest(kits, r, examine(kits, r), s);
    assert.equal(result.outcome, null, JSON.stringify(overrides));
  }
  assert.equal(s.getItem(ROAD_TEST_KEY), null);
  assert.equal(practiceOutcome(kits, report()), "completed"); // (the same eligibility rule as challenges)
});
test("results are kept by test id and version, with attempts, passes and the best attempt", () => {
  const s = storage(), save = r => saveRoadTest(kits, r, examine(kits, r), s);
  assert.equal(roadTestStatus(kits, readRoadTests(s).records), "untried");
  assert.equal(save(report({ collisions: 1 })).outcome, "failed");
  assert.equal(roadTestStatus(kits, readRoadTests(s).records), "attempted");
  assert.equal(save(report({ started_at: "2026-11-07T11:00:00Z", speeding_s: 4 })).outcome, "passed");
  save(report({ started_at: "2026-11-07T11:00:00Z", speeding_s: 4 })); // (the same attempt again is not counted twice)
  save(report({ started_at: "2026-11-07T12:00:00Z", speeding_s: 0.2, hard_brakes: 1, incidents: [incident("hard_brake")] }));
  save(report({ started_at: "2026-11-07T13:00:00Z", red_lights: 1 }));
  const r = readRoadTests(s).records[kits.id];
  assert.equal(r.attempts, 4); assert.equal(r.passes, 2); assert.equal(r.version, kits.version); assert.equal(r.last_at, "2026-11-07T13:00:00Z");
  assert.deepEqual(r.best, { pass: true, demerits: 1, fails: 0, at: "2026-11-07T12:00:00Z" });
  assert.equal(roadTestStatus(kits, readRoadTests(s).records), "passed");
  assert.equal(roadTestStatus({ ...kits, version: kits.version + 1 }, readRoadTests(s).records), "untried");
});
test("malformed road test storage is ignored and blocked storage still returns an outcome", () => {
  for (const raw of ["{", "[]", JSON.stringify({ [kits.id]: { version: 1, attempts: 0, passes: 0, best: null, last_at: "x" } })]) assert.equal(Object.keys(readRoadTests(storage(raw)).records).length, 0);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readRoadTests(blocked).available, false);
  assert.equal(saveRoadTest(kits, report(), examine(kits, report()), blocked).outcome, "passed");
});

// --- the observer, on a real drive: a Rules drive with its indicators hidden from the examiner
{
  const t = ROAD_TESTS[0], map = maps[t.map], ctx = setupChallenge(map, t), { world, autopilot } = ctx;
  const score = new DriveScore(world, { title: t.title, map: t.map, driver: "rules", route: world.route });
  score.observer = new RoadTestObserver();
  for (let k = 0; k < 60 * 160 && autopilot.enabled; k++) {
    const road = stepWorld(ctx, 1 / 60, world.t * 1000);
    world.ego.signal = null; // (after the world moved: only the examiner misses the indicators)
    score.record(world, road, 1 / 60);
  }
  const marked = score.snapshot().incidents.filter(i => i.type === "turn_no_signal").map(i => i.message);
  test("the examiner marks a turn made without signalling, at the turn, with the street's name", () => {
    assert.ok(marked.includes("No signal for the left turn onto Larch Street"), marked.join("; "));
    assert.ok(marked.includes("No signal for the left turn onto West 4th Avenue"), marked.join("; "));
  });
}

// --- full drives, as the arena runs them
const results = [];
for (const t of ROAD_TESTS) for (const brain of ["rules", "cautious"]) {
  const result = await evaluateChallenge(maps[t.map], t, { brain });
  results.push(result);
  const sheet = examine(t, result.report);
  console.log(`  ${t.id} · ${brain}: ${result.report.status} in ${result.time_s} s, ${result.distance_m} m · ${sheet.pass ? "PASS" : "FAIL"} · ${sheet.demerits} demerits${sheet.fails.length ? ` · ${sheet.fails.map(f => f.remark).join("; ")}` : ""}${sheet.minors.length ? ` · ${sheet.minors.map(m => m.remark).join("; ")}` : ""}`);
  test(`${t.id}: ${brain} completes the test and parks, and the examiner marks it`, () => {
    assert.equal(result.report.status, "arrived"); assert.equal(result.report.parking.result, "parked"); assert.ok(result.pass, JSON.stringify(result.failures));
    assert.equal(sheet.available, true); assert.equal(sheet.pass, true); assert.ok(sheet.demerits <= t.maxDemerits);
    assert.ok(result.report.incidents.every(i => MINOR_TYPES.includes(i.type) || ["parking", "following_recovery"].includes(i.type)), result.report.incidents.map(i => i.type).join());
    assert.equal(validateEvaluation(JSON.parse(JSON.stringify({ schema: EVALUATION_SCHEMA, challenge_version: 2, created_at: new Date().toISOString(), results: [result] }))).results.length, 1);
  });
}
// (two saved runs of both tests with Rules and the cautious agent, counted as UTF-16, as lab/history.js does)
const run = { schema: EVALUATION_SCHEMA, challenge_version: 2, created_at: "2026-11-07T00:00:00Z", status: "complete", results };
const bytes = JSON.stringify([run, run]).length * 2;
test("two saved runs of the road tests stay a small part of the history budget", () => assert.ok(bytes < 0.15 * 9 * 1024 * 1024, String(bytes)));
console.log(`Road test history: ${bytes} bytes, ${(bytes / (9 * 1024 * 1024) * 100).toFixed(1)}% of the 9 MB cap for ${ROAD_TESTS.length} road tests with two drivers, twice`);
console.log(`${passed} road test checks passed`);
process.exit(0);
