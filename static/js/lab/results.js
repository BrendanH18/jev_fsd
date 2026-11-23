// The committed results (data/results.json, built by scripts/build_results.py) arranged for the
// leaderboard page (ui/results.js). Pure functions of the file: no DOM, so Node checks them against
// the README table (scripts/test_results_page.mjs).
import { CUSTOM_SUITE, LEGACY_SUITE, suiteVersion } from "../bench/suite-version.js";

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

export function resultVersions(data) {
  return [...new Set(data.rows.map(suiteVersion))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

export const suiteLabel = (version) =>
  version === LEGACY_SUITE ? "Legacy results" : version === CUSTOM_SUITE ? "Custom runs" : `Suite ${version}`;

function rankedRows(data, version) {
  return version === CUSTOM_SUITE ? [] : data.rows.filter((row) => suiteVersion(row) === version);
}

// One line per driver that ran the full challenge set or the city suite, as the README table has it;
// drivers with only a pilot go to `pilots`.
export function summary(data, version = LEGACY_SUITE) {
  const drivers = [],
    pilots = [];
  const rows = rankedRows(data, version);
  for (const [id, info] of Object.entries(data.drivers)) {
    const mine = rows.filter((r) => r.driver === id);
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
      model: (challenges || open || city[0]).model ?? null,
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

function withFailures(run, drive) {
  return { ...drive, failures: run.failed.find((f) => f.id === drive.id)?.failures ?? [] };
}

// The challenge set as a matrix: one row per challenge or road test, in the order the first driver
// drove them, one cell per driver that ran the full set; `suite` "open" for the open track's runs.
export function challengeMatrix(data, suite = "challenges", version = LEGACY_SUITE) {
  const latest = new Map();
  for (const row of rankedRows(data, version))
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
        return drive ? withFailures(run, drive) : null;
      }),
    })),
  };
}

// Result rows are newest first within each driver and suite.
export function compatibleChallengeDrive(data, driver, config) {
  if (!config.map_sha) return null;
  for (const run of data.rows) {
    if (run.suite !== "challenges" || run.driver !== driver || suiteVersion(run) === CUSTOM_SUITE) continue;
    const drive = run.drives.find(
      (d) =>
        d.id === config.challenge &&
        d.map === config.map &&
        d.version === config.version &&
        d.pack === config.pack &&
        d.map_sha === config.map_sha,
    );
    if (drive) return withFailures(run, drive);
  }
  return null;
}

// The city suite: one row per map and weather, one column per driver that ran it.
export function cityGrid(data, version = LEGACY_SUITE) {
  const runs = rankedRows(data, version).filter((r) => r.suite === "city");
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
    .map((r) => {
      const legacyReplay = !r.manifest?.source_commit && Boolean(r.replay_source_commit);
      const runner = r.map ? "bench_node" : "arena_node";
      return {
        driver: r.driver,
        suite_version: suiteVersion(r),
        label: r.label,
        recording: r.recording,
        sourceCommit: r.manifest?.source_commit ?? r.replay_source_commit,
        engine: r.manifest?.engine || r.engine,
        legacyReplay,
        command: `node --experimental-default-type=module scripts/${runner}.mjs --port 8322 --replay ${r.recording}${legacyReplay ? "" : " --check replay"}`,
      };
    });
}

export function percentText(value) {
  if (value === null || value === undefined) return "n/a";
  return `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}
export const moneyText = (value) =>
  value ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0";
