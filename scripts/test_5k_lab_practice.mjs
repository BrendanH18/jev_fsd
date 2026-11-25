import assert from "node:assert/strict";
import { test } from "node:test";
import { challengeConfig } from "../static/js/lab/challenge-config.js";
import {
  PRACTICE_BACKUP_FORMAT,
  PRACTICE_KEY,
  ROAD_TEST_KEY,
  challengeCity,
  challengeFailures,
  challengeNeighbourhood,
  challengeProvince,
  filterChallenges,
  importPracticeBackup,
  practiceEligible,
  practiceOutcome,
  practiceReportNote,
  readPractice,
  readRoadTests,
  savePractice,
  saveRoadTest,
} from "../static/js/lab/practice.js";

const challenge = {
  id: "road-closed",
  map: "halifax",
  weather: "dry",
  time: "afternoon",
  seed: 42,
  title: "Don't drive past the barricade",
  street: "Saint-Denis",
};
const start = "2026-11-25T08:00:00Z";
const nextStart = "2026-11-25T09:00:00Z";
const goodReport = {
  driver: "manual",
  branched: false,
  modified: false,
  status: "arrived",
  started_at: start,
  config: challengeConfig(challenge),
  collisions: 0,
  red_lights: 0,
  stop_signs: 0,
  failed_to_yield: 0,
  off_road_s: 0,
  resets: 0,
};
const practice = { attempts: 1, version: 1, completed: false, best_score: null, last_at: start };
const road = {
  attempts: 1,
  version: 1,
  passes: 1,
  best: { pass: true, fails: 0, demerits: 0, at: start },
  last_at: start,
};
const sheet = { available: true, pass: true, demerits: 0, fails: [] };
const backup = (practice = {}, road_tests = {}) => ({ format: PRACTICE_BACKUP_FORMAT, practice, road_tests });

