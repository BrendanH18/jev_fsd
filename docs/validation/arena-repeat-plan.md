# Open-track arena repeat plan

The [experiment definition](arena-open-repeats-v2.json) for [roadmap 7.5](../../ROADMAP.md#phase-7-results-that-hold-up)
calls for three repeats each of Jev and Claude Haiku 5.5 on the [v2 arena](../../data/suites/v2.json).
The plan was first written for suite `v1` and reissued for `v2` on 27 November 2026, before any repeat
was recorded: `v2` has the same drives, and exists because the
[lane-join parity fix](lane-join-parity-2026-11-26.md) changed results under `v1`'s conditions.
Each recording covers the 60 authored challenges and both road tests on the open track with the
lockstep clock, for 372 drives in total. Claude uses the Claude Platform at low effort.

Before recording, copy the plan outside the checkout and save the clean source commit as
`source_commit`, the exact runtime string as `engine` (for example `node v22.23.4`), and the resolved
Jev model as `drivers.jev.model`. Use those values for all six repeats and publish the copy with the
report. The compare script checks the authored drives and map fingerprints against the suite and
requires a common clean source and engine, and matching model, prompt and provider settings per driver.

Use a dedicated live Boat sandbox and a loopback server for each repeat after the owner approves
the repeat budget. Set the server budget and per-drive reserve in dollars before starting.
Use a distinct output path for each attempt and keep every completed repeat, including drives that
failed or fell back. If a reserve stops a run between drives, retain and disclose the incomplete
attempt separately. Keep the total within the approved budget and verify recorded usage against the
providers' charge. The repeat budget remains open in [D7](../../ROADMAP.md#open-decisions).

```sh
node --experimental-default-type=module scripts/arena_node.mjs --port 8331 \
  --set all --track open --brain "$driver" --reserve "$reserve_usd" \
  --record "$recording" --json "$report"
```

Replay all six recordings offline with `arena_node.mjs --replay "$recording" --check replay`
on the declared tree and runtime. Then compare them with the pinned plan.

```sh
node --experimental-default-type=module scripts/compare_repeats.mjs \
  --plan /tmp/arena-open-repeats-pinned.json \
  jev-1.json.gz jev-2.json.gz jev-3.json.gz haiku-1.json.gz haiku-2.json.gz haiku-3.json.gz \
  > arena-open-repeat-report.json
```

Publish each driver's score and pass count with its minimum, mean and maximum. Use `by_drive`
to check which failures and score differences recur on the same drive. Report flagged choices
per decision, audited counts or durations, emergency-brake interventions, fallbacks, model share
and cost separately. A flag records a predicted rule violation if the manoeuvre runs to completion.
The audit records what happened on the drive. With three repeats, report the observed range and
identify gaps whose ranges overlap.
