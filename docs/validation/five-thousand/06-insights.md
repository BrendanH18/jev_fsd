# Offline run analysis

The inspector compares matched changes, measures spread and recurring failures across saved attempts, and checks the evidence retained in run artifacts. Discover the reports with `--list-changes`, `--list-repeats`, and `--list-diagnostics`. Filter using `--list-fields` and `--list-cohorts` to look up accepted measurements and cohorts. These analyses read saved artifacts offline.

1. Attribute the change in total simulated duration to matched routes. Validated by: tests/test_5k_insights_changes.py.
2. Attribute the change in total driven distance to matched routes. Validated by: tests/test_5k_insights_changes.py.
3. Attribute the change in time spent stationary to matched routes. Validated by: tests/test_5k_insights_changes.py.
4. Attribute the change in time spent speeding to matched routes. Validated by: tests/test_5k_insights_changes.py.
5. Attribute the change in off-road duration to matched routes. Validated by: tests/test_5k_insights_changes.py.
6. Attribute the change in total collisions to matched routes. Validated by: tests/test_5k_insights_changes.py.
7. Attribute the change in at-fault collisions to matched routes. Validated by: tests/test_5k_insights_changes.py.
8. Attribute the change in red-light violations to matched routes. Validated by: tests/test_5k_insights_changes.py.
9. Attribute the change in missed stop signs to matched routes. Validated by: tests/test_5k_insights_changes.py.
10. Attribute the change in failures to yield to matched routes. Validated by: tests/test_5k_insights_changes.py.
11. Attribute the change in emergency brake interventions to matched routes. Validated by: tests/test_5k_insights_changes.py.
12. Attribute the change in hard braking events to matched routes. Validated by: tests/test_5k_insights_changes.py.
13. Attribute the change in lane change counts to matched routes. Validated by: tests/test_5k_insights_changes.py.
14. Attribute the change in deadlock overrides to matched routes. Validated by: tests/test_5k_insights_changes.py.
15. Attribute the change in fallback incidents to matched routes. Validated by: tests/test_5k_insights_changes.py.
16. Attribute the change in model calls to matched routes. Validated by: tests/test_5k_insights_changes.py.
17. Attribute the change in input tokens to matched routes. Validated by: tests/test_5k_insights_changes.py.
18. Attribute the change in driving decisions to matched routes. Validated by: tests/test_5k_insights_changes.py.
19. Attribute the change in provider spend to matched routes. Validated by: tests/test_5k_insights_changes.py.
20. Attribute the change in flagged choices to matched routes. Validated by: tests/test_5k_insights_changes.py.
21. Attribute the change in decisions handled by the model to matched routes. Validated by: tests/test_5k_insights_changes.py.
22. Attribute the change in locally resolved decisions to matched routes. Validated by: tests/test_5k_insights_changes.py.
23. Attribute the change in decisions made by Rules on fallback to matched routes. Validated by: tests/test_5k_insights_changes.py.
24. Attribute the change in partially answered model decisions to matched routes. Validated by: tests/test_5k_insights_changes.py.
25. Cross-tabulate matched pass, fail and unknown verdicts. Validated by: tests/test_5k_insights_changes.py.
26. Cross-tabulate arrivals, unfinished drives and unrecorded arrival status. Validated by: tests/test_5k_insights_changes.py.
27. Cross-tabulate matched parking outcomes with missing parking records visible. Validated by: tests/test_5k_insights_changes.py.
28. Count added, retained and removed failure reasons using pairs with recorded labels. Validated by: tests/test_5k_insights_changes.py.
29. Reconcile changes in the choice flag totals against each recorded road-rule check. Validated by: tests/test_5k_insights_changes.py.
30. Identify drives that now pass after a previous failure. Validated by: tests/test_5k_insights_changes.py.
31. Locate previously arriving drives that fall short in the comparison. Validated by: tests/test_5k_insights_changes.py.
32. Locate drives that recover from an unfinished attempt. Validated by: tests/test_5k_insights_changes.py.
33. Compare duration distributions within each matched verdict transition. Validated by: tests/test_5k_insights_changes.py.
34. Report a new simulation exception as a regression even on an already failing drive. Validated by: tests/test_5k_insights_changes.py.
35. Normalize the omitted city clock to the effective default in condition comparisons. Validated by: tests/test_5k_insights_changes.py.
36. Measure repeat-to-repeat spread in the existing composite driving score. Validated by: tests/test_5k_insights_repeats.py.
37. Measure repeat-to-repeat spread in the pace score. Validated by: tests/test_5k_insights_repeats.py.
38. Measure repeat-to-repeat spread in the comfort score. Validated by: tests/test_5k_insights_repeats.py.
39. Measure repeat-to-repeat spread in the safety margin score. Validated by: tests/test_5k_insights_repeats.py.
40. Measure repeat pass-rate spread using recorded boolean verdicts. Validated by: tests/test_5k_insights_repeats.py.
41. Measure repeat arrival-rate spread independently of pass rates. Validated by: tests/test_5k_insights_repeats.py.
42. Measure repeat parking success where the car could attempt to park. Validated by: tests/test_5k_insights_repeats.py.
43. Measure repeat flagged choices per decision using pooled exposure. Validated by: tests/test_5k_insights_repeats.py.
44. Measure repeat Rules fallback decisions per decision. Validated by: tests/test_5k_insights_repeats.py.
45. Measure repeat emergency brake interventions per decision. Validated by: tests/test_5k_insights_repeats.py.
46. Measure model decision share across repeats using measured decision counts. Validated by: tests/test_5k_insights_repeats.py.
47. Measure local decision share across repeats using measured decision counts. Validated by: tests/test_5k_insights_repeats.py.
48. Measure repeat partial answer rates among model decisions. Validated by: tests/test_5k_insights_repeats.py.
49. Measure repeat provider spend per recorded call. Validated by: tests/test_5k_insights_repeats.py.
50. Measure repeat input tokens per recorded call. Validated by: tests/test_5k_insights_repeats.py.
51. Measure the spread of total simulated time across repeat attempts. Validated by: tests/test_5k_insights_repeats.py.
52. Measure the spread of total driven distance across repeat attempts. Validated by: tests/test_5k_insights_repeats.py.
53. Measure the spread of recorded collision totals across repeat attempts. Validated by: tests/test_5k_insights_repeats.py.
54. Measure the spread of at-fault collision totals across repeat attempts. Validated by: tests/test_5k_insights_repeats.py.
55. Measure repeat red-light violation totals. Validated by: tests/test_5k_insights_repeats.py.
56. Measure repeat stop-sign violation totals. Validated by: tests/test_5k_insights_repeats.py.
57. Measure repeat failure-to-yield totals. Validated by: tests/test_5k_insights_repeats.py.
58. Measure repeat off-road duration separately from audit counts. Validated by: tests/test_5k_insights_repeats.py.
59. Measure repeat fallback incidents independently of fallback decision attribution. Validated by: tests/test_5k_insights_repeats.py.
60. Measure repeat emergency brake intervention totals independently of hard braking. Validated by: tests/test_5k_insights_repeats.py.
61. Measure repeat hard braking totals. Validated by: tests/test_5k_insights_repeats.py.
62. Measure the spread of total recorded spend across repeat attempts. Validated by: tests/test_5k_insights_repeats.py.
63. Measure the spread of the decision volume across repeat attempts. Validated by: tests/test_5k_insights_repeats.py.
64. Compare the strongest deceleration recorded in each repeat. Validated by: tests/test_5k_insights_repeats.py.
65. Compare the shortest closing time to collision recorded in each repeat. Validated by: tests/test_5k_insights_repeats.py.
66. Compare the shortest following headway recorded in each repeat. Validated by: tests/test_5k_insights_repeats.py.
67. Compare the highest lateral acceleration recorded in each repeat. Validated by: tests/test_5k_insights_repeats.py.
68. Report recurring failure reasons with their observed and total attempts. Validated by: tests/test_5k_insights_repeats.py.
69. Show saved verdict sequences and identify pass-to-fail or fail-to-pass variation. Validated by: tests/test_5k_insights_repeats.py.
70. Report verdict and label coverage for each repeat attempt. Validated by: tests/test_5k_insights_repeats.py.
71. Reject repeats with different recorded driver or model identities. Validated by: tests/test_5k_insights_repeats.py.
72. Reject repeats with differing declared suite versions. Validated by: tests/test_5k_insights_repeats.py.
73. Find incompatible drive metadata even when the first repeat omitted it. Validated by: tests/test_5k_insights_repeats.py.
74. Explain missing attempts and missing or changed geometry when constructing the repeat panel. Validated by: tests/test_5k_insights_repeats.py.
75. Exclude interrupted drives from repeat measurements with the affected attempt identified. Validated by: tests/test_5k_insights_repeats.py.
76. Locate missing and malformed verdicts by saved route row. Validated by: tests/test_5k_insights_evidence.py.
77. Find explicitly malformed failure-label lists. Validated by: tests/test_5k_insights_evidence.py.
78. Surface a saved pass that conflicts with a simulation exception. Validated by: tests/test_5k_insights_evidence.py.
79. Surface a saved pass on an interrupted drive. Validated by: tests/test_5k_insights_evidence.py.
80. Find at-fault collision counts exceeding all collisions on a drive. Validated by: tests/test_5k_insights_evidence.py.
81. Find stationary durations that exceed elapsed time beyond rounding precision. Validated by: tests/test_5k_insights_evidence.py.
82. Find speeding durations that exceed elapsed time beyond rounding precision. Validated by: tests/test_5k_insights_evidence.py.
83. Find off-road durations that exceed elapsed time beyond rounding precision. Validated by: tests/test_5k_insights_evidence.py.
84. Find saved p50 call latencies exceeding p95. Validated by: tests/test_5k_insights_evidence.py.
85. Find partial model answers exceeding the model decision count. Validated by: tests/test_5k_insights_evidence.py.
86. Find attributed decision totals disagreeing with independently recorded decisions. Validated by: tests/test_5k_insights_evidence.py.
87. Find decision source shares whose total exceeds the rounding tolerance around one. Validated by: tests/test_5k_insights_evidence.py.
88. Reconcile the saved flag total with the sum of the individual checks. Validated by: tests/test_5k_insights_evidence.py.
89. Locate positive flag counts on drives with zero decisions. Validated by: tests/test_5k_insights_evidence.py.
90. Locate recorded spend on drives with zero calls. Validated by: tests/test_5k_insights_evidence.py.
91. Locate fractional values in the collision counter. Validated by: tests/test_5k_insights_evidence.py.
92. Locate fractional values in the decision counter. Validated by: tests/test_5k_insights_evidence.py.
93. Find measured collisions that lack a collision verdict label. Validated by: tests/test_5k_insights_evidence.py.
94. Summarize event log coverage by presence, validity and retention status. Validated by: tests/test_5k_insights_evidence.py.
95. Count occurrences and affected routes independently for retained events. Validated by: tests/test_5k_insights_evidence.py.
96. Group retained collisions by the recorded obstacle kind. Validated by: tests/test_5k_insights_evidence.py.
97. Group retained collision records by fault attribution. Validated by: tests/test_5k_insights_evidence.py.
98. Group fallback events by recorded error status. Validated by: tests/test_5k_insights_evidence.py.
99. Find discrepancies between uncapped collision logs and the saved counter. Validated by: tests/test_5k_insights_evidence.py.
100. Identify retained events beyond the drive end with a rounding allowance. Validated by: tests/test_5k_insights_evidence.py.
101. Export the final saved pose and nearby-traffic diagnostic payload. Validated by: tests/test_5k_insights_evidence.py.
102. Export retained audit samples with the original sample index and context. Validated by: tests/test_5k_insights_evidence.py.
103. Separate missing audit counters from invalid values in coverage reports. Validated by: tests/test_5k_insights_evidence.py.
104. Find saved audit samples whose corresponding numeric counter is unavailable. Validated by: tests/test_5k_insights_evidence.py.
105. Avoid asserting rerouting was absent on a log that reached the retention ceiling. Validated by: tests/test_5k_insights_evidence.py.
106. Reject unusable exposure rates when the denominator is not positive and finite. Validated by: tests/test_5k_insights_evidence.py.
107. Accept a saved plain or gzip report from standard input. Validated by: tests/test_5k_insights_cli.py.
108. Detect compressed saved reports by content when they lack the original gzip suffix. Validated by: tests/test_5k_insights_cli.py.
109. Reject ambiguous duplicate object keys during JSON decoding. Validated by: tests/test_5k_insights_cli.py.
110. Surface decoder nesting failures with the input file name. Validated by: tests/test_5k_insights_cli.py.
111. Reject conflicting suite versions in the artifact and its configuration. Validated by: tests/test_5k_insights_cli.py.
112. Retain an artifact's stop explanation in run metadata. Validated by: tests/test_5k_insights_cli.py.
113. Keep a row explicitly marked held out out of tuned-run analyses. Validated by: tests/test_5k_insights_cli.py.
114. Expose the inspector through Python's module entry point. Validated by: tests/test_5k_insights_cli.py.
115. Support shell-style route ID selection. Validated by: tests/test_5k_insights_cli.py.
116. Support exact route exclusion independently of inclusive filters. Validated by: tests/test_5k_insights_cli.py.
117. Select routes by an inclusive lower bound on a measured field. Validated by: tests/test_5k_insights_cli.py.
118. Select routes by an inclusive upper bound on a measured field. Validated by: tests/test_5k_insights_cli.py.
119. Diagnose malformed, duplicated or contradictory numeric filter bounds. Validated by: tests/test_5k_insights_cli.py.
120. Keep numeric comparison selection on the baseline side. Validated by: tests/test_5k_insights_cli.py.
121. Keep malformed single-run route IDs from crashing exact-ID selection. Validated by: tests/test_5k_insights_cli.py.
122. Allow jobs to require at least one selected or matched drive. Validated by: tests/test_5k_insights_cli.py.
123. Allow jobs to require complete matching of selected drives. Validated by: tests/test_5k_insights_cli.py.
124. Compare multiple saved attempts offline through repeat mode. Validated by: tests/test_5k_insights_cli.py.
125. Check the supplied repeat count against a caller's declared plan. Validated by: tests/test_5k_insights_cli.py.
126. Reject repeat comparisons that reuse the same underlying artifact through an alias. Validated by: tests/test_5k_insights_cli.py.
127. Discover matched contributor and transition reports through the change catalog. Validated by: tests/test_5k_insights_cli.py.
128. Run the full catalog of matched change reports in one comparison. Validated by: tests/test_5k_insights_cli.py.
129. Discover repeat spread and recurrence reports through the repeat catalog. Validated by: tests/test_5k_insights_cli.py.
130. Discover evidence reports from the diagnostics catalog. Validated by: tests/test_5k_insights_cli.py.
131. List valid cohort keys directly from the profile registry. Validated by: tests/test_5k_insights_cli.py.
132. List measurable filter fields with their units. Validated by: tests/test_5k_insights_cli.py.
133. Export searchable catalogs as structured JSON, CSV or Markdown. Validated by: tests/test_5k_insights_cli.py.
134. Diagnose analysis filters erroneously supplied in listing mode. Validated by: tests/test_5k_insights_cli.py.
135. Diagnose blank values in exact and pattern filters. Validated by: tests/test_5k_insights_cli.py.
136. Detect invalid analysis mode combinations before reading saved files. Validated by: tests/test_5k_insights_cli.py.
137. Require full flag names to prevent accidental embedded option abbreviations. Validated by: tests/test_5k_insights_cli.py.
138. Show matched report measurements and coverage in flat formatted exports. Validated by: tests/test_5k_insights_cli.py.
139. Export repeat coverage, attempt values and spread in tabular formats. Validated by: tests/test_5k_insights_cli.py.
140. Retain matched report totals when top limits truncate displayed details. Validated by: tests/test_5k_insights_cli.py.
141. Include excluded route identities and reasons in formatted comparison output. Validated by: tests/test_5k_insights_cli.py.
142. Render terminal control characters as visible text in plain tables. Validated by: tests/test_5k_insights_cli.py.
143. Preserve literal Markdown link, code and emphasis syntax in saved values. Validated by: tests/test_5k_insights_cli.py.
144. Show source config metadata in formatted executive summaries. Validated by: tests/test_5k_insights_cli.py.
145. Expose JavaScript engine differences in comparisons and strict condition checks. Validated by: tests/test_5k_insights_cli.py.
146. Pin the length cohort for a route just under 500 metres. Validated by: tests/test_5k_insights_legacy.py.
147. Pin the length cohort for a route at exactly 1000 metres. Validated by: tests/test_5k_insights_legacy.py.
148. Check that the controls classifier identifies a stop-sign-only route. Validated by: tests/test_5k_insights_legacy.py.
149. Check that the controls classifier identifies a route without signals or stop signs. Validated by: tests/test_5k_insights_legacy.py.
150. Check that a route with both controls is classified separately. Validated by: tests/test_5k_insights_legacy.py.
151. Distinguish balanced nonzero left and right turns from turn-free routes. Validated by: tests/test_5k_insights_legacy.py.
152. Check the turn-free cohort using recorded zero turn counts. Validated by: tests/test_5k_insights_legacy.py.
153. Check the right-turn-heavy cohort with unequal turn counts. Validated by: tests/test_5k_insights_legacy.py.
154. Keep the earliest longest passing streak across an unknown verdict and a later tie. Validated by: tests/test_5k_insights_legacy.py.
155. Check that a parking drive that never arrived reports that outcome before space availability. Validated by: tests/test_5k_insights_legacy.py.
156. Check that an arriving drive with no available space has a distinct parking outcome. Validated by: tests/test_5k_insights_legacy.py.
157. Check that a string parking value cannot become a recorded parking outcome. Validated by: tests/test_5k_insights_legacy.py.
158. Keep the earliest retained reroute when a drive rerouted repeatedly. Validated by: tests/test_5k_insights_legacy.py.
159. Count an empty retained final-event log as measured without manufacturing a label. Validated by: tests/test_5k_insights_legacy.py.
160. Exclude saved pass rows when counting reasons that alone caused failure. Validated by: tests/test_5k_insights_legacy.py.
161. Check that the failed-distance report counts planned rather than driven metres. Validated by: tests/test_5k_insights_legacy.py.
162. Treat an elapsed time shorter than stationary time as an unavailable moving duration. Validated by: tests/test_5k_insights_legacy.py.
163. Treat an elapsed time shorter than speeding time as an unavailable speeding fraction. Validated by: tests/test_5k_insights_legacy.py.
164. Keep a zero RMS jerk from yielding a peak-to-RMS jerk ratio. Validated by: tests/test_5k_insights_legacy.py.
165. Keep zero RMS lane error from yielding a peak-to-RMS lane error ratio. Validated by: tests/test_5k_insights_legacy.py.
166. Keep zero wall-clock time from yielding a simulation-speed ratio. Validated by: tests/test_5k_insights_legacy.py.
167. Check that ranking uses duration precision before rounding displayed values. Validated by: tests/test_5k_insights_legacy.py.
168. Keep stronger signed deceleration ahead of weaker braking in motion rankings. Validated by: tests/test_5k_insights_legacy.py.
169. Check that a run with cost and no passes has no numeric cost per pass. Validated by: tests/test_5k_insights_legacy.py.
170. Exclude spend with unknown verdicts from the existing cost-per-pass ratio. Validated by: tests/test_5k_insights_legacy.py.
171. Preserve recorded zero spend for a passing group and missing spend for an unmeasured failing group. Validated by: tests/test_5k_insights_legacy.py.
172. Keep all attribution shares undefined for an attributed drive with zero decisions. Validated by: tests/test_5k_insights_legacy.py.
173. Exclude malformed per-check flag counts from the flag-frequency summary. Validated by: tests/test_5k_insights_legacy.py.
174. Keep latency coverage undefined when no recorded calls were made. Validated by: tests/test_5k_insights_legacy.py.
175. Skip division by a saved zero median in latency tail inflation. Validated by: tests/test_5k_insights_legacy.py.
176. Exclude zero-decision rows from the original local-only report. Validated by: tests/test_5k_insights_legacy.py.
177. Keep overall driven distance independent of matched audit exposure. Validated by: tests/test_5k_insights_legacy.py.
178. Count a route only once per hazard family when several counters in that family trigger. Validated by: tests/test_5k_insights_legacy.py.
179. Include collision counts lacking distance in raw audit totals. Validated by: tests/test_5k_insights_legacy.py.
180. Keep audit rates based on positive distance with a corresponding recorded counter. Validated by: tests/test_5k_insights_legacy.py.
181. Keep the legacy hazard order deterministic for ties in affected-route counts. Validated by: tests/test_5k_insights_legacy.py.
182. Treat an audit on a zero-distance drive as lacking distance exposure. Validated by: tests/test_5k_insights_legacy.py.
183. Match missed-stop evidence to its world audit name while ignoring malformed sample rows. Validated by: tests/test_5k_insights_legacy.py.
184. Check score progress clamping at the lower bound. Validated by: tests/test_5k_insights_legacy.py.
185. Check score progress clamping at the upper bound. Validated by: tests/test_5k_insights_legacy.py.
186. Cap the pace component at 100 on drives faster than the reference pace. Validated by: tests/test_5k_insights_legacy.py.
187. Keep time lost at zero when a drive beats the reference pace. Validated by: tests/test_5k_insights_legacy.py.
188. Keep the minimum distance floor in short-drive comfort calculations. Validated by: tests/test_5k_insights_legacy.py.
189. Check the safety margin floor when every measured component reaches its weakest bound. Validated by: tests/test_5k_insights_legacy.py.
190. Keep negative score rounding consistent with the browser at an exact half. Validated by: tests/test_5k_insights_legacy.py.
191. Keep percentile interpolation finite for opposite-signed extrema. Validated by: tests/test_5k_insights_legacy.py.
192. Keep legacy and custom suites comparable when their recorded routes otherwise agree. Validated by: tests/test_5k_insights_legacy.py.
193. Match legacy pack revisions saved as either strings or integers. Validated by: tests/test_5k_insights_legacy.py.
194. Reject comparisons between different authored arena sets. Validated by: tests/test_5k_insights_legacy.py.
195. Reject comparisons between an arena and a benchmark. Validated by: tests/test_5k_insights_legacy.py.
196. Ignore the clock for route restrictions when city configuration disables those restrictions. Validated by: tests/test_5k_insights_legacy.py.
197. Use the configured city clock for enabled route restrictions. Validated by: tests/test_5k_insights_legacy.py.
198. Ignore reordering and duplicate labels when comparing reasons. Validated by: tests/test_5k_insights_legacy.py.
199. Keep missing failure labels from inventing a resolved failure. Validated by: tests/test_5k_insights_legacy.py.
200. Preserve negative numeric CSV measurements while escaping formula-like route identifiers. Validated by: tests/test_5k_insights_legacy.py.
