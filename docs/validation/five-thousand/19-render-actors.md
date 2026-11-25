# Vehicle and actor rendering

The browser feature adapter now owns vehicle and pedestrian views, including the meshes, frame effects and cleanup. The batch improves vehicle cues, replay lighting, parked-car restoration and shared mesh resources. Three scene graphs matched the original actor frame wiring before the visual changes.

1. Route moving vehicle factories and animators through paired entries in the browser feature adapter. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
2. Move separately drawn roadside vehicles, work zones, lane closures and delivery stops behind one parked-actor entry point. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
3. Mount transit stops, streetcar tracks and rail scenery through the adapter in their original draw order. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
4. Move child, worker and guard mesh creation and crowd updates out of the app frame loop. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
5. Move traffic and feature-actor interpolation capture and retirement into the actor adapter. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
6. Keep contraflow riders and backing cars in a shared actor lifecycle alongside fleet traffic. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
7. Dispatch vehicle hump and pothole effects from the adapter. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
8. Route high-beam, reversing-lamp and tailgater effects through the model that can render them. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
9. Index next-checkpoint vehicles and people once per replay frame before matching them by ID. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
10. Interpolate replay geometry without showing the next checkpoint’s signal, doors or siren early. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
11. Hold the current replay actor through a teleport or incompatible model change. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
12. Avoid writing a render-only high-beam override into the supplied ego state. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
13. Replace a moving mesh when a checkpoint restores a different kind, paint, body style or destination under the same ID. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
14. Resolve parking notifications against final bay occupancy when a car pulls out and parks again between draws. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
15. Apply parked-instance visibility from restored occupancy, even when a checkpoint contains stale notifications. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
16. Retire meshes and private GPU resources when vehicles leave the fleet or their parking space. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
17. Retire an open door’s render resources when it closes or its checkpoint is replaced. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
18. Deduplicate disposal of resources used by several children of one actor. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
19. Release retired instance attributes separately from instanced geometry and materials. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
20. Keep shared body, paint and sign caches live when one of their actors retires. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
21. Release detached high-beam and tailgater lens materials along with the rest of the vehicle. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
22. Bound wheel rotation angles and share wheel synchronization across road vehicle types. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
23. Ignore nonfinite wheel speeds and invalid animation time without corrupting transforms. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
24. Keep animation interpolation from running backward on a negative frame sample. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
25. Calculate brake lamp demand from signed-speed magnitude so slowing in reverse lights the brakes. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
26. Take the initial brake sample from the current vehicle speed. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
27. Update tail-lamp lighting when a frame refreshes with zero elapsed animation time. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
28. Normalize flash phase for negative samples around the start of a replay. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
29. Advance strobe phases between recorded checkpoints. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
30. Clear inherited wheel, suspension and road-effect history when a replay jumps. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
31. Restore transit door and school-bus stop-arm positions immediately after a paused seek. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
32. Let car headlights be attached twice without duplicating spotlights and targets. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
33. Resolve reverse-lamp placement from the rendered vehicle specification when the sampled state omits it. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
34. Hide previously mounted reverse lamps after traffic parking is switched off. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
35. Stop fallen pedestrians’ walk cycles. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
36. Lower fallen pedestrians’ umbrellas. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
37. Supply a finite pedestrian stride when a checkpoint lacks walk phase. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
38. Reset the officer’s turning animation when replay jumps. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
39. Track officers and their render-only cruisers independently when either goes away. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
40. Use elapsed time to turn work-zone flagger paddles at a consistent speed. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
41. Restore the flagger’s current paddle face after rewinding. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
42. Cull each goose against the current view rather than a gaggle marker near the car. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
43. Stream only the active goose instance matrices to the GPU. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
44. Animate van turn lamps when it pulls away from a delivery stop. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
45. Display collection-truck turn indicators independently of its stopped hazards. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
46. Make commercial vehicle headlamps follow visibility with independent lens materials. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
47. Add brake lights to ambulances and fire trucks. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
48. Use the van’s existing tail-lamp housings to signal braking. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
49. Show the collection truck’s deceleration in its rear lamps. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
50. Make the plow’s rear lamps respond to braking during snow work. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
51. Provide rear-facing red markers on the heritage car in place of a rear white headlamp. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
52. Split each transit bus doorway into moving paired leaves that clear the opening. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
53. Display the transit bus route number at its rear. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
54. Connect the school bus stop sign to its swing pivot with a visible linkage. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
55. Give bicycle wheels a steerable front pivot at the simulated wheelbase. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
56. Place the police SUV’s push bar and light bar using its body bounds, excluding the projected headlight pool. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
57. Use the same parked and moving car style selection for missing and out-of-range style indices. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
58. Avoid constructing parking materials for an empty parking batch. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
59. Exclude hidden parked bodies from close wheel-detail selection. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
60. Size the swinging door panel from its simulated obstacle dimensions. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
61. Align the dark door opening with the actual owner’s width. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
62. Add bicycle spokes and hubs so wheel motion is visible. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
63. Seat the bicycle rider over a visible saddle. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
64. Make the bicycle head-on view readable with a front lamp. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
65. Mark the back of the bicycle with a red reflector. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
66. Break the articulated streetcar roof across its joints. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
67. Batch a model’s rigid equipment into shared vertex-coloured geometry. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
68. Expose named vertex ranges for the batched equipment so individual parts can be inspected. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
69. Mark both transit-bus boarding thresholds at the curb. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
70. Fit the transit bus with long-arm cab mirrors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
71. Add rear mudflaps to the transit bus. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
72. Mark the bus’s rear bumper with reflectors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
73. Mark the transit bus’s flank with amber side markers. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
74. Add the transit bus’s ribbed rear radiator grille. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
75. Give the transit bus’s tail a recessed plate silhouette. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
76. Add a wiper to the transit bus’s driver windshield. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
77. Extend the school bus’s mirrors past the cab sides. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
78. Outline the school bus’s rear emergency door. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
79. Mark the school bus’s upper rear clearance. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
80. Add school-bus hood corner markers. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
81. Put a low boarding step at the school-bus curb door. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
82. Give the school bus’s rear emergency exit a distinct handle. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
83. Add the school bus’s rear exit step. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
84. Give the school-bus stop arm a fixed hinge housing. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
85. Add the school bus’s front registration plate. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
86. Rib the streetcar’s accordion joints. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
87. Mark each streetcar boarding threshold. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
88. Define the outer cab window edges with corner posts. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
89. Mark the upper rear of the modern streetcar. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
90. Add low side reflectors to long streetcar panels. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
91. Give the streetcar’s rear roof pod visible vent slats. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
92. Add the streetcar’s front coupler socket. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
93. Show the insulated mount under the modern streetcar’s pantograph. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
94. Vent the heritage car’s raised clerestory roof. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
95. Show the heritage car’s boarding steps. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
96. Give the heritage car’s platforms vertical grab rails. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
97. Rib the heritage car’s front fender. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
98. Add the heritage car’s rear marker housings. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
99. Show where the heritage trolley pole contacts the overhead wire. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
100. Give the heritage car a projecting front tow coupling. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
101. Give the heritage car a rear coupling under its platform. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
102. Mark the cargo van’s twin rear doors with hinges. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
103. Add grips to the delivery van’s cab doors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
104. Outline the van’s cab sides with mirror housings. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
105. Give the van’s rear bumper reflective corners. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
106. Place mudflaps behind the delivery van’s rear tires. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
107. Give the van’s sliding cargo door a distinct right-side grip. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
108. Show the release for the van’s rear cargo doors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
109. Add a high-mounted brake-lamp lens to the van’s rear body. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
110. Add a rear registration plate to the delivery van. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
111. Add slip-resistant surfaces to the collection crew’s rear steps. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
112. Place the hopper control panels at the back of the collection body. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
113. Make the collection truck’s tailgate hinge visibly separate from the packer. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
114. Protect the collection body’s bottom edge with a visible side rail. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
115. Mark the collection truck’s hopper edges with reflectors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
116. Add a lower access step under the collection cab doors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
117. Add the collection truck’s slatted front grille. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
118. Give the collection truck a low rear underride bar. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
119. Show the collection body’s rear camera above the hopper. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
120. Add a distinct cutting edge to the snowplow blade. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
121. Mark the angled blade’s outer tips with clearance guides. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
122. Add end grips to the snowplow blade. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
123. Connect the snowplow’s elevated headlamps to their supports. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
124. Show the chain housings on the plow’s dump tailgate. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
125. Mark the plow’s rear spreader with reflectors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
126. Add a spinner to the underside of the plow’s salt spreader. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
127. Define the top rail at the back of the plow’s dump body. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
128. Show where the plow’s folded wing mounts to its side. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
129. Fit the ambulance’s patient doors with hinges. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
130. Add windows to the ambulance’s patient doors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
131. Mark the ambulance module’s rear clearance. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
132. Give the ambulance module external side-door handles. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
133. Add cab mirror housings to the ambulance. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
134. Separate the ambulance’s twin patient doors with a center seam. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
135. Give the ambulance’s rear loading step a grip surface. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
136. Show the handle on the ambulance’s rear patient compartment. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
137. Add slip-resistant rear steps to the fire engine. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
138. Place entry treads beneath the fire engine’s cab doors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
139. Identify the fire engine’s side pump controls with a contrasting panel. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
140. Show capped hose outlets on the fire engine’s pump panel. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
141. Mark the fire engine cab’s roof clearance. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
142. Place reflective strips on the fire engine’s rear corners. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
143. Add a recovery point to the fire engine’s front bumper. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
144. Mark the tow truck’s rear wheel-lift corners with reflectors. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
145. Show a fairlead for the tow truck’s winch cable. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
146. Add side toolbox doors to the tow truck. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
147. Place external handles on the tow truck toolboxes. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
148. Give the tow operator a cab access step. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
149. Add a warning strip across the tow truck’s rear. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
150. Mark the tail of the tow boom with a warning panel. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
151. Give the tow truck a separate front grille. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
152. Rail the upper edges of the road crew’s dump body. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
153. Make the road crew’s dump tailgate latches visible. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
154. Mark the road crew truck’s low rear corners. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
155. Show the supports under the crew truck’s raised arrow board. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
156. Add a folded sign housing alongside the road crew’s bed. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
157. Add the crew truck’s front grille. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
158. Add a stepped front bumper to the crew truck. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
159. Give the crew truck a rear registration plate. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
160. Cover the adapter’s ability to mount an ordinary car for an unknown kind. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
161. Cover the adapter’s distinction between fleet bicycles and contraflow bicycles. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
162. Cover selecting a school-bus mesh for the school-bus actor kind. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
163. Cover fire-engine selection separately from ambulance selection. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
164. Cover the delivery van’s moving and parked roles in the same frame. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
165. Cover roadside tow and police meshes coexisting in one frame. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
166. Pause wheel, door and actor effect animation when the live scene or replay is paused. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
167. Cover the active and inactive work-zone arrow phases in the integrated frame. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
168. Cover the lane-closure truck’s arrow board in the integrated frame. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
169. Cover school crossing guards raising and lowering their signs in the active crowd. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
170. Cover transient schoolchildren leaving the crowd after a checkpoint restore. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
171. Cover the feature adapter retaining handles used by feature notices. Validated by: `scripts/test_5k_render-actors_adapter.mjs`.
172. Compare mixed actor scene graphs over three frames against the original frame wiring. Validated by: `scripts/test_5k_render-actors_adapter.mjs --scene-digest` against the renderer wiring from `0583591`.
173. Cover a strong high beam extending the ego’s spotlight range. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
174. Cover returning to the low-beam ground projection after a high beam. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
175. Cover an ordinary car’s indicators alternating and lighting only the signalled side. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
176. Cover the school bus selecting amber or red as instructed by the simulation. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
177. Cover the school bus lighting only one side during a red warning phase. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
178. Cover emergency strobes alternating halves only when the siren is active. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
179. Cover the snowplow’s blue and amber beacons alternating independently. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
180. Cover the collection truck’s cab and tailgate beacons operating in pairs. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
181. Cover the officer’s beckoning arm going still when the junction is held. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
182. Cover the rider leaning into a turn. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
183. Cover the rider’s crank angle holding at zero elapsed time. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
184. Cover geese selecting the gosling mesh after crossing the culling boundary. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
185. Cover speed-hump lift composing with pothole pitch on the render mesh. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
186. Cover the parked door being positioned in the owner’s local frame. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
187. Cover children’s body scale relative to an adult using the same appearance seed. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
188. Cover opposite stride phases for the pedestrian’s left and right hips. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
189. Cover pedestrian head and torso bob returning to rest after walking. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
190. Cover a culled pedestrian reappearing when moved back into camera range. Validated by: `scripts/test_5k_render-actors_motion.mjs`.
191. Cover the car’s suspension pivot matching the model’s center of gravity. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
192. Cover the pickup’s front axle position matching its wheelbase. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
193. Cover the pickup’s wheel track matching its model specification. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
194. Cover the front lamps aligning with the model’s nose. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
195. Cover the hood camera rising with the model’s body height. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
196. Cover paint variants keeping their colour while sharing car body geometry. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
197. Cover the front road bus and modern streetcar signs retaining the complete destination text. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
198. Cover the modern streetcar’s four pairs of door leaves on the curb side. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
199. Cover the heritage vehicle’s trolley pole reaching overhead. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
200. Cover red and white fire-engine lenses and the ambulance’s additional blue. Validated by: `scripts/test_5k_render-actors_parts.mjs`.
