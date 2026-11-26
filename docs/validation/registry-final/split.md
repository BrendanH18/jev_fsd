# Splitting the per-vehicle traffic loop

ROADMAP 3.3, the last piece. With every opt-in feature on the registry
([feature interface](../../feature-interface.md)), the per-vehicle body of `NpcFleet.step`
(`sim/npc.js`) calls hooks instead of naming features. It is now split into named stages, each under
150 lines. The change is a pure refactor: every statement moved unchanged and in the same order, so the
floating-point operations, random draws and hook calls (order and arguments) are the same.

## The stages

`step` keeps fleet scheduling (`manageTraffic`) and builds `scene` once per step: `all` (the driven car
and the fleet), `extraTraffic` (`trafficActors`) and `standing` (`trafficStanding`). It hands each vehicle
to `stepVehicle`, which runs the `trafficStart` hooks and then the stages in the loop's original order.
The stages share `t`, one plain object per vehicle per step that `placeOnPath` starts. Each later stage
reads what it needs from `t` and writes back what it changes: `gap`, `leadV`, `leader`, `stopAt`,
`featureLimit`, `offset` and the rest. Within a stage, locals keep the loop's original names. The loop's
early `continue`s became `return` from the stage that has them (`heldInPlace` returns true; the wedged
re-plan in `drive` returns before the step).

| Method | Lines | Loop lines it took (before) |
|---|---:|---|
| `step` | 10 | setup and the `for` |
| `stepVehicle` | 17 | the order of the stages |
| `heldInPlace` | 42 | frozen, `trafficManeuver` (`beforeSpecial`), the wait to pull out, parking, `trafficManeuver`, backing off, holding |
| `placeOnPath` | 50 | path policy, a finished lane change, projection and recovery, the `trafficReplan` slots, `trafficLeaderHold` |
| `chooseLane` | 41 | `trafficGiveWay`, `trafficLaneControl`, lane changes, `trafficStop`, a cyclist's kerbside line, `trafficPullOver`, the standing nudge |
| `laneOffset` | 101 | corridor, bypass, overtaking, the offset sum, the `trafficLane` slots, `trafficDriver`, `trafficParkingPlan`, the pull-out merge, `trafficRejoin` |
| `leaderOnPath` | 74 | the leader search along the path (with `inWay`) |
| `leaderByBody` | 71 | a cyclist's body check, the heavy vehicle's body sweep, the swept-body gap to the driven car |
| `leaderHolds` | 31 | `trafficKeepBack`, the leader hold, `trafficFollowingLeader`, `trafficLeadPolicy`, `n.lead` |
| `controlAhead` | 79 | the first signal, yield line or stop sign ahead |
| `stopLines` | 46 | crosswalk, a cyclist's strip hold, `trafficStopAt`, the parking stop, `trafficHangBack` |
| `junctionWaits` | 79 | the indicator, the left turn, the right hook, unsigned junctions, the box at a signal |
| `unstick` | 37 | the nose-to-nose back-off and abandoning a stale stop |
| `featureHolds` | 86 | `trafficHold` (`buses`), `trafficStop`, `trafficHold`, the junction box, corridor, bypass, lane-control and `afterMerge` stops, lane-move holds, `trafficYield` |
| `drive` | 71 | the speed ceiling, the IDM, the pedals, the wedged re-plan, the cyclist's shuffle, pure pursuit, the step |

Before: `NpcFleet.step` was 744 lines (ROADMAP's count of 959 predates the scheduling extraction).
After: `step` is 10 lines, and the longest piece is `laneOffset` at 101.

The other two functions ROADMAP 3.3 names needed nothing more. `buildSnapshot` (`brain/sensors.js`) is
71 lines since snapshot assembly was extracted. `needsMotionQuestion` (`brain/state.js`) is a 15-line
`or` of one clause per situation, with the features behind `featureMotion`. `desiredSpeed` in
`brain/sensors.js` (212 lines) is still over the limit, but ROADMAP 3.3 does not name it.

All the moved code stays in `sim/npc.js`, so `scripts/test_feature_registry.mjs`'s CORE list and the
registry's own list of core files are unchanged, and its source checks still find every hook call.

## Parity

Before is `e8d687f0`; after is the split commit. That commit only changes `sim/npc.js`, so the before
tree on Boat was the after tree with `e8d687f0`'s `npc.js` swapped in. The run used an xlarge sandbox
with Node 22.23.5 and ran the two trees side by side, each with its own loopback server
(`PYTHONHASHSEED=0 PORT=8331|8332 uv run --locked server.py`). From each tree:

```sh
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" bare
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city kitsilano snow
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city --hour 23.5
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city --park 1
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city toronto
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city edmonton
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" rules
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" cautious
node --experimental-default-type=module scripts/registry_parity.mjs prompt "$out"
node --experimental-default-type=module scripts/test_model_recording.mjs
node --experimental-default-type=module scripts/registry_parity.mjs compare "$before" "$after" \
  --expect city-snow.json,city-dry-hour-23.5.json,city-dry-park.json,toronto-city-dry.json,edmonton-city-dry.json
```

All 22 steps exited 0 (11 per tree). The bare, city and snow pass counts come from a rerun of the after tree. `compare` printed `identical` for all ten captures and exited 0:

| Capture | Before and after |
|---|---|
| Kitsilano bare, dry, seed 1 | 12/12, identical |
| Kitsilano city, dry | 12/12, identical |
| Kitsilano city, snow | 12/12, identical |
| Kitsilano city, dry, 23:30 | 12/12, identical |
| Kitsilano city, dry, `--park 1` | 12/12, identical |
| Toronto city, dry | 9/12 on both trees (three timeouts), identical |
| Edmonton city, dry | 11/12 on both trees (one failure to yield), identical |
| Arena, Rules: every challenge and both road tests | 62/62, identical |
| Arena, cautious agent | 62/62, identical |
| Guarded and open LLM system prompts | byte for byte |
| `scripts/test_model_recording.mjs` | 10 checks pass on both trees |

Targeted checks on Boat: `npm run lint`; `scripts/test_feature_registry.mjs`, `test_free_drive.mjs`,
`test_5k_traffic_inspection.mjs`, `test_emergency_traffic_stop.mjs`, `test_buses.mjs` and every
`scripts/test_*traffic*.mjs` (12 files). CI runs the full suite.
