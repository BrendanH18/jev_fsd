# Rules benchmark baseline — 2026-10-29 (level crossings, unchanged)

Rules passes the Edmonton suite **2 of 2 in V8, exactly as on main** at `6cb513f`: route for route,
every result field but wall-clock time and decision latency is the same, with no collisions,
red-light or stop-sign violations, failures to yield or deadlock overrides. "After" is this branch,
which adds railway level crossings from OpenStreetMap (only Old Strathcona has any, the High Level
Bridge Streetcar's eight), the heritage streetcar that runs over them (in free drives only), stopping
for it and never on the tracks, and the "Clear the tracks" challenge. The branch's server serves
Edmonton with its crossings, so the room rule applies to its traffic and the car; on these routes no
queue backed up across the tracks. The other fourteen suites' maps have no level crossing, and there
everything the change adds is skipped (traffic, sensing and the audit look for crossings only on a map
that has one), so they were not rerun.

## Method

Edmonton dry, Rules, suite seed 1, 2 routes, 40 traffic cars, lockstep, V8 through
`scripts/bench_node.mjs` with Node `v22.23.4` on a Raspberry Pi (Linux 6.18, arm64), main and the
branch each against its own `uv run --locked server.py`, compared field by field.

## Earlier record: 2026-10-29b (slow down, move over, unchanged)

Rules passes **70 of 70 routes in V8**, exactly as on main: all 15 seeded suites match main at
`689121c` route for route, in every result field but wall-clock time and decision latency, with no
collisions, red-light or stop-sign violations, failures to yield or deadlock overrides. "After" is
this branch, which adds vehicles stopped at the roadside with their lights flashing (in free drives
only), slowing down and moving over for them, and the "Move over" challenge. The seeded benchmark's
world has no roadside stops, and without them traffic, the car and the audit behave as before.

## Method

As for 2026-10-28 below: all 15 seeded suites, Rules, suite seed 1, 40 traffic cars, lockstep, V8
through `scripts/bench_node.mjs` with Node `v22.23.4` on a Raspberry Pi (Linux 6.18, arm64), main
and the branch each against its own `uv run --locked server.py`, compared field by field. WebKit and
night were not run.

## Earlier record: 2026-10-28b (school and playground zones, unchanged)

Rules passes **70 of 70 routes in V8**, exactly as on main: all 15 seeded suites match main at
`2697ce1` route for route, in every result field but wall-clock time, with no collisions, red-light
or stop-sign violations, failures to yield or deadlock overrides. "After" is this branch, which adds
school and playground zones, their signs and the "School zone" challenge. The seeded benchmark's
world has no clock, so no zone is in effect there, and the new sign posts stand off the road; these
runs confirm that nothing it drives changes.

## Method

As for 2026-10-28 below: all 15 seeded suites, Rules, suite seed 1, 40 traffic cars, lockstep, V8
through `scripts/bench_node.mjs` with Node `v22.23.4` on a Raspberry Pi (Linux 6.18, arm64), main
and the branch each against its own `uv run --locked server.py`, compared field by field. WebKit and
night were not run.

## Earlier record: 2026-10-28 (school buses, unchanged)

Rules passes **70 of 70 routes in V8**, exactly as on main: all 15 seeded suites match main at
`9bbab56` route for route, in every result field but wall-clock time (arrival, distance, safety
brakes, decisions, accelerations, jerk and the rest), with no collisions, red-light or stop-sign
violations, failures to yield or deadlock overrides. "After" is the working tree on top of
`9bbab56`, which adds school buses (in free drives only), traffic and the car stopping for a school
bus with its reds flashing, the children it lets off, and the "Flashing reds" challenge. The seeded
benchmark runs no school buses, and without them traffic, the crowd, the car and the audit behave
as before.

## Method

All 15 seeded suites, Rules, suite seed 1, 40 traffic cars, lockstep, V8 through
`scripts/bench_node.mjs` with Node `v22.23.4` on a Raspberry Pi (Linux 6.18, arm64), one process
per suite, main and the working tree each against its own `uv run --locked server.py`, compared
field by field. Because the engine and machine differ from the records below, the comparison is
main against the change on this machine, not against those numbers. WebKit and night were not run.

## Earlier record: 2026-10-27b (marked crosswalks)

Rules passes **70 of 70 routes in V8 and 69 of 70 in WebKit**, with no red-light or stop-sign
violations, failures to yield or deadlock overrides in either engine. "After" is the working tree
on top of main at `b68a32b`, which adds the marked crosswalks between junctions from OpenStreetMap:
people cross at them, every driver gives way to them there, a vehicle in traffic hides a person
behind it, and the car does not pass a vehicle stopped at one (BC MVA s. 179(3)). Unlike buses and
emergency vehicles, this reaches the seeded benchmark: its 60 people now cross at the crosswalks
along their way, so where a route passes one the traffic and the drive change.

- **Unchanged where no route meets a crosswalk:** V8 Mount Pleasant, Toronto, Montréal, Calgary,
  Ottawa, Québec City, Halifax, Winnipeg, Edmonton and Saskatoon, and WebKit Mount Pleasant,
  Montréal, Calgary, Ottawa, Québec City, Winnipeg, Edmonton and Saskatoon, match the 2026-10-27
  record route for route (Mount Pleasant, Québec City and Edmonton have no crosswalks).
- **Kitsilano, Victoria and WebKit Halifax:** every route still passes in both engines. Arrival times move by up to
  15 s (V8 Kitsilano fog `s1-10`: 207.1 → 222.0 s) and safety brakes go from 27 to 24 in V8 and from
  35 to 26 in WebKit, all suites together.
- **WebKit Toronto `s1-1` fails on one collision, shared fault, not the car's** (`car_22` at
  194.3 s). A traffic car in the left lane of a two-lane approach (`e305`) goes straight on into a
  one-lane street (`e292`) and merges across the car, which is going straight on beside it from the
  curb lane. Traffic has always merged like this where a lane ends past a junction, without
  yielding to a car beside it; the crosswalks only changed the timing that put the two side by side.
  No pedestrian or crosswalk is involved. V8 passes the route as before. Traffic yielding where its
  lane ends is left as a follow-up.

### Method

As for 2026-10-27: all 15 seeded suites, Rules, suite seed 1, 40 traffic cars, lockstep, on macOS
27.0.1 (26A434), Apple M5, V8 through `scripts/bench_node.mjs` with Node `v24.19.0` and WebKit through
`scripts/shot.swift` (`swiftc -O`, a fresh WKWebView per suite, `save: false`, 15 s settle), both
against `PORT=8331 uv run --locked server.py` serving the working tree. The WebKit collision was
reproduced by replaying Toronto `s1-1` alone in a WKWebView. The
[machine-readable record](validation/rebaseline-2026-10-27b-rules.json) holds both engines' summaries
and per-route results; the before columns are the 2026-10-27 record's after columns. Night was not
run.

