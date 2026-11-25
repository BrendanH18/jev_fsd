// Read the benchmark's session hand-off without silently opening a different drive.
export function readWatchReplay(params, storage = undefined) {
  if (!params.has("replay")) return null;
  let raw;
  try {
    raw = (storage ?? globalThis.localStorage)?.getItem("jev-fsd-replay");
  } catch {
    throw new Error("Browser storage is unavailable. Open Watch from the benchmark in a window with storage enabled.");
  }
  if (!raw) throw new Error("This watch link has no saved drive. Open Watch from the benchmark again in this browser.");
  let replay;
  try {
    replay = JSON.parse(raw);
  } catch {
    throw new Error("The saved benchmark drive is unreadable. Open Watch from the benchmark again.");
  }
  if (
    !replay?.scenario ||
    !Number.isFinite(replay.scenario.start?.s) ||
    !Number.isInteger(replay.scenario.start?.lane) ||
    !replay.scenario.route
  )
    throw new Error("The saved benchmark drive is incomplete. Run the benchmark and open Watch again.");
  return replay;
}
