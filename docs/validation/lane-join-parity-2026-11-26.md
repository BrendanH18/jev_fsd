# Lane joins and the sharp-turn limit agree in Python and JavaScript, 26 November 2026 (ROADMAP 3.11)

Starting tree: `7209939a`. Node 22.23.5 and Python 3.12.3 in Boat sandboxes, Rules, lockstep, 40
traffic cars, suite seed 1. The unchanged tree and the changed tree each ran in their own sandbox,
each suite against its own server. No live model calls, no new dependencies.

**Merged 27 November 2026**, as ROADMAP D9 decided: on top of main `309e9a9f`, with a fix for the
fog failure the change exposed ([Fog `s1-3`](#fog-s1-3)), suite `v2` as the active suite
([Suite `v2`](#suite-v2)) and a new Rules baseline
([results on the merged tree](#results-on-the-merged-tree-27-november)). The sections up to
[the 26 November results](#results-of-the-change-alone-26-november) describe the change as built on
`7209939a`; the later ones describe the merged tree.

`tests/test_parity.py` (ROADMAP 3.8) runs the Python router and the JavaScript lane joins on
`tests/fixtures/parity_cases.json`. It had three join cases marked `known_difference` (the roadmap
and the 20 November audit say four: a `grep` count that includes the fixture's own description) and
one comparison no fixture geometry could reach, a turn of exactly 130°.

## What differed, and which side changed

| Difference | Python (`jev/routing.py`) | JavaScript before | Changed |
| --- | --- | --- | --- |
| An outgoing piece under 3 m | `build_route` rounds the corner (`_round_corner`) or spreads the shift (`_blend`) whatever the length. | `joinLanes` (`static/js/map/mapdata.js`) did not join at all: it chained the lanes end to start. At a right turn the path ran past the corner and backed up (5.3 m longer and 1.8 m off in the fixture), and a shifted lane stepped sideways. | **JavaScript.** `joinLanes` no longer has the 3 m exception. Chaining end to start is the mistake the join exists to prevent. |
| Which headings decide the 20° rounding rule | The turn angle between the two edges: the last segment of one edge and the first of the next. | The lane lines' own directions over their last and first 3 m. | **JavaScript.** `joinLanes` takes the edges' turn angle as `turn`; `NpcPath.append` (`sim/npc.js`) and `routeFromLanes` (`demo/routing.js`) pass `map.turnAngle`. Without `turn` (contraflow rider lines, which are not a pair of edges) the lane directions still decide. |
| A turn of exactly 130° | Allowed (`>` refuses). | `sim/npc.js` refused it (`<` kept); `demo/routing.js` allowed it. | **JavaScript** (`sim/npc.js`, both filters, now `<=`), and Python now compares radians with `SHARP_TURN = SHARP_TURN_DEG * math.pi / 180`, the number both JavaScript files use, instead of converting the angle to degrees. |

The rounding itself (`_round_corner`) already used the 3 m lane directions on both sides; only the
decision to round differed. Two rules were possible for that decision. The router's was kept, for
two reasons:

- **It changes the fewest published results.** The Python router's output is unchanged, so every
  route the server plans is the same: the route fingerprints of the bare and city suites
  (`4c9554f6790d5765`, `1607d4bf5bdaaeec`) and of all five hard-city legs are the same before and
  after, `data/suites/` needs no new version for routes, and `tests/test_routing.py` passes
  untouched. Moving Python to the lane directions would have changed the car's own path through
  every traffic circle instead.
- **On real maps the two rules only part at traffic circles**, where the router's answer is the
  one the car has been driving and passing with. Over the twelve bundled packs (24,147 lane pairs
  at turns of 130° or less) the edge angle is never 20° or more while the lane angle is under it;
  the reverse happens at 19 joins (edges turn 5° to 19°, lane lines 21° to 33°, ends 0.1 to 0.5 m
  apart), on Kitsilano all seven between the ring segments of traffic circles. There the router spreads the shift over the join, and traffic
  now does too.

The Python comparison in radians changes no route: no turn in any bundled pack is within 10⁻⁶ rad
of 130°. Map packs are untouched (`jev/osm/` does not use the router; `PACK_VERSION` stays 6).

What changes is traffic's path at traffic circles, and routes built in the browser there:

| Map pack | Outgoing lane under 3 m (now joined) | Of those, at a turn of 20° or more | Ring joins now blended, not rounded |
| --- | --- | --- | --- |
| Kitsilano (`623b012bc8b5`) | 16 | 16 (entries to traffic circles, turns of about 80° onto a ring segment under 2 m long, lanes up to 2 m apart) | 7 |
| Mount Pleasant (`7165f1c807a8`) | 20 | 19 | 6 |
| Halifax (`49db0d437c8c`) | 4 | 2 | 4 |
| Victoria (`d7454a9751b7`) | 25 | 0 (lane shifts on near-straight joins) | 0 |
| Edmonton (`3e794edbefcb`) | 1 | 0 | 1 |
| Saskatoon (`ca5573a8d934`) | 1 | 0 | 0 |
| Calgary (`a53c5bcf6438`) | 0 | 0 | 1 |
| The other five | 0 | 0 | 0 |

## The fixture

The three marks are removed. Five join
cases were added, all of which fail against the old JavaScript: a 1.9 m outgoing lane 1.8 m from
the incoming one at a right turn (a traffic circle entry), 2 m at a left turn, 0.6 m at a right
turn, and two ring-like joins where the edges turn under 20° and the lane lines over it (one with a
0.3 m gap, one with ends that meet). `scripts/parity_js.mjs` also reports the limit itself
(`sharp_limit`): the turn angle set to exactly the limit, to minus the limit and to the next number
above it. The test requires the three sides to agree on each and the limits to be the same number.

## Results of the change alone, 26 November

"Changed" counts drives whose result differs in any field but `wall_ms`, latencies and provenance
(`saved_at`, `source_commit`, `source_dirty`, `name`).

| Suite | Drives | Before | After | Changed |
| --- | --- | --- | --- | --- |
| Kitsilano bare, dry | 12 | 12/12 | 12/12 | 10 (all but `s1-3`, `s1-7`) |
| Kitsilano city, dry | 12 | 12/12 | 12/12 | 11 (all but `s1-1`) |
| Hard city slice | 5 | 5/5 | 5/5 | 5 |
| Challenges and road tests | 62 | 62/62 | 62/62 | 2 (`roundabout-gap`, `road-test-kitsilano`) |

No drive failed on either tree, so nothing was tuned. No route changed: the differences are the
traffic the car meets. Fields that changed, with the counters named (the rest are times, gaps,
accelerations, lane offsets, decision counts and event times):

| Drive | Time before → after (s) | Counters |
| --- | --- | --- |
| bare `s1-1` | 87.1 → 86.9 | |
| bare `s1-2` | 142.8 → 142.7 | `lane_changes` 1 → 3 |
| bare `s1-4` | 139.4 → 139.4 | (`rms_jerk`, `max_jerk` only) |
| bare `s1-5` | 107.6 → 103.9 | |
| bare `s1-6` | 173.3 → 172.8 | |
| bare `s1-8` | 154.2 → 154.2 | (`min_gap_m` only) |
| bare `s1-9` | 139.3 → 171.5 | `safety_brakes` 0 → 1 |
| bare `s1-10` | 147.8 → 147.8 | (`decisions` only) |
| bare `s1-11` | 100.8 → 100.9 | |
| bare `s1-12` | 157.1 → 157.1 | |
| city `s1-2` | 230.8 → 218.7 | |
| city `s1-3` | 172.3 → 169.0 | `safety_brakes` 1 → 0 |
| city `s1-4` | 322.9 → 355.1 | `safety_brakes` 1 → 2 |
| city `s1-5` | 191.8 → 148.7 | |
| city `s1-6` | 246.3 → 256.1 | `safety_brakes` 2 → 1 |
| city `s1-7` | 253.5 → 246.6 | |
| city `s1-8` | 291.8 → 214.6 | `amber_lights_run` 0 and `fresh_green_conflicts` 0 no longer reported (a feature's fields appear once the drive has seen it) |
| city `s1-9` | 275.2 → 275.1 | |
| city `s1-10` | 207.5 → 217.4 | `safety_brakes` 2 → 1; `parking_conflicts` 0 now reported |
| city `s1-11` | 201.9 → 215.2 | `safety_brakes` 2 → 3 |
| city `s1-12` | 294.4 → 301.5 | `safety_brakes` 4 → 3 |
| hard `s1-4` (23:30, dry) | 296.7 → 296.5 | `safety_brakes` 2 → 2, at other places |
| hard `s1-7` (06:30, dry) | 235.2 → 242.7 | `glare_seconds` 0.3 → 0 |
| hard `s1-6` (23:30, fog) | 275.2 → 252.5 | |
| hard `s1-3` (snow) | 318.9 → 310.4 | |
| hard `s1-10` (parking) | 236.9 → 230.2 | `safety_brakes` 2 → 1; `parking_conflicts` 0 now reported |
| `roundabout-gap` | 37.2 → 36.9 | (its route through the circle is built by `routeFromLanes`: `min_headway_s` 0.48 → 0.32, `min_ttc_s` 3 → 2.8) |
| `road-test-kitsilano` | 254.6 → 259.3 | `hard_brakes` 6 → 7 |

Suite totals moved little: bare `safety_brakes` 8 → 9, average speed 23.2 → 22.8 km/h and score
62.5 → 59.6; city `safety_brakes` 18 → 16, average speed 17.2 → 17.6 km/h and score 48.6 → 51.7;
the arena's score stayed 65.

The run files are in `data/runs/lane-join-parity/before/` and `after/` in the worktree that made
the change (`bare.json`, `city.json`, `hard.json`, `arena.json.gz` and their logs); they are not
committed. The committed baseline was recorded again on the merged tree
([below](#results-on-the-merged-tree-27-november)).

## Fog `s1-3`

On the lane-join tree Rules failed to yield on Kitsilano city fog `s1-3` (seed 1, a tuned route): at
t = 54.8 s it crossed the yield line of the Trafalgar Street and West 6th Avenue traffic circle at
5.5 m/s, braking hard, while `car_18`, which had come in at the opposite entry, was in the ring 16 m
of arc from the car's entry at 6 m/s. On main the same route passed. A per-tick trace of both trees
(`bench_node.mjs --trace`) showed the same approach on both: the car comes up Trafalgar Street at
8.3 m/s, the street's limit, with 28 m of sight, and sees `car_18` only when it is 28 m away. On main
`car_18` was 1.3 s further along and came into view with 10 m to the line, enough to stop; with
traffic's lane joins fixed it came into view with 5.8 m to the line, which at 8.3 m/s is not.

**The car was wrong, not the audit.** The audit counts every vehicle in the ring (`ringBusy`,
`sim/roundabout.js`), seen or not, and `car_18` was in it. Sensing took a ring with no traffic *in
sight* as an empty one, however little of the ring the car could see: `crossingTraffic`
(`brain/sensors.js`) looked for circulating and joining vehicles among the visible ones only, so in
fog the approach was planned as if the ring were clear until a vehicle appeared.

**Fix.** Within stopping distance of a roundabout's yield line (the car's stopping distance at its
comfortable rate plus a second to react), sensing now takes the ring as occupied while the car cannot
see as far round it as a vehicle that would hold the entry can be: `ringLookPoint`
(`sim/roundabout.js`) is the point a vehicle at the street's limit would be at now to reach the entry
within the yield horizon, on a small traffic circle the far side of the ring. Weather and light alone
decide (`visibility.rangeAt`), as they do for the vehicles the car would be looking for. The car
slows as for a stop until the ring comes into view and goes on if it is then clear; inside the 6 m
stop zone it goes by the traffic it sees, as before, so a ring too large to see across cannot hold it
at the line for good. In clear daylight the ring is in sight long before the car is within stopping
distance, so nothing changes there: every dry, rain and snow result, the hard city slice, the eleven
other maps and all 62 arena drives with Rules and with the cautious agent are identical with and
without the fix. In fog five of the twelve routes change (`s1-3`, `s1-4`, `s1-8`, `s1-9`, `s1-12`).

`scripts/test_fog_approach_speed.mjs` checks the look point, the sensing (occupied within stopping
distance in fog; not further back, not once the ring is in view, not in clear weather), the rejected
manoeuvres, and closed loop with Rules: alone, the car has the ring in view 8.9 m short of the line
at 3.4 m/s (8.3 m/s before); with a car timed to come into the ring as it arrives, as in the drive, it
waits (before, it entered in front of it at four of the four timings checked). The check fails
without the fix.

**Not closed, and recorded in ROADMAP 1.8.** With 28 m of sight a car can still come in at the far
entry after the driven car has seen the ring empty and gone: over 31 arrival times 2 m apart, 2 still
fail (4 before the fix, at other times). Closing it means reaching the line slowly enough to stop
there, and Rules does not: it scores a manoeuvre on its end speed alone, so before a bend that slows
every manoeuvre by the end it takes the one that went fastest on the way, and comes up to a yield line
above its own target speed. Scoring the peak speed closed all 31, but it changed most suites and
failed two dry city routes (a close pass of a cyclist on `s1-7`, with and without parking, and
parking on `s1-12`), so under standing policy 4.5 it was measured and left out.

## Suite `v2`

The change alters results under suite `v1`'s conditions (11 of 12 Kitsilano city dry routes, and
routes in fog, rain and snow), so `v1` cannot label runs made after it.
[`data/suites/v2.json`](../../data/suites/v2.json) has `v1`'s members unchanged (the 60 challenges
and two road tests with their seeds, versions and map fingerprints; Kitsilano city seed 1 in four
weathers with route fingerprint `1607d4bf5bdaaeec`; the held-out plan) and is defined from
`309e9a9f`, main before this change. No route, map or drive differs: only the tree the drives run on.

- **Writers.** `scripts/canonical_suite.mjs` loads every definition (`SUITES`) and names `v2` the
  active one (`activeSuite`). `bench_node.mjs`, `arena_node.mjs` and the merge tools label a new
  complete run `v2`.
- **`v1` artifacts still verify as `v1`.** An artifact is checked against the definition it declares
  (`definitionFor`): `canonical_suite.mjs --check` passes a `v1` report whose inputs match `v1`,
  `merge_recordings.mjs` and `merge_bench_recordings.mjs` keep a `v1` label on parts that declare it
  and refuse to mix them with `v2` parts, `arena_node.mjs --check submission` checks a tape against
  the suite it declares, `compare_repeats.mjs --plan` loads the suite its plan names, and
  `build_results.py` loads every definition in `data/suites/`. Comparisons across versions stay
  refused (`compatibleSuiteVersions`, the leaderboard's per-version tables).
- **Nothing was published as `v1`.** Every published row before this change is `legacy`. The Rules
  city runs recorded here are the first numbered rows, as `v2`.
- **The repeat plan** for ROADMAP 7.5 had not been run. It is reissued for `v2`
  ([plan](arena-repeat-plan.md), `arena-open-repeats-v2.json`) with the same drivers, track and
  repeat count.
- **The hard city slice** (`data/suites/hard-city-v1.json`) pins routes and conditions, which did not
  change, and stays as it is; all five legs pass.

Checks: `scripts/test_5k_bench_canonical.mjs` (the active suite is `v2`; a `v1`-declared artifact is
explained against `v1` and stays `v1`), `scripts/test_merge_recordings.mjs` (`v1` parts merge as `v1`;
parts from two versions are refused; the reissued plan), `scripts/test_5k_submissions_repeats.mjs` (a
`v1` plan with `v1` tapes), `tests/test_5k_results_publication.py`.

## Results on the merged tree, 27 November

Main `309e9a9f` merged with the change, the fog fix and suite `v2` (`f58d3ad`): Node 22.23.5 in Boat
sandboxes, Rules, lockstep, 40 traffic cars, suite seed 1, every leg from a clean checkout of that
commit. "Before" is the committed reference each run replaces (`docs/rules-baseline.md`), and for the
challenges and road tests a run of main `309e9a9f` the same day. "Changed" counts drives that differ
in any field but timings and provenance.

| Suite | Drives | Before | After | Changed |
| --- | --- | --- | --- | --- |
| Kitsilano bare, dry | 12 | 12/12 | 12/12 | 10 (all but `s1-3`, `s1-7`) |
| Kitsilano city, dry | 12 | 12/12 | 12/12 | 11 (all but `s1-1`) |
| Kitsilano city, fog | 12 | 12/12 | 12/12 | 11 (all but `s1-1`) |
| Kitsilano city, rain | 12 | 12/12 | 12/12 | 11 (all but `s1-1`) |
| Kitsilano city, snow | 12 | 12/12 | 12/12 | 12 |
| Kitsilano city, dry, destination parking | 12 | 12/12 | 12/12 | 11 (all but `s1-1`) |
| City dry, two routes on each of the other eleven maps | 22 | 22/22 | 22/22 | 10 (Calgary 2, Edmonton `s1-2`, Halifax `s1-1`, Mount Pleasant 2, Québec City `s1-1`, Saskatoon 2, Winnipeg `s1-1`) |
| Hard city slice | 5 | 5/5 | 5/5 | 5 (as on 26 November; the fog fix changes none) |
| Challenges and road tests, Rules | 62 | 62/62 | 62/62 | 2 (`roundabout-gap`, `road-test-kitsilano`) |
| Challenges and road tests, cautious agent | 62 | 62/62 | 62/62 | 2 (`roundabout-gap`, `road-test-kitsilano`) |

Every leg of the weekly city matrix passes (`bench.yml`: Kitsilano city in fog, rain and snow, with
dry, bare and the hard city slice), as do the seventeen references `docs/rules-baseline.md` lists:
94 of 94 drives. The dry Kitsilano times and counters are those of the 26 November table above: merging
main (#135, rendering and the compound drive) and the fog fix change no dry result. Per-route times, the
counters that moved and the totals are in
[the baseline](../rules-baseline.md#references-on-suite-v2-after-the-lane-join-parity-fix--2026-11-27).

The fog fix was measured apart from the lane joins, on the merged tree without it and with it:

| Suite | Without the fog fix | With it | Changed by it |
| --- | --- | --- | --- |
| Kitsilano city, fog | 11/12 (`s1-3` failed to yield) | 12/12 | 5 (`s1-3`, `s1-4`, `s1-8`, `s1-9`, `s1-12`) |
| Kitsilano bare dry; city dry, rain, snow and dry with parking | 60/60 | 60/60 | 0 |
| The other eleven maps | 22/22 | 22/22 | 0 |
| Hard city slice | 5/5 | 5/5 | 0 |
| Challenges and road tests, Rules and the cautious agent | 62/62 each | 62/62 each | 0 |

Arena drives that changed against main, with every counter that moved:

| Drive | Driver | Time before → after (s) | Counters |
| --- | --- | --- | --- |
| `roundabout-gap` | Rules | 37.2 → 36.9 | `min_headway_s` 0.48 → 0.32, `min_ttc_s` 3 → 2.8, decisions 142 → 141 |
| `roundabout-gap` | cautious | unchanged | `min_headway_s` 0.92 → 1.09, `min_ttc_s` 4.6 → 4.3 |
| `road-test-kitsilano` | Rules | 254.6 → 259.3 | `hard_brakes` 6 → 7, decisions 799 → 816 |
| `road-test-kitsilano` | cautious | 342.1 → 344 | decisions 1,085 → 1,092 |

**The compound drive** (`rush-hour`, #135) is unchanged in what it measures:
`scripts/test_compound_drive.mjs` passes with its saved model case as committed, and
`scripts/driver_latitude.mjs --only rush-hour` finds 3 of 167 sampled decisions with an ordinary
manoeuvre that fails, as on 26 November, so nothing was retuned.

## Recordings and fixtures

- `scripts/test_model_recording.mjs` passes unchanged: the stub recording
  `data/recordings/stub-llm-kitsilano-s1.json` did not drift.
- `scripts/build_jev_fixtures.mjs --check` passes unchanged (no stale fixture), with the fog fix too.
- Published tapes were not touched. Each already declares the revision it replays exactly on
  (`source_commit` in its manifest, or `replay_source_commit` in its published row, from
  `LEGACY_REPLAY_SOURCES` in `scripts/build_results.py`), so no declaration had to change: none
  claimed main. Replayed on 27 November on the declared revision and on the merged tree
  (`scripts/report_replay_drift.py run`, Node 22.23.5):

| Tape (`data/recordings/`) | Declares | On the declared revision | On the merged tree |
| --- | --- | --- | --- |
| `20261121-075524-jev` (Kitsilano city, 12 drives) | `9b53a07` | all 12 as recorded | none as recorded |
| `20261121-092730-llmclaudehaiku55` (Kitsilano city, 12 drives) | `9b53a07` | all 12 as recorded | none as recorded |
| `jev-open-2026-11-20`, `claude-haiku-arena-2026-11-20`, `claude-haiku-open-2026-11-20` (62 drives each) | `a616469` | all 62, each tape | 58; `scramble`, `roundabout-gap`, `bridges-freeze-first` and `road-test-kitsilano` drift |
| `jev-arena-2026-11-11`, `deepseek-arena-2026-11-11` (62 drives each) | `dcfc663` | all 62, each tape | 52; `door-zone`, `snow-plow`, `zipper`, `roundabout-gap`, `make-room`, `on-your-bumper`, `road-test-kitsilano` and `road-test-toronto` drifted already, now `scramble` and `bridges-freeze-first` too |
| `deepseek-door-zone-2026-11-11`, `liquid-d1-door-zone-2026-11-11`, `luna-door-zone-2026-11-11` (1 drive each) | `dcfc663` | as recorded, each tape | drift, as before |
| `granite-local-2026-11-11` (2 drives) | `dcfc663` | as recorded | as recorded |

  So five tapes that replayed exactly on main before this change no longer do: the two city tapes
  entirely, and four drives of each of the three 20 November arena tapes. A drifted replay runs out
  of recorded answers and falls back to Rules, so its verdicts are not the model's and are not
  reported here. The Rules results for `scramble` and `bridges-freeze-first` are unchanged in every
  saved field; the tapes are keyed by the full decision request, which differs.
- The published rows, the leaderboard's replay commands and the weekly replay drift workflow
  (`.github/workflows/replay-drift.yml`, report-only) read those declared revisions, so none of
  them claims a replay on main; `docs/model-results.md` now lists what replays where.
- The four exported replays the demo plays (`static/replays/*.json`: sampled poses and signal states
  from exact replays of 20 November tapes) are data and were not exported again; none is of a drive
  that drifted. The checks that read them and the published results pass (`scripts/test_replay.mjs`,
  `scripts/test_5k_arena-ui_replay.mjs`, `scripts/test_results_page.mjs`,
  `scripts/test_demo_bench_runs.mjs`, `tests/test_results.py`, the demo build).

CHECKS_SECTION
