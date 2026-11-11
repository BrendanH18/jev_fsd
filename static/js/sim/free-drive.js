// What a free drive turns on: the one definition of the opt-in world features shared by the app
// (main.js), the benchmark's `city` suite (bench/runner.js) and the Node runner (scripts/bench_node.mjs),
// so the world the benchmark measures cannot drift from the world people drive.
//
// `params` is a URLSearchParams (or anything with `get`); each feature is on unless its query
// parameter is "0". `hour` is the local time of day, which sets how many people are out on foot and
// whether the school buses run. Returns the `World` options and the `NpcFleet` options apart from the
// seed, weather, vehicle and traffic count, which each caller sets itself.

import { ROADSIDE_COUNT } from "./roadside.js";
import { WORK_ZONE_COUNT } from "./work-zone.js";
import { LANE_CLOSURE_COUNT } from "./lane-closure.js";
import { OUTAGE_COUNT } from "./outage.js";
import { VAN_COUNT } from "./double-parked.js";
import { PLOW_COUNT } from "./snow-plow.js";
import { STEP_OUT_COUNT } from "./hidden-hazards.js";
import { TRUCK_COUNT } from "./collection-truck.js";

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
    // vehicles stopped at the roadside with their lights flashing (`?roadside=0`)
    roadside: on("roadside") ? ROADSIDE_COUNT : 0,
    // work zones with a flagger at each end (`?workzones=0`)
    workZones: on("workzones") ? WORK_ZONE_COUNT : 0,
    // power cuts that turn a signal's lights off for a while (`?outages=0`)
    outages: on("outages") ? OUTAGE_COUNT : 0,
    // delivery vans double-parked now and then, by day (`?vans=0`)
    vans: on("vans") ? VAN_COUNT : 0,
    // the autopilot parks at the destination, where there is a space (`?park=0` stops it in its lane)
    park: on("park"),
    hazards,
    stepOuts: hazards ? STEP_OUT_COUNT : 0,
    // lane closures where both lanes zipper merge (`?closures=0`)
    closures: on("closures") ? LANE_CLOSURE_COUNT : 0,
    // on two-way streets with one lane each way, everyone passes a cyclist riding in the lane through
    // the oncoming lane once it is clear (`?cyclistpass=0`: everyone stays behind)
    passCyclists: on("cyclistpass"),
    // speed humps, tables, cushions and bumps (`?calming=0`)
    calming: on("calming"),
    // scramble crossings run their all-walk phase, with no right turn on red (`?scramble=0`)
    scrambles: on("scramble"),
    // crossing guards in school zones while they are in effect (`?guards=0`)
    guards: on("guards"),
    nightFlash: on("nightflash"),
    busLanes: on("buslanes"),
    pxo: on("pxo"),
    restrictions: on("restrictions"),
    // cyclists riding against the traffic on one-way streets that allow it (`?contraflow=0`)
    contraflow: on("contraflow"),
    highBeams: on("highbeams"),
    leftOnRed: on("leftonred"),
    redTurnSigns: on("redturnsigns"),
    amberLights: on("amberlights"),
    redRunners: on("redrunners"),
    followingDistance: on("followingdistance"),
    sunGlare: on("sunglare"),
    driveways: on("driveways"),
    potholes: on("potholes"),
    balls: on("balls"),
    geese: on("geese"),
    // now and then a car behind closes up and tailgates the driven car (`?tailgaters=0`)
    tailgaters: on("tailgaters"),
    ice: on("ice"),
    snowbanks: on("snowbanks"),
    puddles: on("puddles"),
    // now and then the car ahead parallel parks, and everyone waits (`?parkers=0`)
    parkers: on("parkers"),
    roadClosures: on("roadclosures"),
    // now and then a police officer directs traffic at a signal on the car's way (`?officers=0`)
    officers: on("officers"),
  };
  const fleet = {
    // emergency vehicles answer calls now and then (`?emergency=0`)
    emergency: on("emergency"),
    buses,
    // streetcars and trains run their routes where the map has tracks (`?streetcars=0`, `?trains=0`)
    streetcars: on("streetcars"),
    trains: on("trains"),
    // on the school run (7:00 to 17:00), two school buses (`?schoolbuses=0`)
    schoolBuses: on("schoolbuses") && hour >= 7 && hour < 17 ? 2 : 0,
    // while it snows, a snow plow clears the main streets (`?plows=0`)
    plows: on("plows") ? PLOW_COUNT : 0,
    // by day, a garbage truck works the quiet streets (`?collection=0`)
    collection: on("collection") ? TRUCK_COUNT : 0,
  };
  return { world, fleet };
}
