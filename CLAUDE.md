# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `/bench`: closed-loop benchmark. Lockstep plus the Rules brain is deterministic, so rerun suite seed 1 and compare with the committed baseline `data/runs/20260923-185357-rules.json` after any change to physics, traffic, planner, or router.

Headless (macOS): `swift scripts/shot.swift URL OUT.png [wait] [post_js] [pre_js] [settle] [timeout]` screenshots a page in an offscreen WKWebView and runs JS. The page is usually `visibilityState: hidden`, so `requestAnimationFrame` never fires. Step the app with `window.__jev.advance(seconds)`, and run the benchmark with `await window.__bench.run({ brain, count, seed, save })`. The default timeout is `settle + wait + 30` s, so pass the 7th argument for long runs. `uv` and the server need to run outside a sandbox: uv writes to `~/.cache/uv` and the server binds a port.

## Architecture

**Split of responsibilities.** Python (`server.py`, `jev/`) builds the map pack from OpenStreetMap, plans routes, and proxies decisions to TypeSafe (the API key never reaches the browser). Everything that moves (physics, traffic, sensing, planning, rendering) runs in the browser under `static/js/`. The server is loopback-only with CSRF defences (`jev/security.py`); state-changing requests need the `X-Jev-Token` header that `common.js` sends.

**Map pack pipeline** (`jev/osm/`): fetch → parse → project to meters → road graph (directed edges, lanes offset right of the centerline) → controls (signals and stops, stop line `s_line` set back past the crossing road's curb) → buildings → `data/maps/<key>.v<PACK_VERSION>.pack.json`. Packs are cached and committed. If the pipeline output changes:
- bump `PACK_VERSION` in `jev/osm/pack.py` and the version assertion in `tests/test_osm.py`;
- rebuild the Kitsilano pack and commit it in place of the old file;
- restart the server, which caches packs in memory.

**One decision cycle** (`static/js/brain/brain.js`, `Autopilot`): `sensors.buildSnapshot` → `candidates.sampleCandidates` → `simulateAll` (3 s forward sims) → `state.toJevState` + `buildQuestions` → brain → `apply`. The only difference between the Jev and Rules brains is the "brain" step: `rules.js` scores the surviving candidates; `jev.js` posts to `/api/decide`. Timeouts and invalid answers fall back to Rules and increment `world.violations.fallbacks`.

**Invariants that span files:**
- **One car model everywhere.** `sim/vehicle.js` (kinematic bicycle, actuator lag and jerk limit, friction circle via `ROAD.mu`) and `controller.applyLaw` drive the ego car, every NPC, and every candidate forward sim. A physics change changes predictions, candidate eligibility, and test geometry together.
- **Lane laws treat `vTarget` as a ceiling.** `applyLaw` caps it with `curveProfileSpeed` (in `controller.js`, also used for `target_speed` in `sensors.js`).
- **One step function.** `sim/step.js` `stepWorld` is used by both the app loop (`main.js`) and the benchmark runner (`bench/runner.js`). The autopilot's `now` is sim time in ms (`world.t * 1000`), not wall time, and must stay that way for replays to be exact.
- **Two copies of the lane-join logic.** The router joins lane polylines by rounding the real corner (`_round_corner` / `_blend` in `jev/routing.py`); `joinLanes` in `static/js/map/mapdata.js` mirrors it for NPC paths. Keep them in sync. Naive end-to-start joins make right turns back up.
- **Coordinates.** Sim is x east, y north, meters; headings are radians counter-clockwise from +x; `lateral > 0` means right of travel (the right normal is `(sin h, -cos h)`). Three.js is `(x, z, -y)`. In meshes placed with `rotation.y = heading`, local +x is forward and local +z is the right side.
- **Ground rendering order.** Coplanar ground layers (grass, sidewalk, curb, asphalt, markings) are drawn with `depthTest`/`depthWrite` off in fixed `renderOrder` (`LAYER` and `groundLayer()` in `render/scene.js`), with the sky first. Anything placed below y = 0 breaks this. Overlays are transparent and depth-tested so cars hide them.

**Jev prompting.** Jev takes question wording literally; criteria must say *when* an option is correct. `motion` is only asked when `needsMotionQuestion` holds, and `vector` only with two or more eligible candidates; everything else is answered locally. After changing wording in `state.js`, run `scripts/verify_jev.py`.

**Benchmark** (`static/js/bench/`): `scenarios.buildSuite` (seeded, routes via `/api/route`), `runner.runScenario` / `setupScenario` (also used by the app's `/?replay=1`), and `metrics.DriveMetrics`. Pass/fail rules live in `failures()`. Runs are stored by `server.py` under `data/runs/`, which is gitignored; commit a baseline on purpose with `git add -f`.

## Gotchas

- Editing a Python file with an in-place substitution that keeps the file size, inside the same second, can leave a stale `__pycache__/*.pyc` that Python still trusts. Delete `__pycache__` if a change seems to have no effect.
- NPC colors and car body styles are render-only. Nothing in sim or brain reads them.
