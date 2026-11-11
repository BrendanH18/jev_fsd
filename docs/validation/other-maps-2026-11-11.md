# The other maps, 11 November 2026 (ROADMAP 1.8)

Starting tree: `44169f1`. Node 22.23.4, Rules, lockstep, 40 traffic cars, suite seed 1, pack
version 6, `scripts/bench_node.mjs` against the production server on port 8393. The smoke suite is
the `city` preset, dry, two routes per map. Failures were reproduced on the untouched tree
(a `git worktree` of `44169f1`, kept outside `/tmp`) with `--diagnostics 1`, then stepped in Node
with the same setup as the runner to read the snapshot, candidates and audits around each one. Where
a fix was in doubt it was applied alone to the untouched tree to confirm it removes the original
failure. No live model calls, no new dependencies.

## Root causes and fixes

Each fix has a focused Node check (`scripts/test_*.mjs`, Node 22, primitives only), run by CI with
the other checks.

| Failure (10 November) | Root cause | Fix | Check |
| --- | --- | --- | --- |
| Winnipeg `s1-1`: 45 deadlock recoveries, 1.1 s off road (Disraeli Freeway) | The curb lane is a bus lane all day, so the car keeps to the middle lane; the router follows the curb lane into a one-lane ramp that continues the middle lane. Lane laws held their 3.5 m offset from the route's polyline onto the ramp, so every forward candidate left the road and the car stalled, then the deadlock creep went off road. | `Route.busMerges` (map/route.js): with a bus-lane policy, where the lane the car keeps to runs straight on into the route's lane on a street with other lanes, the polyline's move across counts as a frame shift, so lane laws follow the car's lane onto the ramp. Nothing changes without the policy. | `test_bus_lane_merge.mjs` |
| Winnipeg `s1-1`: two collisions with parked cars (one at fault), a failure to yield, deadlocks (Lily Street) | Parking bays were placed on the inside of a tight bend, where a parked car's straight body reached up to 1.8 m into the travel lane. The car and an ambulance were blocked for minutes; the creep hit the parked cars. | `sim/parking.js`: no bay whose car would reach more than 0.3 m into the travel lane (`bayIntrusion`). Its random draws are still made and its car number used, so every other bay keeps its car and number. | `test_parking_bends.mjs` |
| Winnipeg `s1-1` (after the above): failure to yield on Martha Street; Edmonton `s1-1` (108 Street NW) | The car was stopped at the hold line behind a traffic car reversing into a space (sim/parkers.js) when the siren came; the room ahead is the parker's, so it cannot pull over. The audit's queue exception only knew a stationary body within 5 m. In Edmonton the parker finished 0.4 s before the ambulance drew level, ending the exception before the car could move over. | `World.parkerQueue`: a parker the car stands at the hold line of is a queue. Released from a queue, the car has as long to pull over as from the call (`AUDIT_EV_PULL_S`). | `test_emergency_parker_queue.mjs` (`test_emergency_control_line.mjs` now runs the audit when its queue clears, as the simulation does) |
| Winnipeg `s1-1` (after the above): pothole hit at 58 km/h after a closure detour | A re-plan replaced the route under a lane law named by the old route's chain index, which matched a chain of the new route: sensing put the car two lanes left of where it was, ignored the pothole in its real lane and steered across. | `Autopilot.reroute` drops a lane manoeuvre planned on the old route and decides again at once, as `main.js` does for a new destination. | `test_reroute_lanes.mjs` |
| Winnipeg `s1-1` (after the above): four deadlock recoveries before a left turn | Two lanes from the left-turn lane after the detour, the first change was planned at the 50 m maximum, leaving too little room for the second; the car slowed mid-change and stopped short of finishing it, with no further change offered. | `candidates.js`: a return toward the route's lane that leaves the car lanes away shares the room before the lane ends with the changes to come. | `test_lane_change_room.mjs` |
| Toronto `s1-2`: off road, four deadlock recoveries (Spadina Crescent into Spadina Avenue) | The route's right turn into the avenue's curb lane crosses the junction's corner, paved in the renderer's junction fill but outside both streets' strips; `roadDistance` called it off road, every candidate was rejected, and the creep then counted 1.6 s off road. | `map/junctions.js`: one copy of the junction fill, drawn by `render/roads.js` and counted as road by the candidates' off-road rejection and the off-road audit (`surfaceDistance`). Scenery placement keeps `roadDistance`. | `test_junction_fill.mjs` |
| Québec City `s1-1`: failure to yield (Rue Saint-Vallier Est) | Stopping for an ambulance on a crossing street, the plan stops 2.5 m short of the crossing street's edge: 7.8 m from the node across a 10.6 m street, inside the audit's 8 m junction box, which the car entered at 1.3 m/s. | `EV_BOX_M` (sim/emergency.js) shared by the plan and the audit: the plan stops out of the box too. Confirmed alone on `44169f1`. | `test_emergency_junction_box.mjs` |
| Mount Pleasant `s1-2`: 23 m in a reserved bus lane | Main Street bends right (a right turn) into a block whose curb lane is reserved all day, 75 m before the next right turn; turning right ends in the curb lane (BC MVA s. 165), and the car was counted while changing out of it. | `sim/bus-lanes.js`: within a lane change's length of turning right into the street, leaving the curb lane is not bus-lane driving. | `test_bus_lane_turn_in.mjs` |
| Victoria `s1-2`: pothole hit at 26 km/h (Yates Street) | Easing round a pothole just after a right turn, the car's nose still pointed across the lane; the forward simulation predicted the wheel clear by centimetres, and a hard brake mid-ease steered back to the lane centre. | `SIM_PAD_M` (10 cm) round potholes in the forward simulations' wheel test; a hard brake while easing round one keeps the ease. | `test_pothole_margin.mjs` |

