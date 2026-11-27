// The leaderboard (ROADMAP 2.7): the page's arrangement of data/results.json (static/js/lab/results.js)
// agrees with the README's generated results table, cell for cell, and every challenge it links to
// exists. The file itself is checked against the committed records by tests/test_results.py.
// node --experimental-default-type=module scripts/test_results_page.mjs   (no server, no network)
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const {
  checkResults,
  summary,
  challengeMatrix,
  compatibleChallengeDrive,
  cityGrid,
  driverDisplayName,
  recordings,
  fractionText,
  percentText,
  moneyText,
  WEATHERS,
  RESULTS_FORMAT,
  resultVersions,
  suiteLabel,
  selectedSuite,
  defaultSuite,
  matchesCoverage,
  fraction,
} = await import("../static/js/lab/results.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");

const data = checkResults(JSON.parse(fs.readFileSync(new URL("../data/results.json", import.meta.url), "utf8")));
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
// (the legacy tables alone: a suite's own table may follow them, README order as on the leaderboard)
const legacyAt = readme.indexOf("### Legacy results");
const legacyEnd = [readme.indexOf("\n### ", legacyAt + 1), readme.indexOf("<!-- results:end -->")].filter(
  (i) => i > legacyAt,
);
const block = readme.slice(legacyAt, Math.min(...legacyEnd));
// README rows: | Driver | Model | challenges | open track | Kitsilano weathers | other maps | own decisions | cost |
const readmeRows = block
  .split("\n")
  .filter((l) => l.startsWith("| ") && !l.startsWith("| Driver"))
  .map((l) => l.split(" | ").map((c) => c.replace(/^\| |\s\|$/g, "").trim()));
let checks = 0;
const test = (name, fn) => {
  fn();
  checks++;
  console.log(`✓ ${name}`);
};

test("the page's summary has the README's drivers, in order", () => {
  const { drivers } = summary(data);
  assert.deepEqual(
    drivers.map((d) => d.label),
    readmeRows.map((r) => r[0]),
  );
});

test("every summary cell matches the README table", () => {
  const { drivers } = summary(data);
  drivers.forEach((d, i) => {
    const row = readmeRows[i];
    assert.ok(row[2].includes(fractionText(d.challenges)), `${d.label} challenges`);
    assert.ok(row[3].includes(fractionText(d.open)), `${d.label} open track`);
    const home = Object.values(d.home).some(Boolean)
      ? WEATHERS.map((w) => (d.home[w] ? fractionText(d.home[w]) : "–")).join(" · ")
      : "not run";
    assert.equal(row[4], home, `${d.label} Kitsilano`);
    assert.equal(row[5], fractionText(d.others), `${d.label} other maps`);
    assert.equal(
      row[6],
      d.challenges && d.challenges.model_share !== undefined ? percentText(d.share) : "n/a",
      `${d.label} own decisions`,
    );
    assert.equal(row[7], d.costTrack ? `${moneyText(d.cost)} (open track)` : moneyText(d.cost), `${d.label} cost`);
  });
});

test("pilots are the drivers without a full run", () => {
  const { pilots } = summary(data);
  assert.deepEqual(pilots.map((p) => p.id).sort(), ["decision:liquid-d1", "llm:granite", "llm:luna"]);
  for (const p of pilots) assert.ok(block.includes(`${p.label} (\`${p.model}\`) ${p.passed}/${p.total}`), p.id);
});

test("the challenge matrix covers every challenge and road test once", () => {
  const matrix = challengeMatrix(data);
  const known = new Set([...CHALLENGES, ...ROAD_TESTS].map((c) => c.id));
  assert.equal(matrix.rows.length, CHALLENGES.length + ROAD_TESTS.length);
  for (const row of matrix.rows) assert.ok(known.has(row.id), row.id);
  assert.deepEqual(matrix.drivers, ["rules", "cautious", "jev", "llm:claude-haiku-5-5", "llm:deepseek"]);
  const failed = (m) =>
    m.rows.flatMap((r) => r.cells.map((c, i) => (c && !c.pass ? `${m.drivers[i]} ${r.id}` : null))).filter(Boolean);
  assert.deepEqual(failed(matrix).sort(), ["llm:claude-haiku-5-5 on-your-bumper", "llm:deepseek double-parked"]);
  // (and the same set on the open track: brain/tracks.js)
  const open = challengeMatrix(data, "open");
  assert.equal(open.rows.length, CHALLENGES.length + ROAD_TESTS.length);
  assert.deepEqual(open.drivers, ["rules", "cautious", "jev", "llm:claude-haiku-5-5"]);
  assert.deepEqual(failed(open), ["llm:claude-haiku-5-5 flagger"]);
});

