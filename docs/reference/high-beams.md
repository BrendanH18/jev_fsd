# High beams (`sim/high-beams.js`)

`World.highBeams` is opt-in (free drives unless `?highbeams=0`, Lab with
`highBeams: true`). No policy, audit or random draws run when disabled. Every
beam decision is actuation, independent of the chosen manoeuvre. Rules and the
cautious agent select high only on dark, unlit streets without fog or snow, with
no oncoming vehicle within 150 m or leader within 60 m. Sensing adds 25 m of
reaction margin to those bumper-to-bumper distances. Vehicle lamps are detected up to 220 m
with building occlusion, independently of the short unlit-object sight range.
`headlights` is included in decision state, optional model answers, and compact
traces; absent or invalid beam answers fall back to Rules. Trace folding includes
the beam choice. In clear darkness high beams extend forward object visibility
from 45 m to 80 m, with the existing sensor query and weather limits still applying.
Street illumination uses the same deterministic lamp placements as rendering.
The authored challenge disables those lamps without changing their solid poles.
NPC dipping and brief flashes are render-only. The HUD indicator is blue.

The audit accumulates `glare_seconds` for high beams inside either dip distance,
or in fog/snow. Metrics appear only after `World.highBeamsSeen` (enabled at night),
and more than 0.8 seconds fails a drive. Coaching deducts five safety points per
second. Tests: `scripts/test_high_beams.mjs`, picked up by CI's Node-check glob.

Ontario's [HTA s.168](https://www.ontario.ca/laws/statute/90h08) and
[MTO handbook](https://www.ontario.ca/document/official-mto-drivers-handbook/getting-ready-drive)
specify 150 m oncoming and 60 m following (except overtaking).
BC's [MVA Regulations s.4.06(5)](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/26_58_01#section4.06)
actually prohibits upper beams within 150 m of another motor vehicle, except
once overtaken and passed; it does **not** state Ontario's 60 m following rule.
The simulator uses the requested Ontario 150/60 m policy on all maps rather than
claiming province-specific legal compliance. The
[MTO bad-weather guidance](https://www.ontario.ca/document/official-mto-drivers-handbook/driving-night-and-bad-weather)
recommends low beams in fog because reflected light reduces visibility. The
[MTO bus handbook](https://www.ontario.ca/document/print/book/150319)
also explicitly recommends low beams in snow to avoid reflection from ice particles.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **High beams are opt-in.** `World` option `highBeams` (free drives unless `?highbeams=0`; challenges with `highBeams: true`) adds beam actuation every decision cycle, `headlights` sensing and model answers, and longer forward sight on dark unlit streets (`sim/high-beams.js`). Rules and the cautious agent dip for oncoming traffic within 150 m, following within 60 m, fog, snow and lit streets; sensing includes a reaction margin. NPC dipping and flashes are render-only. The audit’s `glare_seconds` reaches metrics and fails above 0.8 s only after night driving with the feature on (`World.highBeamsSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and other challenges play out and report exactly as before; keep it that way. Compact trace folding must compare beam choices.
