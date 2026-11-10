# Parking, night and interaction soak, 10 November 2026

Implementation: `c68570acaaea7319ead1270a1188b99fce9038b4`. Follow-up page validation handling:
`35bfa86`. Starting tree: `bd81abd`. Node 22.23.4, Rules, lockstep, 40 traffic cars,
pack version 6. Every benchmark used the production server on port 8381. No sim, brain,
map, router or ROADMAP files changed. No dependencies or tools were added.

## Design

- Parking and hour apply to **bare and city**, so parking alone is a separable suite. Bare has no
  clock unless an hour is supplied; city defaults to fixed Monday 15:30. A requested hour changes
  darkness using the renderer's sun-elevation transition, pedestrian populations and school-bus
  options through `freeDriveOptions`, plus restriction-aware route queries. Defaults serialize
  exactly as before: `park: false` is omitted, city `hour: 15.5` is omitted, and bare keeps its absent
  clock. Parking uses the authored challenge verdict: an arrival requires `parked` and `within_kerb`.
- `--without geese,ice` uses canonical World/fleet option names. `--cover INDEX` selects a generated
  configuration; it can be combined with `--without` to narrow failures. Both require city.
  The browser, CLI and replay share option validation/storage.
- A seeded greedy binary covering array generates **13 configurations for 42 distinct switches**.
  It discovers switches and their URL parameters from `freeDriveOptions`, deduplicates shared
  `buses`, and leaves pedestrian density as an hour-dependent population rather than a binary
  feature. It covers all four settings of all 861 pairs, except the impossible
  `hazards=off, stepOuts=on` setting: **3,443 feasible pair settings**. The array includes destination
  parking. Every row passes through the free-drive definition; disabling hazards disables step-outs.
- Soak suites use two routes per configuration. This deliberately keeps full configuration coverage
  small enough for CI; it is not a claim that every configured feature was encountered. City samples
  cover the map × seed product; covering rows run on the first map/seed. Ordinal modulo sharding is
  deterministic and disjoint. The weekly/manual Namespace workflow uses eight shards (3–4 suites
  each) and a separate four-case parking/night matrix, all report-only, with 30-minute job deadlines.
- Throws, any deadlock recovery (even if the car later arrives), timeouts and collisions return exit 1.
  Other rule/parking audits are reported separately and do not change soak exit status while city
  audit triage is open. `--check 1` still fails an ordinary benchmark on every failed route. Optional
  `--diagnostics 1` records bounded incident time, street, position, audit, actors and terminal context;
  default result shapes are unchanged.

## Files changed

- `static/js/bench/options.js`, `features.js`: validation, default-preserving configs, subsets and array.
- `static/js/bench/runner.js`: option application, darkness, challenge-equivalent parking and diagnostics.
- `scripts/bench_node.mjs`, `soak.mjs`: CLI options and reproducible/shardable soak reporting.
- `static/bench.html`, `static/js/bench/main.js`, `static/js/main.js`: controls, errors, storage and replay.
- `scripts/test_bench_options.mjs`: focused offline checks.
- `.github/workflows/soak.yml`, `AGENTS.md`: scheduled Namespace probes and usage.
- This report and its JSON evidence contain the validation findings.

## Checks

- `node --experimental-default-type=module scripts/test_bench_options.mjs`: PASS, under one second;
  pair coverage/determinism, valid dependencies, exact default option records, invalid options,
  parking/hour setup, optional result fields and exhaustive/disjoint shards. Assertions use primitives.
- `node --experimental-default-type=module scripts/test_free_drive.mjs`: PASS.
- `node --experimental-default-type=module scripts/test_drive_lab.mjs`: **331 checks PASS**;
  all 60 challenges with Rules and the cautious agent.
- `node --experimental-default-type=module scripts/test_simulation_errors.mjs`: all five checks PASS.
- `uv run python -m unittest discover -s tests`: **268 tests PASS**.
- JavaScript syntax checks, `git diff --check`, and workflow YAML parse with system Ruby: PASS.
- The retained `bd81abd` archive matched all **638 Git blobs** before comparison. The original city
  run started from the clean `bd81abd` tree before implementation edits. The after run loaded the
  committed benchmark implementation; the follow-up changes only page error handling and a test.
