# Feature registry, final batch: the merged tree (ROADMAP 3.2)

The three final-batch branches ([transit and rail](transit.md), [emergency vehicles](emergency.md),
[destination parking and hidden hazards](parking-hazards.md)) were each proven identical to `8c34c637`
on their own. This check repeats the proof on their merge, `e8d687f0` (merge fix-ups included), with
the union of the captures the three branches used.

**Verdict: identical.** Apart from timings and run provenance, every capture of `e8d687f0` matches
`8c34c637`: all nine benchmarks, both arena drivers (traces, events and examiner sheets included) and
both system prompts. The committed model recording still replays.

## How it ran

Boat, one `xlarge` sandbox (16 vCPUs, 31 GB), Node 22.23.5, Python 3.12.3, lockstep, Rules brain
(and the cautious agent in the arena), seed 1, 12 routes per benchmark.

- **After** is the sandbox's checkout of this worktree at `e8d687f0` (synced tree
  `08a5f1a3ce5dd7e01fbef00526fa4f43ef50135d`, which is `e8d687f0^{tree}`). The benchmark manifests
  name the clone's base commit as `source_commit`, which the comparison ignores; the tree is what ran.
- **Before** is `git archive 8c34c637c2c506e5f8d11367fe17d97fa5cfcc87` unpacked into a separate
  directory, with the after tree's `scripts/registry_parity.mjs` copied into its `scripts/` (byte-identical
  copy; it supports `--park` and `--hour`).
- One loopback server per tree, started from that tree:
  `PYTHONHASHSEED=0 PORT=8331 uv run --locked server.py` (before) and `PORT=8332` (after).
  Each capture passed its tree's port through `PORT`.
- The 25 commands below ran as separate processes, 16 at a time, before and after side by side. Each
  step logged its exit code and duration, and the driver counted them: **25 of 25 steps ran, all exited 0**,
  arena steps included (139–165 s each; the longest step, the snow benchmark, took 1,469 s).

From each tree (`$out` its own output directory):

```sh
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" bare
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city kitsilano snow
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city --hour 23.5
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city --park 1
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city toronto
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city edmonton
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city calgary
node --experimental-default-type=module scripts/registry_parity.mjs bench "$out" city halifax --hour 23.5
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" rules
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" cautious
node --experimental-default-type=module scripts/registry_parity.mjs prompt "$out"
```

On the after tree only:

```sh
node --experimental-default-type=module scripts/test_model_recording.mjs
```

Then, with every capture named so a missing one fails rather than being skipped:

```sh
node --experimental-default-type=module scripts/registry_parity.mjs compare "$before" "$after" \
  --expect bare-dry.json,city-dry.json,city-snow.json,city-dry-hour-23.5.json,city-dry-park.json,toronto-city-dry.json,edmonton-city-dry.json,calgary-city-dry.json,halifax-city-dry-hour-23.5.json,arena-rules.json,arena-cautious.json,system-prompt.json
```

`compare` printed `identical` for all twelve files and exited 0.

## Results

| Capture (file) | Before | After | Compared |
|---|---|---|---|
| Kitsilano bare, dry (`bare-dry.json`) | 12/12, 10.53 km | 12/12, 10.53 km | identical |
| Kitsilano city, dry, 15:30 (`city-dry.json`) | 12/12, 12.81 km | 12/12, 12.81 km | identical |
| Kitsilano city, snow (`city-snow.json`) | 12/12, 13.65 km | 12/12, 13.65 km | identical |
| Kitsilano city, dry, 23:30 (`city-dry-hour-23.5.json`) | 12/12, 12.80 km | 12/12, 12.80 km | identical |
| Kitsilano city, dry, `--park 1` (`city-dry-park.json`) | 12/12, 12.64 km | 12/12, 12.64 km | identical |
| Toronto city, dry (`toronto-city-dry.json`) | 9/12, 10.65 km; `s1-6`, `s1-10`, `s1-11` fail | the same | identical |
| Edmonton city, dry (`edmonton-city-dry.json`) | 11/12, 13.17 km; `s1-11` fails (one failure to yield) | the same | identical |
| Calgary city, dry (`calgary-city-dry.json`) | 11/12, 11.58 km; `s1-6` fails (one failure to yield) | the same | identical |
| Halifax city, dry, 23:30 (`halifax-city-dry-hour-23.5.json`) | 10/12, 11.94 km; `s1-9`, `s1-10` fail | the same | identical |
| Arena, Rules: every challenge and both road tests (`arena-rules.json`) | 62/62 | 62/62 | identical (traces, events, examiner sheets) |
| Arena, cautious agent (`arena-cautious.json`) | 62/62 | 62/62 | identical |
| System prompts, guarded and open (`system-prompt.json`) | — | — | identical |
| `test_model_recording.mjs` (after) | — | 10 model recording checks passed | — |

These pass counts and distances agree with the per-branch notes for the captures they share
(Toronto 9/12, Edmonton 11/12, Calgary 11/12, Halifax 10/12, arena 62/62 for each driver).

A `--strict` comparison, run for information only, differed only in the fields the default
comparison discards: `started_at`, `wall_ms`, the run `name`, `saved_at` and the benchmark manifest's
`source_commit`/`source_dirty`.

## A note for the next run

The first driver script stopped its servers with `pkill -f server.py`. The pattern also matched the
remote shell, because that shell's command line contained the script text, so the shell was
killed after all 25 steps had finished but before `compare` ran. The captures were outside the clone,
so `compare` ran in a second step against the same files. Stop servers by their recorded PIDs, and
never `wait` without PIDs while a background server is running.
