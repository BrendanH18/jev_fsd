# Input and accessibility

Keyboard, gamepad and touch inputs release cleanly across focus changes. The simulator, Arena, Benchmark and Results pages expose clearer controls, focus destinations and context. The checks exercise input state, accessibility relationships and the browser controls.

1. Expose the driving simulator in the main landmark. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
2. Provide a direct keyboard jump to driving settings. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
3. Provide a direct keyboard jump to the route minimap. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
4. Expose that Explore cities opens a dialog. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
5. Explain the free-drive recovery link before it replaces the requested drive. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
6. Disambiguate map loading from a drive restart in startup recovery. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
7. Provide the Rules brain shortcut and initial selected state. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
8. Provide the Decision brain shortcut and initial unselected state. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
9. Provide the LLM brain shortcut and initial unselected state. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
10. Expose arrow-key access to the Decision and LLM model pickers. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
11. Expose the autopilot toggle shortcut. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
12. Expose the chase-view cycling shortcut. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
13. Expose the sound toggle shortcut. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
14. Expose both ways to open keyboard help. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
15. Expose the Photo Mode shortcut. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
16. Expose the pause and resume shortcut. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
17. Expose the inspector shortcut from the decision card. Validated by: `tests/test_5k_input-a11y_markup.py::test_shortcut_hints`.
18. Expose the inspector dismissal key. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
19. Expose the shortcut help dismissal key. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
20. Give the simulator canvas a fallback for text-only browsers. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
21. Expose precise Shift-arrow navigation alongside standard minimap shortcuts. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
22. Give the minimap a fallback when canvas is unavailable. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
23. Explain that clearing the route keeps the current world. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
24. Name the route-guidance group independently of the minimap. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
25. Name the autopilot’s offered-manoeuvres group. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
26. Name the settings region so the Settings button’s destination is clear. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
27. Name which switches All on changes. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
28. Name which switches All off changes. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
29. Name the scope of the feature switch apply action. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
30. Explain that the weather setting affects grip as well as visibility. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
31. Explain that the time preset uses the map’s local clock. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
32. Explain which part of the simulation graphics quality controls. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
33. Explain fixed and advancing daylight when choosing a clock rate. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
34. Explain the scope and timing of traffic density changes. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
35. Identify the valid world seed range and when a seed takes effect. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
36. Clarify whether randomising the seed restarts the world. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
37. Distinguish master volume from the separate mute button. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
38. Explain why to increase the gamepad dead zone. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
39. Identify which driving keys remain available when letter shortcuts are disabled. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
40. Explain the handedness layout independently of touch visibility. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
41. Explain what Automatic means in the touch visibility selector. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
42. Identify which view shows the windshield wipers. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
43. Clarify which motion the camera setting controls. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
44. Explain which pending settings start a new world. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
45. Explain when the chosen vehicle is applied. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
46. Explain when the selected paint is applied. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
47. Explain the difference between pinning decisions and pausing the drive. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
48. Explain what the inspector’s JSON and curl actions put on the clipboard. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
49. Clarify the inspector snapshot’s contents. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
50. Clarify where a custom driving style is sent. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
51. Identify where the candidate paths are drawn. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
52. Keep the inspector’s mixed snapshot and driving-style field from marking file names as spelling errors. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
53. Distinguish the posted speed limit from the current speed. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
54. Name the current speed independently of the posted limit. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
55. Give the world conditions label a role that exposes its name. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
56. Expose the instrument cluster as a named group. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
57. Expand p50 for readers unfamiliar with latency percentiles. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
58. Identify what the per-minute telemetry counter measures. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
59. Identify which tokens the HUD counts. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
60. Identify what contributes to the HUD cost counter. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
61. Distinguish failures to yield from successful yields in the incidents panel. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
62. Distinguish red-light violations from red lights encountered. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
63. Distinguish missed stops from stop signs encountered. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
64. Identify off-road time as a duration in the incidents panel. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
65. Expose the keyboard help title in screen-reader heading navigation. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
66. Give gamepad users a heading jump within the keyboard help dialog. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
67. Explain the manual keyboard controls in the shortcut reference. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
68. Document the triggerless gamepad pedal fallback in the in-app reference. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
69. Show the slash alternative in the shortcut reference. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
70. Provide a direct keyboard jump to Arena evaluation controls. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
71. Provide a direct keyboard jump past Arena settings and history to measured results. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
72. Name the Arena navigation landmark. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
73. Let keyboard users scroll the Arena’s wide table independently. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
74. Name the Arena’s measured attempts table for table navigation. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
75. Announce Arena model availability as it loads. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
76. Expose the connection between the Arena subset selector and individual drive selection. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
77. Relate Arena progress to its current run announcement. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
78. Identify which progress and results change after an Arena run. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
79. Announce the complete Arena result count when it changes. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
80. Announce Arena baseline compatibility after a selection. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
81. Identify which results are affected by clearing Arena filters. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
82. Explain the practical difference between Arena decision clocks. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
83. Explain what changes on Arena’s open track without relying on hover text. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
84. Clarify that the option adds longer road tests to the Arena. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
85. Tell keyboard users that Arena custom selection supports multiple drives. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
86. Clarify that an Arena module must be trusted and local. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
87. Disable autocorrection for Arena module paths. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
88. Identify the format and scope of the Arena run export. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
89. Explain what the Arena accepts for JSON import. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
90. Identify the scope of Arena saved-run deletion. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
91. Explain what qualifies for an Arena baseline comparison. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
92. Explain which evaluation the baseline driver list belongs to. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
93. Identify how Arena filters affect the CSV export. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
94. Expose the user’s saved manual attempts as a named Arena region. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
95. Provide a direct keyboard jump to benchmark controls. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
96. Provide a direct keyboard jump to benchmark results. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
97. Expose the Benchmark controls and output in the main landmark. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
98. Name the aggregate benchmark summary independently of route rows. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
99. Make the wide benchmark table reachable with keyboard scrolling. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
100. Name the benchmark’s per-route table for screen-reader navigation. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
101. Connect the benchmark Run button to the progress message and results. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
102. Announce the selected benchmark map and available model types when they load. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
103. Identify the table affected by benchmark route search. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
104. Identify the results affected by the failures-only filter. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
105. Explain the benchmark driver’s effect on live requests. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
106. Explain which geography changes with the benchmark map. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
107. Identify the benchmark scenario range and its held-out exception. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
108. Explain what the benchmark traffic count measures. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
109. Explain how to reproduce a benchmark route selection. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
110. Explain how the benchmark world preset changes opt-in features. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
111. Expose the benchmark track distinction without relying on a tooltip. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
112. Identify the added task when parking is enabled. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
113. Explain the benchmark hour field’s units and empty value. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
114. Explain syntax for opting individual benchmark features out. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
115. Preserve feature identifiers on mobile keyboards. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
116. Explain how to request a covering-array condition row. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
117. Clarify what enabling benchmark diagnostics collects. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
118. Distinguish saving a benchmark run from exporting a file. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
119. Explain which options the held-out route set overrides. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
120. Clarify which benchmark clock includes model latency. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
121. Explain how a benchmark chooses comparable routes. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
122. Clarify how viewing a saved benchmark run differs from running it again. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
123. Explain why filtering changes benchmark CSV exports. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
124. Explain why the full benchmark run is present in JSON exports. Validated by: `tests/test_5k_input-a11y_markup.py::test_contextual_help`.
125. Provide a direct keyboard jump to the published results summary. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
126. Move focus to the published summary heading when following a jump link. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
127. Move focus directly to published challenge results from their jump link. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
128. Move focus directly to the published open-track comparison from its jump link. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
129. Move focus directly to the published city suite from its jump link. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
130. Move focus to the replay heading when following either replay jump. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
131. Explain what the published suite-version filter compares. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
132. Distinguish primary results navigation from the in-page section links. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
133. Associate the world seed with its own label without making the Random button part of it. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
134. Give the keyboard help toggle a disclosure state. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
135. Expose benchmark options as their own named section. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
136. Expose benchmark results separately from the control panel. Validated by: `tests/test_5k_input-a11y_markup.py::test_elements`.
137. Release a driving key by its physical identity if its reported character changes. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
138. Keep driving until all physical keys for the same character have been released. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
139. Ignore stale driving-key repeats after the held state is cleared. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
140. Release keyboard driving at composition start. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
141. Respect shadow-tree editors and focused ARIA comboboxes when dispatching driving keys. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
142. Give arrow navigation priority in focused listboxes, trees and grids. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
143. Let focused overlays reserve character keys that would otherwise affect the drive. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
144. Ignore one-shot keyboard actions while the document is hidden. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
145. Block analog and keyboard driving while the window is blurred even if the page is visible. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
146. Release driving sources on pagehide before the next frame. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
147. Invalidate the sampled state on clear so consuming a stale pulse cannot resume driving. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
148. Avoid polling a source twice when it is registered twice. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
149. Treat malformed analog sources as neutral without coercing axis, pedal or hard-brake values. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
150. Discard the frame’s driving sample if polling opens a dialog. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
151. Keep character shortcut hints in sync with the user’s shortcut setting. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
152. Accept legacy boolean buttons on gamepads. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
153. Ignore malformed gamepad button press flags. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
154. Handle nonnumeric stick axes without throwing. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
155. Use the default stick dead zone when the supplied zone is invalid. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
156. Keep the current controller when another of the same mapping priority connects. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
157. Require a replacement controller to return to neutral before driving. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
158. Disarm the gamepad when an explicit input release occurs. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
159. Stop dispatching further gamepad actions when an action opens a dialog. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
160. Keep touch steering neutral for invalid coordinates and use the default scale for invalid ranges. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
161. Announce steering direction and percentage on the touch steering control. Validated by: `static/tests/ui-tests.js`.
162. Pair the touch steering pad with instructions for full and half travel. Validated by: `static/tests/ui-tests.js`.
163. Explain how to hold touch pedals and when the brake changes to reverse. Validated by: `static/tests/ui-tests.js`.
164. Stop mouse steering as soon as the pointer reports no held button. Validated by: `static/tests/ui-tests.js`.
165. Release steering or a pedal when a pointer without capture leaves it. Validated by: `static/tests/ui-tests.js`.
166. Release captured touch pointers when driving input is suspended. Validated by: `static/tests/ui-tests.js`.
167. Preserve browser and system chords when a pedal is focused. Validated by: `static/tests/ui-tests.js`.
168. Suppress pedal activation during input composition. Validated by: `static/tests/ui-tests.js`.
169. Keep stale key repeats from re-engaging released touch controls. Validated by: `static/tests/ui-tests.js`.
170. Show active styling when steering via the touch pad’s keyboard controls. Validated by: `static/tests/ui-tests.js`.
171. Prevent hidden pedals from accumulating input for when they reappear. Validated by: `static/tests/ui-tests.js`.
172. Keep the touch autopilot label stable as its pressed state changes. Validated by: `static/tests/ui-tests.js`.
173. Expose the live pause state on the touch pause button. Validated by: `scripts/test_browser_pages.py --group ui`.
174. Expose the active indicator state on the left and right touch actions. Validated by: `scripts/test_browser_pages.py --group ui`.
175. Restore keyboard focus to the touch setting or Settings opener when the controls disappear. Validated by: `scripts/test_browser_pages.py --group ui`.
176. Show a keyboard bypass link only when focused while keeping it in the tab order. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
177. Keep a focused Settings field clear of the sticky action footer. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
178. Improve canvas focus contrast against both dark roads and bright scenery. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
179. Draw a visible focus ring inside model picker options. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
180. Show keyboard focus on the Arena’s visually styled file input. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
181. Preserve touch pedal and steering contrast under autopilot. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
182. Give pressed pedals a visible shape cue in addition to colour. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
183. Keep the two-row touch strip inside short mobile viewports. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
184. Fit touch pedals and steering side by side on narrow phones. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
185. Honour the operating system’s increased-contrast preference in HUD panels. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
186. Keep the steering track and knob visible in forced-colour mode. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
187. Keep the selected paint marked in forced-colour mode. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
188. Preserve the contrasting keyboard minimap cursor in forced-colour mode. Validated by: `tests/test_5k_input-a11y_markup.py::test_css_keyboard_and_preference_rules`.
189. Cover independent accelerator aliases when an arrow key and a letter key are held together. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
190. Cover preserving sustained analog steering when an independent accelerator pulse expires. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
191. Cover preserving a configured gamepad trigger’s priority over the stick fallback. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
192. Cover independent fallback when only one gamepad trigger is missing. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
193. Cover preserving stick steering when opposite directional pad buttons cancel. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
194. Cover the automatic pointer fallback for an unrecognised touch query value. Validated by: `scripts/test_5k_input-a11y_input.mjs`.
195. Cover the touch brake releasing on pointer cancellation. Validated by: `static/tests/ui-tests.js`.
196. Cover the touch hard brake releasing when capture is lost. Validated by: `static/tests/ui-tests.js`.
197. Cover rejecting dangling ARIA relationship targets across the simulator pages. Validated by: `tests/test_5k_input-a11y_markup.py::test_relationship_targets`.
198. Cover keeping Arena baseline-driver selection unavailable until a baseline exists. Validated by: `tests/test_5k_input-a11y_markup.py::test_existing_report_controls`.
199. Cover permitting only the selected inspector tab in the initial tab sequence. Validated by: `tests/test_5k_input-a11y_markup.py::test_existing_inspector_contract`.
200. Cover unique element IDs across the four application pages. Validated by: `tests/test_5k_input-a11y_markup.py::test_document_contract`.
