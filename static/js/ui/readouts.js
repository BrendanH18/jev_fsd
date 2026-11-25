import { formatClock } from "../sim/world-clock.js";

export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return "–";
  if (metres <= 0) return "0 m";
  if (metres < 100) return `${Math.ceil(metres)} m`;
  const rounded = Math.round(metres / 10) * 10;
  return rounded >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${rounded} m`;
}

export function describeClock(hour, presets) {
  for (const [name, time] of Object.entries(presets)) {
    if (formatClock(time) === formatClock(hour)) return name;
  }
  return formatClock(hour);
}

export function orderedProbabilities(probabilities) {
  return Object.entries(probabilities || {})
    .filter(([, value]) => Number.isFinite(value) && value >= 0 && value <= 1)
    .sort((a, b) => b[1] - a[1]);
}

export function noticePriority(kind) {
  if (kind === "alert") return 3;
  if (kind === "safety") return 2;
  if (kind === "stop") return 1;
  return 0;
}

export function displaySource(meta) {
  if (meta.source === "rules_fallback" || meta.fallback) return "Rules fallback";
  if (meta.source === "local") return "Local decision";
  if (meta.source === "jev") return "Jev";
  if (meta.source === "rules") return "Rules";
  return meta.model || meta.source || "–";
}