test("the city grid has one row per map and weather, Kitsilano first", () => {
  const grid = cityGrid(data);
  assert.equal(grid.rows.length, 4 + 11);
  assert.deepEqual(
    grid.rows.slice(0, 4).map((r) => `${r.map} ${r.weather}`),
    WEATHERS.map((w) => `kitsilano ${w}`),
  );
  assert.deepEqual(grid.drivers, ["rules", "cautious", "jev", "llm:claude-haiku-5-5"]);
  const [kitsilanoDry, ...rest] = grid.rows;
  assert.ok(kitsilanoDry.cells.every((cell) => cell.total === 12));
  for (const cell of kitsilanoDry.cells.slice(2)) {
    assert.ok(cell.recording && cell.model && cell.cost_usd > 0 && cell.model_share > 0);
  }
  assert.deepEqual(
    kitsilanoDry.cells.slice(2).map((cell) => cell.fallbacks),
    [0, 18],
  );
  for (const row of rest) assert.equal(row.cells.filter(Boolean).length, 2, `${row.map} ${row.weather}`);
});

test("the matrix keeps the newest full run per driver on each track", () => {
  const rules = data.rows.find((r) => r.suite === "challenges" && r.driver === "rules");
  const older = { ...rules, date: "2026-01-01", drives: [] };
  const matrix = challengeMatrix({ ...data, rows: [...data.rows, older] });
  assert.equal(
    matrix.runs.find((r) => r.driver === "rules"),
    rules,
  );
  assert.equal(matrix.drivers.filter((id) => id === "rules").length, 1);
});

test("submissions keep their attribution without replacing a built-in run", () => {
  const published = data.rows.find((r) => r.suite === "challenges" && r.driver === "jev");
  const id = "submission:outside-team:jev";
  const submission = { ...published, driver: id, submitter: "outside-team", suite_version: "v1" };
  const mixed = {
    ...data,
    drivers: { ...data.drivers, [id]: { label: "Jev", submitter: "outside-team" } },
    rows: [submission, ...data.rows],
  };
  assert.equal(driverDisplayName(mixed, "jev"), "Jev");
  assert.equal(driverDisplayName(mixed, id), "Jev (submitted by @outside-team)");
  assert.ok(challengeMatrix(mixed, "challenges", "v1").drivers.includes(id));
  assert.equal(
    challengeMatrix(mixed).runs.find((r) => r.driver === "jev"),
    published,
  );
});

test("manual comparison finds the newest guarded drive with the same map data and challenge version", () => {
  const rules = data.rows.find((r) => r.suite === "challenges" && r.driver === "rules");
  const match = rules.drives.find((d) => d.id === "road-test-kitsilano");
  assert.ok(match.map_sha && match.score_inputs);
  const config = { ...match, challenge: match.id };
  const changedMap = { ...rules, drives: [{ ...match, map_sha: "changed", time_s: 0 }] };
  const changedVersion = { ...rules, drives: [{ ...match, version: match.version + 1, time_s: 0 }] };
  const open = { ...rules, suite: "open", drives: [{ ...match, time_s: 0 }] };
  const custom = { ...rules, suite_version: "custom", drives: [{ ...match, time_s: 0 }] };
  const history = { rows: [changedMap, changedVersion, open, custom, rules] };
  assert.deepEqual(compatibleChallengeDrive(history, "rules", config), { ...match, failures: [] });
  assert.equal(compatibleChallengeDrive(history, "rules", { ...config, map_sha: "unknown" }), null);
  assert.equal(compatibleChallengeDrive(history, "rules", { ...config, map_sha: undefined }), null);
});

