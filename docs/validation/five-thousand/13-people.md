# Pedestrians, cyclists and parking

Parking plans claim bays atomically and validate their manoeuvre geometry. Pedestrian crossing and contraflow rider queries handle missing map data, and focused checks cover crossing, yielding, and parking boundaries.

1. Reject parking reservations without an object identity to own them. Validated by: `scripts/test_5k_people_parking.mjs`.
2. Report a missing bay before deriving a reservation. Validated by: `scripts/test_5k_people_parking.mjs`.
3. Report the missing edge ID when an inferred reservation cannot locate its kerb. Validated by: `scripts/test_5k_people_parking.mjs`.
4. Reject invalid bay coordinates before projecting a reservation. Validated by: `scripts/test_5k_people_parking.mjs`.
5. Validate bumper dimensions when deriving reservation endpoints. Validated by: `scripts/test_5k_people_parking.mjs`.
6. Update the reservation record only after the complete span is finite and increasing. Validated by: `scripts/test_5k_people_parking.mjs`.
7. Share owner-checked releases between ego parking and traffic parking. Validated by: `scripts/test_5k_people_parking.mjs`.
8. Reject nonfinite parked-car centers before inserting them in the spatial index. Validated by: `scripts/test_5k_people_parking.mjs`.
9. Reject nonfinite moves before changing the parked axle or its cell. Validated by: `scripts/test_5k_people_parking.mjs`.
10. Bound the work of map-wide parking queries by the number of populated cells. Validated by: `scripts/test_5k_people_parking.mjs`.
11. Reject invalid parked-car step durations before advancing door timers. Validated by: `scripts/test_5k_people_parking.mjs`.
12. Treat a zero-duration parked-car tick as a no-op. Validated by: `scripts/test_5k_people_parking.mjs`.
13. Keep an expired door event from closing a newer door on the same car. Validated by: `scripts/test_5k_people_parking.mjs`.
14. Use one body-center to rear-axle offset when placing parking bays and parked cars. Validated by: `scripts/test_parking_bends.mjs`.
15. Skip stale adjacency entries when placing parked cars near junctions. Validated by: `scripts/test_parking_bends.mjs`.
16. Skip edges without enough finite length to contain a bay. Validated by: `scripts/test_parking_bends.mjs`.
17. Reject invalid steering and distance inputs before probing a parking move. Validated by: `scripts/test_5k_people_parking.mjs`.
18. Use one clearance test for changes in both tyre clearance and body overhang. Validated by: `scripts/test_5k_people_parking.mjs`.
19. Fail parking clearance when road geometry cannot return finite distances. Validated by: `scripts/test_5k_people_parking.mjs`.
20. Skip parking clearance markers that expose no collision body. Validated by: `scripts/test_5k_people_parking.mjs`.
21. Return an empty legal-stretch list when there is no edge. Validated by: `scripts/test_5k_people_parking.mjs`.
22. Compute each junction exclusion from the distinct neighboring roads and their widths in one pass. Validated by: `scripts/test_5k_people_parking.mjs`.
23. Skip missing adjacency edges when determining legal parking space. Validated by: `scripts/test_5k_people_parking.mjs`.
24. Ignore malformed mapped crosswalk positions when subtracting parking exclusions. Validated by: `scripts/test_5k_people_parking.mjs`.
25. Filter invalid source intervals and exclusion intervals before subtracting occupied space. Validated by: `scripts/test_5k_people_parking.mjs`.
26. Reject invalid or out-of-edge ranges in the straight-kerb check. Validated by: `scripts/test_5k_people_parking.mjs`.
27. Return no destination spaces when the route or search bounds are invalid. Validated by: `scripts/test_5k_people_parking.mjs`.
28. Share the temporary block exclusion rule between destination and traffic parking. Validated by: `scripts/test_5k_people_parking.mjs`.
29. Reject empty or reversed spaces before calculating the parallel parking geometry. Validated by: `scripts/test_5k_people_parking.mjs`.
30. Treat an obstacle corner outside the sweep circle as clear regardless of its signed lateral offset. Validated by: `scripts/test_5k_people_parking.mjs`.
31. Reject an invalid radius in the manoeuvre solver. Validated by: `scripts/test_5k_people_parking.mjs`.
32. Reject lateral moves outside the solver's arc range. Validated by: `scripts/test_5k_people_parking.mjs`.
33. Reject invalid longitudinal solver limits while allowing unbounded room. Validated by: `scripts/test_5k_people_parking.mjs`.
34. Use the two pure arcs for small lateral shifts instead of returning a negative straight leg. Validated by: `scripts/test_5k_people_parking.mjs`.
35. Resume an existing pull-out law when the parked snapshot is absent. Validated by: `scripts/test_5k_people_parking.mjs`.
36. Clear an orphaned parking-in law that has no matching plan. Validated by: `scripts/test_5k_people_parking.mjs`.
37. Reset the hold distance when the destination has no space. Validated by: `scripts/test_5k_people_parking.mjs`.
38. Keep a bay reserved until the departing axle has a measurable distance from the parked position. Validated by: `scripts/test_5k_people_parking.mjs`.
39. Validate parking step time before updating the active manoeuvre. Validated by: `scripts/test_5k_people_parking.mjs`.
40. Preserve parking law state and the lane handoff on a zero-duration tick. Validated by: `scripts/test_5k_people_parking.mjs`.
41. Keep inherited object keys out of pull-out phase selection. Validated by: `scripts/test_5k_people_parking.mjs`.
42. Make repeated attempts to commit the same traffic parker idempotent. Validated by: `scripts/test_5k_people_parking.mjs`.
43. Roll back bays acquired before an error in the same traffic parking commit. Validated by: `scripts/test_5k_people_parking.mjs`.
44. Leave disabled traffic parking untouched in the scheduler. Validated by: `scripts/test_5k_people_parking.mjs`.
45. Reject nonfinite route progress and lateral offsets in the traffic parker conflict test. Validated by: `scripts/test_5k_people_parking.mjs`.
46. Return no traffic parker sensing result when the route projection is missing. Validated by: `scripts/test_5k_people_parking.mjs`.
47. Let the parking audit handle a world without traffic parking state. Validated by: `scripts/test_5k_people_parking.mjs`.
48. Skip stale entries without a parking plan during the parking audit. Validated by: `scripts/test_5k_people_parking.mjs`.
49. Share the street identity between pedestrian construction, street lookup and marked crossings on either direction. Validated by: `scripts/test_5k_people_crossings.mjs`.
50. Exclude edges with invalid lengths from pedestrian spawn weights. Validated by: `scripts/test_5k_people_crossings.mjs`.
51. Skip marked crossings with invalid map coordinates while building a crowd. Validated by: `scripts/test_5k_people_crossings.mjs`.
52. Index intersection vertices once per crowd build and preserve the first matching signal. Validated by: `scripts/test_5k_people_crossings.mjs`.
53. Skip crowd spawning for unbounded or nonpositive population requests. Validated by: `scripts/test_5k_people_crossings.mjs`.
54. Return no pedestrian leg for an unmapped corner. Validated by: `scripts/test_5k_people_crossings.mjs`.
55. Return no mapped pedestrian street for a missing edge. Validated by: `scripts/test_5k_people_crossings.mjs`.
56. Validate the direction of authored sidewalk paths to avoid nonadvancing walks. Validated by: `scripts/test_5k_people_crossings.mjs`.
57. Validate the side of authored sidewalk paths before making kerb offsets. Validated by: `scripts/test_5k_people_crossings.mjs`.
58. Reject nonfinite starting positions before sampling sidewalk waypoints. Validated by: `scripts/test_5k_people_crossings.mjs`.
59. Turn back when the pedestrian's street has no usable leg at the next corner. Validated by: `scripts/test_5k_people_crossings.mjs`.
60. Select the first marked crossing encountered with a single pass and keep stable ties. Validated by: `scripts/test_5k_people_crossings.mjs`.
61. Keep an authored pedestrian without a destination standing still. Validated by: `scripts/test_5k_people_crossings.mjs`.
62. Reject invalid pedestrian timestep values before mutating actors. Validated by: `scripts/test_5k_people_crossings.mjs`.
63. Leave pedestrian state unchanged on a zero-duration step. Validated by: `scripts/test_5k_people_crossings.mjs`.
64. Initialize the wait timer for an authored pedestrian on first use. Validated by: `scripts/test_5k_people_crossings.mjs`.
65. Initialize an authored pedestrian's walking animation distance on first use. Validated by: `scripts/test_5k_people_crossings.mjs`.
66. Refuse crossing entry when either endpoint is malformed. Validated by: `scripts/test_5k_people_crossings.mjs`.
67. Use ordinary gap checks when a well-formed crossing has no mapped signal leg. Validated by: `scripts/test_5k_people_crossings.mjs`.
68. Reject unbounded and nonpositive crowd queries. Validated by: `scripts/test_5k_people_crossings.mjs`.
69. Probe the first two waypoints for a waiting pedestrian without allocating an array and allow a missing path. Validated by: `scripts/test_5k_people_crossings.mjs`.
70. Reject inconsistent or reversed path ranges before searching for a pedestrian conflict. Validated by: `scripts/test_5k_people_crossings.mjs`.
71. Find the crossing at the last point of a path even when the query begins there. Validated by: `scripts/test_5k_people_crossings.mjs`.
72. Reuse the crossing direction across path segments in pedestrian conflict searches. Validated by: `scripts/test_5k_people_crossings.mjs`.
73. Ignore missing and invalid signal approach headings in the crossing group lookup. Validated by: `scripts/test_5k_people_crossings.mjs`.
74. Return no line intersection for a marked crossing with a missing endpoint. Validated by: `scripts/test_5k_people_crossings.mjs`.
75. Keep nonfinite distances out of marked-crosswalk intersection results. Validated by: `scripts/test_5k_people_crossings.mjs`.
76. Ignore traffic with unknown heading or speed in the stopped-at-crosswalk test. Validated by: `scripts/test_5k_people_crossings.mjs`.
77. Reject route distance arrays that do not match the route geometry in marked-crossing searches. Validated by: `scripts/test_5k_people_crossings.mjs`.
78. Refresh route crossing results after marked crossings are appended to the same list. Validated by: `scripts/test_5k_people_crossings.mjs`.
79. Clear the remembered crosswalk stop if its clock or ego speed becomes invalid. Validated by: `scripts/test_5k_people_crossings.mjs`.
80. Skip a crossing without geometry when identifying the current crosswalk stop. Validated by: `scripts/test_5k_people_crossings.mjs`.
81. Reject nonfinite inputs in the stop-short calculation. Validated by: `scripts/test_5k_people_crossings.mjs`.
82. Reject malformed observer-to-pedestrian distances before probing occlusion. Validated by: `scripts/test_5k_people_crossings.mjs`.
83. Ignore actors without a physical box in pedestrian sightline checks. Validated by: `scripts/test_5k_people_crossings.mjs`.
84. Reuse the observer's ray origin across pedestrian occlusion sample points. Validated by: `scripts/test_5k_people_crossings.mjs`.
85. Reject invalid box extents and coordinates when clipping a sightline. Validated by: `scripts/test_5k_people_crossings.mjs`.
86. Normalize unusually large contraflow angles without an unbounded loop. Validated by: `scripts/test_contraflow.mjs`.
87. Avoid copying an already independent list of signal approaches before sorting. Validated by: `scripts/test_contraflow.mjs`.
88. Allow a contraflow metadata lookup on an absent map. Validated by: `scripts/test_5k_people_crossings.mjs`.
89. Ignore missing edges in the contraflow junction adjacency lists. Validated by: `scripts/test_5k_people_crossings.mjs`.
90. Reject a rider path append without two finite points. Validated by: `scripts/test_5k_people_crossings.mjs`.
91. Commit the rider path only when its length actually advances. Validated by: `scripts/test_5k_people_crossings.mjs`.
92. Use a finite nonnegative integer target for contraflow riders. Validated by: `scripts/test_5k_people_crossings.mjs`.
93. Skip missing predecessor edges when chaining contraflow blocks. Validated by: `scripts/test_5k_people_crossings.mjs`.
94. Skip missing outgoing edges when choosing a rider's route away. Validated by: `scripts/test_5k_people_crossings.mjs`.
95. Skip rider placement if the reverse street chain cannot form a usable path. Validated by: `scripts/test_5k_people_crossings.mjs`.
96. Do not count a rider extension unless its new path segment was added. Validated by: `scripts/test_5k_people_crossings.mjs`.
97. Reject disabled manual contraflow placement before drawing from the random stream. Validated by: `scripts/test_5k_people_crossings.mjs`.
98. Reject nonfinite placement distances and invalid initial speeds for authored riders. Validated by: `scripts/test_5k_people_crossings.mjs`.
99. Reject invalid cruising target speeds even when the initial speed is valid. Validated by: `scripts/test_5k_people_crossings.mjs`.
100. Skip spawn work on a disabled contraflow fleet. Validated by: `scripts/test_5k_people_crossings.mjs`.
101. Exclude nonfinite edges from contraflow spawn weights. Validated by: `scripts/test_5k_people_crossings.mjs`.
102. Reject invalid contraflow proximity query radii. Validated by: `scripts/test_5k_people_crossings.mjs`.
103. Reject invalid active contraflow step durations before updating riders. Validated by: `scripts/test_5k_people_crossings.mjs`.
104. Let a zero-duration contraflow step leave spawn timing alone. Validated by: `scripts/test_5k_people_crossings.mjs`.
105. Handle a missing rider path in the contraflow exit test. Validated by: `scripts/test_5k_people_crossings.mjs`.
106. Keep pedestrian identifiers unique across multiple batches spawned into one crowd. Validated by: `scripts/test_5k_people_crossings.mjs`.
107. Build sidewalk paths on maps that omit the intersection layer. Validated by: `scripts/test_5k_people_crossings.mjs`.
108. Reject a nonfinite sidewalk endpoint before iterating waypoints. Validated by: `scripts/test_5k_people_crossings.mjs`.
109. Fail a malformed pedestrian waypoint with the actor ID before advancing its position. Validated by: `scripts/test_5k_people_crossings.mjs`.
110. Fail malformed walking speeds before updating pedestrian geometry. Validated by: `scripts/test_5k_people_crossings.mjs`.
111. Treat a crossing with unknown geometry as occupied in the entry check. Validated by: `scripts/test_5k_people_crossings.mjs`.
112. Fail closed when directly assessing stopping room for a malformed marked crossing. Validated by: `scripts/test_5k_people_crossings.mjs`.
113. Validate the look range and available time in an unsignalled gap check. Validated by: `scripts/test_5k_people_crossings.mjs`.
114. Keep nonfinite pedestrian poses out of driver crossing conflicts. Validated by: `scripts/test_5k_people_crossings.mjs`.
115. Reject an invalid time window before looking for pedestrians waiting at the kerb. Validated by: `scripts/test_5k_people_crossings.mjs`.
116. Skip malformed pending pedestrian waypoints in kerb conflict detection. Validated by: `scripts/test_5k_people_crossings.mjs`.
117. Report no crossing distance without a ray origin or observer vehicle. Validated by: `scripts/test_5k_people_crossings.mjs`.
118. Treat absent route geometry as an empty marked-crossing search. Validated by: `scripts/test_5k_people_crossings.mjs`.
119. Compute the observer's front extent once per stopped-traffic search. Validated by: `scripts/test_5k_people_crossings.mjs`.
120. Reject missing or unbounded sight obstruction geometry before clipping. Validated by: `scripts/test_5k_people_crossings.mjs`.
121. Reject non-polyline objects and missing vertices during contraflow path append. Validated by: `scripts/test_5k_people_crossings.mjs`.
122. Reject malformed stop setbacks before committing a contraflow path. Validated by: `scripts/test_5k_people_crossings.mjs`.
123. Allow a contraflow path to finish without appending an unmapped exit lane. Validated by: `scripts/test_5k_people_crossings.mjs`.
124. Skip placement when a contraflow street has no centerline. Validated by: `scripts/test_5k_people_crossings.mjs`.
125. Reject invalid or unbounded sampling ranges in the rider conflict test. Validated by: `scripts/test_5k_people_crossings.mjs`.
126. Skip rider conflict work when a rider or driver path has unusable geometry. Validated by: `scripts/test_5k_people_crossings.mjs`.
127. Compute the driver's acceleration envelope once per rider conflict search. Validated by: `scripts/test_5k_people_crossings.mjs`.
128. Ask for available rightward room once per sample in the oncoming rider conflict check. Validated by: `scripts/test_5k_people_crossings.mjs`.
129. Return no extra rightward room for invalid vehicle widths. Validated by: `scripts/test_5k_people_crossings.mjs`.
130. Reject an invalid look horizon before searching upcoming contraflow entries. Validated by: `scripts/test_5k_people_crossings.mjs`.
131. Use default bicycle dimensions in the exit conflict when a rider lacks a custom spec. Validated by: `scripts/test_5k_people_crossings.mjs`.
132. Distinguish unprojectable kerb geometry from an invalid bay span when reserving parking. Validated by: `scripts/test_5k_people_parking.mjs`.
133. Use the same transactional bay claim for ego and traffic parallel parking. Validated by: `scripts/test_5k_people_parking.mjs`.
134. Publish the ego parking plan only after its bay claims succeed. Validated by: `scripts/test_5k_people_parking.mjs`.
135. Handle an absent car in the parked removal entry point. Validated by: `scripts/test_5k_people_parking.mjs`.
136. Compute stopping room before looking up nearby parked door owners and skip the query when no owner could qualify. Validated by: `scripts/test_5k_people_parking.mjs`.
137. Skip cars with an active door and cars that stay put before projecting automatic door candidates. Validated by: `scripts/test_5k_people_parking.mjs`.
138. Reject impossible lateral shifts before planning the S. Validated by: `scripts/test_5k_people_parking.mjs`.
139. Check that the two arcs and the intervening straight recover the requested lateral shift. Validated by: `scripts/test_5k_people_parking.mjs`.
140. Check that the solver can spend additional longitudinal room while preserving the targeted shift. Validated by: `scripts/test_5k_people_parking.mjs`.
141. Check that opposite-direction mapped crossings reserve the near-side buffer but do not add it to the departure side. Validated by: `scripts/test_5k_people_parking.mjs`.
142. Check that a downstream control line limits the legal parking interval. Validated by: `scripts/test_5k_people_parking.mjs`.
143. Check that a left-only parking lane offers no right-side parking. Validated by: `scripts/test_5k_people_parking.mjs`.
144. Check that traffic parking rejects spaces that fit a car but cannot fit the specified longer vehicle. Validated by: `scripts/test_5k_people_parking.mjs`.
145. Check that parking clearance distinguishes standing bodies from moving bodies handled by the safety prediction. Validated by: `scripts/test_5k_people_parking.mjs`.
146. Check that a scenery sweep can block a parking move when the road and traffic checks allow it. Validated by: `scripts/test_5k_people_parking.mjs`.
147. Check that a stationary car on the curb side does not block a left pull-out. Validated by: `scripts/test_5k_people_parking.mjs`.
148. Check that backing out releases the reserved bay at the exact departure distance. Validated by: `scripts/test_5k_people_parking.mjs`.
149. Check that sidewalk walks pick the first of multiple crossings in either direction. Validated by: `scripts/test_5k_people_crossings.mjs`.
150. Check that completed crossings clear the conflict before the pedestrian starts the waypoint pause. Validated by: `scripts/test_5k_people_crossings.mjs`.
151. Check that the nearest crossing wins when the crowd list starts with a farther pedestrian. Validated by: `scripts/test_5k_people_crossings.mjs`.
152. Check that a tie in route progress preserves crowd order in the returned pedestrian conflict. Validated by: `scripts/test_5k_people_crossings.mjs`.
153. Check that the conflict reports the remaining distance along the crossing to the travel lane. Validated by: `scripts/test_5k_people_crossings.mjs`.
154. Check that a crossing already passed is reported with its negative distance. Validated by: `scripts/test_5k_people_crossings.mjs`.
155. Check that a ray through the kerb endpoint counts as crossing. Validated by: `scripts/test_5k_people_crossings.mjs`.
156. Check that a ray parallel to a crosswalk has no unique crossing. Validated by: `scripts/test_5k_people_crossings.mjs`.
157. Check that a stationary look becomes complete at the exact required duration. Validated by: `scripts/test_5k_people_crossings.mjs`.
158. Check that a completed look remains recorded as the driver resumes moving. Validated by: `scripts/test_5k_people_crossings.mjs`.
159. Check that passing the crossing clears its previous look even before stopping again. Validated by: `scripts/test_5k_people_crossings.mjs`.
160. Check that a cyclist in the adjacent lane does not count as a vehicle being passed at the crosswalk. Validated by: `scripts/test_5k_people_crossings.mjs`.
161. Check that opposing traffic does not count as a stopped vehicle being overtaken. Validated by: `scripts/test_5k_people_crossings.mjs`.
162. Check that a parked vehicle only occludes a pedestrian when passed as an explicit standing blocker. Validated by: `scripts/test_5k_people_crossings.mjs`.
163. Check that a held stationary rider does not reserve the exit of a contraflow street. Validated by: `scripts/test_5k_people_crossings.mjs`.
164. Check that a rider who stops before entering a block does not hold its exit. Validated by: `scripts/test_5k_people_crossings.mjs`.
165. Check that a rider who has cleared the mouth no longer blocks traffic entering the street. Validated by: `scripts/test_5k_people_crossings.mjs`.
166. Check that high-speed approaching traffic can prevent marked crossing entry despite a vacant crossing. Validated by: `scripts/test_5k_people_crossings.mjs`.
167. Check that a pedestrian gap search does not block on traffic outside its configured range. Validated by: `scripts/test_5k_people_crossings.mjs`.
168. Check that an authored pedestrian stays at its waypoint during a held challenge start. Validated by: `scripts/test_5k_people_crossings.mjs`.
169. Check that knockdown time runs down while the pedestrian remains stationary. Validated by: `scripts/test_5k_people_crossings.mjs`.
170. Check that ordinary signal crossing entry follows the axis parallel to the walk. Validated by: `scripts/test_5k_people_crossings.mjs`.
171. Check that the flashing clearance phase does not let a waiting pedestrian start crossing. Validated by: `scripts/test_5k_people_crossings.mjs`.
172. Check that a prediction spanning a signal cycle sees an upcoming walk at the second waypoint. Validated by: `scripts/test_5k_people_crossings.mjs`.
173. Check that a pedestrian waiting for a signal contributes no kerb conflict outside the prediction window. Validated by: `scripts/test_5k_people_crossings.mjs`.
174. Check that a pedestrian too far from the kerb does not create a pending crossing conflict. Validated by: `scripts/test_5k_people_crossings.mjs`.
175. Check that a knocked-down pedestrian does not create a pending crossing conflict. Validated by: `scripts/test_5k_people_crossings.mjs`.
176. Check that one unobstructed side ray still gives the driver sight of a pedestrian. Validated by: `scripts/test_5k_people_crossings.mjs`.
177. Check that the pedestrian occlusion test stops at the daylight viewing range. Validated by: `scripts/test_5k_people_crossings.mjs`.
178. Check that an unheld stationary rider can still hold traffic at the block it is about to leave. Validated by: `scripts/test_5k_people_crossings.mjs`.
179. Check that a rider does not hold the exit of a different block. Validated by: `scripts/test_5k_people_crossings.mjs`.
180. Check that a perpendicular rider and car with overlapping arrival times create a crossing conflict. Validated by: `scripts/test_5k_people_crossings.mjs`.
181. Check that an approaching rider who will stop before reaching the shared path does not create a conflict. Validated by: `scripts/test_5k_people_crossings.mjs`.
182. Check that a painted contraflow path uses the appropriate asphalt edge after excluding parking width. Validated by: `scripts/test_5k_people_crossings.mjs`.
183. Check that rightward room for passing a contraflow rider excludes the parking lane and the road margin. Validated by: `scripts/test_5k_people_crossings.mjs`.
184. Check that the contraflow entry look excludes a street exactly at the horizon. Validated by: `scripts/test_5k_people_crossings.mjs`.
185. Check that contraflow entry checks ignore a street already behind the front bumper. Validated by: `scripts/test_5k_people_crossings.mjs`.
186. Check that claimed parking plans leave already occupied and previously reserved bays intact. Validated by: `scripts/test_5k_people_parking.mjs`.
187. Check that a door event timer still resets when there is insufficient stopping room for any door event. Validated by: `scripts/test_5k_people_parking.mjs`.
188. Check that a bend within a parking interval disqualifies the space while a bend behind it does not. Validated by: `scripts/test_5k_people_parking.mjs`.
189. Check that a temporary parking exclusion on an adjacent block leaves the selected block available. Validated by: `scripts/test_5k_people_parking.mjs`.
190. Check that the widest street determines the corner parking setback. Validated by: `scripts/test_5k_people_parking.mjs`.
191. Check that roundabouts do not offer legal parking stretches. Validated by: `scripts/test_5k_people_parking.mjs`.
192. Check that upcoming traffic within the distance threshold holds a pull-out. Validated by: `scripts/test_5k_people_parking.mjs`.
193. Check that distant slow traffic permits the parked car to pull out. Validated by: `scripts/test_5k_people_parking.mjs`.
194. Check that a committed traffic parker signals right and drops its indicator when released. Validated by: `scripts/test_5k_people_parking.mjs`.
195. Check that moving off before finishing the look cancels the remembered stop. Validated by: `scripts/test_5k_people_crossings.mjs`.
196. Check that crosswalk auditing can include a recently passed vehicle that the forward search omits. Validated by: `scripts/test_5k_people_crossings.mjs`.
197. Check that a bicycle does not occlude a pedestrian even when its test body spans all sightlines. Validated by: `scripts/test_5k_people_crossings.mjs`.
198. Check that insufficient longitudinal room returns the shortest feasible two-arc displacement. Validated by: `scripts/test_5k_people_parking.mjs`.
199. Check that a parking move can bring an already overhanging tyre back toward the asphalt. Validated by: `scripts/test_5k_people_parking.mjs`.
200. Check that departure preserves a reservation that changed hands while the ego was parked. Validated by: `scripts/test_5k_people_parking.mjs`.
