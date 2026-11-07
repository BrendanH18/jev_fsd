import assert from "node:assert/strict";
import { PRACTICE_KEY, challengeCity, filterChallenges, practiceStatus, readPractice, practiceOutcome, savePractice } from "../static/js/lab/practice.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`); };
const challenge = { id: "rain-check", map: "montreal", seed: 42, weather: "rain", time: "night", version: 2,
  title: "Rain check", description: "A person crosses a wet Montréal street.", lesson: "Leave braking room.", street: "Rue Saint-Denis", difficulty: "Patience" };
const vancouver = { ...challenge, id: "curb-merge", map: "kitsilano", title: "Joining the flow", weather: "dry", difficulty: "Anticipation" };
const pleasant = { ...vancouver, id: "blind-corner", map: "mount_pleasant", title: "The blind corner", difficulty: "Sight lines" };
const config = c => ({ version: c.version || 1, challenge: c.id, map: c.map, seed: c.seed, weather: c.weather,
  time: c.time, traffic: 0, car: "compact", clock: 0 });
const report = (c = challenge, overrides = {}) => ({ config: config(c), driver: "manual", branched: false, modified: false,
  started_at: "2026-11-07T10:00:00Z", status: "arrived", score: 95, qualified: true,
  collisions: 0, red_lights: 0, stop_signs: 0, failed_to_yield: 0, off_road_s: 0, resets: 0, ...overrides });
