// Merge arena model recordings made in parts into one (docs/agents.md). A long model run over the
// challenges goes faster split across processes, each recording its own drives with --only:
//   node --experimental-default-type=module scripts/arena_node.mjs --brain jev --set all --only a,b --record part1.json.gz
//   node --experimental-default-type=module scripts/arena_node.mjs --brain jev --set all --only c,d --record part2.json.gz
//   node --experimental-default-type=module scripts/merge_recordings.mjs --out jev-arena.json.gz part1.json.gz part2.json.gz
// The parts must share the driver, model, endpoint, set, track, engine and prompt version, agree on every
// map they share, and record different drives. The merged recording replays like one made in a single
// run (`arena_node.mjs --replay`); its header keeps the earliest recording time. Use
// merge_bench_recordings.mjs for seeded benchmark recordings.
import { lstatSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  CUSTOM_SUITE,
  LEGACY_SUITE,
  setRecordingSuiteVersion,
  suiteVersion,
} from "../static/js/bench/suite-version.js";
import { canonicalJson, ModelRecording } from "../static/js/brain/recording.js";
import { sameArenaTrack } from "./arena_tape.mjs";
import { arenaSuiteVersion, mergeDefinition } from "./canonical_suite.mjs";
import {
  isArenaSet,
  isDateTime,
  isId,
  isRecord,
  isTrack,
  MAX_RECORDING_BYTES,
  readRecordingJson,
  writeJsonArtifact,
} from "./recording_artifacts.mjs";
import { runCost } from "./run_manifest.mjs";

const usage = "Usage: merge_recordings.mjs [--dry-run] --out merged.json[.gz] part.json[.gz] ...";
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let parsed;
try {
  parsed = parseArgs({
    options: { out: { type: "string" }, help: { type: "boolean", short: "h" }, "dry-run": { type: "boolean" } },
    allowPositionals: true,
    tokens: true,
  });
} catch (error) {
  fail(error.message);
}
const { positionals: parts, values, tokens } = parsed;
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const out = values.out;
if (!out?.trim()) fail(usage);
if (!/\.json(?:\.gz)?$/.test(out)) fail("--out must end in .json or .json.gz.");
if (tokens.filter((token) => token.kind === "option" && token.name === "out").length > 1)
  fail("Specify --out only once.");
if (parts.length < 2) fail("Give at least two recordings to merge.");

const sources = new Set();
let destination;
try {
  if (lstatSync(out, { throwIfNoEntry: false })?.isSymbolicLink())
    fail("The merged output must not be a symbolic link.");
  destination = statSync(out, { throwIfNoEntry: false });
  if (destination && !destination.isFile()) fail("The merged output must name a file.");
} catch (error) {
  fail(error.message);
}
const read = (file) => {
  try {
    const source = statSync(file);
    if (destination?.dev === source.dev && destination.ino === source.ino)
      fail(`The merged output must differ from its input recordings (${file}).`);
    const identity = `${source.dev}:${source.ino}`;
    if (sources.has(identity)) fail(`List each input recording once: ${file}.`);
    sources.add(identity);
    return ModelRecording.parse(readRecordingJson(file));
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
    suite_version: h.suite_version,
    suite_target: h.suite_target ?? null,
    manifest: manifestIdentity(h.manifest),
    set: h.arena?.set,
    track: h.arena?.track ?? "guarded",
  });
recordings.forEach((r, i) => {
  if (!r.header.arena) fail(`${parts[i]} is not an arena recording: only arena recordings merge.`);
  const { arena, maps, manifest, recorded_at } = r.header;
  if (!isArenaSet(arena.set)) fail(`${parts[i]} declares an unknown Arena set.`);
  if (arena.track !== undefined && !isTrack(arena.track)) fail(`${parts[i]} declares an unknown Arena track.`);
  if (!Array.isArray(arena.ids) || !arena.ids.every(isId) || new Set(arena.ids).size !== arena.ids.length)
    fail(`${parts[i]} must declare distinct Arena drive IDs.`);
  if (!isRecord(maps) || !Object.entries(maps).every(([id, sha]) => isId(id) && isId(sha)))
    fail(`${parts[i]} needs valid Arena map fingerprints.`);
  if (!isDateTime(recorded_at)) fail(`${parts[i]} needs a valid recorded_at timestamp.`);
  if (Object.keys(r.scenarios).length) fail(`${parts[i]} contains seeded scenarios in an Arena recording.`);
  if (
    manifest &&
    (manifest.suite?.kind !== "arena" || manifest.suite.set !== arena.set || !isRecord(manifest.suite.drives))
  )
    fail(`${parts[i]} has an invalid Arena manifest suite.`);
  try {
    if (manifest && manifest.cost_usd !== runCost(Object.values(r.results)))
      fail(`${parts[i]} has a manifest cost that differs from its drives.`);
  } catch (error) {
    fail(`${parts[i]}: ${error.message}`);
  }
  if (identity(r.header) !== identity(first))
    fail(`${parts[i]} differs from ${parts[0]} in its source, driver, model, endpoint, engine, prompt, set or track.`);
  if (!Object.keys(r.results).length || Object.keys(r.drives).some((id) => !Object.hasOwn(r.results, id)))
    fail(`${parts[i]} must contain finished drives and keep a result for every set of answers.`);
});

