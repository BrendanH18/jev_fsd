# The feature interface

ROADMAP 3.1. Each opt-in feature used to be written into the same core files: `sim/world.js`,
`sim/step.js`, `sim/npc.js`, `brain/sensors.js`, `brain/candidates.js`, `brain/state.js`,
`brain/llm-prompt.js` and `bench/metrics.js`. A feature that has moved to the interface is instead **one
record** in a file of its own under `static/js/sim/features/`, and **one line** in `FEATURES` in
`static/js/sim/features/index.js`. The core loops over the records' hooks and never names the feature.

All 41 features are on the registry (ROADMAP 3.2, finished 26 November): driveway reversers, ball chase,
spring potholes, Canada geese, police officers, tailgaters, black ice, snowbanks, puddles, traffic parking,
road closures, double-parked vans, contraflow cyclists, low sun glare, garbage trucks, traffic calming,
red-light runners, crossing guards, Ontario pedestrian crossovers, roadside stops, following distance,
turn restrictions, high beams, no-turn-on-red signs, scramble crossings, work zones with flaggers and
power cuts, overnight flashing signals, left turns on red, amber-light decisions, bus-only lanes,
snow plows, lane closures, passing cyclists, transit buses, school buses, streetcars, trains at level
crossings, emergency vehicles, destination parking and hidden hazards. Each record holds its core pipeline hooks and model wording.

## A record

```js
export default {
  key: "geese",                 // the World option, and the World property `build` fills (its `enabled`)
  seen: "geeseSeen",            // the World flag: the feature has met the car this drive
  calls: "geeseCalls",          // the World map of the audit's calls (cleared when the car is moved by hand)
  build: (world, { enabled, seed, map }) => new Geese(world, { enabled, seed }),
  metric: {
    at: "streetHazards",
    name: "wildlife_conflicts",
    failure: "drove into or too close to geese crossing the road",
    label: "Drove into or too close to geese crossing the road",
    category: "observation",
  },
  obstacle: { test: isGoose, likePedestrian: true },   // its things in world.obstaclesNear
  motion: (snap) => !!snap.geese_crossing?.wait,       // ask the model "stop or drive?"
  priority: [],                                        // candidate ids kept when the list is cut

  obstacles(world, x, y, r) { ... },                    // World.obstaclesNear
  stepAfterTraffic(world, fleet, dt) { ... },           // sim/step.js
  audit: { at: "streetHazards", run(world) { ... } },   // World.audit
  sense: { at: "streetHazards", run(world, snap, ctx) { ... } },
  limit, target, hazard,                                // snap.limit, desiredSpeed, hazard flags
  candidates, adjust, brakeDetour, sim,                 // lane candidates, their forward-sim checks and rejections
  state, outcome, slowOutcome, clause, holdStill, prompt, // the model's decision state and wording
  trafficStart, trafficReplan, trafficLane, trafficYield, trafficPullOut, // how traffic and cyclists take it
  hides, blocksView, placeEgo, detour, turnPace,        // what it hides, the car put down by hand, its move in the lane
  evStop, evKerb, pullOverDetour, evQueueHold,          // run by the emergency record's pull-over and audit
  trafficGiveWay, trafficPullOver, trafficRejoin, trafficStopAt, trafficHangBack, // traffic giving way to it
  trafficHold, emergencyHold, trafficLaneChange,        // where traffic stops for it; its own lane changes
  standingHides, vehicleHides, hiddenByVehicle, trafficSight, // what standing and moving vehicles hide
  trafficKeepBack, parkingObstructed,                   // room kept clear, streets kept free of parking
  replacesDestinationStop, manoeuvreCandidates,         // a feature's own stop and manoeuvres at the goal
  rulesTerms, cautiousDrive,                            // named Rules terms; the cautious agent's planned stops
  worldOption, freeDrive, freeDriveExtra,               // a fleet option the World takes too; free-drive values
  day,                                                  // true: the clock keeps the `day` of the year while it is on
  view: () => import("../../render/geese.js"),          // its render module: what it draws (Views, below)
  notice, eventBadges, eventBadge, sound,               // HUD badges and the drive sound it makes
  signalLamp, manualArrival,                            // dark signal lamps; a drive finished by hand that counts
};
```

The header of `features/index.js` lists the hook arguments, and `SLOTS` lists the dispatch positions.
The World takes the option through `...features` and builds records in registration order at the end of
its constructor. A record that uses `buildAt` can run earlier to preserve construction dependencies.
Ontario crossovers set their option in the `early` position so the crowd can read it. Roadside stops
reserve parking bays at `afterSpawn` before other features that use the same bays. The World initializes
each declared `seen` flag to false and each declared `calls` field to an empty map. By default, metrics
require a seen flag. A boolean World option can use `metric.reportWhenEnabled` to report from the
start of every drive that enables it. `metric.initial` initializes a counter whose zero is part of
the World state. A record's `build` can return a boolean for a feature whose only setting is on or off.
A record with `buildFleet` takes its option from the fleet. The fleet stores the result under the option
key and supplies its seed and a path factory. The World still builds the record's audit state.
`checkpointShare` adds state that can be shared across checkpoints, and `checkpoint` restores
references to the live World and fleet after a rewind.

`routeOptions` supplies the active constraints when requesting a route, including detours.
`requestReroute` runs before or after the ordinary off-route check to preserve the trigger order.
The record keeps any conditions required before it requests a detour.

