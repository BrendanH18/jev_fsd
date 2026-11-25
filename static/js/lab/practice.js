import { failures } from "../bench/metrics.js";
import { challengeConfig } from "./challenge-config.js";

export const PRACTICE_KEY = "jev-fsd-practice-v1";
export const PRACTICE_BACKUP_FORMAT = "jev-practice-backup/1";
const CITIES = {
  kitsilano: "Vancouver",
  mount_pleasant: "Vancouver",
  victoria: "Victoria",
  toronto: "Toronto",
  montreal: "Montréal",
  calgary: "Calgary",
  ottawa: "Ottawa",
  quebec_city: "Québec City",
  halifax: "Halifax",
  winnipeg: "Winnipeg",
  edmonton: "Edmonton",
  saskatoon: "Saskatoon",
};
const NEIGHBOURHOODS = {
  kitsilano: "Kitsilano",
  mount_pleasant: "Mount Pleasant",
  victoria: "Old Town",
  toronto: "The Annex",
  montreal: "Le Plateau",
  calgary: "Beltline",
  ottawa: "Centretown",
  quebec_city: "Saint-Roch",
  halifax: "Downtown",
  winnipeg: "Exchange District",
  edmonton: "Old Strathcona",
  saskatoon: "Downtown & Nutana",
};
const PROVINCES = {
  kitsilano: "British Columbia",
  mount_pleasant: "British Columbia",
  victoria: "British Columbia",
  toronto: "Ontario",
  ottawa: "Ontario",
  montreal: "Québec",
  quebec_city: "Québec",
  calgary: "Alberta",
  edmonton: "Alberta",
  halifax: "Nova Scotia",
  winnipeg: "Manitoba",
  saskatoon: "Saskatchewan",
};
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—‑]/g, "-")
    .toLowerCase();
const finite = (value) => Number.isFinite(value) && value >= 0;
const date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const version = (challenge) => challenge.version || 1;
const driveId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const mapLabel = (challenge) => challenge.map?.replaceAll("_", " ") ?? "";
const auditCounts = ["collisions", "red_lights", "stop_signs", "failed_to_yield", "resets"];

export function challengeCity(challenge) {
  return Object.hasOwn(CITIES, challenge.map) ? CITIES[challenge.map] : mapLabel(challenge);
}

export function challengeNeighbourhood(challenge) {
  return Object.hasOwn(NEIGHBOURHOODS, challenge.map) ? NEIGHBOURHOODS[challenge.map] : mapLabel(challenge);
}

export function challengeProvince(challenge) {
  return Object.hasOwn(PROVINCES, challenge.map) ? PROVINCES[challenge.map] : "";
}

export function practiceStatus(challenge, records = {}) {
  const record = Object.hasOwn(records, challenge.id) ? records[challenge.id] : null;
  if (!record || record.version !== version(challenge)) return "untried";
  return record.completed ? "completed" : "attempted";
}

