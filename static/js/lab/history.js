import { failures, DECIDED_BY, decidedByTotals, decidedByCounts } from "../bench/metrics.js";
import { compatibleSuiteVersions, CUSTOM_SUITE, LEGACY_SUITE } from "../bench/suite-version.js";
import { FEATURE_METRICS } from "../sim/features/index.js";
import { hashText } from "../brain/recording.js";

// (v3: decisions no event links to are compact, and repeats are folded together: lab/trace.js)
export const EVALUATION_SCHEMA = "jev-agent-evaluation-v3";
const SCHEMAS = ["jev-agent-evaluation-v1", "jev-agent-evaluation-v2", EVALUATION_SCHEMA];
export const EVALUATION_HISTORY_KEY = "jev-fsd-evaluations-v2";
// Bound the cost of decoding and parsing a single chosen file separately from saved history.
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
// Saved history, counted as UTF-16 (two bytes a character, see saveEvaluation): about 4.7 million
// characters of JSON, room for a baseline and a new run of every challenge (some 0.98 million each with
// 26 challenges and two drivers, now that compact decisions are folded together), inside the 5 million
// or so characters of ASCII that browsers allow an origin. A browser that allows less reports
// QuotaExceededError, and older runs are dropped.
const MAX_HISTORY_BYTES = 9 * 1024 * 1024;
const CONDITIONS = {
  version: "challenge version",
  map: "map",
  pack: "map-pack version",
  seed: "seed",
  weather: "weather",
  time: "time of day",
  car: "vehicle",
  mode: "decision clock",
  limit_s: "time limit",
};
const COUNTERS = ["collisions", "red_lights", "stop_signs", "failed_to_yield", "hard_brakes"];
const MEASUREMENTS = ["time_s", "off_road_s", "cost_usd"];
const AUDITS = [
  "deadlocks",
  "amber_lights_run",
  "plow_right_passes",
  "merge_cut_ins",
  "close_passes",
  "bus_lane_driving",
  ...FEATURE_METRICS.map(({ name }) => name),
];
const text = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 240;
const finite = (value) => Number.isFinite(value) && value >= 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const optional = (value, valid) => value === undefined || valid(value);

// A recorded decision's flags, error and snapshots. Up to v2 every decision has them all (`state` and
// `candidates` null only when no event links to it). From v3 one no event links to may instead be a
// compact choice record (lab/trace.js), with no `context_recorded` or snapshots, its flags and error
// only when it has them, and, standing for a run of the same choice, how many it stands for and when
// the last was made.
function validDecision(d, compactAllowed) {
  if (compactAllowed && d.context_recorded === undefined) {
    return (
      d.state === undefined &&
      d.candidates === undefined &&
      (d.error === undefined || text(d.error)) &&
      (d.flags === undefined ||
        (Array.isArray(d.flags) && d.flags.length > 0 && d.flags.length <= 20 && d.flags.every(text))) &&
      (d.repeats === undefined
        ? d.until_s === undefined
        : Number.isSafeInteger(d.repeats) && d.repeats > 1 && finite(d.until_s) && d.until_s >= d.at_s)
    );
  }
  return (
    d.repeats === undefined &&
    d.until_s === undefined &&
    Array.isArray(d.flags) &&
    d.flags.length <= 20 &&
    d.flags.every(text) &&
    (d.error == null || typeof d.error === "string") &&
    typeof d.context_recorded === "boolean" &&
    (d.state === null ? !d.context_recorded : record(d.state)) &&
    (d.candidates === null
      ? !d.context_recorded
      : Array.isArray(d.candidates) &&
        d.candidates.length <= 100 &&
        d.candidates.every(
          (c) =>
            record(c) &&
            text(c.id) &&
            typeof c.eligible === "boolean" &&
            (c.reject === null || text(c.reject)) &&
            (c.target_mps === null || finite(c.target_mps)),
        ))
  );
}

