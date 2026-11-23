// The feature registry (static/js/sim/features/index.js, docs/feature-interface.md): every record is
// whole and every hook sits at a slot the core runs; the core calls every slot and no longer names a
// registered feature; the World builds each feature from its option, with its "seen" flag and audit
// calls; metrics and failures appear only once a feature has met the car, each at its old place; the
// model wording and the LLM prompt keep every line where it was; and a record at a slot the core never
// runs is refused.
// node --experimental-default-type=module scripts/test_feature_registry.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
globalThis.document = { querySelector: () => null };
const R = await import("../static/js/sim/features/index.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { World } = await import("../static/js/sim/world.js");
const { NpcFleet } = await import("../static/js/sim/npc.js");
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
  "sim/free-drive.js",
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

test("every record is whole, its option and flags its own, and every hook at a slot the core runs", () => {
  assert.deepEqual(
    R.FEATURES.map((f) => f.key),
    [
      "highBeams",
      "guards",
      "pxo",
      "restrictions",
      "calming",
      "sunGlare",
      "contraflow",
      "redRunners",
      "driveways",
      "balls",
      "potholes",
      "geese",
      "officers",
      "tailgaters",
      "ice",
      "snowbanks",
      "puddles",
      "parkers",
      "roadClosures",
      "collection",
      "vans",
      "roadside",
      "followingDistance",
      "redTurnSigns",
    ],
  );
  for (const f of R.FEATURES) assert.equal(R.recordProblem(f), null, f.key);
  for (const field of ["key", "seen", "calls"]) {
    const names = R.FEATURES.map((f) => f[field]).filter(Boolean);
    assert.equal(new Set(names).size, names.length, `each ${field} is one feature's`);
  }
  assert.deepEqual(
    R.FEATURE_OPTIONS,
    R.FEATURES.filter((f) => !f.buildFleet).map((f) => f.key),
  );
  assert.deepEqual(
    R.FLEET_FEATURES.map((f) => f.key),
    ["collection"],
  );
});

test("the core runs every slot, and names no registered feature", () => {
  const core = CORE.map(source).join("\n");
  const dispatches = {
    perceptionLine: source("render/perception.js"),
    perceptionFocus: source("render/perception.js"),
    controlDirection: source("sim/features/index.js"),
    junctionPlan: source("sim/features/index.js"),
    checkpoint: source("lab/recorder.js"),
    checkpointShare: source("lab/recorder.js"),
    checkpointRestore: source("lab/recorder.js"),
    decisionFields: source("sim/features/index.js"),
    routeOptions: source("sim/features/index.js"),
    requestReroute: source("brain/brain.js"),
  };
  for (const [name, slots] of Object.entries(R.SLOTS)) {
    if (["metric", "prompt", "notice"].includes(name)) continue;
    for (const slot of slots) {
      const call =
        slot === "end"
          ? new RegExp(`hook(?:s|Entries)\\("${name}"\\)`)
          : new RegExp(`hook(?:s|Entries)\\("${name}", "${slot}"\\)`);
      assert.ok(call.test(dispatches[name] ?? core), `the core runs ${name} at ${slot}`);
    }
  }
  for (const slot of R.SLOTS.notice)
    assert.ok(source("main.js").includes(`announceFeatureNotices("${slot}"`), `HUD notices at ${slot}`);
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
      'contraflow.js"',
      'sun-glare.js"',
      'traffic-calming.js"',
      'red-light-runner.js"',
      'collection-truck.js"',
      'sim/driveway-reversers.js"',
      './driveway-reversers.js"',
      'sim/potholes.js"',
      'sim/geese.js"',
      'sim/road-closures.js"',
      'sim/puddles.js"',
      'sim/black-ice.js"',
      'sim/snowbanks.js"',
      'sim/ball-chase.js"',
      'sim/parkers.js"',
      './potholes.js"',
      './geese.js"',
      './road-closures.js"',
      './puddles.js"',
      './black-ice.js"',
      './snowbanks.js"',
      './ball-chase.js"',
      './parkers.js"',
      'sim/traffic-officer.js"',
      'tailgaters.js"',
      'double-parked.js"',
      './traffic-officer.js"',
      'crossing-guard.js"',
      'pxo.js"',
      'roadside.js"',
      'turn-restrictions.js"',
      'high-beams.js"',
      'red-turn-signs.js"',
    ]) {
      const imports = text
        .split("\n")
        .filter((l) => l.startsWith("import") && l.includes(name) && !l.includes("{ wheelPoints }"));
      assert.equal(imports.length, 0, `${path} imports ${name}`);
    }
    for (const field of [
      "snap.contraflow_cyclist",
      "snap.sun_glare",
      "snap.traffic_calming",
      "world.calming",
      "this.calming",
      "hump_hits",
      "snap.red_light_runner",
      "world.redRunners",
      "this.redRunners",
      "fresh_green_conflicts",
      '"wait_for_runner"',
      "enters_ahead_of_red_light_runner",
      "world.sunGlare",
      "this.sunGlare",
      "glare_speeding_seconds",
      "crew_close_passes",
      "collectionSeen",
      ".collection",
      ".collect?",
      ".contra ",
      "world.contraflow",
      "this.contraflow",
      "cfShift",
      "contraflow_conflicts",
      '"yield_to_contraflow_cyclist"',
      "snap.reversing_vehicle",
      "snap.ball_in_road",
      "snap.parking_ahead",
      '"slow_for_ball"',
      '"wait_for_parker"',
      ".parker",
      ".balls",
      '"yield_to_reversing"',
      "world.driveways",
      "this.driveways",
      "snap.pothole",
      "snap.geese_crossing",
      "snap.road_closed",
      "snap.puddle_splash",
      "snap.puddles_ahead",
      "snap.black_ice",
      "snap.ice_caution",
      "snap.ice_limit_mps",
      '"slow_for_ice"',
      "snap.snowbank",
      '"wait_for_oncoming_narrowing"',
      "intoNarrowing",
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
      "world.snowbanks",
      "this.snowbanks",
      "sbShift",
      "snowbanksSeen",
      "officerHeld",
      "officersSeen",
      "snap.traffic_officer",
      "snap.tailgater",
      "world.tailgaters",
      ".tailgate",
      ".tgPeek",
      "brake_checks",
      '"let_tailgater_pass"',
      '"ease_off_for_tailgater"',
      '"brakes_hard_with_tailgater"',
      "officer_violations",
      '"wait_for_officer"',
      '"go_on_officer_wave"',
      '"passes_officer_stop"',
      "snap.double_parked",
      ".doubleParked",
      '"wait_behind_van"',
      '"no_room_to_go_round"',
      "snap.crossing_guard",
      "world.crossingGuards",
      "this.crossingGuards",
      "guard_violations",
      '"stop_for_crossing_guard"',
      '"passes_crossing_guard"',
      "snap.pxo",
      "world.pxo",
      "this.pxo",
      "pxo_early_goes",
      "snap.roadside_stop",
      "world.roadside",
      "this.roadside",
      "world.followingDistance",
      "this.followingDistance",
      '"following_distance"',
      "snap.turn_restriction",
      "world.restrictions",
      "this.restrictions",
      "illegal_turns",
      '"stop_for_turn_restriction"',
      "world.highBeams",
      "this.highBeams",
      "glare_seconds",
      "world.redTurnSigns",
      "this.redTurnSigns",
      "no_turn_on_red",
    ]) {
      assert.ok(!text.includes(field), `${path} names ${field}`);
    }
  }
});

