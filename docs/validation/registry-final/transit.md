# Feature registry, final batch, part A: transit and rail — 2026-11-26 (ROADMAP 3.2)

Transit buses, school buses, streetcars and trains at level crossings moved onto the feature
registry ([feature interface](../../feature-interface.md)), one commit each on top of `8c34c637`, in
the order that keeps every pipeline's slot boundaries clean at each step: trains, then streetcars,
then school buses, then buses. The core files no longer import `sim/bus.js`, `sim/school-bus.js`,
`sim/streetcar.js`, `sim/rail.js` or the shared `sim/transit-runs.js`, and
`scripts/test_feature_registry.mjs` checks that they name none of the four features' snapshot fields,
candidates, rejections, World fields or vehicle tests.

## What moved

| Feature | Record | Fleet state (`fleet.<key>`) | World state |
|---|---|---|---|
| Transit buses | `sim/features/buses.js` | `Buses` (a `TransitRuns`): `spawn`, `runs`, `manage`, `plan`, `stopSoon`, `yieldTo`, `list`, `target`, `next` | `world.buses` (the World option), `busCalls`; `busYields` stays lazy |
| School buses | `sim/features/school-buses.js` | `SchoolBuses`: `add`, `spawn`, `manage`, `plan`, `yieldTo`, `avoidCorner`, `list`, `target`, `next` | `schoolYields`, `schoolCalls` |
| Streetcars | `sim/features/streetcars.js` | `Streetcars` (a `TransitRuns`): `spawn`, `runs`, `manage`, `plan`, `yieldTo`, `list`, `target`, `next` | `streetcarYields`, `streetcarCalls` |
| Trains | `sim/features/trains.js` | `Trains`: `spawn`, `manage`, `hold`, `list`, `crossings`, `target`, `next` | `onTracks` (read by coaching), `trainCalls`; `trainYields` stays lazy |

`sim/transit-runs.js` holds what buses and streetcars share: their runs of the map's transit routes,
placement, run following, path recovery and replacement, each mode with its own random stream as
before. Each record also owns its sensing, speed target, hazard flag, stop candidate, forward-sim
rejection, decision state, outcome, situation clause, hold-still wording, prompt line, flag text,
Rules required wait, legitimate stop and audit, and every driver's stop for it.

Callers outside the core moved to the fleet state: the challenges (`fleet.buses.spawn`,
`fleet.streetcars.spawn`, `fleet.schoolBuses.add`, `fleet.trains.spawn`), `main.js` (`.list`),
`sim/traffic-inspection.js` (`fleet.<key>.next` and `.target`) and the tests. The World option
`buses` is unchanged; free drives still set it beside the fleet's.

## New hooks, fields and slots

Registration puts the four records together, in the order buses, school buses, streetcars, trains,
just before the garbage trucks: that is the order of their sensing, candidates, wording and audits.
The fleet placed them buses, streetcars, school buses, trains, before the garbage trucks and plows;
buses and streetcars keep that by building at `buildAt: "early"`, which for a fleet record now builds
its fleet state first, right after the cyclists (`buildFleetFeatures`).

