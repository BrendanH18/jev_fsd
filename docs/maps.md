# Canadian city maps

Use **Explore cities** in the simulator, then select a neighbourhood. Eight maps across seven
Canadian cities cover residential streets, downtown avenues and historic street grids. Each is
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

A two-way road segment contributes two directed segments. Routes retain OSM street names,
one-way directions, lane tags and speed limits; missing lane and speed tags use road-class
defaults. Only the largest connected driving network is retained, so a suggested drive cannot
lead to an isolated street. Building counts are processed footprints, capped at 3,000 per pack.

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
Ottawa was downloaded that day through the `overpass-api.de` fallback. These are actual OSM
extracts processed without changing the existing map-pack schema. Raw XML downloads are a
local cache; the processed packs are the redistributable database extracts included here.

| City | Bounding box W,S,E,N | Pack |
|---|---|---|
| Vancouver · Kitsilano | `-123.1700,49.2600,-123.1500,49.2700` | `data/maps/623b012bc8b5.v5.pack.json` |
| Vancouver · Mount Pleasant | `-123.1120,49.2570,-123.0940,49.2680` | `data/maps/7165f1c807a8.v5.pack.json` |
| Victoria | `-123.3740,48.4190,-123.3570,48.4320` | `data/maps/d7454a9751b7.v5.pack.json` |
| Toronto | `-79.4120,43.6600,-79.3940,43.6710` | `data/maps/4a96d42cb3f2.v5.pack.json` |
| Montréal | `-73.5900,45.5160,-73.5740,45.5280` | `data/maps/bb9df59633e0.v5.pack.json` |
| Calgary | `-114.0870,51.0340,-114.0630,51.0450` | `data/maps/a53c5bcf6438.v5.pack.json` |
| Ottawa | `-75.7080,45.4070,-75.6870,45.4210` | `data/maps/d25b07def0d2.v5.pack.json` |
| Québec City | `-71.2350,46.8050,-71.2180,46.8150` | `data/maps/8e99888cb743.v5.pack.json` |

To refresh an extract, run `uv run scripts/fetch_map.py <preset> --force`. To fetch fresh raw
data as well, remove only that city's local `.osm.xml` cache first. For a custom area, keep
using `JEV_FSD_BBOX` or `?bbox=W,S,E,N`.
