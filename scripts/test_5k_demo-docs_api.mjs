import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browserRoute } from "../static/js/demo/routing.js";
import { MapData } from "../static/js/map/mapdata.js";
import { demoApi } from "../static/js/demo/api.js";

const pack = JSON.parse(readFileSync(new URL("../data/maps/623b012bc8b5.v6.pack.json", import.meta.url), "utf8"));
const primary = {
  id: "kitsilano",
  bbox: [-123.17, 49.26, -123.15, 49.27],
  name: "Kitsilano",
  city: "Vancouver",
  utc_offset: -7,
};
const secondary = { ...primary, id: "toronto", bbox: [-80, 43, -79, 44], name: "The Annex", city: "Toronto" };
pack.routing_bbox = primary.bbox;
pack.utc_offset = primary.utc_offset;

const requests = [];
let respond;
globalThis.fetch = (url, options) => {
  requests.push([url, options]);
  return respond(url, options);
};
const result = (body) => Promise.resolve(Response.json(body));

await assert.rejects(demoApi("https://website.invalid/api/maps"), /local API path/);
await assert.rejects(demoApi("//website.invalid/api/maps"), /local API path/);
await assert.rejects(demoApi(null), /local API path/);
await assert.rejects(demoApi("/api/drives", {}), /from.*finite/);
await assert.rejects(demoApi("/api/route", { from: { x: 0, y: "" } }), /from.*finite/);
await assert.rejects(demoApi("/api/route", { from: { x: 0, y: 0 } }), /to.*finite/);
await assert.rejects(demoApi("/api/drives", { from: { x: 0, y: 0, heading: Infinity } }), /finite heading/);
const from = { x: 0, y: 0 };
const to = { x: 10, y: 10 };
for (const [options, reason] of [
  [{ restrictions: 1 }, /restrictions.*true or false/],
  [{ hour: 24 }, /hour.*between/],
  [{ weekday: 7 }, /weekday.*integer/],
  [{ avoid: "e1" }, /avoid.*edge IDs/],
]) {
  await assert.rejects(demoApi("/api/route", { from, to, ...options }), reason);
}
const alreadyAborted = new AbortController();
const cancelled = new Error("cancelled by caller");
alreadyAborted.abort(cancelled);
await assert.rejects(demoApi("/api/maps", undefined, alreadyAborted), (error) => error === cancelled);
assert.equal(requests.length, 0);

respond = () => Promise.reject(new Error("offline"));
await assert.rejects(demoApi("/api/maps"), /catalog.json.*connection and retry/);
respond = () => Promise.resolve(new Response("", { status: 404 }));
await assert.rejects(demoApi("/api/maps"), { status: 404 });
respond = () => Promise.resolve(new Response("{}", { headers: { "content-length": String(31 * 1024 * 1024) } }));
await assert.rejects(demoApi("/api/maps"), /catalog.json.*too large/);
for (const [data, reason] of [
  [{}, /expected a nonempty neighbourhood list/],
  [[{ ...primary, id: "../private" }], /invalid neighbourhood ID/],
  [[primary, { ...primary, bbox: secondary.bbox }], /duplicate neighbourhood/],
  [[primary, { ...secondary, bbox: primary.bbox }], /duplicate bounds/],
  [[{ ...primary, bbox: [0, 0, 0, 0] }], /invalid bounds/],
  [[{ ...primary, utc_offset: "UTC" }], /invalid clock offset/],
  [[{ ...primary, city: "" }], /missing neighbourhood or city label/],
  [[secondary], /missing the default Kitsilano/],
]) {
  respond = () => result(data);
  await assert.rejects(demoApi("/api/maps"), reason);
}

let deliver;
respond = () =>
  new Promise((resolve) => {
    deliver = resolve;
  });
const controller = new AbortController();
const first = demoApi("/api/maps", undefined, controller);
const second = demoApi("/api/maps");
controller.abort(cancelled);
await assert.rejects(first, (error) => error === cancelled);
assert.equal(requests.at(-1)[0].pathname.endsWith("/demo-data/catalog.json"), true);
assert.equal(requests.at(-1)[1].redirect, "error");
deliver(Response.json([primary, secondary]));
const { maps } = await second;
maps[0].bbox[0] = -180;
assert.equal((await demoApi("/api/maps")).maps[0].bbox[0], primary.bbox[0]);

const tracked = new AbortController();
const remove = tracked.signal.removeEventListener.bind(tracked.signal);
let removed = 0;
tracked.signal.removeEventListener = (...args) => {
  if (args[0] === "abort") removed++;
  return remove(...args);
};
await demoApi("/api/maps", undefined, tracked);
assert.equal(removed, 1);

const beforeUnknown = requests.length;
await assert.rejects(demoApi("/api/map?map=unbundled"), /bundled neighbourhoods only/);
assert.equal(requests.length, beforeUnknown);

