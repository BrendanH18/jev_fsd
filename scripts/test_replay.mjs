import assert from "node:assert/strict";
import { replayPosition } from "../static/js/lab/playback.js";

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
console.log("Replay timing passed: variable intervals, duplicate checkpoints, dropped frames, pause/resume, replay restart and state reset.");
