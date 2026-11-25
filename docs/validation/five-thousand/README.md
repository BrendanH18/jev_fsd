# Five-thousand-improvement batch

This batch adds 5000 improvements in 25 areas of 200 each. Each area file numbers its own entries
from 1 to 200, and the batch-wide number of an entry is its area's offset plus its number: entry 7 in
the road traffic area is number 2207. Every entry names the check that proved it.

| Numbers | Area | Inventory |
|---|---|---|
| 1–200 | Local server and security | [01-server.md](01-server.md) |
| 201–400 | Model backends | [02-models.md](02-models.md) |
| 401–600 | Maps and map tooling | [03-maps.md](03-maps.md) |
| 601–800 | Routing and map geometry | [04-routing.md](04-routing.md) |
| 801–1000 | Published results and manifests | [05-results.md](05-results.md) |
| 1001–1200 | Offline run analysis | [06-insights.md](06-insights.md) |
| 1201–1400 | Benchmark runner | [07-bench.md](07-bench.md) |
| 1401–1600 | Arena recordings and outside-driver submissions | [08-submissions.md](08-submissions.md) |
| 1601–1800 | Feature registry, batch A | [09-registry-a.md](09-registry-a.md) |
| 1801–2000 | Snow plows, lane closures and passing cyclists | [10-registry-b.md](10-registry-b.md) |
| 2001–2200 | Vehicle physics and control | [11-physics.md](11-physics.md) |
| 2201–2400 | Road traffic | [12-traffic.md](12-traffic.md) |
| 2401–2600 | Pedestrians, cyclists and parking | [13-people.md](13-people.md) |
| 2601–2800 | Transit, rail and emergency vehicles | [14-transit.md](14-transit.md) |
| 2801–3000 | Sensing and safety filter | [15-sensing.md](15-sensing.md) |
| 3001–3200 | Candidates, Rules, and Cautious | [16-planning.md](16-planning.md) |
| 3201–3400 | Browser model requests and prompt audits | [17-prompting.md](17-prompting.md) |
| 3401–3600 | World rendering | [18-render-world.md](18-render-world.md) |
| 3601–3800 | Vehicle and actor rendering | [19-render-actors.md](19-render-actors.md) |
| 3801–4000 | App UI and HUD | [20-app-ui.md](20-app-ui.md) |
| 4001–4200 | Input and accessibility | [21-input-a11y.md](21-input-a11y.md) |
| 4201–4400 | Challenge practice, debriefs and road tests | [22-lab.md](22-lab.md) |
| 4401–4600 | Arena, leaderboard and replay improvements | [23-arena-ui.md](23-arena-ui.md) |
| 4601–4800 | Public demo and documentation | [24-demo-docs.md](24-demo-docs.md) |
| 4801–5000 | CI and developer tooling | [25-tooling.md](25-tooling.md) |

Seven features moved onto the feature registry in this batch, each in a commit of its own: overnight
flashing, left on red, steady amber and bus lanes (batch A), and snow plows, lane closures and
passing cyclists (batch B), bringing it to 34 of 41 features
([proof](../../feature-interface.md#the-proof)). Vehicle and pedestrian meshes and feature frame
effects now go through the browser feature adapter (ROADMAP 3.10).

Each area was built in its own worktree and checked on its own Boat sandbox. Every area that touched
the simulation, the driving brain, the lab, the benchmark or routing ran the seeded Rules suites on
Kitsilano (seed 1, dry, `bare` and `city`) and all 62 challenge and road-test drives with Rules and
the cautious agent, before and after its change; all matched in every field except timings and run
provenance. The registry batches also compared city rain and snow and the 23:30 city drive.

The merged tree was then compared with the base commit `0583591` on one sandbox: see
[the merged comparison](#merged-comparison).

## Merged comparison

The merged tree at `78cbeb5` (every area branch, the registry merge and the integration fixes) was
compared with `0583591` on one xlarge Boat sandbox under Node 22, each tree with its own server and
`PYTHONHASHSEED=0`. Every field matched except timings and run provenance (`wall_ms`, compute and
decision latency, start and save times, and the source commit, date and dirty flag):

| Suite | Base | Merged | Fields |
|---|---|---|---|
| Kitsilano seed 1, Rules, `bare`, dry | 12/12 | 12/12 | match |
| Kitsilano seed 1, Rules, `city`, dry | 12/12 | 12/12 | match |
| Kitsilano seed 1, Rules, `city`, rain | 12/12 | 12/12 | match |
| Kitsilano seed 1, Rules, `city`, snow | 12/12 | 12/12 | match |
| Kitsilano seed 1, Rules, `city`, dry, 23:30 | 12/12 | 12/12 | match |
| Every challenge and both road tests, Rules | 62/62 | 62/62 | match, full results and the CLI report |
| Every challenge and both road tests, cautious agent | 62/62 | 62/62 | match, full results and the CLI report |

The review fixes that followed change no driving code on these paths: the cautious agent's cyclist pass
now comes from the passing-cyclist record in the same position, and the audit's fallback counter is back
where the base kept it. The stub model recording replays exactly and the Jev fixtures are current.

Combining the branches needed a few fixes of its own, each checked: tests that encoded an interface
another area deliberately changed, transit relations guarding a non-finite position before the
stricter `Vehicle.toLocal`, and pure pursuit accepting the turnaround's unbounded exit lane again.
