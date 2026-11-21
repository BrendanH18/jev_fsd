# City model pilots

Run one Kitsilano dry city drive for Jev and one for Claude Haiku 5.5 before
recording the 12-route comparison in [2.5b](../../ROADMAP.md#phase-2-put-the-models-on-the-road).
Use suite seed 1 and drive `s1-1` for both pilots. The full suite uses the same
settings and includes all 12 drives. Keep separate recordings for the pilots.

Use separate loopback servers in Boat, one key per sandbox, on the same committed
tree and Node version. Use Claude Haiku 5.5 through the Claude Platform at low
effort. Set `JEV_FSD_BUDGET_USD` on each server and give each pilot enough
`JEV_FSD_RPM` to stay within the provider's rate limit. Check each provider's
bill against the server's spend before allocating the rest of [D7](../../ROADMAP.md#open-decisions).

```sh
node --experimental-default-type=module scripts/bench_node.mjs \
  --port 8331 --map kitsilano --features city --weather dry --seed 1 --count 12 \
  --only s1-1 --brain jev --record /tmp/jev-city-pilot.json.gz \
  --json /tmp/jev-city-pilot.json --prompt-audit /tmp/jev-city-pilot-prompts.json

node --experimental-default-type=module scripts/bench_node.mjs \
  --port 8332 --map kitsilano --features city --weather dry --seed 1 --count 12 \
  --only s1-1 --brain llm:claude-haiku-5-5 --record /tmp/haiku-city-pilot.json.gz \
  --json /tmp/haiku-city-pilot.json --prompt-audit /tmp/haiku-city-pilot-prompts.json
```

Record the model that answered, calls, input tokens, model share, fallbacks,
maximum instruction length by question and cost. Investigate rate-limit or
instruction-limit fallbacks before using a pilot to estimate a complete run.
Compare Jev's instructions with the 4,000-character target. The prompt audit
counts characters. The benchmark and provider usage report token counts.

Use the measured spend to set a per-drive reserve for the full recording
(`--reserve` in dollars). A reserve stops the benchmark before starting a
drive when the configured server budget has too little left. Replay the pilots
before running the full suite, with `--replay <recording> --check replay` and
a keyless server on the same tree. The replay verdict and driving verdict
are independent.

## 21 November 2026

Kitsilano `s1-1`, city dry and guarded, was recorded on `9b53a07` with
Node 22.23.4. The Jev response identified `jev-1.14.0` on all 389 calls. Its
largest vector, motion and headlight instructions were 1,633, 1,020 and 44
characters. Jev made 389 of the 416 decisions, with 27 answered locally and
zero fallbacks. The 95th-percentile provider latency was 202 ms.

Jev arrived in 111.9 seconds. It failed after the car collided with a pedestrian
on West Broadway at 72.4 seconds, 0.1 seconds after the emergency brake engaged.
The keyless replay consumed all 389 recorded outcomes and reproduced the
collision and verdict exactly. The server counted $0.055140 from 1,312,851
input tokens, consistent with the [published TypeSafe rate](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost).

Claude Haiku 5.5 timed out at 226.0 seconds after covering 41.1% of the
route. It made 857 of 870 decisions. One request fell back after a connection
reset returned HTTP 502. The system prompt was 19,867 characters and the
95th-percentile provider latency was 2,590 ms. Keyless replay reproduced the
timeout and used all 858 recorded outcomes. The server counted $0.268564 from
7,463,357 input and 147,311 output tokens at the
[published Claude rates](https://platform.claude.com/docs/en/models/haiku-5-5/overview).

The pilots cost $0.3237 on this usage basis. The owner approved using
provider-reported usage at published rates to track spend for the complete
city runs. Both `s1-1` recordings are included in their respective suites.
The remaining routes ran in separate provider processes against separate
loopback servers, with $3 (Jev) and $10 (Haiku) caps across the additional
routes. Each completed part keeps its own report, tape and prompt measurements.

## Complete city suites

All four drivers used the 12 dry Kitsilano city routes from seed 1, with 40 traffic cars,
the guarded track, and the lockstep clock. The reports record the clean source revision
`9b53a07` and Node 22.23.4. Every recorded route matched the independently regenerated
suite with fingerprint `1607d4bf5bdaaeec`.

| Driver | Passed | Model share | Fallbacks | Usage cost |
|---|---:|---:|---:|---:|
| [Rules](../../data/runs/20261121-075044-rules.json) | 12/12 | — | 0 | $0 |
| [Cautious](../../data/runs/20261121-075157-cautious.json) | 9/12 | — | 0 | $0 |
| [Jev 1.14.0](../../data/runs/20261121-075524-jev.json) | 2/12 | 99.3% | 0 | $2.447367 |
| [Claude Haiku 5.5, low effort](../../data/runs/20261121-092730-llmclaudehaiku55.json) | 3/12 | 95.9% | 18 | $7.812091 |

Jev passed `s1-6` and `s1-7`. Its remaining drives got stuck or collided. Haiku passed
`s1-6`, `s1-7` and `s1-12`. Its other drives timed out, got stuck or collided.
Haiku’s tape contains 17 HTTP 502 outcomes and one cancellation, with no HTTP 429 outcomes.

The independently calculated usage total was **$10.259457**, including the two pilot routes,
under the approved $30 cap. Jev reported 58,270,615 input tokens. Haiku reported 42,452,842
uncached input tokens, 118,762,920 cache-read tokens, 7,160 five-minute cache-write tokens,
and 4,756,565 output tokens. The calculation uses the published [TypeSafe rate](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost)
and the [Claude Haiku rates](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
for each token category.

Jev’s longest vector instruction was 3,006 characters, below the 4,000-character target.
Thirty-nine decisions on `s1-6` and `s1-12` exceeded the 5,500-input-token target.
The largest was 5,927 tokens. Those decisions received replies without falling back.
