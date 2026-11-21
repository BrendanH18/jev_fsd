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
  recordings,
  fractionText,
  percentText,
  moneyText,
  WEATHERS,
} = await import("../static/js/lab/results.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");

const data = checkResults(JSON.parse(fs.readFileSync(new URL("../data/results.json", import.meta.url), "utf8")));
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const block = readme.slice(readme.indexOf("<!-- results:start -->"), readme.indexOf("<!-- results:end -->"));
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

test("manual comparison finds the newest guarded drive with the same map data and challenge version", () => {
  const rules = data.rows.find((r) => r.suite === "challenges" && r.driver === "rules");
  const match = rules.drives.find((d) => d.id === "road-test-kitsilano");
  assert.ok(match.map_sha && match.score_inputs);
  const config = { ...match, challenge: match.id };
  const changedMap = { ...rules, drives: [{ ...match, map_sha: "changed", time_s: 0 }] };
  const changedVersion = { ...rules, drives: [{ ...match, version: match.version + 1, time_s: 0 }] };
  const open = { ...rules, suite: "open", drives: [{ ...match, time_s: 0 }] };
  const history = { rows: [changedMap, changedVersion, open, rules] };
  assert.deepEqual(compatibleChallengeDrive(history, "rules", config), { ...match, failures: [] });
  assert.equal(compatibleChallengeDrive(history, "rules", { ...config, map_sha: "unknown" }), null);
  assert.equal(compatibleChallengeDrive(history, "rules", { ...config, map_sha: undefined }), null);
});

test("every recording offered for replay is committed", () => {
  const list = recordings(data);
  assert.equal(list.length, 11);
  for (const r of list) {
    assert.ok(fs.existsSync(new URL(`../${r.recording}`, import.meta.url)), r.recording);
    const row = data.rows.find((row) => row.recording === r.recording);
    const runner = row.map ? "bench_node" : "arena_node";
    assert.ok(r.command.includes(`scripts/${runner}.mjs --port 8322 --replay ${r.recording} --check replay`));
    assert.equal(r.sourceCommit, row.map ? row.manifest?.source_commit : null);
    assert.equal(r.engine, row.manifest?.engine || row.engine);
  }
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

console.log(`${checks} checks passed`);
