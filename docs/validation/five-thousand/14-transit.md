# Transit, rail and emergency vehicles

The shared transit and emergency helpers now handle incomplete geometry and invalid actor state. The offline layer audit reports data paths and network totals for bundled or custom maps. Run it with `node --experimental-default-type=module scripts/audit_transit_layers.mjs --help`.

1. Ignore orphan and malformed adjoining roads when calculating rear clearance at a transit stop. Validated by: `scripts/test_5k_transit_road.mjs`.
2. Reject a transit stop sign assigned outside its edge. Validated by: `scripts/test_5k_transit_road.mjs`.
3. Reject a transit stop placement with an invalid vehicle length. Validated by: `scripts/test_5k_transit_road.mjs`.
4. Use the recorded street length if its cumulative distances are empty. Validated by: `scripts/test_5k_transit_road.mjs`.
5. Place a transit stop when a control object has no stop line. Validated by: `scripts/test_5k_transit_road.mjs`.
6. Keep a curb shift at the lane centre when the mapped offsets or asphalt edge are missing. Validated by: `scripts/test_5k_transit_road.mjs`.
7. Reject invalid vehicle widths before calculating curb shifts. Validated by: `scripts/test_5k_transit_road.mjs`.
8. Bound bus heading normalization so corrupted headings cannot hang a yield query. Validated by: `scripts/test_5k_transit_road.mjs`.
9. Use bus dimensions when an authored coach omits a vehicle spec. Validated by: `scripts/test_5k_transit_road.mjs`.
10. Return no bus relation when the local coordinates are nonfinite. Validated by: `scripts/test_5k_transit_road.mjs`.
11. Require a valid positive road speed limit for a bus to have right of way. Validated by: `scripts/test_5k_transit_road.mjs`.
12. Require a valid indicator timer before a bus can pull out. Validated by: `scripts/test_5k_transit_road.mjs`.
13. Hold the bus at the kerb if a target-lane driver's speed is unknown. Validated by: `scripts/test_5k_transit_road.mjs`.
14. Reject reserved lane indices that the current bus edge cannot accommodate. Validated by: `scripts/test_5k_transit_road.mjs`.
15. Use a single heading classification for school-bus route holds and audit relations. Validated by: `scripts/test_5k_transit_road.mjs`.
16. Check that a school-bus hold has matching path coordinates and distances. Validated by: `scripts/test_5k_transit_road.mjs`.
17. Reject invalid school-bus poses at the shared route-hold entry point. Validated by: `scripts/test_5k_transit_road.mjs`.
18. Keep nonfinite local geometry out of school-bus audit relations. Validated by: `scripts/test_5k_transit_road.mjs`.
19. Rule out school-bus stops on streets with an unknown speed limit. Validated by: `scripts/test_5k_transit_road.mjs`.
20. Omit corrupt crosswalk positions from the school-bus exclusion search. Validated by: `scripts/test_5k_transit_road.mjs`.
21. Allow a school-bus stop range with no crosswalk exclusions supplied. Validated by: `scripts/test_5k_transit_road.mjs`.
22. Validate school-bus stop range bounds before searching. Validated by: `scripts/test_5k_transit_road.mjs`.
23. Reject a streetcar hold on a path with inconsistent cumulative distances. Validated by: `scripts/test_5k_transit_road.mjs`.
24. Discard nonfinite heading or local position in streetcar audit relations. Validated by: `scripts/test_5k_transit_road.mjs`.
25. Reject an infinite approach speed in the shared transit stopping-feasibility tests. Validated by: `scripts/test_5k_transit_road.mjs`.
26. Skip tracks that lack a traversable polyline. Validated by: `scripts/test_5k_transit_rail.mjs`.
27. Use terminus defaults when a track has no end metadata. Validated by: `scripts/test_5k_transit_rail.mjs`.
28. Extend clipped track ends using the nearest distinct vertex. Validated by: `scripts/test_5k_transit_rail.mjs`.
29. Skip nonfinite station records without discarding the rest of a track. Validated by: `scripts/test_5k_transit_rail.mjs`.
30. Ignore invalid street reference angles without losing the rest of the crossing. Validated by: `scripts/test_5k_transit_rail.mjs`.
31. Avoid spreading every road approach into the crossing width calculation. Validated by: `scripts/test_5k_transit_rail.mjs`.
32. Check path and distance alignment before searching for a track intersection. Validated by: `scripts/test_5k_transit_rail.mjs`.
33. Require train body dimensions before calculating a crossing approach. Validated by: `scripts/test_5k_transit_rail.mjs`.
34. Require a valid train direction for crossing approach classification. Validated by: `scripts/test_5k_transit_rail.mjs`.
35. Reject an invalid crossing envelope before calculating train arrival. Validated by: `scripts/test_5k_transit_rail.mjs`.
36. Keep an unmeasurable train speed out of the arrival-time comparison. Validated by: `scripts/test_5k_transit_rail.mjs`.
37. Skip invalid queue actors when determining room beyond a crossing. Validated by: `scripts/test_5k_transit_rail.mjs`.
38. Allow crossing holds before the actor lists have been populated. Validated by: `scripts/test_5k_transit_rail.mjs`.
39. Reject a negative or nonfinite train timestep before updating state. Validated by: `scripts/test_5k_transit_rail.mjs`.
40. Place a train at equilibrium on a zero-duration tick without poisoning its speed or acceleration. Validated by: `scripts/test_5k_transit_rail.mjs`.
41. Check that a crossing has an indexed track before querying an actor for its body. Validated by: `scripts/test_5k_transit_rail.mjs`.
42. Reject infinite speed when testing braking room at a level crossing. Validated by: `scripts/test_5k_transit_rail.mjs`.
43. Only grant new emergency drive-on authorization while the siren is active. Validated by: `scripts/test_5k_transit_emergency.mjs`.
44. Exclude invalid blockage durations from emergency drive-on evidence. Validated by: `scripts/test_5k_transit_emergency.mjs`.
45. Return to the lane centre when a passing offset cannot be read from the road geometry. Validated by: `scripts/test_5k_transit_emergency.mjs`.
46. Fail an emergency passing-gap search on malformed obstacle spans. Validated by: `scripts/test_5k_transit_emergency.mjs`.
47. Use the preferred passing line directly if it already clears the surrounding traffic. Validated by: `scripts/test_5k_transit_emergency.mjs`.
48. Keep the ordinary lane pull-over target when the parking edge is missing. Validated by: `scripts/test_5k_transit_emergency.mjs`.
49. Preserve the parked index result when appending vehicles waiting to pull out. Validated by: `scripts/test_5k_transit_emergency.mjs`.
50. Reject invalid kerb query bounds before running the spatial lookup. Validated by: `scripts/test_5k_transit_emergency.mjs`.
51. Ignore kerb markers that have no physical body. Validated by: `scripts/test_5k_transit_emergency.mjs`.
52. Treat an empty set of driver probes as no siren call. Validated by: `scripts/test_5k_transit_emergency.mjs`.
53. Reject siren ETA calculations with nonfinite closing speeds. Validated by: `scripts/test_5k_transit_emergency.mjs`.
54. Reject an invalid emergency path search window. Validated by: `scripts/test_5k_transit_emergency.mjs`.
55. Skip missing or unusable path segments during siren projection. Validated by: `scripts/test_5k_transit_emergency.mjs`.
56. End a call search once the first zero ETA has been found. Validated by: `scripts/test_5k_transit_emergency.mjs`.
57. Ignore orphan edges and self loops in the emergency junction classification. Validated by: `scripts/test_5k_transit_emergency.mjs`.
58. Reject invalid dispatch destinations before looking up a lane. Validated by: `scripts/test_5k_transit_emergency.mjs`.
59. Ignore a stale predecessor edge when dispatching an emergency vehicle behind the driver. Validated by: `scripts/test_5k_transit_emergency.mjs`.
60. Ignore stale reverse-edge references when dispatching against the driver's direction. Validated by: `scripts/test_5k_transit_emergency.mjs`.
61. Identify malformed lists by field path in the offline layer audit. Validated by: `scripts/test_5k_transit_layers.mjs`.
62. Flag an explicit lane on a bus run because the simulation selects its lane. Validated by: `scripts/test_5k_transit_layers.mjs`.
63. Report a road-to-rail crossing angle outside the mapped range. Validated by: `scripts/test_5k_transit_layers.mjs`.
64. Identify a non-boolean rail crossing control flag. Validated by: `scripts/test_5k_transit_layers.mjs`.
65. Diagnose rail crossings whose arc length exceeds their assigned track. Validated by: `scripts/test_5k_transit_layers.mjs`.
66. Point out crossing streets missing from the associated road pack. Validated by: `scripts/test_5k_transit_layers.mjs`.
67. Report out-of-range heading metadata at a rail crossing. Validated by: `scripts/test_5k_transit_layers.mjs`.
68. Identify crossings with an empty road approach list. Validated by: `scripts/test_5k_transit_layers.mjs`.
69. Flag a mapped rail crossing beyond the road snap distance. Validated by: `scripts/test_5k_transit_layers.mjs`.
70. Identify disagreement between a crossing's coordinates and its rail arc length. Validated by: `scripts/test_5k_transit_layers.mjs`.
71. Flag nonfinite crossing coordinates. Validated by: `scripts/test_5k_transit_layers.mjs`.
72. Report an approach arc length outside the crossing street. Validated by: `scripts/test_5k_transit_layers.mjs`.
73. Detect a level crossing assigned to a roundabout ring. Validated by: `scripts/test_5k_transit_layers.mjs`.
74. Check the crossing's stored street position against its projection. Validated by: `scripts/test_5k_transit_layers.mjs`.
75. Detect an unknown track identifier on a crossing. Validated by: `scripts/test_5k_transit_layers.mjs`.
76. Detect duplicate crossing records within one track while allowing shared crossings across tracks. Validated by: `scripts/test_5k_transit_layers.mjs`.
77. Detect a duplicate street approach at one crossing. Validated by: `scripts/test_5k_transit_layers.mjs`.
78. Find duplicate route, station, track and sign identifiers with their original declaration paths. Validated by: `scripts/test_5k_transit_layers.mjs`.
79. Find duplicate stop placements at one position on a run. Validated by: `scripts/test_5k_transit_layers.mjs`.
80. Detect duplicate ordered edge sequences for the same public route. Validated by: `scripts/test_5k_transit_layers.mjs`.
81. Flag repeated consecutive points in track geometry. Validated by: `scripts/test_5k_transit_layers.mjs`.
82. Identify a route without any drivable run. Validated by: `scripts/test_5k_transit_layers.mjs`.
83. Identify a run without a starting edge. Validated by: `scripts/test_5k_transit_layers.mjs`.
84. Report empty identifiers at their layer field path. Validated by: `scripts/test_5k_transit_layers.mjs`.
85. Distinguish a non-object layer from a malformed field within it. Validated by: `scripts/test_5k_transit_layers.mjs`.
86. Require the map name field in each layer header. Validated by: `scripts/test_5k_transit_layers.mjs`.
87. Report an unsupported transit or rail layer version. Validated by: `scripts/test_5k_transit_layers.mjs`.
88. Identify a stop whose road is absent from its run. Validated by: `scripts/test_5k_transit_layers.mjs`.
89. Report malformed list entries by index and keep checking the remaining entries. Validated by: `scripts/test_5k_transit_layers.mjs`.
90. Flag an invalid optional transit colour. Validated by: `scripts/test_5k_transit_layers.mjs`.
91. Diagnose an unsupported transit mode. Validated by: `scripts/test_5k_transit_layers.mjs`.
92. Flag missing passenger-facing route names. Validated by: `scripts/test_5k_transit_layers.mjs`.
93. Flag a missing public route reference. Validated by: `scripts/test_5k_transit_layers.mjs`.
94. Identify the broken edge join in a disconnected transit run. Validated by: `scripts/test_5k_transit_layers.mjs`.
95. Name a missing road reference in a run and continue auditing subsequent edges. Validated by: `scripts/test_5k_transit_layers.mjs`.
96. Report nonpositive or nonfinite route lengths. Validated by: `scripts/test_5k_transit_layers.mjs`.
97. Give the recomputed distance when a transit run's recorded length disagrees with its streets. Validated by: `scripts/test_5k_transit_layers.mjs`.
98. Report tracks with fewer than two vertices. Validated by: `scripts/test_5k_transit_layers.mjs`.
99. Identify stations that lie outside their track. Validated by: `scripts/test_5k_transit_layers.mjs`.
100. Require station names to be strings and accept unnamed stations. Validated by: `scripts/test_5k_transit_layers.mjs`.
101. Diagnose out-of-order stations without discarding the track. Validated by: `scripts/test_5k_transit_layers.mjs`.
102. Report the invalid arc length of a stop placement on an existing edge. Validated by: `scripts/test_5k_transit_layers.mjs`.
103. Flag stop signs unusually far from their mapped placements. Validated by: `scripts/test_5k_transit_layers.mjs`.
104. Identify invalid names on stop signs. Validated by: `scripts/test_5k_transit_layers.mjs`.
105. Flag stop placements too near the end of a transit run. Validated by: `scripts/test_5k_transit_layers.mjs`.
106. Identify a stop placed before its predecessor in the run. Validated by: `scripts/test_5k_transit_layers.mjs`.
107. Identify stop signs with nonfinite coordinates. Validated by: `scripts/test_5k_transit_layers.mjs`.
108. Report a referenced street with an invalid length. Validated by: `scripts/test_5k_transit_layers.mjs`.
109. Reject a nonsensical street pack before trying to index it. Validated by: `scripts/test_5k_transit_layers.mjs`.
110. Recognize a track whose vertices cover no distance. Validated by: `scripts/test_5k_transit_layers.mjs`.
111. Report malformed track end states. Validated by: `scripts/test_5k_transit_layers.mjs`.
112. Report unsupported railway types. Validated by: `scripts/test_5k_transit_layers.mjs`.
113. Report missing or invalid track lengths. Validated by: `scripts/test_5k_transit_layers.mjs`.
114. Quantify disagreement between track length and rounded polyline geometry. Validated by: `scripts/test_5k_transit_layers.mjs`.
115. Flag a non-string track name. Validated by: `scripts/test_5k_transit_layers.mjs`.
116. Identify an unreferenced track with no level crossing. Validated by: `scripts/test_5k_transit_layers.mjs`.
117. Require an operator string on a rail track. Validated by: `scripts/test_5k_transit_layers.mjs`.
118. Pinpoint malformed coordinates on a rail polyline. Validated by: `scripts/test_5k_transit_layers.mjs`.
119. Require a railway usage string. Validated by: `scripts/test_5k_transit_layers.mjs`.
120. Require tram runs to supply a nonnegative lane index. Validated by: `scripts/test_5k_transit_layers.mjs`.
121. Identify the street edge where a tram run will have its lane clamped. Validated by: `scripts/test_5k_transit_layers.mjs`.
122. Find a run placement with no corresponding stop sign. Validated by: `scripts/test_5k_transit_layers.mjs`.
123. Flag a sign unused by all runs. Validated by: `scripts/test_5k_transit_layers.mjs`.
124. Separate a wrong-map layer from other data problems. Validated by: `scripts/test_5k_transit_layers.mjs`.
125. Find the next matching edge occurrence when assessing stop order on a looped run. Validated by: `scripts/test_5k_transit_layers.mjs`.
126. Show distinct counts for stop signs and their repeated placements. Validated by: `scripts/test_5k_transit_layers.mjs`.
127. Summarize mapped bus and streetcar kilometres separately. Validated by: `scripts/test_5k_transit_layers.mjs`.
128. Check all bundled maps in one offline command. Validated by: `scripts/test_5k_transit_layers.mjs`.
129. Inspect a selected list of bundled maps in the user's order. Validated by: `scripts/test_5k_transit_layers.mjs`.
130. Inspect a transit layer paired with a custom street pack. Validated by: `scripts/test_5k_transit_layers.mjs`.
131. Inspect a standalone rail layer paired with a custom street pack. Validated by: `scripts/test_5k_transit_layers.mjs`.
132. Provide structured diagnostics on stdout for automation. Validated by: `scripts/test_5k_transit_layers.mjs`.
133. Support a stricter invocation that fails on warnings. Validated by: `scripts/test_5k_transit_layers.mjs`.
134. Use a different exit code for unreadable inputs and audit failures. Validated by: `scripts/test_5k_transit_layers.mjs`.
135. Give available bundled map names when a selection is unknown. Validated by: `scripts/test_5k_transit_layers.mjs`.
136. Report input selection errors before reading mismatched custom files. Validated by: `scripts/test_5k_transit_layers.mjs`.
137. Cover a bus stop exactly half a metre behind a control line. Validated by: `scripts/test_5k_transit_road.mjs`.
138. Cover reuse of a map's cached bus parking exclusions. Validated by: `scripts/test_5k_transit_road.mjs`.
139. Check that a parking exclusion covers the body of a stopped bus and both added margins. Validated by: `scripts/test_5k_transit_road.mjs`.
140. Check that an inside-lane or roundabout bus keeps its lane centre. Validated by: `scripts/test_5k_transit_road.mjs`.
141. Pin down the rearward extent of bus relation sensing. Validated by: `scripts/test_5k_transit_road.mjs`.
142. Verify the projected gap for drivers with a nonstandard bumper overhang. Validated by: `scripts/test_5k_transit_road.mjs`.
143. Cover the inclusive speed threshold for transit-bus priority. Validated by: `scripts/test_5k_transit_road.mjs`.
144. Verify a moving driver on a fast road cannot waive the minimum gap by yielding. Validated by: `scripts/test_5k_transit_road.mjs`.
145. Cover braking and explicit yield decisions as separate discharge signals for a close driver. Validated by: `scripts/test_5k_transit_road.mjs`.
146. Ensure a stationary, overlapping driver still blocks the bus's pull-out. Validated by: `scripts/test_5k_transit_road.mjs`.
147. Cover the rear-bumper buffer and signal phase in bus yield targets. Validated by: `scripts/test_5k_transit_road.mjs`.
148. Check that opposing school-bus approaches target different ends of the bus. Validated by: `scripts/test_5k_transit_road.mjs`.
149. Compare school-bus stop sensing against the audit frame on a straight approach. Validated by: `scripts/test_5k_transit_road.mjs`.
150. Check perpendicular school-bus headings are outside the hold. Validated by: `scripts/test_5k_transit_road.mjs`.
151. Pin down the school-bus lateral corridor limit. Validated by: `scripts/test_5k_transit_road.mjs`.
152. Verify the school-bus hold drops once the driver's front reaches the near end. Validated by: `scripts/test_5k_transit_road.mjs`.
153. Keep a later loop-back from reintroducing a passed school bus. Validated by: `scripts/test_5k_transit_road.mjs`.
154. Check that duplicate path vertices do not hide a school bus farther ahead. Validated by: `scripts/test_5k_transit_road.mjs`.
155. Cover first-stop search across unsorted overlapping crosswalk exclusions. Validated by: `scripts/test_5k_transit_road.mjs`.
156. Verify that school-bus stopping can resume exactly at an exclusion endpoint. Validated by: `scripts/test_5k_transit_road.mjs`.
157. Cover the shortest street that fails school-bus clearance on both sides. Validated by: `scripts/test_5k_transit_road.mjs`.
158. Check that the stop line shortens a school-bus stop range. Validated by: `scripts/test_5k_transit_road.mjs`.
159. Check the different streetcar stop targets in the track lane and the curb lane. Validated by: `scripts/test_5k_transit_road.mjs`.
160. Check the curb-lane release point at the rear doors. Validated by: `scripts/test_5k_transit_road.mjs`.
161. Check that overshooting the streetcar stop target still requires waiting short of the doors. Validated by: `scripts/test_5k_transit_road.mjs`.
162. Cover the maximum projected streetcar lookahead. Validated by: `scripts/test_5k_transit_road.mjs`.
163. Verify the position and order of curb-side streetcar doors. Validated by: `scripts/test_5k_transit_road.mjs`.
164. Verify that rotating a streetcar rotates its door offsets. Validated by: `scripts/test_5k_transit_road.mjs`.
165. Compare streetcar sensing and auditing in the curb lane. Validated by: `scripts/test_5k_transit_road.mjs`.
166. Test that opposite-direction drivers are outside the streetcar hold. Validated by: `scripts/test_5k_transit_road.mjs`.
167. Cover the reuse of an indexed rail layer for a map. Validated by: `scripts/test_5k_transit_rail.mjs`.
168. Verify that indexing shifts stops and crossings without mutating the source layer. Validated by: `scripts/test_5k_transit_rail.mjs`.
169. Verify the local rail geometry used on either side of a crossing. Validated by: `scripts/test_5k_transit_rail.mjs`.
170. Check the along-track sort order used for successive crossings. Validated by: `scripts/test_5k_transit_rail.mjs`.
171. Cover the moment an arriving train touches the crossing at zero ETA. Validated by: `scripts/test_5k_transit_rail.mjs`.
172. Pin down the train rear-bumper boundary for releasing a crossing. Validated by: `scripts/test_5k_transit_rail.mjs`.
173. Cover the strict moving threshold and inclusive approach range. Validated by: `scripts/test_5k_transit_rail.mjs`.
174. Cover the minimum divisor for a train ETA at a crawl. Validated by: `scripts/test_5k_transit_rail.mjs`.
175. Verify that gone trains and trains on another track are ignored. Validated by: `scripts/test_5k_transit_rail.mjs`.
176. Compare train ETAs across both directions of travel. Validated by: `scripts/test_5k_transit_rail.mjs`.
177. Verify stable train selection when two arrival estimates tie. Validated by: `scripts/test_5k_transit_rail.mjs`.
178. Cover crossing intersections exactly at a search window endpoint. Validated by: `scripts/test_5k_transit_rail.mjs`.
179. Verify that a parallel path segment does not prevent examining the next segment. Validated by: `scripts/test_5k_transit_rail.mjs`.
180. Check that the calculated crossing angle stays acute in both road directions. Validated by: `scripts/test_5k_transit_rail.mjs`.
181. Verify that multiple crossings are ordered along the driver's road. Validated by: `scripts/test_5k_transit_rail.mjs`.
182. Check that a crawling driver just past its target can still hold short of the envelope. Validated by: `scripts/test_5k_transit_rail.mjs`.
183. Ensure a driver already fouling the track continues across. Validated by: `scripts/test_5k_transit_rail.mjs`.
184. Cover the release of the room rule for a quickly departing queue. Validated by: `scripts/test_5k_transit_rail.mjs`.
185. Check that the nearest rear bumper selects the queue blocker. Validated by: `scripts/test_5k_transit_rail.mjs`.
186. Distinguish cross traffic on the envelope from cross traffic past it. Validated by: `scripts/test_5k_transit_rail.mjs`.
187. Check that a required train stop takes priority over a room stop. Validated by: `scripts/test_5k_transit_rail.mjs`.
188. Cover a room stop even when the train's stop is not owed. Validated by: `scripts/test_5k_transit_rail.mjs`.
189. Compare crossing width across several mapped roads meeting the track. Validated by: `scripts/test_5k_transit_rail.mjs`.
190. Cover clamping the emergency path projection at either end of its search interval. Validated by: `scripts/test_5k_transit_emergency.mjs`.
191. Check stable projection choice at equal distance from two parts of an emergency route. Validated by: `scripts/test_5k_transit_emergency.mjs`.
192. Cover the exact siren hearing radius. Validated by: `scripts/test_5k_transit_emergency.mjs`.
193. Check side and oncoming siren classifications from the driver's heading. Validated by: `scripts/test_5k_transit_emergency.mjs`.
194. Cover selection of the nearest emergency call by ETA and preserve equal-ETA order. Validated by: `scripts/test_5k_transit_emergency.mjs`.
195. Verify an unrelated stationary car does not grant drive-on authorization. Validated by: `scripts/test_5k_transit_emergency.mjs`.
196. Verify that a lead is granted only after the full emergency blockage threshold. Validated by: `scripts/test_5k_transit_emergency.mjs`.
197. Verify a driver heading across the emergency vehicle cannot become its lead. Validated by: `scripts/test_5k_transit_emergency.mjs`.
198. Cover stable side choice when there is equal passing room on both sides. Validated by: `scripts/test_5k_transit_emergency.mjs`.
199. Ensure roundabout pull-overs stay in the travel lane. Validated by: `scripts/test_5k_transit_emergency.mjs`.
200. Check that a vehicle on the left does not reduce the available pull-over room on the right. Validated by: `scripts/test_5k_transit_emergency.mjs`.
