import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchRouteFingerprint, benchRunName, runCost, runManifest } from "./run_manifest.mjs";

const map = { pack: { pack_version: "6", roads: [], signs: {} } };
const maps = { kitsilano: map };
const fingerprint = "0123456789abcdef";
const fingerprints = { kitsilano: fingerprint };
const config = { brain: "rules", map: "kitsilano", pack: "6" };
const suite = { kind: "bench", config, ids: ["a", "b"], generated_ids: ["a", "b"], route_sha: fingerprint };
const options = { driver: "rules", track: "guarded", maps, fingerprints, suite };
const arena = { kind: "arena", set: "all", drives: { flagger: { map: "kitsilano", seed: 0, version: 1 } } };

const result = runManifest(options);
assert.equal(result.format, "jev-run-manifest/2");
assert.equal(result.suite_version, "custom");
assert.equal(result.driver, "rules");
assert.equal(result.model, null);
assert.equal(result.prompt_hash, null);
assert.equal(result.cost_usd, 0);
assert.equal(result.engine, `node ${process.version}`);
assert.equal(result.engine_version, process.versions.v8);
assert.match(result.source_commit, /^[a-f0-9]{40}$/);
assert.equal(typeof result.source_dirty, "boolean");
assert.equal(result.maps.kitsilano.pack_version, "6");
assert.equal(result.maps.kitsilano.fingerprint, fingerprint);
assert.equal(Object.keys(result.maps.kitsilano.components).join(","), "pack_version,roads,signs");
assert.match(result.maps.kitsilano.components.roads, /^[a-f0-9]{16}$/);
const inferred = runManifest({ ...options, fingerprints: {} });
assert.equal(inferred.maps.kitsilano.fingerprint, benchRouteFingerprint(map.pack));
assert.equal(inferred.maps.kitsilano.components.roads, benchRouteFingerprint([]));
assert.equal(runManifest({ ...options, suite: { ...suite, only: true, ids: ["b"] } }).suite.ids[0], "b");
const open = runManifest({ ...options, track: "open", suite: { ...suite, config: { ...config, track: "open" } } });
assert.equal(open.track, "open");
const local = runManifest({ ...options, driver: "starter", local: true, suite: arena });
assert.match(local.prompt_hash, /^[a-f0-9]{16}$/);
assert.equal(local.model, null);
const llm = { ...options, driver: "llm:example", model: "example-v1", suite: arena };
assert.notEqual(runManifest(llm).prompt_hash, runManifest({ ...llm, track: "open" }).prompt_hash);
assert.equal(runManifest(llm).model, "example-v1");