- **Record fields.** `worldOption` (a fleet feature whose option the World takes too, so free drives
  set both) and `freeDrive(on, { hour })` (the school run's hours).
- **Obstacle descriptor.** `heavy` (keeps under the limit and stops for any body in its way just
  ahead), `noseFirst` (with `heavy`, ignores what is beside it short of its front), `onTrack` (never
  pulls over), `ownLane` (does not ease past what stands at the kerb), `pathPolicy(o)` (the transit
  kind the path policy takes it as, or false for none), `laneShift(o)` (its own move toward the kerb)
  and `standing(o)` (drivers ease past it). Each vehicle also has `long`, `traffic` and `noParking`.
- **Hooks.** `trafficHold` (slots `"buses"` and `"end"`) and `emergencyHold`, where a driver stops for
  the feature; `trafficLaneChange`, `trafficRecover`, `trafficIndicator` and `trafficStanding` (the
  core's generic ease past standing vehicles, `standingNudge`, which garbage trucks' kerb clearance
  shares); `rulesWait`; `parkingZones`; `crosswalkVehicle`. `trafficManeuver` is handed `all`,
  `trafficReplan` the fleet, and the `"end"` `trafficStop` the vehicle's projection on its path.
- **Slots.** `"buses"` (audit, sense, target, hazard, candidates, sim, state, clause, holdStill,
  prompt, trafficManage, trafficHold) for the bus's place right after the emergency vehicle's code;
  `"afterCrosswalk"` (sense, target, hazard, candidates, sim, state, clause, holdStill, prompt) for
  school buses, streetcars and level crossings after the crosswalk; target `"streetcars"` after the
  crossing guard's `"afterSchoolBus"`; trafficManage `"schoolBuses"`; trafficReplan `"corner"`; and
  prompt `"schoolBuses"`.

A planned stop that moved from its own place to the `trafficStop` minimum (a bus's or streetcar's
stand, a school bus's stop) gives the same gap: each such stop sets `gap = max(0.05, stop)` and
`leadV = 0` only when it is shorter, which is the same whatever the order, and nothing reads the gap
between those places.

## For the docs, once the batch is merged

- The feature table in `AGENTS.md` and `docs/feature-interface.md`: the four rows now point at their
  records; their shared tests are unchanged. The count of registered features in
  `docs/feature-interface.md` goes up by four.
- `docs/feature-interface.md` ("A record", "Moving the rest"): the fields, descriptor flags, hooks and
  slots above.
- `npc.js`'s `BUS_BODY_LOOK_M` is now `LONG_BODY_LOOK_M`; the emergency vehicles' stand-down rejoin
  uses it.

## What is left in the core

- Slot names (`"buses"`, `"schoolBuses"`, `"streetcars"`, `"afterSchoolBus"`), as earlier batches'
  slots are named after the feature that runs there, and comments that use a bus as an example.
- `world.js`'s collision comment ("a bus standing at an angle") and `sim/pedestrians.js`, which rides
  riders on and off streetcars and lets children off school buses (`crowd.rideOn`, `rideOff`,
  `alight`): not a core file for this batch.
- The HUD notices for the four features stay in `main.js`, as before.

## Parity

Compared the whole batch (`55e61ce0`) with an archive of `8c34c637` in Boat, Node 22.23.5, lockstep,
Rules (and the cautious agent in the arena), `PYTHONHASHSEED=0`, each tree against a loopback server
started from the working checkout (`PYTHONHASHSEED=0 PORT=8331 uv run --locked server.py`). From each
source tree:

```sh
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" bare
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city toronto
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city edmonton
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" rules
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" cautious
node --experimental-default-type=module scripts/registry_parity.mjs prompt "$out"
node --experimental-default-type=module scripts/test_model_recording.mjs
node --experimental-default-type=module scripts/registry_parity.mjs compare "$before" "$after" \
  --expect toronto-city-dry.json,edmonton-city-dry.json
```

| Capture | Before and after |
|---|---|
| Kitsilano bare, dry, seed 1 | identical: 12/12, 10.53 km |
| Kitsilano city, dry, seed 1 (buses and school buses at 15:30) | identical: 12/12, 12.81 km |
| Toronto city, dry, seed 1 (streetcar routes) | identical: 9/12, 10.65 km; `s1-6`, `s1-10` and `s1-11` fail on both |
| Edmonton city, dry, seed 1 (the heritage line's level crossings, a train on the track) | identical: 11/12, 13.17 km; `s1-11` fails on both (one failure to yield) |
| Every challenge and both road tests, Rules (among them the bus pulling out, school bus, streetcar and level crossing challenges) | identical: 62/62 pass |
| The same with the cautious agent | identical: 62/62 pass |
| Guarded and open LLM system prompts | byte for byte |
| `scripts/test_model_recording.mjs` | passes on both trees |

The comparison dropped only timings (`wall_ms`, decision latency, `started_at`) and benchmark source
provenance.

Targeted checks while working (each commit, in Boat): `test_feature_registry`, `test_free_drive`,
`test_buses`, `test_streetcars`, `test_school_buses`, `test_school_bus_corner`, `test_level_crossings`,
`test_emergency_stand_down`, `test_5k_traffic_inspection`, `test_open_track`, `test_bench_options`,
`test_bus_lanes` and its latch, merge and turn-in checks, `test_collection_clearance`,
`test_collection_trucks`, `test_traffic_body_sweep`, `test_snowbank_turn_entry`,
`test_snowbank_waiting_lane`, `test_pull_over_rejoin`, `test_sim_parked_lifecycle`, `test_drive_lab`,
`test_model_recording`, the `test_5k_registry-a_*` and `test_5k_transit_road` checks,
`build_jev_fixtures.mjs --check` (no stale fixtures) and `npm run lint`.
