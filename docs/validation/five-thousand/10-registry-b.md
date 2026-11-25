# Snow plows, lane closures and passing cyclists

Moved the three features onto the registry, including fleet behavior, sensing, model wording, auditing and coaching. Added declaration validation and compatibility checks for the moved metrics and flags.

1. Route the free-drive plow count through its registered fleet option. Validated by: scripts/test_snow_plows.mjs.
2. Give the plow record its own fleet state and authored placement entry point. Validated by: scripts/test_snow_plows.mjs.
3. Provide a path factory that accepts street preferences so plow dispatch keeps its route restrictions outside the fleet core. Validated by: scripts/test_snow_plows.mjs.
4. Restore the plow dispatcher’s references to the live World and fleet on rewind. Validated by: scripts/test_snow_plows.mjs.
5. Dispatch plows between the traffic schedulers that ran before and after them. Validated by: scripts/test_snow_plows.mjs.
6. Dispatch the longer-range plow leader search separately from ordinary traffic matching. Validated by: scripts/test_snow_plows.mjs.
7. Carry a special leader’s headway adjustment through the traffic following controller. Validated by: scripts/test_snow_plows.mjs.
8. Supply special leader metadata to the traffic lane-change decision. Validated by: scripts/test_snow_plows.mjs.
9. Keep the plow’s clearing speed through an obstacle descriptor. Validated by: scripts/test_snow_plows.mjs.
10. Expose the plow’s long body to the ordinary long-vehicle leader scan through its descriptor. Validated by: scripts/test_snow_plows.mjs.
11. Exclude plows from traffic parking through their descriptor. Validated by: scripts/test_snow_plows.mjs.
12. Classify a plow as a visible ordinary-traffic leader with its feature label. Validated by: scripts/test_snow_plows.mjs.
13. Let a feature block overtaking a leader in a particular adjacent lane. Validated by: scripts/test_snow_plows.mjs.
14. Let a feature enlarge the gap needed to return in front of a vehicle. Validated by: scripts/test_snow_plows.mjs.
15. Supply the plow snapshot at the established approach stage. Validated by: scripts/test_snow_plows.mjs.
16. Let the prospective lane’s speed calculation exclude a plow whose keep-back rule would cease to apply there. Validated by: scripts/test_snow_plows.mjs.
17. Let a feature block the ego’s pass offer when its leader may only be passed on a particular side. Validated by: scripts/test_snow_plows.mjs.
18. Let a feature veto an otherwise adequate rear gap for the ego’s lane change. Validated by: scripts/test_snow_plows.mjs.
19. Apply the plow following speed and its reason before the crosswalk target. Validated by: scripts/test_snow_plows.mjs.
20. Emit the plow hazard through the ordered hazard list. Validated by: scripts/test_snow_plows.mjs.
21. Track passing the plow on the right in a feature forward-simulation checker. Validated by: scripts/test_snow_plows.mjs.
22. Reject a predicted plow approach that would end closer inside its stay-back distance through that checker. Validated by: scripts/test_snow_plows.mjs.
23. Supply each route-based prediction checker with the sample’s lateral projection and simulation time. Validated by: scripts/test_snow_plows.mjs.
24. Supply end-position checks with the final route projection and front overhang. Validated by: scripts/test_snow_plows.mjs.
25. Clear the plow audit’s per-vehicle history through the contact-reset hook. Validated by: scripts/test_snow_plows.mjs.
26. Initialize the existing zero plow counter through the metric declaration. Validated by: scripts/test_snow_plows.mjs.
27. Keep the plow audit between the flagger-stage checks and the zipper audit. Validated by: scripts/test_snow_plows.mjs.
28. Populate the plow decision-state object through the record. Validated by: scripts/test_snow_plows.mjs.
29. Give the plow record its situation text and return-to-lane instruction. Validated by: scripts/test_snow_plows.mjs.
30. Supply the plow’s guarded and open system-prompt line from the record. Validated by: scripts/test_snow_plows.mjs.
31. Send the plow’s existing HUD notice through ordered notice dispatch. Validated by: scripts/test_snow_plows.mjs.
32. Dispatch plow following guidance and the associated snapshot incident after the blind-spot measurement. Validated by: scripts/test_snow_plows.mjs.
33. Route the plow’s right-pass and cut-in events through feature coaching. Validated by: scripts/test_snow_plows.mjs.
34. Apply the plow’s safety and legality deductions through the ordered scoring hooks. Validated by: scripts/test_snow_plows.mjs.
35. Supply the plow-specific tips and report fields from the record. Validated by: scripts/test_snow_plows.mjs.
36. Share the registered obstruction spawn check with the plow scheduler. Validated by: scripts/test_plow_main_streets.mjs.
37. Build the lane-closure manager through the registered counted option. Validated by: scripts/test_lane_closures.mjs.
38. Run the closure manager after parked-car updates and before outage updates. Validated by: scripts/test_lane_closures.mjs.
39. Restore the closure manager’s live World reference through its checkpoint hook. Validated by: scripts/test_lane_closures.mjs.
40. Keep merge call, wait and let-in history in the feature’s contact-reset path. Validated by: scripts/test_lane_closures.mjs.
41. Offer a traffic lane-control plan that can coexist with an independent shared corridor. Validated by: scripts/test_lane_closures.mjs.
42. Keep traffic in its lane on approach to a closure through the lane-control plan. Validated by: scripts/test_lane_closures.mjs.
43. Expose a closed-lane steering shift to traffic’s ordinary pursuit. Validated by: scripts/test_lane_closures.mjs.
44. Exclude the closure’s obstacle from following when the driver’s detour takes it around. Validated by: scripts/test_lane_closures.mjs.
45. Adjust the leader projection along the closure’s detour. Validated by: scripts/test_lane_closures.mjs.
46. Apply the traffic speed ceiling from the lane-control plan. Validated by: scripts/test_lane_closures.mjs.
47. Defer the traffic’s zipper stop decision until the following scan can compare competing holds. Validated by: scripts/test_lane_closures.mjs.
48. Keep a moving merger’s speed when the passing lane’s leader is the vehicle taking its turn. Validated by: scripts/test_lane_closures.mjs.
49. Use the closure record to prevent traffic and plow spawning inside its footprint. Validated by: scripts/test_lane_closures.mjs.
50. Contribute the closure’s description to standing-vehicle sensing. Validated by: scripts/test_lane_closures.mjs.
51. Share the registered lane-control detour between ego following and candidate construction. Validated by: scripts/test_lane_closures.mjs.
52. Install the closure’s approach snapshot and speed ceiling through ordered hooks. Validated by: scripts/test_lane_closures.mjs.
53. Add the merge-point wait and let-in reasons before computing the destination parking target. Validated by: scripts/test_lane_closures.mjs.
54. Publish the closure hazard in its existing order relative to parking. Validated by: scripts/test_lane_closures.mjs.
55. Generate both zipper stop candidates through the closure record. Validated by: scripts/test_lane_closures.mjs.
56. Check a past-merge-point violation before checking the plow rule. Validated by: scripts/test_lane_closures.mjs.
57. Check entering the closed lane or changing lanes too early from the same checker. Validated by: scripts/test_lane_closures.mjs.
58. Put the zipper stop preference and legitimate-deadlock exemption in the record. Validated by: scripts/test_lane_closures.mjs.
59. Use the feature’s stop condition to include the motion question. Validated by: scripts/test_lane_closures.mjs.
60. Supply the zipper’s decision-state and outcome text from the feature. Validated by: scripts/test_lane_closures.mjs.
61. Keep the merge-point situation and hold-still wording at the established ordering. Validated by: scripts/test_lane_closures.mjs.
62. Contribute the zipper instruction at its existing LLM prompt position. Validated by: scripts/test_lane_closures.mjs.
63. Provide the reason a nearby closure prevents a cycling pass from the closure record. Validated by: scripts/test_lane_closures.mjs.
64. Route the zipper HUD notice through the feature dispatcher. Validated by: scripts/test_lane_closures.mjs.
65. Apply the closure’s audit and replay marker through its record. Validated by: scripts/test_lane_closures.mjs.
66. Use the zipper detour as a coaching corridor while the car is crossing lanes. Validated by: scripts/test_lane_closures.mjs.
67. Route early merge, forced merge and skipped merge turns through feature coaching. Validated by: scripts/test_lane_closures.mjs.
68. Apply the merge’s coaching deductions, report fields and tips in their prior order. Validated by: scripts/test_lane_closures.mjs.
69. Keep the cyclist passing option under its established query flag. Validated by: scripts/test_cyclist_passing.mjs.
70. Store per-cyclist clearance measurements in a registered audit map. Validated by: scripts/test_cyclist_passing.mjs.
71. Clear in-progress passing state on a manual placement through the feature reset. Validated by: scripts/test_cyclist_passing.mjs.
72. Dispatch moving-traffic passes through an overtaking hook. Validated by: scripts/test_cyclist_passing.mjs.
73. Give an overtaking plan the obstacle’s passing clearance and the driver’s lateral offset. Validated by: scripts/test_cyclist_passing.mjs.
74. Hand the feature the ordinary-traffic manoeuvre holds that prevent starting a pass. Validated by: scripts/test_cyclist_passing.mjs.
75. Let a vehicle descriptor opt out of the overtaking planner. Validated by: scripts/test_cyclist_passing.mjs.
76. Add the cyclist’s sensing state after parking and the plow. Validated by: scripts/test_cyclist_passing.mjs.
77. Exclude the cyclist being passed from ordinary following through the feature’s predicate. Validated by: scripts/test_cyclist_passing.mjs.
78. Use an optional detour for planned passing outside the ordinary lane law. Validated by: scripts/test_cyclist_passing.mjs.
79. Change the ego’s pre-blind-spot speed cap through the cyclist record when a pass is on. Validated by: scripts/test_cyclist_passing.mjs.
80. Provide the lower following target and reason when the pass is blocked. Validated by: scripts/test_cyclist_passing.mjs.
81. Add the cyclist-ahead hazard through the feature’s stage. Validated by: scripts/test_cyclist_passing.mjs.
82. Generate the pass and follow candidates in the record. Validated by: scripts/test_cyclist_passing.mjs.
83. Declare the cyclist candidates’ priority in the pruning list. Validated by: scripts/test_cyclist_passing.mjs.
84. Keep just the relevant passing choices when a pass has started. Validated by: scripts/test_cyclist_passing.mjs.
85. Retain the cyclist’s detour during hard braking where the old law did. Validated by: scripts/test_cyclist_passing.mjs.
86. Read enabled passing clearance from the feature while preserving the default 1 m check for legacy drives. Validated by: scripts/test_cyclist_passing.mjs.
87. Let a feature prediction checker see both the local lateral projection and the active law near an obstacle. Validated by: scripts/test_cyclist_passing.mjs.
88. Relocate the check for cutting off oncoming traffic during a cyclist pass while keeping its rejection precedence. Validated by: scripts/test_cyclist_passing.mjs.
89. Supply the Rules pass-start cost and blocked-follow reward through the feature’s scoring slot. Validated by: scripts/test_cyclist_passing.mjs.
90. Use the cyclist record to exempt waiting at a safe following distance from deadlock recovery. Validated by: scripts/test_cyclist_passing.mjs.
91. Ask the motion question when the cyclist record supplies an interaction. Validated by: scripts/test_cyclist_passing.mjs.
92. Supply the cyclist pass’s decision-state fields and blocked-pass reasons from the feature. Validated by: scripts/test_cyclist_passing.mjs.
93. Keep ordinary off-road outcome precedence for a candidate going round a cyclist. Validated by: scripts/test_cyclist_passing.mjs.
94. Supply the follow-cyclist candidate’s outcome through the ID hook. Validated by: scripts/test_cyclist_passing.mjs.
95. Keep the cyclist-pass clause in the established order and suppress redundant following advice. Validated by: scripts/test_cyclist_passing.mjs.
96. Add the passing and following motion criterion through the record. Validated by: scripts/test_cyclist_passing.mjs.
97. Contribute the cyclist-passing system-prompt line after the parking advice. Validated by: scripts/test_cyclist_passing.mjs.
98. Dispatch the cyclist HUD notice at the same point after hidden-traffic notices. Validated by: scripts/test_cyclist_passing.mjs.
99. Report the cyclist clearance metric from the start of enabled drives. Validated by: scripts/test_cyclist_passing.mjs.
100. Export the cyclist close-pass replay marker from its audit declaration. Validated by: scripts/test_cyclist_passing.mjs.
101. Exempt a lawful oncoming-lane pass from wrong-way coaching. Validated by: scripts/test_cyclist_passing.mjs.
102. Move cyclist clearance and oncoming-cutoff coaching into the record. Validated by: scripts/test_cyclist_passing.mjs.
103. Reject misspelled obstacle descriptor fields. Validated by: scripts/test_5k_registry-b_contracts.mjs.
104. Reject a writable lazy obstacle label while retaining support for a deferred getter. Validated by: scripts/test_5k_registry-b_contracts.mjs.
105. Validate unknown placed-hook fields so unused metadata cannot imply hook behavior. Validated by: scripts/test_5k_registry-b_contracts.mjs.
106. Reject unknown metric fields and report the misspelled key. Validated by: scripts/test_5k_registry-b_contracts.mjs.
107. Reject stray notice fields before a feature loads. Validated by: scripts/test_5k_registry-b_contracts.mjs.
108. Reject unsupported prompt descriptor fields. Validated by: scripts/test_5k_registry-b_contracts.mjs.
109. Check the allowed nested field names for each kind of coaching entry. Validated by: scripts/test_5k_registry-b_contracts.mjs.
110. Reject a sparse priority list so every element describes a candidate. Validated by: scripts/test_5k_registry-b_contracts.mjs.
111. Detect multiple owners for a priority candidate ID. Validated by: scripts/test_5k_registry-b_contracts.mjs.
112. Detect multiple owners for a replay marker ID. Validated by: scripts/test_5k_registry-b_contracts.mjs.
113. Require a trace threshold for threshold-based replay markers. Validated by: scripts/test_5k_registry-b_contracts.mjs.
114. Reject simultaneous counter-event and threshold-event modes for a metric. Validated by: scripts/test_5k_registry-b_contracts.mjs.
115. Disallow simultaneous seen-flag and enabled-option reporting for a metric. Validated by: scripts/test_5k_registry-b_contracts.mjs.
116. Require finite nonnegative initial audit counters. Validated by: scripts/test_5k_registry-b_contracts.mjs.
117. Return a diagnostic for a non-array registry input. Validated by: scripts/test_5k_registry-b_contracts.mjs.
118. Handle symbol-valued slots in schema diagnostics. Validated by: scripts/test_5k_registry-b_contracts.mjs.
119. Reject callback dispatch for data declarations with an actionable error. Validated by: scripts/test_5k_registry-b_contracts.mjs.
120. Reject unknown slots requested by data readers. Validated by: scripts/test_5k_registry-b_contracts.mjs.
121. Keep the simultaneous plow, merge and cyclist metric order covered by a regression assertion. Validated by: scripts/test_5k_registry-b_contracts.mjs.
122. Keep the disabled passing rejection label covered by a compatibility assertion. Validated by: scripts/test_5k_registry-b_contracts.mjs.
123. Use the plow specification as the source of the plow actor’s kind. Validated by: scripts/test_open_track.mjs.
124. Check that each new registry record is loaded and every added slot has a matching dispatch point. Validated by: scripts/test_feature_registry.mjs.
125. Check that the closure and passing-cyclist options are both initialized by the World builder. Validated by: scripts/test_feature_registry.mjs.
126. Document how a fleet feature supplies World audit state while keeping its scheduler on the fleet. Validated by: uv run --locked python -m unittest discover -s tests -p test_doc_links.py.
127. Document the lane-control and shared-corridor contracts for simultaneous restrictions. Validated by: uv run --locked python -m unittest discover -s tests -p test_doc_links.py.
128. Document optional detours and committed manoeuvre choices so future features can preserve candidate order. Validated by: uv run --locked python -m unittest discover -s tests -p test_doc_links.py.
129. Update the three feature reference pages with the relevant record and user-facing option behavior. Validated by: uv run --locked python -m unittest discover -s tests -p test_doc_links.py.
130. Reject symbol-named feature properties because no core hook can dispatch them. Validated by: scripts/test_5k_registry-b_contracts.mjs.
131. Reject nonenumerable feature properties that an ordinary record scan would skip. Validated by: scripts/test_5k_registry-b_contracts.mjs.
132. Reject symbol keys in a feature’s exported data map. Validated by: scripts/test_5k_registry-b_contracts.mjs.
133. Reject hidden snapshot defaults that would never be copied into a snapshot. Validated by: scripts/test_5k_registry-b_contracts.mjs.
134. Reject a null slot on a placed hook instead of silently treating it as the final stage. Validated by: scripts/test_5k_registry-b_contracts.mjs.
135. Require enabled-option metrics to be backed by a World option. Validated by: scripts/test_5k_registry-b_contracts.mjs.
136. Require enabled-option metrics to use a boolean option instead of a placement count. Validated by: scripts/test_5k_registry-b_contracts.mjs.
137. Require coaching deduction categories to appear at the stage that uses them. Validated by: scripts/test_5k_registry-b_contracts.mjs.
138. Detect conflicting coaching orders within a shared stage. Validated by: scripts/test_5k_registry-b_contracts.mjs.
139. Add a regression check for “Require a halt at one third of the plow’s stay-back distance”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
140. Add a regression check for “Interpolate the plow following target inside the keep-back distance”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
141. Add a regression check for “Use the alongside-plow drop-back reason”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
142. Add a regression check for “Clamp the plow drop-back speed to zero for a nearly stationary plow”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
143. Add a regression check for “Keep an already tighter target without adding a plow reason”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
144. Add a regression check for “Leave the target alone when the plow is outside its keep-back distance”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
145. Add a regression check for “Keep the ordinary headway for a plow driver following another plow”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
146. Add a regression check for “Preserve the longer high-speed headway after subtracting the standard gap”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
147. Add a regression check for “Allow an exact keep-back distance when returning ahead of a plow”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
148. Add a regression check for “Keep the ordinary gap rule when a plow is ahead, not behind the lane change”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
149. Add a regression check for “Keep the lane offer available when the plow is not its leader”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
150. Add a regression check for “Retain the plow constraint for an adjacent lane until the offset puts it far enough right”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
151. Add a regression check for “Skip plow prediction checks when sensing puts the plow alongside”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
152. Add a regression check for “Keep the plow pass rejection if the route frame moves sideways”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
153. Add a regression check for “Keep plow pass permission on the left when visibility is adequate”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
154. Add a regression check for “Apply the all-sides plow prediction restriction in poor sight”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
155. Add a regression check for “Release a plow prediction latch before evaluating another candidate”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
156. Add a regression check for “Use projected plow motion to distinguish shrinking and growing headway”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
157. Add a regression check for “Keep hard braking eligible when its predicted plow headway shrinks”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
158. Add a regression check for “Accept the exact metre of zipper stop overshoot”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
159. Add a regression check for “Preserve the separate let-in overshoot threshold”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
160. Add a regression check for “Prioritize a violated zipper hold over an early lane change”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
161. Add a regression check for “Classify a lane change after merging differently from a premature merge”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
162. Add a regression check for “Permit a lane change away from the closed lane when already in an open lane”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
163. Add a regression check for “Keep the zipper hold’s hard-brake exception”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
164. Add a regression check for “Clear the merge-line crossing latch before the next prediction”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
165. Add a regression check for “Leave the street speed limit in place if it is lower than the closure approach cap”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
166. Add a regression check for “Tag a granted zipper approach with the in-turn reason at its speed ceiling”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
167. Add a regression check for “Treat a near let-in stop as legitimate before Rules would hold motion”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
168. Add a regression check for “Distinguish motion instructions for waiting to merge and letting a car merge”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
169. Add a regression check for “Keep the three new hazards in their established relative order”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
170. Add a regression check for “Keep closure, plow and cyclist wording in their established situation order”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
171. Add a regression check for “Keep closure, cyclist and plow model fields in their established serialized order”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
172. Add a regression check for “Expose the work-zone, lane-control and optional detours independently”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
173. Add a regression check for “Separate zipper directions from parking directions in prompt assembly”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
174. Add a regression check for “Keep the passing instruction after parking advice without replacing that advice”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
175. Add a regression check for “Keep an unstarted pass from narrowing the candidate list”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
176. Add a regression check for “Keep the fall-back option when an active pass stops being clear”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
177. Add a regression check for “Forward the active passing detour to the braking law”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
178. Add a regression check for “Do not exempt an unrelated leading bike from following”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
179. Add a regression check for “Restore the target bike to following when a pass is no longer clear”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
180. Add a regression check for “Read the passing clearance from the street limit ahead of the temporary speed cap”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
181. Add a regression check for “Prefer the planned clearance over a newly sensed street limit during a pass”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
182. Add a regression check for “Do not charge Rules repeatedly for starting a pass already under way”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
183. Add a regression check for “Preserve Rules’ incentive to follow a cyclist waiting for a safe chance to pass”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
184. Add a regression check for “Do not report a stopped cyclist as a legitimate hold when there is room to keep moving”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
185. Add a regression check for “Do not give an alongside passing candidate a redundant follow alternative”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
186. Add a regression check for “Keep model advice for a blocked pass distinct from a change of mind during a pass”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
187. Add a regression check for “Keep plows out of cyclist overtaking even when the pass option is on”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
188. Add a regression check for “Avoid looking up a traffic path while a new pass is temporarily held”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
189. Add a regression check for “Reject an oncoming encounter based on distance even at low closing speed”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
190. Add a regression check for “Reject a fast-closing encounter beyond the fixed distance threshold”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
191. Add a regression check for “Keep a passing candidate clear when the oncoming car is outside its lateral corridor”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
192. Add a regression check for “Keep ordinary lane following exempt from the cyclist-specific oncoming rejection”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
193. Add a regression check for “Keep parallel vehicles outside the oncoming prediction check”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
194. Add a regression check for “Avoid an oncoming rejection when the ego body has not crossed the centre line”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
195. Add a regression check for “Avoid an oncoming rejection for a vehicle entirely behind the ego”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
196. Add a regression check for “Allow hard braking when the passing prediction has found oncoming traffic”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
197. Add a regression check for “Keep the merge replay marker after the lane-closure record owns its declaration”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
198. Add a regression check for “Keep the cyclist replay marker after the passing record owns its declaration”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
199. Add a regression check for “Keep the shared yield and all three passing events in trace counter order”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
200. Add a regression check for “Choose the first usable result from an ordered set of feature hooks”. Validated by: scripts/test_5k_registry-b_dispatch.mjs.
