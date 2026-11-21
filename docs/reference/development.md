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
scripts/boat-check.sh --full     # also every scripts/test_*.mjs, one at a time, 360 s each as in CI
scripts/boat-check.sh -- uv run --locked python -m unittest discover -s tests -k test_route_never_backs_up
scripts/boat-check.sh --save     # rebuild the warm snapshot jev-fsd-warm from origin's default branch
scripts/boat-check.sh --status   # this worktree's sandbox
scripts/boat-check.sh --done     # delete it when the work ends (--stop keeps it)
```

The account's 200 daily sandbox starts are shared by every project, and each create or resume
uses one, so the script keeps one long-lived sandbox per worktree. The first check creates it
from the saved snapshot `jev-fsd-warm` (`JEV_BOAT_SNAPSHOT`), or bare when there is none, as a
`default` machine (`JEV_BOAT_TYPE`) with `--no-env`, so no GitHub token, agent logins or model
keys go in and no check can spend credits. Creates and resumes pass `--fail-fast`: when Boat has
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
hours ahead (renewed every 30 minutes, so a long check is never cut off), and when the check
ends it sets it to `JEV_BOAT_IDLE` seconds (default 2700), so a forgotten sandbox
stops itself and the next check resumes it. Starts only happen on a create or a resume; a
check against a running sandbox uses none. When no starts are left, the script stops with
exit code 3 and the message from Boat.

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
id=$(boat new --environment jev-fsd-live --name jev-fsd-live-<purpose> --json | jq -r 'select(.event=="ready") | .id')
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
