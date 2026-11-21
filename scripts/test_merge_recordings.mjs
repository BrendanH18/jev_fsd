// Arena and seeded benchmark recordings made in parts merge with every drive, answer and result.
// node --experimental-default-type=module scripts/test_merge_recordings.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
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
    results: Object.fromEntries(drives.map((id) => [id, { challenge: id, pass: true, result_sha: id }])),
  });
  const file = path.join(dir, name);
  fs.writeFileSync(file, r.serialize());
  return file;
};
const merge = (...files) =>
  execFileSync(
    process.execPath,
    [
      "--experimental-default-type=module",
      new URL("merge_recordings.mjs", import.meta.url).pathname,
      "--out",
      path.join(dir, "out.json"),
      ...files,
    ],
    { stdio: "pipe" },
  ).toString();

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

const withManifest = (id, map, fingerprint, source_commit = "a".repeat(40)) =>
  write(
    `${id}.json`,
    header([id], {
      maps: { [map]: fingerprint },
      manifest: {
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
const provenance = ModelRecording.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8")).header.manifest;
assert.deepEqual(Object.keys(provenance.suite.drives), ["seven", "eight"]);
assert.deepEqual(Object.keys(provenance.maps), ["kitsilano", "toronto"]);
refused([g, withManifest("nine", "toronto", "bbbb", "b".repeat(40))], /differs.*source/, "another source commit");

const config = { map: "kitsilano", features: "city", count: 2, seed: 1, brain: "jev" };
const benchScenarios = ["s1-1", "s1-2"].map((id) => ({ id, traffic_seed: 42 }));
function benchPart(id, pass, traffic_seed = 42, name = id) {
  const manifest = {
    source_commit: "a".repeat(40),
    source_dirty: false,
    maps: { kitsilano: { fingerprint: "map-sha" } },
    suite: { kind: "bench", only: true, config, ids: [id], route_sha: benchRouteFingerprint(benchScenarios) },
    cost_usd: 0.01,
  };
  const result = { id, arrived: pass, pass, cost_usd: 0.01, wall_ms: 10 };
  const tape = new ModelRecording({
    header: { driver: "jev", brain: "jev", bench: config, map_sha: "map-sha", manifest },
    drives: { [id]: {} },
  });
  tape.keepResult(id, result, { id, traffic_seed });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ manifest, config, results: [result], saved_at: "2026-11-21T08:00:00Z" }));
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
assert.equal(combined.manifest.suite.only, undefined);
assert.deepEqual(combined.manifest.suite.ids, ["s1-1", "s1-2"]);
assert.equal(combined.name, "20261121-080000-jev");
console.log("✓ city parts merge in suite order with failed verdicts kept and duplicate drives refused");

fs.rmSync(dir, { recursive: true, force: true });
console.log("\nmerge recordings checks passed");
process.exit(0);