export function filterChallenges(challenges, filters = {}, records = {}) {
  const terms = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  return challenges.filter((c) => {
    if (
      (filters.city && challengeCity(c) !== filters.city) ||
      (filters.province && challengeProvince(c) !== filters.province) ||
      (filters.skill && c.difficulty !== filters.skill) ||
      (filters.weather && c.weather !== filters.weather) ||
      (filters.time && c.time !== filters.time) ||
      (filters.progress && practiceStatus(c, records) !== filters.progress)
    )
      return false;
    if (!terms.length) return true;
    const haystack = normalize(
      [
        c.id,
        c.id?.replaceAll("-", " "),
        c.title,
        c.description,
        c.lesson,
        c.street,
        challengeCity(c),
        challengeNeighbourhood(c),
        challengeProvince(c),
        c.map,
        c.difficulty,
        c.weather,
        c.time,
      ].join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

function sanitizePracticeRecords(parsed) {
  const valid = (r) =>
    r &&
    Number.isSafeInteger(r.version) &&
    r.version > 0 &&
    Number.isSafeInteger(r.attempts) &&
    r.attempts > 0 &&
    typeof r.completed === "boolean" &&
    (r.best_score === null || (r.completed && finite(r.best_score) && r.best_score <= 100)) &&
    date(r.last_at);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.fromEntries(
        Object.entries(parsed)
          .filter(([id, r]) => driveId.test(id) && valid(r))
          .map(([id, r]) => [
            id,
            {
              version: r.version,
              attempts: r.attempts,
              completed: r.completed,
              best_score: r.best_score,
              last_at: r.last_at,
            },
          ]),
      )
    : {};
}

// Progress is compact and independent of the last twenty full drive reports.
export function readPractice(storage) {
  return readRecords(storage, PRACTICE_KEY, sanitizePracticeRecords);
}

function readRecords(storage, key, sanitize) {
  let raw;
  try {
    raw = (storage || globalThis.localStorage).getItem(key);
  } catch {
    return { records: {}, available: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    parsed = {};
  }
  return { records: sanitize(parsed), available: true };
}

function hasAuditCounters(report) {
  return finite(report.off_road_s) && auditCounts.every((key) => Number.isSafeInteger(report[key]) && report[key] >= 0);
}

// Reports and manual progress use the same arrival, safety and parking verdict.
// Older reports without the required audit counters cannot establish a clean arrival.
export function challengeFailures(challenge, report) {
  if (!report || !hasAuditCounters(report)) return null;
  return failures({
    ...report,
    arrived: report.status === "arrived",
    ...(challenge.park ? { parked: report.parking?.result === "parked" && report.parking.within_kerb === true } : {}),
  });
}

// Only the unchanged authored manual drive can earn progress (road tests use the same rule).
export function practiceEligible(challenge, report) {
  if (
    report?.driver !== "manual" ||
    !driveId.test(challenge.id) ||
    report.branched !== false ||
    report.modified !== false ||
    !["arrived", "finished"].includes(report.status) ||
    !date(report.started_at) ||
    !hasAuditCounters(report) ||
    report.resets !== 0
  )
    return false;
  return Object.entries(challengeConfig(challenge)).every(([key, value]) => report.config?.[key] === value);
}

// A coaching grade is not a pass.
export function practiceOutcome(challenge, report) {
  if (!practiceEligible(challenge, report)) return null;
  return challengeFailures(challenge, report).length ? "attempted" : "completed";
}

export function practiceReportNote(practice) {
  if (practice?.outcome === "completed")
    return practice.saved === false
      ? "Clean manual arrival. Browser storage is unavailable."
      : "Clean manual arrival. Challenge completed.";
  if (practice?.outcome === "attempted")
    return practice.saved === false
      ? "Manual attempt was not saved because browser storage is unavailable."
      : "Manual attempt recorded. Retry for a clean arrival.";
  return "AI, mixed-driver, modified and replay drives do not change your manual practice progress.";
}

export function savePractice(challenge, report, storage) {
  const state = readPractice(storage),
    outcome = practiceOutcome(challenge, report);
  if (!outcome) return { ...state, outcome };
  const previous = practiceStatus(challenge, state.records) === "untried" ? null : state.records[challenge.id];
  if (previous && Date.parse(previous.last_at) === Date.parse(report.started_at)) return { ...state, outcome };
  const score = outcome === "completed" && finite(report.score) && report.score <= 100 ? report.score : null;
  state.records[challenge.id] = {
    version: version(challenge),
    attempts: Math.min(Number.MAX_SAFE_INTEGER, (previous?.attempts || 0) + 1),
    completed: outcome === "completed" || !!previous?.completed,
    best_score: score === null ? (previous?.best_score ?? null) : Math.max(score, previous?.best_score ?? 0),
    last_at:
      previous && Date.parse(previous.last_at) > Date.parse(report.started_at) ? previous.last_at : report.started_at,
  };
  try {
    (storage || globalThis.localStorage).setItem(PRACTICE_KEY, JSON.stringify(state.records));
    state.available = true;
  } catch {
    state.available = false;
  }
  return { ...state, outcome };
}

// Road tests (lab/road-tests.js, scored by lab/examiner.js): eligible manual attempts only, under the
// same rule as challenge practice, kept apart from it and keyed by test id and authored version: how
// many attempts and passes, and the best attempt (a pass before a fail, then fewer violations, then
// fewer demerits, then the earlier).
export const ROAD_TEST_KEY = "jev-fsd-road-tests-v1";
const validBest = (b) =>
  b &&
  typeof b.pass === "boolean" &&
  Number.isSafeInteger(b.demerits) &&
  b.demerits >= 0 &&
  Number.isSafeInteger(b.fails) &&
  b.fails >= 0 &&
  date(b.at);

function sanitizeRoadTestRecords(parsed) {
  const valid = (r) =>
    r &&
    Number.isSafeInteger(r.version) &&
    r.version > 0 &&
    Number.isSafeInteger(r.attempts) &&
    r.attempts > 0 &&
    Number.isSafeInteger(r.passes) &&
    r.passes >= 0 &&
    r.passes <= r.attempts &&
    validBest(r.best) &&
    r.best.pass === r.passes > 0 &&
    date(r.last_at) &&
    Date.parse(r.best.at) <= Date.parse(r.last_at);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.fromEntries(
        Object.entries(parsed)
          .filter(([id, r]) => driveId.test(id) && valid(r))
          .map(([id, r]) => [
            id,
            {
              version: r.version,
              attempts: r.attempts,
              passes: r.passes,
              best: { pass: r.best.pass, demerits: r.best.demerits, fails: r.best.fails, at: r.best.at },
              last_at: r.last_at,
            },
          ]),
      )
    : {};
}

export function readRoadTests(storage) {
  return readRecords(storage, ROAD_TEST_KEY, sanitizeRoadTestRecords);
}
export function roadTestRecord(test, records = {}) {
  const record = Object.hasOwn(records, test.id) ? records[test.id] : null;
  return record && record.version === version(test) ? record : null;
}
export function roadTestStatus(test, records = {}) {
  const record = roadTestRecord(test, records);
  return !record ? "untried" : record.passes ? "passed" : "attempted";
}
const better = (a, b) =>
  a.pass !== b.pass
    ? a.pass
    : a.fails !== b.fails
      ? a.fails < b.fails
      : a.demerits !== b.demerits
        ? a.demerits < b.demerits
        : Date.parse(a.at) < Date.parse(b.at);
// `sheet` is the examiner's sheet for the report (lab/examiner.js `examine`).
export function saveRoadTest(test, report, sheet, storage) {
  const state = readRoadTests(storage);
  if (!practiceEligible(test, report) || !sheet?.available || !Array.isArray(sheet.fails))
    return { ...state, outcome: null };
  const attempt = { pass: sheet.pass, demerits: sheet.demerits, fails: sheet.fails.length, at: report.started_at };
  if (!validBest(attempt)) return { ...state, outcome: null };
  const outcome = sheet.pass ? "passed" : "failed";
  const previous = roadTestRecord(test, state.records);
  if (previous && Date.parse(previous.last_at) === Date.parse(report.started_at)) return { ...state, outcome };
  state.records[test.id] = {
    version: version(test),
    attempts: Math.min(Number.MAX_SAFE_INTEGER, (previous?.attempts || 0) + 1),
    passes: Math.min(Number.MAX_SAFE_INTEGER, (previous?.passes || 0) + (sheet.pass ? 1 : 0)),
    best: previous && !better(attempt, previous.best) ? previous.best : attempt,
    last_at:
      previous && Date.parse(previous.last_at) > Date.parse(report.started_at) ? previous.last_at : report.started_at,
  };
  try {
    (storage || globalThis.localStorage).setItem(ROAD_TEST_KEY, JSON.stringify(state.records));
    state.available = true;
  } catch {
    state.available = false;
  }
  return { ...state, outcome };
}

export function exportPracticeBackup(storage) {
  const practice = readPractice(storage);
  const roadTests = readRoadTests(storage);
  if (!practice.available || !roadTests.available) return null;
  return {
    format: PRACTICE_BACKUP_FORMAT,
    exported_at: new Date().toISOString(),
    practice: practice.records,
    road_tests: roadTests.records,
  };
}

export function importPracticeBackup(data, storage, confirmReplace = () => false) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Backup file must be a JSON object.");
  }
  if (data.format !== PRACTICE_BACKUP_FORMAT) {
    throw new Error(`Unsupported backup format (expected ${PRACTICE_BACKUP_FORMAT}).`);
  }
  for (const field of ["practice", "road_tests"]) {
    const records = data[field];
    if (!Object.hasOwn(data, field) || !records || typeof records !== "object" || Array.isArray(records)) {
      throw new Error(`Backup field ${field} must contain a record object.`);
    }
  }
  const practiceRecords = sanitizePracticeRecords(data.practice);
  const roadTestRecords = sanitizeRoadTestRecords(data.road_tests);
  for (const [field, records] of [
    ["practice", practiceRecords],
    ["road_tests", roadTestRecords],
  ]) {
    const invalid = Object.keys(data[field]).find((id) => !Object.hasOwn(records, id));
    if (invalid !== undefined) throw new Error(`Backup field ${field} has an invalid entry for "${invalid}".`);
  }
  const store = storage || globalThis.localStorage;
  const keys = [PRACTICE_KEY, ROAD_TEST_KEY];
  const previous = keys.map((key) => store.getItem(key));
  const next = [JSON.stringify(practiceRecords), JSON.stringify(roadTestRecords)];
  // Do not rewrite identical backups or prompt when the only stored data belongs to an empty record set.
  if (
    previous.some((raw, i) => raw !== next[i] && raw !== null && !/^(?:\s*|\s*\{\s*\}\s*)$/.test(raw)) &&
    !confirmReplace()
  )
    return null;
  try {
    for (const [i, key] of keys.entries()) {
      if (next[i] !== previous[i]) store.setItem(key, next[i]);
    }
  } catch (error) {
    // A failed Web Storage write leaves its own key intact. Restore any key that changed.
    for (const [i, key] of keys.entries()) {
      if (store.getItem(key) === previous[i]) continue;
      if (previous[i] === null) store.removeItem(key);
      else store.setItem(key, previous[i]);
    }
    throw error;
  }
  return {
    practice: practiceRecords,
    roadTests: roadTestRecords,
    practiceCount: Object.keys(practiceRecords).length,
    roadTestCount: Object.keys(roadTestRecords).length,
    available: true,
  };
}

export function resetPractice(storage) {
  try {
    const store = storage || globalThis.localStorage;
    const practice = store.getItem(PRACTICE_KEY);
    store.removeItem(PRACTICE_KEY);
    try {
      store.removeItem(ROAD_TEST_KEY);
    } catch {
      if (practice !== null) store.setItem(PRACTICE_KEY, practice);
      return { available: false };
    }
    return { available: true };
  } catch {
    return { available: false };
  }
}