## Earlier record: 2026-10-27 (buses, unchanged)

Rules passes **70 of 70 routes in both V8 and WebKit**, exactly as in the 2026-10-26 record below:
every suite matches its after columns route for route (arrival time, pass and safety brakes) and in
its summary, with no collisions, red-light or stop-sign violations, failures to yield or deadlock
overrides. "After" is the working tree on top of main at `9704bfc`, which adds buses on their
OpenStreetMap routes (in free drives only), traffic and the car letting a bus pull out from its
stop, bus zones, and the "Pulling out" challenge. The seeded benchmark runs no buses, and without
them the traffic, parking, car and audit behave as before (the map now carries its `transit`
routes, which nothing reads unless buses run); these runs confirm it.

### Method

As for 2026-10-26: all 15 seeded suites, Rules, suite seed 1, 40 traffic cars, lockstep, on macOS
27.0.1 (26A434), Apple M5, V8 through `scripts/bench_node.mjs` with Node `v24.19.0` and WebKit through
`scripts/shot.swift` (`swiftc -O`, a fresh WKWebView per suite, `save: false`, 15 s settle), both
against `PORT=8331 uv run --locked server.py` serving the working tree. Kitsilano dry, fog and rain
were rerun in both engines once the last review fixes were in, and match. The
[machine-readable record](validation/rebaseline-2026-10-27-rules.json) holds both engines'
summaries and per-route results (WebKit: pass, arrival, time, safety brakes, collisions and
failures to yield per route); the before columns are the 2026-10-26 record's after columns. Night
was not run.

## Earlier record: 2026-10-26 (emergency vehicles, unchanged)

Rules passes **70 of 70 routes in both V8 and WebKit**, exactly as in the 2026-10-25b record below:
every suite matches its after columns route for route (arrival time, pass and safety brakes) and in
its summary, with no collisions, red-light or stop-sign violations, failures to yield or deadlock
overrides. "After" is the working tree on top of main at `c073ca4`, which adds emergency vehicles:
an ambulance or a fire truck now and then in a free drive, everyone pulling over for it, and the
"Lights and sirens" challenge. The seeded benchmark sends none, and with none about the traffic,
the car and the audit behave as before; these runs confirm it.

### Method

As for 2026-10-25b: all 15 seeded suites (Kitsilano 12 routes in each of dry, fog, rain and snow,
the eleven other maps two dry routes each), Rules, suite seed 1, 40 traffic cars, lockstep, on
macOS 27.0.1 (26A434), Apple M5. V8 used `scripts/bench_node.mjs` with Node `v24.19.0` (V8
`13.6.233.17-node.51`); WebKit used `scripts/shot.swift` compiled with
`swiftc -O`, a fresh WKWebView per suite calling `window.__bench.run` with `save: false` after a
15 s settle; both against `PORT=8331 uv run --locked server.py` serving the working tree. The
[machine-readable record](validation/rebaseline-2026-10-26-rules.json) holds both engines'
summaries and per-route results; the before columns are the 2026-10-25b record's after columns.
Each engine ran one suite at a time, the two engines side by side (lockstep runs do not depend on
timing). Night was not run.

## Earlier record: 2026-10-25b (no deadlock overrides)

Rules passes **70 of 70 routes in both V8 and WebKit**, before and after, with no collisions,
red-light or stop-sign violations or failures to yield, and the seven deadlock overrides
(Toronto 4, Ottawa 3) are gone: **0 in either engine**. "Before" is main at `01da9ac`; "after" is
the working tree on top of it, where a car two or more lanes from its route's lane keeps room for
a lane change per lane, a lane change ends once the car is across, and the car turns round with a
three-point turn where its route makes a U-turn at a dead end.

### Method

Both engines ran all 15 seeded suites through the production suite builder, runner and metrics:
Rules, suite seed 1, 40 traffic cars, lockstep. Kitsilano has 12 routes in each of dry, fog, rain
and snow; the other eleven maps have two dry routes each. One benchmark suite ran at a time, on
macOS 27.0.1 (26A434), Apple M5.

V8 used `scripts/bench_node.mjs` with Node `v24.19.0` (V8 `13.6.233.17-node.51`), from the working
tree against `PORT=8333 uv run --locked server.py`. WebKit used the unmodified `scripts/shot.swift`,
compiled with `swiftc -O`, with a fresh WKWebView process per suite calling `window.__bench.run`
with Rules, seed 1, 40 traffic cars, lockstep, the requested count and weather, and `save: false`,
served from the working tree on 8333. The first Kitsilano rain page had not finished loading when
the run was called 8 s in; it was rerun with 15 s.

Main at `01da9ac` differs from `f5d810f`, the previous record's after side, only by one line in
`World.resetToLane`, which the benchmark never calls, so the before columns are that record's
after columns. Kitsilano dry, Toronto and Ottawa were rerun in both engines from a `git archive
01da9ac` tree (checked against a fresh extract; WebKit served it on 8332 with the working tree's
`.venv/bin/python3`) and reproduce them route for route. The [machine-readable
record](validation/rebaseline-2026-10-25b-rules.json) holds both engines' summaries and per-route
metrics and safety, collision, yield and deadlock events. Night was not run.

### Results

Passed / routes; deadlock overrides, safety brakes and mean speeds are before → after.

#### V8

| Map and conditions | Before | After | Deadlock overrides | Safety brakes | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0 → 0 | 7 → 7 | 23.47 → 23.55 |
| Kitsilano, fog | 12/12 | 12/12 | 0 → 0 | 2 → 2 | 17.65 → 17.65 |
| Kitsilano, rain | 12/12 | 12/12 | 0 → 0 | 1 → 1 | 19.02 → 19.02 |
| Kitsilano, snow | 12/12 | 12/12 | 0 → 0 | 4 → 4 | 14.93 → 14.93 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0 → 0 | 2 → 2 | 18.5 → 18.5 |
| Victoria, dry | 2/2 | 2/2 | 0 → 0 | 4 → 4 | 14.85 → 14.85 |
| Toronto, dry | 2/2 | 2/2 | 4 → 0 | 1 → 3 | 18 → 15.7 |
| Montréal, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 17.55 → 17.55 |
| Calgary, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 19.5 → 19.45 |
| Ottawa, dry | 2/2 | 2/2 | 3 → 0 | 0 → 0 | 18.4 → 18.35 |
| Québec City, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 26.55 → 26.55 |
| Halifax, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 21.2 → 21.2 |
| Winnipeg, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 32.15 → 34.2 |
| Edmonton, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 28.5 → 28.5 |
| Saskatoon, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 27.35 → 27.35 |

