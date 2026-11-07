// Move along recorded simulation time, including short or duplicate final checkpoints.
export function replayPosition(frames, index, elapsed) {
  if (!frames.length) return { index: 0, elapsed: 0, alpha: 0, ended: true };
  index = Math.max(0, Math.min(frames.length - 1, Math.round(index)));
  elapsed = Math.max(0, elapsed);
  while (index < frames.length - 1) {
    const duration = Math.max(0, frames[index + 1].t - frames[index].t);
    if (elapsed < duration) return { index, elapsed, alpha: elapsed / duration, ended: false };
    elapsed -= duration;
    index++;
  }
  return { index, elapsed: 0, alpha: 0, ended: true };
}

// Reports use elapsed drive time; checkpoints use absolute simulation time. The
// drive may start long after the world, and its oldest checkpoints may roll away.
export function reportIncidentTarget(recorder, report, incident) {
  const frames = recorder.frames;
  const first = frames[0], last = frames.at(-1), drive = first?.state.drive;
  if (!drive || !report?.recording_id || report.recording_id !== recorder.recordingId
    || !report.started_at || drive.startedAt !== report.started_at
    || last.state.drive?.startedAt !== report.started_at || !Number.isFinite(drive.elapsed)) return null;
  if (incident === undefined) return Math.max(0, frames.length - 11);
  if (!Number.isFinite(incident?.at_s) || incident.at_s < 0) return null;
  const eventTime = first.t - drive.elapsed + incident.at_s;
  // Incident timestamps are rounded to tenths of a second in the score report.
  if (eventTime < first.t - 0.05 - 1e-9 || eventTime > last.t + 0.05 + 1e-9) return null;
  const target = Math.max(first.t, eventTime - 3);
  return Math.max(0, frames.findLastIndex(frame => frame.t <= target + 1e-9));
}
