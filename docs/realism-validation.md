# Realism validation — 2026-09-29

The revised world gives the ego building occlusion, weather-limited observations, parking
maneuvers, and opening doors. Jev's wording now asks for judgment about clearance, comfort and
uncertainty, with target speed as a reference. **Live Jev behavior remains unverified:** the local
server reports no API key. Offline results establish simulator behavior and request consistency,
not model judgment or a behavioral difference between Jev and Rules.

## Offline checks

- 94/94 browser assertions pass, including hidden vehicles and pedestrians, no hidden-object
  leakage through candidate prediction or the emergency brake, physical collisions despite
  occlusion, fog range and stopping room, unknown signal phases, parking, pull-out waiting,
  velocity-preserving NPC recovery, and door sensing, prediction, collision and closure.
- 43/43 Python tests pass. The offline snapshot checker validates all 20 requests: 11 new
  committed realism cases and 9 existing saved decisions.
- Committed realism cases match the production sensing, simulation and question pipeline exactly.
  The generator's `--check` reports no drift. Model expectations for approaching and holding at
  crossings have been specified, but have not been checked against model answers.
- The interactive scene was exercised with an open door. Its rendered panel center matched the
  simulation's collision box center exactly. Traffic-to-parking transfers retain the actual
  vehicle pose and remove its moving mesh.

## Rules benchmark

Twelve routes, seed 1, 40 traffic cars, lockstep, the production `buildSuite` and `runScenario`
functions, with graphics omitted. The historical dry baseline is
[`20260928-222541-rules.json`](../data/runs/20260928-222541-rules.json). The new parking, door and
recovery policies change how the seeded traffic develops, so this compares worlds as well as
driver behavior. Full records: [dry](validation/realism-dry-rules.json) and
[fog](validation/realism-fog-rules.json). Local copies are also available in `/bench` under
**compare with** as `20260929-realism-dry-rules` and `20260929-realism-fog-rules`.

| Metric | Historical dry | Revised dry | Revised fog |
|---|---:|---:|---:|
| Passed routes | 12/12 | 10/12 | 10/12 |
| Arrived | 12/12 | 12/12 | 12/12 |
| Collisions | 0 | 2 | 1 |
| Collisions attributed to ego | 0 | 0 | 0 |
| Red / stop / yield violations | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Total off-road time | 0.1 s | 0.2 s | 1.4 s |
| Safety brakes | 7 | 9 | 5 |
| Mean speed | 24.45 km/h | 22.03 km/h | 17.08 km/h |

The benchmark counts every collision as a failed drive, regardless of the simulator's approximate
fault attribution. Dry failures are `s1-6` (crossing traffic, shared fault) and `s1-7` (oncoming
traffic while ego was stopped, other fault). Fog failures are `s1-3` (pull-out contact, other
fault) and `s1-9` (off-road time). These remain simulator/Rules limitations; the new world does
not retain the older perfect pass rate. Rain and snow were not rerun for the final revision.

## Repeat the checks

```sh
uv run python -m unittest discover tests
node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check
uv run scripts/verify_jev.py --offline
```

Open `/tests` for the browser checks and `/bench` for the seeded Rules suite. With an API key,
run `uv run scripts/verify_jev.py` and the same benchmark with Jev, including driving-style
variants. Passing saved decisions alone does not establish closed-loop driving behavior.
