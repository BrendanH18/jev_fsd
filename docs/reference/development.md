# Development

```sh
uv run python -m unittest discover tests
node --experimental-default-type=module scripts/test_drive_score.mjs
node --experimental-default-type=module scripts/test_drive_controls.mjs
node --experimental-default-type=module scripts/test_replay.mjs
node --experimental-default-type=module scripts/test_interpolate.mjs
node --experimental-default-type=module scripts/test_orbit_camera.mjs
node --experimental-default-type=module scripts/test_cinematic_photo.mjs
node --experimental-default-type=module scripts/test_static_collision.mjs
node --experimental-default-type=module scripts/test_scenery_collision.mjs
node --experimental-default-type=module scripts/test_route_controls.mjs
node --experimental-default-type=module scripts/test_world_conditions.mjs
node --experimental-default-type=module scripts/test_vehicle_models.mjs
node --experimental-default-type=module scripts/test_llm_agent.mjs
node --experimental-default-type=module scripts/test_decision_agent.mjs
node --experimental-default-type=module scripts/test_lane_change.mjs
node --experimental-default-type=module scripts/test_pull_out.mjs
node --experimental-default-type=module scripts/test_left_turn.mjs
node --experimental-default-type=module scripts/test_right_on_red.mjs
node --experimental-default-type=module scripts/test_all_way_stop.mjs
node --experimental-default-type=module scripts/test_give_way.mjs
node --experimental-default-type=module scripts/test_right_hook.mjs
node --experimental-default-type=module scripts/test_speed_zones.mjs
node --experimental-default-type=module scripts/test_roadside.mjs
node --experimental-default-type=module scripts/test_streetcars.mjs
node --experimental-default-type=module scripts/test_level_crossings.mjs
node --experimental-default-type=module scripts/test_junction_box.mjs
node --experimental-default-type=module scripts/test_advance_green.mjs
node --experimental-default-type=module scripts/test_work_zones.mjs
node --experimental-default-type=module scripts/test_outages.mjs
node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check
uv run scripts/verify_jev.py --offline
```

