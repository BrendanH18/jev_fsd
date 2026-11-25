# Development

```sh
uv run python -m unittest discover -s tests
node scripts/node_checks.mjs                                  # every scripts/test_*.mjs in parallel (pass --jobs N or specific files)
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
CI runs all of the above on every pull request, and it is the full check: agents run only the
checks that cover their change, through [Boat checks](#boat-checks), and leave the rest to CI.

## Boat checks

Agents run these checks in a [Boat](https://boat.dev) sandbox, not on the owner's computers.
`scripts/boat-check.sh` needs the signed-in `boat` CLI, `jq`, git, tar and perl.

```sh
scripts/boat-check.sh            # lint, Python tests, offline Jev requests, fixture check
scripts/boat-check.sh --full     # also every scripts/test_*.mjs, in parallel, 360 s each as in CI
scripts/boat-check.sh -- uv run --locked python -m unittest discover -s tests -k test_route_never_backs_up
scripts/boat-check.sh --save     # rebuild the warm snapshot jev-fsd-warm from origin's default branch
scripts/boat-check.sh --status   # this worktree's sandbox
scripts/boat-check.sh --done     # delete it when the work ends (--stop keeps it)
```

Owner decision (2026-11-22): CI is the gate and runs the full suite once, on the pushed commit.
Agents don't run the full suite (the plain check or `--full`) before handing work back. While
working they run targeted checks with `-- CMD`: the tests that cover the code they changed, such
as one `scripts/test_*.mjs` file, a few through `node scripts/node_checks.mjs --jobs 4 FILE...` or
one Python file (`uv run --locked python -m unittest discover -s tests -p "test_routing.py"`), and
lint for the languages they touched (`ruff check` and `ruff format --check`, or `npm run lint`).
CI runs the full suite on every pushed commit; a failed CI job is reproduced on Boat with the
script and fixed. The plain check and `--full` are for reproducing a CI failure, for heavy
checks that must not run on the Pi or the Mac, and for checks CI doesn't run. Everything the
script's plain and `--full` runs do is in CI (`lint.yml`, and `demo.yml`'s Python and Node jobs).
CI doesn't compare a seeded benchmark with the committed baseline, run WebKit or verify Jev
live, so those stay required before hand-off when a change calls
for them ([Checking work](../../AGENTS.md#checking-work)). The hand-off report names the targeted
checks that ran and says that CI runs the full check.

The account's daily sandbox starts (840 on the $100 plan) are shared by every project, and each
create or resume uses one, so the script keeps one long-lived sandbox per worktree. The first
check creates it from the saved snapshot `jev-fsd-warm` (`JEV_BOAT_SNAPSHOT`), or bare when
there is none, with `--no-env`, so no GitHub token, agent logins or model keys go in and no check
can spend credits. Creates and resumes pass `--fail-fast`: when Boat has
no machine ready, nothing starts and no start is counted, and the script tries again every 10
seconds for about a minute. The sandbox id is kept in the worktree's git directory, and later checks
reuse that sandbox. Agents sharing a worktree each set their own `JEV_BOAT_SLOT`; one sandbox
is never shared between agents.

Each check makes the clone at `/home/user/jev_fsd` match the working tree exactly: tracked and
untracked, non-ignored files, as `boat push` takes them, so deleted files go and ignored ones
such as `.env` never leave the computer. Git's index there lists exactly those files, so
`git ls-files` (which `tests/test_results.py` relies on) matches the computer the script ran on.
Only what changed since the last check is sent. The script indexes the working tree in a private
index in the worktree's git directory, a fresh copy of its own index each time (its stat data keeps this to a
few milliseconds, and the real index is untouched), and its git tree names the exact contents. When this
sandbox got tree T last time (`pushed-<slot>` beside the sandbox id), the files that differ
from T go as a gzipped tarball with the list of changed and deleted paths: inside `boat exec`'s
arguments up to 72 KB, or pushed when bigger. In the sandbox, the clone's index is the tree last
synced. Files earlier checks left (`git clean -x`, which keeps the top-level `node_modules` and `.venv`) and
their edits to tracked files are undone first, then `git write-tree` must give T before the
change is applied and the new tree after. A new sandbox, a missing record or a mismatch sends
every file instead, as `git archive` of the tree itself (everything but `.git`, `node_modules`
and `.venv` is replaced and the index rebuilt); a mismatch found in the sandbox exits 75 and leaves a marker, and the script then
sends every file and runs again. A full send that still does not give the tree (an
`export-ignore` attribute, or `core.autocrlf` on the sending computer) stops before any check.
Index entries marked assume-unchanged or skip-worktree are cleared on both sides first. Measured 2026-11-21 on `default` from a Raspberry Pi 5:

| Push | Before (`boat push` of the tree) | After |
|---|---|---|
| First check in a sandbox | 22 s | 8 s (25 MB tarball; 2 s of it to pack) |
| One-line edit | 8 s | none: the whole `-- true` run took 2 s |
| 300 KB of changes | 8 s | 3 s |

`npm ci` runs only when `package-lock.json` changed, then
`uv sync --locked`. The command runs with `boat exec --timeout 0`. A bare sandbox first installs
Node 22 (checked against the release's SHA-256 sums), uv and the clone. Copy results such as
`data/runs/` back before the next check replaces them.

Owner decision (2026-11-22, replacing the 15 idle minutes of 2026-11-21): every size stops as
soon as its check ends, whatever happened to the check. A stopped sandbox bills nothing, and
Boat keeps its machine for 10 minutes after it reads `stopped`, unbilled. A plain resume in
that time, or while the sandbox is still `stopping`, usually takes that machine back with no
restore, and Boat [doesn't count it as a start](https://docs.boat.dev/limits.md), so idling to
save a start only spends plan hours. Boat can release the machine early; a resume after that
restores the snapshot on a new machine and counts as a start. The script resumes a `stopping` sandbox straight away; when Boat
can't take the machine back mid-stop (`sandbox_stopping`), it waits up to two minutes for
`stopped` and resumes then. A resume at a new size always starts a new machine, so it waits for
`stopped` first and uses a start. `JEV_BOAT_IDLE` (seconds) leaves the auto-stop that far ahead
instead of stopping.

Boat's auto-stop is a deadline, not an idle timer. While a check runs, the script keeps it 30
minutes ahead, renewed every 10 minutes from the moment the sandbox is running (through the push,
the run and any resync) so a long check is never cut off. The renewal loop
checks that the script is still alive before each renewal, so a run killed outright (no exit
trap) leaves a sandbox that stops itself within 30 minutes. The exit trap is armed before the
create or resume, so an interrupted run still stops the sandbox; a sandbox this run was creating
and hadn't recorded yet is deleted instead, its id taken from the create's output. Starts only
happen on a create or on a resume that can't take the kept machine back; a check against a
running sandbox uses none. A resume that finds no machine ready can leave Boat finishing it for
a while, so the script also retries "resume already in progress". When no starts are left, the
script stops with exit code 3 and the message from Boat.

Measured 2026-11-22 from a Raspberry Pi 5 (`default`): the first plain check created the sandbox
(69 s in all) and left it `stopping`, then `stopped` 9 s later. Checks sent 7 and 30 seconds
after it read `stopped`, and one sent while it was still `stopping`, each resumed it (2 s where
timed), and the account's daily start count (`boat limits --json`, `.starts.day.used`) didn't
change. A run
killed with `SIGKILL` (with the renewal shortened to 5 s for the test) lost its renewal loop
within 8 s, and its sandbox stopped at the auto-stop deadline. A `SIGTERM` during a create
deleted the new sandbox, and one during `--save` deleted the build sandbox.

### Sizes and parallel checks

Owner decision (2026-11-21): `--full` runs on `xlarge` (16 vCPUs, 32 GB) with one Node check per
vCPU, and the plain check and `-- CMD` run on `default` (4 vCPUs, 8 GB). The size is chosen per
run (`JEV_BOAT_TYPE` overrides it for every mode): a sandbox of the other size is stopped and
resumed at this run's size, which uses one start. Every size stops as soon as its check ends
(above).

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
about a cent per `--full` and stops straight afterwards. The plain check is single-threaded Python and
gains nothing from cores, so it stays on `default`. The `--full` runs above include about 10 to 25
s of pushing the working tree, and a size change adds the resume (12 to 56 s, longer when Boat has
no machine ready).

`--save` builds `jev-fsd-warm` in a fresh bare sandbox that runs no worktree code: it installs
the toolchain, checks out `origin`'s default branch, installs its dependencies, saves the
sandbox, waits until Boat reports that save ready and deletes the sandbox. An interrupted save
deletes the build sandbox too, or stops it once the save has begun (the save needs its source)
and prints the delete to run when the save reads ready. Nothing a check or a
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
through the simulator and arena. Before contributing, run the tests that cover the change (CI
runs the full suite) and include a baseline comparison when a change affects driving.

## Plan Node checks

Preview the dispatch order with `node scripts/node_checks.mjs --list`.
`--match TEXT` and `--exclude TEXT` filter test basenames. `--show-output`
prints passing checks' output. `--fail-fast` lets running checks finish and
skips the rest. `--json report.json.gz` exports per-file outcomes and the
retained failure logs.

Use `node scripts/ci_shard.mjs --shards 6 --file test_bench_options.mjs` to
find a check's shard. Add `--json` to a lookup, shard listing or full plan to
read it from another tool. Use `--times PATH` to experiment with an alternate
timing table and `--require-measured` to identify tests missing timings.

## Check a packaged demo

The static build checks its navigation, bundled map data and published replays
before CI uploads it. To verify a previously generated copy without writing
to it, run `python scripts/build_demo.py --check --output .demo-site`. Use
`python scripts/build_demo.py --list-maps` for its bundled map catalog.

The Arena catalog is available offline with
`node --experimental-default-type=module scripts/arena_node.mjs --list --set all`.
Use `--map`, `--region`, `--weather`, `--hazard`, `--difficulty` or
`--parking-only` to select drives, then remove `--list` to run the selection
against the local server.