for (const [data, reason] of [
  [null, /expected a map pack object/],
  [{ ...pack, pack_version: 6 }, /missing map pack version/],
  [{ ...pack, name: null }, /missing map name/],
  [{ ...pack, routing_bbox: secondary.bbox }, /routing bounds differ/],
  [{ ...pack, utc_offset: 0 }, /clock offset differs/],
  [{ ...pack, extent: [] }, /invalid projected map extent/],
  [{ ...pack, stops: null }, /expected an array for stops/],
  [{ ...pack, lanes: [] }, /road graph is empty/],
  [{ ...pack, edges: [{ ...pack.edges[0], id: null }] }, /missing its ID/],
  [{ ...pack, edges: [pack.edges[0], pack.edges[0]] }, /duplicate road edge/],
  [
    {
      ...pack,
      edges: [
        {
          ...pack.edges[0],
          pts: [
            [0, 0],
            [1e30, 1],
          ],
        },
      ],
    },
    /invalid geometry for road edge/,
  ],
  [{ ...pack, edges: [{ ...pack.edges[0], from: null }] }, /missing endpoints/],
  [{ ...pack, edges: [{ ...pack.edges[0], lane_offsets: [] }] }, /invalid lane offsets/],
  [{ ...pack, edges: [{ ...pack.edges[0], asphalt: [1, -1] }] }, /invalid asphalt bounds/],
  [{ ...pack, edges: [{ ...pack.edges[0], limit: 0 }] }, /invalid speed limit/],
  [{ ...pack, edges: [{ ...pack.edges[0], length: -1 }] }, /invalid length/],
  [{ ...pack, lanes: [{ ...pack.lanes[0], edge: "unknown" }] }, /unknown road edge/],
  [{ ...pack, lanes: [{ ...pack.lanes[0], idx: -1 }] }, /invalid lane index/],
  [{ ...pack, lanes: [pack.lanes[0], pack.lanes[0]] }, /duplicate lane/],
  [{ ...pack, lanes: [{ ...pack.lanes[0], pts: [[0, 0]] }] }, /invalid geometry for lane/],
  [{ ...pack, lanes: pack.lanes.slice(1) }, /missing one or more lanes/],
]) {
  respond = () => result(data);
  await assert.rejects(demoApi("/api/map"), reason);
}
respond = () => result(pack);
const chosen = await demoApi("/api/map?bbox=-123.170,%2049.260,-123.150,49.270");
assert.equal(chosen.name, pack.name);
chosen.edges.length = 0;
assert.equal((await demoApi("/api/map")).edges.length, pack.edges.length);
globalThis.document = { querySelector: () => ({ content: "99.0.0" }) };
const status = await demoApi("/api/status");
assert.equal(status.version, "99.0.0-demo");
delete globalThis.document;
assert.equal(status.configured, false);
assert.equal(status.spend.usd, 0);
status.map.bbox[0] = 0;
assert.equal((await demoApi("/api/status")).map.bbox[0], primary.bbox[0]);
assert.equal((await demoApi("/api/route", { from: { x: 1e40, y: 0 }, to })).routes.length, 0);
assert.equal((await demoApi("/api/drives", { from: { x: 0, y: 1e40 } })).drives.length, 0);

const map = new MapData(pack);
const lane = map.laneList.find((candidate) => candidate.length > 30);
const [sx, sy] = lane.pts[0];
const [gx, gy] = lane.pts.at(-1);
const start = { x: sx, y: sy };
const goal = { x: gx, y: gy };
const expected = browserRoute(map, start, goal);
const actual = (await demoApi("/api/route", { from: start, to: goal })).routes[0];
assert.ok(expected?.polyline.length > 1);
assert.equal(JSON.stringify(actual), JSON.stringify(expected));
const large = { ...start, heading: 1e25 };
const reduced = { ...start, heading: large.heading % (Math.PI * 2) };
assert.equal(
  JSON.stringify(await demoApi("/api/route", { from: large, to: goal })),
  JSON.stringify(await demoApi("/api/route", { from: reduced, to: goal })),
);

for (const [data, reason] of [
  [{}, /unsupported leaderboard format/],
  [{ format: "jev-results/1" }, /missing leaderboard map list/],
  [{ format: "jev-results/1", maps: {} }, /missing leaderboard drivers/],
  [{ format: "jev-results/1", maps: {}, drivers: {} }, /missing leaderboard rows/],
  [{ format: "jev-results/1", maps: {}, drivers: {}, rows: [null] }, /invalid leaderboard row/],
]) {
  respond = () => result(data);
  await assert.rejects(demoApi("/api/results"), reason);
}
const annex = { ...pack, routing_bbox: secondary.bbox };
respond = () => result({ ...annex, nodes: null });
await assert.rejects(demoApi("/api/route?map=toronto", { from: start, to: goal }), /open the road graph.*toronto.json/);
respond = () => result(annex);
assert.equal((await demoApi("/api/map?map=toronto")).nodes.length, pack.nodes.length);

const published = JSON.parse(readFileSync(new URL("../data/results.json", import.meta.url), "utf8"));
respond = () => result(published);
assert.equal((await demoApi("/api/results")).rows.length, published.rows.length);

const key = "jev-demo-runs";
const storage = new Map();
globalThis.localStorage = {
  getItem: (name) => storage.get(name) ?? null,
  setItem: (name, value) => storage.set(name, value),
};
const run = { config: {}, summary: {}, results: [{}] };
await assert.rejects(demoApi("/api/bench/save", { ...run, config: { bad: 1n } }), /saved as JSON/);
await assert.rejects(
  demoApi("/api/bench/save", { ...run, config: { toJSON: () => null } }),
  /after JSON serialization/,
);
const saved = await demoApi("/api/bench/save", { ...run, unexpected: "ignore" });
assert.equal((await demoApi(`/api/bench/runs?name=${saved.name}`)).unexpected, undefined);
storage.set(
  key,
  JSON.stringify([
    { ...run, name: "mismatch", results: [{ suite_version: "custom" }] },
    { ...run, name: "canonical", suite_version: "v1", results: [{ suite_version: "v1" }] },
    { ...run, name: " " },
    ...Array.from({ length: 12 }, (_, index) => ({ ...run, name: `run-${index}` })),
  ]),
);
const runs = (await demoApi("/api/bench/runs")).runs;
assert.equal(runs.length, 10);
assert.equal(runs[0].name, "run-0");
globalThis.localStorage.setItem = () => {
  throw new DOMException("blocked", "SecurityError");
};
await assert.rejects(demoApi("/api/bench/save", run), /blocked access to benchmark storage/);
console.log("✓ standalone demo request validation, shared cache, browser routing and saved run recovery");
