// What a free drive turns on: the one definition of the opt-in world features shared by the app
// (main.js), the benchmark's `city` suite (bench/runner.js) and the Node runner (scripts/bench_node.mjs),
// so the world the benchmark measures cannot drift from the world people drive.
//
// `params` is a URLSearchParams (or anything with `get`); each feature is on unless its query
// parameter is "0". `hour` is the local time of day, which sets how many people are out on foot and
// what a registered feature's `freeDrive` makes of it. Returns the `World` options and the `NpcFleet` options apart from the
// seed, weather, vehicle and traffic count, which each caller sets itself.

import { FEATURES } from "./features/index.js";

export function freeDriveOptions(params = new URLSearchParams(), { hour = 15.5 } = {}) {
  const on = (name) => params.get(name) !== "0";
  const world = {
    // fewer people out on foot late in the evening and at night
    pedestrians: hour >= 22 || hour < 6 ? 18 : hour >= 20 ? 36 : undefined,
  };
  const fleet = {};
  // Each registered option is enabled unless its lowercase query flag is 0, with any option the feature
  // reads beside its own (hidden hazards' `stepOuts`, say).
  for (const {
    key,
    flag = key.toLowerCase(),
    defaultCount,
    buildFleet,
    worldOption,
    freeDrive,
    freeDriveExtra,
  } of FEATURES) {
    const enabled = on(flag);
    const options = buildFleet ? fleet : world;
    if (worldOption) world[key] = enabled;
    options[key] = freeDrive
      ? freeDrive(enabled, { hour })
      : defaultCount === undefined
        ? enabled
        : enabled
          ? defaultCount
          : 0;
    if (freeDriveExtra) Object.assign(options, freeDriveExtra(enabled));
  }
  return { world, fleet };
}