// Imports are data only. Validate before replacing the current view or saved history.
export function validateEvaluation(value) {
  if (!value || !SCHEMAS.includes(value.schema))
    throw new Error("Choose a Jev agent evaluation JSON export (v1, v2 or v3).");
  if (
    !Number.isSafeInteger(value.challenge_version) ||
    value.challenge_version < 1 ||
    !Array.isArray(value.results) ||
    !value.results.length ||
    value.results.length > 300 ||
    !text(value.created_at) ||
    !Number.isFinite(Date.parse(value.created_at))
  )
    throw new Error("The evaluation has invalid dates, versions or results.");
  if (value.suite_version !== undefined && ![LEGACY_SUITE, CUSTOM_SUITE].includes(value.suite_version))
    throw new Error("The evaluation has an unknown suite version.");
  const results = value.results.map((r, index) => {
    if (r?.suite_version !== value.suite_version) throw new Error("The evaluation disagrees on suite version.");
    if (
      !record(r) ||
      !["challenge", "map", "brain", "weather", "time", "car"].every((k) => text(r[k])) ||
      !["lockstep", "realtime"].includes(r.mode) ||
      !Number.isSafeInteger(r.version) ||
      r.version < 1 ||
      !Number.isSafeInteger(r.seed) ||
      (!(Number.isSafeInteger(r.pack) && r.pack >= 0) && !text(r.pack)) ||
      !COUNTERS.every((k) => count(r[k])) ||
      !MEASUREMENTS.every((k) => finite(r[k])) ||
      !AUDITS.every((k) => optional(r[k], finite)) ||
      !optional(r.parked, (parked) => typeof parked === "boolean") ||
      !optional(r.trace_truncated, (truncated) => typeof truncated === "boolean") ||
      typeof r.arrived !== "boolean" ||
      typeof r.stopped !== "boolean" ||
      (r.latency_p50_ms !== null && !finite(r.latency_p50_ms)) ||
      // (who decided, reported for every driver but Rules: bench/metrics.js)
      (DECIDED_BY.some((k) => r[k] !== undefined) &&
        !(
          DECIDED_BY.every((k) => count(r[k])) &&
          r.partial_decisions <= r.model_decisions &&
          ["model_share", "local_share", "fallback_share"].every((k) => r[k] === null || (finite(r[k]) && r[k] <= 1))
        )) ||
      !record(r.report) ||
      !finite(r.report.score) ||
      r.report.score > 100 ||
      typeof r.report.qualified !== "boolean" ||
      (r.simulation_error !== undefined && !text(r.simulation_error)) ||
      // (an open-track drive, brain/tracks.js: bench/metrics.js trackFields)
      (r.track === undefined
        ? r.flagged_choices !== undefined || r.flagged_by_check !== undefined
        : !(
            r.track === "open" &&
            count(r.flagged_choices) &&
            record(r.flagged_by_check) &&
            Object.keys(r.flagged_by_check).every(text) &&
            Object.values(r.flagged_by_check).every(count) &&
            Object.values(r.flagged_by_check).reduce((a, n) => a + n, 0) === r.flagged_choices
          )) ||
      r.report.status !== (r.simulation_error ? "error" : r.stopped ? "stopped" : r.arrived ? "arrived" : "timeout") ||
      !Number.isSafeInteger(r.report.model_version) ||
      r.report.model_version < 1 ||
      !Array.isArray(r.report.incidents) ||
      r.report.incidents.length > 100 ||
      r.report.incidents.some((e) => !record(e) || !finite(e.at_s) || !text(e.type) || !text(e.message))
    )
      throw new Error(`The export contains an invalid evaluation result at attempt ${index + 1}.`);
    if (value.schema !== SCHEMAS[0] && (!finite(r.limit_s) || r.limit_s === 0 || !text(r.engine_version)))
      throw new Error(`The export is missing its evaluation conditions at attempt ${index + 1}.`);
    if (
      r.decisions_trace !== undefined &&
      (!Array.isArray(r.decisions_trace) ||
        r.decisions_trace.length > 600 ||
        r.decisions_trace.some(
          (d, i, trace) =>
            !record(d) ||
            !finite(d.at_s) ||
            (i > 0 && d.at_s < (trace[i - 1].until_s ?? trace[i - 1].at_s)) ||
            !Number.isSafeInteger(d.id) ||
            (i > 0 && d.id <= trace[i - 1].id) ||
            d.id < 1 ||
            !text(d.source) ||
            !["drive", "stop", "reverse"].includes(d.motion) ||
            !(d.chosen_id === null || text(d.chosen_id)) ||
            !optional(d.headlights, text) ||
            !validDecision(d, value.schema === EVALUATION_SCHEMA),
        ))
    )
      throw new Error(`The export contains an invalid decision trace at attempt ${index + 1}.`);
    const contextTimes = new Map(
      (r.decisions_trace || []).filter((d) => d.context_recorded).map((d) => [d.id, d.at_s]),
    );
    if (
      r.events !== undefined &&
      (!Array.isArray(r.events) ||
        r.events.length > 1000 ||
        r.events.some(
          (e, i, events) =>
            !record(e) ||
            !finite(e.at_s) ||
            (i > 0 && e.at_s < events[i - 1].at_s) ||
            !text(e.type) ||
            !text(e.message) ||
            !(e.decision_id === null || contextTimes.get(e.decision_id) <= e.at_s) ||
            !(value.schema === EVALUATION_SCHEMA
              ? e.decision_id === null
                ? e.decision_age_s === null
                : finite(e.decision_age_s)
              : e.decision_age_s === null || finite(e.decision_age_s)) ||
            !optional(e.count, (n) => count(n) && n > 0),
        ))
    )
      throw new Error(`The export contains an invalid incident timeline at attempt ${index + 1}.`);
    const f = failures(r);
    // (an import's shares are derived from its validated counts, so a row and the summary agree)
    const decided =
      r.model_decisions === undefined
        ? {}
        : decidedByCounts({
            model: r.model_decisions,
            partial: r.partial_decisions,
            local: r.local_decisions,
            fallback: r.fallback_decisions,
          });
    return { ...r, ...decided, failures: f, pass: !r.stopped && f.length === 0 };
  });
  return {
    schema: value.schema,
    ...(value.suite_version === undefined ? {} : { suite_version: value.suite_version }),
    challenge_version: value.challenge_version,
    created_at: value.created_at,
    status: ["complete", "stopped", "error", "imported"].includes(value.status) ? value.status : "imported",
    results,
  };
}

