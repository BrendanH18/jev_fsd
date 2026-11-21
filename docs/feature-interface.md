# The feature interface

ROADMAP 3.1. Each opt-in feature used to be written into the same core files: `sim/world.js`,
`sim/step.js`, `sim/npc.js`, `brain/sensors.js`, `brain/candidates.js`, `brain/state.js`,
`brain/llm-prompt.js` and `bench/metrics.js`. A feature that has moved to the interface is instead **one
record** in a file of its own under `static/js/sim/features/`, and **one line** in `FEATURES` in
`static/js/sim/features/index.js`. The core loops over the records' hooks and never names the feature.

Eleven features have moved: driveway reversers, ball chase, spring potholes, Canada geese, police officers,
tailgaters, black ice, snowbanks, puddles, traffic parking and road closures. Each record holds the hooks
into the core pipeline and the model wording that used to sit in `brain/state.js` and `brain/llm-prompt.js`.

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

The header of `features/index.js` lists every hook, its arguments and its slots. The World takes the
option through `...features` in its constructor and builds every record at the end of the constructor,
in registration order, with its `seen` flag false and its `calls` an empty map.

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

| Where | What | Hook needed |
|---|---|---|
| `lab/challenges.js` | the challenge entry and its installer/step | ROADMAP 3.5 (one file per challenge) |
| `brain/rules.js`, `agents/cautious.js`, `brain/safety.js` | the drivers' preferences: a stop flag, a cost for its candidate, the cautious agent's pick | `rules` (stop, cost), `cautious` |
| `brain/brain.js`, `bench/runner.js`, `lab/evaluation.js`, `lab/recorder.js` | road closures' re-plan round a closure (`avoid`, `closureRouting`) and checkpoint fixes (geese' `world` back-reference, potholes shared between checkpoints) | `reroute`, `checkpoint` |
| `sim/drive-score.js` | the coach: its seen flag, incident text, score penalty, tip and report field | `coach` |
| `main.js`, `render/*.js`, `render/perception.js`, `ui/lab.js` | drawing it, the HUD notice and badge, the perception overlay's line and rejection label | `view`, `notice`, `perception` |
| `AGENTS.md` | its paragraph | ROADMAP 3.4 |

Free drives and the city benchmark enable every registered feature by default. Use the record's
option key with `--without` and its lowercase form in the URL. For example, disable road closures
with `--without roadClosures` or `?roadclosures=0`. `scripts/test_free_drive.mjs` checks both paths.

The record's `metric.label` supplies the trace event text. Simultaneous registered violations appear
in metric slot order, then registration order within each slot. The examiner groups the metric's
failure under `metric.category` when present and under Other otherwise.

So today a new feature needs its own sim module, its record, its challenge, its test and the registration
line, plus entries in the presentation and driver files above. The core simulation and decision pipeline
need nothing.

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
* **Hooks still to add.** Driver preferences (Rules, the cautious agent), the coach, the HUD and
  renderers, checkpoint fixes and the re-plan, as in the table above.
* **Then 3.3.** With the features out of `NpcFleet.step` and the sensing pass, those long functions are
  mostly the core's own logic and loops over hooks, and can be broken up.
