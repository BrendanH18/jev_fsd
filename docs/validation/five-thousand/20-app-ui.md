# App UI and HUD

The driving app now handles interrupted routing, unavailable graphics and delayed model setup more clearly. The HUD, AI Eyes, inspector, Explorer and Photo Mode present more useful readouts, remember display choices and avoid redundant frame work. Boat checks cover the browser flows and the supporting UI contracts.

1. Report an unreachable simulator server as a connection failure. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
2. Preserve cancellation from both fetch and response-body parsing. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
3. Report unreadable JSON immediately on successful HTTP responses. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
4. Keep the HTTP status available even when an error response contains HTML. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
5. Accept null, primitive and malformed error bodies without dropping the HTTP status. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
6. Cover the upstream Jev status on a structured API error. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
7. Explain when browser storage prevents a benchmark watch link from loading. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
8. Explain how to recover a watch link whose saved drive is missing. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
9. Give corrupt benchmark watch data a recovery message. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
10. Reject incomplete benchmark watch data before constructing a scenario. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
11. Share a single cancellable request between Explore, scenic drives and the minimap. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
12. Cancel a pending minimap lookup when selecting a precomputed suggested route. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
13. Discard both success and failure responses from superseded routes. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
14. Keep missing-route feedback from a suggested drive visible on the minimap. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
15. Show an explicit busy state while rechecking a suggested route. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
16. Report a malformed route list separately from an unreachable destination. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
17. Reject missing geometry before trying to build a route. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
18. Reject a non-finite destination before trying to install a route. Validated by: `scripts/test_5k_app-ui_requests.mjs`.
19. Cancel routing when entering a recorded frame so the preview cannot be overwritten by live work. Validated by: `scripts/test_browser_pages.py --group ui`.
20. Cancel pending route lookups when graphics disconnect. Validated by: `scripts/test_browser_pages.py --group ui`.
21. Cancel route work and release held input if the simulation stops after an error. Validated by: `scripts/test_browser_pages.py --group ui`.
22. Explain when the simulator returns incomplete map settings. Validated by: `scripts/test_browser_pages.py --group ui`.
23. Explain when the map has no drivable streets. Validated by: `scripts/test_browser_pages.py --group ui`.
24. Identify WebGL initialization failures as graphics startup errors. Validated by: `scripts/test_browser_pages.py --group ui`.
25. Distinguish checking simulator status from downloading streets and traffic controls. Validated by: `scripts/test_browser_pages.py --group ui`.
26. Wait through all synchronous setup before removing the loading overlay. Validated by: `scripts/test_browser_pages.py --group ui`.
27. Restore the startup barrier if setup fails after exposing controls. Validated by: `scripts/test_browser_pages.py --group ui`.
28. Preserve weather, graphics and other drive options when using the free-drive recovery link. Validated by: `scripts/test_browser_pages.py --group ui`.
29. Pause the drive and offer a reload after WebGL context loss. Validated by: `scripts/test_browser_pages.py --group ui`.
30. Prevent a lost graphics context from receiving new frame draws. Validated by: `scripts/test_browser_pages.py --group ui`.
31. Open a challenge in manual mode when its requested driver is unavailable. Validated by: `scripts/test_browser_pages.py --group ui`.
32. Reject inherited driver object properties as driver IDs. Validated by: `scripts/test_browser_pages.py --group ui`.
33. Release all current control sources when the model setup dialog pauses driving. Validated by: `scripts/test_browser_pages.py --group ui`.
34. Reject non-finite numeric preferences on read and on validated write. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
35. Allow controls to validate stored values against their supported domain. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
36. Report whether a preference write succeeded. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
37. Allow individual display preferences to be reset. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
38. Reuse preference validation for legacy raw settings without migrating existing storage keys. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
39. Use a valid saved graphics quality when the URL quality is unknown. Validated by: `scripts/test_browser_pages.py --group ui`.
40. Remove a prior graphics URL override when the driver chooses a new quality. Validated by: `scripts/test_browser_pages.py --group ui`.
41. Offer a return to the system camera motion preference. Validated by: `scripts/test_browser_pages.py --group ui`.
42. Preserve other history state while reflecting drive conditions in the URL. Validated by: `scripts/test_browser_pages.py --group ui`.
43. Show an exact clock value in Settings when the time is between presets. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
44. Restore the clock rate and time readout when seeking a recording. Validated by: `scripts/test_browser_pages.py --group ui`.
45. Show enabled feature switch counts while editing. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
46. Distinguish unapplied feature switches from the active drive settings. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
47. Disable bulk enabling or disabling when it would change no feature switch. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
48. Avoid a restart when feature switches match the original configuration. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
49. Restart directly into the configured drive after applying feature switches from Explore. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
50. Focus the first usable Settings selector on keyboard activation. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
51. Return shortcut-help focus to its button if the opener disappeared. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
52. Keep modified navigation shortcuts out of the driver radio controls. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
53. Prevent driver radio navigation from reaching driving controls. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
54. Avoid reselecting the current driver on a redundant radio navigation action. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
55. Keep a visible tab stop available when the active model pillar is hidden. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
56. Avoid offering a hidden model menu in the driver tooltip. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
57. Distinguish model unavailability from the built-in Jev key prompt. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
58. Avoid rebuilding the map attribution when it has not changed. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
59. Cache the rolling median latency until another measured decision arrives. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
60. Ignore negative and non-finite latency samples. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
61. Cover exclusion of local latency from the rolling model readout. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
62. Expire decision timestamps without allocating a replacement array on each HUD tick. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
63. Avoid a speed warning when the road has no known limit. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
64. Show unavailable speed and speed limit measurements as a dash. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
65. Identify reverse travel in the manual driving HUD. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
66. Normalize absent incident counters to zero. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
67. Give short turn distances metre-level resolution. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
68. Show a distance rounded to one kilometre in kilometre units. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
69. Keep missing navigation distances from becoming NaN labels. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
70. Use conversational directions for slight and sharp turns. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
71. Present a useful instruction for an unknown turn code. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
72. Direct a driver back to the highlighted route when route guidance is unavailable. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
73. Make the paused navigation hint usable without letter shortcuts. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
74. Share friendly decision source labels across HUD and inspector. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
75. Show a dash for unknown decision latency instead of a zero-millisecond response. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
76. Distinguish a measured zero-token decision from a missing token count. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
77. Explain when no candidate passes the safety checks. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
78. Ignore vector probabilities for absent candidates. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
79. Filter out non-numeric and out-of-range probabilities before drawing bars. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
80. Draw a genuinely empty bar for a zero-probability decision. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
81. Render candidate rule flags as readable words. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
82. Describe lane changes as actions with optional target speeds. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
83. Avoid NaN in descriptions of manoeuvres with no target speed. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
84. Name stop-line actions even when older trace data lacks a speed label. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
85. Describe a steer law without a direction as creeping forward. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
86. Round lateral nudges to readable precision. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
87. Keep a lower-priority notice from immediately replacing a driving alert. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
88. Coalesce overlapping collision flashes into one visual effect. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
89. Let transit and crosswalk warnings reappear when the road user becomes relevant again. Validated by: `scripts/test_browser_pages.py --group ui`.
90. Repeat a siren notice when the same emergency vehicle becomes relevant again. Validated by: `scripts/test_browser_pages.py --group ui`.
91. Reuse cached DOM references for the instrument controls updated every frame. Validated by: `scripts/test_browser_pages.py --group ui`.
92. Build the full conditions readout only when a visible measurement changes. Validated by: `scripts/test_browser_pages.py --group ui`.
93. Skip finding the nearest gong while sound is off and avoid intermediate train arrays. Validated by: `scripts/test_browser_pages.py --group ui`.
94. Skip measuring siren distance while sound is off. Validated by: `scripts/test_browser_pages.py --group ui`.
95. Avoid rewriting the windshield and rain droplet visibility while camera and weather stay steady. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
96. Skip updating windshield wipers when their displayed angle is unchanged. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
97. Relate the AI Eyes switch to its associated panel. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
98. Document amber hazards and magenta sirens in the AI Eyes legend. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
99. Reset AI Eyes to its observing message on reopen. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
100. Return focus to the AI Eyes switch when closing its focused panel. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
101. Avoid rebuilding the AI Eyes summary and hazard badges when their visible content is unchanged. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
102. Avoid replacing the AI Eyes candidate rejection rows when the visible list is unchanged. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
103. Keep AI Eyes expansion focus across live content updates. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
104. Publish the candidate rejection disclosure state to assistive technology. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
105. Omit unavailable AI Eyes measurements from the summary. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
106. Remember the last inspector tab. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
107. Remember candidate overlay visibility. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
108. Apply the saved candidate overlay preference before the first frame. Validated by: `scripts/test_browser_pages.py --group ui`.
109. Refresh the inspector immediately when releasing a stale pin. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
110. Avoid serializing the same inspector decision for a redundant update. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
111. Reset the inspector scroll position when switching tabs. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
112. Explain when a decision has no recorded state. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
113. Explain when a decision asked no questions. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
114. Preserve the exact text of LLM prompt messages in the inspector. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
115. Show the selected answer for a local answer without probabilities. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
116. Show the executed manoeuvre in driving terms in the Answers tab. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
117. Keep the inspector JSON export synchronized with the displayed decision totals. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
118. Read out the absence of a value when a selected inspector tab cannot be copied. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
119. Report a blocked clipboard consistently for both inspector copy actions. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
120. Quote endpoint URLs and request bodies as literal shell arguments in copied commands. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
121. Only interpolate valid environment variable names in copied authorization headers. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
122. Present blank snapshot names as form errors. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
123. Keep snapshot save errors visible in the form while the inspector is open. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
124. Mark the snapshot form busy and make its submitted name read-only until the request settles. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
125. Remember the preferred Explorer sort order. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
126. Defer the map catalog request until Explorer opens. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
127. Skip malformed and duplicate catalog entries. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
128. Skip malformed suggested drives instead of creating unusable cards. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
129. Offer a clear-filters action even when some map results remain. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
130. Avoid sending a map switch request for an unknown or already current map. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
131. Recover when opening a neighbourhood reports a failure without throwing. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
132. Use singular count labels for a single road, signal, turn or stop. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
133. Leave unknown counts out of Explorer map and suggested-drive cards. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
134. Skip invalid preview bounds and break preview strokes at invalid points. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
135. Keep a separate capture status so moving the Photo Mode camera cannot erase a save result. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
136. Remember the Photo Mode composition grid. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
137. Restore the previous scene grade after exiting Photo Mode. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
138. Provide a reset for Photo Mode weather and time. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
139. Show the actual scene time before the Photo Mode slider is moved. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
140. Expose formatted grading values for the Photo Mode sliders. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
141. Disable unavailable post-processing controls on low graphics. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
142. Focus the reveal action after hiding the Photo panel. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
143. Discard a photo download callback from a closed Photo Mode session. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
144. Report the captured canvas size even if the viewport has subsequently changed. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
145. Handle empty graphics captures and download failures with a retryable status. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
146. Keep a truncated photo filename free of a trailing slug separator. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
147. Use a readable photo filename when its timestamp is invalid. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
148. Allow photo actions to wrap on narrow panels. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
149. Keep long driving notices within the viewport and pointer input available. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
150. Skip redundant master gain ramps while the target gain is unchanged. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
151. Allow sound to be switched off without resuming a suspended device. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
152. Make audio setup errors retryable without retaining a partial audio graph. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
153. Skip synthesizer updates while the drive is paused or the document is hidden. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
154. Keep non-finite vehicle measurements from reaching audio parameters. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
155. Clear the previous gong strike when no train is ringing. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
156. Avoid creating inaudible gong and horn oscillators. Validated by: `scripts/test_5k_app-ui_readouts.mjs`.
157. Cancel provider model lookups when switching tabs, providers or closing setup. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
158. Invalidate model suggestions immediately after changing credentials or the server URL. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
159. Keep the current model edit when reselecting its provider. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
160. Clear the previous custom endpoint when choosing a provider preset. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
161. Validate a custom server URL before testing it. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
162. Keep unavailable provider tabs out of the model setup keyboard navigation. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
163. Announce connection-test progress and prevent duplicate probes. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
164. Keep only distinct usable model IDs returned by a provider. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
165. Support providers returning an output price without an input price. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
166. Keep the full precision of listed model prices. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
167. Preserve hand-edited prices if the current model's catalog refreshes. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
168. Prevent saving a model without an ID. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
169. Apply native numeric price validity before saving. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
170. Serialize saves and removals to prevent overlapping configuration mutations. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
171. Discard auto-selection from a save that finishes after the dialog was closed. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
172. Mask a successfully saved key even when the setup dialog remains on screen. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
173. Make the setup status distinguish save errors from removal errors. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
174. Keep model menu items out of the ordinary Tab sequence. Validated by: `static/tests/ui-tests.js and static/tests/explorer-tests.js`.
175. Keep candidate paths visible while AI Eyes is active even if the independent candidate setting is off. Validated by: `scripts/test_browser_pages.py --group ui`.
176. Redraw the current candidate paths immediately when the overlay is re-enabled. Validated by: `scripts/test_browser_pages.py --group ui`.
177. Keep a selected graphics quality in the URL when browser storage cannot save it. Validated by: `scripts/test_browser_pages.py --group ui`.
178. Cover base-relative links to a simulator page. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
179. Cover preservation of coordinate pairs in benchmark URLs. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
180. Cover escaping reserved characters in authored drive links. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
181. Cover elapsed-time display at and below one second. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
182. Cover zero and sub-cent model cost precision. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
183. Cover model costs above one cent at four decimal places. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
184. Cover the empty latency percentile result. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
185. Cover computing rolling percentiles without mutating the source samples. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
186. Cover the upper bound of the percentile index. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
187. Cover the hard-brake label when manoeuvre law data is absent. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
188. Cover the direction label for a reverse manoeuvre. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
189. Cover the lane-offset label when the vehicle must stop. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
190. Cover a target under walking speed being labeled as creeping. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
191. Cover grading limits for contrast and saturation. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
192. Cover Explorer search with whitespace between words. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
193. Cover province filters rejecting otherwise matching neighbourhoods. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
194. Cover Explorer showing all maps for a whitespace-only query. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
195. Cover unique feature switches when both the core list and registry name a flag. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
196. Cover lowercase URL flags for feature switches. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
197. Cover the clipboard preserving a multiline inspector value. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
198. Cover clipboard access when the Clipboard API is unavailable. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
199. Cover sending a route selection as JSON with its abort signal. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
200. Cover sending a request with no body as a GET. Validated by: `scripts/test_5k_app-ui_compatibility.mjs`.
