# Feature registry, final batch: emergency vehicles (ROADMAP 3.2)

Emergency vehicles moved onto the [feature registry](../../feature-interface.md) in three commits on top of
`8c34c63`, each leaving every result as it was: the fleet side, the audit, then sensing, candidates and
wording. The core files listed at the top of `static/js/sim/features/index.js` no longer name them:
`scripts/test_feature_registry.mjs` now refuses the emergency modules, `snap.emergency`, `pull_over`,
`fails_to_yield_to_emergency`, `evCalls`, `evYield`, `yieldEv`, `evShift`, `evRejoin`, `siren`,
`EV_BOX_M`, `AUDIT_EV_`, `FOLLOW_M`, `heldInQueue`, `queueHold` and the `ev*` hook names in them.

## What moved

| Before | After |
|---|---|
| `NpcFleet` option `emergency`, `sirens`, `nextEmergency`, `dispatched`, `evs` | the record's `buildFleet`: `fleet.emergency`, an `EmergencyTraffic` (`sim/emergency-traffic.js`) with `sirens`, `next`, `dispatched`, `evs` |
| `NpcFleet.dispatchEmergency`, `retireEmergency`, `emergencyStep`, `emergencyAhead`, `pullOverTo`, `yieldStop` | `fleet.emergency.dispatch`, `retire`, `step`, `ahead`, `pullOverTo`, `yieldStop` |
| the dispatch timer in `NpcFleet.manageTraffic` | `trafficManage` at the new slot `"beforeTransit"` (before buses, streetcars, school buses and trains, as before) |
| the siren-on vehicle step in `NpcFleet.step` | `trafficManeuver` at `"beforeSpecial"`, now handed `all` and the road users outside the fleet |
| traffic's call to give way (`n.yieldEv`), its pull-over shift (`n.evShift`), its stop, the stood-down rejoin (`n.evRejoin`) and hanging back 150 m | new hooks `trafficGiveWay`, `trafficPullOver`, `trafficStopAt`, `trafficRejoin`, `trafficHangBack`, each where that code ran |
| `World.auditEmergency`, `heldInQueue`, `queueHold`, the `AUDIT_EV_*` constants | `sim/emergency-audit.js`, run by the record's `audit` at the new slot `"afterCyclists"` with the road |
| `World.evCalls`, `evCounted`, `evJunction` | the record's `calls: "evCalls"` (cleared when the car is moved by hand, as before), `property: "evCounted"`, and `resetContact` for `evJunction` |
| `emergencyYield`, `emergencyAhead` and `EV_STOP_DECEL` in `brain/sensors.js` | `sim/emergency-yield.js`, run by the record's `sense` at the new slot `"afterRightHook"` |
| `snap.emergency`, `snap.emergency_ahead` defaults | the record's `snapshot` |
| the `pull_over` candidate, its rejection `fails_to_yield_to_emergency`, the speed cap on every lane candidate, the two prediction rules | `candidates` at `"afterRightHook"`, `sim` at the new slot `"afterParkers"`, `adjust` at the new slot `"first"`, `predictionIgnore` (now handed the world) and the new `predictionStill` |
| `desiredSpeed`'s pull-over and keep-back speeds, the hazard flag | `target` at the new slot `"afterBus"`, `hazard` at `"afterRightHook"` |
| `emergency_vehicle`, `emergency_vehicle_ahead`, the outcome, the two clauses, the hold-still criterion, the motion question, the prompt line, the flag text | `state` at `"afterRearTraffic"` and `"beforeTurnaround"`, `outcome` at `"ids"`, `clause` at `"afterRearTraffic"` and `"beforeFollowing"`, `holdStill` at `"afterLate"`, `motion`, `prompt` at `"afterRightHook"`, `flagText` |
| Rules' pull-over bonus and lane error, the cautious agent's first choice and planned stop, the deadlock exemption | `rulesCost` at the new slot `"special"`, the new `rulesLaneGoal`, `cautious` at the new slot `"first"`, `cautiousDrive`, `legitimateStop` |
| the crosswalk hold's name for an emergency vehicle | the new `vehicleLabel` |

