# Following distance (`sim/following.js`)

`World` option `followingDistance` is on in free drives unless `?followingdistance=0`,
and in the **Brakes ahead** and **Make room** challenges. Sensing, candidate predictions,
local drivers, ordinary motor traffic and coaching share `followingPolicy`. With the
option off, the previous following, scoring and benchmark behavior is preserved.

The target is 3 m standstill room plus the greater of a grip-scaled two-second headway
and the driven car's response/braking distance minus the leader's maximum-braking
stopping distance. Response reserves 0.4 seconds, the vehicle's acceleration lag and
its jerk-limited ramp into comfortable braking. The leader is assumed able to brake
immediately. `safe_speed_mps` combines the inverse stopping-distance calculation with
a gradual gap-recovery target. These are simulator margins, not a claim about legal
minimums or real-vehicle safety. At 10 m/s behind an equal-speed compact car with no
acceleration, targets are approximately 25 m dry, 35 m rain and 47 m snow.

Sensing exposes `following.policy`; model state exposes `target_gap_m`, `safe_speed_mps`
and `target_headway_s` beside the observed gap and speed. Predictions reject
`following_distance` when a candidate keeps or worsens a gap deficit while ending above
the safe speed. Braking and choices that recover room remain available; a completed pass
is no longer following that leader. Specialized plow, cyclist, emergency and junction
constraints remain in force. NPCs retain IDM and cap their desired speed by the shared
policy for real leaders, separately from virtual stop-line gaps.

Coaching measures physical gaps independently of the driver's observations, including
manual driving and gaps beyond the old 35 m query. A newly encountered close leader observed moving sideways into the car's path
gets five seconds to recover, once per leader per drive. The driver moving into a short
gap does not earn an allowance. The
checkpoint includes the allowance and encountered leader IDs. Sustained deficits after
the allowance contribute to `close_following_s`; actual and target gaps appear in the
coach and AI eyes. Reports identify `following_policy: grip-and-response-v1`, record
`following_recovery_s`, and retain existing collision and comfort scoring. A saved trace
marks the first full second of sustained short following and retains that decision's
observation. In-memory replay retains the regular checkpoints and their policy state.

Checks: `test_following_policy.mjs` exercises dry/rain/snow and maximum-braking physics;
`test_following_integration.mjs` covers sensing, both local drivers, candidate filtering,
manual coaching, bounded recovery and feature-off behavior;
`test_following_challenges.mjs` runs the real streets with Rules/cautious and checks
physical merging and checkpoint determinism. The integration script's optional
`--write-snapshots` generates the two live-model cases in `data/snapshots/`.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Following distance is opt-in.** `World` option `followingDistance` (free drives unless `?followingdistance=0`; the "Brakes ahead" and "Make room" challenges) shares grip/response-based gap targets and safe speeds through `sim/following.js`, sensing, predictions, local drivers, ordinary motor traffic and coaching. Keep special plow/cyclist/emergency gaps in force. Coaching grants five seconds of recovery when a newly encountered leader moves sideways into the car's path, once per leader per drive, and checkpoints preserve that state. With it off, no policy work or random draws occur and existing benchmark/challenge behavior and report shapes stay unchanged.
