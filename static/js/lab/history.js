import { failures, DECIDED_BY, decidedByTotals, decidedByCounts } from "../bench/metrics.js";

// (v3: decisions no event links to are compact, and repeats are folded together: lab/trace.js)
export const EVALUATION_SCHEMA = "jev-agent-evaluation-v3";
const SCHEMAS = ["jev-agent-evaluation-v1", "jev-agent-evaluation-v2", EVALUATION_SCHEMA];
export const EVALUATION_HISTORY_KEY = "jev-fsd-evaluations-v2";
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
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
const COUNTERS = [
  "time_s",
  "collisions",
  "red_lights",
  "stop_signs",
  "failed_to_yield",
  "off_road_s",
  "hard_brakes",
  "cost_usd",
];
const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 240;
const finite = (value) => Number.isFinite(value) && value >= 0;

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
        : Number.isInteger(d.repeats) && d.repeats > 1 && finite(d.until_s) && d.until_s >= d.at_s)
    );
  }
  return (
    d.repeats === undefined &&
    d.until_s === undefined &&
    Array.isArray(d.flags) &&
    d.flags.length <= 20 &&
    d.flags.every(text) &&
    typeof d.context_recorded === "boolean" &&
    (d.state === null ? !d.context_recorded : !!d.state && typeof d.state === "object" && !Array.isArray(d.state)) &&
    (d.candidates === null
      ? !d.context_recorded
      : Array.isArray(d.candidates) &&
        d.candidates.length <= 100 &&
        d.candidates.every(
          (c) =>
            c &&
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
    !Number.isInteger(value.challenge_version) ||
    value.challenge_version < 1 ||
    !Array.isArray(value.results) ||
    !value.results.length ||
    value.results.length > 300 ||
    !text(value.created_at) ||
    !Number.isFinite(Date.parse(value.created_at))
  )
    throw new Error("The evaluation has invalid dates, versions or results.");
  const results = value.results.map((r) => {
    if (
      !r ||
      !["challenge", "map", "brain", "weather", "time", "car"].every((k) => text(r[k])) ||
      !["lockstep", "realtime"].includes(r.mode) ||
      !Number.isInteger(r.version) ||
      r.version < 1 ||
      !Number.isInteger(r.seed) ||
      r.pack == null ||
      !["string", "number"].includes(typeof r.pack) ||
      !COUNTERS.every((k) => finite(r[k])) ||
      typeof r.arrived !== "boolean" ||
      typeof r.stopped !== "boolean" ||
      (r.latency_p50_ms !== null && !finite(r.latency_p50_ms)) ||
      // (who decided, reported for every driver but Rules: bench/metrics.js)
      (r.model_decisions !== undefined &&
        !(
          DECIDED_BY.every((k) => Number.isInteger(r[k]) && r[k] >= 0) &&
          ["model_share", "local_share", "fallback_share"].every((k) => r[k] === null || (finite(r[k]) && r[k] <= 1))
        )) ||
      !r.report ||
      !finite(r.report.score) ||
      r.report.score > 100 ||
      typeof r.report.qualified !== "boolean" ||
      (r.simulation_error !== undefined && !text(r.simulation_error)) ||
      // (an open-track drive, brain/tracks.js: bench/metrics.js trackFields)
      (r.track === undefined
        ? r.flagged_choices !== undefined || r.flagged_by_check !== undefined
        : !(
            r.track === "open" &&
            Number.isInteger(r.flagged_choices) &&
            r.flagged_by_check &&
            typeof r.flagged_by_check === "object" &&
            !Array.isArray(r.flagged_by_check) &&
            Object.values(r.flagged_by_check).every((n) => Number.isInteger(n) && n >= 0) &&
            Object.values(r.flagged_by_check).reduce((a, n) => a + n, 0) === r.flagged_choices
          )) ||
      r.report.status !== (r.simulation_error ? "error" : r.stopped ? "stopped" : r.arrived ? "arrived" : "timeout") ||
      !Number.isInteger(r.report.model_version) ||
      !Array.isArray(r.report.incidents) ||
      r.report.incidents.length > 100 ||
      r.report.incidents.some((e) => !e || !finite(e.at_s) || !text(e.type) || !text(e.message))
    )
      throw new Error("The export contains an invalid evaluation result.");
    if (value.schema !== SCHEMAS[0] && (!finite(r.limit_s) || r.limit_s === 0 || !text(r.engine_version)))
      throw new Error("The export is missing its evaluation conditions.");
    if (
      r.decisions_trace !== undefined &&
      (!Array.isArray(r.decisions_trace) ||
        r.decisions_trace.length > 600 ||
        r.decisions_trace.some(
          (d) =>
            !d ||
            !finite(d.at_s) ||
            !Number.isInteger(d.id) ||
            d.id < 1 ||
            !text(d.source) ||
            !["drive", "stop", "reverse"].includes(d.motion) ||
            !(d.chosen_id === null || text(d.chosen_id)) ||
            !validDecision(d, value.schema === EVALUATION_SCHEMA),
        ) ||
        new Set(r.decisions_trace.map((d) => d.id)).size !== r.decisions_trace.length)
    )
      throw new Error("The export contains an invalid decision trace.");
    if (
      r.events !== undefined &&
      (!Array.isArray(r.events) ||
        r.events.length > 1000 ||
        r.events.some(
          (e) =>
            !e ||
            !finite(e.at_s) ||
            !text(e.type) ||
            !text(e.message) ||
            !(
              e.decision_id === null ||
              r.decisions_trace?.some((d) => d.id === e.decision_id && d.at_s <= e.at_s && d.context_recorded)
            ) ||
            !(e.decision_age_s === null || finite(e.decision_age_s)),
        ))
    )
      throw new Error("The export contains an invalid incident timeline.");
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
    challenge_version: value.challenge_version,
    created_at: value.created_at,
    status: ["complete", "stopped", "error", "imported"].includes(value.status) ? value.status : "imported",
    results,
  };
}

export function readEvaluations(storage) {
  try {
    storage ||= globalThis.localStorage;
    const raw = JSON.parse(storage.getItem(EVALUATION_HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 10).flatMap((run) => {
      try {
        return [validateEvaluation(run)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

// Saves `run` first in the history, dropping the oldest runs to fit; `keep` (a saved run, such as the
// chosen baseline) is dropped only when nothing else is left to drop.
export function saveEvaluation(run, storage, keep = null) {
  const validated = validateEvaluation(run);
  storage ||= globalThis.localStorage;
  const runs = [validated, ...readEvaluations(storage)].slice(0, 10);
  const kept = keep ? JSON.stringify(keep) : null;
  const drop = () => {
    const i = runs.findLastIndex((r, k) => k > 0 && JSON.stringify(r) !== kept);
    runs.splice(i > 0 ? i : runs.length - 1, 1);
  };
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
      if (error.name !== "QuotaExceededError" || runs.length === 1) throw error;
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
  INDEX = "evaluation-index"; // (the index holds { id, created_at, bytes, ... }, cheap to list)
const OPEN_TIMEOUT_MS = 5000;
const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new DOMException("The transaction was aborted.", "AbortError"));
  });
const same = (a, b) => a.created_at === b.created_at && a.status === b.status && a.count === b.count;
const summary = (run, bytes) => ({ created_at: run.created_at, status: run.status, count: run.results.length, bytes });

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(EVALUATION_DB, 1);
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      reject(new Error("IndexedDB did not open."));
    }, OPEN_TIMEOUT_MS);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS);
      if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: "id" });
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

// The pre-IndexedDB history, newest first, as a store with the same interface.
function localHistory(storage) {
  const local = () => storage || globalThis.localStorage;
  return {
    kind: "localStorage",
    limit: 10,
    async list() {
      return readEvaluations(storage);
    },
    async save(run, keep = null) {
      return saveEvaluation(run, storage, keep);
    },
    async remove(run) {
      const runs = readEvaluations(storage),
        json = JSON.stringify(run),
        at = runs.findIndex((r) => JSON.stringify(r) === json);
      const remaining = runs.filter((_, k) => k !== at);
      local().setItem(EVALUATION_HISTORY_KEY, JSON.stringify(remaining));
      return remaining;
    },
  };
}

function databaseHistory(db, { maxRuns, maxBytes }) {
  let entries = []; // { id, run }, newest first
  const ids = new WeakMap();
  const runs = () => entries.map((e) => e.run);
  // (the index, newest first, and the runs not yet in memory)
  async function refresh(index) {
    const known = new Map(entries.map((e) => [e.id, e.run])),
      missing = index.filter((i) => !known.has(i.id));
    if (missing.length) {
      const tx = db.transaction(RUNS, "readonly"),
        store = tx.objectStore(RUNS);
      const loaded = await Promise.all(missing.map((i) => request(store.get(i.id))));
      missing.forEach((i, k) => {
        try {
          if (loaded[k]) known.set(i.id, validateEvaluation(loaded[k]));
        } catch {
          /* a damaged record is left out */
        }
      });
    }
    entries = index.filter((i) => known.has(i.id)).map((i) => ({ id: i.id, run: known.get(i.id) }));
    for (const e of entries) ids.set(e.run, e.id);
    return runs();
  }
  const sorted = (index) => index.sort((a, b) => b.id - a.id);
  const readIndex = async () => sorted(await request(db.transaction(INDEX, "readonly").objectStore(INDEX).getAll()));
  const keepId = (keep) => {
    if (!keep) return null;
    if (ids.has(keep)) return ids.get(keep);
    const json = JSON.stringify(keep);
    return entries.find((e) => JSON.stringify(e.run) === json)?.id ?? null;
  };
  return {
    kind: "indexedDB",
    limit: maxRuns,
    async list() {
      try {
        return await refresh(await readIndex());
      } catch {
        return runs();
      }
    },
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
        const tx = db.transaction([RUNS, INDEX], "readwrite"),
          store = tx.objectStore(RUNS),
          index = tx.objectStore(INDEX),
          done = finished(tx);
        done.catch(() => {
          /* reported below */
        });
        let after,
          left = 0;
        try {
          const old = sorted(await request(index.getAll()));
          // (never an id used before, even after the newest run is deleted: another tab may still map the
          // old id to the run it named, and would delete the new one in its place)
          const id = Math.max((old[0]?.id || 0) + 1, Date.now()),
            drop = new Set();
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
          after = [{ id, ...summary(validated, bytes) }, ...old.filter((i) => !drop.has(i.id))];
          await done;
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
          if (error?.name === "QuotaExceededError" && left > 0) continue;
          throw error;
        }
        entries = [{ id: after[0].id, run: validated }, ...entries.filter((e) => after.some((i) => i.id === e.id))];
        return refresh(after);
      }
    },
    async remove(run) {
      const id = keepId(run);
      if (id != null) {
        const tx = db.transaction([RUNS, INDEX], "readwrite"),
          done = finished(tx);
        tx.objectStore(RUNS).delete(id);
        tx.objectStore(INDEX).delete(id);
        await done;
      }
      return refresh(await readIndex());
    },
  };
}