function evaluationKey(value) {
  try {
    return JSON.stringify(validateEvaluation(value));
  } catch {
    return null;
  }
}

const LOCAL_RUNS = 10;
function parseFallback(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const valid = [];
  for (const run of parsed) {
    try {
      valid.push(validateEvaluation(run));
    } catch {
      continue;
    }
    if (valid.length === LOCAL_RUNS) break;
  }
  return valid;
}

export function readEvaluations(storage) {
  try {
    storage ||= globalThis.localStorage;
    return parseFallback(storage.getItem(EVALUATION_HISTORY_KEY));
  } catch {
    return [];
  }
}

// Saves `run` first in the history, dropping the oldest runs to fit; `keep` (a saved run, such as the
// chosen baseline) is dropped only when nothing else is left to drop.
export function saveEvaluation(run, storage, keep = null) {
  const validated = validateEvaluation(run);
  storage ||= globalThis.localStorage;
  const old = parseFallback(storage.getItem(EVALUATION_HISTORY_KEY)),
    runs = [validated, ...old],
    keepJson = evaluationKey(keep),
    kept = old.find((r) => keepJson !== null && JSON.stringify(r) === keepJson);
  const drop = () => {
    const i = runs.findLastIndex((r, k) => k > 0 && r !== kept);
    runs.splice(i > 0 ? i : runs.length - 1, 1);
  };
  if (runs.length > LOCAL_RUNS) drop();
  let json = JSON.stringify(runs);
  const bytes = () => Math.max(json.length * 2, new Blob([json]).size); // localStorage can account for UTF-16 strings.
  while (runs.length > 1 && bytes() > MAX_HISTORY_BYTES) {
    drop();
    json = JSON.stringify(runs);
  }
  if (bytes() > MAX_HISTORY_BYTES)
    throw new Error("This evaluation is too large for browser history. Export it to keep a copy.");
  for (;;) {
    try {
      storage.setItem(EVALUATION_HISTORY_KEY, json);
      break;
    } catch (error) {
      if (!["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error?.name) || runs.length === 1) throw error;
      drop();
      json = JSON.stringify(runs);
    }
  }
  return runs;
}

// Saved arena history lives in IndexedDB, where a run of every challenge (some 3.7 MB each with 60
// challenges and two drivers) is not bound by localStorage's few megabytes. The newest
// MAX_SAVED_RUNS runs are kept within MAX_SAVED_BYTES of JSON; older ones are dropped first, and a
// browser quota (QuotaExceededError) drops more. Where IndexedDB is missing or throws (private
// windows, blocked storage, Node), the store falls back to localStorage and its 9 MB cap above.
// History saved in localStorage before is moved into IndexedDB once, and its key removed.
export const EVALUATION_DB = "jev-fsd-arena";
export const MAX_SAVED_RUNS = 20;
export const MAX_SAVED_BYTES = 200 * 1024 * 1024;
const RUNS = "evaluations",
  INDEX = "evaluation-index", // (the index holds { id, created_at, bytes, ... }, cheap to list)
  META = "metadata",
  LAST_ID = "last-id",
  MIGRATED = "migrated-fallback-copies";
const OPEN_TIMEOUT_MS = 5000;
const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // A request error bubbles before the transaction aborts and sets tx.error.
    tx.onabort = () => reject(tx.error || new DOMException("The transaction was aborted.", "AbortError"));
  });
