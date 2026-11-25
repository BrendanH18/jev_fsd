# Arena, leaderboard and replay improvements

The leaderboard supports shareable filters and richer exports. The replay gallery opens at a selected moment and gives viewers finer playback controls. Arena history handles damaged or unavailable storage more reliably, and the debrief explains how published drives match the manual attempt.

1. Validate the published map catalog before map names reach the leaderboard. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
2. Reject malformed driver catalog records with the offending driver ID. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
3. Require a driver ID on a published run. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
4. Require a nonempty human-readable run label. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
5. Require a suite name on a published run. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
6. Reject malformed published suite version labels. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
7. Reject impossible published pass totals. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
8. Reject corrupt published dates before rendering date ranges. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
9. Require at least one source artifact per published run. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
10. Validate recording paths independently of report sources. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
11. Reject malformed model names in published results. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
12. Validate the attribution of submitted runs. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
13. Validate the track declared by a published run. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
14. Reject negative or fractional run-level flag counts. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
15. Reject malformed published costs. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
16. Validate published Rules fallback counts. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
17. Reject model decision shares outside zero to one. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
18. Require a map on each city result. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
19. Require a weather condition on each city result. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
20. Validate published failure detail lists. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
21. Require drive lists on published challenge and open-track runs. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
22. Require an ID for every published drive. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
23. Reject duplicate drive IDs within a published run. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
24. Require a map for each published drive. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
25. Require a Boolean drive verdict. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
26. Reject negative or nonnumeric published drive durations. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
27. Validate per-drive counts of flagged choices. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
28. Validate the shape of historical drive score inputs. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
29. Validate the shape of driven-corridor score inputs. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
30. Reject malformed per-drive incident counts. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
31. Resolve map labels only from entries the catalog owns. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
32. Render missing cost measurements as unavailable. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
33. Protect terminal replay commands from filenames beginning with a dash. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
34. Skip an explicitly open-track run when matching a guarded debrief comparison. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
35. Treat an unknown coverage filter as unfiltered. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
36. Keep an empty driver catalog from qualifying as complete coverage. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
37. Filter leaderboard challenges and road tests by map. Validated by: `scripts/test_browser_pages.py`.
38. Separate short challenges from road tests with a drive-type filter. Validated by: `scripts/test_browser_pages.py`.
39. Filter city results to one recorded weather. Validated by: `scripts/test_browser_pages.py`.
40. Filter rows to results available for a named driver. Validated by: `scripts/test_browser_pages.py`.
41. Apply pass and fail filters to the selected driver when one is chosen. Validated by: `scripts/test_browser_pages.py`.
42. Filter to failures without selecting clean drives with flags. Validated by: `scripts/test_browser_pages.py`.
43. Filter to rows where every measured driver passed. Validated by: `scripts/test_browser_pages.py`.
44. Isolate rows with split verdicts. Validated by: `scripts/test_browser_pages.py`.
45. Isolate flagged-choice rows on the open track. Validated by: `scripts/test_browser_pages.py`.
46. Search challenge failures by their published reason. Validated by: `scripts/test_browser_pages.py`.
47. Reset the active table's filters and return focus to its search field. Validated by: `scripts/test_browser_pages.py`.
48. Save each table's filter state in shareable URL parameters. Validated by: `scripts/test_browser_pages.py`.
49. Restore selected filters and sorting from the URL when the suite is redrawn. Validated by: `scripts/test_browser_pages.py`.
50. Restore the selected cohort and table filters on browser history navigation. Validated by: `scripts/test_browser_pages.py`.
51. Give the challenge matrix a sortable map column. Validated by: `scripts/test_browser_pages.py`.
52. Start duration sorting with the shortest measured drive. Validated by: `scripts/test_browser_pages.py`.
53. Sort challenge-driver columns by driven-corridor score. Validated by: `scripts/test_browser_pages.py`.
54. Sort challenge-driver columns by measured incident count. Validated by: `scripts/test_browser_pages.py`.
55. Sort open-track driver columns by flag count. Validated by: `scripts/test_browser_pages.py`.
56. Sort city-driver columns by raw cost. Validated by: `scripts/test_browser_pages.py`.
57. Sort city-driver columns by fallback count. Validated by: `scripts/test_browser_pages.py`.
58. Sort city-driver columns by run date. Validated by: `scripts/test_browser_pages.py`.
59. Sort city-driver columns by model decision share. Validated by: `scripts/test_browser_pages.py`.
60. Preserve subsecond precision in the challenge-duration readout. Validated by: `scripts/test_browser_pages.py`.
61. Label unavailable drive durations explicitly. Validated by: `scripts/test_browser_pages.py`.
62. Display driven-corridor scores where published input measurements support them. Validated by: `scripts/test_browser_pages.py`.
63. Label the table's absent attempts as not run. Validated by: `scripts/test_browser_pages.py`.
64. Provide a focusable horizontal scrolling region for each comparison matrix. Validated by: `scripts/test_browser_pages.py`.
65. Hide jump links whose sections are absent from the custom cohort. Validated by: `scripts/test_browser_pages.py`.
66. Complete direct jumps to visible results sections after the asynchronous table load. Validated by: `scripts/test_browser_pages.py`.
67. Allow a failed results request to be retried from the page. Validated by: `scripts/test_browser_pages.py`.
68. Describe parking and scenario-specific challenge verdict checks in the leaderboard. Validated by: `scripts/test_browser_pages.py`.
69. Distinguish unmeasured open flags from zero in the summary export. Validated by: `scripts/test_browser_pages.py`.
70. Identify the track of reported costs in the summary CSV. Validated by: `scripts/test_browser_pages.py`.
71. Include the drive type in challenge CSV exports. Validated by: `scripts/test_browser_pages.py`.
72. Include map IDs alongside human-readable map names in challenge CSV exports. Validated by: `scripts/test_browser_pages.py`.
73. Include track and suite labels in challenge CSV exports. Validated by: `scripts/test_browser_pages.py`.
74. Export per-driver failure reasons alongside challenge verdicts. Validated by: `scripts/test_browser_pages.py`.
75. Export driven-corridor scores alongside the original challenge scores. Validated by: `scripts/test_browser_pages.py`.
76. Identify the filters used for a challenge JSON export. Validated by: `scripts/test_browser_pages.py`.
77. Include a track, drive type and map label in challenge JSON exports. Validated by: `scripts/test_browser_pages.py`.
78. Split city pass fractions into numeric passed and total columns. Validated by: `scripts/test_browser_pages.py`.
79. Include map IDs and suite tags in city CSV exports. Validated by: `scripts/test_browser_pages.py`.
80. Include each city run’s date, cost, fallback count and model decision share in CSV. Validated by: `scripts/test_browser_pages.py`.
81. Preserve the active city filters in JSON export metadata. Validated by: `scripts/test_browser_pages.py`.
82. Include display map names in city JSON exports. Validated by: `scripts/test_browser_pages.py`.
83. Search the terminal recording catalog by driver, title or recording path. Validated by: `scripts/test_browser_pages.py`.
84. Filter the terminal recording list by suite version. Validated by: `scripts/test_browser_pages.py`.
85. Show a result count and a no-match message for terminal recordings. Validated by: `scripts/test_browser_pages.py`.
86. Offer manual text selection when copying a terminal replay command is denied. Validated by: `scripts/test_browser_pages.py`.
87. Show the replay engine even when an older terminal recording has no pinned source checkout. Validated by: `scripts/test_browser_pages.py`.
88. Bound the size of search text restored from a leaderboard URL. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
89. Keep missing metrics after measured values in both sort directions. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
90. Reject an invalid published replay verdict before showing it. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
91. Reject map dimensions that overflow or collapse. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
92. Require road polylines to contain at least two points. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
93. Reject nonpositive replay road widths. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
94. Require building outlines to have enough points to form a polygon. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
95. Require a time-zero frame for synchronized replay. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
96. Reject arrays masquerading as replay traffic dictionaries. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
97. Reject malformed traffic-light entries before drawing a frame. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
98. Validate decision timestamps against published replay duration and ordering. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
99. Validate the motion stored for a replay decision. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
100. Validate the manoeuvre identifier displayed in the decision log. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
101. Validate the reason attached to a flagged replay choice. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
102. Validate replay event chronology and duration. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
103. Reject empty replay event messages. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
104. Explain invalid JSON responses instead of exposing a parser exception. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
105. Honor replay cancellation when response decoding has already finished. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
106. Use binary timeline lookup for frames, choices and events during playback. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
107. Step across decisions less than fifty milliseconds apart. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
108. Open the gallery directly to the replay identified in the URL. Validated by: `scripts/test_browser_pages.py`.
109. Open a shared replay link at its recorded offset. Validated by: `scripts/test_browser_pages.py`.
110. Keep the gallery selection in the URL when selecting a different drive. Validated by: `scripts/test_browser_pages.py`.
111. Copy a link to the exact currently displayed replay moment. Validated by: `scripts/test_browser_pages.py`.
112. Offer the replay link as selectable text when clipboard access is denied. Validated by: `scripts/test_browser_pages.py`.
113. Download the selected browser replay as JSON. Validated by: `scripts/test_browser_pages.py`.
114. Offer quarter-speed playback for inspecting short manoeuvres. Validated by: `scripts/test_browser_pages.py`.
115. Offer one-and-a-half speed playback for reviewing longer drives. Validated by: `scripts/test_browser_pages.py`.
116. Provide a one-action jump to the first frame. Validated by: `scripts/test_browser_pages.py`.
117. Provide a one-action jump to the final frame. Validated by: `scripts/test_browser_pages.py`.
118. Jump to the previous recorded event. Validated by: `scripts/test_browser_pages.py`.
119. Jump to the next recorded event. Validated by: `scripts/test_browser_pages.py`.
120. Support Home and End when the replay player itself has keyboard focus. Validated by: `scripts/test_browser_pages.py`.
121. Keep keyboard focus on the selected gallery control during loading. Validated by: `scripts/test_browser_pages.py`.
122. Restore focus after a keyboard retry replaces its control. Validated by: `scripts/test_browser_pages.py`.
123. Show the recorded suite alongside the replay verdict. Validated by: `scripts/test_browser_pages.py`.
124. Distinguish reverse travel from forward speed in the replay readout. Validated by: `scripts/test_browser_pages.py`.
125. Cache the speed trace and repaint only the playhead on every frame. Validated by: `scripts/test_browser_pages.py`.
126. Label the speed trace with the actual recorded peak. Validated by: `scripts/test_browser_pages.py`.
127. Align speed-chart seeking with the padded plot area. Validated by: `scripts/test_browser_pages.py`.
128. Avoid auto-scrolling the decision log while keyboard focus is inside it. Validated by: `scripts/test_browser_pages.py`.
129. Identify the failing attempt in result, condition, trace and timeline import errors. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
130. Reject unsafe integer challenge versions at the evaluation level. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
131. Reject unsafe integer versions on individual attempts. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
132. Reject seeds that JavaScript cannot represent exactly. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
133. Reject fractional counts of audited driving incidents. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
134. Validate optional rule-audit measurements used to recompute a verdict. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
135. Require parking outcomes to be Boolean when present. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
136. Require all decision counts when any one of them is present. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
137. Reject partial model counts above the total number of model decisions. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
138. Require open-track flag counts to be exact nonnegative integers. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
139. Validate the check names used for open-track flag tallies. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
140. Verify imported decision IDs increase through the trace. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
141. Reject trace entries that overlap earlier folded decision spans. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
142. Check chronological ordering in imported incident timelines. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
143. Require v3 incident decision ages to agree with the presence of a linked decision. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
144. Reject nonpositive repeated incident counts. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
145. Recover valid fallback runs behind malformed entries. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
146. Preserve fallback history when reading it fails during a save. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
147. Preserve fallback history when the read before deletion fails. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
148. Avoid rewriting fallback history for an absent entry. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
149. Remove the fallback key when its final entry is deleted. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
150. Support the WebKit quota error name during fallback eviction. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
151. Normalize copied evaluation records before looking up saved identities. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
152. Return a clear comparison result when no baseline is loaded. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
153. Read IndexedDB index rows and their payloads in a single snapshot. Validated by: `scripts/test_arena_storage.mjs`.
154. Keep older concurrent reads from replacing newer saved-history snapshots. Validated by: `scripts/test_arena_storage.mjs`.
155. Retain a committed save in memory if refreshing the index fails. Validated by: `scripts/test_arena_storage.mjs`.
156. Remove a committed deletion from memory if refreshing the index fails. Validated by: `scripts/test_arena_storage.mjs`.
157. Refuse to erase a fallback evaluation that is too large to migrate. Validated by: `scripts/test_arena_storage.mjs`.
158. Use bounded storage defaults for invalid IndexedDB budget values. Validated by: `scripts/test_arena_storage.mjs`.
159. Recover from a corrupt last-record counter without overwriting a valid run. Validated by: `scripts/test_arena_storage.mjs`.
160. Refuse new saves when all representable IndexedDB IDs are exhausted. Validated by: `scripts/test_arena_storage.mjs`.
161. Ignore damaged migration ledger entries. Validated by: `scripts/test_arena_storage.mjs`.
162. Display an unavailable benchmark verdict for older manual reports without audit evidence. Validated by: `scripts/test_browser_pages.py`.
163. Describe why published comparison cannot run when a legacy report has no map fingerprint. Validated by: `scripts/test_browser_pages.py`.
164. Link the same-drive comparison to its filtered leaderboard on both the server and demo. Validated by: `scripts/test_browser_pages.py`.
165. Identify when no published drivers match the report's guarded conditions. Validated by: `scripts/test_browser_pages.py`.
166. Distinguish no recorded incidents from missing incident measurements. Validated by: `scripts/test_browser_pages.py`.
167. Show a tie when a manual comparison difference rounds to zero. Validated by: `scripts/test_browser_pages.py`.
168. Show progress while fetching the model clip for an incident. Validated by: `scripts/test_browser_pages.py`.
169. Check that a results file with no published runs remains readable. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
170. Check that legacy results can omit the map catalog. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
171. Check that a published debrief requires the same map ID even if its hash matches. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
172. Check that a published debrief never reuses another challenge with otherwise identical conditions. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
173. Check that published comparison treats numeric and string pack labels as different versions. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
174. Check that published comparison does not fall back to another driver. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
175. Check that a historical match without a failure list has an empty failure list in the debrief. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
176. Check that explicit legacy tags and untagged runs share one suite choice. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
177. Check that an empty suite picker defaults to the legacy cohort. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
178. Check that the summary uses guarded trial cost when both tracks are published. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
179. Check that a guarded cost has no open-track attribution. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
180. Check that the city grid keeps the newest result when one driver repeats a city condition. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
181. Check that results from the bare preset stay out of city comparisons. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
182. Check that multiple failure reasons retain their order in the challenge matrix. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
183. Check that a report without a recording is omitted from terminal replay choices. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
184. Check that an older city recording with a replay source still uses legacy verification. Validated by: `scripts/test_5k_arena-ui_results.mjs`.
185. Check that a coaching qualification flag cannot overrule a clean benchmark verdict. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
186. Check that a zero coaching grade cannot overrule a clean benchmark verdict. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
187. Check that a required parking failure survives Arena import. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
188. Check that successful parking does not add a benchmark failure. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
189. Check that exactly one second off-road fails an imported attempt. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
190. Check that less than one second off-road does not fail an imported attempt by itself. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
191. Check that Arena import recomputes model decision share from the underlying counts. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
192. Check that Arena import rounds locally answered decision share to thousandths. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
193. Check that Arena import rounds fallback share independently of model share. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
194. Check that validated partial decisions survive share recomputation. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
195. Check that a measured zero in an open-track evaluation imports as a clean run. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
196. Check that merely listing fallback runs leaves the stored bytes unchanged. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
197. Check that a v2 incident with an unknown decision age keeps its recorded decision ID. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
198. Check that a truncated trace stays marked as such after import. Validated by: `scripts/test_5k_arena-ui_history.mjs`.
199. Check that published browser replays still accept negative speeds from reversing. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
200. Check that frame lights with an unfamiliar textual state do not invalidate a recording. Validated by: `scripts/test_5k_arena-ui_replay.mjs`.