// Moves the localStorage history into the database, oldest first so the newest keeps the highest id,
// leaving out runs already there (a move interrupted before the key was removed), then removes the key.
async function migrate(db, storage) {
  let raw;
  try {
    raw = (storage || globalThis.localStorage).getItem(EVALUATION_HISTORY_KEY);
  } catch {
    return;
  }
  if (raw == null) return;
  const legacy = readEvaluations({ getItem: () => raw });
  if (legacy.length) {
    const tx = db.transaction([RUNS, INDEX], "readwrite"),
      store = tx.objectStore(RUNS),
      index = tx.objectStore(INDEX),
      done = finished(tx);
    done.catch(() => {
      /* reported below */
    });
    try {
      const old = await request(index.getAll());
      let id = old.reduce((max, i) => Math.max(max, i.id), 0);
      for (const run of [...legacy].reverse()) {
        const json = JSON.stringify(run),
          entry = summary(run, new Blob([json]).size);
        if (old.some((i) => same(i, entry))) continue;
        id++;
        store.put(run, id);
        index.put({ id, ...entry });
      }
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
    (storage || globalThis.localStorage).removeItem(EVALUATION_HISTORY_KEY);
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
    db = await openDatabase(indexedDB);
    await migrate(db, storage);
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
  const candidates = baseline.results.filter((r) => r.challenge === result.challenge && r.brain === brain);
  if (!candidates.length) return { reasons: ["challenge absent from baseline"] };
  const matches = candidates.filter((r) => !conditionDifferences(result, r).length);
  if (matches.length > 1) return { reasons: ["duplicate baseline results"] };
  if (!matches.length) {
    const nearest = candidates.map((r) => conditionDifferences(result, r)).sort((a, b) => a.length - b.length)[0];
    return { reasons: nearest };
  }
  const before = matches[0];
  if (result.stopped || before.stopped) return { reasons: ["stopped attempt"] };
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
