# Registry, final batch C: destination parking, hidden hazards and the last two core reads

ROADMAP 3.2, final batch, part C. Destination parking and hidden hazards moved onto the feature
registry ([feature interface](../../feature-interface.md)), and the two core reads ROADMAP 3.2 still
listed went behind hooks owned by their records. Each piece is a commit of its own:

| Commit | What moved |
|---|---|
| Let the registry comparison capture a benchmark with destination parking | `scripts/registry_parity.mjs bench` takes `--park 1` (capture `*-park.json`) |
| Read a flashing signal's stand-in stop through the night-flash record | the `night_flash` reads in `sim/npc.js` and `sim/world.js` |
| Ask the feature records which streets they keep parking off | the `world.laneClosures` read in `sim/parallel-park.js` |
| Move hidden hazards onto the feature registry | `sim/features/hidden-hazards.js` |
| Move destination parking onto the feature registry | `sim/features/destination-parking.js` |

## The two core reads

**Overnight flashing.** Traffic's stop-sign release (`sim/npc.js`, at a stop it has completed), its
give-way check (`NpcFleet.givesWay`) and the World's give-way audit (`sim/world.js`) asked a control for
its `night_flash` flag to find the grouped junction a flashing red's stand-in stop belongs to. They now
ask the existing `priorityJunction` hook without the traffic argument, which the night-flash record
already answered for sensing (`giveWayAt`): the stand-in stop's junction, or null for any other control.
No new hook. `night_flash` is now on the registry test's list of names the core must not use.

**Lane closures.** `parkingObstructed` (`sim/parallel-park.js`, used by destination parking and traffic
parking alike) read `world.workZones`, `world.laneClosures` and `world.doubleParked` by name. A new hook,
`parkingObstructed(world, edgeId)`, lets the work-zone, lane-closure and double-parked-van records each
rule out their own block. The test is a pure `or` of the three, so the registration order does not
matter. The work-zone and van reads went with the lane closure's because they are the same test in the
same function.

## Hidden hazards

The record (`key: "hazards"`, built `early`, as the World set its option before anything else) builds
the step-outs from the World's `stepOuts` option, which it reads beside its own: `build` is now handed
every World option (`options`), and a record's `freeDriveExtra(enabled)` (named `freeDrive` before the merge with the transit move, which took that name for the option itself) adds the free-drive options it sets
with its own (`stepOuts: STEP_OUT_COUNT`). The checkpoint's `stepOuts.world` fix moved from
`lab/recorder.js` to the record's `checkpoint` hook.

`World.sees` keeps the general sight line: buildings, weather and darkness, a registered feature's
`hides` (a snowbank), an obstacle's own `visible`, and moving traffic hiding a pedestrian
(`sim/crosswalk.js hiddenByTraffic`). What hidden hazards add comes through three new hooks at `"end"`:

- `standingHides(world, observer, ped)`: the vehicles standing at the kerb that may hide a pedestrian,
  handed to `hiddenByTraffic` beside the moving ones;
- `vehicleHides(world, observer, o, reach)`: another vehicle's body hides a road user;
- `hiddenByVehicle(world, observer, o)`: `World.hiddenByVehicle`, which the give-way audits use to mark
  a failure to yield `unseen`.

Sensing's give-way, oncoming-turn and turn-on-red checks look along the lanes they give way to through
`trafficSight(world)`, which returns `{ laneSight }` while road vehicles hide traffic, or null. The
checks themselves (`oncomingView`, the give-way and right-on-red loops, the starting-queue test) stay in
`brain/sensors.js`: they are the general sight-line logic, and their `hidden_by` and `sight_m` fields and
the state's wording for them read the same whatever hides the lane.

The blind spot is the record's: its sensing (`snap.blind_spot` and the speed ceiling), target speed,
hazard flag, decision state, situation clause, the two LLM prompt lines ("A vehicle can hide another…"
and "Beside cars parked at the kerb…") and the examiner's `blind_spot_speeding` remark. New slots sit
exactly where the core code was: `sense`, `target`, `hazard`, `state` and `clause` at `"blindSpots"`,
`stepBeforeTraffic` at `"stepOuts"` (after `"afterOutages"`, before the ordinary `"end"`), and `prompt`
at `"hiddenHazards"` (after `"afterGlare"`). A record's `examinerMinors` adds the examiner's minor errors
from the incident stream, with an optional `when(report)` (the parking record uses it for the kerb).

## Destination parking

The record (`key: "park"`, `property: "parkAtGoal"`, built `early`) sets the World's parking state as the
constructor did (`park`, `parking`, `parkHold`, `parkTried`, `parkedIn`, `kerbContact`), resets it when the
car is moved by hand (`resetContact`, releasing only reservations whose `reserved?.owner` is the car), and
audits kerb strikes and lets the space go after every other audit (`audit` at `"destination"`). The
planner stays in the autopilot (`brain/brain.js` `ParkPlanner`) and the `parked` and `no_space` fields in
`bench/runner.js`; neither is a core file. With the option off the record sets the same empty state and
every hook returns what the core's false path did, so the `parkAtGoal` false path is unchanged.

New hooks and slots, each where the core code was:

