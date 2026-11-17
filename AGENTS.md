# Agent instructions

## Commands

No build step. Python runs through `uv` (one dependency, `typesafe-sdk`); the browser app is plain ES modules with Three.js from a CDN import map. Ruff (config in `pyproject.toml`) and Biome (`biome.jsonc`; `static/vendor/` and `data/` are left out) lint and format; CI runs both (`.github/workflows/lint.yml`). Biome is the only npm package: `package.json` and `package-lock.json` pin it (Dependabot updates it), so run `npm ci` once. Biome warnings fail CI as errors do. Fix what they report rather than hand-formatting or silencing a rule; an unused parameter a callback signature needs gets a leading `_`. Node checks that read source with regexes must accept the formatter's line breaks and trailing commas.

```sh
npm ci                                                      # install the pinned Biome (once)
uv run --locked ruff check && uv run --locked ruff format --check && npm run lint   # lint and format checks
uv run --locked ruff format && npm run format               # apply formatting and safe fixes
uv run server.py                                            # serves http://127.0.0.1:8322 (PORT to change)
uv run python -m unittest discover -s tests                 # offline Python tests
uv run python -m unittest discover -s tests -p "test_routing.py"          # one file
uv run python -m unittest discover -s tests -k test_route_never_backs_up  # one test
uv run scripts/fetch_map.py [bbox|preset] [--force]         # build/rebuild a map pack
uv run scripts/verify_jev.py                                # live: data/snapshots/*.json against the real model (costs credits)
node --experimental-default-type=module scripts/bench_node.mjs --features city            # the city suite under Node (server running)
node --experimental-default-type=module scripts/arena_node.mjs --brain jev --record out.json.gz   # challenges + road tests under Node (server running); --replay to check
```

The main ruleset requires three checks: `Lint and format`, `Demo checks passed` (`demo.yml`) and `Benchmark passed` (`bench.yml`). The last two pass only when every job they `need` passed, so add any new job in those workflows to their `needs`.

Workflows (`.github/workflows/`) run on Namespace runners and pin every action to a full commit SHA with a `# vX.Y.Z` comment, which Dependabot keeps up to date. CodeQL is an advanced setup (`codeql.yml`), not GitHub's default setup. The weekly city soak (`soak.yml`) is report-only: a failing leg leaves the run green, and its `Soak summary` job lists the failed routes in the run summary and as warnings (`scripts/soak_summary.py`).

`python -m unittest tests.test_x` fails: `tests/helpers.py` fixes `sys.path`, so always use `discover -s tests`.

Browser-side checks need the server running:
- `/tests`: browser unit tests (car model, controller, collisions, candidates, state). Use `/tests`, not `/tests/run.html`: only pages listed in `PAGES` in `server.py` get the session token injected, and every API call without it gets a 403.
- `/bench`: closed-loop benchmark. Lockstep plus the Rules brain is deterministic, so rerun suite seed 1 and compare with the newest committed run in `data/runs/` of the same map, preset and weather (`docs/rules-baseline.md` lists them) after any change to physics, traffic, planner, or router.

Headless (macOS): `swift scripts/shot.swift URL OUT.png [wait] [post_js] [pre_js] [settle] [timeout]` screenshots a page in an offscreen WKWebView and runs JS. The page is usually `visibilityState: hidden`, so `requestAnimationFrame` never fires. Step the app with `window.__jev.advance(seconds)`, and run the benchmark with `await window.__bench.run({ brain, count, seed, save })`. The default timeout is `settle + wait + 30` s, so pass the 7th argument for long runs. `SHOT_SIZE=390x844` sets the viewport (default 1440×900); `?touch=1` shows the touch controls on a desktop. `uv` and the server need to run outside a sandbox: uv writes to `~/.cache/uv` and the server binds a port.

Docs: [`docs/reference/`](docs/reference/README.md) has one page per topic and feature; [adding a challenge](docs/adding-a-challenge.md); [adding a driver](docs/agents.md).

## Architecture

**Split of responsibilities.** Python (`server.py`, `jev/`) builds the map pack from OpenStreetMap, plans routes, and proxies decisions to TypeSafe (the API key never reaches the browser). Everything that moves (physics, traffic, sensing, planning, rendering) runs in the browser under `static/js/`. The server is loopback-only with CSRF defences (`jev/security.py`); state-changing requests need the `X-Jev-Token` header that `common.js` sends.

