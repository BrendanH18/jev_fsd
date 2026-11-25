import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publishedDrives } from "./driver_comparison.mjs";
import { readArtifactJson } from "./recording_artifacts.mjs";

const dir = mkdtempSync(join(tmpdir(), "jev-outside-driver-"));
const run = (script, ...args) => {
  const run = spawnSync(
    process.execPath,
    ["--experimental-default-type=module", fileURLToPath(new URL(script, import.meta.url)), ...args],
    { encoding: "utf8", timeout: 5000 },
  );
  if (run.error) throw run.error;
  return run;
};
const check = (...args) => run("check_driver.mjs", ...args);
const arena = (...args) => run("arena_node.mjs", ...args);
const latitude = (...args) => run("driver_latitude.mjs", ...args);
const expect = (result, diagnostic) => {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, diagnostic);
};

try {
  const path = join(dir, "new-driver.mjs");
  const label = 'Pilot with "quotes"';
  assert.equal(check("--scaffold", path, "--label", label).status, 0);
  assert.ok(existsSync(path));
  const created = readFileSync(path, "utf8");
  expect(check("--scaffold", path), /EEXIST/);
  assert.equal(readFileSync(path, "utf8"), created);
  expect(check("--scaffold", join(dir, "driver.js")), /end in .mjs/);
  expect(check("--scaffold", join(dir, "a.mjs"), "--id", "Rules"), /local driver id/);
  expect(check("--scaffold", join(dir, "rules.mjs")), /reserved/);
  expect(check("--scaffold", join(dir, "a.mjs"), "--label", "a\nb"), /single line/);
  expect(check("--scaffold", join(dir, "a.mjs"), "--agent", path), /uses only --id and --label/);
  expect(check("--id", "unused", "--agent", path), /require --scaffold/);
  expect(check("--validate"), /requires only --agent/);
  expect(check("--validate", "--agent", path, "--json"), /requires only --agent/);
  const checked = check("--agent", path, "--validate");
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).label, label);
  assert.equal(JSON.parse(checked.stdout).id, "new-driver");

  const { default: starter } = await import(pathToFileURL(path).href);
  const driver = starter.create();
  const candidate = (id, progress_m, flagged = false) => ({ id, flagged, sim: { progress_m } });
  const decide = (candidates) => driver.decide({}, candidates, {}, undefined);
  const brake = candidate("hard_brake", 0);
  assert.equal(await decide([]), null);
  assert.equal((await decide([brake])).motion, "stop");
  assert.equal((await decide([candidate("flagged", 20, true), candidate("clear", 2), brake])).candidateId, "clear");
  assert.equal((await decide([candidate("flagged", 20, true), brake])).candidateId, "hard_brake");
  assert.equal((await decide([candidate("first", 2), candidate("second", 2)])).candidateId, "first");
  assert.equal((await decide([candidate("slow", 2), candidate("fast", 3)])).candidateId, "fast");
  const singleton = join(dir, "singleton.mjs");
  writeFileSync(singleton, 'const shared={decide(){}}; export default {id:"single",label:"Single",create:()=>shared};');
  expect(check("--agent", singleton, "--validate"), /fresh driver instance/);

  expect(check("--agent", path, "--agent", path), /only once/);
  expect(check("--agent", path, "--only", "a,a"), /duplicate items/);
  expect(check("--agent", path, "--timeout", "0"), /decimal whole number/);
  expect(check("--agent", path, "--expect-drives", "nan"), /decimal whole number/);
  expect(check("--agent", path, "--out", "x.txt"), /end in .json/);
  expect(check("--agent", path, "--published", "index.json", "--no-published"), /cannot be used/);

  const basic = arena("--list", "--only", "door-zone");
  assert.equal(basic.status, 0, basic.stderr);
  assert.equal(JSON.parse(basic.stdout).drives[0].seed, undefined);
  const details = arena("--list", "--only", "door-zone", "--details", "--expect-drives", "1");
  assert.equal(details.status, 0, details.stderr);
  assert.equal(Number.isInteger(JSON.parse(details.stdout).drives[0].seed), true);
  assert.equal(typeof JSON.parse(details.stdout).drives[0].time, "string");
  assert.equal(Number.isFinite(JSON.parse(details.stdout).drives[0].limit_s), true);
  expect(arena("--list", "--only", "door-zone", "--expect-drives", "2"), /Expected 2 selected drives, found 1/);
  expect(arena("--list", "--only", "door-zone", "--skip", "door-zone"), /both selected and skipped/);
  expect(arena("--details"), /requires --list/);
  expect(arena("--tape-info"), /uses only --replay/);
  expect(arena("--tape-info", "--replay", path, "--track", "open"), /uses only --replay/);
  expect(arena("--agent", dir), /readable module file/);
  const committed = fileURLToPath(new URL("../data/recordings/jev-open-2026-11-20.json.gz", import.meta.url));
  const info = arena("--tape-info", "--replay", committed);
  assert.equal(info.status, 0, info.stderr);
  assert.equal(JSON.parse(info.stdout).track, "open");
  assert.equal(JSON.parse(info.stdout).planned, 62);
  assert.ok(JSON.parse(info.stdout).answers > 0);

  assert.match(latitude("--help").stdout, /--check/);
  expect(latitude("--every", "Infinity"), /finite positive/);
  expect(latitude("--force", "7", "--horizon", "6"), /must not exceed/);
  expect(latitude("--only", "door-zone,door-zone"), /duplicate items/);
  expect(latitude("--only", "door-zone,"), /empty item/);
  expect(latitude("--limit", "0"), /whole number/);
  expect(latitude("--json", "output.txt"), /end in .json/);
  expect(latitude("--port", "0"), /port must be a decimal integer/);
  expect(latitude("unparsed"), /Unexpected argument/);
  expect(latitude("--every", "1", "--every", "2"), /only once/);

  const current = { map: "kitsilano", id: "door-zone", seed: 2, version: 1, weather: "dry", time: "day" };
  const selected = new Map([["kitsilano/door-zone", current]]);
  const row = { driver: "external", recording: "tape.json.gz", date: "2026-11-11", drives: [current] };
  const candidates = [
    null,
    row,
    { ...row, date: "2026-11-18", mode: "realtime" },
    { ...row, date: "2026-11-24", drives: [{ ...current, seed: 3 }] },
    { ...row, date: "2026-11-26", drives: [{ ...current, weather: "snow" }] },
    { ...row, date: "2026-11-28", drives: [{ ...current, time: "night" }] },
    { ...row, date: 55 },
    { ...row, drives: {} },
    { ...row, drives: [null] },
  ];
  assert.throws(() => publishedDrives({}, "guarded", selected), /rows array/);
  assert.equal(
    publishedDrives({ rows: candidates }, "guarded", selected).get("external").get("kitsilano/door-zone").date,
    "2026-11-11",
  );
  for (const name of ["jev-arena-2026-11-11.json.gz", "jev-open-2026-11-20.json.gz"]) {
    const file = fileURLToPath(new URL(`../data/recordings/${name}`, import.meta.url));
    assert.equal(readArtifactJson(file).header.driver, "jev");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Outside-driver CLI, published conditions and scaffold checks passed.");