- Bare dry seed 1 matches the supplied `before-bare.json` **field for field** across config, summary,
  all 12 results and all events. City dry seed 1 matches the untouched `bd81abd` run **field for field**.
  Both comparisons omit only `wall_ms` and latency fields. Bare is 12/12; city remains 11/12, with
  exactly the existing s1-11 timeout and failure-to-yield audit.
- Repeated `city --hour 23.5 --only s1-1` and `city --count 2 --cover 4 --only s1-2` match their first
  runs field for field, including incident diagnostics, excluding only timings.

Stable JSON SHA-256 (all fields except `wall_ms` and latency, sorted keys):

| Record pair | SHA-256 |
| --- | --- |
| Bare supplied / implementation | `4859a3028d0cf5f2a5af975c93ae3672ccd33367fa974b234919cfbbea797ed2` |
| City bd81abd / implementation | `887635cd872bb37cb6a195521820bdf75bffa48cc3bd94b2317f21300e94b3f8` |

## Park and night: every output line

Each run uses Kitsilano, seed 1, Rules, dry unless shown, count 12. These include every original
stdout line, including the final config/summary JSON. Diagnostic result records are in the JSON
beside this report; failure descriptions follow the logs.

### --features city --weather dry --park 1

```text
s1-1 FAIL arrived=true t=88.1 coll=0/0 off=0 dl=0 safety=0 lc=0  failures=not parked
s1-2 FAIL arrived=true t=155.4 coll=0/0 off=0 dl=0 safety=2 lc=1  failures=not parked
s1-3 PASS arrived=true t=176.6 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-4 PASS arrived=true t=324.7 coll=0/0 off=0 dl=0 safety=2 lc=1
s1-5 FAIL arrived=true t=194.4 coll=0/0 off=0 dl=0 safety=3 lc=0  failures=not parked
s1-6 PASS arrived=true t=238.7 coll=0/0 off=0 dl=0 safety=1 lc=0
s1-7 PASS arrived=true t=262 coll=0/0 off=0 dl=0 safety=1 lc=0
s1-8 PASS arrived=true t=226.6 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-9 FAIL arrived=true t=219.7 coll=0/0 off=0.2 dl=0 safety=0 lc=0  failures=not parked
s1-10 PASS arrived=true t=235.4 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-11 FAIL arrived=false t=247.6 coll=0/0 off=0 dl=0 safety=2 lc=0  failures=timeout,failed to yield
s1-12 PASS arrived=true t=342.4 coll=0/0 off=0 dl=0 safety=1 lc=0
{"config":{"brain":"rules","count":12,"seed":1,"npcs":40,"mode":"lockstep","weather":"dry","features":"city","park":true,"map":"kitsilano","bbox":[-123.17,49.26,-123.15,49.27],"pack":"6","engine":"node v22.23.4"},"summary":{"scenarios":12,"pass_rate":0.583,"arrived_rate":0.917,"km":12.47,"collisions":0,"at_fault":0,"red_lights":0,"stop_signs":0,"failed_to_yield":1,"off_road_s":0.2,"safety_brakes":12,"deadlocks":0,"fallbacks":0,"violations_per_km":0.08,"avg_kmh":17.08,"min_gap_m":1.9,"min_ttc_s":1.1,"hard_brakes":0,"rms_jerk":3.22,"max_lat_accel":5.5,"lane_rms_m":0.46,"lane_changes":2,"speeding_s":0,"decisions":10375,"calls":0,"tokens":0,"cost_usd":0}}
```

### --features city --weather dry --hour 23.5

