// Offline checks of the scores beyond pass or fail (static/js/bench/scores.js, ROADMAP 4.3) and the
// held-out seeds (static/js/bench/heldout.js, ROADMAP 4.4), on hand-made results and on committed runs
// and model recordings. Assertions receive primitives only.
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
globalThis.document = { querySelector: () => null };
const { driveScores, driverScores, rankDrivers, ramp, scoresText, REFERENCE_KMH, SCORES_VERSION } = await import("../static/js/bench/scores.js");
const { HELDOUT, HELDOUT_DEFAULT, HELDOUT_SEEDS, heldoutPlan } = await import("../static/js/bench/heldout.js");
const { soakPlan } = await import("./soak.mjs");
const { failures } = await import("../static/js/bench/metrics.js");

const root = new URL("../", import.meta.url);
const run = (name) => JSON.parse(fs.readFileSync(new URL(`data/runs/${name}.json`, root)));
const recording = (name) => JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`data/recordings/${name}`, root))));

// --- formulas on a hand-made drive -------------------------------------------------------------
assert.equal(SCORES_VERSION, 1);
assert.equal(REFERENCE_KMH, 50);
assert.equal(ramp(1, 1, 6), 1); assert.equal(ramp(6, 1, 6), 0); assert.equal(ramp(3.5, 1, 6), 0.5);
assert.equal(ramp(4, 4, 1), 1); assert.equal(ramp(0, 4, 1), 0); assert.equal(ramp(2.5, 4, 1), 0.5);
// 1 km at 25 km/h: 144 s against 72 s at the reference speed
const base = { id: "x-1", arrived: true, pass: true, time_s: 144, distance_m: 1000, progress: 1, tags: { length_m: 1000 },
  collisions: 0, rms_jerk: 1, hard_brakes: 0, max_lat_accel: 2, min_ttc_s: null, min_headway_s: null, safety_brakes: 0 };
let s = driveScores(base);
assert.equal(s.progress, 1); assert.equal(s.pace, 50); assert.equal(s.time_lost_s, 72); assert.equal(s.time_lost_s_per_km, 72);
assert.equal(s.comfort, 100); assert.equal(s.margin, 100); assert.equal(s.score, 83.3);
// every comfort part at its uncomfortable end
s = driveScores({ ...base, rms_jerk: 6, hard_brakes: 10, max_lat_accel: 7 });
assert.equal(s.comfort, 0);
s = driveScores({ ...base, rms_jerk: 3.5 });
assert.equal(s.comfort, 80);
// margin: TTC 2.5 s (half), headway 1.25 s (half), 5 safety brakes a km (none left)
s = driveScores({ ...base, min_ttc_s: 2.5, min_headway_s: 1.25, safety_brakes: 5 });
assert.equal(s.margin, 35);
assert.equal(driveScores({ ...base, collisions: 1 }).margin, 0);
// a drive that did not arrive: half the route in 144 s, so 108 s lost against the 36 s it needed
s = driveScores({ ...base, arrived: false, pass: false, progress: 0.5 });
assert.equal(s.progress, 0.5); assert.equal(s.time_lost_s, 108); assert.equal(s.pace, 25);
assert.equal(s.score, 0.5 * Math.round(((25 + 100 + 100) / 3) * 10) / 10);
// a drive faster than the reference speed loses no time and its pace stops at 100
s = driveScores({ ...base, time_s: 60 });
assert.equal(s.time_lost_s, 0); assert.equal(s.pace, 100);
// arena results have no route length: the distance driven stands in
s = driveScores({ ...base, tags: undefined, distance_m: 500, time_s: 72 });
assert.equal(s.time_lost_s, 36); assert.equal(s.time_lost_s_per_km, 72);
// an arrival scores progress 1 whatever the route projection said (a detour re-plans the route)
assert.equal(driveScores({ ...base, progress: 0.7 }).progress, 1);
assert.ok(scoresText(driverScores([base])).startsWith("score 83.3 · progress 100%"));
// a drive's scores are computed, not stored: the result is left as it was
const before = JSON.stringify(base);
driveScores(base); driverScores([base]); rankDrivers([{ driver: "a", results: [base] }]);
assert.equal(JSON.stringify(base), before);
console.log("✓ formulas, units and edge cases");

