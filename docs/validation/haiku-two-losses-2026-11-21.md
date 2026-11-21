# Claude Haiku’s two recorded losses

On 21 November 2026, both published drives replayed on `a616469`, the 20 November publication
tree, using Node 22.23.4 and the authored lockstep clock. The replay consumed every saved reply
and matched each full comparable result hash. An observer logged the reconstructed LLM requests,
applied decisions and simulator state as the replays ran. Times below are elapsed simulation seconds.

| Drive | Track | Replies matched | Result hash | Verdict |
|---|---|---:|---|---|
| `flagger` | Open | 691/691 | `a4599358446f908f` | Timeout at 180 s |
| `on-your-bumper` | Guarded | 318/318 | `b39d96ba25d9141b` | Arrived in 88.3 s with one brake check |

## Flagger in Ottawa

From the start the model saw `work_zone.flagger: STOP`, a closed lane and a stop line 65.3 m away.
The instructions called for approaching and stopping at the line, then waiting for SLOW. Haiku
repeated `drive` with `stop_for_flagger` through 8.733 s. For its last eight selections of that
approach, from 6.917 s and 16.2 m out, the offered `stop_for_flagger` still carried its stop-at-line
label and explicitly warned that its predicted path went past the STOP paddle. All eight choices
counted against `runs_flagger_stop`.

At 8.983 s the prompt showed 4.1 m/s with 0.5 m left. Haiku answered `stop` with
`stop_for_flagger`. The motion answer applied `hard_brake`. At 9.633 s the car came to rest with
its front 1.034 m past the line. The zone’s waiting check requires the front to be less than 1 m
past the line.
When the authored hold lifted at 13.583 s, the car was outside that window and the phase stayed
open to opposing traffic. Every model request through timeout still showed STOP, and the stationary
requests showed `wait_in_m: 0`. Haiku kept answering `stop` and the car held position. The audit
recorded zero stop-sign violations and the drive failed on time. [Work-zone phase and waiting logic](../../static/js/sim/work-zone.js)

## On your bumper in Winnipeg

Haiku chose `let_tailgater_pass` on all four occasions it was offered earlier in the drive. On the
red approach, at 32.550 s, it chose `drive` with `stop_at_line`, offered with a predicted peak
deceleration of 4.1 m/s². On the next request at 32.817 s, the prompt showed a red 17.7 m ahead,
ego speed 9.9 m/s, and a trailing headway of 0.71 s. It gave 2.8 m/s² as the braking need and
3.8 m/s² as the advised braking ceiling with the tailgater behind.

The guarded filter dropped `stop_at_line` for `runs_red`. The remaining options were
`keep_lane_stop` at a predicted peak of 6.9 m/s² and `hard_brake` at 7.0 m/s². The tailgater filter
allows the gentlest surviving manoeuvre even when it exceeds the usual ceiling. Haiku answered
`drive` with `keep_lane_stop` at 32.817 s and again at 33.083 s. Those replies contain the choices
alone. [Guarded candidate filtering](../../static/js/brain/candidates.js)

At 33.183 s the brake-check audit measured a 5.93 m/s² peak in its 0.25 s window against
2.80 m/s² needed for the red, with the follower about 0.80 s behind. That single audited event
failed the drive. The shared emergency brake, collisions, red-light violations and Rules fallbacks
all remained at zero. [Brake-check audit](../../static/js/sim/tailgaters.js)
