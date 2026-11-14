# OpenStreetMap turn restrictions

`jev/osm/restrictions.py` builds `<key>.restrictions.v1.json` beside unchanged packs.
`uv run scripts/fetch_map.py <preset> --restrictions` refetches raw OSM and rebuilds only
this layer. All twelve presets have layers; raw XML is cache data, excluded from this change.
The Overpass fallback includes `type=restriction` relations, and the XML parser retains them.
Because committed packs omit OSM way IDs, relation ways are matched through both endpoint
node IDs. Relations outside the retained street graph do not produce edge pairs.

Supported kinds: no left/right/U-turn/straight and only left/right/straight. Records contain
`from`, `to` successor IDs, `kind`, source relation ID, and optional `condition` with local
minute bounds and weekdays (Monday=0). Motorcar tags override motor_vehicle and generic tags;
`except=motorcar|motor_vehicle|vehicle` exempts the car, while bicycle/bus exemptions do not.
Supported conditions are an optional weekday or weekday range followed by HH:MM-HH:MM,
including overnight intervals; semicolon-separated conditional clauses are supported. Supported conditional clauses override the base restriction while active, including `none` exemptions.
Via-way relations and unsupported conditions (holidays, dates, sunrise, comma lists) are
explicitly recorded in `skipped`. Unsupported clauses are never treated as permanent bans.
Distinct parallel ways sharing both endpoint IDs cannot be distinguished by these packs.

`World.restrictions` is false by default. Free drives enable it unless `?restrictions=0`.
Route calls send `restrictions: true`, `hour`, `weekday`; Python and demo routing filter
successors only with that flag. Conditions are evaluated at request time, not predicted
arrival time. The app uses WorldClock weekdays (`?weekday=0` Monday, through 6 Sunday,
default Monday) and advances days at midnight. NPC random successor choices exclude banned
turns without drawing extra randomness; ordinary traffic also replaces preplanned turns
when a condition activates more than 12 m before the junction. Fixed transit routes remain
authored transit paths. Cyclists are exempt from these motorcar restrictions.

Sensing reports `turn_restriction` for the next restricted approach within 100 m, with
`kinds`, `in_effect`, `banned`, and distance. If the route becomes illegal, target speed
brakes short of the junction, Rules and cautious stop, and Autopilot requests a legal route.
Jev state and the LLM prompt expose the same rule. Signs are render-only white squares with
black arrows and a red slash for prohibitions (only-turn signs omit the slash). Conditional
schedule text is not drawn on these simple signs.

The audit follows actual lane transitions, independently of navigation, and records
`illegal_turns`; `World.restrictionsSeen` gates metrics and legality coaching. A prohibited
turn fails a drive and costs 25 legality points. Disabled worlds add no metrics or sensing
fields and consume no additional random numbers.

Challenge `no-left-turn`, “No left turn”, Toronto / Bathurst Street, uses OSM relation
124176 on approach e192. The direct shortest route makes its forbidden left; the challenge
routes around it on real streets. Focused checks: `scripts/test_turn_restrictions.mjs` and
`tests/test_restrictions.py`. Existing challenges and benchmark retain restrictions off.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Turn restrictions are opt-in.** `World` option `restrictions` (free drives, unless `?restrictions=0`; challenges with `restrictions: true`) applies the OSM via-node turn restrictions layer to route requests and NPC successor choices (`sim/turn-restrictions.js`). Conditional signs use local `world.clock.hour` and `weekday` (Monday=0, the default); the app clock advances the weekday at midnight. Sensing reports `turn_restriction`; the audit’s `illegal_turns` reaches metrics and fails a drive only once a restriction has applied (`World.restrictionsSeen`), so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