const sameSummary = (a, b) =>
  a.created_at === b.created_at && a.status === b.status && a.count === b.count && a.bytes === b.bytes;
const summary = (run, bytes) => ({ created_at: run.created_at, status: run.status, count: run.results.length, bytes });
// Where an index entry sits in the history: the `order` a migration gave it (ids are never reused, so
// they cannot place a moved run among older saved ones), or else its id. Orders stay below later ids.
const position = (entry) => (Number.isFinite(entry.order) ? entry.order : entry.id);

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(EVALUATION_DB, 2);
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      reject(new Error("IndexedDB did not open."));
    }, OPEN_TIMEOUT_MS);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS);
      if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    open.onsuccess = () => {
      clearTimeout(timer);
      const db = open.result;
      if (late) {
        db.close();
        return;
      } // (the page went on with the localStorage history)
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => {
      clearTimeout(timer);
      reject(open.error);
    };
    open.onblocked = () => {
      clearTimeout(timer);
      late = true;
      reject(new Error("IndexedDB is blocked."));
    };
  });
}

// An origin-wide lock keeps a fallback tab's read and write together during migration.
function withFallbackLock(operation) {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(EVALUATION_HISTORY_KEY, operation) : operation();
}

// The pre-IndexedDB history, newest first, as a store with the same interface.
function localHistory(storage) {
  const local = () => storage || globalThis.localStorage;
  return {
    kind: "localStorage",
    limit: LOCAL_RUNS,
    async list() {
      return readEvaluations(storage);
    },
    async save(run, keep = null) {
      return withFallbackLock(() => saveEvaluation(run, storage, keep));
    },
    async remove(run) {
      return withFallbackLock(() => {
        const runs = parseFallback(local().getItem(EVALUATION_HISTORY_KEY)),
          json = evaluationKey(run),
          at = json === null ? -1 : runs.findIndex((r) => JSON.stringify(r) === json);
        if (at === -1) return runs;
        const remaining = runs.filter((_, k) => k !== at);
        if (!remaining.length) local().removeItem(EVALUATION_HISTORY_KEY);
        else local().setItem(EVALUATION_HISTORY_KEY, JSON.stringify(remaining));
        return remaining;
      });
    },
  };
}

