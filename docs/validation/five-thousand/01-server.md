# Local server and security

This batch hardens loopback HTTP handling, adds revalidation for static assets, validates saved artifacts, preserves local configuration during key edits, and bounds map caches. The first 145 entries describe shipped changes. The last 55 describe additional regression coverage.

1. Support HEAD on readable APIs, pages and assets while preserving GET response metadata. Validated by: `tests/test_5k_server_http.py`.
2. Advertise available page and API methods through OPTIONS without dispatching an action. Validated by: `tests/test_5k_server_http.py`.
3. Return an Allow header for a recognized resource when an authenticated PUT, PATCH or DELETE is refused. Validated by: `tests/test_5k_server_http.py`.
4. Apply the write-request token checks to PUT, PATCH and DELETE before refusing their methods. Validated by: `tests/test_5k_server_http.py`.
5. Give malformed HTTP requests the JSON error envelope used by the API. Validated by: `tests/test_5k_server_http.py`.
6. Frame parser errors as HTTP responses even when no HTTP version could be parsed. Validated by: `tests/test_5k_server_http.py`.
7. Keep the raw malformed request line out of parser diagnostics. Validated by: `tests/test_5k_server_http.py`.
8. Refuse bodies on GET, HEAD and OPTIONS before endpoint dispatch. Validated by: `tests/test_5k_server_http.py`.
9. Reject unsupported and ambiguous body content encodings with HTTP 415. Validated by: `tests/test_5k_server_http.py`.
10. Answer Expect requests immediately when the server does not support the handshake. Validated by: `tests/test_5k_server_http.py`.
11. Return HTTP 408 when an inactive request body reaches the socket timeout. Validated by: `tests/test_5k_server_http.py`.
12. Parse long Content-Length headers without converting overlong integers or misreading leading zeroes. Validated by: `tests/test_5k_server_http.py`.
13. Allow a UTF-8 byte-order mark on incoming JSON. Validated by: `tests/test_5k_server_http.py`.
14. Require unique object keys in both request bodies and imported JSON files. Validated by: `tests/test_5k_server_http.py` and `tests/test_5k_server_artifacts.py`.
15. Reject JSON escapes for unpaired surrogates before they reach application handlers. Validated by: `tests/test_5k_server_http.py`.
16. Check the original request target before the standard handler can normalize leading slashes. Validated by: `tests/test_5k_server_http.py`.
17. Reject request-target fragments rather than dispatching the portion preceding them. Validated by: `tests/test_5k_server_http.py`.
18. Treat semicolons as literal path characters. Validated by: `tests/test_5k_server_http.py`.
19. Decode percent-encoded characters in static filenames. Validated by: `tests/test_5k_server_http.py`.
20. Reject malformed percent escapes in URLs. Validated by: `tests/test_5k_server_http.py`.
21. Require valid UTF-8 in percent-encoded query parameters. Validated by: `tests/test_5k_server_http.py`.
22. Reject raw and percent-encoded backslash separators and encoded forward slashes. Validated by: `tests/test_5k_server_http.py`.
23. Reserve the API namespace even when a static file has the same path. Validated by: `tests/test_5k_server_http.py`.
24. Apply the static-root boundary to the HTML documents in the page registry. Validated by: `tests/test_5k_server_http.py`.
25. Give missing registered page files a JSON 404 response. Validated by: `tests/test_5k_server_http.py`.
26. Route unexpected page and filesystem failures through the generic JSON 500 response. Validated by: `tests/test_5k_server_http.py`.
27. Recognize symlink loops as missing static resources. Validated by: `tests/test_5k_server_http.py`.
28. Stream static files in bounded chunks using the opened file's size. Validated by: `tests/test_5k_server_http.py`.
29. Let browsers revalidate static assets with private cache directives. Validated by: `tests/test_5k_server_http.py`.
30. Use weak ETags to revalidate static assets. Validated by: `tests/test_5k_server_http.py`.
31. Apply Last-Modified validation when the client has no ETag. Validated by: `tests/test_5k_server_http.py`.
32. Stop an incomplete asset response cleanly if the open file fails midstream. Validated by: `tests/test_5k_server_http.py`.
33. Fall back to binary content for unprintable MIME types. Validated by: `tests/test_5k_server_http.py`.
34. Remove the Python runtime version from the Server header. Validated by: `tests/test_5k_server_http.py`.
35. Send a same-origin resource policy on responses. Validated by: `tests/test_5k_server_http.py`.
36. Add a frame-denial header alongside the existing frame-ancestors policy. Validated by: `tests/test_5k_server_http.py`.
37. Bind request Host validation to the actual listener port. Validated by: `tests/test_5k_server_http.py`.
38. Accept socket peers only from the IPv4 loopback address. Validated by: `tests/test_5k_server_http.py`.
39. Apply Fetch Metadata protections to read-only API paths. Validated by: `tests/test_5k_server_http.py`.
40. Check explicit Origins when accessing read-only APIs. Validated by: `tests/test_5k_server_http.py`.
41. Treat an explicitly empty fetch-site header as invalid. Validated by: `tests/test_5k_server_http.py`.
42. Treat an explicitly empty Origin header as invalid. Validated by: `tests/test_5k_server_http.py`.
43. Accept omitted Origin ports on the default HTTP port. Validated by: `tests/test_5k_server_http.py`.
44. Bind an explicit Origin to the Host header's loopback alias. Validated by: `tests/test_5k_server_http.py`.
45. Limit Host whitespace normalization to HTTP spaces and tabs. Validated by: `tests/test_5k_server_http.py`.
46. Keep URL query data out of access logs. Validated by: `tests/test_5k_server_http.py`.
47. Suppress decision access logs by route rather than by substring in the request line. Validated by: `tests/test_5k_server_http.py`.
48. Bound how much of an arbitrary URL path is written to access logs. Validated by: `tests/test_5k_server_http.py`.
49. Escape nonprintable characters before writing server log lines. Validated by: `tests/test_5k_server_http.py`.
50. Log unexpected exception types and frames without printing exception values. Validated by: `tests/test_5k_server_http.py`.
51. Keep disconnects during error responses out of the generic error path. Validated by: `tests/test_5k_server_http.py`.
52. Require a text label when naming a snapshot. Validated by: `tests/test_5k_server_artifacts.py`.
53. Require a text brain label when naming a saved benchmark. Validated by: `tests/test_5k_server_artifacts.py`.
54. Require a text driver label when naming a recording. Validated by: `tests/test_5k_server_artifacts.py`.
55. Check the final encoded artifact size before attempting publication. Validated by: `tests/test_5k_server_artifacts.py`.
56. Prevent direct save calls from publishing non-finite JSON numbers. Validated by: `tests/test_5k_server_artifacts.py`.
57. Accept UTF-8 signatures in JSON read from disk. Validated by: `tests/test_5k_server_artifacts.py`.
58. Treat non-finite numbers in imported JSON as corrupt data. Validated by: `tests/test_5k_server_artifacts.py`.
59. Ignore symlinked files when reading or listing local artifacts. Validated by: `tests/test_5k_server_artifacts.py`.
60. Use the file size to skip opening plain artifacts beyond the decoded size limit. Validated by: `tests/test_5k_server_artifacts.py`.
61. Keep oversized listing metadata out of the in-process catalog cache. Validated by: `tests/test_5k_server_artifacts.py`.
62. Reject artifact names that cannot fit within the filename byte limit. Validated by: `tests/test_5k_server_artifacts.py`.
63. Accept decomposed Unicode accents in artifact names. Validated by: `tests/test_5k_server_artifacts.py`.
64. Reject requests with conflicting exact artifact names. Validated by: `tests/test_5k_server_artifacts.py`.
65. Hide run files with names that cannot be used for lookup. Validated by: `tests/test_5k_server_artifacts.py`.
66. Validate imported benchmark configuration, summary and replay containers. Validated by: `tests/test_5k_server_artifacts.py`.
67. Require imported run results to agree with the declared suite. Validated by: `tests/test_5k_server_artifacts.py`.
68. Require recording outcome list members to be objects. Validated by: `tests/test_5k_server_artifacts.py`.
69. Check that recorded scenario values are objects. Validated by: `tests/test_5k_server_artifacts.py`.
70. Validate the results container of an imported recording. Validated by: `tests/test_5k_server_artifacts.py`.
71. Apply suite and manifest agreement checks when reading imported recordings. Validated by: `tests/test_5k_server_artifacts.py`.
72. Let clients bound how many artifacts a catalog returns. Validated by: `tests/test_5k_server_artifacts.py`.
73. Support paging through artifact catalogs using an exclusive name cursor. Validated by: `tests/test_5k_server_artifacts.py`.
74. Support exact suite-version filters on artifact catalogs. Validated by: `tests/test_5k_server_artifacts.py`.
75. Support exact driver filters on artifact catalogs. Validated by: `tests/test_5k_server_artifacts.py`.
76. Bound the number of attempts to reserve a unique save name. Validated by: `tests/test_5k_server_artifacts.py`.
77. Keep dangling symlinks from being replaced by fallback artifact publication. Validated by: `tests/test_5k_server_artifacts.py`.
78. Treat already-removed temporary save files as successful cleanup. Validated by: `tests/test_5k_server_artifacts.py`.
79. Recognize a UTF-8 signature in the environment file parser. Validated by: `tests/test_5k_server_settings.py`.
80. Parse a whitespace-separated comment after an empty environment assignment as a comment. Validated by: `tests/test_5k_server_settings.py`.
81. Reject oversized environment files without reading unnecessary bytes. Validated by: `tests/test_5k_server_settings.py`.
82. Reject nonregular environment sources. Validated by: `tests/test_5k_server_settings.py`.
83. Report invalid environment encoding without copying the invalid bytes. Validated by: `tests/test_5k_server_settings.py`.
84. Use an actual Git ignore check in a repository and fail closed if Git cannot run it. Validated by: `tests/test_5k_server_settings.py`.
85. Keep inherited Git repository and index overrides out of key-write preflight. Validated by: `tests/test_5k_server_settings.py`.
86. Honor negation and later rules when reading a simple ignore file outside a Git checkout. Validated by: `tests/test_5k_server_settings.py`.
87. Check whether an ignore wildcard actually matches the requested credential filename. Validated by: `tests/test_5k_server_settings.py`.
88. Reject unsafe credential file basenames. Validated by: `tests/test_5k_server_settings.py`.
89. Refuse to replace or delete symlinked credential files. Validated by: `tests/test_5k_server_settings.py`.
90. Report symlinked credential files as having unsafe permissions. Validated by: `tests/test_5k_server_settings.py`.
91. Diagnose a directory at the credential write target during preflight. Validated by: `tests/test_5k_server_settings.py`.
92. Validate the type and format of a key before consulting Git. Validated by: `tests/test_5k_server_settings.py`.
93. Store typed keys with shell metacharacters as literal assignments. Validated by: `tests/test_5k_server_settings.py`.
94. Preserve untouched environment lines byte for byte during key edits. Validated by: `tests/test_5k_server_settings.py`.
95. Match the existing file's newline style when appending a key. Validated by: `tests/test_5k_server_settings.py`.
96. Keep an existing export prefix when replacing an environment assignment. Validated by: `tests/test_5k_server_settings.py`.
97. Preserve inline comments when updating key values. Validated by: `tests/test_5k_server_settings.py`.
98. Consolidate duplicate assignments to a single credential. Validated by: `tests/test_5k_server_settings.py`.
99. Serialize read-modify-write cycles so simultaneous credential edits keep both keys. Validated by: `tests/test_5k_server_settings.py`.
100. Preserve the UTF-8 signature when updating or forgetting assignments. Validated by: `tests/test_5k_server_settings.py`.
101. Validate environment variable names before deleting assignments. Validated by: `tests/test_5k_server_settings.py`.
102. Continue startup using process settings when the environment file is unreadable. Validated by: `tests/test_5k_server_settings.py`.
103. Drop stale on-disk credentials if an environment-file reload fails. Validated by: `tests/test_5k_server_settings.py`.
104. Validate whole-number environment options without floating-point rounding. Validated by: `tests/test_5k_server_settings.py`.
105. Reject rate and traffic counts above the exact integer range of the browser. Validated by: `tests/test_5k_server_settings.py`.
106. Keep an underflowing spend budget from becoming unlimited. Validated by: `tests/test_5k_server_settings.py`.
107. Permit surrounding whitespace in an explicitly configured TypeSafe API root. Validated by: `tests/test_5k_server_settings.py`.
108. Disable Jev when a configured TypeSafe API root is malformed. Validated by: `tests/test_5k_server_settings.py`.
109. Reject a process key with invalid HTTP header characters without falling back to the file credential. Validated by: `tests/test_5k_server_settings.py`.
110. Trim horizontal whitespace from imported TypeSafe keys. Validated by: `tests/test_5k_server_settings.py`.
111. Normalize usable model names and default names with invalid formatting. Validated by: `tests/test_5k_server_settings.py`.
112. Continue parsing endpoint paths when a home-directory alias cannot be resolved. Validated by: `tests/test_5k_server_settings.py`.
113. Diagnose configuration paths that name directories instead of JSON files. Validated by: `tests/test_5k_server_settings.py`.
114. Diagnose an embedded null in a model endpoint configuration path. Validated by: `tests/test_5k_server_settings.py`.
115. Read the HTTP quiet setting from project configuration. Validated by: `tests/test_5k_server_settings.py`.
116. Allow explicit false values to override an enabled quiet setting. Validated by: `tests/test_5k_server_settings.py`.
117. Report invalid startup options using setting names and accepted defaults. Validated by: `tests/test_5k_server_settings.py`.
118. Give port conflicts an unused-port diagnostic on standard error. Validated by: `tests/test_5k_server_settings.py`.
119. Give bind permission failures a distinct port diagnostic. Validated by: `tests/test_5k_server_settings.py`.
120. Close the listener if startup or serving ends. Validated by: `tests/test_5k_server_settings.py`.
121. Identify an unreadable startup map without printing the internal exception. Validated by: `tests/test_5k_server_settings.py`.
122. Return a failure code if the serving loop stops with an I/O error. Validated by: `tests/test_5k_server_settings.py`.
123. Keep each model setup mutation and its combined registry reply in one critical section. Validated by: `tests/test_5k_server_settings.py`.
124. Reject unknown map selectors rather than silently routing on the default map. Validated by: `tests/test_5k_server_maps.py`.
125. Reject repeated map query selectors. Validated by: `tests/test_5k_server_maps.py`.
126. Keep precise bounding boxes distinct in the router cache even when their disk lookup rounds to the same key. Validated by: `tests/test_5k_server_maps.py`.
127. Bound the number of loaded routers with least-recently-used eviction. Validated by: `tests/test_5k_server_maps.py`.
128. Release per-map locks after the last caller leaves. Validated by: `tests/test_5k_server_maps.py`.
129. Retry map loading after a synthetic fallback has cooled down. Validated by: `tests/test_5k_server_maps.py`.
130. Assemble map overlays into an owned copy of the pack. Validated by: `tests/test_5k_server_maps.py`.
131. Consume a bounding-box iterator once when determining map identity. Validated by: `tests/test_5k_server_maps.py`.
132. Bound the number of cached map previews. Validated by: `tests/test_5k_server_maps.py`.
133. Limit the data read from a map pack for its preview. Validated by: `tests/test_5k_server_maps.py`.
134. Require map preview extents to have ordered bounds and positive area. Validated by: `tests/test_5k_server_maps.py`.
135. Validate that preview entries describing roads are objects. Validated by: `tests/test_5k_server_maps.py`.
136. Validate the comparable endpoint IDs used to deduplicate preview segments. Validated by: `tests/test_5k_server_maps.py`.
137. Require preview roads to have a textual classification. Validated by: `tests/test_5k_server_maps.py`.
138. Require at least two points before drawing a road segment. Validated by: `tests/test_5k_server_maps.py`.
139. Require road preview coordinates to be stored in arrays. Validated by: `tests/test_5k_server_maps.py`.
140. Bound angle wrapping before passing very large headings to a router search. Validated by: `tests/test_5k_server_maps.py`.
141. Validate that the local routing hour is in a calendar day. Validated by: `tests/test_5k_server_maps.py`.
142. Validate that the routing weekday is a zero-based day of the week. Validated by: `tests/test_5k_server_maps.py`.
143. Reject empty and padded route avoidance IDs. Validated by: `tests/test_5k_server_maps.py`.
144. Stop scanning candidate drive lanes once the fixed route-search budget is full. Validated by: `tests/test_5k_server_maps.py`.
145. Skip a drive recommendation when its route contains no segment. Validated by: `tests/test_5k_server_maps.py`.
146. Cover navigating to the app from an external site. Validated by: `tests/test_5k_server_http.py`.
147. Cover local API access with an uppercase Host and an implicit port. Validated by: `tests/test_5k_server_http.py`.
148. Require foreign-origin method probes to carry no access-control headers. Validated by: `tests/test_5k_server_http.py`.
149. Check that each HTML response gets its own fresh CSP script nonce. Validated by: `tests/test_5k_server_http.py`.
150. Check that JSON error pages retain the existing nosniff, referrer and frame policies. Validated by: `tests/test_5k_server_http.py`.
151. Cover accepting a request body exactly at the ordinary byte limit. Validated by: `tests/test_5k_server_http.py`.
152. Check that recording saves retain a separate POST quota from ordinary routes. Validated by: `tests/test_5k_server_http.py`.
153. Cover the HTTP response for scalar JSON bodies. Validated by: `tests/test_5k_server_http.py`.
154. Cover preserved provider retry codes and the upstream status field for gateway failures. Validated by: `tests/test_5k_server_http.py`.
155. Check that an explicit identity body encoding still reaches the action. Validated by: `tests/test_5k_server_http.py`.
156. Exercise closing a request stream after refusing a body sent to an unknown route. Validated by: `tests/test_5k_server_http.py`.
157. Cover the Fetch Metadata context used by explicit local navigation. Validated by: `tests/test_5k_server_http.py`.
158. Cover refusing requests with same-site rather than same-origin Fetch Metadata. Validated by: `tests/test_5k_server_http.py`.
159. Exercise the policy for opaque browser origins. Validated by: `tests/test_5k_server_http.py`.
160. Check that alternative loopback spellings cannot broaden the Host allowlist. Validated by: `tests/test_5k_server_http.py`.
161. Cover a snapshot label that becomes empty after sanitization. Validated by: `tests/test_5k_server_artifacts.py`.
162. Cover the exact allowlist of persisted browser snapshot and run fields. Validated by: `tests/test_5k_server_artifacts.py`.
163. Check that a saved benchmark run stays readable only by its file owner. Validated by: `tests/test_5k_server_artifacts.py`.
164. Check that nested benchmark configuration and result order survive a save and load. Validated by: `tests/test_5k_server_artifacts.py`.
165. Cover a recording save without optional scenarios or results. Validated by: `tests/test_5k_server_artifacts.py`.
166. Check that a legacy recording's listed header stays versionless. Validated by: `tests/test_5k_server_artifacts.py`.
167. Cover a recording header at the exact serialized header-size limit. Validated by: `tests/test_5k_server_artifacts.py`.
168. Check that one recording can span multiple gzip members. Validated by: `tests/test_5k_server_artifacts.py`.
169. Cover the exact decoded-size boundary when listing a compressed recording. Validated by: `tests/test_5k_server_artifacts.py`.
170. Cover the exact decoded-size boundary when loading a plain benchmark run. Validated by: `tests/test_5k_server_artifacts.py`.
171. Verify that unfiltered artifact listings retain their existing default caps and order. Validated by: `tests/test_5k_server_artifacts.py`.
172. Cover a legacy tape format accessible only through exact lookup. Validated by: `tests/test_5k_server_artifacts.py`.
173. Cover falling back to the file credential when the process variable is empty. Validated by: `tests/test_5k_server_settings.py`.
174. Cover reading environment values without shell expansion. Validated by: `tests/test_5k_server_settings.py`.
175. Check that settings copy an injected process environment at initialization. Validated by: `tests/test_5k_server_settings.py`.
176. Cover both valid port range boundaries. Validated by: `tests/test_5k_server_settings.py`.
177. Check that reload keeps the process port while refreshing unrelated file settings. Validated by: `tests/test_5k_server_settings.py`.
178. Check that a setup validation failure leaves the registry reply untouched. Validated by: `tests/test_5k_server_settings.py`.
179. Check that key permissions distinguish an absent file from an unsafe one. Validated by: `tests/test_5k_server_settings.py`.
180. Exercise a credential file with only the group-execute bit set. Validated by: `tests/test_5k_server_settings.py`.
181. Check that forgetting an absent environment variable leaves the file intact. Validated by: `tests/test_5k_server_settings.py`.
182. Exercise a nondefault credential filename using an anchored ignore rule. Validated by: `tests/test_5k_server_settings.py`.
183. Cover default-map selection when the route request leaves bbox empty. Validated by: `tests/test_5k_server_maps.py`.
184. Check precedence of bbox over the map query alias. Validated by: `tests/test_5k_server_maps.py`.
185. Check that ordinary route headings are passed through unchanged. Validated by: `tests/test_5k_server_maps.py`.
186. Cover accepted numeric-string route coordinates and an absent optional heading. Validated by: `tests/test_5k_server_maps.py`.
187. Check route-count clamping with legacy integer strings. Validated by: `tests/test_5k_server_maps.py`.
188. Check default route count, hour, weekday, restrictions and avoidance options passed to the router. Validated by: `tests/test_5k_server_maps.py`.
189. Cover routing at midnight on Sunday. Validated by: `tests/test_5k_server_maps.py`.
190. Check that valid avoided edge IDs preserve their order across API validation. Validated by: `tests/test_5k_server_maps.py`.
191. Check that the drive API retains the requested pose and recommendation order. Validated by: `tests/test_5k_server_maps.py`.
192. Cover custom map identity without assigning the default city's time offset. Validated by: `tests/test_5k_server_maps.py`.
193. Cover existing preview arterial classifications. Validated by: `tests/test_5k_server_maps.py`.
194. Cover deduplicating drive destinations in one geographic grid cell. Validated by: `tests/test_5k_server_maps.py`.
195. Cover the minimum lane length used in collecting drive candidates. Validated by: `tests/test_5k_server_maps.py`.
196. Check the route suggestion distance window. Validated by: `tests/test_5k_server_maps.py`.
197. Check that suggestion search continues after one unreachable destination. Validated by: `tests/test_5k_server_maps.py`.
198. Verify the order and distance targets of the three suggested drive presets. Validated by: `tests/test_5k_server_maps.py`.
199. Cover pruning recommended destinations within the minimum separation distance. Validated by: `tests/test_5k_server_maps.py`.
200. Cover the existing GET and POST 404 response for endpoints registered with a different method. Validated by: `tests/test_5k_server_http.py`.