#### WebKit

| Map and conditions | Before | After | Deadlock overrides | Safety brakes | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0 → 0 | 7 → 7 | 23.77 → 23.77 |
| Kitsilano, fog | 12/12 | 12/12 | 0 → 0 | 5 → 5 | 17.22 → 17.22 |
| Kitsilano, rain | 12/12 | 12/12 | 0 → 0 | 6 → 6 | 19.3 → 19.3 |
| Kitsilano, snow | 12/12 | 12/12 | 0 → 0 | 5 → 5 | 14.98 → 14.98 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0 → 0 | 2 → 2 | 18.5 → 18.5 |
| Victoria, dry | 2/2 | 2/2 | 0 → 0 | 3 → 3 | 17.35 → 17.35 |
| Toronto, dry | 2/2 | 2/2 | 4 → 0 | 1 → 2 | 18.3 → 18.4 |
| Montréal, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 17.55 → 17.55 |
| Calgary, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 19.5 → 19.45 |
| Ottawa, dry | 2/2 | 2/2 | 3 → 0 | 0 → 0 | 18.4 → 18.35 |
| Québec City, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 26.55 → 26.55 |
| Halifax, dry | 2/2 | 2/2 | 0 → 0 | 2 → 2 | 20.95 → 20.95 |
| Winnipeg, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 34.15 → 34.1 |
| Edmonton, dry | 2/2 | 2/2 | 0 → 0 | 2 → 1 | 24.65 → 28.35 |
| Saskatoon, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 27.35 → 27.35 |

### Why the numbers moved

- **Ottawa `s1-1`: 3 deadlock overrides → 0, 175.3 → 175.4 s** in both engines. The route starts
  on Wellington Street two lanes left of its route's lane, 71 m before a right turn. Before, the
  lane-end rule kept room for one lane change only: the car sped up, moved one lane over, found no
  room left for the second change, went back, and stood still until deadlock recovery crept it
  across at 22.7 s. Now it keeps room for both changes and crosses them in turn.
- **Toronto `s1-2`: 4 deadlock overrides → 0.** The suite starts the car facing away from its
  destination, and the router turns it round in Willcocks Common, a 10 m dead end off Huron
  Street. Before, the car tried to follow the U-turn's line in one sweep, stood still at 34 s, and
  deadlock recovery crept it round from 46.3 s. Now it starts turning round at 33 s, makes one leg
  forward (6.5 m) and one back (5.9 m), drives out and hands back at 54 s. From there the drive
  meets traffic at different times: in V8 it follows `car_p2`, which pulled out ahead of it, waits
  at a red light and takes 175.1 → 250.5 s, with two more safety brakes for following too close
  (209.1 and 244.0 s; the open door at 73.7 s is braked for before and after). In WebKit it takes
  180.1 → 180.9 s with one more following brake (175.4 s).
- **Lane changes that end once across.** A change now counts as over within 0.15 m of the new
  lane's centre rather than 0.5 m before its planned end, so the next manoeuvre is offered a
  little sooner. **V8 Kitsilano dry `s1-4`: 137.1 → 131.7 s**, **V8 Winnipeg `s1-1`: 125.0 →
  107.8 s** and **WebKit Edmonton `s1-2`: 200.2 → 147.0 s** (one safety brake fewer) all make lane
  changes; with that rule switched off, `s1-4` and Winnipeg `s1-1` go back to 137.1 and 125.0 s
  exactly. Calgary's mean speed moves 19.5 → 19.45 km/h in both engines. No other route moved by
  5 s or more.

### Repeat

Start `PORT=8331 uv run --locked server.py`, then run each suite with `bench_node.mjs`
(`--map kitsilano --count 12 --weather dry|fog|rain|snow`, and `--count 2 --weather dry` for the
eleven other maps), one at a time, for example:

```sh
npx --yes --package=node@24.19.0 node scripts/bench_node.mjs --port 8331 --map toronto --count 2 --weather dry --json toronto-dry.json
```

## Earlier record: 2026-10-25 (cyclists keep right, right hooks)

Rules passes **70 of 70 routes in both V8 and WebKit**, before and after, with no collisions,
red-light violations, stop-sign violations or failures to yield, and the same seven deadlock
overrides (Toronto 4, Ottawa 3). "Before" is main at `de3f4ad`; "after" is `f5d810f`, where
cyclists ride an empty parking lane, cars turning right yield to a cyclist on their right, the
audit counts a right hook as a failure to yield, and traffic cars get into the lane for a turn
just past a short link inside a junction.

### Method

Both engines ran all 15 seeded suites through the production suite builder, runner and metrics:
Rules, suite seed 1, 40 traffic cars, lockstep. Kitsilano has 12 routes in each of dry, fog, rain
and snow; the other eleven maps have two dry routes each. One benchmark suite ran at a time, on
macOS 27.0.1 (26A434), Apple M5.

V8 used `scripts/bench_node.mjs` with Node `v24.19.0` (V8 `13.6.233.17-node.51`) against
`PORT=8331 uv run --locked server.py`. "Before" ran the script from a `git archive de3f4ad`
tree, "after" from the working tree at `f5d810f`; the server only supplies maps and routes,
which this change does not touch. For example:

```sh
npx --yes --package=node@24.19.0 node scripts/bench_node.mjs --port 8331 --map toronto --count 2 --weather dry --json toronto-dry.json
```

WebKit used the unmodified `scripts/shot.swift`, compiled with `swiftc`, with a fresh WKWebView
process per suite. Each page waited for its map to load, then called `window.__bench.run` with
Rules, seed 1, 40 traffic cars, lockstep, the requested count and weather, and `save: false`.
"Before" was served from the `de3f4ad` tree on port 8332, "after" from the working tree on 8331;
both servers used the working tree's `.venv/bin/python3`.

Every before suite reproduces the previous baseline below: the V8 and WebKit summaries match
its after columns. The [machine-readable record](validation/rebaseline-2026-10-25-rules.json)
holds both engines' summaries and per-route metrics and safety, collision, yield and deadlock
events. Night was not run.

### Results

Passed / routes; deadlock overrides, safety brakes and mean speeds are before → after.

#### V8

