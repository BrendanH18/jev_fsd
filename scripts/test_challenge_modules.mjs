// One layout for challenges: every challenge is a module of its own, static/js/lab/challenges/<id>.js,
// exporting its definition and scripted parts, and lab/challenges.js is the ordered registry of them.
// node --experimental-default-type=module scripts/test_challenge_modules.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const { MapData } = await import("../static/js/map/mapdata.js");
const registry = await import("../static/js/lab/challenges.js");
const { CHALLENGES, CHALLENGE_VERSION, challengeById, challengeScenario, challengeConfig } = registry;
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`✓ ${name}`); }

const dir = new URL("../static/js/lab/challenges/", import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
const modules = Object.fromEntries(await Promise.all(files.map(async (f) => [f.slice(0, -3), await import(new URL(f, dir))])));

await test("every challenge module is named for its challenge and exports its definition and scenario", () => {
  for (const [name, m] of Object.entries(modules)) {
    assert.equal(typeof m.challenge, "object", `${name}.js exports a challenge`);
    assert.equal(m.challenge.id, name, `${name}.js is the module of challenge ${m.challenge.id}`);
    assert.equal(typeof m.scenario, "function", `${name}.js exports its scenario`);
    for (const hook of ["install", "step"]) assert.ok(m[hook] === undefined || typeof m[hook] === "function", `${name}.js ${hook}`);
    const extra = Object.keys(m).filter((k) => !["challenge", "scenario", "install", "step"].includes(k));
    // (its own scripted parts may be exported too, for tests: never another challenge's definition)
    assert.ok(extra.every((k) => !(m[k] && typeof m[k] === "object" && "id" in m[k] && "hazard" in m[k])), `${name}.js exports one definition`);
  }
});

await test("the registry lists every module once, and nothing else", () => {
  const ids = CHALLENGES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "challenge ids are unique");
  assert.deepEqual([...ids].sort(), Object.keys(modules).sort());
  assert.equal(CHALLENGES.every((c) => modules[c.id].challenge === c), true, "CHALLENGES holds the modules' own definitions");
  assert.equal(CHALLENGES.every((c) => challengeById(c.id) === c), true);
  assert.equal(ROAD_TESTS.every((t) => challengeById(t.id) === t && !ids.includes(t.id)), true, "road tests stay out of CHALLENGES");
  assert.equal(CHALLENGE_VERSION, 2);
  assert.deepEqual(Object.keys(registry).sort(), ["CHALLENGES", "CHALLENGE_VERSION", "challengeById", "challengeConfig", "challengeScenario", "installChallenge", "stepChallenge"]);
  assert.deepEqual(challengeConfig(CHALLENGES[0]), { version: 1, challenge: "door-zone", map: "kitsilano", seed: 1042, weather: "dry", time: "afternoon", traffic: 0, car: "compact", clock: 0 });
});

await test("no challenge keeps its scripted parts outside lab/challenges/", () => {
  const lab = fs.readdirSync(new URL("../static/js/lab/", import.meta.url));
  assert.deepEqual(lab.filter((f) => f.endsWith("-challenge.js")), []);
  const shared = fs.readdirSync(new URL("shared/", dir)).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
  assert.equal(shared.some((name) => name in modules), false, "shared/ holds no challenge of its own");
});

// The maps, with every layer, as the server serves them.
const names = { saskatoon: "ca5573a8d934", kitsilano: "623b012bc8b5", mount_pleasant: "7165f1c807a8", victoria: "d7454a9751b7", montreal: "bb9df59633e0", toronto: "4a96d42cb3f2", ottawa: "d25b07def0d2", calgary: "a53c5bcf6438", edmonton: "3e794edbefcb", winnipeg: "19bb885c9cae", halifax: "49db0d437c8c" };
const cache = {};
const load = (id) => cache[id] ||= (() => {
  const file = (name) => new URL(`../data/maps/${names[id]}.${name}.json`, import.meta.url);
  const pack = JSON.parse(fs.readFileSync(file("v6.pack")));
  for (const name of ["transit", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
    if (fs.existsSync(file(`${name}.v1`))) pack[name] = JSON.parse(fs.readFileSync(file(`${name}.v1`)));
  }
  const crossings = ["crossings.v2", "crossings.v1"].find((n) => fs.existsSync(file(n)));
  if (crossings) pack.crossings = JSON.parse(fs.readFileSync(file(crossings)));
  return new MapData(pack);
})();

await test("each challenge builds its own drive through the registry", () => {
  for (const c of CHALLENGES) {
    const sc = challengeScenario(load(c.map), c);
    assert.equal(sc.id, c.id, `${c.id} builds its own drive`);
    assert.equal(sc.traffic_seed, c.seed, `${c.id} keeps its seed`);
    assert.ok(sc.route?.polyline?.length > 1, `${c.id} has a route`);
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