The record registers right after traffic parking in `FEATURES`. Any position would do: each of its hooks has
a slot of its own, and the hooks other records give it (snowbanks' `evKerb`, `evStop` and `pullOverDetour`,
parkers' `evQueueHold`) are now dispatched by the emergency modules in registration order, as the core did.

## New registry pieces and why

- **A hook as a list.** A record may give one hook as a list of `{ at, run }` at two or more slots of the
  same pipeline (`feature-schema.js` `hookEntries`). The decision state and the wording put
  `emergency_vehicle` after the rear-traffic features and `emergency_vehicle_ahead` after the blind spot, and
  the JSON key order and clause order are part of what the model reads, so one slot could not hold both.
- **Slots.** Each new slot sits exactly where the code it replaces used to run, so candidates, rejections,
  the speed reasons, wording, prompt lines, events and failures keep their order.
- **Traffic.** The dead `!isEmergency(n)` guards in front of the bus, school bus and streetcar holds went: a
  vehicle with its siren on never reaches them. `yieldAtCrossing` takes the vehicles to wait for room among,
  and `boxBusy` an `onRoad` flag, both supplied by the emergency step as the core did itself.
  `npc.js` now exports `IDM`, `LOOK_M`, `LEADER_MARGIN_M`, `featureTrafficSpeed`, `bodySweepLook`,
  `sweptBodyGap` and `curveSpeed` for it.
- **Diagnostics only.** On the branch, Rules' explanation named the pull-over bonus `feature_special_0`, and
  the cautious agent reported `feature_first` and `feature_planned_stop`. After the merge the bonus is a
  named Rules term (`rulesTerms` at `"special"`), the cautious agent reports the first pick by its candidate
  id and the pull-over's stop at `cautiousDrive`'s `"plannedStop"`, so `explain()` and the decision trace say
  `pull_over` and `planned_stop` again, as before the move (`scripts/test_5k_planning_policy.mjs`).

## Left in the core

- The shared counter `failed_to_yield` (as asked).
- The slot names `"beforeEmergency"` (target and sim), named before this move after their neighbour.
- Comments that give an emergency vehicle as an example of what a hook is for.

## Parity

**Identical.** `8c34c63` (before) and `a63dad8` (after, the last of the three commits) were each captured
in Boat (xlarge, Node 22.23.5) from the worktree's checkout, each against its own loopback server started with
`PYTHONHASHSEED=0 PORT=8331 uv run --locked server.py`, using
[`registry_parity.mjs`](../../../scripts/registry_parity.mjs):

```sh
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" bare
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city kitsilano snow
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city kitsilano dry --hour 23.5
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city calgary dry
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" rules
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" cautious
node --experimental-default-type=module scripts/registry_parity.mjs prompt "$out"
node --experimental-default-type=module scripts/test_model_recording.mjs
node scripts/registry_parity.mjs compare "$before" "$after" \
  --expect city-snow.json,city-dry-hour-23.5.json,calgary-city-dry.json
```

| Capture (Rules unless named, seed 1, 12 routes) | Both trees | Compared |
|---|---|---|
| Kitsilano bare, dry | 12/12, 10.53 km | identical |
| Kitsilano city, dry (15:30) | 12/12, 12.81 km | identical |
| Kitsilano city, dry at 23:30 | 12/12, 12.80 km | identical |
| Kitsilano city, snow | 12/12, 13.65 km | identical |
| Calgary city, dry (multi-lane streets, where traffic changes lanes toward the kerb to give way) | 11/12, 11.58 km; `s1-6` fails with a failure to yield on both | identical |
| Every challenge and both road tests, Rules (Lights and sirens included) | 62/62 | identical, traces and events included |
| The same, cautious agent | 62/62 | identical |
| Guarded and open LLM system prompts | | byte for byte |
| `scripts/test_model_recording.mjs` (the stub model's whole drive, prompts included) | passes | passes |

The comparison discards only wall time, decision latency, run timestamps and source provenance. The
free-drive city suites dispatch emergency vehicles from the fleet's siren stream on every route, so the
dispatch timer, the vehicle step, traffic giving way and the car's pull-over all ran in them.

Targeted checks on the after tree (Boat, Node 22.23.5): `npm run lint`, `build_jev_fixtures.mjs --check`
(0 stale) and every `scripts/test_*.mjs` that mentions emergency vehicles, sirens or the pull-over (42 files,
among them all 22 `test_emergency*.mjs`, `test_pull_over_rejoin`, `test_5k_planning_policy`,
`test_5k_sensing_*`, `test_level_crossings`, `test_junction_box`, `test_give_way` and
`test_5k_traffic_inspection`), plus `test_feature_registry`, `test_free_drive`, `test_open_track`,
`test_challenge_modules` and `test_model_recording`: all pass.

## AGENTS.md wording to apply

In the invariant **Emergency vehicles and the car's pull-over**:

- Heading: `(sim/emergency.js, emergencyYield in brain/sensors.js, NpcFleet.emergencyStep)` becomes
  `(sim/emergency.js and the record sim/features/emergency.js: emergencyYield in sim/emergency-yield.js,
  EmergencyTraffic.step in sim/emergency-traffic.js, the audit in sim/emergency-audit.js)`.
- `emergencyLead latches drive-on authorisation in World.evCalls` becomes `... in world.evCalls (the record's
  calls map)`.
- `NpcFleet.yieldStop is a physical front-bumper target` becomes `EmergencyTraffic.yieldStop
  (sim/emergency-traffic.js, through traffic's trafficStopAt hook) is a physical front-bumper target`.
- `(World.heldInQueue, through the feature's evQueueHold hook)` becomes `(heldInQueue in
  sim/emergency-audit.js, through the feature's evQueueHold hook)`.
- **Registered features**: add emergency vehicles to the list.

`docs/feature-interface.md` lists `evStop, evKerb, pullOverDetour` among a record's hooks; they are now run by
the emergency modules rather than the core, and the new hooks above belong in its record sketch and in
"Moving the rest (3.2)".
