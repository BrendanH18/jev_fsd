"""Human and machine-readable output for offline map audits."""

from __future__ import annotations

import json
from dataclasses import asdict

from .audit_schema import Issue


def compare_audits(current, reference):
    """Compare artifacts by filename without requiring a Git checkout in either directory."""
    expected = {item.file: item for item in reference.artifacts if item.sha256}
    actual = {item.file: item for item in current.artifacts if item.sha256}
    differences = []
    for file in sorted(expected.keys() | actual.keys()):
        if file not in expected:
            differences.append(Issue(file, "only in map directory"))
        elif file not in actual:
            differences.append(Issue(file, "only in reference directory"))
        elif actual[file].sha256 != expected[file].sha256:
            differences.append(Issue(file, "bytes differ from reference"))
    return differences


def render(audits, references=None, *, machine=False):
    reports = []
    lines = []
    for audit in audits:
        reference = references[audit.area] if references is not None else None
        differences = compare_audits(audit, reference) if reference is not None else []
        ok = audit.ok and (reference is None or reference.ok) and not differences
        report = {**asdict(audit), "ok": ok}
        if reference is not None:
            report["reference"] = asdict(reference)
            report["differences"] = [asdict(issue) for issue in differences]
        reports.append(report)
        if machine:
            continue

        lines.append(f"{audit.area} {'PASS' if ok else 'FAIL'}")
        for label, result in (("", audit), ("reference ", reference)):
            if result is None:
                continue
            for item in result.artifacts:
                counts = ", ".join(f"{n} {key}" for key, n in sorted(item.counts.items()))
                detail = f" ({counts})" if counts else ""
                lines.append(f"  {label}{item.status:7} {item.file}{detail}")
                lines.extend(f"    {issue.path} {issue.message}" for issue in item.issues)
        lines.extend(f"  comparison {issue.path} {issue.message}" for issue in differences)
    ok = all(report["ok"] for report in reports)
    if machine:
        return json.dumps({"ok": ok, "maps": reports}, indent=2), ok
    return "\n".join(lines), ok