test("registered HUD notices keep their order, clear on absence, and own event badges", () => {
  const badges = [];
  const hud = { badge: (...args) => badges.push(args) };
  const world = { driveways: {}, geese: {}, sunGlare: {} };
  const autopilot = {
    enabled: true,
    snap: {
      contraflow_cyclist: { cyclist_id: "cf-1", wait: true, relation: "oncoming" },
      red_light_runner: { id: "car-1", wait: true },
    },
  };
  const announced = new Map();
  const show = () => R.announceFeatureNotices("beforeLeftOnRed", world, autopilot, {}, announced, hud);
  show();
  show();
  assert.deepEqual(badges, [
    ["CYCLIST COMING THE OTHER WAY · NO ROOM · WAIT", "safety", 2500],
    ["CAR RUNNING THE RED · WAIT", "safety", 2500],
  ]);
  const snap = autopilot.snap;
  autopilot.snap = {};
  show();
  assert.equal(announced.size, 0);
  autopilot.snap = snap;
  show();
  assert.equal(badges.length, 4);
  assert.equal(R.featureEventBadge({ type: "pothole_hit", kmh: 34.6 }), "HIT A POTHOLE AT 35 KM/H");
  assert.equal(R.featurePerceptionRejection("passes_crossing_guard"), "Crossing guard: STOP");
});

