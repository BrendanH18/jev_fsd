# Lane joins and the sharp-turn limit agree in Python and JavaScript, 26 November 2026 (ROADMAP 3.11)

Starting tree: `7209939a`. Node 22.23.5 and Python 3.12.3 in Boat sandboxes, Rules, lockstep, 40
traffic cars, suite seed 1. The unchanged tree and the changed tree each ran in their own sandbox,
each suite against its own server. No live model calls, no new dependencies.

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

## Results

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
committed. The committed baseline in `data/runs/` and `docs/rules-baseline.md` are re-recorded on
the merged tree.

## Recordings and fixtures

- `scripts/test_model_recording.mjs` passes unchanged: the stub recording
  `data/recordings/stub-llm-kitsilano-s1.json` did not drift.
- `scripts/build_jev_fixtures.mjs --check` passes unchanged.
- Published tapes replay on their declared revision and were not touched. Replayed on both trees
  with `--check replay` to see which this change adds to those that no longer replay on main:

| Tape (`data/recordings/`) | On `7209939a` | With this change |
| --- | --- | --- |
| `20261121-075524-jev` (Kitsilano city, 12 drives) | all 12 as recorded | none as recorded |
| `20261121-092730-llmclaudehaiku55` (Kitsilano city, 12 drives) | all 12 as recorded | none as recorded |
| `claude-haiku-arena-2026-11-20`, `claude-haiku-open-2026-11-20`, `jev-open-2026-11-20` (62 drives each) | all 62 as recorded | 58 as recorded; `scramble`, `roundabout-gap`, `bridges-freeze-first` and `road-test-kitsilano` drift |
| `jev-arena-2026-11-11`, `deepseek-arena-2026-11-11` (62 drives each) | 8 already drift (`door-zone`, `snow-plow`, `zipper`, `roundabout-gap`, `make-room`, `on-your-bumper`, `road-test-kitsilano`, `road-test-toronto`) | 10 drift: those and `scramble`, `bridges-freeze-first` |
| `deepseek-door-zone-2026-11-11`, `liquid-d1-door-zone-2026-11-11`, `luna-door-zone-2026-11-11` | already drift | still drift |
| `granite-local-2026-11-11` (2 drives) | as recorded | as recorded |

  So five tapes that replay exactly on main today stop doing so on the merged tree: the two city
  tapes entirely, and four drives of each of the three November 20 arena tapes. A drifted replay
  runs out of recorded answers and falls back to Rules, so its verdicts are not the model's and are
  not reported here. The Rules results for `scramble` and `bridges-freeze-first` are unchanged in
  every saved field; the tapes are keyed by the full decision request, which differs.

## Checks

On Boat, Node 22.23.5: `tests/test_parity.py` (7 tests), `tests/test_routing.py`,
`tests/test_doc_links.py`, `ruff check`, `ruff format --check`, `npm run lint`,
`scripts/build_jev_fixtures.mjs --check`, and the 109 `scripts/test_*.mjs` files that build a route
or traffic (`node scripts/node_checks.mjs`, all passed). CI runs the full suite.