| Map and conditions | Before | After | Deadlock overrides | Safety brakes | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0 → 0 | 10 → 7 | 23.24 → 23.47 |
| Kitsilano, fog | 12/12 | 12/12 | 0 → 0 | 5 → 2 | 16.72 → 17.65 |
| Kitsilano, rain | 12/12 | 12/12 | 0 → 0 | 2 → 1 | 19.04 → 19.02 |
| Kitsilano, snow | 12/12 | 12/12 | 0 → 0 | 3 → 4 | 14.76 → 14.93 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0 → 0 | 2 → 2 | 18.5 → 18.5 |
| Victoria, dry | 2/2 | 2/2 | 0 → 0 | 0 → 4 | 15.1 → 14.85 |
| Toronto, dry | 2/2 | 2/2 | 4 → 4 | 1 → 1 | 18.25 → 18 |
| Montréal, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 17.55 → 17.55 |
| Calgary, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 3 → 3 | 0 → 0 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 26.55 → 26.55 |
| Halifax, dry | 2/2 | 2/2 | 0 → 0 | 2 → 1 | 21.25 → 21.2 |
| Winnipeg, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 33.65 → 32.15 |
| Edmonton, dry | 2/2 | 2/2 | 0 → 0 | 0 → 1 | 28.5 → 28.5 |
| Saskatoon, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 26.15 → 27.35 |

#### WebKit

| Map and conditions | Before | After | Deadlock overrides | Safety brakes | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0 → 0 | 8 → 7 | 23.47 → 23.77 |
| Kitsilano, fog | 12/12 | 12/12 | 0 → 0 | 5 → 5 | 17.55 → 17.22 |
| Kitsilano, rain | 12/12 | 12/12 | 0 → 0 | 3 → 6 | 19.13 → 19.3 |
| Kitsilano, snow | 12/12 | 12/12 | 0 → 0 | 1 → 5 | 15.05 → 14.98 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0 → 0 | 3 → 2 | 18.35 → 18.5 |
| Victoria, dry | 2/2 | 2/2 | 0 → 0 | 1 → 3 | 17.4 → 17.35 |
| Toronto, dry | 2/2 | 2/2 | 4 → 4 | 1 → 1 | 19 → 18.3 |
| Montréal, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 17.55 → 17.55 |
| Calgary, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 3 → 3 | 0 → 0 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 26.55 → 26.55 |
| Halifax, dry | 2/2 | 2/2 | 0 → 0 | 1 → 2 | 21.3 → 20.95 |
| Winnipeg, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 33.8 → 34.15 |
| Edmonton, dry | 2/2 | 2/2 | 0 → 0 | 0 → 2 | 29.2 → 24.65 |
| Saskatoon, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 27.35 → 27.35 |

### Why the numbers moved

Cyclists now ride an empty parking lane instead of the traffic lane, so the car follows them
less and can drive past them; and traffic parks, pulls out and opens doors in different places,
which shifts drives both ways.

- **Right hooks.** On Kitsilano `s1-7` in dry, fog and rain, `bike_6` comes up on the car's right
  at a right turn. The car reports it for 10.5, 9.0 and 9.6 s (V8), stops for 1.3 and 0.7 s in
  dry and fog, and turns behind it: 214.5 → 216.2 s, 254.5 → 256.6 s and 235.4 → 232.9 s. No
  other V8 route meets a cyclist on its right at a right turn.
- **Following cyclists.** Across the 70 V8 routes the car spent 339.1 s within 20 m behind a
  cyclist before, and 179.2 s after. **Kitsilano snow `s1-7`: 351.3 → 281.8 s** (WebKit
  313.9 → 281.6 s): before, it followed a cyclist at walking pace for 164 s in the snow; after,
  for 15.7 s, until the cyclist took the parking lane and the car went by.
- **Traffic.** None of the other routes that moved by 5 s or more meets a cyclist where it
  matters; parked cars, pull-outs, doors and signal phases decide them. In WebKit,
  **Edmonton `s1-2`: 138.1 → 200.2 s**: both drives match to the second for the first 500 m, then
  a street-side door opens ahead of the car (13 s), a car that pulled out leads it, and it reaches
  a signal as it turns red (30 s). **Kitsilano fog `s1-4`: 153.2 → 194.6 s**: 6 s behind a car
  pulling out, then 20.5 s at a red. **Kitsilano snow `s1-12`: 253.8 → 291.7 s**: following
  `car_p5`, which pulled out ahead of it, across two stop signs, then 13.9 s at a red. In V8,
  **Kitsilano dry `s1-6`: 215.3 → 174.2 s**, **fog `s1-5`: 214.7 → 155.0 s** and **fog `s1-12`:
  225.1 → 184.5 s** stop 28, 47 and 25 s less; **rain `s1-8`: 190.2 → 217.6 s** stops 18 s more.
- **Safety brakes.** The added ones checked are traffic: V8 Victoria `s1-2`'s four are for
  `car_p2`, a car that pulled out ahead of it (three), and an open door.

#### Traffic turning left from the wrong lane (V8 Kitsilano fog `s1-4`)

The first V8 after run failed Kitsilano fog `s1-4` with a collision at 133.4 s. Turning left from
West Broadway onto Yew Street from the left lane, the car was hit from its right by `car_23`,
which made the same turn from the right lane. The turn comes just past an 8.6 m link that goes
straight on inside the junction, and a traffic car looked only at the turn at the end of the
street it was on, so it never moved into the left lane. Traffic cars now look through a straight
link shorter than 20 m to the turn at the next junction (`NpcFleet.maybeChangeLane`); Kitsilano
has 14 turns like it from streets with more than one lane. The runs above include that change.

### Repeat

Start `PORT=8331 uv run --locked server.py`, then run each suite with `bench_node.mjs` as above
(`--map kitsilano --count 12 --weather dry|fog|rain|snow`, and `--count 2 --weather dry` for the
eleven other maps), one at a time.

## Earlier record: 2026-10-24 (giving way without a signal)

Rules passes **70 of 70 routes in both V8 and WebKit**, before and after, with no collisions,
red-light violations, stop-sign violations or failures to yield, and the same seven deadlock
overrides (Toronto 4, Ottawa 3). "Before" is main at `9163c27`; "after" adds right of way at
two-way stops and junctions without a sign or signal, creeping forward to look past buildings,
the give-way audit, an emergency brake that keeps steering along the car's path, traffic that
keeps its new lane after a lane change, and unsigned junctions that do not hide a control just
beyond them.

### Method

Both engines ran all 15 seeded suites through the production suite builder, runner and metrics:
Rules, suite seed 1, 40 traffic cars, lockstep. Kitsilano has 12 routes in each of dry, fog, rain
and snow; the other eleven maps have two dry routes each. One benchmark suite ran at a time, on
macOS 27.0.1 (26A434), Apple M5.