function databaseHistory(db, { maxRuns, maxBytes }) {
  let entries = []; // { id, run }, newest first
  const ids = new WeakMap();
  const runs = () => entries.map((e) => e.run);
  let started = 0,
    rendered = 0;
  const sorted = (index) =>
    index
      .filter((entry) => Number.isSafeInteger(entry?.id) && entry.id > 0)
      .sort((a, b) => position(b) - position(a) || b.id - a.id);

  async function list() {
    const sequence = ++started;
    try {
      const tx = db.transaction([INDEX, RUNS], "readonly");
      const done = finished(tx);
      const loaded = (async () => {
        const index = sorted(await request(tx.objectStore(INDEX).getAll()));
        const known = new Map(entries.map((e) => [e.id, e.run]));
        const missing = index.filter((i) => !known.has(i.id));
        const store = tx.objectStore(RUNS);
        const records = await Promise.all(missing.map((i) => request(store.get(i.id))));
        missing.forEach((i, k) => {
          try {
            if (records[k]) known.set(i.id, validateEvaluation(records[k]));
          } catch {
            /* a damaged record is left out */
          }
        });
        return index.filter((i) => known.has(i.id)).map((i) => ({ id: i.id, run: known.get(i.id) }));
      })();
      const [snapshot] = await Promise.all([loaded, done]);
      if (sequence >= rendered) {
        rendered = sequence;
        entries = snapshot;
        for (const e of entries) ids.set(e.run, e.id);
      }
    } catch {
      /* a temporary read failure leaves the last successful snapshot visible */
    }
    return runs();
  }

  const keepId = (keep) => {
    if (!keep) return null;
    if (ids.has(keep)) return ids.get(keep);
    const json = evaluationKey(keep);
    return json === null ? null : (entries.find((e) => JSON.stringify(e.run) === json)?.id ?? null);
  };
  return {
    kind: "indexedDB",
    limit: maxRuns,
    list,
    // Saves `run` as the newest, dropping the oldest runs to keep within the limits; `keep` (a saved
    // run, such as the chosen baseline) is dropped only when nothing else is left to drop. Drops and
    // the write are one transaction, so a failed save leaves the history as it was.
    async save(run, keep = null) {
      const validated = validateEvaluation(run),
        json = JSON.stringify(validated),
        bytes = new Blob([json]).size;
      if (bytes > maxBytes)
        throw new Error("This evaluation is too large for browser history. Export it to keep a copy.");
      const kept = keepId(keep);
      for (let extra = 0; ; extra++) {
        const tx = db.transaction([RUNS, INDEX, META], "readwrite"),
          store = tx.objectStore(RUNS),
          index = tx.objectStore(INDEX),
          metadata = tx.objectStore(META),
          done = finished(tx);
        done.catch(() => {
          /* reported below */
        });
        let after,
          left = 0;
        try {
          const [stored, lastId] = await Promise.all([request(index.getAll()), request(metadata.get(LAST_ID))]);
          const old = sorted(stored);
          // (never an id used before, even after the newest run is deleted: another tab may still map the
          // old id to the run it named, and would delete the new one in its place)
          const id = old.reduce((max, i) => Math.max(max, i.id), count(lastId) ? lastId : 0) + 1;
          if (!Number.isSafeInteger(id)) throw new Error("Evaluation history has exhausted its record IDs.");
          const drop = new Set();
          const droppable = () =>
            old.findLast((i) => !drop.has(i.id) && i.id !== kept) || old.findLast((i) => !drop.has(i.id));
          const total = () => old.reduce((sum, i) => sum + (drop.has(i.id) ? 0 : i.bytes), bytes);
          while (old.length > drop.size && (old.length - drop.size + 1 > maxRuns || total() > maxBytes))
            drop.add(droppable().id);
          // (after the browser's quota refused the write `extra` times, as many more of the oldest)
          for (let k = 0; k < extra && old.length > drop.size; k++) drop.add(droppable().id);
          left = old.length - drop.size;
          for (const key of drop) {
            store.delete(key);
            index.delete(key);
          }
          store.put(validated, id);
          index.put({ id, ...summary(validated, bytes) });
          metadata.put(id, LAST_ID);
          after = [{ id, ...summary(validated, bytes) }, ...old.filter((i) => !drop.has(i.id))];
          await done;
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
          await done.catch(() => {});
          if (error?.name === "QuotaExceededError" && left > 0) continue;
          throw error;
        }
        rendered = started + 1;
        ids.set(validated, after[0].id);
        entries = [{ id: after[0].id, run: validated }, ...entries.filter((e) => after.some((i) => i.id === e.id))];
        return list();
      }
    },
    async remove(run) {
      const id = keepId(run);
      if (id != null) {
        const tx = db.transaction([RUNS, INDEX, META], "readwrite"),
          metadata = tx.objectStore(META),
          done = finished(tx);
        await Promise.all([
          request(metadata.get(LAST_ID)).then((lastId) => {
            tx.objectStore(RUNS).delete(id);
            tx.objectStore(INDEX).delete(id);
            // Version 1 histories may still contain ids that predate the counter.
            if (!count(lastId) || id > lastId) metadata.put(id, LAST_ID);
          }),
          done,
        ]);
        rendered = started + 1;
        entries = entries.filter((entry) => entry.id !== id);
      }
      return list();
    },
  };
}

