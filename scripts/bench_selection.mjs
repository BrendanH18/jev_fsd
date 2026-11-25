import { wholeNumber } from "./cli_tools.mjs";

const TAGS = Object.freeze({
  length: "length_m",
  signals: "signals",
  stops: "stops",
  lefts: "lefts",
  rights: "rights",
});

export const SELECTION_OPTIONS = Object.freeze(Object.keys(TAGS).flatMap((tag) => [`min-${tag}`, `max-${tag}`]));

export function routeRanges(args) {
  return Object.entries(TAGS).flatMap(([name, key]) => {
    const minOption = `min-${name}`;
    const maxOption = `max-${name}`;
    if (args[minOption] === undefined && args[maxOption] === undefined) return [];
    const min = wholeNumber(minOption, args[minOption], 0);
    const max = wholeNumber(maxOption, args[maxOption], Number.MAX_SAFE_INTEGER);
    if (min > max) throw new Error(`--${minOption} cannot exceed --${maxOption}.`);
    return [{ key, min, max }];
  });
}

export function selectBenchRoutes(suite, { only, skip, limit, startAt, ranges = [] } = {}) {
  const ids = suite.map((sc) => sc.id);
  const known = new Set(ids);
  if (known.size !== ids.length) throw new Error("The generated suite has duplicate scenario IDs.");
  const included = new Set(only);
  const excluded = new Set(skip);
  const missing = [...new Set([...included, ...excluded, ...(startAt ? [startAt] : [])])].filter(
    (id) => !known.has(id),
  );
  if (missing.length) throw new Error(`No scenario ${missing.join(", ")} in this suite (${ids.join(", ")}).`);
  for (const id of included) if (excluded.has(id)) throw new Error(`Scenario ${id} appears in both --only and --skip.`);
  const first = startAt ? ids.indexOf(startAt) : 0;
  const selected = suite
    .slice(first)
    .filter((sc) => {
      if ((only && !included.has(sc.id)) || excluded.has(sc.id)) return false;
      return ranges.every(({ key, min, max }) => {
        const value = sc.tags?.[key];
        if (!Number.isFinite(value) || value < 0) throw new Error(`Scenario ${sc.id} has no usable ${key} tag.`);
        return min <= value && value <= max;
      });
    })
    .slice(0, limit);
  if (!selected.length) throw new Error("The selection leaves no scenarios.");
  return selected;
}

export function routeCoverage(generated, selected, results) {
  const completed = new Set(results.map((r) => r.id));
  const included = new Set(selected.map((sc) => sc.id));
  const counts = new Map();
  for (const result of results)
    for (const failure of new Set(result.failures || [])) counts.set(failure, (counts.get(failure) || 0) + 1);
  return {
    generated: generated.length,
    selected: selected.length,
    completed: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).map((r) => r.id),
    pending: selected.filter((sc) => !completed.has(sc.id)).map((sc) => sc.id),
    excluded: generated.filter((sc) => !included.has(sc.id)).map((sc) => sc.id),
    failures: Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}
