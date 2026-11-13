# Emergency-vehicle yields after the 12 November merges (ROADMAP 1.8)

Starting tree: `9b4d23d` (the five fix branches merged: Victoria s2, review follow-ups, Calgary s2, Toronto
s2, Kitsilano night). Node 22.23.4, Rules, lockstep, 40 traffic cars, `city` preset, against a server on port
8411, always the whole job (earlier drives in the process change later ones). Each failure was reproduced with
`--diagnostics 1`, then stepped in Node with the runner's `runScenario` to read the plan (`world.evYield`), the
snapshot's `emergency`, the candidates' rejections and the audit's call record (`world.evCalls`) around it. No
live model calls, no new dependencies.

## The six failures

| Job | Route | Where | What happened |
| --- | --- | --- | --- |
| Montréal seed 1 | `s1-2` 86.4 s | Avenue du Mont-Royal Est | Planned its stop short of the junction ahead by the summed edge lengths: the front came within the 8 m box round the node as the ambulance crossed. |
| Kitsilano cover row 9 | `s1-2` 79.9 s | West Broadway | Stopped at a red, 0.5 m short of the line: the plan said the car was in the junction and should clear it, 40 m on. |
| Victoria seed 3 | `s3-2` 112.9 s | Douglas Street | The same, at a red on Douglas Street. |
| Calgary seed 2 | `s2-2` 115.6 s | 8 Street SW | Rolling to a stop 0.26 m over a red's line: the same plan, and the audit did not take the line stop. |
| Mount Pleasant seed 1 | `s1-1` 106.7 s | East 6th Avenue | Crept 1.5 m past a stop sign's line to look: the same plan, through the stop sign. |
| Kitsilano seed 1 snow | `s1-4` 124.7 s | Larch Street | Queued behind `car_28` at a red; the queue moved up 1.6 m and stopped again; the forward sims had the oncoming ambulance drive into the car. |

## Root causes and fixes

