# Published results and manifests

This batch validates publication inputs and frozen suite definitions, adds field-level diagnostics for manifest and tape disagreements, and expands offline replay and soak reporting. Regeneration preserves the committed results JSON and README table.

1. Read BOM-prefixed publication JSON without corrupting UTF-8 labels. Validated by: `tests/test_5k_results_publication.py`.
2. Reject duplicate publication JSON keys before one value overwrites another. Validated by: `tests/test_5k_results_publication.py`.
3. Reject non-JSON numeric constants before they reach publication calculations. Validated by: `tests/test_5k_results_publication.py`.
4. Validate numbered suite filenames against the version each definition declares. Validated by: `tests/test_5k_results_publication.py`.
5. Validate the source revision a frozen suite was defined from. Validated by: `tests/test_5k_results_publication.py`.
6. Require a nonempty map catalog in a frozen suite. Validated by: `tests/test_5k_results_publication.py`.
7. Validate suite map IDs and their declared fingerprints. Validated by: `tests/test_5k_results_publication.py`.
8. Require an authored arena drive table in each frozen suite. Validated by: `tests/test_5k_results_publication.py`.
9. Validate each authored drive entry before reading its fields. Validated by: `tests/test_5k_results_publication.py`.
10. Require authored drives to reference a map pinned by the suite. Validated by: `tests/test_5k_results_publication.py`.
11. Reject invalid authored seeds in frozen definitions. Validated by: `tests/test_5k_results_publication.py`.
12. Require positive authored challenge versions in frozen definitions. Validated by: `tests/test_5k_results_publication.py`.
13. Check that the canonical benchmark map is pinned in the same definition. Validated by: `tests/test_5k_results_publication.py`.
14. Validate the benchmark configuration object and feature preset in frozen definitions. Validated by: `tests/test_5k_results_publication.py`.
15. Require the frozen benchmark to specify lockstep execution. Validated by: `tests/test_5k_results_publication.py`.
16. Reject invalid tuned benchmark seeds in frozen definitions. Validated by: `tests/test_5k_results_publication.py`.
17. Validate the benchmark traffic count in frozen definitions. Validated by: `tests/test_5k_results_publication.py`.
18. Require a positive benchmark route count in frozen definitions. Validated by: `tests/test_5k_results_publication.py`.
19. Validate the weather list for a frozen benchmark, including duplicate entries. Validated by: `tests/test_5k_results_publication.py`.
20. Check the frozen route ID list against the benchmark route count. Validated by: `tests/test_5k_results_publication.py`.
21. Require the frozen benchmark's route fingerprint to be valid. Validated by: `tests/test_5k_results_publication.py`.
22. Check held-out seeds for validity, uniqueness and separation from the tuned seed. Validated by: `tests/test_5k_results_publication.py`.
23. Require a held-out plan with a positive route count and valid route fingerprint. Validated by: `tests/test_5k_results_publication.py`.
24. Report a missing v1 definition before constructing legacy arena coverage. Validated by: `tests/test_5k_results_publication.py`.
25. Name the invalid metadata field when a submitted publication cannot be read. Validated by: `tests/test_5k_results_publication.py`.
26. Read recording text as UTF-8 with optional BOM in both plain and compressed tapes. Validated by: `tests/test_5k_results_publication.py`.
27. Invalidate a cached recording when its file is replaced at the same size and discard the superseded entry. Validated by: `tests/test_5k_results_publication.py`.
28. Distinguish an invalid recording root from missing or malformed header, result and drive tables. Validated by: `tests/test_5k_results_publication.py`.
29. Reject malformed per-drive records in a tape's result table. Validated by: `tests/test_5k_results_publication.py`.
30. Reject a malformed recording drive before aggregating its answers. Validated by: `tests/test_5k_results_publication.py`.
31. Require call arrays in each recording channel. Validated by: `tests/test_5k_results_publication.py`.
32. Reject malformed calls with their drive, channel and call number. Validated by: `tests/test_5k_results_publication.py`.
33. Validate a recorded call's response before reading its fields. Validated by: `tests/test_5k_results_publication.py`.
34. Validate response metadata before identifying the answering model. Validated by: `tests/test_5k_results_publication.py`.
35. Reject wrongly typed provider model identifiers. Validated by: `tests/test_5k_results_publication.py`.
36. Detect malformed provider traces before scoring cost. Validated by: `tests/test_5k_results_publication.py`.
37. Distinguish malformed provider responses from malformed usage objects when reading cost. Validated by: `tests/test_5k_results_publication.py`.
38. Reject invalid costs attributed to provider usage. Validated by: `tests/test_5k_results_publication.py`.
39. Bound the time spent in Node fingerprinting numbered benchmark scenarios. Validated by: `tests/test_5k_results_publication.py`.
40. Distinguish a fingerprint process failure from a missing Node executable. Validated by: `tests/test_5k_results_publication.py`.
41. Detect invalid fingerprint output even when the Node process exits successfully. Validated by: `tests/test_5k_results_publication.py`.
42. Reject version 2 manifests that claim legacy suite status. Validated by: `tests/test_5k_results_publication.py`.
43. Distinguish an invalid source commit from an unclean source in publication diagnostics. Validated by: `tests/test_5k_results_publication.py`.
44. Identify driver disagreements with a manifest separately from other settings. Validated by: `tests/test_5k_results_publication.py`.
45. Identify engine disagreements with a manifest separately from other settings. Validated by: `tests/test_5k_results_publication.py`.
46. Reject invalid manifest tracks and report track disagreements by name. Validated by: `tests/test_5k_results_publication.py`.
47. Treat a blank V8 version as missing provenance. Validated by: `tests/test_5k_results_publication.py`.
48. Identify invalid per-drive costs before aggregating them for verification. Validated by: `tests/test_5k_results_publication.py`.
49. Reject report cost totals outside Node's supported precision. Validated by: `tests/test_5k_results_publication.py`.
50. Match Node's rounding at a half microdollar during manifest verification. Validated by: `tests/test_5k_results_publication.py`.
51. Identify a wrong summary cost separately from a wrong manifest cost. Validated by: `tests/test_5k_results_publication.py`.
52. Distinguish missing map provenance from missing suite provenance in a manifest. Validated by: `tests/test_5k_results_publication.py`.
53. Identify the map whose provenance record or fingerprint is malformed. Validated by: `tests/test_5k_results_publication.py`.
54. Validate the pack version's type before comparing provenance. Validated by: `tests/test_5k_results_publication.py`.
55. Identify an absent or invalid component fingerprint by map and component. Validated by: `tests/test_5k_results_publication.py`.
56. Compare a saved arena drive's pack version to the manifest's map pack version. Validated by: `tests/test_5k_results_publication.py`.
57. Validate authored challenge revisions in versioned manifests. Validated by: `tests/test_5k_results_publication.py`.
58. Reject duplicate challenge IDs in an arena report before tallying it or binding it to its manifest. Validated by: `tests/test_5k_results_publication.py`.
59. Report a benchmark manifest with the wrong suite kind before comparing routes. Validated by: `tests/test_5k_results_publication.py`.
60. Identify benchmark settings that differ from the manifest. Validated by: `tests/test_5k_results_publication.py`.
61. Validate the list of completed benchmark routes against the report order. Validated by: `tests/test_5k_results_publication.py`.
62. Reject invalid or duplicate generated route IDs. Validated by: `tests/test_5k_results_publication.py`.
63. Require a boolean benchmark selection flag in saved provenance. Validated by: `tests/test_5k_results_publication.py`.
64. Check that a selected benchmark run follows the generated order. Validated by: `tests/test_5k_results_publication.py`.
65. Validate the shape of a supplied benchmark route fingerprint. Validated by: `tests/test_5k_results_publication.py`.
66. Identify a mismatched pack version separately from a mismatched benchmark map. Validated by: `tests/test_5k_results_publication.py`.
67. Identify the changed route and fields when a benchmark tape differs from its report. Validated by: `tests/test_5k_results_publication.py`.
68. Distinguish a canonical report stopped early from an incomplete route selection or a stopped drive. Validated by: `tests/test_5k_results_publication.py`.
69. Identify a numbered arena run recorded against the wrong set. Validated by: `tests/test_5k_results_publication.py`.
70. Identify a numbered arena manifest with changed authored drive definitions. Validated by: `tests/test_5k_results_publication.py`.
71. Report incomplete numbered arena drive coverage. Validated by: `tests/test_5k_results_publication.py`.
72. Report changed map fingerprints for a numbered arena run. Validated by: `tests/test_5k_results_publication.py`.
73. Identify the canonical benchmark config field that differs, including boolean substitutions for numeric values. Validated by: `tests/test_5k_results_publication.py`.
74. Report a weather mismatch against the frozen benchmark. Validated by: `tests/test_5k_results_publication.py`.
75. Report a map fingerprint mismatch against the frozen benchmark. Validated by: `tests/test_5k_results_publication.py`.
76. Identify destination parking as the canonical eligibility mismatch. Validated by: `tests/test_5k_results_publication.py`.
77. Identify custom start hours as the canonical eligibility mismatch. Validated by: `tests/test_5k_results_publication.py`.
78. Identify feature covering rows as the canonical eligibility mismatch. Validated by: `tests/test_5k_results_publication.py`.
79. Identify omitted features as the canonical eligibility mismatch. Validated by: `tests/test_5k_results_publication.py`.
80. Identify a track mismatch against the guarded canonical benchmark. Validated by: `tests/test_5k_results_publication.py`.
81. Identify differences in the held-out seed schedule and its starting seed. Validated by: `tests/test_5k_results_publication.py`.
82. Identify a mismatched held-out route count. Validated by: `tests/test_5k_results_publication.py`.
83. Distinguish held-out route fingerprint disagreements from tuned route fingerprint disagreements. Validated by: `tests/test_5k_results_publication.py`.
84. Distinguish a mismatch in reported canonical route order from a mismatch in generated route order. Validated by: `tests/test_5k_results_publication.py`.
85. Reject malformed failure labels before creating a published result. Validated by: `tests/test_5k_results_publication.py`.
86. Reject negative or wrongly typed published driving times. Validated by: `tests/test_5k_results_publication.py`.
87. Validate collision, hard-brake and safety-brake counts before publishing incident data. Validated by: `tests/test_5k_results_publication.py`.
88. Check fallback counts before aggregating driver reliability. Validated by: `tests/test_5k_results_publication.py`.
89. Validate open-track flagged-choice counts. Validated by: `tests/test_5k_results_publication.py`.
90. Check decision counts before weighting published decision shares. Validated by: `tests/test_5k_results_publication.py`.
91. Validate model decision counts before aggregating assigned decisions. Validated by: `tests/test_5k_results_publication.py`.
92. Validate local decision counts before aggregating assigned decisions. Validated by: `tests/test_5k_results_publication.py`.
93. Validate fallback decision counts before aggregating assigned decisions. Validated by: `tests/test_5k_results_publication.py`.
94. Reject model, local and fallback shares outside the unit interval. Validated by: `tests/test_5k_results_publication.py`.
95. Reject a passing verdict for a drive with a simulation error. Validated by: `tests/test_5k_results_publication.py`.
96. Require an arena summary, driver ID and results array before building a row. Validated by: `tests/test_5k_results_publication.py`.
97. Require a supported arena track before assigning a leaderboard cohort. Validated by: `tests/test_5k_results_publication.py`.
98. Validate the arena summary's total drive count against its rows. Validated by: `tests/test_5k_results_publication.py`.
99. Validate the arena summary's passing drive count against its rows. Validated by: `tests/test_5k_results_publication.py`.
100. Require a map ID on every published arena drive. Validated by: `tests/test_5k_results_publication.py`.
101. Validate summary cost before adding it to published data. Validated by: `tests/test_5k_results_publication.py`.
102. Name the missing benchmark identity field when a saved run is incomplete. Validated by: `tests/test_5k_results_publication.py`.
103. Validate benchmark timestamps before using them to date a leaderboard row. Validated by: `tests/test_5k_results_publication.py`.
104. Require an actual reason on a benchmark marked stopped. Validated by: `tests/test_5k_results_publication.py`.
105. Reject invalid benchmark distance totals. Validated by: `tests/test_5k_results_publication.py`.
106. Validate the configured benchmark seed before grouping published runs. Validated by: `tests/test_5k_results_publication.py`.
107. Validate the requested route count before grouping benchmark runs. Validated by: `tests/test_5k_results_publication.py`.
108. Validate the traffic count in saved benchmark config. Validated by: `tests/test_5k_results_publication.py`.
109. Reject unsupported benchmark tracks before classifying runs. Validated by: `tests/test_5k_results_publication.py`.
110. Distinguish missing driven-corridor measurements from measurements with invalid content. Validated by: `tests/test_5k_results_publication.py`.
111. Handle null decision counts consistently when calculating attribution. Validated by: `tests/test_5k_results_publication.py`.
112. Stage both publication outputs before replacing either file. Validated by: `tests/test_5k_results_publication.py`.
113. Preserve existing file permission bits when regenerating a publication output. Validated by: `tests/test_5k_results_publication.py`.
114. Preserve the README's CRLF convention when replacing the generated block. Validated by: `tests/test_5k_results_publication.py`.
115. Require an array of replay rows and identify the index of a malformed entry. Validated by: `tests/test_5k_results_reports.py`.
116. Require an explicit recording path to name a gzip JSON tape. Validated by: `tests/test_5k_results_reports.py`.
117. Validate that published tape paths are canonical repository-relative paths. Validated by: `tests/test_5k_results_reports.py`.
118. Reject contradictory Node versions in a row and its attached replay manifest. Validated by: `tests/test_5k_results_reports.py`.
119. Reject contradictory source commits in a row and its attached replay manifest. Validated by: `tests/test_5k_results_reports.py`.
120. Treat an explicitly invalid manifest revision or engine as invalid provenance. Validated by: `tests/test_5k_results_reports.py`.
121. Validate the published suite version before making replay jobs. Validated by: `tests/test_5k_results_reports.py`.
122. Reject a manifest whose suite version differs from the row's version. Validated by: `tests/test_5k_results_reports.py`.
123. Validate the track for a published replay. Validated by: `tests/test_5k_results_reports.py`.
124. Reject a manifest whose track differs from the row's track. Validated by: `tests/test_5k_results_reports.py`.
125. Reject invalid map IDs before choosing a replay runner. Validated by: `tests/test_5k_results_reports.py`.
126. Verify that the manifest's suite kind agrees with the replay runner. Validated by: `tests/test_5k_results_reports.py`.
127. Bound the number of drives a replay job can request to a representable integer. Validated by: `tests/test_5k_results_reports.py`.
128. Reject published passed counts outside the replay drive count. Validated by: `tests/test_5k_results_reports.py`.
129. Filter replay jobs by published driver ID. Validated by: `tests/test_5k_results_reports.py`.
130. Filter replay jobs by track. Validated by: `tests/test_5k_results_reports.py`.
131. Filter replay jobs by suite version. Validated by: `tests/test_5k_results_reports.py`.
132. Filter benchmark replay jobs by map. Validated by: `tests/test_5k_results_reports.py`.
133. Accept a singular drive in a successful one-drive replay transcript. Validated by: `tests/test_5k_results_reports.py`.
134. Give the actual count when an exact replay transcript reports too few or too many drives. Validated by: `tests/test_5k_results_reports.py`.
135. Recognize punctuated IDs in replay drift transcripts. Validated by: `tests/test_5k_results_reports.py`.
136. Explain repeated drive IDs in a drift transcript. Validated by: `tests/test_5k_results_reports.py`.
137. Distinguish excessive drift counts from duplicate drive IDs. Validated by: `tests/test_5k_results_reports.py`.
138. Distinguish missing fidelity output from ambiguous fidelity output. Validated by: `tests/test_5k_results_reports.py`.
139. Reject unknown runner names before starting a local replay. Validated by: `tests/test_5k_results_reports.py`.
140. Resolve a relative tape filename before changing the runner's working directory. Validated by: `tests/test_5k_results_reports.py`.
141. Decode replay subprocess logs consistently even when the output contains invalid UTF-8. Validated by: `tests/test_5k_results_reports.py`.
142. Identify the server's exit status when startup fails before replay. Validated by: `tests/test_5k_results_reports.py`.
143. Identify the readiness deadline when a replay server remains alive without accepting requests. Validated by: `tests/test_5k_results_reports.py`.
144. Diagnose a missing checkout before reserving a local replay server port. Validated by: `tests/test_5k_results_reports.py`.
145. Diagnose a missing runner script before starting the server. Validated by: `tests/test_5k_results_reports.py`.
146. Emit a machine-readable replay verdict on request. Validated by: `tests/test_5k_results_reports.py`.
147. Keep replay subprocess logs off the JSON verdict stream. Validated by: `tests/test_5k_results_reports.py`.
148. Escape Markdown formatting in replay step summaries. Validated by: `tests/test_5k_results_reports.py`.
149. Keep the replay verdict when the step summary cannot be written. Validated by: `tests/test_5k_results_reports.py`.
150. Expand every matrix reference in a leg label and report missing matrix keys. Validated by: `tests/test_5k_results_reports.py`.
151. Expand block-form axes in a workflow matrix. Validated by: `tests/test_5k_results_reports.py`.
152. Keep commas and comment characters in quoted matrix labels. Validated by: `tests/test_5k_results_reports.py`.
153. Decode YAML quotes and escapes in literal matrix values. Validated by: `tests/test_5k_results_reports.py`.
154. Honor literal matrix exclusions when deriving expected soak legs. Validated by: `tests/test_5k_results_reports.py`.
155. Apply matrix include values to compatible rows and add standalone include rows. Validated by: `tests/test_5k_results_reports.py`.
156. Read BOM-prefixed workflow files for local summary generation. Validated by: `tests/test_5k_results_reports.py`.
157. Accept an alternate soak workflow file when deriving expected legs. Validated by: `tests/test_5k_results_reports.py`.
158. Reject unsupported soak schema versions. Validated by: `tests/test_5k_results_reports.py`.
159. Reject a wrongly typed harness failure verdict. Validated by: `tests/test_5k_results_reports.py`.
160. Validate the list of skipped configurations and reject duplicate IDs. Validated by: `tests/test_5k_results_reports.py`.
161. Identify configurations listed as both run and skipped. Validated by: `tests/test_5k_results_reports.py`.
162. Reject duplicate run configuration IDs. Validated by: `tests/test_5k_results_reports.py`.
163. Reject malformed run configuration IDs. Validated by: `tests/test_5k_results_reports.py`.
164. Require printable harness error details instead of treating arbitrary values as errors. Validated by: `tests/test_5k_results_reports.py`.
165. Validate arrival status before inferring a stuck drive. Validated by: `tests/test_5k_results_reports.py`.
166. Validate deadlock and collision counts before classifying failed drives. Validated by: `tests/test_5k_results_reports.py`.
167. Require simulation error details to be nonblank text. Validated by: `tests/test_5k_results_reports.py`.
168. Report configurations skipped by a fail-fast soak. Validated by: `tests/test_5k_results_reports.py`.
169. Report a harness failure even when it has no route diagnostics. Validated by: `tests/test_5k_results_reports.py`.
170. Include prematurely stopped benchmark runs and their stop reasons in soak summaries. Validated by: `tests/test_5k_results_reports.py`.
171. Show collision, stuck and simulation-error evidence in route warnings even when the labels were omitted. Validated by: `tests/test_5k_results_reports.py`.
172. Read gzip-compressed soak and benchmark artifacts directly. Validated by: `tests/test_5k_results_reports.py`.
173. Report a truncated compressed leg alongside other available results. Validated by: `tests/test_5k_results_reports.py`.
174. Identify ambiguous artifacts containing multiple report files. Validated by: `tests/test_5k_results_reports.py`.
175. Escape HTML from uploaded report text while keeping inter-route line breaks. Validated by: `tests/test_5k_results_reports.py`.
176. Fall back to stdout when the GitHub soak summary path cannot be written. Validated by: `tests/test_5k_results_reports.py`.
177. Retain uploaded coverage when the requested workflow cannot be read. Validated by: `tests/test_5k_results_reports.py`.
178. Report the failing drive in cost aggregation errors. Validated by: `scripts/test_5k_results_manifest.mjs`.
179. Reject a non-array cost input before attempting to sum drives. Validated by: `scripts/test_5k_results_manifest.mjs`.
180. Identify a malformed drive entry in run cost aggregation by index. Validated by: `scripts/test_5k_results_manifest.mjs`.
181. Require a timestamp for a derived benchmark filename. Validated by: `scripts/test_5k_results_manifest.mjs`.
182. Reject driver IDs that would collapse to an empty filename suffix. Validated by: `scripts/test_5k_results_manifest.mjs`.
183. Check that a new manifest has a driver ID and a supported track. Validated by: `scripts/test_5k_results_manifest.mjs`.
184. Validate an optional model ID before including it in provenance. Validated by: `scripts/test_5k_results_manifest.mjs`.
185. Reject model provenance on built-in or local drivers. Validated by: `scripts/test_5k_results_manifest.mjs`.
186. Limit manifests for local tapes to arena suites. Validated by: `scripts/test_5k_results_manifest.mjs`.
187. Reject fingerprints for maps outside the run. Validated by: `scripts/test_5k_results_manifest.mjs`.
188. Validate fingerprint overrides when creating a manifest. Validated by: `scripts/test_5k_results_manifest.mjs`.
189. Refuse provenance for an empty map pack. Validated by: `scripts/test_5k_results_manifest.mjs`.
190. Check a benchmark pack version against its config when constructing the manifest. Validated by: `scripts/test_5k_results_manifest.mjs`.
191. Compare a benchmark manifest's driver, track and map collection to its config when constructing it. Validated by: `scripts/test_5k_results_manifest.mjs`.
192. Validate the map, seed and version of each authored drive before constructing arena provenance. Validated by: `scripts/test_5k_results_manifest.mjs`.
193. Construct a manifest from a verified Git revision and detect untracked files regardless of status configuration. Validated by: `scripts/test_5k_results_manifest.mjs`.
194. Add a regression check that an unrecorded provider charge leaves the overall billed cost unknown. Validated by: `tests/test_5k_results_publication.py`.
195. Add a regression check that benchmark tape comparisons keep measured driving time while dropping report start timestamps. Validated by: `tests/test_5k_results_publication.py`.
196. Add a regression check that route fingerprints ignore object property order. Validated by: `scripts/test_5k_results_manifest.mjs`.
197. Add a regression check that route fingerprints preserve drive order. Validated by: `scripts/test_5k_results_manifest.mjs`.
198. Add a regression check that model manifests fingerprint guarded and open LLM prompts differently. Validated by: `scripts/test_5k_results_manifest.mjs`.
199. Add a regression check that map component fingerprints use stable alphabetical key order. Validated by: `scripts/test_5k_results_manifest.mjs`.
200. Add a regression check that ordinary artifact names retain their timestamp and normalized driver suffix. Validated by: `scripts/test_5k_results_manifest.mjs`.
