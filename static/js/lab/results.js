// The committed results (data/results.json, built by scripts/build_results.py) arranged for the
// leaderboard page (ui/results.js). Pure functions of the file: no DOM, so Node checks them against
// the README table (scripts/test_results_page.mjs).

export const RESULTS_FORMAT = "jev-results/1";
export const WEATHERS = ["dry", "fog", "rain", "snow"];
export const HOME_MAP = "kitsilano";

const sum = (rows, key) => rows.reduce((total, r) => total + (r[key] || 0), 0);
export const fraction = (rows) => ({ passed: sum(rows, "passed"), total: sum(rows, "total") });
export const fractionText = (f) => (f ? `${f.passed}/${f.total}` : "not run");

export function checkResults(data) {
  if (!data || data.format !== RESULTS_FORMAT || !Array.isArray(data.rows) || !data.drivers) {
    throw new Error(`Not a results file (${RESULTS_FORMAT}).`);
  }
  return data;
}

// One line per driver that ran the full challenge set or the city suite, as the README table has it;
// drivers with only a pilot go to `pilots`.
export function summary(data) {
  const drivers = [],
    pilots = [];
  for (const [id, info] of Object.entries(data.drivers)) {
    const mine = data.rows.filter((r) => r.driver === id);
    const challenges = mine.find((r) => r.suite === "challenges") || null;
    // (the same set on the open track: static/js/brain/tracks.js)
    const open = mine.find((r) => r.suite === "open") || null;
    const city = mine.filter((r) => r.suite === "city");
    const pilot = mine.filter((r) => r.suite === "pilot");
    if (!challenges && !open && !city.length) {
      if (pilot.length) pilots.push({ id, ...info, rows: pilot, ...fraction(pilot) });
      continue;
    }
    const home = Object.fromEntries(
      WEATHERS.map((w) => [w, city.find((r) => r.map === HOME_MAP && r.weather === w) || null]),
    );
    const others = city.filter((r) => r.map !== HOME_MAP && r.weather === "dry");
    drivers.push({
      id,
      ...info,
      challenges,
      open,
      home,
      others: others.length ? { ...fraction(others), maps: others.length, rows: others } : null,
      share: challenges?.model_share ?? null,
      // (a driver run on the open track alone: that run's cost, marked so)
      cost: challenges ? challenges.cost_usd : (open?.cost_usd ?? 0),
      costTrack: !challenges && open ? "open" : null,
      pilots: pilot,
    });
  }
  return { drivers, pilots };
}

// The challenge set as a matrix: one row per challenge or road test, in the order the first driver
// drove them, one cell per driver that ran the full set; `suite` "open" for the open track's runs.
export function challengeMatrix(data, suite = "challenges") {
  const latest = new Map();
  for (const row of data.rows)
    if (row.suite === suite && !latest.has(row.driver)) latest.set(row.driver, row);
  const runs = [...latest.values()];
  const order = [];
  for (const run of runs)
    for (const d of run.drives) if (!order.some((o) => o.id === d.id)) order.push({ id: d.id, map: d.map });
  return {
    drivers: runs.map((r) => r.driver),
    runs,
    rows: order.map((o) => ({
      ...o,
      cells: runs.map((run) => {
        const drive = run.drives.find((d) => d.id === o.id);
        if (!drive) return null;
        const failed = run.failed.find((f) => f.id === o.id);
        return { ...drive, failures: failed ? failed.failures : [] };
      }),
    })),
  };
}

// The city suite: one row per map and weather, one column per driver that ran it.
export function cityGrid(data) {
  const runs = data.rows.filter((r) => r.suite === "city");
  const drivers = [...new Set(runs.map((r) => r.driver))];
  const maps = Object.keys(data.maps || {});
  const places = [];
  for (const run of runs)
    if (!places.some((p) => p.map === run.map && p.weather === run.weather))
      places.push({ map: run.map, weather: run.weather });
  places.sort(
    (a, b) => maps.indexOf(a.map) - maps.indexOf(b.map) || WEATHERS.indexOf(a.weather) - WEATHERS.indexOf(b.weather),
  );
  return {
    drivers,
    rows: places.map((p) => ({
      ...p,
      cells: drivers.map((d) => runs.find((r) => r.driver === d && r.map === p.map && r.weather === p.weather) || null),
    })),
  };
}

// Model drives that replay with no key, one command each.
export function recordings(data) {
  return data.rows
    .filter((r) => r.recording)
    .map((r) => ({
      driver: r.driver,
      label: r.label,
      recording: r.recording,
      command: `node --experimental-default-type=module scripts/${r.map ? "bench_node" : "arena_node"}.mjs --port 8322 --replay ${r.recording} --check replay`,
    }));
}

export function percentText(value) {
  if (value === null || value === undefined) return "n/a";
  return `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}
export const moneyText = (value) =>
  value ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0";
