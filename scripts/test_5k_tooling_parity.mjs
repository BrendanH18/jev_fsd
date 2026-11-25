import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./cli_tools.mjs";

const registry = fileURLToPath(new URL("./registry_parity.mjs", import.meta.url));
const parity = fileURLToPath(new URL("./parity_js.mjs", import.meta.url));
const root = fs.mkdtempSync(join(tmpdir(), "jev-parity-"));
const before = join(root, "before");
const after = join(root, "after");
function run(script, status, ...args) {
  const result = spawnSync(process.execPath, ["--experimental-default-type=module", script, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 6000,
  });
  assert.equal(result.status, status, result.error?.message ?? result.stdout + result.stderr);
  return result;
}
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
try {
  assert.match(run(parity, 0, "--help").stdout, /Usage:/);
  assert.match(run(parity, 2, "--kind", "arcs").stderr, /turns or joins/);
  assert.match(run(parity, 2, "--case", "absent").stderr, /Unknown parity case: absent/);
  const backward = JSON.parse(run(parity, 0, "--case", "straight on, ends meet", "--kind", "joins").stdout);
  assert.equal(backward.turns.length, 0);
  assert.equal(backward.joins[0].name, "straight on, ends meet");
  assert.equal(backward.joins[0].polyline.length > 2, true);
  const listing = run(parity, 0, "--list", "--pretty", "--kind", "turns", "--match", "+130");
  assert.equal(JSON.parse(listing.stdout).turns.join("|"), "turn +130 deg|turn +130.01 deg|turn +130.1 deg");
  assert.match(listing.stdout, /\n {2}"turns": \[/);

  const spec = join(root, "fixture.json");
  const lines = {
    name: "turn",
    in: [
      [-1, 0],
      [0, 0],
    ],
    out: [
      [0, 0],
      [1, 0],
    ],
  };
  const fixture = (turn, expected, additions = {}) => {
    write(spec, { turns: [turn], joins: [], ...additions });
    assert.match(run(parity, 2, "--fixture", spec).stderr, expected);
  };
  fixture({ ...lines, name: " " }, /non-empty case name/);
  fixture({ ...lines, in: [[0, 0]] }, /at least two points/);
  fixture(
    {
      ...lines,
      out: [
        [0, 0],
        [1, null],
      ],
    },
    /finite \[x, y\] pair/,
  );
  fixture(
    {
      ...lines,
      in: [
        [0, 0],
        [0, 0],
      ],
    },
    /positive, finite length/,
  );
  fixture(
    {
      ...lines,
      in: [
        [-1, 0],
        [0, 0],
        [0, 0],
      ],
    },
    /no incoming direction/,
  );
  fixture(
    {
      ...lines,
      out: [
        [0, 1],
        [1, 1],
      ],
    },
    /at the same point/,
  );
  fixture({ ...lines, angle_deg: 200 }, /within -180 to 180/);
  fixture({ ...lines, known_difference: true }, /needs an explanation/);
  fixture(lines, /tolerance_m.*non-negative/, { tolerance_m: -1 });
  fixture(lines, /joins must be an array/, { joins: {} });
  fixture(lines, /duplicates another case name/, { turns: [lines, lines] });
  assert.match(run(parity, 2, spec, "--fixture", spec).stderr, /fixture path once/);
  write(spec, null);
  assert.match(run(parity, 2, spec).stderr, /expected a fixture object/);
  write(spec, { turns: [lines], joins: [] });
  assert.equal(JSON.parse(run(parity, 0, spec).stdout).turns[0].name, "turn");

  fs.mkdirSync(before);
  fs.mkdirSync(after);
  const names = ["bare-dry.json", "city-dry.json", "arena-rules.json", "arena-cautious.json", "system-prompt.json"];
  for (const name of names) {
    write(join(before, name), { wall_ms: 1, order: [1, 2], name });
    write(join(after, name), { wall_ms: 2, order: [1, 2], name });
  }
  assert.match(run(registry, 0, "--help").stdout, /Usage:/);
  assert.match(run(registry, 1, "prompt", after, "unexpected").stderr, /Usage:/);
  assert.match(run(registry, 1, "bench", after, "other").stderr, /Choose bare or city/);
  assert.match(run(registry, 1, "arena", after, "other").stderr, /Choose rules or cautious/);
  assert.match(run(registry, 1, "bench", after, "bare", "--port", "99999").stderr, /65535/);
  assert.match(run(registry, 1, "bench", after, "bare", "--hour", "24").stderr, /from 0 up to 24/);
  assert.match(run(registry, 1, "bench", after, "bare", "--timeout", "0").stderr, /decimal whole number/);
  assert.match(run(registry, 1, "compare", before, after, "--expect", "city-snow.json").stderr, /city-snow\.json/);
  assert.match(run(registry, 1, "compare", before, after, "--only", "../city-dry.json").stderr, /bare .json/);
  assert.match(
    run(registry, 1, "compare", before, after, "--only", "city-dry.json", "--expect", "none.json").stderr,
    /Choose --only or --expect/,
  );
  assert.match(run(registry, 0, "compare", before, after).stdout, /city-dry.json: identical/);
  const report = join(root, "diff.json.gz");
  const selected = ["compare", before, after, "--only", "city-dry.json"];
  const strict = run(registry, 1, ...selected, "--strict", "--limit", "1", "--json", report);
  assert.match(strict.stderr, /wall_ms: expected 1, actual 2/);
  assert.equal(readJson(report).strict, true);
  assert.equal(readJson(report).comparisons[0].differences.length, 1);
  assert.match(run(registry, 1, ...selected, "--json", join(after, "city-dry.json")).stderr, /different files/);
  write(join(after, "other.json"), {});
  assert.match(run(registry, 1, "compare", before, after).stderr, /Added after: other.json/);
  fs.unlinkSync(join(after, "arena-rules.json"));
  assert.match(run(registry, 1, "compare", before, after).stderr, /Missing after: arena-rules.json/);
  assert.match(run(registry, 0, ...selected).stdout, /city-dry.json: identical/);
  write(join(after, "city-dry.json"), null);
  assert.match(run(registry, 1, ...selected).stderr, /expected a capture object or array/);

  const baselineOnly = JSON.parse(run(parity, 0, "--list").stdout);
  assert.equal(baselineOnly.turns.includes("turn +130 deg"), true);
  assert.equal(baselineOnly.turns.includes("turn -130 deg"), true);
  assert.equal(baselineOnly.joins.includes("short outgoing lane (2 m) at a right turn"), true);
  const originalTurn = JSON.parse(run(parity, 0, "--case", "turn +90 deg").stdout).turns[0];
  assert.equal(originalTurn.kind, "left");
  assert.equal(originalTurn.npc_allowed, true);
  assert.equal(originalTurn.browser_allowed, true);
  const reverse = JSON.parse(run(parity, 0, "--case", "turn +165 deg").stdout).turns[0];
  assert.equal(reverse.kind, "uturn");
  assert.equal(reverse.npc_allowed, false);
  assert.equal(reverse.browser_allowed, false);
  write(join(after, "city-dry.json"), { order: [2, 1], name: "city-dry.json" });
  assert.match(run(registry, 1, ...selected).stderr, /order\.0: expected 1, actual 2/);
  write(join(after, "city-dry.json"), { order: [1, 2], name: "city-dry.json", latency_p50_ms: 100 });
  assert.match(run(registry, 0, ...selected).stdout, /identical/);
  run(registry, 0, "prompt", after);
  const prompt = readJson(join(after, "system-prompt.json"));
  assert.equal(typeof prompt.guarded, "string");
  assert.equal(typeof prompt.open, "string");

  const scripts = join(root, "scripts");
  fs.mkdirSync(scripts);
  const bench = join(scripts, "bench_node.mjs");
  fs.writeFileSync(
    bench,
    'import { writeFileSync } from "node:fs"; const opts = process.argv.slice(2); writeFileSync(opts.at(-1), JSON.stringify({ opts }));',
  );
  assert.match(
    run(registry, 0, "bench", after, "city", "toronto", "snow", "--hour", "23.5", "--port", "4321").stdout,
    /Captured/,
  );
  const captured = readJson(join(after, "toronto-city-snow-hour-23.5.json")).opts;
  assert.equal(captured[captured.indexOf("--hour") + 1], "23.5");
  assert.equal(captured[captured.indexOf("--port") + 1], "4321");
  fs.writeFileSync(
    bench,
    'import { writeFileSync } from "node:fs"; writeFileSync(process.argv.at(-1), "{}"); process.exitCode = 3;',
  );
  assert.match(run(registry, 1, "bench", after, "city", "toronto", "rain").stderr, /failed \(3\)/);
  assert.equal(fs.existsSync(join(after, "toronto-city-rain.json")), false);
  fs.writeFileSync(bench, "setInterval(() => {}, 1000);");
  assert.match(run(registry, 1, "bench", after, "city", "--timeout", "1").stderr, /timed out after 1 s/);
  assert.equal(
    fs.readdirSync(after).some((name) => name.startsWith(".registry-parity-")),
    false,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
