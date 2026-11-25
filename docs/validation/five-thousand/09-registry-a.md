# Feature registry, batch A

Overnight flashing, left turns on red, amber-light decisions and bus-only lanes move behind the feature registry. The batch keeps their audit and decision order and adds policy boundary and registry validation checks.

1. Construct overnight flashing through the same World option that the free-drive registry exposes. Validated by: scripts/test_night_flash.mjs.
2. Declare the overnight encounter flag in the record so each new world starts with an independent audit gate. Validated by: scripts/test_5k_registry-a_schema.mjs.
3. Restore the active flashing clock through the checkpoint dispatch when a saved drive is resumed. Validated by: scripts/test_5k_registry-a_policies.mjs.
4. Prioritize the registered flashing plan when calculating the two groups' physical signal phases. Validated by: scripts/test_night_flash.mjs.
5. Resolve an individual approach through the temporary phase before checking its ordinary advance interval. Validated by: scripts/test_5k_registry-a_policies.mjs.
6. Use the explicit world's registered phase when a caller asks what light a movement has. Validated by: scripts/test_night_flash.mjs.
7. Keep scramble eligibility tied to the temporary signal phase while the flashing plan is active. Validated by: scripts/test_night_flash.mjs.
8. Supply dark pedestrian heads during temporary flashing without applying the ordinary walk interval. Validated by: scripts/test_night_flash.mjs.
9. Prevent ordinary pedestrian crossing permission during flashing so pedestrians rely on observed gaps. Validated by: scripts/test_night_flash.mjs.
10. Exclude flashing operation from opposing advance-green holds. Validated by: scripts/test_night_flash.mjs.
11. Suppress group and movement countdowns when a temporary flashing plan is in effect. Validated by: scripts/test_night_flash.mjs.
12. Return an approach-specific stop from the registered control resolver for side-street flashing red. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
13. Combine visible flashing and its replacement control through one sensing result before checking the junction. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
14. Skip the additional sight query for a visible override when the flashing option is disabled. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
15. Use the flashing record's approach priority instead of the ordinary signal approach ranking. Validated by: scripts/test_night_flash.mjs.
16. Use the grouped junction's position and approach list when measuring side-street give-way room. Validated by: scripts/test_night_flash.mjs.
17. Exclude vehicles still outside the crossing street from the main-street driver's flashing give-way check. Validated by: scripts/test_night_flash.mjs.
18. Let the fleet use the grouped signal centre when judging whether an intersection box is occupied. Validated by: scripts/test_night_flash.mjs.
19. Apply the registered 20 km/h caution ceiling to an NPC even while it waits for the box to clear. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
20. Let a flashing signal hold approaching NPC traffic at the line while the box is occupied. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
21. Observe a flashing control for the encounter audit independently of the selected manoeuvre. Validated by: scripts/test_night_flash.mjs.
22. Dispatch the flashing HUD notice before the later signal and plow notices in the same frame. Validated by: scripts/test_night_flash.mjs.
23. Keep the flashing-amber situation instruction ahead of the ordinary signal wording for Jev. Validated by: node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check.
24. Register the physical signal resolver after the feature records load so timing and map modules can load independently. Validated by: scripts/test_feature_registry.mjs.
25. Store the opening system-prompt flashing guidance in its record. Validated by: guarded and open system-prompt comparison.
26. Scope overnight road-class selection to the map as well as the intersection. Validated by: scripts/test_5k_registry-a_policies.mjs.
27. Compare group rank extremes in a single scan. Validated by: scripts/test_5k_registry-a_policies.mjs.
28. Refuse selection when a phase approach is missing its recognised group. Validated by: scripts/test_5k_registry-a_policies.mjs.
29. Handle a missing or malformed collection of approaches without selecting a flash plan. Validated by: scripts/test_5k_registry-a_policies.mjs.
30. Treat an absent map as an unavailable overnight plan. Validated by: scripts/test_5k_registry-a_policies.mjs.
31. Require a finite hour within the current local day before selecting overnight operation. Validated by: scripts/test_5k_registry-a_policies.mjs.
32. Retain the source control when a replacement stop lacks an approach identifier. Validated by: scripts/test_5k_registry-a_policies.mjs.
33. Skip the HUD route projection for an overnight world that has no local clock. Validated by: scripts/test_night_flash.mjs.
34. Reuse the resolved grouped junction throughout an NPC's box-occupancy check. Validated by: scripts/test_night_flash.mjs.
35. Expose the left-on-red option through feature construction while retaining the user-facing query switch. Validated by: node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check.
36. Run the shared red-turn gap check only after the feature finds a permitted left exit. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
37. Let the left-turn record supply the required entry lane to the shared stop and gap checks. Validated by: scripts/test_left_on_red.mjs.
38. Read an additional red turn's permission through one feature dispatch used by the planner and built-in agents. Validated by: scripts/test_5k_registry-a_policies.mjs.
39. Preserve the opportunity flag when sensing finds a permitted turn whose lane or gap is still blocked. Validated by: scripts/test_left_on_red.mjs.
40. Allow traffic to request a stop-memory opportunity in the feature's required lane. Validated by: scripts/test_left_on_red.mjs.
41. Record whether the physical approach qualifies at line entry even if the planned route heads elsewhere. Validated by: scripts/test_left_on_red.mjs.
42. Capture signed exit eligibility at entry so a scheduled change cannot alter the remembered turn. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
43. Let the registry validate the actual exit before it updates the crossing audit's intended bearing. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
44. Share the existing intersection model position for the left-turn decision fields. Validated by: scripts/test_left_on_red.mjs.
45. Supply the Jev hold-still exception only when the left-red turn is ready to go. Validated by: scripts/test_5k_registry-a_policies.mjs.
46. Have the feature own the left-turn notice's full-stop, yield and clear messages. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
47. Keep the left-turn prompt guidance immediately before the right-turn rule. Validated by: guarded and open system-prompt comparison.
48. Reject nonnumeric or unordered map bounds when checking regional turn eligibility. Validated by: scripts/test_5k_registry-a_policies.mjs.
49. Reject a missing or identical pair of approach and exit IDs before consulting turn geometry. Validated by: scripts/test_5k_registry-a_policies.mjs.
50. Fail closed when the left-turn geometry lookup has no map or edge index. Validated by: scripts/test_5k_registry-a_policies.mjs.
51. Skip the route lookup if no route control or enabled left-turn feature is available. Validated by: scripts/test_5k_registry-a_policies.mjs.
52. Declare steady-amber observation as a World feature with its own audit flag. Validated by: scripts/test_amber_policy.mjs.
53. Observe the physical amber before ordinary crossing audit handlers so turn intent and driver choice cannot change the first observation. Validated by: scripts/test_amber_policy.mjs.
54. Evaluate an amber violation when the front bumper crosses the applicable line. Validated by: scripts/test_amber_policy.mjs.
55. Defer an amber-arrow violation until the driven vehicle actually exits on a left turn. Validated by: scripts/test_amber_policy.mjs.
56. Keep a previously observed clearing speed in sensing after the control look window moves on. Validated by: scripts/test_amber_policy.mjs.
57. Place the latched signal decision in the same observed intersection position before line geometry is serialized. Validated by: node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check.
58. Supply the intersection-clearing exemption separately when the front has already passed the line. Validated by: scripts/test_amber_policy.mjs.
59. Share the latched signal decision between target speed, prediction and the built-in stop policy. Validated by: scripts/test_5k_registry-a_policies.mjs.
60. Allow a feature to lower the clearing speed while retaining the reason used by the speed planner. Validated by: scripts/test_5k_registry-a_policies.mjs.
61. Select a response-aware stop law before a feature applies a follower-specific braking adjustment. Validated by: scripts/test_5k_registry-a_policies.mjs.
62. Cap completed candidate laws after emergency braking and other alternatives have been assembled. Validated by: scripts/test_5k_registry-a_policies.mjs.
63. Let traffic obtain a registered signal stop decision before its ordinary braking fallback. Validated by: scripts/test_amber_policy.mjs.
64. Retain traffic's clearing cap after legal entry until its rear leaves the crossing street. Validated by: scripts/test_amber_policy.mjs.
65. Apply the dedicated Rules bonus for a controlled amber stop before ordinary signal-stop costs. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
66. Choose the controlled signal-stop candidate at the existing point in cautious-agent preference order. Validated by: scripts/test_amber_policy.mjs.
67. Allow a chosen controlled stop to execute its braking law without a separate immediate-stop action. Validated by: scripts/test_5k_registry-a_policies.mjs.
68. Serialize amber observation speed, distance and stopping distance through the intersection model hook. Validated by: node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check.
69. Provide the safe-stop or clear-carefully yellow instruction through a feature clause. Validated by: node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check.
70. Register the standalone amber clearing instruction in its original position in both LLM prompts. Validated by: guarded and open system-prompt comparison.
71. Place the seen-gated amber metric immediately after red lights in the benchmark report. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
72. Keep the amber verdict directly after the red-light verdict. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
73. Register the amber counter label at the front of evaluation trace audit events. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
74. Supply the amber incident's replay marker without maintaining it in the recorder list. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
75. Use the feature metric's category to classify an amber failure in an examiner sheet. Validated by: scripts/test_road_test.mjs.
76. Dispatch the amber coaching incident through the record so the reason controls its wording. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
77. Apply the amber coaching deduction from the drive's own counter delta before other legality deductions. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
78. Let the record cap the coaching grade from the current drive's amber violations. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
79. Keep amber guidance ahead of general junction tips when both apply. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
80. Gate the amber coaching summary on the observation flag for that specific drive. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
81. Ignore incomplete amber observations before they create or clear a latched decision. Validated by: scripts/test_5k_registry-a_policies.mjs.
82. Require a recognised displayed amber and an advance plan for arrow observations. Validated by: scripts/test_5k_registry-a_policies.mjs.
83. Return an unbounded stopping distance for an invalid speed. Validated by: scripts/test_5k_registry-a_policies.mjs.
84. Ignore malformed actuator lag in the steady-amber reaction allowance. Validated by: scripts/test_5k_registry-a_policies.mjs.
85. Calculate the reaction allowance and available braking room once per amber decision. Validated by: scripts/test_amber_policy.mjs.
86. Construct the existing bus-lane option and encounter audit gate through its feature record. Validated by: scripts/test_bus_lanes.mjs.
87. Run the reserved-lane exposure audit after cyclist passing and before calming. Validated by: scripts/test_bus_lanes.mjs.
88. Set the active reservation policy before deriving the ego's route lane. Validated by: scripts/test_bus_lanes.mjs.
89. Filter lane-change offers after the normal offer hooks have had their turn. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
90. Apply reserved-lane candidate rejection in its original order between collisions and lane-change checks. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
91. Publish the reserved-lane denial reason through the open-track wording map. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
92. Apply the local Rules exit incentive without changing the subsequent speed and stop costs. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
93. Let the cautious driver choose an eligible reserved-lane exit after emergency preference. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
94. Let the reservation record choose the closest legal lane from the route's alternatives. Validated by: scripts/test_bus_lanes.mjs.
95. Prepare for a reserved straight continuation before entering the matching lane chain. Validated by: scripts/test_bus_lane_merge.mjs.
96. Supply the route's lateral frame transitions for reserved-lane merges through the feature. Validated by: scripts/test_bus_lane_merge.mjs.
97. Keep the route's merge inspection method available to route callers through the generic dispatch. Validated by: scripts/test_bus_lane_merge.mjs.
98. Select a transit spawning lane through the reservation feature before placing the vehicle on its run. Validated by: scripts/test_bus_lanes.mjs.
99. Reuse one traffic path policy dispatcher for both spawned and updated traffic paths. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
100. Keep the original successor pool when every successor street is reserved. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
101. Prefer a legal successor street when another street's lanes are all reserved. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
102. Choose a legal lane on either side of a reserved turn-in while preserving the original search order. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
103. Give cars and bicycles independent reserved-lane spawn eligibility. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
104. Update an ordinary lane change toward a lawful lane without bypassing the fleet's gap check. Validated by: scripts/test_bus_lanes.mjs.
105. Write the reserved-lane observation into the model state before other road constraints. Validated by: node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check.
106. Place the reserved-lane situation clause ahead of the calming and right-hook clauses. Validated by: node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check.
107. Register the reserved-lane LLM instruction at its established prompt position. Validated by: guarded and open system-prompt comparison.
108. Keep the bus-lane metre threshold and failure wording in the metric record. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
109. Keep continuous bus-lane metre samples out of the decision trace while retaining aggregate reporting. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
110. Classify a reserved-lane failure through the metric's examiner category. Validated by: scripts/test_road_test.mjs.
111. Supply the reserved-lane coaching deduction before the ordinary moving-traffic deductions. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
112. Keep reserved-lane guidance after the following-distance tip when both apply. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
113. Retain exact measured metres in the independent bus-lane coaching summary. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
114. Move bus-lane painting into the browser-only feature adapter while retaining scene insertion order. Validated by: scripts/test_bus_lanes.mjs.
115. Reject local-hour values outside the day for reservable-lane schedules. Validated by: scripts/test_5k_registry-a_policies.mjs.
116. Treat an unrecognized schedule object as an active reservation when the local hour is usable. Validated by: scripts/test_5k_registry-a_policies.mjs.
117. Retain the reservation when a listed window cannot be evaluated. Validated by: scripts/test_5k_registry-a_policies.mjs.
118. Retain a scheduled reservation when the clock lacks a usable explicit weekday. Validated by: scripts/test_5k_registry-a_policies.mjs.
119. Skip malformed lane-layer entries without throwing during reservation lookup. Validated by: scripts/test_5k_registry-a_policies.mjs.
120. Treat an unknown exemption list as giving ordinary vehicles no exemption. Validated by: scripts/test_5k_registry-a_policies.mjs.
121. Reject nonfinite route distances and invalid lane-edge indices before querying route geometry. Validated by: scripts/test_5k_registry-a_policies.mjs.
122. Avoid recording a distance sample for a nonpositive or nonfinite time step. Validated by: scripts/test_5k_registry-a_policies.mjs.
123. Prevent invalid speed and overflowing distance samples from poisoning the lane audit. Validated by: scripts/test_5k_registry-a_policies.mjs.
124. Detect nonenumerable or symbol-backed declarations that dispatch would otherwise ignore. Validated by: scripts/test_5k_registry-a_schema.mjs.
125. Reject accessor-based callbacks while retaining lazily evaluated obstacle labels. Validated by: scripts/test_5k_registry-a_schema.mjs.
126. Report extra fields in metric, prompt and notice declarations instead of silently discarding them. Validated by: scripts/test_5k_registry-a_schema.mjs.
127. Report misspelled obstacle and coaching-entry fields at registry load. Validated by: scripts/test_5k_registry-a_schema.mjs.
128. Reject unknown keys nested in a slotted callback declaration. Validated by: scripts/test_5k_registry-a_schema.mjs.
129. Report an explicitly null slot as a declaration error. Validated by: scripts/test_5k_registry-a_schema.mjs.
130. Validate the derived query flag as well as an explicitly configured one. Validated by: scripts/test_5k_registry-a_schema.mjs.
131. Detect sparse priority lists and repeated candidate IDs before building the retention set. Validated by: scripts/test_5k_registry-a_schema.mjs.
132. Reject mutable or unserializable snapshot defaults that could leak state between decisions. Validated by: scripts/test_5k_registry-a_schema.mjs.
133. Require a threshold for a one-shot trace declaration. Validated by: scripts/test_5k_registry-a_schema.mjs.
134. Reject a named threshold trace when its trace output is switched off. Validated by: scripts/test_5k_registry-a_schema.mjs.
135. Reject duplicate coach orders within a declaration and slot. Validated by: scripts/test_5k_registry-a_schema.mjs.
136. Flag a score category configured on a stage that cannot use it. Validated by: scripts/test_5k_registry-a_schema.mjs.
137. Require a meaningful style name when a notice declares a nonempty style. Validated by: scripts/test_5k_registry-a_schema.mjs.
138. Refuse non-array registries with a specific validation error. Validated by: scripts/test_5k_registry-a_schema.mjs.
139. Give one feature ownership of each coaching seen flag. Validated by: scripts/test_5k_registry-a_schema.mjs.
140. Give each failure reason and evaluation marker one owner to avoid ambiguous attribution. Validated by: scripts/test_5k_registry-a_schema.mjs.
141. Detect duplicate replay markers even when one record supplies a threshold trace name. Validated by: scripts/test_5k_registry-a_schema.mjs.
142. Reject a priority candidate ID claimed by two records. Validated by: scripts/test_5k_registry-a_schema.mjs.
143. Keep validated records, slot lists and option lists immutable after initialization. Validated by: scripts/test_5k_registry-a_schema.mjs.
144. Reuse a frozen hook list for every request for the same hook and slot. Validated by: scripts/test_5k_registry-a_schema.mjs.
145. Preserve queued hook-list identities across circular import initialization. Validated by: scripts/test_feature_registry.mjs.
146. Reject requests to treat metric, prompt or notice data as executable hooks. Validated by: scripts/test_5k_registry-a_schema.mjs.
147. Collect route options using the existing initialized hook list. Validated by: scripts/test_feature_registry.mjs.
148. Report the unsupported position when feature construction cannot proceed. Validated by: scripts/test_5k_registry-a_schema.mjs.
149. Read only the option object's own settings during feature construction. Validated by: scripts/test_5k_registry-a_schema.mjs.
150. Reject an unsupported HUD dispatch slot with its name in the error. Validated by: scripts/test_5k_registry-a_schema.mjs.
151. Record a HUD announcement only after its badge call succeeds. Validated by: scripts/test_feature_registry.mjs.
152. Resolve absent event badge input without dereferencing a missing event. Validated by: scripts/test_5k_registry-a_schema.mjs.
153. Read metrics from own counter fields and keep missing seen counters at zero. Validated by: scripts/test_5k_registry-a_schema.mjs.
154. Exclude nonnumeric and negative counters from failures and mark invalid reported data unavailable. Validated by: scripts/test_5k_registry-a_schema.mjs.
155. Keep large finite counters representable when scaling them for output would overflow. Validated by: scripts/test_5k_registry-a_schema.mjs.
156. Support declared clock fields for boolean or counted enabled features. Validated by: scripts/test_5k_registry-a_schema.mjs.
157. Use finite positive counters for feature score deductions when an optional counter is missing or corrupt. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
158. Keep a previous driving session's counter balance out of the current session's penalties. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
159. Document the physical signal override, visible policy and grouped priority hooks together. Validated by: uv run --locked python -m unittest discover -s tests -p test_doc_links.py.
160. Document the additional red-turn entry, exit and traffic lane contracts. Validated by: uv run --locked python -m unittest discover -s tests -p test_doc_links.py.
161. Document the metric trace switch and coaching counter-delta declarations. Validated by: uv run --locked python -m unittest discover -s tests -p test_doc_links.py.
162. Describe reserved-lane handling for malformed schedules and out-of-range clock hours. Validated by: uv run --locked python -m unittest discover -s tests -p test_doc_links.py.
163. Cover opposite main streets derived from the same signal object in two maps. Validated by: scripts/test_5k_registry-a_policies.mjs.
164. Check that an explicitly supplied world's signal phase does not activate the global clock. Validated by: scripts/test_5k_registry-a_policies.mjs.
165. Check that replay restoration supplies the active main and side phases again. Validated by: scripts/test_5k_registry-a_policies.mjs.
166. Exercise dark-control precedence over the nighttime replacement in the registry. Validated by: scripts/test_5k_registry-a_policies.mjs.
167. Verify that a visible side-street replacement retains the approach identity and two-way stop type. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
168. Check that the main-street override changes the speed without replacing the signal control. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
169. Check that an unseen main-street signal supplies no clearing permission. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
170. Check that an unseen side-street signal supplies no stop-memory replacement to sensing. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
171. Check that a busy flashing-amber junction holds ordinary traffic and a cleared box releases it. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
172. Confirm that the overnight traffic policy leaves an ordinary green unmodified. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
173. Cover a provisional left-turn exit recorded with a signed-exit snapshot. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
174. Check that a live left-turn audit still follows the sign when no snapshot was recorded at entry. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
175. Check that an unrelated exit cannot complete a provisional turn. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
176. Verify that confirming the exit updates the crossing's direction and encounter flag together. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
177. Verify that a permitted right turn remains permitted when another red-turn observation cannot go. Validated by: scripts/test_5k_registry-a_policies.mjs.
178. Check that loss of the left-turn observation clears the repeat-suppression state for the HUD. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
179. Check that an invalid intervening amber timestamp leaves the earlier physical observation latched. Validated by: scripts/test_5k_registry-a_policies.mjs.
180. Check that a confirmed red turn does not acquire an amber stop preference. Validated by: scripts/test_5k_registry-a_policies.mjs.
181. Verify that a firm stop law carries both the braking detail and observation allowance into candidates. Validated by: scripts/test_5k_registry-a_policies.mjs.
182. Verify that a legal clearing cap keeps a slower candidate slower and leaves an unbounded hard-brake law alone. Validated by: scripts/test_5k_registry-a_policies.mjs.
183. Distinguish safe-stop and acceleration incidents in the coaching report. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
184. Check that a prior driver's amber violations do not cap the current coaching score. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
185. Check that amber reports appear only after amber has been seen even when reserved-lane reporting is present. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
186. Verify that physical amber replay markers are retained while individual bus-lane metre samples are omitted. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
187. Verify that auditing the same aggregate twice does not add a duplicate trace event. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
188. Cover the reserved-lane stopping exemption for a compulsory hold. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
189. Check that the candidate filter accepts the exact standing-speed boundary but rejects just above it. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
190. Verify that an emergency brake can remain in the reserved lane. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
191. Cover the permitted right-turn entry separately from an inactive reservation. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
192. Verify that the local agents reward an eligible move to an unrestricted lane. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
193. Verify that a selected legal default lane is left to the fleet's existing lane choice. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
194. Cover an all-reserved successor pool without discarding its final path option. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
195. Check that a bicycle-accessible reserved street remains in a cyclist's successor pool. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
196. Confirm a transit vehicle can retain its reservation lane while an ordinary vehicle seeks another. Validated by: scripts/test_5k_registry-a_dispatch.mjs.
197. Check that omitting the option from a traffic path leaves no reservation state behind. Validated by: scripts/test_5k_registry-a_policies.mjs.
198. Check that a live traffic path refreshes its schedule from the world's current clock. Validated by: scripts/test_5k_registry-a_policies.mjs.
199. Check that a raw counter with a string value cannot create a false failure. Validated by: scripts/test_5k_registry-a_schema.mjs.
200. Check that identical lists are reused for the same hook without sharing callbacks across different slots. Validated by: scripts/test_5k_registry-a_schema.mjs.
