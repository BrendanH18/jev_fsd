# Roadmap audit and expansion plan, 20 November 2026

An audit of [`ROADMAP.md`](../../ROADMAP.md) against the repository at `3ca3178` (#99), and the
input behind its [expansion plan](../../ROADMAP.md#expansion-plan-from-20-november). Read-only:
no tests, benchmarks, server or model calls were run for it.

Three reviewers worked independently from the same files: Claude Opus 5.5 (which wrote the plan),
GPT-6.2 Sol and Gemini 4 Neon. Sol and Neon were each given the roadmap, AGENTS.md, the README,
the model results, the Rules baseline, the feature interface and the git log, and asked for an audit
and a ranked set of workstreams.

## How the figures were measured

| Figure | Value | How |
|---|---|---|
| Python tests | 324 | `def test_` definitions under `tests/` (Sol counted the same by AST, in 32 files) |
| Node checks | 161 | `scripts/test_*.mjs`, the files `scripts/ci_shard.mjs` shards |
| Browser CI jobs | 4 | `.github/workflows/demo.yml` |
| Challenges, road tests | 60, 2 | `static/js/lab/challenges/*.js`; `ROAD_TESTS` |
| Maps | 12 packs in 11 cities | `data/maps/*.v6.pack.json`; `MAP_NAMES` in `scripts/build_results.py` |
| Opt-in features | 41 | rows of the feature table in AGENTS.md; `bench/features.js` counts 42 free-drive switches |
| Registered features | 9 | `FEATURES` in `static/js/sim/features/index.js` |
| `static/js` lines | 70,392 in 253 files | `wc -l` over tracked `.js` files under `static/js` |
| `sim/npc.js`, `brain/sensors.js` | 3,953 and 3,406 | `wc -l`; `NpcFleet.step` 959 lines, `buildSnapshot` 585 (Neon) |
| AGENTS.md | 37,787 bytes | `wc -c` |
| Reference pages | 54 | `docs/reference/*.md` |
| Parity known differences | 4 | `known_difference` in `tests/fixtures/parity_cases.json` |
| Recordings | 12 MB | `du -sh data/recordings`; each Claude Haiku 62-drive tape is about 4.5 MB |

**Line counts across #80 are not comparable.** Biome's formatting (#80, `aa6149c`) took `static/js`
from 44,706 to 69,111 lines, `sim/npc.js` from 2,698 to 3,997 and `brain/sensors.js` from 2,131 to
3,479, with no change in behaviour. Since #80, `static/js` has grown 1.9%, and `npc.js` and
`sensors.js` have shrunk by 44 and 73 lines while six features moved onto the registry. Neon read the
growth from 41,000 to 70,392 lines, and of the two core files, as sprawl; it is formatting.

## What the audit found

**Stale "Where we are".** It was measured on 9 November at `0b5bdd3` and still said 268 Python tests,
76 Node checks, about 32 features, about 41,000 lines, a demo with "Rules and browser agents only",
and Rules 6/12 on the city probe, with the conclusion that "the default free drive is not known to
work". All three reviewers found this. The city suite has passed since 10 November (48/48 on Kitsilano
in four weathers, 22/22 on the other maps), and the demo has had the leaderboard since 14 November and
a keyless model replay since 20 November.

**Phase 2 had not exited, though later phases had.** Its exit, and item 2.5, ask for a model on the city
suite; only Rules and the cautious agent have one. Item 2.5 still named DeepSeek as the LLM to run,
which the 20 November rule (live runs use Jev and Claude Haiku 5.5 only) now excludes. Sol: split 2.5
into the challenge comparison (done) and the city comparison (open). Neon: "Phases run in order" no
longer held, since Phases 4 and 5 exited before 2. Both are reflected in the roadmap.

**Phase 3's exit needs more than 3.2.** `docs/feature-interface.md` lists about eight driver and
presentation files a registered feature still needs a line in. Sol and Neon both found that moving
the remaining 32 features alone would not meet the exit. Added as 3.10.

**Replays.** Sol found that `arena_node.mjs --check 1` fails a replay whose recorded drive failed,
even when it replays exactly, so a published failure cannot be verified as a replay; Neon found that
CI replays only the stub tape, so published tapes drift silently. The 11 November Jev and DeepSeek tapes
replay exactly on 54 of 62 drives. Jev's open-track tape was checked again at #99; Claude Haiku's has
not been checked since #95. Phase 7.3 and 7.7.

**Router nondeterminism, never scheduled.** `snap` in `jev/routing.py` breaks ties in `set` order,
so a re-plan depends on Python's hash seed (found in 3.1). Neon proposed fixing it; it is now 7.1 and
comes before the model city runs, since road-closure re-plans happen there.

**Smaller corrections.** 2.7's browser replay landed 20 November (#98), not 14 November; 3.8 has four
known differences, not three; 5.4 has 54 pages; 3.4's AGENTS.md is 37.8 KB with 41 rows, not 28 KB
with 32; 3.7 has four browser jobs; #97 and #98 (offline reports and run comparison) were missing (now
2.8); the changelog's Unreleased section says "Nothing yet" after four PRs (5.7); 5.6 tracked one
machine's branches and worktrees, not the repository (dropped); D1, D3 and D4 were decided but still
read as open; D2's spend stopped at $8.36 (about $144 now, $116 of it a dropped Claude Sonnet run);
"Done so far" stopped on 9 November.

