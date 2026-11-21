// Version labels describe the run as a whole. Legacy artifacts never acquire a numbered version
// simply by replaying on a newer checkout.
export const LEGACY_SUITE = "legacy";
export const CUSTOM_SUITE = "custom";
export const suiteVersion = (artifact) => artifact?.suite_version ?? LEGACY_SUITE;

export function setRecordingSuiteVersion(recording, version) {
  recording.header.suite_version = version;
  if (recording.header.manifest) {
    recording.header.manifest.format = "jev-run-manifest/2";
    recording.header.manifest.suite_version = version;
  }
  for (const result of Object.values(recording.results)) result.suite_version = version;
}

export function replaySuiteVersion(header, complete) {
  const version = suiteVersion(header);
  return complete || version === LEGACY_SUITE ? version : CUSTOM_SUITE;
}