| Where | Hook (slot) |
|---|---|
| Traffic keeping back the room the car reverses into (`World.parkHold`) and backing off | `trafficKeepBack(world, n, path, { dt, look, isLong })` |
| `snap.parking`, after the turnaround | `sense` at `"destination"` |
| "parking space ahead" target, after the pedestrian's | `target` at `"destination"` |
| "parking" hazard flag, after `"late"` and before the blind spot's | `hazard` at `"destination"` |
| `wait_to_park`, after `stop_to_turn_round` | `candidates` at `"destination"` |
| `stop_at_destination` left out while the space is the destination | `replacesDestinationStop(ctx)` |
| `park` and `pull_out`, after `turn_around` | `manoeuvreCandidates` at `"afterTurnaround"` |
| Kept when the list is cut (was `law.kind === "park"`) | `priority: ["park", "pull_out"]` |
| `passes_parking_space`, after `passes_turn_round_point` | `sim` at `"destination"` (and `flagText`) |
| `state.parking`, after `turnaround` | `state` at `"destination"` |
| Outcome labels | `outcome` at `"ids"` (by candidate id, so the order does not matter) |
| Situation clause, after the following clause | `clause` at `"destination"` |
| Motion question: drive, hold still, reached the destination | `driveCriterion` at `"destination"`, `holdStill` at `"destination"`, `arrivalCriterion` |
| Motion question asked | `motion` |
| LLM prompt line, after the U-turn's | `prompt` at `"afterTurnaround"` |
| Rules: arriving is no reason to stop while parking in | `keepsDestination(snap)` |
| Rules: `parking` and `parking_approach` cost terms, under their own names | `rulesTerms` at `"afterTurnaround"` |
| Rules: a clear parking manoeuvre goes on | `manoeuvreGoesOn(candidate)` |
| Cautious agent's choice (`selection: "parking"`) and planned stop | `cautious` at `"parking"`, `cautiousDrive` at `"plannedStop"` |
| Safety brake allowances while parking | `safetyLaw(world, law)` |
| Deadlock: waiting to park or pull out | `legitimateStop` |
| `not parked` failure, its examiner category and remark | `verdict` |
| Examiner: the kerb minor, the road test's last instruction and the parking marks | `examinerMinors`, `examinerScript`, `examinerMarks` |

The `"park"` law kind stays in `sim/controller.js` and `brain/candidate-validation.js`, which are not core
files. The `turnaround` law kind stays in the core: it is not a registered feature.

## Registration

Both records are appended to `FEATURES`, destination parking before hidden hazards, after bus lanes.
Their hooks run at slots of their own, or at shared ones where the order does not matter (outcome labels
by id, the motion test, legitimate stops, `resetContact`, `checkpoint`), so their place changes no order.
Merging with the other batch-C branches only needs both lines kept.

## Parity

Before is `8c34c637`; after is this branch's head. Boat, Node 22.23.5, one loopback server per tree run
(`PYTHONHASHSEED=0 PORT=8331 uv run --locked server.py`), the after tree's `registry_parity.mjs`
(with `--park`) copied into the before tree. From each tree:

```sh
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" bare
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city --park 1
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city --hour 23.5
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city halifax --hour 23.5
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city calgary
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" rules
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" cautious
node --experimental-default-type=module scripts/registry_parity.mjs prompt "$out"
node --experimental-default-type=module scripts/test_model_recording.mjs
node --experimental-default-type=module scripts/registry_parity.mjs compare "$before" "$after" \
  --expect bare-dry.json,city-dry-park.json,city-dry-hour-23.5.json,halifax-city-dry-hour-23.5.json,calgary-city-dry.json
```

Every capture matched apart from timings and run provenance (`compare` printed `identical` for all nine):

| Capture | Before and after |
|---|---|
| Kitsilano bare, dry, seed 1 | 12/12, identical |
| Kitsilano city, dry | 12/12, identical |
| Kitsilano city, dry, `--park 1` | 12/12 (6 parked, 6 with no space), identical |
| Kitsilano city, dry, 23:30 (overnight flashing) | 12/12, identical |
| Halifax city, dry, 23:30 (overnight flashing) | 10/12 on both trees, identical |
| Calgary city, dry (a map with a lane closure) | 11/12 on both trees, identical |
| Arena, Rules: every challenge and both road tests | 62/62, identical (traces, events, examiner sheets) |
| Arena, cautious agent | 62/62, identical |
| Guarded and open LLM system prompts | byte for byte |
| `scripts/test_model_recording.mjs` | passes on both trees |

The same comparison also ran after the hidden-hazards commit, with the same result. The Jev fixtures
stayed current (`build_jev_fixtures.mjs --check`: 0 stale).

## Left in the core, and outside it

- `brain/sensors.js` keeps the general sight-line checks along the lanes the car gives way to, and
  `brain/state.js` keeps the wording for their `hidden_by` and `sight_m` fields: they read whatever
  `trafficSight` hides, and the fields are the intersection's own.
- Outside the core files, as before: the autopilot's parking planner (`brain/brain.js`), the benchmark's
  parking verdict fields (`bench/runner.js`), the HUD notices (`main.js` imports `parkNotice`,
  `hazardNotice` and `trafficNotice`; they could become record `notice` fields), the coach's hidden-hazard
  and parking reports (`sim/drive-score.js`), the `"park"` law in `sim/controller.js`, and the
  renderers' perception lines.

## AGENTS.md wording to apply

- Invariants, **Registered features**: add "destination parking" and "hidden hazards" to the list the
  registry registers.
- Opt-in features, **Parking**: "traffic keeps back from a car parking ahead through `World.parkHold`"
  becomes "traffic keeps back from a car parking ahead through `World.parkHold`, which the
  destination-parking record's `trafficKeepBack` hook reads".
- Feature table: the destination parking row's module becomes `parallel-park.js` (record
  `features/destination-parking.js`), and the hidden hazards row's becomes `hidden-hazards.js`,
  `hidden-traffic.js`, `blind-spot.js` (record `features/hidden-hazards.js`), with `World.sees` and the
  record's `standingHides`, `vehicleHides` and `trafficSight` as the shared test.
- `docs/feature-interface.md`: the count of features on the registry goes up by two, and ROADMAP 3.2's
  "still to move out of the core" sentence about `night_flash` and `world.laneClosures` is done.
