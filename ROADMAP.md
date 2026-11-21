# Roadmap

Last reviewed: 2026-11-20 at `3ca3178` (#99), with an audit and an expansion plan
([record](docs/validation/roadmap-audit-2026-11-20.md)). This is the one place the plan lives. Update
it when an item lands, when a priority changes, or when a decision under
[Open decisions](#open-decisions) is made.

## What this project is for

The original brief (18 September 2026) was: a car in an open city, with other traffic, that the Jev
model drives from one point on a map to another, to show what Jev and other models can do. Open
source and easy to run.

The one-line version ([D1](#open-decisions), now in the README and on the repository page):

> **A driving test for AI models, on real Canadian streets, that you can also take yourself.**

The simulator, the challenges, the replay and the road tests all serve that sentence. A feature
that makes the world richer but does not help compare drivers, or help a person understand a
driver's choice, comes second.

Not goals: controlling a real vehicle, a general-purpose traffic simulator, photorealism.

## Where we are

Measured on 2026-11-20 at `3ca3178` (#99). How each figure was counted is in the
[audit record](docs/validation/roadmap-audit-2026-11-20.md#how-the-figures-were-measured).

| Area | State |
|---|---|
| World | 12 neighbourhoods in 11 cities, 60 challenges, 2 road tests, 41 opt-in world features (42 free-drive switches); **9 of the 41 are on the feature registry** |
| Drivers | Rules, the cautious agent, decision models (Jev and others), LLMs through any OpenAI-compatible endpoint or a major lab's own API (Claude through the Claude Platform), your own module |
| Public demo | Live on GitHub Pages: Rules and the browser agents drive; the results leaderboard; one keyless model replay (Jev, **Right on red**) |
| Checks | 324 Python tests, 161 Node checks in six shards, four browser jobs, blocking Ruff and Biome lint; the city matrix weekly; the interaction soak weekly, report-only |
| Tools | 100 offline reports on saved runs and a matched comparison of two runs (`scripts/inspect_run.py`) |
| Seeded benchmark, features off | Rules 12/12 on Kitsilano dry, on every change |
| Seeded routes, features on (`city`) | Rules 48/48 on Kitsilano in four weathers, 22/22 on the other eleven maps; on held-out routes no fix was tuned against, Kitsilano dry bare 10/12 and city 8/12 (14 November, not fixed by design) |
| Model results | Challenges and road tests: Jev 62/62 on both tracks (8 flagged choices on the open track), Claude Haiku 5.5 61/62 on each (216 flagged), DeepSeek V4.1 Flash 61/62 guarded (11 November). One run each, all recorded. **No model has a city-suite result** |
| Replay | The 20 November Jev and Claude Haiku tapes replayed exactly when published (#95); Jev's open-track tape was checked again at #99, Claude Haiku's was not. The 11 November Jev and DeepSeek tapes replay exactly on 54 of 62 (the rest need `dcfc663`). CI replays only the stub tape |
| Release | `0.3.0` (20 November); four PRs since, and the changelog's Unreleased section is empty |
| Size | `static/js` 70,392 lines in 253 files. Not comparable with earlier counts: Biome's formatting (#80) took it from 44,706 to 69,111 lines with no code change. Since #80 it has grown 1.9% while `sim/npc.js` (3,953) and `brain/sensors.js` (3,406) shrank as six features moved out |
| Model spend | About $144 to date: $8.36 to 11 November, $136 on 20 November (of which $116 was a Claude Sonnet run that was dropped) |

The bold rows set the order below. The thing the project was built to show, a model driving the city
people drive, still has no result; and three in four features still reach into the core files.

## How work is ordered

A phase is finished when its exit test passes, not when its items are ticked. Sizes are rough:
**S** an hour or two, **M** a day, **L** several days.

Phases 0 to 5 were planned to run in order; in practice 3, 4 and 5 ran beside the end of 2. From
here the order is the [expansion plan](#expansion-plan-from-20-november): work is taken in the order
of its table, a later phase may start when it does not depend on an earlier one, and no exit is
claimed before the exits it depends on.

| Phase | Aim | Exit test | State |
|---|---|---|---|
| [0](#phase-0-stop-the-freeze) | No drive freezes | The known crash is fixed and a thrown step can no longer stop the app | Exited 9 Nov |
| [1](#phase-1-make-the-default-world-pass) | The world people actually drive is measured and passes | A seeded "city" suite with features on runs in CI and Rules passes it | Exited 10 Nov; 1.8 open |
| [2](#phase-2-put-the-models-on-the-road) | Model results exist and are published | A committed, reproducible comparison of Rules, Jev and at least one LLM, on the challenges **and the city suite** | **Open**: no model city run (2.5b) |
| [3](#phase-3-make-features-cheap-to-add) | A new feature stops touching the core files | A new feature needs its own file, its challenge, its test and one registration line | Proof on three met 14 Nov; 9 of 41 moved |
| [4](#phase-4-a-benchmark-that-separates-drivers) | Scores tell drivers apart | Two different models get measurably different scores for a stated reason | Met 20 Nov, on one run each |
| [5](#phase-5-release-and-presentation) | The project presents what it is | 0.3.0 cut; README leads with results | Exited 20 Nov |
| [6](#phase-6-grow-the-world-again) | New scenarios, under the admission rule | Each one passes the [checklist](#admission-rule-for-new-scenarios) | Gated (see [order](#expansion-plan-from-20-november)) |
| [7](#phase-7-results-that-hold-up) | Published results survive the simulator changing, and say how sure they are | A clean checkout verifies every published row on its declared tree, failures included; a repeated comparison reports its spread | New |
| [8](#phase-8-you-against-the-models) | "Take it yourself" meets the leaderboard | On the public demo, with no key, a visitor drives a challenge and sees their result beside Rules, Jev and Claude Haiku on the same drive | New |
| [9](#phase-9-a-harder-test) | The test separates drivers by judgment, not by the filter | Rules, Jev and Claude Haiku differ by a stated margin on a set built for it, for reasons the report names, over repeated runs | New |
| [10](#phase-10-open-to-outside-drivers) | Someone else can bring a driver and a result | An outside driver goes from scaffold to a verified submission bundle offline in one documented path | New |

**Scenario freeze.** Lifted on 10 November under [D3](#open-decisions). New scenarios now wait for
Phase 3's exit and the order below.

---

## Phase 0: stop the freeze

- [x] **0.1 Fix the parking-slot crash.** (S) `taken()` in `static/js/sim/parallel-park.js` reads
  `slot.reserved.spec`, but `sim/driveway-reversers.js` reserves slots with the string
  `"driveway"`, and `sim/lane-closure.js` and `sim/work-zone.js` with a closure record. Since
  traffic cars parallel park (#67), every one of them reaches this code. Add a regression check
  that builds a world with driveways and parkers on and plans a space on a block with a reserved
  slot.
- [x] **0.2 Give slot reservations one shape.** (S) Nine modules write `slot.reserved` in three
  shapes. Decide one (an object that can say what stretch of kerb it takes) and make every writer
  and reader use it.
- [x] **0.3 Contain a thrown step.** (S) The frame loop in `static/js/main.js` asks for the next
  frame only at its end, so one exception in `stepWorld` stops the app for good. Catch it, show
  what failed, and keep the page usable. In the benchmark and the arena a throw stays a failed
  route, with the error recorded.
- [x] **0.4 Confirm in the browser.** (S) Reproduce the freeze on the live demo before the fix and
  confirm it is gone after, so the Node finding is known to match what a visitor sees.

Completed 9 November: all reservations use `{ owner, sFrom, sTo }`, and a thrown step pauses the
app with an error and restart control while benchmark/arena attempts retain a failed result.
WebKit reproduced the first-step freeze with real driveway reservations on a frozen `a9977b6`
build and advanced normally with the fix. The public demo's preview timed out twice, so the
browser comparison used that identical local build. Error recovery, camera controls, restart,
and all 199 browser unit checks passed. The existing 12-route dry suite is unchanged; see the
[validation record](docs/validation/free-drive-freezes-2026-11-09.json) and
[baseline notes](docs/rules-baseline.md). Phase 1 remains next; no new scenarios were added.

## Phase 1: make the default world pass

Every opt-in feature is off in the seeded benchmark, and each is tested alone by its own challenge.
Free drives turn nearly all of them on together. Nothing checks that combination.

- [x] **1.1 One definition of a free drive.** (M) `main.js` builds about forty `World` and
  `NpcFleet` options inline from query parameters. Move that into one function that the app, the
  benchmark and the Node runner all call, so the benchmark's "city" world cannot drift from the
  app's.
- [x] **1.2 A "city" suite beside the current one.** (M) Add a feature preset to
  `bench/runner.js` and `scripts/bench_node.mjs`: `bare` (today's behaviour, so every earlier
  record stays comparable) and `city` (the free-drive defaults, with routes planned the way the app
  plans them, turn restrictions included). The 9 November probe script is the starting point.
- [x] **1.3 Triage what the probe found.** (L) On Kitsilano dry, seed 1, with features on:
  - `s1-3`: after a road-closure detour the car stops 69 m short of its goal and never moves again.
  - `s1-11`: the car sits behind a stationary car that had pulled out from the kerb, with a fire
    truck stuck behind it, for over five minutes.
  - `s1-3`, `s1-7`, `s1-11`, `s1-12`: a failure to yield each. Not yet known whether the car or
    the audit is wrong.
  - `s1-12`: a hard brake with a tailgater behind.
  - `s1-4`, `s1-9`: the crash in 0.1.

  Done, 10 November (Rules, Kitsilano, seed 1, at the city preset of 1.2): **12/12 in dry, fog,
  rain and snow**, up from 7/12, 5/12, 4/12 and 1/12 at the first probe, with no route that passed
  before failing since. A road-closure detour now extends the bench deadline by
  the distance it adds. Fixed along the way, each with a Node check:
  - Audits: a prohibited-turn audit misreading a legal left; the emergency-vehicle audit penalising
    stops the car could not improve on, and an exact-target comparison inside a snowbank narrowing.
  - Emergency vehicles: two missed sirens on turns; pull-overs that could not finish steering before
    a short stop, or approached it too fast; a stood-down vehicle that kept its passing controller;
    gap searches blocked by what was behind them.
  - Traffic: boxed in by pothole moves and a garbage truck; driving into the stopped car; turning
    bodies swinging across it; a pedestrian and a cyclist waiting on each other at a crossing;
    buses blocking a narrowing's exit.
  - The car: a slow left ignoring a stopped oncoming car; a ball warning missed behind a competing
    stop; a red light from a wet amber dilemma; no way back from a pull-over beside parked cars.
  - Snowbank narrowings lost on partial routes.
  - Emergency drive-on: the planner and the audit kept separate drive-on latches, so snow `s1-4`
    failed to yield on a right turn it had been told to make; they now share one
    (`emergencyLead`).
  Evidence: `docs/validation/city-round3-2026-11-10.json`, `city-detours-2026-11-10.json`, `city-yields-2026-11-10.json`,
  `city-snow-2026-11-10.json`, `traffic-clearance-2026-11-10.md`.
- [x] **1.4 Record a city baseline.** (M) Kitsilano in dry, fog, rain and snow, then the two-route
  smoke suite for every other map. Commit it under `data/runs/` and describe it in
  `docs/rules-baseline.md`. Recorded 10 November: Kitsilano 48/48 across the four weathers; the
  other eleven maps 16/22 (see 1.8).
- [x] **1.5 Run it in CI.** (S) The city suite for Kitsilano dry on every change; the full matrix
  on a schedule. `.github/workflows/bench.yml` runs bare dry and city dry on every change and the city
  matrix weekly, every job blocking.
- [x] **1.6 Look for interactions on purpose.** (M) A scheduled soak over several seeds and maps,
  and a run over pairs of features, since the bugs found so far are all pairs (parkers with
  driveways, closures with detours, pull-outs with emergency vehicles). A throw, a stuck car or a
  collision fails it. `--without` and `--cover` (13 seeded configurations covering every pair of the
  42 free-drive switches, `bench/features.js`) and `scripts/soak.mjs`, run weekly by `soak.yml`. The
  first run found a delivery-van stand-off (configuration 4), stuck cars in Toronto, Calgary and
  Victoria, and failures to yield to emergency vehicles at night and on other maps
  (`docs/validation/bench-options-soak-2026-11-10.md`).
- [x] **1.7 Park and night.** (M) The benchmark has no parking at the destination and no time of
  day. Add both as suite options so the overnight and parking features are covered by a seeded run.
  `--park 1` (an arrival with no space to be had is no failure) and `--hour 23.5`, run weekly; city
  dry with parking passes 12/12.

Exit: Rules passes the city suite on Kitsilano in all four weathers with no throw and no stuck car,
and CI runs it.

**Exited 10 November.** The city suite passes on Kitsilano in all four weathers, and CI runs city
dry on every change and the full matrix weekly, every job blocking. The scenario freeze lifts under
D3. What the smoke suite and the soak found on other maps is not frozen work:

- [ ] **1.8 The other maps.** (M) The 1.4 smoke suite (city, dry, two routes each) **passed on every
  map** on 11 November (`docs/validation/other-maps-2026-11-11.md`). A second round on 12 November
  fixed every failure the soak sample and the review of #73 had left open: Toronto, Calgary and
  Victoria seed 2 (stuck routes, a traffic car turning across the car, emergency yields, a prohibited
  turn the audit misread), the Kitsilano seed 3 deadlocks, the night failures at 23:30 and 06:30 and in
  fog, the delivery-van stand-off (cover row 4), parked cars' jittered footprints, the bus-lane turn-in
  latch and a detour counted twice. Each fix has a Node check. The fixes changed which traffic the car
  meets, and merged they found older faults (emergency stops at a line, junctions placed from summed
  edge lengths, a plow on residential streets, waits at a narrow contraflow mouth, a parking manoeuvre
  given up after one overshoot), fixed in turn. Over 41 jobs (172 routes) on the final tree: **166/172**;
  new references in `docs/rules-baseline.md`, ten bare routes changed. Evidence:
  `docs/validation/other-maps-round2-2026-11-12.md`. *Fixed 14 November:* the two routes that failed the
  weekly city matrix (Kitsilano rain `s1-12`, a brake check; snow `s1-4`, a failure to yield). Kitsilano
  is 12/12 in every weather again. *Fixed 18 November:* on Edmonton `s1-2` a contraflow rider now
  clears the waiting car on 81 Avenue NW, and on Kitsilano parking `s1-10` the car finishes parking
  on Stephens Street. *Fixed 20 November:* Winnipeg `s1-1` (the audit now takes a stop held between a
  give-way line and where the car looks from as a line stop) and Kitsilano 06:30 `s1-4` (a pull-over
  begun late, with little room left, finishes its move within its stop) no longer fail to yield to an
  ambulance on Martha Street and Vine Street; every other route and challenge is unchanged
  (`docs/validation/yields-2026-11-20.md`). See [the seeded comparisons](docs/rules-baseline.md). Still open:
  - Unprotected lefts in fog: 28 m of sight is too short to judge 11 m/s oncoming traffic
    (`docs/validation/night-2026-11-12.md`); the fog-night `s1-6` failure is gone for now only because
    traffic changed.
  - Long vehicles other than school buses (transit buses, plows, garbage and emergency trucks) can
    still sweep parked cars at corners; turns other than U-turns still take their position from summed
    edge lengths; the car's own contraflow sensing keeps the old junction-entry rule.
  - The committed Jev and DeepSeek challenge recordings replay exactly on 54 of 62 drives on this tree
    (`docs/model-results.md`); re-record the other eight.
  - From the review of #75, each changing traffic, so each needs its own re-baseline: re-sort turns
    after a U-turn moves (`map/route.js`); a rounding tolerance on the lanes a pull-over can cross
    (`brain/sensors.js`); keep a parker's stuck timeout running through blocked retries
    (`sim/parkers.js`); roll the school bus's corner check all the way to a far corner and check that
    its replacement turn's lane can be reached (`sim/npc.js`); check parked cars and other vehicles on a
    pedestrian's or a child's way round a car (`sim/pedestrians.js`, `sim/ball-chase.js`); keep a
    stopped car in a contraflow rider's gap check until its body clears (`sim/contraflow.js`); use the
    achieved, not commanded, deceleration in `ringJoining` (`sim/roundabout.js`). Tried together, the
    first four broke Kitsilano city dry `s1-12`.

## Phase 2: put the models on the road

This is the original point of the project, and the cheapest phase to run: the September Jev drive
cost $0.033.

- [x] **2.1 Live-check every saved case.** (S) Run `scripts/verify_jev.py` against all cases in
  `data/snapshots/`. Nineteen of the 28 were written for situations added since the last live run. Record
  the date, the model version and each result in the docs, and fix the wording of any that fail.
  *Done 11 November:* 39 of 39 pass on `jev-1.14.0` ([model results](docs/model-results.md#live-check-of-the-saved-cases-roadmap-21)); no wording changed.
- [x] **2.2 Measure what a decision costs now.** (S) The question wording has grown by about thirty
  situation clauses, and the newer requests are roughly twice the size of the first ones. Record
  input tokens, latency and cost per decision for a plain road and for the busiest cases, and set a
  ceiling that a new clause must stay under. *Done:* Jev costs $0.00010 a decision on the
  challenges and $0.00014 on the city suite; ceilings are 4,000 characters of instructions per
  question, 5,500 Jev input tokens and a 6,000-token LLM system prompt
  ([model results](docs/model-results.md#what-a-decision-costs-roadmap-22)). Found on the way: the
  server's 2,000-character instruction limit refused one city decision in six; it is now 6,000.
- [x] **2.3 Smoke-test the endpoints against real providers.** (S) One decision model and one LLM
  through a hosted provider, and one through a local server. The README says they have only met
  mock servers. *Done:* Liquid d1 and Jev through the decision endpoint, GPT-6 Luna, GPT-6.1 Terra
  and DeepSeek V4.1 Flash through OpenRouter, Granite 4.2 through Ollama
  ([model results](docs/model-results.md#endpoints-checked-against-real-providers-roadmap-23)).
  Fixed: the LLM driver now counts the provider's billed cost; Ollama's context and thinking
  settings are documented; the stale Perplexity decider example is gone. llama.cpp not tried.
- [x] **2.4 Report who actually drove.** (S) A model drive falls back to Rules on a timeout or an
  unusable answer, and many questions are answered locally. Show, per drive, the share of decisions
  the model made, the share answered locally and the share that fell back. Without it a "pass"
  cannot be credited to the model. *Landed:* the autopilot counts model, partial, local and
  fallback decisions; non-Rules results, the bench aggregate and table, the arena, the drive report
  and the Inspect drawer show `model_share`, `local_share` and `fallback_share`. Finding for 2.5: almost every
  decision asks the model something (with Rules, every decision in three seeded routes and the first
  60 s of every challenge would have), so per decision the local share is near zero; what is answered
  locally is mostly the motion question inside a call. Consider a per-question count before 2.5.
- [x] **2.5a First published comparison: challenges and road tests.** (M) Rules, the cautious agent, Jev and at least one LLM
  ([D2](#open-decisions)) over the 60 challenges, the road tests and the city suite. Commit the
  runs, with model ids, date, seed and prompt version, and write them up in
  `docs/model-results.md`. *Mostly done, 11 November:* over the 60 challenges and 2 road tests,
  Rules, the cautious agent and Jev pass 62/62 and DeepSeek V4.1 Flash 61/62 (it waited behind the
  double-parked van until time ran out); Jev and DeepSeek are recorded and replay without a key
  (`scripts/arena_node.mjs`). Rules and the cautious agent ran the city suite (cautious 38/48 on
  Kitsilano, 17/22 elsewhere). Still to run: a model on the city suite (Jev about $1.40, DeepSeek
  about $2.10 for Kitsilano dry; Jev's first attempt was spoiled by the instruction limit and a
  shared rate limit). About $8.36 spent so far; see the write-up.
- [x] **2.6 Make a model run repeatable offline.** (M) Save each model answer keyed by its request,
  so a published run can be replayed exactly without a key, and CI can check that a recorded model
  drive still plays out the same. Done: model recordings (`brain/recording.js`, `bench_node.mjs
  --record`/`--replay`, `data/recordings/`, checked by `scripts/test_model_recording.mjs`; docs/agents.md).
- [x] **2.7 Show the results where people look.** (M) A results table at the top of the README and
  a read-only leaderboard in the public demo, built from the committed runs.
  *Done 14 November:* `data/results.json` from the committed runs (`scripts/build_results.py`,
  checked by `tests/test_results.py`), the generated README table, and the `/results` leaderboard in the
  app and the public demo. *20 November (#98):* Jev’s **Right on red** drive also plays in the browser
  from sampled positions and signals exported from its exact command-line replay.
- [x] **2.8 Read and compare saved runs offline.** (M) *Done 20 November (#97, #98):*
  `scripts/inspect_run.py` answers 100 questions about a saved run (outcomes, audits, motion, model
  decisions; `--list`), and `--compare` runs any of them over the matched routes of two runs.

**2.5 is split.** *2.5a, the challenges and road tests:* done (above). *2.5b, the city suite:* open,
and now the first item of the [expansion plan](#expansion-plan-from-20-november). Under the
20 November rule (AGENTS.md, [D2](#open-decisions)) the LLM is Claude Haiku 5.5, not DeepSeek:

- [ ] **2.5b Jev and Claude Haiku on the city suite.** (M) Kitsilano dry, seed 1, the 12 routes Rules
  and the cautious agent already have. First make the route snapping deterministic (7.1), so a
  re-plan is the same on any server process. Pilot one route of each model to measure decisions,
  instruction length, fallbacks and cost (S), then record both on their own servers with their own
  rate limits, and publish them beside Rules and the cautious agent with `model_share`, verdicts,
  cost and a keyless replay. Both one-route pilots and their exact replays are recorded in the
  [city pilot results](docs/validation/city-model-pilots.md). The full suites are the next publication.

Exit: someone with no key can open the repository, see how each driver did on the challenges and
on the city suite, and replay any of the published drives. *Met for the challenges; open until
2.5b lands.*

## Phase 3: make features cheap to add

Each recent feature edited the same core files: `sim/npc.js` (2,499 lines on 9 November, with a
548-line `step`), `brain/sensors.js` (2,068), `brain/state.js`, `brain/candidates.js`, `sim/world.js`,
`bench/metrics.js` and `AGENTS.md`. That is where the next interaction bug comes from. *20 November,
after Biome's formatting:* `sim/npc.js` 3,953 lines with a 959-line `NpcFleet.step`, and
`brain/sensors.js` 3,406 with a 585-line `buildSnapshot`; both a little shorter than just after #80.

- [x] **3.1 A feature interface.** (L) One record per feature: its option, what it builds in the
  world, its step, what it adds to sensing, its candidates and rejections, its model wording, how
  traffic yields to it, its audit, its metric, its failure text and its "seen" flag. The core loops
  over the registered features. Prove it on three (suggest potholes, geese and road closures), with
  the seeded suites and every challenge giving identical results before and after. "Identical"
  means every result field but the timings (`wall_ms` and decision latency), as in
  `docs/rules-baseline.md`.
  *Done 14 November:* `static/js/sim/features/` holds the registry and the records for potholes,
  geese and road closures; the core files no longer name them. Bare and city Kitsilano dry seed 1,
  all 62 challenge and road-test drives and the model recording are identical before and after. A new
  feature still needs a line in the drivers' preferences, checkpoints, the coach, the renderers and the
  labels ([what is left](docs/feature-interface.md)). Found on the way: `snap` in `jev/routing.py` breaks
  ties between equally near lanes in `set` order, so a re-planned route can differ between server
  processes (Python's hash seed); comparisons need one server process or `PYTHONHASHSEED=0` until it
  is made deterministic.
- [ ] **3.2 Move the rest across.** (L) A few at a time, each with the same before-and-after record.
  *Under way:* 20 November, puddles, black ice and snowbanks moved onto the registry, each in a commit
  of its own, and the core files no longer name them (six of the 41 features were records then). This ends
  the one exception AGENTS.md allowed: traffic's lane hooks hand each other their moves, so puddles read
  the move round a pothole without naming it. Black ice and snowbanks needed new hooks for the step's
  start, the clock's day, sight lines, the emergency pull-over and traffic's line and pedals
  ([feature interface](docs/feature-interface.md)). Bare, city, city snow and city rain on Kitsilano
  seed 1, all 62 challenge and road-test drives with Rules and with the cautious agent, and the model
  recording are identical before and after
  ([record](docs/validation/registry-round2-2026-11-20.md)). Driveway reversers, ball chase
  and traffic parking moved next (#98, #99). Police officers now use the registry too, bringing
  it to **10 of 41**. The bare and city comparisons and all Rules and cautious arena drives matched
  before and after ([record](docs/feature-interface.md)). Tailgaters and the remaining parking
  and late features are next.
- [ ] **3.3 Break up the long functions.** (M) `NpcFleet.step` (959 lines), `buildSnapshot` (585)
  and the one-line `needsMotionQuestion` test, once the features have moved out of them. Each piece
  under about 150 lines, with the same before-and-after record as 3.2.
- [x] **3.4 Shrink `AGENTS.md`.** (M) It is 48 KB, mostly one paragraph per feature saying the same
  thing: opt-in, own random stream, one shared conflict test, audit only once seen. State that
  pattern once, and move each feature's detail to the reference docs. Aim for under 12 KB.
  *Done 14 November:* the pattern is stated once with a 32-row feature table; each feature's rule
  moved word for word to its reference page. 56 KB to about 28 KB; the 12 KB aim would mean dropping rules.
  *20 November:* 37.8 KB with a 41-row table, grown with the Boat, lint and registry rules. Revisit
  when 3.2 ends: a registered feature's row can then point at its record.
- [x] **3.5 One layout for challenges.** (M) `lab/challenges.js` lists all 60 challenges in 2,030
  lines, and 19 of them keep their scripted parts in files of their own. Give every challenge its
  own file.
  *Done 14 November:* each challenge is `static/js/lab/challenges/<id>.js` (definition, `scenario`,
  `install`, `step`), shared parts in `lab/challenges/shared/`, and `lab/challenges.js` is the ordered
  registry. Results identical for all 62 drives with Rules and the cautious agent.
- [x] **3.6 Arena storage before it fills.** (M) Two runs of every challenge with two drivers take
  78.3% of the 9 MB history cap, 87.1% with the road tests, and each new challenge adds about 1.3%.
  Move saved runs to storage without that limit, or keep compact summaries and export the rest.
  *Done 14 November:* saved runs are in IndexedDB (`lab/history.js` `openEvaluationHistory`): the
  newest 20 within 200 MB, the oldest evicted first and on a quota error, with a one-time move of the
  localStorage history; the 9 MB localStorage cap is kept only as the fallback.
- [x] **3.7 Faster CI.** (S) The 76 Node checks run one after another in about ten minutes and the
  browser suites take up to seventeen. Split both across parallel jobs.
  *Done 14 November:* six Node shards balanced by measured time (about 1.5 minutes each instead
  of ten in a row), a Python job, and one job per browser suite (four since #92).
- [x] **3.8 Keep the duplicated rules in step.** (S) The sharp-turn rule and the lane-join geometry
  each exist in Python and in JavaScript. Add a check that runs both on the same cases.
  *Done 14 November:* `tests/test_parity.py` compares both sides on
  `tests/fixtures/parity_cases.json`. It found lane-join disagreements, four cases marked
  `known_difference` today (an outgoing piece under
  3 m is chained, not joined, in JavaScript; edge versus 3 m lane headings for the 20° rounding
  decision), recorded as known differences and left for a change that re-baselines routes; and exactly
  130° is a U-turn in `sim/npc.js` (`<`) but not in Python or `demo/routing.js` (`>`), unreachable from
  real geometry.
- [ ] **3.9 Trace the engine difference.** (M) The same seed gives different results in V8 and
  WebKit, and the cause has never been found. Find the first step where they part. *Moved to 7.4*,
  since it decides which published tapes a reader can replay.
- [ ] **3.10 Hooks for what still sits outside a record.** (L) A registered feature still needs a
  line each in about eight driver and presentation files: its free-drive option, the drivers'
  preferences (`brain/rules.js`, `agents/cautious.js`), checkpoints and re-plans, the coach
  (`sim/drive-score.js`), drawing, the HUD and the perception overlay, and the trace and examiner
  labels ([list](docs/feature-interface.md#how-close-a-new-feature-is-to-its-own-file-its-challenge-its-test-and-one-registration-line)).
  Add the `freeDrive`, `rules`, `cautious`, `coach`, `view`, `notice`, `perception` and `label` hooks the
  list names, proved on the nine registered features with the 3.2 record. Without this, finishing
  3.2 does not meet the exit below.
- [ ] **3.11 Make the parity known differences agree.** (M) The four `known_difference` lane joins in
  `tests/fixtures/parity_cases.json`, and the exact-130° U-turn comparison, in one change that
  re-baselines routes, so the Python router and NPC paths join lanes the same way.

Exit: adding a feature needs its own file, its challenge, its test and one registration line.
*The proof on three features was met on 14 November; this exit needs 3.2 and 3.10.*

## Phase 4: a benchmark that separates drivers

Rules passes all 12 seeded routes and all 60 challenges, because each challenge was written
together with the behaviour that passes it. And every driver chooses only among manoeuvres that
already passed the safety filter. Both make a pass easy to get and hard to learn from.

- [x] **4.1 Measure how much is left to the driver.** (M) For each challenge, count the decisions
  where the surviving candidates include one that leads to a failure. If that number is near zero,
  the challenge tests the filter and not the driver.
  *Done 14 November:* `scripts/driver_latitude.mjs`. 28 of 3,042 sampled decisions leave room to
  fail, 24 of them only through the emergency brake; 4, in three challenges (Winter composure, All walk,
  Keep going safely), offer an ordinary manoeuvre that fails
  ([record](docs/validation/driver-latitude-2026-11-14.md)). The challenges test the filter, which is
  the case for 4.2.
- [x] **4.2 An open track.** (L) A second scoring mode in which the filter advises but does not
  remove options (collisions that are about to happen are still braked for), so a driver's own
  judgment decides the outcome. Keep the current mode as the "guarded" track.
  *Done 20 November:* `track: "open"` (`brain/tracks.js`; `--track open`, the *track* box on `/bench` and
  in the arena). Road-rule failures stay on offer, flagged with the rule; a predicted collision is still
  removed. Rules and the cautious agent drive it exactly as the guarded track (124 challenge drives and the
  seeded suites identical). Results report `flagged_choices`, and the leaderboard has an open-track column
  ([how](docs/reference/benchmarks.md#benchmarks-and-validation)).
- [x] **4.3 Scores beyond pass or fail.** (M) Report progress, comfort, margin kept and time lost
  as numbers per driver, so two passing drivers can still be ranked.
  *Done 14 November:* progress, pace, comfort, margin kept, time lost and a combined score
  (`bench/scores.js`), computed from saved fields and shown on `/bench`, in the arena and by the Node
  scripts; formulas in `docs/rules-baseline.md`. Jev and DeepSeek both pass 61 challenges they share and
  score 63.8 and 64.7.
- [x] **4.4 Held-out seeds.** (S) Keep a set of seeds and routes that no fix was tuned against, and
  report them separately.
  *Done 14 November:* `bench/heldout.js` (`--heldout 1`): Kitsilano seeds 101 to 103 and two
  routes of seed 101 on every other map. First Rules run on Kitsilano dry: bare 10/12, city 8/12
  ([record](docs/validation/heldout-2026-11-14.md)), recorded and not fixed.
- **4.5 A harder Rules baseline is not the goal** (standing policy, not a task). Rules is the
  reference and the fallback. When it fails an open-track case, record that as a result; do not
  patch Rules until the case is understood.

Exit: the published comparison shows a difference between two models that the report can explain.

**Exit met 20 November.** On the open track Jev passes 62/62 and took a flagged manoeuvre 8 times; Claude
Haiku 5.5 passes 61/62 and took one 216 times, mostly rolling stop signs and going on at reds. It failed
`flagger` after stopping outside the work zone's waiting window and receiving a STOP paddle until timeout
([write-up](docs/model-results.md#the-open-track-roadmap-42-20-november-2026)).
One run of each; the size of the gap needs more runs (7.5). Most of Claude Haiku's 216 flagged choices
never became a violation, because it chose again before the line; whether a flag should cost score is
9.1. The guarded `on-your-bumper` brake check is documented in 9.2.

## Phase 5: release and presentation

- [x] **5.1 Cut 0.3.0.** (S) Then release on a rhythm, so the unreleased section never reaches
  1,600 lines again. *Done 20 November.*
- [x] **5.2 Rewrite the top of the README.** (M) Lead with what the project is and the results
  table. The opening paragraph is one sentence of about 300 words listing every feature; replace it
  with a short list. Move the 60-row challenge table to the docs. Remove the two stray paragraphs
  after the licence line.
  *Done 14 November:* the one-line statement, a six-bullet list, the generated results table;
  challenges in `docs/challenges.md`.
- [x] **5.3 Make the repository page agree with the README.** (S) The GitHub description says "Jev
  drives the car"; the README says "Drive Lab". Settle it with [D1](#open-decisions), and set the
  homepage to the demo, which is empty today.
  *Done 14 November:* the GitHub description is now the one-line statement, the homepage is the
  demo, and `pyproject.toml` and the demo's social card say the same. The README was rewritten around
  the first results as stories, with new screenshots in `docs/readme/`.
- [x] **5.4 Split the reference.** (M) `docs/project-reference.md` is 2,608 lines. One page per
  feature, generated or linked from the feature registry of 3.1.
  *Done 14 November:* 53 pages (54 since) in `docs/reference/` with an index; `project-reference.md` keeps the
  old anchors; `tests/test_doc_links.py` checks every doc link. Not yet generated from a feature registry.
- [x] **5.5 A guide to adding a challenge.** (S) The README invites scenario contributions; there
  is no page that says how.
  *Done 14 November:* `docs/adding-a-challenge.md`, linked from the README and the reference index.
- ~~**5.6 Tidy the repository.**~~ Dropped 20 November: the branches and worktrees were on one
  machine, not in the repository, so the roadmap cannot track them.
- [ ] **5.7 Keep the changelog current.** (S) Unreleased now covers #96 to #100. Add each PR's line
  as it merges, and cut 0.3.1 or 0.4.0 when 2.5b lands.

## Phase 6: grow the world again

New scenarios resume here, one at a time, each passing the rule below, and not before Phase 3 exits
([D3](#open-decisions)). Compound drives are 9.3. Candidates, in no order and none committed:

- Season as a benchmark condition beside weather and `--hour` (1.7).
- More Canadian cities, only where a city brings a rule or a road layout the eleven lack. First list
  which provincial rules the current cities already cover (S), so a new city is chosen for its gap,
  not its name.
- ~~Driving with a gamepad or on a touch screen.~~ Done 14 November: `ui/gamepad.js`, `ui/touch.js`
  (input only; see [Gamepad and touch](docs/drive-experience.md#gamepad-and-touch)).
- ~~Longer drives that string several situations together, like the road tests.~~ Moved to 9.3.

### Admission rule for new scenarios

A scenario is ready when all of these hold:

1. It teaches something no existing challenge does. Say what in one sentence.
2. It is built on the feature interface of Phase 3, and touches no core file.
3. The `bare` suite and every existing challenge give identical results before and after, timings
   aside.
4. The `city` suite still passes with it on.
5. It has one saved model case, checked live, and stays under the decision cost ceiling of 2.2.
6. Arena storage has been measured again.

---

## Expansion plan (from 20 November)

Built from an audit of this file against the repository at `3ca3178` and independent input from
GPT-6.2 Sol and Gemini 4 Neon ([record](docs/validation/roadmap-audit-2026-11-20.md)). Both put
the same thing first: the project has still not shown a model driving the city, and a result from
one run that replays only on the tree it was made on is weak evidence. Both put new cities last.

| Order | Work | Why then | Waits for |
|---|---|---|---|
| 1 | [7.1](#phase-7-results-that-hold-up), then [2.5b](#phase-2-put-the-models-on-the-road) | Closes Phase 2, the original point of the project | Budget ([D7](#open-decisions)) |
| 2 | [Phase 7](#phase-7-results-that-hold-up) | Every later comparison stands on it | 2.5b for 7.5 and 7.6 |
| 3 | [Phase 8](#phase-8-you-against-the-models) | The "take it yourself" half of the one-line statement; cheap, since the replay player, debriefs and scores exist | 7.2, to know which drives can be shown |
| alongside | [Phase 3](#phase-3-make-features-cheap-to-add): 3.2, 3.10, 3.3, 3.11 | A batch at a time beside 1 to 3; new scenarios wait for its exit | — |
| 4 | [Phase 9](#phase-9-a-harder-test) | Separates drivers by judgment once the evidence is sound | 7.5; Phase 3 for 9.3 |
| 5 | [Phase 10](#phase-10-open-to-outside-drivers) | Lets others bring drivers once the format has settled | 7.2, 7.3 |
| 6 | [Phase 6](#phase-6-grow-the-world-again) | New scenarios and cities, one at a time | Phase 3's exit |

What makes 1.0 is [D6](#open-decisions). The dates are in the
[six-month plan](#six-month-plan-23-november-2026-to-21-may-2027).

**Risks**, and where the plan answers them:

1. *Comparisons nobody can reproduce:* engine differences, the router's hash-seed ties and tapes that
   drift as traffic changes. 7.1 to 7.4 and 7.7.
2. *Fallbacks passing for the model:* rate limits and instruction limits spoiled the first Jev city
   run and the first Claude run. The 2.5b pilot, a server per run, and `model_share` on every row.
3. *Reading too much into one run on a tuned set, or into flags that never became violations.* 7.5,
   7.6 and 9.1.
4. *Scope drift:* new scenarios and cities before the city result and Phase 3's exit. The order above.

## Six-month plan (23 November 2026 to 21 May 2027)

The expansion plan's order, laid out on a calendar. Each block ends on a Friday with a check: the exit
tests it names pass, or the block's left-over items are written down and the next block starts anyway.
Review this plan at each block's end and move dates here, not in the phase sections.

**Capacity.** The listed items in Phases 2, 3 and 7 to 10 add up to about 35 working days at the
S/M/L sizes. About 14 PRs a week merged from late October to 20 November, but the sizes leave out
review rounds, before-and-after records, re-baselines and soak fixes, so the plan assumes each item
takes about twice its size, and leaves the holidays out. On that assumption Phases 2 and 7 to 10 are
placed in the first four blocks, with room, and the last two blocks are for the first growth under
the admission rule and a second results round. If work runs fast, pull the next block's items
forward; do not add scenarios early.

| Block | Dates | Aim | Items | Check at the end |
|---|---|---|---|---|
| 1 | 23 Nov to 18 Dec | **Models on the city** | 7.1, the 2.5b pilot, then 2.5b; 7.3; 5.7; 3.2 batch (the `"officers"` and `"tailgaters"` neighbours) | Phase 2 exits. Release **0.4.0** with the city results |
| — | 21 Dec to 1 Jan | Holidays | The weekly city matrix and soak keep running; fix only what they break | — |
| 2 | 4 Jan to 29 Jan | **Results that hold up** | 7.2, 7.4 (two days, then write down what is known), 7.5, 7.6, 7.7, 7.8; 8.1, 8.2; 3.2 batches (the `"parking"` and `"late"` neighbours) | Phase 7 exits; the D6 gate passes. About 20 of 41 features registered. Release **0.5.0** as the 1.0 candidate |
| 3 | 1 Feb to 26 Feb | **1.0** | 8.3, 8.4; 3.10; the rest of 3.2; fixes found on the candidate | Phase 8 exits. Release **1.0.0**, scored on suite `v1` |
| 4 | 1 Mar to 26 Mar | **Finish the interface; start the harder test** | 3.3, 3.11; 9.1, 9.2, 9.4 | Phase 3 exits: a new feature is one file, its challenge, its test and one line. 1.1.0 |
| 5 | 29 Mar to 30 Apr | **Compound drives; outside drivers** | 9.3 (one compound drive through the admission rule); 10.1, 10.2, 10.3, 10.4 | Phase 9 and Phase 10 exit. 1.2.0 |
| 6 | 3 May to 21 May | **Grow by one; second results round** | The provincial-rule gap list (Phase 6), then one new city or one season condition through the admission rule; Jev's current version and Claude Haiku over suite `v1` again, with repeats | The new scenario passes all six admission checks. A second dated results round, and the next plan written here |

**Every week.** Triage the weekly city matrix (Mondays) and the soak (Thursdays). A failed leg becomes a fix with a Node
check, or a line in 1.8. Add each PR's changelog line as it merges (5.7).

**Every month.** Cut a release (0.4.0, 0.5.0, 1.0.0, then 1.x). Live-check the saved cases with
`scripts/verify_jev.py` when Jev ships a new version, and record which version each result used.

**Spend.** About $30 for blocks 1 and 2 ([D7](#open-decisions)). The second round in block 6 is about
$18 for three repeats of both models over the 62 drives, plus suite `v1`'s city routes in four weathers
at the cost the block 1 pilot measures (Jev about $1.40 a weather; Claude Haiku not yet known). Agree a
figure for it at the end of block 1. Check the provider's bill during each run, and ask before going
past an agreed amount.

**What would move the dates.**

- *7.4, the engine difference,* has no known size. It is timeboxed: if the first step where V8 and
  WebKit part is not found in two days, publish each result with the engine it needs and go on.
- *3.2 is the long pole,* 32 features in neighbour batches, each with a full before-and-after record. If
  it slips, block 3 still releases 1.0 (D6 does not need Phase 3) and 9.3 moves to block 6.
- *A new Jev version or a change in Claude Haiku's pricing or limits* can move a results round. A
  new Jev version is a live check and a re-record, not a reason to change the prompt wording.
- *Open decisions D6 to D8.* The plan assumes the recommendations. If 1.0 is tied to Phase 2 alone
  (D6), release it at the end of block 1 and move `v1` (7.8) into block 2. If recordings must stay
  in Git as they are (D8), 10.3 becomes a size limit on each new tape.

## Phase 7: results that hold up

- [x] **7.1 Deterministic route snapping.** (S) `snap` and `snap_all` break ties by edge ID and
  lane index. Two servers with different hash seeds agreed on all 576 route requests across the
  12 maps. All 60 seeded Kitsilano drives matched before and after. See the
  [routing validation record](docs/validation/deterministic-routing-2026-11-21.md).
- [x] **7.2 A manifest for every published run.** (M) Source commit, JavaScript engine and version,
  map pack and layer fingerprints, prompt hash, model id, track, seed, suite and cost, written by
  `bench_node.mjs` and `arena_node.mjs` and checked by `scripts/build_results.py`.
  New publications carry the manifest. Earlier results retain their original metadata.
- [x] **7.3 Check replays apart from verdicts.** (S) Both Node runners accept `--check replay`, which
  passes an exactly reproduced failure. The weekly replay drift job checks published tapes on their
  declared revision and on main and reports both results in its job summary.
- [ ] **7.4 Trace the engine difference.** (M) Was 3.9. Find the first step where V8 and WebKit part
  on a tuned seed, and fix it or document which engine each published result needs.
- [ ] **7.5 Repeat runs and their spread.** (M) Declare the drives and the number of repeats before
  running (suggested: three runs of Jev and of Claude Haiku over the 62 drives on the open track, within
  [D7](#open-decisions)), then report each score with its range and which differences recur. Report
  flagged choices per decision, audited violations, emergency-brake interventions and fallbacks as
  separate numbers. `scripts/compare_repeats.mjs` reports spread from recordings with matching
  source and drive settings. The repeated live runs and their results are still due.
- [ ] **7.6 Models on the held-out routes.** (S) Jev and Claude Haiku on the held-out Kitsilano
  city routes (`bench/heldout.js`), reported apart and never debugged against.
- [ ] **7.7 The eight drifted tapes.** (S) Record Jev's eight drifted 11 November drives again on main,
  and mark DeepSeek's (no longer run, AGENTS.md) in `results.json` as replaying on `dcfc663` only.
- [ ] **7.8 Version the test.** (M) Name the set a 1.0 result is scored on (the 60 challenges, the
  2 road tests, the Kitsilano city suite in four weathers and the held-out routes) as suite `v1`, and
  write `suite_version` into every result and manifest. A change that alters any `v1` result bumps it,
  and the leaderboard only ranks rows of one version together.

Exit: a clean checkout verifies every published row on its declared tree, failed drives included, and
a repeated comparison reports its spread.

## Phase 8: you against the models

The game and the leaderboard are two separate places today: a manual drive gets a coach score that is
never set beside a model's result on the same drive.

- [ ] **8.1 Your drive beside theirs.** (M) After a manual challenge or road test, the drive report
  shows Rules, Jev and Claude Haiku on the same drive from `results.json`: verdict, time, the score
  of `bench/scores.js` and incidents. As for practice, only the original unchanged manual attempt
  counts, and every verdict comes from `challengeFailures`.
- [ ] **8.2 From the leaderboard to the wheel.** (S) Each challenge on `/results` links to driving it
  with its authored setup, and the leaderboard shows the scores of `bench/scores.js` beside pass and
  fail.
- [ ] **8.3 A gallery of model drives.** (M) Generalise `ui/published-replay.js` from one drive to a
  list of exported drives: four to six that show a difference (Claude Haiku at the flagger, one of
  Jev's flagged lefts, a pass and a fail on the same challenge), with the chosen and flagged manoeuvres
  marked. Keep the demo's size in check.
- [ ] **8.4 Compare an incident.** (M) For a challenge you failed, play your incident beside a model's
  drive through the same moment, reusing the debrief and the replay player.

Exit: on the public demo, with no key, a visitor drives a challenge, sees their result beside Rules,
Jev and Claude Haiku on the same drive, and can watch at least four contrasting model drives.

## Phase 9: a harder test

Phase 4 found that the challenges mostly test the filter (4.1: 4 of 3,042 sampled decisions offer an
ordinary manoeuvre that fails) and that most open-track flags never became violations.

- [ ] **9.1 Decide what a flagged choice costs.** (M) First measure how long each flagged choice was
  held and how close it came to the line. Then either add a score term (bump `SCORES_VERSION`) or keep
  scores on outcomes and report flags apart, and record why.
- [x] **9.2 Claude Haiku's two losses.** (S) The open-track `flagger` stall and the guarded
  `on-your-bumper` brake check replay exactly. The
  [review](docs/validation/haiku-two-losses-2026-11-21.md) records what the model saw,
  the choices it made and which audit or timeout determined each verdict.
- [ ] **9.3 Compound drives.** (L) One or two longer drives on existing maps that string several
  situations together, like the road tests, each passing the admission rule. Run the latitude script of
  4.1 on each before admitting it: a drive in which no ordinary manoeuvre can fail does not separate
  drivers.
- [ ] **9.4 A hard city slice.** (M) A small fixed set of city routes from the soak's hardest
  conditions (night, unprotected lefts in fog, snow narrowings, parking). Rules' failures there are
  results under 4.5; the slice becomes blocking once Rules passes it.

Exit: on a set built for it, Rules, Jev and Claude Haiku differ by a stated margin over repeated runs
(7.5), for reasons the report names.

## Phase 10: open to outside drivers

- [x] **10.1 Check your own driver.** (S) `scripts/check_driver.mjs` runs a trusted custom module
  over the challenges on both tracks and prints its results beside Rules, the cautious agent and
  matching published model runs. See [adding a driver](docs/agents.md).
- [ ] **10.2 A submission bundle.** (M) A versioned format (the 7.2 manifest, the recording and the
  results) and an offline verifier that replays it and checks `model_share`, the prompt hash, the tree
  and the cost. Rows submitted from outside are marked as such on the leaderboard.
- [ ] **10.3 Where recordings live.** (M) `data/recordings/` is 12 MB, and each Claude Haiku run of the
  62 drives adds about 4.5 MB, so 7.5's repeats alone would add about 15 MB. Slim the tapes or move
  them ([D8](#open-decisions)).
- [x] **10.4 A real-street report.** (S) The Map problem and Driving problem issue templates ask for
  the map, seed, route and a saved run.

Exit: an outside driver goes from a scaffold to a verified submission bundle offline by one
documented path, and adding it grows the repository by a stated, small amount.

---

## Parked

| Item | Why |
|---|---|
| Road elevation, camber, suspension | Large, and does not help compare drivers |
| Controlling a real vehicle | Never a goal |
| New single-hazard challenges beyond the 60 | 4.1 showed they test the filter; compound drives (9.3) come first |
| Several new cities at once | One at a time, for a rule or layout the others lack (Phase 6) |
| Paying for more model providers in-house | Live runs use Jev and Claude Haiku 5.5 only; breadth comes through Phase 10 |
| Recording DeepSeek again | No longer run; its tapes stay as published (7.7) |

## Open decisions

| | Decision | Recommendation |
|---|---|---|
| **D1** | Is this first a model showcase or a driving game? | *Decided 14 November:* the showcase, with the game as how people meet it; the one-line statement is in the README and on the repository page |
| **D2** | Which models go in the first comparison, and what is the budget? | *Decided 11 November:* Jev and DeepSeek V4.1 Flash through OpenRouter, $5 to start, raised for DeepSeek's full run. *20 November:* live model test runs now use Jev and Claude Haiku 5.5 only (AGENTS.md). About $144 spent in all, $116 of it on a dropped Claude Sonnet run. Further spend: D7 |
| **D3** | Does the scenario freeze hold until Phase 1 exits, or until Phase 3? | *Decided:* lifted when Phase 1 exited (10 November). *Proposed 20 November:* new scenarios now wait for Phase 3's exit, one at a time |
| **D4** | Is `city` a second suite, or does it replace the current one? | *Decided and built (1.2):* a second suite, so earlier records stay comparable |
| **D5** | Is the next release 0.3.0 or 1.0? | *Decided:* 0.3.0, cut 20 November. What makes 1.0 is now D6 |
| **D6** | What makes 1.0? | Phase 2's exit (2.5b), 7.1 to 7.3, 7.8 and 8.1 on the public demo: models on the city, results that verify on a named suite, and a person set beside them. Until then, release 0.x on a rhythm (5.7). The [six-month plan](#six-month-plan-23-november-2026-to-21-may-2027) meets this at the end of January and cuts 1.0.0 on 26 February |
| **D7** | What is the budget for 2.5b, 7.5 and 7.6? | **21 November:** up to $30 approved for Jev and Claude Haiku city work, starting with one city route per model. The owner approved using provider-reported token usage at published rates to verify spend for this city run. The two pilots cost $0.3237 on that basis. At 20 November prices Jev's 62 open-track drives cost $1.47 and Claude Haiku's $4.53 (effort low), so three repeats of both are about $18 |
| **D8** | Where do model recordings live? | First slim them in Git (keep only what replay needs). Moving them to release assets, with a hash in Git, is a change of service and needs the owner's approval |

## Done so far

| When | What |
|---|---|
| 18 Sep | Real map in the browser, autopilot, Rules and Jev drivers, signals and stop signs |
| 23 to 28 Sep | Seeded benchmark, tyre and actuator model, realism and graphics; 0.2.0 |
| 29 Sep to 7 Oct | Occlusion, parking, more cities, coaching, Drive Lab, arena, replay, public demo, photo mode |
| 14 to 15 Oct | Every check in CI, Rules re-baselined, rendering artifacts fixed, LLM and decision-model drivers, four more cities |
| 19 Oct to 9 Nov | Lane changes, right of way, and the road situations behind most of the 60 challenges; practice library, debriefs, road tests |
| 9 to 12 Nov | Phases 0 and 1: no drive freezes, the city suite passes on every map and runs in CI, the soak and pair cover; first model results, recorded and replayable |
| 14 Nov | Results table and leaderboard, scores beyond pass or fail, held-out routes, the feature registry, one file per challenge, arena storage in IndexedDB, the README rewrite, the reference split |
| 16 to 19 Nov | Ruff and Biome with blocking CI, pinned actions, each major lab's own API, faster browser CI |
| 20 Nov | The open track, Jev and Claude Haiku results, 0.3.0, Boat sandboxes for agent work, 100 offline reports and run comparison, a keyless model replay in the demo, the registry at nine features |
