# Map evidence for Phase 6

Use this list with the [provincial coverage review](provincial-rules.md) and the
[Phase 6 admission rule](../../ROADMAP.md#admission-rule-for-new-scenarios). Each row identifies
the evidence a map or rule proposal would need and a control case for evaluating it. Record the
current source of the rule and the OSM element IDs at the time of proposal.

| Gap | Evidence to collect before selecting a site | Control case |
|---|---|---|
| BC pedestrian-controlled flashing green | Approach-specific signal heads, the minor approaches' controls and the public authority's documentation for the crossing. | A steady green and an Ontario or Québec advance-green movement with similar approach geometry. |
| BC two-way to one-way left on red | A complete directed junction showing a two-way approach, a one-way departure, signs and pedestrian paths. | A one-way to one-way movement and a signed turn prohibition. |
| Multi-lane roundabout | Lane connections on each entry, through the ring and at each exit, with the approach markings and posted instructions. | Halifax North Park's single-lane ring and an exit requiring a different entry lane. |
| Bicycle signals and advance stop boxes | Signal heads by mode, markings and a crossing where a bicycle and a motor vehicle could use the same space in different phases. | A reserved bike lane where both road users receive an ordinary green. |
| Transit-only advance signals | The transit head's permitted movement and a nearby general-traffic approach held by a separate head. | The same lane when general traffic has an ordinary green. |
| U-turns at signalized junctions | Local authority and signs tied to one feasible opposite-direction movement, with enough geometry to distinguish a U-turn from a left turn. | The simulator's existing dead-end U-turn exercise. |
| Ontario pedestrian crossovers beyond the reviewed boxes | A verified crossover class, its markings and beacon type, and the full crossing across all lanes. | A nearby ordinary marked crossing with similar geometry. |
| Local school-zone schedules | Posted boundaries and time windows, plus the school calendar or beacon schedule when either affects the posted rule. | The same street during inactive hours and a playground zone with independent hours. |
| Regional move-over policy | The eligible stopped vehicles, relevant speed thresholds and a segment with a usable adjacent lane. | The same roadside vehicle when a lane change is blocked and when the special rule is inactive. |
| Regional high-beam thresholds | Documented oncoming and following distances and an unlit approach long enough to observe both. | A vehicle at the opposite side of each threshold and a lit road. |
| Regional transit bus pull-out policy | Posted road speed, stop layout, bus eligibility and whether entering the through lane triggers the local rule. | A bus already in the travel lane, plus a bay where the same rule can be evaluated. |
| Regional cyclist passing clearance | The local rule tied to a segment's posted speed and its available lateral room. | An approach suitable for passing and an otherwise similar approach with oncoming traffic. |
| Regional snow plow passing | Plow configuration, roadway width and applicable local guidance, including where the blade or a second plow occupies an adjacent lane. | A single plow with clear sight and room on the permitted side. |
| Median-separated school bus stops | Motor-vehicle rule for the specific separation and an extract with independently mapped carriageways and a plausible stop. | Opposite-direction traffic on a single undivided approach. |
| Overnight flashing schedules | A municipal schedule showing when the same intersection changes from normal operation to flashing, and the display on each approach. | The same intersection shortly before the schedule begins. |
| Atlantic historic street layout | A connected candidate extract with an acute junction and constrained width that exercise a judgment absent from existing city routes. | A similarly sized conventional intersection in a bundled map. |
| Northern seasonal visibility | A candidate route with confirmed lighting and geometry, together with a reproducible date and local time for low winter sun or darkness. | The same route and seed at a date with a different daylight window. |

For each shortlisted site, save the bounds, raw extract date and source, cited authority, primary and
control movements, and the test that would distinguish the driver's decisions on the open track.
Use the existing map keys and road controls as evidence for the control cases. Use a staging
directory for any prepared candidate files.

## Inspect staged map files offline

```sh
uv run --locked scripts/fetch_map.py --audit --all
uv run --locked scripts/fetch_map.py kitsilano --audit --crossings --json
uv run --locked scripts/fetch_map.py kitsilano --audit --maps-dir staged-maps --against data/maps
```

The audit reads prepared JSON and reports file names, record counts and field paths for problems.
JSON reports also include byte sizes, SHA-256 digests, and the selected version of a sidecar. A present
older crossing file is audited even when v2 takes precedence. Some extracts omit rail entirely.
Use `--require-rail` when a proposal specifically depends on a prepared rail layer. Exit 1 means a
file failed validation, a required file was missing or an artifact differed from the reference.
