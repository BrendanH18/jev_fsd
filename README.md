# Jev FSD

A browser driving simulator on real OpenStreetMap streets (default: Kitsilano, Vancouver) where
[Jev by TypeSafe AI](https://typesafe.ai/), a "System One" model, drives the car. Click a destination
on the minimap; code plans the route, samples safe maneuvers, and Jev picks one several times a
second. A panel shows exactly what Jev was asked and the probabilities it answered with.

![Jev driving in Kitsilano](docs/m3-jev-drive.png)

**Code owns the math. Jev owns the judgment.** Jev is text-only and, by TypeSafe's own account,
not a calculator. So the geometry, physics, routing, collision prediction, and stop-line checks all
live in code. Each decision, code samples up to 16 candidate maneuvers, forward-simulates each for
3 seconds with the real car model, rejects the ones that collide, leave the road, or run a red, and
sends Jev a compact table of the survivors plus the situation. Jev answers two typed questions:

- `motion`: drive or stop, right now
- `vector`: which candidate to execute for the next second

Questions with only one legal answer are resolved locally without a call. Decisions run every
250 ms near hazards and every 650 ms on open road; the chosen maneuver keeps executing until the
next answer lands, so latency never stalls the car. A local safety brake overrides for imminent
collisions only. Red lights run, stop signs missed, and collisions are counted on screen, never hidden.

## Run

```sh
cp .env.example .env      # add TYPESAFE_API_KEY (console.typesafe.ai)
uv run server.py          # http://127.0.0.1:8322
```

No Node, no bundler: Three.js loads from a CDN import map. The Python server (one dependency,
`typesafe-sdk`) serves the app, builds the map, routes, and proxies Jev so the key never reaches
the browser. Without a key the Rules brain still works.

**Keys:** click the minimap to set a destination · `J` autopilot · `W A S D` drive · `Space` brake ·
`C` camera · `R` reset to lane · `P` pause · `1`/`2` switch brain.

Brains: **Jev** (TypeSafe) and **Rules** (pure code, the fallback). The interface leaves room for others.

## Measured (Kitsilano, 40 NPC cars, 755 m route with a stop sign and three signals)

| | Jev brain |
|---|---|
| live decisions | 431 in 129 s |
| latency p50 / p90 | 130 ms / 199 ms |
| input tokens per decision | about 1,800 |
| cost for the whole drive | $0.033 |
| violations | 1 red light (entered as yellow turned red), 0 stop signs, 0 collisions |

## Map

The default map is fetched once from the OpenStreetMap main API and cached in `data/maps/` (the
Kitsilano pack is committed, so the demo runs offline). Any bounding box works:

```sh
JEV_FSD_BBOX="-123.1120,49.2570,-123.0940,49.2680" uv run server.py   # W,S,E,N (Mount Pleasant)
uv run scripts/fetch_map.py -123.1120,49.2570,-123.0940,49.2680     # pre-warm the cache
```

Pipeline (`jev/osm/`): XML → projected road graph with lanes, one-ways, speed limits → signalled
intersections (phases invented in code, OSM has no timing) and stop signs → building footprints →
one JSON "map pack". Overpass mirrors are the fallback; a synthetic grid is the fallback for that.

## Tests

```sh
uv run python -m unittest discover tests    # offline: geometry, graph, controls, routing, decide
open http://127.0.0.1:8322/tests            # browser: controller, car model, collisions, candidates, state
uv run scripts/verify_jev.py                # live: saved snapshots in data/snapshots/ against the real model
```

The snapshots are real decisions saved from the JSON panel, with expectations such as "at a red
light, `motion=stop` with p > 0.5". Run them after changing any question wording.

## Layout

```
server.py            routes: /api/status /api/map /api/route /api/decide /api/snapshot/save
jev/client.py        the only module that talks to TypeSafe (spend guard, latency, trace)
jev/osm/             fetch, parse, project, graph, controls, buildings, pack
jev/routing.py       edge-based A* with turn penalties, alternatives, filleted polyline
jev/decide.py        request validation for the decision proxy
static/js/sim/       bicycle model, controller, collisions, signals, NPC traffic, world
static/js/brain/     sensors, candidates, state + questions, scheduler, rules brain, jev brain, safety
static/js/render/    scene, roads, buildings, cars, overlays, minimap
static/js/ui/        HUD, input, JSON panel
```

Independent open-source demo; not affiliated with TypeSafe AI. MIT.
