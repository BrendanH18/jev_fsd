# Drive Lab change inventory

| Area | Additions |
|---|---:|
| Individually selectable benchmark profiles | 973 |
| Map import and cache improvements | 10 |
| Benchmark and replay tool improvements | 9 |
| Arena history improvements | 8 |
| **Total** | **1,000** |

The [benchmark inspector](../reference/benchmarks.md#benchmark-profiles-by-route-cohort)
lists every new profile with `--list-profiles`. Each profile pairs a saved measurement with
a route grouping, such as emergency-brake interventions by flagged choice or time off road
by the number of mapped signals. The original 100 report IDs are outside this count.

## Map import and cache

1. Validate map CLI arguments and provide help for presets and west-negative coordinates.
2. Combine layer switches and limit rebuilds to the selected layers.
3. Include turn restrictions in full map imports.
4. Refresh raw downloads with `--refresh-osm`.
5. Run imports and migrations in a separate cache directory using `--maps-dir`.
6. Fall back from incomplete or invalid upstream XML responses.
7. Recover from invalid raw OSM caches.
8. Recover from unreadable or wrong-version compiled map packs.
9. Publish raw, pack and layer files atomically.
10. Preflight source versions and destination collisions before migrating v5 packs to v6.

## Benchmark and replay

1. Preserve merge inputs, including aliases through hard links, and isolate temporary output.
2. Reject empty arena shards or orphaned answers while accepting completed drives from stopped runs.
3. Reject stopped drives and extra tape entries in benchmark merges.
4. Name the damaged input file when a benchmark report or tape fails to parse.
5. Check traces with a numeric tolerance and locate missing ticks and changed result fields.
6. Reject contradictory replay jobs and invalid drift summaries.
7. Preserve runner diagnostics when a replay times out.
8. Verify that repeat comparisons use complete, distinct tapes from a clean source commit.
9. Report per-run measurements and failed drives alongside the spread of recorded costs.

## Arena history

1. Keep the selected baseline under the localStorage run limit.
2. Keep IndexedDB IDs unique after deletions so stale tabs cannot delete a different run.
3. Match complete runs and preserve duplicate counts when migrating localStorage history.
4. Preserve new fallback writes made during a history migration.
5. Retry quota failures raised by an individual IndexedDB request.
6. Preserve a comparison baseline when deleting a different run.
7. Serialize changes to saved history with evaluation and import saves.
8. Accept evaluation files up to 32 MiB for larger exports.
