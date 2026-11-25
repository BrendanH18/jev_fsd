# Benchmark, CLI and developer tooling

These changes cover benchmark and Arena selection, trace and soak analysis, Node check planning, demo packaging, and the benchmark page. The seeded Rules comparisons use Kitsilano seed 1 in bare and city conditions.

1. Reject duplicate CLI options so a later flag cannot silently replace an earlier value. Validated by: test_bench_tooling.mjs.
2. Reject an unrelated service on the benchmark port before sending API requests. Validated by: test_bench_tooling.mjs.
3. Protect replay inputs and sibling outputs from hard-link, symbolic-link and path alias collisions. Validated by: test_bench_tooling.mjs.
4. Reject unsafe artifact destinations such as directories and dangling links before driving. Validated by: test_bench_tooling.mjs.
5. Name the file in errors from malformed compressed JSON. Validated by: test_bench_tooling.mjs.
6. Validate benchmark and Arena check modes before reaching the server. Validated by: test_bench_tooling.mjs.
7. Normalize whitespace and reject empty or duplicate IDs in CLI selections. Validated by: test_bench_tooling.mjs.
8. Reject malformed benchmark counts, seeds and traffic levels before reaching the server. Validated by: test_bench_tooling.mjs.
9. Reject invalid bounding boxes before asking the server to load one. Validated by: Boat CLI integration against the loopback server.
10. List generated benchmark routes and their tags without simulating them. Validated by: Boat CLI integration against the loopback server.
11. Allow benchmark runs to skip named routes while retaining suite order. Validated by: Boat CLI integration against the loopback server.
12. Start a benchmark at a named route without rebuilding a shorter suite. Validated by: Boat CLI integration against the loopback server.
13. Cap benchmark execution after applying route selection. Validated by: Boat CLI integration against the loopback server.
14. Reject benchmark selections that leave no routes. Validated by: Boat CLI integration against the loopback server.
15. Provide single-line JSON output from the Benchmark and Arena CLIs with quiet mode. Validated by: Boat CLI integration against the loopback server.
16. Report Benchmark and Arena drive starts on standard error with progress mode. Validated by: Boat CLI integration against the loopback server.
17. Support gzip compression for full Benchmark and Arena result reports. Validated by: Boat CLI integration against the loopback server.
18. Publish driving artifacts through a same-directory replacement so partial writes do not replace the previous copy. Validated by: test_bench_tooling.mjs.
19. List the Arena's authored drives with their conditions offline. Validated by: test_bench_tooling.mjs.
20. Select Arena drives by map. Validated by: test_bench_tooling.mjs.
21. Select Arena drives by province. Validated by: test_bench_tooling.mjs.
22. Select Arena drives by authored weather. Validated by: test_bench_tooling.mjs.
23. Select Arena drives by hazard. Validated by: test_bench_tooling.mjs.
24. Select Arena drives by difficulty. Validated by: test_bench_tooling.mjs.
25. Select Arena drives with destination parking. Validated by: test_bench_tooling.mjs.
26. Exclude named Arena drives. Validated by: test_bench_tooling.mjs.
27. Limit the number of selected Arena drives. Validated by: test_bench_tooling.mjs.
28. Report available Arena filter values when a selection contains a typo. Validated by: test_bench_tooling.mjs.
29. Preserve whole-recording submission checks by rejecting Arena subset filters in submission mode. Validated by: test_bench_tooling.mjs.
30. Compare trace positions with a dedicated tolerance in metres. Validated by: test_bench_tooling.mjs.
31. Compare trace headings with a dedicated tolerance in radians. Validated by: test_bench_tooling.mjs.
32. Compare trace speeds with a dedicated tolerance in metres per second. Validated by: test_bench_tooling.mjs.
33. Treat sub-tolerance trace differences as failures when exact comparison is requested. Validated by: test_bench_tooling.mjs.
34. Compare traffic identities exactly even under a permissive numeric pose tolerance. Validated by: test_bench_tooling.mjs.
35. Identify the trace side and tick when a capture contains a malformed step. Validated by: test_bench_tooling.mjs.
36. Count all divergent decision ticks in trace summaries. Validated by: test_bench_tooling.mjs.
37. Count ticks with unmatched traffic in trace summaries. Validated by: test_bench_tooling.mjs.
38. Include context around the final tick when only the trace verdict differs. Validated by: test_bench_tooling.mjs.
39. Write trace comparisons directly to a plain or compressed report file. Validated by: test_bench_tooling.mjs.
40. Emit compact trace comparison JSON for downstream tools. Validated by: test_bench_tooling.mjs.
41. Retry a selected soak configuration by its shard-local ID. Validated by: test_bench_tooling.mjs.
42. Exclude named configurations from a soak shard. Validated by: test_bench_tooling.mjs.
43. Reject unsupported weather while previewing a soak plan. Validated by: test_bench_tooling.mjs.
44. Reject duplicate soak maps or seeds so shard IDs remain unique. Validated by: test_bench_tooling.mjs.
45. Complete empty soak shards without reaching a server. Validated by: test_bench_tooling.mjs.
46. Keep soak standard output to one final JSON line in quiet mode. Validated by: test_bench_tooling.mjs.
47. Announce the current soak configuration on standard error. Validated by: test_bench_tooling.mjs.
48. Stop a soak after its first failed configuration and report remaining IDs. Validated by: test_bench_tooling.mjs.
49. Allow soak runs to enforce each drive's full audit verdict. Validated by: test_bench_tooling.mjs.
50. Allow soak runs to require the requested route count. Validated by: test_bench_tooling.mjs.
51. Write compressed soak reports with a gzip suffix. Validated by: test_bench_tooling.mjs.
52. Document local Node runner options in command-line help. Validated by: test_bench_tooling.mjs.
53. Preview Node checks in dispatch order without executing them. Validated by: test_bench_tooling.mjs.
54. Select Node checks by a substring in their basenames. Validated by: test_bench_tooling.mjs.
55. Exclude Node checks by a substring in their basenames. Validated by: test_bench_tooling.mjs.
56. Report missing check files and empty selections before starting workers. Validated by: test_bench_tooling.mjs.
57. Bound Node check timeouts to the supported timer range. Validated by: test_bench_tooling.mjs.
58. Accept inline Node flags and reject a missing flag value. Validated by: test_bench_tooling.mjs.
59. Allow file paths after an explicit option terminator in the Node runner. Validated by: test_bench_tooling.mjs.
60. Show output from passing Node checks on demand. Validated by: test_bench_tooling.mjs.
61. Stop dispatching new Node checks on the first failure when requested. Validated by: test_bench_tooling.mjs.
62. Export Node check outcomes and retained failure logs as JSON. Validated by: test_bench_tooling.mjs.
63. Emit structured data for the full CI shard plan or an individual shard. Validated by: test_bench_tooling.mjs.
64. Find the shard that owns a named check. Validated by: test_bench_tooling.mjs.
65. Replan CI shards against an alternate timing table. Validated by: test_bench_tooling.mjs.
66. Report missing timings in strict shard-planner mode. Validated by: test_bench_tooling.mjs.
67. Reject invalid measured durations in shard-planning inputs. Validated by: test_bench_tooling.mjs.
68. Ignore directories whose names resemble Node checks. Validated by: test_bench_tooling.mjs.
69. Distribute zero-duration checks across equally loaded shards. Validated by: test_bench_tooling.mjs.
70. Reject conflicting CI shard views and unknown options. Validated by: test_bench_tooling.mjs.
71. Verify an already packaged demo without rewriting it. Validated by: test_demo_artifact.py.
72. List the demo's bundled map catalog without building an artifact. Validated by: test_demo_artifact.py.
73. Refuse demo output paths inside project data, docs, code or metadata. Validated by: test_demo_artifact.py.
74. Check that demo page links resolve under a subdirectory deployment. Validated by: test_demo_artifact.py.
75. Check that local demo navigation fragments target existing elements. Validated by: test_demo_artifact.py.
76. Require the Rules-only boot marker on each demo page. Validated by: test_demo_artifact.py.
77. Reject demo pages containing a local Jev session token. Validated by: test_demo_artifact.py.
78. Check that the demo's Three.js import aliases resolve to bundled files. Validated by: test_demo_artifact.py.
79. Require attribution, license and deployment assets in the generated demo. Validated by: test_demo_artifact.py.
80. Reject server-side source or environment files found in a demo artifact. Validated by: test_demo_artifact.py.
81. Check the demo catalog and each map's pack version, bounds, clock and layers against the source. Validated by: test_demo_artifact.py.
82. Validate the packaged leaderboard format and catalog references. Validated by: test_demo_artifact.py.
83. Check that the bundled published replays match their source artifacts. Validated by: test_demo_artifact.py.
84. Require valid metadata and result objects when saving a demo benchmark. Validated by: test_bench_view.mjs.
85. Give demo saves unique names and recording timestamps even when two share a millisecond. Validated by: test_bench_view.mjs.
86. Read a summary-only demo history listing without loading per-drive results into the controls. Validated by: test_bench_view.mjs.
87. Keep valid demo history entries when storage contains corrupt or duplicate records. Validated by: test_bench_view.mjs.
88. Recover from demo storage quota errors by evicting the oldest runs before giving up. Validated by: test_bench_view.mjs.
89. Identify the bundled data file in demo asset-load errors. Validated by: test_bench_view.mjs.
90. Reject unsupported demo API routes without fetching a map. Validated by: test_bench_view.mjs.
91. Show benchmark differences only when conditions and completed route sets are comparable. Validated by: test_bench_view.mjs.
92. Search browser benchmark rows by route ID, failure or simulation error. Validated by: test_bench_view.mjs.
93. Offer the built-in Cautious driver on the benchmark page. Validated by: test_bench_view.mjs.
94. Let the browser benchmark run without saving a record. Validated by: test_bench_view.mjs.
95. Collect incident diagnostics and choose covering rows through browser benchmark controls. Validated by: test_bench_view.mjs.
96. Validate browser suite parameters and prevent concurrent runs from overwriting the active run. Validated by: test_bench_view.mjs.
97. Keep completed browser drives when stopped and show queued drives as skipped. Validated by: test_bench_view.mjs.
98. Avoid reporting an interrupted browser replay as exact. Validated by: test_bench_view.mjs.
99. Include verdict details in benchmark exports and name files after the run conditions. Validated by: test_bench_view.mjs.
100. Show flagged choices in open-track browser benchmark results. Validated by: test_bench_view.mjs.
