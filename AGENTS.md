# Agent instructions

## Commands

No build step and no linter are configured. Python runs through `uv` (one dependency, `typesafe-sdk`); the browser app is plain ES modules with Three.js from a CDN import map.

```sh
uv run server.py                                            # serves http://127.0.0.1:8322 (PORT to change)
uv run python -m unittest discover -s tests                 # offline Python tests
uv run python -m unittest discover -s tests -p "test_routing.py"          # one file
uv run python -m unittest discover -s tests -k test_route_never_backs_up  # one test
uv run scripts/fetch_map.py [bbox|preset] [--force]         # build/rebuild a map pack
uv run scripts/verify_jev.py                                # live: data/snapshots/*.json against the real model (costs credits)
```

`python -m unittest tests.test_x` fails: `tests/helpers.py` fixes `sys.path`, so always use `discover -s tests`.

Browser-side checks need the server running:
- `/tests`: browser unit tests (car model, controller, collisions, candidates, state). Use `/tests`, not `/tests/run.html`: only pages listed in `PAGES` in `server.py` get the session token injected, and every API call without it gets a 403.
- `/bench`: closed-loop benchmark. Lockstep plus the Rules brain is deterministic, so rerun suite seed 1 and compare with the newest committed baseline in `data/runs/` after any change to physics, traffic, planner, or router.

Headless (macOS): `swift scripts/shot.swift URL OUT.png [wait] [post_js] [pre_js] [settle] [timeout]` screenshots a page in an offscreen WKWebView and runs JS. The page is usually `visibilityState: hidden`, so `requestAnimationFrame` never fires. Step the app with `window.__jev.advance(seconds)`, and run the benchmark with `await window.__bench.run({ brain, count, seed, save })`. The default timeout is `settle + wait + 30` s, so pass the 7th argument for long runs. `uv` and the server need to run outside a sandbox: uv writes to `~/.cache/uv` and the server binds a port.

## Architecture

**Split of responsibilities.** Python (`server.py`, `jev/`) builds the map pack from OpenStreetMap, plans routes, and proxies decisions to TypeSafe (the API key never reaches the browser). Everything that moves (physics, traffic, sensing, planning, rendering) runs in the browser under `static/js/`. The server is loopback-only with CSRF defences (`jev/security.py`); state-changing requests need the `X-Jev-Token` header that `common.js` sends.

**Map pack pipeline** (`jev/osm/`): fetch → parse → project to meters → road graph (directed edges, lanes offset right of the centerline, parking lanes widen `asphalt`, roundabout rings pushed out to a drivable radius) → controls (signals, stops, roundabout yields; `s_line` set back behind the crosswalk) → buildings → `data/maps/<key>.v<PACK_VERSION>.pack.json`. Packs are cached and committed. If the pipeline output changes:
- bump `PACK_VERSION` in `jev/osm/pack.py` and the version assertion in `tests/test_osm.py`;
- rebuild the Kitsilano pack and replace the old pack file with it;
- restart the server, which caches packs in memory.

**One decision cycle** (`static/js/brain/brain.js`, `Autopilot`): `sensors.buildSnapshot` → `candidates.sampleCandidates` → `simulateAll` (3 s forward sims) → `state.toJevState` + `buildQuestions` → brain → `apply`. The only difference between the Jev and Rules brains is the "brain" step: `rules.js` scores the surviving candidates; `jev.js` posts to `/api/decide`. Timeouts and invalid answers fall back to Rules and increment `world.violations.fallbacks`.

