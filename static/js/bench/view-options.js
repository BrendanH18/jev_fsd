import { compatibleSuiteVersions, suiteVersion } from "./suite-version.js";

const ROUTE_TAGS = ["length_m", "signals", "stops", "lefts", "rights"];

function routeComparisonIssue(current, baseline) {
  const a = current.results;
  const b = baseline.results;
  if (
    ![a, b].every(
      (rows) =>
        Array.isArray(rows) &&
        rows.length &&
        rows.every((result) => typeof result?.id === "string" && result.id.trim()),
    )
  )
    return "route identity unavailable";
  const byId = new Map(b.map((result) => [result.id, result]));
  const ids = new Set(a.map((result) => result.id));
  if (a.length !== b.length || ids.size !== a.length || byId.size !== b.length || a.some(({ id }) => !byId.has(id)))
    return "completed routes";
  // The fingerprint covers the whole generated suite, so it only identifies the driven routes of a
  // complete run. Subset (--only) runs fall back to the per-route geometry tags.
  const whole = (run) => run.manifest?.suite && !run.manifest.suite.only;
  const aSha = whole(current) && current.manifest.suite.route_sha;
  const bSha = whole(baseline) && baseline.manifest.suite.route_sha;
  if (aSha && bSha) return aSha === bSha ? null : "route fingerprints";
  // Older runs have no fingerprint. Match the same geometry tags as the offline inspector.
  for (const { id, tags } of a) {
    const other = byId.get(id).tags;
    for (const key of ROUTE_TAGS) {
      const x = tags?.[key];
      const y = other?.[key];
      const valid = key === "length_m" ? Number.isFinite : Number.isInteger;
      if (!valid(x) || x < 0 || !valid(y) || y < 0) return "route identity unavailable";
      if (x !== y) return "route tags";
    }
  }
  return null;
}

// A run stopped part way holds only a prefix of its suite: the page's Stop (state.stopped, and
// config.stopped once saved) or the CLI's budget stop (a top-level reason). A suite can be shorter
// than the requested count without having stopped, so the counts alone prove nothing.
function stoppedEarly(run) {
  return Boolean(run.stopped || run.config?.stopped);
}

// Compare the conditions that determine a drive, while allowing different drivers.
export function comparisonIssue(current, baseline) {
  if (!compatibleSuiteVersions(current, baseline))
    return `The selected run uses suite ${suiteVersion(baseline)}. Deltas require compatible suite versions.`;
  if (!current?.config || !baseline?.config) return "Benchmark conditions are unavailable. Deltas are hidden.";
  const a = current.config;
  const b = baseline.config;
  const differences = [];
  const test = (name, x, y) => {
    if (x !== undefined && y !== undefined && x !== y) differences.push(name);
  };
  if (Array.isArray(a.bbox) && Array.isArray(b.bbox)) test("map", a.bbox.join(","), b.bbox.join(","));
  else test("map", a.map, b.map);
  test("map pack", a.pack, b.pack);
  test("map fingerprint", current.manifest?.maps?.[a.map]?.fingerprint, baseline.manifest?.maps?.[b.map]?.fingerprint);
  test("JavaScript engine", a.engine?.split(" ")[0], b.engine?.split(" ")[0]);
  test("traffic", a.npcs, b.npcs);
  test("clock mode", a.mode, b.mode);
  test("weather", a.weather || "dry", b.weather || "dry");
  test("world", a.features || "bare", b.features || "bare");
  test("track", a.track || "guarded", b.track || "guarded");
  test("parking", Boolean(a.park), Boolean(b.park));
  test("held-out policy", Boolean(a.heldout), Boolean(b.heldout));
  test("suite seed", a.seed, b.seed);
  if (a.heldout && b.heldout) test("held-out seeds", a.seeds?.join(","), b.seeds?.join(","));
  test("route count", a.count, b.count);
  test("hour", a.hour ?? (a.features === "city" ? 15.5 : null), b.hour ?? (b.features === "city" ? 15.5 : null));
  test("covering row", a.cover ?? null, b.cover ?? null);
  test("feature exclusions", [...(a.without || [])].sort().join(","), [...(b.without || [])].sort().join(","));
  if (current.complete === false || baseline.complete === false) differences.push("a run is in progress");
  if (stoppedEarly(current) || stoppedEarly(baseline)) differences.push("a run stopped before its suite finished");
  const routeIssue = routeComparisonIssue(current, baseline);
  if (routeIssue) differences.push(routeIssue);
  return differences.length ? `Benchmark conditions differ (${differences.join(", ")}). Deltas are hidden.` : null;
}

export function validateRunInputs({ count, npcs, seed, mode, weather, heldout }, weatherNames, { form = false } = {}) {
  const whole = (value, min) => Number.isSafeInteger(value) && value >= min;
  if (!heldout && (!whole(count, 1) || (form && count > 60)))
    throw new Error(`Scenarios must be a whole number ${form ? "from 1 to 60" : "of at least 1"}.`);
  if (!whole(npcs, 0) || (form && npcs > 120))
    throw new Error(`Traffic must be a ${form ? "whole number from 0 to 120" : "nonnegative whole number"}.`);
  if (!heldout && !whole(seed, 0)) throw new Error("Suite seed must be a nonnegative whole number.");
  if (!["lockstep", "realtime"].includes(mode)) throw new Error("Choose the lockstep or realtime clock.");
  if (!weatherNames.includes(weather)) throw new Error(`Unknown benchmark weather "${weather}".`);
}

export function routeMatches(query, scenario, result) {
  const verdict = result ? (result.pass ? "verdict:pass" : "verdict:fail") : "verdict:pending";
  const parking = result?.no_space
    ? "parking:no-space"
    : result?.parked === true
      ? "parking:parked"
      : result?.parked === false
        ? "parking:failed"
        : "";
  const text = [scenario.id, verdict, parking, ...(result?.failures || []), result?.simulation_error || ""]
    .join(" ")
    .toLowerCase();
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
    config.track === "open" ? "open" : null,
    config.park ? "park" : null,
    config.hour !== undefined ? `hour-${config.hour}` : null,
    config.cover !== undefined ? `cover-${config.cover}` : null,
    config.mode === "realtime" ? "realtime" : null,
  ]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 100);
  return `jev-benchmark-${slug}.${extension}`;
}
