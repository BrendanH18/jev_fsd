# Contraflow cyclists

`jev/osm/contraflow.py` builds `<key>.contraflow.v1.json` beside unchanged packs from the raw OSM
ways: the one-way streets cyclists may ride both ways (`oneway:bicycle=no`, `cycleway=opposite`,
`opposite_lane`/`opposite_track`, `bicycle:backward=yes`, and side lanes or tracks running against the
traffic, `cycleway:left=lane` + `cycleway:left:oneway=-1` and the like). Each record names the pack's
one-way edge, `kind` (`lane`, `track` or `shared`) and `side` relative to the traffic. Ways are
matched by both endpoint node IDs, or by name and centreline where the pack merged ways; ways tagged
`bicycle=no` and roundabouts are left out. `uv run scripts/fetch_map.py <preset> --contraflow`
rebuilds only the layer. `server.py`, `scripts/build_demo.py` and the Node tests load it with the
others; `MapData.contraflow` maps edge id to record.

`World` option `contraflow` (free drives unless `?contraflow=0`; challenges with `contraflow: true`)
creates `World.contraflow` (`sim/contraflow.js` `ContraflowRiders`). It puts up to three riders down on
contraflow streets 40 to 260 m from the car, from its own random stream (`seed * 122949823 + 47`), and
another 6 to 20 s after one rides off (340 m away, or at the end of its way). A rider rides the street's
contraflow blocks in turn (`RiderPath`), 0.6 m in from the asphalt's (or parking lane's) edge on the
driver's left, then crosses or turns onto an ordinary street and rides with the traffic on its curb
side. At the end of each block `contraControl` says what faces it: the signal of the approach on its
street's axis, the stop sign its street's own traffic has from the other side (or a stop where the
street ends at one that does not stop for it), `yield` (an uncontrolled junction; at an `equal` one,
only to traffic from its right), or `major`. A signal that is dark, or flashing red overnight
(`sim/night-flash.js`), is a stop sign to it; flashing amber is a caution. It stops for those, for people on crosswalks and for any
body in its way just ahead. Riders are `kind: "bike"` with `contra: true`; `world.obstaclesNear`,
collisions, sight lines and the forward sims see them; `world.npcs` does not hold them.

`riderConflict` is the one test everyone uses: along a vehicle's way (its path or route), from its
front, against the rider's way ahead (to a stop it means to make), samples that cross its way within
half the widths plus 0.5 m, or meet it head on within half the widths plus the minimum passing
distance (1 m at 50 km/h or less, 1.5 m above; `sim/cyclist-pass.js` `minPassM`) after moving right as
far as the asphalt allows (not into a parking lane), conflict when the vehicle, pulling away at
2 m/s² from its speed, would be there within 1.5 s of the rider. It returns the first such arc length
and how far right to move for one coming the other way (within 45 m). Before entering a contraflow
street the rider is coming out of (within 60 m of the junction), the wait is 1.5 m short of the
crossing street's asphalt instead (`entryHold`). Traffic (`sim/npc.js`, `trafficYield`) eases right at
0.7 m/s and holds there; riders coming the other way are not leaders. The driven car's sensing
(`brain/sensors.js contraflowCyclist`) reports `contraflow_cyclist`: `relation` (`turning_in`,
`oncoming`, `turning_off`, `crossing`), `wait`, `stop_s_route`, `shift_m` and a `detour` (`cf:<id>`)
that moves it right, kept from the executing law until it is by. The car waits at the first of the
entry and conflict holds it can still stop at (from 0.5 m/s, where it is); past both it has committed.
Candidates add `yield_to_contraflow_cyclist` and reject `fails_to_yield_to_contraflow_cyclist` (front
0.5 m past the hold) and `passes_contraflow_cyclist_too_close` (moving faster than 1 m/s beside one
coming the other way with less than the passing distance less 0.1 m). Rules stops within 1.5 m of the
hold and the cautious agent takes the yield candidate; `toJevState`, the situation clauses, the motion
question and the LLM prompt describe it.

The audit (`auditContraflow`) sets `World.contraflowSeen` once a rider is within 30 m of the car.
Cutting one off (the car's front in its way ahead of it, within 2 s, as for `auditCyclists`) is
`failed_to_yield` (`to: "contraflow cyclist"`, once per rider per 10 s); that and meeting one head on
with less than the passing distance while moving are `contraflow_conflicts`, which reach the metrics
and fail a drive only once `contraflowSeen`. `DriveScore` reports `contraflow_conflicts`,
`contraflow_meets` and `contraflow_cutoffs` with coaching. `render/contraflow.js` draws a solid lane
line, bicycles and arrows against the traffic (or sharrows on shared streets) and, at the start of each
street, a ONE WAY sign with an EXCEPT BICYCLES tab (SENS UNIQUE / EXCEPTÉ VÉLOS in Québec); the
renderer drew no one-way signs before. With the option off nothing is built, stepped or drawn from a
random stream, `obstaclesNear` returns what it did, and no metric changes.

The challenge **Both ways** (`contraflow`, seed 40042) turns right from Rue Drolet into Rue Villeneuve
Est (painted contraflow lane, 3.2 m of asphalt) at a junction without a sign while a cyclist comes out
of it from the car's right (`lab/challenges/contraflow.js`). Focused checks:
`node --experimental-default-type=module scripts/test_contraflow.mjs` and `tests/test_contraflow.py`.

Limits: contraflow cyclists do not take part in all-way stop turn order or give-way priority for
traffic (`sim/priority.js`); the conflict test stands in for both. Separate cycle tracks
(`highway=cycleway`) are not in the packs. Packs give most Plateau one-ways 3.2 m of asphalt, so a car
there always stops for an oncoming cyclist.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Contraflow cyclists are opt-in.** `World` option `contraflow` (free drives, unless `?contraflow=0`; challenges with `contraflow: true`) puts cyclists from their own random stream on the map's contraflow layer, riding against the one-way at the driver's left and stopping for what faces their way (`sim/contraflow.js`, `World.contraflow`). They are not in `world.npcs`: `world.obstaclesNear` adds them, and traffic, sensing (`contraflow_cyclist`) and the forward sims meet them through the one conflict test `riderConflict` (wait short of the junction for one coming out of a street being entered; move over, and stop where that leaves less than the minimum passing distance, for one coming the other way). The audit's `contraflow_conflicts` (cutting one off, also `failed_to_yield`, or meeting one too close) reaches the metrics, and fails a drive, only once one has ridden near the car (`World.contraflowSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