```text
s1-1 PASS arrived=true t=87 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-2 PASS arrived=true t=148.5 coll=0/0 off=0 dl=0 safety=2 lc=1
s1-3 PASS arrived=true t=165.2 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-4 PASS arrived=true t=287.2 coll=0/0 off=0 dl=0 safety=0 lc=1
s1-5 PASS arrived=true t=163.8 coll=0/0 off=0 dl=0 safety=2 lc=0
s1-6 PASS arrived=true t=244.4 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-7 PASS arrived=true t=259.1 coll=0/0 off=0 dl=0 safety=4 lc=0
s1-8 PASS arrived=true t=190.2 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-9 FAIL arrived=true t=252.8 coll=0/0 off=0.2 dl=0 safety=0 lc=0  failures=failed to yield
s1-10 PASS arrived=true t=208.4 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-11 PASS arrived=true t=164.8 coll=0/0 off=0 dl=0 safety=1 lc=0
s1-12 PASS arrived=true t=287.9 coll=0/0 off=0 dl=0 safety=2 lc=0
{"config":{"brain":"rules","count":12,"seed":1,"npcs":40,"mode":"lockstep","weather":"dry","features":"city","hour":23.5,"map":"kitsilano","bbox":[-123.17,49.26,-123.15,49.27],"pack":"6","engine":"node v22.23.4"},"summary":{"scenarios":12,"pass_rate":0.917,"arrived_rate":1,"km":12.8,"collisions":0,"at_fault":0,"red_lights":0,"stop_signs":0,"failed_to_yield":1,"off_road_s":0.2,"safety_brakes":11,"deadlocks":0,"fallbacks":0,"violations_per_km":0.08,"avg_kmh":18.94,"min_gap_m":2.3,"min_ttc_s":1.1,"hard_brakes":0,"rms_jerk":3.19,"max_lat_accel":5.28,"lane_rms_m":0.35,"lane_changes":2,"speeding_s":0,"decisions":9252,"calls":0,"tokens":0,"cost_usd":0}}
```

### --features city --weather dry --hour 6.5

```text
s1-1 PASS arrived=true t=109.9 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-2 FAIL arrived=false t=264.8 coll=0/0 off=0 dl=0 safety=0 lc=1  failures=timeout
s1-3 FAIL arrived=true t=156.4 coll=0/0 off=0 dl=0 safety=1 lc=0  failures=failed to yield
s1-4 PASS arrived=true t=318.7 coll=0/0 off=0 dl=0 safety=1 lc=1
s1-5 PASS arrived=true t=134.6 coll=0/0 off=0 dl=0 safety=2 lc=0
s1-6 PASS arrived=true t=264.5 coll=0/0 off=0 dl=0 safety=1 lc=0
s1-7 FAIL arrived=true t=315.6 coll=0/0 off=0 dl=0 safety=2 lc=0  failures=failed to yield
s1-8 FAIL arrived=true t=214.4 coll=0/0 off=0 dl=0 safety=0 lc=0  failures=failed to yield
s1-9 PASS arrived=true t=209.5 coll=0/0 off=0.2 dl=0 safety=0 lc=0
s1-10 PASS arrived=true t=257 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-11 PASS arrived=true t=189.7 coll=0/0 off=0 dl=0 safety=1 lc=0
s1-12 PASS arrived=true t=295.1 coll=0/0 off=0 dl=0 safety=2 lc=0
{"config":{"brain":"rules","count":12,"seed":1,"npcs":40,"mode":"lockstep","weather":"dry","features":"city","hour":6.5,"map":"kitsilano","bbox":[-123.17,49.26,-123.15,49.27],"pack":"6","engine":"node v22.23.4"},"summary":{"scenarios":12,"pass_rate":0.667,"arrived_rate":0.917,"km":12.41,"collisions":0,"at_fault":0,"red_lights":0,"stop_signs":0,"failed_to_yield":3,"off_road_s":0.2,"safety_brakes":10,"deadlocks":0,"fallbacks":0,"violations_per_km":0.24,"avg_kmh":16.76,"min_gap_m":0,"min_ttc_s":1.1,"hard_brakes":0,"rms_jerk":3.24,"max_lat_accel":5.35,"lane_rms_m":0.3,"lane_changes":2,"speeding_s":0,"decisions":10309,"calls":0,"tokens":0,"cost_usd":0}}
```

### --features city --weather fog --hour 23.5

