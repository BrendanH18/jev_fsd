# Challenges, practice, arena and leaderboard

This batch improves practice, road tests, replay, Arena and the leaderboard, and adds regression coverage for their saved data and driving verdicts. The authored challenge catalog and published model coverage are unchanged. No new challenge requires a model result.

1. Search the library by published drive ID and authored conditions as well as descriptive text. Validated by: `scripts/test_practice_library.mjs`.
2. Treat two spellings of the latest practice timestamp as one attempt. Validated by: `scripts/test_practice_library.mjs`.
3. Keep the latest practice timestamp when recording an older report. Validated by: `scripts/test_practice_library.mjs`.
4. Treat two spellings of the latest road-test timestamp as one attempt. Validated by: `scripts/test_practice_library.mjs`.
5. Prefer the earlier road-test attempt when verdict and marks tie. Validated by: `scripts/test_practice_library.mjs`.
6. Keep the last road-test date independent of a newly saved best attempt. Validated by: `scripts/test_practice_library.mjs`.
7. Preserve practice progress when the road-test half of a reset fails. Validated by: `scripts/test_practice_library.mjs`.
8. Round-trip a mixed practice and road-test backup into a clean profile. Validated by: `scripts/test_practice_library.mjs`.
9. Keep unrelated app settings when clearing both progress stores. Validated by: `scripts/test_practice_library.mjs`.
10. Tell drivers when an eligible road-test verdict could not be saved. Validated by: `scripts/test_road_test.mjs`.
11. Check that a road-test result at the exact demerit allowance still passes. Validated by: `scripts/test_road_test.mjs`.
12. Check that a coaching score of zero does not change a clean examiner verdict. Validated by: `scripts/test_road_test.mjs`.
13. Check that an ordinary street kerb contact does not count as a parking demerit. Validated by: `scripts/test_road_test.mjs`.
14. Check that the examiner prefers the move-over event when both roadside audits fire. Validated by: `scripts/test_road_test.mjs`.
15. Check that the examiner attaches a dangerous-action mark to its own incident. Validated by: `scripts/test_road_test.mjs`.
16. Check that following-gap demerits accumulate with exposure and cap at three. Validated by: `scripts/test_road_test.mjs`.
17. Check that minor speeding becomes a dangerous violation only above ten seconds. Validated by: `scripts/test_road_test.mjs`.
18. Check that a brief road-edge excursion is a demerit and one second is a failure. Validated by: `scripts/test_road_test.mjs`.
19. Check that either direction of parking misalignment can earn a demerit. Validated by: `scripts/test_road_test.mjs`.
20. Check that a completed test retains a clean pass at each parking demerit boundary. Validated by: `scripts/test_road_test.mjs`.
21. Check that queuing away from the line does not mask a later stop over it. Validated by: `scripts/test_road_test.mjs`.
22. Check that the first valid stop governs even when the driver stops again past the line. Validated by: `scripts/test_road_test.mjs`.
23. Recover the replay cursor and interpolation from nonnumeric inputs. Validated by: `scripts/test_replay.mjs`.
24. Decline incident playback when a retained checkpoint lacks drive state. Validated by: `scripts/test_replay.mjs`.
25. Keep the original checkpoint when a branch request is outside the recording bounds. Validated by: `scripts/test_replay.mjs`.
26. Prevent empty or nonnumeric branch requests from invalidating recording identity. Validated by: `scripts/test_replay.mjs`.
27. Preserve sparse arrays and their trailing empty slots in a checkpoint. Validated by: `scripts/test_replay.mjs`.
28. Check that a checkpoint preserves identity across map keys and set members. Validated by: `scripts/test_replay.mjs`.
29. Check that shared renderer handles retain identity across simulation checkpoints. Validated by: `scripts/test_replay.mjs`.
30. Check that branching trims only future incident markers. Validated by: `scripts/test_replay.mjs`.
31. Check that restoring replay spend cannot decrease live model usage counters. Validated by: `scripts/test_replay.mjs`.
32. Check that restoring a replay cannot rewind to another attempt in the same buffer. Validated by: `scripts/test_replay.mjs`.
33. Check that a shared drive link round-trips zero-valued settings. Validated by: `scripts/test_replay.mjs`.
34. Use clean filename separators when a download slug ends at its length cap. Validated by: `scripts/test_replay.mjs`.
35. Check that a score-card filename uses the challenge ID and requested image extension. Validated by: `scripts/test_replay.mjs`.
36. Check that copying a drive link offers the exact URL when clipboard access is denied. Validated by: `scripts/test_replay.mjs`.
37. Keep complete Unicode characters when truncating score-card titles. Validated by: `scripts/test_replay.mjs`.
38. Run a road-tests-only Arena evaluation without running any short challenges. Validated by: `scripts/test_arena_history.mjs`.
39. Check that city selections honor the optional road-test setting. Validated by: `scripts/test_arena_history.mjs`.
40. Check that an individual-drive selection can combine road tests and challenges in authored order. Validated by: `scripts/test_arena_history.mjs`.
41. Search Arena attempts by multiple accent-insensitive terms across map, challenge and driver. Validated by: `scripts/test_arena_history.mjs`.
42. Filter Arena rows by track while preserving older guarded results. Validated by: `scripts/test_arena_history.mjs`.
43. Distinguish a simulation error from a driving failure in Arena verdicts and filters. Validated by: `scripts/test_arena_history.mjs`.
44. Filter Arena incident timelines by event type without reordering their entries. Validated by: `scripts/test_arena_history.mjs`.
45. Reject invalid map-pack versions while reading older named versions. Validated by: `scripts/test_arena_history.mjs`.
46. Reject impossible coaching model versions on imported results. Validated by: `scripts/test_arena_history.mjs`.
47. Reject oversized repeat counts that cannot represent an exact count. Validated by: `scripts/test_arena_history.mjs`.
48. Reject nontext errors in event-linked decision records. Validated by: `scripts/test_arena_history.mjs`.
49. Validate a full incident timeline indexed by stable decision IDs. Validated by: `scripts/test_arena_history.mjs`.
50. Decline to compare attempts interrupted by a simulation error. Validated by: `scripts/test_arena_history.mjs`.
51. Check that absent conditions block comparison even when both exports omit them. Validated by: `scripts/test_arena_history.mjs`.
52. Check that comparison reports the closest mismatch if several baseline attempts differ. Validated by: `scripts/test_arena_history.mjs`.
53. Check that lockstep timing exports keep zero latency distinct from unmeasured latency. Validated by: `scripts/test_arena_history.mjs`.
54. Check that an unknown imported run status becomes imported without changing its timestamp. Validated by: `scripts/test_arena_history.mjs`.
55. Check that an interrupted result remains in the attempt denominator. Validated by: `scripts/test_arena_history.mjs`.
56. Check that timeline exports clip an extended event message to the import limit. Validated by: `scripts/test_arena_history.mjs`.
57. Check that a capped event timeline keeps its previous full decision context intact. Validated by: `scripts/test_arena_history.mjs`.
58. Check that previewing a compact trace does not prevent its latest decision from gaining context. Validated by: `scripts/test_arena_history.mjs`.
59. Check that different fallback reasons remain distinguishable in the compact decision trace. Validated by: `scripts/test_arena_history.mjs`.
60. Check that identical manoeuvres with different hazard warnings do not fold together. Validated by: `scripts/test_arena_history.mjs`.
61. Check that compact traces preserve who made a decision when the manoeuvre stays the same. Validated by: `scripts/test_arena_history.mjs`.
62. Check that an incident before the first decision has no invented age or decision ID. Validated by: `scripts/test_arena_history.mjs`.
63. Check that consecutive measurements report only newly observed hard braking. Validated by: `scripts/test_arena_history.mjs`.
64. Check that the off-road threshold records exactly one evaluation event. Validated by: `scripts/test_arena_history.mjs`.
65. Check that the IndexedDB history budget counts UTF-8 bytes for multilingual incident text. Validated by: `scripts/test_arena_storage.mjs`.
66. Check that a serialized copy of a chosen baseline survives IndexedDB eviction. Validated by: `scripts/test_arena_storage.mjs`.
67. Check that invalid IndexedDB saves are rejected before history can be evicted. Validated by: `scripts/test_arena_storage.mjs`.
68. Check that migration keeps valid entries alongside malformed legacy runs. Validated by: `scripts/test_arena_storage.mjs`.
69. Check that deleting one duplicate fallback entry leaves the other copy. Validated by: `scripts/test_arena_storage.mjs`.
70. Fetch each map once per Arena evaluation even when several drives share it. Validated by: `scripts/test_arena_browser.py`.
71. Announce the visible attempt count when Arena search changes. Validated by: `scripts/test_arena_browser.py`.
72. Show duration deltas on matching Arena attempts. Validated by: `scripts/test_arena_browser.py`.
73. Close Arena details and return keyboard focus to the inspected row. Validated by: `scripts/test_arena_browser.py`.
74. Show tracks explicitly when viewing a mixed imported run. Validated by: `scripts/test_arena_browser.py`.
75. Keep a measured Open Track flag count distinct from an unmeasured Guarded count. Validated by: `scripts/test_arena_browser.py`.
76. Export the current Arena track selection in CSV. Validated by: `scripts/test_arena_browser.py`.
77. Clear the Arena filters together and resume keyboard search. Validated by: `scripts/test_arena_browser.py`.
78. Reject a results file whose driver catalog is a list or scalar. Validated by: `scripts/test_results_page.mjs`.
79. Label unknown driver IDs literally even when they are inherited object keys. Validated by: `scripts/test_results_page.mjs`.
80. Select an available leaderboard suite by its shareable URL value. Validated by: `scripts/test_results_page.mjs`.
81. Filter leaderboard rows by whether every driver has a result. Validated by: `scripts/test_results_page.mjs`.
82. Sort unknown maps and weather after the catalogued conditions. Validated by: `scripts/test_results_page.mjs`.
83. Quote recording paths with spaces and apostrophes in copyable shell commands. Validated by: `scripts/test_results_page.mjs`.
84. Show unavailable model decision share when a measurement is nonnumeric. Validated by: `scripts/test_results_page.mjs`.
85. Leave missing leaderboard challenge results blank and keep the other drivers aligned. Validated by: `scripts/test_results_page.mjs`.
86. Return no published debrief baseline when driving conditions are unavailable. Validated by: `scripts/test_results_page.mjs`.
87. Check numeric ordering of double-digit suite versions. Validated by: `scripts/test_results_page.mjs`.
88. Check that each suite provenance label is human-readable. Validated by: `scripts/test_results_page.mjs`.
89. Check that open-only drivers retain their recorded cost and appear beyond the pilot section. Validated by: `scripts/test_results_page.mjs`.
90. Check that an unmeasured weather occupies an empty cell instead of inheriting a dry result. Validated by: `scripts/test_results_page.mjs`.
91. Check that summary totals for other maps use their dry conditions. Validated by: `scripts/test_results_page.mjs`.
92. Check that pass fractions aggregate numerators and denominators instead of averaging rates. Validated by: `scripts/test_results_page.mjs`.
93. Check that a numbered suite has no fallback ranking from a legacy cohort. Validated by: `scripts/test_results_page.mjs`.
94. Check that an older guarded drive can supply a debrief when the newest pack differs. Validated by: `scripts/test_results_page.mjs`.
95. Check that a published failure reason survives into a challenge debrief comparison. Validated by: `scripts/test_results_page.mjs`.
96. Check that a manifest replay source and engine override legacy metadata. Validated by: `scripts/test_results_page.mjs`.
97. Preserve the active suite in the leaderboard URL when its picker changes. Validated by: `scripts/test_browser_pages.py`.
98. See the best clean coaching score on a completed challenge card. Validated by: `scripts/test_browser_pages.py`.
99. See the pass count and attempt count together on each road-test card. Validated by: `scripts/test_browser_pages.py`.
100. Sort challenges by best clean score with unscored attempts last. Validated by: `scripts/test_browser_pages.py`.
