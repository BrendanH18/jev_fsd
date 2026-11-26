// What a free drive turns on: the one definition of the opt-in world features shared by the app
// (main.js), the benchmark's `city` suite (bench/runner.js) and the Node runner (scripts/bench_node.mjs),
// so the world the benchmark measures cannot drift from the world people drive.
//
// `params` is a URLSearchParams (or anything with `get`); each feature is on unless its query
// parameter is "0". `hour` is the local time of day, which sets how many people are out on foot and
// what a registered feature's `freeDrive` makes of it. Returns the `World` options and the `NpcFleet` options apart from the
// seed, weather, vehicle and traffic count, which each caller sets itself.

import { STEP_OUT_COUNT } from "./hidden-hazards.js";
import { FEATURES } from "./features/index.js";

export function freeDriveOptions(params = new URLSearchParams(), { hour = 15.5 } = {}) {
  const on = (name) => params.get(name) !== "0";
  // cars parked at the kerb hide the people behind them, now and then someone steps out from between
  // them, and the autopilot keeps to a speed it can stop from beside them (`?hazards=0`)
  const hazards = on("hazards");
  const world = {
    // fewer people out on foot late in the evening and at night
    pedestrians: hour >= 22 || hour < 6 ? 18 : hour >= 20 ? 36 : undefined,
    // the autopilot parks at the destination, where there is a space (`?park=0` stops it in its lane)
    park: on("park"),
    hazards,
    stepOuts: hazards ? STEP_OUT_COUNT : 0,
  };
  const fleet = {};
  // Each registered option is enabled unless its lowercase query flag is 0.
  for (const { key, flag = key.toLowerCase(), defaultCount, buildFleet, worldOption, freeDrive } of FEATURES) {
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
  }
  return { world, fleet };
}