test("each leaderboard cohort selects its own newest runs", () => {
  const challenges = data.rows.find((r) => r.driver === "rules" && r.suite === "challenges");
  const city = data.rows.find((r) => r.driver === "rules" && r.suite === "city");
  const v1 = [challenges, city].map((r) => ({ ...r, suite_version: "v1", passed: 0 }));
  const mixed = { ...data, rows: [...v1, { ...challenges, suite_version: "custom" }, ...data.rows] };
  assert.equal(summary(mixed, "v1").drivers.length, 1);
  assert.equal(summary(mixed).drivers[0].challenges.passed, challenges.passed);
  assert.deepEqual(challengeMatrix(mixed, "challenges", "v1").runs, [v1[0]]);
  assert.deepEqual(cityGrid(mixed, "v1").rows[0].cells, [v1[1]]);
  assert.deepEqual(challengeMatrix(mixed, "challenges", "custom").runs, []);
});

test("every recording offered for replay is committed", () => {
  const list = recordings(data);
  assert.equal(list.length, 11);
  for (const r of list) {
    assert.ok(fs.existsSync(new URL(`../${r.recording}`, import.meta.url)), r.recording);
    const row = data.rows.find((row) => row.recording === r.recording);
    const runner = row.map ? "bench_node" : "arena_node";
    assert.ok(r.command.includes(`scripts/${runner}.mjs --port 8322 --replay ${r.recording}`));
    assert.equal(r.command.endsWith(" --check replay"), !row.replay_source_commit);
    assert.equal(r.sourceCommit, row.manifest?.source_commit ?? row.replay_source_commit);
    assert.equal(r.engine, row.manifest?.engine || row.engine);
  }
});

test("replay instructions for manifest arena recordings pin the source and check fidelity", () => {
  const [arena] = recordings({
    rows: [
      { driver: "jev", recording: "data/recordings/jev-arena.json.gz", manifest: { source_commit: "a".repeat(40) } },
    ],
  });
  assert.equal(arena.sourceCommit, "a".repeat(40));
  assert.equal(arena.legacyReplay, false);
  assert.ok(arena.command.endsWith("jev-arena.json.gz --check replay"));
});

test("replay instructions for a city recording use the benchmark runner", () => {
  const [city] = recordings({
    rows: [{ driver: "jev", map: "kitsilano", recording: "data/recordings/jev-city.json.gz" }],
  });
  assert.ok(
    city.command.includes(
      "scripts/bench_node.mjs --port 8322 --replay data/recordings/jev-city.json.gz --check replay",
    ),
  );
});

test("formatting agrees with scripts/build_results.py", () => {
  assert.equal(percentText(0.9995), "99.95%");
  assert.equal(percentText(1), "100%");
  assert.equal(percentText(0.991), "99.1%");
  assert.equal(moneyText(2.552419), "$2.55");
  assert.equal(moneyText(0), "$0");
  assert.throws(() => checkResults({ rows: [] }));
});