// Moves the localStorage history into the database, leaving out runs already there (a move interrupted
// before the key was removed), then removes the key. The fallback runs and the saved ones are put in the
// order they were created, so the limits drop the oldest runs, not the moved ones. Each kept run's
// `order` records its place, leaving every saved run's id as it is; later saves take higher ids.
async function migrate(db, storage, { maxRuns, maxBytes }) {
  let raw;
  try {
    storage ||= globalThis.localStorage;
    raw = storage.getItem(EVALUATION_HISTORY_KEY);
  } catch {
    return;
  }
  if (raw == null) return;
  const legacy = parseFallback(raw);
  if (legacy.length) {
    if (legacy.some((run) => new Blob([JSON.stringify(run)]).size > maxBytes))
      throw new Error("A saved evaluation exceeds the IndexedDB history budget.");
    const tx = db.transaction([RUNS, INDEX, META], "readwrite"),
      store = tx.objectStore(RUNS),
      index = tx.objectStore(INDEX),
      metadata = tx.objectStore(META),
      done = finished(tx);
    done.catch(() => {
      /* reported below */
    });
    try {
      const [old, lastId, migrated] = await Promise.all([
        request(index.getAll()),
        request(metadata.get(LAST_ID)),
        request(metadata.get(MIGRATED)),
      ]);
      const pending = [...legacy].reverse().map((run) => {
        const json = JSON.stringify(run);
        return { run, key: hashText(json), entry: summary(run, new Blob([json]).size) };
      });
      const matching = old.filter((entry) => pending.some((p) => sameSummary(p.entry, entry)));
      const copies = new Map();
      for (const saved of await Promise.all(matching.map((entry) => request(store.get(entry.id))))) {
        if (!saved) continue;
        const key = hashText(JSON.stringify(saved));
        copies.set(key, (copies.get(key) ?? 0) + 1);
      }
      // A fallback tab may still hold copies that were deleted or evicted in IndexedDB.
      if (Array.isArray(migrated))
        for (const pair of migrated)
          if (Array.isArray(pair) && text(pair[0]) && count(pair[1]))
            copies.set(pair[0], Math.max(copies.get(pair[0]) ?? 0, pair[1]));
      const previous = old.reduce((max, i) => Math.max(max, i.id), count(lastId) ? lastId : 0);
      const occurrences = new Map();
      const moving = [];
      for (const { run, key, entry } of pending) {
        occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
        const count = copies.get(key) ?? 0;
        if (count) {
          copies.set(key, count - 1);
          continue;
        }
        moving.push({ run, entry });
      }
      // Oldest first by creation time (a tie keeps the saved runs' order, then the fallback runs' order).
      const created = (item) => {
        const time = Date.parse((item.saved ?? item.entry).created_at);
        return Number.isFinite(time) ? time : -Infinity;
      };
      const saved = old.sort((a, b) => position(a) - position(b) || a.id - b.id);
      const combined = [...saved.map((entry) => ({ saved: entry })), ...moving].sort(
        (a, b) => created(a) - created(b) || 0,
      );
      let bytes = combined.reduce((total, item) => total + (item.saved ?? item.entry).bytes, 0);
      let first = 0;
      while (first < combined.length && (combined.length - first > maxRuns || bytes > maxBytes)) {
        const item = combined[first++];
        bytes -= (item.saved ?? item.entry).bytes;
        if (item.saved) {
          store.delete(item.saved.id);
          index.delete(item.saved.id);
        }
      }
      const kept = combined.slice(first);
      // (each kept run's rank is its position, so repeated moves never need fractions)
      let id = previous;
      kept.forEach((item, rank) => {
        const order = rank + 1;
        if (item.saved) {
          if (position(item.saved) !== order) index.put({ ...item.saved, order });
          return;
        }
        id++;
        if (!Number.isSafeInteger(id)) throw new Error("Evaluation history has exhausted its record IDs.");
        store.put(item.run, id);
        index.put({ id, ...item.entry, order });
      });
      if (id > previous) metadata.put(id, LAST_ID);
      metadata.put([...occurrences], MIGRATED);
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      throw error;
    }
  }
  try {
    // A tab that fell back to localStorage may have saved another run during the move.
    if (storage.getItem(EVALUATION_HISTORY_KEY) === raw) {
      storage.removeItem(EVALUATION_HISTORY_KEY);
      if (storage.getItem(EVALUATION_HISTORY_KEY) === null) {
        const tx = db.transaction(META, "readwrite");
        const done = finished(tx);
        tx.objectStore(META).delete(MIGRATED);
        await done;
      }
    }
  } catch {
    /* moved; the next open skips what is there */
  }
}

