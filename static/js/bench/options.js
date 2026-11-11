import { FEATURE_NAMES, coveringArray, featureSubset } from "./features.js";
export const FEATURE_PRESETS = ["bare", "city"];
export const CITY_HOUR = 15.5, CITY_WEEKDAY = 0;

// Only nondefault options enter saved configs. Accept the same shape from CLI, browser and replay.
export function benchmarkConfig({ features = "bare", park = false, hour, without = [], cover } = {}) {
  if (!FEATURE_PRESETS.includes(features)) throw new Error(`Unknown feature preset "${features}": use ${FEATURE_PRESETS.join(" or ")}.`);
  if (typeof park !== "boolean") throw new Error("park must be true or false.");
  if (hour !== undefined && (typeof hour !== "number" || !Number.isFinite(hour) || hour < 0 || hour >= 24)) throw new Error("hour must be a number from 0 inclusive to 24 exclusive.");
  if (typeof without === "string") without = without ? without.split(",") : [];
  if (!Array.isArray(without) || without.some(name => !FEATURE_NAMES.includes(name))) throw new Error(`Unknown feature in without: use ${FEATURE_NAMES.join(",")}.`);
  if (features === "bare" && (without.length || cover !== undefined)) throw new Error("without and cover require the city preset.");
  if (cover !== undefined) {
    const rows = coveringArray();
    if (!Number.isInteger(cover) || cover < 0 || cover >= rows.length) throw new Error(`cover must be an index from 0 to ${rows.length - 1}.`);
    const row = rows[cover];
    without = [...without, ...row.without];
    park = park || row.park;
  }
  without = [...new Set(without)].sort();
  if (without.includes("hazards") && !without.includes("stepOuts")) without.push("stepOuts");
  without.sort();
  // --without park always wins, including over a covering row's parking choice.
  if (without.includes("park")) park = false;
  return { ...(features !== "bare" ? { features } : {}), ...(park ? { park } : {}),
    ...(hour !== undefined && (features === "bare" || hour !== CITY_HOUR) ? { hour } : {}),
    ...(without.length ? { without } : {}), ...(cover !== undefined ? { cover } : {}) };
}

export function presetOptions(features = "bare", options = {}) {
  const config = benchmarkConfig({ ...options, features });
  if (features === "bare") {
    // A supplied hour affects pedestrian density even in a feature-free world.
    const world = { ...(config.park ? { park: true } : {}) };
    if (options.hour !== undefined) world.pedestrians = featureSubset([], { hour: options.hour, park: false }).world.pedestrians;
    return { world, fleet: {} };
  }
  return featureSubset(config.without || [], { hour: config.hour ?? CITY_HOUR, park: !!config.park });
}