function storage(raw = null) {
  const data = new Map(raw === null ? [] : [[PRACTICE_KEY, raw]]);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
const record = overrides => ({ version: 2, attempts: 1, completed: false, best_score: null, last_at: "2026-11-07T10:00:00Z", ...overrides });

test("city names group both Vancouver neighbourhoods and preserve accents", () => {
  assert.equal(challengeCity(challenge), "Montréal");
  assert.equal(challengeCity(vancouver), "Vancouver"); assert.equal(challengeCity(pleasant), "Vancouver");
  assert.equal(filterChallenges([challenge, vancouver, pleasant], { city: "Vancouver" }).length, 2);
});
test("search ignores accents and case, and searches streets, cities, descriptions and lessons", () => {
  for (const query of ["MONTREAL", "saint-denis", "person crosses", "BRAKING ROOM"]) {
    assert.equal(filterChallenges([challenge], { query }).length, 1);
  }
  assert.equal(filterChallenges([challenge], { query: "rain saint-denis" }).length, 1);
  assert.equal(filterChallenges([challenge], { query: "nothing matches" }).length, 0);
});
test("all filters combine and blank filters preserve authored order", () => {
  const list = [challenge, vancouver, pleasant], records = { [challenge.id]: record() };
  const result = filterChallenges(list, { query: "rain", city: "Montréal", skill: "Patience", weather: "rain", progress: "attempted" }, records);
  assert.equal(result.length, 1); assert.equal(result[0].id, challenge.id);
  assert.equal(filterChallenges(list, { city: "Vancouver", weather: "rain" }).length, 0);
  assert.equal(filterChallenges(list, { progress: "untried" }, records).length, 2);
  assert.equal(filterChallenges(list).map(c => c.id).join(), list.map(c => c.id).join());
});
test("practice status is versioned and completed progress remains distinct", () => {
  assert.equal(practiceStatus(challenge, {}), "untried");
  assert.equal(practiceStatus(challenge, { [challenge.id]: record({ version: 1 }) }), "untried");
  assert.equal(practiceStatus(challenge, { [challenge.id]: record() }), "attempted");
  assert.equal(practiceStatus(challenge, { [challenge.id]: record({ completed: true, best_score: 95 }) }), "completed");
});
test("only a clean arrival completes, independently of coaching qualification or score", () => {
  assert.equal(practiceOutcome(challenge, report(challenge, { qualified: false, score: 59 })), "completed");
  assert.equal(practiceOutcome(challenge, report(challenge, { status: "finished", score: 100 })), "attempted");
  assert.equal(practiceOutcome(challenge, report(challenge, { collisions: 1, score: 100 })), "attempted");
});
test("every existing failure policy blocks a clean completion", () => {
  for (const [key, value] of Object.entries({ collisions: 1, red_lights: 1, amber_lights_run: 1, stop_signs: 1,
    failed_to_yield: 1, off_road_s: 1, plow_right_passes: 1, merge_cut_ins: 1, close_passes: 1,
    bus_lane_driving: 1.1, glare_seconds: 0.81, glare_speeding_seconds: 1.1, illegal_turns: 1, hump_hits: 1,
    pxo_early_goes: 1, crew_close_passes: 1, guard_violations: 1, contraflow_conflicts: 1, fresh_green_conflicts: 1,
    reversing_conflicts: 1, pothole_hits: 1, ball_warnings_ignored: 1, wildlife_conflicts: 1 })) {
    assert.equal(practiceOutcome(challenge, report(challenge, { [key]: value })), "attempted", key);
  }
  assert.equal(practiceOutcome(challenge, report(challenge, { off_road_s: 0.9, glare_seconds: 0.8, bus_lane_driving: 1 })), "completed");
});
test("AI, mixed, replay, modified, reset and nonterminal drives earn no manual progress", () => {
  for (const overrides of [{ driver: "rules" }, { driver: "mixed" }, { branched: true }, { modified: true },
    { resets: 1 }, { status: "active" }, { status: "replaced" }, { branched: undefined }, { modified: undefined }]) {
    assert.equal(practiceOutcome(challenge, report(challenge, overrides)), null);
  }
});
test("all authored conditions must match, and missing or invalid audit counters cannot pass", () => {
  for (const key of Object.keys(config(challenge))) {
    assert.equal(practiceOutcome(challenge, report(challenge, { config: { ...config(challenge), [key]: "changed" } })), null, key);
  }
  assert.equal(practiceOutcome(challenge, report(challenge, { config: undefined })), null);
  for (const key of ["collisions", "red_lights", "stop_signs", "failed_to_yield", "off_road_s", "resets"]) {
    for (const value of [undefined, NaN, -1]) assert.equal(practiceOutcome(challenge, report(challenge, { [key]: value })), null);
  }
});
test("parking challenges need a real parked result within the kerb limit", () => {
  const parking = { ...challenge, park: true };
  assert.equal(practiceOutcome(parking, report(parking)), "attempted");
  assert.equal(practiceOutcome(parking, report(parking, { parking: { result: "parked", within_kerb: false } })), "attempted");
  assert.equal(practiceOutcome(parking, report(parking, { parking: { result: "stopped in lane", within_kerb: true } })), "attempted");
  assert.equal(practiceOutcome(parking, report(parking, { parking: { result: "parked", within_kerb: true } })), "completed");
});
test("compact progress survives report history eviction, retains best clean score and ignores duplicate reports", () => {
  const s = storage();
  savePractice(challenge, report(challenge, { status: "finished", score: 100 }), s);
  savePractice(challenge, report(challenge, { started_at: "2026-11-07T11:00:00Z", score: 80 }), s);
  savePractice(challenge, report(challenge, { started_at: "2026-11-07T11:00:00Z", score: 80 }), s);
  savePractice(challenge, report(challenge, { started_at: "2026-11-07T12:00:00Z", collisions: 1, score: 100 }), s);
  s.setItem("jev-fsd-drives-v1", "[]");
  const r = readPractice(s).records[challenge.id];
  assert.equal(r.attempts, 3); assert.equal(r.completed, true); assert.equal(r.best_score, 80);
  assert.equal(practiceStatus(challenge, readPractice(s).records), "completed");
  assert.equal(Object.keys(r).sort().join(), "attempts,best_score,completed,last_at,version");
});
test("a new authored version starts fresh without erasing other challenges", () => {
  const s = storage(); savePractice(challenge, report(), s); savePractice(vancouver, report(vancouver), s);
  const changed = { ...challenge, version: 3 };
  savePractice(changed, report(changed, { status: "finished" }), s);
  const state = readPractice(s);
  assert.equal(state.records[challenge.id].attempts, 1); assert.equal(state.records[challenge.id].best_score, null);
  assert.equal(practiceStatus(changed, state.records), "attempted"); assert.equal(practiceStatus(vancouver, state.records), "completed");
});
test("ineligible attempts never write or alter saved manual progress", () => {
  const s = storage(); savePractice(challenge, report(), s); const before = s.getItem(PRACTICE_KEY);
  const result = savePractice(challenge, report(challenge, { driver: "rules" }), s);
  assert.equal(result.outcome, null); assert.equal(s.getItem(PRACTICE_KEY), before);
});
test("malformed storage is ignored and blocked storage returns usable in-memory progress", () => {
  for (const raw of ["{", "null", "[]", '{"rain-check":{"version":2}}']) {
    assert.equal(Object.keys(readPractice(storage(raw)).records).length, 0);
  }
  const mixed = storage(JSON.stringify({ good: record(), bad: record({ attempts: -1 }), array: [] }));
  assert.equal(Object.keys(readPractice(mixed).records).join(), "good");
  const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(readPractice(blocked).available, false);
  const result = savePractice(challenge, report(), blocked);
  assert.equal(result.available, false); assert.equal(result.outcome, "completed");
  assert.equal(practiceStatus(challenge, result.records), "completed");
});

console.log(`${passed} practice library checks passed`);
