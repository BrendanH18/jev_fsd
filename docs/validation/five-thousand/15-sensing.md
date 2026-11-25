# Sensing and safety filter

Sensing can diagnose malformed readings and mismatched coordinate frames on demand. The safety filter handles incomplete observations and accounts for open-track rejections while preserving the seeded drive results. Regression coverage pins the sensing and braking boundaries.

1. Snapshot validation diagnoses a negative or nonfinite value for the simulation time at `t`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
2. Snapshot validation diagnoses a fractional, negative or unsafe count for the physics tick at `tick`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
3. Snapshot validation diagnoses a negative or nonfinite speed for the effective speed ceiling at `limit`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
4. Snapshot validation diagnoses a value other than true or false for the route-following verdict at `onRoute`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
5. Snapshot validation diagnoses a nonfinite or nonnumeric value for the nearest control-line offset at `control_line_m` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
6. Snapshot validation diagnoses a value other than a record for the ego reading at `ego`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
7. Snapshot validation diagnoses a value other than a record for the road reading at `road`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
8. Snapshot validation diagnoses a value other than a record for the visibility reading at `visibility`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
9. Snapshot validation diagnoses a value other than a record for the speed target at `target`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
10. Snapshot validation diagnoses a value other than a record for the active route at `route` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
11. Snapshot validation diagnoses a value other than a record for the route projection at `routeProj` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
12. Snapshot validation diagnoses a value other than a record for the navigation reading at `nav` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
13. Snapshot validation diagnoses a value other than a record for the current lane reading at `lane` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
14. Snapshot validation diagnoses a value other than an array for the visible traffic list at `traffic`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
15. Snapshot validation diagnoses a value other than an array for the roadside observation list at `roadside`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
16. Snapshot validation diagnoses a nonfinite or nonnumeric value for the ego easting at `ego.x`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
17. Snapshot validation diagnoses a nonfinite or nonnumeric value for the ego northing at `ego.y`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
18. Snapshot validation diagnoses a nonfinite or nonnumeric value for the ego heading at `ego.psi`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
19. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed ego speed at `ego.v`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
20. Snapshot validation diagnoses a zero, negative or nonfinite value for the front axle-reference distance at `ego.front_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
21. Snapshot validation diagnoses a value other than true or false for the road-surface verdict at `road.on_road`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
22. Snapshot validation diagnoses a negative, nonnumeric or NaN value for the unsigned road-surface distance at `road.distance_to_road`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
23. Snapshot validation diagnoses a negative or nonfinite value for the road station at `road.s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
24. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed offset from the street at `road.lateral`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
25. Snapshot validation diagnoses a value outside the signed radian range for the error relative to the road heading at `road.heading_error`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
26. Snapshot validation diagnoses a negative or nonfinite speed for the posted or zoned limit at `road.limit`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
27. Snapshot validation diagnoses a negative, nonnumeric or NaN value for the sight range at `visibility.range_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
28. Snapshot validation diagnoses a negative or nonfinite speed for the speed safe within sight at `visibility.safe_speed_mps`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
29. Snapshot validation diagnoses a nonfinite or nonnumeric value for the visible route distance at `visibility.clear_path_m` when supplied. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
30. Snapshot validation diagnoses a negative or nonfinite speed for the commanded target speed at `target.v`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
31. Snapshot validation diagnoses a list containing a blank or non-string label for the ordered speed-reason labels at `target.reasons`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
32. Snapshot validation diagnoses a negative or nonfinite value for the rear-axle route station at `routeProj.s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
33. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed lateral route offset at `routeProj.lateral`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
34. Snapshot validation diagnoses a value outside the signed radian range for the signed heading difference from the route at `routeProj.headingErr`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
35. Snapshot validation diagnoses a negative or nonfinite value for the unsigned projection distance at `routeProj.distance`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
36. Snapshot validation diagnoses a value other than a two-coordinate finite point for the nearest point on the route at `routeProj.point`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
37. Snapshot validation diagnoses a fractional, negative or unsafe count for the route segment index at `routeProj.index`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
38. Snapshot validation diagnoses an unrecognized turn direction for the next-exit turn direction at `nav.next_turn`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
39. Snapshot validation diagnoses a fractional, negative or unsafe count for the roundabout exit number at `nav.exit` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
40. Snapshot validation diagnoses a nonfinite or nonnumeric value for the distance to the next turn at `nav.turn_in_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
41. Snapshot validation diagnoses a negative or nonfinite value for the distance remaining at `nav.remaining_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
42. Snapshot validation diagnoses a nonfinite or nonnumeric value for the turnaround start offset at `nav.turn_round_in_m` when supplied. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
43. Snapshot validation diagnoses a nonfinite or nonnumeric value for the destination lateral coordinate at `nav.destination.right`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
44. Snapshot validation diagnoses a nonfinite or nonnumeric value for the destination longitudinal coordinate at `nav.destination.ahead`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
45. Snapshot validation diagnoses a value other than a positive safe integer for the same-direction lane count at `lane.lanes`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
46. Snapshot validation diagnoses a fractional, negative or unsafe count for the current lane index at `lane.index`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
47. Snapshot validation diagnoses a fractional, negative or unsafe count for the route lane index at `lane.route_index`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
48. Snapshot validation diagnoses a value other than a safe integer for the signed lane-index difference at `lane.delta`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
49. Snapshot validation diagnoses a nonfinite or nonnumeric value for the tracked lane center offset at `lane.center`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
50. Snapshot validation diagnoses a nonfinite or nonnumeric value for the tracked lane end station at `lane.until_s` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
51. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed offset from the tracked lane at `lane.lateral`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
52. Snapshot validation diagnoses a value other than a record for the active lane shift at `lane.shift` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
53. Snapshot validation diagnoses a nonfinite or nonnumeric value for the lane-change origin center at `lane.from_center` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
54. Snapshot validation diagnoses a nonfinite or nonnumeric value for the lane-change start station at `lane.shift.start`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
55. Snapshot validation diagnoses a zero, negative or nonfinite value for the lane-change length at `lane.shift.len`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
56. Snapshot validation diagnoses an empty or unrecognized identifier for the approached control ID at `intersection.id`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
57. Snapshot validation diagnoses an unrecognized control type for the control type at `intersection.control`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
58. Snapshot validation diagnoses a blank or non-string label for the displayed signal phase at `intersection.signal` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
59. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed front-bumper distance to the control line at `intersection.bumper_to_line_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
60. Snapshot validation diagnoses a nonfinite or nonnumeric value for the station of the control line at `intersection.s_line_route`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
61. Snapshot validation diagnoses a value other than true or false for the junction entry verdict at `intersection.entered`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
62. Snapshot validation diagnoses an unrecognized turn direction for the controlled turn direction at `intersection.turn`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
63. Snapshot validation diagnoses a value other than true or false for the stop completion memory at `intersection.stop_completed` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
64. Snapshot validation diagnoses a value other than true or false for the all-way stop designation at `intersection.all_way` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
65. Snapshot validation diagnoses a value other than true or false for the crossing-traffic verdict at `intersection.cross_traffic_moving`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
66. Snapshot validation diagnoses a value other than true or false for the stop-queue arrival at `intersection.priority.arrived`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
67. Snapshot validation diagnoses a value other than true or false for the stop-queue right of way at `intersection.priority.go`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
68. Snapshot validation diagnoses a value other than an array for the queued vehicles at `intersection.priority.waiting`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
69. Snapshot validation diagnoses a blank or non-string label for the junction priority rule at `intersection.give_way.rule`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
70. Snapshot validation diagnoses a negative or nonfinite value for the required crossing time at `intersection.give_way.need_s` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
71. Snapshot validation diagnoses a negative or nonfinite value for the unobstructed sight distance at `intersection.give_way.sight_m` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
72. Snapshot validation diagnoses a nonfinite or nonnumeric value for the peek-point station at `intersection.give_way.peek_s_route`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
73. Snapshot validation diagnoses a value other than true or false for the peek completion flag at `intersection.give_way.peeked`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
74. Snapshot validation diagnoses a nonfinite or nonnumeric value for the give-way hold station at `intersection.give_way.hold_s_route` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
75. Snapshot validation diagnoses a nonfinite or nonnumeric value for the front-bumper distance to the give-way hold at `intersection.give_way.bumper_to_hold_m` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
76. Snapshot validation diagnoses a value other than true or false for the give-way clearance verdict at `intersection.give_way.go`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
77. Snapshot validation diagnoses an empty or unrecognized identifier for the lead-vehicle ID at `following.id`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
78. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed bumper gap to the leader at `following.gap_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
79. Snapshot validation diagnoses a nonfinite or nonnumeric value for the lead vehicle speed at `following.speed`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
80. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed following closing speed at `following.closing_mps`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
81. Snapshot validation diagnoses a nonfinite or nonnumeric value for the projected lead position at `following.s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
82. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed gap to the rear vehicle at `rear_follower.gap_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
83. Snapshot validation diagnoses a nonfinite or nonnumeric value for the rear-vehicle closing speed at `rear_follower.closing_mps`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
84. Snapshot validation diagnoses an empty or unrecognized identifier for the pedestrian ID at `pedestrian.id`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
85. Snapshot validation diagnoses a nonfinite or nonnumeric value for the front-bumper distance to the pedestrian crossing at `pedestrian.bumper_to_crosswalk_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
86. Snapshot validation diagnoses a nonfinite or nonnumeric value for the pedestrian crossing station at `pedestrian.s_route`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
87. Snapshot validation diagnoses a negative or nonfinite value for the pedestrian distance to the route at `pedestrian.to_path_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
88. Snapshot validation diagnoses a nonfinite or nonnumeric value for the pedestrian speed at `pedestrian.speed`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
89. Snapshot validation diagnoses an empty or unrecognized identifier for the cyclist ID for a right-turn conflict at `right_hook.id`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
90. Snapshot validation diagnoses a negative or nonfinite value for the cyclist time to the conflict at `right_hook.eta_s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
91. Snapshot validation diagnoses a negative or nonfinite value for the time needed to clear the cyclist at `right_hook.need_s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
92. Snapshot validation diagnoses a nonfinite or nonnumeric value for the right-hook yield station at `right_hook.yield_s_route`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
93. Snapshot validation diagnoses a nonfinite or nonnumeric value for the front-bumper distance to the right-hook yield at `right_hook.bumper_to_yield_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
94. Snapshot validation diagnoses an empty or unrecognized identifier for the emergency call ID at `emergency.id`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
95. Snapshot validation diagnoses a negative or nonfinite value for the distance to the emergency vehicle at `emergency.distance_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
96. Snapshot validation diagnoses a negative or nonfinite value for the time to the emergency vehicle at `emergency.eta_s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
97. Snapshot validation diagnoses a value other than true or false for the emergency-vehicle visibility at `emergency.seen`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
98. Snapshot validation diagnoses a nonfinite or nonnumeric value for the pull-over stop station at `emergency.stop_s_route` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
99. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed distance to the pull-over stop at `emergency.bumper_to_stop_m` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
100. Snapshot validation diagnoses a nonfinite or nonnumeric value for the lateral pull-over target at `emergency.offset_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
101. Snapshot validation diagnoses a value other than true or false for the pull-over steering-at-stop directive at `emergency.steer_at_stop`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
102. Snapshot validation diagnoses a negative or nonfinite speed for the pull-over speed envelope at `emergency.max_speed_mps`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
103. Snapshot validation diagnoses a value other than true or false for the junction clearing flag during a pull-over at `emergency.clearing`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
104. Snapshot validation diagnoses a value other than true or false for the drive-on authorization at `emergency.lead`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
105. Snapshot validation diagnoses a negative or nonfinite value for the gap to the emergency leader at `emergency_ahead.gap_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
106. Snapshot validation diagnoses a negative or nonfinite speed for the emergency leader speed at `emergency_ahead.speed`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
107. Snapshot validation diagnoses a warning-light colour other than amber or red for the school-bus warning-light colour at `school_bus.lights`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
108. Snapshot validation diagnoses a value other than true or false for the streetcar door state at `streetcar.doors`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
109. Snapshot validation diagnoses an unrecognized crossing hold reason for the level-crossing hold reason at `level_crossing.wait`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
110. Snapshot validation diagnoses a negative or nonfinite speed for the school or playground speed limit at `speed_zone.limit_mps`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
111. Snapshot validation diagnoses a value other than true or false for the current zone membership at `speed_zone.in_zone`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
112. Snapshot validation diagnoses a nonfinite or nonnumeric value for the signed distance to the zone start at `speed_zone.starts_in_m`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
113. Snapshot validation diagnoses a direction other than in or out for the parking direction at `parking.mode`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
114. Snapshot validation diagnoses a blank or non-string label for the active parking phase at `parking.phase` while allowing null. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
115. Snapshot validation diagnoses a fractional, negative or unsafe count for the parking direction-change count at `parking.legs`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
116. Snapshot validation diagnoses a value other than true or false for the parking execution flag at `parking.executing`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
117. Snapshot validation diagnoses a negative or nonfinite value for the elapsed parking idle time at `parking.idle_s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
118. Snapshot validation diagnoses a fractional, negative or unsafe count for the turnaround leg count at `turnaround.legs`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
119. Snapshot validation diagnoses a value other than true or false for the turnaround execution flag at `turnaround.executing`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
120. Snapshot validation diagnoses a negative or nonfinite value for the elapsed turnaround idle time at `turnaround.idle_s` when supplied. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
121. Snapshot validation diagnoses a zero, negative or nonfinite value for the elapsed stalled time at `stuck.for_s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
122. Snapshot validation diagnoses a negative or nonfinite value for the time to predicted contact at `current_path_hazard.in_s`. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
123. An absent or non-record snapshot produces a readable top-level diagnostic. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
124. A malformed nested observation identifies the section that needs to be a record. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
125. The active route must provide a positive length before its projection can be interpreted. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
126. The on-route verdict requires a route. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
127. An active route without a projection is diagnosed explicitly. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
128. An active route without navigation information is diagnosed explicitly. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
129. An active route without lane information is diagnosed explicitly. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
130. A projection left over after route removal produces a diagnostic. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
131. The validator identifies a projection beyond the route end. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
132. The on-road verdict must agree with the drivable surface measurement. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
133. The current lane index must exist on the street. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
134. The route lane index must exist on the street. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
135. The reported lane delta must agree with the current and route lane indexes. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
136. A lane-change origin requires an active shift. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
137. Junction entry must agree with the front bumper crossing the control line. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
138. A control-line distance measured from the rear axle is identified by its mismatch with the route station. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
139. A pedestrian crossing distance must agree with its station along the route. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
140. A right-hook yield distance must agree with its reported stop point. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
141. A give-way hold must supply both its route station and its bumper distance or neither. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
142. An emergency drive-on authorization cannot also request a stop. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
143. A pull-over stop must supply both its route station and its bumper distance or neither. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
144. The following closing speed must agree with the ego and lead speeds. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
145. Snapshot producers can opt into validation that throws with all actionable field paths after sensing completes. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
146. Supported driving tracks are immutable so other callers cannot change validation by modifying the exported list. Validated by: `scripts/test_5k_sensing_filter.mjs`.
147. An explicit collision rejection stays enforced even when a reused candidate still says it is eligible. Validated by: `scripts/test_5k_sensing_filter.mjs`.
148. A physical collision with a malformed rejection label is reported by its collision verdict. Validated by: `scripts/test_5k_sensing_filter.mjs`.
149. Open-track processing keeps candidates blocked when their rejection values have invalid types. Validated by: `scripts/test_5k_sensing_filter.mjs`.
150. Padding a collision label with whitespace cannot turn it into an advisory. Validated by: `scripts/test_5k_sensing_filter.mjs`.
151. Malformed rejection values appear together under an unknown count without coercing the original objects. Validated by: `scripts/test_5k_sensing_filter.mjs`.
152. Rejection counts use own keys even for labels that match inherited object names. Validated by: `scripts/test_5k_sensing_filter.mjs`.
153. A blank rejection label displays the unknown road-rule text. Validated by: `scripts/test_5k_sensing_filter.mjs`.
154. Obstacle sweeps preserve the original bounding box when a vehicle supplies a shared box. Validated by: `scripts/test_5k_sensing_filter.mjs`.
155. The forward brake computes its door sweep once per tick even when several doors are visible. Validated by: `scripts/test_5k_sensing_filter.mjs`.
156. A prediction envelope without an executing law can still request an imminent collision brake. Validated by: `scripts/test_5k_sensing_filter.mjs`.
157. Malformed following readings leave the physical obstacle checks available. Validated by: `scripts/test_5k_sensing_filter.mjs`.
158. Malformed prediction times no longer trigger the imminent-collision brake by coercion. Validated by: `scripts/test_5k_sensing_filter.mjs`.
159. Deadlock detection diagnoses invalid elapsed time without changing the accumulated stall duration. Validated by: `scripts/test_5k_sensing_filter.mjs`.
160. Manual following metrics decline incomplete or nonfinite route projections. Validated by: `scripts/test_5k_sensing_filter.mjs`.
161. Routed sensing reports an invalid projection heading before passing it to angle wrapping. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
162. Sensing reports an invalid ego heading before querying obstacles or a route. Validated by: `scripts/test_5k_sensing_snapshot.mjs`.
163. Pedestrian and NPC visibility membership use the same obstacle index while retaining source order. Validated by: `node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check` and the seeded parity comparison.
164. Emergency sensing skips route geometry and clears the pull-over plan when there is no active emergency vehicle. Validated by: `node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check` and the seeded parity comparison.
165. Intersection cadence activates inside the 60 m look-ahead boundary. Validated by: `scripts/test_5k_sensing_filter.mjs`.
166. An oncoming conflict remains a cadence flag beyond ordinary intersection look-ahead. Validated by: `scripts/test_5k_sensing_filter.mjs`.
167. A planned turn activates cadence only inside 50 m. Validated by: `scripts/test_5k_sensing_filter.mjs`.
168. A nearby destination never impersonates a planned turn. Validated by: `scripts/test_5k_sensing_filter.mjs`.
169. The following flag requires less than 15 m of bumper gap. Validated by: `scripts/test_5k_sensing_filter.mjs`.
170. A vehicle at or behind the ego axle does not activate forward traffic cadence. Validated by: `scripts/test_5k_sensing_filter.mjs`.
171. A moving traffic reading exactly 25 m away is outside cadence range. Validated by: `scripts/test_5k_sensing_filter.mjs`.
172. Forward traffic cadence uses a symmetric lateral corridor. Validated by: `scripts/test_5k_sensing_filter.mjs`.
173. Cadence measures lane error from the tracked lane center when available. Validated by: `scripts/test_5k_sensing_filter.mjs`.
174. The lane-error cadence threshold includes neither lateral boundary. Validated by: `scripts/test_5k_sensing_filter.mjs`.
175. A completed shift into another lane remains a lane-change cadence flag. Validated by: `scripts/test_5k_sensing_filter.mjs`.
176. An active return shift triggers cadence even with a zero target lane delta. Validated by: `scripts/test_5k_sensing_filter.mjs`.
177. Near-destination cadence switches at 30 m remaining. Validated by: `scripts/test_5k_sensing_filter.mjs`.
178. Independent hazards retain their cadence priority order. Validated by: `scripts/test_5k_sensing_filter.mjs`.
179. An explicit zero visibility target stays zero even with a long sight range. Validated by: `scripts/test_5k_sensing_filter.mjs`.
180. Visibility falling inside the stopping buffer yields a zero speed target. Validated by: `scripts/test_5k_sensing_filter.mjs`.
181. Visibility with room beyond the buffer yields a larger target. Validated by: `scripts/test_5k_sensing_filter.mjs`.
182. The visibility cap adds no reason when the road limit is tighter. Validated by: `scripts/test_5k_sensing_filter.mjs`.
183. A moving bus with a stop point inside one metre requests a complete stop. Validated by: `scripts/test_5k_sensing_filter.mjs`.
184. The stop behind a vehicle at a crosswalk remains distinct from a pedestrian hold. Validated by: `scripts/test_5k_sensing_filter.mjs`.
185. An amber school bus already behind the stop point no longer caps speed. Validated by: `scripts/test_5k_sensing_filter.mjs`.
186. Red school-bus lamps still hold at a passed stop point. Validated by: `scripts/test_5k_sensing_filter.mjs`.
187. Streetcar doors replace the approach speed with a stop target. Validated by: `scripts/test_5k_sensing_filter.mjs`.
188. A track-room hold and a train hold retain separate explanations. Validated by: `scripts/test_5k_sensing_filter.mjs`.
189. Emergency drive-on authorization with no stop leaves the speed ceiling unchanged. Validated by: `scripts/test_5k_sensing_filter.mjs`.
190. Pull-over speed respects its own envelope before reaching the stop. Validated by: `scripts/test_5k_sensing_filter.mjs`.
191. A lane-closure merge hold at route station zero remains a stop. Validated by: `scripts/test_5k_sensing_filter.mjs`.
192. An all-way stop queue cannot hold before the stop is completed. Validated by: `scripts/test_5k_sensing_filter.mjs`.
193. A completed stop keeps yielding to moving cross traffic until junction entry. Validated by: `scripts/test_5k_sensing_filter.mjs`.
194. An imminent executing hazard acts at walking speed and stops reporting at one second. Validated by: `scripts/test_5k_sensing_filter.mjs`.
195. A fresh physical obstruction takes priority over the executing prediction. Validated by: `scripts/test_5k_sensing_filter.mjs`.
196. A reverse sweep does not hold for the same obstacle after it moves to the nose. Validated by: `scripts/test_5k_sensing_filter.mjs`.
197. A stopped turnaround uses reverse sensing only for the active execution law. Validated by: `scripts/test_5k_sensing_filter.mjs`.
198. A completed parking law restores the ordinary forward standstill clearance. Validated by: `scripts/test_5k_sensing_filter.mjs`.
199. The direct-ahead check excludes moving oncoming traffic during a parking approach. Validated by: `scripts/test_5k_sensing_filter.mjs`.
200. Crawling in a planned turnaround records stalled time after five seconds of idling. Validated by: `scripts/test_5k_sensing_filter.mjs`.
