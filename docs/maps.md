# Canadian city maps

Use **Explore cities** in the simulator, then select a neighbourhood. Twelve maps across eleven
Canadian cities cover residential streets, downtown avenues, historic street grids, a harbour
front, a warehouse district, a prairie main street and river crossings. Each is
a neighbourhood-sized extract of real OpenStreetMap roads, lane tags, buildings and traffic controls. The processed
packs are bundled, so these choices work without a map download. Three suggested drives are
routed from the car's current position when the explorer opens; the world pauses while choosing.

| URL parameter | Neighbourhood | Directed segments | Signals | Stops | Buildings |
|---|---|---:|---:|---:|---:|
| `?map=kitsilano` | Kitsilano, Vancouver | 626 | 24 | 181 | 2,062 |
| `?map=mount_pleasant` | Mount Pleasant, Vancouver | 745 | 23 | 171 | 1,427 |
| `?map=victoria` | Old Town, Victoria | 556 | 42 | 34 | 836 |
| `?map=toronto` | The Annex, Toronto | 418 | 19 | 118 | 1,892 |
| `?map=montreal` | Le Plateau, Montréal | 408 | 23 | 60 | 3,000 |
| `?map=calgary` | Beltline, Calgary | 553 | 40 | 56 | 1,183 |
| `?map=ottawa` | Centretown, Ottawa | 675 | 48 | 147 | 3,000 |
| `?map=quebec_city` | Saint-Roch, Québec City | 757 | 25 | 49 | 1,647 |
| `?map=halifax` | Downtown, Halifax | 581 | 25 | 31 | 1,020 |
| `?map=winnipeg` | Exchange District, Winnipeg | 598 | 17 | 5 | 783 |
| `?map=edmonton` | Old Strathcona, Edmonton | 404 | 11 | 4 | 1,614 |
| `?map=saskatoon` | Downtown & Nutana, Saskatoon | 639 | 27 | 9 | 1,552 |

A two-way road segment contributes two directed segments. Routes retain OSM street names,
one-way directions, lane tags and speed limits; missing lane and speed tags use road-class
defaults. Only the largest connected driving network is retained, so a suggested drive cannot
lead to an isolated street. Building counts are processed footprints, capped at 3,000 per pack.
Edmonton and Winnipeg have few mapped stop signs: many of their residential and warehouse
crossings are uncontrolled in OpenStreetMap, as they often are on the street.

Changing city starts a new world and keeps the selected weather, time and graphics setting.
An active drive with distance recorded is saved as **map changed**, without an arrival claim.
Routing, rerouting, status and map attribution use the selected city's bounding box.
**Benchmark this city** in the explorer opens the benchmark on that same map; saved runs and
3D replays preserve the bounding box. Signal-heavy downtowns can start scenarios on controlled
streets when the original uncontrolled-street sampling cannot fill a suite.
The map geometry has no elevation data; buildings use tagged heights or procedural estimates.
Vancouver's specific mountain backdrop and landmarks are shown only in Vancouver.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), made available
under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
Victoria, Toronto and Montréal were downloaded on 2026-09-29 from the OpenStreetMap main API.
Mount Pleasant, Calgary and Québec City were downloaded on 2026-09-30 from the same API;
Ottawa was downloaded that day through the `overpass-api.de` fallback. Halifax, Winnipeg,
Edmonton and Saskatoon were downloaded on 2026-10-14 from the OpenStreetMap main API. These are actual OSM
extracts processed without changing the existing map-pack schema. Raw XML downloads are a
local cache; the processed packs are the redistributable database extracts included here.

