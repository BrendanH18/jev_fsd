# Adding a challenge

A challenge is one authored drive in the Drive Lab: a real street on one of the bundled maps, a fixed
seed, weather and time of day, a start and a route, and one scripted hazard placed so that the car
meets it every time. The same definition plays in the app (`/?challenge=<id>`), in the agent arena,
under Node (`scripts/arena_node.mjs`) and in the checks. This page says what a challenge is made of,
when a new one is ready to merge, and the checks to run. The [Drive Lab guide](drive-lab.md)
describes the existing sixty from the player's side.

## Before you start: the admission rule

New scenarios are admitted under the [admission rule in the roadmap](../ROADMAP.md#admission-rule-for-new-scenarios).
In short, a new challenge is ready when:

1. it teaches something no existing challenge does, and you can say what in one sentence;
2. it is built on the feature interface and touches no core file (a challenge for a new situation
   comes with its feature: see the [opt-in feature pattern](../AGENTS.md#opt-in-features));
3. the `bare` benchmark suite and every existing challenge give identical results before and after,
   timings aside;
4. the `city` suite still passes with it on;
5. it has one saved model case, checked live, and stays under the
   [decision cost ceiling](model-results.md#what-a-decision-costs-roadmap-22);
6. arena storage has been measured again ([below](#arena-storage)).

Read the roadmap's own wording before you begin; it is the rule, and this list only summarises it.

## How a challenge is defined

A challenge has four parts, all in one module of its own, `static/js/lab/challenges/<id>.js`, named
by its id. It exports `challenge` (the definition), `scenario(map, challenge)`, and optionally
`install(world, fleet, challenge, scenario, at)` and `step(world, fleet)`. What several challenges
share is in `static/js/lab/challenges/shared/` (`kit.js`: `laneScenario`, `installBase`,
`stepAuthored`, oncoming, all-way and through traffic). `static/js/lab/challenges.js` is the ordered
registry: import the new module there and add it to `MODULES` in lab order;
`scripts/test_challenge_modules.mjs` checks the layout.

1. **The definition** (the module's `challenge`, collected into `CHALLENGES` by `static/js/lab/challenges.js`): plain data the picker, the arena and
   the reports read.

   | Field | Meaning |
   |---|---|
   | `id` | Stable kebab-case id, used in links (`?challenge=<id>`), saved progress and arena history. Never reuse or rename one. |
   | `title`, `icon`, `difficulty`, `description`, `lesson` | What the picker and the debrief show. The lesson says what the driver should have done. |
   | `map`, `weather`, `time`, `seed` | The conditions. Seeds are unique; recent challenges use `<n>042`. |
   | `hazard` | The kind of challenge: `challengeScenario` dispatches on it. |
   | `street` | The street the site is looked for on, so the challenge stays put if the map gains sites elsewhere. |
   | feature flags | The `World` options the challenge turns on (`geese: true`, `hidden: true` for hidden hazards, `park: true` to park at the end, and so on). |
   | `version` | Bump it when an existing challenge's conditions change, so earlier results no longer compare. New challenges leave it out (version 1). |
   | `date`, `utcOffset`, `limit_s` | Optional: a date and time zone for the sky and the sun, and a time limit other than 180 s. |

2. **The scenario** (the module's `scenario`, called by `challengeScenario(map, challenge)`): where the car starts (`start`:
   edge, lane, `s`, position, heading), its `route` (usually `routeFromLanes` from
   `static/js/demo/routing.js`, so no server is needed), the `goal`, `traffic_seed`, a `tags` summary,
   and one field describing the hazard's site (for example `geese: { edge, s, sigma }`). It must be
   deterministic: `test_drive_lab.mjs` builds it twice and compares.

3. **Installing it** (the module's `install`, called by `installChallenge(world, fleet, challenge, scenario)`): places the hazard's
   actors from the scenario's field and merges their ids into `world.challenge`. Set
   `world.challenge.triggered` once the hazard is under way; the evaluation records the `hazard`
   event from it, and the checks require one. Background curb events are switched off for every
   challenge, so only the authored hazard happens.

4. **Stepping it, if needed** (the module's `step`, called by `stepChallenge(world, fleet)`; the default is `stepAuthored`): for a hazard that has to react to the
   car while the drive runs, such as a trigger distance or an actor that hands over to ordinary traffic.

`setupChallenge` in `static/js/lab/evaluation.js` builds every challenge world, in the app, the
arena and the tests alike: it turns the challenge's feature flags into `World` options
(`geese: !!challenge.geese`), sets the clock from `time`, builds the scenario, then installs it.
A new feature flag is added there.

## A worked example: "Goose crossing"

"Goose crossing" is one of the simplest recent challenges: one feature, one site, one group of actors
and no scripted traffic.

Its definition, exported as `challenge` from `static/js/lab/challenges/goose-crossing.js`:

```js
export const challenge = { id: "goose-crossing", title: "Goose crossing", map: "ottawa", weather: "dry", time: "afternoon",
  seed: 53042, icon: "⋯", difficulty: "Patience", hazard: "geese", geese: true, street: "Clemow Avenue",
  description: "Clemow Avenue in the Glebe runs between Central Park and Patterson's Creek Park, …",
  lesson: "Geese cross slowly in single file and often stop in the road. Stop well short of them …" },
```

Its scripted parts are in the same module:

- `gooseSites(map, street)` finds the site from the map's data rather than hard-coding coordinates:
  a span of the parks layer with a park on both sides, on a two-way street with one lane each way,
  with a straight run-up long enough to start in.
- `geeseScenario(map, challenge)` starts the car from a standstill `GS_START_M` short of the
  crossing, routes it `GS_GOAL_M` past, and returns `geese: { edge, s, sigma }`. It throws a clear
  error if the site is missing, so a map change cannot silently move the challenge.
- `placeGeese(world, spec)` stops the world's own geese from appearing (`geese.target = 0`), places
  one authored gaggle that sets off once the car's front is `GS_TRIGGER_M` away, with one adult
  scripted to stand in the car's lane for `GS_STOP_S`, and returns `{ gaggleId, stopperId, at,
  triggered: true }`.

The module exports the hooks the registry calls, and one line joins it to the World options:

```js
// static/js/lab/challenges/goose-crossing.js
export const scenario = geeseScenario;
export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeGeese(world, scenario.geese));
}
// static/js/lab/challenges.js: import it and list it in MODULES
// setupChallenge (lab/evaluation.js), in the World options
geese: !!challenge.geese,
```

Its checks live with the feature, in `scripts/test_geese.mjs`: Rules and the cautious agent stop
short, wait for the last goose and arrive with a clean result; a driver who goes as soon as the
first geese are past its lane fails with `wildlife_conflicts`; and `CHALLENGES.filter(c => c.geese)`
is exactly this one challenge. The same script writes the saved model case
(`--write-snapshot` writes `data/snapshots/goose_crossing.json`). The Drive Lab guide has its row in
the challenge table and a short section.

## Checks to run

Run each with Node 22 and `--experimental-default-type=module`, one at a time; agents run them on
Boat with `scripts/boat-check.sh -- CMD`. CI runs every Node check, the fixture check and the model
recordings on the pushed commit, so while working run the feature's own test and
`scripts/test_drive_lab.mjs` and leave the rest to CI. CI doesn't compare unchanged results with
the baseline, record the arena storage figure or verify the saved model case live; those stay to do
before hand-off ([checking work](../AGENTS.md#checking-work)).

- **The feature's own test** (`scripts/test_<feature>.mjs`): the challenge passes with `rules` and
  `cautious` (`evaluateChallenge(...).pass`), a driver who makes the mistake the lesson warns about
  fails with the feature's metric, and the feature stays off in every other challenge.
- **`scripts/test_drive_lab.mjs`**: every challenge builds the same scenario twice, has a route over
  100 m, and completes cleanly with Rules and the cautious agent, with a `hazard` event and a result
  that survives being saved to arena history. It takes about two minutes, close to CI's per-script
  limit; split a slow check out rather than raise the limit.
- **Arena storage**: `test_drive_lab.mjs` prints the share of the history budget two arena runs take
  and fails over it. Record the new figure ([below](#arena-storage)).
- **Jev fixtures**: `scripts/build_jev_fixtures.mjs --check`, after any change to sensing,
  candidates or question wording.
- **Model recordings**: `scripts/test_model_recording.mjs` replays a committed recording that
  includes the first challenge. Adding a challenge at the end of `CHALLENGES` leaves it unchanged; a
  change to physics, traffic, sensing, candidates, the decision state or the LLM prompt does not, and
  is rewritten with `--write` only when intended.
- **Practice and road tests**, if you touched them: `scripts/test_practice_library.mjs` and
  `scripts/test_road_test.mjs`.
- **Unchanged results**: the seeded `bare` suite (`scripts/bench_node.mjs`, and `/bench` in WebKit)
  against the newest record of the same map, preset and weather in
  [the Rules baseline](rules-baseline.md), and the `city` suite (`--features city`).
- **The saved model case**: write it with the feature test's `--write-snapshot`, check it offline
  with `uv run scripts/verify_jev.py --offline`, and live with `uv run scripts/verify_jev.py
  data/snapshots/<case>.json`. The live check spends model credits; agree the budget first.
- **Docs**: a row in the [Drive Lab](drive-lab.md) challenge table and a short section, the
  challenge count wherever the docs give it, and a changelog entry.

## Arena storage

Saved arena runs share one budget. The figures recorded so far, moved here from `AGENTS.md`:

Saved arena runs live in IndexedDB (20 runs within 200 MB); the 9 MB `MAX_HISTORY_BYTES` cap in `static/js/lab/history.js` now applies only to the localStorage fallback, and the figures below are of that cap. Since compact decisions are folded together (`static/js/lab/trace.js`), two runs of every challenge with Rules and the cautious agent, measured in Node (2026-11-09) by `scripts/test_drive_lab.mjs`, take 78.3% (7,389,066 bytes) with 60 challenges ("Road closed" adds 2.2%, "Room to park" 1.9%, "Follow the officer" 1.4% and "Don't splash" 1.3%, each measured on its own; "On your bumper" 1.7%, "Bridges freeze first" and "One car at a time" 1.8% together, "Chasing the ball" 1.4%, "Goose crossing" 1.3%, "Pothole season" 0.8%, "Into the sun" 2.0%, "Reverse lights" 1.4%, "Fresh green" 0.7%, "Space to react" adds 1.9%, "Left on red" adds 1.3%, "Dip your lights" 1.2%, "Both ways" 0.6%, "After midnight" 1.3%, "No left turn" adds 2.4%, "Stop for the guard" 1.5%, "Wait for the far curb" 1.0%, "Buses only" 0.8%, "Over the humps" 0.9%, "All walk" 1.5%, "Collection day" 1.3%, "Give them room" 0.7%, "Take turns" 1.5%, "Behind the plow" 0.8%, "Blind left" 2.0%; 98.2% with 26 before folding). Road tests are not in that run: the arena includes them only when asked, and two runs of both with the same two drivers add 8.8% (`scripts/test_road_test.mjs`). Measure again after adding a challenge or more to each decision record.

Add the new challenge's share to this list when you measure it.

## Rules for practice, debriefs and road tests

These rules, moved here verbatim from `AGENTS.md`, apply to every challenge.

**Challenge practice library** (`lab/practice.js`, `ui/lab.js`): compact manual progress is stored separately from the last 20 full reports, keyed by challenge id and authored version. Only the original unchanged manual attempt counts; AI/mixed drivers, replay branches and resets do not. Starting another score session on the same challenge page invalidates eligibility until an authored retry reloads it. Clean completion reuses `bench/metrics.js` `failures()`, including parking where required, rather than the coaching grade. Changing the time through photo mode marks the challenge modified. In Squeeze in, Finish & review recognizes a manual car stopped inside a legal space using `spacesAlong` and `parkedPose`. Checks: `scripts/test_practice_library.mjs`, `static/tests/practice-tests.js` through `/tests`, and the finish integration cases in `scripts/test_browser_pages.py`.

**Challenge debriefs** (`ui/drive-report.js`): use `challengeFailures` in `lab/practice.js` for the same arrival, safety and parking verdict as manual progress. Keep coaching grades separate. Incident replay must match the recorder's recording id and drive session; incident `at_s` is drive-relative, while checkpoint `t` is world time. Link only events still inside the recording, with up to three seconds of lead-in; older reports and discarded replay futures must never seek a different recording.

**Road tests** (`lab/road-tests.js`, `lab/examiner.js`, `ui/road-test.js`): `ROAD_TESTS` are kept out of `CHALLENGES` but play through the challenge path (`challengeById`, `challengeScenario`, `installChallenge`), so arena runs, test_drive_lab and the benchmark never see them. The examiner only observes: `RoadTestObserver` is attached as `drive.observer` to road test drives alone (main.js `startDrive`, evaluation.js) and only adds incidents, so other reports stay field-for-field identical. The sheet is a pure function of the report: fails come from `challengeFailures`, so a new audit in `failures()` fails a road test automatically (filed under "Other" until `FAIL_CATEGORY` names it). Storage reuses `practiceEligible` under its own key. Checks: `scripts/test_road_test.mjs`, `static/tests/road-test-tests.js`.