Exposed while keeping Kitsilano's city suite at 48/48 (the bend bays and the re-plan change traffic
everywhere, which brought latent problems to the surface):

| Route | Root cause | Fix | Check |
| --- | --- | --- | --- |
| Kitsilano dry `s1-5`: contact with a fire truck backing out of a stand-off | Nudged 1 m right to pass it, the car's hard brake aimed back at the lane centre and swung its nose into the truck. | A hard brake 0.75 m or more off the lane's centre keeps to its line (to the nearest half metre), as with scenery in the lane. | `test_hard_brake_line.mjs` |
| Kitsilano fog and rain `s1-8`: failure to yield on West 8th Avenue | Cars parked close to a 3.2 m lane's line leave less than the 0.3 m pull-over plus the forward simulations' 0.3 m margin: the pull-over was rejected as a collision for 1.5 s, and the car stopped 0.17 m over. | `parkedRoom` (sim/emergency.js): the plan pulls over only as far as parked cars leave room, and the audit takes that far (less the usual 0.1 m settling allowance, over the kerb it pulls into) as pulled over. | `test_emergency_room.mjs` |
| Kitsilano snow `s1-12`: failure to yield on West Broadway | Stopped in the left lane with a bus alongside in the right lane, the car could not pull over, and stopping was counted as not yielding. | The audit counts a stop with a vehicle alongside on the right, closer than a lane's width, as yielding. | `test_emergency_room.mjs` |
| Kitsilano snow `s1-11`: collision with an ambulance | Told to drive on, the car crept forward at a stop sign while the ambulance drew alongside to go round and turned across its nose. | Sensing: with drive-on authorised, a vehicle alongside (within 4 m) holds the car still until it is past. | `test_emergency_room.mjs` |

## Results

City preset, suite seed 1. "Before" is the 1.4 record (`20261110-1902*`/`-1903*`), "after" this change
(`20261111-1302*`). Per-route results are in [the JSON beside this record](other-maps-2026-11-11.json).

| Map | Weather | Before | After | Run | Collisions | Failures to yield | Off road (s) | Deadlocks |
|---|---|---|---|---|---|---|---|---|
| Kitsilano | dry | 12/12 | 12/12 | `20261111-130206-rules` | 0 | 0 | 0 | 0 |
| Kitsilano | fog | 12/12 | 12/12 | `20261111-130207-rules` | 0 | 0 | 0 | 0 |
| Kitsilano | rain | 12/12 | 12/12 | `20261111-130208-rules` | 0 | 0 | 0 | 0 |
| Kitsilano | snow | 12/12 | 12/12 | `20261111-130209-rules` | 0 | 0 | 0 | 0 |
| Calgary | dry | 2/2 | 2/2 | `20261111-130210-rules` | 0 | 0 | 0 | 0 |
| Edmonton | dry | 1/2 | 2/2 | `20261111-130211-rules` | 0 | 0 | 0 | 0 |
| Halifax | dry | 2/2 | 2/2 | `20261111-130213-rules` | 0 | 0 | 0 | 3 (`s1-1`, as before) |
| Montréal | dry | 2/2 | 2/2 | `20261111-130214-rules` | 0 | 0 | 0 | 0 |
| Mount Pleasant | dry | 1/2 | 2/2 | `20261111-130215-rules` | 0 | 0 | 0 | 0 |
| Ottawa | dry | 2/2 | 2/2 | `20261111-130216-rules` | 0 | 0 | 0 | 0 |
| Québec City | dry | 1/2 | 2/2 | `20261111-130217-rules` | 0 | 0 | 0 | 0 |
| Saskatoon | dry | 2/2 | 2/2 | `20261111-130218-rules` | 0 | 0 | 0 | 0 |
| Toronto | dry | 1/2 | 2/2 | `20261111-130219-rules` | 0 | 0 | 0 | 0 |
| Victoria | dry | 1/2 | 2/2 | `20261111-130220-rules` | 0 | 0 | 0 | 0 |
| Winnipeg | dry | 1/2 | 2/2 | `20261111-130221-rules` | 0 | 0 | 0 | 0 |

