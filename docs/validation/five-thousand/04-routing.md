# Routing and map geometry

The router and browser map now diagnose malformed inputs, bound spatial searches, and handle degenerate geometry. The map inspector reports optional layer problems by field and the parity fixtures cover more turn and lane-join boundaries.

1. Reject nonfinite Python headings before angle wrapping. Validated by: `tests/test_5k_routing_inputs.py`.
2. Bound the cost of wrapping a large finite Python heading. Validated by: `tests/test_5k_routing_inputs.py`.
3. Reject undefined angles in Python turn classification. Validated by: `tests/test_5k_routing_inputs.py`.
4. Give empty Python point interpolation an explicit error. Validated by: `tests/test_5k_routing_inputs.py`.
5. Reject an undefined Python interpolation distance instead of extrapolating NaNs. Validated by: `tests/test_5k_routing_inputs.py`.
6. Give empty Python heading interpolation an explicit error. Validated by: `tests/test_5k_routing_inputs.py`.
7. Reject an undefined Python heading distance instead of selecting an arbitrary segment. Validated by: `tests/test_5k_routing_inputs.py`.
8. Give a single-point Python polyline a neutral heading. Validated by: `tests/test_5k_routing_inputs.py`.
9. Report that projecting onto an empty Python polyline has no target. Validated by: `tests/test_5k_routing_inputs.py`.
10. Reject nonfinite Python projection coordinates. Validated by: `tests/test_5k_routing_inputs.py`.
11. Project onto a single Python point with a measured distance and neutral lateral offset. Validated by: `tests/test_5k_routing_inputs.py`.
12. Validate supplied Python arc-length table sizes before locating segments. Validated by: `tests/test_5k_routing_inputs.py`.
13. Reject invalid simplification tolerances. Validated by: `tests/test_5k_routing_inputs.py`.
14. Reject nonfinite Python polyline offsets. Validated by: `tests/test_5k_routing_inputs.py`.
15. Require a usable radius for Python fillets. Validated by: `tests/test_5k_routing_inputs.py`.
16. Require a positive whole number of Python fillet steps. Validated by: `tests/test_5k_routing_inputs.py`.
17. Reject invalid resampling steps before walking arc length. Validated by: `tests/test_5k_routing_inputs.py`.
18. Reject a nonfinite length before resampling. Validated by: `tests/test_5k_routing_inputs.py`.
19. Detect resampling increments too small to reach the end in floating point. Validated by: `tests/test_5k_routing_inputs.py`.
20. Validate consecutive-point deduplication tolerances. Validated by: `tests/test_5k_routing_inputs.py`.
21. Reject a non-object routing pack with a constructor error. Validated by: `tests/test_5k_routing_inputs.py`.
22. Identify malformed Python road records at their source index. Validated by: `tests/test_5k_routing_inputs.py`.
23. Identify malformed Python lane records at their source index. Validated by: `tests/test_5k_routing_inputs.py`.
24. Reject duplicate Python graph edge IDs before building adjacency. Validated by: `tests/test_5k_routing_inputs.py`.
25. Validate the directed endpoints of Python roads before indexing successors. Validated by: `tests/test_5k_routing_inputs.py`.
26. Require usable Python edge centreline geometry. Validated by: `tests/test_5k_routing_inputs.py`.
27. Reject nonfinite cumulative Python edge geometry. Validated by: `tests/test_5k_routing_inputs.py`.
28. Reject corrupt declared Python road lengths. Validated by: `tests/test_5k_routing_inputs.py`.
29. Reject invalid speed limits before calculating Python travel times. Validated by: `tests/test_5k_routing_inputs.py`.
30. Identify invalid Python road lane counts at pack load. Validated by: `tests/test_5k_routing_inputs.py`.
31. Reject a non-text street name before formatting a route summary. Validated by: `tests/test_5k_routing_inputs.py`.
32. Reject a Python lane that references an unknown road. Validated by: `tests/test_5k_routing_inputs.py`.
33. Validate Python lane ordinals against the declared road lane count. Validated by: `tests/test_5k_routing_inputs.py`.
34. Reject duplicate Python lane ordinals before snapping. Validated by: `tests/test_5k_routing_inputs.py`.
35. Require usable geometry for a Python lane and identify its road in errors. Validated by: `tests/test_5k_routing_inputs.py`.
36. Guard the Python lane index against unrepresentable subdivision counts. Validated by: `tests/test_5k_routing_inputs.py`.
37. Validate the shape of Python restriction rows before indexing movements. Validated by: `tests/test_5k_routing_inputs.py`.
38. Report an invalid Python restriction source before looking up the road. Validated by: `tests/test_5k_routing_inputs.py`.
39. Report a malformed Python restriction target list before indexing movements. Validated by: `tests/test_5k_routing_inputs.py`.
40. Report an unknown Python restriction kind instead of treating it as a turn ban. Validated by: `tests/test_5k_routing_inputs.py`.
41. Reuse the empty restriction source for packs without a restriction layer. Validated by: `tests/test_5k_routing_inputs.py`.
42. Return an empty successor list for an unknown Python road. Validated by: `tests/test_5k_routing_inputs.py`.
43. Compute the Python angle once when pricing a sharp turn. Validated by: `tests/test_5k_routing_inputs.py`.
44. Use occupied Python grid cells to bound the work of very large snapping windows. Validated by: `tests/test_5k_routing_inputs.py`.
45. Reject malformed Python snap coordinates before computing grid keys. Validated by: `tests/test_5k_routing_inputs.py`.
46. Validate the Python snap radius. Validated by: `tests/test_5k_routing_inputs.py`.
47. Validate the Python snap heading tolerance. Validated by: `tests/test_5k_routing_inputs.py`.
48. Reject invalid Python snap headings before evaluating direction. Validated by: `tests/test_5k_routing_inputs.py`.
49. Validate Python destination coordinates before candidate enumeration. Validated by: `tests/test_5k_routing_inputs.py`.
50. Validate the Python destination search radius. Validated by: `tests/test_5k_routing_inputs.py`.
51. Validate the Python destination slack around the closest lane. Validated by: `tests/test_5k_routing_inputs.py`.
52. Avoid reprojecting every Python lane when a heading falls back to distance. Validated by: `tests/test_5k_routing_inputs.py`.
53. Report an unknown Python search start edge directly. Validated by: `tests/test_5k_routing_inputs.py`.
54. Report an unknown Python search goal edge directly. Validated by: `tests/test_5k_routing_inputs.py`.
55. Validate the Python search start distance before computing remaining travel time. Validated by: `tests/test_5k_routing_inputs.py`.
56. Validate the Python search goal distance before computing the heuristic. Validated by: `tests/test_5k_routing_inputs.py`.
57. Require a mapping for Python alternative-route costs. Validated by: `tests/test_5k_routing_inputs.py`.
58. Validate the edge keys and nonnegative multipliers in Python alternative-route costs. Validated by: `tests/test_5k_routing_inputs.py`.
59. Report malformed from and to objects and name an invalid coordinate in Python route requests. Validated by: `tests/test_5k_routing_inputs.py`.
60. Validate the requested Python route count. Validated by: `tests/test_5k_routing_inputs.py`.
61. Return an empty Python route request without snapping when zero routes are requested. Validated by: `tests/test_5k_routing_inputs.py`.
62. Validate the restriction switch on Python routing calls. Validated by: `tests/test_5k_routing_inputs.py`.
63. Validate the Python routing clock hour. Validated by: `tests/test_5k_routing_inputs.py`.
64. Validate the Python routing weekday. Validated by: `tests/test_5k_routing_inputs.py`.
65. Reject an invalid Python avoidance collection before treating its entries as road IDs. Validated by: `tests/test_5k_routing_inputs.py`.
66. Skip a Python destination snap when the start cannot be matched. Validated by: `tests/test_5k_routing_inputs.py`.
67. Require a nonempty Python edge chain before constructing route geometry. Validated by: `tests/test_5k_routing_inputs.py`.
68. Report an unknown Python road in a route geometry chain. Validated by: `tests/test_5k_routing_inputs.py`.
69. Validate the start and goal snap data before slicing Python route geometry. Validated by: `tests/test_5k_routing_inputs.py`.
70. Report a missing selected Python lane with its ordinal and road. Validated by: `tests/test_5k_routing_inputs.py`.
71. Choose the Python lane indices once for geometry and response metadata. Validated by: `tests/test_5k_routing_inputs.py`.
72. Find the interior Python slice boundaries by arc-length search. Validated by: `tests/test_5k_routing_inputs.py`.
73. Validate browser routing start poses and their finite coordinates. Validated by: `scripts/test_5k_routing_geometry.mjs`.
74. Validate browser routing destination poses and their finite coordinates. Validated by: `scripts/test_5k_routing_geometry.mjs`.
75. Reject invalid browser routing headings explicitly. Validated by: `scripts/test_5k_routing_geometry.mjs`.
76. Report invalid browser routing options as an object error. Validated by: `scripts/test_5k_routing_geometry.mjs`.
77. Require a boolean browser restriction toggle. Validated by: `scripts/test_5k_routing_geometry.mjs`.
78. Require a finite browser clock hour. Validated by: `scripts/test_5k_routing_geometry.mjs`.
79. Require a whole browser routing weekday. Validated by: `scripts/test_5k_routing_geometry.mjs`.
80. Reject invalid browser avoidance lists instead of treating strings as sets of letters. Validated by: `scripts/test_5k_routing_geometry.mjs`.
81. Explain an empty browser route lane chain. Validated by: `scripts/test_5k_routing_geometry.mjs`.
82. Validate browser lane-chain start and goal distances before slicing. Validated by: `scripts/test_5k_routing_geometry.mjs`.
83. Identify the position of a missing browser route lane. Validated by: `scripts/test_5k_routing_geometry.mjs`.
84. Identify a browser route lane with no geometry. Validated by: `scripts/test_5k_routing_geometry.mjs`.
85. Detect a stale arc-length array on a browser route lane. Validated by: `scripts/test_5k_routing_geometry.mjs`.
86. Report a missing browser lane edge reference before building turn instructions. Validated by: `scripts/test_5k_routing_geometry.mjs`.
87. Measure cumulative joined length for browser turn instructions only when a turn is emitted. Validated by: `scripts/test_5k_routing_geometry.mjs`.
88. Reject browser routes too long for one-metre resampling to finish. Validated by: `scripts/test_5k_routing_geometry.mjs`.
89. Skip the browser goal snap if its start cannot be matched. Validated by: `scripts/test_5k_routing_geometry.mjs`.
90. Stop the browser predecessor walk at a missing predecessor. Validated by: `scripts/test_5k_routing_geometry.mjs`.
91. Reconstruct browser predecessor chains by reversing once instead of shifting every accumulated edge. Validated by: `scripts/test_5k_routing_geometry.mjs`.
92. Return no browser route when a required turn lane is absent. Validated by: `scripts/test_5k_routing_geometry.mjs`.
93. Check malformed saved-route objects before building browser geometry. Validated by: `scripts/test_5k_routing_geometry.mjs`.
94. Require a nonempty saved-route polyline in the browser. Validated by: `scripts/test_5k_routing_geometry.mjs`.
95. Identify a corrupt saved-route point by its index. Validated by: `scripts/test_5k_routing_geometry.mjs`.
96. Reject a saved-route polyline with overflowing length. Validated by: `scripts/test_5k_routing_geometry.mjs`.
97. Require an edge list in saved browser routes. Validated by: `scripts/test_5k_routing_geometry.mjs`.
98. Report the missing road ID when a browser route references an unavailable road. Validated by: `scripts/test_5k_routing_geometry.mjs`.
99. Validate saved browser start distances before computing edge marks. Validated by: `scripts/test_5k_routing_geometry.mjs`.
100. Validate saved browser destination distances before locating route controls. Validated by: `scripts/test_5k_routing_geometry.mjs`.
101. Reject a malformed browser turn list up front. Validated by: `scripts/test_5k_routing_geometry.mjs`.
102. Report the browser turn missing its direction. Validated by: `scripts/test_5k_routing_geometry.mjs`.
103. Report the browser turn with an invalid route distance. Validated by: `scripts/test_5k_routing_geometry.mjs`.
104. Accept legacy browser routes without a turn list as routes with no turn instructions. Validated by: `scripts/test_5k_routing_geometry.mjs`.
105. Keep the saved U-turn distance when a browser route has no edge transition to locate it on. Validated by: `scripts/test_5k_routing_geometry.mjs`.
106. Return no offset point for an undefined browser arc length or lateral offset. Validated by: `scripts/test_5k_routing_geometry.mjs`.
107. Reject invalid lateral acceleration before calculating a browser curve speed. Validated by: `scripts/test_5k_routing_geometry.mjs`.
108. Ignore malformed numeric bounding boxes in the browser right-on-red lookup. Validated by: `scripts/test_5k_routing_geometry.mjs`.
109. Stop nonfinite browser headings from stalling angle wrapping. Validated by: `scripts/test_5k_routing_geometry.mjs`.
110. Keep browser wrapping work bounded for very large finite angles. Validated by: `scripts/test_5k_routing_geometry.mjs`.
111. Return no browser point for an empty line, mismatched arc lengths or an undefined interpolation distance. Validated by: `scripts/test_5k_routing_geometry.mjs`.
112. Use a neutral browser heading at a one-point line. Validated by: `scripts/test_5k_routing_geometry.mjs`.
113. Project onto a single browser point and retain its distance and neutral lateral offset. Validated by: `scripts/test_5k_routing_geometry.mjs`.
114. Return no browser projection for invalid coordinates or a mismatched arc-length table. Validated by: `scripts/test_5k_routing_geometry.mjs`.
115. Perform a full browser projection when a hint cannot name a valid segment. Validated by: `scripts/test_5k_routing_geometry.mjs`.
116. Validate the browser lane-join corner radius. Validated by: `scripts/test_5k_routing_geometry.mjs`.
117. Validate the browser lane-join blending distance. Validated by: `scripts/test_5k_routing_geometry.mjs`.
118. Return no street membership for a vehicle without a finite heading. Validated by: `scripts/test_5k_routing_geometry.mjs`.
119. Reject nonfinite junction-fill probes without building the fill index. Validated by: `scripts/test_5k_routing_geometry.mjs`.
120. Return no building bounding rectangle for incomplete or corrupt point data. Validated by: `scripts/test_5k_routing_geometry.mjs`.
121. Skip corrupt building footprints without losing later buildings. Validated by: `scripts/test_5k_routing_geometry.mjs`.
122. Skip buildings with an unusable height. Validated by: `scripts/test_5k_routing_geometry.mjs`.
123. Skip footprints whose signed area overflows. Validated by: `scripts/test_5k_routing_geometry.mjs`.
124. Expose map pack diagnostics with field paths and expected values without constructing a map. Validated by: `scripts/test_5k_routing_map.mjs`.
125. Explain missing or malformed graph collections before the browser indexes them. Validated by: `scripts/test_5k_routing_map.mjs`.
126. Report duplicate browser edge identifiers before indexing. Validated by: `scripts/test_5k_routing_map.mjs`.
127. Identify invalid projected node coordinates. Validated by: `scripts/test_5k_routing_map.mjs`.
128. Detect road references to undefined endpoint nodes. Validated by: `scripts/test_5k_routing_map.mjs`.
129. Identify malformed browser edge polylines before computing cumulative distance. Validated by: `scripts/test_5k_routing_map.mjs`.
130. Report unusable road lengths in browser diagnostics. Validated by: `scripts/test_5k_routing_map.mjs`.
131. Inspect the speed limit used to mark changes along a route. Validated by: `scripts/test_5k_routing_map.mjs`.
132. Inspect lane counts and the matching centreline offset table. Validated by: `scripts/test_5k_routing_map.mjs`.
133. Report reversed asphalt limits. Validated by: `scripts/test_5k_routing_map.mjs`.
134. Report an unusable declared lane width. Validated by: `scripts/test_5k_routing_map.mjs`.
135. Report lane references to missing browser roads. Validated by: `scripts/test_5k_routing_map.mjs`.
136. Report duplicate browser lane ordinals before one lane shadows another. Validated by: `scripts/test_5k_routing_map.mjs`.
137. Identify lane ordinals outside the road's lane count. Validated by: `scripts/test_5k_routing_map.mjs`.
138. Identify unusable lane polylines before spatial hashing. Validated by: `scripts/test_5k_routing_map.mjs`.
139. Reject lane segments whose map-grid subdivision count cannot be represented safely. Validated by: `scripts/test_5k_routing_map.mjs`.
140. Inspect geographic bounds, routing bounds and projected extents as ordered coordinates. Validated by: `scripts/test_5k_routing_map.mjs`.
141. Check the UTC offset used to choose the local map clock. Validated by: `scripts/test_5k_routing_map.mjs`.
142. Identify a malformed signal or stop list before the browser constructs control lookups. Validated by: `scripts/test_5k_routing_map.mjs`.
143. Report signal approaches assigned to nonexistent roads. Validated by: `scripts/test_5k_routing_map.mjs`.
144. Report malformed submitted signal phase groups. Validated by: `scripts/test_5k_routing_map.mjs`.
145. Check signal cycle durations and start offsets. Validated by: `scripts/test_5k_routing_map.mjs`.
146. Report malformed stop or yield approach distances. Validated by: `scripts/test_5k_routing_map.mjs`.
147. Check roundabout lane and outer radii against their enclosing radii. Validated by: `scripts/test_5k_routing_map.mjs`.
148. Report invalid road control kinds and identifiers. Validated by: `scripts/test_5k_routing_map.mjs`.
149. Inspect crosswalk coordinates and distance along their road. Validated by: `scripts/test_5k_routing_map.mjs`.
150. Identify a broken pedestrian refuge or crossover flag. Validated by: `scripts/test_5k_routing_map.mjs`.
151. Inspect the traffic-calming kind and its placement coordinates. Validated by: `scripts/test_5k_routing_map.mjs`.
152. Identify calming attachments that reference an absent road or invalid distance. Validated by: `scripts/test_5k_routing_map.mjs`.
153. Diagnose contraflow attached to a two-way street. Validated by: `scripts/test_5k_routing_map.mjs`.
154. Inspect the side and kind of a contraflow cycle facility. Validated by: `scripts/test_5k_routing_map.mjs`.
155. Inspect driveway placement and heading before generating a reversing vehicle. Validated by: `scripts/test_5k_routing_map.mjs`.
156. Report invalid driveway lengths. Validated by: `scripts/test_5k_routing_map.mjs`.
157. Identify bus-lane reservations pointing to nonexistent lane ordinals. Validated by: `scripts/test_5k_routing_map.mjs`.
158. Inspect scheduled bus-lane time windows, including overnight periods. Validated by: `scripts/test_5k_routing_map.mjs`.
159. Inspect the stored set of vehicles allowed in a reserved lane. Validated by: `scripts/test_5k_routing_map.mjs`.
160. Identify an unsupported school or playground zone kind. Validated by: `scripts/test_5k_routing_map.mjs`.
161. Report backwards road spans in school zones, park frontages and bridge layers. Validated by: `scripts/test_5k_routing_map.mjs`.
162. Inspect park or water area outlines and polylines. Validated by: `scripts/test_5k_routing_map.mjs`.
163. Identify a park frontage whose left or right area reference is missing. Validated by: `scripts/test_5k_routing_map.mjs`.
164. Report an unusable track centreline before rail distance calculations. Validated by: `scripts/test_5k_routing_map.mjs`.
165. Inspect track lengths, endpoint types and stop positions. Validated by: `scripts/test_5k_routing_map.mjs`.
166. Inspect invalid level-crossing warning flags. Validated by: `scripts/test_5k_routing_map.mjs`.
167. Inspect the rail-to-road crossing angle. Validated by: `scripts/test_5k_routing_map.mjs`.
168. Report malformed transit mode, line reference and colour metadata. Validated by: `scripts/test_5k_routing_map.mjs`.
169. Identify missing boarding positions before driving a transit run. Validated by: `scripts/test_5k_routing_map.mjs`.
170. Report malformed building polygons and nonpositive heights in map diagnostics. Validated by: `scripts/test_5k_routing_map.mjs`.
171. Skip malformed crossing rows while retaining pedestrian crossover classification. Validated by: `scripts/test_5k_routing_map.mjs`.
172. Skip malformed contraflow entries while indexing legitimate one-way cycle facilities. Validated by: `scripts/test_5k_routing_map.mjs`.
173. Skip malformed driveway rows when loading the map. Validated by: `scripts/test_5k_routing_map.mjs`.
174. Skip malformed park spans without dropping their neighbouring records. Validated by: `scripts/test_5k_routing_map.mjs`.
175. Skip malformed bridge spans without dropping valid spans. Validated by: `scripts/test_5k_routing_map.mjs`.
176. Filter missing calming attachments before indexing device positions. Validated by: `scripts/test_5k_routing_map.mjs`.
177. Return an empty browser lane search for invalid coordinates or radius. Validated by: `scripts/test_5k_routing_map.mjs`.
178. Bound sparse browser grid traversal while preserving cell order for ties. Validated by: `scripts/test_5k_routing_map.mjs`.
179. Return no browser lane match for an invalid direction filter. Validated by: `scripts/test_5k_routing_map.mjs`.
180. Return no browser successor edges when the road is absent. Validated by: `scripts/test_5k_routing_map.mjs`.
181. Return undefined headings for missing browser roads. Validated by: `scripts/test_5k_routing_map.mjs`.
182. Avoid classifying an undefined browser turn as a right turn. Validated by: `scripts/test_5k_routing_map.mjs`.
183. Omit missing approaches when deriving a browser junction's node set. Validated by: `scripts/test_5k_routing_map.mjs`.
184. Return no control record for a missing browser road. Validated by: `scripts/test_5k_routing_map.mjs`.
185. Report zero crossing width when the browser has no such road. Validated by: `scripts/test_5k_routing_map.mjs`.
186. Avoid repeating browser lane projections during a direction mismatch fallback. Validated by: `scripts/test_5k_routing_map.mjs`.
187. Check a negative turn just inside the straight classification threshold. Validated by: `tests/test_parity.py`.
188. Check a negative turn just outside the straight classification threshold. Validated by: `tests/test_parity.py`.
189. Check a right turn just below the U-turn classification threshold. Validated by: `tests/test_parity.py`.
190. Check a right turn just beyond the U-turn classification threshold. Validated by: `tests/test_parity.py`.
191. Check a near-straight left across the signed heading seam. Validated by: `tests/test_parity.py`.
192. Check a right turn crossing the signed heading seam. Validated by: `tests/test_parity.py`.
193. Check that both signs of west represent the same heading. Validated by: `tests/test_parity.py`.
194. Check an exact reversal across all three turn decisions. Validated by: `tests/test_parity.py`.
195. Cover a translated lane join from northbound to westbound with offset lines. Validated by: `tests/test_parity.py`.
196. Cover overlapping collinear lane ends in the same direction. Validated by: `tests/test_parity.py`.
197. Cover an offset blend with unequal lane lengths where the approach limits its trim. Validated by: `tests/test_parity.py`.
198. Cover a right turn approached through two collinear lane segments. Validated by: `tests/test_parity.py`.
199. Check measured turn angles against the fixture declarations in addition to checking implementation parity. Validated by: `tests/test_parity.py`.
200. Identify a collapsed lane join explicitly in the parity comparison. Validated by: `tests/test_parity.py`.
