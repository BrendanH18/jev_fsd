import { matchesCoverage } from "./results.js";

export function searchMatches(query, fields) {
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const haystack = normalize(fields.join(" "));
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

export const RESULTS_FILTERS = {
  query: "",
  issues: "",
  coverage: "",
  map: "",
  kind: "",
  weather: "",
  driver: "",
  sort: "",
  direction: "",
  metric: "",
};

export function readResultFilters(params, section, options) {
  return Object.fromEntries(
    Object.entries(RESULTS_FILTERS).map(([key, fallback]) => {
      const value = params.get(`${section}-${key}`);
      return [key, key === "query" ? (value ?? "").slice(0, 160) : options[key]?.includes(value) ? value : fallback];
    }),
  );
}

export function writeResultFilters(params, section, state) {
  for (const key of Object.keys(RESULTS_FILTERS)) {
    const name = `${section}-${key}`;
    if (state[key]) params.set(name, state[key]);
    else params.delete(name);
  }
}

export function filterResultRows(rows, state, details) {
  const { describe, kind, failed, metric } = details;
  const visible = rows.filter((row) => {
    const cells = state.driver ? [row.cells[details.drivers.indexOf(state.driver)]] : row.cells;
    const measured = cells.filter(Boolean);
    if (state.map && row.map !== state.map) return false;
    if (state.kind && kind?.(row) !== state.kind) return false;
    if (state.weather && row.weather !== state.weather) return false;
    if (state.driver && !measured.length) return false;
    if (!matchesCoverage(row.cells, state.coverage)) return false;
    if (state.issues === "fail" && !measured.some(failed)) return false;
    if (state.issues === "pass" && (!measured.length || measured.some(failed))) return false;
    if (
      state.issues === "split" &&
      !(row.cells.some((cell) => cell && failed(cell)) && row.cells.some((cell) => cell && !failed(cell)))
    )
      return false;
    if (state.issues === "flags" && !measured.some((cell) => cell.flagged_choices > 0)) return false;
    if (state.issues === "any" && !measured.some((cell) => failed(cell) || cell.flagged_choices > 0)) return false;
    return !state.query || searchMatches(state.query, describe(row));
  });
  if (!state.sort) return visible;
  const dir = state.direction === "desc" ? -1 : 1;
  return visible
    .map((row) => ({ row, value: metric(row, state.sort, state.metric) }))
    .sort((a, b) => {
      if (a.value == null) return b.value == null ? 0 : 1;
      if (b.value == null) return -1;
      return (
        dir *
        (typeof a.value === "string" ? a.value.localeCompare(b.value, undefined, { numeric: true }) : a.value - b.value)
      );
    })
    .map(({ row }) => row);
}
