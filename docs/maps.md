# Canadian city maps

Use **Explore cities** in the simulator, then select a city. Each map is a neighbourhood-sized
extract of real OpenStreetMap roads, lane tags, buildings and traffic controls. The processed
packs are bundled, so these choices work without a map download. Three suggested drives are
routed from the car's current position when the explorer opens; the world pauses while choosing.

| URL parameter | Neighbourhood | Roads | Signals | Stops | Buildings |
|---|---|---:|---:|---:|---:|
| `?map=kitsilano` | Kitsilano, Vancouver | 626 | 24 | 181 | 2,062 |
| `?map=victoria` | Old Town, Victoria | 556 | 42 | 34 | 836 |
| `?map=toronto` | The Annex, Toronto | 418 | 19 | 118 | 1,892 |
| `?map=montreal` | Le Plateau, Montréal | 408 | 23 | 60 | 3,000 |

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
The new extracts were downloaded on 2026-09-29 from the OpenStreetMap main API and processed
without changing the existing map-pack schema. Raw XML downloads are a local cache; the three
processed packs are the redistributable database extracts included here.

| City | Bounding box W,S,E,N | Pack |
|---|---|---|
| Victoria | `-123.3740,48.4190,-123.3570,48.4320` | `data/maps/d7454a9751b7.v5.pack.json` |
| Toronto | `-79.4120,43.6600,-79.3940,43.6710` | `data/maps/4a96d42cb3f2.v5.pack.json` |
| Montréal | `-73.5900,45.5160,-73.5740,45.5280` | `data/maps/bb9df59633e0.v5.pack.json` |

To refresh an extract, run `uv run scripts/fetch_map.py <preset> --force`. To fetch fresh raw
data as well, remove only that city's local `.osm.xml` cache first. For a custom area, keep
using `JEV_FSD_BBOX` or `?bbox=W,S,E,N`.
