# Red-light runners

`sim/red-light-runner.js` is opt-in through `World.redRunners` (`createRunners`): free drives
enable it unless `?redrunners=0`; only the **Fresh green** challenge enables it in the lab. With it
off, `random` is null, no vehicle gets a `runner` or `runDrawn`, and no metric key is added.

**Runners.** `runsLight`, called from the NPC signal check, draws once per approach from the
feature's own stream when an ordinary car first sees amber, could still stop (the existing
`canStop`, or the amber decision with `amberLights`), goes at least 6 m/s, and would reach its line
between 1 s before and 2.5 s after its light turns red. With `RUNNER_CHANCE` (12%) it commits
(`commitRunner`, which `World.redRunnersSeen` notes within 120 m of the car); no other car commits
for 30 s. A runner skips the red/amber stop, and `runnerCap` holds its speed at the commitment
speed until its rear clears the junction, marking `runner.entered` at the line. It never commits
while someone is in the junction box, gives up while it can still stop if someone gets there
first (or if it slows below 2 m/s short of the line), and keeps every leader, crosswalk and box
check. The challenge commits its runner directly. Checkpoints carry the commitment on the vehicle
and the stream in `world.redRunners`.

**The test.** `runnerThreat(world, observer, inter, heading, others)` returns the nearest vehicle
crossing the observer's way (30 to 150 degrees off its heading, above 2.5 m/s) that is on a red
or amber approach to the same signal and cannot stop before its line (`canStopAt`: the
`amberStoppingDistance`, unless it is already braking hard enough), or that has entered the
junction on one (past its line on its approach, or a committed runner with `entered`). Traffic on
a green waits at the line for one (`runnerHold`) when within 40 m and able to stop.

**The driven car.** Sensing adds `red_light_runner` (id, `relation` `cannot_stop`/`in_junction`,
`from` left/right, speed, `to_line_m`, `wait`, `stop_s_route`, `bumper_to_stop_m`, `green_for_s`)
while its own light is green and it has not entered, from the vehicles it can see; `wait` holds
while it can still stop at the line, braking hard if it must. The target speed stops at the line,
`wait_for_runner` stops there, and any other candidate whose front crosses the line is rejected
as `enters_ahead_of_red_light_runner` (hard braking excepted). Rules and the cautious agent wait,
and the deadlock detector counts the wait as legitimate. Jev/LLM state carries
`red_light_runner`; the situation clause and the motion criteria say to hold at the line until it
has gone through even though the light is green.

**Audit.** `auditRunner` watches the car's approach to a green signal within 40 m. Once a visible
runner threat has existed while the car could still stop, entering the junction while one remains
counts as `fresh_green_conflicts` (event `fresh_green_conflict`, replay marker, coaching tip,
25 safety points and a 69 cap). Metrics report the key only once `World.redRunnersSeen`.

The challenge uses Edmonton's 106 Street NW (`e220` to `e367`) at Whyte Avenue NW (`sig3`), the
runner on `e309` to `e316`. Focused checks: `scripts/test_red_light_runners.mjs`, and
`data/snapshots/fresh_green.json` for live Jev verification.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Red-light runners are opt-in.** `World` option `redRunners` (free drives unless `?redrunners=0`; challenges with `redRunners: true`) lets an ordinary traffic car that could stop for an amber commit, now and then, to running the late amber or fresh red (`sim/red-light-runner.js`, its own random stream, drawn once per approach, at most one commitment every 30 s). A runner holds the speed it had, never commits into an occupied junction box, gives up while it can still stop if someone gets there first, and keeps every other leader, crosswalk and box check, so it never drives into anyone already in its path. `runnerThreat` is the one test, shared by sensing (`red_light_runner`), candidates (`wait_for_runner`, rejection `enters_ahead_of_red_light_runner`), Rules, the cautious agent, the model wording, traffic waiting on a green and the audit: a vehicle crossing the observer's way on a red or amber that cannot stop before its line (`sim/amber.js` stopping distance, unless visibly braking hard enough) or has entered the junction on one. The audit's `fresh_green_conflicts` (entering on green while one is in sight, after the car could have stopped for it) reaches the metrics, and fails a drive, only once a runner has committed within 120 m of the car (`World.redRunnersSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