V8 used `scripts/bench_node.mjs` with Node `v24.19.0` (V8 `13.6.233.17-node.51`) against
`PORT=8331 uv run --locked server.py`. "Before" ran the script from a `git archive 9163c27`
tree, "after" from the working tree; the server only supplies maps and routes, which this change
does not touch. For example:

```sh
npx --yes --package=node@24.19.0 node scripts/bench_node.mjs --port 8331 --map toronto --count 2 --weather dry --json toronto-dry.json
```

WebKit used the unmodified `scripts/shot.swift`, compiled with `swiftc`, with a fresh WKWebView
process per suite. Each page waited for its map to load, then called `window.__bench.run` with
Rules, seed 1, 40 traffic cars, lockstep, the requested count and weather, and `save: false`.
"Before" was served from the `9163c27` tree on port 8332, "after" from the working tree on 8331;
both servers used the working tree's `.venv/bin/python3`.

Every before suite reproduces the previous baseline below: the V8 summaries match its post-fix
V8 record and the WebKit summaries its WebKit after column. The
[machine-readable record](validation/rebaseline-2026-10-24-rules.json) holds both engines'
summaries and per-route metrics and safety, collision and yield events. Night was not run.

### Results

Passed / routes; deadlock overrides, safety brakes and mean speeds are before → after.

#### V8

| Map and conditions | Before | After | Deadlock overrides | Safety brakes | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0 → 0 | 13 → 10 | 23.19 → 23.24 |
| Kitsilano, fog | 12/12 | 12/12 | 0 → 0 | 5 → 5 | 17.09 → 16.72 |
| Kitsilano, rain | 12/12 | 12/12 | 0 → 0 | 3 → 2 | 19.5 → 19.04 |
| Kitsilano, snow | 12/12 | 12/12 | 0 → 0 | 3 → 3 | 14.89 → 14.76 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0 → 0 | 1 → 2 | 19.25 → 18.5 |
| Victoria, dry | 2/2 | 2/2 | 0 → 0 | 2 → 0 | 15.25 → 15.1 |
| Toronto, dry | 2/2 | 2/2 | 4 → 4 | 2 → 1 | 18.45 → 18.25 |
| Montréal, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 25.6 → 17.55 |
| Calgary, dry | 2/2 | 2/2 | 0 → 0 | 1 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 3 → 3 | 0 → 0 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 28.2 → 26.55 |
| Halifax, dry | 2/2 | 2/2 | 0 → 0 | 1 → 2 | 20.95 → 21.25 |
| Winnipeg, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 36.65 → 33.65 |
| Edmonton, dry | 2/2 | 2/2 | 0 → 0 | 1 → 0 | 31.15 → 28.5 |
| Saskatoon, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 29.85 → 26.15 |

#### WebKit

| Map and conditions | Before | After | Deadlock overrides | Safety brakes | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0 → 0 | 10 → 8 | 23.65 → 23.47 |
| Kitsilano, fog | 12/12 | 12/12 | 0 → 0 | 7 → 5 | 17.39 → 17.55 |
| Kitsilano, rain | 12/12 | 12/12 | 0 → 0 | 4 → 3 | 19.47 → 19.13 |
| Kitsilano, snow | 12/12 | 12/12 | 0 → 0 | 1 → 1 | 15.06 → 15.05 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0 → 0 | 1 → 3 | 19.25 → 18.35 |
| Victoria, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 17.65 → 17.4 |
| Toronto, dry | 2/2 | 2/2 | 4 → 4 | 1 → 1 | 19.05 → 19 |
| Montréal, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 25.6 → 17.55 |
| Calgary, dry | 2/2 | 2/2 | 0 → 0 | 1 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 3 → 3 | 0 → 0 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 28.25 → 26.55 |
| Halifax, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 21.35 → 21.3 |
| Winnipeg, dry | 2/2 | 2/2 | 0 → 0 | 1 → 1 | 36.6 → 33.8 |
| Edmonton, dry | 2/2 | 2/2 | 0 → 0 | 1 → 0 | 31.15 → 29.2 |
| Saskatoon, dry | 2/2 | 2/2 | 0 → 0 | 0 → 0 | 29.85 → 27.35 |

### Why the numbers moved

The car now spends time looking at blind junctions, and waiting there for traffic with the
right of way; traffic giving way changes where traffic is and when the car reaches each signal,
which shifts other drives both ways. Junctions without a sign meet most often in Montréal,
Winnipeg, Edmonton, Saskatoon and Québec City. V8 routes whose time moved by at least 5 s, with the time
spent waiting and slowing to look where the car gives way:

- **Montréal `s1-1`: 73.0 → 95.0 s** and **`s1-2`: 57.5 → 93.3 s** (the same in WebKit). `s1-1`
  looks for 9.5, 7.1 and 7.6 s at three junctions without a sign and gives way to `car_39` and
  `car_19` for 7.6 s on a smaller street meeting a larger one; `s1-2` looks for 9.1 s at one,
  which brings it to a signal just as it turns red: it waits 28 s there (Montréal has no right
  on red).
- **Winnipeg `s1-1`: 92.2 → 112.1 s** (WebKit 92.7 → 110.9 s): six junctions without a sign,
  18.5 s looking, and 4.9, 2.2 and 0.5 s giving way to `car_p1` and `car_32`, `car_31` and
  `car_39`.
- **Edmonton `s1-1`: 84.3 → 92.8 s** and **`s1-2`: 133.5 → 145.2 s**: 6.0 s and 5.3 s looking,
  then 6.1 s giving way to `car_p2` (`s1-1`), and 2.4 and 0.6 s to `car_p1` and `car_20` (`s1-2`).
- **Saskatoon `s1-1`: 78.0 → 94.7 s**: 6.7, 2.8 and 1.8 s looking at three junctions without a
  sign and 7.0 s giving way to `car_5`; **`s1-2`: 104.2 → 110.2 s** (both engines): 4.6, 3.0 and
  1.8 s looking, and 2.5 s giving way to `car_40`.
- **Québec City `s1-2`: 66.8 → 74.9 s** (both engines): 7.5 and 1.7 s looking at two junctions
  without a sign in Saint-Roch.
- **Kitsilano fog `s1-12`: 187.7 → 225.1 s.** After its stop at a two-way stop, the car moved off
  and then saw `bike_7` on the through road through the fog; it stopped 1 m past the line and
  waited 7.8 s while the cyclist crossed. Before, it carried on in front of it.
