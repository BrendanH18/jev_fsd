// Scene-graph captures for a renderer refactor (docs/feature-interface.md, "Running the render comparison").
// Run `capture` in each source tree and `compare` the two files: every scene object, transform, geometry
// buffer and material setting the feature adapter draws has to match, in the same order.
//
//   node --experimental-default-type=module scripts/render_parity.mjs capture OUT.json [--only ID,...]
//   node --experimental-default-type=module scripts/render_parity.mjs compare BEFORE.json AFTER.json
//   node --experimental-default-type=module scripts/render_parity.mjs detail ID      (per-object hashes of one scene)
//
// Scenes: every challenge and both road tests, driven by Rules for six seconds and drawn ten times a
// second, then two replay frames of the same drive restored from the recorder (interpolating toward the
// next checkpoint); and four free drives with every opt-in feature on (Kitsilano dry, at night in rain and
// in snow, and Toronto), drawn the same way.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import "./render_actor_test_support.mjs";

const [mode, ...args] = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};

if (mode === "compare") {
  const [before, after] = args.map((file) => JSON.parse(readFileSync(file, "utf8")));
  const ids = [...new Set([...Object.keys(before.scenes), ...Object.keys(after.scenes)])];
  let frames = 0,
    objects = 0,
    different = 0;
  for (const id of ids) {
    const a = before.scenes[id],
      b = after.scenes[id];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      different++;
      const at = a && b && !a.error && !b.error ? a.frames.findIndex((f, i) => f.digest !== b.frames[i]?.digest) : -1;
      console.log(
        `✗ ${id}: ${a?.error || b?.error || (at < 0 ? "a different number of frames" : `frame ${at} (${a.frames[at].label}) differs`)}`,
      );
    } else if (a.error) {
      different++;
      console.log(`✗ ${id}: both trees failed: ${a.error}`);
    } else {
      frames += a.frames.length;
      objects += a.frames.at(-1).objects;
    }
  }
  console.log(
    `${ids.length - different}/${ids.length} scenes identical (${frames} frames, ${objects} objects in the last frame of each)`,
  );
  process.exit(different ? 1 : 0);
}
if (mode !== "capture" && mode !== "detail") {
  console.error("Usage: render_parity.mjs capture OUT.json [--only ID,...] | compare BEFORE AFTER | detail ID");
  process.exit(2);
}

