import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  challengeMatrix,
  checkResults,
  cityGrid,
  compatibleChallengeDrive,
  mapDisplayName,
  matchesCoverage,
  moneyText,
  recordings,
  repositoryArtifact,
  RESULTS_FORMAT,
  resultVersions,
  selectedSuite,
  summary,
} from "../static/js/lab/results.js";
import {
  filterResultRows,
  readResultFilters,
  writeResultFilters,
  searchMatches,
} from "../static/js/lab/results-filters.js";

const drive = { id: "turn", map: "mtl", pass: false, time_s: 12.1, version: 1, pack: "6", map_sha: "match" };
const data = {
  format: RESULTS_FORMAT,
  drivers: { rules: { label: "Rules" } },
  maps: { mtl: "Montréal" },
  rows: [
    {
      driver: "rules",
      label: "Challenges",
      suite: "challenges",
      total: 1,
      passed: 0,
      date: "2026-11-21",
      sources: ["reports/suite.json"],
      failed: [{ id: "turn", failures: ["red light"] }],
      drives: [drive],
    },
  ],
};

function bad(field, change) {
  const copy = structuredClone(data);
  change(copy.rows[0], copy, copy.rows[0].drives[0]);
  assert.throws(() => checkResults(copy), new RegExp(field));
}

const committed = JSON.parse(readFileSync(new URL("../data/results.json", import.meta.url), "utf8"));
assert.equal(checkResults(committed).rows.length, committed.rows.length);
assert.equal(checkResults(data).rows[0].drives[0].map, "mtl");
bad("map catalog", (_row, body) => {
  body.maps.mtl = 1;
});
bad("driver details", (_row, body) => {
  body.drivers.rules = "Rules";
});
bad("driver details", (_row, body) => {
  body.drivers.rules.submitter = 8;
});
bad("run data", (_row, body) => {
  body.rows[0] = null;
});
bad("row 1.*driver", (row) => {
  row.driver = "";
});
bad("label", (row) => {
  row.label = [];
});
bad("suite", (row) => {
  row.suite = null;
});
bad("suite version", (row) => {
  row.suite_version = "v2.0";
});
bad("pass counts", (row) => {
  row.passed = 2;
});
bad("pass counts", (row) => {
  row.total = 1.5;
});
bad("date", (row) => {
  row.date = "not a date";
});
bad("sources", (row) => {
  row.sources = [];
});
bad("sources", (row) => {
  row.sources = ["../outside"];
});
bad("recording path", (row) => {
  row.recording = "/outside";
});
bad("model", (row) => {
  row.model = {};
});
bad("submitter", (row) => {
  row.submitter = [];
});
bad("track", (row) => {
  row.track = "unknown";
});
bad("flag count", (row) => {
  row.flagged_choices = -1;
});
bad("cost", (row) => {
  row.cost_usd = "0.1";
});
bad("fallback count", (row) => {
  row.fallbacks = 0.5;
});
bad("model decision share", (row) => {
  row.model_share = 1.1;
});
bad("city map", (row) => {
  row.suite = "city";
  row.map = null;
});
bad("city weather", (row) => {
  row.suite = "city";
  row.map = "mtl";
});
bad("failure details", (row) => {
  row.failed[0].failures = "red light";
});
bad("drive list", (row) => {
  delete row.drives;
});
bad("drive ID", (_row, _body, entry) => {
  delete entry.id;
});
bad("duplicate drive ID", (row) => {
  row.drives.push({ ...drive });
});
bad("drive map", (_row, _body, entry) => {
  entry.map = false;
});
bad("drive verdict", (_row, _body, entry) => {
  entry.pass = "fail";
});
bad("drive duration", (_row, _body, entry) => {
  entry.time_s = -2;
});
bad("drive flag count", (_row, _body, entry) => {
  entry.flagged_choices = 1.2;
});
bad("drive score inputs", (_row, _body, entry) => {
  entry.score_inputs = [];
});
bad("comparison score inputs", (_row, _body, entry) => {
  entry.comparison_score_inputs = "";
});
bad("incident counts", (_row, _body, entry) => {
  entry.incident_counts = { collision: "0" };
});

assert.equal(repositoryArtifact("data/a #3's file.json"), true);
assert.equal(repositoryArtifact("data//entry"), false);
assert.equal(repositoryArtifact("data/./entry"), false);
assert.equal(repositoryArtifact("data\\entry"), false);
assert.equal(repositoryArtifact("data/entry\n"), false);
assert.equal(mapDisplayName(data, "toString"), "toString");
assert.equal(mapDisplayName(data, "mtl"), "Montréal");
assert.equal(moneyText(undefined), "n/a");
assert.equal(moneyText(0), "$0");
assert.equal(matchesCoverage([{}], "something-else"), true);
assert.equal(matchesCoverage([], "complete"), false);
assert.match(
  recordings({ rows: [{ ...data.rows[0], recording: "-file.json" }] })[0].command,
  /--replay \.\/-file\.json/,
);
const config = { ...drive, challenge: drive.id };
assert.equal(compatibleChallengeDrive({ rows: [{ ...data.rows[0], track: "open" }] }, "rules", config), null);
assert.equal(compatibleChallengeDrive(data, "rules", config).failures[0], "red light");

