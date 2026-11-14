# Ontario pedestrian crossovers

`sim/pxo.js` implements the whole-roadway clearance rule at Ontario PXOs. [Ontario’s guidance](https://www.ontario.ca/page/driving-near-pedestrian-crossovers-and-school-crossings)
requires drivers to stay stopped until pedestrians are safely on the sidewalk across the roadway.
A flashing amber beacon is a warning, not a traffic signal or permission to proceed.

`jev/osm/crossings.py` v2 adds `pxo` and `beacons` to the crossings sidecar, leaving the v6 street
pack alone. `load_crossings` and `build_crossings` accept cached v1 layers; only Toronto and Ottawa
need v2 files. Rebuild with `uv run scripts/fetch_map.py ottawa --crossings` (add `--force` to
refetch raw OSM). The Ontario gate uses map-centre bounds around the two bundled neighbourhoods,
like the geographic Montréal right-on-red gate; it is deliberately not a province-wide boundary.
Identification requires a marked, non-signalled crossing plus `crossing_ref=pxo` or `pxo:*`;
a fallback requires `crossing:signed=yes`, `crossing:signals=no` and `flashing_lights=button|yes|always`.
`crossing=uncontrolled` alone never qualifies. All three bundled cases have explicit references:
Toronto Harbord Street node 67344971 (`pxo:Type_A`), Ottawa Somerset Street West node 5606060531,
and Ottawa Metcalfe Street node 2317854682 (`pxo`, both attributed in OSM to City of Ottawa).
Their button-operated flashing-light tags are retained as `beacons`. PXOs are kept near junctions
and edge ends, where the old mid-block filter discarded them. No raw OSM or street pack is committed.

`MapData.pxos` is separate from `map.crosswalks`; only `World({pxo:true})` on these Ontario maps adds
them to the crowd’s marked crossings. Off means identical crossing geometry and random draws.
Nearby junction pedestrian legs align to the mapped PXO only while enabled, so free-drive walkers
use its real location and whole-roadway clearance rule too. NPCs use the shared `crosswalkConflict` whole-road occupancy branch; sensing reports `pxo` and
reuses pedestrian stop candidates. Rules and cautious hold at the line, and Jev/LLM wording explicitly
requires every pedestrian to reach the far curb. Occupancy uses the complete asphalt cross-section,
including parking lanes, with 0.3 m for the pedestrian’s body. The audit counts each forward crossing
of the hold line (2 m short of the centre) while occupied, in either travel direction, once per passage.
`pxo_early_goes` fails the drive and costs safety points; metrics/report fields appear only once a
nearby PXO is used (`pxoSeen`). Replay checkpoints retain the line history and occupancy mode.
Rendering places X/STOP FOR PEDESTRIANS signs and flashing amber roadside beacons; the visual is a
simplified assembly, not a reconstruction of each site’s overhead hardware. Buttons are implicit
when people enter; there is no separate button animation or beacon clearance timer.

The challenge **Wait for the far curb** (`pxo-far-curb`, Ottawa, Metcalfe Street) uses node 2317854682.
The car takes the inner lane of this one-way street. A slow pedestrian crosses from its far/left
sidewalk: that lane clears early while the rest of the roadway remains occupied. Both Rules and
cautious complete it without leaving early. `scripts/test_pxo.mjs` checks identification, off-mode
preservation, occupancy after lane clearance, sensing/prompt wording, the audit and both drivers;
`tests/test_pxo.py` checks tags and layer migration. Unlabelled crossings, two-stage refuges and
PXOs elsewhere in Ontario are not inferred from geography alone.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Ontario pedestrian crossovers are opt-in.** `World` option `pxo` (free drives, unless `?pxo=0`; challenges with `pxo: true`) enables the Ontario maps’ separately stored `map.pxos` from the crossings v2 sidecar. `sim/pxo.js` holds traffic and the driven car until every pedestrian clears the whole roadway, including the far curb. PXOs are added to the crowd only while enabled, so with it off no crossing geometry, random stream or existing challenge changes. The audit’s `pxo_early_goes` reaches the metrics and fails a drive only once a nearby PXO has been occupied (`World.pxoSeen`); keep it that way. Legacy crossings v1 sidecars remain readable; never bump the street pack for a crossing-layer change.
