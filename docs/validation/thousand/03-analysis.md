# Offline analysis and results

These improvements cover saved-run analysis, replay and soak diagnostics, publication, and outside-driver tooling. The checks use saved artifacts, synthetic fixtures, and deterministic local simulation without model calls.

1. Filter saved-run analysis by one or more exact failure reasons. Validated by: test_inspect_run.py.
2. Filter mixed-map arena reports by the recorded drive map. Validated by: test_inspect_run.py.
3. Find both introduced and resolved occurrences of a selected failure reason in a comparison. Validated by: test_inspect_run.py.
4. Keep baseline map selection anchored to matched drive identities in comparisons. Validated by: test_inspect_run.py.
5. Reject duplicate drive IDs before comparison filters can conceal them. Validated by: test_inspect_run.py.
6. Accept saved reports with a UTF-8 byte order mark in plain and gzip files. Validated by: test_inspect_run.py.
7. Reject blank cohort values instead of silently selecting an empty cohort. Validated by: test_inspect_run.py.
8. Diagnose catalog search flags that are mistakenly used in run analysis. Validated by: test_inspect_run.py.
9. Diagnose saved-run inputs that are mistakenly passed to a catalog listing. Validated by: test_inspect_run.py.
10. Preserve the measurement denominator for count reports in table and spreadsheet exports. Validated by: test_inspect_run.py.
11. Flag a lost pass even when another drive gained a pass. Validated by: test_inspect_run.py.
12. Flag an increase in collisions on a single route even when the fleet total stayed flat. Validated by: test_inspect_run.py.
13. Exclude arena pairs with conflicting recorded driving conditions from matched regression coverage. Validated by: test_inspect_run.py.
14. Export retained events with their route, index, timestamp, and saved payload. Validated by: test_inspect_run.py.
15. Locate retained event timestamps that are invalid or move backwards within a drive. Validated by: test_inspect_run.py.
16. Show the failed drives behind each verdict reason with map and duration context. Validated by: test_inspect_run.py.
17. Make forensic report IDs discoverable through a dedicated searchable catalog. Validated by: test_inspect_run.py.
18. Preserve table rows when route identifiers contain carriage returns or line feeds. Validated by: test_inspect_run.py.
19. Keep saved HTML-like values and pipe delimiters literal in Markdown tables. Validated by: test_inspect_run.py.
20. Match published driver comparisons to the authored challenge version. Validated by: test_cli_tooling.mjs.
21. Match published driver comparisons to the map pack revision used for the drive. Validated by: test_cli_tooling.mjs.
22. Classify legacy rows without an explicit track as guarded in the local driver checker. Validated by: test_cli_tooling.mjs.
23. Report compact soak collision records even when the artifact has no route payload for the collision. Validated by: test_soak_summary.py.
24. Include compact soak audit records and their reasons in failed-route warnings. Validated by: test_soak_summary.py.
25. Merge compact and full soak evidence without inflating affected-route counts. Validated by: test_soak_summary.py.
26. Recognize simulation errors from a verdict label when the exception field is omitted. Validated by: test_soak_summary.py.
27. Recognize collisions from a verdict label when the collision counter is omitted. Validated by: test_soak_summary.py.
28. Keep an absent arrival measurement from counting as a stuck drive. Validated by: test_soak_summary.py.
29. Avoid duplicating timeout and stuck descriptions when both refer to the same timeout. Validated by: test_soak_summary.py.
30. Warn about audit evidence on a route whose saved verdict says it passed. Validated by: test_soak_summary.py.
31. Reject soak artifacts whose top-level JSON value is the wrong type. Validated by: test_soak_summary.py.
32. Require matching simulation conditions on request while permitting different drivers. Validated by: test_inspect_run.py.
33. Treat disabled features as a set when comparing run conditions. Validated by: test_inspect_run.py.
34. Detect artifacts that contain no route, classification, or harness evidence. Validated by: test_soak_summary.py.
35. Identify covering-row changes in saved-run comparisons. Validated by: test_inspect_run.py.
36. Identify simulation mode changes in saved-run comparisons. Validated by: test_inspect_run.py.
37. Reject duplicate results for the same route in one soak run. Validated by: test_soak_summary.py.
38. Reject string verdicts that could make a failing soak route look successful. Validated by: test_soak_summary.py.
39. Reject malformed failure labels before the soak formatter treats a string as individual reasons. Validated by: test_soak_summary.py.
40. Select one or more exact tape paths from the published replay matrix. Validated by: test_replay_drift.py.
41. Validate an independently supplied SHA-256 when inspecting a submission file. Validated by: test_cli_tooling.mjs.
42. Show duplicate claims for the same soak leg instead of arbitrarily choosing an artifact. Validated by: test_soak_summary.py.
43. Read a directly extracted soak artifact alongside nested artifact directories. Validated by: test_soak_summary.py.
44. Recover the directory name when an uploaded soak label contains only whitespace. Validated by: test_soak_summary.py.
45. Keep unreadable soak labels from blocking summaries of other legs. Validated by: test_soak_summary.py.
46. Accept UTF-8 byte order marks in soak artifacts and their labels. Validated by: test_soak_summary.py.
47. Summarize the number of readable, missing, and unreadable soak artifacts and the routes counted. Validated by: test_soak_summary.py.
48. Keep encoded newlines in soak data from becoming workflow annotation line breaks. Validated by: test_soak_summary.py.
49. Add a regression check that malformed soak JSON still leaves a successful report-only exit. Validated by: test_soak_summary.py.
50. Add a regression check that harness errors with no drives appear in the soak artifact report. Validated by: test_soak_summary.py.
51. Build a replay matrix from an alternate published results index. Validated by: test_replay_drift.py.
52. Filter the replay matrix by benchmark or arena runner. Validated by: test_replay_drift.py.
53. Report malformed matrix input with the input path and a concise CLI error. Validated by: test_replay_drift.py.
54. Accept alternate replay indexes saved with a UTF-8 byte order mark. Validated by: test_replay_drift.py.
55. Reject non-object replay manifests before inspecting their provenance. Validated by: test_replay_drift.py.
56. Diagnose invalid replay source revision types and engine identifiers without a type exception. Validated by: test_replay_drift.py.
57. Reject malformed dirty-status metadata that would otherwise masquerade as a clean source. Validated by: test_replay_drift.py.
58. Validate drive counts on the replay command before starting the application server. Validated by: test_replay_drift.py.
59. Allow the replay runner timeout to be configured in seconds. Validated by: test_replay_drift.py.
60. Give callers an opt-in failing exit status for replay drift or errors. Validated by: test_replay_drift.py.
61. Report a missing replay tape before starting a subprocess. Validated by: test_replay_drift.py.
62. Preserve a report when the target checkout revision cannot be read. Validated by: test_replay_drift.py.
63. Encode line breaks and percent signs in replay workflow annotations. Validated by: test_replay_drift.py.
64. Export publication input validation as a machine-readable verdict and error list. Validated by: test_results.py.
65. Add a regression check that duplicated replay fidelity lines are ambiguous. Validated by: test_replay_drift.py.
66. Add a regression check that replay runner termination by signal still reports the exit status. Validated by: test_replay_drift.py.
67. Check that inspection detects a published tape and report that disagree even when the tape checksum matches. Validated by: test_cli_tooling.mjs.
68. Identify the submission input path in JSON or gzip decoding errors. Validated by: test_cli_tooling.mjs.
69. Accept a UTF-8 byte order mark when inspecting a portable submission. Validated by: test_cli_tooling.mjs.
70. Reject submission files with invalid UTF-8 bytes before decoding replacement text. Validated by: test_cli_tooling.mjs.
71. Name the required flag that was omitted from a submission subcommand. Validated by: test_cli_tooling.mjs.
72. Reject submission options that do not belong to the selected subcommand. Validated by: test_cli_tooling.mjs.
73. Add a regression check that a packed gzip bundle can be inspected. Validated by: test_cli_tooling.mjs.
74. Add a regression check that packing refuses to overwrite an existing bundle. Validated by: test_cli_tooling.mjs.
75. Add a regression check that publication inspection identifies a missing companion tape. Validated by: test_cli_tooling.mjs.
76. Expose a way to run a local driver without reading published comparisons. Validated by: test_cli_tooling.mjs and the Boat driver smoke check.
77. Validate the driver evaluation set directly in the driver checker. Validated by: test_cli_tooling.mjs.
78. Require challenge IDs on report rows in a submission bundle. Validated by: test_submission_bundle.mjs.
79. Require a boolean verdict on every submitted report row. Validated by: test_submission_bundle.mjs.
80. Reject repeated challenge IDs in a submitted report. Validated by: test_submission_bundle.mjs.
81. Require reports to cover the challenges declared by their submission recording. Validated by: test_submission_bundle.mjs.
82. Reject recorded results stored under the wrong declared challenge. Validated by: test_submission_bundle.mjs.
83. Add a regression check that manifest verification rejects missing decision tapes. Validated by: test_submission_bundle.mjs.
84. Add a regression check that manifest verification rejects missing result rows independently of decision tapes. Validated by: test_submission_bundle.mjs.
85. Add a regression check that stopped drives cannot be verified for publication. Validated by: test_submission_bundle.mjs.
86. Add a regression check that simulation errors cannot be verified for publication. Validated by: test_submission_bundle.mjs.
87. Add regression coverage for verification diagnostics that distinguish drive-order, malformed result, and top-level report differences. Validated by: test_submission_bundle.mjs.
88. Include per-challenge verdict frequencies in repeat analysis. Validated by: test_merge_recordings.mjs.
89. Report duration spread for each challenge across repeats. Validated by: test_merge_recordings.mjs.
90. Report cost spread for each challenge across repeats. Validated by: test_merge_recordings.mjs.
91. Allow repeat reports to focus on a named driver. Validated by: test_merge_recordings.mjs.
92. Provide repeat-comparison CLI help without requiring recordings. Validated by: test_merge_recordings.mjs.
93. Reject arena repeats with unknown track metadata. Validated by: test_merge_recordings.mjs.
94. Diagnose malformed recorded challenge verdicts before computing repeat statistics. Validated by: test_merge_recordings.mjs.
95. Reject invalid drive costs before summing recording costs. Validated by: test_merge_recordings.mjs.
96. Reject run totals larger than the supported whole-microdollar precision. Validated by: test_merge_recordings.mjs.
97. Add a regression check that repeat comparisons reject model version changes within one driver. Validated by: test_merge_recordings.mjs.
98. Reject duplicate route verdicts during publication input validation. Validated by: test_results.py.
99. Refuse to regenerate a README with ambiguous results delimiters. Validated by: test_results.py.
100. Report results-generation errors without a traceback or partial writes caused by invalid input. Validated by: test_results.py.