const rows = [
  {
    id: "a",
    map: "mtl",
    weather: "dry",
    title: "Test 2",
    kind: "road-test",
    cells: [
      { pass: true, metric: 6 },
      { pass: false, metric: 2 },
    ],
  },
  {
    id: "b",
    map: "ott",
    weather: "rain",
    title: "Test 12",
    kind: "challenge",
    cells: [null, { pass: true, flagged_choices: 2, metric: 0 }],
  },
  {
    id: "c",
    map: "mtl",
    weather: "rain",
    title: "Test 1",
    kind: "challenge",
    cells: [{ pass: true, metric: 6 }, null],
  },
  { id: "d", map: "ott", weather: "dry", title: "Test 3", kind: "road-test", cells: [{ pass: false }, null] },
];
const detail = {
  drivers: ["rules", "model"],
  kind: (row) => row.kind,
  describe: (row) => [row.title, mapDisplayName(data, row.map), row.weather],
  failed: (cell) => !cell.pass,
  metric: (row, column) => (column === "title" ? row.title : row.cells[detail.drivers.indexOf(column)]?.metric),
};
const ids = (state) =>
  filterResultRows(rows, state, detail)
    .map((row) => row.id)
    .join("");
assert.equal(ids({ query: " MONTREAL   rain " }), "c");
assert.equal(searchMatches("  ", []), true);
assert.equal(searchMatches("rain 2", ["Test 2", "dry"]), false);
assert.equal(ids({ map: "ott" }), "bd");
assert.equal(ids({ weather: "rain" }), "bc");
assert.equal(ids({ kind: "road-test" }), "ad");
assert.equal(ids({ driver: "model" }), "ab");
assert.equal(ids({ driver: "model", issues: "pass" }), "b");
assert.equal(ids({ driver: "rules", coverage: "complete" }), "a");
assert.equal(ids({ issues: "pass" }), "bc");
assert.equal(ids({ issues: "fail" }), "ad");
assert.equal(ids({ issues: "split" }), "a");
assert.equal(ids({ issues: "split", driver: "model" }), "a");
assert.equal(ids({ issues: "flags" }), "b");
assert.equal(ids({ issues: "any", weather: "rain" }), "b");
assert.equal(ids({ sort: "model", direction: "asc" }), "bacd");
assert.equal(ids({ sort: "model", direction: "desc" }), "abcd");
assert.equal(ids({ sort: "rules", direction: "desc" }), "acbd");
assert.equal(ids({ sort: "title" }), "cadb");
assert.equal(ids({ map: "ott", weather: "snow" }), "");
assert.equal(rows.map((row) => row.id).join(""), "abcd");
const params = new URLSearchParams({ suite: "v2", "city-map": "mtl", "open-sort": "rules", "city-direction": "bad" });
const options = { map: ["mtl"], direction: ["asc", "desc"] };
assert.equal(readResultFilters(params, "city", options).map, "mtl");
assert.equal(readResultFilters(params, "city", options).direction, "");
assert.equal(readResultFilters(params, "city", options).sort, "");
writeResultFilters(params, "city", { map: "", query: "Montréal & coast", direction: "asc" });
assert.equal(params.has("city-map"), false);
assert.equal(params.get("city-query"), "Montréal & coast");
assert.equal(params.get("open-sort"), "rules");
assert.equal(params.get("suite"), "v2");
params.set("city-query", "a".repeat(170));
assert.equal(readResultFilters(params, "city", options).query.length, 160);
const guarded = data.rows[0];
assert.equal(checkResults({ ...data, rows: [] }).rows.length, 0);
assert.equal(checkResults({ ...data, maps: undefined }).rows.length, 1);
assert.equal(compatibleChallengeDrive(data, "rules", { ...config, map: "other" }), null);
assert.equal(compatibleChallengeDrive(data, "rules", { ...config, challenge: "other" }), null);
assert.equal(compatibleChallengeDrive(data, "rules", { ...config, pack: 6 }), null);
assert.equal(compatibleChallengeDrive(data, "other", config), null);
assert.equal(
  compatibleChallengeDrive({ rows: [{ ...guarded, failed: undefined }] }, "rules", config).failures.length,
  0,
);
assert.equal(resultVersions({ rows: [guarded, { ...guarded, suite_version: "legacy" }] }).length, 1);
assert.equal(selectedSuite([], null), "legacy");
const full = { ...guarded, passed: 1, cost_usd: 0.4321 };
const openTrack = { ...full, suite: "open", track: "open", cost_usd: 0.9876 };
assert.equal(summary({ ...data, rows: [openTrack, full] }).drivers[0].cost, 0.4321);
assert.equal(summary({ ...data, rows: [openTrack, full] }).drivers[0].costTrack, null);
const city = { ...full, suite: "city", weather: "dry", map: "mtl" };
assert.equal(cityGrid({ ...data, rows: [city, { ...city, passed: 0 }] }).rows[0].cells[0].passed, 1);
assert.equal(cityGrid({ ...data, rows: [{ ...city, suite: "bare" }] }).rows.length, 0);
assert.equal(
  challengeMatrix({
    ...data,
    rows: [
      {
        ...guarded,
        failed: [{ id: drive.id, failures: ["red light", "collision"] }],
      },
    ],
  }).rows[0].cells[0].failures.join("|"),
  "red light|collision",
);
assert.equal(recordings({ rows: [{ ...guarded, recording: null }] }).length, 0);
assert.equal(
  recordings({ rows: [{ ...city, recording: "data/old.json.gz", replay_source_commit: "archive" }] })[0].legacyReplay,
  true,
);
console.log("Results validation, matching, filters and sort checks passed");
