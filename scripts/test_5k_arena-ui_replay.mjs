import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  incidentDrive,
  loadPublishedDrive,
  replayIndex,
  replayMoment,
  replaySelection,
  validatePublishedReplay,
} from "../static/js/ui/published-replay.js";

const right = "jev-right-on-red";
const ids = [right, "jev-unprotected-left", "jev-flagger", "claude-haiku-flagger"];
const fixture = (id) => JSON.parse(readFileSync(new URL(`../static/replays/${id}.json`, import.meta.url), "utf8"));
const replay = fixture(right);
const bad = (field, change) => {
  const copy = structuredClone(replay);
  change(copy);
  assert.throws(() => validatePublishedReplay(copy), new RegExp(field));
};
for (const id of ids) assert.equal(validatePublishedReplay(fixture(id)).format, "jev-browser-replay/1");

bad("format", (r) => {
  r.format = "future";
});
bad("recorded model", (r) => {
  r.model = " ";
});
bad("verdict", (r) => {
  r.pass = "yes";
});
bad("recording path", (r) => {
  r.source = "data/../other";
});
bad("map bounds", (r) => {
  r.bounds[0] = NaN;
});
bad("map dimensions", (r) => {
  r.bounds[2] = r.bounds[0];
});
bad("map dimensions", (r) => {
  r.bounds[0] = -Number.MAX_VALUE;
  r.bounds[2] = Number.MAX_VALUE;
});
bad("route", (r) => {
  r.route.length = 1;
});
bad("road geometry", (r) => {
  r.roads[0].points.length = 1;
});
bad("road widths", (r) => {
  r.roads[0].width = 0;
});
bad("building geometry", (r) => {
  r.buildings.push([
    [0, 0],
    [1, 1],
  ]);
});
bad("signal locations", (r) => {
  r.signals.push([0, 1, 2]);
});
bad("frame count", (r) => {
  r.frames.length = 1;
});
bad("first frame time", (r) => {
  r.frames[0].t = 1;
});
bad("frame 2 time", (r) => {
  r.frames[1].t = 0;
});
bad("frame 2 driven vehicle", (r) => {
  r.frames[1].ego.psi = "left";
});
bad("frame 2 speed", (r) => {
  r.frames[1].ego.speed = Infinity;
});
bad("frame 2 traffic", (r) => {
  r.frames[1].traffic = [];
});
bad("frame 2 traffic", (r) => {
  r.frames[1].traffic.bad = { x: 0, y: 0 };
});
bad("frame 2 lights", (r) => {
  r.frames[1].lights.pop();
});
bad("frame 2 lights", (r) => {
  r.frames[1].lights[0] = null;
});
bad("decision times", (r) => {
  r.choices[0].t = -1;
});
bad("decision times", (r) => {
  r.choices[0].t = r.choices[1].t + 1;
});
bad("decision times", (r) => {
  r.choices.at(-1).t = r.frames.at(-1).t + 1;
});
bad("decision motion", (r) => {
  r.choices[0].motion = "jump";
});
bad("manoeuvre ID", (r) => {
  r.choices[0].id = {};
});
bad("flag reason", (r) => {
  r.choices[0].flag = true;
});
bad("event times", (r) => {
  r.events[0].t = r.events[1].t + 1;
});
bad("event message", (r) => {
  r.events[0].message = "";
});

const allowed = fixture(right);
allowed.frames[1].ego.speed = -5;
allowed.frames[1].lights[0] = "unexpected";
allowed.events.at(-1).t = allowed.frames.at(-1).t + 0.03;
assert.equal(validatePublishedReplay(allowed).events.length, allowed.events.length);

const trace = [{ t: 0 }, { t: 1.01 }, { t: 1.01 }, { t: 1.03 }, { t: 5 }];
assert.equal(replayIndex(trace, -0.1), -1);
assert.equal(replayIndex([], 0), -1);
assert.equal(replayIndex(trace, 0), 0);
assert.equal(replayIndex(trace, 1.01), 2);
assert.equal(replayIndex(trace, 100), 4);
assert.equal(replayMoment(trace, 1.01, 1), 1.03);
assert.equal(replayMoment(trace, 1.03, -1), 1.01);
assert.equal(replayMoment(trace, 0, -1), null);
assert.equal(replayMoment(trace, 5, 1), null);
assert.equal(replayMoment(trace, 0, -1, true), 5);
assert.equal(replayMoment(trace, 5, 1, true), 0);
assert.equal(replayMoment([], 0, 1, true), null);
const url = (query) => new URL(`https://example.test/jev_fsd/results.html?${query}`);
assert.equal(replaySelection(url("replay=unknown&at=8")).id, right);
assert.equal(replaySelection(url("replay=unknown&at=8")).time, 0);
assert.equal(replaySelection(url("replay=jev-flagger&at=3.524")).time, 3.524);
assert.equal(replaySelection(url("replay=jev-flagger&at=-1")).time, 0);
assert.equal(replaySelection(url("replay=jev-flagger&at=1e3")).time, 0);
assert.equal(replaySelection(url(`replay=jev-flagger&at=${"9".repeat(400)}`)).time, 0);
const incidentConfig = {
  challenge: "flagger",
  map: "ottawa",
  map_sha: "c18b8436019517f5",
  pack: "6",
  seed: 22042,
  version: 1,
  weather: "dry",
  time: "afternoon",
};
assert.equal(incidentDrive(incidentConfig, { at_s: 56.18 }), "jev-flagger");
assert.equal(incidentDrive(incidentConfig, { at_s: 56.22 }), null);
assert.equal(incidentDrive({ ...incidentConfig, map_sha: "other" }, { at_s: 10 }), null);

const oldFetch = globalThis.fetch;
try {
  let calls = 0;
  globalThis.fetch = async (target) => {
    calls++;
    const id = /\/replays\/([^/]+)\.json$/.exec(target.pathname)[1];
    return Response.json(fixture(id));
  };
  await assert.rejects(loadPublishedDrive("../unknown"), /Unknown published replay/);
  assert.equal(calls, 0);
  assert.equal((await loadPublishedDrive("jev-flagger")).challenge, "flagger");
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response("", { status: 503 });
  await assert.rejects(loadPublishedDrive(right), /Request failed \(503\)/);
  globalThis.fetch = async () => new Response("invalid");
  await assert.rejects(loadPublishedDrive(right), /not valid JSON/);
  globalThis.fetch = async () => Response.json({ ...replay, model: "wrong" });
  await assert.rejects(loadPublishedDrive(right), /does not match/);
  globalThis.fetch = async () => Response.json({ ...replay, result_sha: "wrong" });
  await assert.rejects(loadPublishedDrive(right), /does not match/);
  globalThis.fetch = async () => Response.json(replay);
  await assert.rejects(loadPublishedDrive(right, AbortSignal.abort()), (err) => err.name === "AbortError");
} finally {
  globalThis.fetch = oldFetch;
}
console.log("Published replay validation, selection, loading and timeline checks passed");