const THREE = await import("three");
const views = await import("../static/js/render/feature-views.js");
const { mountActorViews, mountFeatureViews } = views;
// (the scenery entry point was renamed when the views moved to their features)
const mountScenery = views.mountFeatureScenery ?? views.mountTransitScenery;
const { actorTime } = await import("../static/js/render/actor-motion.js");
const { createCarMesh, addHeadlights } = await import("../static/js/render/cars.js");
const { load } = await import("./drive_lab_maps.mjs");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { WorldClock } = await import("../static/js/sim/world-clock.js");
const { DriveScore } = await import("../static/js/sim/drive-score.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
const { Autopilot } = await import("../static/js/brain/brain.js");
const { freeDriveOptions } = await import("../static/js/sim/free-drive.js");
const { mapClock } = await import("../static/js/sim/speed-zones.js");
const { interpolatePose, capturePose } = await import("../static/js/sim/interpolate.js");

const STEP = 1 / 60,
  DRAW_EVERY = 6,
  SECONDS = 6;

function objectDigest(object, hash) {
  const add = (value) => hash.update(JSON.stringify(value));
  add([
    object.name,
    object.type,
    object.children.length,
    object.position.toArray(),
    object.quaternion.toArray(),
    object.scale.toArray(),
    object.visible,
    object.castShadow,
    object.receiveShadow,
    object.renderOrder,
    object.intensity,
    object.count,
  ]);
  if (object.geometry) {
    for (const [name, attribute] of Object.entries(object.geometry.attributes)) {
      add([name, attribute.itemSize, attribute.normalized]);
      hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
    if (object.geometry.index) hash.update(Buffer.from(object.geometry.index.array.buffer));
    add(object.geometry.groups);
  }
  if (object.instanceMatrix) hash.update(Buffer.from(object.instanceMatrix.array.buffer));
  if (object.instanceColor) hash.update(Buffer.from(object.instanceColor.array.buffer));
  for (const material of [object.material].flat().filter(Boolean)) {
    add([
      material.type,
      material.color?.getHex(),
      material.emissive?.getHex(),
      material.emissiveIntensity,
      material.roughness,
      material.metalness,
      material.visible,
      material.opacity,
      material.transparent,
      material.depthWrite,
      material.depthTest,
      material.side,
      material.polygonOffset,
      material.polygonOffsetFactor,
      material.polygonOffsetUnits,
      material.map?.image?.trace,
    ]);
  }
}

function graphDigest(scene) {
  const hash = createHash("sha256");
  let objects = 0;
  scene.traverse((object) => {
    objects++;
    objectDigest(object, hash);
  });
  return { digest: hash.digest("hex"), objects };
}

// One line per object directly in the scene, for finding where two trees part.
function graphDetail(scene) {
  return scene.children.map((child, i) => {
    const hash = createHash("sha256");
    let objects = 0;
    child.traverse((object) => {
      objects++;
      objectDigest(object, hash);
    });
    return `${i} ${child.name || child.type} ${objects} ${hash.digest("hex").slice(0, 12)}`;
  });
}

function stage(ctx, { lightsOn, weather }) {
  const { world, fleet } = ctx;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  const view = {
    scene,
    camera,
    addScenery: (group) => scene.add(group),
    // (a low, clear evening sun dead ahead, so low sun glare has something to draw)
    atmosphere: { elevationDeg: 8, cloud: 0.1, sun: { dir: new THREE.Vector3(1, 0.14, 0).normalize() } },
  };
  mountScenery(view, world.map);
  const ego = createCarMesh(0x2f7cff, "ego");
  addHeadlights(ego);
  scene.add(ego);
  const features = mountFeatureViews(view, world);
  const actors = mountActorViews(view, world, fleet);
  const previousEgo = {};
  const frames = [],
    details = [];
  const draw = (label, dt, alpha, replayNext = null, replayAlpha = 0) => {
    const e = world.ego;
    camera.position.set(e.x - 9 * Math.cos(e.psi), 4, -(e.y - 9 * Math.sin(e.psi)));
    camera.lookAt(e.x, 1, -e.y);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const renderEgo = replayNext
      ? views.replayActorPose(e, replayNext.world.ego, replayAlpha)
      : Number.isFinite(previousEgo.x)
        ? interpolatePose(e, previousEgo, alpha)
        : e;
    actors.sync();
    actors.updateEgo(ego, renderEgo, dt, lightsOn, actorTime(world.t, replayNext?.world.t, replayAlpha));
    features.updateSignals();
    actors.updateVehicles(dt, lightsOn, alpha, replayNext, replayAlpha);
    actors.updatePeople(alpha, replayNext, replayAlpha, weather);
    features.update(fleet, actors.people, dt, lightsOn);
    frames.push({ label, ...graphDigest(scene) });
    if (mode === "detail") details.push([label, graphDetail(scene)]);
  };
  return { actors, ego, previousEgo, draw, frames, details };
}

async function drive(ctx, conditions) {
  const { world } = ctx;
  const { actors, ego, previousEgo, draw, frames, details } = stage(ctx, conditions);
  const clock = new WorldClock(15.5),
    recorder = new DriveRecorder({ seconds: SECONDS + 1 });
  let score = new DriveScore(world, { route: world.route });
  draw("start", 0, 1);
  for (let k = 1; k <= SECONDS / STEP; k++) {
    capturePose(world.ego, previousEgo);
    actors.capture();
    const road = stepWorld(ctx, STEP, world.t * 1000);
    if (ctx.autopilot.firing) await ctx.autopilot.firing;
    score.record(world, road, STEP);
    clock.update(world.t);
    recorder.record({ ...ctx, clock, drive: score });
    // (drawn part-way between physics steps half the time, as a display faster than the simulation does)
    if (k % DRAW_EVERY === 0) draw(`t=${world.t.toFixed(1)}`, STEP * DRAW_EVERY, k % (2 * DRAW_EVERY) ? 0.5 : 1);
  }
  // a replay: back to a checkpoint in the middle, drawn toward the next one
  const index = Math.floor(recorder.frames.length / 2);
  recorder.restore(index, {
    ...ctx,
    clock,
    setDrive: (value) => {
      score = value;
    },
  });
  capturePose(world.ego, previousEgo);
  actors.restore(ego, true);
  const next = recorder.frames[index + 1]?.state ?? null;
  draw("replay 0.5", 0, 1, next, 0.5);
  draw("replay 0.9", 0.05, 1, next, 0.9);
  return { frames, details };
}

function freeDrive(mapId, { weather, hour, seed }) {
  const map = load(mapId);
  const free = freeDriveOptions(new URLSearchParams(), { hour });
  const world = new World(map, { seed, weather, ...free.world });
  world.visibility.setNight(hour >= 21 || hour < 6 ? 1 : 0);
  world.setClock(mapClock(hour, map));
  const fleet = new NpcFleet(world, { count: 24, seed: seed + 6, ...free.fleet });
  const autopilot = new Autopilot(world, {});
  return { world, fleet, autopilot };
}

const scenes = [
  ...[...CHALLENGES, ...ROAD_TESTS].map((challenge) => ({
    id: challenge.id,
    build: () => setupChallenge(load(challenge.map), challenge),
    conditions: {
      lightsOn:
        challenge.time === "night" || challenge.nightFlash
          ? 1
          : challenge.weather && challenge.weather !== "dry"
            ? 0.6
            : 0,
      weather: challenge.weather || "dry",
    },
  })),
  ...[
    ["free-kitsilano-dry", "kitsilano", { weather: "dry", hour: 15.5, seed: 11 }],
    ["free-kitsilano-rain-night", "kitsilano", { weather: "rain", hour: 23, seed: 12 }],
    ["free-kitsilano-snow", "kitsilano", { weather: "snow", hour: 8, seed: 13 }],
    ["free-toronto-dry", "toronto", { weather: "dry", hour: 15.5, seed: 14 }],
  ].map(([id, mapId, options]) => ({
    id,
    build: () => freeDrive(mapId, options),
    conditions: { lightsOn: options.hour >= 21 ? 1 : options.weather === "dry" ? 0 : 0.6, weather: options.weather },
  })),
];

const only = mode === "detail" ? [args[0]] : option("--only")?.split(",");
const out = { node: process.version, scenes: {} };
for (const scene of scenes) {
  if (only && !only.includes(scene.id)) continue;
  try {
    const { frames, details } = await drive(scene.build(), scene.conditions);
    out.scenes[scene.id] = { frames };
    if (mode === "detail") for (const [label, lines] of details) console.log(`# ${label}\n${lines.join("\n")}`);
    else console.log(`${scene.id}: ${frames.length} frames, ${frames.at(-1).objects} objects`);
  } catch (error) {
    out.scenes[scene.id] = {
      error: String(error?.stack || error)
        .split("\n")
        .slice(0, 3)
        .join(" | "),
    };
    console.log(`${scene.id}: ${out.scenes[scene.id].error}`);
  }
}
if (mode === "capture") writeFileSync(args[0], JSON.stringify(out));
process.exit(0);
