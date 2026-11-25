// Keep published benchmarks comparable to the version and street pack used for the driver check.
export function publishedDrives(leaderboard, track, selected) {
  const rows = leaderboard.rows
    .filter((row) => row.recording && !row.map && (row.track ?? "guarded") === track)
    .sort((a, b) => b.date.localeCompare(a.date));
  const drivers = new Map();
  for (const row of rows) {
    if (!drivers.has(row.driver)) drivers.set(row.driver, new Map());
    const drives = drivers.get(row.driver);
    for (const drive of row.drives) {
      const key = `${drive.map}/${drive.id}`;
      const current = selected.get(key);
      if (current && !drives.has(key) && drive.version === current.version && drive.pack === current.pack)
        drives.set(key, { ...drive, date: row.date });
    }
  }
  return drivers;
}