| City | Bounding box W,S,E,N | Pack |
|---|---|---|
| Vancouver · Kitsilano | `-123.1700,49.2600,-123.1500,49.2700` | `data/maps/623b012bc8b5.v6.pack.json` |
| Vancouver · Mount Pleasant | `-123.1120,49.2570,-123.0940,49.2680` | `data/maps/7165f1c807a8.v6.pack.json` |
| Victoria | `-123.3740,48.4190,-123.3570,48.4320` | `data/maps/d7454a9751b7.v6.pack.json` |
| Toronto | `-79.4120,43.6600,-79.3940,43.6710` | `data/maps/4a96d42cb3f2.v6.pack.json` |
| Montréal | `-73.5900,45.5160,-73.5740,45.5280` | `data/maps/bb9df59633e0.v6.pack.json` |
| Calgary | `-114.0870,51.0340,-114.0630,51.0450` | `data/maps/a53c5bcf6438.v6.pack.json` |
| Ottawa | `-75.7080,45.4070,-75.6870,45.4210` | `data/maps/d25b07def0d2.v6.pack.json` |
| Québec City | `-71.2350,46.8050,-71.2180,46.8150` | `data/maps/8e99888cb743.v6.pack.json` |
| Halifax | `-63.5900,44.6400,-63.5700,44.6520` | `data/maps/49db0d437c8c.v6.pack.json` |
| Winnipeg | `-97.1500,49.8920,-97.1310,49.9030` | `data/maps/19bb885c9cae.v6.pack.json` |
| Edmonton | `-113.5120,53.5130,-113.4880,53.5230` | `data/maps/3e794edbefcb.v6.pack.json` |
| Saskatoon | `-106.6720,52.1170,-106.6500,52.1310` | `data/maps/ca5573a8d934.v6.pack.json` |

Processing skips streets roofed by a building (`covered=yes`, `tunnel=building_passage`, such
as Grafton Street through Halifax's Nova Centre) and footprints that start above street level
(`building:min_level` or `min_height` above zero: skywalks and pedways over roads). A roundabout
split across several OSM ways is joined into one ring with a fitted centre, and rings of 9 m
radius or more keep their single circulating lane on the mapped carriageway. The eight earlier
packs were not rebuilt; refreshing one may drop a raised footprint (Kitsilano: one).

Pack version 6 fixes two-way streets with more lanes one way than the other, such as Belleville
Street in Victoria (three lanes one way, one the other). Their lanes already sat on either side of
the mapped centreline, but the asphalt was centred on it, so the outer lane on the wider side ran
past the curb, and curbside lamp and sign posts stood in it. Now each side's asphalt ends beyond
its own lanes. The committed packs were upgraded in place by `scripts/migrate_packs.py`, without
new OSM data: it widened or narrowed the asphalt of 378 directed segments (all but Saskatoon have
some) and moved back the 202 signal and 2 stop lines set back from those streets' curbs. A fresh
build of Kitsilano from its cached OSM with the fixed code gives the same roads, lanes and controls
as its migrated pack, except for one stop line 1 cm away (packs store lengths to the centimetre).

### Bus routes

Each bundled map has its bus and trolleybus routes and their stops beside its pack, in
`data/maps/<key>.transit.v1.json` (`jev/osm/transit.py`). They were built on 2026-10-27 from
OpenStreetMap downloaded that day (the main API; Ottawa through the `overpass-api.de` fallback),
matched to the committed packs' streets by OSM node, so the packs themselves are unchanged. A
route's ways are joined end to end into runs along the pack's directed edges; its platform and
stop members on the right-hand side of a run become its stops there. The server and the browser
demo add the file to the map as `transit`. With buses running, the sim keeps a bus zone clear of
parking at each stop. To rebuild a map's routes from today's OSM without touching its pack, run
`uv run scripts/fetch_map.py <preset> --transit`. A custom area gets its routes from the same
download as its pack.

### Crosswalks

Each bundled map also has its marked crosswalks between junctions beside its pack, in
`data/maps/<key>.crossings.v1.json` (`jev/osm/crossings.py`), built on 2026-10-27 from the same
OpenStreetMap downloads as the bus routes. A crossing node on a drivable street tagged as marked and
without a signal (`crossing=uncontrolled`, `marked` or `zebra`, or a `crossing:markings` value other
than `no`) is placed on the pack street whose centreline passes within 3 m of it, as a point along an
edge, with how it is painted (bars along the traffic for zebra and ladder markings, two lines across it
for lines, dots and dashes) and whether it has a refuge island. Crossings within 16 m of a junction
are left out, since people already cross at every junction's corners, and so are those within 12 m
of a dead end or the edge of the map, unmarked ones (in BC a crosswalk away from a junction exists
only where it is marked), signalled ones, and a second one within 8 m of another on the same street.
That leaves 102 across the twelve maps (Mount Pleasant, Québec City and Edmonton have none). The
packs are unchanged; the server and the browser demo add the file to the map as `crossings`, and
`--transit` rebuilds it with the bus routes.

To refresh an extract, run `uv run scripts/fetch_map.py <preset> --force`. To fetch fresh raw
data as well, remove only that city's local `.osm.xml` cache first. For a custom area, keep
using `JEV_FSD_BBOX` or `?bbox=W,S,E,N`.
