import assert from "node:assert/strict";
import { replayPosition, reportIncidentTarget } from "../static/js/lab/playback.js";
import { DriveRecorder } from "../static/js/lab/recorder.js";

globalThis.document = { querySelector: () => null };
const { DriveLab } = await import("../static/js/ui/lab.js");
const frames = [10, 10.5, 11, 11.2, 11.2].map(t => ({ t }));
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
let position = replayPosition(frames, 0, 0.25);
assert.equal(position.index, 0); near(position.alpha, 0.5);
position = replayPosition(frames, 0, 1.1);
assert.equal(position.index, 2); near(position.elapsed, 0.1); near(position.alpha, 0.5);
position = replayPosition(frames, 0, 1.25);
assert.equal(position.index, 4); assert(position.ended); assert.equal(position.alpha, 0);
assert(replayPosition([], 0, 0).ended);
assert(replayPosition([{ t: 4 }], 0, 2).ended);
assert.equal(replayPosition(frames, 0, -1).alpha, 0);
// The real deck logic keeps fractional time on pause, resets it on seek, and
// restores only the destination checkpoint when a slow render skips several.
const lab = Object.assign(Object.create(DriveLab.prototype), {
  reviewing: true, playing: true, lastTick: 1000, replayElapsed: 0, replayAlpha: 0,
  replay: {}, slider: { value: 0 }, play: {}, controls: {}, replayStatus: {}, recorder: { frames },
  seeks: [], seek(index) {
    this.slider.value = index; this.seeks.push(index); this.replayElapsed = 0; this.replayAlpha = 0;
  },
});
lab.update(lab.recorder, 1250); near(lab.replayAlpha, 0.5);
lab.togglePlayback(); assert(!lab.playing);
lab.update(lab.recorder, 6000); near(lab.replayAlpha, 0.5);
lab.togglePlayback(); assert(lab.playing);
lab.update(lab.recorder, lab.lastTick + 850);
assert.deepEqual(lab.seeks, [2]); near(lab.replayAlpha, 0.5);
lab.update(lab.recorder, lab.lastTick + 200);
assert.equal(lab.slider.value, 4); assert(!lab.playing); assert.equal(lab.play.textContent, "Play replay");
lab.togglePlayback(); assert(lab.playing); assert.equal(lab.slider.value, 0);
near(lab.replayAlpha, 0); near(lab.replayElapsed, 0);
lab.endReview(); assert(!lab.playing && !lab.reviewing && lab.controls.hidden);

// A report's event time is relative to its drive, not the world's clock. The
// retained recording begins partway through this drive at world t=150.
const startedAt = "2026-11-07T19:00:00.000Z", recording = new DriveRecorder();
const report = { started_at: startedAt, recording_id: recording.recordingId };
const retained = Array.from({ length: 21 }, (_, i) => ({ t: 150 + i / 2,
  state: { drive: { startedAt, elapsed: 50 + i / 2 } } }));
recording.frames = retained;
assert.equal(reportIncidentTarget(recording, report, { at_s: 57.1 }), 8, "start three seconds before event, rounded down to checkpoint");
assert.equal(reportIncidentTarget(recording, report, { at_s: 50.5 }), 0, "available event can have less than three seconds of lead-in");
assert.equal(reportIncidentTarget(recording, report, { at_s: 49.9 }), null, "expired event must not seek an unrelated retained future");
assert.equal(reportIncidentTarget(recording, report, { at_s: 60.1 }), null, "event beyond recording is unavailable");
assert.equal(reportIncidentTarget(recording, report, { at_s: 50 }), 0);
assert.equal(reportIncidentTarget(recording, report, { at_s: 60 }), 14);
assert.equal(reportIncidentTarget(recording, report), 10, "generic replay seeks near the end of this report's recording");
assert.equal(reportIncidentTarget(recording, { ...report, started_at: "other drive" }, { at_s: 57.1 }), null);
assert.equal(reportIncidentTarget(recording, {}, { at_s: 57.1 }), null);
assert.equal(reportIncidentTarget({ frames: [] }, report, { at_s: 57.1 }), null);
assert.equal(reportIncidentTarget(recording, report, { at_s: NaN }), null);
assert.equal(reportIncidentTarget(recording, report, { at_s: -1 }), null);
// A real event can round back before the oldest checkpoint by up to 0.05 s.
const rounded = retained.map(frame => ({ ...frame, t: frame.t + 0.03,
  state: { drive: { startedAt, elapsed: frame.state.drive.elapsed + 0.03 } } }));
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
recording.reset(); recording.frames = retained;
assert.equal(reportIncidentTarget(recording, resetReport), null);
assert.equal(reportIncidentTarget({ ...recording, frames: retained }, { started_at: startedAt }, { at_s: 57.1 }), null, "legacy history has no live recording identity");
// Selecting another incident pauses and seeks even while replay is already open.
lab.recorder = { frames: retained }; lab.reviewing = true; lab.playing = true;
lab.openReplay(3);
assert.equal(lab.slider.value, 3); assert(!lab.playing); assert(lab.reviewing); assert(!lab.controls.hidden);
assert.equal(lab.play.textContent, "Play replay");
lab.endReview(); lab.openReplay(0); assert.equal(lab.slider.value, 0); assert(!lab.playing);
console.log("Replay timing and incident navigation passed: variable intervals, pause/resume, nonzero drive start, retained boundaries, history identity and paused event seeking.");
