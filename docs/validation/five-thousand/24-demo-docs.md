# Public demo and documentation

The static build verifies its staged artifact before publication, the browser adapter diagnoses bad data and preserves local runs, and the documentation checker covers relative URLs and anchors used in the guides.

1. Stage and verify a replacement before touching the previous demo. Validated by: tests/test_demo_artifact.py.
2. Restore the previous output when renaming a verified stage fails. Validated by: tests/test_demo_artifact.py.
3. Preserve a recoverable backup and give its location if rollback itself fails. Validated by: tests/test_demo_artifact.py.
4. Require both the demo boot marker and catalog to identify a reusable output directory. Validated by: tests/test_demo_artifact.py.
5. Diagnose an output path that points to a regular file. Validated by: tests/test_demo_artifact.py.
6. Protect the repository's dependency directories from replacement. Validated by: tests/test_demo_artifact.py.
7. Reject source symlinks before copying their contents into the build. Validated by: tests/test_demo_artifact.py.
8. Reject source assets outside the allowed file types for each copied directory. Validated by: tests/test_demo_artifact.py.
9. Reject non-regular entries such as devices or FIFOs before reading the artifact. Validated by: tests/test_demo_artifact.py.
10. Reject hardlinked output files that a later source edit could change. Validated by: tests/test_demo_artifact.py.
11. Refuse unexpected files even when their extensions look safe. Validated by: tests/test_demo_artifact.py.
12. Verify copied application and vendor files against their tracked sources. Validated by: tests/test_demo_artifact.py.
13. Verify the bundled attribution text itself. Validated by: tests/test_demo_artifact.py.
14. Require the Pages marker to be empty. Validated by: tests/test_demo_artifact.py.
15. Inspect the artifact for unsafe entries before reading page and JSON contents. Validated by: tests/test_demo_artifact.py.
16. Resolve source navigation with query strings or fragments under the deployed project path. Validated by: tests/test_demo_artifact.py.
17. Rewrite single-quoted HTML asset references. Validated by: tests/test_demo_artifact.py.
18. Rewrite root-relative public replay and media paths. Validated by: tests/test_demo_artifact.py.
19. Support attributed and uppercase HTML head elements when inserting demo metadata. Validated by: tests/test_demo_artifact.py.
20. Explain a missing or repeated source head instead of leaving the application unmarked. Validated by: tests/test_demo_artifact.py.
21. Show the actual packaged map count in the social description. Validated by: tests/test_demo_artifact.py.
22. Validate the bundled release label against the application version. Validated by: tests/test_demo_artifact.py.
23. Verify that the social card's image URL points to the published asset. Validated by: tests/test_demo_artifact.py.
24. Reject a base tag that redirects resolution of every relative URL. Validated by: tests/test_demo_artifact.py.
25. Catch redirects declared as HTML meta refreshes. Validated by: tests/test_demo_artifact.py.
26. Reject embedded documents that can bypass the packaged page checks. Validated by: tests/test_demo_artifact.py.
27. Diagnose duplicate HTML IDs that make fragment navigation ambiguous. Validated by: tests/test_demo_artifact.py.
28. Accept legacy named HTML anchors. Validated by: tests/test_demo_artifact.py.
29. Check responsive image candidates for missing resources. Validated by: tests/test_demo_artifact.py.
30. Check poster assets for broken video thumbnails. Validated by: tests/test_demo_artifact.py.
31. Check form action URLs for references outside the static site. Validated by: tests/test_demo_artifact.py.
32. Reject remote dependencies while allowing ordinary outbound navigation. Validated by: tests/test_demo_artifact.py.
33. Allow inline image data without treating it as a missing file. Validated by: tests/test_demo_artifact.py.
34. Reject ambiguous URL backslashes. Validated by: tests/test_demo_artifact.py.
35. Reject encoded control characters in asset paths. Validated by: tests/test_demo_artifact.py.
36. Catch resource URLs that address directories instead of files. Validated by: tests/test_demo_artifact.py.
37. Catch links to existing but empty assets. Validated by: tests/test_demo_artifact.py.
38. Report the source line for a missing HTML fragment target. Validated by: tests/test_demo_artifact.py.
39. Check that each page loads its intended module entry point. Validated by: tests/test_demo_artifact.py.
40. Catch dropped or repeated required stylesheets. Validated by: tests/test_demo_artifact.py.
41. Require the inline import map to precede module execution. Validated by: tests/test_demo_artifact.py.
42. Detect accidental use of external import map sources. Validated by: tests/test_demo_artifact.py.
43. Detect import maps on pages that do not use Three.js. Validated by: tests/test_demo_artifact.py.
44. Validate package-alias directory suffixes. Validated by: tests/test_demo_artifact.py.
45. Verify that required Three.js aliases actually target the intended vendored modules. Validated by: tests/test_demo_artifact.py.
46. Check that relative JavaScript imports name a shipped module. Validated by: tests/test_demo_artifact.py.
47. Check re-exports for missing module files. Validated by: tests/test_demo_artifact.py.
48. Inspect literal lazy imports that would otherwise fail only when opened. Validated by: tests/test_demo_artifact.py.
49. Resolve individual Three.js add-ons referenced by the module graph. Validated by: tests/test_demo_artifact.py.
50. Catch unresolved package names before deploying JavaScript. Validated by: tests/test_demo_artifact.py.
51. Verify local CSS resources such as background images. Validated by: tests/test_demo_artifact.py.
52. Follow CSS stylesheet import targets when verifying the artifact. Validated by: tests/test_demo_artifact.py.
53. Explain invalid JSON with the originating file or import map location. Validated by: tests/test_demo_artifact.py.
54. Reject duplicate JSON keys that can disguise damaged map or import configuration. Validated by: tests/test_demo_artifact.py.
55. Reject nonstandard or overflowing numbers that browser JSON cannot use. Validated by: tests/test_demo_artifact.py.
56. Reject data files with the wrong top-level JSON type. Validated by: tests/test_demo_artifact.py.
57. Report the exact field or array entry where the shipped map differs from its source. Validated by: tests/test_demo_artifact.py.
58. Fail packaging when the shared map loader reports corruption in an existing derived layer. Validated by: tests/test_demo_artifact.py.
59. Detect a stale leaderboard even if the file still has the correct schema. Validated by: tests/test_demo_artifact.py.
60. Reject leaderboard driver and row containers that the UI cannot read. Validated by: tests/test_demo_artifact.py.
61. Expose a verified JSON report of the artifact with total size and largest files. Validated by: tests/test_demo_artifact.py.
62. Include the deployed leaderboard checksum for artifact identification. Validated by: tests/test_demo_artifact.py.
63. Explain unsupported scoped import maps before any module can be resolved in the wrong scope. Validated by: tests/test_demo_artifact.py.
64. Refuse a symbolic link as the root of a standalone verification. Validated by: tests/test_demo_artifact.py.
65. Use the packaged application version in the demo status response. Validated by: scripts/test_5k_demo-docs_api.mjs.
66. Decline absolute and protocol-relative API requests before making a network request. Validated by: scripts/test_5k_demo-docs_api.mjs.
67. Diagnose invalid origin coordinates before starting a demo route lookup. Validated by: scripts/test_5k_demo-docs_api.mjs.
68. Diagnose invalid destination coordinates separately from the origin. Validated by: scripts/test_5k_demo-docs_api.mjs.
69. Require finite heading values in debug and shared-route requests. Validated by: scripts/test_5k_demo-docs_api.mjs.
70. Normalize extreme finite headings before entering iterative angle wrapping. Validated by: scripts/test_5k_demo-docs_api.mjs.
71. Return no candidates for extreme coordinates without starting unbounded grid loops. Validated by: scripts/test_5k_demo-docs_api.mjs.
72. Validate the toggle for scheduled turn restrictions. Validated by: scripts/test_5k_demo-docs_api.mjs.
73. Validate the simulated hour passed to the restriction lookup. Validated by: scripts/test_5k_demo-docs_api.mjs.
74. Validate the weekday supplied to the restriction lookup. Validated by: scripts/test_5k_demo-docs_api.mjs.
75. Reject an invalid road closure edge list before routing. Validated by: scripts/test_5k_demo-docs_api.mjs.
76. Match numerically equivalent bundled bounding boxes with trailing zeros or spaces. Validated by: scripts/test_5k_demo-docs_api.mjs.
77. Keep an aborted caller's cancellation reason while other callers share the asset. Validated by: scripts/test_5k_demo-docs_api.mjs.
78. Clean up shared-request abort listeners as soon as the caller settles. Validated by: scripts/test_5k_demo-docs_api.mjs.
79. Skip a pack download if selection is cancelled while waiting for the catalog. Validated by: scripts/test_5k_demo-docs_api.mjs.
80. Prevent remote redirects on fetches for packaged data. Validated by: scripts/test_5k_demo-docs_api.mjs.
81. Distinguish network download failures from corrupt JSON with retry guidance. Validated by: scripts/test_5k_demo-docs_api.mjs.
82. Expose HTTP status codes on packaged data errors. Validated by: scripts/test_5k_demo-docs_api.mjs.
83. Decline a bundled JSON response advertised as implausibly large. Validated by: scripts/test_5k_demo-docs_api.mjs.
84. Reject catalogs with no usable neighbourhood list. Validated by: scripts/test_5k_demo-docs_api.mjs.
85. Require map IDs that can safely name a bundled data file. Validated by: scripts/test_5k_demo-docs_api.mjs.
86. Reject duplicate map IDs that make selectors ambiguous. Validated by: scripts/test_5k_demo-docs_api.mjs.
87. Reject duplicated bounds that would resolve to two neighbourhoods. Validated by: scripts/test_5k_demo-docs_api.mjs.
88. Check that catalog bounds have ordered finite coordinates. Validated by: scripts/test_5k_demo-docs_api.mjs.
89. Check that the catalog identifies the default neighbourhood. Validated by: scripts/test_5k_demo-docs_api.mjs.
90. Check clock offsets before the browser starts the map. Validated by: scripts/test_5k_demo-docs_api.mjs.
91. Check that a neighbourhood has displayable city and neighbourhood labels. Validated by: scripts/test_5k_demo-docs_api.mjs.
92. Validate the pack's version marker before giving it to the simulator. Validated by: scripts/test_5k_demo-docs_api.mjs.
93. Reject packs that disagree with their catalog bounds and clock. Validated by: scripts/test_5k_demo-docs_api.mjs.
94. Require a valid projected map extent for camera and route coordinates. Validated by: scripts/test_5k_demo-docs_api.mjs.
95. Validate the top-level map collections before constructing the world. Validated by: scripts/test_5k_demo-docs_api.mjs.
96. Detect empty lane graphs instead of starting a drive without roads. Validated by: scripts/test_5k_demo-docs_api.mjs.
97. Reject duplicate edge keys before building the routing index. Validated by: scripts/test_5k_demo-docs_api.mjs.
98. Reject broken edge geometry and graph endpoints before routing. Validated by: scripts/test_5k_demo-docs_api.mjs.
99. Check lane counts against edge offsets and supplied lanes. Validated by: scripts/test_5k_demo-docs_api.mjs.
100. Reject nonsensical asphalt bounds before the renderer handles them. Validated by: scripts/test_5k_demo-docs_api.mjs.
101. Reject zero or invalid speed limits in bundled road records. Validated by: scripts/test_5k_demo-docs_api.mjs.
102. Reject nonpositive routing weights in the bundled graph. Validated by: scripts/test_5k_demo-docs_api.mjs.
103. Reject a dangling lane reference to an edge the pack does not contain. Validated by: scripts/test_5k_demo-docs_api.mjs.
104. Check lane indices before indexing edge lane offsets. Validated by: scripts/test_5k_demo-docs_api.mjs.
105. Reject colliding lane keys before loading the cached map. Validated by: scripts/test_5k_demo-docs_api.mjs.
106. Validate lane polylines before inserting them into the spatial grid. Validated by: scripts/test_5k_demo-docs_api.mjs.
107. Build the route graph lazily when a caller first needs a route or drive suggestion. Validated by: scripts/test_5k_demo-docs_api.mjs.
108. Clear and diagnose corrupt pack cache entries if route graph construction fails. Validated by: scripts/test_5k_demo-docs_api.mjs.
109. Isolate API callers from mutable cached catalog and status metadata. Validated by: scripts/test_5k_demo-docs_api.mjs.
110. Return map snapshots whose mutations cannot affect later routing. Validated by: scripts/test_5k_demo-docs_api.mjs.
111. Reject invalid leaderboard payloads before the results page renders them. Validated by: scripts/test_5k_demo-docs_api.mjs.
112. Keep only the portable benchmark fields when writing a saved result. Validated by: scripts/test_5k_demo-docs_api.mjs.
113. Give JSON serialization errors a benchmark-specific message. Validated by: scripts/test_5k_demo-docs_api.mjs.
114. Validate the final serialized benchmark after a nested custom JSON conversion. Validated by: scripts/test_5k_demo-docs_api.mjs.
115. Filter history records from invalid suites or with mixed suite markers. Validated by: scripts/test_5k_demo-docs_api.mjs.
116. Enforce the saved-run cap even when imported browser storage exceeds it. Validated by: scripts/test_5k_demo-docs_api.mjs.
117. Explain storage access refusal separately from exhausted quota. Validated by: scripts/test_5k_demo-docs_api.mjs.
118. Add a standard-library documentation check mode to the existing demo build command. Validated by: tests/test_doc_links.py.
119. Discover project Markdown in the repository root and GitHub issue and contribution templates. Validated by: tests/test_doc_links.py.
120. Allow a review to check selected Markdown files or directories. Validated by: tests/test_doc_links.py.
121. Offer machine-readable JSON results for editor and automation integration. Validated by: tests/test_doc_links.py.
122. Offer escaped GitHub Actions annotations with source locations. Validated by: tests/test_doc_links.py.
123. Ignore documentation links in standalone indented code. Validated by: tests/test_doc_links.py.
124. Respect longer fence delimiters when ignoring embedded code examples. Validated by: tests/test_doc_links.py.
125. Recognize fenced examples inside Markdown blockquotes. Validated by: tests/test_doc_links.py.
126. Skip Markdown or HTML links hidden inside comments. Validated by: tests/test_doc_links.py.
127. Ignore inline code delimited by matching backtick runs. Validated by: tests/test_doc_links.py.
128. Parse link labels or link destinations that wrap onto another line. Validated by: tests/test_doc_links.py.
129. Handle filenames with balanced parentheses. Validated by: tests/test_doc_links.py.
130. Handle backslash-escaped punctuation in local paths. Validated by: tests/test_doc_links.py.
131. Handle angle-enclosed destinations with spaces. Validated by: tests/test_doc_links.py.
132. Accept Markdown titles delimited by single quotes or parentheses. Validated by: tests/test_doc_links.py.
133. Validate relative resources referenced with HTML source attributes. Validated by: tests/test_doc_links.py.
134. Validate HTML link destinations with externally visible anchors. Validated by: tests/test_doc_links.py.
135. Find links in HTML tags whose attributes wrap across lines. Validated by: tests/test_doc_links.py.
136. Detect undefined full and collapsed reference labels. Validated by: tests/test_doc_links.py.
137. Resolve reference labels case-insensitively and collapse intervening whitespace. Validated by: tests/test_doc_links.py.
138. Use the first definition when a reference is defined twice. Validated by: tests/test_doc_links.py.
139. Resolve reference definitions whose destination starts on the following line. Validated by: tests/test_doc_links.py.
140. Recognize Setext headings when building the anchor index. Validated by: tests/test_doc_links.py.
141. Decode character references before constructing heading slugs. Validated by: tests/test_doc_links.py.
142. Avoid heading slug collisions with existing numbered headings. Validated by: tests/test_doc_links.py.
143. Resolve explicit HTML IDs and preserve legacy name anchors. Validated by: tests/test_doc_links.py.
144. Check relative links containing query parameters. Validated by: tests/test_doc_links.py.
145. Detect malformed destination percent escapes or UTF-8 sequences. Validated by: tests/test_doc_links.py.
146. Reject escaped characters that cannot form a portable relative path. Validated by: tests/test_doc_links.py.
147. Catch destination paths that step outside the checkout. Validated by: tests/test_doc_links.py.
148. Report path capitalization differences even on case-insensitive filesystems. Validated by: tests/test_doc_links.py.
149. Suggest close anchor matches when a Markdown or HTML fragment is stale. Validated by: tests/test_doc_links.py.
150. Check fragments against README headings when the destination is a directory. Validated by: tests/test_doc_links.py.
151. Validate source-line fragments and ranges against file line counts. Validated by: tests/test_doc_links.py.
152. Allow UTF-8 byte-order marks before the first Markdown heading. Validated by: tests/test_doc_links.py.
153. Report invalid or unreadable Markdown sources without aborting the entire check. Validated by: tests/test_doc_links.py.
154. Give visitors a direct keyless demo quick start beside the local installation instructions. Validated by: tests/test_doc_links.py.
155. Expose the static build guide in the main reference index. Validated by: tests/test_doc_links.py.
156. Document the standard-library Python requirement for a standalone build. Validated by: tests/test_doc_links.py.
157. Use a loopback-only command for the static HTTP preview. Validated by: tests/test_doc_links.py.
158. Explain why the static directory needs HTTP instead of a file URL. Validated by: tests/test_doc_links.py.
159. Distinguish the preview port from the simulator server's port. Validated by: tests/test_doc_links.py.
160. Show how to build and serve a specific output directory. Validated by: tests/test_doc_links.py.
161. Explain which directories can be rebuilt and where to keep unrelated files. Validated by: tests/test_doc_links.py.
162. Provide a nested preview procedure for testing a project-path deployment. Validated by: tests/test_doc_links.py.
163. Show a subpath deep link that preserves both suite selection and a replay fragment. Validated by: tests/test_doc_links.py.
164. List the generated page URLs beside their extensionless local-app counterparts. Validated by: tests/test_doc_links.py.
165. Document direct map selection and bypassing the startup menu to take the wheel. Validated by: tests/test_doc_links.py.
166. Show how to launch an authored drive with its map and conditions intact. Validated by: tests/test_doc_links.py.
167. Explain when an original manual attempt counts toward practice progress. Validated by: tests/test_doc_links.py.
168. Show how to compare the two published Ottawa flagger drives without a key. Validated by: tests/test_doc_links.py.
169. Explain that the replay gallery downloads the selected drive's frames on demand. Validated by: tests/test_doc_links.py.
170. Show which Arena and benchmark drivers can run on the public demo. Validated by: tests/test_doc_links.py.
171. Document the Save run switch for an exploratory or storage-blocked benchmark. Validated by: tests/test_doc_links.py.
172. Explain how a drive link shares settings while a report shares the result. Validated by: tests/test_doc_links.py.
173. Explain why demo routing yields at most one alternative. Validated by: tests/test_doc_links.py.
174. Describe which map, seed and selection settings must match for useful browser benchmark comparisons. Validated by: tests/test_doc_links.py.
175. Describe arena JSON export and import for transferring runs to another browser. Validated by: tests/test_doc_links.py.
176. Explain the fallback from IndexedDB to browser local storage for arena history. Validated by: tests/test_doc_links.py.
177. Identify which rewind and incident data must be reviewed before leaving an active drive. Validated by: tests/test_doc_links.py.
178. Document the demo benchmark retention limit and behaviour at browser quota. Validated by: tests/test_doc_links.py.
179. Explain how a different host, port or scheme affects access to browser history. Validated by: tests/test_doc_links.py.
180. Explain why serving another project path on the same origin can share local history. Validated by: tests/test_doc_links.py.
181. Identify the source revision needed to verify a previously packaged demo. Validated by: tests/test_doc_links.py.
182. Explain how the artifact report diagnoses deployments that have grown in size. Validated by: tests/test_doc_links.py.
183. Explain the relation between source cache keys and deployed map-ID filenames. Validated by: tests/test_doc_links.py.
184. Show how to inspect preset IDs, projected extents and record counts without a map download. Validated by: tests/test_doc_links.py.
185. Explain what a catalog row with an unreadable source pack means before a build. Validated by: tests/test_doc_links.py.
186. Correct the suggested-drive count to reflect routing that finds fewer reachable destinations. Validated by: tests/test_doc_links.py.
187. Name the dependency lockfile ecosystems that Dependabot actually updates. Validated by: tests/test_doc_links.py.
188. Describe which demo jobs precede packaging and what the required gate checks. Validated by: tests/test_doc_links.py.
189. Clarify Pages' full-artifact deployment and active deployment concurrency. Validated by: tests/test_doc_links.py.
190. Explain how a host's HTML fallback can masquerade as a JSON parse failure. Validated by: tests/test_doc_links.py.
191. Document browser quality persistence and the URL option for a lower starting setting. Validated by: tests/test_doc_links.py.
192. Show the touch-control option for reproducing desktop previews of mobile input. Validated by: tests/test_doc_links.py.
193. Replace a stale validation test count with commands that report the current counts. Validated by: tests/test_doc_links.py.
194. Document the main browser check's narrow driving-controls and startup group. Validated by: tests/test_doc_links.py.
195. Describe the different URL arguments accepted by the main and Arena browser checks. Validated by: tests/test_doc_links.py.
196. Document scoped docs checks and why a renamed heading needs a repository-wide pass. Validated by: tests/test_doc_links.py.
197. Show when to use ordinary, JSON and annotation output for link checks. Validated by: tests/test_doc_links.py.
198. Show how to retain an existing deep link by keeping an explicit anchor. Validated by: tests/test_doc_links.py.
199. Explain line-range links and the directory README convention to contributors. Validated by: tests/test_doc_links.py.
200. Describe browser-stored demo runs and static results in the privacy reference. Validated by: tests/test_doc_links.py.