// --- per driver and ranking ---------------------------------------------------------------------
const slow = { ...base, id: "x-2", time_s: 288, tags: { length_m: 1000 } };
const d = driverScores([base, slow]);
assert.equal(d.drives, 2); assert.equal(d.passed, 2); assert.equal(d.km, 2);
assert.equal(d.time_lost_s, 72 + 216); assert.equal(d.time_lost_s_per_km, 144);
// two passing drivers: the smoother, quicker one ranks first
let ranked = rankDrivers([{ driver: "jerky", results: [{ ...base, rms_jerk: 5 }, slow] }, { driver: "smooth", results: [base, slow] }]);
assert.equal(ranked.ranking.map((r) => r.driver).join(","), "smooth,jerky");
assert.equal(ranked.ranking[0].rank, 1); assert.equal(ranked.ranking[1].rank, 2);
// more passes outrank a higher score
ranked = rankDrivers([{ driver: "fails", results: [{ ...base, pass: false }, slow] }, { driver: "passes", results: [{ ...base, rms_jerk: 6, hard_brakes: 10 }, slow] }]);
assert.equal(ranked.ranking[0].driver, "passes");
// only the drives both have count; equal drivers share a rank
ranked = rankDrivers([{ driver: "b", results: [base, slow] }, { driver: "a", results: [base, { ...base, id: "x-3" }] }]);
assert.equal(ranked.matched.join(","), "x-1");
assert.equal(ranked.ranking.map((r) => `${r.driver}${r.rank}`).join(","), "a1,b1");
// arena results are matched by challenge
ranked = rankDrivers([{ driver: "a", results: [{ ...base, id: undefined, challenge: "door-zone" }] }, { driver: "b", results: [{ ...base, id: undefined, challenge: "door-zone" }, { ...base, id: undefined, challenge: "four-way-stop" }] }]);
assert.equal(ranked.matched.join(","), "door-zone");
console.log("✓ per-driver aggregates and ranking");

// --- committed results ----------------------------------------------------------------------------
// Jev and DeepSeek V4.1 Flash on the challenges (model recordings, 2026-11-11): rank them on the
// challenges both passed.
const jev = recording("jev-arena-2026-11-11.json.gz").results, deepseek = recording("deepseek-arena-2026-11-11.json.gz").results;
const bothPassed = Object.keys(jev).filter((id) => jev[id].pass && deepseek[id]?.pass);
assert.ok(bothPassed.length >= 60, `${bothPassed.length} challenges both passed`);
ranked = rankDrivers([{ driver: "jev", results: bothPassed.map((id) => jev[id]) }, { driver: "deepseek", results: bothPassed.map((id) => deepseek[id]) }]);
assert.equal(ranked.matched.length, bothPassed.length);
assert.equal(ranked.ranking[0].passed, bothPassed.length); assert.equal(ranked.ranking[1].passed, bothPassed.length);
// both pass every one of them, yet the scores tell them apart
assert.notEqual(ranked.ranking[0].score, ranked.ranking[1].score);
assert.ok(ranked.ranking[0].score > ranked.ranking[1].score);
assert.equal(ranked.ranking.map((r) => r.driver).join(","), "deepseek,jev");
console.log(`✓ Jev and DeepSeek both pass ${bothPassed.length} challenges; scores ${ranked.ranking.map((r) => `${r.driver} ${r.score}`).join(", ")}`);
// Rules and the cautious agent on the Kitsilano city suite: rank them on the routes both passed
const rules = run("20261112-190001-rules").results, cautious = run("20261111-172000-cautious").results;
const passedBoth = rules.filter((r) => r.pass && cautious.find((c) => c.id === r.id)?.pass).map((r) => r.id);
assert.ok(passedBoth.length >= 8);
ranked = rankDrivers([{ driver: "rules", results: rules.filter((r) => passedBoth.includes(r.id)) }, { driver: "cautious", results: cautious.filter((r) => passedBoth.includes(r.id)) }]);
assert.notEqual(ranked.ranking[0].score, ranked.ranking[1].score);
// the cautious agent keeps more margin and loses more time than Rules, which the scores show
const by = Object.fromEntries(ranked.ranking.map((r) => [r.driver, r]));
assert.ok(by.cautious.margin > by.rules.margin);
assert.ok(by.cautious.time_lost_s_per_km > by.rules.time_lost_s_per_km);
// over the whole suite Rules ranks first on passes (12 against 10) although the cautious agent scores higher
ranked = rankDrivers([{ driver: "rules", results: rules }, { driver: "cautious", results: cautious }]);
assert.equal(ranked.ranking[0].driver, "rules"); assert.equal(ranked.ranking[0].passed, 12);
console.log(`✓ Rules and the cautious agent on ${passedBoth.length} routes both passed: ${Object.values(by).map((r) => `${r.driver} ${r.score}`).join(", ")}`);
// every committed run and recording scores without a missing number
const files = fs.readdirSync(new URL("data/runs/", root)).filter((f) => f.endsWith(".json"));
let scored = 0;
for (const f of files) {
  const results = JSON.parse(fs.readFileSync(new URL(`data/runs/${f}`, root))).results || [];
  for (const r of results) {
    const x = driveScores(r);
    for (const k of ["progress", "pace", "comfort", "margin", "score", "time_lost_s"]) assert.ok(Number.isFinite(x[k]) && x[k] >= 0, `${f} ${r.id} ${k}`);
    assert.ok(x.score <= 100 && x.comfort <= 100 && x.margin <= 100 && x.pace <= 100);
    scored++;
  }
}
const stub = JSON.parse(fs.readFileSync(new URL("data/recordings/stub-llm-kitsilano-s1.json", root)));
for (const r of Object.values(stub.results)) { assert.ok(Number.isFinite(driveScores(r).score)); assert.equal(failures(r).length === 0, r.pass); scored++; }
console.log(`✓ ${scored} committed drives score in range`);

