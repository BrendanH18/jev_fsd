// Filters and selectors used by the Arena controls and its CSV export.
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export const arenaOutcome = (r) => (r.stopped ? "stopped" : r.simulation_error ? "error" : r.pass ? "pass" : "fail");

export function arenaDrives(challenges, roadTests, { subset, includeRoadTests, selected }) {
  if (subset === "road-tests") return [...roadTests];
  if (subset === "custom") return [...challenges, ...roadTests].filter((drive) => selected.has(drive.id));
  const pool = includeRoadTests ? [...challenges, ...roadTests] : challenges;
  return pool.filter((drive) => !subset || drive.map === subset);
}

export function filterArenaResults(results, { query, agent, verdict, track }, labels) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return results.filter((r) => {
    if (
      (agent && agent !== r.brain) ||
      (verdict && verdict !== arenaOutcome(r)) ||
      (track && track !== (r.track ?? "guarded"))
    )
      return false;
    if (!terms.length) return true;
    const search = normalize(
      [r.brain, labels.agent(r.brain), r.challenge, labels.challenge(r.challenge), r.map].join(" "),
    );
    return terms.every((term) => search.includes(term));
  });
}

export function filterTimeline(events, type) {
  return type ? events.filter((event) => event.type === type) : events;
}

export function timelineTypes(events) {
  return [...new Set(events.map((event) => event.type))].sort();
}
