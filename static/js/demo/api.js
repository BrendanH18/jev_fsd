import { MapData } from "../map/mapdata.js";
import { CUSTOM_SUITE } from "../bench/suite-version.js";
import { browserRoute, browserDrives } from "./routing.js";

const root = new URL("../../demo-data/", import.meta.url);
const API_ORIGIN = "https://demo.local";
const SMALL_ASSET_LIMIT = 30 * 1024 * 1024;
const RUNS_KEY = "jev-demo-runs";
const RUNS_LIMIT = 10;
// Projected local metres. This bounds the spatial index loops even for damaged JSON.
const GRID_COORDINATE_LIMIT = 1_000_000;
const PACK_ARRAYS = ["edges", "lanes", "intersections", "stops", "buildings"];
const packCache = new Map();
let catalogPromise;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRun(run) {
  return (
    isObject(run) &&
    isObject(run.config) &&
    isObject(run.summary) &&
    Array.isArray(run.results) &&
    (run.suite_version === undefined || run.suite_version === CUSTOM_SUITE) &&
    run.results.every((result) => isObject(result) && result.suite_version === run.suite_version)
  );
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
    const runs = [];
    for (const run of parsed) {
      if (!validRun(run) || typeof run.name !== "string" || !run.name.trim() || names.has(run.name)) continue;
      names.add(run.name);
      runs.push(run);
      if (runs.length === RUNS_LIMIT) break;
    }
    return runs;
  } catch {
    return [];
  }
}

function serializeRun(body) {
  if (!isObject(body) || !Array.isArray(body.results) || !isObject(body.summary) || !isObject(body.config))
    throw new Error("Benchmark save requires a config, summary and results array.");
  if (body.suite_version !== undefined && body.suite_version !== CUSTOM_SUITE)
    throw new Error("browser benchmark runs must use the custom suite");
  if (!validRun(body)) throw new Error("run and results must agree on suite_version");
  const { config, summary, results, suite_version } = body;
  // Normalize to the JSON stored by the local API and check again after any custom serialization.
  let normalized;
  try {
    normalized = JSON.parse(JSON.stringify({ config, summary, results, suite_version }));
  } catch (error) {
    throw new Error("The benchmark contains values that cannot be saved as JSON.", { cause: error });
  }
  if (!validRun(normalized)) throw new Error("The benchmark is invalid after JSON serialization.");
  return normalized;
}

// A full browser storage keeps the saved runs: the save fails with code "storage_full" unless the
// request sets replace_oldest, the user's choice to remove the oldest runs until the new one fits
// (they are listed in `removed`).
function saveRun(body, storage, now = Date.now()) {
  const record = serializeRun(body);
  if (!storage) throw new Error("Benchmark storage is unavailable in this browser.");
  const replaceOldest = isObject(body) && body.replace_oldest === true;
  const runs = readRuns(storage);
  const base = `demo-${now}`;
  let name = base;
  for (let suffix = 2; runs.some((run) => run.name === name); suffix++) name = `${base}-${suffix}`;
  const next = [{ ...record, name, saved_at: new Date(now).toISOString() }, ...runs].slice(0, RUNS_LIMIT);
  let popped = false;
  while (next.length) {
    try {
      storage.setItem(RUNS_KEY, JSON.stringify(next));
      // (after removing runs for room, name every saved run that is gone, the one past the cap too)
      const removed = popped ? runs.filter((run) => !next.includes(run)).map((run) => run.name) : [];
      return removed.length ? { saved: name, name, removed } : { saved: name, name };
    } catch (error) {
      if (error?.name === "SecurityError")
        throw new Error("The browser has blocked access to benchmark storage.", { cause: error });
      if (error?.name !== "QuotaExceededError") throw error;
      if (!replaceOldest && next.length > 1) {
        const full = new Error(
          `Browser storage is full, so the ${runs.length} saved run${runs.length === 1 ? " was" : "s were"} kept`,
          { cause: error },
        );
        full.code = "storage_full";
        throw full;
      }
      popped = true;
      next.pop();
    }
  }
  throw new Error("This benchmark exceeds available demo storage.");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Request aborted", "AbortError");
}