With a running app, `uv run --with playwright python scripts/test_browser_pages.py` runs the `/tests`
page, the renderer assertions, a check that the pilot controls fit the HUD panel, and the practice finish, debrief replay and error recovery cases in headless Chromium (`--group pages`, `practice` or `parking` runs one part, as CI does), and `scripts/test_arena_browser.py` runs the
arena workflow (install the browser once with `uv run --with playwright python -m playwright install chromium`).
CI runs all of the above on every pull request. Agents run them through
[Boat checks](#boat-checks).

## Boat checks

Agents run these checks in a [Boat](https://boat.dev) sandbox, not on the owner's computers.
`scripts/boat-check.sh` needs the signed-in `boat` CLI, `jq` and git.

```sh
scripts/boat-check.sh            # lint, Python tests, offline Jev requests, fixture check
scripts/boat-check.sh --full     # also every scripts/test_*.mjs, in parallel, 360 s each as in CI
scripts/boat-check.sh -- uv run --locked python -m unittest discover -s tests -k test_route_never_backs_up
scripts/boat-check.sh --save     # rebuild the warm snapshot jev-fsd-warm from origin's default branch
scripts/boat-check.sh --status   # this worktree's sandbox
scripts/boat-check.sh --done     # delete it when the work ends (--stop keeps it)
```

The account's daily sandbox starts (840 on the $100 plan) are shared by every project, and each
create or resume uses one, so the script keeps one long-lived sandbox per worktree. The first
check creates it from the saved snapshot `jev-fsd-warm` (`JEV_BOAT_SNAPSHOT`), or bare when
there is none, with `--no-env`, so no GitHub token, agent logins or model keys go in and no check
can spend credits. Creates and resumes pass `--fail-fast`: when Boat has
no machine ready, nothing starts and no start is counted, and the script tries again every 10
seconds for about a minute. The sandbox id is kept in the worktree's git directory, and later checks
reuse that sandbox. Agents sharing a worktree each set their own `JEV_BOAT_SLOT`; one sandbox
is never shared between agents.

Each check pushes the working tree (tracked and untracked, non-ignored files) to a fresh
directory and moves it into the clone at `/home/user/jev_fsd`. Everything there but `.git`,
`node_modules` and `.venv` is replaced, so deleted files go too, and git's index is rebuilt from
the pushed files, so `git ls-files` (which `tests/test_results.py` relies on) matches the
computer the script ran on. `npm ci` runs only when `package-lock.json` changed, then
`uv sync --locked`. The command runs with `boat exec --timeout 0`. A bare sandbox first installs
Node 22 (checked against the release's SHA-256 sums), uv and the clone. Copy results such as
`data/runs/` back before the next check replaces them.

Boat's auto-stop is a deadline, not an idle timer. While a check runs, the script keeps it two
hours ahead (renewed every 30 minutes, so a long check is never cut off). When the check ends,
an `xlarge` sandbox is stopped at once and a smaller one gets an auto-stop 15 minutes ahead
(`JEV_BOAT_IDLE` seconds; 0 stops at once), so a forgotten sandbox stops itself and the next
check resumes it. Starts only happen on a create or a resume; a check against a running sandbox
uses none. A resume that finds no machine ready can leave Boat finishing it for a while, so the
script also retries "resume already in progress". When no starts are left, the script stops with
exit code 3 and the message from Boat.

### Sizes and parallel checks

Owner decision (2026-11-21): `--full` runs on `xlarge` (16 vCPUs, 32 GB) with one Node check per
vCPU, and the plain check and `-- CMD` run on `default` (4 vCPUs, 8 GB). The size is chosen per
run (`JEV_BOAT_TYPE` overrides it for every mode): a sandbox of the other size is stopped and
resumed at this run's size, which uses one start. Idle time follows the size, because an idle
`xlarge` bills about 5.6 times `default`: `xlarge` stops as soon as its check ends, and `default`
and `large` stay up 15 minutes for back-to-back checks.

`--full` runs the lint, offline Jev requests and fixture check first, then the Python tests
alongside `scripts/node_checks.mjs`: a pool of `JEV_BOAT_JOBS` workers (default `nproc`) that
takes the `scripts/test_*.mjs` files longest first by `scripts/ci_test_times.json`, runs each in
its own Node process with CI's 360 s limit (killing its process group on a timeout), prints a
line per file and the output of each failing one, and ends with a summary and the failed files.
It exits 1 when any file fails. `scripts/test_node_checks.mjs` checks it. CI's sharding is
unchanged.

No check needed to run alone: none listens on a port, shares a temporary file or reads wall time,
and every file passed in all twelve parallel runs (those below and the sizing experiments,
three to six at each size), as it did in the sequential run. Running together does slow each file 1.3 to 2.2 times (memory and cache, not CPU
quota: a pure CPU loop scales to 16 jobs). Boat places a size on different hardware from run to
run; on an AMD EPYC 8224P host an `xlarge` core ran the checks at half the speed of the others,
and on an EPYC 4585PX host sixteen checks at once ran each four to five times slower than alone.

`scripts/test_drive_lab.mjs` was the critical path (96 s alone, up to 235 s in a full pool), so
its arena drives (every challenge with Rules and the cautious agent) now run on four worker
threads (`scripts/drive_lab_arena.mjs`): 102 s down to 32 s alone, with the same drives (every
result field but the wall-clock `wall_ms` and `report.started_at`). The Python tests went from
72 s to 25 s once `scripts/build_results.py` cached what it reads from the model recordings
(`tests/test_results.py` builds the results many times).

Measured 2026-11-21 with no other load; cost from `boat usage` for the run's window:

| Run | Size (CPU) | Whole run | Node checks | Cost |
|---|---|---|---|---|
| Plain, before | `default` (Ryzen 9 9950X) | 105 s (25 s push, 72 s Python) | — | — |
| Plain, after | `default` (Ryzen 7 9700X) | 54 s reusing, 93 s with a resume (25 s Python) | — | — |
| `--full`, one at a time | `default` (Ryzen 9 9950X) | 743 s | about 650 s | — |
| `--full`, before the drive lab split | `default` (Ryzen 9 9950X), 4 jobs | 297 s, 278 s | 280 s, 266 s | — |
| | `large` (EPYC 9455), 8 jobs | 193 s | 158 s | — |
| | `xlarge` (EPYC 8224P), 16 jobs | 264 s | 236 s (210 s with 8 jobs) | — |
| `--full`, after | `default` (Ryzen 7 9700X), 4 jobs | 356 s | 301 s | $0.003 |
| | `large` (EPYC 9455), 8 jobs | 155 s, 153 s | 144 s, 143 s | $0.004 |
| | `xlarge` (EPYC 9455), 16 jobs | 101 s, 117 s | 72 s, 92 s | $0.005–0.006 |
| | `xlarge` (EPYC 4585PX), 16 jobs | 202 s | 169 s | $0.011 |

`xlarge` gives the shortest wait (from 72 to 169 s of Node checks, depending on the host) at
about a cent per `--full` and stops straight afterwards, while 15 idle minutes on `large` would cost $0.018. The plain check is single-threaded Python and
gains nothing from cores, so it stays on `default`. The `--full` runs above include about 10 to 25
s of pushing the working tree, and a size change adds the resume (12 to 56 s, longer when Boat has
no machine ready).

`--save` builds `jev-fsd-warm` in a fresh bare sandbox that runs no worktree code: it installs
the toolchain, checks out `origin`'s default branch, installs its dependencies, saves the
sandbox, waits until Boat reports that save ready and deletes the sandbox. Nothing a check or a
custom command changed on a check sandbox reaches the snapshot. It uses one start. Refresh it
after a change to the Node version, `uv.lock` or `package-lock.json` reaches the default branch.
The script refuses a live `scripts/verify_jev.py` run; `--offline` is fine.

Live, paid runs (recordings, and arena, benchmark or `verify_jev.py` runs that call a model)
never use the check sandbox. When the owner asks for one, it gets its own sandbox from the Boat
environment `jev-fsd-live`, which injects only `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY`
(no GitHub, agent or Boat credentials), and the sandbox is deleted afterwards:

```sh
id=$(boat new --environment jev-fsd-live --name jev-fsd-live-city-pilot --json | jq -r 'select(.event=="ready") | .id')
# ... the run, then copy results back ...
boat delete "$id" --yes
```

Keys are never read from `.env` or passed on the command line.

Open [/tests](http://127.0.0.1:8322/tests) for simulation and HUD checks. From the simulator's browser
console, run the WebGL renderer checks:

```js
const { runRenderTests } = await import('/tests/render-tests.js');
runRenderTests(); // Every result should have ok: true.
```

The documented validation covers 160 Python tests (68 for LLM endpoints and their setup against a local mock
OpenAI-compatible server, and 25 for decision-model endpoints and their setup against a local mock System One
server, both with temporary files; no real provider is tested), 146 browser assertions (99 simulation, 27 HUD and 20 explorer),
106 renderer assertions, one HUD layout check, 19 scoring tests, 13 building collision regressions, 17 scenery collision regressions,
22 vehicle model regressions, 15 LLM agent checks, 14 decision agent checks, six route-control regressions,
world-condition and interpolation checks, and 20 offline Jev requests.
Renderer checks include actual front/rear sign rasterization and wet frames across quality
transitions. HUD checks cover fallback and stop labels, the three pillar buttons and an unavailable
Decision button, keyboard driver selection, probability rows, telemetry reset and the 10 Hz update bound. See
[HUD validation and viewport-review limits](../drive-experience.md#validation) and
[rendering performance](../render-performance.md) for DOM measurements and GPU profiling.

Run a seeded Rules benchmark after changing physics, traffic, planning or routing. Rebuild
committed Jev cases with `scripts/build_jev_fixtures.mjs` after changing sensing or question
wording. Live verification (`uv run scripts/verify_jev.py`) requires an API key and spends
credits. The fixtures are generated by the real production pipeline.

| Path | Contents |
|---|---|
| `server.py`, `jev/` | Local server, TypeSafe client, decision-model and LLM endpoint proxies, spend guard, OSM processing and routing |
| `static/js/sim/` | Physics, traffic, collisions, signals, parking, pedestrians and sensing |
| `static/js/brain/` | Candidates, Jev questions, drivers (Rules, decision models, LLMs) and safety brake |
| `static/js/ui/` | City explorer, drive reports, cockpit and driving audio |
| `static/js/render/` | Three.js scene, scenery, lighting, signs, reflections and post-processing |
| `static/js/bench/` | Seeded suites, headless runs and metrics |
| `scripts/` | Map fetching, fixture generation, verification and headless tools |
| `data/`, `docs/` | Map packs, decisions, runs, screenshots and validation reports |

To add a driver, follow the [agent adapter guide](../agents.md): implement
`decide(snap, eligible, request, signal)`, returning `{ motion, candidateId, meta }`, and
register its factory with `registerAgent` in `static/js/brain/registry.js` or load its module
through the simulator and arena. Before contributing, run the applicable tests and include
a baseline comparison when a change affects driving.
