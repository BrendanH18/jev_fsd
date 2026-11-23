# Provincial road rules coverage and gap analysis

Before adding another Canadian city or provincial rule under [Phase 6](../../ROADMAP.md#phase-6-grow-the-world-again),
this page records which provincial rules the twelve bundled neighbourhoods already model, which
depend on OpenStreetMap infrastructure in each extract, where one province's statute stands in for
all maps, and where genuine coverage gaps remain. Every new scenario or city must satisfy the
[Phase 6 admission rule](../../ROADMAP.md#admission-rule-for-new-scenarios).

## Bundled map coverage across Canada

The twelve bundled map packs (`jev/maps.py`, [Canadian city maps](../maps.md)) cover eleven cities
in **seven provinces** and leave **six provinces and territories** without a bundled neighbourhood.

| Province / territory | Status | Bundled map(s) | Notable regional rules / layouts exercised |
|---|---|---|---|
| British Columbia (BC) | Covered (3 maps) | Vancouver · Kitsilano (`kitsilano`), Vancouver · Mount Pleasant (`mount_pleasant`), Victoria · Old Town (`victoria`) | Left-arrow advance greens, 1-way→1-way left on red, scramble crossing (Victoria), bus-only lanes (Mount Pleasant, Victoria), bridges/black ice (Victoria, Kitsilano), BC Class 5-style road test |
| Alberta (AB) | Covered (2 maps) | Calgary · Beltline (`calgary`), Edmonton · Old Strathcona (`edmonton`) | Left-arrow advance greens, 1-way→1-way left on red, railway level crossings (Edmonton), few mapped stop signs on uncontrolled residential grids |
| Saskatchewan (SK) | Covered (1 map) | Saskatoon · Downtown & Nutana (`saskatoon`) | Left-arrow advance greens, 1-way→1-way left on red, river bridges and black ice (`bridges.v1.json`), water-adjacent park spans, roundabout |
| Manitoba (MB) | Covered (1 map) | Winnipeg · Exchange District (`winnipeg`) | Left-arrow advance greens, 1-way→1-way left on red, bus-only lanes, snow plow clearance challenge, slow-down/move-over challenge |
| Ontario (ON) | Covered (2 maps) | Toronto · The Annex (`toronto`), Ottawa · Centretown (`ottawa`) | Flashing-green-ball advance greens, 1-way→1-way left on red, Ontario pedestrian crossovers (`crossings.v2.json`), mixed-traffic streetcars (Toronto 511 Bathurst), mapped No-Turn-on-Red signs (Toronto), ON G2-style road test |
| Québec (QC) | Covered (2 maps) | Montréal · Le Plateau (`montreal`), Québec City · Saint-Roch (`quebec_city`) | Flashing-green-ball advance greens, no left turn on red (both maps), Island of Montréal right-on-red ban (Montréal only; allowed in Québec City), contraflow cycling, bus-only lanes and school crossing guard (Montréal) |
| Nova Scotia (NS) | Covered (1 map) | Halifax · Downtown (`halifax`) | Left-arrow advance greens, 1-way→1-way left on red (effective Oct 2026), single-lane roundabout (North Park), bus-only lanes, school crossing guard (Trollope Street) |
| New Brunswick (NB) | Uncovered | None | Custom `?bbox=` only |
| Prince Edward Island (PE) | Uncovered | None | Custom `?bbox=` only |
| Newfoundland and Labrador (NL) | Uncovered | None | Custom `?bbox=` only |
| Yukon (YT) | Uncovered | None | Custom `?bbox=` only |
| Northwest Territories (NT) | Uncovered | None | Custom `?bbox=` only |
| Nunavut (NU) | Uncovered | None | Custom `?bbox=` only |

Custom areas loaded with `?bbox=W,S,E,N` ([custom maps](custom-maps.md)) work anywhere in Canada.
The simulation applies left-on-red and Ontario crossover rules only within their reviewed bounds.
The signal display defaults to an arrow outside the Ontario and Québec region, and right turns on
red remain available outside the Montréal Island region under the simulator’s ordinary stop,
sign, and yield checks.

## 1. Rules explicitly gated by province or region in code

Five behaviours inspect the map's coordinates or carry explicit provincial framing in code:

1. **Right turn on red — Island of Montréal exclusion** (`rightOnRedAllowed` in
   `static/js/map/mapdata.js`). The simulator allows a right turn after stopping and yielding outside its coarse
   Island of Montréal polygon (`MONTREAL_ISLAND`, judged at the map centre). The regional exception
   follows Québec’s rules: Montréal · Le Plateau
   prohibits right turns on red, while Québec City · Saint-Roch permits them. See
   [Québec Highway Safety Code, sections 359–359.1](https://www.legisquebec.gouv.qc.ca/fr/document/lc/C-24.2?langCont=en).
2. **Left turn on red — reviewed one-way regions and BC omission** (`leftOnRedRegion` and
   `leftOnRedAllowed` in `static/js/sim/left-on-red.js`, [left turns on red](left-on-red.md)).
   Eligible map centres are checked against an explicit allow-list of ten reviewed city bounding
   boxes across BC, AB, SK, MB, ON and NS (where Nova Scotia's Using the Road Regulations
   s. 50(3)–(4) took effect on 19 October 2026). Both Québec maps are excluded (Québec Highway
   Safety Code ss. 359–359.1 allow right turns on red only), and unknown custom bounding boxes fail
   closed so a map straddling the Ottawa River or entering an unreviewed province cannot guess.
   **Intentional omission:** BC's Motor Vehicle Act s. 129(3)(b) also permits a left turn on red
   from a **two-way** street onto a **one-way** street after stopping and yielding; the simulator
   deliberately restricts `leftOnRedAllowed` to `a?.oneway && b?.oneway` across all ten regions.
3. **Advance green display and permitted movements** (`advanceStyle` in `static/js/sim/signals.js`,
   [advance greens and left-turn arrows](advance-greens.md)). A coarse `FLASHING_GREEN` polygon
   covering Ontario and Québec (from the Manitoba border east to the Gulf of St. Lawrence, excluding
   New Brunswick and Nova Scotia south of the Gaspé) selects between two provincial signal styles:
   - **Ontario and Québec (`"flash"`):** a flashing green ball (`advance`) lets the leading approach
     proceed left, straight or right while oncoming traffic is held on red (MTO Driver's Handbook,
     "Traffic lights"; SAAQ *feu vert clignotant*), then holds steady green through clearance.
   - **BC, AB, SK, MB, NS and elsewhere (`"arrow"`):** a green left arrow beside a red ball
     (`arrow`, followed by 3 s `arrow_yellow` and 1 s `red`) permits left and U-turn movements only
     (BC Motor Vehicle Act s. 130); straight and right-turning traffic waits on red. A flashing
     green ball is never used for an advance green in BC, where a flashing green indicates a
     pedestrian-controlled signal.
4. **Ontario pedestrian crossovers (PXOs)** (`ontarioMap` in `static/js/sim/pxo.js`,
   `jev/osm/crossings.py` v2, [Ontario pedestrian crossovers](pedestrian-crossovers.md)). Gated to
   two neighbourhood bounding boxes around Toronto (`43.5–44.0 N`, `-79.7 to -79.0 W`) and Ottawa
   (`45.1–45.6 N`, `-76.0 to -75.3 W`) rather than a province-wide polygon. When enabled, vehicles
   must remain stopped until every pedestrian clears the entire asphalt roadway, including parking
   lanes, to the far curb.
5. **Provincial-styled road tests** (`ROAD_TESTS` in `static/js/lab/road-tests.js`,
   [Drive lab road tests](../drive-lab.md#road-tests)). Two authored multi-situation routes carry
   regional labels: **Kitsilano road test** (BC Class 5-style, ~1.7 km) and **Annex road test**
   (Ontario G2-style, ~1.2 km). Both use the same shared examiner rubric (`static/js/lab/examiner.js`,
   10-demerit threshold) rather than official licensing authority marking sheets.

## 2. Map-data-dependent regional layouts

These rules use uniform simulation code across all maps, but activate only where the real
OpenStreetMap sidecar layers contain qualifying infrastructure ([Canadian city maps](../maps.md)):

- **Toronto mixed-traffic streetcars** (`sim/streetcar.js`, [streetcars](streetcars.md)): Only
  Toronto's Annex has streetcar runs in a shared travel lane in `transit.v1.json` (the 511 Bathurst
  route; Spadina's separate median right-of-way is excluded). Stopping at least 2 m behind open
  rear doors (Ontario HTA s. 166) is therefore only encountered in Toronto.
- **Edmonton railway level crossings** (`sim/rail.js`, [level crossings](level-crossings.md)): Only
  Edmonton's Old Strathcona has active street-level rail crossings in `rail.v1.json` — eight
  crossbuck-only crossings along the High Level Bridge Streetcar heritage track (Alberta AR
  304/2002 s. 42: stop 5 m from the nearest rail; never stop on tracks).
- **Victoria scramble crossing** (`sim/signals.js`, [scramble crossings](scrambles.md)): Only
  Victoria's Old Town has a mapped scramble intersection in `scrambles.v1.json` (Government, Wharf
  and Humboldt streets by the Empress), running an exclusive all-walk phase with diagonal
  pedestrians and no right turn on red.
- **Toronto mapped No-Turn-on-Red signs** (`sim/red-turn-signs.js`,
  [red-turn signs](red-turn-signs.md)): Although all twelve presets ship `restrictions.v1.json`,
  only Toronto's layer currently contains `red_turns` records (7 mapped signs, including OSM
  relation 3726713 at Harbord Street and Spadina Avenue).
- **Halifax single-lane roundabout** (`sim/roundabout.js`):
  Halifax's North Park roundabout (Cunard Street / North Park Street) anchors **Find your gap**.
  Saskatoon (Spadina Crescent) and neighbourhood traffic circles (such as West 8th Avenue in
  Kitsilano) also appear in the packs; all roundabouts are currently modelled as single-lane rings.
- **Montréal and Halifax school crossing guards** (`sim/crossing-guard.js`,
  [school crossing guards](crossing-guards.md)): Guards staff marked mid-block crosswalks
  (`crossings`) that fall inside an active school-zone span (`zones`). In the bundled packs, only
  Montréal (Rue Berri) and Halifax (Trollope Street) have qualifying sites.
- **Bridges and black ice** (`sim/black-ice.js`, [black ice](black-ice.md)): The `bridges.v1.json`
  layer has roadway spans on only three bundled maps — Saskatoon (6 spans: Traffic, Broadway and
  Chief Mistawasis bridges), Victoria (10 spans: Johnson Street Bridge and approaches) and
  Kitsilano (6 spans on West Broadway). Other maps can still form black ice in tall-building
  shadows under winter conditions, but do not trigger bridge-deck caution.
- **Bus-only lanes and contraflow cycling** ([bus-only lanes](bus-lanes.md),
  [contraflow cyclists](contraflow-cyclists.md)): Reserved bus lanes (`buslanes.v1.json`) appear in
  five maps (Mount Pleasant, Winnipeg, Montréal, Victoria and Halifax); contraflow one-way bike
  streets (`contraflow.v1.json`) appear in nine (led by Montréal, Québec City and Ottawa; absent in
  Kitsilano, Calgary and Saskatoon).

## 3. Shared simulation rules and regional gaps

The simulation uses the same thresholds in every map for the cases below. Each gap identifies
where a future regional implementation needs its own legislation or map data.

| Rule | Shared simulation behavior | Regional gap |
|---|---|---|
| [School and playground zones](school-zones.md) | 30 km/h, with fixed school hours and playground hours based on daylight. | Posted hours, school calendars and beacon-triggered zones. |
| [Slow down, move over](slow-down-move-over.md) | BC-style 40/70 km/h limits when passing selected roadside vehicles, plus a lane change when clear. | Other provinces' speeds and categories of eligible vehicles. |
| [High beams](high-beams.md) | Dip within 150 m of oncoming traffic or 60 m when following. | Different distance thresholds, including BC's common 150 m threshold. [BC Motor Vehicle Act Regulations, section 4.06](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/26_58_01#section4.06). |
| [Transit bus pull-out](simulation.md) | Yield to a signalling bus pulling out from its stop. | Whether the rule applies in a marked bay and at different posted speeds. |
| [Passing cyclists](passing-cyclists.md) | Allow 1 m at 50 km/h or below, and 1.5 m above it. | Ontario's one-metre standard and other provincial passing rules. |
| [Passing snow plows](snow-plows.md) | Stay back at the scripted clearance distances and pass only on the left when clear. | Regional thresholds and rules about echelon plows and wing blades. |
| [School buses](simulation.md) | Stop in both directions when the lights flash on modelled two-way streets. | Median-separated approaches and different required stopping distances. |

Two additional signal rules also apply one uniform policy across all maps: **amber-light decisions**
(`sim/amber.js`, [amber-light decisions](amber-lights.md)) use BC MVA s. 128(1)(a) with a
conservative simulator stopping-distance check, and **overnight flashing signals**
(`sim/night-flash.js`, [overnight flashing signals](night-flash.md)) follow BC MVA s. 131(1), (3)
as a general policy rather than city-specific overnight schedules.

## 4. Candidate gaps and selection criteria for Phase 6

When Phase 3 exits and [Phase 6](../../ROADMAP.md#phase-6-grow-the-world-again) adds one new rule
or city at a time, candidates should close a concrete statutory or infrastructural gap rather than
duplicating an existing grid:

1. **BC pedestrian-controlled flashing green:** `advanceStyle` already prevents a flashing green
   from meaning an advance left turn in BC, but pedestrian-controlled flashing greens (where the
   main street holds a flashing green until a pedestrian pushes the button, while the minor street
   has stop signs) are not yet modelled. It directly tests a well-known cross-province signal
   misinterpretation between BC and ON/QC.
2. **BC two-way to one-way left turn on red:** Adding BC MVA s. 129(3)(b)'s two-way-to-one-way
   case in Vancouver or Victoria would test a distinct legal and geometric interaction — yielding
   both to oncoming traffic on the two-way approach (if permitted) and to cross traffic/pedestrians
   on the one-way street — while keeping the one-way-only gate elsewhere.
3. **Multi-lane roundabouts:** Every current roundabout in `jev/osm/graph.py` and
   `sim/roundabout.js` is a single-lane ring. Multi-lane roundabouts (common in Waterloo/Kitchener,
   suburban Ottawa, Calgary and Halifax corridors) add entry lane selection (right lane for
   first/second exits, left lane for through/left/U-turn exits), yielding to both circulating
   lanes, and prohibiting lane changes inside the ring.
4. **Dedicated bicycle signals and bike boxes:** Separate green/amber/red bicycle signal heads and
   painted green advance stop boxes (widespread in Vancouver, Montréal, Toronto and Ottawa) are
   distinct from shared-lane cycling and contraflow lanes, testing right-turn hold compliance when
   a bicycle phase leads or overlaps general traffic.
5. **Transit-priority white vertical bar signals:** Used in Montréal, Toronto, Ottawa, Vancouver and
   Québec City, a white vertical bar gives transit vehicles an early green while general traffic
   remains on red — a realistic "not your light" judgment hazard alongside left-turn arrows.
6. **Provincial U-turn bans at signals and intersections:** Use opposite-direction turns at traffic signals
   to exercise local prohibitions, such as the BC rule for intersections with a traffic signal.
   The authored exercises place U-turns at dead ends. [BC Motor Vehicle Act, section 168](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96318_05#section168).
7. **Atlantic and Northern layouts (uncovered provinces and territories):** Adding a neighbourhood
   from NB, PE, NL, YT, NT or NU is justified when it pairs with a missing layout or condition —
   for example, St. John's irregular narrow historic junctions, Moncton/Charlottetown multi-lane
   roundabouts, or Whitehorse/Yellowknife winter low-sun and unlit arterial conditions (tying into
   Phase 6's season benchmark condition).

### Selection criteria for the next city or rule

Before proposing a Phase 6 addition, check all four criteria alongside the six-point
[admission rule](../../ROADMAP.md#admission-rule-for-new-scenarios):

- **Distinct rule or layout:** It closes a gap listed in Sections 1–4 rather than adding another
  grid with the same controls and hazards as an existing city.
- **Verifiable OSM data:** The real bounding box already contains clean, tagged OpenStreetMap
  features (signals, lanes, signs or geometry) without hand-invented street layouts.
- **Open-track separation:** It requires driver judgment on the [open track](benchmarks.md) — not
  merely a safety-filter rejection that every model passes automatically.
- **Clean registry fit:** It implements cleanly as a self-contained record on the Phase 3 feature
  interface without re-introducing feature-specific branches in core simulation files.
