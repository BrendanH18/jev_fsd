# Server and APIs

This batch improves request handling, saved artifacts, provider setup, and offline coverage of backend behavior. The checks use temporary files and stubbed provider responses.

1. Reject unsupported HTTP transfer encodings before reading a body. Validated by: `HttpTests.test_transfer_encoding` in `tests/test_server_api_improvements.py`.
2. Limit the number of query parameters before allocating their parsed values. Validated by: `HttpTests.test_query_field_limit` in `tests/test_server_api_improvements.py`.
3. Require a local path in an HTTP request target. Validated by: `HttpTests.test_absolute_target` in `tests/test_server_api_improvements.py`.
4. Return a client error when a request body ends before its declared length. Validated by: `HttpTests.test_truncated_body` in `tests/test_server_api_improvements.py`.
5. Return a dedicated JSON decoding error for invalid request bodies. Validated by: `HttpTests.test_json_error` in `tests/test_server_api_improvements.py`.
6. Reject non-finite JSON numbers, including exponents that overflow. Validated by: `HttpTests.test_non_finite_json` in `tests/test_server_api_improvements.py`.
7. Keep internal exception details out of API error responses. Validated by: `HttpTests.test_private_error` in `tests/test_server_api_improvements.py`.
8. Stop request handling quietly when a client has disconnected. Validated by: `HttpTests.test_disconnected_client` in `tests/test_server_api_improvements.py`.
9. Cover repeated query values and percent decoding at the handler boundary. Validated by: `HttpTests.test_query_values` in `tests/test_server_api_improvements.py`.
10. Cover the JSON response contract for explicit API validation errors. Validated by: `HttpTests.test_acknowledged_api_error` in `tests/test_server_api_improvements.py`.
11. Omit script nonces on responses that have no inline script. Validated by: `HttpTests.test_non_page_csp` in `tests/test_server_api_improvements.py`.
12. Prevent the server from emitting JSON numbers browsers cannot parse. Validated by: `HttpTests.test_response_json_finiteness` in `tests/test_server_api_improvements.py`.
13. Reject ambiguous security and content headers before dispatch. Validated by: `RequestPolicyTests.test_ambiguous_security_headers` in `tests/test_server_api_improvements.py`.
14. Handle non-ASCII session tokens as authentication failures. Validated by: `RequestPolicyTests.test_unicode_token` in `tests/test_server_api_improvements.py`.
15. Validate JSON media types exactly while accepting charset parameters. Validated by: `RequestPolicyTests.test_media_type` in `tests/test_server_api_improvements.py`.
16. Cover authorized bodyless model probes without a content-type header. Validated by: `RequestPolicyTests.test_bodyless_probe` in `tests/test_server_api_improvements.py`.
17. Reject malformed drive origins before loading their map. Validated by: `RequestValidationTests.test_drive_validation_before_loading` in `tests/test_server_api_improvements.py`.
18. Reject boolean drive coordinates instead of treating them as meters or radians. Validated by: `RequestValidationTests.test_drive_boolean` in `tests/test_server_api_improvements.py`.
19. Return a validation error for drive coordinates outside floating-point range. Validated by: `RequestValidationTests.test_drive_overflow` in `tests/test_server_api_improvements.py`.
20. Reject wrongly typed empty route-avoidance lists. Validated by: `RequestValidationTests.test_route_avoid_type` in `tests/test_server_api_improvements.py`.
21. Require route restriction switches to be booleans. Validated by: `RequestValidationTests.test_route_restrictions_type` in `tests/test_server_api_improvements.py`.
22. Validate the force-refresh switch before probing model endpoints. Validated by: `RequestValidationTests.test_force_probe_type` in `tests/test_server_api_improvements.py`.
23. Refuse a Jev state that cannot be serialized as finite JSON. Validated by: `RequestValidationTests.test_finite_jev_state` in `tests/test_server_api_improvements.py`.
24. Require non-empty choice IDs in Jev questions. Validated by: `RequestValidationTests.test_blank_jev_criteria` in `tests/test_server_api_improvements.py`.
25. Cover the exact upper boundary of the serialized Jev state budget. Validated by: `RequestValidationTests.test_max_jev_state` in `tests/test_server_api_improvements.py`.
26. Cover the exact instruction limit accepted by Jev request validation. Validated by: `RequestValidationTests.test_max_jev_instructions` in `tests/test_server_api_improvements.py`.
27. Require a non-empty user message before calling a language model. Validated by: `RequestValidationTests.test_llm_user_message` in `tests/test_server_api_improvements.py`.
28. Reject duplicate option IDs before building a language model schema. Validated by: `RequestValidationTests.test_llm_duplicate_ids` in `tests/test_server_api_improvements.py`.
29. Validate the whole offered language model option ID. Validated by: `RequestValidationTests.test_llm_id_newline` in `tests/test_server_api_improvements.py`.
30. Cover the prompt allowlist that drops extra message properties. Validated by: `RequestValidationTests.test_llm_message_metadata` in `tests/test_server_api_improvements.py`.
31. Leave an absent artifact directory untouched when listing it. Validated by: `ArtifactTests.test_listing_is_read_only` in `tests/test_server_api_improvements.py`.
32. Reject mistyped run names instead of loading a different sanitized name. Validated by: `ArtifactTests.test_exact_run_lookup` in `tests/test_server_api_improvements.py`.
33. Require a benchmark run configuration object when saving. Validated by: `ArtifactTests.test_run_config_object` in `tests/test_server_api_improvements.py`.
34. Bound memory used to load a saved benchmark run. Validated by: `ArtifactTests.test_run_read_limit` in `tests/test_server_api_improvements.py`.
35. Reuse benchmark metadata across repeated listing requests. Validated by: `ArtifactTests.test_run_catalog_cache` in `tests/test_server_api_improvements.py`.
36. Refresh listing metadata when a file is replaced with the same size and timestamp. Validated by: `ArtifactTests.test_cache_replaced_file` in `tests/test_server_api_improvements.py`.
37. Avoid reopening compressed recording tapes to repeat a catalog listing. Validated by: `ArtifactTests.test_recording_metadata_cache` in `tests/test_server_api_improvements.py`.
38. Keep recordings without a usable header or drive map out of the catalog. Validated by: `ArtifactTests.test_incomplete_recording_metadata` in `tests/test_server_api_improvements.py`.
39. Apply the recording read limit to uncompressed artifacts too. Validated by: `ArtifactTests.test_plain_recording_limit` in `tests/test_server_api_improvements.py`.
40. Cover the preference for a readable plain tape when both archive formats exist. Validated by: `ArtifactTests.test_recording_catalog_precedence` in `tests/test_server_api_improvements.py`.
41. Require snapshot expected answers to be stored as an object. Validated by: `ArtifactTests.test_snapshot_expect` in `tests/test_server_api_improvements.py`.
42. Record a snapshot's actual saved name when an earlier save used the same name. Validated by: `ArtifactTests.test_snapshot_filename_collision` in `tests/test_server_api_improvements.py`.
43. Require ASCII digits in numbered recording suite versions. Validated by: `ArtifactTests.test_suite_version_digits` in `tests/test_server_api_improvements.py`.
44. Give leaderboard users the regeneration command for an unreadable results file. Validated by: `ArtifactTests.test_corrupt_results_diagnostic` in `tests/test_server_api_improvements.py`.
45. Handle non-text bounding-box inputs in the settings parser. Validated by: `SettingsTests.test_bbox_type` in `tests/test_server_api_improvements.py`.
46. Cover case-insensitive bounding box preset names with surrounding whitespace. Validated by: `SettingsTests.test_bbox_preset_whitespace` in `tests/test_server_api_improvements.py`.
47. Fall back to the default rate cap for fractional process settings. Validated by: `SettingsTests.test_fractional_rpm` in `tests/test_server_api_improvements.py`.
48. Fall back to the default traffic count for a fractional vehicle setting. Validated by: `SettingsTests.test_fractional_npcs` in `tests/test_server_api_improvements.py`.
49. Cover process environment precedence across file reloads. Validated by: `SettingsTests.test_shell_and_file` in `tests/test_server_api_improvements.py`.
50. Cover repository-relative endpoint config paths when launched from another directory. Validated by: `SettingsTests.test_relative_endpoint_config` in `tests/test_server_api_improvements.py`.
51. Parse quoted environment values with trailing comments while keeping hashes inside quotes. Validated by: `SettingsTests.test_quoted_env_comments` in `tests/test_server_api_improvements.py`.
52. Recognize tab-separated comments in unquoted environment values. Validated by: `SettingsTests.test_env_comment_tab` in `tests/test_server_api_improvements.py`.
53. Cover export assignments and last-definition precedence in environment files. Validated by: `SettingsTests.test_export_env_repeated_variables` in `tests/test_server_api_improvements.py`.
54. Validate the entire environment variable name when saving a key. Validated by: `SettingsTests.test_env_variable_name` in `tests/test_server_api_improvements.py`.
55. Reject API keys that cannot be represented as printable HTTP header text. Validated by: `SettingsTests.test_env_transport_key` in `tests/test_server_api_improvements.py`.
56. Keep the previous key file when a replacement cannot be flushed to disk. Validated by: `SettingsTests.test_env_flush_failure` in `tests/test_server_api_improvements.py`.
57. Report private key-file permissions only for regular files. Validated by: `SettingsTests.test_env_private_regular_file` in `tests/test_server_api_improvements.py`.
58. Cover removing all assignments for a key while retaining neighboring settings. Validated by: `SettingsTests.test_forget_key` in `tests/test_server_api_improvements.py`.
59. Report malformed URLs as endpoint configuration problems. Validated by: `ProviderConfigTests.test_malformed_url` in `tests/test_server_api_improvements.py`.
60. Reject URL suffixes that would invalidate appended provider API paths. Validated by: `ProviderConfigTests.test_url_query_or_fragment` in `tests/test_server_api_improvements.py`.
61. Validate that stored endpoint URLs contain no embedded whitespace. Validated by: `ProviderConfigTests.test_url_whitespace` in `tests/test_server_api_improvements.py`.
62. Reject port zero and empty explicit ports in provider configuration. Validated by: `ProviderConfigTests.test_url_zero_port` in `tests/test_server_api_improvements.py`.
63. Reject URL userinfo even when its username is empty. Validated by: `ProviderConfigTests.test_url_empty_userinfo` in `tests/test_server_api_improvements.py`.
64. Require endpoint names to be text in hand-edited configuration. Validated by: `ProviderConfigTests.test_config_name_type` in `tests/test_server_api_improvements.py`.
65. Require a provider model ID to be text. Validated by: `ProviderConfigTests.test_config_model_type` in `tests/test_server_api_improvements.py`.
66. Validate the entire key variable name in endpoint configuration. Validated by: `ProviderConfigTests.test_key_env_line_break` in `tests/test_server_api_improvements.py`.
67. Validate the entire decision API path without accepting trailing line breaks. Validated by: `ProviderConfigTests.test_decision_path_line_break` in `tests/test_server_api_improvements.py`.
68. Detect a fractional model token limit instead of truncating it. Validated by: `ProviderConfigTests.test_fractional_tokens` in `tests/test_server_api_improvements.py`.
69. Detect fractional per-endpoint call rates instead of truncating them. Validated by: `ProviderConfigTests.test_fractional_endpoint_rate` in `tests/test_server_api_improvements.py`.
70. Reject non-object extra request configuration even when it is empty. Validated by: `ProviderConfigTests.test_extra_body_type` in `tests/test_server_api_improvements.py`.
71. Keep endpoint status readable when a configured URL is malformed. Validated by: `ProviderConfigTests.test_bad_configured_public_url` in `tests/test_server_api_improvements.py`.
72. Report a deeply nested endpoint configuration file instead of aborting registry startup. Validated by: `ProviderConfigTests.test_deep_endpoint_file` in `tests/test_server_api_improvements.py`.
73. Cover first-definition precedence when endpoint names are duplicated. Validated by: `ProviderConfigTests.test_duplicate_config` in `tests/test_server_api_improvements.py`.
74. Keep caller edits out of a cached endpoint status probe. Validated by: `ProviderConfigTests.test_probe_cache_isolation` in `tests/test_server_api_improvements.py`.
75. Finish a batch of endpoint probes against the registry snapshot that started it. Validated by: `ProviderConfigTests.test_probe_registry_snapshot` in `tests/test_server_api_improvements.py`.
76. Discard a decision probability outside floating-point range without losing the valid choice. Validated by: `ProviderConfigTests.test_large_decision_probabilities` in `tests/test_server_api_improvements.py`.
77. Reject numeric impostors and overflowing prices before writing model setup. Validated by: `ModelSetupTests.test_invalid_setup_prices` in `tests/test_server_api_improvements.py`.
78. Allow setup to add a model alongside an ill-typed entry without discarding that entry. Validated by: `ModelSetupTests.test_saved_entry_without_valid_name` in `tests/test_server_api_improvements.py`.
79. Name the endpoint configuration file when its save fails. Validated by: `ModelSetupTests.test_setup_file_write_error` in `tests/test_server_api_improvements.py`.
80. Surface key-file write failures directly in setup without exposing the key. Validated by: `ModelSetupTests.test_key_file_write_error` in `tests/test_server_api_improvements.py`.
81. Explain invalid model list encoding without inserting replacement characters into IDs. Validated by: `ModelSetupTests.test_invalid_model_list_encoding` in `tests/test_server_api_improvements.py`.
82. Show one setup option per provider model ID. Validated by: `ModelSetupTests.test_duplicate_listed_models` in `tests/test_server_api_improvements.py`.
83. Skip blank provider model IDs in setup choices. Validated by: `ModelSetupTests.test_blank_listed_model` in `tests/test_server_api_improvements.py`.
84. Keep models selectable when provider prices are booleans or exceed numeric range. Validated by: `ModelSetupTests.test_invalid_listed_model_prices` in `tests/test_server_api_improvements.py`.
85. Redact a typed key from text echoed by model catalogs. Validated by: `ModelSetupTests.test_model_catalog_credentials` in `tests/test_server_api_improvements.py`.
86. Cover the alternative provider metadata fields for display name and context window. Validated by: `ModelSetupTests.test_model_catalog_context_alias` in `tests/test_server_api_improvements.py`.
87. Avoid accumulating call timestamps when the server has no rate cap. Validated by: `JevClientTests.test_unlimited_rate_tracking` in `tests/test_server_api_improvements.py`.
88. Release rate-limit capacity exactly one minute after a call. Validated by: `JevClientTests.test_rate_window_exact_expiry` in `tests/test_server_api_improvements.py`.
89. Keep the process totals intact if result cost accounting raises. Validated by: `JevClientTests.test_spend_accounting_atomic` in `tests/test_server_api_improvements.py`.
90. Treat a malformed Jev usage block as unavailable accounting metadata. Validated by: `JevClientTests.test_malformed_usage_object` in `tests/test_server_api_improvements.py`.
91. Include Jev output tokens in process diagnostics. Validated by: `JevClientTests.test_jev_spend_output_tokens` in `tests/test_server_api_improvements.py`.
92. Keep malformed Jev token counts from reducing or corrupting the spend total. Validated by: `JevClientTests.test_invalid_jev_token_values` in `tests/test_server_api_improvements.py`.
93. Return an empty answer object for an unusable Jev answers container. Validated by: `JevClientTests.test_jev_answer_container` in `tests/test_server_api_improvements.py`.
94. Report a provider error when Jev returns JSON with the wrong top-level shape. Validated by: `JevClientTests.test_non_object_jev_reply` in `tests/test_server_api_improvements.py`.
95. Refresh the Jev SDK client when its base URL changes with the same API key. Validated by: `JevClientTests.test_sdk_configuration_reload` in `tests/test_server_api_improvements.py`.
96. Report malformed TypeSafe response JSON from the fallback transport as a provider error. Validated by: `JevClientTests.test_stdlib_bad_json` in `tests/test_server_api_improvements.py`.
97. Bound the fallback transport's server-requested retry wait by the configured timeout. Validated by: `JevClientTests.test_bounded_stdlib_retry_delay` in `tests/test_server_api_improvements.py`.
98. Keep TypeSafe's nested provider error messages short enough for the UI. Validated by: `JevClientTests.test_provider_error_size` in `tests/test_server_api_improvements.py`.
99. Keep the map picker available when one cached pack is unreadable. Validated by: `MapCatalogTests.test_missing_pack_metadata` in `tests/test_server_api_improvements.py`.
100. Refresh a map preview after atomic replacement preserves its size and timestamp. Validated by: `MapCatalogTests.test_replaced_map_metadata` in `tests/test_server_api_improvements.py`.