function storage(initial = {}) {
  const records = new Map(Object.entries(initial));
  return {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
}

test("search treats straight and curly apostrophes alike", () => {
  assert.equal(filterChallenges([challenge], { query: "don’t" }).length, 1);
});
test("search treats a nonbreaking hyphen like an authored ASCII hyphen", () => {
  assert.equal(filterChallenges([challenge], { query: "saint‑denis" }).length, 1);
});
test("search can find a space-separated ID even when the title differs", () => {
  assert.equal(filterChallenges([challenge], { query: "road closed" }).length, 1);
});
test("time and weather filters intersect", () => {
  const night = { ...challenge, id: "night", time: "night" };
  const fog = { ...night, id: "fog", weather: "fog" };
  assert.equal(filterChallenges([challenge, night, fog], { time: "night", weather: "dry" })[0]?.id, night.id);
  assert.equal(filterChallenges([challenge, night, fog], { time: "night", weather: "dry" }).length, 1);
});
test("blank searches and rejected filters skip text reads", () => {
  const card = {
    ...challenge,
    get title() {
      throw new Error("Did not need the title");
    },
  };
  assert.equal(filterChallenges([card], { query: " " }).length, 1);
  assert.equal(filterChallenges([card], { query: "fog", weather: "snow" }).length, 0);
});
test("map label lookup uses catalog own properties", () => {
  const unknown = { map: "constructor" };
  assert.equal(challengeCity(unknown), "constructor");
  assert.equal(challengeNeighbourhood(unknown), "constructor");
  assert.equal(challengeProvince(unknown), "");
});
test("legacy cards without a map have an empty place label", () => {
  assert.equal(challengeCity({}), "");
  assert.equal(challengeNeighbourhood({}), "");
});
test("audit durations can be fractional but counts cannot", () => {
  assert.equal(challengeFailures(challenge, { ...goodReport, off_road_s: 0.1 }).length, 0);
  for (const report of [
    { ...goodReport, collisions: 0.5 },
    { ...goodReport, red_lights: -1 },
    { ...goodReport, stop_signs: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.equal(challengeFailures(challenge, report), null);
    assert.equal(practiceEligible(challenge, report), false);
  }
});
test("unsafe storage counts and versions are rejected on import", () => {
  const over = Number.MAX_SAFE_INTEGER + 1;
  for (const record of [
    { ...practice, attempts: over },
    { ...practice, version: over },
  ]) {
    assert.throws(() => importPracticeBackup(backup({ [challenge.id]: record }), storage()), /invalid entry/);
  }
  assert.throws(() => importPracticeBackup(backup({}, { [challenge.id]: { ...road, passes: over } }), storage()));
});
test("progress counts saturate at the largest exactly representable integer", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const s = storage({
    [PRACTICE_KEY]: JSON.stringify({ [challenge.id]: { ...practice, attempts: max } }),
    [ROAD_TEST_KEY]: JSON.stringify({ [challenge.id]: { ...road, attempts: max, passes: max } }),
  });
  const report = { ...goodReport, started_at: nextStart };
  savePractice(challenge, report, s);
  saveRoadTest(challenge, report, sheet, s);
  assert.equal(readPractice(s).records[challenge.id]?.attempts, max);
  assert.equal(readRoadTests(s).records[challenge.id]?.attempts, max);
  assert.equal(readRoadTests(s).records[challenge.id]?.passes, max);
});
test("a practice best score requires a clean completion", () => {
  assert.throws(() => importPracticeBackup(backup({ [challenge.id]: { ...practice, best_score: 90 } }), storage()));
});
test("the road-test best must agree with whether the driver has passed", () => {
  for (const record of [
    { ...road, passes: 0 },
    { ...road, best: { ...road.best, pass: false } },
  ]) {
    assert.throws(() => importPracticeBackup(backup({}, { [challenge.id]: record }), storage()));
  }
});
test("the road-test best cannot be dated later than the latest attempt", () => {
  const inconsistent = { ...road, best: { ...road.best, at: nextStart } };
  assert.throws(() => importPracticeBackup(backup({}, { [challenge.id]: inconsistent }), storage()));
});
test("noncanonical IDs are rejected consistently", () => {
  const invalid = { ...challenge, id: "road--closed" };
  const report = { ...goodReport, config: challengeConfig(invalid) };
  assert.equal(practiceOutcome(invalid, report), null);
  assert.throws(() => importPracticeBackup(backup({ [invalid.id]: practice }), storage()));
});
test("malformed examiner sheets cannot make progress unreadable", () => {
  for (const changes of [{ fails: null }, { pass: "true" }, { demerits: -1 }]) {
    const s = storage();
    const result = saveRoadTest(challenge, goodReport, { ...sheet, ...changes }, s);
    assert.equal(result.outcome, null);
    assert.equal(s.getItem(ROAD_TEST_KEY), null);
  }
});
test("backup errors identify the invalid record and its collection", () => {
  assert.throws(
    () => importPracticeBackup(backup({}, { "road-test-toronto": null }), storage()),
    /road_tests.*road-test-toronto/,
  );
});
test("whitespace around an empty store needs no replacement prompt", () => {
  const s = storage({ [PRACTICE_KEY]: " { \n } " });
  assert.equal(importPracticeBackup(backup({ [challenge.id]: practice }), s)?.practiceCount, 1);
});
test("a byte-identical backup neither asks for confirmation nor writes to storage", () => {
  const data = backup({ [challenge.id]: practice }, { [challenge.id]: road });
  const s = storage();
  importPracticeBackup(data, s);
  s.setItem = () => {
    throw new Error("No write expected");
  };
  assert.equal(importPracticeBackup(data, s)?.roadTestCount, 1);
});
test("practice debrief distinguishes completed and incomplete attempts when storage fails", () => {
  assert.match(
    practiceReportNote({ outcome: "completed", saved: false }),
    /Clean manual arrival.*storage is unavailable/,
  );
  assert.match(practiceReportNote({ outcome: "attempted", saved: false }), /attempt was not saved/);
});

// Additional boundaries in the manual-progress contract.
test("a report with only a different clock is ineligible", () => {
  assert.equal(practiceEligible(challenge, { ...goodReport, config: { ...goodReport.config, clock: 1 } }), false);
});
test("canonical arrival with score zero remains a clean completion", () => {
  const s = storage();
  assert.equal(savePractice(challenge, { ...goodReport, qualified: true, score: 0 }, s).outcome, "completed");
  assert.equal(readPractice(s).records[challenge.id]?.best_score, 0);
});
test("backup validation happens before asking to replace existing progress", () => {
  const s = storage({ [PRACTICE_KEY]: JSON.stringify({ [challenge.id]: practice }) });
  let confirmations = 0;
  const confirm = () => {
    confirmations++;
    return true;
  };
  assert.throws(() => importPracticeBackup(backup({}, { invalid: null }), s, confirm));
  assert.equal(confirmations, 0);
});
test("replacing a backup leaves an unchanged companion collection untouched", () => {
  const s = storage();
  importPracticeBackup(backup({}, { [challenge.id]: road }), s);
  const wrote = [];
  const setItem = s.setItem;
  s.setItem = (key, value) => {
    wrote.push(key);
    setItem(key, value);
  };
  importPracticeBackup(backup({ [challenge.id]: practice }, { [challenge.id]: road }), s);
  assert.equal(wrote.join(","), PRACTICE_KEY);
});
