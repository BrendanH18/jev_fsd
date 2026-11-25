import { MapData } from "../map/mapdata.js";
import { CUSTOM_SUITE } from "../bench/suite-version.js";
import { browserRoute, browserDrives } from "./routing.js";

const root = new URL("../../demo-data/", import.meta.url),
  cache = new Map();
let catalogPromise;
const RUNS_KEY = "jev-demo-runs";
const RUNS_LIMIT = 10;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function localRunStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readRuns(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(RUNS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const names = new Set();
    return parsed.filter((run) => {
      if (
        !isObject(run) ||
        typeof run.name !== "string" ||
        !run.name ||
        names.has(run.name) ||
        !isObject(run.config) ||
        !isObject(run.summary) ||
        !Array.isArray(run.results) ||
        !run.results.every(isObject)
      )
        return false;
      names.add(run.name);
      return true;
    });
  } catch {
    return [];
  }
}

function saveRun(body, storage, now = Date.now()) {
  if (!isObject(body) || !Array.isArray(body.results) || !isObject(body.summary) || !isObject(body.config))
    throw new Error("Benchmark save requires a config, summary and results array.");
  if (body.suite_version !== undefined && body.suite_version !== CUSTOM_SUITE)
    throw new Error("browser benchmark runs must use the custom suite");
  if (body.results.some((result) => !isObject(result) || result.suite_version !== body.suite_version))
    throw new Error("run and results must agree on suite_version");
  if (!storage) throw new Error("Benchmark storage is unavailable in this browser.");
  const runs = readRuns(storage);
  const base = `demo-${now}`;
  let name = base;
  for (let suffix = 2; runs.some((run) => run.name === name); suffix++) name = `${base}-${suffix}`;
  const next = [{ ...body, name, saved_at: new Date(now).toISOString() }, ...runs].slice(0, RUNS_LIMIT);
  while (next.length) {
    try {
      storage.setItem(RUNS_KEY, JSON.stringify(next));
      return { saved: name, name };
    } catch (error) {
      if (error.name !== "QuotaExceededError") throw error;
      next.pop();
    }
  }
  throw new Error("This benchmark exceeds available demo storage.");
}
// Cancel a caller's wait without cancelling a cached fetch used by other callers.
function waitForShared(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Request aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
function loadCatalog(signal) {
  catalogPromise ||= json("catalog.json").catch((err) => {
    catalogPromise = null;
    throw err;
  });
  return waitForShared(catalogPromise, signal);
}
async function json(name, signal) {
  const response = await fetch(new URL(name, root), { signal });
  if (!response.ok) throw new Error(`Could not load bundled demo data ${name} (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(`Could not read bundled demo data ${name}: ${error.message}`, { cause: error });
  }
}
async function selection(query, body, signal) {
  const maps = await loadCatalog(signal);
  const key = query.get("map") || query.get("bbox") || body?.bbox || "kitsilano";
  const item = maps.find((m) => m.id === key || m.bbox.join(",") === String(key));
  if (!item)
    throw new Error("The public demo supports the bundled neighbourhoods only. Use the local app for custom maps.");
  if (!cache.has(item.id))
    cache.set(
      item.id,
      json(`${item.id}.json`)
        .then((pack) => ({ pack, map: new MapData(pack) }))
        .catch((err) => {
          cache.delete(item.id);
          throw err;
        }),
    );
  return { item, ...(await waitForShared(cache.get(item.id), signal)) };
}
export async function demoApi(path, body, { signal } = {}) {
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  const url = new URL(path, "https://demo.local");
  if (url.pathname === "/api/maps") return { maps: await loadCatalog(signal) };
  if (url.pathname === "/api/results") return json("results.json", signal);
  if (url.pathname === "/api/bench/runs") {
    const runs = readRuns(localRunStorage());
    const name = url.searchParams.get("name");
    if (name) return runs.find((run) => run.name === name) || {};
    return {
      runs:
        url.searchParams.get("summary") === "1"
          ? runs.map(({ name, saved_at, suite_version, config, summary }) => ({
              name,
              saved_at,
              suite_version,
              config,
              summary,
            }))
          : runs,
    };
  }
  if (url.pathname === "/api/bench/save") return saveRun(body, localRunStorage());
  if (!["/api/status", "/api/map", "/api/route", "/api/drives"].includes(url.pathname))
    throw new Error("This action needs the local app. The public demo uses the free Rules driver.");
  const { item, pack, map } = await selection(url.searchParams, body, signal);
  if (url.pathname === "/api/status")
    return {
      version: "0.3.0-demo",
      configured: false,
      demo: true,
      npcs: 16,
      map: { ...item, label: `${item.name}, ${item.city}`, synthetic: false, name: pack.name },
      spend: { usd: 0 },
    };
  if (url.pathname === "/api/map") return pack;
  if (url.pathname === "/api/route") {
    const route = browserRoute(map, body.from, body.to, body);
    return { routes: route ? [route] : [] };
  }
  return { drives: browserDrives(map, body.from) };
}
