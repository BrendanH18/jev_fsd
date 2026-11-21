# Open-track flagged choices and their exposure

The two 20 November open-track tapes contain 224 flagged choices. Every flagged drive replayed
exactly on the published tree, `a616469`, with Node 22.23.4 and the authored lockstep clock. The
replays consumed all 10,182 recorded replies across those 42 drive instances. Each full comparable
result hash matched, and the measured flags matched the published counts on each drive and check.
The 82 drive instances with zero recorded flags were outside this replay sample. [Published model results](../model-results.md)

## Duration and clearance

Duration counts the 60 Hz physics ticks that began with the chosen plan still active. Re-selecting
the same manoeuvre started a new choice. Every exposure ended at a later decision, with no hard
emergency-brake ticks during any flagged choice. The brake’s hold-only branch has no distinct tick
marker in the replay observer.

Clearance is the closest signed distance from the projected front bumper to the stop, yield or
hold line in the decision snapshot, sampled before and after each active tick. For moving actors,
the measurement keeps that decision-time line fixed. Negative values mean the front went beyond
the nominal line. The simulator evaluates each rule using its own tolerance and traffic state.
[Candidate checks](../../static/js/brain/candidates.js)

| Driver | Flagged drives | Measured choices | 15 ticks (250 ms) | 16 ticks (267 ms) | Total time | Line measured | Closest line | At or past line |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Jev | 5 | 8/8 | 4 | 4 | 2.067 s | 7/8 | 2.75 m | 0 |
| Claude Haiku 5.5 | 37 | 216/216 | 96 | 120 | 56.000 s | 210/216 | −1.36 m | 4 |

| Check | Jev choices | Haiku choices | Line measurements | Closest line |
|---|---:|---:|---:|---:|
| `runs_stop` | 0 | 68 | 68 | 5.42 m |
| `runs_red` | 0 | 39 | 39 | 5.33 m |
| `no_room_to_go_round` | 0 | 18 | 18 | −0.02 m |
| `fails_to_yield_to_oncoming` | 5 | 15 | 20 | 1.01 m |
| `fails_to_yield_to_pedestrian` | 0 | 11 | 11 | 7.46 m |
| `passes_stopped_school_bus` | 0 | 11 | 11 | −1.36 m |
| `drives_into_geese` | 0 | 9 | 9 | 1.79 m |
| `runs_flagger_stop` | 0 | 8 | 8 | 0.38 m |
| `passes_streetcar_doors` | 0 | 6 | 6 | 4.79 m |
| `blocks_parking_car` | 1 | 5 | 6 | 1.53 m |
| `fails_to_yield` | 0 | 5 | 5 | 1.84 m |
| `fails_to_yield_to_cyclist` | 0 | 5 | 5 | 2.09 m |
| `enters_unseen_junction` | 1 | 3 | 4 | 2.75 m |
| `passes_cyclist_too_close` | 0 | 4 | 0 | — |
| `passes_car_stopped_at_crosswalk` | 0 | 2 | 2 | 4.74 m |
| `blocks_junction` | 0 | 2 | 2 | 3.43 m |
| `fails_to_yield_to_contraflow_cyclist` | 0 | 2 | 2 | 1.11 m |
| `passes_reversing_vehicle_too_close` | 0 | 2 | 0 | — |
| `crosses_in_front_of_train` | 0 | 1 | 1 | 4.20 m |
| `visibility_stopping_distance` | 1 | 0 | 0 | — |

The seven unmeasured clearances cover visibility speed, lateral room beside cyclists and a
reversing-vehicle check that combines a hold line with moving body clearance. All seven decisions
have duration measurements. Every measured line stayed on the same route throughout its exposure.

Haiku’s four nominal crossings were two flags in `school-bus` at 0.71 m and 1.36 m past the
snapshot stop position, plus one each in `double-parked` and `collection` at about 0.02 m past the
hold position. All four were within the candidate checks’ 1.5 m allowance beyond those positions.
The 107 signal and stop-sign flags all ended over 5 m short. The eight consecutive `flagger`
flags held the approach for 2.067 s in total. The car subsequently overshot the line while braking
under a new choice and timed out while waiting at STOP. [Flagger replay evidence](haiku-two-losses-2026-11-21.md)

All five Jev drives passed. Haiku passed 36 of 37, with the `flagger` timeout as its one loss.
Across the sample the audit recorded zero red-light violations, stop-sign violations, collisions,
brake checks and failures to yield. It recorded one hard emergency-brake intervention on Jev’s
flagged drives and five on Haiku’s, all outside flagged exposure.

## Scoring recommendation

Keep the score based on audited outcomes and report flagged choices separately, with the number
of decisions, duration and clearance where measured. Across the complete published tapes Jev made
0.66 flagged choices per 1,000 decisions and Haiku made 17.9. The flags distinguish their choices
even where the outcomes agree. Counting each flag as a score penalty would give repeated selections
of the same approach multiple penalties and treat a distant prediction like an actual violation.
These measurements describe one published run per driver.