**Map pack pipeline** (`jev/osm/`): fetch → parse → project to meters → road graph (directed edges, lanes offset right of the centerline, parking lanes widen `asphalt`, roundabout rings pushed out to a drivable radius) → controls (signals, stops, roundabout yields; `s_line` set back behind the crosswalk) → buildings → `data/maps/<key>.v<PACK_VERSION>.pack.json`. Packs are cached and committed. If the pipeline output changes: bump `PACK_VERSION` in `jev/osm/pack.py` and the version assertion in `tests/test_osm.py`; rebuild the Kitsilano pack and replace the old pack file; restart the server, which caches packs in memory.

**Layers beside a pack** (`<key>.<layer>.v1.json`) come from the raw OSM download (`scripts/fetch_map.py ... --<layer>`), leave the pack as it was and are committed: transit, crossings, zones, rail, calming, scrambles, buslanes, restrictions, contraflow, driveways, parks, bridges. Crossings `v2` (Toronto, Ottawa: Ontario's pedestrian crossovers) is preferred to `v1`; never bump the street pack for a crossing-layer change. `server.py`, `scripts/build_demo.py` and any Node test that loads a pack for the challenges must load every layer.

**One decision cycle** (`static/js/brain/brain.js`, `Autopilot`): `sensors.buildSnapshot` → `candidates.sampleCandidates` → `simulateAll` (3 s forward sims) → `state.toJevState` + `buildQuestions` → brain → `apply`. The only difference between the Jev and Rules brains is the "brain" step: `rules.js` scores the surviving candidates; `jev.js` posts to `/api/decide`. Timeouts and invalid answers fall back to Rules and increment `world.violations.fallbacks`.

**Invariants that span files:**
- **Parking reservations have one shape.** Write `slot.reserved = { owner, sFrom, sTo }` only with `reserveSlot` (`sim/parking.js`); the span is along the slot's own edge. Test `reserved?.owner` when releasing. Never infer a span from the owner's spec (driveway owners are map records). Check `scripts/test_parking_reservations.mjs`.
- **A thrown simulation step fails its drive.** The app pauses with a persistent error and restart control while frames keep rendering. Benchmark and arena results add `simulation_error` only on failure; `failures()` and saved evaluation validation keep that verdict; successful result shapes are unchanged. Checks: `scripts/test_simulation_errors.mjs` and the browser recovery case.
- **One car model everywhere.** `sim/vehicle.js` (dynamic bicycle with Fiala tires and weight transfer above 3 m/s, kinematic below; actuator lag and jerk limit; ABS/stability control; grip `ROAD.mu`) and `controller.applyLaw` drive the ego car, every NPC, every cyclist (`BIKE` spec, no mass, so always kinematic) and every candidate forward sim. A physics change changes predictions, candidate eligibility and test geometry together. Size-dependent code reads `vehicle.spec`, not `CAR`.
- **Grip is global.** `ROAD.mu` is module state set by `setWeather` (`sim/weather.js`), which `new World()` calls. `comfort()` in `vehicle.js` derives cornering/braking targets from it; never hard-code 2.5 m/s^2 style constants. The one exception is black ice's `ROAD.gripAt` hook (below).
- **`Route.project(x, y)` without a hint tracks the ego and updates `route.hint`; with a hint it must not.** Projecting other vehicles or forward sims without a hint corrupts the ego's route position.
- **Obstacles.** `world.obstaclesNear(x, y, r)` returns traffic, parked cars (`sim/parking.js`, spatial grid), pedestrians (`sim/pedestrians.js`) and the feature actors kept out of `world.npcs` (contraflow cyclists, driveway reversers, geese, barricades). Use it, not `world.npcs`, for anything that can be hit.
- **Lane laws treat `vTarget` as a ceiling.** `applyLaw` caps it with `curveProfileSpeed` (`controller.js`, also `target_speed` in `sensors.js`).
- **One step function.** `sim/step.js` `stepWorld` runs the app loop (`main.js`) and the benchmark runner (`bench/runner.js`). The autopilot's `now` is sim time in ms (`world.t * 1000`), never wall time, so replays are exact.
- **Two copies of the sharp-turn rule.** `SHARP_TURN_DEG` in `jev/routing.py` and `SHARP_TURN` in `sim/npc.js` (turns over 130 degrees are U-turns).
- **Two copies of the lane-join logic.** The router rounds the real corner (`_round_corner` / `_blend` in `jev/routing.py`); `joinLanes` in `static/js/map/mapdata.js` mirrors it for NPC paths. Keep them in sync; naive end-to-start joins make right turns back up. `tests/test_parity.py` runs both copies of the sharp-turn rule (including `browserRoute`'s 130° limit in `demo/routing.js`) and of the lane join on `tests/fixtures/parity_cases.json`. A case marked `known_difference` must keep disagreeing, so remove the mark when you bring the two into line.
- **Road surface for driving.** The candidates' off-road rejection and the off-road audit use `surfaceDistance` (`map/junctions.js`): `roadDistance` plus the junction fills the renderer draws, from the one `junctionFills`. Scenery placement keeps `roadDistance`. No parking bay goes where its car would reach more than 0.3 m into the travel lane (`bayIntrusion`, `sim/parking.js`), and no parked car whose jittered body would (`footprintIntrusion`; the bay stays, empty); a left-out bay or car still draws its randoms and uses its car number.
- **Street cross-section.** `map/streets.js` (gutter, curb, boulevard, sidewalk) is shared by the renderer and the pedestrians; crosswalk positions depend on it and on the asphalt width (which includes parking lanes).
- **Emergency vehicles and the car's pull-over** (`sim/emergency.js`, `emergencyYield` in `brain/sensors.js`, `NpcFleet.emergencyStep`). The siren's speed ceiling (`max_speed_mps`) caps every lane candidate, not only `pull_over`; a short pull-over (`steer_at_stop`) finishes its sideways move within its stopping room, in prediction and execution alike (`steerAtStop` in `applyLaw`). Drive-on authorisation is one latch in `World.evCalls`, set by `emergencyLead` and read by sensing and every emergency-yield audit branch: a pull-over, a physically blocking queue or a control-line stop captured when the siren arrived may accept it, a later stop cannot create that exception, and turning never turns an authorised lead into a new crossing call. Traffic's own stop when it gives way (`NpcFleet.yieldStop`) is a physical front-bumper target: the IDM standstill gap is added back, with the following policy on or off, so a vehicle clearing a junction or narrowing gets its planned rear clearance. The emergency audit measures the rear axle, with the pull-over's settling allowance carried over to a target moved left by snowbanks. Traffic waiting for a snowbank narrowing stays in its approach lane, outside the shared corridor. The car stops out of the `EV_BOX_M` junction box the audit measures; beside cars parked close to a narrow lane it pulls over only as far as `parkedRoom` allows, which the audit accepts (with the usual settling allowance); stopped with a vehicle alongside on its right, or at a reversing parker's hold line (`World.parkerQueue`), it is yielding, and released from a queue it has `AUDIT_EV_PULL_S` to pull over. With drive-on authorised, a vehicle alongside still holds the car still. A vehicle that stands down (siren off) leaves its passing controller and drives as ordinary traffic, keeping its passing line until a body forecast (`sweptBodyGap`) lets it merge back.
- **Registered features.** Features in `static/js/sim/features/index.js` (potholes, geese and road closures so far; [feature interface](docs/feature-interface.md)) are one record each (option, World state, seen flag, audit calls, hooks) and one line in `FEATURES`; the core runs each hook at a slot (`SLOTS`) where the feature's code used to run, so order-sensitive pipelines (candidates, rejections, wording, prompt, events, failures) stay exactly as before. Never name a registered feature in the core files; add a hook or slot instead and check `scripts/test_feature_registry.mjs`. The one exception, until puddles move onto the registry, is traffic's puddle check reading the move round a pothole (`laneFx.potholes`, `n.phShift` in `sim/npc.js`; see [feature interface](docs/feature-interface.md)). When moving a feature onto the registry, compare the bare and city suites and every challenge before and after, every field but timings, against one server process or with `PYTHONHASHSEED=0` (route snapping ties depend on the hash seed).
- **Manual input is analog.** `World.stepManual` takes `throttle`, `brake`, `left` and `right` as booleans or amounts from 0 to 1; a boolean must drive exactly as 1 (`scripts/test_gamepad_touch.mjs`). The keyboard, the gamepad (`ui/gamepad.js`) and the touch controls (`ui/touch.js`) combine in `ui/input.js` (`addSource`, `poll` once a frame in `main.js`); new inputs are added as sources, never inside the simulation.
- **Coordinates.** Sim is x east, y north, meters; headings are radians counter-clockwise from +x; `lateral > 0` means right of travel (the right normal is `(sin h, -cos h)`). Three.js is `(x, z, -y)`. In meshes placed with `rotation.y = heading`, local +x is forward and local +z is the right side.
- **Ground rendering order.** Coplanar ground layers (grass, sidewalk, curb, asphalt, markings) are drawn with `depthTest`/`depthWrite` off in fixed `renderOrder` (`LAYER` and `groundLayer()` in `render/scene.js`), sky first; roundabout islands are `islandCurb`/`island`, above asphalt. Speed humps and the like rise above the ground, are depth-tested and drawn after the markings (`render/traffic-calming.js`). Anything placed below y = 0 breaks this. Overlays are transparent and depth-tested so cars hide them.

**Jev prompting.** Jev takes question wording literally; criteria must say *when* an option is correct. Weather, roundabout, cyclist and pedestrian clauses were added on the `sim-realism` branch without a live check. `motion` is only asked when `needsMotionQuestion` holds, and `vector` only with two or more eligible candidates; everything else is answered locally. After changing wording in `state.js`, run `scripts/verify_jev.py`. Keep each question's instructions under 4,000 characters on the city suite and a Jev decision under 5,500 input tokens (`docs/model-results.md`); the server refuses instructions over 6,000 characters (`jev/decide.py`).

**Benchmark** (`static/js/bench/`; [internals](docs/reference/benchmarks.md#benchmark-internals)): pass/fail lives in `failures()`. `decidedBy` fields are reported for every driver but Rules. `features` is `bare` (default, every opt-in feature off) or `city` (`freeDriveOptions` without destination parking, 15:30 Monday, routes keeping to turn restrictions). Every option (`weather`, `--park`, `--hour`, `--without`, `--cover`) defaults to earlier behaviour so earlier records compare. A drive's deadline is its route length at 2.5 m/s (slower in city snow); only a road-closure re-plan (`autopilot.closureRouting`) moves it. Runs go to gitignored `data/runs/` (baselines need `git add -f`). Model recordings (`brain/recording.js`, lockstep only) are committed under `data/recordings/`; with no tape every result is as before.

- **Scores are display-only.** `bench/scores.js` reads saved fields and is never written into results. A formula change bumps `SCORES_VERSION` and updates `docs/rules-baseline.md`.
- **Held-out routes.** Never debug, replay or tune against a held-out route (`bench/heldout.js`, seeds in `HELDOUT_SEEDS`). Record a failure there, reproduce it on a fresh tuned seed and fix it there. Report held-out results apart.
- **Published results are generated.** `data/results.json` and the README block between `<!-- results:start -->` and `<!-- results:end -->` are built by `uv run scripts/build_results.py` from `data/results/<date>/*.json`, `data/recordings/*.json.gz` and the newest `data/runs/*.json` per driver, map, preset and weather. Never edit either by hand; rerun the script after committing a run, a recording or a published result, and when adding a map add its name to `MAP_NAMES` (`tests/test_results.py` checks both). The leaderboard (`static/results.html`, `ui/results.js`, `lab/results.js`) reads the same file through `/api/results`, or `demo-data/results.json` in the demo.

**Challenges** (`lab/challenges/<id>.js`, registry `lab/challenges.js`): one module per challenge, named by its id, exporting `challenge` (the definition) and `scenario(map, challenge)`, and optionally `install(world, fleet, challenge, scenario, at)` (after `installBase` has set `world.challenge`) and `step(world, fleet)` (default `stepAuthored`: `release` once `trigger` holds near `world.challenge.at`). Shared parts live in `lab/challenges/shared/` (`kit.js`: `laneScenario`, `installBase`, `stepAuthored`, oncoming/all-way/through traffic). To add a challenge, write its module, import it in `lab/challenges.js` and put it in `MODULES` in lab order; `scripts/test_challenge_modules.mjs` checks the layout. The registry finds a module by id, then by hazard when a test changes it, so keep hazards distinct unless two lessons share code.

**Challenges, practice, debriefs and road tests** (full rules: [adding a challenge](docs/adding-a-challenge.md#rules-for-practice-debriefs-and-road-tests)). Every verdict (practice progress, debriefs, road test sheets) comes from `challengeFailures` (`lab/practice.js`) and so `failures()`, with parking where required, never the coaching grade. Only the original unchanged manual attempt counts as practice. `ROAD_TESTS` stay out of `CHALLENGES`; `RoadTestObserver` is attached to road test drives alone and only adds incidents, so other reports stay field-for-field identical. Incident replay never seeks a different recording.

### Opt-in features

Every feature in the table follows one pattern. Its reference page has the full description and, under "Agent rules", its detailed rule; read it before touching the feature.

- **Opt-in.** A `World` option (`plows`, `collection`: `NpcFleet`), on in free drives unless `?<flag>=0` (snowbanks only when it snows at the start), and in challenges that set it or place the feature themselves. `freeDriveOptions` (`sim/free-drive.js`) is the one definition of a free drive: add a new feature there, never inline in `main.js` (`scripts/test_free_drive.mjs` checks every `World` option is in it).
- **Off means untouched.** With it off nothing is placed or computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way. On, it draws only from its own random stream.
- **One shared test** decides the situation for sensing, candidates (law and rejection), Rules, the cautious agent, the model wording, traffic and cyclists, the coach and the audit. Never re-derive it in one of them.
- **Audit only once seen.** Its metric reaches the metrics, and fails a drive, only once the feature was met in that drive (`World.<x>Seen`).
- **Render-only parts stay render-only** (lamps, flashes, spray, flinches, jolts).

Names are code identifiers; modules are in `static/js/sim/`; "—" means none of its own.

| Feature | Option | Flag | Module | Shared test | Audit metric | Seen |
|---|---|---|---|---|---|---|
| [Destination parking](docs/reference/parallel-parking.md) | park | park | parallel-park.js | — | challenge parking verdict | — |
| [Hidden hazards](docs/reference/hidden-hazards.md) | hazards (+stepOuts) | hazards | hidden-hazards.js, hidden-traffic.js, blind-spot.js | World.sees | — | — |
| [Snow plows](docs/reference/snow-plows.md) | plows (fleet) | plows | snow-plow.js | — | plow_right_passes | plowsSeen |
| [Lane closures](docs/reference/lane-closures.md) | closures | closures | lane-closure.js | — | merge_cut_ins | closuresSeen |
| [Passing cyclists](docs/reference/passing-cyclists.md) | passCyclists | cyclistpass | cyclist-pass.js | — | close_passes | option on |
| [Bus lanes](docs/reference/bus-lanes.md) | busLanes | buslanes | bus-lanes.js | busLanePolicy | bus_lane_driving | busLanesSeen |
| [Traffic calming](docs/reference/traffic-calming.md) | calming | calming | traffic-calming.js | — | hump_hits | calmingSeen |
| [Scramble crossings](docs/reference/scrambles.md) | scrambles | scramble | signals.js | isScramble | — | — |
| [Garbage trucks](docs/reference/collection-day.md) | collection (fleet) | collection | collection-truck.js | crewInRoad | crew_close_passes | collectionSeen |
| [Crossing guards](docs/reference/crossing-guards.md) | guards | guards | crossing-guard.js | — | guard_violations | guardsSeen |
| [Pedestrian crossovers](docs/reference/pedestrian-crossovers.md) | pxo | pxo | pxo.js | — | pxo_early_goes | pxoSeen |
| [High beams](docs/reference/high-beams.md) | highBeams | highbeams | high-beams.js | — | glare_seconds | highBeamsSeen |
| [Turn restrictions](docs/reference/turn-restrictions.md) | restrictions | restrictions | turn-restrictions.js | — | illegal_turns | restrictionsSeen |
| [Overnight flashing](docs/reference/night-flash.md) | nightFlash | nightflash | night-flash.js | — | stop_signs_run, failed_to_yield | nightFlashSeen |
| [Contraflow cyclists](docs/reference/contraflow-cyclists.md) | contraflow | contraflow | contraflow.js | riderConflict | contraflow_conflicts | contraflowSeen |
| [Left on red](docs/reference/left-on-red.md) | leftOnRed | leftonred | left-on-red.js | — | — | leftOnRedSeen |
| [Red-turn signs](docs/reference/red-turn-signs.md) | redTurnSigns | redturnsigns | red-turn-signs.js | — | — | — |
| [Amber lights](docs/reference/amber-lights.md) | amberLights | amberlights | amber.js | — | amber_lights_run | amberLightsSeen |
| [Following distance](docs/reference/following-distance.md) | followingDistance | followingdistance | following.js | — | — | — |
| [Red-light runners](docs/reference/red-light-runners.md) | redRunners | redrunners | red-light-runner.js | runnerThreat | fresh_green_conflicts | redRunnersSeen |
| [Sun glare](docs/reference/sun-glare.md) | sunGlare | sunglare | sun-glare.js | glareFor, glareCeiling | glare_speeding_seconds | sunGlareSeen |
| [Driveway reversers](docs/reference/driveway-reversers.md) | driveways | driveways | driveway-reversers.js | reverserConflict | reversing_conflicts | drivewaysSeen |
| [Potholes](docs/reference/potholes.md) | potholes | potholes | potholes.js | safeSpeed, wheelRoom | pothole_hits | potholesSeen |
| [Ball, then a child](docs/reference/ball-chase.md) | balls | balls | ball-chase.js | ballCover | ball_warnings_ignored | ballsSeen |
| [Geese](docs/reference/geese.md) | geese | geese | geese.js | geeseConflict | wildlife_conflicts | geeseSeen |
| [Tailgaters](docs/reference/tailgaters.md) | tailgaters | tailgaters | tailgaters.js | tailgaterThreat | brake_checks | tailgatersSeen |
| [Black ice](docs/reference/black-ice.md) | ice | ice | black-ice.js | safeSpeed, easeToward, iceLimit | ice_overspeed | iceSeen |
| [Snowbanks](docs/reference/snowbanks.md) | snowbanks | snowbanks | snowbanks.js | narrowingTurn | snowbank_conflicts | snowbanksSeen |
| [Puddles](docs/reference/puddles.md) | puddles | puddles | puddles.js | splashRisk | pedestrians_splashed | puddlesSeen |
| [Traffic parking](docs/reference/parkers.md) | parkers | parkers | parkers.js | parkerConflict | parking_conflicts | parkersSeen |
| [Road closures](docs/reference/road-closures.md) | roadClosures | roadclosures | road-closures.js | closureAhead | closure_entries | roadClosuresSeen |
| [Police officers](docs/reference/traffic-officers.md) | officers | officers | traffic-officer.js | officerDirection | officer_violations | officersSeen |

Where features reach into shared code:
- **Black ice is the one place grip varies.** The car model reads local grip only through `ROAD.gripAt`. Every `World` sets the hook, null without ice, and with it null vehicle stepping stays bit for bit as before: branch on it, never multiply by 1. `comfort()` stays global; `hard_brake` and the shared emergency brake are never eased.
- **Signals.** Scrambles (`setScrambles`; `planOf` picks `scramblePlan` only while on) and overnight flashing (`setNightFlash`, reset by each World and replay restore) are module state in `sim/signals.js`. Flashing suppresses advance greens, scrambles and right-on-red; outages take precedence.
- **The clock.** Time-dependent features read `world.clock` (`hour`; `weekday`, Monday = 0 the default; `day`, `utc_offset` only when present; free drives' clock has no `day`). Without a clock no bus lane is in effect and no signal flashes.
- **Routing.** Red-turn bans never feed ordinary routing restrictions. An empty or missing `avoid` (road closures) must leave every route exactly as before; lockstep evaluation awaits `autopilot.closureRouting`. Left-on-red city bounds fail closed; extend them only after checking provincial law.
- **Parking.** Every parking branch leaves the `parkAtGoal` false path exactly as it was; `planSpace`'s `anywhere` only skips the destination checks; traffic keeps back from a car parking ahead through `World.parkHold`.
- The driven car has no `id`; closures and officers call it `EGO_ID` ("ego"). Without `passCyclists`, candidates keep the 1 m `passes_cyclist_too_close` rejection. Compact trace folding must compare beam choices.

## Gotchas

- Editing a Python file with an in-place substitution that keeps the file size, inside the same second, can leave a stale `__pycache__/*.pyc` that Python still trusts. Delete `__pycache__` if a change seems to have no effect.
- NPC colors and car body styles are render-only. Nothing in sim or brain reads them.
- In Node tests, never pass sim objects (World, Route, MapData, vehicles) to `assert`; assert on primitives such as ids, counts and booleans. A failing assert on one makes Node print the whole object graph, which has used 70–200 GB of memory on a 16 GB Mac, and `--max-old-space-size` does not stop it. Run heavy checks one at a time; the full Playwright suites run in CI.
- Node test scripts that build an `Autopilot` never exit on their own; end them with `process.exit(0)`. Run `scripts/test_*.mjs` with Node 22, as CI does; Node 24 rejects `--experimental-default-type`.
- CI (`.github/workflows/demo.yml`, on Namespace runners) runs `scripts/test_*.mjs` in the shards `scripts/ci_shard.mjs` plans from `scripts/ci_test_times.json`, and stops any that runs longer than `NODE_TEST_TIMEOUT` (360 s; the slowest, `test_drive_lab.mjs`, takes about two minutes). Add a new check's measured seconds to the times file (unlisted files count as the median), and change the shard count in both the matrix and the `--shards` argument; `scripts/test_ci_shard.mjs` checks they match. Split a check rather than raise the limit far.
- `window.__bench.run` saves to `data/runs/` unless you pass `save: false`. For before/after benchmarks, check that the before tree really matches its commit (`diff -r` against a fresh `git archive`) and that its results reproduce the previous record; WebKit can expose timing bugs V8 misses.
- Saved arena runs are kept in IndexedDB (`openEvaluationHistory` in `static/js/lab/history.js`): the newest `MAX_SAVED_RUNS` (20) within `MAX_SAVED_BYTES` (200 MB), the oldest evicted first and on a `QuotaExceededError`. The 9 MB `MAX_HISTORY_BYTES` cap applies only to the localStorage fallback (no IndexedDB: some private windows, blocked storage, Node), which keeps 10 runs; the history store is async, checked by `scripts/test_arena_storage.mjs` with a fake IndexedDB. Two runs of every challenge with Rules and the cautious agent took 78.3% of the fallback cap on 2026-11-09, and each new challenge adds about 1–2%. Measure again after adding a challenge or more to each decision record ([how, and the per-challenge figures](docs/adding-a-challenge.md#arena-storage)).
- After changing candidates or sensing, rerun `scripts/build_jev_fixtures.mjs --check` (see [development](docs/reference/development.md)).
- The committed model recording `data/recordings/stub-llm-kitsilano-s1.json` (a stub model, not a real one) replays a whole drive, so a change to physics, traffic, sensing, candidates, the decision state, the LLM prompt or a drive result's fields makes `scripts/test_model_recording.mjs` fail. If the change is intended, rewrite it with that script's `--write`. Model recordings replay exactly only on the JavaScript engine they were made on (see "Record a model run" in `docs/agents.md`).
- Keep benchmark worktrees out of `/tmp`.
- Live model runs: parallel runs against one server share its `JEV_FSD_RPM` limit, and calls over it fall back to Rules with a local 429 (spoiling the run); give each run its own server or raise the limit. Check the provider's own bill (OpenRouter: `GET /api/v1/key`) during a run, and ask before spending past the agreed budget.
- `tests/test_doc_links.py` checks every relative link and anchor in `README.md`, `AGENTS.md`, `ROADMAP.md` and `docs/`; run it after moving or renaming a heading.

## Decisions

- Ask before adding any dependency, tool or service.
- New maps are Canadian cities. LLM drivers use a generic OpenAI-compatible endpoint. A Claude brain is deferred; keep the brain interface open for it.

## Context maintenance

- The plan is `ROADMAP.md`. Read it before proposing what to build next, and update it when an
  item lands or a priority changes.
- Keep project rules and durable project knowledge in tracked `AGENTS.md` and
  repository docs; do not store them in agent auto-memory or machine-local notes.
- `CLAUDE.md` contains only `@AGENTS.md`. Shared hooks, scripts and settings
  belong in tracked files. Do not ignore instruction files or shared settings;
  ignore only machine-local settings and agent worktrees.