// Cancel a caller's wait without cancelling the download shared with other callers.
async function waitForShared(promise, signal) {
  if (!signal) return promise;
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason ?? new DOMException("Request aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function json(name, { signal, validate } = {}) {
  const url = new URL(name, root);
  let response;
  try {
    response = await fetch(url, { signal, redirect: "error" });
  } catch (error) {
    throwIfAborted(signal);
    throw new Error(`Could not download bundled demo data ${name}. Check the connection and retry.`, { cause: error });
  }
  if (!response.ok) {
    const error = new Error(`Could not load bundled demo data ${name} (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  // Content-Length is only an early check. The browser may report the compressed size.
  if (Number(response.headers?.get("content-length")) > SMALL_ASSET_LIMIT)
    throw new Error(`Bundled demo data ${name} is too large.`);
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throwIfAborted(signal);
    throw new Error(`Could not read bundled demo data ${name} as JSON. Check that the demo is served over HTTP.`, {
      cause: error,
    });
  }
  throwIfAborted(signal);
  if (validate) {
    const issue = validate(data);
    if (issue) throw new Error(`Invalid bundled demo data ${name}: ${issue}.`);
  }
  return data;
}

function finiteTuple(value, size) {
  return Array.isArray(value) && value.length === size && value.every(Number.isFinite);
}

function bounds(value) {
  return finiteTuple(value, 4) && value[0] < value[2] && value[1] < value[3];
}

function catalogIssue(data) {
  if (!Array.isArray(data) || !data.length) return "expected a nonempty neighbourhood list";
  const ids = new Set();
  const boxes = new Set();
  for (const map of data) {
    if (typeof map?.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(map.id)) return "invalid neighbourhood ID";
    if (ids.has(map.id)) return `duplicate neighbourhood ${map.id}`;
    if (!bounds(map.bbox)) return `invalid bounds for ${map.id}`;
    const box = map.bbox.join(",");
    if (boxes.has(box)) return `duplicate bounds for ${map.id}`;
    if (!Number.isFinite(map.utc_offset)) return `invalid clock offset for ${map.id}`;
    if (typeof map.name !== "string" || !map.name.trim() || typeof map.city !== "string" || !map.city.trim())
      return `missing neighbourhood or city label for ${map.id}`;
    ids.add(map.id);
    boxes.add(box);
  }
  if (!ids.has("kitsilano")) return "missing the default Kitsilano neighbourhood";
  return null;
}

function loadCatalog(signal) {
  catalogPromise ||= json("catalog.json", { validate: catalogIssue }).catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return waitForShared(catalogPromise, signal);
}

function validPolyline(points) {
  return (
    Array.isArray(points) &&
    points.length >= 2 &&
    points.every((point) => finiteTuple(point, 2) && point.every((value) => Math.abs(value) <= GRID_COORDINATE_LIMIT))
  );
}

function graphIssue(pack) {
  const edges = new Map();
  for (const edge of pack.edges) {
    if (typeof edge?.id !== "string" || !edge.id) return "an edge is missing its ID";
    if (edges.has(edge.id)) return `duplicate road edge ${edge.id}`;
    if (!validPolyline(edge.pts)) return `invalid geometry for road edge ${edge.id}`;
    if (typeof edge.from !== "string" || typeof edge.to !== "string") return `missing endpoints for edge ${edge.id}`;
    if (!Number.isInteger(edge.lanes) || edge.lanes < 1 || !finiteTuple(edge.lane_offsets, edge.lanes))
      return `invalid lane offsets for edge ${edge.id}`;
    if (!finiteTuple(edge.asphalt, 2) || edge.asphalt[0] >= edge.asphalt[1])
      return `invalid asphalt bounds for edge ${edge.id}`;
    if (!Number.isFinite(edge.limit) || edge.limit <= 0) return `invalid speed limit for edge ${edge.id}`;
    if (!Number.isFinite(edge.length) || edge.length <= 0) return `invalid length for edge ${edge.id}`;
    edges.set(edge.id, edge);
  }
  const lanes = new Set();
  for (const lane of pack.lanes) {
    const edge = edges.get(lane?.edge);
    if (!edge) return "a lane refers to an unknown road edge";
    if (!Number.isInteger(lane.idx) || lane.idx < 0 || lane.idx >= edge.lanes)
      return `invalid lane index for edge ${lane.edge}`;
    const key = `${lane.edge}:${lane.idx}`;
    if (lanes.has(key)) return `duplicate lane ${key}`;
    if (!validPolyline(lane.pts)) return `invalid geometry for lane ${key}`;
    lanes.add(key);
  }
  if ([...edges.values()].reduce((count, edge) => count + edge.lanes, 0) !== lanes.size)
    return "a road edge is missing one or more lanes";
  return null;
}

function packIssue(pack, item) {
  if (!isObject(pack)) return "expected a map pack object";
  if (typeof pack.pack_version !== "string" || !/^[1-9][0-9]*$/.test(pack.pack_version))
    return "missing map pack version";
  if (typeof pack.name !== "string" || !pack.name.trim()) return "missing map name";
  if (!bounds(pack.routing_bbox) || pack.routing_bbox.join(",") !== item.bbox.join(","))
    return "routing bounds differ from the catalog";
  if (pack.utc_offset !== item.utc_offset) return "clock offset differs from the catalog";
  if (!bounds(pack.extent)) return "invalid projected map extent";
  const absent = PACK_ARRAYS.find((field) => !Array.isArray(pack[field]));
  if (absent) return `expected an array for ${absent}`;
  if (!pack.edges.length || !pack.lanes.length) return "the road graph is empty";
  return graphIssue(pack);
}

function resultsIssue(data) {
  if (!isObject(data) || data.format !== "jev-results/1") return "unsupported leaderboard format";
  if (!isObject(data.maps) && !Array.isArray(data.maps)) return "missing leaderboard map list";
  if (!isObject(data.drivers)) return "missing leaderboard drivers";
  if (!Array.isArray(data.rows)) return "missing leaderboard rows";
  if (data.rows.some((row) => !isObject(row))) return "invalid leaderboard row";
  return null;
}

function loadPack(item) {
  return json(`${item.id}.json`, { validate: (pack) => packIssue(pack, item) })
    .then((pack) => ({ pack, map: null }))
    .catch((error) => {
      packCache.delete(item.id);
      throw error;
    });
}

async function selection(query, body, signal) {
  const key = query.get("map") || query.get("bbox") || body?.bbox || "kitsilano";
  const requested = String(key);
  const parts = requested.split(",");
  const bbox = parts.length === 4 && parts.every((value) => value.trim()) ? parts.map(Number) : null;
  const maps = await loadCatalog(signal);
  const item = maps.find((entry) => entry.id === requested || bbox?.every((coord, i) => coord === entry.bbox[i]));
  if (!item)
    throw new Error("The public demo supports the bundled neighbourhoods only. Use the local app for custom maps.");
  throwIfAborted(signal);
  if (!packCache.has(item.id)) packCache.set(item.id, loadPack(item));
  const entry = await waitForShared(packCache.get(item.id), signal);
  throwIfAborted(signal);
  return { item, entry };
}

function coordinates(body, field) {
  const point = body?.[field];
  if (!isObject(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error(`Demo routing requires ${field} with finite x and y coordinates.`);
  return point;
}

function startCoordinates(body) {
  const start = coordinates(body, "from");
  const heading = start.heading;
  if (heading == null) return start;
  if (!Number.isFinite(heading)) throw new Error("Demo routing requires a finite heading in radians.");
  // The shared angle helper wraps by repeatedly adding or subtracting a turn.
  const turn = Math.PI * 2;
  return Math.abs(heading) > turn * 4 ? { ...start, heading: heading % turn } : start;
}

function isLocalPoint({ x, y }) {
  return Math.abs(x) <= GRID_COORDINATE_LIMIT && Math.abs(y) <= GRID_COORDINATE_LIMIT;
}

function routeOptions(body) {
  const { restrictions, hour, weekday, avoid } = body;
  if (restrictions !== undefined && typeof restrictions !== "boolean")
    throw new Error("Demo route restrictions must be true or false.");
  if (hour !== undefined && (!Number.isFinite(hour) || hour < 0 || hour >= 24))
    throw new Error("Demo route hour must be between 0 and 24, excluding 24.");
  if (weekday !== undefined && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6))
    throw new Error("Demo route weekday must be an integer from 0 to 6.");
  if (avoid != null && (!Array.isArray(avoid) || !avoid.every((id) => typeof id === "string" && id.length)))
    throw new Error("Demo route avoid must be a list of edge IDs.");
  return { restrictions, hour, weekday, avoid };
}

function routeMap(item, entry) {
  try {
    entry.map ??= new MapData(entry.pack);
    return entry.map;
  } catch (error) {
    packCache.delete(item.id);
    throw new Error(`Could not open the road graph in bundled demo data ${item.id}.json.`, { cause: error });
  }
}

export async function demoApi(path, body, { signal } = {}) {
  throwIfAborted(signal);
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//"))
    throw new Error("Demo requests require a local API path.");
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error("Demo requests require a local API path.");

  const api = url.pathname;
  if (api === "/api/maps") return { maps: structuredClone(await loadCatalog(signal)) };
  if (api === "/api/results") return json("results.json", { signal, validate: resultsIssue });
  if (api === "/api/bench/runs") {
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
  if (api === "/api/bench/save") return saveRun(body, localRunStorage());
  if (!["/api/status", "/api/map", "/api/route", "/api/drives"].includes(api))
    throw new Error("This action needs the local app. The public demo uses the free Rules driver.");
  const from = api === "/api/route" || api === "/api/drives" ? startCoordinates(body) : null;
  const to = api === "/api/route" ? coordinates(body, "to") : null;
  const options = api === "/api/route" ? routeOptions(body) : null;
  const { item, entry } = await selection(url.searchParams, body, signal);
  const { pack } = entry;
  if (api === "/api/status")
    return {
      version: `${globalThis.document?.querySelector('meta[name="jev-version"]')?.content || "browser"}-demo`,
      configured: false,
      demo: true,
      npcs: 16,
      map: { ...structuredClone(item), label: `${item.name}, ${item.city}`, synthetic: false, name: pack.name },
      spend: { usd: 0 },
    };
  if (api === "/api/map") return structuredClone(pack);
  if (api === "/api/route") {
    if (!isLocalPoint(from) || !isLocalPoint(to)) return { routes: [] };
    const route = browserRoute(routeMap(item, entry), from, to, options);
    return { routes: route ? [route] : [] };
  }
  if (!isLocalPoint(from)) return { drives: [] };
  return { drives: browserDrives(routeMap(item, entry), from) };
}