| Root cause | Fix | Check |
| --- | --- | --- |
| **The junction loop in `emergencyYield` (brain/sensors.js) took a car at or just past its stop as already in the junction.** The stop short of a junction is `min(crossing street - 2.5 m, box - 0.5 m, line - 0.5 m)`; a car past it was "clearing" and planned a stop past the junction. A car stopped where Rules stops for a red is exactly 0.5 m short of the line (by rounding, just past it), one finishing a stop overshoots, one at a stop sign creeps to look, and where the line is within 2.5 m of the crossing street a car at its line is already past that stop. Every candidate through a red or a stop sign was rejected, so the car stood in its lane. Five of the six. | Past that stop but still out of the junction (the crossing street and the box), and able to stop within the 1.5 m a short stop overshoots, the car is short of the junction: it stops there. Not yet over its line, it stops at most 0.5 m short of it (moving over the line gives up the audit's line stop); over a signal's line, where it is; over a stop sign's line, using the room up to the junction and its look point to pull over. Moving off (over 0.5 m/s) through a light that is not red, it is on its way through and clears the junction as before. | `test_emergency_line_stop` |
| **The same loop placed each junction's node at `route.edgeStarts`**, the summed edge lengths, which run metres past the polyline after rounded corners (6.5 m at West Broadway on the cover row 9 route). The stop "8.5 m short of the node" was inside the box. Montréal. | Use `route.laneEdgeStarts()`, the node projected onto the polyline, and `laneEdgeAt`. `test_emergency_snowbank_stop` measured its expected stop from `edgeStarts`; it now measures from the node's place on the polyline (the stop it checks is 19.8 m down the new street, past the 18.5 m it requires). | `test_emergency_line_stop`, `test_emergency_snowbank_stop` |
| **The audit took a line stop at the call only from behind the line** (`toLine >= 0`, and an approach only while it could stop before the line), although it takes one that overshoots by up to 1.5 m after an approach (`lineOvershoot`). Calgary. | At the call, a car stopped up to 1.5 m over its line, or still able to stop within that, is stopped (or stopping) at it, as after an approach (`AUDIT_EV_OVERSHOOT_M`). | `test_emergency_line_stop` |
| **The forward sims predicted an oncoming ambulance in a straight line along its heading.** Still angled from its turn into the street, it went straight into a car at the kerb: every pull-over was rejected or braked off by `pathHazard`. One coming up behind was already left out, since it goes round what it cannot get past (`threadGap`) or stops. Kitsilano snow. | One coming the other way down the street (within 45° of opposite, ahead) is left out the same way. One crossing from a side street is still predicted. | `test_emergency_line_stop` |
| **The audit released a queue for good.** Queued at the call, the car is excused; when the queue moves, it has `AUDIT_EV_PULL_S` (4 s) to pull over. Here the queue moved 1.6 m to the red ahead and stopped again 3.5 s later, the car stopped behind it 0.16 m over, and holding still in the queue again was a failure to yield. Kitsilano snow. | Released, a car that moves up a car's length or less and stops queued again within that time is queued again. | `test_emergency_line_stop` |
| **The audit's hold-up check excused a queue only while the queue's front also blocked the vehicle** (`blockedInQueue`). Not one of the six: with the prediction fix, Kitsilano snow `s1-9` stops 0.3 m further on at 250 s (it no longer brakes hard for an oncoming fire truck that was never going to hit it) and its drive differs from then on. At 452.5 s the car stood in the queue behind `reversing_1_away` it was in at the call, parked cars at its right, and an oncoming fire truck that had squeezed past the queue's front was held up by the car alone for one step after 10 s of being held by both: a failure to yield. | Still standing in the queue captured at the call (`holdingQueue`, as the `unmoved` check already allows), the car is not counted as holding the vehicle up. A car that came up to the queue after the call still is. Audit only: no drive changes. | `test_emergency_line_stop` |

## Results

| Job | `9b4d23d` | Now |
| --- | --- | --- |
| Montréal seed 1, 2 routes | 1/2 | 2/2 |
| Mount Pleasant seed 1, 2 routes | 1/2 | 2/2 |
| Kitsilano seed 1 cover row 9, 2 routes | 1/2 | 2/2 |
| Calgary seed 2, 2 routes | 1/2 | 2/2 |
| Victoria seed 3, 2 routes | 1/2 | 2/2 |
| Kitsilano seed 1 snow | 10/12 (`s1-4` failure to yield, `s1-12` timeout) | 11/12 (`s1-12` timeout, unchanged at 921.8 s) |
| Kitsilano seed 1 dry | 12/12 | 12/12 |
| Kitsilano seed 1 fog | 12/12 | 12/12 |
| Kitsilano seed 1 rain | 11/12 (`s1-9` timeout at 597.4 s) | 12/12 |

No collisions, off-road time or deadlocks in any of them. The five two-route jobs and dry, fog and rain ran before the last
(audit-only) change; snow ran on the final tree. Routes that play out differently from `9b4d23d` (time or
decisions), all from emergency vehicles met on the way: dry `s1-9`; fog `s1-4`, `s1-5`, `s1-8`, `s1-12`;
rain `s1-3`, `s1-5`, `s1-6`, `s1-7`, `s1-9` (its timeout gone), `s1-12`; snow `s1-4`, `s1-9`.

Checks: `test_emergency_line_stop` (new; fails on `9b4d23d`, and its audit, prediction and queue parts each fail
without their own fix), every `test_emergency*.mjs`,
`test_model_recording` (the stub recording replays unchanged), `test_drive_lab` (331 checks), `test_free_drive`,
`test_replay`, `test_parkers` and `test_road_test` pass, one at a time; `scripts/build_jev_fixtures.mjs --check`
reports 0 stale fixtures.

## Bare suite

Kitsilano seed 1, no `--features`, run on `9b4d23d` first and again on this tree: 12/12 both, every route field
for field identical and the summary identical. Emergency vehicles are a `city` feature; every change here acts
only while one is on the road.

## Open

- Kitsilano snow `s1-12` times out (921.8 s) on `9b4d23d` and here alike: not an emergency yield, left to the
  agents on the other regressions.
- Mount Pleasant passes by pulling over in the 5.1 m between where it crept to and its look point. Its stop
  line is on the next street from where the rear axle is, so the audit's line-stop exception (which reads the
  rear axle's street) never sees it. A car crept past such a line with too little room to steer over would hold
  there and still be counted.