**Phase exits checked.** Phase 0: met, with the browser comparison made on an identical local build
because the public preview timed out. Phase 1: met; 1.8 stays open. Phase 4: met on one run of each
model; Neon noted that most of Claude Haiku's 216 flagged choices never became violations, and that
its guarded `on-your-bumper` failure has not been looked into. Phase 5: met (`v0.3.0` tagged, README
leads with the statement and results).

## The input

### GPT-6.2 Sol

Ranked: (1) a matched city comparison of all four drivers on the same 12 routes, with a one-route
pilot first; (2) durable evidence: a manifest per published run, replay checks that accept an exactly
reproduced failure, and tracing one V8/WebKit difference; (3) generalisation: predeclared repeats,
flags, violations, interventions and fallbacks reported apart, models on held-out routes; (4) a
keyless human comparison on the public demo; (5) growth one lesson at a time, starting with a
multi-hazard drive on an existing map. A 1.0 gate of (1), (2) and the human comparison. Risks:
nondeterminism, fallbacks masking the model, over-reading one tuned set or predicted flags. Park bulk
maps, photorealism and re-recording old tapes.

### Gemini 4 Neon

Ranked: (1) credibility: deterministic snapping, Jev and Claude Haiku on the city and held-out routes,
repeats with variance bands, a versioned submission format with an offline verifier, a CI drift
report; (2) human against AI on the demo: the drive report beside published results, a replay gallery,
scores on `/results`, a share card; (3) finish the feature interface, including the missing hooks and
breaking up `NpcFleet.step` and `buildSnapshot`; (4) sharper diagnostics: decide what a flagged choice
costs, look into Claude Haiku's losses, a hard city slice, compound road tests; (5) contributor
workflow: a check-your-agent script, an issue template, recordings out of Git; (6) new cities only for
a rule the others lack, after (3). Park new single-hazard challenges and new cities; cut 5.6; use
submissions rather than paying for more providers.

### Where they differed, and what the plan does

| Question | Sol | Neon | Plan |
|---|---|---|---|
| First item | The city comparison | Determinism, then the city comparison | 7.1 first (S), then 2.5b: re-plans on the city suite depend on the hash seed |
| Outside submissions | Not raised | A versioned bundle and verifier | Phase 10, after the manifest (7.2) settles the format |
| Phase 3 | Exit not met; not a workstream | Workstream 3, before new mechanics | Runs alongside 1 to 3; new scenarios wait for its exit (D3) |
| Core sprawl as a risk | Not raised | Top-three risk | Not a risk: the growth is formatting (above); the registry is shrinking the core |
| Recordings in Git | Not raised | Move to release assets | Slim first; moving them is a change of service for the owner (D8) |
| 1.0 | City comparison, durable evidence, human comparison | Phase 2's exit | Sol's gate, narrowed to 7.1 to 7.3 and 8.1 (D6) |
| Share card, compound road tests in named cities | — | Proposed | 8.x left open; compound drives (9.3) on existing maps under the admission rule |