- **Kitsilano rain `s1-12`: 166.0 → 220.0 s** and **snow `s1-12`: 253.7 → 285.0 s**: 3.8 s
  looking at a junction without a sign, then 7.4 and 6.3 s giving way at two two-way stops to
  `car_30` and `car_p6` (rain); 0.7 s looking and 5.5 s giving way to `car_p5` (snow). The rest
  is traffic and the signals that follow.
- **Victoria `s1-1`: 248.5 → 259.9 s**: 7.1 s looking and 5.8 s giving way to `car_36` at a
  two-way stop. **Mount Pleasant `s1-1`: 126.2 → 135.7 s**: 4.1 and 3.2 s looking at two.
- **Kitsilano fog `s1-5`: 154.9 → 214.7 s**: 3.1 s giving way to `car_p3`; the rest is traffic
  ahead of it, with no stop longer than 3 s.
- **Kitsilano dry `s1-2`** (83.9 → 89.8 s) and **`s1-6`** (210.3 → 215.3 s), and **rain `s1-6`**
  (229.7 → 218.3 s): traffic differences.
- **Kitsilano dry `s1-8`: 214.3 → 177.9 s and fog `s1-4`: 194.3 → 153.2 s** (WebKit fog
  197.5 → 153.2 s): sooner, because traffic that now gives way is elsewhere when the car comes
  by; `s1-8` gives way for 9.5 s at two two-way stops, to `car_p2`, `car_p4` and `car_12`, and
  spends 8.1 s looking, and still arrives 36 s sooner.

#### Traffic changing lanes, then swinging back (WebKit Kitsilano dry `s1-6`)

An earlier WebKit after run failed Kitsilano dry `s1-6` with a collision at 139.5 s. The car and
`car_10` moved off side by side from the signal at West Broadway and Larch Street, the car in the
left lane and `car_10` in the right. Past the junction `car_10` swung left into the car's lane,
19° off the street at 7.8 m/s, and the car hit it at 4.4 m/s (counted at fault: `car_10` was
ahead of it and heading within 20° of it). `car_10` had changed into the right lane on the block
before, but the lane it had already planned for the next block was still the left one, so its
path crossed back where the two blocks joined. A traffic car that changes lanes now re-plans the
lanes ahead from its new one (`NpcPath.switchLane`), and the final runs above include that
change: WebKit `s1-6` arrives at 203.3 s (212.6 s before) without contact.

#### The emergency brake and a lane's jog (WebKit Toronto `s1-1`)

The first WebKit after run, before the emergency-brake change, failed Toronto dry `s1-1` with a
collision at 115.5 s. Going straight through the signal at Bloor Street West and Huron Street,
the route moves from the curb lane to the inner lane inside the junction, so the polyline swings
to 40° off the street for about 8 m. `car_1`, waiting in the opposite inner lane to turn left,
stood 1.7 m to the left of the car's path. With the car's nose swung toward it, the emergency
brake fired, and it held the steering wheel where it was, so the car kept turning into
`car_1` (2.5 m/s at contact, at fault). V8 drove the same path at the same time without
`car_1` there. Placing `car_1` there in V8 reproduces the contact at 115.5 s with the brake as it
was. With the brake steering along the car's path, as the `hard_brake` manoeuvre does, it does
not occur at any of five placements between 113.3 and 114.0 s. The final runs above include
that change; Toronto passes 2 of 2 in both engines.

## Earlier record: 2026-10-23b (all-way stop fixes)

Rules passes **70 of 70 routes in both V8 and WebKit**, with no collisions, red-light
violations, stop-sign violations or failures to yield. "Before" is main at `4119e87`; "after"
is PR #27's fixed simulation code at `29ec036`, fixing the Toronto timeout and manual turn
indicators at all-way stops.

### Method

Both engines ran all 15 seeded suites through the production suite builder, runner and metrics:
Rules, suite seed 1, 40 traffic cars, lockstep. Kitsilano has 12 routes in each of dry, fog, rain
and snow; the other eleven maps have two dry routes each. One benchmark suite ran at a time.

The V8 post-fix run used `scripts/bench_node.mjs` on macOS 27.0.1 (26A434), arm64,
with Node `v24.19.0` and V8
`13.6.233.17-node.51`, matching the engine versions of the initial Linux cloud runs. The local
server ran `PORT=8331 uv run --locked server.py`; HTTP readiness was checked. For example:

```sh
npx --yes --package=node@24.19.0 node scripts/bench_node.mjs --port 8331 --map toronto --count 2 --weather dry --json toronto-dry.json
```

WebKit also reran all 15 suites before and after, on the same Mac, using WebKit framework
`22625.1.29.11.28`. The unmodified `scripts/shot.swift` was compiled with `swiftc`, and each suite
used a fresh WKWebView process. A temporary `git archive 4119e87` checkout served the before
code on port 8332; the PR at `a994c50` (the same simulation code as `29ec036`) served after on
8331. Both servers used the current checkout's `.venv/bin/python3`. Each page waited for its
map to load, then called `window.__bench.run` with Rules, seed 1, 40 traffic cars, lockstep,
the requested count/weather, and `save: false`; its returned config, summary and route results
were captured directly. Every before summary exactly reproduces the previous WebKit main
baseline in `rebaseline-2026-10-22b-rules.json`.

The [machine-readable record](validation/rebaseline-2026-10-23-rules.json) retains the original
cloud `v8` before/after results unchanged and adds the rerun under `post_fix.v8`, with the exact
code commit and method. In V8, all rounded route metrics and event types/times match the initial
cloud after results, apart from Toronto dry `s1-2`. Victoria's first safety event has sub-1e-12
differences in its unrounded gap and closing speed; wall times differ. The WebKit rerun is
stored under `webkit_rebaseline.suites` in the same file. Night was not run.

The review follow-up at `ed19adb` restricts the stop-sign oncoming audit to left turns and
U-turns, clears stale context at other routed stop crossings, and judges manual turns from
actual heading rather than the indicator. It changes no driving or physics code. Toronto and
Ottawa dry (two routes each) were rerun in both engines: all four suite summaries and all route
metrics/events reproduce this full rebaseline within 1e-12, excluding wall time. Those results
are recorded under `audit_scope_validation`; the regression checks also cover straight/right
departures and both routed and manual left turns/U-turns with missing or misleading indicators.

### Results

Kitsilano passes 48 of 48 routes; the city smoke suites pass 22 of 22. No route before or after
has a collision or traffic-rule violation. Passed / routes; deadlock overrides and mean speeds
are main → fixed PR.

#### V8

