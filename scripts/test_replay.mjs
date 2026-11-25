import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { replayPosition, reportIncidentTarget } from "../static/js/lab/playback.js";
import { copyDriveLink, driveLink, exportFilename, exportDriveCard } from "../static/js/lab/share.js";
import { cloneState, DriveRecorder } from "../static/js/lab/recorder.js";

globalThis.document = { querySelector: () => null };
const { DriveLab } = await import("../static/js/ui/lab.js");
const { incidentDrive, loadPublishedDrive } = await import("../static/js/ui/published-replay.js");
const fetchDrive = globalThis.fetch;
try {
  for (const [driver, challenges] of [
    ["jev", ["flagger", "right-on-red", "unprotected-left"]],
    ["claude-haiku", ["flagger"]],
  ]) {
    const recording = `data/recordings/${driver}-open-2026-11-20.json.gz`;
    const source = JSON.parse(gunzipSync(readFileSync(new URL(`../${recording}`, import.meta.url))));
    for (const challenge of challenges) {
      const id = `${driver}-${challenge}`;
      const replay = JSON.parse(readFileSync(new URL(`../static/replays/${id}.json`, import.meta.url)));
      const { map, pack, version, seed, weather, time, result_sha, pass, flagged_choices } = source.results[challenge];
      assert.equal(replay.challenge, challenge);
      assert.equal(replay.source, recording);
      assert.equal(replay.suite_version, "legacy");
      assert.equal(replay.model, source.header.model);
      assert.equal(replay.result_sha, result_sha);
      assert.equal(replay.pass, pass);
      assert.equal(replay.choices.filter((choice) => choice.flag).length, flagged_choices);
      assert.ok(replay.frames.every((frame, i) => i === 0 || frame.t > replay.frames[i - 1].t));
      globalThis.fetch = async () => Response.json(replay);
      assert.equal((await loadPublishedDrive(id)).result_sha, result_sha);
      if (driver === "jev") {
        const config = { challenge, map, pack, version, seed, weather, time, map_sha: source.header.maps[map] };
        const end = replay.frames.at(-1).t;
        assert.equal(incidentDrive(config, { at_s: end }), id);
        assert.equal(incidentDrive(config, { at_s: Math.round(end * 10) / 10 }), id);
        for (const at_s of [end + 0.051, -1, Number.NaN, Infinity, undefined, null])
          assert.equal(incidentDrive(config, { at_s }), null);
        for (const mismatch of [{ map_sha: undefined }, { seed: seed + 1 }, { weather: "rain" }, { time: "night" }])
          assert.equal(incidentDrive({ ...config, ...mismatch }, { at_s: 1 }), null);
      }
    }
  }
  const replay = JSON.parse(readFileSync(new URL("../static/replays/jev-flagger.json", import.meta.url)));
  for (const bad of [
    { choices: {} },
    { events: null },
    { route: [] },
    { bounds: [] },
    { signals: {} },
    { frames: [] },
  ]) {
    globalThis.fetch = async () => Response.json({ ...replay, ...bad });
    await assert.rejects(loadPublishedDrive("jev-flagger"), /Replay data is incomplete/);
  }
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(loadPublishedDrive("jev-flagger"), /Request failed \(503\)/);
  globalThis.fetch = async () => Response.json(replay);
  replay.challenge = "right-on-red";
  await assert.rejects(loadPublishedDrive("jev-flagger"), /does not match the selected drive/);
  replay.challenge = "flagger";
  replay.result_sha = "another-result";
  await assert.rejects(loadPublishedDrive("jev-flagger"), /does not match the selected drive/);
} finally {
  globalThis.fetch = fetchDrive;
}
const frames = [10, 10.5, 11, 11.2, 11.2].map((t) => ({ t }));
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
let position = replayPosition(frames, 0, 0.25);
assert.equal(position.index, 0);
near(position.alpha, 0.5);
position = replayPosition(frames, 0, 1.1);
assert.equal(position.index, 2);
near(position.elapsed, 0.1);
near(position.alpha, 0.5);
position = replayPosition(frames, 0, 1.25);
assert.equal(position.index, 4);
assert(position.ended);
assert.equal(position.alpha, 0);
assert(replayPosition([], 0, 0).ended);
assert(replayPosition([{ t: 4 }], 0, 2).ended);
assert.equal(replayPosition(frames, 0, -1).alpha, 0);
// The real deck logic keeps fractional time on pause, resets it on seek, and
// restores only the destination checkpoint when a slow render skips several.
const lab = Object.assign(Object.create(DriveLab.prototype), {
  reviewing: true,
  playing: true,
  lastTick: 1000,
  replayElapsed: 0,
  replayAlpha: 0,
  replay: {},
  slider: { value: 0 },
  play: {},
  controls: {},
  replayStatus: {},
  recorder: { frames },
  seeks: [],
  seek(index) {
    this.slider.value = index;
    this.seeks.push(index);
    this.replayElapsed = 0;
    this.replayAlpha = 0;
  },
});
lab.update(lab.recorder, 1250);
near(lab.replayAlpha, 0.5);
lab.togglePlayback();
assert(!lab.playing);
lab.update(lab.recorder, 6000);
near(lab.replayAlpha, 0.5);
lab.togglePlayback();
assert(lab.playing);
lab.update(lab.recorder, lab.lastTick + 850);
assert.deepEqual(lab.seeks, [2]);
near(lab.replayAlpha, 0.5);
lab.update(lab.recorder, lab.lastTick + 200);
assert.equal(lab.slider.value, 4);
assert(!lab.playing);
assert.equal(lab.play.textContent, "Play replay");
lab.togglePlayback();
assert(lab.playing);
assert.equal(lab.slider.value, 0);
near(lab.replayAlpha, 0);
near(lab.replayElapsed, 0);
lab.endReview();
assert(!lab.playing && !lab.reviewing && lab.controls.hidden);