**Invariants that span files:**
- **One car model everywhere.** `sim/vehicle.js` (dynamic bicycle with Fiala tires and weight transfer above 3 m/s, kinematic below; actuator lag and jerk limit; ABS/stability control; grip `ROAD.mu`) and `controller.applyLaw` drive the ego car, every NPC, every cyclist (`BIKE` spec, no mass, so always kinematic), and every candidate forward sim. A physics change changes predictions, candidate eligibility, and test geometry together. Size-dependent code must read `vehicle.spec`, not `CAR`.
- **Grip is global.** `ROAD.mu` is module state set by `setWeather` (`sim/weather.js`), which `new World()` calls. `comfort()` in `vehicle.js` derives cornering/braking targets from it; never hard-code 2.5 m/s^2 style constants again.
- **`Route.project(x, y)` without a hint tracks the ego and updates `route.hint`; with a hint it must not.** Projecting other vehicles or forward sims without a hint corrupts the ego's route position.
- **Obstacles.** `world.obstaclesNear(x, y, r)` returns traffic, parked cars (`sim/parking.js`, spatial grid) and pedestrians (`sim/pedestrians.js`). Use it rather than `world.npcs` for anything that can be hit.
- **Lane laws treat `vTarget` as a ceiling.** `applyLaw` caps it with `curveProfileSpeed` (in `controller.js`, also used for `target_speed` in `sensors.js`).
- **One step function.** `sim/step.js` `stepWorld` is used by both the app loop (`main.js`) and the benchmark runner (`bench/runner.js`). The autopilot's `now` is sim time in ms (`world.t * 1000`), not wall time, and must stay that way for replays to be exact.
- **Two copies of the sharp-turn rule.** `SHARP_TURN_DEG` in `jev/routing.py` and `SHARP_TURN` in `sim/npc.js` (turns over 130 degrees are U-turns).
- **Street cross-section.** `map/streets.js` (gutter, curb, boulevard, sidewalk) is shared by the renderer and the pedestrians; crosswalk positions depend on it and on the asphalt width (which includes parking lanes).
- **Two copies of the lane-join logic.** The router joins lane polylines by rounding the real corner (`_round_corner` / `_blend` in `jev/routing.py`); `joinLanes` in `static/js/map/mapdata.js` mirrors it for NPC paths. Keep them in sync. Naive end-to-start joins make right turns back up.
- **Parking is opt-in.** `World` option `park` (free drives, unless `?park=0`; challenges with `park: true`) makes the autopilot parallel park at the destination and pull out again at the start of the next drive (`sim/parallel-park.js`, `World.park`/`parking`/`parkedIn`). The seeded benchmark and the other challenges never park, so every parking branch must leave the `parkAtGoal` false path exactly as it was. Traffic keeps back from a car parking ahead of it through `World.parkHold` (`sim/npc.js`).
- **Hidden hazards are opt-in.** `World` option `hazards` (free drives, unless `?hazards=0`; challenges with `hidden: true`) makes vehicles standing at the kerb hide pedestrians (`World.sees`), makes road vehicles hide other vehicles and cyclists, with the car waiting to see along the lanes it gives way to (`sim/hidden-traffic.js`), turns on the driven car's blind-spot speed (`blind_spot` in sensing, `sim/blind-spot.js`), and with `stepOuts` lets people step out from between parked cars. With it off nothing is computed and no random stream is drawn from, so the seeded benchmark and the other challenges play out exactly as before; keep it that way.
- **Coordinates.** Sim is x east, y north, meters; headings are radians counter-clockwise from +x; `lateral > 0` means right of travel (the right normal is `(sin h, -cos h)`). Three.js is `(x, z, -y)`. In meshes placed with `rotation.y = heading`, local +x is forward and local +z is the right side.
- **Ground rendering order.** Coplanar ground layers (grass, sidewalk, curb, asphalt, markings) are drawn with `depthTest`/`depthWrite` off in fixed `renderOrder` (`LAYER` and `groundLayer()` in `render/scene.js`), with the sky first; roundabout islands are `islandCurb`/`island`, above asphalt. Anything placed below y = 0 breaks this. Overlays are transparent and depth-tested so cars hide them.

**Jev prompting.** Jev takes question wording literally; criteria must say *when* an option is correct. Weather, roundabout, cyclist, and pedestrian clauses were added on the `sim-realism` branch without a live check. `motion` is only asked when `needsMotionQuestion` holds, and `vector` only with two or more eligible candidates; everything else is answered locally. After changing wording in `state.js`, run `scripts/verify_jev.py`.

**Benchmark** (`static/js/bench/`): `scenarios.buildSuite` (seeded, routes via `/api/route`), `runner.runScenario` / `setupScenario` (also used by the app's `/?replay=1`), and `metrics.DriveMetrics`. Pass/fail rules live in `failures()` (collisions, red lights, stop signs, failures to yield, off road). Bench runs take a `weather` option. Runs are stored by `server.py` under `data/runs/`, which is gitignored, so a baseline has to be added with `git add -f`.

## Gotchas

- Editing a Python file with an in-place substitution that keeps the file size, inside the same second, can leave a stale `__pycache__/*.pyc` that Python still trusts. Delete `__pycache__` if a change seems to have no effect.
- NPC colors and car body styles are render-only. Nothing in sim or brain reads them.
- In Node tests, never pass sim objects (World, Route, MapData, vehicles) to `assert`; assert on primitives such as ids, counts and booleans. A failing assert on one makes Node print the whole object graph, which has used 70–200 GB of memory on a 16 GB Mac, and `--max-old-space-size` does not stop it. Run heavy checks one at a time; the full Playwright suites run in CI.
- Node test scripts that build an `Autopilot` never exit on their own; end them with `process.exit(0)`. Run `scripts/test_*.mjs` with Node 22, as CI does; Node 24 rejects `--experimental-default-type`.
- `window.__bench.run` saves to `data/runs/` unless you pass `save: false`. For before/after benchmarks, check that the before tree really matches its commit (`diff -r` against a fresh `git archive`) and that its results reproduce the previous record; WebKit can expose timing bugs V8 misses.
- Saved arena runs count against the 9 MB `MAX_HISTORY_BYTES` cap in `static/js/lab/history.js`. Since compact decisions are folded together (`static/js/lab/trace.js`), two runs of every challenge with Rules and the cautious agent, measured in Node (2026-11-01), take 38.8% with 27 challenges ("Blind left" adds 2.0%; 98.2% with 26 before folding). Measure again after adding a challenge or more to each decision record.
- After changing candidates or sensing, rerun `scripts/build_jev_fixtures.mjs --check` (see `docs/project-reference.md`).
- Keep benchmark worktrees out of `/tmp`.

## Decisions

- Ask before adding any dependency, tool or service.
- New maps are Canadian cities. LLM drivers use a generic OpenAI-compatible endpoint. A Claude brain is deferred; keep the brain interface open for it.

## Context maintenance

- Keep project rules and durable project knowledge in tracked `AGENTS.md` and
  repository docs; do not store them in agent auto-memory or machine-local notes.
- `CLAUDE.md` contains only `@AGENTS.md`. Shared hooks, scripts and settings
  belong in tracked files. Do not ignore instruction files or shared settings;
  ignore only machine-local settings and agent worktrees.
