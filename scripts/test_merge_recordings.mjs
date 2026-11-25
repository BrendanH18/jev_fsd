// Arena and seeded benchmark recordings made in parts merge with every drive, answer and result.
// node --experimental-default-type=module scripts/test_merge_recordings.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import suiteV1 from "../data/suites/v1.json" with { type: "json" };
import { setRecordingSuiteVersion } from "../static/js/bench/suite-version.js";
globalThis.document = { querySelector: () => null };
const { ModelRecording } = await import("../static/js/brain/recording.js");
const { benchRouteFingerprint } = await import("./run_manifest.mjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-recordings-"));
const header = (ids, extra = {}) => ({
  driver: "jev",
  kind: "jev",
  model: "jev-test",
  recorded_at: extra.recorded_at || "2026-11-20T10:00:00.000Z",
  engine: "node v22",
  versions: { format: "jev-model-recording/1" },
  arena: { set: "all", ids, ...(extra.track ? { track: extra.track } : {}) },
  maps: extra.maps || { kitsilano: "aaaa" },
  ...(extra.manifest ? { manifest: extra.manifest } : {}),
});
const write = (name, h, drives) => {
  const r = new ModelRecording({
    header: h,
    drives: Object.fromEntries(drives.map((id) => [id, { [`k-${id}`]: [{ response: { id } }] }])),
    results: Object.fromEntries(
      drives.map((id) => [id, { challenge: id, ...h.manifest?.suite.drives[id], pass: true, result_sha: id }]),
    ),
  });
  const file = path.join(dir, name);
  fs.writeFileSync(file, r.serialize());
  return file;
};
const arenaOutput = path.join(dir, "out.json");
const mergeTo = (destination, ...files) =>
  execFileSync(
    process.execPath,
    [
      "--experimental-default-type=module",
      new URL("merge_recordings.mjs", import.meta.url).pathname,
      "--out",
      destination,
      ...files,
    ],
    { stdio: "pipe" },
  ).toString();
const merge = (...files) => mergeTo(arenaOutput, ...files);

const a = write("a.json", header(["one", "two"], { track: "open" }), ["one", "two"]);
const b = write(
  "b.json",
  header(["three"], {
    track: "open",
    recorded_at: "2026-11-20T09:00:00.000Z",
    maps: { kitsilano: "aaaa", toronto: "bbbb" },
  }),
  ["three"],
);
assert.match(merge(a, b), /merged 3 drives from 2 recordings/);
const merged = ModelRecording.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
assert.deepEqual(Object.keys(merged.results), ["one", "two", "three"]);
assert.deepEqual(merged.header.arena.ids, ["one", "two", "three"]);
assert.equal(merged.header.arena.track, "open");
assert.equal(merged.header.recorded_at, "2026-11-20T09:00:00.000Z");
assert.deepEqual(merged.header.maps, { kitsilano: "aaaa", toronto: "bbbb" });
assert.equal(merged.drives.three["k-three"][0].response.id, "three");
console.log("✓ parts merge into one recording with every drive, the earliest time and every map");

const source = fs.readFileSync(a, "utf8");
assert.throws(() => mergeTo(a, a, b), /output must differ from its input recordings/);
assert.equal(fs.readFileSync(a, "utf8"), source);
const inputAlias = path.join(dir, "arena-alias.json");
fs.linkSync(a, inputAlias);
assert.throws(() => mergeTo(inputAlias, a, b), /output must differ from its input recordings/);
fs.writeFileSync(`${arenaOutput}.tmp`, "another process's file");
assert.match(merge(a, b), /merged 3 drives/);
assert.equal(fs.readFileSync(`${arenaOutput}.tmp`, "utf8"), "another process's file");

