# Roundabout challenge and red-turn signs

**Find your gap** (`roundabout-gap`, seed 42042) uses Halifax's North Park roundabout:
Cunard Street approach `e300`, circulating along the ring, then the third exit onto North Park Street (`e358`). Three cars already in the ring use ordinary NPC paths and
vehicle physics. The car waits outside the ring for a gap, then follows its planned exit.
The challenge changes no shared map state; fleet and driver state survive normal replay
checkpoints. Circulating NPCs keep priority over waiting entries; the generic junction-box
yield check excludes ring edges, while following and collision checks still apply.
`scripts/test_roundabout_challenge.mjs` checks yielding, the exit, both local
drivers and deterministic replay.

**Wait for green** (`wait-for-green`, seed 43042) turns right from Harbord Street `e355`
onto Spadina Avenue `e179` in Toronto, at the real sign in
[OSM relation 3726713](https://www.openstreetmap.org/relation/3726713).
The cross street is empty; the car must hold at red and make the same turn on green.
Its start time selects a long red interval without changing the shared signal plan.

`World.redTurnSigns` defaults off. Free drives enable it unless `?redturnsigns=0`;
only Wait for green enables it among the challenges. `MapData.redTurns` loads the
optional `red_turns` array in the existing restrictions v1 sidecar. The seven mapped
Toronto records were rebuilt for this change; its 21 ordinary restrictions are unchanged.
Other cities' layers remain unchanged. There is no pack version bump or new layer loader.

`jev/osm/restrictions.py` supports the two relation forms documented by
[OpenStreetMap](https://wiki.openstreetmap.org/wiki/No_turn_on_red):
`type=restriction` with `restriction=no_right_turn_on_red` or `no_left_turn_on_red`, and
`type=restriction:on_red` with `restriction:on_red=no_right_turn` or `no_left_turn`.
Motorcar exemptions and precedence, simple weekday/time conditions, overnight intervals,
and conditional `none` use the existing restriction parser. Via-way and unsupported
conditional syntax are reported in `skipped`; node-based tag alternatives are not inferred.
Rebuild a city's sidecar with `uv run scripts/fetch_map.py <preset> --restrictions`.

Red-only bans stay out of ordinary `restrictions`, so Python and browser routes can still
use the turn. The shared `sim/red-turn-signs.js` policy prevents both right- and left-on-red
exceptions for the ego and NPCs. Sensing reports `intersection.no_turn_on_red`; Jev and LLM
situation text explains why an empty cross street is insufficient. The renderer adds an
ON RED plate to the prohibited-turn sign, with schedule text for supported timed signs.
The audit uses the exit actually driven, even without a route, and captures the signs in
effect at entry so a schedule changing during the turn cannot alter the verdict. Violations
reuse `red_lights_run`, replay markers and legality coaching; no metric key is added.
Focused coverage: `tests/test_restrictions.py`, `scripts/test_red_turn_signs.mjs`, and
`data/snapshots/no_turn_on_red.json` for live Jev verification.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Red-turn signs are opt-in.** `World` option `redTurnSigns` (free drives unless `?redturnsigns=0`; challenges with `redTurnSigns: true`) applies the restrictions sidecar's separate `red_turns` list (`sim/red-turn-signs.js`). These bans prohibit a turn only on red; never feed them into ordinary routing restrictions. Sensing, NPCs, left-on-red eligibility and the actual-exit red-light audit share this policy. The audit captures active bans at line crossing, so a schedule changing mid-turn cannot change the verdict. No new metric is added. Only Toronto's sidecar currently contains mapped signs. With it off, existing challenges and benchmarks retain their previous red-turn behavior.