| Map and conditions | Before | After | Deadlock overrides | Mean km/h |
|---|---:|---:|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0 → 0 | 23.18 → 23.19 |
| Kitsilano, fog | 12/12 | 12/12 | 0 → 0 | 17.09 → 17.09 |
| Kitsilano, rain | 12/12 | 12/12 | 0 → 0 | 19.56 → 19.5 |
| Kitsilano, snow | 12/12 | 12/12 | 0 → 0 | 14.89 → 14.89 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0 → 0 | 19.25 → 19.25 |
| Victoria, dry | 2/2 | 2/2 | 0 → 0 | 15.35 → 15.25 |
| Toronto, dry | 2/2 | 2/2 | 4 → 4 | 19 → 18.45 |
| Montréal, dry | 2/2 | 2/2 | 0 → 0 | 25.6 → 25.6 |
| Calgary, dry | 2/2 | 2/2 | 0 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 3 → 3 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0 → 0 | 28.25 → 28.2 |
| Halifax, dry | 2/2 | 2/2 | 0 → 0 | 20.95 → 20.95 |
| Winnipeg, dry | 2/2 | 2/2 | 0 → 0 | 36.65 → 36.65 |
| Edmonton, dry | 2/2 | 2/2 | 0 → 0 | 31.15 → 31.15 |
| Saskatoon, dry | 2/2 | 2/2 | 0 → 0 | 29.85 → 29.85 |

#### WebKit

| Map and conditions | Before | After | Deadlock overrides | Mean km/h |
|---|---:|---:|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0 → 0 | 23.54 → 23.65 |
| Kitsilano, fog | 12/12 | 12/12 | 0 → 0 | 17.39 → 17.39 |
| Kitsilano, rain | 12/12 | 12/12 | 0 → 0 | 19.53 → 19.47 |
| Kitsilano, snow | 12/12 | 12/12 | 0 → 0 | 15.06 → 15.06 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0 → 0 | 18.9 → 19.25 |
| Victoria, dry | 2/2 | 2/2 | 0 → 0 | 17.7 → 17.65 |
| Toronto, dry | 2/2 | 2/2 | 4 → 4 | 17.55 → 19.05 |
| Montréal, dry | 2/2 | 2/2 | 0 → 0 | 25.6 → 25.6 |
| Calgary, dry | 2/2 | 2/2 | 0 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 3 → 3 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0 → 0 | 28.25 → 28.25 |
| Halifax, dry | 2/2 | 2/2 | 0 → 0 | 21.35 → 21.35 |
| Winnipeg, dry | 2/2 | 2/2 | 0 → 0 | 36.65 → 36.6 |
| Edmonton, dry | 2/2 | 2/2 | 0 → 0 | 31.15 → 31.15 |
| Saskatoon, dry | 2/2 | 2/2 | 0 → 0 | 29.85 → 29.85 |

### Failures

#### V8

**No V8 route failures remain.** Toronto dry `s1-2`, which timed out at 310.4 s in the initial
implementation, now arrives at 176.6 s (main: 165.5 s). Its four deadlock overrides return at
46.3, 46.4, 46.7 and 47.0 s, matching main. The stop line retained for left-turn sensing no
longer suppresses deadlock recovery once it is 3 m behind the car. Genuine oncoming conflicts
still hold the deadlock timer, as do incomplete stops at the line and small overshoots.

The recovered route records two safety brakes, at 51.1 s (a vehicle ahead) and 173.4 s (following
gap 1.97 m), with no contact or violation; its closest gap is 1.6 m. The first brake also occurred
on main. Stopped time falls from 277.1 s in the timeout to 21.4 s. All other routes reproduce the
initial cloud after rounded metrics and event types/times.

Toronto's overrides are 4 → 4 versus main; Ottawa's remain 3 → 3, at 22.7, 22.9 and 23.2 s on
`s1-1`, which arrives at 175.3 s. No other suite has a deadlock override. Relative to main,
Kitsilano rain `s1-3` still takes 99.6 → 103.7 s and adds two safety brakes; Victoria `s1-2`
takes 237.6 → 240.6 s and adds two, with closest gap 17.3 → 2.4 m. Both pass without contact.

The manual-turn fix is covered separately by `scripts/test_all_way_stop.mjs`: a manual left
indicator holds an opposing vehicle that arrived later, yields on a tie, and updates priority
when changed at the line. With a route, its planned turn takes precedence. Both new regression
checks failed without their corresponding fixes.

#### WebKit

**No route failures occur before or after.** Toronto dry `s1-1` takes 226.3 → 207.1 s, and
`s1-2` takes 176.4 → 164.5 s. The latter retains four deadlock overrides at 46.3, 46.4, 46.7
and 47.0 s, and one safety brake at 51.1 s, before and after. Ottawa's three overrides remain
at 22.7, 22.9 and 23.2 s on `s1-1`, which arrives at 175.3 s on both sides. These deadlock
events do not record vehicle IDs. Every other suite has zero overrides, and all suites have
zero collisions, red-light violations, stop-sign violations and failures to yield.

Other timing changes of at least 5 s, and all changes in safety-brake counts:

- Kitsilano dry `s1-7` takes 226.6 → 212.3 s. The route passes without contact or violation.
- Kitsilano rain `s1-3` takes 99.6 → 103.7 s; safety brakes change 0 → 2, both for an open door,
  at 94.5 and 95.1 s. Closest gap is 4.5 → 1.9 m. The route passes without contact or violation.
- Mount Pleasant dry `s1-1` takes 130.2 → 125.8 s; safety brakes change 1 → 0, removing the
  following brake at 117.1 s. Closest gap is 2.3 → 3.3 m. The route passes without contact
  or violation.

## Earlier record: 2026-10-23 (initial all-way stops)

This record covers turn order at all-way stops and yielding to oncoming traffic on left turns at
stop signs. "Before" is main at `4119e87`; "after" is PR #27 at `c88f98f`. V8 passes 70 of 70
routes before and 69 of 70 after: Toronto dry `s1-2` now times out. The regression is recorded
below; no simulation code was changed for this baseline.

### Method

Production suite builder, runner and metrics through each checkout's own `scripts/bench_node.mjs`:
Rules, suite seed 1, 40 traffic cars, lockstep. Kitsilano ran 12 routes in each of dry, fog, rain
and snow; Mount Pleasant, Victoria, Toronto, Montréal, Calgary, Ottawa, Québec City, Halifax,
Winnipeg, Edmonton and Saskatoon each ran two dry routes. One suite ran at a time. Both checkouts
used Node `v24.19.0`, V8 `13.6.233.17-node.51`, and their own production audits. The after audit
additionally checks all-way-stop turn order and oncoming traffic on left turns at stop signs.

