import { MapData } from "../map/mapdata.js";
import { browserRoute, browserDrives } from "./routing.js";

const root = new URL("../../demo-data/", import.meta.url), cache = new Map();
let catalogPromise;
// Cancel a caller's wait without cancelling a cached fetch used by other callers.
function waitForShared(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Request aborted", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
function loadCatalog(signal) {
  catalogPromise ||= json("catalog.json").catch(err => { catalogPromise = null; throw err; });
  return waitForShared(catalogPromise, signal);
}
async function json(name, signal) {
  const response = await fetch(new URL(name, root), { signal });
  if (!response.ok) throw new Error(`Could not load bundled demo data (${response.status}).`);
  return response.json();
}
async function selection(query, body, signal) {
  const maps = await loadCatalog(signal);
  const key = query.get("map") || query.get("bbox") || body?.bbox || "kitsilano";
  const item = maps.find(m => m.id === key || m.bbox.join(",") === String(key));
  if (!item) throw new Error("The public demo supports the eight bundled neighbourhoods. Use the local app for custom maps.");
  if (!cache.has(item.id)) cache.set(item.id, json(`${item.id}.json`).then(pack => ({ pack, map: new MapData(pack) })).catch(err => { cache.delete(item.id); throw err; }));
  return { item, ...await waitForShared(cache.get(item.id), signal) };
}
export async function demoApi(path, body, { signal } = {}) {
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  const url = new URL(path, "https://demo.local");
  if (url.pathname === "/api/maps") return { maps: await loadCatalog(signal) };
  if (url.pathname === "/api/bench/runs") {
    try { return { runs: JSON.parse(localStorage.getItem("jev-demo-runs") || "[]") }; } catch { return { runs: [] }; }
  }
  if (url.pathname === "/api/bench/save") {
    const name = `demo-${Date.now()}`, { runs } = await demoApi("/api/bench/runs");
    localStorage.setItem("jev-demo-runs", JSON.stringify([{ name, ...body }, ...runs].slice(0, 10)));
    return { saved: name };
  }
  const { item, pack, map } = await selection(url.searchParams, body, signal);
  if (url.pathname === "/api/status") return { version: "0.3.0-demo", configured: false, demo: true, npcs: 16,
    map: { ...item, label: `${item.name}, ${item.city}`, synthetic: false, name: pack.name }, spend: { usd: 0 } };
  if (url.pathname === "/api/map") return pack;
  if (url.pathname === "/api/route") { const route = browserRoute(map, body.from, body.to); return { routes: route ? [route] : [] }; }
  if (url.pathname === "/api/drives") return { drives: browserDrives(map, body.from) };
  throw new Error("This action needs the local app. The public demo uses the free Rules driver.");
}
