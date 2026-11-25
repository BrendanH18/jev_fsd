# Arena recordings and outside-driver submissions

This batch adds offline tape and report validation, local driver scaffolding, merge previews, and repeat-run analysis. Regression checks cover historical tape encodings, submission consistency, and the Arena command-line workflow.

1. Read recording files through a bounded descriptor so a concurrent file growth cannot bypass the input limit. Validated by: scripts/test_5k_submissions_tapes.mjs.
2. Reject special files as tape inputs before attempting to read their contents. Validated by: scripts/test_5k_submissions_tapes.mjs.
3. Bound gzip inflation while allowing historical tapes written before prompt compaction. Validated by: scripts/test_5k_submissions_tapes.mjs.
4. Detect malformed UTF-8 in tape readers used by Arena and the merge tools. Validated by: scripts/test_5k_submissions_tapes.mjs.
5. Publish new JSON artifacts only after their contents have been written to a staging file. Validated by: scripts/test_5k_submissions_tapes.mjs.
6. Apply the artifact size limit to Arena outputs before replacing the previous checkpoint. Validated by: scripts/test_5k_submissions_tapes.mjs.
7. Require model recording headers to carry a string driver identifier. Validated by: scripts/test_5k_submissions_tapes.mjs.
8. Reject model recordings whose explicit brain kind disagrees with the driver identifier. Validated by: scripts/test_5k_submissions_tapes.mjs.
9. Require endpoint metadata to be an object when present in a model tape. Validated by: scripts/test_5k_submissions_tapes.mjs.
10. Reject model tapes that name a different driver in their endpoint metadata. Validated by: scripts/test_5k_submissions_tapes.mjs.
11. Reject empty drive identifiers in answer dictionaries. Validated by: scripts/test_5k_submissions_tapes.mjs.
12. Reject empty request keys in answer dictionaries. Validated by: scripts/test_5k_submissions_tapes.mjs.
13. Require at least one answer for every recorded request key. Validated by: scripts/test_5k_submissions_tapes.mjs.
14. Preserve literal provider trace values that collide with model tape compression placeholders. Validated by: scripts/test_5k_submissions_tapes.mjs.
15. Reject raw response markers on non-response outcomes. Validated by: scripts/test_5k_submissions_tapes.mjs.
16. Validate drive identifiers when opening a tape. Validated by: scripts/test_5k_submissions_tapes.mjs.
17. Look up replay answers only in the tape's own dictionary. Validated by: scripts/test_5k_submissions_tapes.mjs.
18. Reject unsupported local recording formats before constructing their tapes. Validated by: scripts/test_5k_submissions_tapes.mjs.
19. Verify the shape of a local tape's per-drive results before replay. Validated by: scripts/test_5k_submissions_tapes.mjs.
20. Validate local answer queues with the same outcome checks as model tapes. Validated by: scripts/test_5k_submissions_tapes.mjs.
21. Require boolean question-driven metadata for every local drive with a tape. Validated by: scripts/test_5k_submissions_tapes.mjs.
22. Reject unsupported local decision timeout values before constructing a replay driver. Validated by: scripts/test_5k_submissions_tapes.mjs.
23. Require exactly one answer or failure in each local response envelope. Validated by: scripts/test_5k_submissions_tapes.mjs.
24. Require failure messages on recorded local exception payloads. Validated by: scripts/test_5k_submissions_tapes.mjs.
25. Reject orphaned local driver-behavior records. Validated by: scripts/test_5k_submissions_tapes.mjs.
26. Explicitly diagnose missing local behavior metadata when opening a replay brain. Validated by: scripts/test_5k_submissions_tapes.mjs.
27. Store local exception metadata in the same JSON form seen by the recording and replay path. Validated by: scripts/test_5k_submissions_tapes.mjs.
28. Record a usable exception when local error metadata cannot be serialized. Validated by: scripts/test_5k_submissions_tapes.mjs.
29. Protect local tape tables from inherited property collisions. Validated by: scripts/test_5k_submissions_tapes.mjs.
30. Check that an imported local definition exports an object by default. Validated by: scripts/test_5k_submissions_tapes.mjs.
31. Validate the local driver ID syntax with a local-driver-specific diagnostic. Validated by: scripts/test_5k_submissions_tapes.mjs.
32. Explain when a local identifier is reserved for a built-in driver. Validated by: scripts/test_5k_submissions_tapes.mjs.
33. Require a nonempty local driver label. Validated by: scripts/test_5k_submissions_tapes.mjs.
34. Require a callable local driver factory before registering it. Validated by: scripts/test_5k_submissions_tapes.mjs.
35. Validate that the factory returns a driver with a callable decision method. Validated by: scripts/test_5k_submissions_tapes.mjs.
36. Check the decision-mode setting supplied by a local driver factory. Validated by: scripts/test_5k_submissions_tapes.mjs.
37. Allow Arena users to inspect a model or local tape without contacting a server. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
38. Support a required selected-drive count in Arena runs and listings. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
39. Show the authored seed, time, revision, and time limit in the detailed Arena catalog. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
40. Count a local driver exception separately from its successful responses and transport errors in tape inspection. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
41. Report when the same Arena drive is both explicitly included and excluded. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
42. Reject directory paths supplied as trusted Arena agent modules. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
43. Reject a spend reserve on an Arena recording made by a local agent. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
44. Give the selected endpoint's unavailability reason before attempting to drive. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
45. Report the specific Arena map that failed to load. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
46. Write comparison-score exports through the same gzip-aware artifact writer as other Arena exports. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
47. Profile mismatched tape consumption with the missing, unused, and cancellation counts. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
48. Require a supported set and track in an Arena tape. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
49. Validate that an Arena tape's declared drive list has unique identifiers. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
50. Require an Arena tape to name its map fingerprint table. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
51. Reject an Arena tape that contains no finished drives. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
52. Identify a result outside an Arena tape's authored drive plan. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
53. Identify a result filed under the wrong challenge key. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
54. Require boolean verdicts when loading Arena tapes for replay. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
55. Identify an Arena result whose decision tape is absent. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
56. Reject Arena results that refer to unrecorded maps. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
57. Reject recorded Arena results whose track differs from their tape. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
58. Detect a stray decision tape that has no Arena result. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
59. Reject seeded benchmark scenarios embedded in an Arena recording. Validated by: scripts/test_5k_submissions_tapes.mjs and scripts/test_5k_submissions_cli.mjs.
60. Reject a fully stopped run during submission preflight. Validated by: scripts/test_5k_submissions_bundle.mjs.
61. Verify the same Arena set in the submission manifest and tape. Validated by: scripts/test_5k_submissions_bundle.mjs.
62. Verify the same driver attribution in the submission manifest and tape. Validated by: scripts/test_5k_submissions_bundle.mjs.
63. Verify the same model attribution in the submission manifest and tape. Validated by: scripts/test_5k_submissions_bundle.mjs.
64. Verify that a submission's manifest and tape claim the same engine. Validated by: scripts/test_5k_submissions_bundle.mjs.
65. Check that the submission declares one consistent track. Validated by: scripts/test_5k_submissions_bundle.mjs.
66. Check that all parts of a submission agree on the suite version. Validated by: scripts/test_5k_submissions_bundle.mjs.
67. Check that the authored manifest covers exactly the recorded submission drives. Validated by: scripts/test_5k_submissions_bundle.mjs.
68. Check that the submission map catalog and tape map list agree. Validated by: scripts/test_5k_submissions_bundle.mjs.
69. Validate each submitted map fingerprint before launching verification. Validated by: scripts/test_5k_submissions_bundle.mjs.
70. Confirm every submitted drive uses its authored map. Validated by: scripts/test_5k_submissions_bundle.mjs.
71. Confirm every submitted drive uses its authored seed. Validated by: scripts/test_5k_submissions_bundle.mjs.
72. Confirm every submitted drive uses its authored challenge revision. Validated by: scripts/test_5k_submissions_bundle.mjs.
73. Require lockstep metadata for verifiable submission results. Validated by: scripts/test_5k_submissions_bundle.mjs.
74. Require a result fingerprint for every submitted drive. Validated by: scripts/test_5k_submissions_bundle.mjs.
75. Validate submission failure reasons before displaying or replaying them. Validated by: scripts/test_5k_submissions_bundle.mjs.
76. Check that a submitted drive's verdict agrees with the presence of failures. Validated by: scripts/test_5k_submissions_bundle.mjs.
77. Reject nonnumeric or out-of-range decision shares in submitted reports. Validated by: scripts/test_5k_submissions_bundle.mjs.
78. Check the report summary's run identity against the manifest. Validated by: scripts/test_5k_submissions_bundle.mjs.
79. Check the report summary's drive denominator against the submitted rows. Validated by: scripts/test_5k_submissions_bundle.mjs.
80. Recompute the submitted pass count before replay. Validated by: scripts/test_5k_submissions_bundle.mjs.
81. Check the submitted open-track flag total against its drives. Validated by: scripts/test_5k_submissions_bundle.mjs.
82. Reconcile reported, recorded, and manifest costs before replay. Validated by: scripts/test_5k_submissions_bundle.mjs.
83. Reject published rows that claim a measurement missing from their recorded drive. Validated by: scripts/test_5k_submissions_bundle.mjs.
84. Explain driver, model, and track identity mismatches during checkout verification. Validated by: scripts/test_5k_submissions_bundle.mjs.
85. Check the clean source claim before the verifier attempts to contact the simulator. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
86. Diagnose the exact Node and V8 runtime needed for verification. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
87. Name a missing Arena runner in the requested replay checkout. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
88. Honor the PORT environment variable when no submission replay port is supplied. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
89. Explain a verifier timeout using the configured millisecond limit. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
90. Separate a child exit status from a child signal in verifier diagnostics. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
91. Detect a replay process that returned without writing its report. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
92. Verify the stored checksum syntax for published submissions. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
93. Accept uppercase hexadecimal in an otherwise valid published checksum. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
94. Validate submitter attribution when reading a published artifact. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
95. Offer offline submission inspection with tape integrity checks and outcome counts. Validated by: scripts/test_cli_tooling.mjs and the Boat submission smoke check.
96. Give the Arena merge tool a dedicated help flag. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
97. Show the final Arena merge plan without writing the requested output. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
98. Reject repeated Arena merge destination flags. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
99. Reject unsupported Arena merge output suffixes. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
100. Reject Arena merge destinations that are symbolic links. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
101. Detect repeated Arena shard inputs identified by their filesystem inode. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
102. Validate the set and track on each Arena shard before merging. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
103. Reject duplicate Arena drive IDs in a shard plan. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
104. Require map fingerprint metadata on Arena merge inputs. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
105. Reject invalid Arena shard recording timestamps. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
106. Validate the Arena merge manifest's suite kind and declared set. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
107. Check each Arena shard's declared cost against its drive results. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
108. Reject simulation errors when assembling merged Arena recordings. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
109. Verify authored weather and time of day when merging Arena results. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
110. Normalize the default guarded track across older and newer Arena shards. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
111. Choose the earliest actual recording time when Arena timestamps carry different offsets. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
112. Provide help for seeded benchmark recording merges. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
113. Preview seeded benchmark merge coverage without creating report and tape files. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
114. Reject repeated flag names in seeded benchmark merges. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
115. Check all benchmark merge file inputs and outputs for aliases. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
116. Require a valid benchmark report timestamp. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
117. Validate the seeded benchmark configuration before matching results. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
118. Reject a seeded benchmark shard interrupted by a simulation error. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
119. Require exact drive identifiers and boolean verdicts in seeded benchmark shard reports. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
120. Reject an Arena tape submitted as a benchmark merge part. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
121. Match the benchmark tape's driver to its report configuration. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
122. Validate cost values before merging benchmark shard reports. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
123. Validate regenerated benchmark route arrays before fingerprinting them. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
124. Check the generated list of benchmark drive IDs for invalid elements. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
125. Name the exact benchmark shard that generated a conflicting route fingerprint. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
126. Order merged benchmark timestamps by actual time across timezone offsets. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
127. Display a repeat plan's drive IDs and total workload offline. Validated by: scripts/test_5k_submissions_repeats.mjs.
128. Allow a repeat plan to pin the V8 version. Validated by: scripts/test_5k_submissions_repeats.mjs.
129. Require a complete Node version when a repeat plan pins the runtime. Validated by: scripts/test_5k_submissions_repeats.mjs.
130. Reject repeat-plan provider settings attached to a non-LLM driver. Validated by: scripts/test_5k_submissions_repeats.mjs.
131. Validate the scheme, credentials, and fragment of a repeat-plan provider URL. Validated by: scripts/test_5k_submissions_repeats.mjs.
132. Require the loaded repeat suite to identify itself with the planned version. Validated by: scripts/test_5k_submissions_repeats.mjs.
133. Distinguish malformed outcome model identifiers from mixed model versions. Validated by: scripts/test_5k_submissions_repeats.mjs.
134. Reject malformed provider request traces before comparing their settings. Validated by: scripts/test_5k_submissions_repeats.mjs.
135. Recognize hard-linked repeat inputs as duplicate attempts. Validated by: scripts/test_5k_submissions_repeats.mjs.
136. Check repeat recording timestamps before report generation. Validated by: scripts/test_5k_submissions_repeats.mjs.
137. Validate counted repeat measures as nonnegative safe integers. Validated by: scripts/test_5k_submissions_repeats.mjs.
138. Validate repeat durations and audit measurements before aggregation. Validated by: scripts/test_5k_submissions_repeats.mjs.
139. Reject repeats with more flagged choices than decisions. Validated by: scripts/test_5k_submissions_repeats.mjs.
140. Reject repeats with more partial decisions than model decisions. Validated by: scripts/test_5k_submissions_repeats.mjs.
141. Report a repeat drive's simulation error before aggregating it. Validated by: scripts/test_5k_submissions_repeats.mjs.
142. Reconcile repeat tape costs with manifest totals when present. Validated by: scripts/test_5k_submissions_repeats.mjs.
143. Reconcile repeat map fingerprints with their manifest when present. Validated by: scripts/test_5k_submissions_repeats.mjs.
144. Save repeat comparisons to new plain or gzipped JSON files. Validated by: scripts/test_5k_submissions_repeats.mjs.
145. Report input token spreads when repeats measure usage. Validated by: scripts/test_5k_submissions_repeats.mjs.
146. Report output token spreads when repeats measure usage. Validated by: scripts/test_5k_submissions_repeats.mjs.
147. Report partial-decision spreads independently from fallbacks. Validated by: scripts/test_5k_submissions_repeats.mjs.
148. Report local-decision spreads independently from model choices. Validated by: scripts/test_5k_submissions_repeats.mjs.
149. Show each recorded attempt's timestamp in the repeat report. Validated by: scripts/test_5k_submissions_repeats.mjs.
150. Show emergency-brake intervention spread for each repeated drive. Validated by: scripts/test_5k_submissions_repeats.mjs.
151. Show fallback spread for each repeated drive. Validated by: scripts/test_5k_submissions_repeats.mjs.
152. Show per-drive flagged-choice spreads on the open track. Validated by: scripts/test_5k_submissions_repeats.mjs.
153. Scaffold a standalone local-driver module from the checker. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
154. Allow a scaffold to use an explicit display label independent of its ID. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
155. Validate a trusted local module and its factory without launching the server. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
156. Detect a local factory returning the same instance for different runs. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
157. Limit each Arena child process in the driver comparison with a configurable timeout. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
158. Use an alternate saved leaderboard in the local-driver checker. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
159. Export local-driver comparisons to new plain or gzip JSON reports. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
160. Carry expected drive counts from the checker through to all Arena comparisons. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
161. Include measured flags, fallbacks, and interventions in machine-readable driver comparisons. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
162. Exclude realtime published runs from the lockstep driver comparison. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
163. Skip invalid row metadata without dropping the published leaderboard. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
164. Check authored weather, seed, and time before matching published comparisons. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
165. Give the latitude analysis tool dedicated CLI help. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
166. Use strict flag and operand parsing in latitude analysis. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
167. Reject nonfinite latitude timing arguments. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
168. Support a bounded number of challenges in latitude analysis. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
169. Write gzip latitude reports with atomic per-drive checkpoint updates. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
170. Use authenticated loopback preflight and reject redirects in latitude analysis. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
171. Add a quiet mode that keeps latitude progress out of stdout. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
172. Add a checked latitude mode that fails when the baseline branch cannot be verified. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
173. Identify the exact map that failed to load in latitude analysis. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
174. Index baseline positions by tick for latitude branch comparison. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
175. Walk recorded decisions once when matching latitude checkpoints to the next decision. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
176. Cover identical simultaneous requests completing out of order while replay keeps the original request order. Validated by: scripts/test_5k_submissions_tapes.mjs.
177. Cover the remaining-answer count before any requests have been replayed and after all answers have been used. Validated by: scripts/test_5k_submissions_tapes.mjs.
178. Cover model replay applying the current tick even when a raw provider response was saved. Validated by: scripts/test_5k_submissions_tapes.mjs.
179. Cover an Arena recording stopped between drives replaying the finished subset. Validated by: scripts/test_5k_submissions_tapes.mjs.
180. Cover inspection distinguishing a recorded null response from timeout, cancellation, and transport error outcomes. Validated by: scripts/test_5k_submissions_tapes.mjs.
181. Check committed model and Arena tape encoding compatibility across the recording directory. Validated by: scripts/test_5k_submissions_tapes.mjs.
182. Pin sparse-array canonicalization for stable recording keys. Validated by: scripts/test_5k_submissions_tapes.mjs.
183. Pin object canonicalization with undefined members and reordered keys. Validated by: scripts/test_5k_submissions_tapes.mjs.
184. Check that tape result matching ignores wall-clock duration. Validated by: scripts/test_5k_submissions_tapes.mjs.
185. Check that tape result matching still distinguishes a changed drive verdict. Validated by: scripts/test_5k_submissions_tapes.mjs.
186. Check that published row verification tolerates recorded fields omitted from the public projection. Validated by: scripts/test_5k_submissions_bundle.mjs.
187. Check that published row verification does not treat wall-clock timings as recorded metrics. Validated by: scripts/test_5k_submissions_bundle.mjs.
188. Pin the summary mismatch diagnostic to its exact report field. Validated by: scripts/test_5k_submissions_bundle.mjs.
189. Bound submission report difference output to twelve field changes in regression coverage. Validated by: scripts/test_5k_submissions_bundle.mjs.
190. Check merged Arena tapes keep the answer payloads from different file encodings. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
191. Check that a merged benchmark report orders results by the generated suite rather than input file order. Validated by: scripts/test_5k_submissions_merge.mjs and scripts/test_merge_recordings.mjs.
192. Check that scaffold creation preserves an existing file. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
193. Check that the generated driver chooses the first eligible candidate when projected progress ties. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
194. Check that the generated driver can return control to Rules for an empty eligible list. Validated by: scripts/test_5k_submissions_cli.mjs and the Boat driver smoke check.
195. Document how to create a standalone agent, validate its factory, and load the same module in the browser. Validated by: uv run --locked python -m unittest discover -s tests -p "test_doc_links.py" and the Boat driver smoke check.
196. Correct the agent guide to distinguish the default decision deadline from a custom timeout. Validated by: uv run --locked python -m unittest discover -s tests -p "test_doc_links.py" and the Boat driver smoke check.
197. Document the driver's expected selection count and check-mode exit status. Validated by: uv run --locked python -m unittest discover -s tests -p "test_doc_links.py" and the Boat driver smoke check.
198. Document saving a machine-readable driver comparison and locating enforcement measurements. Validated by: uv run --locked python -m unittest discover -s tests -p "test_doc_links.py" and the Boat driver smoke check.
199. Document the offline tape inspection paths for a bundle and a standalone recording. Validated by: uv run --locked python -m unittest discover -s tests -p "test_doc_links.py" and the Boat driver smoke check.
200. Document the verifier timeout and the need to run the server from the replay checkout. Validated by: uv run --locked python -m unittest discover -s tests -p "test_doc_links.py" and the Boat driver smoke check.
