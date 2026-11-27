// The committed results (data/results.json, built by scripts/build_results.py) arranged for the
// leaderboard page (ui/results.js). Pure functions of the file: no DOM, so Node checks them against
// the README table (scripts/test_results_page.mjs).
import { CUSTOM_SUITE, LEGACY_SUITE, suiteVersion } from "../bench/suite-version.js";

export const RESULTS_FORMAT = "jev-results/1";
export const WEATHERS = ["dry", "fog", "rain", "snow"];
export const HOME_MAP = "kitsilano";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const measure = (value) => Number.isFinite(value) && value >= 0;
const optional = (value, valid) => value == null || valid(value);
const list = (value, valid) => Array.isArray(value) && value.every(valid);

export function repositoryArtifact(path) {
  return (
    text(path) && path.split("/").every((part) => part && part !== "." && part !== ".." && !/[\\\p{Cc}]/u.test(part))
  );
}

function checkRun(row, index) {
  const require = (valid, field) => {
    if (!valid) throw new Error(`Results row ${index + 1} has invalid ${field}.`);
  };
  require(record(row), "run data");
  require(text(row.driver), "driver");
  require(text(row.label), "label");
  require(text(row.suite), "suite");
  require(optional(
    row.suite_version,
    (version) => /^(?:legacy|custom|v[1-9]\d*)$/.test(version) && text(version),
  ), "suite version");
  require(count(row.total) && count(row.passed) && row.passed <= row.total, "pass counts");
  require(optional(row.date, (date) => text(date) && Number.isFinite(Date.parse(date))), "date");
  require(list(row.sources, repositoryArtifact) && row.sources.length > 0, "sources");
  require(optional(row.recording, repositoryArtifact), "recording path");
  require(optional(row.model, text), "model");
  require(optional(row.submitter, text), "submitter");
  require(optional(row.track, (track) => track === "open" || track === "guarded"), "track");
  require(optional(row.flagged_choices, count), "flag count");
  require(optional(row.cost_usd, measure), "cost");
  require(optional(row.fallbacks, count), "fallback count");
  require(optional(row.model_share, (share) => measure(share) && share <= 1), "model decision share");
  if (row.suite === "city") {
    require(text(row.map), "city map");
    require(text(row.weather), "city weather");
  }
  require(optional(row.failed, (failed) =>
    list(failed, (f) => record(f) && text(f.id) && list(f.failures, text)),
  ), "failure details");
  if (row.suite === "open" || row.suite === "challenges" || row.drives !== undefined) {
    require(list(row.drives, record), "drive list");
    const ids = new Set();
    for (const drive of row.drives) {
      require(text(drive.id), "drive ID");
      require(!ids.has(drive.id), `duplicate drive ID "${drive.id}"`);
      ids.add(drive.id);
      require(text(drive.map), "drive map");
      require(typeof drive.pass === "boolean", "drive verdict");
      require(optional(drive.time_s, measure), "drive duration");
      require(optional(drive.flagged_choices, count), "drive flag count");
      require(optional(drive.score_inputs, record), "drive score inputs");
      require(optional(drive.comparison_score_inputs, record), "comparison score inputs");
      require(optional(
        drive.incident_counts,
        (counts) => record(counts) && Object.values(counts).every(count),
      ), "incident counts");
    }
  }
}

const sum = (rows, key) => rows.reduce((total, r) => total + (r[key] || 0), 0);
export const fraction = (rows) => ({ passed: sum(rows, "passed"), total: sum(rows, "total") });
export const fractionText = (f) => (f ? `${f.passed}/${f.total}` : "not run");

export function checkResults(data) {
  if (
    !data ||
    data.format !== RESULTS_FORMAT ||
    !Array.isArray(data.rows) ||
    !data.drivers ||
    typeof data.drivers !== "object" ||
    Array.isArray(data.drivers)
  ) {
    throw new Error(`Not a results file (${RESULTS_FORMAT}).`);
  }
  if (!optional(data.maps, (maps) => record(maps) && Object.values(maps).every(text)))
    throw new Error("The results file has an invalid map catalog.");
  for (const [id, info] of Object.entries(data.drivers)) {
    if (!record(info) || !optional(info.label, text) || !optional(info.submitter, text))
      throw new Error(`The results file has invalid driver details for "${id}".`);
  }
  data.rows.forEach(checkRun);
  return data;
}

