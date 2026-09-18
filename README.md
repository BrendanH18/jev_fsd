# Jev FSD

A browser driving simulator on real OpenStreetMap streets (default: Kitsilano, Vancouver) where
[Jev by TypeSafe AI](https://typesafe.ai/), a "System One" model, drives the car. Click a destination
on the minimap; code plans the route, samples safe maneuvers, and Jev picks one several times a second.

Code owns the geometry, physics, routing, and collision checks. Jev owns the judgment.

## Run

```sh
cp .env.example .env      # add TYPESAFE_API_KEY
uv run server.py          # http://127.0.0.1:8322
uv run python -m unittest discover tests
```

Status: under construction. See the milestone list in the commit history.