const refused = (files, pattern, what) => {
  assert.throws(
    () => merge(...files),
    (error) => pattern.test(error.stderr.toString()),
    what,
  );
  console.log(`✓ refused: ${what}`);
};
refused(
  [a, write("c.json", header(["two"], { track: "open" }), ["two"])],
  /more than one part/,
  "a drive in two parts",
);
refused([a, write("d.json", header(["four"]), ["four"])], /differs/, "another track");
refused(
  [a, write("e.json", header(["five"], { track: "open", maps: { kitsilano: "cccc" } }), ["five"])],
  /other map data/,
  "other map data",
);
// (a finished drive whose answers are missing could not replay)
const torn = new ModelRecording({
  header: header(["six"], { track: "open" }),
  drives: {},
  results: { six: { challenge: "six", pass: true, result_sha: "six" } },
});
fs.writeFileSync(path.join(dir, "f.json"), torn.serialize());
refused([a, path.join(dir, "f.json")], /no answers/, "a result without its answers");
const extraAnswers = ModelRecording.parse(source);
extraAnswers.drives.unfinished = {};
const unfinished = path.join(dir, "unfinished-arena.json");
fs.writeFileSync(unfinished, extraAnswers.serialize());
refused([unfinished, b], /keep a result for every set of answers/, "answers without a result");
const partial = write("partial-arena.json", header(["four", "five"], { track: "open" }), ["four"]);
assert.match(merge(a, partial), /merged 3 drives/, "a resumed merge can use a shard stopped between drives");
const stopped = ModelRecording.parse(fs.readFileSync(partial, "utf8"));
stopped.results.four.stopped = true;
fs.writeFileSync(partial, stopped.serialize());
refused([a, partial], /stopped attempt for four/, "a stopped attempt cannot enter the replay plan");

const withManifest = (id, map, fingerprint, source_commit = "a".repeat(40)) =>
  write(
    `${id}.json`,
    header([id], {
      maps: { [map]: fingerprint },
      manifest: {
        format: "jev-run-manifest/1",
        source_commit,
        suite: { kind: "arena", set: "all", drives: { [id]: { map, seed: 42 } } },
        maps: { [map]: { fingerprint } },
        cost_usd: 0,
      },
    }),
    [id],
  );
const g = withManifest("seven", "kitsilano", "aaaa");
const h = withManifest("eight", "toronto", "bbbb");
assert.match(merge(g, h), /merged 2 drives from 2 recordings/);
const legacy = ModelRecording.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
const provenance = legacy.header.manifest;
assert.equal(provenance.format, "jev-run-manifest/1");
assert.equal(provenance.suite_version, undefined);
assert.equal(legacy.header.suite_version, undefined);
assert.ok(Object.values(legacy.results).every((result) => result.suite_version === undefined));
assert.deepEqual(Object.keys(provenance.suite.drives), ["seven", "eight"]);
assert.deepEqual(Object.keys(provenance.maps), ["kitsilano", "toronto"]);
refused([g, withManifest("nine", "toronto", "bbbb", "b".repeat(40))], /differs.*source/, "another source commit");
const wrongMap = withManifest("ten", "kitsilano", "aaaa");
const mapShard = ModelRecording.parse(fs.readFileSync(wrongMap, "utf8"));
mapShard.header.manifest.maps.kitsilano.components = { roads: "other" };
fs.writeFileSync(wrongMap, mapShard.serialize());
refused([g, wrongMap], /conflicting manifest map data/, "manifests that disagree on a shared map");
mapShard.header.manifest.maps.kitsilano.fingerprint = "other";
fs.writeFileSync(wrongMap, mapShard.serialize());
refused([h, wrongMap], /conflicting manifest map data/, "a manifest fingerprint that disagrees with its tape");

const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");
const { activeSuite: canonical, authoredDrive } = await import("./canonical_suite.mjs");
const { heldoutPlan } = await import("../static/js/bench/heldout.js");
const authored = [...CHALLENGES, ...ROAD_TESTS].map((c) => [c.id, authoredDrive(c)]);
assert.deepEqual(Object.fromEntries(authored), canonical.arena.drives);
const { seeds, count } = canonical.bench.heldout;
assert.deepEqual(heldoutPlan("kitsilano"), { seeds, count });

