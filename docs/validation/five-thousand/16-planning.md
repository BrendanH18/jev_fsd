# Candidates, Rules, and Cautious

The planner validates control laws and predictions before offering a manoeuvre. Rules and Cautious expose the reasons for their choices, and Autopilot tracks the requested and executed manoeuvres, fallbacks, spend, and predicted hazards through an opt-in browser trace. Start a capture with `const trace = window.__jev.autopilot.startDecisionTrace()` and inspect `trace.latest`, `trace.entries({ reason: "invalid_vector" })`, or `trace.summarize()`.

1. Prediction rejects non-array batches before any world access. Validated by: `scripts/test_5k_planning_candidates.mjs`.
2. Prediction identifies missing candidate records by their position in the batch. Validated by: `scripts/test_5k_planning_candidates.mjs`.
3. Candidate identifiers must contain a non-whitespace string before they can become vector options. Validated by: `scripts/test_5k_planning_candidates.mjs`.
4. Duplicate candidate IDs fail before the simulator mutates the candidates. Validated by: `scripts/test_5k_planning_candidates.mjs`.
5. Candidate diagnostics identify a missing or non-object control law by manoeuvre ID. Validated by: `scripts/test_5k_planning_candidates.mjs`.
6. Unsupported control-law kinds fail before the controller can treat them as lane following. Validated by: `scripts/test_5k_planning_candidates.mjs`.
7. A lane, parking, turnaround, or recovery steering law needs a finite nonnegative speed ceiling. Validated by: `scripts/test_5k_planning_candidates.mjs`.
8. Direct recovery steering rejects a nonfinite steering angle. Validated by: `scripts/test_5k_planning_candidates.mjs`.
9. Reverse recovery requires a finite coordinate pair when it has a target. Validated by: `scripts/test_5k_planning_candidates.mjs`.
10. The controller-facing lane offset is checked before it can poison steering. Validated by: `scripts/test_5k_planning_candidates.mjs`.
11. The lane centre is checked before it can poison the lateral error used for ranking. Validated by: `scripts/test_5k_planning_candidates.mjs`.
12. Relative lane displacement must represent a whole number of lanes. Validated by: `scripts/test_5k_planning_candidates.mjs`.
13. Absolute lane indexes must be nonnegative integers. Validated by: `scripts/test_5k_planning_candidates.mjs`.
14. An explicit control-law origin must be a finite route arc length. Validated by: `scripts/test_5k_planning_candidates.mjs`.
15. Relative stopping distance rejects nonnumeric values. Validated by: `scripts/test_5k_planning_candidates.mjs`.
16. Absolute stopping position rejects nonfinite route arc lengths. Validated by: `scripts/test_5k_planning_candidates.mjs`.
17. A candidate rejects negative stopping deceleration before computing a braking target. Validated by: `scripts/test_5k_planning_candidates.mjs`.
18. A candidate rejects negative brake reaction time before computing its stopping room. Validated by: `scripts/test_5k_planning_candidates.mjs`.
19. A lane change requires a shift description with readable fields. Validated by: `scripts/test_5k_planning_candidates.mjs`.
20. The departure offset for a lane change must be finite. Validated by: `scripts/test_5k_planning_candidates.mjs`.
21. The start of a lane change must be a finite route position. Validated by: `scripts/test_5k_planning_candidates.mjs`.
22. A lane change must have positive length before the controller interpolates it. Validated by: `scripts/test_5k_planning_candidates.mjs`.
23. A detour must provide a description of its path. Validated by: `scripts/test_5k_planning_candidates.mjs`.
24. Detour markers must be finite before the controller interpolates the detour. Validated by: `scripts/test_5k_planning_candidates.mjs`.
25. The detour must ease in, continue, and ease back in route order. Validated by: `scripts/test_5k_planning_candidates.mjs`.
26. A detour rejects nonfinite lateral displacement before it is added to steering. Validated by: `scripts/test_5k_planning_candidates.mjs`.
27. A speed-restriction list must be iterable as an array before it reaches the controller. Validated by: `scripts/test_5k_planning_candidates.mjs`.
28. A missing speed-restriction record is reported with its index. Validated by: `scripts/test_5k_planning_candidates.mjs`.
29. A speed-restriction zone needs finite and ordered start and end positions. Validated by: `scripts/test_5k_planning_candidates.mjs`.
30. A speed restriction can bring the car to rest and rejects negative target speeds. Validated by: `scripts/test_5k_planning_candidates.mjs`.
31. An active turnaround must have a manoeuvre ID before the autopilot can reuse it. Validated by: `scripts/test_5k_planning_candidates.mjs`.
32. The turnaround law rejects an unknown phase before the controller can execute it. Validated by: `scripts/test_5k_planning_candidates.mjs`.
33. The turnaround point must be finite before it can anchor the turn on the route. Validated by: `scripts/test_5k_planning_candidates.mjs`.
34. The desired departure heading must be finite before the controller can detect alignment. Validated by: `scripts/test_5k_planning_candidates.mjs`.
35. The three-point turn needs a left or right steering side. Validated by: `scripts/test_5k_planning_candidates.mjs`.
36. The departure projection window must start at a nonnegative route index. Validated by: `scripts/test_5k_planning_candidates.mjs`.
37. The departure projection window must end at an integer route index after its start. Validated by: `scripts/test_5k_planning_candidates.mjs`.
38. Stateful manoeuvres validate both the leg count and the distance already travelled. Validated by: `scripts/test_5k_planning_candidates.mjs`.
39. Parking validates the direction of the manoeuvre before interpreting its phase. Validated by: `scripts/test_5k_planning_candidates.mjs`.
40. Parking validates the phase against the selected entry or exit mode. Validated by: `scripts/test_5k_planning_candidates.mjs`.
41. The parking frame origin must supply finite longitudinal and lateral coordinates. Validated by: `scripts/test_5k_planning_candidates.mjs`.
42. The parking frame needs a finite heading before the controller projects the vehicle. Validated by: `scripts/test_5k_planning_candidates.mjs`.
43. The parking frame rejects nonfinite kerb positions. Validated by: `scripts/test_5k_planning_candidates.mjs`.
44. Parking rejects zero and negative turning radii before computing arc lengths. Validated by: `scripts/test_5k_planning_candidates.mjs`.
45. Parking checks its first steering arc for a finite nonnegative angle. Validated by: `scripts/test_5k_planning_candidates.mjs`.
46. The parking bay's front and rear limits must form an ordered finite interval. Validated by: `scripts/test_5k_planning_candidates.mjs`.
47. Parking requires a finite target pose in the bay's local coordinates. Validated by: `scripts/test_5k_planning_candidates.mjs`.
48. The alignment point for entering a bay must be finite. Validated by: `scripts/test_5k_planning_candidates.mjs`.
49. Pull-out validates the initial and destination lateral references in the bay frame. Validated by: `scripts/test_5k_planning_candidates.mjs`.
50. Pull-out validates the longitudinal point from which it begins steering out. Validated by: `scripts/test_5k_planning_candidates.mjs`.
51. Lane-expiry validation allows an unbounded forward lane and rejects an invalid bound. Validated by: `scripts/test_5k_planning_candidates.mjs`.
52. A lane-specific scoring target must be finite and nonnegative. Validated by: `scripts/test_5k_planning_candidates.mjs`.
53. A missing prediction reports the candidate ID before the policy tries to read it. Validated by: `scripts/test_5k_planning_candidates.mjs`.
54. Predictions validate peak longitudinal and lateral acceleration and braking measurements. Validated by: `scripts/test_5k_planning_candidates.mjs`.
55. Prediction clearance can be unmeasured and rejects impossible negative infinity. Validated by: `scripts/test_5k_planning_candidates.mjs`.
56. Predictions require finite speed and progress while preserving signed measurements for reverse manoeuvres. Validated by: `scripts/test_5k_planning_candidates.mjs`.
57. Predictions reject nonfinite lateral and heading errors before the drivers use them for scoring. Validated by: `scripts/test_5k_planning_candidates.mjs`.
58. Following gap validation distinguishes a missing measurement from an unbounded gap. Validated by: `scripts/test_5k_planning_candidates.mjs`.
59. Off-road sample fraction is checked against its physical range. Validated by: `scripts/test_5k_planning_candidates.mjs`.
60. A prediction must end at a finite coordinate pair. Validated by: `scripts/test_5k_planning_candidates.mjs`.
61. Decision state accepts a missing metadata record and an absent traffic observation list. Validated by: `scripts/test_5k_planning_candidates.mjs`.
62. Vector criteria retain candidate IDs that coincide with JavaScript prototype properties. Validated by: `scripts/test_5k_planning_candidates.mjs`.
63. Unrecognised cyclist passing constraints receive a readable explanation. Validated by: `scripts/test_5k_planning_candidates.mjs`.
64. The candidate regression check keeps one unconditional hard-brake option at the end of the offer list. Validated by: `scripts/test_5k_planning_candidates.mjs`.
65. The candidate regression check pins the sixteen-manoeuvre upper bound. Validated by: `scripts/test_5k_planning_candidates.mjs`.
66. The candidate regression check covers the destination stop within the approach zone. Validated by: `scripts/test_5k_planning_candidates.mjs`.
67. The candidate regression check applies the amber ceiling to every available powered lane plan. Validated by: `scripts/test_5k_planning_candidates.mjs`.
68. The prediction regression check covers a batch with no candidates. Validated by: `scripts/test_5k_planning_candidates.mjs`.
69. The prediction regression check verifies that overwriting duplicate IDs never partially simulates the input. Validated by: `scripts/test_5k_planning_candidates.mjs`.
70. The prediction regression check keeps the initial pose and final endpoint in the sampled path. Validated by: `scripts/test_5k_planning_candidates.mjs`.
71. The prediction regression check pins an unmeasured following gap on a road with no other vehicles. Validated by: `scripts/test_5k_planning_candidates.mjs`.
72. The prediction regression check covers a clean lane without a stop-line crossing. Validated by: `scripts/test_5k_planning_candidates.mjs`.
73. The prediction regression check verifies that running a batch leaves ego position and speed intact. Validated by: `scripts/test_5k_planning_candidates.mjs`.
74. The state regression check keeps the eligible candidate order in the serialized observation. Validated by: `scripts/test_5k_planning_candidates.mjs`.
75. The speed-label regression check covers a stationary vehicle whose target is also zero. Validated by: `scripts/test_5k_planning_candidates.mjs`.
76. The speed-label regression check pins the boundary between a stop and motion below target. Validated by: `scripts/test_5k_planning_candidates.mjs`.
77. Rules can explain a choice through the same evaluation that makes the ordinary decision. Validated by: `scripts/test_5k_planning_policy.mjs`.
78. Rules reports the shared desired speed it used to judge manoeuvres. Validated by: `scripts/test_5k_planning_policy.mjs`.
79. Rules explains a speed cap imposed by traffic in the lane needed for the next turn. Validated by: `scripts/test_5k_planning_policy.mjs`.
80. Rules reports the actual target speed used for each candidate. Validated by: `scripts/test_5k_planning_policy.mjs`.
81. Rules exposes the progress reward in its ranking. Validated by: `scripts/test_5k_planning_policy.mjs`.
82. Rules exposes the lateral tracking penalty in its ranking. Validated by: `scripts/test_5k_planning_policy.mjs`.
83. Rules exposes the alignment penalty in its ranking. Validated by: `scripts/test_5k_planning_policy.mjs`.
84. Rules exposes the speed tracking penalty in its ranking. Validated by: `scripts/test_5k_planning_policy.mjs`.
85. Rules explains the additional penalty for overshooting the target speed. Validated by: `scripts/test_5k_planning_policy.mjs`.
86. Rules shows the preference for leaving an active reserved bus lane. Validated by: `scripts/test_5k_planning_policy.mjs`.
87. Rules exposes the preference for the amber approach stop. Validated by: `scripts/test_5k_planning_policy.mjs`.
88. Rules exposes the preference for stopping at a traffic control line. Validated by: `scripts/test_5k_planning_policy.mjs`.
89. Rules exposes the preference for stopping near the destination. Validated by: `scripts/test_5k_planning_policy.mjs`.
90. Rules exposes the preference for the pedestrian crossing stop. Validated by: `scripts/test_5k_planning_policy.mjs`.
91. Rules reports the required-wait score applied to priority traffic manoeuvres. Validated by: `scripts/test_5k_planning_policy.mjs`.
92. Rules reports the preference for creeping to look or waiting short of a give-way point. Validated by: `scripts/test_5k_planning_policy.mjs`.
93. Rules scores a pull-over against its intended kerb position in the explanation. Validated by: `scripts/test_5k_planning_policy.mjs`.
94. Rules reports its preference for giving way by pulling to the side. Validated by: `scripts/test_5k_planning_policy.mjs`.
95. Rules shows the preference for resuming a clear three-point turn. Validated by: `scripts/test_5k_planning_policy.mjs`.
96. Rules shows the preference for carrying on with a clear parking manoeuvre. Validated by: `scripts/test_5k_planning_policy.mjs`.
97. Rules exposes the preference for stopping at the parking alignment point. Validated by: `scripts/test_5k_planning_policy.mjs`.
98. Rules explains the extra cost of starting an oncoming-lane cyclist pass. Validated by: `scripts/test_5k_planning_policy.mjs`.
99. Rules explains the preference for following a cyclist whose pass is unavailable. Validated by: `scripts/test_5k_planning_policy.mjs`.
100. Rules exposes the penalty for hard braking when other manoeuvres are offered. Validated by: `scripts/test_5k_planning_policy.mjs`.
101. Rules exposes the penalty for reverse recovery. Validated by: `scripts/test_5k_planning_policy.mjs`.
102. Rules explains the penalty for a manoeuvre that drifts out of lane. Validated by: `scripts/test_5k_planning_policy.mjs`.
103. Rules shows the relative cost of aborting and completing a lane change. Validated by: `scripts/test_5k_planning_policy.mjs`.
104. Rules shows the lane-distance penalty for staying outside the route lane. Validated by: `scripts/test_5k_planning_policy.mjs`.
105. Rules quantifies the penalty for closing within three metres of traffic. Validated by: `scripts/test_5k_planning_policy.mjs`.
106. Rules reports feature scoring separately before and during the required-stop scoring stage. Validated by: `scripts/test_5k_planning_policy.mjs`.
107. Rules explains move-over scoring applied ahead of ordinary passing costs. Validated by: `scripts/test_5k_planning_policy.mjs`.
108. Rules explains feature-specific score adjustments at the standard hook slot. Validated by: `scripts/test_5k_planning_policy.mjs`.
109. Rules names a signal hold by the phase that caused it. Validated by: `scripts/test_5k_planning_policy.mjs`.
110. Rules distinguishes an incomplete stop from a stop completed with cross traffic still moving. Validated by: `scripts/test_5k_planning_policy.mjs`.
111. Rules reports an all-way stop hold when another road user has priority. Validated by: `scripts/test_5k_planning_policy.mjs`.
112. Rules reports a hold for moving traffic in a roundabout. Validated by: `scripts/test_5k_planning_policy.mjs`.
113. Rules reports a hold for oncoming traffic in the path of a turn. Validated by: `scripts/test_5k_planning_policy.mjs`.
114. Rules reports waiting at a junction give-way point. Validated by: `scripts/test_5k_planning_policy.mjs`.
115. Rules reports a close stationary leader as a reason to hold. Validated by: `scripts/test_5k_planning_policy.mjs`.
116. Rules reports a nearby crossing pedestrian as a reason to hold. Validated by: `scripts/test_5k_planning_policy.mjs`.
117. Rules reports waiting for a cyclist on the inside of a right turn. Validated by: `scripts/test_5k_planning_policy.mjs`.
118. Rules reports the hold at a merge point. Validated by: `scripts/test_5k_planning_policy.mjs`.
119. Rules reports reaching the destination as a hold reason. Validated by: `scripts/test_5k_planning_policy.mjs`.
120. Rules identifies feature holds before the signal check and after the standard traffic checks. Validated by: `scripts/test_5k_planning_policy.mjs`.
121. Rules explains when the amber approach law can carry on despite an immediate hold. Validated by: `scripts/test_5k_planning_policy.mjs`.
122. Rules explains when a clear turnaround overrides a hold. Validated by: `scripts/test_5k_planning_policy.mjs`.
123. Rules explains when an active parking manoeuvre overrides a hold. Validated by: `scripts/test_5k_planning_policy.mjs`.
124. Cautious can explain its policy without needing an Autopilot instance. Validated by: `scripts/test_5k_planning_policy.mjs`.
125. Cautious reports the offered candidates it skipped because of rule flags. Validated by: `scripts/test_5k_planning_policy.mjs`.
126. Cautious shows which of its usual speed preference and the sensed target sets the ceiling. Validated by: `scripts/test_5k_planning_policy.mjs`.
127. Cautious identifies a zero-speed target from a feature hold. Validated by: `scripts/test_5k_planning_policy.mjs`.
128. Cautious explains the preference for an immediate pull-over. Validated by: `scripts/test_5k_planning_policy.mjs`.
129. Cautious explains choosing an exit from a restricted bus lane. Validated by: `scripts/test_5k_planning_policy.mjs`.
130. Cautious explains continuing with the offered parking or pull-out law. Validated by: `scripts/test_5k_planning_policy.mjs`.
131. Cautious explains choosing an available cyclist pass. Validated by: `scripts/test_5k_planning_policy.mjs`.
132. Cautious explains proceeding along a designated amber approach. Validated by: `scripts/test_5k_planning_policy.mjs`.
133. Cautious distinguishes feature selections before and after its bus-lane step. Validated by: `scripts/test_5k_planning_policy.mjs`.
134. Cautious identifies feature selections evaluated after the cyclist pass. Validated by: `scripts/test_5k_planning_policy.mjs`.
135. Cautious identifies feature selections on its ordinary hook. Validated by: `scripts/test_5k_planning_policy.mjs`.
136. Cautious distinguishes feature selections before and after the amber approach. Validated by: `scripts/test_5k_planning_policy.mjs`.
137. Cautious exposes the score used when no explicit priority picked a manoeuvre. Validated by: `scripts/test_5k_planning_policy.mjs`.
138. Cautious quantifies the cost of deviating from its target speed. Validated by: `scripts/test_5k_planning_policy.mjs`.
139. Cautious quantifies the cost of deviating from its preferred lateral position. Validated by: `scripts/test_5k_planning_policy.mjs`.
140. Cautious quantifies its short-gap penalty independently of speed and progress. Validated by: `scripts/test_5k_planning_policy.mjs`.
141. Cautious quantifies the progress component of its score. Validated by: `scripts/test_5k_planning_policy.mjs`.
142. Cautious explains a stop based on predicted near-zero speed. Validated by: `scripts/test_5k_planning_policy.mjs`.
143. Cautious explains why its parking or pull-over law handles a predicted stop itself. Validated by: `scripts/test_5k_planning_policy.mjs`.
144. Cautious explains when a feature law handles its own approach to a stop. Validated by: `scripts/test_5k_planning_policy.mjs`.
145. Cautious explains a decision with no candidate left after rule filtering. Validated by: `scripts/test_5k_planning_policy.mjs`.
146. Cautious explains driving when the prediction ends in motion. Validated by: `scripts/test_5k_planning_policy.mjs`.
147. Autopilot starts and stops a bounded decision capture through the existing browser debug handle. Validated by: `scripts/test_5k_planning_trace.mjs`.
148. Replacing a capture prevents an in-flight answer from appearing in the new or retired history. Validated by: `scripts/test_5k_planning_trace.mjs`.
149. A capture exposes its latest recorded decision without sharing mutable prediction objects. Validated by: `scripts/test_5k_planning_trace.mjs`.
150. Clearing a capture drops its entries and preserves monotonic decision numbering. Validated by: `scripts/test_5k_planning_trace.mjs`.
151. Captured decisions use the simulation clock and selection epoch. Validated by: `scripts/test_5k_planning_trace.mjs`.
152. Captured decisions preserve the active driving track. Validated by: `scripts/test_5k_planning_trace.mjs`.
153. Capture distinguishes the configured driver from the source that supplied the applied decision. Validated by: `scripts/test_5k_planning_trace.mjs`.
154. Capture shows the requested manoeuvre, the policy selection, and the actual brake or hold separately. Validated by: `scripts/test_5k_planning_trace.mjs`.
155. Capture labels a no-eligible-candidate stop before a driver is consulted. Validated by: `scripts/test_5k_planning_trace.mjs`.
156. Capture identifies an explicit alternate manoeuvre chosen by the replay driver. Validated by: `scripts/test_5k_planning_trace.mjs`.
157. Capture retains the hazard flags that set the decision cadence. Validated by: `scripts/test_5k_planning_trace.mjs`.
158. Capture includes the last executing law's predicted obstruction when present. Validated by: `scripts/test_5k_planning_trace.mjs`.
159. Capture distinguishes questions asked from answers resolved locally. Validated by: `scripts/test_5k_planning_trace.mjs`.
160. Capture records the offered IDs and the set available to a driver that obeys road rules. Validated by: `scripts/test_5k_planning_trace.mjs`.
161. Capture records the reason why a predicted manoeuvre was rejected or flagged. Validated by: `scripts/test_5k_planning_trace.mjs`.
162. Capture shows the candidate's control-law type and its planned speed ceiling. Validated by: `scripts/test_5k_planning_trace.mjs`.
163. Capture shows the absolute planned stopping position. Validated by: `scripts/test_5k_planning_trace.mjs`.
164. Capture shows the planned lateral offset and the direction and intent of a lane change. Validated by: `scripts/test_5k_planning_trace.mjs`.
165. Capture identifies candidates that are planned around an obstruction. Validated by: `scripts/test_5k_planning_trace.mjs`.
166. Capture counts the speed restriction zones along the candidate law. Validated by: `scripts/test_5k_planning_trace.mjs`.
167. Capture shows signed predicted progress and end speed. Validated by: `scripts/test_5k_planning_trace.mjs`.
168. Capture renders an unmeasured gap or clearance as unavailable. Validated by: `scripts/test_5k_planning_trace.mjs`.
169. Capture reports predicted peak braking and lateral acceleration. Validated by: `scripts/test_5k_planning_trace.mjs`.
170. Capture reports whether a candidate leaves the lane, leaves the road, or crosses a stop line. Validated by: `scripts/test_5k_planning_trace.mjs`.
171. Capture reports the first predicted collision's actor, time and type. Validated by: `scripts/test_5k_planning_trace.mjs`.
172. Capture identifies a static obstruction even when a separate collision was predicted first. Validated by: `scripts/test_5k_planning_trace.mjs`.
173. Capture reports a ranked runner-up with the score difference and explicitly recognizes ties. Validated by: `scripts/test_5k_planning_trace.mjs`.
174. Capture shows whether a route answer installed the named option, used the first, or kept the existing route. Validated by: `scripts/test_5k_planning_trace.mjs`.
175. Capture shows whether the beam came from an explicit answer or the sensed default. Validated by: `scripts/test_5k_planning_trace.mjs`.
176. Capture labels a driver decision that left a requested route or headlight choice to a default. Validated by: `scripts/test_5k_planning_trace.mjs`.
177. Capture records built-in policy diagnostics without extending the ordinary decision envelope. Validated by: `scripts/test_5k_planning_trace.mjs`.
178. Capture avoids storing raw provider messages, choices or map geometry. Validated by: `scripts/test_5k_planning_trace.mjs`.
179. Trace lookups can select decisions by configured driver. Validated by: `scripts/test_5k_planning_trace.mjs`.
180. Trace lookups can select local, model or fallback decisions. Validated by: `scripts/test_5k_planning_trace.mjs`.
181. Trace lookups can select a decision or fallback reason. Validated by: `scripts/test_5k_planning_trace.mjs`.
182. Trace lookups can select a decision that considered a named candidate. Validated by: `scripts/test_5k_planning_trace.mjs`.
183. Trace lookups can select a decision that observed a hazard flag. Validated by: `scripts/test_5k_planning_trace.mjs`.
184. Trace lookups can select a decision with a named candidate rejection. Validated by: `scripts/test_5k_planning_trace.mjs`.
185. Trace lookups can select a decision that asked a particular question. Validated by: `scripts/test_5k_planning_trace.mjs`.
186. Trace lookups can select a motion outcome. Validated by: `scripts/test_5k_planning_trace.mjs`.
187. Trace lookups support inclusive simulation-time bounds. Validated by: `scripts/test_5k_planning_trace.mjs`.
188. Trace summaries count selected records by driver, decision source, reason and motion. Validated by: `scripts/test_5k_planning_trace.mjs`.
189. Trace summaries tally executed manoeuvres, candidate rejections and asked questions. Validated by: `scripts/test_5k_planning_trace.mjs`.
190. Trace summaries tally decisions with partial answers. Validated by: `scripts/test_5k_planning_trace.mjs`.
191. Trace summaries total counted calls and their input tokens, output tokens and cost. Validated by: `scripts/test_5k_planning_trace.mjs`.
192. Trace summaries count calls with unknown cost separately from those with zero cost. Validated by: `scripts/test_5k_planning_trace.mjs`.
193. An invalid motion is rejected even when a decision model also omitted its vector. Validated by: `scripts/test_5k_planning_trace.mjs`.
194. Fallback status from a driver increments the same violation counter as other fallbacks. Validated by: `scripts/test_5k_planning_trace.mjs`.
195. Malformed output-token counts are sanitized while older results can omit the metric. Validated by: `scripts/test_5k_planning_trace.mjs`.
196. An empty reroute option list cannot install an undefined route. Validated by: `scripts/test_5k_planning_trace.mjs`.
197. Trace distinguishes a declined vector that Rules replaced from a candidate outside the offered set. Validated by: `scripts/test_5k_planning_trace.mjs`.
198. Trace distinguishes a timeout from an exception inside a driver. Validated by: `scripts/test_5k_planning_trace.mjs`.
199. Trace identifies unusable model replies that still incurred a call. Validated by: `scripts/test_5k_planning_trace.mjs`.
200. Trace identifies fallback explicitly reported by a driver. Validated by: `scripts/test_5k_planning_trace.mjs`.
