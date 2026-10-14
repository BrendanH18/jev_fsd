# Rules benchmark baseline — 2026-10-14

This rerun re-baselines the seeded Rules suites on commit `62fe050`. No simulation, brain or
rendering code changed. Since the 2026-09-30 record, `static/js/sim` and `static/js/brain` changed
in PRs #9–#12: an agent registry, reroute epoch handling, challenge hooks and comment cleanup.
Rain and snow had not been run as full suites since the realism work. This is their first record.

## Method

Production `/bench`, Rules, suite seed 1, 40 traffic cars, lockstep. Kitsilano ran 12 routes in
dry, fog, rain and snow. The other bundled maps ran two-route dry smoke suites.

Each suite ran in WebKit through `scripts/shot.swift` on macOS 27.0.1. The script calls
`window.__bench.run(...)` on `/bench?map=<preset>`, and the page saves its own result through
`/api/bench/save`. The Kitsilano dry run is committed as
[`20261014-091959-rules.json`](../data/runs/20261014-091959-rules.json). The two older runs in
`data/runs/` remain. [Machine-readable record](validation/rebaseline-2026-10-rules.json) has the
commit, summaries, per-route results and the checks below.

Night was not run. `/bench` has no time-of-day option. Its world never calls
`visibility.setNight`, so every bench drive uses daylight sensing. The 2026-09-30 suites had
the same limitation.

## Results

"Before" is the 2026-09-30 record in [world-validation.md](world-validation.md). The counts are
collisions / at-fault and red / stop / yield. Off-road and safety brakes are suite totals.

| Map and conditions | Before | Now | Arrived | Collisions | Red / stop / yield | Off-road s | Safety brakes | Mean km/h (before → now) |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Kitsilano, dry | 10/12 | 11/12 | 12/12 | 1 / 0 | 0 / 0 / 0 | 0.2 | 10 | 22.55 → 22.83 |
| Kitsilano, fog | 10/12 | 10/12 | 12/12 | 1 / 0 | 0 / 0 / 0 | 1.4 | 8 | 17.06 → 17.18 |
| Kitsilano, rain | not run | 11/12 | 12/12 | 1 / 1 | 0 / 0 / 0 | 0.2 | 8 | — → 19.21 |
| Kitsilano, snow | not run | 10/12 | 12/12 | 2 / 0 | 0 / 0 / 0 | 0.4 | 5 | — → 15.01 |
| Mount Pleasant, dry | 2/2 | 2/2 | 2/2 | 0 / 0 | 0 / 0 / 0 | 0 | 1 | 19.3 → 19.6 |
| Calgary, dry | 1/2 | 1/2 | 1/2 | 2 / 1 | 0 / 0 / 0 | 0 | 1 | 16.4 → 13.85 |
| Ottawa, dry | 2/2 | 1/2 | 1/2 | 1 / 1 | 0 / 0 / 0 | 0 | 1 | 18.4 → 12.85 |
| Québec City, dry | 2/2 | 1/2 | 1/2 | 1 / 1 | 0 / 0 / 0 | 0 | 0 | 28.25 → 17.3 |
| Victoria, dry | not run | 1/2 | 1/2 | 2 / 1 | 0 / 0 / 0 | 13.5 | 0 | — → 9.5 |
| Toronto, dry | not run | 1/2 | 1/2 | 2 / 1 | 0 / 0 / 0 | 0 | 0 | — → 10.35 |
| Montréal, dry | not run | 2/2 | 2/2 | 0 / 0 | 0 / 0 / 0 | 0 | 1 | — → 25.6 |

All Kitsilano routes arrived, and Kitsilano had no red-light, stop or yield violations in any
weather. Before this run, Calgary had 0.6 s off-road and every new-map smoke route arrived.

## Failures

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

## Why the numbers moved

Code changes are not the cause. All eight dry suites ran again from a `git archive` of `bbc9012`,
the commit behind the 2026-09-30 record, in the same WebKit harness. Every summary and per-route
result matched `62fe050` exactly, except wall-clock time.

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

## Repeat

```sh
PORT=8331 uv run server.py
```

Open `/bench?map=kitsilano`, or another preset such as `calgary`, and run the suite from the
page or the console:

```js
await window.__bench.run({ brain: "rules", count: 12, npcs: 40, seed: 1, mode: "lockstep", weather: "dry" })
```

Headless runs pass the same call as the `pre_js` argument with a long timeout:

```sh
swift scripts/shot.swift "http://127.0.0.1:8331/bench?map=kitsilano" out.png 1 "" \
  "return (await window.__bench.run({ count: 12, weather: 'dry' })).summary" 3 3000
```

Results save to `data/runs/`. Choose this baseline under **compare with** on `/bench`.