export function resultVersions(data) {
  return [...new Set(data.rows.map(suiteVersion))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

export const suiteLabel = (version) =>
  version === LEGACY_SUITE ? "Legacy results" : version === CUSTOM_SUITE ? "Custom runs" : `Suite ${version}`;

export const selectedSuite = (versions, requested, preferred = versions[0]) =>
  versions.includes(requested) ? requested : (preferred ?? LEGACY_SUITE);

// The suite the leaderboard opens on when its address names none: the newest in which a model has a
// published result, else the newest. A suite that so far holds only the built-in drivers' runs (a
// new suite the day Rules is recorded on it) has nothing to compare yet, and stays one pick away.
const BUILT_IN_KINDS = new Set(["rules", "agent"]);
export function defaultSuite(data) {
  const versions = resultVersions(data).filter((version) => version !== CUSTOM_SUITE);
  const hasModel = (version) =>
    data.rows.some((row) => {
      if (suiteVersion(row) !== version) return false;
      const driver = Object.hasOwn(data.drivers ?? {}, row.driver) ? data.drivers[row.driver] : null;
      return Boolean(driver?.kind) && !BUILT_IN_KINDS.has(driver.kind);
    });
  return versions.find(hasModel) ?? versions[0] ?? resultVersions(data)[0];
}

export function matchesCoverage(cells, coverage) {
  if (!coverage) return true;
  const complete = cells.every(Boolean);
  if (coverage === "complete") return cells.length > 0 && complete;
  if (coverage === "missing") return !complete;
  return true;
}

export function driverDisplayName(data, id) {
  const driver = Object.hasOwn(data.drivers, id) ? data.drivers[id] : null;
  const name = driver?.label || id;
  return driver?.submitter ? `${name} (submitted by @${driver.submitter})` : name;
}

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
  return { ...drive, failures: run.failed?.find((f) => f.id === drive.id)?.failures ?? [] };
}

// The challenge set as a matrix: one row per challenge or road test, in the order the first driver
// drove them, one cell per driver that ran the full set; `suite` "open" for the open track's runs.
export function challengeMatrix(data, suite = "challenges", version = LEGACY_SUITE) {
  const latest = new Map();
  for (const row of rankedRows(data, version))
    if (row.suite === suite && !latest.has(row.driver)) latest.set(row.driver, row);
  const runs = [...latest.values()];
  const order = new Map();
  const cellsByRun = runs.map((run) => {
    const cells = new Map();
    const failures = new Map((run.failed || []).map((entry) => [entry.id, entry.failures]));
    for (const drive of run.drives) {
      if (!order.has(drive.id)) order.set(drive.id, drive.map);
      if (!cells.has(drive.id)) cells.set(drive.id, { ...drive, failures: failures.get(drive.id) ?? [] });
    }
    return cells;
  });
  return {
    drivers: runs.map((r) => r.driver),
    runs,
    rows: Array.from(order, ([id, map]) => ({ id, map, cells: cellsByRun.map((cells) => cells.get(id) ?? null) })),
  };
}

// Result rows are newest first within each driver and suite.
export function compatibleChallengeDrive(data, driver, config) {
  if (!config?.map_sha) return null;
  for (const run of data.rows) {
    if (
      run.suite !== "challenges" ||
      run.driver !== driver ||
      (run.track ?? "guarded") !== "guarded" ||
      suiteVersion(run) === CUSTOM_SUITE
    )
      continue;
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
  const rank = (values, key) => {
    const index = values.indexOf(key);
    return index < 0 ? values.length : index;
  };
  places.sort(
    (a, b) =>
      rank(maps, a.map) - rank(maps, b.map) ||
      a.map.localeCompare(b.map) ||
      rank(WEATHERS, a.weather) - rank(WEATHERS, b.weather) ||
      a.weather.localeCompare(b.weather),
  );
  return {
    drivers,
    rows: places.map((p) => ({
      ...p,
      cells: drivers.map((d) => runs.find((r) => r.driver === d && r.map === p.map && r.weather === p.weather) || null),
    })),
  };
}

// Recorded drives that replay with no key, one command each.
export const mapDisplayName = (data, id) => (Object.hasOwn(data.maps ?? {}, id) ? data.maps[id] : id);

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
        command: `node --experimental-default-type=module scripts/${runner}.mjs --port 8322 --replay ${shellPath(r.recording)}${legacyReplay ? "" : " --check replay"}`,
      };
    });
}

const shellPath = (value) => {
  const path = value.startsWith("-") ? `./${value}` : value;
  return /^[\w./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
};

export function percentText(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}
export const moneyText = (value) =>
  !measure(value)
    ? "n/a"
    : value
      ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "$0";
