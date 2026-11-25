# Thousand-improvement batch

This batch adds 1000 improvements in ten areas of 100 each. Each area file numbers its own
entries from 1 to 100. The batch-wide number of an entry is its area's offset plus its number. For
example, entry 7 in the simulation core is number 407.

| Numbers | Area | Inventory |
|---|---|---|
| 1–100 | Server and APIs | [01-server.md](01-server.md) |
| 101–200 | Maps and map tooling | [02-maps.md](02-maps.md) |
| 201–300 | Offline analysis and results | [03-analysis.md](03-analysis.md) |
| 301–400 | Feature registry | [04-registry.md](04-registry.md) |
| 401–500 | Simulation core | [05-sim.md](05-sim.md) |
| 501–600 | Driving brain and prompting | [06-brain.md](06-brain.md) |
| 601–700 | Rendering and visuals | [07-render.md](07-render.md) |
| 701–800 | App UI and controls | [08-ui.md](08-ui.md) |
| 801–900 | Challenges, practice, arena and leaderboard | [09-lab.md](09-lab.md) |
| 901–1000 | Benchmark, CLI and developer tooling | [10-bench.md](10-bench.md) |

Each entry names the check that proved it. Before merging, each area was checked separately on a
Boat sandbox. Every area ran the seeded Rules suites on Kitsilano (seed 1, dry, `bare` and `city`)
before and after its change. All of them passed 12/12, with every field the same except timings.

The merged tree was then compared with the base commit `64d9772` on one sandbox. The comparison
covered the same two suites and every challenge and both road tests with Rules and the cautious
agent. It also ran the model-recording replay, the Jev fixture check, offline Jev verification and
the published-results check.