// Opens the saved arena history: { kind, limit, list(), save(run, keep), remove(run) }, all async,
// with runs newest first. Never rejects: without a working IndexedDB it is the localStorage history.
export async function openEvaluationHistory({
  indexedDB,
  storage,
  maxRuns = MAX_SAVED_RUNS,
  maxBytes = MAX_SAVED_BYTES,
} = {}) {
  let db;
  try {
    indexedDB ??= globalThis.indexedDB;
    if (!indexedDB) return localHistory(storage);
    maxRuns = count(maxRuns) && maxRuns > 0 ? Math.min(maxRuns, MAX_SAVED_RUNS) : MAX_SAVED_RUNS;
    maxBytes = finite(maxBytes) && maxBytes >= 1 ? Math.min(Math.floor(maxBytes), MAX_SAVED_BYTES) : MAX_SAVED_BYTES;
    db = await openDatabase(indexedDB);
    await withFallbackLock(() => migrate(db, storage, { maxRuns, maxBytes }));
    return databaseHistory(db, { maxRuns, maxBytes });
  } catch {
    try {
      db?.close();
    } catch {
      /* closing is best effort */
    }
    return localHistory(storage);
  }
}

export function conditionDifferences(a, b) {
  const differences = Object.entries(CONDITIONS)
    .filter(([k]) => a[k] == null || b[k] == null || a[k] !== b[k])
    .map(([, label]) => label);
  if (!compatibleSuiteVersions(a, b)) differences.push("suite version");
  if (!a.engine_version || !b.engine_version || a.engine_version !== b.engine_version)
    differences.push("simulation version");
  // (the guarded and open tracks are different conditions: brain/tracks.js)
  if ((a.track ?? "guarded") !== (b.track ?? "guarded")) differences.push("track");
  if (
    a.report?.model_version == null ||
    b.report?.model_version == null ||
    a.report.model_version !== b.report.model_version
  )
    differences.push("scoring version");
  return differences;
}

export function compareResult(result, baseline, brain) {
  if (!Array.isArray(baseline?.results)) return { reasons: ["no baseline results"] };
  const candidates = baseline.results.filter((r) => r.challenge === result.challenge && r.brain === brain);
  if (!candidates.length) return { reasons: ["challenge absent from baseline"] };
  const conditions = candidates.map((r) => ({ before: r, reasons: conditionDifferences(result, r) }));
  const matches = conditions.filter(({ reasons }) => !reasons.length);
  if (matches.length > 1) return { reasons: ["duplicate baseline results"] };
  if (!matches.length) {
    return { reasons: conditions.sort((a, b) => a.reasons.length - b.reasons.length)[0].reasons };
  }
  const { before } = matches[0];
  if (result.stopped || before.stopped) return { reasons: ["stopped attempt"] };
  if (result.simulation_error || before.simulation_error) return { reasons: ["simulation error"] };
  return { before, reasons: [] };
}

export const incidentCount = (r) => r.collisions + r.red_lights + r.stop_signs + r.failed_to_yield;
export function summarizeResults(results) {
  const mean = (key) => {
    const values = results.map((r) => r[key]).filter(Number.isFinite);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  return {
    count: results.length,
    pass_rate: results.length ? results.filter((r) => r.pass && !r.stopped).length / results.length : 0,
    incidents: results.reduce((sum, r) => sum + incidentCount(r), 0),
    hard_brakes: results.reduce((sum, r) => sum + r.hard_brakes, 0),
    latency_p50_ms: mean("latency_p50_ms"),
    cost_usd: results.reduce((sum, r) => sum + r.cost_usd, 0),
    ...decidedByTotals(results),
  };
}