```text
s1-1 PASS arrived=true t=115.8 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-2 FAIL arrived=true t=173.7 coll=0/0 off=0 dl=0 safety=2 lc=1  failures=failed to yield
s1-3 PASS arrived=true t=102 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-4 PASS arrived=true t=319 coll=0/0 off=0 dl=0 safety=2 lc=1
s1-5 PASS arrived=true t=229.9 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-6 PASS arrived=true t=269 coll=0/0 off=0 dl=0 safety=1 lc=0
s1-7 PASS arrived=true t=425.2 coll=0/0 off=0 dl=0 safety=5 lc=0
s1-8 FAIL arrived=true t=213.7 coll=0/0 off=0 dl=0 safety=0 lc=0  failures=failed to yield
s1-9 PASS arrived=true t=299.8 coll=0/0 off=0.4 dl=0 safety=0 lc=1
s1-10 PASS arrived=true t=225.8 coll=0/0 off=0 dl=0 safety=0 lc=0
s1-11 FAIL arrived=true t=190.3 coll=0/0 off=0 dl=0 safety=1 lc=0  failures=failed to yield
s1-12 PASS arrived=true t=292.7 coll=0/0 off=0 dl=0 safety=1 lc=0
{"config":{"brain":"rules","count":12,"seed":1,"npcs":40,"mode":"lockstep","weather":"fog","features":"city","hour":23.5,"map":"kitsilano","bbox":[-123.17,49.26,-123.15,49.27],"pack":"6","engine":"node v22.23.4"},"summary":{"scenarios":12,"pass_rate":0.75,"arrived_rate":1,"km":12.94,"collisions":0,"at_fault":0,"red_lights":0,"stop_signs":0,"failed_to_yield":3,"off_road_s":0.4,"safety_brakes":12,"deadlocks":0,"fallbacks":0,"violations_per_km":0.23,"avg_kmh":16.53,"min_gap_m":0.4,"min_ttc_s":0.3,"hard_brakes":0,"rms_jerk":2.81,"max_lat_accel":4.8,"lane_rms_m":0.26,"lane_changes":3,"speeding_s":0,"decisions":10490,"calls":0,"tokens":0,"cost_usd":0}}
```

## Park and night diagnoses

- **park, s1-1**: 88.1 s, West Broadway (e247, -133,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **park, s1-2**: 155.4 s, West 10th Avenue (e445, -303,-218): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **park, s1-5**: 194.4 s, West Broadway (e247, -105,-119): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **park, s1-9**: 219.7 s, West 4th Avenue (e200, 278,358): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **park, s1-11**: 247.6 s, Balsam Street (e453, -11,-462): drive deadline reached at 6.3 m/s, with no reported leader; `timeout`. 107.8 s, Larch Street (e574, -185,-436): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_1"}].
- **night, s1-9**: 235.3 s, Yew Street (e338, 354,344): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_2"}].
- **dawn, s1-2**: 264.8 s, West Broadway (e246, -332,-107): drive deadline reached at 0 m/s, behind `car_34` (2.8 m gap); `timeout`.
- **dawn, s1-3**: 122 s, West 5th Avenue (e213, -181,267): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_1"}].
- **dawn, s1-7**: 128.1 s, Arbutus Street (e153, 507,-90): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_1"}].
- **dawn, s1-8**: 155.5 s, Trafalgar Street (e553, -342,-93): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"fire_truck_1"}].
- **fog-night, s1-2**: 65 s, West Broadway (e246, -180,-107): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_1"}].
- **fog-night, s1-8**: 130.2 s, Stephens Street (e284, -472,1): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"fire_truck_1"}].
- **fog-night, s1-11**: 111 s, West 13th Avenue (e386, -129,-531): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_1"}].

## Full covering array

Commands (the two shards together execute all 13 rows, seed 1, Kitsilano dry, two routes each):

```sh
node --experimental-default-type=module scripts/soak.mjs --port 8381 --mode pairs --maps kitsilano --seeds 1 --count 2 --shard 0 --shards 2 --json pairs-0.json
node --experimental-default-type=module scripts/soak.mjs --port 8381 --mode pairs --maps kitsilano --seeds 1 --count 2 --shard 1 --shards 2 --json pairs-1.json
```

All 26 drives finish without a throw. One route times out with five other-at-fault contacts;
13 routes have other audit failures (12 parking verdicts, one emergency yield, and one ball warning
that overlaps a parking verdict). Shard 0 exits 1; shard 1 exits 0 under the documented audit policy. All configurations are
`pairwise-v1-1-INDEX/kitsilano/seed-1`; the exact enabled/disabled lists are also retained in JSON.

