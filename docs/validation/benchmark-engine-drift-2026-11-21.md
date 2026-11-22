# Benchmark engine drift, 21 November 2026

The tuned Kitsilano Rules drive `s1-1` was run in one Linux x86-64 Boat sandbox with
Node v22.23.5 (V8 12.4.254.21-node.57) and Bun 1.4.5 (JavaScriptCore). Both used the
same loopback server, seed 1, dry weather, the bare preset, 40 traffic cars and the
60 Hz lockstep runner. The map fingerprint, scenario and settings matched.

| First difference | Tick | V8 | JavaScriptCore |
|---|---:|---:|---:|
| Seventh traffic car's x position (m) | 0 | 116.40637475162136 | 116.40637475162137 |
| State difference above `1e-9`: 29th traffic car's x position (m) | 1884 | 524.1275289333397 | 524.1275289273093 |

Tick 0 is after world and fleet setup, before the first physics step. The first observed
drift is about `1.4e-14` m in `car_7`. Inspecting its spawn lane showed identical endpoints
(`[-1.35, -17]` and `[166.98, -21.16]`). The lane length, calculated by `Math.hypot` on
that segment, was `168.38139594385123` m in V8 and `168.3813959438512` m in JavaScriptCore.
Fleet spawning uses that length to pick a distance along the lane and interpolate the
starting position. Both runs passed in 5,227 ticks (87.1 s) with identical sampled Rules
decisions.

## Toronto city

The same runtimes and server ran Toronto `s1-1` from the two-route, dry city suite at seed 1.
Use `--map toronto --count 2 --features city` with both capture commands. Its matched traces
also differed before the first step. The second traffic car's heading was
`-2.8536609676894154` rad in V8 and `-2.853660967689415` rad in JavaScriptCore. The first
state difference above `1e-9` was the 33rd traffic car's y position at tick 733.
The first differing Rules decision was at tick 9414 (156.9 s), when V8 chose `drive` and
JavaScriptCore chose `stop`. Both passed. V8 arrived at 268.7 s and JavaScriptCore at 272.8 s.

The experiment uses Bun's JavaScriptCore build. Historical Safari WKWebView runs and
their verdicts are recorded separately in the [Rules baseline](../rules-baseline.md).
The [benchmark reference](../reference/benchmarks.md#trace-a-tuned-rules-drive-across-engines)
has the commands and the engine requirements for exact replay.
