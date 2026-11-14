# Geese crossing the road (`sim/geese.js`)

`jev/osm/parks.py` builds `<key>.parks.v1.json` beside unchanged packs from the raw OSM download:
`areas`, the parks (`leisure=park`), gardens (`leisure=garden`), recreation grounds
(`leisure=recreation_ground`), lawns (`landuse=grass`) and water (`natural=water`,
`waterway=riverbank`; `waterway=river|canal` as lines), as ways or multipolygons (`jev/osm/parse.py`
now keeps those multipolygons too), projected to pack metres and simplified to 1 m, without the
small ones (a park under 800 m², a garden under 1,500 m², a recreation ground under 1,000 m², a
lawn under 2,500 m², water under 300 m²); and `spans`, every stretch of a pack street (each
direction's edge) whose centreline passes within 25 m of an area, or through one, with the area on
each side of travel (`left`, `right`), `water`, and `from`/`to` along the edge (stretches under
20 m and roundabout rings are left out). Only areas beside a span are kept.
`uv run scripts/fetch_map.py <preset> --parks` rebuilds only the layer; `server.py`,
`scripts/build_demo.py` and the Node tests load it with the others, and `MapData.parks` and
`MapData.parkSpans` hold it. All twelve presets have layers (149 areas, 889 spans: Halifax 155,
Québec City 138, Saskatoon 118, Victoria 98, Ottawa 75, Calgary 55, Winnipeg 51, Montréal 47,
Toronto 46, Kitsilano 38, Edmonton 36, Mount Pleasant 32). Only Saskatoon has water beside a
street, the South Saskatchewan River; Ottawa's bbox stops short of the Rideau Canal. Ottawa's raw
download comes from Overpass (it exceeds the main API's 50,000-node limit), so
`fetch.overpass_query` asks for the parks and water too.

`World` option `geese` is on in free drives unless `?geese=0`, and in the **Goose crossing**
challenge (`geese: true`). One gaggle at a time, 20–45 s into a drive and 50–120 s after the last,
by day (`world.clock.sun_deg > 0`, or a daylit sky without a clock) and not in snow, a gaggle of 4–9
geese (45% of the time two or three adults with goslings between them; adults lead and bring up the
rear) is put on the grass beside a span 100–200 m ahead along the route, 15 m or more from the
edge's ends, 20 m from its stop line and 12 m from a crosswalk, on a side with a park or water. It
sets off once the car's front is 50–80 m short (all from its own random stream). Their way
(`crossingGeometry`) runs from the grass 1 m beyond the sidewalk, straight across within ±14°, to
the far grass. They walk in loose single file, each at its own pace (adults 0.5–0.8 m/s, goslings
0.4–0.65 m/s), keeping 1.0–1.6 m (goslings 0.6–1.0 m) behind the one ahead and wandering ±0.3 m
either side of the line. The lead stops 0.4 m short of the kerb to look for 1 s, and steps off once
nothing coming whose way crosses theirs would need more than 2.5 m/s² (after 0.8 s to react) to
stop short of them, and nothing stands in their way across. On the road one or another pauses for
0.8–2.5 s now and then (0.05/s), and in 35% of gaggles one stops in the road for 4–9 s; the ones
behind it wait in file. A goose stops for a vehicle about to be in its way. Once the last is 0.3 m
past the far kerb face the gaggle is `across`, and they wander onto the grass and graze.

Geese are `Goose` objects (`goose: true`, `kind: "goose"`; 0.9 × 0.4 m, goslings 0.45 × 0.25 m),
not in `world.npcs`; `world.obstaclesNear` adds them, so the forward sims and the safety supervisor
see them, and hitting one is a collision in `collisions`, at fault when the car was moving, as for a
pedestrian. Sensing leaves them out of the vehicles it follows or changes lanes around: a gaggle is
waited for, never followed or passed. Sensing, the forward sims, traffic and cyclists, and the lead's
look share `geeseConflict`: the corridor from 0.5 m outside one kerb face to 0.5 m outside the other,
1.3 m either side of the file's line, against a vehicle's line (route or path), whichever way it
goes. While they come up to the kerb or look (`coming`), a driver slows to reach 4 m/s by 8 m short
of the corridor (`cautionSpeed`); from the lead stepping off until the last goose is off the roadway
(`crossing`), it stops 2 m short and keeps the same gentle approach ceiling. Sensing reports
`geese_crossing` (`geese`, `goslings`, `from`, `phase`, `on_road`, `stopped_on_road`, `wait`,
`stop_s_route`, `bumper_to_stop_m`, `limit_mps`), caps `snap.limit`, and `desiredSpeed` stops at the
wait point. The `wait_for_geese` candidate slows, or stops there; forward sims reject
`drives_into_geese` for passing the wait point by more than 1 m. Rules stops at the wait point and
prefers the candidate; the cautious agent takes it whenever the car must wait; the deadlock detector
leaves a car waiting for geese alone. Models get a `geese_crossing` field, a situation clause, a
stop criterion for the motion question and a line in the system prompt. Traffic and cyclists
(`geeseYield` in `sim/npc.js`) cap their speed and hold at the same point once they could still
stop there.

The audit counts moving faster than 0.8 m/s with less than 2 m between the car's body and a goose
on the roadway, and hitting one, each once per gaggle, as `wildlife_conflicts`, reported (and
failing a drive) only once a gaggle has crossed within 60 m of the driven car (`World.geeseSeen`).
The drive score costs 20 safety points each, with an incident, a coaching tip and a replay marker.
The renderer (`render/geese.js`) draws low-poly adults (brown-grey body, pale belly, black tail,
neck and head, white chinstrap) and half-size yellow-grey goslings as four instanced meshes (each
kind with neck up, and head down for grazing), waddling with a bob and a roll paced by the distance
walked. The HUD says GEESE BY THE ROAD AHEAD, and GEESE CROSSING · WAIT FOR THE LAST ONE once the car
must stop.

**Goose crossing** (`goose-crossing`, seed 53042, Ottawa, Clemow Avenue in the Glebe, dry
afternoon): the first span of the street in the parks layer with a park on both sides (Central
Park and Patterson's Creek Park), on a two-way street with one lane each way (`gooseSites`). Ottawa's
bbox has no water beside a street, so this, a creek-side park where geese graze, stands in for the
canal. The car starts from a standstill on the block before, 98 m short of the crossing, through an
uncontrolled junction with Cobalt Avenue; eight geese (three adults, five goslings) wait on the
grass of Patterson's Creek Park on the left, the lead a step short of the kerb, and set off once the
car's front is 75 m away. The adult in the middle of the file stops in the car's lane for 8 s. The
route ends 30 m past the crossing. Rules stops about 4 m short of the file, the cautious agent about
7 m, and both wait about 40 s, until the last goose is off the road. A driver who stops, then goes
as soon as the lead is across its lane comes within 2 m of the goose standing in it
(`wildlife_conflicts`). Checks: `scripts/test_geese.mjs` (its `--write-snapshot` writes the
live-model case `data/snapshots/goose_crossing.json`) and `tests/test_parks.py`.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Geese are opt-in.** `World` option `geese` (free drives, unless `?geese=0`; challenges with `geese: true`) has a gaggle of Canada geese, from its own random stream, by day and not in snow, cross a street of the map's parks layer spans beside a park or water near the car's route (`sim/geese.js`, `World.geese`), in loose single file, the lead looking at the kerb first. Geese are not in `world.npcs`: `world.obstaclesNear` adds them as small obstacles (`goose`), so the forward sims see them and hitting one is a collision, at fault when the car was moving, as for a pedestrian; sensing's following and lane-change vehicle lists leave them out. Sensing (`geese_crossing`), candidates (`wait_for_geese`, rejection `drives_into_geese`), traffic and cyclists (`geeseYield` in `sim/npc.js`) and the lead's look share the one conflict test `geeseConflict` (the corridor from kerb to kerb): slow while they come up to the kerb, stop until the last goose is off the roadway. The audit's `wildlife_conflicts` (moving above a crawl within 2 m of a goose on the roadway, or hitting one) reaches the metrics, and fails a drive, only once a gaggle has crossed near the car (`World.geeseSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
