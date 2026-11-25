# Benchmark runner

The benchmark runner adds route selection, progress and recovery artifacts, canonical suite diagnostics, trace controls, and fixed hard-city coverage reports. The browser benchmark can cancel planning and keep completed drives. Regression checks pin the saved measurement and comparison rules.

1. Consolidate hard-city soak shards into one offline report. Validated by: scripts/test_5k_bench_hard_city.mjs.
2. Write the hard-city report as Markdown for review. Validated by: scripts/test_5k_bench_hard_city.mjs.
3. Read and write gzip artifacts in the hard-city report command. Validated by: scripts/test_5k_bench_hard_city.mjs.
4. Add a hard-city check mode that exits unsuccessfully for incomplete or failing coverage. Validated by: scripts/test_5k_bench_hard_city.mjs.
5. Protect the input shards from being overwritten by report output. Validated by: scripts/test_5k_bench_hard_city.mjs.
6. Preserve the fixed leg order when hard-city reports arrive out of order. Validated by: scripts/test_5k_bench_hard_city.mjs.
7. Distinguish harness errors, drive failures, skipped legs, and missing legs in hard-city reports. Validated by: scripts/test_5k_bench_hard_city.mjs.
8. Show fixed weather, hour, and parking conditions alongside each leg. Validated by: scripts/test_5k_bench_hard_city.mjs.
9. Show fixed map and route fingerprints in the consolidated report. Validated by: scripts/test_5k_bench_hard_city.mjs.
10. Track which shard numbers supplied evidence. Validated by: scripts/test_5k_bench_hard_city.mjs.
11. Report parking unavailability separately from a successful park. Validated by: scripts/test_5k_bench_hard_city.mjs.
12. Include existing display scores alongside hard-city route verdicts. Validated by: scripts/test_5k_bench_hard_city.mjs.
13. Expose the time, minimum TTC, and safety-brake count for hard-city review. Validated by: scripts/test_5k_bench_hard_city.mjs.
14. Render multi-line harness errors safely in Markdown tables. Validated by: scripts/test_5k_bench_hard_city.mjs.
15. Reject hard-city reports using a different slice or schema. Validated by: scripts/test_5k_bench_hard_city.mjs.
16. Reject invalid hard-city shard coordinates. Validated by: scripts/test_5k_bench_hard_city.mjs.
17. Reject hard-city reports that disagree on the total number of shards. Validated by: scripts/test_5k_bench_hard_city.mjs.
18. Reject a repeated hard-city shard. Validated by: scripts/test_5k_bench_hard_city.mjs.
19. Reject legs assigned to another shard. Validated by: scripts/test_5k_bench_hard_city.mjs.
20. Reject duplicate hard-city evidence, including contradictory skipped records. Validated by: scripts/test_5k_bench_hard_city.mjs.
21. Reject hard-city harness errors that also claim drive results. Validated by: scripts/test_5k_bench_hard_city.mjs.
22. Reject invalid hard-city pass and arrival verdicts. Validated by: scripts/test_5k_bench_hard_city.mjs.
23. Reject hard-city verdicts that contradict the recorded failures. Validated by: scripts/test_5k_bench_hard_city.mjs.
24. Enforce the fixed driver and clock on hard-city evidence. Validated by: scripts/test_5k_bench_hard_city.mjs.
25. Verify the hard-city traffic count instead of relying on route identity alone. Validated by: scripts/test_5k_bench_hard_city.mjs.
26. Verify the weather on hard-city evidence. Validated by: scripts/test_5k_bench_hard_city.mjs.
27. Verify the fixed hour and destination parking setting on hard-city evidence. Validated by: scripts/test_5k_bench_hard_city.mjs.
28. Verify the fixed seed and requested suite size on hard-city evidence. Validated by: scripts/test_5k_bench_hard_city.mjs.
29. Require the full city preset for hard-city evidence. Validated by: scripts/test_5k_bench_hard_city.mjs.
30. Reject other rule-enforcement tracks for fixed hard-city results. Validated by: scripts/test_5k_bench_hard_city.mjs.
31. Reject stopped runs from fixed hard-city evidence. Validated by: scripts/test_5k_bench_hard_city.mjs.
32. Require the manifest to identify the fixed benchmark route selection. Validated by: scripts/test_5k_bench_hard_city.mjs.
33. Show fingerprints and fixed NPC counts in hard-city dry-run plans. Validated by: scripts/test_5k_bench_hard_city.mjs.
34. Validate programmatic soak map and seed lists before building shard IDs. Validated by: scripts/test_5k_bench_hard_city.mjs.
35. Reject nonboolean held-out policy in programmatic soak plans. Validated by: scripts/test_5k_bench_hard_city.mjs.
36. Reject contradictory soak include and exclude selections. Validated by: scripts/test_5k_bench_hard_city.mjs.
37. Add optional full-plan coverage and outcomes to soak reports. Validated by: scripts/test_5k_bench_hard_city.mjs.
38. Retry unattempted and failed legs from an existing coverage report. Validated by: scripts/test_5k_bench_hard_city.mjs.
39. Preserve completed passing evidence in a soak retry artifact. Validated by: scripts/test_5k_bench_hard_city.mjs.
40. Refuse soak retries made with a different shard partition. Validated by: scripts/test_5k_bench_hard_city.mjs.
41. Refuse soak retries made with a different audit or route-count policy. Validated by: scripts/test_5k_bench_hard_city.mjs.
42. Refuse soak retries when planned drive conditions changed. Validated by: scripts/test_5k_bench_hard_city.mjs.
43. Require a unique corresponding run for each reused passing leg. Validated by: scripts/test_5k_bench_hard_city.mjs.
44. Identify a missing or unreadable benchmark result file as a soak harness failure. Validated by: scripts/test_5k_bench_hard_city.mjs.
45. Avoid creating a temporary directory for a soak with no work. Validated by: scripts/test_5k_bench_hard_city.mjs.
46. Limit trace comparison to an absolute tick range. Validated by: scripts/test_5k_bench_trace.mjs.
47. Limit state comparisons to the ego vehicle. Validated by: scripts/test_5k_bench_trace.mjs.
48. Limit state comparisons to traffic. Validated by: scripts/test_5k_bench_trace.mjs.
49. Compare one traffic actor over the selected ticks. Validated by: scripts/test_5k_bench_trace.mjs.
50. Reject an actor selection that would compare no traffic. Validated by: scripts/test_5k_bench_trace.mjs.
51. Match trace traffic by ID with an explicit order-insensitive mode. Validated by: scripts/test_5k_bench_trace.mjs.
52. Allow shortest-angle heading comparison across the angle boundary. Validated by: scripts/test_5k_bench_trace.mjs.
53. Keep exact heading drift visible when wrapped headings are within tolerance. Validated by: scripts/test_5k_bench_trace.mjs.
54. Report wrapped heading maxima in aggregate drift statistics. Validated by: scripts/test_5k_bench_trace.mjs.
55. Explain the first divergent trace tick with several bounded field differences. Validated by: scripts/test_5k_bench_trace.mjs.
56. Allow an explicitly state-focused trace check to ignore decision differences. Validated by: scripts/test_5k_bench_trace.mjs.
57. Allow a trace check to ignore final result differences. Validated by: scripts/test_5k_bench_trace.mjs.
58. Allow length checks to be excluded explicitly from trace comparisons. Validated by: scripts/test_5k_bench_trace.mjs.
59. Keep trace context windows within the requested tick range. Validated by: scripts/test_5k_bench_trace.mjs.
60. Retain absolute peak-drift ticks when comparing a slice. Validated by: scripts/test_5k_bench_trace.mjs.
61. Report the actual shared tick count for a sliced comparison. Validated by: scripts/test_5k_bench_trace.mjs.
62. Distinguish missing steps inside the selected range from capture differences beyond it. Validated by: scripts/test_5k_bench_trace.mjs.
63. Reject ranges extending past the end of either available capture. Validated by: scripts/test_5k_bench_trace.mjs.
64. Report the selected trace scope in machine-readable output. Validated by: scripts/test_5k_bench_trace.mjs.
65. Expose ignored categories and traffic-order policy in machine-readable trace comparisons. Validated by: scripts/test_5k_bench_trace.mjs.
66. Reject negative elapsed time in a trace verdict. Validated by: scripts/test_5k_bench_trace.mjs.
67. Reject blank scenario IDs in trace captures. Validated by: scripts/test_5k_bench_trace.mjs.
68. Detect nonfinite or nonnumeric recorded pose components. Validated by: scripts/test_5k_bench_trace.mjs.
69. Reject trace traffic actors with invalid IDs. Validated by: scripts/test_5k_bench_trace.mjs.
70. Reject repeated actor identities within a trace tick. Validated by: scripts/test_5k_bench_trace.mjs.
71. Reject malformed trace decision records. Validated by: scripts/test_5k_bench_trace.mjs.
72. Reject invalid decision counters in traces. Validated by: scripts/test_5k_bench_trace.mjs.
73. Validate categorical decision fields before comparing traces. Validated by: scripts/test_5k_bench_trace.mjs.
74. Offer strict trace checks for complete production poses and decision fields. Validated by: scripts/test_5k_bench_trace.mjs.
75. Select benchmark routes by minimum length. Validated by: scripts/test_5k_bench_selection.mjs.
76. Select benchmark routes by maximum length. Validated by: scripts/test_5k_bench_selection.mjs.
77. Select routes with a minimum signal count. Validated by: scripts/test_5k_bench_selection.mjs.
78. Select routes with a maximum signal count. Validated by: scripts/test_5k_bench_selection.mjs.
79. Select routes with a minimum stop-sign count. Validated by: scripts/test_5k_bench_selection.mjs.
80. Select routes with a maximum stop-sign count. Validated by: scripts/test_5k_bench_selection.mjs.
81. Select routes with a minimum number of left turns. Validated by: scripts/test_5k_bench_selection.mjs.
82. Select routes with a maximum number of left turns. Validated by: scripts/test_5k_bench_selection.mjs.
83. Select routes with a minimum number of right turns. Validated by: scripts/test_5k_bench_selection.mjs.
84. Select routes with a maximum number of right turns. Validated by: scripts/test_5k_bench_selection.mjs.
85. Compose route geometry filters with named selectors before applying the drive limit. Validated by: scripts/test_5k_bench_selection.mjs.
86. Reject inverted benchmark filter bounds. Validated by: scripts/test_5k_bench_selection.mjs.
87. Reject routes without the tag needed by a geometry filter. Validated by: scripts/test_5k_bench_selection.mjs.
88. Reject duplicate route IDs before driving or building a manifest. Validated by: scripts/test_5k_bench_selection.mjs.
89. Reject overlap between benchmark include and exclude selections. Validated by: scripts/test_5k_bench_selection.mjs.
90. Trim named benchmark starting routes and reject a blank start. Validated by: scripts/test_5k_bench_selection.mjs.
91. Include route coverage in benchmark list and run output on request. Validated by: scripts/test_5k_bench_selection.mjs.
92. Distinguish selected-but-pending routes from routes excluded by the selection. Validated by: scripts/test_5k_bench_selection.mjs.
93. Count distinct failing routes per failure reason in coverage reports. Validated by: scripts/test_5k_bench_selection.mjs.
94. Require the generated count on demand without rejecting intentional subsets. Validated by: Boat benchmark CLI integration.
95. Write a separately marked partial benchmark checkpoint after each completed drive. Validated by: Boat benchmark CLI integration.
96. Check checkpoint path collisions with benchmark inputs and other outputs. Validated by: scripts/test_5k_bench_selection.mjs.
97. Prevent benchmark-only output modes from being used during a list operation. Validated by: scripts/test_5k_bench_selection.mjs.
98. Emit benchmark route-generation progress independently of final JSON. Validated by: Boat benchmark CLI integration.
99. Emit per-route finish progress with verdict and simulated duration. Validated by: Boat benchmark CLI integration.
100. Report short suite generation in benchmark progress output. Validated by: Boat benchmark CLI integration.
101. Reject held-out count or seed overrides before connecting to the server. Validated by: scripts/test_5k_bench_selection.mjs.
102. Reject a blank benchmark driver ID before connecting. Validated by: scripts/test_5k_bench_selection.mjs.
103. Check the CLI hour range before connecting. Validated by: scripts/test_5k_bench_selection.mjs.
104. Validate comma-separated feature exclusions before starting a benchmark. Validated by: scripts/test_5k_bench_selection.mjs.
105. Require decimal reserve input instead of accepting hexadecimal dollar amounts. Validated by: scripts/test_5k_bench_selection.mjs.
106. Reject arena artifacts at the benchmark replay entry point. Validated by: scripts/test_5k_bench_selection.mjs.
107. Reject benchmark replay headers that specify a realtime clock. Validated by: scripts/test_5k_bench_selection.mjs.
108. Report unexpected benchmark runner errors with benchmark context. Validated by: scripts/test_5k_bench_selection.mjs.
109. Require the returned map bounds to contain four finite coordinates. Validated by: Boat benchmark CLI integration.
110. Explain the eligibility of an existing run manifest without replaying it. Validated by: scripts/test_5k_bench_canonical.mjs.
111. Add a check mode for the report's declared canonical suite badge. Validated by: scripts/test_5k_bench_canonical.mjs.
112. Report the actual and expected fields for canonical configuration mismatches. Validated by: scripts/test_5k_bench_canonical.mjs.
113. Identify map and route fingerprint mismatches independently in canonical suite diagnostics. Validated by: scripts/test_5k_bench_canonical.mjs.
114. Identify invalid held-out seed lists and expected route counts in canonical diagnostics. Validated by: scripts/test_5k_bench_canonical.mjs.
115. Explain generated and completed route ID discrepancies independently. Validated by: scripts/test_5k_bench_canonical.mjs.
116. Identify an explicitly subsetted manifest in suite eligibility diagnostics. Validated by: scripts/test_5k_bench_canonical.mjs.
117. Identify an interrupted report in suite eligibility diagnostics. Validated by: scripts/test_5k_bench_canonical.mjs.
118. Detect disagreement between a report's benchmark config and its manifest. Validated by: scripts/test_5k_bench_canonical.mjs.
119. Protect the checked-in canonical definition against mutation at runtime. Validated by: scripts/test_5k_bench_canonical.mjs.
120. Identify missing and extra arena drive definitions in suite diagnostics. Validated by: scripts/test_5k_bench_canonical.mjs.
121. Identify missing and extra arena map fingerprints in suite diagnostics. Validated by: scripts/test_5k_bench_canonical.mjs.
122. Identify duplicate or unknown completed arena drives. Validated by: scripts/test_5k_bench_canonical.mjs.
123. Identify stopped or missing completed arena drives. Validated by: scripts/test_5k_bench_canonical.mjs.
124. Name a drive whose completion record disagrees with authored inputs. Validated by: scripts/test_5k_bench_canonical.mjs.
125. Accept whitespace around valid browser feature exclusions. Validated by: scripts/test_bench_view.mjs.
126. Reject holes in benchmark feature exclusion arrays. Validated by: scripts/test_5k_bench_runtime.mjs.
127. Protect the ordered benchmark preset and feature catalogs from mutation. Validated by: scripts/test_5k_bench_runtime.mjs.
128. Protect held-out seed plans from mutation by callers. Validated by: scripts/test_5k_bench_runtime.mjs.
129. Stop route planning when a browser benchmark is canceled. Validated by: scripts/test_bench_view.mjs.
130. Stop visiting held-out seeds after canceling a held-out run. Validated by: scripts/test_5k_bench_runtime.mjs.
131. Report which suite seed and attempt encountered a routing request failure. Validated by: scripts/test_5k_bench_runtime.mjs.
132. Reject malformed routing responses instead of treating them as unroutable trips. Validated by: scripts/test_5k_bench_runtime.mjs.
133. Validate the suite size against the safe integer attempt budget. Validated by: scripts/test_5k_bench_runtime.mjs.
134. Validate programmatic suite seeds before using the random generator. Validated by: scripts/test_5k_bench_runtime.mjs.
135. Validate the route restriction hour and weekday before asking the router. Validated by: scripts/test_5k_bench_runtime.mjs.
136. Provide a route-accepted callback during suite construction. Validated by: scripts/test_5k_bench_runtime.mjs.
137. Give a clear error for a scenario with an unusable route length. Validated by: scripts/test_5k_bench_runtime.mjs.
138. Reject malformed traffic count, diagnostics and clock options at the runner boundary. Validated by: scripts/test_5k_bench_runtime.mjs.
139. Reject unknown weather and track at the runner boundary. Validated by: scripts/test_5k_bench_runtime.mjs.
140. Reject invalid or unavailable benchmark driver IDs in scenario setup. Validated by: scripts/test_5k_bench_runtime.mjs.
141. Identify a missing scenario start lane before placing the ego car. Validated by: scripts/test_5k_bench_runtime.mjs.
142. Reject a start position outside its lane. Validated by: scripts/test_5k_bench_runtime.mjs.
143. Suppress tick-zero sampling for a benchmark canceled before it starts. Validated by: scripts/test_5k_bench_runtime.mjs.
144. Mark interrupted individual drives in headless results. Validated by: scripts/test_5k_bench_runtime.mjs.
145. Cancel the active autopilot request when the benchmark receives an abort signal. Validated by: scripts/test_bench_options.mjs and scripts/test_5k_bench_runtime.mjs.
146. Keep the incident diagnostic cap without repeatedly scanning all accumulated incidents. Validated by: scripts/test_bench_options.mjs and scripts/test_5k_bench_runtime.mjs.
147. Aggregate minima without exceeding the JavaScript argument limit. Validated by: scripts/test_5k_bench_runtime.mjs.
148. Hide browser deltas when the map fingerprints differ. Validated by: scripts/test_5k_bench_runtime.mjs.
149. Hide browser deltas across different JavaScript engines. Validated by: scripts/test_5k_bench_runtime.mjs.
150. Hide browser deltas across different covering rows. Validated by: scripts/test_5k_bench_runtime.mjs.
151. Hide browser deltas when held-out seed lists differ. Validated by: scripts/test_5k_bench_runtime.mjs.
152. Treat the omitted city clock and explicit default hour as comparable. Validated by: scripts/test_5k_bench_runtime.mjs.
153. Hide browser deltas during an in-progress run. Validated by: scripts/test_5k_bench_runtime.mjs.
154. Handle missing condition metadata and corrupt route identities during comparisons. Validated by: scripts/test_5k_bench_runtime.mjs.
155. Search browser route rows by explicit verdict. Validated by: scripts/test_5k_bench_runtime.mjs.
156. Search browser route rows by explicit parking outcome. Validated by: scripts/test_5k_bench_runtime.mjs.
157. Include open track, parking, hour, covering row, and realtime conditions in export filenames. Validated by: scripts/test_5k_bench_runtime.mjs.
158. Retain the stopped marker when exporting a saved browser benchmark. Validated by: scripts/test_bench_view.mjs.
159. Mark exported in-progress browser reports as partial. Validated by: scripts/test_bench_view.mjs.
160. Retain source manifests when downloading previously saved browser runs. Validated by: scripts/test_bench_view.mjs.
161. Reject corrupt saved runs with missing or duplicate route IDs. Validated by: scripts/test_5k_bench_runtime.mjs.
162. Deduplicate concurrent requests for the same browser comparison. Validated by: scripts/test_bench_view.mjs.
163. Carry over stop metadata into cached browser comparisons. Validated by: scripts/test_bench_view.mjs.
164. Match browser results to rows by route ID instead of row position. Validated by: scripts/test_bench_view.mjs.
165. Snapshot filter controls once per browser table render. Validated by: scripts/test_bench_view.mjs.
166. Show completed and passed route counts when returning an unsaved browser benchmark. Validated by: scripts/test_bench_view.mjs.
167. Tell browser users if suite generation returned fewer routes than requested. Validated by: scripts/test_bench_view.mjs.
168. Retain the recording in the returned browser result when server saving was disabled. Validated by: scripts/test_bench_view.mjs.
169. Show which artifact survived a partial save failure and where to download results. Validated by: scripts/test_5k_bench_runtime.mjs.
170. Pin distance accumulation while the vehicle is reversing. Validated by: scripts/test_5k_bench_metrics.mjs.
171. Pin the boundary between a stop and slow movement. Validated by: scripts/test_5k_bench_metrics.mjs.
172. Pin the strict speeding threshold. Validated by: scripts/test_5k_bench_metrics.mjs.
173. Verify that speed away from a mapped road contributes no speeding time. Validated by: scripts/test_5k_bench_metrics.mjs.
174. Pin peak lateral acceleration as an absolute magnitude. Validated by: scripts/test_5k_bench_metrics.mjs.
175. Verify that lane-center error follows the active lane during a lane change. Validated by: scripts/test_5k_bench_metrics.mjs.
176. Verify that off-route samples do not affect lane-center RMS. Validated by: scripts/test_5k_bench_metrics.mjs.
177. Verify that repeated samples in one lane change count the maneuver once. Validated by: scripts/test_5k_bench_metrics.mjs.
178. Check that route progress does not decrease after a projection falls behind. Validated by: scripts/test_5k_bench_metrics.mjs.
179. Check that progress is capped at the route's end. Validated by: scripts/test_5k_bench_metrics.mjs.
180. Check that very slow approaches do not contribute a gap measurement. Validated by: scripts/test_5k_bench_metrics.mjs.
181. Verify that alongside traffic does not count as a leader. Validated by: scripts/test_5k_bench_metrics.mjs.
182. Pin the closing-speed cutoff for time-to-collision sampling. Validated by: scripts/test_5k_bench_metrics.mjs.
183. Pin the ego-speed cutoff for time-headway sampling. Validated by: scripts/test_5k_bench_metrics.mjs.
184. Check that a single deceleration sample does not count as a hard brake. Validated by: scripts/test_5k_bench_metrics.mjs.
185. Verify that sustained deceleration counts one hard-braking event. Validated by: scripts/test_5k_bench_metrics.mjs.
186. Check the jerk measurement when hard braking is released. Validated by: scripts/test_5k_bench_metrics.mjs.
187. Pin the latency median convention for an even number of samples. Validated by: scripts/test_5k_bench_metrics.mjs.
188. Verify the latency upper percentile on an unsorted sample. Validated by: scripts/test_5k_bench_metrics.mjs.
189. Check that computing latency percentiles leaves sample order intact. Validated by: scripts/test_5k_bench_metrics.mjs.
190. Check that decision attribution subtracts the pre-drive counters. Validated by: scripts/test_5k_bench_metrics.mjs.
191. Verify that partial decisions are not counted twice in model share. Validated by: scripts/test_5k_bench_metrics.mjs.
192. Verify that zero decisions produce unavailable shares. Validated by: scripts/test_5k_bench_metrics.mjs.
193. Check aggregate model share by total decisions rather than by averaging percentages. Validated by: scripts/test_5k_bench_metrics.mjs.
194. Check that guarded-trace results leave out open-track flags. Validated by: scripts/test_5k_bench_metrics.mjs.
195. Verify that flag counts are combined and emitted in stable check order. Validated by: scripts/test_5k_bench_metrics.mjs.
196. Check collision and stop-sign exposure per driven kilometre. Validated by: scripts/test_5k_bench_metrics.mjs.
197. Check that missing speeds do not lower mean recorded speed. Validated by: scripts/test_5k_bench_metrics.mjs.
198. Pin summed cost rounding to the report's precision. Validated by: scripts/test_5k_bench_metrics.mjs.
199. Verify that zero travelled distance produces an unavailable per-kilometre rate. Validated by: scripts/test_5k_bench_metrics.mjs.
200. Check that a simulation failure takes precedence over a deadlock without hiding a collision. Validated by: scripts/test_5k_bench_metrics.mjs.