function arenaShard(name, entries) {
  const maps = Object.fromEntries(entries.map(([, { map }]) => [map, canonical.maps[map]]));
  const ids = entries.map(([id]) => id);
  const recording = new ModelRecording({
    header: header(ids, {
      maps,
      manifest: {
        source_commit: "a".repeat(40),
        source_dirty: false,
        suite: { kind: "arena", set: "all", drives: Object.fromEntries(entries) },
        maps: Object.fromEntries(Object.entries(maps).map(([map, fingerprint]) => [map, { fingerprint }])),
        cost_usd: 0,
      },
    }),
    drives: Object.fromEntries(ids.map((id) => [id, {}])),
    results: Object.fromEntries(
      entries.map(([id, drive]) => [id, { challenge: id, ...drive, pass: false, result_sha: id }]),
    ),
  });
  setRecordingSuiteVersion(recording, "custom");
  const file = path.join(dir, name);
  fs.writeFileSync(file, recording.serialize());
  return file;
}
const division = Math.floor(authored.length / 2);
const shardA = arenaShard("arena-a.json", authored.slice(0, division));
const shardB = arenaShard("arena-b.json", authored.slice(division));
merge(shardA, shardB);
const canonicalMerge = ModelRecording.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
const firstId = authored[0][0];
assert.equal(canonicalMerge.header.suite_version, canonical.version);
assert.equal(canonicalMerge.results[firstId].result_sha, firstId);
assert.equal(canonicalMerge.results[firstId].suite_version, canonical.version);
canonicalMerge.header.manifest.format = "jev-run-manifest/1";
assert.throws(() => ModelRecording.parse(canonicalMerge.serialize()), /disagree on suite_version/);
canonicalMerge.header.manifest.format = "jev-run-manifest/2";
delete canonicalMerge.results[firstId].suite_version;
assert.throws(() => ModelRecording.parse(canonicalMerge.serialize()), /disagree on suite_version/);
const swapped = ModelRecording.parse(fs.readFileSync(shardB, "utf8"));
const [left, right] = Object.keys(swapped.results);
[swapped.results[left], swapped.results[right]] = [swapped.results[right], swapped.results[left]];
const changed = path.join(dir, "arena-swapped.json");
fs.writeFileSync(changed, swapped.serialize());
refused([shardA, changed], /disagrees with its authored drive/, "arena results swapped between two drive keys");
merge(shardA, arenaShard("arena-short.json", authored.slice(division, -1)));
assert.equal(ModelRecording.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8")).header.suite_version, "custom");

const config = { map: "kitsilano", features: "city", count: 3, seed: 1, brain: "jev" };
const benchScenarios = ["s1-1", "s1-2"].map((id) => ({ id, traffic_seed: 42 }));
function benchPart(id, pass, traffic_seed = 42, name = id, version) {
  const manifest = {
    format: "jev-run-manifest/1",
    source_commit: "a".repeat(40),
    source_dirty: false,
    maps: { kitsilano: { fingerprint: "map-sha" } },
    suite: {
      kind: "bench",
      only: true,
      config,
      ids: [id],
      generated_ids: benchScenarios.map((scenario) => scenario.id),
      route_sha: benchRouteFingerprint(benchScenarios),
    },
    cost_usd: 0.01,
  };
  const result = { id, arrived: pass, pass, cost_usd: 0.01, wall_ms: 10, suite_version: version };
  const tape = new ModelRecording({
    header: { driver: "jev", brain: "jev", bench: config, map_sha: "map-sha", manifest },
    drives: { [id]: {} },
  });
  if (version !== undefined) setRecordingSuiteVersion(tape, version);
  tape.keepResult(id, result, { id, traffic_seed });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ suite_version: version, manifest, config, results: [result], saved_at: "2026-11-21T08:00:00Z" }),
  );
  fs.writeFileSync(`${file}.gz`, gzipSync(tape.serialize()));
  return file;
}
const first = benchPart("s1-1", false),
  second = benchPart("s1-2", true),
  report = path.join(dir, "bench.json");
const mergeBench = (...files) =>
  execFileSync(
    process.execPath,
    [
      new URL("merge_bench_recordings.mjs", import.meta.url).pathname,
      "--json",
      report,
      "--record",
      `${report}.gz`,
      ...files,
    ],
    { stdio: "pipe" },
  ).toString();