// Lab validation additions
test("Reject a results file whose driver catalog is a list or scalar", () => {
  for (const drivers of [[], 1, "driver", true]) {
    assert.throws(() => checkResults({ format: RESULTS_FORMAT, rows: [], drivers }), /Not a results file/);
  }
});
test("Label unknown driver IDs literally even when they are inherited object keys", () => {
  assert.equal(
    driverDisplayName({ drivers: { __proto__: { constructor: { label: "Wrong" } } } }, "constructor"),
    "constructor",
  );
});
test("Select an available leaderboard suite by its shareable URL value", () => {
  assert.equal(selectedSuite(["v2", "v1", "legacy"], "v1"), "v1");
  assert.equal(selectedSuite(["v2", "v1", "legacy"], "v3"), "v2");
  assert.equal(selectedSuite([], null), "legacy");
  assert.equal(selectedSuite(["v2", "legacy"], null, "legacy"), "legacy");
  assert.equal(selectedSuite(["v2", "legacy"], "v2", "legacy"), "v2");
});
test("Open the leaderboard on the newest suite a model has a result in", () => {
  const drivers = { rules: { kind: "rules" }, cautious: { kind: "agent" }, jev: { kind: "jev" } };
  const row = (driver, suite_version) => ({ driver, suite_version });
  // a new suite with only the built-in drivers' runs: the models' results are still the legacy ones
  const fresh = { drivers, rows: [row("rules", "v2"), row("cautious", "v2"), row("rules", "custom"), row("jev")] };
  assert.deepEqual(resultVersions(fresh), ["v2", "legacy", "custom"]);
  assert.equal(defaultSuite(fresh), "legacy");
  assert.equal(selectedSuite(resultVersions(fresh), null, defaultSuite(fresh)), "legacy");
  assert.equal(selectedSuite(resultVersions(fresh), "v2", defaultSuite(fresh)), "v2");
  // once a model is published on it, the newest suite
  assert.equal(defaultSuite({ drivers, rows: [...fresh.rows, row("jev", "v2")] }), "v2");
  assert.equal(defaultSuite({ drivers, rows: [row("jev", "v1"), row("rules", "v2"), row("jev")] }), "v1");
  // nothing from a model anywhere: the newest numbered suite; custom runs are never the default
  assert.equal(defaultSuite({ drivers, rows: [row("rules", "v2"), row("rules")] }), "v2");
  assert.equal(defaultSuite({ drivers, rows: [row("jev", "custom"), row("rules", "v2")] }), "v2");
  assert.equal(defaultSuite({ drivers, rows: [row("rules", "custom")] }), "custom");
  assert.equal(defaultSuite({ drivers, rows: [] }), undefined);
  // an unknown driver id is not taken for a model (nor an inherited key for a driver)
  assert.equal(defaultSuite({ drivers, rows: [row("constructor", "v2"), row("jev")] }), "legacy");
  // the published results today
  assert.equal(defaultSuite(data), "legacy");
});
test("Filter leaderboard rows by whether every driver has a result", () => {
  const pass = { pass: true },
    fail = { pass: false };
  assert.equal(matchesCoverage([pass, fail], "complete"), true);
  assert.equal(matchesCoverage([pass, null], "complete"), false);
  assert.equal(matchesCoverage([fail, null], "missing"), true);
  assert.equal(matchesCoverage([null, fail], ""), true);
});
test("Sort unknown maps and weather after the catalogued conditions", () => {
  const rows = [
    ["new-b", "dry"],
    ["kitsilano", "other"],
    ["new-a", "dry"],
    ["kitsilano", "snow"],
  ].map(([map, weather]) => ({ map, weather, driver: "rules", suite: "city" }));
  assert.deepEqual(
    cityGrid({ rows, maps: { kitsilano: "Kitsilano" } }).rows.map(({ map, weather }) => [map, weather]),
    [
      ["kitsilano", "snow"],
      ["kitsilano", "other"],
      ["new-a", "dry"],
      ["new-b", "dry"],
    ],
  );
});
test("Quote recording paths with spaces and apostrophes in copyable shell commands", () => {
  const [item] = recordings({ rows: [{ recording: "data/recordings/A driver's run.json.gz" }] });
  assert.ok(item.command.endsWith("'data/recordings/A driver'\\''s run.json.gz' --check replay"));
});
test("Show unavailable model decision share when a measurement is nonnumeric", () => {
  for (const value of [Infinity, NaN, "0.5"]) assert.equal(percentText(value), "n/a");
});
test("Leave missing leaderboard challenge results blank and keep the other drivers aligned", () => {
  const rows = [
    { suite: "challenges", driver: "rules", drives: [{ id: "first", map: "kitsilano", pass: true }] },
    {
      suite: "challenges",
      driver: "cautious",
      drives: [{ id: "second", map: "edmonton", pass: false }],
      failed: [{ id: "second", failures: ["collision"] }],
    },
  ];
  const matrix = challengeMatrix({ rows });
  assert.deepEqual(
    matrix.rows.map((r) => r.id),
    ["first", "second"],
  );
  assert.deepEqual(
    matrix.rows[0].cells.map((cell) => cell?.pass ?? null),
    [true, null],
  );
  assert.deepEqual(
    matrix.rows[1].cells.map((cell) => cell?.failures ?? null),
    [null, ["collision"]],
  );
});
test("Return no published debrief baseline when driving conditions are unavailable", () => {
  assert.equal(compatibleChallengeDrive(data, "rules", null), null);
});
test("Check numeric ordering of double-digit suite versions", () => {
  const rows = ["v2", "v10", "v2", "v1"].map((suite_version) => ({ suite_version }));
  assert.deepEqual(resultVersions({ rows }), ["v10", "v2", "v1"]);
});
test("Check that each suite provenance label is human-readable", () => {
  assert.deepEqual(["v1", "legacy", "custom"].map(suiteLabel), ["Suite v1", "Legacy results", "Custom runs"]);
});
test("Check that open-only drivers retain their recorded cost and appear beyond the pilot section", () => {
  const open = { suite: "open", driver: "only-open", cost_usd: 0.75, model: "model" };
  const [entry] = summary({ drivers: { "only-open": { label: "Only open" } }, rows: [open] }).drivers;
  assert.deepEqual([entry.challenges, entry.cost, entry.costTrack, entry.model], [null, 0.75, "open", "model"]);
});
test("Check that an unmeasured weather occupies an empty cell instead of inheriting a dry result", () => {
  const city = { suite: "city", driver: "rules", map: "kitsilano", weather: "dry", total: 12, passed: 12 };
  const home = summary({ drivers: { rules: { label: "Rules" } }, rows: [city] }).drivers[0].home;
  assert.deepEqual(home, { dry: city, fog: null, rain: null, snow: null });
});
test("Check that summary totals for other maps use their dry conditions", () => {
  const rows = [
    ["kitsilano", "dry", 12],
    ["ottawa", "dry", 10],
    ["ottawa", "rain", 7],
    ["toronto", "dry", 8],
  ].map(([map, weather, passed]) => ({ driver: "rules", map, weather, passed, total: 12, suite: "city" }));
  const others = summary({ drivers: { rules: {} }, rows }).drivers[0].others;
  assert.deepEqual(
    { passed: others.passed, total: others.total, maps: others.maps },
    { passed: 18, total: 24, maps: 2 },
  );
});
test("Check that pass fractions aggregate numerators and denominators instead of averaging rates", () => {
  assert.deepEqual(
    fraction([
      { passed: 1, total: 1 },
      { passed: 4, total: 9 },
    ]),
    { passed: 5, total: 10 },
  );
  assert.equal(fractionText({ passed: 0, total: 2 }), "0/2");
});
test("Check that a numbered suite has no fallback ranking from a legacy cohort", () => {
  assert.deepEqual(summary(data, "v99"), { drivers: [], pilots: [] });
  assert.deepEqual(cityGrid(data, "v99"), { drivers: [], rows: [] });
});
test("Check that an older guarded drive can supply a debrief when the newest pack differs", () => {
  const published = data.rows.find((r) => r.suite === "challenges" && r.driver === "rules");
  const drive = published.drives[0];
  const newer = { ...published, drives: [{ ...drive, pack: "another pack" }] };
  const config = { ...drive, challenge: drive.id };
  assert.equal(compatibleChallengeDrive({ rows: [newer, published] }, "rules", config).pack, drive.pack);
});
test("Check that a published failure reason survives into a challenge debrief comparison", () => {
  const published = data.rows.find((r) => r.suite === "challenges" && r.driver === "llm:deepseek");
  const drive = published.drives.find((d) => d.id === "double-parked");
  const match = compatibleChallengeDrive(data, published.driver, { ...drive, challenge: drive.id });
  assert.deepEqual(match.failures, published.failed.find((f) => f.id === drive.id).failures);
});
test("Check that a manifest replay source and engine override legacy metadata", () => {
  const [item] = recordings({
    rows: [
      {
        recording: "data/recordings/drive.json",
        manifest: { source_commit: "current", engine: "recorded engine" },
        replay_source_commit: "legacy",
        engine: "legacy engine",
      },
    ],
  });
  assert.deepEqual([item.sourceCommit, item.engine, item.legacyReplay], ["current", "recorded engine", false]);
});
// End lab validation additions

console.log(`${checks} checks passed`);
