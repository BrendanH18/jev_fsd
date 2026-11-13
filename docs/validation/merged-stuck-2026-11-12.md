# Stalls on the merged tree, 12 November 2026 (ROADMAP 1.8)

Starting tree: `9b4d23d` (the five fix branches of 12 November merged: Victoria seed 2, review follow-ups,
Calgary seed 2, Toronto seed 2, Kitsilano nights). Each passed on its own; together they changed which
traffic the car meets, and three city drives stalled. Node 22.23.4, Rules, lockstep, 40 traffic cars,
`scripts/bench_node.mjs --features city --diagnostics 1` against a local server, pack version 6. Every job
was run whole (drives depend on the ones before them in the process), then the failing drive was stepped
in Node with the runner's own setup to read traffic, riders, pedestrians, the officer and the parking law
around it. No live model calls, no new dependencies.

## Root causes and fixes

Each fix has a focused Node check (`scripts/test_*.mjs`, Node 22, primitives only), which fails on
`9b4d23d`. CI runs it with the other checks.

| Failure (`9b4d23d`) | Root cause | Fix | Check |
| --- | --- | --- | --- |
| Québec City `s1-1` (`--count 2`): timeout at 526.6 s on Rue Caron | Rue Caron is a 3.2 m one-way with a contraflow lane, across Boulevard Charest Est at `sig15`, where a police officer stood (its lights dark). A contraflow rider was held at its line on the officer's held axis. `car_16`, turning in from Charest, measured its room to move over on Charest (`trafficYield` used the current edge for every point), so it saw no conflict until it was inside Caron's mouth, and stopped there, 5.6 m from the junction's centre, for a rider it could never pass. The entry hold only covered riders coming out (`comingOut`), not one standing at its line. The officer's all-stop cannot end with a vehicle in the box, so the rider was held for good, and everyone queued behind. | `trafficYield` (sim/contraflow.js) measures the room on the street where it would meet the rider. Meeting one just inside the street it turns into, where waiting would leave its body in the junction, a driver waits before the junction instead, at its signal's line (out of the box), else at `entryHold`, once it can still stop there. | `test_contraflow_narrow.mjs` |
| Québec `s1-1`, next | An ambulance then passed `car_16` and stopped in the box face to face with the held rider, stood down there, and held the officer's all-stop the same way. A rider held up face to face by a standing vehicle rides off out of the car's sight (or squeezes by), but not when it is also waiting at its own line, and under an officer that wait never ends. | The face-to-face rule applies at the rider's line too (sim/contraflow.js `ride`). | `test_contraflow_narrow.mjs` |
| Québec `s1-1`, next | The driven car on Caron met a rider coming the other way and stopped 0.1 m short of the move over it planned (0.35 of 0.45 m), braking hard. A stopped car cannot move sideways, and the rider needs 0.1 m beside it to squeeze by, so each waited for the other. | Squeezing by a vehicle standing face to face on a contraflow street, a rider keeps up to 0.2 m nearer the kerb than its line (`HUG_M`), where that fits. | `test_contraflow_narrow.mjs` |
| Kitsilano rain `s1-9`: timeout at 597.4 s on West 5th Avenue | A child chasing a ball (sim/ball-chase.js) darted out; `reversing_1_away`, a car handed over from a driveway, stopped hard with its bumper 0.26 m short of the child's way back. The child would not walk within its body and a 0.1 m margin of a standing car (`Crowd.threat`), and the car waited for the child on its crossing (`crosswalkConflict`). | Part-way across, held up for 3 s by a vehicle standing just short of their way (the way passes no more than 0.1 m into its body), someone walks round its nearer end (`walkRound`, sim/pedestrians.js). A vehicle standing across the way is still waited for, as before (`test_pedestrian_stopped_car.mjs`). | `test_pedestrian_round.mjs` |
| Kitsilano rain `s1-9`, next | Round the bumper, the child's way home to the gap it came from ran past the tail of `car_p9`, a car at the kerb waiting to pull out. That car is in `world.npcs`, so the child waited for it; it waited for `reversing_1_away` to go (`pullClear`), which waited for the child. | A car still at the kerb waiting to pull out (`pull`, not yet `moving`) is parked as far as people walking by are concerned (`Crowd.threat`), as the Toronto fix (`kerbCars`) treats it for a pull-over. | `test_pedestrian_round.mjs` |
| Kitsilano `--park 1` `s1-12`: "not parked" on Vine Street (stuck, 0.95 m off the kerb at 33.5°) | The first arc into a 7.32 m space overshot to 35.7°; at the second arc's start its front corner would come within `CLEAR_M` of the car in front (`parked_3087`), and the swing the other way was blocked by it too. `nextLeg` gave up ("stuck") after one leg though a straight move either way was free. The officer's cruiser parked a bay behind had nothing to do with it. | With neither swing having room, the car moves 0.5 m straight (toward where swinging in goes, else away) and tries again, once in a row (`shuffle`); standing as the law allows already (`parkedPose().within_kerb`), it is parked. It now parks in 7 legs, 0.07 m off the kerb at 1.7°. | `test_parking_shuffle.mjs` |

Two changes were tried and left out: an officer ignoring an emergency vehicle in the box (the ambulance
had stood down, so it did not apply), and counting contraflow riders as waiting on a held axis (not
needed once nobody stops in the box for them).

## Results

| Job | `9b4d23d` | Now |
| --- | --- | --- |
| Québec City, city, seed 1, `--count 2` | 1/2 (`s1-1` timeout) | 2/2 (`s1-1` 285.7 s) |
| Kitsilano, city, seed 1, rain | 11/12 (`s1-9` timeout) | 12/12 (`s1-9` 393.9 s) |
| Kitsilano, city, seed 1, `--park 1` | 11/12 (`s1-12` not parked) | 12/12 (`s1-12` parked, 315.0 s) |
| Kitsilano, city, seed 1, dry | — | 12/12 |
| Kitsilano, bare, seed 1 | 12/12 | 12/12, every route field for field identical (timings aside) |

The bare suite has no contraflow riders, balls or parking, and no stall where a pedestrian waits on a
grazing vehicle or a kerb car, so nothing in it changed.

Checks, one at a time: `test_contraflow_narrow`, `test_pedestrian_round`, `test_parking_shuffle`,
`test_pedestrian_stopped_car`, `test_pedestrian_crossing_entry`, `test_cyclist_crosswalk_clearance`,
`test_crosswalks`, `test_contraflow`, `test_parking_ego`, `test_parkers`, `test_ball_chase`,
`test_emergency_ball`, `test_traffic_officers`, `test_driveway_reversers`, `test_school_buses`,
`test_collection_trucks`, `test_crossing_guards`, `test_emergency`, `test_model_recording` (the committed
recording still replays exactly) and `test_drive_lab` pass.

## Open

The driven car's own contraflow sensing (`contraflowCyclist`, brain/sensors.js) has the same entry rule as
traffic had: a rider standing at its line in the mouth of a narrow street the car turns into is not
"coming out", so the car may enter and stop in the junction for it. No run here showed it; changing it
changes the car's candidates, so it is left for its own item. A pedestrian's way round a standing vehicle
is two straight legs and does not look for other bodies beyond it.
