// Keep published benchmarks comparable to the version and street pack used for the driver check.
export function publishedDrives(leaderboard, track, selected) {
  if (!Array.isArray(leaderboard?.rows)) throw new Error("The published leaderboard needs a rows array.");
  const rows = leaderboard.rows
    .filter(
      (row) =>
        row?.recording &&
        !row.map &&
        (row.track ?? "guarded") === track &&
        typeof row.date === "string" &&
        typeof row.driver === "string" &&
        Array.isArray(row.drives) &&
        (row.mode === undefined || row.mode === "lockstep"),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const drivers = new Map();
  for (const row of rows) {
    if (!drivers.has(row.driver)) drivers.set(row.driver, new Map());
    const drives = drivers.get(row.driver);
    for (const drive of row.drives) {
      if (typeof drive?.map !== "string" || typeof drive.id !== "string") continue;
      const key = `${drive.map}/${drive.id}`;
      const current = selected.get(key);
      if (!current || drives.has(key) || drive.version !== current.version || drive.pack !== current.pack) continue;
      if (drive.seed !== undefined && current.seed !== undefined && drive.seed !== current.seed) continue;
      if (drive.weather !== undefined && current.weather !== undefined && drive.weather !== current.weather) continue;
      if (drive.time !== undefined && current.time !== undefined && drive.time !== current.time) continue;
      drives.set(key, { ...drive, date: row.date });
    }
  }
  return drivers;
}