// A report's event time is relative to its drive, not the world's clock. The
// retained recording begins partway through this drive at world t=150.
const startedAt = "2026-11-07T19:00:00.000Z",
  recording = new DriveRecorder();
const report = { started_at: startedAt, recording_id: recording.recordingId };
const retained = Array.from({ length: 21 }, (_, i) => ({
  t: 150 + i / 2,
  state: { drive: { startedAt, elapsed: 50 + i / 2 } },
}));
recording.frames = retained;
assert.equal(
  reportIncidentTarget(recording, report, { at_s: 57.1 }),
  8,
  "start three seconds before event, rounded down to checkpoint",
);
assert.equal(
  reportIncidentTarget(recording, report, { at_s: 50.5 }),
  0,
  "available event can have less than three seconds of lead-in",
);
assert.equal(
  reportIncidentTarget(recording, report, { at_s: 49.9 }),
  null,
  "expired event must not seek an unrelated retained future",
);
assert.equal(reportIncidentTarget(recording, report, { at_s: 60.1 }), null, "event beyond recording is unavailable");
assert.equal(reportIncidentTarget(recording, report, { at_s: 50 }), 0);
assert.equal(reportIncidentTarget(recording, report, { at_s: 60 }), 14);
assert.equal(
  reportIncidentTarget(recording, report),
  10,
  "generic replay seeks near the end of this report's recording",
);
assert.equal(reportIncidentTarget(recording, { ...report, started_at: "other drive" }, { at_s: 57.1 }), null);
assert.equal(reportIncidentTarget(recording, {}, { at_s: 57.1 }), null);
assert.equal(reportIncidentTarget({ frames: [] }, report, { at_s: 57.1 }), null);
assert.equal(reportIncidentTarget(recording, report, { at_s: NaN }), null);
assert.equal(reportIncidentTarget(recording, report, { at_s: -1 }), null);
// A real event can round back before the oldest checkpoint by up to 0.05 s.
const rounded = retained.map((frame) => ({
  ...frame,
  t: frame.t + 0.03,
  state: { drive: { startedAt, elapsed: frame.state.drive.elapsed + 0.03 } },
}));
assert.equal(reportIncidentTarget({ ...recording, frames: rounded }, report, { at_s: 50 }), 0);
// Repeated branches retain the drive's start timestamp but replace its future.
// A report can navigate only the exact in-memory recording that produced it.
recording.branch(20);
assert.equal(reportIncidentTarget(recording, report), null);
const branchReport = { ...report, branched: true, recording_id: recording.recordingId };
assert.equal(reportIncidentTarget(recording, branchReport, { at_s: 57.1 }), 8);
recording.branch(20);
assert.equal(reportIncidentTarget(recording, branchReport, { at_s: 57.1 }), null);
const resetReport = { ...report, recording_id: recording.recordingId };
recording.reset();
recording.frames = retained;
assert.equal(reportIncidentTarget(recording, resetReport), null);
assert.equal(
  reportIncidentTarget({ ...recording, frames: retained }, { started_at: startedAt }, { at_s: 57.1 }),
  null,
  "legacy history has no live recording identity",
);
// Selecting another incident pauses and seeks even while replay is already open.
lab.recorder = { frames: retained };
lab.reviewing = true;
lab.playing = true;
lab.openReplay(3);
assert.equal(lab.slider.value, 3);
assert(!lab.playing);
assert(lab.reviewing);
assert(!lab.controls.hidden);
assert.equal(lab.play.textContent, "Play replay");
lab.endReview();
lab.openReplay(0);
assert.equal(lab.slider.value, 0);
assert(!lab.playing);
console.log(
  "Replay timing and incident navigation passed: variable intervals, pause/resume, nonzero drive start, retained boundaries, history identity and paused event seeking.",
);

