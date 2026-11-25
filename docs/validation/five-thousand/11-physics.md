# Vehicle physics and control

Vehicle stepping reports invalid physical inputs early and restores motion when a tick fails. Controller geometry, stopping speeds, the world clock, and render interpolation handle boundary cases explicitly. Shared weather and vehicle presets are protected against accidental mutation.

1. Keep the existing step-duration bounds in one validation function shared between the controller and the integrator. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
2. Validate elapsed time before reading command fields, including for zero-duration probes. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
3. Reject non-record commands at the positive-duration integration boundary. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
4. Require explicit boolean permissions for reverse so strings and numbers cannot engage gear. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
5. Reject corrupt steering or throttle actuator state before moving either actuator. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
6. Reject corrupt lateral velocity or yaw rate before integrating motion. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
7. Reject corrupt longitudinal or lateral acceleration before using it for axle load transfer. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
8. Diagnose invalid global friction at the vehicle-step boundary. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
9. Diagnose invalid global friction when computing comfortable driving limits. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
10. Reject a non-function local grip hook before actuating the vehicle. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
11. Use a single validated ambient friction value throughout a tick, including local-grip fallbacks. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
12. Roll back a partially integrated tick when sampling local friction throws. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
13. Fail a finite-input tick that overflows its output pose and restore the original motion. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
14. Detect overflow in integrated speed before speed clipping could hide it. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
15. Keep shared built-in physical specifications read-only so actors cannot silently change another actor's limits. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
16. Revalidate custom mutable specifications after in-place changes. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
17. Avoid caching a frozen custom specification whose getters can change its physical values. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
18. Reject a missing or non-record vehicle specification at the motion boundary. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
19. Require positive wheelbase for the curvature and axle load calculations. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
20. Reject steering ranges that reach the kinematic tangent singularity. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
21. Prevent negative steering rate from driving the actuator away from its target angle. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
22. Validate drive acceleration limits before using them to bound throttle. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
23. Validate brake magnitudes before using them to bound negative acceleration. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
24. Reject unbounded forward speed limits at integration. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
25. Reject reverse speed limits that invert the signed speed clamp. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
26. Reject negative time constants for the acceleration actuator. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
27. Reject corrupt jerk limits before they reach the slew calculation. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
28. Distinguish invalid mass from deliberately massless kinematic specifications. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
29. Keep the dynamic centre of gravity between the axles so both nominal axle loads remain positive. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
30. Validate a massless model's optional centre of gravity without requiring dynamic fields. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
31. Reject zero yaw inertia before dividing yaw moment by it. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
32. Reject zero track width before calculating lateral load transfer. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
33. Require nonnegative centre-of-gravity height for the load transfer model. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
34. Reject an invalid front tyre stiffness independently of the rear tyre. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
35. Reject an invalid rear tyre stiffness independently of the front tyre. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
36. Bound front braking share so the rear axle cannot apply throttle under braking. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
37. Bound front drive share so the rear axle cannot apply braking under throttle. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
38. Bound the lateral load transfer share so one axle cannot receive a negative load transfer. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
39. Validate supplied wheel power before using it as a throttle ceiling. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
40. Reject powered kinematic specifications with no mass before the power calculation can divide by zero. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
41. Reject negative aerodynamic drag area for powered models. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
42. Reject negative rolling resistance for powered models. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
43. Compute the dynamic substep interval once per tick. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
44. Keep the low-level integrators module-local while preserving the validated stepping path for restored vehicle prototypes. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
45. Wrap multiply unbounded headings in constant time through the shared angle helper. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
46. Use the same rear-axle-relative projection for vehicle centres and front bumpers. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
47. Fall back to the normalized Fiala cubic when the expanded polynomial would overflow. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
48. Compute the comfort scaling factor once for both lateral and longitudinal targets. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
49. Clarify that the car model switches at 3 m/s and that stepping expects seconds, signed radians and m/s². Validated by: `scripts/test_5k_physics_vehicle.mjs`.
50. Reject an invalid law timestep before a parking or turnaround law can change its state. Validated by: `scripts/test_5k_physics_controller.mjs`.
51. Make zero-duration laws true no-ops even when no route or vehicle has been built. Validated by: `scripts/test_5k_physics_controller.mjs`.
52. Reject a missing or non-record control law at dispatch. Validated by: `scripts/test_5k_physics_controller.mjs`.
53. Diagnose non-finite speed at pursuit lookahead instead of sending an invalid position into route geometry. Validated by: `scripts/test_5k_physics_controller.mjs`.
54. Diagnose non-finite speed when sizing a lane change. Validated by: `scripts/test_5k_physics_controller.mjs`.
55. Validate the pursuit arc position and lateral offset before querying the route. Validated by: `scripts/test_5k_physics_controller.mjs`.
56. Reject invalid explicit lookahead distances independently of the vehicle speed. Validated by: `scripts/test_5k_physics_controller.mjs`.
57. Require a finite route length and a pursuit point lookup for route-based steering. Validated by: `scripts/test_5k_physics_controller.mjs`.
58. Reject missing or invalid steering target coordinates. Validated by: `scripts/test_5k_physics_controller.mjs`.
59. Reject invalid steering pose before heading normalization can loop on a non-finite value. Validated by: `scripts/test_5k_physics_controller.mjs`.
60. Detect steering coordinate differences that overflow the coordinate range. Validated by: `scripts/test_5k_physics_controller.mjs`.
61. Validate wheelbase for standalone pursuit and off-route recovery commands. Validated by: `scripts/test_5k_physics_controller.mjs`.
62. Share the steering projection between route pursuit and arbitrary-point recovery while preserving their respective bearing conventions. Validated by: `scripts/test_5k_physics_controller.mjs`.
63. Replace the off-route recovery heading loop with bounded wrap arithmetic. Validated by: `scripts/test_5k_physics_controller.mjs`.
64. Diagnose an invalid current speed or coercible speed target at the proportional controller. Validated by: `scripts/test_5k_physics_controller.mjs`.
65. Reject invalid proportional gain. Validated by: `scripts/test_5k_physics_controller.mjs`.
66. Validate that both speed-control pedal bounds are finite and nonnegative. Validated by: `scripts/test_5k_physics_controller.mjs`.
67. Define a disabled gain as zero command even when the target is unbounded. Validated by: `scripts/test_5k_physics_controller.mjs`.
68. Scale finite speeds before subtracting when their difference would overflow. Validated by: `scripts/test_5k_physics_controller.mjs`.
69. Reject malformed stopping distances before calculating a speed cap. Validated by: `scripts/test_5k_physics_controller.mjs`.
70. Reject invalid stopping deceleration when there is room to stop. Validated by: `scripts/test_5k_physics_controller.mjs`.
71. Return zero stopping speed for zero deceleration even with unbounded stopping room. Validated by: `scripts/test_5k_physics_controller.mjs`.
72. Calculate a stopping speed from scaled factors if its square cannot be represented. Validated by: `scripts/test_5k_physics_controller.mjs`.
73. Validate route geometry before building a curve speed profile. Validated by: `scripts/test_5k_physics_controller.mjs`.
74. Reject an invalid arc position for curve speed sampling. Validated by: `scripts/test_5k_physics_controller.mjs`.
75. Ignore negative curve samples independently of the existing unavailable-sample rule. Validated by: `scripts/test_5k_physics_controller.mjs`.
76. Recover finite curve caps whose mathematical square overflows. Validated by: `scripts/test_5k_physics_controller.mjs`.
77. Keep positive subnormal curve caps when squaring would erase them. Validated by: `scripts/test_5k_physics_controller.mjs`.
78. Validate a lane law's requested lateral offset and route position. Validated by: `scripts/test_5k_physics_controller.mjs`.
79. Reject a corrupt lane-frame correction before applying it to source or target. Validated by: `scripts/test_5k_physics_controller.mjs`.
80. Diagnose overflowing lane-change target and source positions at the geometry boundary. Validated by: `scripts/test_5k_physics_controller.mjs`.
81. Reject malformed lane shift geometry before easing across it. Validated by: `scripts/test_5k_physics_controller.mjs`.
82. Define a zero-length lane change as an instantaneous shift at its starting position. Validated by: `scripts/test_5k_physics_controller.mjs`.
83. Use a weighted blend when the difference between otherwise finite lane-change endpoints overflows. Validated by: `scripts/test_5k_physics_controller.mjs`.
84. Reject malformed detour geometry before sampling it. Validated by: `scripts/test_5k_physics_controller.mjs`.
85. Reject non-finite route positions for an active detour. Validated by: `scripts/test_5k_physics_controller.mjs`.
86. Scale the start and end detour ramps when the arc length span exceeds the numeric range. Validated by: `scripts/test_5k_physics_controller.mjs`.
87. Diagnose malformed lane centre offsets before applying the nudge correction. Validated by: `scripts/test_5k_physics_controller.mjs`.
88. Report overflow while deriving the lane centre from a valid lateral target. Validated by: `scripts/test_5k_physics_controller.mjs`.
89. Validate lane speed targets before taking their minimum with the curve cap. Validated by: `scripts/test_5k_physics_controller.mjs`.
90. Reject malformed lane-law start positions before constructing stop distances. Validated by: `scripts/test_5k_physics_controller.mjs`.
91. Report a corrupt explicit law stop distance. Validated by: `scripts/test_5k_physics_controller.mjs`.
92. Validate stopping reaction times before reserving travel for the response lag. Validated by: `scripts/test_5k_physics_controller.mjs`.
93. Validate the braking limit on a law with a stop before combining it with the weather limit. Validated by: `scripts/test_5k_physics_controller.mjs`.
94. Reject a non-array collection of temporary speed caps at the lane law boundary. Validated by: `scripts/test_5k_physics_controller.mjs`.
95. Reject individual slow zones with malformed extents or speed limits. Validated by: `scripts/test_5k_physics_controller.mjs`.
96. Document the pursuit angle, speed-control gain and pedal units next to the APIs. Validated by: `scripts/test_5k_physics_controller.mjs`.
97. Ignore stale elapsed samples without extending the next valid clock interval. Validated by: `scripts/test_5k_physics_time_render.mjs`.
98. Reject negative elapsed samples before setting the initial clock anchor. Validated by: `scripts/test_5k_physics_time_render.mjs`.
99. Reduce extreme elapsed intervals modulo a week before advancing the clock. Validated by: `scripts/test_5k_physics_time_render.mjs`.
100. Reject imprecise weekday values while continuing to wrap exact integers around the week. Validated by: `scripts/test_5k_physics_time_render.mjs`.
101. Use one afternoon fallback for the clock, parser and display. Validated by: `scripts/test_5k_physics_time_render.mjs`.
102. Make the named daylight presets immutable for all consumers. Validated by: `scripts/test_5k_physics_time_render.mjs`.
103. Accept 24:00 as midnight and reject out-of-range dial labels. Validated by: `scripts/test_5k_physics_time_render.mjs`.
104. Use the standard traffic count when the configured default cannot be rounded. Validated by: `scripts/test_5k_physics_time_render.mjs`.
105. Accept only the advertised clock rate values in a URL. Validated by: `scripts/test_5k_physics_time_render.mjs`.
106. Protect shared weather presets against both replaced records and mutated values. Validated by: `scripts/test_5k_physics_time_render.mjs`.
107. Document the units and distinct roles of grip, desired-speed scaling and visibility. Validated by: `scripts/test_5k_physics_time_render.mjs`.
108. Snap render poses when the interpolation fraction is non-finite. Validated by: `scripts/test_5k_physics_time_render.mjs`.
109. Reject corrupt render coordinate samples before arithmetic can coerce them. Validated by: `scripts/test_5k_physics_time_render.mjs`.
110. Reject a corrupt previous heading before subtracting it from the current heading. Validated by: `scripts/test_5k_physics_time_render.mjs`.
111. Use the exact current render pose at the end of an interval. Validated by: `scripts/test_5k_physics_time_render.mjs`.
112. Preserve the zero-heading convention for a headingless actor at the interpolation endpoint. Validated by: `scripts/test_5k_physics_time_render.mjs`.
113. Read the road's dry friction default from one coefficient shared by the vehicle model, comfort limits, and weather. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
114. Reject an invalid vehicle body length before projecting the physical centre or bumper. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
115. Require rear overhang to place the axle on or within the vehicle body. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
116. Reject invalid lateral body dimensions in the collision box and corner views. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
117. Validate vehicle heading before projecting the body centre or bumper. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
118. Reject non-finite projected bumper and centre positions before returning a geometry sample. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
119. Diagnose corner coordinates that overflow even when the body centre is finite. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
120. Reject corrupt target points when deriving vehicle-local coordinates. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
121. Diagnose an invalid source pose before applying its local frame. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
122. Reject overflowing forward or right coordinates in the vehicle-local projection. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
123. Reject non-record speed-control options rather than silently applying default pedal settings. Validated by: `scripts/test_5k_physics_controller.mjs`.
124. Apply the same law record validation when sampling a standalone lateral target or lane centre. Validated by: `scripts/test_5k_physics_controller.mjs`.
125. Report a malformed frame-shift hook by property name before calling it. Validated by: `scripts/test_5k_physics_controller.mjs`.
126. Preserve the positive-zero curve speed convention while repairing underflow of positive samples. Validated by: `scripts/test_5k_physics_controller.mjs`.
127. Use a shared measurement of stopping room for the brake and steering decisions on a lane law. Validated by: `scripts/test_5k_physics_controller.mjs`.
128. Respect an explicit zero stopping deceleration instead of substituting the implicit comfort limit. Validated by: `scripts/test_5k_physics_controller.mjs`.
129. Keep the live weather snapshot read-only across retained references to the active profile. Validated by: `scripts/test_5k_physics_time_render.mjs`.
130. Normalize case and surrounding whitespace before selecting a known weather preset. Validated by: `scripts/test_5k_physics_time_render.mjs`.
131. Repair an invalid local hour restored into the clock state before applying elapsed time. Validated by: `scripts/test_5k_physics_time_render.mjs`.
132. Normalize a corrupt weekday restored into the clock state without losing valid day numbering. Validated by: `scripts/test_5k_physics_time_render.mjs`.
133. Treat an unrecognized restored clock rate as paused before advancing. Validated by: `scripts/test_5k_physics_time_render.mjs`.
134. Discard an invalid restored elapsed-time anchor before calculating a clock delta. Validated by: `scripts/test_5k_physics_time_render.mjs`.
135. Keep the elapsed local time when an invalid explicit set-hour request arrives. Validated by: `scripts/test_5k_physics_time_render.mjs`.
136. Keep the displayed minute on the current side of midnight when the display tolerance would round it up. Validated by: `scripts/test_5k_physics_time_render.mjs`.
137. Replace an unusable capture destination with a fresh render sample. Validated by: `scripts/test_5k_physics_time_render.mjs`.
138. Prevent capture from writing to the live pose when the source is also passed as the destination. Validated by: `scripts/test_5k_physics_time_render.mjs`.
139. Mark missing or non-numeric capture coordinates as unavailable for the next blend. Validated by: `scripts/test_5k_physics_time_render.mjs`.
140. Handle the absence of a next render actor without attempting to dereference a pose. Validated by: `scripts/test_5k_physics_time_render.mjs`.
141. Use the exact previous render pose at the start of the interval while preserving current non-pose fields. Validated by: `scripts/test_5k_physics_time_render.mjs`.
142. Pin axle-wise sampling to the physical contact positions and selected body specification. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
143. Pin the number of surface samples per dynamic substep on either side of the 3 m/s boundary. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
144. Verify that the least-grippy axle constrains the low-speed split-surface case. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
145. Check that an over-limit steering target still uses the physical slew rate. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
146. Pin jerk limiting to the actuator path before grip limits are applied. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
147. Check that zero actuator lag and zero steering lock remain valid. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
148. Cover rolling drag when the command leaves both pedals neutral. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
149. Verify that positive throttle can encounter a negative net powertrain demand at speed. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
150. Check that braking in reverse stops before accelerating forward. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
151. Pin the signed reverse speed ceiling to the vehicle's specification. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
152. Verify that the sideslip readout suppresses near-standstill motion and handles reverse speed. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
153. Retain a finite straight trajectory on extremely low positive grip. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
154. Check that a rail specification can have zero steering lock. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
155. Check that retrying after a failed hook gives the same physical results as an untouched clone. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
156. Check that pursuit respects lateral displacement even when clipped at the end of a route. Validated by: `scripts/test_5k_physics_controller.mjs`.
157. Pin pursuit's one-metre geometric floor for recovery targets near the rear axle. Validated by: `scripts/test_5k_physics_controller.mjs`.
158. Check the steering sign on both sides of an eastbound route. Validated by: `scripts/test_5k_physics_controller.mjs`.
159. Verify the reverse law flips the recovery heading command toward its target. Validated by: `scripts/test_5k_physics_controller.mjs`.
160. Pin route-free hard braking to the current steering angle. Validated by: `scripts/test_5k_physics_controller.mjs`.
161. Check that an infinite numeric target saturates each intended pedal. Validated by: `scripts/test_5k_physics_controller.mjs`.
162. Pin the curve profile horizon to inclusive 60 m with 3 m sampling. Validated by: `scripts/test_5k_physics_controller.mjs`.
163. Verify that curve lookups receive the comfortable lateral acceleration for the current surface. Validated by: `scripts/test_5k_physics_controller.mjs`.
164. Exercise independent lane-frame corrections at the start of a shift and at the target. Validated by: `scripts/test_5k_physics_controller.mjs`.
165. Pin the neutral detour endpoints, matched ramps and signed middle section. Validated by: `scripts/test_5k_physics_controller.mjs`.
166. Verify that detours support zero-width ramps without invalid endpoint arithmetic. Validated by: `scripts/test_5k_physics_controller.mjs`.
167. Verify that overlapping slow zones use the strictest limit and release it past the interval. Validated by: `scripts/test_5k_physics_controller.mjs`.
168. Check that reserving stop reaction room moves braking earlier on the lane law. Validated by: `scripts/test_5k_physics_controller.mjs`.
169. Pin the short-stop pursuit point to half the available room. Validated by: `scripts/test_5k_physics_controller.mjs`.
170. Verify that a passed stop line still leaves a usable minimum pursuit point. Validated by: `scripts/test_5k_physics_controller.mjs`.
171. Check that preset selection updates global planning grip without disabling the local surface. Validated by: `scripts/test_5k_physics_controller.mjs`.
172. Verify the clock remains paused with an extreme elapsed sample when rate is zero. Validated by: `scripts/test_5k_physics_time_render.mjs`.
173. Exercise changing from accelerated time to real time while preserving elapsed daylight. Validated by: `scripts/test_5k_physics_time_render.mjs`.
174. Check that changing to an unsupported rate charges earlier time at the previous rate. Validated by: `scripts/test_5k_physics_time_render.mjs`.
175. Verify that setting the hour first accounts for an elapsed midnight rollover. Validated by: `scripts/test_5k_physics_time_render.mjs`.
176. Check that the formatted clock pads fields and avoids a one-minute rounding error. Validated by: `scripts/test_5k_physics_time_render.mjs`.
177. Pin world-option range clamping for enormous decimal text without accepting fractional seed or traffic values. Validated by: `scripts/test_5k_physics_time_render.mjs`.
178. Distinguish fog visibility and desired-speed scaling from fog grip. Validated by: `scripts/test_5k_physics_time_render.mjs`.
179. Pin the distance threshold for snapping render teleports at exactly 12 m. Validated by: `scripts/test_5k_physics_time_render.mjs`.
180. Pin the angular threshold for a render heading reset at exactly a quarter-turn. Validated by: `scripts/test_5k_physics_time_render.mjs`.
181. Check the short arc when a render actor crosses the negative angle wrap. Validated by: `scripts/test_5k_physics_time_render.mjs`.
182. Verify reusable render capture leaves unrelated actor properties out of the sample. Validated by: `scripts/test_5k_physics_time_render.mjs`.
183. Pin the distinct centre and bumper offsets for a custom short-overhang body. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
184. Verify that right-positive vehicle-local coordinates are clockwise from the heading. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
185. Exercise the intended floating-point tolerance at an exact dynamic substep multiple. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
186. Check the forward-only bicycle speed clamp after an explicit reverse request. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
187. Verify that a kinematic turn consumes no more than the available lateral grip. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
188. Pin dry comfort ceilings when a surface is grippier than dry asphalt. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
189. Check comfort's low-grip floor separately from the unfloored physical hard-braking limit. Validated by: `scripts/test_5k_physics_vehicle.mjs`.
190. Show a firm stop can use more deceleration than the comfortable stop with the same room. Validated by: `scripts/test_5k_physics_controller.mjs`.
191. Check that a lane law with no active stop retains normal pursuit even if stop steering was requested. Validated by: `scripts/test_5k_physics_controller.mjs`.
192. Pin route-based hard braking to steering on the planned offset line. Validated by: `scripts/test_5k_physics_controller.mjs`.
193. Check that a fixed-steer law can execute without route geometry. Validated by: `scripts/test_5k_physics_controller.mjs`.
194. Exercise braking under a zero curve ceiling when the lane law requests a higher speed. Validated by: `scripts/test_5k_physics_controller.mjs`.
195. Check that disabling one proportional pedal leaves the other available. Validated by: `scripts/test_5k_physics_controller.mjs`.
196. Verify that a lightweight recovery pose can still use the default wheelbase. Validated by: `scripts/test_5k_physics_controller.mjs`.
197. Check that restoring a replay time anchor permits seeking to an earlier clock state. Validated by: `scripts/test_5k_physics_time_render.mjs`.
198. Keep decimal exponent parsing separate from radix-prefixed clock text. Validated by: `scripts/test_5k_physics_time_render.mjs`.
199. Pin render teleport snapping even at the beginning of a discontinuous interval. Validated by: `scripts/test_5k_physics_time_render.mjs`.
200. Verify that a finite render capture can replace a previous invalid sample in place. Validated by: `scripts/test_5k_physics_time_render.mjs`.
