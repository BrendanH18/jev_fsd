import assert from "node:assert/strict";
import { api } from "../static/js/common.js";
import { readWatchReplay } from "../static/js/ui/replay-link.js";
import { RouteRequest } from "../static/js/ui/route-request.js";

const params = new URLSearchParams("replay=1");
const store = (value) => ({ getItem: () => value });
const badStore = {
  getItem() {
    throw new Error("blocked");
  },
};
const replay = {
  scenario: {
    id: "case 1",
    start: { edge: "road", lane: 0, s: 3 },
    route: {
      polyline: [
        [0, 1],
        [2, 3],
      ],
    },
  },
};
assert.equal(readWatchReplay(new URLSearchParams(), badStore), null);
assert.throws(() => readWatchReplay(params, badStore), /storage is unavailable/);
assert.throws(() => readWatchReplay(params, store(null)), /no saved drive/);
assert.throws(() => readWatchReplay(params, store("{broken")), /unreadable/);
assert.throws(() => readWatchReplay(params, store("null")), /incomplete/);
assert.throws(() => readWatchReplay(params, store('{"scenario":{"start":{"s":1},"route":{}}}')), /incomplete/);
assert.equal(readWatchReplay(params, store(JSON.stringify(replay))).scenario.id, "case 1");

const responses = [];
const installs = [];
let message;
let busy;
let enabled = true;
const routes = new RouteRequest({
  request(path, payload, { signal }) {
    assert.equal(path, "/api/route");
    return new Promise((resolve, reject) => responses.push({ payload, signal, resolve, reject }));
  },
  payload: ([x, y]) => ({ x, y }),
  install(route, destination, title) {
    installs.push({ route, destination, title });
  },
  show(text, working = false) {
    message = text;
    busy = working;
  },
  canInstall: () => enabled,
});
const route = {
  polyline: [
    [0, 0],
    [2, 3],
  ],
  edges: ["edge1"],
};
const first = routes.choose([3, 4]);
const second = routes.choose([5, 6], { route, title: "Suggested", check: true });
assert.equal(busy, true);
assert.equal(responses[1].payload.x, 5);
assert.equal(responses[0].signal.aborted, true);
responses[0].reject(new Error("obsolete"));
assert.equal(await first, false);
assert.equal(message, "Finding route…");
responses[1].resolve({ routes: [route] });
assert.equal(await second, true);
assert.equal(installs.length, 1);
assert.equal(installs[0].destination.join(","), "5,6");
assert.equal(installs[0].title, "Suggested");
assert.equal(busy, false);
assert.equal(message, "");

const third = routes.choose([3, 4]);
assert.equal(await routes.choose([9, 9], { route, check: false }), true);
assert.equal(responses.length, 3);
assert.equal(responses[2].signal.aborted, true);
responses[2].resolve({ routes: [route] });
assert.equal(await third, false);
assert.equal(installs.length, 2);

const cancelled = routes.choose([4, 4]);
routes.cancel();
assert.equal(responses.at(-1).signal.aborted, true);
responses.at(-1).resolve({ routes: [route] });
assert.equal(await cancelled, false);
assert.equal(message, "");

const blocked = routes.choose([4, 4]);
enabled = false;
responses.at(-1).resolve({ routes: [route] });
assert.equal(await blocked, false);
assert.equal(busy, false);
const requestsBefore = responses.length;
assert.equal(await routes.choose([4, 4]), false);
assert.equal(responses.length, requestsBefore);
enabled = true;
assert.equal(await routes.choose([NaN, 0]), false);
assert.match(message, /valid destination/);

const empty = routes.choose([4, 4]);
responses.at(-1).resolve({ routes: [] });
assert.equal(await empty, false);
assert.equal(message, "No route here. Choose another street.");
assert.equal(busy, false);
const invalid = routes.choose([4, 4]);
responses.at(-1).resolve({ routes: null });
assert.equal(await invalid, false);
assert.match(message, /invalid route list/);
assert.equal(await routes.choose([4, 4], { route: { polyline: [] }, check: false }), false);
assert.match(message, /incomplete/);
assert.equal(
  await routes.choose([4, 4], {
    route: {
      polyline: [
        [0, 0],
        [NaN, 3],
      ],
      edges: [],
    },
    check: false,
  }),
  false,
);
assert.match(message, /destination is invalid/);
const failed = routes.choose([9, 9]);
responses.at(-1).reject(new Error("Request timed out."));
assert.equal(await failed, false);
assert.match(message, /timed out/);
assert.equal(routes.pending, null);

// The scenic lookup can finish even after aborting its fetch. Only the map choice may take effect.
let resolveScenic;
let scenicSignal;
let scenicApplied = false;
const scenicLookup = routes.lookup(
  (signal) => {
    scenicSignal = signal;
    return new Promise((resolve) => {
      resolveScenic = resolve;
    });
  },
  () => {
    scenicApplied = true;
  },
);
const mapChoice = routes.choose([2, 3]);
assert.equal(scenicSignal.aborted, true);
resolveScenic({ destination: [8, 9], route });
assert.equal(await scenicLookup, false);
assert.equal(scenicApplied, false);
responses.at(-1).resolve({ routes: [route] });
assert.equal(await mapChoice, true);
assert.equal(installs.length, 3);

globalThis.document = { querySelector: () => null };
let headers;
globalThis.fetch = async (_path, opts) => {
  headers = opts.headers;
  return { ok: true, json: async () => ({ ok: true }) };
};
assert.equal((await api("/api/status")).ok, true);
assert.equal(headers["Content-Type"], undefined);
assert.equal((await api("/api/route", { k: 1 })).ok, true);
assert.equal(headers["Content-Type"], "application/json");
globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => null });
await assert.rejects(api("/api/models"), (error) => error.message === "Request failed (409)" && error.status === 409);
globalThis.fetch = async () => ({
  ok: false,
  status: 429,
  json: async () => ({ error: "Too many requests", jev_status: 429 }),
});
await assert.rejects(api("/api/models"), (error) => error.message === "Too many requests" && error.jevStatus === 429);
globalThis.fetch = async () => ({
  ok: false,
  status: 502,
  json: async () => {
    throw new SyntaxError("proxy returned HTML");
  },
});
await assert.rejects(api("/api/models"), (error) => error.status === 502);
globalThis.fetch = async () => ({
  ok: true,
  json: async () => {
    throw new SyntaxError("broken payload");
  },
});
await assert.rejects(api("/api/map"), /unreadable JSON/);
globalThis.fetch = async () => {
  throw new TypeError("offline");
};
await assert.rejects(api("/api/map"), /Could not reach the simulator server/);
const abort = new DOMException("cancelled", "AbortError");
globalThis.fetch = async () => {
  throw abort;
};
await assert.rejects(api("/api/map"), (error) => error === abort);
globalThis.fetch = async () => ({
  ok: true,
  json: async () => {
    throw abort;
  },
});
await assert.rejects(api("/api/map"), (error) => error === abort);
console.log("App route requests, watch links and HTTP error handling passed.");