| Index (`--cover`) | Park | Exact `--without` list | Throws | Stuck/timeouts | Collision routes | Other audit routes |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | `amberLights,balls,buses,closures,collection,contraflow,driveways,geese,hazards,highBeams,leftOnRed,officers,passCyclists,potholes,puddles,redRunners,redTurnSigns,roadClosures,schoolBuses,snowbanks,stepOuts,sunGlare,tailgaters,trains,vans` | 0 | 0 | 0 | s1-1,s1-2 |
| 1 | 0 | `amberLights,busLanes,calming,emergency,followingDistance,guards,ice,nightFlash,officers,park,parkers,plows,pxo,tailgaters,trains` | 0 | 0 | 0 | 0 |
| 2 | 0 | `buses,collection,driveways,emergency,followingDistance,guards,hazards,highBeams,nightFlash,park,plows,potholes,pxo,redRunners,redTurnSigns,restrictions,roadClosures,roadside,scrambles,snowbanks,stepOuts,streetcars,vans,workZones` | 0 | 0 | 0 | 0 |
| 3 | 1 | `amberLights,balls,calming,contraflow,guards,highBeams,leftOnRed,nightFlash,outages,parkers,passCyclists,potholes,puddles,redRunners,roadside,scrambles,streetcars,workZones` | 0 | 0 | 0 | s1-1,s1-2 |
| 4 | 0 | `balls,closures,followingDistance,geese,ice,leftOnRed,officers,outages,park,pxo,redTurnSigns,restrictions,roadClosures,roadside,schoolBuses,snowbanks,stepOuts,workZones` | 0 | s1-2 | s1-2 | 0 |
| 5 | 1 | `amberLights,balls,busLanes,buses,calming,closures,collection,driveways,emergency,hazards,ice,officers,parkers,passCyclists,plows,pxo,redRunners,restrictions,roadside,schoolBuses,stepOuts,streetcars,sunGlare,tailgaters,vans` | 0 | 0 | 0 | s1-1,s1-2 |
| 6 | 0 | `amberLights,busLanes,buses,closures,contraflow,emergency,geese,guards,ice,nightFlash,park,parkers,potholes,redTurnSigns,schoolBuses,scrambles,streetcars,sunGlare,trains,vans,workZones` | 0 | 0 | 0 | 0 |
| 7 | 1 | `busLanes,closures,driveways,emergency,hazards,nightFlash,officers,outages,parkers,passCyclists,plows,puddles,restrictions,roadClosures,scrambles,stepOuts,trains,vans` | 0 | 0 | 0 | s1-1,s1-2 |
| 8 | 1 | `balls,busLanes,buses,calming,contraflow,followingDistance,geese,guards,ice,leftOnRed,outages,potholes,puddles,restrictions,roadClosures,roadside,schoolBuses,scrambles,snowbanks,sunGlare,tailgaters,trains,vans,workZones` | 0 | 0 | 0 | s1-1 |
| 9 | 1 | `busLanes,buses,calming,collection,driveways,geese,highBeams,ice,outages,plows,potholes,puddles,pxo,redTurnSigns,restrictions,roadside,schoolBuses,scrambles,tailgaters,trains,workZones` | 0 | 0 | 0 | s1-1 |
| 10 | 1 | `amberLights,balls,collection,contraflow,followingDistance,geese,guards,hazards,highBeams,ice,nightFlash,outages,parkers,passCyclists,plows,pxo,redRunners,redTurnSigns,restrictions,roadside,snowbanks,stepOuts,streetcars,sunGlare,vans,workZones` | 0 | 0 | 0 | s1-1 |
| 11 | 0 | `busLanes,buses,calming,collection,contraflow,emergency,followingDistance,geese,hazards,leftOnRed,park,parkers,passCyclists,plows,potholes,puddles,redTurnSigns,roadClosures,roadside,schoolBuses,scrambles,stepOuts,streetcars,sunGlare,tailgaters,trains,vans` | 0 | 0 | 0 | 0 |
| 12 | 1 | `amberLights,balls,buses,calming,closures,collection,contraflow,driveways,guards,hazards,ice,leftOnRed,officers,outages,plows,puddles,redTurnSigns,restrictions,scrambles,snowbanks,stepOuts,streetcars,sunGlare` | 0 | 0 | 0 | s1-1,s1-2 |

