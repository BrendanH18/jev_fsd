# Road traffic

Traffic lane, control and curb queries handle missing map records. The traffic fleet also exposes a read-only diagnostic report through `window.__jev.fleet.inspectTraffic()`. Pause a drive before collecting the report. Issue codes locate a vehicle, path sample, edge or queue entry without advancing the simulation.

1. Expose a read-only, JSON-serializable fleet inspection report with vehicle, path and queue locations. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
2. Report a vacant or malformed vehicle record and continue inspecting the fleet. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
3. Report a vacant or malformed all-way stop queue entry and continue inspecting the queue. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
4. Report a fleet detached from the world's obstacle and sensing list. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
5. Report a fleet whose routing map differs from its world's map. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
6. Report the driven car accidentally registered as background traffic. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
7. Report the same vehicle inserted into the step list twice. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
8. Report duplicated vehicle IDs that would collide in replay and rendering. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
9. Report a world time that cannot drive absolute traffic schedules. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
10. Report a non-integer tick that would corrupt queue age. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
11. Report an invalid car population target before curb departure tries to rebalance it. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
12. Report a corrupt pull-out sequence counter before it can produce unusable IDs. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
13. Report a non-finite pull-out countdown that can strand parked traffic. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
14. Report a non-finite curb-parking countdown that can disable parking attempts. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
15. Report a countdown that can suppress emergency dispatch indefinitely. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
16. Report an invalid bus replenishment deadline. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
17. Report an invalid streetcar replenishment deadline. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
18. Report an invalid school-bus replenishment deadline. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
19. Report an invalid train recovery deadline. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
20. Report an invalid plow replenishment deadline. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
21. Report an invalid bus population target. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
22. Report an invalid streetcar population target. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
23. Report an invalid school-bus population target. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
24. Report an invalid train population target. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
25. Report an invalid plow population target. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
26. Report missing or malformed traffic identifiers. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
27. Locate a vehicle with an invalid rear-axle position. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
28. Locate a vehicle whose heading cannot form a collision box. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
29. Locate a vehicle whose forward speed would poison approach estimates. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
30. Locate a vehicle with invalid lateral speed in the tire model. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
31. Locate a vehicle with an invalid yaw rate. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
32. Locate a non-finite steering actuator state. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
33. Locate a non-finite acceleration actuator state. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
34. Report an unsupported traffic indicator value. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
35. Report traffic missing the vehicle specification used in geometry. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
36. Report a vehicle length that cannot describe the body. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
37. Report a vehicle width that cannot define lateral clearance. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
38. Report a rear overhang that places the rear axle outside the usable body span. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
39. Report a path-following vehicle whose wheelbase cannot compute steering. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
40. Report a path-following vehicle without a usable braking limit. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
41. Report invalid desired speed before IDM divides by it. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
42. Identify an invalid freeze countdown that can immobilize a vehicle. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
43. Identify a stopped-time counter that would break deadlock recovery. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
44. Identify a corrupt reaction timer that can bypass driver hesitation. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
45. Identify a corrupt nose-to-nose wait timer. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
46. Identify a post-reverse hold that cannot expire. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
47. Identify a parking queue timer that can prevent a needed reverse. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
48. Report missing road-path state while allowing track-only actors. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
49. Report a parked vehicle that remains in the moving fleet. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
50. Report simultaneous pull-in and pull-out states on one actor. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
51. Report a lane change still active when ordinary curb parking starts. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
52. Report a driver acceleration coefficient that would invalidate IDM. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
53. Report an IDM braking parameter that would divide by zero. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
54. Report negative or invalid driver time headway. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
55. Report a driver gap that puts its standstill target inside the leader. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
56. Report a driver reaction interval that could make it wait forever. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
57. Report a corrupt driver passing rate that makes gap opportunities unusable. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
58. Report a path that would treat its lane and turn IDs in a different map. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
59. Report a path without enough points to project a rear axle. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
60. Report a cumulative distance table out of sync with the polyline size. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
61. Report a distance table that did not rebase to zero. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
62. Report a non-positive or non-finite NPC path length. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
63. Report a path length that differs from its terminal arc length. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
64. Report invalid rear-axle progress before seeking the next control. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
65. Report rear-axle progress outside the usable polyline span. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
66. Report absent edge spans while the geometry is still present. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
67. Report turn restrictions being evaluated against an abandoned world. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
68. Report missing seeded successor selection before the next path extension. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
69. Identify the malformed point in a joined traffic polyline. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
70. Identify a non-finite lane coordinate and its vertex index. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
71. Identify the invalid sample in the path's cumulative distance table. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
72. Identify a backwards step in the table used by the path's binary search. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
73. Identify the segment whose geometric length no longer matches the arc-length increment. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
74. Locate an empty or malformed path edge record. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
75. Locate a path edge ID absent from the map. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
76. Locate a path edge whose lane index is outside mapped bounds. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
77. Locate a declared path lane for which the map has no polyline. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
78. Locate an edge interval with reversed or non-finite route coordinates. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
79. Locate a break between adjacent path arc-length spans. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
80. Locate a disconnected road sequence even when the joined polyline appears continuous. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
81. Report a terminal road span that disagrees with the geometry endpoint. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
82. Locate a stale destination node that would query the wrong junction. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
83. Locate a missing or nonpositive path speed limit. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
84. Locate a path speed limit that has drifted from the mapped limit. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
85. Locate a path edge that added or lost its mapped traffic control. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
86. Locate a control ID mismatch before a vehicle can consult another light or stop. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
87. Locate an unsupported traffic control type in the path. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
88. Locate a control whose stop line cannot be projected. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
89. Locate a stale stop line after a path edge's mapped control is edited. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
90. Report a lane change without a signed left or right direction. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
91. Report an out-of-range target lane in an active lane change. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
92. Report a lane change anchored to an unmapped street. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
93. Report a lane change whose target is inconsistent with its signed direction and source lane. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
94. Report a lane change with no usable lateral width. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
95. Report a zero or invalid lane-change easing duration. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
96. Report a lane change that cannot advance reliably from its current timer. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
97. Report a corrupt cooldown between lane changes. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
98. Report a curb departure with an invalid lateral starting offset. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
99. Report a curb departure with an invalid merge duration. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
100. Report a curb departure with invalid merge progress. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
101. Report a curb departure whose wait countdown can never expire. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
102. Report a reverse maneuver whose remaining distance is unusable. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
103. Report a reverse maneuver whose safety timeout cannot be measured. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
104. Report a curb-parking plan with an invalid longitudinal interval. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
105. Report a curb-parking plan whose target offset cannot be steered to. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
106. Report a curb-parking timeout that cannot be measured. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
107. Report an ordinary parking maneuver detached from its indexed bay. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
108. Report a parking maneuver that no longer owns its bay reservation. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
109. Report a parking maneuver targeting an already occupied slot. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
110. Report an all-way queue entry filed under the wrong vehicle object. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
111. Locate an all-way stop queued at an unknown junction. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
112. Locate an all-way stop queued from a missing approach. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
113. Locate an approach heading that prevents an all-way stop tie-break. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
114. Report an impossible stop arrival timestamp. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
115. Report a non-finite stop-line observation in the all-way queue. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
116. Report an all-way queue approach with an unusable planned turn. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
117. Report an all-way entry refreshed on an impossible tick. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
118. Report a departure latch inconsistent with its arrival and the current clock. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
119. Report an invalid finite-leader gap while permitting a legitimate overlap. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
120. Report an invalid leader speed while permitting an oncoming projection. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
121. Report a stop-memory state outside the stop-sign state machine. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
122. Report corrupt elapsed stop time that can prevent stop completion. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
123. Report a malformed counter of initiated stops. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
124. Report an active or completed stop with no control identity. Validated by: `scripts/test_5k_traffic_inspection.mjs`.
125. Share the conversion from mapped road distance to joined-path control position across traffic and junction-box checks. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
126. Use the same length-weighted lane sampling for initial motor traffic and cyclists. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
127. Share the driver-specific crossing arrival gap between signed and unsigned junction checks. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
128. Extract the asymmetric closing-speed allowance used for traffic lane changes. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
129. Extract the axle-to-axle clearance occupied by the two bodies during lane changes. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
130. Skip motor-traffic spawning when the map has no eligible lane. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
131. Let an unstarted path return false from extension without touching the map. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
132. Preserve the current path if a requested replacement lane is missing. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
133. Retain the path edge when trimming cannot find an arc-length cut. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
134. Treat a missing edge as no priority approach in the traffic give-way query. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
135. Return no unsigned crossing arrival when the queried stop approach is absent. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
136. Skip dangling adjacency records when counting the neighbors of a junction. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
137. Return no forward strip obstruction when the parking-strip cursor is stale. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
138. Drop a lane-change attempt when its target lacks a lane polyline. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
139. Reject a red-turn query with no associated control. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
140. Skip parking slots whose road disappeared before populating the parked-span cache. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
141. Pin down that a lane change carries its new index into a two-lane straight continuation. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
142. Pin down that a lane change keeps the planned road when the next street is narrower. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
143. Pin down that a left turn enters the innermost lane. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
144. Pin down that a right turn enters the curb lane regardless of incoming lane. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
145. Pin down that a dead-end path keeps the last edge after its endpoint. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
146. Pin down that a shared path boundary selects the departing edge. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
147. Pin down that a positive offset points to the right on eastbound traffic paths. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
148. Pin down that a zero-width parking strip never becomes a bicycle lane. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
149. Pin down that an inbound bicycle does not ride a strip beside an inner lane. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
150. Pin down that the mapped ring does not expose a parking strip to bicycles. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
151. Pin down that traffic starts an unobstructed mid-block move for a right turn. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
152. Pin down that ordinary traffic does not initiate a lane change while crawling. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
153. Pin down that curbward yielding may initiate a lane change from rest. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
154. Pin down that traffic leaves a cooldown before initiating another lane change. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
155. Pin down that approach distance is measured at the nose before initiating a turn lane change. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
156. Pin down that bicycles keep their own lateral movement system during a curbward request. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
157. Pin down that gap checks see a fast rear approach in the target lane. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
158. Pin down that moving away releases the same front gap. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
159. Pin down that a vehicle near the adjacent lane does not block from outside its lateral corridor. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
160. Pin down that sufficient end distance allows a curbward yield after the ordinary cutoff. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
161. Pin down that a vehicle heading away from the left-turn junction is ignored. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
162. Pin down that an opposing vehicle six seconds out does not delay a left turn. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
163. Pin down that a faster opposing vehicle inside the look radius delays a left turn. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
164. Pin down that forward traffic is not counted as a crossing approach. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
165. Pin down that crossing traffic five seconds away is outside the default acceptance gap. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
166. Pin down that the additional red-turn gap holds for the same crossing approach. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
167. Pin down that a stopped vehicle does not generate an arrival conflict. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
168. Pin down that a rear-axle point in the crossing radius counts as box occupancy. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
169. Pin down that parallel traffic in the crossing radius does not count as crossing occupancy. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
170. Pin down that approach timing uses an NPC's planned edge and skips its completed crossing. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
171. Pin down that an earlier conflicting arrival wins outside the tie window. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
172. Pin down that an earlier vehicle in the same lane does not create a crossing conflict. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
173. Pin down that near-simultaneous arrivals yield to the one on the right. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
174. Pin down that a crossing vehicle keeps the turn even when a waiting one arrived earlier. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
175. Pin down that opposed straight approaches share a turn. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
176. Pin down that an opposing U-turn yields to through traffic on tied arrival. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
177. Pin down that an approach already going does not yield its turn. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
178. Pin down that an all-way approach whose driver never stopped stays off the queue. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
179. Pin down that the same queue entry is removed after the approach changes. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
180. Pin down that the all-way queue expires unrefreshed stop claims. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
181. Pin down that the far side uses the incoming paved width when wider than the cross street. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
182. Pin down that the near side uses the width of the crossing street. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
183. Pin down that a driver already in the crossing only waits while still short of the cross street. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
184. Pin down that the creep exception ends at its exact speed threshold. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
185. Pin down that a blocker at queue speed is moving too quickly to reserve box space. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
186. Pin down that the nearest rear bumper is selected even when vehicles are unsorted. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
187. Pin down that a vehicle just short of the stop line does not occupy the outgoing box. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
188. Pin down that the box room check ignores stopped vehicles facing against the planned lane. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
189. Pin down that the queue footprint is projected from the rear of the body. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
190. Pin down that a bike is exempt from motor-vehicle box holds. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
191. Pin down that unsignalled control entries are skipped by the route box lookup. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
192. Pin down that bumper-to-bumper following does not measure from axle to axle. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
193. Pin down that a follower one lane to the side is excluded. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
194. Pin down that a follower facing away is excluded. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
195. Pin down that a follower slightly overlapping the rear bumper retains a signed gap. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
196. Pin down that following distance scale applies only above the standstill minimum. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
197. Pin down that a geometry-only leader specification can constrain the follower. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
198. Pin down that negative current acceleration does not shorten the reserved response time. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
199. Pin down that loss of a time gap while the leader is pulling away does not demand acceleration. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
200. Pin down that a weaker follower spec limits its comfortable braking envelope. Validated by: `scripts/test_5k_traffic_behavior.mjs`.