// Lab validation additions
function test(label, fn) {
  const result = fn();
  if (result instanceof Promise) return result.then(() => console.log(`✓ ${label}`));
  console.log(`✓ ${label}`);
}
test("Recover the replay cursor and interpolation from nonnumeric inputs", () => {
  assert.deepEqual(replayPosition([{ t: 0 }, { t: 1 }], NaN, 0.25), {
    index: 0,
    elapsed: 0.25,
    alpha: 0.25,
    ended: false,
  });
  assert.deepEqual(replayPosition([{ t: 0 }, { t: 1 }, { t: 2 }], 1, NaN), {
    index: 1,
    elapsed: 0,
    alpha: 0,
    ended: false,
  });
});
test("Decline incident playback when a retained checkpoint lacks drive state", () => {
  const missingLast = [...retained.slice(0, -1), { t: retained.at(-1).t }];
  const missingFirst = [{ t: retained[0].t }, ...retained.slice(1)];
  for (const frames of [missingLast, missingFirst])
    assert.equal(reportIncidentTarget({ frames, recordingId: report.recording_id }, report, { at_s: 51 }), null);
});
test("Keep the original checkpoint when a branch request is outside the recording bounds", () => {
  const recorder = new DriveRecorder();
  recorder.frames = [{ t: 1 }, { t: 2 }];
  recorder.branch(-10);
  assert.deepEqual(
    recorder.frames.map((frame) => frame.t),
    [1],
  );
  assert.equal(recorder.at, 1);
});
test("Prevent empty or nonnumeric branch requests from invalidating recording identity", () => {
  const recorder = new DriveRecorder();
  const id = recorder.recordingId;
  recorder.branch(0);
  recorder.frames = [{ t: 1 }];
  recorder.branch(NaN);
  assert.equal(recorder.recordingId, id);
  assert.equal(recorder.branched, false);
});
test("Preserve sparse arrays and their trailing empty slots in a checkpoint", () => {
  const sparse = new Array(4);
  sparse[1] = "checkpoint";
  const copy = cloneState(sparse);
  assert.equal(copy.length, 4);
  assert.deepEqual(Object.keys(copy), ["1"]);
  assert.equal(copy[1], "checkpoint");
});
test("Check that a checkpoint preserves identity across map keys and set members", () => {
  const actor = { id: "car", speed: 0 };
  const original = { actor, map: new Map([[actor, actor]]), set: new Set([actor]) };
  const copy = cloneState(original);
  assert.equal(copy.map.get(copy.actor) === copy.actor, true);
  assert.equal(copy.set.has(copy.actor), true);
  copy.actor.speed = 1;
  assert.equal(actor.speed, 0);
});
test("Check that shared renderer handles retain identity across simulation checkpoints", () => {
  const instances = { meshes: ["headlight"] };
  const copy = cloneState({ instances });
  assert.equal(copy.instances === instances, true);
});
test("Check that branching trims only future incident markers", () => {
  const recorder = new DriveRecorder();
  recorder.frames = [{ t: 0 }, { t: 2 }, { t: 4 }];
  for (const t of [0, 2, 4]) recorder.mark(t, "collision");
  recorder.branch(1);
  assert.deepEqual(
    recorder.markers.map((m) => m.t),
    [0, 2],
  );
});
test("Check that restoring replay spend cannot decrease live model usage counters", () => {
  const recorder = new DriveRecorder();
  recorder.spend = { cost: 0.25, tokens: 1000, calls: 4 };
  const pilot = { totals: { cost: 0.1, tokens: 1100, calls: 1 } };
  recorder.restoreSpend(pilot);
  assert.deepEqual(pilot.totals, { cost: 0.25, tokens: 1100, calls: 4 });
});
test("Check that restoring a replay cannot rewind to another attempt in the same buffer", () => {
  const frames = [...retained.slice(0, -1), { ...retained.at(-1), state: { drive: { startedAt: "another drive" } } }];
  assert.equal(reportIncidentTarget({ frames, recordingId: report.recording_id }, report, { at_s: 52 }), null);
});
test("Check that a shared drive link round-trips zero-valued settings", () => {
  const link = new URL(
    driveLink(
      { challenge: "rain-check", seed: 0, traffic: 0, clock: 0, quality: "low" },
      "https://example.test/drive/",
    ),
  );
  assert.deepEqual(Object.fromEntries(link.searchParams), {
    challenge: "rain-check",
    seed: "0",
    traffic: "0",
    clock: "0",
    quality: "low",
  });
});
test("Use clean filename separators when a download slug ends at its length cap", () => {
  const name = exportFilename({ title: `${"a".repeat(47)} and more`, started_at: "2026-11-19T17:00:00Z" });
  assert.ok(name.startsWith(`jev-${"a".repeat(47)}-2026-`));
});
test("Check that a score-card filename uses the challenge ID and requested image extension", () => {
  const name = exportFilename(
    { config: { challenge: "À travers" }, title: "Different title", started_at: "2026-11-19T17:00:00Z" },
    "png",
    "jev-card",
  );
  assert.match(name, /^jev-card-a-travers-2026-11-19-\d{6}\.png$/);
});
await test("Check that copying a drive link offers the exact URL when clipboard access is denied", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldLocation = globalThis.location;
  globalThis.location = new URL("https://example.test/repo/");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    },
  });
  try {
    await assert.rejects(copyDriveLink({ challenge: "rain-check" }), (error) => {
      assert.match(error.message, /Clipboard unavailable/);
      assert.equal(new URL(error.link).searchParams.get("challenge"), "rain-check");
      return true;
    });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
    globalThis.location = oldLocation;
  }
});
await test("Keep complete Unicode characters when truncating score-card titles", async () => {
  const oldDocument = globalThis.document;
  const painted = [];
  const noop = () => {};
  const ctx = {
    createLinearGradient: () => ({ addColorStop: noop }),
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fillText: (value, _x, y) => {
      if (y === 157) painted.push(value);
    },
    measureText: (value) => ({ width: Array.from(value).length * 250 }),
  };
  globalThis.document = {
    createElement: () => ({ getContext: () => ctx, toBlob: (cb) => cb(null) }),
  };
  try {
    await assert.rejects(
      exportDriveCard({ title: "A🚘🚗🛻Z", categories: {}, driver: "manual", distance_m: 0, elapsed_s: 0 }),
      /Could not create the image/,
    );
    assert.deepEqual(painted, ["A🚘🚗…"]);
  } finally {
    globalThis.document = oldDocument;
  }
});
// End lab validation additions