Other maps 22/22 (16/22 before); Kitsilano 48/48 (48/48 before). No route that passed before fails.
Every Kitsilano city route's details change: the bend bays shift which parked cars traffic meets
and pulls out from across the whole map.

Checks: all 123 `scripts/test_*.mjs` pass under Node 22.23.4 within CI's 360 s limit; `scripts/build_jev_fixtures.mjs --check`
reports 0 stale fixtures. `test_cyclist_passing.mjs` counted the passes traffic starts in one seeded
three-minute drive, which had exactly one; with the bend bays that drive has none, and on the untouched
tree seeds 12/18, 13/19 and 21/7 give 0, 1 and 1 against 0, 1 and 1 now, so the check now sums two drives.
`render/roads.js` now draws its junction fills from `map/junctions.js` (the same polygons, in the same
order); the browser pages were not re-run here.

## Bare suite

`scripts/bench_node.mjs` with default features, against `20261110-190326-rules`: 12/12, every route
field for field identical (timings aside) except two, so `20261111-130222-rules` is the new reference:

- `s1-3`: 84.3 s to 84.6 s, 262 to 261 decisions, 516 m to 517 m. The bend bays: `parked_2602` stood
  0.3 m or more into the lane of curving `e422` ahead of traffic car `car_14`, which slowed for it.
  Restoring only the old `parking.js` restores the route exactly; keeping the slots but not placing their
  cars does not, so it is the car.
- `s1-9`: 139.0 s to 139.3 s, 431 to 438 decisions, off road 0.2 s to 0. The 0.2 s was a junction corner
  the renderer paves; it first changed with the junction-fill change and with nothing else.

Summary: off road 0.2 s to 0, decisions 5,167 to 5,173, average speed 23.78 to 23.77 km/h, RMS jerk
3.04 to 2.97, max lateral acceleration 5.29 to 5.25.

## Open

The smoke suite passes, so ROADMAP 1.8's smoke-suite part is done. The 1.6 soak's sample (city,
Kitsilano, Toronto, Calgary and Victoria, seeds 1–3, two routes each,
`scripts/soak.mjs --port 8393 --mode city --maps kitsilano,toronto,calgary,victoria --seeds 1,2,3 --count 2`)
was re-run on the final tree for the record, without further fixes ([JSON](other-maps-soak-2026-11-11.json)):

| Configuration | 10 November | Now |
| --- | --- | --- |
| Toronto seed 1 | `s1-1` 3 deadlock recoveries; `s1-2` stuck, off road (the Spadina corner) | clean |
| Victoria seed 1 | `s1-2` failure to yield, pothole hit | clean |
| Calgary seed 2 | `s2-1` timeout; `s2-2` failure to yield, prohibited turn | `s2-1` timeout and failure to yield (11 Avenue SW, behind `car_33`); `s2-2` prohibited turn only (`e561` to `e560` at 15.7 s) |
| Kitsilano seed 3 | `s3-1` 3 deadlock recoveries (Arbutus Street, 12 s) | the same |
| Toronto seed 2 | `s2-1` timeout (Harbord Street); `s2-2` stuck, 322 recoveries (Sussex Avenue) | `s2-1` arrives, but an at-fault collision at 341 s (below); `s2-2` stuck, 516 recoveries (Sussex Avenue) |
| Victoria seed 2 | `s2-1` failure to yield (ambulance); `s2-2` stuck (Menzies Street) | the same |

Still open (ROADMAP 1.8):

- **Toronto seed 2 `s2-1`, Bloor Street West, 341 s.** Traffic car `car_36`, in the left lane on a
  bend, swings right across into the right lane while the car passes it at 8 m/s; the audit gives the
  fault to the car because it was moving. The traffic car's move, not the driven car's, is the defect:
  ordinary traffic changing lanes or turning into an occupied lane.
- **Stuck routes**: Toronto seed 2 `s2-2` (Sussex Avenue, school bus, fire truck and parked cars),
  Victoria seed 2 `s2-2` (Menzies Street), Calgary seed 2 `s2-1` (11 Avenue SW, nose to nose with
  `car_33`), Kitsilano seed 3 `s3-1` (recovers and arrives). Not investigated in this pass.
- **Emergency yields**: Victoria seed 2 `s2-1` (Blanshard Street) and Calgary seed 2 `s2-1`.
- **Calgary seed 2 `s2-2`**: a prohibited turn from `e561` to `e560`, 15.7 s in.
- **The van stand-off** in cover row 4 and the **night emergency yields** from the soak were not re-run.
