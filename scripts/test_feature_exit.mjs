// Phase 3's exit test (ROADMAP.md, docs/feature-interface.md), checked mechanically: "adding a feature
// needs its own file, its challenge, its test and one registration line".
//
// (a) The app, the browser adapter and the shared renderers name no registered feature: none reads a
//     feature's World or fleet state, and none imports a feature's own simulation or render module.
// (b) A throwaway feature in one file (scripts/fixtures/throwaway-feature.js), registered by one import
//     and one FEATURES entry, is picked up everywhere the registry feeds: the World option and its state,
//     the free-drive flag, a challenge's option, the step, sensing, the model prompt, metrics, HUD notices
//     and event badges, and the views (scenery, scene objects, a vehicle kind, a parked mesh, an effect on
//     ordinary cars, something a person carries, the minimap). The registration is applied to the
//     registry's source as it loads, so no file in the app changes.
// node --experimental-default-type=module scripts/test_feature_exit.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import "./render_actor_test_support.mjs";

let checks = 0;
const test = (name, fn) => {
  fn();
  checks++;
  console.log(`✓ ${name}`);
};
const root = new URL("../static/js/", import.meta.url);
const source = (path) => fs.readFileSync(new URL(path, root), "utf8");
const list = (directory) => fs.readdirSync(new URL(directory, root)).filter((name) => name.endsWith(".js"));
// (static and dynamic imports alike, whatever line breaks the formatter chose)
const importsOf = (path) =>
  [...source(path).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^import\s*)"([^"]+)"/gm)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => new URL(specifier, new URL(path, root)).href.slice(root.href.length));

// ---- The registration: one import and one entry, applied to the registry as it loads ----
const registry = new URL("sim/features/index.js", root).href,
  fixture = new URL("./fixtures/throwaway-feature.js", import.meta.url).href;
const IMPORT_AFTER = 'import hazards from "./hidden-hazards.js";\n',
  LIST_START = "export const FEATURES = [\n";
const rewritten = [];
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== registry) return result;
    const text = String(result.source ?? fs.readFileSync(new URL(url), "utf8"));
    const end = text.indexOf("\n];", text.indexOf(LIST_START));
    assert.ok(text.includes(IMPORT_AFTER) && text.includes(LIST_START) && end > 0, "the registry keeps its shape");
    rewritten.push(url);
    return {
      ...result,
      source: `${text.slice(0, end)}\n  lanterns,${text.slice(end)}`.replace(
        IMPORT_AFTER,
        `${IMPORT_AFTER}import lanterns from "${fixture}";\n`,
      ),
    };
  },
});

