import { DEFAULT_TRACK, TRACKS, isTrack } from "../brain/tracks.js";
import { FEATURE_NAMES, coveringArray, featureSubset } from "./features.js";
export const FEATURE_PRESETS = Object.freeze(["bare", "city"]);
export const CITY_HOUR = 15.5,
  CITY_WEEKDAY = 0;

// Only nondefault options enter saved configs. Accept the same shape from CLI, browser and replay.
export function benchmarkConfig({
  features = "bare",
  park = false,
  hour,
  without = [],
  cover,
  track = DEFAULT_TRACK,
} = {}) {
  if (!isTrack(track)) throw new Error(`Unknown track "${track}": use ${TRACKS.join(" or ")}.`);
  if (!FEATURE_PRESETS.includes(features))
    throw new Error(`Unknown feature preset "${features}": use ${FEATURE_PRESETS.join(" or ")}.`);
  if (typeof park !== "boolean") throw new Error("park must be true or false.");
  if (hour !== undefined && (typeof hour !== "number" || !Number.isFinite(hour) || hour < 0 || hour >= 24))
    throw new Error("hour must be a number from 0 inclusive to 24 exclusive.");
  if (typeof without === "string") without = without.trim() ? without.split(",").map((name) => name.trim()) : [];
  if (Array.isArray(without)) without = Array.from(without);
  if (!Array.isArray(without) || without.some((name) => !FEATURE_NAMES.includes(name)))
    throw new Error(`Unknown feature in without: use ${FEATURE_NAMES.join(",")}.`);
  if (features === "bare" && (without.length || cover !== undefined))
    throw new Error("without and cover require the city preset.");
  if (cover !== undefined) {
    const rows = coveringArray();
    if (!Number.isInteger(cover) || cover < 0 || cover >= rows.length)
      throw new Error(`cover must be an index from 0 to ${rows.length - 1}.`);
    const row = rows[cover];
    without = [...without, ...row.without];
    park = park || row.park;
  }
  without = [...new Set(without)];
  if (without.includes("hazards") && !without.includes("stepOuts")) without.push("stepOuts");
  without.sort();
  // --without park always wins, including over a covering row's parking choice.
  if (without.includes("park")) park = false;
  return {
    ...(features !== "bare" ? { features } : {}),
    ...(park ? { park } : {}),
    ...(hour !== undefined && (features === "bare" || hour !== CITY_HOUR) ? { hour } : {}),
    ...(without.length ? { without } : {}),
    ...(cover !== undefined ? { cover } : {}),
    // (the open track, brain/tracks.js; a guarded run's config stays as every earlier one)
    ...(track !== DEFAULT_TRACK ? { track } : {}),
  };
}

export function validateScenarioOptions({ npcs, weather, brain, diagnostics, mode }, weatherNames) {
  if (!Number.isSafeInteger(npcs) || npcs < 0) throw new Error("Benchmark traffic must be a nonnegative integer.");
  if (!weatherNames.includes(weather)) throw new Error(`Unknown benchmark weather "${weather}".`);
  if (typeof brain !== "string" || !brain.trim() || ["__proto__", "constructor", "prototype"].includes(brain))
    throw new Error("Benchmark driver must be a valid ID.");
  if (diagnostics !== undefined && typeof diagnostics !== "boolean")
    throw new Error("Benchmark diagnostics must be true or false.");
  if (mode !== undefined && !["lockstep", "realtime"].includes(mode))
    throw new Error("Choose the lockstep or realtime clock.");
}

export function presetOptions(features = "bare", options = {}) {
  const config = benchmarkConfig({ ...options, features });
  if (features === "bare") {
    // A supplied hour affects pedestrian density even in a feature-free world.
    const world = { ...(config.park ? { park: true } : {}) };
    if (options.hour !== undefined)
      world.pedestrians = featureSubset([], { hour: options.hour, park: false }).world.pedestrians;
    return { world, fleet: {} };
  }
  return featureSubset(config.without || [], { hour: config.hour ?? CITY_HOUR, park: !!config.park });
}
