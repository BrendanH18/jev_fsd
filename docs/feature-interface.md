# The feature interface

ROADMAP 3.1. Each opt-in feature used to be written into the same core files: `sim/world.js`,
`sim/step.js`, `sim/npc.js`, `brain/sensors.js`, `brain/candidates.js`, `brain/state.js`,
`brain/llm-prompt.js` and `bench/metrics.js`. A feature that has moved to the interface is instead **one
record** in a file of its own under `static/js/sim/features/`, and **one line** in `FEATURES` in
`static/js/sim/features/index.js`. The core loops over the records' hooks and never names the feature.

Thirty features have moved to the registry. They include driveway reversers, ball chase, spring
potholes, Canada geese, police officers, tailgaters, black ice, snowbanks, puddles, traffic parking,
road closures, double-parked vans, contraflow cyclists, low sun glare, garbage trucks, traffic calming,
red-light runners, crossing guards, Ontario pedestrian crossovers, roadside stops, following distance,
turn restrictions, high beams, no-turn-on-red signs, scramble crossings, work zones with flaggers and
power cuts, overnight flashing signals, left turns on red, and amber-light decisions. Each record holds its core pipeline hooks and
model wording.

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
  evStop, evKerb, pullOverDetour,                       // the emergency pull-over and its audit
  day,                                                  // true: the clock keeps the `day` of the year while it is on
};
```

The header of `features/index.js` lists the hook arguments, and `SLOTS` lists the dispatch positions.
The World takes the option through `...features` and builds records in registration order at the end of
its constructor. A record that uses `buildAt` can run earlier to preserve construction dependencies.
Ontario crossovers set their option in the `early` position so the crowd can read it. Roadside stops
reserve parking bays at `afterSpawn` before other features that use the same bays. The World initializes
each declared `seen` flag to false and each declared `calls` field to an empty map. A metric requires a
seen flag. A record's `build` can return a boolean for a feature whose only setting is on or off.
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
the core never runs is still refused, then.

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
An `examinerFail` hook returns a failure item or null without modifying the report.

### Registry validation

Loading the registry validates the declarations before filling the hook lists. A hook can be a
function at `end` or an object with a supported `at` and a callable `run`. Data records for metrics,
notices and prompts have their own required fields. A notice's order is unique within its slot.
World properties, seen flags and audit maps share one namespace, and feature snapshot fields and
display text IDs each have one owner. Coach reports, guidance, deductions and tips take the same
slot lists the coaching dispatcher uses. Keep label accessors lazy when a vehicle module can
import the registry before its constants have initialized.

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

Before deterministic snapping (roadmap 7.1), comparisons needed one server process or a fixed
`PYTHONHASHSEED`. The first city comparison
differed in three drives (`s1-10` to `s1-12`): the simulation matched to the last digit up to a re-plan,
where the server's `/api/route` returned a different number of alternative routes for the same request.
The untouched tree, run again against the restarted server, gave the new results exactly. The server's
lane snapping (`jev/routing.py` `snap`) iterated a Python `set` of string-keyed lanes and kept the first
of equally near ones, so a tie depended on the process's hash seed. With `PYTHONHASHSEED=0` both trees
gave identical city results, the 12.81 km of the committed reference.

## How close a new feature is to "its own file, its challenge, its test and one registration line"

A registered feature still has these integration points outside its own files:

| Where | What still needs a change |
|---|---|---|
| `lab/challenges.js` | Register the authored challenge module. |
| `render/feature-views.js` | Mount and update any scene object the feature draws, through the browser adapter. |
| `main.js`, vehicle renderers | Add a mesh or a per-vehicle effect when existing renderers cannot draw the actor. |
| `AGENTS.md` | Link any project rule that agents need to preserve. |

Set `coach` on the record for its driving messages, penalties, tips and report fields. Use `notice`
for live HUD updates, `eventBadges` for audit badges, and the perception fields for AI Eyes
observations and rejection text. Use `routeOptions` and `requestReroute` to participate in routing.
Checkpoints call `checkpointShare` for immutable state and `checkpoint` after restoring the
world and fleet.

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

A new feature needs its own sim module, record, challenge, test and registration line, plus applicable
entries in the presentation files above.

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
* **Presentation hooks.** Records supply feature notices, perception lines and rejection labels.
  Renderer integration points are listed in the table above.
* **Then 3.3.** With the features out of `NpcFleet.step` and the sensing pass, those long functions are
  mostly the core's own logic and loops over hooks, and can be broken up.
