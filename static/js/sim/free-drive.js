// What a free drive turns on: the one definition of the opt-in world features shared by the app
// (main.js), the benchmark's `city` suite (bench/runner.js) and the Node runner (scripts/bench_node.mjs),
// so the world the benchmark measures cannot drift from the world people drive.
//
// `params` is a URLSearchParams (or anything with `get`); each feature is on unless its query
// parameter is "0". `hour` is the local time of day, which sets how many people are out on foot and
// whether the school buses run. Returns the `World` options and the `NpcFleet` options apart from the
// seed, weather, vehicle and traffic count, which each caller sets itself.

import { STEP_OUT_COUNT } from "./hidden-hazards.js";
import { FEATURES } from "./features/index.js";

export function freeDriveOptions(params = new URLSearchParams(), { hour = 15.5 } = {}) {
  const on = (name) => params.get(name) !== "0";
  // cars parked at the kerb hide the people behind them, now and then someone steps out from between
  // them, and the autopilot keeps to a speed it can stop from beside them (`?hazards=0`)
  const hazards = on("hazards");
  const buses = on("buses");
  const world = {
    // fewer people out on foot late in the evening and at night
    pedestrians: hour >= 22 || hour < 6 ? 18 : hour >= 20 ? 36 : undefined,
    // buses run their routes (`?buses=0`)
    buses,
    // the autopilot parks at the destination, where there is a space (`?park=0` stops it in its lane)
    park: on("park"),
    hazards,
    stepOuts: hazards ? STEP_OUT_COUNT : 0,
  };
  const fleet = {
    // emergency vehicles answer calls now and then (`?emergency=0`)
    emergency: on("emergency"),
    buses,
    // streetcars run their routes where the map has tracks (`?streetcars=0`)
    streetcars: on("streetcars"),
    // on the school run (7:00 to 17:00), two school buses (`?schoolbuses=0`)
    schoolBuses: on("schoolbuses") && hour >= 7 && hour < 17 ? 2 : 0,
  };
  // Each registered option is enabled unless its lowercase query flag is 0.
  for (const { key, flag = key.toLowerCase(), defaultCount, buildFleet } of FEATURES) {
    const enabled = on(flag);
    const options = buildFleet ? fleet : world;
    options[key] = defaultCount === undefined ? enabled : enabled ? defaultCount : 0;
  }
  return { world, fleet };
}
