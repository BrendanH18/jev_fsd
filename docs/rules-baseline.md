# Rules benchmark baseline — 2026-10-22 (right on red)

This rerun covers right turns on red and two fixes to left turns at a signal. The driven car and
traffic turn right on red after a full stop wherever the map allows it (every bundled map but
Montréal's), and the audit counts such a turn as legal only after a full stop. Turning left, the
car now waits for an oncoming car pulling away from its own line, allows for oncoming vehicles
speeding up, and no longer takes the left indicator of a car pulling out of a parking spot for a
left turn. "Before" is `b8ce8a8` from a `git archive`; "after" is the same commit with this change.
Both ran on the same day in the same harness, in WebKit and in V8, so the difference between them
is this change alone.

## Method

As on the earlier 2026-10-22 record: production `/bench`, Rules, suite seed 1, 40 traffic cars,
lockstep, in WebKit through `scripts/shot.swift` on macOS 27.0.1. Kitsilano ran 12 routes in dry,
fog, rain and snow; the other eleven maps ran two-route dry smoke suites. The same suites also ran
in V8 (Node 22.23.4) through `scripts/bench_node.mjs`. The WebKit Kitsilano dry run is
[`20261022-153156-rules.json`](../data/runs/20261022-153156-rules.json). The
[machine-readable record](validation/rebaseline-2026-10-22b-rules.json) has every summary and
per-route result, before and after, in both engines, and how often the car turned right on red.
Night was not run.

The "before" columns reproduce the earlier 2026-10-22 "after" columns exactly, in both engines.

## Results

WebKit. Passed / routes; collisions are total / at fault. No suite, before or after, ran a red
light or a stop sign or failed to yield.

| Map and conditions | Before | After | Collisions (before → after) | Deadlock overrides | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 23.64 → 23.54 |
| Kitsilano, fog | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 17.2 → 17.39 |
| Kitsilano, rain | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 19.23 → 19.53 |
| Kitsilano, snow | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 14.5 → 15.06 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 19.25 → 18.9 |
| Victoria, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 17.65 → 17.7 |
| Toronto, dry | 2/2 | 2/2 | 0/0 → 0/0 | 4 → 4 | 18.25 → 17.55 |
| Montréal, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 25.6 → 25.6 |
| Calgary, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 0/0 → 0/0 | 3 → 3 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 28.25 → 28.25 |
| Halifax, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 20.95 → 21.35 |
| Winnipeg, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 36.55 → 36.65 |
| Edmonton, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 30.85 → 31.15 |
| Saskatoon, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 29.85 → 29.85 |

V8:

| Map and conditions | Before | After | Collisions (before → after) | Deadlock overrides | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 22.99 → 23.18 |
| Kitsilano, fog | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 17.28 → 17.09 |
| Kitsilano, rain | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 19.35 → 19.56 |
| Kitsilano, snow | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 14.48 → 14.89 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 19.25 → 19.25 |
| Victoria, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 18.25 → 15.35 |
| Toronto, dry | 2/2 | 2/2 | 0/0 → 0/0 | 4 → 4 | 18.55 → 19 |
| Montréal, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 25.6 → 25.6 |
| Calgary, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 0/0 → 0/0 | 3 → 3 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 28.25 → 28.25 |
| Halifax, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 21.25 → 20.95 |
| Winnipeg, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 36.65 → 36.65 |
| Edmonton, dry | 1/2 | 2/2 | 1/0 → 0/0 | 0 → 0 | 30.4 → 31.15 |
| Saskatoon, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 29.85 → 29.85 |

In WebKit every suite passes before and after, 70 of 70 routes. In V8, 70 of 70 pass (before: 69):
Edmonton `s1-2` now passes. No suite in either engine, after the change, has a collision, a red
light, a stop sign run or a failure to yield. Most summaries changed a little, because traffic cars
turning right on red change where everyone is: mean speed by up to 0.7 km/h, a safety brake or two
more or fewer. The exception is Victoria `s1-1` in V8, 76 s slower (see below).

In separate V8 runs of the same suites, Rules reached a red light where its route turns right 20
times and turned right on red 3 times (Kitsilano dry, Mount Pleasant, Toronto). After the full
stop it waited for the green 9 times because it could not see far enough along the street to its
left (seven times in Kitsilano's fog, rain and snow, which rule it out, and twice in dry weather
where a building hides that street); at the other 8 it did not turn on red because something else
held it or the light turned green first.

## Failures

Before, Edmonton `s1-2` (V8 only) collided with `car_30` at 100.8 s. It was traced tick by tick.
The car was not hidden, as the earlier record supposed: it stood at its own line for the red, in
view and signalling a right turn into the street the car turned into. When the light turned green
it pulled away slowly; sensing ignored oncoming vehicles under 1 m/s and assumed a steady speed,
so the car judged the gap long enough and turned, and they met in that street. The car now waits
for it, and the route passes.

During this work, with right turns on red and the change above but before the pull-out fix,
Kitsilano dry `s1-8` (V8) collided with `car_p6` at 137.5 s: the car turned left in front of it as
it pulled out of a parking spot on the far side of the junction, facing it, its left indicator on
for the pull-out, which sensing took for an oncoming left turn. That is fixed, and the route
passes.

No failures remain. Two changes are worth knowing about:

- **Victoria `s1-1` (V8): 172.6 s → 248.5 s.** Before and after, the car stops 15 m short of a
  green light at the same spot, behind no one: the outline of `building:320` reaches into its lane,
  so every manoeuvre straight ahead predicts a collision with it, and the ±1 m sideways manoeuvres
  that would get around it are offered only when traffic or a parked car is in view. It waits until
  something comes into view: 42 s before, 121 s after, because traffic cars turning right on red
  changed when that happened. It is not caused by this change and is not fixed here.
- **Victoria `s1-2` (WebKit): closest gap 2.3 m → 0.1 m.** A parked car's door opened just ahead
  of the car at 5.5 m/s (229 s); Rules braked hard and stopped 0.1 m short of it, without contact.
  Doors open at random moments and the change shifted when the car got there.

## Repeat

As below for WebKit. For V8, start a server in one terminal and run the same suites from Node in
another:

```sh
PORT=8331 uv run server.py   # keeps running
```

```sh
node --experimental-default-type=module scripts/bench_node.mjs --map halifax --count 2
```

Add `--weather rain` (or `fog`, `snow`) to change the weather, `--only s1-1` to run only the listed
scenarios (comma-separated), and `--json out.json` to write the run's settings and full results.

Compare V8 runs only with V8 runs.

## Earlier record: 2026-10-22 (left turns)

This rerun covers left turns at a signal: the driven car now yields to oncoming traffic, waiting at
the line or inside the junction until the gap is long enough. The audit gains a failure to yield
for oncoming traffic: the car's front entering the path of an oncoming vehicle due at the
junction within 2 s, seen or not, judged against the lanes that vehicle is following. "Before" is
`b456c70` with only that audit added (`static/js/sim/world.js`, and the route and map helpers it
reads in `static/js/map/route.js` and `static/js/map/mapdata.js`), so both columns are judged by
the same audit and the difference between them is the driving change alone. Both ran on the same day in the same harness, in WebKit and in V8.

### Method

As on 2026-10-20: production `/bench`, Rules, suite seed 1, 40 traffic cars, lockstep, in WebKit
through `scripts/shot.swift` on macOS 27.0.1. Kitsilano ran 12 routes in dry, fog, rain and snow;
the other eleven maps ran two-route dry smoke suites. The same suites also ran in V8 (Node 22.23.4)
through `scripts/bench_node.mjs`. The WebKit Kitsilano dry run is
[`20261022-092538-rules.json`](../data/runs/20261022-092538-rules.json). The
[machine-readable record](validation/rebaseline-2026-10-22-rules.json) has every summary and
per-route result, before and after, in both engines. Night was not run; `/bench` still has no
time-of-day option.

### Results

WebKit. Passed / routes; collisions are total / at fault. No suite, before or after, ran a red
light or a stop sign.

| Map and conditions | Before | After | Arrived (after) | Collisions (before → after) | Failures to yield (before → after) | Deadlock overrides | Mean km/h |
|---|---:|---:|---:|---|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 23.66 → 23.64 |
| Kitsilano, fog | 11/12 | 12/12 | 12/12 | 1/0 → 0/0 | 1 → 0 | 0 → 0 | 17.25 → 17.2 |
| Kitsilano, rain | 12/12 | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 19.23 → 19.23 |
| Kitsilano, snow | 12/12 | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 4 → 0 | 14.51 → 14.5 |
| Mount Pleasant, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 19.25 → 19.25 |
| Victoria, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 17.65 → 17.65 |
| Toronto, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 4 → 4 | 18.25 → 18.25 |
| Montréal, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 25.6 → 25.6 |
| Calgary, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 3 → 3 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 28.25 → 28.25 |
| Halifax, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 20.95 → 20.95 |
| Winnipeg, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 36.55 → 36.55 |
| Edmonton, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 30.85 → 30.85 |
| Saskatoon, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 29.85 → 29.85 |

In WebKit, Kitsilano passes 48 of 48 routes across the four weathers (before: 47) and the city
smoke suites 22 of 22, as before. In V8, Kitsilano passes 48 of 48 and the city smoke suites 21 of
22, before and after; Edmonton `s1-2` fails in both. Seven suite summaries changed in each engine,
the four Kitsilano suites and the Victoria, Calgary and Québec City smoke suites. Apart from the
fog route that now passes and the snow deadlocks, the changes are small: mean speed by at most
0.15 km/h, a safety brake more or fewer, and a few more decisions where the car checks a left
turn; the rest are identical. In V8 Kitsilano rain, the closest gap to another vehicle grew from
0.7 m to 2.1 m.

### Failures

Before, Kitsilano fog `s1-4` (WebKit only) turned left on a green while `car_34`, coming the
other way, turned right into the same street: a shared-fault contact at 174.3 s, which the new
audit also counts as a failure to yield. It now passes. In Kitsilano snow, the four deadlock
overrides are gone in both engines.

Remaining failure:

- **Edmonton `s1-2` (V8 only):** a shared-fault contact with `car_30` at 100.8 s, before and
  after; the audit does not count it as a failure to yield. The car turns left on a green with nothing coming
  in view and is moving through the junction at 5 to 6 m/s when `car_30`, an oncoming car turning
  right into the same street, comes into view. By then the car is 3 m from where it would wait, too
  late to stop short of the oncoming lane, so it carries on and both brake. Slowing for an oncoming
  approach the car cannot see would avoid it; it does not do that yet. WebKit passes this route.


## Earlier record: 2026-10-20

This rerun covers two fixes for the failures the 2026-10-19 record left. A traffic car pulling out
of a parking spot now checks for a gap again on every tick until it is actually moving, instead of
once before it starts. And within 10 m of the destination, a car stopped on its route and in the
route's lane has arrived when every manoeuvre along that lane that would get it closer hits a
parked car or static scenery.
"Before" is `1a8d7b5` from a `git archive`; "after" is the same commit with this change. Both ran
on the same day in the same harness, in WebKit and in V8, so the difference between them is this
change alone.

### Method

As on 2026-10-19: production `/bench`, Rules, suite seed 1, 40 traffic cars, lockstep, in WebKit
through `scripts/shot.swift` on macOS 27.0.1. Kitsilano ran 12 routes in dry, fog, rain and snow;
the other eleven maps ran two-route dry smoke suites. The same suites also ran in V8 (Node 22.23.2)
through `scripts/bench_node.mjs`. The WebKit Kitsilano dry run is committed as
[`20261020-093450-rules.json`](../data/runs/20261020-093450-rules.json). The
[machine-readable record](validation/rebaseline-2026-10-20-rules.json) has every summary and
per-route result, before and after, in both engines. Night was not run; `/bench` still has no
time-of-day option.

The WebKit "before" column reproduces the 2026-10-19 "after" column exactly: the same passes,
collisions and mean speeds in every suite.

### Results

WebKit. Passed / routes; collisions are total / at fault. No suite, before or after, ran a red
light or a stop sign or failed to yield.

| Map and conditions | Before | After | Arrived (after) | Collisions (before → after) | Off-road s | Deadlock overrides | Mean km/h |
|---|---:|---:|---:|---|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 12/12 | 0/0 → 0/0 | 0.2 → 0.2 | 0 → 0 | 23.08 → 23.66 |
| Kitsilano, fog | 12/12 | 11/12 | 12/12 | 0/0 → 1/0 | 0.4 → 0.4 | 0 → 0 | 16.77 → 17.25 |
| Kitsilano, rain | 10/12 | 12/12 | 12/12 | 2/1 → 0/0 | 0.2 → 0.2 | 4 → 0 | 18.63 → 19.23 |
| Kitsilano, snow | 12/12 | 12/12 | 12/12 | 0/0 → 0/0 | 0.3 → 0.3 | 4 → 4 | 14.61 → 14.51 |
| Mount Pleasant, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 18.95 → 19.25 |
| Victoria, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 17.65 → 17.65 |
| Toronto, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 4 → 4 | 18.25 → 18.25 |
| Montréal, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 25.6 → 25.6 |
| Calgary, dry | 1/2 | 2/2 | 2/2 | 1/0 → 0/0 | 0 → 0 | 4 → 0 | 16.95 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 3 → 3 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 28.25 → 28.25 |
| Halifax, dry | 1/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 14.9 → 20.95 |
| Winnipeg, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 36.55 → 36.55 |
| Edmonton, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 30.85 → 30.85 |
| Saskatoon, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 29.85 → 29.85 |

In WebKit, Kitsilano passes 47 of 48 routes across the four weathers (before: 46), and the city
smoke suites pass 22 of 22 (before: 20). In V8, Kitsilano passes 48 of 48 (before: 47, with rain
`s1-2` failing) and the city smoke suites 21 of 22 (before: 19, with Calgary and Halifax `s1-1`
failing; Edmonton `s1-2` fails in both). Seven suite summaries changed in WebKit and six in V8, all
of them Kitsilano, Calgary, Halifax or (WebKit only) Mount Pleasant; the rest are identical.

### Failures

Before, three routes collided with a car pulling out of a parking spot: Kitsilano rain `s1-2`
(`car_p1`, ego at fault, 19.3 s), Kitsilano rain `s1-5` (`car_p2`, other fault, 131.5 s) and
Calgary `s1-1` (`car_p1`, other fault, 24.4 s). Rain `s1-2` and Calgary `s1-1` were traced tick by
tick in V8, which reproduces them: in both, the pulling-out car was parked about 1.2 m behind
another, which held it still as its leader. Its gap check passed while the ego was still more than
30 m back, but the car could not move, and its merge, timed in seconds rather than by distance,
ran out while it stood there. It moved off 3.4 and 3.6 s after the check, with the ego 9 to 11 m
behind at 10 to 12 m/s. All three routes now pass; the car waits at the curb with its
indicator on until the ego has gone by. Rain `s1-5` passes in V8 before and after, so it was not
traced, but it was a pull-out contact of the same kind.

Halifax `s1-1` stopped 7.7 m short of its destination on Chebucto Landing (7.8 m in WebKit), behind
`parked_672`, and timed out: every manoeuvre along the lane predicted contact with that car, and
the deadlock creep does not fire within 10 m of a destination. It now arrives there, and the
arrival event names the car (`blocked_by: parked_672`). In WebKit an eligible 1 m nudge to the left
would have got 5.4 m closer beside the parked car; Rules never chose it, and it does not count as a
way to a destination the car is standing on.

Remaining failures after the change:

- **Kitsilano fog `s1-4` (WebKit only):** a shared-fault contact with `car_34` at 174.3 s, ego at
  3.4 m/s. New; before, this route passed. The ego turns left on a green while `car_34`, coming the
  other way, turns right into the same street. Rules does not yield to oncoming traffic when it
  turns left at a signal: the junction's `cross_traffic_moving` counts only crossing traffic. The
  street was not changed; the pull-outs earlier in the drive now wait for the ego, which changes
  when it reaches this junction. Not fixed here.
- **Edmonton `s1-2` (V8 only):** a shared-fault contact with `car_30` at 100.8 s, before and after.
  WebKit passes this route. Not traced.

## Earlier record: 2026-10-19

This rerun re-baselines the seeded Rules suites after the street-furniture fix: two-way streets
with more lanes one way than the other get asphalt that matches their lanes (map pack v6, see
[maps](maps.md)), no post or trunk stands in a lane or on the asphalt, and the deadlock creep never
drives into static scenery. It also covers the lane-change PRs #20 and #21, which landed after the
2026-10-14 record without a benchmark run. "Before" is `b7f21ff` (pack v5) from a `git archive`;
"after" is the same commit with this change. Both ran in the same WebKit harness on the same day,
so the difference between them is this change alone.

### Method

As on 2026-10-14: production `/bench`, Rules, suite seed 1, 40 traffic cars, lockstep, in WebKit
through `scripts/shot.swift` on macOS 27.0.1. Kitsilano ran 12 routes in dry, fog, rain and snow;
the other eleven maps ran two-route dry smoke suites. The Kitsilano dry run was saved as
`20261019-195046-rules.json` but not committed; its summary and per-route results are in the
[machine-readable record](validation/rebaseline-2026-10-19-rules.json) has every summary and
per-route result, before and after. Night was not run; `/bench` still has no time-of-day option.

### Results

Passed / routes; collisions are total / at fault. No suite, before or after, ran a red light or a
stop sign or failed to yield.

| Map and conditions | Before | After | Arrived (after) | Collisions (before → after) | Off-road s | Deadlock overrides | Mean km/h |
|---|---:|---:|---:|---|---|---|---|
| Kitsilano, dry | 11/12 | 12/12 | 12/12 | 1/0 → 0/0 | 0.2 → 0.2 | 0 → 0 | 22.83 → 23.08 |
| Kitsilano, fog | 11/12 | 12/12 | 12/12 | 1/0 → 0/0 | 0.4 → 0.4 | 12 → 0 | 17.18 → 16.77 |
| Kitsilano, rain | 11/12 | 10/12 | 12/12 | 1/1 → 2/1 | 0.2 → 0.2 | 0 → 4 | 19.33 → 18.63 |
| Kitsilano, snow | 11/12 | 12/12 | 12/12 | 1/0 → 0/0 | 0.4 → 0.3 | 3 → 4 | 15.04 → 14.61 |
| Mount Pleasant, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 19.6 → 18.95 |
| Victoria, dry | 1/2 | 2/2 | 2/2 | 2/1 → 0/0 | 13.5 → 0 | 276 → 0 | 9.5 → 17.65 |
| Toronto, dry | 1/2 | 2/2 | 2/2 | 2/1 → 0/0 | 0 → 0 | 330 → 4 | 10.35 → 18.25 |
| Montréal, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 25.6 → 25.6 |
| Calgary, dry | 1/2 | 1/2 | 2/2 | 2/1 → 1/0 | 0 → 0 | 392 → 4 | 13.85 → 16.95 |
| Ottawa, dry | 1/2 | 2/2 | 2/2 | 1/1 → 0/0 | 0 → 0 | 869 → 3 | 12.85 → 18.4 |
| Québec City, dry | 1/2 | 2/2 | 2/2 | 1/1 → 0/0 | 0 → 0 | 999 → 0 | 17.3 → 28.25 |
| Halifax, dry | 1/2 | 1/2 | 1/2 | 1/1 → 0/0 | 1.9 → 0 | 7 → 0 | 19.2 → 14.9 |
| Winnipeg, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 36.55 → 36.55 |
| Edmonton, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 32.9 → 30.85 |
| Saskatoon, dry | 2/2 | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 29.85 → 29.85 |

Kitsilano passes 46 of 48 routes across the four weathers (before: 44), and the city smoke suites
pass 20 of 22 (before: 16). The before column has the same pass counts as the 2026-10-14 record wherever both exist,
except that Kitsilano fog and snow each pass one more route; #20 and #21 changed driving in
between and were not separately benchmarked.

### Failures

Before, `s1-1` in Calgary, Ottawa, Québec City, Toronto and Victoria hit a lamp post, signal post
or street-sign post, at fault, then stayed blocked until the time limit while the deadlock creep
pushed into the post hundreds of times. Every one of those posts stood within 1 m of the route's
lane centre: four along streets with more lanes one way than the other, whose outer lane ran past
the curb (8 Street SW, Gladstone Avenue, Bloor Street West, Belleville Street), and Québec City's
far-side signal pole at `sig3`, placed by the narrower approach street's width inside the wider
street it continues into. All five now pass except Calgary's, which keeps its other-fault pull-out
contact (`car_p1`, 24.4 s, as on 2026-10-14). Victoria's 13.5 s off-road was the car driving in that
outer lane. Halifax `s1-2`, which failed before with an at-fault contact with `car_18`, passes.

Remaining failures after the change:

- **Kitsilano rain `s1-2`:** ego-fault contact with pull-out `car_p1` at 19.3 s, ego at 10.4 m/s.
  New in this run; before, this route passed.
- **Kitsilano rain `s1-5`:** other-fault contact with pull-out `car_p2` at 131.5 s. Also new.
  Before, rain's one failure was `s1-4` (ego-fault contact with `car_p3`), which now passes.
- **Calgary `s1-1`:** the other-fault pull-out contact above.
- **Halifax `s1-1`:** times out 7.7 m short of the destination on Chebucto Landing, stopped beside
  a car that has just parked in the curb bay there: every forward manoeuvre predicts contact with
  it, and the deadlock creep deliberately does not fire within 10 m of a destination. New; before,
  this route passed. Chebucto Landing itself was not changed by the migration (its lanes were
  symmetric), so this most likely comes from different timing earlier in the drive (21 of Halifax's
  signal lines moved), which put a parking car there. This was not traced further. V8 (Node,
  `scripts/bench_node.mjs`) reproduces it.

The route-level changes in Kitsilano rain and Halifax are on streets the fix did not touch. The
closed-loop simulation is sensitive to small differences: moving stop lines and roadside objects
changes when the car reaches each junction and which traffic it meets there.

## Earlier record: 2026-10-14

This rerun re-baselines the seeded Rules suites on commit `62fe050`. No simulation, brain or
rendering code changed. Since the 2026-09-30 record, `static/js/sim` and `static/js/brain` changed
in PRs #9–#12: an agent registry, reroute epoch handling, challenge hooks and comment cleanup.
Rain and snow had not been run as full suites since the realism work. This is their first record.

### Method

Production `/bench`, Rules, suite seed 1, 40 traffic cars, lockstep. Kitsilano ran 12 routes in
dry, fog, rain and snow. The other bundled maps ran two-route dry smoke suites. Halifax, Winnipeg,
Edmonton and Saskatoon were added after this baseline; their smoke results are in
[world validation](world-validation.md#new-cities--2026-10-14).

Each suite ran in WebKit through `scripts/shot.swift` on macOS 27.0.1. The script calls
`window.__bench.run(...)` on `/bench?map=<preset>`, and the page saves its own result through
`/api/bench/save`. The Kitsilano dry run is committed as
[`20261014-091959-rules.json`](../data/runs/20261014-091959-rules.json). The two older runs in
`data/runs/` remain. [Machine-readable record](validation/rebaseline-2026-10-rules.json) has the
commit, summaries, per-route results and the checks below.

Night was not run. `/bench` has no time-of-day option. Its world never calls
`visibility.setNight`, so every bench drive uses daylight sensing. The 2026-09-30 suites had
the same limitation.

### Results

"Before" is the 2026-09-30 record in [world-validation.md](world-validation.md). The counts are
collisions / at-fault and red / stop / yield. Off-road and safety brakes are suite totals.

| Map and conditions | Before | Now | Arrived | Collisions | Red / stop / yield | Off-road s | Safety brakes | Deadlock overrides | Mean km/h (before → now) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Kitsilano, dry | 10/12 | 11/12 | 12/12 | 1 / 0 | 0 / 0 / 0 | 0.2 | 10 | 0 | 22.55 → 22.83 |
| Kitsilano, fog | 10/12 | 10/12 | 12/12 | 1 / 0 | 0 / 0 / 0 | 1.4 | 8 | 12 | 17.06 → 17.18 |
| Kitsilano, rain | not run | 11/12 | 12/12 | 1 / 1 | 0 / 0 / 0 | 0.2 | 8 | 0 | — → 19.21 |
| Kitsilano, snow | not run | 10/12 | 12/12 | 2 / 0 | 0 / 0 / 0 | 0.4 | 5 | 7 | — → 15.01 |
| Mount Pleasant, dry | 2/2 | 2/2 | 2/2 | 0 / 0 | 0 / 0 / 0 | 0 | 1 | 0 | 19.3 → 19.6 |
| Calgary, dry | 1/2 | 1/2 | 1/2 | 2 / 1 | 0 / 0 / 0 | 0 | 1 | 392 | 16.4 → 13.85 |
| Ottawa, dry | 2/2 | 1/2 | 1/2 | 1 / 1 | 0 / 0 / 0 | 0 | 1 | 867 | 18.4 → 12.85 |
| Québec City, dry | 2/2 | 1/2 | 1/2 | 1 / 1 | 0 / 0 / 0 | 0 | 0 | 1003 | 28.25 → 17.3 |
| Victoria, dry | not run | 1/2 | 1/2 | 2 / 1 | 0 / 0 / 0 | 13.5 | 0 | 276 | — → 9.5 |
| Toronto, dry | not run | 1/2 | 1/2 | 2 / 1 | 0 / 0 / 0 | 0 | 0 | 330 | — → 10.35 |
| Montréal, dry | not run | 2/2 | 2/2 | 0 / 0 | 0 / 0 / 0 | 0 | 1 | 0 | — → 25.6 |

All results in this table come from WebKit; under V8 the same code scores Kitsilano dry 10/12
(see below). All Kitsilano routes arrived, and Kitsilano had no red-light, stop or yield
violations in any weather.

Deadlock overrides count the times ego had been stuck for 12 s and the brain forced a 2 m/s
creep along its lane (`brain.js`). They are not failures in themselves. In Kitsilano fog all 12 were on `s1-3`, which arrived but failed for its
contact. In snow, 3 were on `s1-1`, which passed, and 4 on `s1-6`, which arrived but failed for
its collision. The 2026-09-30 fog suite also recorded 12. The large counts in the other cities
come from the blocked `s1-1` routes described below. Before this run, Calgary had 0.6 s off-road and every new-map smoke route arrived.

### Failures

The benchmark fails every collision, whatever its fault attribution. Fault is the simulator's
approximate judgement.

- **Kitsilano dry:** `s1-6` hit crossing traffic (`car_9`, shared fault, 62.8 s). `s1-7`
  now passes; on 2026-09-30, other-fault oncoming traffic hit it while stopped.
- **Kitsilano fog:** these failures are unchanged. `s1-3` had a pull-out contact (`car_p2`,
  other fault, 50.5 s). `s1-9` had 1.4 s off-road.
- **Kitsilano rain:** `s1-4` had an ego-fault contact with `car_23` at 118.0 s. Ego was at
  4.1 m/s, the other car at 6.8 m/s, with a 23° heading difference. This is the only at-fault
  car collision in these suites.
- **Kitsilano snow:** `s1-6` was hit by `car_27` (other fault, 141.6 s). `s1-10` had a contact
  with oncoming `car_5` (shared fault, 185.3 s).
- **Calgary, Ottawa, Québec City, Victoria and Toronto, route `s1-1`:** ego hit street furniture
  at 0.9–7.5 m/s, with ego at fault. The objects were a lamp post in Calgary, Ottawa and Toronto,
  a signal post in Québec City and a street-sign post in Victoria. Ego then stayed blocked until
  the time limit and reported repeated deadlocks. Calgary also kept its earlier other-fault
  pull-out contact (`car_p1`, 24.4 s). Victoria had 13.5 s off-road. Victoria and Toronto
  each counted a second collision outside the first 50 events the runner keeps, so its details
  are not recorded. In each city, `s1-2` passed
  and matched the 2026-09-30 timing where a record exists.

### Why the numbers moved

In the suites retested, code changes are not the cause. All eight dry suites ran again from a
`git archive` of `bbc9012`, the commit behind the 2026-09-30 record, in the same WebKit harness.
Every summary and per-route result matched `62fe050` exactly, except wall-clock time. Fog, rain
and snow were not rerun on the old code, so this shows only that the dry results did not move.

Within one engine, the runs are deterministic. A second Kitsilano dry run matched the first
exactly. The old-code runs also matched despite running alongside other suites on a different
server.

The JavaScript engine does change the results. The same `62fe050` code ran Kitsilano dry under
Node 22.23.2 (V8) with the production suite and runner modules. It reproduced the 2026-09-30 result:
10/12, with `s1-6` and `s1-7` failing and 2 collisions, 0 at fault. Eleven of 12 route
times matched the old record exactly. WebKit matched V8 on routes 1–3, then diverged from
route 4. The likeliest explanation is last-bit differences in `Math` functions between engines.
The closed-loop simulation amplifies them. This was not traced to a specific call. V8 route
`s1-8` (154.3 s) also differs from the old record (159.2 s), so that record probably came from
another V8 build, such as a browser.

The street-furniture failures on the new maps therefore exist at `bbc9012` in WebKit. Scenery
collisions entered in the same commit (#8), and the vehicle and scenery validation reran only
Kitsilano. Whether these routes also fail under V8 was not checked. The planner does not avoid
these posts, and the cause is still unknown. This record reports it and does not fix it.

Compare runs only when they use the same browser engine. A difference between Chrome and Safari
does not show a behaviour change. These small seeded suites do not establish driver safety in
general.

### Repeat

```sh
PORT=8331 uv run server.py
```

Open `/bench?map=kitsilano` and run the 12-route suite from the page or the console, changing
`weather` to `fog`, `rain` or `snow` for the other Kitsilano rows:

```js
await window.__bench.run({ brain: "rules", count: 12, npcs: 40, seed: 1, mode: "lockstep", weather: "dry" })
```

The city smoke suites use two routes. Open another preset such as `/bench?map=calgary` and run:

```js
await window.__bench.run({ brain: "rules", count: 2, npcs: 40, seed: 1, mode: "lockstep", weather: "dry" })
```

Headless runs pass the same call as the `pre_js` argument with a long timeout:

```sh
swift scripts/shot.swift "http://127.0.0.1:8331/bench?map=kitsilano" out.png 1 "" \
  "return (await window.__bench.run({ count: 12, weather: 'dry' })).summary" 3 3000
```

Results save to `data/runs/`. Choose this baseline under **compare with** on `/bench`.