for (const [changes, error] of [
  [{ driver: " " }, /driver ID/],
  [{ model: false }, /nonempty ID/],
  [{ model: "surprise" }, /cannot declare a model ID/],
  [{ track: "custom" }, /track must be/],
  [{ local: "false" }, /local flag must be/],
  [{ local: true, driver: "jev" }, /cannot declare model provenance/],
  [{ local: true }, /support arena suites/],
  [{ maps: {} }, /needs map data/],
  [{ maps: { kitsilano: { pack: {} } } }, /pack object/],
  [{ maps: { kitsilano: { pack: { pack_version: true } } } }, /invalid pack version/],
  [{ maps: { kitsilano: { pack: { pack_version: "4" } } } }, /pack version disagrees/],
  [{ fingerprints: [] }, /fingerprints must be an object/],
  [{ fingerprints: { ottawa: fingerprint } }, /unknown map ottawa/],
  [{ fingerprints: { kitsilano: "short" } }, /Invalid fingerprint/],
  [{ suite: null }, /suite must be an object/],
  [{ suite: { kind: "other" } }, /kind must be/],
  [{ suite: { ...suite, config: [] } }, /config object/],
  [{ suite: { ...suite, config: { ...config, brain: "other" } } }, /config driver disagrees/],
  [{ suite: { ...suite, config: { ...config, track: "open" } } }, /config track disagrees/],
  [{ suite: { ...suite, config: { ...config, map: "ottawa" } } }, /configured map/],
  [{ suite: { ...suite, ids: ["a", "a"] } }, /unique route IDs/],
  [{ suite: { ...suite, generated_ids: ["a", "a"] } }, /unique generated route IDs/],
  [{ suite: { ...suite, route_sha: false } }, /route fingerprint/],
  [{ suite: { ...suite, only: "yes" } }, /only must be a boolean/],
  [{ suite: { ...suite, ids: ["b", "a"] } }, /generated order/],
  [{ suite: { ...suite, ids: ["c"], only: true } }, /generated order/],
  [{ suite: { ...suite, ids: ["b"] } }, /every generated route/],
  [{ suite: { ...arena, set: "" } }, /set name/],
  [{ suite: { ...arena, drives: {} } }, /authored drives/],
  [{ suite: { ...arena, drives: { invalid: null } } }, /Invalid arena drive/],
  [{ suite: { ...arena, drives: { a: { map: "other" } } } }, /unknown map/],
  [{ suite: { ...arena, drives: { a: { map: "kitsilano", seed: -1 } } } }, /invalid seed/],
  [{ suite: { ...arena, drives: { a: { map: "kitsilano", seed: 0, version: 0 } } } }, /invalid version/],
]) {
  assert.throws(() => runManifest({ ...options, ...changes }), error);
}
assert.throws(() => runManifest(null), /options must be an object/);
assert.throws(() => runCost({}), /results array/);
assert.throws(() => runCost([null]), /result 1 must be an object/);
assert.throws(() => runCost([{ id: "a", cost_usd: -0.1 }]), /Drive a cost/);
assert.throws(() => runCost([{ challenge: "flagger", cost_usd: Number.NaN }]), /Drive flagger cost/);
assert.throws(() => runCost([{ cost_usd: 2 ** 53 }]), /supported range/);
assert.equal(runCost([]), 0);
assert.equal(runCost([{ cost_usd: null }, {}]), 0);
assert.equal(runCost([{ cost_usd: 0.0000005 }]), 0.000001);
assert.equal(runCost([{ cost_usd: 0.0000003 }, { cost_usd: 0.0000003 }]), 0.000001);
assert.equal(benchRunName("2026-11-22T10:11:12.345Z", "llm:my-driver"), "20261122-101112-llmmydriver");
assert.throws(() => benchRunName("yesterday", "rules"), /ISO timestamp/);
assert.throws(() => benchRunName("2026-11-22T10:11:12Z", "*"), /alphanumeric driver ID/);
assert.equal(benchRouteFingerprint([{ b: 2, a: 1 }]), benchRouteFingerprint([{ a: 1, b: 2 }]));
assert.notEqual(benchRouteFingerprint([{ id: "a" }, { id: "b" }]), benchRouteFingerprint([{ id: "b" }, { id: "a" }]));
const repository = mkdtempSync(join(tmpdir(), "jev-manifest-source-"));
const gitDir = process.env.GIT_DIR;
const workTree = process.env.GIT_WORK_TREE;
try {
  process.env.GIT_DIR = join(repository, ".git");
  process.env.GIT_WORK_TREE = repository;
  const git = (...args) =>
    execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init");
  assert.equal(runManifest(options).source_commit, null);
  assert.equal(runManifest(options).source_dirty, true);
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "Test",
  );
  git("config", "status.showUntrackedFiles", "no");
  assert.equal(runManifest(options).source_commit, git("rev-parse", "HEAD").trim());
  assert.equal(runManifest(options).source_dirty, false);
  writeFileSync(join(repository, "untracked.txt"), "not committed");
  assert.equal(runManifest(options).source_dirty, true);
} finally {
  if (gitDir === undefined) delete process.env.GIT_DIR;
  else process.env.GIT_DIR = gitDir;
  if (workTree === undefined) delete process.env.GIT_WORK_TREE;
  else process.env.GIT_WORK_TREE = workTree;
  rmSync(repository, { recursive: true, force: true });
}
console.log("Run manifest checks passed.");
