// Merge arena model recordings made in parts into one (docs/agents.md). A long model run over the
// challenges goes faster split across processes, each recording its own drives with --only:
//   node --experimental-default-type=module scripts/arena_node.mjs --brain jev --set all --only a,b --record part1.json.gz
//   node --experimental-default-type=module scripts/arena_node.mjs --brain jev --set all --only c,d --record part2.json.gz
//   node --experimental-default-type=module scripts/merge_recordings.mjs --out jev-arena.json.gz part1.json.gz part2.json.gz
// The parts must share the driver, model, endpoint, set, track, engine and prompt version, agree on every
// map they share, and record different drives. The merged recording replays like one made in a single
// run (`arena_node.mjs --replay`); its header keeps the earliest recording time. Seeded benchmark
// recordings are not merged: a bench run's drives depend on one suite.
import fs from "node:fs";
import zlib from "node:zlib";

const argv = process.argv.slice(2);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const outAt = argv.indexOf("--out");
if (outAt < 0 || !argv[outAt + 1]) fail("Usage: merge_recordings.mjs --out merged.json[.gz] part.json[.gz] ...");
const out = argv[outAt + 1];
const parts = argv.filter((_, i) => i !== outAt && i !== outAt + 1);
if (parts.length < 2) fail("Give at least two recordings to merge.");

const { ModelRecording, canonicalJson } = await import("../static/js/brain/recording.js");
const { runCost } = await import("./run_manifest.mjs");
const read = (file) => {
  try {
    const raw = fs.readFileSync(file);
    return ModelRecording.parse(file.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8"));
  } catch (error) {
    fail(`Cannot read the recording ${file}: ${error.message}`);
  }
};
const recordings = parts.map(read);
const first = recordings[0].header;
const manifestIdentity = (manifest) => {
  if (!manifest) return null;
  const { suite, maps: _maps, cost_usd: _cost, ...identity } = manifest;
  return { ...identity, suite: { kind: suite.kind, set: suite.set } };
};
// (what must agree: who drove, through what, on which drives' set and track, with which prompt and engine)
const identity = (h) =>
  canonicalJson({
    driver: h.driver,
    kind: h.kind,
    model: h.model,
    endpoint: h.endpoint ?? null,
    engine: h.engine,
    versions: h.versions,
    manifest: manifestIdentity(h.manifest),
    set: h.arena?.set,
    track: h.arena?.track ?? null,
  });
recordings.forEach((r, i) => {
  if (!r.header.arena) fail(`${parts[i]} is not an arena recording: only arena recordings merge.`);
  if (identity(r.header) !== identity(first))
    fail(`${parts[i]} differs from ${parts[0]} in its source, driver, model, endpoint, engine, prompt, set or track.`);
});

const maps = {},
  manifestMaps = {},
  manifestDrives = {},
  ids = [],
  merged = new ModelRecording({ header: { ...first }, drives: {}, results: {}, scenarios: {} });
recordings.forEach((r, i) => {
  for (const [id, sha] of Object.entries(r.header.maps || {})) {
    if (maps[id] && maps[id] !== sha) fail(`${parts[i]} was made on other map data for ${id}.`);
    maps[id] = sha;
  }
  if (r.header.manifest) Object.assign(manifestMaps, r.header.manifest.maps);
  for (const id of Object.keys(r.results)) {
    if (id in merged.results) fail(`${id} is recorded in more than one part (${parts[i]}).`);
    // (a finished drive keeps its answers, an empty set for one that asked nothing)
    if (!Object.hasOwn(r.drives, id)) fail(`${parts[i]} has a result for ${id} but no answers for it.`);
    merged.results[id] = r.results[id];
    merged.drives[id] = r.drives[id];
    if (r.header.manifest) manifestDrives[id] = r.header.manifest.suite.drives[id];
    ids.push(id);
  }
});
merged.header = {
  ...first,
  recorded_at: recordings.map((r) => r.header.recorded_at).sort()[0],
  arena: { ...first.arena, ids },
  maps,
};
if (first.manifest)
  merged.header.manifest = {
    ...first.manifest,
    suite: { ...first.manifest.suite, drives: manifestDrives },
    maps: manifestMaps,
    cost_usd: runCost(Object.values(merged.results)),
  };
const text = merged.serialize();
// (written beside the destination and renamed over it, so a failed write leaves an existing file as it was)
const tmp = `${out}.tmp`;
fs.writeFileSync(tmp, out.endsWith(".gz") ? zlib.gzipSync(text, { level: 9 }) : text);
fs.renameSync(tmp, out);
console.log(`merged ${ids.length} drives from ${parts.length} recordings into ${out}`);
