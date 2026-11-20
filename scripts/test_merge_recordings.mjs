// scripts/merge_recordings.mjs: arena recordings made in parts merge into one that holds every part's
// drives, answers and results, and parts that disagree, or record a drive twice, are refused.
// node --experimental-default-type=module scripts/test_merge_recordings.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
globalThis.document = { querySelector: () => null };
const { ModelRecording } = await import("../static/js/brain/recording.js");

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
fs.rmSync(dir, { recursive: true, force: true });
console.log("\nmerge recordings checks passed");
process.exit(0);
