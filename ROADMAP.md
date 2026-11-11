# Roadmap

Last reviewed: 2026-11-09. This is the one place the plan lives. Update it when an item lands, when
a priority changes, or when a decision under [Open decisions](#open-decisions) is made.

## What this project is for

The original brief (18 September 2026) was: a car in an open city, with other traffic, that the Jev
model drives from one point on a map to another, to show what Jev and other models can do. Open
source and easy to run.

The proposed one-line version, pending [decision D1](#open-decisions):

> **A driving test for AI models, on real Canadian streets, that you can also take yourself.**

The simulator, the challenges, the replay and the road tests all serve that sentence. A feature
that makes the world richer but does not help compare drivers, or help a person understand a
driver's choice, comes second.

Not goals: controlling a real vehicle, a general-purpose traffic simulator, photorealism.

## Where we are

Measured on 2026-11-09 at `0b5bdd3`.

| Area | State |
|---|---|
| World | 12 neighbourhoods in 11 cities, 60 challenges, 2 road tests, about 32 opt-in world features |
| Drivers | Rules, the cautious agent, decision models (Jev and others), any OpenAI-compatible LLM, your own module |
| Public demo | Live on GitHub Pages, Rules and browser agents only |
| Checks | 268 Python tests, 76 Node checks, browser and renderer suites; CI green, 10 to 17 minutes |
| Seeded benchmark, features off | Rules 12/12 on Kitsilano dry; full 70-route matrix last run 31 October |
| Seeded routes, features on | **Rules 6/12** in a one-off probe: 2 routes threw, 2 left the car stuck, 4 logged a failure to yield |
| Model results | **None committed.** Model endpoints tested against mock servers only; last live Jev check 14 October |
| Release | Still `0.2.0` (28 September) with about 1,600 lines of unreleased changelog |
| Size | `static/js` about 41,000 lines, up from about 12,600 on 14 October |

The two bold rows are why the order below is what it is: the default free drive is not known to
work, and the thing the project was built to show has not been shown.

## How work is ordered

Phases run in order. A phase is finished when its exit test passes, not when its items are ticked.
Sizes are rough: **S** an hour or two, **M** a day, **L** several days.

| Phase | Aim | Exit test |
|---|---|---|
| [0](#phase-0-stop-the-freeze) | No drive freezes | The known crash is fixed and a thrown step can no longer stop the app |
| [1](#phase-1-make-the-default-world-pass) | The world people actually drive is measured and passes | A seeded "city" suite with features on runs in CI and Rules passes it |
| [2](#phase-2-put-the-models-on-the-road) | Model results exist and are published | A committed, reproducible comparison of Rules, Jev and at least one LLM |
| [3](#phase-3-make-features-cheap-to-add) | A new feature stops touching the core files | Three features moved to a shared interface with identical results (timings aside) |
| [4](#phase-4-a-benchmark-that-separates-drivers) | Scores tell drivers apart | Two different models get measurably different scores for a stated reason |
| [5](#phase-5-release-and-presentation) | The project presents what it is | 0.3.0 cut; README leads with results |
| [6](#phase-6-grow-the-world-again) | New scenarios, under the admission rule | Each one passes the [checklist](#admission-rule-for-new-scenarios) |

**Scenario freeze.** No new world features or challenges until Phase 1 exits. Fixes, tests and
anything in Phases 0 to 2 are not frozen.

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
- [ ] **1.3 Triage what the probe found.** (L) On Kitsilano dry, seed 1, with features on:
  - `s1-3`: after a road-closure detour the car stops 69 m short of its goal and never moves again.
  - `s1-11`: the car sits behind a stationary car that had pulled out from the kerb, with a fire
    truck stuck behind it, for over five minutes.
  - `s1-3`, `s1-7`, `s1-11`, `s1-12`: a failure to yield each. Not yet known whether the car or
    the audit is wrong.
  - `s1-12`: a hard brake with a tailgater behind.
  - `s1-4`, `s1-9`: the crash in 0.1.

  Status, 10 November (Rules, Kitsilano, seed 1, at the city preset of 1.2): **dry 12/12, fog
  12/12, rain 12/12, snow 11/12**, up from 7/12, 5/12, 4/12 and 1/12 at the first probe, with no
  route that passed before failing since. A road-closure detour now extends the bench deadline by
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
  Still open: snow `s1-4` arrives after two detours (1,940 m against 894 m planned) but fails to
  yield to an emergency vehicle on the way: the planner thinks it was asked to drive on ahead of
  it while the audit does not. The 1.6 soak finds more emergency yields at night and on other maps.
  Evidence: `docs/validation/city-round3-2026-11-10.json`, `city-detours-2026-11-10.json`, `city-yields-2026-11-10.json`,
  `city-snow-2026-11-10.json`, `traffic-clearance-2026-11-10.md`.
- [ ] **1.4 Record a city baseline.** (M) Kitsilano in dry, fog, rain and snow, then the two-route
  smoke suite for every other map. Commit it under `data/runs/` and describe it in
  `docs/rules-baseline.md`.
- [x] **1.5 Run it in CI.** (S) The city suite for Kitsilano dry on every change; the full matrix
  on a schedule. `.github/workflows/bench.yml` runs bare dry and city dry on every change, both blocking,
  and the city matrix weekly; fog, rain and snow report without blocking until they pass.
- [ ] **1.6 Look for interactions on purpose.** (M) A scheduled soak over several seeds and maps,
  and a run over pairs of features, since the bugs found so far are all pairs (parkers with
  driveways, closures with detours, pull-outs with emergency vehicles). A throw, a stuck car or a
  collision fails it.
- [ ] **1.7 Park and night.** (M) The benchmark has no parking at the destination and no time of
  day. Add both as suite options so the overnight and parking features are covered by a seeded run.

Exit: Rules passes the city suite on Kitsilano in all four weathers with no throw and no stuck car,
and CI runs it.

## Phase 2: put the models on the road

This is the original point of the project, and the cheapest phase to run: the September Jev drive
cost $0.033.

- [ ] **2.1 Live-check every saved case.** (S) Run `scripts/verify_jev.py` against all cases in
  `data/snapshots/`. Nineteen of the 28 were written for situations added since the last live run. Record
  the date, the model version and each result in the docs, and fix the wording of any that fail.
- [ ] **2.2 Measure what a decision costs now.** (S) The question wording has grown by about thirty
  situation clauses, and the newer requests are roughly twice the size of the first ones. Record
  input tokens, latency and cost per decision for a plain road and for the busiest cases, and set a
  ceiling that a new clause must stay under.
- [ ] **2.3 Smoke-test the endpoints against real providers.** (S) One decision model and one LLM
  through a hosted provider, and one through a local server. The README says they have only met
  mock servers.
- [ ] **2.4 Report who actually drove.** (S) A model drive falls back to Rules on a timeout or an
  unusable answer, and many questions are answered locally. Show, per drive, the share of decisions
  the model made, the share answered locally and the share that fell back. Without it a "pass"
  cannot be credited to the model.
- [ ] **2.5 First published comparison.** (M) Rules, the cautious agent, Jev and at least one LLM
  ([D2](#open-decisions)) over the 60 challenges, the road tests and the city suite. Commit the
  runs, with model ids, date, seed and prompt version, and write them up in
  `docs/model-results.md`.
- [ ] **2.6 Make a model run repeatable offline.** (M) Save each model answer keyed by its request,
  so a published run can be replayed exactly without a key, and CI can check that a recorded model
  drive still plays out the same.
- [ ] **2.7 Show the results where people look.** (M) A results table at the top of the README and
  a read-only leaderboard in the public demo, built from the committed runs.

Exit: someone with no key can open the repository, see how each driver did, and replay any of the
drives.

## Phase 3: make features cheap to add

Each recent feature edited the same core files: `sim/npc.js` (2,499 lines, with a 548-line
`step`), `brain/sensors.js` (2,068), `brain/state.js`, `brain/candidates.js`, `sim/world.js`,
`bench/metrics.js` and `AGENTS.md`. That is where the next interaction bug comes from.

- [ ] **3.1 A feature interface.** (L) One record per feature: its option, what it builds in the
  world, its step, what it adds to sensing, its candidates and rejections, its model wording, how
  traffic yields to it, its audit, its metric, its failure text and its "seen" flag. The core loops
  over the registered features. Prove it on three (suggest potholes, geese and road closures), with
  the seeded suites and every challenge giving identical results before and after. "Identical"
  means every result field but the timings (`wall_ms` and decision latency), as in
  `docs/rules-baseline.md`.
- [ ] **3.2 Move the rest across.** (L) A few at a time, each with the same before-and-after record.
- [ ] **3.3 Break up the long functions.** (M) `NpcFleet.step`, the sensing pass and the one-line
  `needsMotionQuestion` test, once the features have moved out of them.
- [ ] **3.4 Shrink `AGENTS.md`.** (M) It is 48 KB, mostly one paragraph per feature saying the same
  thing: opt-in, own random stream, one shared conflict test, audit only once seen. State that
  pattern once, and move each feature's detail to the reference docs. Aim for under 12 KB.
- [ ] **3.5 One layout for challenges.** (M) `lab/challenges.js` lists all 60 challenges in 2,030
  lines, and 19 of them keep their scripted parts in files of their own. Give every challenge its
  own file.
- [ ] **3.6 Arena storage before it fills.** (M) Two runs of every challenge with two drivers take
  78.3% of the 9 MB history cap, 87.1% with the road tests, and each new challenge adds about 1.3%.
  Move saved runs to storage without that limit, or keep compact summaries and export the rest.
- [ ] **3.7 Faster CI.** (S) The 76 Node checks run one after another in about ten minutes and the
  browser suites take up to seventeen. Split both across parallel jobs.
- [ ] **3.8 Keep the duplicated rules in step.** (S) The sharp-turn rule and the lane-join geometry
  each exist in Python and in JavaScript. Add a check that runs both on the same cases.
- [ ] **3.9 Trace the engine difference.** (M) The same seed gives different results in V8 and
  WebKit, and the cause has never been found. Find the first step where they part.

Exit: adding a feature needs its own file, its challenge, its test and one registration line.

## Phase 4: a benchmark that separates drivers

Rules passes all 12 seeded routes and all 60 challenges, because each challenge was written
together with the behaviour that passes it. And every driver chooses only among manoeuvres that
already passed the safety filter. Both make a pass easy to get and hard to learn from.

- [ ] **4.1 Measure how much is left to the driver.** (M) For each challenge, count the decisions
  where the surviving candidates include one that leads to a failure. If that number is near zero,
  the challenge tests the filter and not the driver.
- [ ] **4.2 An open track.** (L) A second scoring mode in which the filter advises but does not
  remove options (collisions that are about to happen are still braked for), so a driver's own
  judgment decides the outcome. Keep the current mode as the "guarded" track.
- [ ] **4.3 Scores beyond pass or fail.** (M) Report progress, comfort, margin kept and time lost
  as numbers per driver, so two passing drivers can still be ranked.
- [ ] **4.4 Held-out seeds.** (S) Keep a set of seeds and routes that no fix was tuned against, and
  report them separately.
- [ ] **4.5 A harder Rules baseline is not the goal.** Rules is the reference and the fallback.
  When it fails an open-track case, record that as a result; do not patch Rules until the case is
  understood.

Exit: the published comparison shows a difference between two models that the report can explain.

## Phase 5: release and presentation

- [ ] **5.1 Cut 0.3.0.** (S) Then release on a rhythm, so the unreleased section never reaches
  1,600 lines again.
- [ ] **5.2 Rewrite the top of the README.** (M) Lead with what the project is and the results
  table. The opening paragraph is one sentence of about 300 words listing every feature; replace it
  with a short list. Move the 60-row challenge table to the docs. Remove the two stray paragraphs
  after the licence line.
- [ ] **5.3 Make the repository page agree with the README.** (S) The GitHub description says "Jev
  drives the car"; the README says "Drive Lab". Settle it with [D1](#open-decisions), and set the
  homepage to the demo, which is empty today.
- [ ] **5.4 Split the reference.** (M) `docs/project-reference.md` is 2,608 lines. One page per
  feature, generated or linked from the feature registry of 3.1.
- [ ] **5.5 A guide to adding a challenge.** (S) The README invites scenario contributions; there
  is no page that says how.
- [ ] **5.6 Tidy the repository.** (S) About 26 local branches and 15 worktrees are left over from
  merged work.

## Phase 6: grow the world again

New scenarios resume here, one at a time, each passing the rule below. Candidates, in no order and
none committed:

- Time of day and season as first-class benchmark conditions.
- More Canadian cities, where a city brings a rule or a road layout the others lack.
- Driving with a gamepad or on a touch screen; the demo needs a keyboard today.
- Longer drives that string several situations together, like the road tests.

### Admission rule for new scenarios

A scenario is ready when all of these hold:

1. It teaches something no existing challenge does. Say what in one sentence.
2. It is built on the feature interface of Phase 3, and touches no core file.
3. The `bare` suite and every existing challenge give identical results before and after, timings
   aside.
4. The `city` suite still passes with it on.
5. It has one saved model case, checked live, and stays under the decision cost ceiling of 2.2.
6. Arena storage has been measured again.

## Parked

| Item | Why |
|---|---|
| A Claude brain | Deferred by decision; the driver interface stays open for it |
| Road elevation, camber, suspension | Large, and does not help compare drivers |
| Controlling a real vehicle | Never a goal |

## Open decisions

| | Decision | Recommendation |
|---|---|---|
| **D1** | Is this first a model showcase or a driving game? | The showcase, with the game as how people meet it: the one-line statement at the top |
| **D2** | Which models go in the first comparison, and what is the budget? | Jev, one small and one large LLM through a hosted provider, $5 |
| **D3** | Does the scenario freeze hold until Phase 1 exits, or until Phase 3? | Phase 1; allow at most one new scenario between phases after that |
| **D4** | Is `city` a second suite, or does it replace the current one? | A second suite, so earlier records stay comparable |
| **D5** | Is the next release 0.3.0 or 1.0? | 0.3.0 now; 1.0 when Phase 2 exits |

## Done so far

| When | What |
|---|---|
| 18 Sep | Real map in the browser, autopilot, Rules and Jev drivers, signals and stop signs |
| 23 to 28 Sep | Seeded benchmark, tyre and actuator model, realism and graphics; 0.2.0 |
| 29 Sep to 7 Oct | Occlusion, parking, more cities, coaching, Drive Lab, arena, replay, public demo, photo mode |
| 14 to 15 Oct | Every check in CI, Rules re-baselined, rendering artifacts fixed, LLM and decision-model drivers, four more cities |
| 19 Oct to 9 Nov | Lane changes, right of way, and the road situations behind most of the 60 challenges; practice library, debriefs, road tests |