assert.throws(() => mergeBench(first, first), /Unexpected or repeated drive s1-1/);
assert.throws(
  () => mergeBench(first, benchPart("s1-2", true, 43, "shifted")),
  /recorded routes do not match the complete seeded suite/,
);
const brokenReport = path.join(dir, "broken-report.json");
fs.writeFileSync(brokenReport, "{");
assert.throws(() => mergeBench(first, brokenReport), /broken-report\.json: cannot read report/);
const brokenTape = benchPart("s1-2", true, 42, "broken-tape");
fs.writeFileSync(`${brokenTape}.gz`, "not a gzip recording");
assert.throws(() => mergeBench(first, brokenTape), /broken-tape\.json\.gz: cannot read recording/);
const extraBenchmarkTape = benchPart("s1-2", true, 42, "extra-answers");
const extraPart = ModelRecording.parse(gunzipSync(fs.readFileSync(`${extraBenchmarkTape}.gz`)).toString("utf8"));
extraPart.drives.unfinished = {};
fs.writeFileSync(`${extraBenchmarkTape}.gz`, gzipSync(extraPart.serialize()));
assert.throws(() => mergeBench(first, extraBenchmarkTape), /report, tape and selected drives disagree/);
assert.equal(fs.existsSync(report), false);
assert.match(mergeBench(second, first), /Merged 2 drives from 2 parts/);
const combined = JSON.parse(fs.readFileSync(report, "utf8"));
assert.deepEqual(
  combined.results.map((result) => [result.id, result.pass]),
  [
    ["s1-1", false],
    ["s1-2", true],
  ],
);
assert.equal(combined.summary.cost_usd, 0.02);
assert.equal(combined.suite_version, undefined);
assert.equal(combined.manifest.format, "jev-run-manifest/1");
assert.equal(combined.manifest.suite_version, undefined);
assert.ok(combined.results.every((result) => result.suite_version === undefined));
const combinedTape = ModelRecording.parse(gunzipSync(fs.readFileSync(`${report}.gz`)).toString("utf8"));
assert.equal(combinedTape.header.suite_version, undefined);
assert.deepEqual(combinedTape.header.manifest, combined.manifest);
assert.equal(combined.manifest.suite.only, undefined);
assert.deepEqual(combined.manifest.suite.ids, ["s1-1", "s1-2"]);
assert.equal(combined.name, "20261121-080000-jev");
console.log("✓ city parts merge in suite order with failed verdicts kept and duplicate drives refused");

fs.rmSync(report);
fs.rmSync(`${report}.gz`);
mergeBench(benchPart("s1-1", false, 42, "legacy-a", "legacy"), benchPart("s1-2", true, 42, "legacy-b", "legacy"));
const explicitLegacy = JSON.parse(fs.readFileSync(report, "utf8"));
assert.equal(explicitLegacy.suite_version, "legacy");
assert.equal(explicitLegacy.manifest.suite_version, "legacy");
assert.ok(explicitLegacy.results.every((result) => result.suite_version === "legacy"));

function repeat(
  name,
  { pass, recorded_at, cost_usd, time_s, source_dirty = false, model = "jev-test", failures, track = "guarded" },
) {
  const challenge = "one";
  const recording = new ModelRecording({
    header: header([challenge], {
      recorded_at,
      track,
      manifest: { source_commit: "a".repeat(40), source_dirty },
    }),
    results: { [challenge]: { challenge, pass, failures: failures ?? (pass ? [] : ["timeout"]), cost_usd, time_s } },
    drives: { [challenge]: { key: [{ response: { meta: { model } } }] } },
  });
  const file = path.join(dir, name);
  fs.writeFileSync(file, recording.serialize());
  return file;
}
const compare = (...files) =>
  execFileSync(process.execPath, [new URL("compare_repeats.mjs", import.meta.url).pathname, ...files], {
    stdio: "pipe",
  });