A core module asks for its hooks once, when it loads (`hooks(name, slot)`). Through an import cycle that
can be before the records have loaded (the snowbanks record's simulation reaches `sim/npc.js`, say), so the
list `hooks()` hands out is filled as soon as the registry has loaded, before anything can run it; a slot
the core never runs is still refused, then. The lists live in `features/hook-lists.js`, which imports nothing: a module the
records load themselves (`sim/parallel-park.js`, which the controller loads) asks it for its list rather
than loading the registry, so loading the bus lanes or a bus module first cannot reach a record before
its own module has finished.

An override of a signal has separate hooks for the physical direction, the direction the car can see, and
the crossing audit. `controlDirection` serves the world light and oncoming-traffic checks.
`trafficControl` also records whether a traffic vehicle must keep waiting at the line. `controlSense`
supplies the visible direction and its snapshot fields. `junctionPlan` reads those fields to set the
stop target, rejection and model wording. `controlAudit` takes over the signal audit while the override
applies and preserves the record used to check a left turn across oncoming traffic.

For a replacement control such as an all-way stop at a dark signal, register
`controlReplace(world, control, edgeId)`. Return the replacement or null to leave it to the next
record. An officer on duty returns the original signal, so the junction still follows the officer.
`alternateSignal` reports the temporary signal state to the light and oncoming-queue checks.
`senseSignalControl` supplies the replacement and its snapshot fields once the driver can see the
junction. `controlEvent` adds fields to missed-stop and all-way-yield events. A traffic driver caught
too close to stop can use `trafficReleaseControl` after its stop memory has observed the new control.

Use `phaseBansRedTurns` for a whole phase plan that forbids red turns on every approach. Sensing,
traffic and the manual audit share it. The separate `redLightEvent` hook can tag a missed red for
coaching. `intersectionFields` adds snapshot fields, while `intersectionModelFields` adds the model
representation at the corresponding point. Preserve the order of fields and situation clauses so
recorded requests replay.

Use `trafficCorridor(world, vehicle, path, front)` for a temporary route along or around the lane.
The result can supply its present pursuit `shift`, a `lineAt(s)` delta for leader projection, an actor
to `ignore` when bypassing it, a speed `limit`, and a `stop()` evaluated at the existing stop
decision. A corridor also prevents the start of a new oncoming-lane cyclist pass. The
`detour` slot before the merge supplies the ego's preferred path to both following and candidate laws.
A `trafficLaneControl` supplies the lane restriction separately from a shared corridor, so their
speed limits and lateral offsets can both apply. Its deferred `stop()` can return a gap and the
speed of a vehicle already moving through the merge. The `detour` slot `laneControl` applies the
matching detour to ego following and every lane candidate.

`trafficOvertaking` returns a temporary lateral shift for a passing driver and the clearance the
driver needs from the vehicle it is passing. The core supplies whether another manoeuvre prevents
the start of a pass. An ego pass can use an `optional` detour, which sensing can follow while
candidate generation reserves it for the passing law. The `activeManeuver` hook keeps the relevant
candidate choices after the ego has started across and supplies the hard brake's detour.

`trafficFollowingLeader` can supply a leader outside the normal following scan. `trafficLeadPolicy`
adjusts the controller's gap and adds leader observations. `trafficPassingLaneBlocked` and
`trafficMergeGap` handle pass eligibility and return clearance in adjacent lanes. The ego equivalents,
`lanePassBlocked`, `laneGapBlocked` and `laneTargetFields`, govern whether it can pass, whether it
has room to change lanes and which constraints apply to the candidate lane.

An `examinerFail` hook returns a failure item or null without modifying the report.

### Signal and lane policies

- `specialSignalPhase` supplies a physical phase before advance greens or scramble timing.
  `visibleSignalPolicy` supplies the signal, replacement stop and optional speed and yield policy
  the driver can see. Replacement controls such as a power cut still take precedence.
- `priorityLevel` changes an approach's priority for gap checks. `priorityJunction` lets a replacement
  stop or a traffic junction check use the grouped signal's reference point, and
  `priorityTrafficOutside` excludes traffic still waiting outside that junction.
- `senseRedTurn` calls the existing gap calculation when an additional red turn is permitted.
  `extraRedTurn` supplies its required lane and observed turn. The independent crossing audit takes
  entry data through `redTurnMemory` and confirms the actual exit through `redTurnExit`. Traffic can
  nominate its entry lane through `trafficRedTurnLane`.
- `signalDecision` exposes the latched stopping profile to the planner and local drivers.
  `observeSignal` observes the physical lamp before the crossing audit and can return an action for
  entry. If that action returns fields for an arrow crossing, `arrowExitAudit` checks them on the
  actual left-turn exit. `trafficSignalDecision` supplies the profile to traffic using the same policy.
- `routeLaneIndex` selects a lane after ordinary route lane preparation. `routeLaneMerges` supplies
  frame transitions where the lane selection changes at a street join. `laneOfferBlocked` filters
  lane-change offers, and `candidateLaneReject` applies the restriction after collision checks and
  before ordinary lane-change checks. The traffic hooks supply independent spawn, path, and live
  lane-change decisions while leaving the normal gap check in the fleet.

### Registry validation

Loading the registry validates the declarations before filling the hook lists. A hook can be a
function at `end` or an object with a supported `at` and a callable `run`. Data records for metrics,
notices and prompts have their own required fields. A notice's order is unique within its slot.
World properties, seen flags and audit maps share one namespace. Snapshot fields, display text IDs,
priority candidate IDs, audit failure reasons, and trace markers each have one owner. Snapshot
defaults are scalar values copied into every snapshot. Declarations use enumerable data properties
except that an obstacle label can use a getter for constants in modules that are still loading.
Coach reports, guidance, deductions and tips follow the coaching dispatcher’s slot lists. Each order
is unique within its kind and slot.

Set `metric.trace` to false for an aggregate metric that should appear in the report and verdict
without emitting trace events. A `traceType` needs a threshold, while `eventType` identifies the
World event used for replay markers. Score deductions can read a World counter's change since coaching
began with `delta: true`. `capDelta` applies the same baseline when a violation caps the score.

## Slots: why results stay exactly the same

Order matters in the core: the candidates list is ordered (and capped at 15), rejections are an
`else if` chain where the first reason wins, the situation clauses and the LLM prompt are text, events
are pushed in audit order, and failures are a list. A hook therefore runs at a **slot**: the place in that
pipeline where the feature's own code used to be. While other features are still written into the core, a
slot marks a point in the pipeline (`"driveways"` covers the driveway reversers and the hooks that
follow them, `"restrictions"` follows turn restrictions, `"first"` runs before everything, and `"end"`
runs after the rest). `SLOTS` in `index.js` lists the slots the core runs for each hook;
`hooks()` refuses a slot the core never runs, and loading the registry refuses a record with a hook at
one, so a misspelt slot cannot silently do nothing (`scripts/test_feature_registry.mjs` checks both, and
that the core calls every slot).

Where order provably does not matter the hooks share one place: the speed ceilings that are a plain
`Math.min`, the forward-sim checks (each sets only its own flag), traffic's holds (each stops it with
`leadV = 0`, so the closest wins whatever the order), the outcome labels chosen by candidate id, and the
motion test (a pure `||`). A hazard flag or a clause hook may return a list (snowbanks give two flags and
two sentences), pushed in its order.