test("the World builds each feature from its option, with its seen flag and its audit's calls", () => {
  const root = new URL("../data/maps/", import.meta.url);
  const pack = JSON.parse(fs.readFileSync(new URL("bb9df59633e0.v6.pack.json", root)));
  pack.parks = JSON.parse(fs.readFileSync(new URL("bb9df59633e0.parks.v1.json", root)));
  pack.driveways = JSON.parse(fs.readFileSync(new URL("bb9df59633e0.driveways.v1.json", root)));
  pack.contraflow = JSON.parse(fs.readFileSync(new URL("bb9df59633e0.contraflow.v1.json", root)));
  const map = new MapData(pack);
  const off = new World(map, { seed: 3, parked: 0, pedestrians: 0 });
  const on = new World(map, {
    seed: 3,
    parked: 0,
    pedestrians: 0,
    guards: true,
    highBeams: true,
    restrictions: true,
    redTurnSigns: true,
    followingDistance: true,
    sunGlare: true,
    calming: true,
    contraflow: true,
    redRunners: true,
    driveways: true,
    balls: true,
    potholes: true,
    geese: true,
    ice: true,
    snowbanks: true,
    puddles: true,
    parkers: true,
    officers: true,
    tailgaters: true,
    roadClosures: true,
    vans: 2,
  });
  for (const f of R.FEATURES) {
    const property = f.property ?? f.key;
    if (!f.buildFleet) {
      const offState = off[property],
        onState = on[property];
      assert.equal(typeof offState === "boolean" ? offState : offState?.enabled, false, `${f.key} off by default`);
      assert.equal(
        typeof onState === "boolean" ? onState : onState?.enabled,
        f.key === "geese" ? !!map.parkSpans?.length : !["pxo", "roadside"].includes(f.key),
        `${f.key} on with its option`,
      );
    }
    for (const w of [off, on]) {
      if (f.seen) assert.equal(w[f.seen], false);
      else assert.ok(!Object.hasOwn(w, "undefined"));
      if (f.calls) assert.ok(w[f.calls] instanceof Map);
    }
  }
  const offFleet = new NpcFleet(off, { count: 0, bikes: 0 });
  const onFleet = new NpcFleet(on, { count: 0, bikes: 0, collection: 1 });
  assert.equal(offFleet.collection.target, 0);
  assert.equal(onFleet.collection.target, 1);
  assert.equal(offFleet.collection.trucks.length, 0);
  assert.ok(off.crewPassed instanceof Set);
  // (off, nothing is placed and no random stream is made)
  assert.equal(off.contraflow.random, null);
  assert.equal(off.redRunners.random, null);
  assert.equal(off.driveways.random, null);
  assert.equal(off.balls.random, null);
  assert.equal(off.parkers.random, null);
  assert.equal(off.tailgaters.random, null);
  assert.equal(off.potholes.list.length, 0);
  assert.equal(off.puddles.list.length, 0);
  assert.ok(on.puddles.list.length > 0);
  assert.equal(on.puddlesRained, false, "dry: no rain yet this drive");
  assert.equal(off.geese.random, null);
  assert.equal(off.roadClosures.random, null);
  assert.equal(on.doubleParked.count, 2);
  assert.ok(on.potholes.list.length > 0);
  // (the registered features' obstacles join the others only while there are some)
  assert.equal(off.obstaclesNear(off.ego.x, off.ego.y, 50).length, on.obstaclesNear(on.ego.x, on.ego.y, 50).length);
  assert.ok(map.driveways.find((driveway) => on.driveways.place(driveway)));
  const [reverser] = on.driveways.cars;
  assert.ok(on.obstaclesNear(reverser.x, reverser.y, 10).includes(reverser));
  assert.ok(!off.obstaclesNear(reverser.x, reverser.y, 10).some((o) => o.reverser));
});