const repeatOne = repeat("repeat-one.json", {
  pass: true,
  recorded_at: "2026-11-21T08:00:00Z",
  cost_usd: 0.01,
  time_s: 10,
});
const repeatTwo = repeat("repeat-two.json", {
  pass: false,
  recorded_at: "2026-11-21T08:30:00Z",
  cost_usd: 0.03,
  time_s: 20,
});
const reportRepeat = JSON.parse(compare(repeatOne, repeatTwo)).drivers[0];
assert.deepEqual(reportRepeat.cost_usd, { min: 0.01, mean: 0.02, max: 0.03 });
assert.deepEqual(reportRepeat.by_drive.one.verdicts, { passed: 1, failed: 1 });
assert.deepEqual(reportRepeat.by_drive.one.time_s, { min: 10, mean: 15, max: 20 });
assert.deepEqual(reportRepeat.by_drive.one.cost_usd, { min: 0.01, mean: 0.02, max: 0.03 });
assert.deepEqual(reportRepeat.by_drive.one.failure_reasons, { timeout: 1 });
assert.match(String(compare("--help")), /--driver/);
assert.deepEqual(
  JSON.parse(compare("--driver=jev", repeatOne, repeatTwo)).drivers.map((driver) => driver.driver),
  ["jev"],
);
assert.throws(() => compare("--driver=absent", repeatOne, repeatTwo), /Unknown driver absent/);
assert.throws(() => compare(repeatOne, repeatOne), /List each recording once/);
assert.throws(
  () => compare(repeatOne, repeat("unknown-track.json", { pass: true, track: "typo" })),
  /unknown arena track/,
);
assert.throws(() => compare(repeatOne, repeat("bad-result.json", { pass: 1 })), /invalid challenge result/);
assert.throws(
  () => compare(repeatOne, repeat("bad-failures.json", { pass: true, failures: "timeout" })),
  /invalid challenge result/,
);
assert.throws(
  () => compare(repeatOne, repeat("changed-model.json", { pass: true, model: "moved" })),
  /same model, prompt and provider settings/,
);
assert.throws(
  () => compare(repeatOne, repeat("negative-cost.json", { pass: true, cost_usd: -1 })),
  /finite nonnegative/,
);
assert.throws(
  () => compare(repeatOne, repeat("string-cost.json", { pass: true, cost_usd: "0.01" })),
  /finite nonnegative/,
);
assert.throws(
  () => compare(repeatOne, repeat("excessive-cost.json", { pass: true, cost_usd: 1e12 })),
  /cost exceeds the supported range/,
);
assert.deepEqual(
  reportRepeat.runs.map(({ file, cost_usd, failed_drives }) => [file, cost_usd, failed_drives]),
  [
    [repeatOne, 0.01, []],
    [repeatTwo, 0.03, ["one"]],
  ],
);
const duplicate = path.join(dir, "repeat-copy.json.gz");
fs.writeFileSync(duplicate, gzipSync(fs.readFileSync(repeatOne)));
assert.throws(() => compare(repeatOne, duplicate), /copies of the same recording/);
const reformatted = path.join(dir, "repeat-reformatted.json");
fs.writeFileSync(reformatted, JSON.stringify(JSON.parse(fs.readFileSync(repeatOne, "utf8")), null, 2));
assert.throws(() => compare(repeatOne, reformatted), /copies of the same recording/);
const dirty = repeat("repeat-dirty.json", { pass: true, cost_usd: 0, source_dirty: true });
assert.throws(() => compare(repeatOne, dirty), /same clean source/);
const missingAnswers = ModelRecording.parse(fs.readFileSync(repeatTwo, "utf8"));
missingAnswers.drives = {};
fs.writeFileSync(repeatTwo, missingAnswers.serialize());
assert.throws(() => compare(repeatOne, repeatTwo), /complete arena recording/);
console.log("✓ repeat comparison preserves per-run outcomes and costs and rejects duplicate and incomplete tapes");

