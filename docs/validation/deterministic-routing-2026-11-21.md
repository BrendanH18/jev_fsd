# Deterministic route snapping

The router now breaks exact projection-distance ties by edge ID, then lane
index. Heading preference is applied before the tie-break. The same order
applies to the one closest lane per edge and to equally close goal edges.

## Server comparisons

Four loopback servers ran in Boat. Two served `b1d5283` with
`PYTHONHASHSEED=0` and `2`. The other two served the router change with seeds
`1` and `2`. All used CPython 3.12.3 and the same committed map data.

The comparison selected 48 origin and destination lane-end pairs per bundled
map using random seed 713. Each request asked for up to three alternatives with
turn restrictions enabled. The comparison used the entire `routes` array
returned by `POST /api/route`, excluding the request's `compute_ms`.

| Servers compared | Requests | Different responses |
|---|---:|---:|
| Original router, seeds 0 and 2 | 576 | 79 |
| Updated router, seeds 1 and 2 | 576 | 0 |

The first original disagreement was in Kitsilano from
`(-172.59, 81.19)` to `(506.87, -380.48)`, with no heading supplied.
The routing unit test separately exercises tied edges and lane indices,
conflicting headings, heading fallback and reversed lane input order. All
12 routing tests passed under seeds 0, 1 and 2 after the change.

## Kitsilano benchmark

Rules ran on Node 22.23.5 using suite seed 1 and 40 traffic cars. The
baseline server used hash seed 0. The patched servers used seed 2 for bare
dry and seed 1 for the city runs. Every per-drive field apart from wall-clock
timings and every summary field matched.

| Suite | Baseline passed | Patched passed | Changed results |
|---|---:|---:|---:|
| Bare, dry | 12/12 | 12/12 | 0 |
| City, dry | 12/12 | 12/12 | 0 |
| City, fog | 12/12 | 12/12 | 0 |
| City, rain | 12/12 | 12/12 | 0 |
| City, snow | 12/12 | 12/12 | 0 |

The five benchmark references remain valid.
