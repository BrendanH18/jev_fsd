// One layout for challenges: every challenge is a module of its own, static/js/lab/challenges/<id>.js,
// exporting its definition and scripted parts, and lab/challenges.js is the ordered registry of them.
// node --experimental-default-type=module scripts/test_challenge_modules.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { load: loadMap, names } = await import("./drive_lab_maps.mjs");
const { WEATHER } = await import("../static/js/sim/weather.js");
const { parseHour } = await import("../static/js/sim/world-clock.js");
const registry = await import("../static/js/lab/challenges.js");
const { CHALLENGES, COMPOUND_DRIVES, CHALLENGE_VERSION, challengeById, challengeScenario, challengeConfig } = registry;
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

const dir = new URL("../static/js/lab/challenges/", import.meta.url);
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".js"))
  .sort();
const modules = Object.fromEntries(
  await Promise.all(files.map(async (f) => [f.slice(0, -3), await import(new URL(f, dir))])),
);

await test("every challenge module is named for its challenge and exports its definition and scenario", () => {
  for (const [name, m] of Object.entries(modules)) {
    assert.equal(typeof m.challenge, "object", `${name}.js exports a challenge`);
    assert.equal(m.challenge.id, name, `${name}.js is the module of challenge ${m.challenge.id}`);
    assert.equal(typeof m.scenario, "function", `${name}.js exports its scenario`);
    for (const hook of ["install", "step"])
      assert.ok(m[hook] === undefined || typeof m[hook] === "function", `${name}.js ${hook}`);
    const extra = Object.keys(m).filter((k) => !["challenge", "scenario", "install", "step"].includes(k));
    // (its own scripted parts may be exported too, for tests: never another challenge's definition)
    assert.ok(
      extra.every((k) => !(m[k] && typeof m[k] === "object" && "id" in m[k] && "hazard" in m[k])),
      `${name}.js exports one definition`,
    );
  }
});

await test("the registry lists every module once, and nothing else", () => {
  const ids = CHALLENGES.map((c) => c.id),
    compound = COMPOUND_DRIVES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "challenge ids are unique");
  assert.deepEqual([...ids, ...compound].sort(), Object.keys(modules).sort());
  assert.equal(ids.length, 60, "the numbered suites pin the sixty challenges: a new drive goes in a list of its own");
  assert.equal(
    COMPOUND_DRIVES.every((c) => modules[c.id].challenge === c && challengeById(c.id) === c && c.compound === true),
    true,
    "COMPOUND_DRIVES holds the compound modules' own definitions",
  );
  assert.equal(
    compound.some((id) => ids.includes(id)),
    false,
    "compound drives stay out of CHALLENGES",
  );
  assert.equal(
    CHALLENGES.every((c) => modules[c.id].challenge === c),
    true,
    "CHALLENGES holds the modules' own definitions",
  );
  assert.equal(
    CHALLENGES.every((c) => challengeById(c.id) === c),
    true,
  );
  assert.equal(
    ROAD_TESTS.every((t) => challengeById(t.id) === t && !ids.includes(t.id)),
    true,
    "road tests stay out of CHALLENGES",
  );
  assert.equal(CHALLENGE_VERSION, 2);
  assert.deepEqual(Object.keys(registry).sort(), [
    "CHALLENGES",
    "CHALLENGE_VERSION",
    "COMPOUND_DRIVES",
    "challengeById",
    "challengeConfig",
    "challengeScenario",
    "installChallenge",
    "stepChallenge",
  ]);
  assert.deepEqual(challengeConfig(CHALLENGES[0]), {
    version: 1,
    challenge: "door-zone",
    map: "kitsilano",
    seed: 1042,
    weather: "dry",
    time: "afternoon",
    traffic: 0,
    car: "compact",
    clock: 0,
  });
});

await test("no challenge keeps its scripted parts outside lab/challenges/", () => {
  const lab = fs.readdirSync(new URL("../static/js/lab/", import.meta.url));
  assert.deepEqual(
    lab.filter((f) => f.endsWith("-challenge.js")),
    [],
  );
  const shared = fs
    .readdirSync(new URL("shared/", dir))
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.slice(0, -3));
  assert.equal(
    shared.some((name) => name in modules),
    false,
    "shared/ holds no challenge of its own",
  );
});

