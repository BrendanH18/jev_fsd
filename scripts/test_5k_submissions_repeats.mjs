import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import suite from "../data/suites/v1.json" with { type: "json" };
import { readArtifactJson } from "./recording_artifacts.mjs";

const dir = mkdtempSync(join(tmpdir(), "jev-repeat-plan-"));
const cli = fileURLToPath(new URL("./compare_repeats.mjs", import.meta.url));
const compare = (...args) => {
  const result = spawnSync(process.execPath, ["--experimental-default-type=module", cli, ...args], { encoding: "utf8", timeout: 5000 });
  if (result.error) throw result.error;
  return result;
};
const expect = (result, diagnostic) => {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, diagnostic);
};
const save = (name, data) => {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data));
  return file;
};
const driver = "llm:fixture";
const manifest = {
  format: "jev-run-manifest/2", source_commit: "b".repeat(40), source_dirty: false,
  engine: "node v22.23.5", engine_version: "12.4", driver, track: "open", suite_version: "v1", cost_usd: 0,
};
const plan = { format: "jev-arena-repeat-plan/1", suite_version: "v1", track: "open",
  engine: manifest.engine, repeats_per_driver: 2, drivers: { [driver]: { model: "test", provider_url: "https://example.net/v1", effort: "low" } } };
const makeRepeat = (n) => ({
  format: "jev-model-recording/1",
  header: { driver, kind: "llm", engine: manifest.engine, suite_version: "v1", recorded_at: `2026-11-21T0${n}:00:00Z`,
    manifest: structuredClone(manifest), arena: { set: "all", track: "open", ids: Object.keys(suite.arena.drives) }, maps: { ...suite.maps } },
  results: Object.fromEntries(Object.entries(suite.arena.drives).map(([challenge, conditions], index) =>
    [challenge, { challenge, ...conditions, suite_version: "v1", mode: "lockstep", track: "open",
      pass: true, failures: [], decisions: 10, flagged_choices: index === 0 ? n : 0, input_tokens: n,
      output_tokens: n * 2, model_decisions: 4, partial_decisions: n, local_decisions: 6,
      fallbacks: index === 0 ? n - 1 : 0, safety_brakes: index === 0 ? n : 0 }],
  )),
  drives: Object.fromEntries(Object.keys(suite.arena.drives).map((id) => [id, { key: [{ response: {
    meta: { model: "test" }, trace: { request: { url: "https://example.net/v1", output_config: { effort: "low" } } },
  } }] }])),
});

try {
  const savedPlan = save("plan", plan);
  const shown = compare("--show-plan", "--plan", savedPlan);
  assert.equal(shown.status, 0, shown.stderr);
  const displayed = JSON.parse(shown.stdout);
  assert.equal(displayed.recordings, 2);
  assert.equal(displayed.drives_per_recording, 62);
  assert.equal(displayed.total_drives, 124);
  assert.equal(displayed.ids[0], "door-zone");
  expect(compare("--show-plan"), /requires only --plan FILE/);
  expect(compare("--show-plan", "--plan", savedPlan, "--driver", driver), /requires only --plan FILE/);

  for (const [candidate, diagnostic] of [
    [{ ...plan, engine: "node ?" }, /invalid arena repeat plan/],
    [{ ...plan, engine_version: [] }, /invalid arena repeat plan/],
    [{ ...plan, suite_version: ["v1"] }, /invalid arena repeat plan/],
    [{ ...plan, drivers: { "llm:": {} } }, /invalid settings/],
    [{ ...plan, drivers: { jev: { effort: "low" } } }, /require an LLM driver/],
    [{ ...plan, drivers: { [driver]: { provider_url: "file:///tmp/a" } } }, /invalid provider URL/],
    [{ ...plan, drivers: { [driver]: { provider_url: "https://secret@example.net" } } }, /invalid provider URL/],
    [{ ...plan, drivers: { [driver]: { provider_url: "https://example.net/#xx" } } }, /invalid provider URL/],
    [{ ...plan, drivers: { [driver]: { model: " test " } } }, /invalid settings/],
  ]) {
    expect(compare("--show-plan", "--plan", save("bad-plan", candidate)), diagnostic);
  }
  const first = save("repeat-a", makeRepeat(1));
  const second = save("repeat-b", makeRepeat(2));
  const aliases = join(dir, "alias.json");
  linkSync(first, aliases);
  expect(compare(first, aliases), /List each recording once/);
  expect(compare("--driver", "", first, second), /driver ID/);
  expect(compare("--json", "text.txt", first, second), /must end/);
  expect(compare("--plan", save("pinned", { ...plan, engine_version: "12.5" }), first, second), /V8 version declared/);
  const output = join(dir, "results.json.gz");
  const saved = compare("--plan", savedPlan, "--json", output, first, second);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stdout, "");
  const result = readArtifactJson(output).drivers[0];
  assert.equal(result.runs[1].recorded_at, "2026-11-21T02:00:00Z");
  assert.equal(result.input_tokens.mean, 93);
  assert.equal(result.output_tokens.max, 248);
  assert.equal(result.partial_decisions.mean, 93);
  assert.equal(result.local_decisions.min, 372);
  assert.equal(result.by_drive["door-zone"].safety_brakes.min, 1);
  assert.equal(result.by_drive["door-zone"].fallbacks.max, 1);
  assert.equal(result.by_drive["door-zone"].flagged_choices.mean, 1.5);
  expect(compare("--json", output, first, second), /EEXIST/);

  const id = "door-zone";
  for (const [mutate, diagnostic] of [
    [(r) => { r.header.arena.set = "bad"; }, /unknown Arena set/],
    [(r) => { r.header.recorded_at = null; }, /invalid recorded_at/],
    [(r) => { r.scenarios = { a: {} }; }, /seeded scenarios/],
    [(r) => { r.results[id].failures = [" "]; }, /invalid challenge result/],
    [(r) => { r.results[id].flagged_choices = 11; }, /more flagged choices/],
    [(r) => { r.results[id].partial_decisions = 5; }, /more partial decisions/],
    [(r) => { r.results[id].input_tokens = -1; }, /invalid input_tokens count/],
    [(r) => { r.results[id].decisions = "10"; }, /invalid decisions count/],
    [(r) => { r.results[id].off_road_s = -0.2; }, /invalid off_road_s measurement/],
    [(r) => { r.results[id].time_s = "slow"; }, /invalid time_s measurement/],
    [(r) => { r.results[id].simulation_error = "test"; }, /ended with a simulation error/],
    [(r) => { r.header.manifest.cost_usd = 0.01; }, /manifest cost/],
    [(r) => { r.header.manifest.maps = { kitsilano: { fingerprint: "?" } }; }, /manifest map fingerprint/],
    [(r) => { r.drives[id].key[0].response.meta.model = 1; }, /invalid answer model/],
    [(r) => { r.drives[id].key[0].response.trace.request = []; }, /invalid provider request trace/],
  ]) {
    const broken = makeRepeat(2);
    mutate(broken);
    expect(compare(first, save("bad-repeat", broken)), diagnostic);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Offline repeat plan validation, measurement checks and JSON output passed.");
