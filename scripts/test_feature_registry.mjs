// The feature registry (static/js/sim/features/index.js, docs/feature-interface.md): every record is
// whole and every hook sits at a slot the core runs; the core calls every slot and no longer names a
// registered feature; the World builds each feature from its option, with its "seen" flag and audit
// calls; metrics and failures appear only once a feature has met the car, each at its old place; the
// model wording and the LLM prompt keep every line where it was; and a record at a slot the core never
// runs is refused.
// node --experimental-default-type=module scripts/test_feature_registry.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const R = await import("../static/js/sim/features/index.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { failures } = await import("../static/js/bench/metrics.js");
const { SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");

let checks = 0;
const test = (name, fn) => {
  fn();
  checks++;
  console.log(`✓ ${name}`);
};
const source = (path) => fs.readFileSync(new URL(`../static/js/${path}`, import.meta.url), "utf8");
const CORE = [
  "sim/world.js",
  "sim/step.js",
  "sim/npc.js",
  "brain/sensors.js",
  "brain/candidates.js",
  "brain/state.js",
  "brain/llm-prompt.js",
  "bench/metrics.js",
];

test("every record is whole, its option and flags its own, and every hook at a slot the core runs", () => {
  assert.deepEqual(
    R.FEATURES.map((f) => f.key),
    ["potholes", "geese", "ice", "puddles", "roadClosures"],
  );
  for (const f of R.FEATURES) assert.equal(R.recordProblem(f), null, f.key);
  for (const field of ["key", "seen", "calls"])
    assert.equal(new Set(R.FEATURES.map((f) => f[field])).size, R.FEATURES.length, `each ${field} is one feature's`);
  assert.deepEqual(
    R.FEATURE_OPTIONS,
    R.FEATURES.map((f) => f.key),
  );
});

test("the core runs every slot, and names no registered feature", () => {
  const core = CORE.map(source).join("\n");
  for (const [name, slots] of Object.entries(R.SLOTS)) {
    if (["metric", "prompt"].includes(name)) continue;
    for (const slot of slots) {
      const call =
        slot === "end"
          ? new RegExp(`hook(?:s|Entries)\\("${name}"\\)`)
          : new RegExp(`hook(?:s|Entries)\\("${name}", "${slot}"\\)`);
      assert.ok(call.test(core), `the core runs ${name} at ${slot}`);
    }
  }
  for (const slot of R.SLOTS.metric) {
    assert.ok(source("bench/metrics.js").includes(`featureMetrics(world, v, "${slot}")`), `metrics at ${slot}`);
    assert.ok(source("bench/metrics.js").includes(`featureFailures(m, "${slot}")`), `failures at ${slot}`);
  }
  for (const slot of R.SLOTS.prompt)
    assert.ok(source("brain/llm-prompt.js").includes(`\${promptLines("${slot}")}`), `prompt lines at ${slot}`);
  // (their modules, their snapshot fields and their candidates belong to the records now, and traffic's
  // moves inside its lane reach each other only through what the hooks return, never by name)
  for (const path of CORE) {
    const text = source(path);
    for (const name of [
      'sim/potholes.js"',
      'sim/geese.js"',
      'sim/road-closures.js"',
      'sim/puddles.js"',
      'sim/black-ice.js"',
      './potholes.js"',
      './geese.js"',
      './road-closures.js"',
      './puddles.js"',
      './black-ice.js"',
    ]) {
      const imports = text
        .split("\n")
        .filter((l) => l.startsWith("import") && l.includes(name) && !l.includes("{ wheelPoints }"));
      assert.equal(imports.length, 0, `${path} imports ${name}`);
    }
    for (const field of [
      "snap.pothole",
      "snap.geese_crossing",
      "snap.road_closed",
      "snap.puddle_splash",
      "snap.puddles_ahead",
      "snap.black_ice",
      "snap.ice_caution",
      "snap.ice_limit_mps",
      '"slow_for_ice"',
      '"ease_round_pothole"',
      '"ease_round_puddle"',
      '"wait_for_geese"',
      '"stop_for_closure"',
      "world.roadClosures",
      "world.geese",
      "this.geese",
      "this.roadClosures",
      "this.potholes",
      "world.puddles",
      "this.puddles",
      "phShift",
      "pdShift",
      "laneFx",
      "world.ice",
      "this.ice",
      "vIce",
      "iceSeen",
    ]) {
      assert.ok(!text.includes(field), `${path} names ${field}`);
    }
  }
});

test("the World builds each feature from its option, with its seen flag and its audit's calls", () => {
  const root = new URL("../data/maps/", import.meta.url);
  const pack = JSON.parse(fs.readFileSync(new URL("bb9df59633e0.v6.pack.json", root)));
  pack.parks = JSON.parse(fs.readFileSync(new URL("bb9df59633e0.parks.v1.json", root)));
  const map = new MapData(pack);
  const off = new World(map, { seed: 3, parked: 0, pedestrians: 0 });
  const on = new World(map, {
    seed: 3,
    parked: 0,
    pedestrians: 0,
    potholes: true,
    geese: true,
    ice: true,
    puddles: true,
    roadClosures: true,
  });
  for (const f of R.FEATURES) {
    assert.equal(off[f.key].enabled, false, `${f.key} off by default`);
    assert.equal(on[f.key].enabled, f.key === "geese" ? !!map.parkSpans?.length : true, `${f.key} on with its option`);
    for (const w of [off, on]) {
      assert.equal(w[f.seen], false);
      assert.ok(w[f.calls] instanceof Map);
    }
  }
  // (off, nothing is placed and no random stream is made)
  assert.equal(off.potholes.list.length, 0);
  assert.equal(off.puddles.list.length, 0);
  assert.ok(on.puddles.list.length > 0);
  assert.equal(on.puddlesRained, false, "dry: no rain yet this drive");
  assert.equal(off.geese.random, null);
  assert.equal(off.roadClosures.random, null);
  assert.ok(on.potholes.list.length > 0);
  // (the registered features' obstacles join the others only while there are some)
  assert.equal(off.obstaclesNear(off.ego.x, off.ego.y, 50).length, on.obstaclesNear(on.ego.x, on.ego.y, 50).length);
});

test("metrics and failures appear only once a feature has met the car, each at its old place", () => {
  const world = { potholesSeen: false, geeseSeen: true, iceSeen: true, puddlesSeen: true, roadClosuresSeen: true };
  const v = { wildlife_conflicts: 2 };
  assert.deepEqual(R.featureMetrics(world, v, "driveways"), {});
  assert.deepEqual(R.featureMetrics(world, v, "balls"), { wildlife_conflicts: 2 });
  assert.deepEqual(R.featureMetrics(world, v, "tailgaters"), { ice_overspeed: 0 });
  assert.deepEqual(R.featureMetrics(world, v, "snowbanks"), { pedestrians_splashed: 0 });
  assert.deepEqual(R.featureMetrics(world, v, "parkers"), { closure_entries: 0 });
  const m = {
    arrived: true,
    reversing_conflicts: 1,
    pothole_hits: 1,
    ball_warnings_ignored: 1,
    wildlife_conflicts: 1,
    brake_checks: 1,
    ice_overspeed: 1,
    snowbank_conflicts: 1,
    pedestrians_splashed: 1,
    parking_conflicts: 1,
    closure_entries: 1,
    officer_violations: 1,
  };
  assert.deepEqual(failures(m), [
    "squeezed past or failed to stop for a car backing out",
    "hit a pothole too fast",
    "ignored a ball rolling into the street",
    "drove into or too close to geese crossing the road",
    "braked hard with a tailgater close behind",
    "crossed black ice too fast, or braked or steered hard on it",
    "entered a stretch narrowed by snowbanks out of turn",
    "splashed a pedestrian from a puddle",
    "blocked or went round a car parallel parking",
    "drove onto a closed road",
    "went on when a police officer signalled stop",
  ]);
});

test("the LLM prompt keeps each feature's line where it was", () => {
  const lines = SYSTEM_PROMPT.split("\n");
  const at = (start) => {
    const i = lines.findIndex((l) => l.startsWith(start));
    assert.ok(i >= 0, start);
    return i;
  };
  for (const f of R.FEATURES.filter((x) => x.prompt))
    assert.equal(lines.filter((l) => l === f.prompt.text).length, 1, f.key);
  assert.equal(at("When road_closed.on_route"), at("When turn_restriction.banned") + 1);
  assert.equal(at("- Watch for potholes"), at("- Watch driveways for reversing lights") + 1);
  assert.equal(at("- Canada geese cross the road"), at("- Snowbanks (") + 1);
  assert.equal(at("- In the rain, watch for puddles"), at("- Canada geese cross the road") + 1);
  assert.equal(at("- Near freezing (`ice_caution`)"), at("- A car tailgating close behind") + 1);
});

test("a record at a slot the core never runs is refused", () => {
  const record = { key: "x", seen: "xSeen", calls: "xCalls", build: () => ({ enabled: false }) };
  assert.equal(R.recordProblem(record), null);
  assert.match(R.recordProblem({ ...record, sense: { at: "nowhere", run() {} } }), /never runs/);
  assert.match(R.recordProblem({ ...record, sensing() {} }), /unknown hook/);
  assert.match(R.recordProblem({ ...record, seen: undefined }), /no seen/);
  assert.throws(() => R.hooks("sense", "nowhere"), /no slot/);
});

console.log(`${checks} feature registry checks passed`);