const maps = Object.create(null),
  manifestMaps = Object.create(null),
  manifestDrives = Object.create(null),
  ids = [],
  merged = new ModelRecording({ header: { ...first }, drives: {}, results: {}, scenarios: {} });
recordings.forEach((r, i) => {
  const fingerprints = Object.entries(r.header.maps || {});
  const shardMaps = r.header.manifest?.maps;
  if (r.header.manifest && (!shardMaps || Object.keys(shardMaps).length !== fingerprints.length))
    fail(`${parts[i]} has different maps in the recording and its manifest.`);
  for (const [id, sha] of fingerprints) {
    if (maps[id] && maps[id] !== sha) fail(`${parts[i]} was made on other map data for ${id}.`);
    maps[id] = sha;
    if (shardMaps) {
      const entry = shardMaps[id];
      if (entry?.fingerprint !== sha || (manifestMaps[id] && canonicalJson(manifestMaps[id]) !== canonicalJson(entry)))
        fail(`${parts[i]} has conflicting manifest map data for ${id}.`);
      manifestMaps[id] = entry;
    }
  }
  for (const [id, result] of Object.entries(r.results)) {
    if (id in merged.results) fail(`${id} is recorded in more than one part (${parts[i]}).`);
    if (typeof result.pass !== "boolean") fail(`${parts[i]} has no boolean verdict for ${id}.`);
    if (result.simulation_error) fail(`${parts[i]} has a simulation error on ${id}.`);
    if (result.stopped) fail(`${parts[i]} has a stopped attempt for ${id}.`);
    // (a finished drive keeps its answers, an empty set for one that asked nothing)
    if (!Object.hasOwn(r.drives, id)) fail(`${parts[i]} has a result for ${id} but no answers for it.`);
    if (result.map !== undefined && !Object.hasOwn(r.header.maps, result.map))
      fail(`${parts[i]} has no map fingerprint for drive ${id}.`);
    if (!sameArenaTrack(result, r.header.arena)) fail(`${parts[i]} has a result on a different track for ${id}.`);
    const authored = r.header.manifest?.suite.drives[id];
    if (
      result.challenge !== id ||
      !r.header.arena.ids.includes(id) ||
      (r.header.manifest &&
        (!authored ||
          result.map !== authored.map ||
          result.seed !== authored.seed ||
          (authored.version !== undefined && result.version !== authored.version) ||
          (authored.weather !== undefined && result.weather !== authored.weather) ||
          (authored.time !== undefined && result.time !== authored.time)))
    )
      fail(`${parts[i]} has a result for ${id} that disagrees with its authored drive.`);
    merged.results[id] = result;
    merged.drives[id] = r.drives[id];
    if (authored) manifestDrives[id] = authored;
    ids.push(id);
  }
});
merged.header = {
  ...first,
  recorded_at: recordings.map((r) => r.header.recorded_at).sort((a, b) => Date.parse(a) - Date.parse(b))[0],
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
if (suiteVersion(first) !== LEGACY_SUITE)
  setRecordingSuiteVersion(
    merged,
    // (shards that declare a numbered suite are checked against that definition, not the active one)
    mergeDefinition(first)
      ? arenaSuiteVersion(
          { set: first.arena.set, drives: manifestDrives, maps },
          Object.values(merged.results),
          mergeDefinition(first),
        )
      : CUSTOM_SUITE,
  );
if (values["dry-run"]) {
  console.log(
    JSON.stringify({
      out,
      parts,
      ids,
      maps,
      suite_version: suiteVersion(merged.header),
      cost_usd: merged.header.manifest?.cost_usd ?? null,
    }),
  );
} else {
  try {
    writeJsonArtifact(out, merged.serialize(), MAX_RECORDING_BYTES);
  } catch (error) {
    fail(error.message);
  }
  console.log(`merged ${ids.length} drives from ${parts.length} recordings into ${out}`);
}