test("metrics and failures appear only once a feature has met the car, each at its old place", () => {
  const world = {
    potholesSeen: false,
    geeseSeen: true,
    iceSeen: true,
    snowbanksSeen: false,
    puddlesSeen: true,
    roadClosuresSeen: true,
    officersSeen: true,
  };
  const v = { wildlife_conflicts: 2, glare_speeding_seconds: 1.016 };
  assert.deepEqual(R.featureMetrics(world, v, "afterHeadlights"), {});
  world.sunGlareSeen = true;
  assert.deepEqual(R.featureMetrics(world, v, "afterHeadlights"), { glare_speeding_seconds: 1.02 });
  assert.deepEqual(R.featureFailures({ glare_speeding_seconds: 1 }, "afterHeadlights"), []);
  assert.deepEqual(R.featureMetrics(world, v, "afterCalming"), {});
  world.collectionSeen = true;
  assert.deepEqual(R.featureMetrics(world, v, "afterCalming"), { crew_close_passes: 0 });
  assert.deepEqual(R.featureMetrics(world, v, "afterRestrictions"), {});
  world.calmingSeen = true;
  assert.deepEqual(R.featureMetrics(world, v, "afterRestrictions"), { hump_hits: 0 });
  assert.deepEqual(R.featureMetrics(world, v, "beforeRunner"), {});
  world.contraflowSeen = true;
  assert.deepEqual(R.featureMetrics(world, v, "beforeRunner"), { contraflow_conflicts: 0 });
  world.redRunnersSeen = true;
  assert.deepEqual(Object.keys(R.featureMetrics(world, v, "beforeRunner")), [
    "contraflow_conflicts",
    "fresh_green_conflicts",
  ]);
  assert.deepEqual(R.featureMetrics(world, v, "driveways"), {});
  assert.deepEqual(R.featureMetrics(world, v, "streetHazards"), { wildlife_conflicts: 2 });
  assert.deepEqual(R.featureMetrics(world, v, "rearTraffic"), { ice_overspeed: 0, pedestrians_splashed: 0 });
  assert.deepEqual(R.featureMetrics(world, v, "late"), { closure_entries: 0 });
  assert.deepEqual(R.featureMetrics(world, v, "junctions"), { officer_violations: 0 });
  world.tailgatersSeen = true;
  world.snowbanksSeen = true;
  assert.deepEqual(Object.keys(R.featureMetrics(world, v, "rearTraffic")), [
    "brake_checks",
    "ice_overspeed",
    "snowbank_conflicts",
    "pedestrians_splashed",
  ]);
  world.ballsSeen = true;
  world.parkersSeen = true;
  assert.deepEqual(Object.keys(R.featureMetrics(world, v, "streetHazards")), [
    "ball_warnings_ignored",
    "wildlife_conflicts",
  ]);
  assert.deepEqual(Object.keys(R.featureMetrics(world, v, "late")), ["parking_conflicts", "closure_entries"]);
  const m = {
    arrived: true,
    glare_speeding_seconds: 1.02,
    illegal_turns: 1,
    hump_hits: 1,
    pxo_early_goes: 1,
    crew_close_passes: 1,
    contraflow_conflicts: 1,
    fresh_green_conflicts: 1,
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
    "too fast for sun glare",
    "made a prohibited turn",
    "took a speed hump too fast",
    "left a pedestrian crossover before the far curb",
    "passed a garbage crew worker too close",
    "cut off or squeezed a contraflow cyclist",
    "entered on green ahead of a car running the red",
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
  for (const f of R.FEATURES.filter((x) => x.prompt)) {
    const count = f.prompt.text.split("\n").length;
    const occurrences = f.prompt.inline
      ? lines.filter((line) => line.endsWith(f.prompt.text))
      : lines.filter((_, i) => lines.slice(i, i + count).join("\n") === f.prompt.text);
    assert.equal(occurrences.length, 1, f.key);
  }
  assert.equal(at("- Driving into a low sun"), at("- An in-effect `bus_lane`") + 1);
  assert.equal(at("- Coming up to a speed hump"), at("- Driving into a low sun") + 1);
  assert.equal(at("- A garbage truck stopped"), at("- Choose `wait_behind_van`") + 1);
  assert.equal(at("- Behind a cyclist"), at("- A garbage truck stopped") + 1);
  assert.equal(at("When road_closed.on_route"), at("When turn_restriction.banned") + 1);
  assert.equal(at("- On a one-way street"), at("- Choose `wait_short_of_junction`") + 1);
  assert.equal(at("- When the car's light turns green"), at("- On a one-way street") + 1);
  assert.equal(at("- A ball rolling into the street"), at("- When the car's light turns green") + 1);
  assert.equal(at("- Watch driveways for reversing lights"), at("- A ball rolling into the street") + 1);
  assert.equal(at("- Watch for potholes"), at("- Watch driveways for reversing lights") + 1);
  assert.equal(at("- Snowbanks ("), at("- Watch for potholes") + 1);
  assert.equal(at("- Canada geese cross the road"), at("- Snowbanks (") + 1);
  assert.equal(at("- In the rain, watch for puddles"), at("- Canada geese cross the road") + 1);
  assert.equal(at("- A car ahead signalling right"), at("- In the rain, watch for puddles") + 1);
  assert.equal(at("- A police officer directing traffic"), at("- A car ahead signalling right") + 1);
  assert.equal(at("- Near freezing (`ice_caution`)"), at("- A car tailgating close behind") + 1);
});

test("a record at a slot the core never runs is refused", () => {
  const record = { key: "x", seen: "xSeen", calls: "xCalls", build: () => ({ enabled: false }) };
  assert.equal(R.recordProblem(record), null);
  assert.match(R.recordProblem({ ...record, sense: { at: "nowhere", run() {} } }), /never runs/);
  assert.match(R.recordProblem({ ...record, sensing() {} }), /unknown hook/);
  assert.equal(R.recordProblem({ ...record, seen: undefined }), null);
  assert.match(R.recordProblem({ ...record, seen: "" }), /no seen/);
  const metric = { at: "late", name: "test_violation", failure: "test failure", label: "Test violation" };
  assert.equal(R.recordProblem({ ...record, metric }), null);
  assert.match(R.recordProblem({ ...record, seen: undefined, metric }), /no seen/);
  assert.match(R.recordProblem({ ...record, metric: { ...metric, label: "" } }), /metric has no label/);
  assert.match(R.recordProblem({ ...record, metric: { ...metric, category: "rightOfWay" } }), /unknown category/);
  assert.throws(() => R.hooks("sense", "nowhere"), /no slot/);
});

test("every record loads in a fresh process, through the registry as the core loads it", () => {
  const dir = new URL("../static/js/sim/features/", import.meta.url);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "index.js")) {
    // (fixed code; the two modules come in as arguments)
    const code =
      'globalThis.document = { querySelector: () => null }; await import(process.argv[1]); const r = await import(process.argv[2]); if (!r.default?.key) throw new Error("no record");';
    execFileSync(
      process.execPath,
      [
        "--experimental-default-type=module",
        "--input-type=module",
        "-e",
        code,
        new URL("index.js", dir).href,
        new URL(file, dir).href,
      ],
      { stdio: "pipe" },
    );
  }
});

test("the van and collection simulations can load before the registry", () => {
  for (const [module, className] of [
    ["double-parked", "DoubleParked"],
    ["collection-truck", "CollectionTrucks"],
  ]) {
    const entry = new URL(`../static/js/sim/${module}.js`, import.meta.url);
    const code = `globalThis.document = { querySelector: () => null };
      const module = await import(process.argv[1]);
      if (typeof module.${className} !== "function") throw new Error("${className} did not load");`;
    execFileSync(process.execPath, [
      "--experimental-default-type=module",
      "--input-type=module",
      "-e",
      code,
      entry.href,
    ]);
  }
});

console.log(`${checks} feature registry checks passed`);
