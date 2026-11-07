import { failures } from "../bench/metrics.js";

export const PRACTICE_KEY = "jev-fsd-practice-v1";
const CITIES = { kitsilano: "Vancouver", mount_pleasant: "Vancouver", victoria: "Victoria", toronto: "Toronto",
  montreal: "Montréal", calgary: "Calgary", ottawa: "Ottawa", quebec_city: "Québec City", halifax: "Halifax",
  winnipeg: "Winnipeg", edmonton: "Edmonton", saskatoon: "Saskatoon" };
const normalize = value => String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const finite = value => Number.isFinite(value) && value >= 0;
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const version = challenge => challenge.version || 1;
const counterKeys = ["collisions", "red_lights", "stop_signs", "failed_to_yield", "off_road_s", "resets"];

export function challengeCity(challenge) { return CITIES[challenge.map] || challenge.map.replaceAll("_", " "); }

export function practiceStatus(challenge, records = {}) {
  const record = Object.hasOwn(records, challenge.id) ? records[challenge.id] : null;
  if (!record || record.version !== version(challenge)) return "untried";
  return record.completed ? "completed" : "attempted";
}

export function filterChallenges(challenges, filters = {}, records = {}) {
  const terms = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  return challenges.filter(c => {
    const haystack = normalize([c.title, c.description, c.lesson, c.street, challengeCity(c), c.map].join(" "));
    return terms.every(term => haystack.includes(term))
      && (!filters.city || challengeCity(c) === filters.city)
      && (!filters.skill || c.difficulty === filters.skill)
      && (!filters.weather || c.weather === filters.weather)
      && (!filters.progress || practiceStatus(c, records) === filters.progress);
  });
}

// Progress is compact and independent of the last twenty full drive reports.
export function readPractice(storage) {
  let raw;
  try { raw = (storage || globalThis.localStorage).getItem(PRACTICE_KEY); }
  catch { return { records: {}, available: false }; }
  let parsed;
  try { parsed = JSON.parse(raw || "{}"); } catch { parsed = {}; }
  const valid = r => r && Number.isInteger(r.version) && r.version > 0 && Number.isInteger(r.attempts) && r.attempts > 0
    && typeof r.completed === "boolean" && (r.best_score === null || finite(r.best_score) && r.best_score <= 100)
    && date(r.last_at);
  const records = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed).filter(([id, r]) => /^[a-z0-9-]+$/.test(id) && valid(r))
      .map(([id, r]) => [id, { version: r.version, attempts: r.attempts, completed: r.completed, best_score: r.best_score, last_at: r.last_at }])) : {};
  return { records, available: true };
}

// A coaching grade is not a pass. Only the unchanged authored manual drive can earn progress.
export function practiceOutcome(challenge, report) {
  if (!report || report.driver !== "manual" || report.branched !== false || report.modified !== false
    || !["arrived", "finished"].includes(report.status) || !date(report.started_at)
    || !counterKeys.every(key => finite(report[key])) || report.resets !== 0) return null;
  const expected = { version: version(challenge), challenge: challenge.id, map: challenge.map, seed: challenge.seed,
    weather: challenge.weather, time: challenge.time, traffic: 0, car: "compact", clock: 0 };
  if (!Object.entries(expected).every(([key, value]) => report.config?.[key] === value)) return null;
  const metrics = { ...report, arrived: report.status === "arrived",
    ...(challenge.park ? { parked: report.parking?.result === "parked" && report.parking.within_kerb === true } : {}) };
  return failures(metrics).length ? "attempted" : "completed";
}

export function savePractice(challenge, report, storage) {
  const state = readPractice(storage), outcome = practiceOutcome(challenge, report);
  if (!outcome) return { ...state, outcome };
  const previous = practiceStatus(challenge, state.records) === "untried" ? null : state.records[challenge.id];
  if (previous?.last_at === report.started_at) return { ...state, outcome };
  const score = outcome === "completed" && finite(report.score) && report.score <= 100 ? report.score : null;
  state.records[challenge.id] = { version: version(challenge), attempts: (previous?.attempts || 0) + 1,
    completed: outcome === "completed" || !!previous?.completed,
    best_score: score === null ? previous?.best_score ?? null : Math.max(score, previous?.best_score ?? 0), last_at: report.started_at };
  try { (storage || globalThis.localStorage).setItem(PRACTICE_KEY, JSON.stringify(state.records)); state.available = true; }
  catch { state.available = false; }
  return { ...state, outcome };
}
