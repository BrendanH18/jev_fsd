import assert from "node:assert/strict";
import { DriveAudio } from "../static/js/ui/drive-audio.js";
import { describe, Hud } from "../static/js/ui/hud.js";
import { shellQuote } from "../static/js/ui/panel.js";
import { photoFilename } from "../static/js/ui/photo-mode.js";
import { preference } from "../static/js/ui/preferences.js";
import {
  describeClock,
  displaySource,
  formatDistance,
  noticePriority,
  orderedProbabilities,
} from "../static/js/ui/readouts.js";

const entries = new Map();
const storage = {
  getItem: (key) => entries.get(key),
  setItem: (key, value) => entries.set(key, value),
  removeItem: (key) => entries.delete(key),
};
const limited = preference("volume", 100, storage, { valid: (v) => v >= 0 && v <= 100 });
assert.equal(limited.write(50), true);
assert.equal(limited.write(101), false);
assert.equal(limited.write("60"), false);
assert.equal(limited.write(Infinity), false);
assert.equal(limited.read(), 50);
assert.equal(limited.reset(), true);
assert.equal(limited.read(), 100);
entries.set("jev-fsd-ui-volume", "1e309");
assert.equal(limited.read(), 100);
entries.set("jev-fsd-ui-volume", "-1");
assert.equal(limited.read(), 100);
entries.set("jev-fsd-quality", "low");
const quality = preference("quality", "high", storage, {
  legacy: true,
  valid: (value) => ["low", "high"].includes(value),
});
assert.equal(quality.read(), "low");
assert.equal(quality.write("high"), true);
assert.equal(entries.get("jev-fsd-quality"), "high");
entries.set("jev-fsd-quality", "unknown");
assert.equal(quality.read(), "high");
const noWrites = preference("camera-motion", "", {
  removeItem: () => {
    throw new Error("unavailable");
  },
});
assert.equal(noWrites.reset(), false);

assert.equal(formatDistance(2.2), "3 m");
assert.equal(formatDistance(99.5), "100 m");
assert.equal(formatDistance(124.9), "120 m");
assert.equal(formatDistance(999), "1.0 km");
assert.equal(formatDistance(1450), "1.4 km");
assert.equal(formatDistance(-3), "0 m");
assert.equal(formatDistance(NaN), "–");
assert.equal(formatDistance(undefined), "–");
assert.equal(describeClock(15.5, { afternoon: 15.5 }), "afternoon");
assert.equal(describeClock(15.6, { afternoon: 15.5 }), "15:36");
assert.equal(describeClock(0, {}), "00:00");
assert.equal(displaySource({ source: "rules_fallback" }), "Rules fallback");
assert.equal(displaySource({ source: "jev", fallback: "timeout" }), "Rules fallback");
assert.equal(displaySource({ source: "local" }), "Local decision");
assert.equal(displaySource({ source: "jev" }), "Jev");
assert.equal(displaySource({ source: "rules" }), "Rules");
assert.equal(displaySource({ source: "llm", model: "Example" }), "Example");
assert.equal(displaySource({}), "–");
assert.equal(
  orderedProbabilities({ low: 0, best: 0.9, next: 0.1, nan: NaN, negative: -1, text: "0.6", large: 2 })
    .map(([key]) => key)
    .join(","),
  "best,next,low",
);
assert.equal(noticePriority("alert") > noticePriority("safety"), true);
assert.equal(noticePriority("stop") > noticePriority(""), true);
assert.equal(describe({ id: "hold", law: { stopAtRoute: 12 } }), "Stop at the line");
assert.equal(describe({ id: "creep", law: { kind: "steer" } }), "Creep forward");
assert.equal(
  describe({ id: "right", change: { dir: "right" }, law: { vTarget: 8 } }),
  "Change to right lane · 29 km/h",
);
assert.equal(describe({ id: "left", change: { dir: "left" } }), "Change to left lane");
assert.equal(describe({ id: "not_recorded" }), "not recorded");
assert.equal(
  describe({ id: "keep_target", law: { vTarget: 10, offset: 0.3, center: 0.1 } }),
  "Target 36 km/h · 0.2 m right",
);
assert.equal(shellQuote("https://example.test/?x=a&y=b"), "'https://example.test/?x=a&y=b'");
assert.equal(shellQuote("can't"), "'can'\\''t'");
assert.equal(shellQuote(""), "''");
assert.equal(photoFilename("Drive", new Date(NaN)), "jev-drive.png");
assert.equal(photoFilename(`${"a".repeat(47)} b`, new Date(2026, 0, 2)), `jev-${"a".repeat(47)}-2026-01-02-000000.png`);

const hud = { latencies: [], decisionTimes: [], p50: null };
const record = (meta, now) => Hud.prototype.recordDecision.call(hud, meta, now);
record({ source: "local", latency_ms: 0 }, 1);
record({ source: "jev", latency_ms: NaN }, 2);
record({ source: "jev", latency_ms: -1 }, 3);
record({}, 4);
assert.equal(hud.p50, null);
assert.equal(hud.decisionTimes.join(","), "1,2,3,4");
for (let i = 0; i < 41; i++) record({ source: "jev", latency_ms: i }, i + 5);
assert.equal(hud.latencies.length, 40);
assert.equal(hud.latencies[0], 1);
assert.equal(hud.p50, 21);

const audioNode = new EventTarget();
audioNode.attrs = new Map();
audioNode.setAttribute = (name, value) => audioNode.attrs.set(name, value);
globalThis.document = new EventTarget();
globalThis.document.hidden = false;
const audio = new DriveAudio(audioNode);
const gains = [];
audio.master = { gain: { setTargetAtTime: (gain) => gains.push(gain) } };
audio.context = { currentTime: 0, state: "running" };
audio.enabled = true;
audio.updateGain();
audio.updateGain();
assert.equal(gains.join(","), "0.4");
document.hidden = true;
document.dispatchEvent(new Event("visibilitychange"));
assert.equal(gains.at(-1), 0);
audio.update({ v: 10 }, "rain", false, true);
document.hidden = false;
await audio.toggle();
assert.equal(audio.enabled, false);
assert.equal(audioNode.attrs.get("aria-pressed"), "false");
audio.context = null;
globalThis.window = {};
await audio.toggle();
assert.equal(audioNode.textContent, "Retry sound");
assert.equal(audioNode.disabled, false);
assert.equal(audio.context, null);
console.log("App readouts, display preferences, shell quoting and audio state passed.");
