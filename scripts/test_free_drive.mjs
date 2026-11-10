// One definition of a free drive (sim/free-drive.js): the app builds its world from it, and the
// benchmark's `city` preset is the same options apart from parking at the destination, while `bare`
// leaves every opt-in feature off as the seeded benchmark always has.
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { freeDriveOptions } = await import("../static/js/sim/free-drive.js");
const { presetOptions, suiteOptions, setupScenario, FEATURE_PRESETS, CITY_HOUR } = await import("../static/js/bench/runner.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES, challengeScenario } = await import("../static/js/lab/challenges.js");

const free = freeDriveOptions();
const worldKeys = Object.keys(free.world).sort(), fleetKeys = Object.keys(free.fleet).sort();
// Every option the World takes is a free-drive feature, apart from what each caller sets itself.
const worldSource = fs.readFileSync(new URL("../static/js/sim/world.js", import.meta.url), "utf8");
const constructorOptions = worldSource.match(/constructor\(map, \{([^}]*)\} = \{\}\)/)[1].split(",").map((s) => s.trim().split(" ")[0]);
assert.deepEqual(constructorOptions.filter((k) => !["seed", "parked", "weather", "vehicleSpec"].includes(k)).sort(), worldKeys);
for (const key of worldKeys.filter((k) => k !== "pedestrians")) assert.ok(free.world[key], `free drives turn on ${key}`);
for (const key of fleetKeys) assert.ok(free.fleet[key], `free drives turn on the fleet's ${key}`);
assert.equal(freeDriveOptions(new URLSearchParams("geese=0&plows=0&hazards=0")).world.geese, false);
assert.equal(freeDriveOptions(new URLSearchParams("plows=0")).fleet.plows, 0);
assert.equal(freeDriveOptions(new URLSearchParams("hazards=0")).world.stepOuts, 0);
assert.equal(freeDriveOptions(new URLSearchParams(), { hour: 23 }).world.pedestrians, 18);
assert.equal(freeDriveOptions(new URLSearchParams(), { hour: 18 }).fleet.schoolBuses, 0);
console.log("✓ free drives turn every feature on unless its query parameter is 0");

// The app builds its free-drive world from this one function, with nothing set inline beside it.
const main = fs.readFileSync(new URL("../static/js/main.js", import.meta.url), "utf8");
const freeWorld = main.match(/world = new World\(map, \{([^}]*)\}\);\n\s*fleet = new NpcFleet\(world, \{([^}]*)\}\);/);
assert.ok(freeWorld, "main.js builds the free drive's world and fleet together");
assert.deepEqual(freeWorld[1].split(",").map((s) => s.trim().split(":")[0]), ["seed", "weather", "vehicleSpec", "...free.world"]);
assert.deepEqual(freeWorld[2].split(",").map((s) => s.trim().split(":")[0]), ["count", "seed", "...free.fleet"]);
console.log("✓ the app's free drive takes its features from freeDriveOptions alone");

assert.deepEqual(FEATURE_PRESETS, ["bare", "city"]);
assert.deepEqual(presetOptions("bare"), { world: {}, fleet: {} });
assert.deepEqual(suiteOptions("bare"), {});
const city = presetOptions("city"), cityFree = freeDriveOptions(new URLSearchParams(), { hour: CITY_HOUR });
assert.equal(city.world.park, false);
assert.deepEqual({ ...city.world, park: true }, cityFree.world);
assert.deepEqual(city.fleet, cityFree.fleet);
assert.equal(suiteOptions("city").restrictions.hour, CITY_HOUR);
assert.throws(() => presetOptions("everything"), /Unknown feature preset/);
console.log("✓ the city preset is the free drive without parking; bare is unchanged");

const key = "623b012bc8b5", base = new URL("../data/maps/", import.meta.url);
const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, base)));
for (const layer of ["transit", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
  const path = new URL(`${key}.${layer}.v1.json`, base);
  if (fs.existsSync(path)) pack[layer] = JSON.parse(fs.readFileSync(path));
}
const crossings = [2, 1].map((v) => new URL(`${key}.crossings.v${v}.json`, base)).find((path) => fs.existsSync(path));
if (crossings) pack.crossings = JSON.parse(fs.readFileSync(crossings));
const map = new MapData(pack), challenge = CHALLENGES.find((c) => c.id === "door-zone");
const scenario = { ...challengeScenario(map, challenge), id: "free-drive", traffic_seed: 7, tags: { length_m: 400 } };
const bare = setupScenario(map, scenario, { npcs: 4 }).world;
assert.equal(bare.clock, null);
assert.equal(!!bare.restrictions, false);
assert.equal(!!bare.roadClosures?.enabled, false);
const cityWorld = setupScenario(map, scenario, { npcs: 4, features: "city" }).world;
assert.equal(cityWorld.clock.hour, CITY_HOUR);
assert.equal(cityWorld.clock.weekday, 0);
assert.equal(!!cityWorld.restrictions, true);
assert.equal(cityWorld.parkAtGoal, false);
assert.equal(!!cityWorld.roadClosures?.enabled, true);
assert.equal(!!cityWorld.geese?.enabled, true);
console.log("✓ a city scenario builds the free drive's world on the afternoon clock");
process.exit(0);