The PR checkout served port 8331; a separate `git worktree add ../before 4119e87` checkout served
port 8332. Each ran `PORT=<port> python3 server.py`, the stdlib fallback, and HTTP readiness was
checked before running. For example, from the corresponding checkout:

```sh
node scripts/bench_node.mjs --port 8331 --map kitsilano --count 12 --weather dry --json after-kitsilano-dry.json
node scripts/bench_node.mjs --port 8332 --map kitsilano --count 12 --weather dry --json before-kitsilano-dry.json
```

Node 24 uses built-in module detection; `--experimental-default-type=module` was omitted because
this version rejects it. **This record is V8 only. WebKit was not run:** `scripts/shot.swift` is
macOS-only and this environment is Linux. Night was not run. Compare these results with V8 runs.
The [machine-readable record](validation/rebaseline-2026-10-23-rules.json) preserves every suite's
summary and per-route results directly from its `--json` output, before and after.

### Results

V8. Passed / routes; collisions are total / at fault. Deadlock overrides and mean speeds are
before → after.

| Map and conditions | Before | After | Collisions (before → after) | Deadlock overrides | Mean km/h |
|---|---:|---:|---|---|---|
| Kitsilano, dry | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 23.18 → 23.19 |
| Kitsilano, fog | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 17.09 → 17.09 |
| Kitsilano, rain | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 19.56 → 19.5 |
| Kitsilano, snow | 12/12 | 12/12 | 0/0 → 0/0 | 0 → 0 | 14.89 → 14.89 |
| Mount Pleasant, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 19.25 → 19.25 |
| Victoria, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 15.35 → 15.25 |
| Toronto, dry | 2/2 | 1/2 | 0/0 → 0/0 | 4 → 0 | 19 → 11.4 |
| Montréal, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 25.6 → 25.6 |
| Calgary, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 19.5 → 19.5 |
| Ottawa, dry | 2/2 | 2/2 | 0/0 → 0/0 | 3 → 3 | 18.4 → 18.4 |
| Québec City, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 28.25 → 28.2 |
| Halifax, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 20.95 → 20.95 |
| Winnipeg, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 36.65 → 36.65 |
| Edmonton, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 31.15 → 31.15 |
| Saskatoon, dry | 2/2 | 2/2 | 0/0 → 0/0 | 0 → 0 | 29.85 → 29.85 |

Kitsilano passes 48 of 48 routes across the four weathers before and after. The city smoke suites
pass 22 of 22 before and 21 of 22 after. No route on either side has a collision, red-light
violation, stop-sign violation or failure to yield. Toronto's four deadlock overrides become zero
alongside a timeout; Ottawa's three remain unchanged. All other suites have zero overrides on
both sides.

Outside Toronto, mean speed changes by at most 0.10 km/h. Kitsilano rain `s1-3` takes
99.6 → 103.7 s and adds two safety brakes (0 → 2); Victoria `s1-2` takes 237.6 → 240.6 s and
also adds two (0 → 2), with closest gap 17.3 → 2.4 m. Both routes still pass without contact.

### Failures

**Toronto dry `s1-2` regresses from a pass at 165.5 s to a timeout at 310.4 s.** After the change,
the car travels 146 m, reaches 18.8% of the route and records 277.1 s stopped. Its event list is empty: there is
no arrival, collision, yield violation or deadlock event. Separate before/after diagnostic
replays reproduced every saved route metric exactly.

Both drives initially slow into the same stall during the first left turn, at the two-way stop
`stop78`, junction `n24959550`. Rules keeps choosing `keep_lane_stop` even though forward
manoeuvres remain eligible and predict no collision. At 46.5 s in the after replay, the car is
stationary at route progress 145.69 m, its front 24.65 m past the stop line. `car_p1` is stationary about
14.7 m away; `car_25` approaches later, visible nearby at 48 s. The snapshot has no oncoming
conflict, moving cross traffic, following vehicle or all-way priority wait.

Before, the deadlock detector recognises the stall and emits four overrides at **46.3, 46.4,
46.7 and 47.0 s**. The car creeps out, records a safety brake at 51.1 s, and arrives at 165.5 s.
After, sensing retains the left-turn stop while the car is still near the junction so it can
check oncoming traffic. At this point stop memory no longer marks the stop complete. The
deadlock detector treats an incomplete stop with `bumper_to_line_m < 12` as a legitimate wait,
with no lower bound to exclude a line already behind the car. It therefore keeps `stuckFor`
at zero even with the line 24.65 m behind, and never triggers the earlier recovery. **Toronto's
override count changes 4 → 0 alongside this timeout.** The regression was unfixed at this initial benchmark commit; see the post-fix record above.

**Ottawa's three overrides are unchanged (3 → 3).** They all occur on `s1-1`, at **22.7, 22.9
and 23.2 s**, before and after, and that route arrives at 175.3 s on both sides. These events do
not record a vehicle ID. All suites besides Toronto and Ottawa retain zero overrides. There are
no other route failures, collisions or failures to yield in this record.

## Earlier record: 2026-10-22b (right on red)

This rerun covers right turns on red and two fixes to left turns at a signal. The driven car and
traffic turn right on red after a full stop wherever the map allows it (every bundled map but
Montréal's), and the audit counts such a turn as legal only after a full stop. Turning left, the
car now waits for an oncoming car pulling away from its own line, allows for oncoming vehicles
speeding up, and no longer takes the left indicator of a car pulling out of a parking spot for a
left turn. "Before" is `b8ce8a8` from a `git archive`; "after" is the same commit with this change.
Both ran on the same day in the same harness, in WebKit and in V8, so the difference between them
is this change alone.

### Method

As on the earlier 2026-10-22 record: production `/bench`, Rules, suite seed 1, 40 traffic cars,
lockstep, in WebKit through `scripts/shot.swift` on macOS 27.0.1. Kitsilano ran 12 routes in dry,
fog, rain and snow; the other eleven maps ran two-route dry smoke suites. The same suites also ran
in V8 (Node 22.23.4) through `scripts/bench_node.mjs`. The WebKit Kitsilano dry run is
[`20261022-153156-rules.json`](../data/runs/20261022-153156-rules.json). The
[machine-readable record](validation/rebaseline-2026-10-22b-rules.json) has every summary and
per-route result, before and after, in both engines, and how often the car turned right on red.
Night was not run.

The "before" columns reproduce the earlier 2026-10-22 "after" columns exactly, in both engines.

### Results

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

### Failures

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

### Repeat

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
