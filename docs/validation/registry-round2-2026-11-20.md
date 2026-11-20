# Feature registry, round two: puddles, black ice and snowbanks — 2026-11-20 (ROADMAP 3.2)

Puddles, black ice and snowbanks moved onto the feature registry ([feature interface](../feature-interface.md)),
one commit each on top of `3183f9a`: puddles, then black ice, then snowbanks. Each commit was compared
with the untouched tree. "Identical" means every result field but the timings (`wall_ms`, decision
latency), as in [the Rules baseline](../rules-baseline.md).

## What was compared

Each tree came from `git archive` of its commit, so nothing uncommitted took part. Lockstep, Node
22.23.4, the Kitsilano map, one server started with
`PORT=8331 PYTHONHASHSEED=0 uv run server.py`, the runs one at a time.

| Run | What it covers | Before (`3183f9a`) |
|---|---|---|
| Kitsilano bare, dry, suite seed 1 (Rules) | every opt-in feature off | 12/12, 10.53 km |
| Kitsilano city, dry, seed 1 (Rules) | the free drive's features | 12/12, 12.81 km |
| Kitsilano city, **snow**, seed 1 (Rules) | snowbanks on all 12 routes (`snowbank_conflicts` reported), black ice met on `s1-9` (`ice_overspeed` reported) | 12/12, 13.65 km |
| Kitsilano city, **rain**, seed 1 (Rules) | puddles placed, sensed and avoided by traffic; no route came up to one with someone beside it, so `pedestrians_splashed` is not reported | 12/12, 12.61 km |
| Every challenge and both road tests, Rules | 62 drives, each drive's whole comparable result (decision trace and events included); among them "Don't splash", "Bridges freeze first", "One car at a time", "Pothole season", "Goose crossing" and "Road closed" | 62/62 pass |
| The same with the cautious agent | 62 drives | 62/62 pass |
| `scripts/test_model_recording.mjs` | the stub model's whole recorded drive, prompts included | passes |

The bench runs compare `bench_node.mjs --json` (config, summary and every drive's result, events
included). The challenge runs compare `comparableResult` of each `evaluateChallenge` result, with any
latency field removed, through a small harness kept out of the repository (it loads `CHALLENGES` and
`ROAD_TESTS` and calls `evaluateChallenge(map, challenge, { brain })` for each).

```sh
PORT=8331 PYTHONHASHSEED=0 uv run server.py
node --experimental-default-type=module scripts/bench_node.mjs --features bare --seed 1 --json bare.json
node --experimental-default-type=module scripts/bench_node.mjs --features city --seed 1 --json city.json
node --experimental-default-type=module scripts/bench_node.mjs --features city --seed 1 --weather snow --json citysnow.json
node --experimental-default-type=module scripts/bench_node.mjs --features city --seed 1 --weather rain --json cityrain.json
# every challenge and road test, Rules and the cautious agent: comparableResult of each drive
node --experimental-default-type=module scripts/test_model_recording.mjs
```

## Result: identical

| Commit | Bare | City | City snow | City rain | Challenges, Rules | Challenges, cautious | Model recording |
|---|---|---|---|---|---|---|---|
| Puddles (`57f77d0`) | identical | identical | identical | identical | 62/62 identical | 62/62 identical | passes |
| Black ice (`e89a559`) | identical | identical | identical | identical | 62/62 identical | 62/62 identical | passes |
| Snowbanks (`57a13d4`, all three moved) | identical | identical | identical | identical | 62/62 identical | 62/62 identical | passes |

No field differed in any run. `SYSTEM_PROMPT` is byte for byte the same string after each commit.

The server was restarted once, during the snowbanks run (every process this session had started was
stopped from outside at 10:29). The untouched tree was run again on the new server before the black ice
and snowbanks commits, so each pair above shares a server process: puddles against the second server's
baseline, black ice and snowbanks against the third's. The two baselines, and the first partial one from
the very first server, are identical to each other in every field, as `PYTHONHASHSEED=0` should make them.

## Other checks

`scripts/test_feature_registry.mjs` (now six records, each core file free of their names, the cycle-safe
`hooks()` exercised by loading the registry first), 58 `scripts/test_*.mjs` checks touching the moved
features, emergency vehicles, potholes, geese, road closures, parking, hidden hazards, free drives, bench
options and the drive lab (all pass), `scripts/build_jev_fixtures.mjs --check` (no stale fixture), the
Python tests (301 pass), Ruff and Biome. The browser tests at `/tests` and the Playwright suites were
left to CI.
