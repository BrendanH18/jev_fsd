# Review follow-ups, 12 November 2026 (ROADMAP 1.8)

Three defects left open by the review of #73 (ROADMAP 1.8, "From review of #73" and "Scenery in the
lane during a detour"). Starting tree: `dcfc663`. Node 22.23.4, Rules, lockstep, 40 traffic cars, suite
seed 1, pack version 6, `scripts/bench_node.mjs --diagnostics 1` against a server on port 8405. No live
model calls, no new dependencies.

Each fix has a focused Node check (`scripts/test_*.mjs`, Node 22, primitives only), which CI runs with
the other checks (`.github/workflows/demo.yml` runs every `scripts/test_*.mjs`). Each check was run
against the file it covers as it stood at `dcfc663` and fails there.

## Defects and fixes

| Defect | Fix | Check |
| --- | --- | --- |
| **Parked cars on bends.** `sim/parking.js` left out a bay whose car would reach more than 0.3 m into the travel lane (`bayIntrusion`), but measured a car placed square in the middle of the bay. The car actually parked there is jittered (up to 0.6 m along the kerb, 0.1 m sideways, 0.02 rad in heading), and near a bend that can carry it past the limit although its bay passed: over every map at full density, seeds 1 and 7, 26 of 78,950 parked cars reached more than 0.3 m into a lane, the worst 1.28 m. | `footprintIntrusion` measures the car's own body as placed; `bayIntrusion` now uses it for the bay. A car over the limit is not placed: its bay stays (empty, for traffic to park in, at the bay's own pose, which passed), and it still makes its draws and uses its number, so every other car keeps its number and pose. | `test_parking_footprint.mjs`: no placed car on any map reaches more than 0.3 m into a lane (worst now 0.298 m); one car or none per bay; a car left out still uses its number. |
| **Bus-lane turn-in allowance.** Leaving the reserved curb lane a right turn ends in, the car is not counted for a lane change's length, `laneChangeLength(ego.v)` at the current speed: the allowance shrank as the car slowed on the way across (and grew as it sped up). | `sim/bus-lanes.js` latches it on the world (`World.busTurnIn`, per street and route): a lane change's length at the fastest the car went in that lane before it had moved `TURN_OUT_M` (0.5 m) from the lane's centre, then fixed. Checkpoints clone the world, so they keep it. | `test_bus_lane_latch.mjs` (Mount Pleasant's Main Street, `e452`): started out at 10 m/s and slowed to 3 m/s, 22 m in, it is not counted (it was); started out at 3 m/s and sped up to 14 m/s, 30 m in, it is (it was not); a cloned checkpoint keeps the latch; a new route latches afresh. |
| **Scenery in the lane during a detour.** With scenery standing in the lane ahead, the stops (`stop_at_line`, `wait_for_officer`, `wait_for_runner`) and the hard brake keep to the line the car is on, rounding `lane.lateral` (`nudge`). `lane.lateral` already includes the move of a detour (a work zone, a lane closure, a double-parked van, a contraflow cyclist, a snowbank narrowing, a pothole, a cyclist pass), and every such law carries the detour too (`inLane`, or the hard brake's own), so the move was counted twice: a car a metre left round a work zone braked toward two metres left. The fix to the hard brake in #73 (`brakeLine`) covered only the case without scenery. | `brain/candidates.js`: the line is `lane.lateral` less the move of the detour the law carries (`lineOff`): `inLane`'s detour for the stops, and for the hard brake the pothole ease, the cyclist pass or `inLane`'s detour, whichever it carries. Without a detour nothing changes. | `test_detour_scenery_line.mjs`: a car a metre left on a work zone's detour line, with scenery ahead, brakes and stops on that line (both aimed at two metres left before); half a metre beyond it, it brakes there; without a detour, or without scenery, as before. |

## Results

"Reference" is the 11 November record (`20261111-1302*`, `docs/rules-baseline.md`). Per-route
comparisons are in [the JSON beside this record](review-followups-2026-11-12.json).

| Suite | Map | Weather | Routes | Passed | Reference | Against the reference (timings aside) |
| --- | --- | --- | --- | --- | --- | --- |
| bare | Kitsilano | dry | 12 | 12 | `20261111-130222-rules` | every route identical, events included |
| city | Kitsilano | dry | 12 | 12 | `20261111-130206-rules` | identical but `s1-10` (below) |
| city | Kitsilano | fog | 12 | 12 | `20261111-130207-rules` | identical |
| city | Kitsilano | rain | 12 | 12 | `20261111-130208-rules` | identical |
| city | Kitsilano | snow | 12 | 12 | `20261111-130209-rules` | identical but the known `s1-12` brake value (below) |
| city | Calgary | dry | 2 | 2 | `20261111-130210-rules` | identical |
| city | Edmonton | dry | 2 | 2 | `20261111-130211-rules` | identical |
| city | Halifax | dry | 2 | 2 | `20261111-130213-rules` | identical |
| city | Montréal | dry | 2 | 2 | `20261111-130214-rules` | identical |
| city | Mount Pleasant | dry | 2 | 2 | `20261111-130215-rules` | identical |
| city | Ottawa | dry | 2 | 2 | `20261111-130216-rules` | identical |
| city | Québec City | dry | 2 | 2 | `20261111-130217-rules` | identical |
| city | Saskatoon | dry | 2 | 2 | `20261111-130218-rules` | identical |
| city | Toronto | dry | 2 | 2 | `20261111-130219-rules` | identical |
| city | Victoria | dry | 2 | 2 | `20261111-130220-rules` | identical |
| city | Winnipeg | dry | 2 | 2 | `20261111-130221-rules` | identical |

("Identical" means every result field, `events` included, equal to the reference's but the timings
(`wall_ms`, latency percentiles) and the `diagnostics` these runs added.)

**The bare suite needs no re-baseline**: every route is identical to `20261111-130222-rules`. So are
the eleven other maps' smoke runs and Kitsilano city in fog and rain. Two city routes differ:

- **Kitsilano dry `s1-10`** (196.3 s to 213.5 s, 755 to 824 decisions, stopped 12.5 s to 24.9 s,
  average 21.6 to 19.9 km/h, RMS jerk 2.79 to 2.94, max jerk 21.5 to 29.4; still passes, no
  collision, no audit). The parked-car fix alone causes it: reverting only `sim/parking.js` restores the
  reference result exactly, while reverting only `bus-lanes.js` or only `candidates.js` does not. In this
  drive's world the footprint check leaves out one car, `parked_1706`, on Stephens Street (`e292`) at
  (-460, -176), 76 m behind the car's route. Traffic away from the car then plays out differently: a car
  pulling out of the kerb ahead (`car_p2`, at (-476, -69)) gets away at 107 s, where in the reference it
  was still waiting, and later traffic cars `car_8` and `car_21` reach the junction at (-596, -2) just as
  the car is about to pull away from it. The car waits 7 s longer there (149 to 156 s), and the rest of
  the 17 s follows from the traffic it meets after that. This is a change in which traffic the car
  meets, not a change in how it drives, so `20261111-130206-rules` needs a new Kitsilano dry city
  reference once this lands.
- **Kitsilano snow `s1-12`**: one safety brake at 260.5 s logs a closing speed of 9.141 m/s rather than
  the reference's 9.155. This is the exception already recorded in `docs/rules-baseline.md`, from the
  #73 fix to detour braking, and it is unchanged here: the current tree gives the same value.

In the other drives the fixes changed no outcome:

- **Parked cars.** The footprint check leaves out a few parked cars in these suites' worlds: one in
  Kitsilano (the one above, in bare and city alike, where the bare drive stays identical) and 13 over the
  other maps' 22 drives. Each is 76 m or more from its drive's route, and every other car keeps its
  number and pose.
- **Bus lanes.** Only Mount Pleasant and Winnipeg `s1-1` meet a bus lane in effect here. Their bus-lane
  driving stays at 0 m, and Mount Pleasant `s1-2`, the turn-in the allowance was written for, plays out
  identically: the latch changes no count.
- **Detours.** No route changes from the detour fix: reverting it alone leaves Kitsilano dry `s1-10`
  as it is now, and every other route is identical.

Other checks, one at a time under Node 22.23.4: `test_model_recording.mjs` passes (the committed stub
recording still replays to its saved result); `build_jev_fixtures.mjs --check` reports 0 stale
fixtures; `test_drive_lab.mjs` passes (331 checks, all challenges); and `test_bus_lane_merge`,
`test_bus_lane_turn_in`, `test_bus_lanes`, `test_buses`, `test_parking_bends`,
`test_parking_reservations`, `test_parking_ego`, `test_parkers`, `test_traffic_parking_clearance`,
`test_hard_brake_line`, `test_scenery_collision`, `test_pothole_margin`, `test_potholes`,
`test_pothole_traffic_clearance`, `test_puddles`, `test_double_parked`, `test_work_zones`,
`test_snowbanks`, `test_lane_change`, `test_lane_change_room` and `test_reroute_lanes` pass.