## The proof

"Identical" means every result field but the timings (`wall_ms` and decision latency), as in
`docs/rules-baseline.md`. The tree before the change (`b7f5d39`, from `git archive`) and after it,
lockstep, Rules, Node 22.23.4, 2026-11-14:

| Run | Before | After |
|---|---|---|
| Kitsilano bare, dry, suite seed 1 (`bench_node.mjs`) | 12/12, 10.53 km | identical, every field |
| Kitsilano city, dry, suite seed 1 (`--features city`) | 12/12, 12.81 km | identical, every field |
| Every challenge and both road tests (`evaluateChallenge`, Rules), each drive's whole comparable result, decision trace and events included | 62 drives | 62/62 identical |
| `scripts/test_model_recording.mjs` (the stub model's whole drive, prompts included) | passes | passes |

`SYSTEM_PROMPT` is byte-for-byte the same string. The Jev fixtures (`build_jev_fixtures.mjs --check`),
the browser tests at `/tests` (199/199) and every `scripts/test_*.mjs` that touches potholes, geese,
closures, free drives, bench options or the drive lab pass unchanged, apart from `test_free_drive.mjs`,
which now reads the registered options beside the World's own.

**Round two** (puddles, black ice, snowbanks; 2026-11-20) added Kitsilano city in snow (snowbanks on
every route, black ice on one) and in rain, and every challenge with the cautious agent as well as
Rules: all identical after each of the three commits
([record](validation/registry-round2-2026-11-20.md)).

**Driveway reversers** were compared against `36efa57` in Boat with Node 22.23.2. The full
arena results, including decision traces and events, matched in all 62 drives with Rules and
all 62 with the cautious agent, apart from wall time, decision latency and the run start
timestamp. The 12-route Kitsilano dry suites (bare and city) and the two-route Calgary city suite
also matched field for field apart from timings, using seed 1 and one server with `PYTHONHASHSEED=0`.
All 26 drives passed, with the reversing audit present on three Kitsilano and both Calgary city
routes. Both runs of **Reverse lights** reported the reversing audit. The LLM system
prompt was byte-identical, the Jev fixtures stayed current, and the committed stub replay passed.

**Ball chase and traffic parking** were compared against `c81cea9` in Boat with Node 22.23.5.
Every challenge and road test matched for both Rules and the cautious agent, including decision
traces and events, apart from wall time and the run start timestamp. Both features reported their
audit metrics in their own challenges. The guarded and open system prompts matched byte for byte,
the Jev fixtures stayed current, and all 62 drives in the published Jev open-track recording
replayed exactly.

**Police officers** were compared against `b1d5283` in Boat with Node 22.23.5. Rules and the
cautious agent passed all 62 challenges and road tests on both trees. Each comparable result,
including decision traces and events, matched. Both drivers reported the officer audit in
**Follow the officer**. Rules also matched every result field apart from timings in three
12-route dry suites at seed 1, using one server with `PYTHONHASHSEED=0`. Kitsilano bare passed
12/12 (10.53 km), Kitsilano city passed 12/12 (12.81 km), and Toronto city passed 9/12 on both
trees (10.65 km), with timeouts on `s1-6`, `s1-10` and `s1-11`. Six Kitsilano city routes and seven
Toronto city routes reported the officer audit. The officer challenge replayed exactly from the
published Jev and Claude Haiku open-track recordings. The LLM system prompt was byte-identical,
the Jev fixtures stayed current, and the registry, traffic-officer, free-drive, open-track and
model-recording checks passed.

**Tailgaters** were compared against `2333e9a` in Boat with Node 22.23.5. Both Rules and the
cautious agent passed all 62 challenges and road tests on both trees. All comparable result
fields matched, including decision traces, events and reports apart from the start timestamp.
Both drivers reported the brake-check audit in **On your bumper**.

The full dry Kitsilano bare and city suites (12 routes each, seed 1) matched in every result
field apart from timings, using one server with `PYTHONHASHSEED=0`. Rules passed 12/12 in bare
(10.53 km) and city (12.81 km). The cautious agent passed 12/12 in bare (10.56 km) and 9/12 in
city (12.22 km). On both trees, it got stuck on `s1-2` and ran red lights on `s1-8` and
`s1-10`. Its city routes `s1-4` and `s1-6` reported `brake_checks: 0`. Rules also passed
the rainy city route `s1-12`, which matched field for field apart from timings and reported
`brake_checks: 0` on both trees.

The guarded and open LLM system prompts and the regenerated **On your bumper** Jev request
matched byte for byte. The published Jev and Claude
Haiku open-track recordings of that challenge replayed exactly. The Jev fixture, registry,
tailgater, following, traffic-officer, free-drive, open-track and model-recording checks passed.

**Audit labels and examiner categories** were compared against `f78bd52` in Boat with Node
22.23.5. All 62 authored drives matched for Rules and the cautious agent on each track,
including decision traces and examiner sheets. The comparison excluded only `wall_ms` and
`report.started_at`.

**Double-parked delivery vans** were compared against `7dc60e5` in Boat with Node 22.23.5.
All 62 authored drives matched for Rules and the cautious agent, including decision traces and
events. All 12 dry Kitsilano routes at seed 1 matched in each driver's bare and city suites.
The comparison excluded wall time, arena report start time, and the suite label assigned to the
after-run shards. Rules passed all 24 routes. The cautious agent passed all 12 bare routes and
9 of 12 city routes on both trees, with a stall on `s1-2` and red lights on `s1-8` and `s1-10`.
The guarded and open LLM prompts were byte-identical, the Jev fixtures stayed current, and the
**Round the van** and **Collection day** drives replayed exactly from both published open-track
recordings (Jev and Claude Haiku).

**Contraflow cyclists** were compared against `e2d97a8` in Boat with Node 22.23.5. Rules
and the cautious agent each passed all 62 authored drives on both trees. Their results,
decision traces, events, examiner sheets and comparison score inputs matched apart from
timings. Both drivers reported `contraflow_conflicts: 0` in **Both ways**. Jev and Claude Haiku's
published open-track recordings of that challenge replayed exactly. The guarded and open
LLM prompts matched byte for byte, and the Jev fixtures stayed current.

All 72 dry benchmark attempts matched apart from timings and run provenance. The comparison
used seed 1 with 12 routes per suite for each driver. Both passed all 12 Kitsilano bare routes.
Rules passed 12/12 and the cautious agent 9/12 on Kitsilano city. On Montréal city, Rules passed
9/12 and the cautious agent 8/12. The contraflow metric appeared on four Rules and six cautious
Montréal routes.

**Low sun glare** was compared against `9c29525` in Boat with Node 22.23.5. All 36 dry
Rules benchmark drives matched, including 12 each on Kitsilano bare, Kitsilano city and Calgary
city at 18:00, all at seed 1. Glare was recorded on 10 Calgary routes, with zero seconds of
glare speeding on each. Rules and the cautious agent each passed all 60 challenges and both
road tests. Their results, decision traces, events, examiner sheets and score inputs matched.
The comparison excluded wall time, decision latency and run provenance.

The guarded and open LLM system prompts and all 191 complete **Into the sun** prompts on each
track matched byte for byte. The Jev fixtures stayed current, and both published open-track model
recordings of **Into the sun** replayed exactly.

**Garbage trucks** were compared against `fb3ddff` in Boat with Node 22.23.5. Rules passed all
12 routes in each Kitsilano suite at seed 1: dry bare, dry city at 15:30 and 23:30, and city fog.
All comparable results matched before and after. The dry afternoon city run reported zero crew close
passes on every route, with the metric present on all 12. The other three suites omitted it.
Rules and the cautious agent each passed all 62 authored drives. Their comparable results, decision
traces, events, examiner sheets, score inputs and both LLM system prompts matched byte for byte.
Both published open-track recordings of **Collection day** replayed exactly.

**Traffic calming, red-light runners and driver hooks** were compared against an archived
`97a3142` tree in Boat with Node 22.23.5. Rules and the cautious agent each passed all 62
authored drives on both trees. All comparable result fields matched, including the decision
traces, events, examiner sheets and driven-corridor measurements, excluding wall time and run
provenance. Both trees also matched and passed all 30 Kitsilano Rules benchmark attempts at seed
1. The comparison covered the 12 dry bare and 12 dry city routes, three rainy city routes and three
city routes in fog at 23:30. The speed-hump metric appeared on four dry and one foggy city route.
The red-light runner metric appeared on one dry city route.

The guarded and open LLM system prompts matched byte for byte. The published Jev and Claude Haiku
open-track recordings of **Over the humps** and **Fresh green** all replayed exactly. The registry,
free-drive, traffic-calming, red-light-runner, open-track and following-policy checks passed. The
Jev fixtures stayed current and all 39 offline requests passed.

**Scramble crossings, work zones and power cuts** were compared against `64d9772` in Boat
with Node 22.23.5. Rules passed 12/12 on Kitsilano bare and 12/12 on Kitsilano city at seed 1
in dry weather. The additional dry Victoria city suite passed 10/12 on both trees. Route
`s1-7` timed out and `s1-12` recorded a timeout, a collision and a failure to yield in both runs.
The Victoria baseline was split across four processes, then merged after checking the same route
fingerprint and all 12 scenario IDs. Every benchmark result field matched apart from timings.

Rules and the cautious agent each passed all 62 authored drives, including both road tests, on
both trees. Full arena results, reports, decision traces and events matched. The guarded and
open system prompts matched byte for byte. The stub model recording replayed on both trees,
the Jev fixtures stayed current and all 39 offline Jev requests validated.

**Snow plows, lane closures and passing cyclists** were compared against `0583591` in Boat with
Node 22.23.5. Each migration matched all 36 Rules benchmark results on Kitsilano at seed 1,
covering bare dry, city dry and city snow in four three-route captures per suite. Each revision
ran against its own loopback server with `PYTHONHASHSEED=0`. Rules and the cautious agent each
passed all 62 authored drives on every revision. Their complete arena captures and the CLI reports
matched the base, including the full traces and coaching reports. Both LLM system prompts matched
byte for byte. The comparison omitted timings and run provenance. The recorded stub drive replayed
and the Jev fixtures stayed current.
**Overnight flashing, left turns on red, steady amber, and bus lanes** each had a
separate comparison against their preceding tree in Boat with Node 22.23.5. The city
route and the named arena drives matched for each move. Each arena comparison ran Rules
and the cautious agent.

| Move | Rules city comparison at seed 1 | Arena comparison |
|---|---|---|
| Overnight flashing | Halifax, dry at 23:30, `s1-1` | After midnight |
| Left turns on red | Calgary, dry, `s1-1` | Left on red |
| Steady amber | Kitsilano, rain `s1-4` and snow `s1-6` | Room to stop and Keep going safely |
| Bus lanes | Mount Pleasant, dry at 08:00, `s1-3`, on a route using an active reserved edge | Buses only |

The whole batch matched an archive of `0583591` with separate loopback servers and
`PYTHONHASHSEED=0`. The comparison covered 47 Rules routes at seed 1, including all
12 routes each on Kitsilano dry bare, dry city and dry city at 23:30. It also covered
two rainy and one snowy Kitsilano city routes, two Halifax city routes at 23:30, two
dry city routes each in Calgary and Toronto, and two dry Mount Pleasant city routes
at 08:00. Both trees passed 45 routes. Mount Pleasant `s1-3` logged 4.51 m of
reserved-lane driving, and `s1-4` got stuck and failed to yield on both trees.

Rules and the cautious agent each passed all 62 authored drives, including both road
tests. The full arena results, coaching reports, decision traces and events matched.
The comparisons excluded timing and run provenance fields. The guarded and open LLM
prompts matched byte for byte, the committed stub recording replayed exactly and all
39 offline Jev requests validated.

Before deterministic snapping (roadmap 7.1), comparisons needed one server process or a fixed
`PYTHONHASHSEED`. The first city comparison
differed in three drives (`s1-10` to `s1-12`): the simulation matched to the last digit up to a re-plan,
where the server's `/api/route` returned a different number of alternative routes for the same request.
The untouched tree, run again against the restarted server, gave the new results exactly. The server's
lane snapping (`jev/routing.py` `snap`) iterated a Python `set` of string-keyed lanes and kept the first
of equally near ones, so a tie depended on the process's hash seed. With `PYTHONHASHSEED=0` both trees
gave identical city results, the 12.81 km of the committed reference.

## Views: what a feature draws

The registry loads in Node without Three.js, so a record does not import its meshes. It says where its
render module is, `view: () => import("../../render/geese.js")`, and that module exports a `view`. The
browser adapter ([`render/feature-views.js`](../static/js/render/feature-views.js)) loads every registered
view once, before anything is mounted, and refuses one that breaks the contract. The adapter draws
traffic, parked cars and people itself; `main.js` calls it and neither names a feature.

| Field | What the feature declares |
|---|---|
| `scenery: { order, build(map) }` | Scenery of the map alone, added before the World exists (bus stops, tracks). |
| `mount: { order, run({ view, scene, world, map }), frame?, signals? }` | Its scene objects for this World. `run` returns null while the feature is off, or what it mounted, which is kept under the record's key for its notices to read. `frame(mounted, { view, world, fleet, people, camera, dt, lightsOn })` runs once a frame and `signals(mounted)` as the signal lamps change. |
| `vehicles: { [kind]: { create, sync, roadEffects?, onRails?, minimap? } }` | The mesh and animator of a kind of traffic, and how the minimap marks it (`"emergency"` or `"transit"`). |
| `traffic: { order, list(world), after?, minimap? }` | Road users it keeps outside the fleet, drawn and interpolated as traffic, in replays too. |
| `parked: { order, flag?, create?, sync? }` | A parked car with `car[flag]` set gets a mesh of its own instead of a place in the batch; `sync` animates the feature's own each frame. |
| `car: { order, pose?, effect? }` | Ordinary cars in traffic: fields added to the pose they are drawn from, and an effect after they are drawn (a tailgater's flash). |
| `ego: { order, pose }` | Fields added to the pose the driven car is drawn from. |
| `roadEffect: { order, run(world, mesh, pose, dt, { onRails }) }` | What the road does to a vehicle's mesh (a hump's lift, a pothole's jolt). |
| `person: { order, mount, sync }` | Something a person carries (a crossing guard's sign). |
| `transientPeople: [prefix]` | Ids of people who come and go, whose meshes are retired once they leave. |

`order` places a declaration among the other features' and is unique within a field, as a notice's is.
The orders in use keep every scene as it was drawn before the views moved: the same objects in the
same order ([record](validation/render-registry-exit-2026-11-26.md)). A renderer that keeps motion
history of its own on a mesh registers how to clear it with `onMotionReset` (`render/actor-motion.js`),
so a rewind clears it without the adapter knowing what it is. Render-only parts stay render-only: a
view reads the World and never writes to it.

Two couplings stay inside the features' own modules. The turn-restrictions view also draws the
no-turn-on-red signs, which stand on the same posts, and the officers' view animates their cruisers
with the roadside renderer.

## How close a new feature is to "its own file, its challenge, its test and one registration line"

`scripts/test_feature_exit.mjs` checks this mechanically. It registers a throwaway feature, written
in one file ([`scripts/fixtures/throwaway-feature.js`](../scripts/fixtures/throwaway-feature.js)), with
one import and one `FEATURES` entry applied to the registry's source as it loads, and checks that the
World option and state, the free-drive flag, a challenge's option, the step, sensing, the model prompt,
metrics, HUD notices, event badges and every kind of view pick it up with no other file changed. It
also checks that `main.js`, the adapter and the shared renderers read no feature's World or fleet state
and import no feature's own module.

What a new feature still touches outside its own files (its record, its simulation and render
modules, its challenge module and its test):

| Where | What still needs a change |
|---|---|
| `sim/features/index.js` | The registration: its import and its `FEATURES` entry. |
| `lab/challenges.js` | The challenge's own registration: its import and its `MODULES` entry. The challenge turns the feature's World option on under the feature's key (`geese: true`); `setupChallenge` passes it through. |
| `scripts/test_feature_registry.mjs` | The list of registered keys it asserts, in registration order. |
| `scripts/ci_test_times.json` | The measured seconds of its test, for the CI shards (an unlisted file counts as the median). |
| `AGENTS.md`, `docs/reference/` | Its row in the opt-in table, its reference page, and any rule agents must keep. |
| `ui/drive-audio.js` | Only for a sound that does not exist yet: the record's `sound` names a drive sound and gives the distance to its nearest source. |
| Map pipeline and loaders | Only for a feature that needs a new map layer (`jev/osm/`, and each place that loads every layer). |

These still name older features, and a new feature does not touch them:

- **AI Eyes** (`render/perception.js`, shown by `ui/lab.js`) words eleven features that predate its
  hooks itself: emergency vehicles, buses, school buses, streetcars, level crossings, work zones, lane
  closures, snow plows, scrambles, passing cyclists and hidden hazards, and it marks their vehicles. New
  features use `perceptionLine`,
  `perceptionFocus` and `perceptionRejections`. The exit check lists the three feature modules it still
  imports, and that list may only shrink.
- **`setupChallenge`** (`lab/evaluation.js`) still lists the options of the 29 features whose challenges
  predate the pass-through, under the names those challenges use (`hidden` for hidden hazards).
- **`brain/brain.js`** keeps the destination-parking planner (`autopilot.parker`), which `main.js`
  clears when a route is replaced.

Set `coach` on the record for its driving messages, penalties, tips and report fields. Use `notice`
for live HUD updates (a list when the feature has several), `eventBadges` for the badges of its own
audit events and `eventBadge` for an event the core raises too (a stop missed at a flagger), and the
perception fields for AI Eyes observations and rejection text. Use `routeOptions` and `requestReroute`
to participate in routing. Checkpoints call `checkpointShare` for immutable state and `checkpoint`
after restoring the world and fleet.

Free drives and the city benchmark enable every registered feature by default. Use the record's
option key with `--without` and its lowercase form in the URL. A record can declare `flag` to preserve
an existing URL parameter. Scramble crossings use `--without scrambles` and `?scramble=0`.
For counted placement features, `defaultCount` is the enabled count and the URL opt-out supplies zero.
`scripts/test_free_drive.mjs` checks both paths.

The record's `metric.label` supplies the trace event text. Counter events appear in metric slot
order, then registration order within each slot. For a duration metric, `decimals` controls rounding
and `threshold` sets how many seconds the result must exceed to fail. A duration with `traceType`
emits one named event after crossing that threshold and uses the same name for its replay marker.
Use `eventType` when a counter audit emits its own world event with a different replay marker name.
The examiner groups failures by `metric.category` and puts uncategorized failures under Other.

Rules reads `rulesStop` and `rulesCost` from the feature records. The cautious agent reads `cautious` at
slots in its candidate precedence, along with `cautiousStop` for its speed target and `cautiousDrive`
for a manoeuvre whose law already brings the car to a stop. The deadlock detector uses `legitimateStop`
when the car is waiting for a feature.

## Running the registry comparison

On Boat, archive the before commit into a temporary source directory. Copy
[`registry_parity.mjs`](../scripts/registry_parity.mjs) into that directory's `scripts/` so the same
capture logic loads each revision's simulator. Start one loopback server with
`PYTHONHASHSEED=0 PORT=8331 uv run --locked server.py` for both trees. Reuse it when maps and
routing have stayed the same. Run these commands from each source tree with a different absolute
output directory:

```sh
node --experimental-default-type=module scripts/registry_parity.mjs bench "$output" bare
node --experimental-default-type=module scripts/registry_parity.mjs bench "$output" city
node --experimental-default-type=module scripts/registry_parity.mjs bench "$output" city victoria
node --experimental-default-type=module scripts/registry_parity.mjs arena "$output" rules
node --experimental-default-type=module scripts/registry_parity.mjs arena "$output" cautious
node --experimental-default-type=module scripts/registry_parity.mjs prompt "$output"
node --experimental-default-type=module scripts/test_model_recording.mjs
```

Choose a city map and weather that exercise the batch. For example, Victoria contains the bundled
scramble crossing, and the optional final `bench` argument selects weather. Compare the output
directories with `node scripts/registry_parity.mjs compare "$before" "$after"`. The check compares
the complete benchmark configuration, summary and individual results, both arena drivers' full
traces and results, and both system prompts. It discards wall time, decision latency, run timestamps
and benchmark source identifiers. Simulation times, incidents, audit fields, candidate IDs, array
order, map fingerprints and route fingerprints still have to match.

## Running the render comparison

A change to the adapter, a view or a shared renderer has to leave every scene as it was. On Boat,
archive the before commit into a temporary directory, copy
[`render_parity.mjs`](../scripts/render_parity.mjs) into its `scripts/`, and capture from each tree:

```sh
node --experimental-default-type=module scripts/render_parity.mjs capture "$output.json"
node --experimental-default-type=module scripts/render_parity.mjs compare "$before.json" "$after.json"
node --experimental-default-type=module scripts/render_parity.mjs detail <scene id>    # where two trees part
node --experimental-default-type=module scripts/render_parity.mjs notices             # HUD notices against the app's old wording
```

A capture drives every challenge and both road tests with Rules for six seconds, drawing ten times a
second through the adapter as the app's frame loop does, then restores a checkpoint from the recorder
and draws two replay frames toward the next one. Four free drives with every feature on (Kitsilano dry,
at night in rain and in snow, and Toronto) are drawn the same way. Each frame is a digest of the whole
scene graph in order: every object's name, type, transform, visibility, shadow flags and render order,
its geometry buffers, instance matrices and colours, and its materials' settings. It needs no server and
takes about 90 seconds a tree.

## Moving the rest (3.2)

* **A few at a time, by neighbours.** A feature's hooks run at slots named after its neighbours, so move
  neighbours together. Driveway reversers and potholes now share the `"driveways"` slot, in that
  registration order. Once every feature in a pipeline is a record, that
  pipeline needs no slots at all; register the records in the order the core runs them today, which
  differs by pipeline (candidates put road closures beside turn restrictions, but the audit puts them
  after parkers), so a few records will keep an explicit slot or the core will need a reviewed reorder.
  Moving black ice, snowbanks and puddles (registered in that order, after geese) showed it: they run in
  that order in sensing, the audit and the hazard flags, but puddles come first in the speed ceiling, the
  target, the candidates, the decision state and the wording, beside potholes, and black ice's lane
  adjustment and slowed-outcome wording come after puddles' (`"end"`). The temporary `"snowbanks"` slots
  that puddles used went once snowbanks moved. Tailgaters register before ice, snowbanks, puddles and
  parkers. The shared `"rearTraffic"` slot keeps their audits, metrics, candidate insertion and model
  text in the established order. Each pipeline still calls the slot where those hooks belong.
* **Contraflow cyclists.** The `trafficActors` hook supplies riders outside the fleet to its clearance
  and following checks. The obstacle descriptor identifies when a rider is coming the other way, so
  a driver handles the encounter as oncoming traffic. The `"beforeLaneMoves"` slot applies the
  driver's move before it considers its next adjustments and retains the rider's stop point.
  The `"beforeRunner"` slots keep the cyclist's candidate, rejection, model wording and result
  fields ahead of the red-light runner's.
* **Garbage trucks.** The fleet option feeds the record's scheduler. Its stop plan runs beside the
  other scheduled stops and its crew uses the existing double-parked obstruction. Obstacle descriptors
  supply the moving truck's label, long-vehicle clearance checks, space beside the kerb and parking
  eligibility. The audit retains its place after traffic calming.
* **Traffic calming.** The record owns the front-axle crossing audit, the speed ceilings for the ego
  car and ordinary traffic, and the associated reason, metrics and model text. Its audit runs before
  the garbage crew audit, and its model wording retains its order relative to low sun glare.
* **Red-light runners.** The record observes ordinary signal approaches through `auditSignal` after
  the amber observation. Traffic reads the committed vehicle's speed ceiling before checking the
  signal, then asks `trafficSignalProceed` about waiving a red or amber stop and `trafficSignalHold`
  about waiting at a green. The runner rejection, metrics and wording follow contraflow within the
  same pipeline slots.
* **Crossing guards and Ontario crossovers.** Guard hooks retain the order of approaching traffic stops,
  the ego stop candidate, its pass-line rejection and the model wording. Crossovers sense occupancy
  before the ordinary crosswalk hold. Their held-stop wording stays in the pedestrian instruction.
* **Roadside stops and following distance.** The roadside record supplies the speed cap and lane-change
  offer, including the speed the car can keep in the next lane. Following distance supplies the two
  lane policies, traffic's safe speed and the final-gap rejection after the collision check.
* **Turn restrictions and no-turn-on-red signs.** Traffic checks prohibited successors and replans
  before it reaches a prohibited corner. Red-only signs preserve the banned exits in effect when
  a car crosses on red, so a schedule change during the turn cannot change the verdict.
* **High beams.** The record extends sight only when the headlights and conditions allow it. It supplies
  the model question, the local decision field and the glare audit, including its trace threshold.
* **Same proof each time.** Record the bare and city Kitsilano suites and every challenge before and
  after, and diff every field but the timings (the harness used here dumps `comparableResult` of each
  `evaluateChallenge` result, decision trace and events included).
* **Cross-feature couplings.** Puddles allow for a traffic car's move round a pothole: each `trafficLane`
  hook is handed the moves the earlier ones returned (`aim`, where a move is heading; `now`, where it has
  got to; `easing`), so the puddles record reads the pothole's move without naming it. Puddles still treat
  potholes full of water as puddles (`sim/puddles.js waterSets`), and black ice reuses the pothole
  slow-down helpers, inside the features' own modules.
* **Hooks added in round two.** Black ice and snowbanks reached further into the core than the first
  three: the refresh before anything moves (`stepBeforeTraffic` at `"first"`), the clock's `day`, the gap a
  turn across traffic needs on ice (`turnPace`), traffic's gentle pedals (`trafficYield`'s `controls`),
  what a snowbank hides (`hides`, `blocksView`), the car put down in a narrowing (`placeEgo`), the move
  toward the middle (`detour`), the emergency pull-over and its audit (`evStop`, `pullOverDetour`,
  `evKerb`), a parked car's wait to pull out (`trafficPullOut`) and traffic's line between the banks
  (`trafficLane` at `"late"`, with `hold`, `lineAt` and `kept` for the leader search). The forward-sim
  checker gained `settle` (puddles' "no manoeuvre can help it" pass) and the sim time in `afterLaw`.
* **Driveway reversers.** An obstacle can provide its own predicted box and local visibility check, and
  use `traffic: true` to stay in the ordinary traffic sensing pass. A forward-sim checker can inspect
  nearby obstacles via `near`. The reverser step runs after contraflow, followed by ball chase and geese
  in registration order.
* **Ball chase and traffic parking.** The `trafficSpeed` hook caps both ordinary and emergency traffic.
  The fleet uses hooks to schedule parkers, step them as they reverse, give traffic a virtual leader at
  their hold line, and apply their approach offset, stop and signal. The emergency audit uses
  `evQueueHold` when a stopped or reversing parker has room reserved behind it.
* **Tailgaters.** The fleet runs its scheduler before the parking scheduler and takes a
  `trafficDriver` override for peeking, delayed observation of the lead car, speed and braking.
  The `following` sensing slot runs after the vehicles ahead and behind are known. Lane offers can
  add a move before bus-lane legality is checked, and `finishLanes` reads the final offers.
  Candidates can handle a special lane offer and adjust the stop-at-line law. Prediction skips the
  close follower and checks braking against the gentlest otherwise eligible candidate before the
  existing post-simulation hooks can lift their rejections.
* **Low sun glare.** The record keeps the clock's `day` and `utc_offset` while enabled and installs
  the glare visibility callback. The ordinary-traffic speed hook excludes cyclists. The driving audit
  still runs before the collision checks and keeps its reaction allowance in the checkpoint.
* **Presentation hooks.** Records supply feature notices, perception lines and rejection labels, and
  each feature's view declares what it draws ([Views](#views-what-a-feature-draws)).
* **The last seven (26 November).** Transit buses, school buses, streetcars and trains moved in that order
  (each step's new slots landing where the code was, with no temporary slots); the fleet keeps them under
  `fleet.buses`, `fleet.schoolBuses`, `fleet.streetcars` and `fleet.trains`, and buses and streetcars share
  `sim/transit-runs.js`. Emergency vehicles moved in three steps (traffic, audit, then sensing, candidates
  and wording) into `sim/emergency-traffic.js`, `sim/emergency-audit.js` and `sim/emergency-yield.js`; a
  record can now give one hook at several slots as a list, since the model state names the vehicle behind
  and the one ahead at two different places. Destination parking and hidden hazards followed, and the
  last two named reads left the core: a flashing signal's stand-in stop goes through the night-flash
  record's `priorityJunction`, and the streets parking avoids through `parkingObstructed`. Each branch, and
  then the merge of the three, gave the same results as before on the bare and city suites (Kitsilano in
  snow, at 23:30 and with parking; Toronto, Edmonton, Calgary and Halifax), all 62 Rules and cautious
  drives, both prompts and the stub recording ([transit](validation/registry-final/transit.md),
  [emergency](validation/registry-final/emergency.md),
  [parking and hazards](validation/registry-final/parking-hazards.md),
  [merged](validation/registry-final/merged.md)).
* **Then 3.3.** With the features out of `NpcFleet.step` and the sensing pass, those long functions are
  mostly the core's own logic and loops over hooks, and can be broken up.