// --- held-out seeds ------------------------------------------------------------------------------------
assert.equal(heldoutPlan("kitsilano").seeds.join(","), "101,102,103");
assert.equal(heldoutPlan("kitsilano").count * heldoutPlan("kitsilano").seeds.length, 12);
assert.equal(heldoutPlan("toronto").seeds.join(","), HELDOUT_DEFAULT.seeds.join(","));
assert.equal(heldoutPlan("-123.2,49.2,-123.1,49.3").count, 2);
assert.equal(HELDOUT_SEEDS.join(","), "101,102,103");
assert.ok(Object.keys(HELDOUT).every((m) => typeof m === "string"));
// no committed run and no CI job uses a held-out seed for anything but a held-out run
for (const f of files) {
  const config = JSON.parse(fs.readFileSync(new URL(`data/runs/${f}`, root))).config || {};
  if (!config.heldout) assert.ok(!HELDOUT_SEEDS.includes(config.seed), `${f} uses held-out seed ${config.seed}`);
}
for (const f of fs.readdirSync(new URL(".github/workflows/", root))) {
  const text = fs.readFileSync(new URL(`.github/workflows/${f}`, root), "utf8");
  for (const seed of HELDOUT_SEEDS) assert.ok(!new RegExp(`--seeds? [0-9,]*\\b${seed}\\b`).test(text), `${f} tunes on held-out seed ${seed}`);
}
// soak: one configuration per map, flagged so bench_node runs the held-out suite
const plan = soakPlan({ maps: ["kitsilano", "toronto"], heldout: true });
assert.equal(plan.map((t) => t.id).join(","), "heldout/kitsilano,heldout/toronto");
assert.equal(plan.every((t) => t.heldout === true && t.options.features === "city"), true);
assert.equal(plan[0].seeds.join(","), "101,102,103"); assert.equal(plan[1].count, 2);
assert.equal(soakPlan({ maps: ["kitsilano", "toronto"], heldout: true, shard: 1, shards: 2 }).map((t) => t.id).join(","), "heldout/toronto");
assert.throws(() => soakPlan({ mode: "pairs", heldout: true }));
// and the tuned plan is as it was
assert.equal(soakPlan({ mode: "city", maps: ["kitsilano"], seeds: [1] }).map((t) => t.id).join(","), "city/kitsilano/seed-1");
console.log("✓ held-out seeds, plans and soak configurations");
process.exit(0);
