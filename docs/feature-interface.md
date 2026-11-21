# The feature interface

ROADMAP 3.1. Each opt-in feature used to be written into the same core files: `sim/world.js`,
`sim/step.js`, `sim/npc.js`, `brain/sensors.js`, `brain/candidates.js`, `brain/state.js`,
`brain/llm-prompt.js` and `bench/metrics.js`. A feature that has moved to the interface is instead **one
record** in a file of its own under `static/js/sim/features/`, and **one line** in `FEATURES` in
`static/js/sim/features/index.js`. The core loops over the records' hooks and never names the feature.

Seven features have moved: driveway reversers (`features/driveways.js`), spring potholes (`features/potholes.js`), Canada geese (`features/geese.js`),
black ice (`features/black-ice.js`), snowbanks (`features/snowbanks.js`), puddles (`features/puddles.js`)
and road closures (`features/road-closures.js`). Each record holds the hooks into the core pipeline
and the model wording that used to sit in `brain/state.js` and `brain/llm-prompt.js`.

## A record

```js
export default {
  key: "geese",                 // the World option, and the World property `build` fills (its `enabled`)
  seen: "geeseSeen",            // the World flag: the feature has met the car this drive
  calls: "geeseCalls",          // the World map of the audit's calls (cleared when the car is moved by hand)
  build: (world, { enabled, seed, map }) => new Geese(world, { enabled, seed }),
  metric: { at: "balls", name: "wildlife_conflicts", failure: "drove into or too close to geese crossing the road" },
  obstacle: { test: isGoose, likePedestrian: true },   // its things in world.obstaclesNear
  motion: (snap) => !!snap.geese_crossing?.wait,       // ask the model "stop or drive?"
  priority: [],                                        // candidate ids kept when the list is cut

  obstacles(world, x, y, r) { ... },                    // World.obstaclesNear
  stepAfterTraffic(world, fleet, dt) { ... },           // sim/step.js
  audit: { at: "balls", run(world) { ... } },           // World.audit
  sense: { at: "balls", run(world, snap, ctx) { ... } }, // the sensing pass
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
timestamp. Both runs of **Reverse lights** reported the reversing audit. The LLM system
prompt was byte-identical, the Jev fixtures stayed current, and the committed stub replay passed.

**Run before and after against one server process, or set `PYTHONHASHSEED`.** The first city comparison
differed in three drives (`s1-10` to `s1-12`): the simulation matched to the last digit up to a re-plan,
where the server's `/api/route` returned a different number of alternative routes for the same request.
The untouched tree, run again against the restarted server, gave the new results exactly. The server's
lane snapping (`jev/routing.py` `snap`) iterates a Python `set` of string-keyed lanes and keeps the first
of equally near ones, so a tie can depend on the process's hash seed. With `PYTHONHASHSEED=0` both trees
gave identical city results, the 12.81 km of the committed reference.

## How close a new feature is to "its own file, its challenge, its test and one registration line"

For the seven migrated features, the core files above no longer name them. What a feature still needs
outside its own files:

| Where | What | Hook needed |
|---|---|---|
| `sim/free-drive.js` | its free-drive option (`on("geese")`) | `freeDrive` (option and query parameter) |
| `lab/challenges.js` | the challenge entry and its installer/step | ROADMAP 3.5 (one file per challenge) |
| `brain/rules.js`, `agents/cautious.js`, `brain/safety.js` | the drivers' preferences: a stop flag, a cost for its candidate, the cautious agent's pick | `rules` (stop, cost), `cautious` |
| `brain/brain.js`, `bench/runner.js`, `lab/evaluation.js`, `lab/recorder.js` | road closures' re-plan round a closure (`avoid`, `closureRouting`) and checkpoint fixes (geese' `world` back-reference, potholes shared between checkpoints) | `reroute`, `checkpoint` |
| `sim/drive-score.js` | the coach: its seen flag, incident text, score penalty, tip and report field | `coach` |
| `main.js`, `render/*.js`, `render/perception.js`, `ui/lab.js` | drawing it, the HUD notice and badge, the perception overlay's line and rejection label | `view`, `notice`, `perception` |
| `lab/trace.js`, `lab/examiner.js` | the audit's label and road-test category | from `metric` (add `label`, `category`) |
| `AGENTS.md` | its paragraph | ROADMAP 3.4 |

So today a new feature needs its own sim module, its record, its challenge, its test and the registration
line, plus a line each in about eight presentation and driver files. The core simulation and decision
pipeline need nothing.

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
  that puddles used went once snowbanks moved; the new slots are named after the core code they follow
  (`"officers"`, `"tailgaters"`, `"parking"`, `"parkers"`).
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
  (`trafficLane` at `"parkers"`, with `hold`, `lineAt` and `kept` for the leader search). The forward-sim
  checker gained `settle` (puddles' "no manoeuvre can help it" pass) and the sim time in `afterLaw`.
* **Driveway reversers.** An obstacle can provide its own predicted box and local visibility check, and
  use `traffic: true` to stay in the ordinary traffic sensing pass. A forward-sim checker can inspect
  nearby obstacles via `near`. The reverser step runs in the `"beforeBalls"` slot, after contraflow.
* **Hooks still to add.** Driver preferences (Rules, the cautious agent), the coach, the HUD and
  renderers, checkpoint fixes and the re-plan, as in the table above.
* **Then 3.3.** With the features out of `NpcFleet.step` and the sensing pass, those long functions are
  mostly the core's own logic and loops over hooks, and can be broken up.
