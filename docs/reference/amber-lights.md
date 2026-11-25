# Amber-light decisions

The [feature registry](../feature-interface.md) record in `sim/features/amber.js` owns the
option, decision hooks and auditing. `sim/amber.js` provides `amberStoppingDistance` and `observeAmber` for opt-in
`World.amberLights`. Free drives enable it unless `?amberlights=0`; only the paired
**Room to stop** and **Keep going safely** challenges enable it in the lab. Other challenges
and seeded benchmarks retain their existing amber handling and metric keys.

A safe stop needs 0.5 m plus speed times the 0.4 s decision allowance and the vehicle's
actuator lag, plus speed squared divided by twice `comfort().decel`. This is a conservative
simulator model, not a statutory stopping distance. `ego.amberChoices` latches the decision
per physical approach and displayed signal phase when the lamp first becomes visible. Invalid
position, speed or clock samples leave any latched decision in place.
The stop branch uses a response-aware braking profile through amber and the following red;
the clear branch caps speed at observation speed until the rear clears the crossing street,
including when red follows the legal entry. A car whose bumper has already crossed
the line clears the junction when red follows. Pedestrians, oncoming vehicles, blocked exits
and other obstructions still take priority, and a new entry on red is still a violation.

Sensing exposes `intersection.amber`; Jev/LLM state includes the stop choice, onset speed,
onset distance and calculated stopping distance. Ordinary traffic shares the policy.
The independent line-crossing audit counts ignoring an available safe stop, or accelerating
more than 0.5 m/s above the observation speed before crossing on amber, as
`amber_lights_run`. `World.amberLightsSeen` gates metrics. Each violation fails a drive,
costs 25 road-rules points and caps the total score at 69, with a replay marker and coaching.
Vehicle state carries the latched decisions through normal replay checkpoints.

The paired lessons use Kitsilano's West 4th Avenue at Maple Street (`e163` → `e165`),
with the real signal plan unmodified. Their dry defaults start at 36 km/h, one second before
amber, with 65 m or 23 m to the line. The snow stop test starts at 7.2 km/h and 23 m so the
amber remains visible within snow's shorter sight range. Focused checks:
`scripts/test_amber_policy.mjs`, `scripts/test_amber_challenges.mjs`, and live model cases
`data/snapshots/amber_stop.json` / `amber_clear.json`.

Legal basis: [BC Motor Vehicle Act s.128(1)(a)](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96318_05#section128).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Amber-light decisions are opt-in.** `World` option `amberLights` (free drives unless `?amberlights=0`; paired challenges with `amberLights: true`) shares the first-visible-amber stop decision between sensing, candidates, local drivers, NPCs and the line-crossing audit (`sim/amber.js`). Stopping distance includes reaction, actuator lag and grip; the decision is latched per physical approach and signal phase on the vehicle, so checkpoints preserve it. Clearing speed is capped at the observation speed; pedestrians, traffic and blocked exits still take priority. An entry on red remains prohibited, while a car already across the line clears the junction. `amber_lights_run` reaches metrics only after an observed amber (`World.amberLightsSeen`). With the feature off, previous challenges and benchmark behavior and metric shapes remain unchanged.
