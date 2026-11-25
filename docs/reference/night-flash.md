# Overnight flashing signals

The [feature registry](../feature-interface.md) record in `sim/features/night-flash.js`
registers `World.nightFlash` and uses the signal policy in `sim/night-flash.js`.
Free drives enable it unless
`?nightflash=0` and in the `after-midnight` challenge (Halifax, Morris at Barrington, seed 39042).
It requires a clock: 23:00 <= hour or hour < 05:00. Selection draws no randomness and uses the
pack's existing `roadRank`: primary/secondary and links = 3, tertiary and links = 2, others = 1.
Every approach in one phase group must rank strictly above every approach in the other. Equal
or overlapping ranks retain normal timing. This is a documented simulator policy, not municipal
signal-program data. Disabled worlds do not select sites or consume random draws.

Main-street `flashing_amber` supplies a 20 km/h caution ceiling (a simulation target, not a
statutory speed limit): at 5.56 m/s it gives time to observe a junction and stop within a short
visible distance. Grip and the existing safe-speed controller can require slower travel. Vehicles
yield to pedestrians and vehicles already crossing. Side-street `flashing_red` becomes an
approach-specific two-way stop through `controlAt`, `StopMemory` and `priority.js`; a stop on
another approach does not count. The all-way arrival queue is not involved. Sensing reports the
flashing state, suppresses countdowns, and shares stops, priority and caution with Rules, cautious,
Jev and LLM drivers. An unseen signal remains unknown. The audit sets `World.nightFlashSeen` when
met, counts missed red stops in `stop_signs_run`, and priority violations in `failed_to_yield`.
No new metric keys appear in disabled benchmark results.

Outages override flashing. Flashing overrides advance greens and scramble timing; there is no
right-on-red question. Pedestrian heads are dark and pedestrians use gaps. Signal lamps blink
at 1 Hz with a 50% duty cycle. Like `setScrambles`, `setNightFlash` selects module state for the
current world; constructor and checkpoint restore reconnect it. `scripts/test_night_flash.mjs`
is included by the CI Node-check glob.

Legal basis: [BC Motor Vehicle Act s. 131(1)(a), (3)(a)](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96318_05#section131).
Flashing red requires stopping before the near crosswalk (or intersection if none), then waiting
until safe. Flashing yellow allows entry only with caution and requires yielding to pedestrians
in the junction or adjacent crosswalk. The simulator additionally holds amber traffic for vehicles
already crossing; its 20 km/h target is a conservative implementation choice.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Overnight flashing signals are opt-in.** `World` option `nightFlash` (free drives, unless `?nightflash=0`; challenges with `nightFlash: true`) selects strictly separated road-class groups deterministically from the pack (`sim/night-flash.js`), from 23:00 inclusive to 05:00 exclusive on `world.clock.hour`. No clock means no flashing. Main-street amber has a 20 km/h caution ceiling and yields to people and traffic already in the junction; side-street red reuses a two-way stop, never the all-way queue. Outages take precedence; flashing suppresses advance greens, scrambles and right-on-red. Signals use module state (`setNightFlash`), reset by each World and replay restore. The audit counts missed red stops as `stop_signs_run` and priority violations as `failed_to_yield`, only on encountering flashing operation (`World.nightFlashSeen`). With it off no selection, random draw or existing benchmark/challenge behavior changes; keep it that way.