Every failure (including recovered deadlocks):

- **pairwise-v1-1-0/kitsilano/seed-1, s1-1**: 87.1 s, West Broadway (e247, -133,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-0/kitsilano/seed-1, s1-2**: 90 s, West 10th Avenue (e445, -303,-218): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-3/kitsilano/seed-1, s1-1**: 78 s, West Broadway (e247, -133,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-3/kitsilano/seed-1, s1-2**: 70.2 s, West Broadway (e244, -361,-103): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_1"}].
- **pairwise-v1-1-4/kitsilano/seed-1, s1-2**: 264.8 s, Trafalgar Street (e350, -343,-148): drive deadline reached at 0 m/s, behind `car_30` (2.5 m gap); `timeout`. 79.6 s, Trafalgar Street (e350, -343,-144): `car_30` contacts ego (0 vs 0.7 m/s; fault `other`); 5 contacts total, 0 ego-at-fault.
- **pairwise-v1-1-5/kitsilano/seed-1, s1-1**: 87.6 s, West Broadway (e247, -133,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-5/kitsilano/seed-1, s1-2**: 145.1 s, West 10th Avenue (e445, -302,-218): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-7/kitsilano/seed-1, s1-1**: 87.6 s, West Broadway (e247, -133,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-7/kitsilano/seed-1, s1-2**: 83.4 s, Trafalgar Street (e350, -344,-176): `ball_warnings_ignored`; [{"type":"ball_warning_ignored","ball":"ball_1","kmh":5.4,"over_kmh":3.8}]. 98.2 s, West 10th Avenue (e445, -302,-218): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-8/kitsilano/seed-1, s1-1**: 78.1 s, West Broadway (e247, -134,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-9/kitsilano/seed-1, s1-1**: 78 s, West Broadway (e247, -133,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-10/kitsilano/seed-1, s1-1**: 79.4 s, West Broadway (e247, -133,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-12/kitsilano/seed-1, s1-1**: 87.6 s, West Broadway (e247, -133,-118): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.
- **pairwise-v1-1-12/kitsilano/seed-1, s1-2**: 144.8 s, West 10th Avenue (e445, -303,-218): arrival was in lane, without a completed kerb parking manoeuvre; `parked=false`.

**Narrowing row 4.** The stopped ego is on Trafalgar Street beside `van_1`. Oncoming `car_30`,
apparently going around the van, repeatedly contacts it at 79.6, 101.1, 120.2, 137.4 and 153.1 s.
Every collision is assigned to the other car; the final state remains nose-to-nose. The repeat
reproduces all five contacts exactly. Adding `--without vans` to the same row and s1-2 makes it
pass in 93.7 s with zero contacts and no audits. This identifies a van/ordinary-traffic interaction;
it does not establish which missing feature explains why the full city configuration avoids it.

```sh
node --experimental-default-type=module scripts/bench_node.mjs --port 8381 --features city --count 2 --cover 4 --only s1-2 --diagnostics 1
node --experimental-default-type=module scripts/bench_node.mjs --port 8381 --features city --count 2 --cover 4 --without vans --only s1-2 --diagnostics 1
```

## Map and seed sample

Kitsilano, Toronto, Calgary and Victoria, seeds 1–3 on each map, two routes per configuration:

```sh
node --experimental-default-type=module scripts/soak.mjs --port 8381 --mode city --maps kitsilano,toronto,calgary,victoria --seeds 1,2,3 --count 2 --shard 0 --shards 2 --json sample-0.json
node --experimental-default-type=module scripts/soak.mjs --port 8381 --mode city --maps kitsilano,toronto,calgary,victoria --seeds 1,2,3 --count 2 --shard 1 --shards 2 --json sample-1.json
```

Both sample shards exit 1: seven routes have deadlocks/timeouts, including two that recover and
arrive; four routes have other audit failures (one overlaps a stuck route). No throws or collisions.

| Configuration | Throws | Stuck/timeouts (includes recovered deadlocks) | Collision routes | Other audit routes |
| --- | --- | --- | --- | --- |
| city/calgary/seed-1 | 0 | 0 | 0 | 0 |
| city/calgary/seed-2 | 0 | s2-1 | 0 | s2-2 |
| city/calgary/seed-3 | 0 | 0 | 0 | 0 |
| city/kitsilano/seed-1 | 0 | 0 | 0 | 0 |
| city/kitsilano/seed-2 | 0 | 0 | 0 | 0 |
| city/kitsilano/seed-3 | 0 | s3-1 | 0 | 0 |
| city/toronto/seed-1 | 0 | s1-1,s1-2 | 0 | s1-2 |
| city/toronto/seed-2 | 0 | s2-1,s2-2 | 0 | 0 |
| city/toronto/seed-3 | 0 | 0 | 0 | 0 |
| city/victoria/seed-1 | 0 | 0 | 0 | s1-2 |
| city/victoria/seed-2 | 0 | s2-2 | 0 | s2-1 |
| city/victoria/seed-3 | 0 | 0 | 0 | 0 |

Every failure (including recovered deadlocks):

- **city/calgary/seed-2, s2-1**: 425.2 s, 11 Avenue SW (e478, -260,363): drive deadline reached at 0 m/s, behind `car_33` (2.3 m gap); `timeout`.
- **city/calgary/seed-2, s2-2**: 99.9 s, 8 Street SW (e345, -476,-203): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"fire_truck_1"}]. 15.7 s, unnamed road (e560, -474,-470): `illegal_turns`; [{"type":"illegal_turn","from":"e561","to":"e560"}].
- **city/kitsilano/seed-3, s3-1**: 12 s, Arbutus Street (e607, 508,-207): first of 3 `deadlock_overrides`; nearby actors none within 20 m; arrived=True. Recovered deadlocks still fail the soak.
- **city/toronto/seed-1, s1-1**: 387.3 s, Harbord Street (e332, 298,-206): first of 3 `deadlock_overrides`; nearby actors ambulance_2; arrived=True. Recovered deadlocks still fail the soak.
- **city/toronto/seed-1, s1-2**: 310.4 s, Bloor Street West (e264, -30,137): drive deadline reached at 8.6 m/s, with no reported leader; `stuck`. 276.2 s, Spadina Avenue (e177, -33,81): `off_road_s`; []. 275.3 s, Spadina Avenue (e177, -33,80): first of 3 `deadlock_overrides`; nearby actors gaggle_1_goose_1,gaggle_1_gosling_2,gaggle_1_gosling_3,gaggle_1_gosling_4,gaggle_1_gosling_5,gaggle_1_gosling_6,gaggle_1_gosling_7,gaggle_1_gosling_8,gaggle_1_goose_9; arrived=False. Recovered deadlocks still fail the soak.
- **city/toronto/seed-2, s2-1**: 540.4 s, Harbord Street (e354, -92,-313): drive deadline reached at 11.1 m/s, with no reported leader; `timeout`.
- **city/toronto/seed-2, s2-2**: 200.4 s, Sussex Avenue (e18, 63,-80): drive deadline reached at 0 m/s, with no reported leader; `stuck`. 119.5 s, Sussex Avenue (e18, 63,-80): first of 322 `deadlock_overrides`; nearby actors school_bus_2,fire_truck_1,car_p4,car_p5,ped_9,stepout_1; arrived=False. Recovered deadlocks still fail the soak.
- **city/victoria/seed-1, s1-2**: 107.4 s, Fort Street (e67, 209,-130): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_1"}]. 16.7 s, Yates Street (e193, -171,125): `pothole_hits`; [{"type":"pothole_hit","pothole":"ph221","kmh":26.3,"safe_kmh":20.6,"depth_cm":7}].
- **city/victoria/seed-2, s2-1**: 68.2 s, unnamed road (e286, 260,514): `failed_to_yield`; [{"type":"failed_to_yield","to":"emergency vehicle","with":"ambulance_1"}].
- **city/victoria/seed-2, s2-2**: 465.2 s, Menzies Street (e545, -488,-771): drive deadline reached at 0 m/s, with no reported leader; `stuck`. 191.3 s, Menzies Street (e545, -491,-771): first of 4 `deadlock_overrides`; nearby actors none within 20 m; arrived=False. Recovered deadlocks still fail the soak.

These are simulator/audit findings for the parallel city-fix work. No simulation fixes were made here.
The local server was stopped after all checks. The generated project `.venv` was left in place.
