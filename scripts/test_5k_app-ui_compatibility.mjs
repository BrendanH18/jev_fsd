import assert from "node:assert/strict";
import { api, appUrl, copyText, ms, percentile, usd } from "../static/js/common.js";
import { filterMaps } from "../static/js/ui/explorer.js";
import { describe, freeDriveSwitchList } from "../static/js/ui/hud.js";
import { clampLook } from "../static/js/ui/photo-mode.js";

const repositoryUrl = new URL("../", import.meta.url);
assert.equal(appUrl("/bench"), new URL("bench", repositoryUrl).href);
assert.equal(new URL(appUrl("bench", { bbox: "1,2,3,4" })).searchParams.get("bbox"), "1,2,3,4");
assert.equal(new URL(appUrl("", { challenge: "left & right" })).searchParams.get("challenge"), "left & right");
assert.equal(new URL(appUrl("results")).search, "");

assert.equal(ms(999.2), "999 ms");
assert.equal(ms(1000), "1.00 s");
assert.equal(usd(0), "$0");
assert.equal(usd(0.0000045), "$0.0000045");
assert.equal(usd(0.00125), "$0.00125");
assert.equal(usd(0.0125), "$0.0125");
assert.equal(percentile([], 0.5), null);
const latencies = [90, 5, 20];
assert.equal(percentile(latencies, 0.5), 20);
assert.equal(latencies.join(","), "90,5,20");
assert.equal(percentile(latencies, 1), 90);

assert.equal(describe({ id: "hard_brake" }), "Brake hard");
assert.equal(describe({ id: "reverse", law: { kind: "reverse" } }), "Reverse toward the road");
assert.equal(describe({ id: "lane", law: { vTarget: 0.04, offset: -0.6 } }), "Stop · 0.6 m left");
assert.equal(describe({ id: "lane", law: { vTarget: 0.3 } }), "Creep forward");
assert.equal(clampLook("contrast", "-1"), -0.3);
assert.equal(clampLook("saturation", "2"), 0.6);

const maps = [
  { id: "a", name: "Avenue", city: "City", province: "BC", description: "Bus lanes" },
  { id: "b", name: "Borough", city: "City", province: "BC", description: "One-way streets" },
];
assert.equal(filterMaps(maps, { query: "  CITY\tLANES   " })[0]?.id, "a");
assert.equal(filterMaps(maps, { query: "lanes", region: "ON" }).length, 0);
assert.equal(filterMaps(maps, { query: "  " }).length, 2);
assert.equal(filterMaps(maps, { query: "CA" }).length, 0);
const flags = freeDriveSwitchList().map(([flag]) => flag);
assert.equal(flags.length, new Set(flags).size);
assert.equal(
  flags.every((flag) => flag === flag.toLowerCase()),
  true,
);

const clipboard = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      async writeText(text) {
        clipboard.push(text);
      },
    },
  },
});
assert.equal(await copyText("Jev\nRules"), true);
assert.equal(clipboard[0], "Jev\nRules");
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
assert.equal(await copyText("ignored"), false);

globalThis.document = { querySelector: () => null };
let sent;
globalThis.fetch = async (path, options) => {
  sent = { path, ...options };
  return { ok: true, json: async () => ({ routes: [] }) };
};
const signal = new AbortController().signal;
await api("/api/route", { from: { x: 0, y: 1 }, k: 1 }, { signal });
assert.equal(sent.method, "POST");
assert.equal(sent.signal === signal, true);
assert.equal(JSON.parse(sent.body).from.x, 0);
assert.equal(JSON.parse(sent.body).k, 1);
assert.equal(sent.path, "/api/route");
await api("/api/status");
assert.equal(sent.method, undefined);
assert.equal(sent.body, undefined);
console.log("Existing formatting, filenames, search, clipboard and API request contracts passed.");
