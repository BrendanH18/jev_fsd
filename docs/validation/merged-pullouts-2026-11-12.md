# Merged tree: routes stuck around cars pulled out of the kerb, 12 November 2026 (ROADMAP 1.8)

Starting tree: `9b4d23d` (the five fix branches of 12 November merged). Node 22.23.4, Rules, lockstep, 40
traffic cars, `scripts/bench_node.mjs --features city` against a local server, pack version 6. Each failure
was reproduced on the untouched merge with the full job (results depend on earlier drives in the same
process), then stepped in Node with the runner's own setup to read traffic, candidates and audits around
it. In each one a car pulled out of the kerb (`car_pN`) was stuck behind or beside the real cause. No live
model calls, no new dependencies.

## Root causes and fixes

Each fix has a focused Node check (`scripts/test_*.mjs`, Node 22, primitives only), run by CI with the
others; each check fails with its fix taken out.

| Failure (`9b4d23d`) | Root cause | Fix | Check |
| --- | --- | --- | --- |
| Ottawa `s1-1`: timeout, and collisions with `car_p3` at 147.5 s and 171.9 s (McLeod Street) | Two faults. (1) An ambulance on its call at 11 m/s saw a ball roll out 21 m ahead, too late to stop short of the gap, and stopped with its body beside it. The child picked the ball up on the far side, walked back toward the gap, came up against the ambulance's side and waited for it to move (sim/pedestrians.js `threat` waits short of a stationary body), while the ambulance waited for the child in the road. Neither ever moved. (2) `car_p3`, just pulled out and still angled 14 degrees, stood nose to nose with the ambulance and backed off (`backOff`) into the driven car stopped behind it and to its left: the room behind was measured only for vehicles whose centre lay in a 1.6 m strip straight behind, and the driven car's centre was 2.6 m to the side with its front corner right behind the reversing car. | (1) A child bringing the ball back who is stopped by a vehicle standing across the way walks round the nearer end of its body, 0.6 m clear (round the other end where another standing body is in the way), then on to the kerb as before (sim/ball-chase.js `walkRound`; at most three times on one way back). (2) `backOff` also stops for anything whose body is in its own body moved 1.5 m straight back (`BACK_CLEAR_M`), so a corner in that room counts. | `test_ball_walk_round.mjs`, `test_backoff_angled.mjs` |
| Edmonton `s1-2`: timeout, stopped 6.7 m behind `car_p2` (81 Avenue NW) | `car_p2`, pulled out earlier, became a traffic parker (sim/parkers.js) on a one-lane one-way street. Reversing in on full lock, its front reached the far kerb's limit at 31 degrees, the square-up leg ran its front toward the car parked ahead, and the manoeuvre was stuck. It tried again from where it stood every 1.5 s, found no leg each time, and gave up only "while still near its start", which, 23 degrees across its lane, it never was: the driven car waited behind it for 350 s. | Stuck for `STUCK_MAX_S` (30 s) a parker gives up wherever it stands and drives on as traffic. Near its start it still gives up after `GIVE_UP_S` (12 s) as before. | `test_parker_stuck_angled.mjs` |
| Kitsilano snow `s1-12`: timeout, 2 m behind `car_p2` (Balsam Street) | Plows are put down on the main streets but `NpcPath.extend` let them turn onto any street. On Kitsilano's residential streets (3.2 m lanes, 2.1 m parking lanes) a car parked at the kerb stands 2.6 m from the lane's middle, 2.52 m for `parked_1263` with its parking jitter, inside the 2.55 m that a 2.6 m plow counts as in its way. `plow_1` turned onto West 5th Avenue, came to a stop 3 m behind that parked car (its gap stayed just over the 3 m that starts the stopped driver's give-up clock) and stood there for the rest of the drive. `car_p2` (pulled out of the kerb) waited behind it, and so did the driven car. | A plow's path keeps to the classes it works (`PLOW_CLASSES`: primary, secondary, tertiary) wherever a junction offers one (`NpcPath` option `classes`), with the same one random draw per turn; with none on offer it takes what there is. Plows exist only while it snows in city drives. | `test_plow_main_streets.mjs` |

## Results

City preset, suite seed 1. Per-route results for the runs below were compared field by field with the
untouched merge run in the same session.

| Job | `9b4d23d` | Now | Notes |
| --- | --- | --- | --- |
| Ottawa, dry, 2 routes | 1/2 | 2/2 | `s1-1` arrives at 191.0 s, no collisions |
| Edmonton, dry, 2 routes | 1/2 | 2/2 | `s1-2` arrives at 273.6 s (`car_p2` gives up at about 130 s) |
| Kitsilano, snow, 12 routes | 10/12 (`s1-4`, `s1-12`) | 11/12 | `s1-12` arrives at 534.9 s; `s1-4` fails to yield as on the merge. Routes `s1-2`, `s1-3`, `s1-7`, `s1-8`, `s1-9`, `s1-11` change in detail, all passing, as the plow keeps to the main streets |
| Kitsilano, dry, 12 routes | 12/12 | 12/12 | every route identical |
| Kitsilano, rain, 12 routes | 11/12 (`s1-9` timeout) | 10/12 (`s1-9` collision, `s1-12` brake check) | see Open |

Checks (Node 22.23.4, one at a time): the four new checks, `test_ball_chase`, `test_ball_competing_stop`,
`test_crosswalks`, `test_double_parked`, every `test_emergency*` (19), `test_npc_turn_lane`, `test_parkers`,
`test_parking_bends`, `test_parking_ego`, `test_parking_footprint`, `test_parking_reservations`,
`test_pull_out`, `test_pull_over_rejoin`, `test_snow_plows`, `test_traffic_backoff`,
`test_traffic_parking_clearance`, `test_model_recording` (the stub recording replays unchanged: no rewrite)
and `test_drive_lab` (117 s) pass.

## Bare suite

`scripts/bench_node.mjs` with default features, Kitsilano, suite seed 1: 12/12, and every route identical
field for field (timings aside) to the untouched merge. Of the four changes only `backOff` runs in a bare
world, and no bare route backs off into a car at an angle.

## Open

- **Kitsilano rain `s1-12`, brake check (new).** The `backOff` change alters which traffic the car meets.
  At 148.5 s on Vine Street, coming up to a stop sign 17 m ahead at 6.4 m/s, `car_12` closes from behind
  at 7.6 m/s with a 0.92 s headway, just over the 0.8 s at which sensing calls it a tailgater
  (`TAIL_THREAT_S`). The forward sims predict it at constant speed, so every stopping candidate is
  rejected as a rear-end collision. With nothing eligible the car falls back to `hard_brake` (4.2 m/s²
  where 1.0 was needed), which closes the headway below 0.8 s, and the audit counts a brake check. A
  follower closing from behind at a few m/s rejecting every way of stopping is a forward-sim issue that
  predates this pass. It was not changed here.
- **Kitsilano rain `s1-9`, still failing, now a collision.** On the merge it timed out stuck on West 5th
  Avenue (a reversing driveway car, an ambulance and pulled-out cars). With the ball fix it gets further,
  then at the Yew Street junction the car, `school_bus_6` and several traffic cars lock up. After the
  deadlock overrides the car's creep drives into the stationary school bus at 425 s (at fault). Not
  investigated further.
- **Kitsilano snow `s1-4`, failure to yield**, fails the same way on the merge. Not part of this pass.
- The parker's S-curve on a one-lane one-way street came within millimetres of the far kerb limit
  (`sClear` passed, but the executed path did not, from actuator lag and an 8 cm start error). The
  give-up removes the deadlock; planning that margin was not touched (`parallel-park.js` is shared with
  the driven car's parking).
