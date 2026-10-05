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
