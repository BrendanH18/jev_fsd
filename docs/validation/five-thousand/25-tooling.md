# CI and developer tooling

The Node runner and shard planner expose timing, failure and retry information. The workflows share local server readiness checks, the Boat wrapper handles sync and exit failures, and the parity tools validate fixtures and report capture drift.

1. Reject duplicate singleton runner options before dispatch. Validated by: `scripts/test_5k_tooling_runner.mjs`.
2. Explain how to pass check paths that begin with a hyphen when an unknown short option is encountered. Validated by: `scripts/test_5k_tooling_runner.mjs`.
3. Reject values supplied as standalone Node flags so a value cannot become the entry script. Validated by: `scripts/test_5k_tooling_runner.mjs`.
4. Reject Node flags that would substitute eval, syntax checking or another Node execution mode for a check. Validated by: `scripts/test_5k_tooling_runner.mjs`.
5. Offer the input-order dispatch mode for reproducing a particular sequence of checks. Validated by: `scripts/test_5k_tooling_runner.mjs`.
6. Offer alphabetical dispatch for investigating order-dependent failures. Validated by: `scripts/test_5k_tooling_runner.mjs`.
7. Allow the Node runner to load alternate timing data when investigating dispatch balance. Validated by: `scripts/test_5k_tooling_runner.mjs`.
8. Make the timeout's SIGTERM grace period configurable, including immediate termination. Validated by: `scripts/test_5k_tooling_runner.mjs`.
9. Bound the Node runner’s retained output to the configured byte count and allow zero retention. Validated by: `scripts/test_5k_tooling_runner.mjs`.
10. Suppress per-check success messages with quiet mode. Validated by: `scripts/test_5k_tooling_runner.mjs`.
11. Make the number of checks in the slowest list configurable. Validated by: `scripts/test_5k_tooling_runner.mjs`.
12. Rerun only failed checks from a previous Node report. Validated by: `scripts/test_5k_tooling_runner.mjs`.
13. Provide a separate switch for including skipped checks when rerunning a previous report. Validated by: `scripts/test_5k_tooling_runner.mjs`.
14. Reject malformed rerun reports and explain when a saved report contains no checks to rerun. Validated by: `scripts/test_5k_tooling_runner.mjs`.
15. Save absolute file paths for completed and queued checks so a report can be used from another directory. Validated by: `scripts/test_5k_tooling_runner.mjs`.
16. Prevent Node reports from overwriting retry reports, timing tables or excluded check inputs. Validated by: `scripts/test_5k_tooling_runner.mjs`.
17. Send JSON to stdout and human progress to stderr when using the standard-output target. Validated by: `scripts/test_5k_tooling_runner.mjs`.
18. Retain successful check output in JSON when the developer explicitly requests it. Validated by: `scripts/test_5k_tooling_runner.mjs`.
19. Sort JSON check records by label so parallel completion order does not change report layout. Validated by: `scripts/test_5k_tooling_runner.mjs`.
20. Record the effective worker count, time budget, aggregate check time and low-water memory reading in JSON. Validated by: `scripts/test_5k_tooling_runner.mjs`.
21. Record interrupted checks and queued work before returning from an interrupted CLI run. Validated by: `scripts/test_5k_tooling_runner.mjs`.
22. Return the conventional SIGTERM exit status for a terminated Node runner. Validated by: `scripts/test_5k_tooling_runner.mjs`.
23. Kill leftover descendants when the check process exits so inherited pipes cannot hold the runner open. Validated by: `scripts/test_5k_tooling_runner.mjs`.
24. Emit an Actions file annotation for a failed Node check. Validated by: `scripts/test_5k_tooling_runner.mjs`.
25. Keep text emitted by test processes from being interpreted as Actions commands. Validated by: `scripts/test_5k_tooling_runner.mjs`.
26. Append a Markdown check summary with counts and a bounded list of failures. Validated by: `scripts/test_5k_tooling_runner.mjs`.
27. Refuse a Markdown summary and JSON report that resolve to the same destination. Validated by: `scripts/test_5k_tooling_runner.mjs`.
28. Support executing the runner through a symlink by resolving its real entry point. Validated by: `scripts/test_5k_tooling_runner.mjs`.
29. Discover checks in a caller-supplied directory for isolated shard planning. Validated by: `scripts/test_5k_tooling_shards.mjs`.
30. Find the shard for a check supplied as a path, including a path copied from a check log. Validated by: `scripts/test_5k_tooling_shards.mjs`.
31. Ignore missing or non-file symlink targets during discovery while retaining symlinks to real checks. Validated by: `scripts/test_5k_tooling_shards.mjs`.
32. Exclude newlines from discovered check names to preserve line-based shard output. Validated by: `scripts/test_5k_tooling_shards.mjs`.
33. Reject timing table keys that cannot represent bare check filenames. Validated by: `scripts/test_5k_tooling_shards.mjs`.
34. Ignore inherited or invalid direct-API measurements when pricing files. Validated by: `scripts/test_5k_tooling_shards.mjs`.
35. Validate direct planner requests for an allowable number of shards before allocating the plan. Validated by: `scripts/test_5k_tooling_shards.mjs`.
36. Reject duplicate planner inputs before a check can be assigned twice. Validated by: `scripts/test_5k_tooling_shards.mjs`.
37. Validate explicit fallback estimates passed by direct planner callers. Validated by: `scripts/test_5k_tooling_shards.mjs`.
38. Report arithmetic overflow when estimates become too large to represent. Validated by: `scripts/test_5k_tooling_shards.mjs`.
39. Override the unmeasured duration estimate for an exploratory shard plan. Validated by: `scripts/test_5k_tooling_shards.mjs`.
40. Offer longest-first within-shard output for reviewing the execution order. Validated by: `scripts/test_5k_tooling_shards.mjs`.
41. Report missing and stale entries together in a timing-coverage audit. Validated by: `scripts/test_5k_tooling_shards.mjs`.
42. Report the estimated total, mean and longest shard in the planner audit. Validated by: `scripts/test_5k_tooling_shards.mjs`.
43. Report empty shard indexes in the planner audit. Validated by: `scripts/test_5k_tooling_shards.mjs`.
44. Allow clean timing tables to be enforced by rejecting stale entries on request. Validated by: `scripts/test_5k_tooling_shards.mjs`.
45. Enforce a nonempty shard policy on request. Validated by: `scripts/test_5k_tooling_shards.mjs`.
46. Reject plans over an operator-supplied per-shard time budget. Validated by: `scripts/test_5k_tooling_shards.mjs`.
47. Emit an Actions-compatible matrix of shard indexes. Validated by: `scripts/test_5k_tooling_shards.mjs`.
48. Overlay observations from successful checks in a saved Node report. Validated by: `scripts/test_5k_tooling_shards.mjs`.
49. Keep existing estimates when the run reports a failure for a check. Validated by: `scripts/test_5k_tooling_shards.mjs`.
50. Skip observations for tests outside the selected discovery directory's check set. Validated by: `scripts/test_5k_tooling_shards.mjs`.
51. Reject multiple passing observations for the same check when refreshing a timing table. Validated by: `scripts/test_5k_tooling_shards.mjs`.
52. Reject malformed timing report rows and invalid observed durations before refreshing a timing table. Validated by: `scripts/test_5k_tooling_shards.mjs`.
53. Export a sorted timing table that can be reviewed and supplied to another planning run. Validated by: `scripts/test_5k_tooling_shards.mjs`.
54. Keep parsed option names as own keys without giving them prototype behavior. Validated by: `scripts/test_5k_tooling_cli.mjs`.
55. Let integer validation accept a numeric input from JavaScript callers. Validated by: `scripts/test_5k_tooling_cli.mjs`.
56. Reject non-string input to comma-list validation with an option-specific message. Validated by: `scripts/test_5k_tooling_cli.mjs`.
57. Limit the loopback port parser to scalar strings and numbers. Validated by: `scripts/test_5k_tooling_cli.mjs`.
58. Allow a UTF-8 byte order mark on JSON artifacts. Validated by: `scripts/test_5k_tooling_cli.mjs`.
59. Reject malformed UTF-8 instead of silently replacing corrupt bytes in JSON artifacts. Validated by: `scripts/test_5k_tooling_cli.mjs`.
60. Reject non-file JSON inputs before attempting to read them. Validated by: `scripts/test_5k_tooling_cli.mjs`.
61. Support a byte cap for JSON reads from untrusted or unexpectedly large reports. Validated by: `scripts/test_5k_tooling_cli.mjs`.
62. Enforce the byte cap after gzip expansion as well as on the input file. Validated by: `scripts/test_5k_tooling_cli.mjs`.
63. Allow the JSON reader to normalize known metadata during parsing through a reviver. Validated by: `scripts/test_5k_tooling_cli.mjs`.
64. Reject a trailing separator on artifact paths before resolving the destination. Validated by: `scripts/test_5k_tooling_cli.mjs`.
65. Identify a non-directory artifact parent before attempting to create a temporary file. Validated by: `scripts/test_5k_tooling_cli.mjs`.
66. Reject an explicitly empty output filename. Validated by: `scripts/test_5k_tooling_cli.mjs`.
67. Use indexed path and inode checks to avoid quadratic collision scans across artifact lists. Validated by: `scripts/test_5k_tooling_cli.mjs`.
68. Distinguish input and output options even when their caller-supplied labels match. Validated by: `scripts/test_5k_tooling_cli.mjs`.
69. Preserve the existing file's permissions across an atomic artifact replacement. Validated by: `scripts/test_5k_tooling_cli.mjs`.
70. Allow code awaiting a benchmark page to cancel the request explicitly. Validated by: `scripts/test_5k_tooling_cli.mjs`.
71. Allow a check to set a shorter benchmark page timeout. Validated by: `scripts/test_5k_tooling_cli.mjs`.
72. Release the failed HTTP response body before reporting a benchmark page error. Validated by: `scripts/test_5k_tooling_cli.mjs`.
73. Treat whitespace-only benchmark session tokens as missing. Validated by: `scripts/test_5k_tooling_cli.mjs`.
74. Report array differences in numeric order so short diff limits show the first divergent indexes. Validated by: `scripts/test_5k_tooling_cli.mjs`.
75. Quote unusual JSON keys in difference paths so a dotted key is distinguishable from nested fields. Validated by: `scripts/test_5k_tooling_cli.mjs`.
76. Report sparse-array length differences when index keys cannot account for the drift. Validated by: `scripts/test_5k_tooling_cli.mjs`.
77. Accept an explicit loopback port for both registry benchmark and arena captures. Validated by: `scripts/test_5k_tooling_parity.mjs`.
78. Capture a specific simulation hour without overwriting a different hour's comparison file. Validated by: `scripts/test_5k_tooling_parity.mjs`.
79. Allow the registry benchmark process to have an explicit timeout. Validated by: `scripts/test_5k_tooling_parity.mjs`.
80. Promote a benchmark capture to its destination only after the child process succeeds. Validated by: `scripts/test_5k_tooling_parity.mjs`.
81. Keep registry arena fetches on the configured loopback origin and reuse the token from the shared page probe. Validated by: `scripts/test_5k_tooling_parity.mjs`.
82. Name the driver and scenario when a registry arena capture fails. Validated by: `scripts/test_5k_tooling_parity.mjs`.
83. Write registry arena and prompt captures atomically. Validated by: `scripts/test_5k_tooling_parity.mjs`.
84. Reject extra or missing positional arguments for registry capture modes. Validated by: `scripts/test_5k_tooling_parity.mjs`.
85. Require named extra captures for migration proofs that need more than the default conditions. Validated by: `scripts/test_5k_tooling_parity.mjs`.
86. Compare a deliberately selected capture subset during local debugging. Validated by: `scripts/test_5k_tooling_parity.mjs`.
87. Offer a strict registry comparison that includes timing and source metadata. Validated by: `scripts/test_5k_tooling_parity.mjs`.
88. Configure the number of field differences printed for each capture. Validated by: `scripts/test_5k_tooling_parity.mjs`.
89. Export structured registry comparison results, including through gzip. Validated by: `scripts/test_5k_tooling_parity.mjs`.
90. Protect input capture files from being overwritten by the registry diff report. Validated by: `scripts/test_5k_tooling_parity.mjs`.
91. Name both missing and extra files when registry capture sets differ. Validated by: `scripts/test_5k_tooling_parity.mjs`.
92. Reject a scalar registry capture with a filename-specific diagnostic. Validated by: `scripts/test_5k_tooling_parity.mjs`.
93. Select the parity fixture through a named CLI option. Validated by: `scripts/test_5k_tooling_parity.mjs`.
94. Select the turn or lane-join portion of a routing parity fixture. Validated by: `scripts/test_5k_tooling_parity.mjs`.
95. Select an exact case name, including names containing commas. Validated by: `scripts/test_5k_tooling_parity.mjs`.
96. Filter routing parity fixture cases by a substring. Validated by: `scripts/test_5k_tooling_parity.mjs`.
97. List case names without importing the routing or traffic modules. Validated by: `scripts/test_5k_tooling_parity.mjs`.
98. Offer indented JSON for a routing parity inspection. Validated by: `scripts/test_5k_tooling_parity.mjs`.
99. Report unknown selected case names directly. Validated by: `scripts/test_5k_tooling_parity.mjs`.
100. Reject malformed fixture roots and non-array case groups. Validated by: `scripts/test_5k_tooling_parity.mjs`.
101. Require each parity case to have a display name. Validated by: `scripts/test_5k_tooling_parity.mjs`.
102. Reject repeated parity names within one case group. Validated by: `scripts/test_5k_tooling_parity.mjs`.
103. Require enough points to make a parity fixture line. Validated by: `scripts/test_5k_tooling_parity.mjs`.
104. Reject malformed or non-finite coordinate pairs before constructing a route. Validated by: `scripts/test_5k_tooling_parity.mjs`.
105. Reject degenerate and non-finite parity line lengths. Validated by: `scripts/test_5k_tooling_parity.mjs`.
106. Require an incoming direction at a turn fixture's junction. Validated by: `scripts/test_5k_tooling_parity.mjs`.
107. Verify that turn fixture edges share the stated junction. Validated by: `scripts/test_5k_tooling_parity.mjs`.
108. Validate the optional authored angle in parity fixtures. Validated by: `scripts/test_5k_tooling_parity.mjs`.
109. Require a rationale when a fixture is marked as a known difference. Validated by: `scripts/test_5k_tooling_parity.mjs`.
110. Validate the comparison tolerance before processing fixture geometry. Validated by: `scripts/test_5k_tooling_parity.mjs`.
111. Reject conflicting Boat sandbox actions. Validated by: `scripts/test_5k_tooling_ci.mjs`.
112. Reject ambiguous Boat command modes. Validated by: `scripts/test_5k_tooling_ci.mjs`.
113. Reject whitespace-only custom Boat commands. Validated by: `scripts/test_5k_tooling_ci.mjs`.
114. Treat a zero idle duration with leading zeros as immediate shutdown. Validated by: `scripts/test_5k_tooling_ci.mjs`.
115. Explain when the Boat runner is started outside a Git worktree. Validated by: `scripts/test_5k_tooling_ci.mjs`.
116. Protect Boat sandbox ID reads with the slot lock and replace the stored ID atomically. Validated by: `scripts/test_5k_tooling_ci.mjs`.
117. Validate stored sandbox IDs before passing them to Boat. Validated by: `scripts/test_5k_tooling_ci.mjs`.
118. Validate the types of Boat's sandbox state and machine size fields. Validated by: `scripts/test_5k_tooling_ci.mjs`.
119. Recognize a structured not-found response without treating unrelated API errors as a lost sandbox. Validated by: `scripts/test_5k_tooling_ci.mjs`.
120. Retain a sandbox when Boat returns an unrecognized state. Validated by: `scripts/test_5k_tooling_ci.mjs`.
121. Stop replacement when Boat cannot delete the previous failed sandbox. Validated by: `scripts/test_5k_tooling_ci.mjs`.
122. Avoid starting a bare sandbox when checking snapshot availability failed. Validated by: `scripts/test_5k_tooling_ci.mjs`.
123. Validate the sandbox ID coming from Boat's creation events before persisting it. Validated by: `scripts/test_5k_tooling_ci.mjs`.
124. Remove saved index and sync bookkeeping when deleting a slot's sandbox. Validated by: `scripts/test_5k_tooling_ci.mjs`.
125. Make Boat stop idempotent for gone, stopped and stopping sandboxes. Validated by: `scripts/test_5k_tooling_ci.mjs`.
126. Report a vanished sandbox through Boat status without a second failing lookup. Validated by: `scripts/test_5k_tooling_ci.mjs`.
127. Return the conventional SIGTERM exit status from the Boat wrapper. Validated by: `scripts/test_5k_tooling_ci.mjs`.
128. Preserve a legitimate remote exit code of 255. Validated by: `scripts/test_5k_tooling_ci.mjs`.
129. Reject missing or invalid Boat exit frames with decoder and transport statuses. Validated by: `scripts/test_5k_tooling_ci.mjs`.
130. Prepare and verify Node in a staging directory before replacing an existing remote installation. Validated by: `scripts/test_5k_tooling_ci.mjs`.
131. Remove a partial Node download or installation when the bootstrap step fails. Validated by: `scripts/test_5k_tooling_ci.mjs`.
132. Report unsupported sandbox architectures before trying to download Node. Validated by: `scripts/test_5k_tooling_ci.mjs`.
133. Build incremental Boat uploads from the indexed tree and publish the sync receipt atomically. Validated by: `scripts/test_5k_tooling_ci.mjs`.
134. Send a full snapshot if the changed path list would be too large for an archive invocation. Validated by: `scripts/test_5k_tooling_ci.mjs`.
135. Restore the pinned Biome install when its executable is missing despite a matching lock marker. Validated by: `scripts/test_5k_tooling_ci.mjs`.
136. Replace three repeated workflow server probes with a shared readiness script. Validated by: `scripts/test_5k_tooling_ci.mjs`.
137. Bound each Actions readiness HTTP request to two seconds. Validated by: `scripts/test_5k_tooling_ci.mjs`.
138. Bypass proxy settings for the loopback Actions readiness check. Validated by: `scripts/test_5k_tooling_ci.mjs`.
139. Check that the process is still running during Actions readiness polling. Validated by: `scripts/test_5k_tooling_ci.mjs`.
140. Require a successful HTTP status for workflow readiness, including when the server redirects. Validated by: `scripts/test_5k_tooling_ci.mjs`.
141. Identify the last HTTP response status when readiness times out. Validated by: `scripts/test_5k_tooling_ci.mjs`.
142. Route the demo shard through the same Node runner used on Boat. Validated by: `scripts/test_5k_tooling_ci.mjs`.
143. Preserve check paths containing spaces when passing the shard list from Bash to Node. Validated by: `scripts/test_5k_tooling_ci.mjs`.
144. Publish short-lived per-shard Node reports in GitHub Actions. Validated by: `scripts/test_5k_tooling_ci.mjs`.
145. Use the explicit Python unittest discovery start directory in the demo workflow. Validated by: `scripts/test_5k_tooling_ci.mjs`.
146. Pass browser suite arguments as a quoted array from an environment value. Validated by: `scripts/test_5k_tooling_ci.mjs`.
147. Bound the server log printed by a failing browser suite. Validated by: `scripts/test_5k_tooling_ci.mjs`.
148. Avoid trying to print missing server logs when an earlier workflow step failed. Validated by: `scripts/test_5k_tooling_ci.mjs`.
149. Upload seeded benchmark reports for both successful and failed ordinary benchmark legs when available. Validated by: `scripts/test_5k_tooling_ci.mjs`.
150. Skip the hard-city artifact upload when there is no report. Validated by: `scripts/test_5k_tooling_ci.mjs`.
151. Report the names and statuses of failed required jobs in the aggregate CI gates. Validated by: `scripts/test_5k_tooling_ci.mjs`.
152. Remove repository token permissions from gate jobs that only inspect dependency results. Validated by: `scripts/test_5k_tooling_ci.mjs`.
153. Require the aggregate demo gate before deployment. Validated by: `scripts/test_5k_tooling_ci.mjs`.
154. Pass benchmark and soak matrix arguments as quoted values instead of substituting them into shell code. Validated by: `scripts/test_5k_tooling_ci.mjs`.
155. Skip the replay matrix and explain the empty run when the published index has no tapes. Validated by: `scripts/test_5k_tooling_ci.mjs`.
156. Attempt the published-revision replay even when execution of the main-revision replay failed unexpectedly. Validated by: `scripts/test_5k_tooling_ci.mjs`.
157. Return isolated copies of the shared synthetic map fixture to keep changes local to one test. Validated by: `tests/test_5k_tooling_helpers.py`.
158. Generate a normalized probability distribution for single-choice fake Jev answers. Validated by: `tests/test_5k_tooling_helpers.py`.
159. Reject empty fake choice criteria with the question ID. Validated by: `tests/test_5k_tooling_helpers.py`.
160. Reject fake picks that are absent from the criteria. Validated by: `tests/test_5k_tooling_helpers.py`.
161. Reject empty fake score criteria before generating a probability legend. Validated by: `tests/test_5k_tooling_helpers.py`.
162. Reject unknown fake question types with the question ID. Validated by: `tests/test_5k_tooling_helpers.py`.
163. Snapshot fake client call arguments before invoking the picker. Validated by: `tests/test_5k_tooling_helpers.py`.
164. Keep returned fake Jev requests independent of later changes to the caller's input. Validated by: `tests/test_5k_tooling_helpers.py`.
165. Reuse the offline arena map loader for focused city-progress checks so their map and layer list stay in sync. Validated by: `scripts/test_emergency_short_stop.mjs`.
166. Check that workflow actions keep their full commit pins and version comments. Validated by: `scripts/test_5k_tooling_ci.mjs`.
167. Check that each workflow uses the configured public standard runner. Validated by: `scripts/test_5k_tooling_ci.mjs`.
168. Check that every checkout step disables persisted credentials. Validated by: `scripts/test_5k_tooling_ci.mjs`.
169. Check that all three required check names remain present. Validated by: `scripts/test_5k_tooling_ci.mjs`.
170. Check that the aggregate demo gate includes every prerequisite job. Validated by: `scripts/test_5k_tooling_ci.mjs`.
171. Check that the benchmark gate depends on the benchmark suite. Validated by: `scripts/test_5k_tooling_ci.mjs`.
172. Check that packaging the demo waits for Python, Node and browser jobs to finish. Validated by: `scripts/test_5k_tooling_ci.mjs`.
173. Check that only main-branch runs can deploy Pages and pull requests cannot deploy. Validated by: `scripts/test_5k_tooling_ci.mjs`.
174. Check that the Pages deployment retains its required Pages and identity-token permissions. Validated by: `scripts/test_5k_tooling_ci.mjs`.
175. Check that Pages deployment is serialized without cancelling an active deployment. Validated by: `scripts/test_5k_tooling_ci.mjs`.
176. Check that demo cancellation applies to superseded pull request runs. Validated by: `scripts/test_5k_tooling_ci.mjs`.
177. Check that the fixed hard city slice stays in the seeded benchmark matrix. Validated by: `scripts/test_5k_tooling_ci.mjs`.
178. Check that the fixed hard city slice invokes the soak tool in hard mode. Validated by: `scripts/test_5k_tooling_ci.mjs`.
179. Check that CodeQL keeps scanning Actions, JavaScript and Python. Validated by: `scripts/test_5k_tooling_ci.mjs`.
180. Check that lint continues to require the Ruff formatting check. Validated by: `scripts/test_5k_tooling_ci.mjs`.
181. Check that the required lint step installs the lockfile's dependency set before running Biome. Validated by: `scripts/test_5k_tooling_ci.mjs`.
182. Check that soak jobs remain report-only. Validated by: `scripts/test_5k_tooling_ci.mjs`.
183. Check that the soak summary waits for both sets of soak legs. Validated by: `scripts/test_5k_tooling_ci.mjs`.
184. Check that an unsupported Boat machine size fails command validation. Validated by: `scripts/test_5k_tooling_ci.mjs`.
185. Check that a negative Boat idle duration is rejected. Validated by: `scripts/test_5k_tooling_ci.mjs`.
186. Check that a Boat slot cannot contain a parent directory path. Validated by: `scripts/test_5k_tooling_ci.mjs`.
187. Check that the Boat parallelism override rejects a value outside its allowed range. Validated by: `scripts/test_5k_tooling_ci.mjs`.
188. Check that the Boat runner refuses live Jev verification in a check sandbox. Validated by: `scripts/test_5k_tooling_ci.mjs`.
189. Check that a live Boat slot lock is preserved and reported to the second caller. Validated by: `scripts/test_5k_tooling_ci.mjs`.
190. Check that a stale Boat slot lock is reported without removing it. Validated by: `scripts/test_5k_tooling_ci.mjs`.
191. Check that an inline option's value preserves embedded equals signs. Validated by: `scripts/test_5k_tooling_cli.mjs`.
192. Check that a trailing option terminator is accepted without starting a second parse. Validated by: `scripts/test_5k_tooling_cli.mjs`.
193. Check that a boolean CLI switch refuses an inline value. Validated by: `scripts/test_5k_tooling_cli.mjs`.
194. Check that a help token cannot stand in for a missing option value. Validated by: `scripts/test_5k_tooling_cli.mjs`.
195. Check that a diff with a root label reports that label for primitive values. Validated by: `scripts/test_5k_tooling_cli.mjs`.
196. Check that a diff truncates an unusually long rendered value. Validated by: `scripts/test_5k_tooling_cli.mjs`.
197. Check that repeating the Node flag option forwards both flags to the check process. Validated by: `scripts/test_5k_tooling_runner.mjs`.
198. Check that a check which signals itself is reported with its terminating signal. Validated by: `scripts/test_5k_tooling_runner.mjs`.
199. Check that the registry comparator treats a reorder of otherwise identical JSON array items as drift. Validated by: `scripts/test_5k_tooling_parity.mjs`.
200. Check that the default registry comparison still ignores median decision latency. Validated by: `scripts/test_5k_tooling_parity.mjs`.