const plan = new URL("../docs/validation/arena-open-repeats-v1.json", import.meta.url).pathname;
const { drives: plannedDrives } = suiteV1.arena;
const { maps: plannedMaps } = suiteV1;
function plannedRepeat(driver, number, { track = "open", effort = "low", ids = Object.keys(plannedDrives) } = {}) {
  const llm = driver.startsWith("llm:");
  const model = llm ? "claude-haiku-5-5" : "jev-test";
  const fullHeader = {
    ...header(ids, {
      maps: plannedMaps,
      track,
      recorded_at: `2026-11-23T0${number}:00:00Z`,
      manifest: {
        format: "jev-run-manifest/2",
        source_commit: "a".repeat(40),
        source_dirty: false,
        engine: "node v22",
        driver,
        track,
      },
    }),
    model,
    driver,
    kind: llm ? "llm" : "jev",
  };
  const outcome = {
    response: {
      meta: { model },
      ...(llm
        ? { trace: { request: { url: "https://api.anthropic.com/v1/messages", output_config: { effort } } } }
        : {}),
    },
  };
  const results = Object.fromEntries(
    ids.map((challenge, index) => {
      const failed = index === 0 && number === 2;
      return [
        challenge,
        {
          challenge,
          ...plannedDrives[challenge],
          track,
          mode: "lockstep",
          pass: !failed,
          failures: failed ? ["red light"] : [],
          red_lights: Number(failed),
          safety_brakes: Number(failed),
          fallbacks: Number(failed),
          flagged_choices: number,
          decisions: 10,
          model_decisions: failed ? 8 : 9,
          local_decisions: 1,
          fallback_decisions: Number(failed),
        },
      ];
    }),
  );
  const tape = new ModelRecording({
    header: fullHeader,
    drives: Object.fromEntries(ids.map((id) => [id, { [id]: [outcome] }])),
    results,
  });
  setRecordingSuiteVersion(tape, "v1");
  const file = path.join(dir, `planned-${llm ? "haiku" : "jev"}-${number}-${track}-${effort}-${ids.length}.json`);
  fs.writeFileSync(file, tape.serialize());
  return file;
}

const haiku = "llm:claude-haiku-5-5";
const jevRepeats = [1, 2, 3].map((number) => plannedRepeat("jev", number));
const haikuRepeats = [1, 2, 3].map((number) => plannedRepeat(haiku, number));
const unevenRepeats = [...jevRepeats.slice(0, 2), haikuRepeats[0]];
assert.deepEqual(
  JSON.parse(compare(...unevenRepeats)).drivers.map(({ driver, repeats }) => [driver, repeats]),
  [
    ["jev", 2],
    [haiku, 1],
  ],
);
assert.deepEqual(
  JSON.parse(compare("--driver=jev", ...unevenRepeats)).drivers.map(({ driver }) => driver),
  ["jev"],
);
const planned = JSON.parse(compare("--plan", plan, ...jevRepeats, ...haikuRepeats));
assert.equal(planned.drives_per_repeat, 62);
assert.equal(planned.drivers.length, 2);
for (const driver of planned.drivers) {
  assert.equal(driver.repeats, 3);
  assert.deepEqual(driver.flags_per_decision, { min: 0.1, mean: 0.2, max: 0.3 });
  assert.deepEqual(driver.by_drive["door-zone"].failure_reasons, { "red light": 1 });
  assert.deepEqual(driver.runs[1].audited_failures, { "red light": 1 });
  assert.equal(driver.runs[1].audit_totals.red_lights, 1);
  assert.equal(driver.runs[1].decisions, 620);
  assert.equal(driver.runs[1].flagged_choices, 124);
  assert.equal(driver.runs[1].fallbacks, 1);
  assert.equal(driver.runs[1].safety_brakes, 1);
  assert.equal(driver.runs[1].model_share, 0.898);
}
assert.throws(() => compare("--plan", plan, ...jevRepeats), /exactly these drivers/);
assert.throws(
  () => compare("--plan", plan, ...jevRepeats, ...haikuRepeats.slice(1)),
  /repeat plan requires 3 recordings/,
);
assert.throws(
  () => compare("--plan", plan, ...jevRepeats, plannedRepeat(haiku, 1, { effort: "high" }), ...haikuRepeats.slice(1)),
  /needs the model and provider settings declared/,
);
const pinnedPlan = path.join(dir, "pinned-repeat-plan.json");
const planDefinition = JSON.parse(fs.readFileSync(plan, "utf8"));
planDefinition.source_commit = "b".repeat(40);
fs.writeFileSync(pinnedPlan, JSON.stringify(planDefinition));
assert.throws(
  () => compare("--plan", pinnedPlan, ...jevRepeats, ...haikuRepeats),
  /needs the source and engine declared/,
);
const subset = ["door-zone"];
assert.throws(
  () =>
    compare(
      "--plan",
      plan,
      ...["jev", haiku].flatMap((driver) => [1, 2, 3].map((number) => plannedRepeat(driver, number, { ids: subset }))),
    ),
  /must cover the complete v1 arena/,
);
console.log("✓ planned repeats check canonical coverage, driver counts and provider settings");

fs.rmSync(dir, { recursive: true, force: true });
console.log("\nmerge recordings checks passed");
process.exit(0);
