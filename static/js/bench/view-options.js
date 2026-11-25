import { compatibleSuiteVersions, suiteVersion } from "./suite-version.js";

// Compare the conditions that determine a drive, while allowing different drivers.
export function comparisonIssue(current, baseline) {
  if (!compatibleSuiteVersions(current, baseline))
    return `The selected run uses suite ${suiteVersion(baseline)}. Deltas require compatible suite versions.`;
  const a = current.config || {};
  const b = baseline.config || {};
  const differences = [];
  const test = (name, x, y) => {
    if (x !== undefined && y !== undefined && x !== y) differences.push(name);
  };
  if (Array.isArray(a.bbox) && Array.isArray(b.bbox)) test("map", a.bbox.join(","), b.bbox.join(","));
  else test("map", a.map, b.map);
  test("map pack", a.pack, b.pack);
  test("traffic", a.npcs, b.npcs);
  test("clock mode", a.mode, b.mode);
  test("weather", a.weather || "dry", b.weather || "dry");
  test("world", a.features || "bare", b.features || "bare");
  test("track", a.track || "guarded", b.track || "guarded");
  test("parking", Boolean(a.park), Boolean(b.park));
  test("held-out policy", Boolean(a.heldout), Boolean(b.heldout));
  test("suite seed", a.seed, b.seed);
  test("route count", a.count, b.count);
  test("hour", a.hour ?? null, b.hour ?? null);
  test("feature exclusions", [...(a.without || [])].sort().join(","), [...(b.without || [])].sort().join(","));
  const aIds = current.results?.map(({ id }) => id).sort();
  const bIds = baseline.results?.map(({ id }) => id).sort();
  if (aIds && bIds) test("completed routes", aIds.join(","), bIds.join(","));
  return differences.length ? `Benchmark conditions differ (${differences.join(", ")}). Deltas are hidden.` : null;
}

export function validateRunInputs({ count, npcs, seed, mode, weather, heldout }, weatherNames) {
  const whole = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  if (!heldout && !whole(count, 1, 60)) throw new Error("Scenarios must be a whole number from 1 to 60.");
  if (!whole(npcs, 0, 120)) throw new Error("Traffic must be a whole number from 0 to 120.");
  if (!heldout && !whole(seed, 0, Number.MAX_SAFE_INTEGER))
    throw new Error("Suite seed must be a nonnegative whole number.");
  if (!["lockstep", "realtime"].includes(mode)) throw new Error("Choose the lockstep or realtime clock.");
  if (!weatherNames.includes(weather)) throw new Error(`Unknown benchmark weather "${weather}".`);
}

export function routeMatches(query, scenario, result) {
  const text = [scenario.id, ...(result?.failures || []), result?.simulation_error || ""].join(" ").toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((term) => text.includes(term));
}

export function benchmarkDownloadName(config, extension) {
  const slug = [
    config.map,
    config.brain,
    config.features || "bare",
    config.weather || "dry",
    config.heldout ? "heldout" : `s${config.seed}`,
  ]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 100);
  return `jev-benchmark-${slug}.${extension}`;
}