globalThis.document.body = null;
const R = await import("../static/js/sim/features/index.js");
const { default: lanterns, seen } = await import(fixture);
const THREE = await import("three");
const { freeDriveOptions } = await import("../static/js/sim/free-drive.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");
const { setupChallenge, challengeFeatureOptions } = await import("../static/js/lab/evaluation.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
const { CAR } = await import("../static/js/sim/vehicle.js");
const { load } = await import("./drive_lab_maps.mjs");
const views = await import("../static/js/render/feature-views.js");

const records = R.FEATURES.filter((f) => f !== lanterns);
const recordFiles = list("sim/features/").filter((name) => !["index.js", "hook-lists.js"].includes(name));
// (a feature's render module is the one its record's `view` imports)
const viewModules = new Set(
  recordFiles.flatMap((name) =>
    [...source(`sim/features/${name}`).matchAll(/\bview:\s*\(\)\s*=>\s*import\(\s*"([^"]+)"\s*,?\s*\)/g)].map((match) =>
      new URL(match[1], new URL(`sim/features/${name}`, root)).href.slice(root.href.length),
    ),
  ),
);
// The core files of the registry's own check (scripts/test_feature_registry.mjs).
const CORE = [
  "sim/world.js",
  "sim/step.js",
  "sim/npc.js",
  "sim/free-drive.js",
  "sim/pedestrians.js",
  "brain/sensors.js",
  "brain/candidates.js",
  "brain/state.js",
  "brain/llm-prompt.js",
  "brain/tracks.js",
  "brain/rules.js",
  "brain/safety.js",
  "agents/cautious.js",
  "bench/metrics.js",
  "lab/trace.js",
  "lab/examiner.js",
];
// A feature's own simulation modules: what the records import from sim/ that no core file does.
const coreImports = new Set(CORE.flatMap(importsOf));
const ownSim = new Set(
  recordFiles
    .flatMap((name) => importsOf(`sim/features/${name}`))
    .filter((path) => path.startsWith("sim/") && !path.startsWith("sim/features/") && !coreImports.has(path)),
);
// The app, the adapter and every renderer that is not a feature's own.
const shared = [
  "main.js",
  ...list("render/")
    .map((name) => `render/${name}`)
    .filter((path) => !viewModules.has(path)),
];
// AI Eyes (render/perception.js) still words the features that predate its hooks itself. A new feature
// uses `perceptionLine`, `perceptionFocus` and `perceptionRejections`, so this list may only shrink.
const STILL_NAMED = {
  "render/perception.js": ["sim/bus.js", "sim/emergency.js", "sim/hidden-traffic.js"],
};

test("every feature that draws has a render module of its own, which only its record names", () => {
  assert.ok(viewModules.size > 0);
  for (const path of viewModules) assert.ok(fs.existsSync(new URL(path, root)), `${path} exists`);
  assert.equal(R.FEATURE_VIEWS.length, viewModules.size + 1, "each record with a view, and the throwaway one");
  for (const path of viewModules) assert.ok(/^export const view = /m.test(source(path)), `${path} exports its view`);
});

test("the app, the adapter and the shared renderers import no feature's own module", () => {
  assert.ok(ownSim.has("sim/geese.js") && ownSim.has("sim/bus.js") && ownSim.has("sim/parallel-park.js"));
  assert.ok(!ownSim.has("sim/vehicle.js") && !ownSim.has("sim/signals.js"));
  assert.ok(shared.includes("render/feature-views.js") && shared.includes("render/cars.js"));
  const found = {};
  for (const path of shared) {
    const named = importsOf(path)
      .filter((target) => viewModules.has(target) || ownSim.has(target) || /^sim\/features\/(?!index\.js)/.test(target))
      .sort();
    if (named.length) found[path] = named;
  }
  assert.equal(JSON.stringify(found), JSON.stringify(STILL_NAMED));
});

test("the app, the adapter and the shared renderers read no feature's World or fleet state", () => {
  const names = new Set(records.flatMap((f) => [f.key, f.property, f.seen, f.calls]).filter(Boolean));
  assert.ok(names.has("geese") && names.has("laneClosures") && names.has("potholesSeen") && names.size > 80);
  const state = new RegExp(`\\b(?:world|fleet)\\??\\.(${[...names].join("|")})\\b`, "g");
  const found = {};
  for (const path of shared) {
    const read = [...new Set([...source(path).matchAll(state)].map((match) => match[0]))];
    if (read.length) found[path] = read;
  }
  assert.equal(JSON.stringify(found), "{}");
  // (and the vehicle kinds, parked flags and people's ids features draw are theirs to name)
  const adapter = source("render/feature-views.js");
  for (const word of ["streetcar", "school_bus", "delivery_van", "doubleParked", "workzone", "crossingGuard", "kid_"])
    assert.ok(!adapter.includes(word), `the adapter names ${word}`);
});

test("one import and one FEATURES entry register the throwaway feature, and no other file changes", () => {
  assert.equal(rewritten.length, 1);
  assert.equal(rewritten[0], registry);
  assert.equal(R.FEATURES.length, records.length + 1);
  assert.equal(R.FEATURES.at(-1).key, "lanterns");
  assert.equal(R.registryProblem(R.FEATURES), null);
});

test("its option reaches the World, free drives and challenges", () => {
  assert.ok(R.FEATURE_OPTIONS.includes("lanterns"));
  assert.equal(freeDriveOptions().world.lanterns, true);
  assert.equal(freeDriveOptions(new URLSearchParams("lanterns=0")).world.lanterns, false);
  assert.equal(JSON.stringify(challengeFeatureOptions({ id: "lantern-street", lanterns: true })), '{"lanterns":true}');
  // (no challenge so far sets a registered option this way that setupChallenge does not already name)
  const named = source("lab/evaluation.js");
  for (const challenge of [...CHALLENGES, ...ROAD_TESTS])
    for (const key of Object.keys(challengeFeatureOptions(challenge)))
      assert.ok(new RegExp(`\\b${key}: !!challenge\\.`).test(named), `${challenge.id} sets ${key} by its key`);
});

const challenge = { ...CHALLENGES[0], lanterns: true };
const ctx = setupChallenge(load(challenge.map), challenge);
const { world, fleet, autopilot } = ctx;
const plain = setupChallenge(load(challenge.map), CHALLENGES[0]).world;

test("the World builds it, with its seen flag and its audit's calls", () => {
  assert.equal(world.lanterns.enabled, true);
  assert.equal(plain.lanterns.enabled, false);
  assert.equal(world.lanternsSeen, false);
  assert.equal(world.lanternCalls instanceof Map, true);
});

for (let k = 0; k < 30; k++) stepWorld(ctx, 1 / 60, world.t * 1000);

test("the step, sensing and the model prompt run its hooks", () => {
  assert.equal(world.lanterns.lit, 30);
  assert.equal(seen.steps, 30);
  assert.ok(seen.senses > 0);
  assert.equal(autopilot.snap.lantern_ahead.gap_m, 40);
  assert.ok(SYSTEM_PROMPT.includes("A street lantern stands at the kerb"));
  assert.ok(Object.hasOwn(R.FEATURE_SNAPSHOT_FIELDS, "lantern_ahead"));
});

test("its metric is reported once it has met the car, and fails the drive", () => {
  world.violations.lanterns_knocked = 2;
  assert.equal(Object.hasOwn(R.featureMetrics(world, world.violations, "streetHazards"), "lanterns_knocked"), false);
  world.lanternsSeen = true;
  assert.equal(R.featureMetrics(world, world.violations, "streetHazards").lanterns_knocked, 2);
  assert.ok(R.featureFailures({ lanterns_knocked: 2 }, "streetHazards").includes("knocked over a street lantern"));
});

test("the HUD shows its notice and its event badges", () => {
  const badges = [];
  const hud = { badge: (text) => badges.push(text) };
  const announced = new Map();
  for (const slot of R.SLOTS.notice) R.announceFeatureNotices(slot, world, autopilot, {}, announced, hud, fleet);
  assert.ok(badges.includes("LANTERNS AHEAD"));
  assert.equal(R.featureEventBadge({ type: "lantern_knocked" }), "KNOCKED OVER A LANTERN");
  assert.equal(R.featureEventBadge({ type: "stop_sign", lantern: true }), "NO STOP AT THE LANTERN");
  assert.equal(R.featureEventBadge({ type: "stop_sign", flagger: true }), "WENT PAST THE FLAGGER'S STOP");
  assert.equal(R.featureEventBadge({ type: "stop_sign" }), undefined);
});

test("the browser adapter mounts its view: scenery, scene objects, a vehicle, a parked mesh, people", () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  const view = { scene, camera, addScenery: (group) => scene.add(group), atmosphere: null };
  const named = (name) => scene.children.filter((child) => child.name === name).length;
  views.mountFeatureScenery(view, world.map);
  assert.equal(named("lantern-posts"), 1);

  const mounted = views.mountFeatureViews(view, world);
  assert.equal(mounted.lanterns.group.name, "lanterns");
  assert.equal(named("lanterns"), 1);
  assert.equal(views.mountFeatureViews({ ...view, scene: new THREE.Scene() }, plain).lanterns, null);

  const e = world.ego;
  fleet.vehicles.push({ id: "cart", kind: "lantern_cart", x: e.x + 30, y: e.y, psi: e.psi, v: 0, spec: CAR });
  fleet.vehicles.push({ id: "plain", x: e.x + 40, y: e.y, psi: e.psi, v: 0, delta: 0, spec: CAR, color: 0x335577 });
  world.parked.list.push({ id: "stall", x: e.x + 50, y: e.y + 4, psi: e.psi, lanternStall: true });
  world.crowd.list.push({ id: "lantern_1", look: 3, x: e.x + 5, y: e.y + 5, psi: 0, v: 0, lanternBearer: true });
  const actors = views.mountActorViews(view, world, fleet);
  actors.updateVehicles(0.1, 0, 1, null, 0);
  actors.updatePeople(1, null, 0, "dry");
  mounted.update(fleet, actors.people, 0.1, 0);
  assert.equal(named("lantern-cart-cart"), 1);
  assert.equal(scene.getObjectByName("lantern-cart-cart").position.x, e.x + 30);
  assert.equal(named("lantern-stall-stall"), 1);
  assert.equal(scene.children.filter((child) => child.userData.lanternLit === true).length, 1);
  assert.equal(actors.people.get("lantern_1").userData.lantern, true);
  assert.equal(actors.minimapMarks.get("lantern_cart"), "transit");
  assert.equal(seen.frames, 1);

  // (its people come and go: the mesh is retired once they leave)
  world.crowd.list.pop();
  actors.updatePeople(1, null, 0, "dry");
  assert.equal(actors.people.has("lantern_1"), false);
});

test("a view that breaks the contract is refused when the views load", () => {
  const refused = (view, pattern) => assert.throws(() => views.compileViews([{ key: "broken", view }]), pattern);
  refused(undefined, /exports no `view`/);
  refused({ meshes: {} }, /unknown field "meshes"/);
  refused({ mount: { run() {} } }, /mount\.order must be an integer/);
  refused({ mount: { order: 1 } }, /mount needs a run function/);
  refused({ vehicles: { cart: { create() {} } } }, /vehicles\.cart needs create and sync/);
  refused({ parked: { order: 1, flag: "stall" } }, /a flag and a create function together/);
  assert.throws(
    () =>
      views.compileViews([
        { key: "one", view: { mount: { order: 1, run() {} } } },
        { key: "two", view: { mount: { order: 1, run() {} } } },
      ]),
    /two: mount order 1 is one's/,
  );
});

console.log(`${checks} exit-test checks passed`);
process.exit(0);