const cache = new Map();
function load(id) {
  if (!cache.has(id)) cache.set(id, loadMap(id));
  return cache.get(id);
}
const drives = [...CHALLENGES, ...ROAD_TESTS, ...COMPOUND_DRIVES];
const scenarios = new Map();
const scenarioFor = (c) => {
  if (!scenarios.has(c.id)) scenarios.set(c.id, challengeScenario(load(c.map), c));
  return scenarios.get(c.id);
};
const nonblank = (text) => typeof text === "string" && text.trim().length > 0;
const coordinates = (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

const metadataChecks = [
  ["stable lowercase kebab-case IDs", (c) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id)],
  ["bundled map keys", (c) => Object.hasOwn(names, c.map)],
  ["recognised weather conditions", (c) => Object.hasOwn(WEATHER, c.weather)],
  ["parseable local starting times", (c) => typeof c.time === "string" && Number.isFinite(parseHour(c.time, NaN))],
  ["positive safe scenario seeds", (c) => Number.isSafeInteger(c.seed) && c.seed > 0],
  [
    "positive version numbers when authored explicitly",
    (c) => c.version === undefined || (Number.isSafeInteger(c.version) && c.version > 0),
  ],
  [
    "positive finite time limits when specified",
    (c) => c.limit_s === undefined || (Number.isFinite(c.limit_s) && c.limit_s > 0),
  ],
  ["an icon for the library card", (c) => nonblank(c.icon)],
  ["a skill label for library filtering", (c) => nonblank(c.difficulty)],
  ["nonblank briefings before the drive", (c) => nonblank(c.description)],
  ["nonblank lessons with distinct wording for the debrief", (c) => nonblank(c.lesson) && c.lesson !== c.description],
  ["nonblank street names when used as site selectors", (c) => c.street === undefined || nonblank(c.street)],
  ["hazard keys that can be used for dispatch", (c) => typeof c.hazard === "string" && /^[a-z][a-z-]*$/.test(c.hazard)],
];
for (const [expectation, valid] of metadataChecks)
  await test(`authored drives have ${expectation}`, () => {
    for (const c of drives) assert.equal(valid(c), true, c.id);
  });

await test("scenario seeds do not overlap between drives", () => {
  assert.equal(new Set(drives.map((c) => c.seed)).size, drives.length);
});
await test("each library title is nonblank and selects a distinct drive", () => {
  assert.equal(
    drives.every((c) => nonblank(c.title)),
    true,
  );
  assert.equal(new Set(drives.map((c) => c.title)).size, drives.length);
});
await test("road tests have examiner style and region labels", () => {
  for (const t of ROAD_TESTS) {
    assert.equal(nonblank(t.style), true, t.id);
    assert.equal(nonblank(t.region), true, t.id);
  }
});
await test("road tests have nonnegative, integral demerit allowances", () => {
  for (const t of ROAD_TESTS) assert.equal(Number.isSafeInteger(t.maxDemerits) && t.maxDemerits >= 0, true, t.id);
});
await test("road-test populations are whole nonnegative actor counts", () => {
  for (const t of ROAD_TESTS) {
    for (const kind of ["traffic", "pedestrians"]) {
      const count = t.population[kind];
      assert.equal(Number.isSafeInteger(count) && count >= 0, true, `${t.id} ${kind}`);
    }
  }
});

await test("each challenge builds its own drive through the registry", () => {
  for (const c of [...CHALLENGES, ...COMPOUND_DRIVES]) {
    const sc = scenarioFor(c);
    assert.equal(sc.id, c.id, `${c.id} builds its own drive`);
    assert.equal(sc.traffic_seed, c.seed, `${c.id} keeps its seed`);
    assert.ok(sc.route?.polyline?.length > 1, `${c.id} has a route`);
  }
});

await test("each drive starts on a lane that exists in its map", () => {
  for (const c of drives) {
    const { start } = scenarioFor(c);
    const edge = load(c.map).edges.get(start.edge);
    assert.equal(!!edge && Number.isSafeInteger(start.lane) && start.lane >= 0 && start.lane < edge.lanes, true, c.id);
  }
});
await test("each drive starts within its lane at a finite pose", () => {
  for (const c of drives) {
    const { start } = scenarioFor(c);
    const lane = load(c.map).lane(start.edge, start.lane);
    assert.equal(start.s >= 0 && start.s <= lane.length, true, c.id);
    const pose = [start.x, start.y, start.psi];
    assert.equal(pose.every((n) => n === undefined) || pose.every(Number.isFinite), true, c.id);
  }
});
await test("all route points are finite two-dimensional coordinates", () => {
  for (const c of drives) assert.equal(scenarioFor(c).route.polyline.every(coordinates), true, c.id);
});
await test("each target is within snapping distance of its route endpoint", () => {
  for (const c of drives) {
    const { route, goal } = scenarioFor(c);
    assert.equal(coordinates(goal), true, c.id);
    const [x, y] = route.polyline.at(-1);
    const offset = Math.hypot(x - goal[0], y - goal[1]);
    assert.equal(offset <= 5, true, `${c.id} goal is ${offset.toFixed(2)} m from the route endpoint`);
  }
});

await test("a challenge with its hazard taken away starts on a plain lane with nothing placed", () => {
  const c = CHALLENGES.find((x) => x.id === "room-to-park");
  const sc = challengeScenario(load(c.map), { ...c, parkers: false, hazard: "none" });
  assert.deepEqual(Object.keys(sc), ["id", "start", "route", "goal", "traffic_seed", "tags"]);
  assert.equal(!load(c.map).edges.get(sc.start.edge).control, true, "on a lane with no sign or signal");
});

console.log(`${passed} tests passed`);
process.exit(0);
