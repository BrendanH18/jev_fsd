# Reference

The project reference, one page per topic. It began as one long file, `docs/project-reference.md`,
which is now an index that points here. The [README](../../README.md) is the place to start;
these pages hold the detail.

Guides: [adding a challenge](../adding-a-challenge.md), [adding a driver](../agents.md),
[Drive Lab](../drive-lab.md), [maps](../maps.md), [scoring and driving details](../drive-experience.md),
[Rules baseline](../rules-baseline.md), [model results](../model-results.md).

## Using the app

Running the app, driving with keyboard, touch controls or a gamepad, choosing a vehicle in the
six-car garage, connecting models, replaying recorded drives, and changing looks and maps.

- [Overview and quick start](overview.md)
- [Build, drive and deploy the browser demo](../browser-demo.md)
- [Drive coach, HUD and controls](drive-coach-and-hud.md)
- [Graphics and recent rendering fixes](graphics.md)
- [Custom maps and configuration](custom-maps.md)
- [Privacy and limitations](privacy-and-limitations.md)

## Simulation and decisions

How the car, traffic, regional road rules and the decision pipeline work.

- [Simulation: car, traffic, buses and emergency vehicles](simulation.md)
- [The decision pipeline](decision-pipeline.md)
- [Scenery, collisions and sight](scenery-and-sight.md)
- [Lane changes and turn lanes](lane-changes.md)
- [All-way stops](all-way-stops.md)
- [Provincial road rules coverage and gap analysis](provincial-rules.md)

## Benchmarks and development

Measuring drivers on versioned suites (`v1` and `hard-city-v1`), inspecting saved runs offline
(`scripts/inspect_run.py`: 100 core reports, 1,073 cohort profiles, 100 rate profiles and 100
matched paired-rate comparisons), running CLI tooling (`bench_node.mjs`, `arena_node.mjs`,
`bench_trace.mjs`, `compare_repeats.mjs`, `check_driver.mjs`, `node_checks.mjs`, `soak.mjs`,
`boat-check.sh`), and finding your way around the code.

- [Benchmarks and validation](benchmarks.md)
- [Development](development.md)

## Features

One page per situation the world can produce. Opt-in features end with their "Agent rules", the detailed project rule from `AGENTS.md`; the [opt-in feature pattern](../../AGENTS.md#opt-in-features) states what they all share.

- [Advance greens and left-turn arrows](advance-greens.md)
- [Amber-light decisions](amber-lights.md)
- [A ball, then a child](ball-chase.md)
- [Black ice](black-ice.md)
- [Bus-only lanes](bus-lanes.md)
- [Collection day (garbage trucks)](collection-day.md)
- [Contraflow cyclists](contraflow-cyclists.md)
- [Double-parked delivery vans](double-parked-vans.md)
- [Driveway reversers](driveway-reversers.md)
- [Following distance](following-distance.md)
- [Geese crossing the road](geese.md)
- [Hidden hazards and hidden traffic](hidden-hazards.md)
- [High beams](high-beams.md)
- [Keeping the junction clear](junction-box.md)
- [Lane closures and the zipper merge](lane-closures.md)
- [Left turns on red](left-on-red.md)
- [Level crossings](level-crossings.md)
- [Low sun glare](sun-glare.md)
- [Ontario pedestrian crossovers](pedestrian-crossovers.md)
- [OpenStreetMap turn restrictions](turn-restrictions.md)
- [Overnight flashing signals](night-flash.md)
- [Parallel parking at the destination](parallel-parking.md)
- [Passing cyclists with room](passing-cyclists.md)
- [Police officers directing traffic](traffic-officers.md)
- [Power cuts](power-outages.md)
- [Puddles at the kerb](puddles.md)
- [Red-light runners](red-light-runners.md)
- [Road closures](road-closures.md)
- [Roundabout challenge and red-turn signs](red-turn-signs.md)
- [School and playground zones](school-zones.md)
- [School crossing guards](crossing-guards.md)
- [Scramble crossings](scrambles.md)
- [Slow down, move over](slow-down-move-over.md)
- [Snow plows](snow-plows.md)
- [Snowbanks](snowbanks.md)
- [Speed humps, tables, cushions and bumps](traffic-calming.md)
- [Spring potholes](potholes.md)
- [Streetcars](streetcars.md)
- [Tailgaters](tailgaters.md)
- [Traffic parallel parking](parkers.md)
- [Work zones with a flagger](work-zones.md)
