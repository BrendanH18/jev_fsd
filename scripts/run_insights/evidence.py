"""Cross-check independent measurements and extract evidence from saved diagnostics."""

from collections import Counter
from functools import partial

from . import decisions, outcomes, profiles, safety


def _entries(rows, read):
    entries = []
    for index, row in enumerate(rows):
        value = read(row)
        if value is not None:
            entries.append({"id": row.get("id"), "row_index": index, **value})
    return {"rows": entries, "coverage": {"selected_routes": len(rows)}}


def _conflict(rows, *, first, second, margin=0):
    def read(row):
        a, b = (profiles.measurement(row, field) for field in (first, second))
        if a is not None and b is not None and a - b > margin:
            return {first: a, second: b}
        return None

    return _entries(rows, read)


def _verdict_failure(rows, *, field, reason):
    def read(row):
        observed = profiles.measurement(row, field)
        reasons = outcomes.reasons(row)
        if observed and reasons is not None and reason not in reasons:
            return {"field": field, "value": observed, "failures": reasons}
        return None

    return _entries(rows, read)


def _decision_total(row):
    counts = [profiles.measurement(row, field) for field in (*decisions.SOURCES, "decisions")]
    if None not in counts and sum(counts[:3]) != counts[3]:
        return {"attributed": sum(counts[:3]), "decisions": counts[3]}
    return None


def _flag_total(row):
    flags = profiles.measurement(row, "flagged_choices")
    checks = row.get("flagged_by_check")
    if flags is None or not isinstance(checks, dict) or any(type(n) is not int or n < 0 for n in checks.values()):
        return None
    counted = sum(checks.values())
    return {"flagged_choices": flags, "by_check_total": counted} if flags != counted else None


def _share_total(row):
    shares = [profiles.measurement(row, field) for field in ("model_share", "local_share", "fallback_share")]
    if None not in shares and abs(sum(shares) - 1) > 0.0015:
        # The runner rounds each of the three fractions to three decimal places.
        return {"share_total": sum(shares), "shares": shares}
    return None


def _zero_exposure(rows, *, numerator, exposure):
    def read(row):
        value, denominator = (profiles.measurement(row, field) for field in (numerator, exposure))
        return {numerator: value, exposure: denominator} if value and denominator == 0 else None

    return _entries(rows, read)


def _counter_integer(rows, *, field):
    def read(row):
        value = profiles.measurement(row, field)
        return {"field": field, "value": value} if value is not None and int(value) != value else None

    return _entries(rows, read)


def _missing_verdict(row):
    if outcomes.verdict(row) == "unknown":
        return {"present": "pass" in row, "value": row.get("pass")}
    return None


def _invalid_failure_list(row):
    if "failures" in row and outcomes.reasons(row) is None:
        return {"value": row["failures"]}
    return None


def _error_verdict(row):
    if isinstance(row.get("simulation_error"), str) and row["simulation_error"] and row.get("pass") is True:
        return {"simulation_error": row["simulation_error"]}
    return None


def _stopped_verdict(row):
    if row.get("stopped") is True and row.get("pass") is True:
        return {"stopped": True}
    return None


def _event_frequency(rows):
    # Counts are lower bounds on capped logs. Report route incidence independently.
    occurrences, routes = Counter(), Counter()
    measured = capped = 0
    for row in rows:
        log = outcomes.events(row)
        if log is None:
            continue
        measured += 1
        capped += outcomes.event_log_capped(log)
        types = [event["type"] for event in log]
        occurrences.update(types)
        routes.update(set(types))
    return {
        "rows": [
            {"type": kind, "occurrences": n, "routes": routes[kind]}
            for kind, n in sorted(occurrences.items(), key=lambda item: (-item[1], item[0]))
        ],
        "coverage": {"measured_logs": measured, "capped_logs": capped, "selected_routes": len(rows)},
    }


def _events_by_field(rows, *, kind, field):
    keys = Counter()
    measured = unclassified = capped = 0
    for row in rows:
        events = outcomes.events(row)
        if events is None:
            continue
        measured += 1
        capped += outcomes.event_log_capped(events)
        for event in events:
            if event["type"] == kind:
                label = event.get(field)
                if isinstance(label, str) and label.strip():
                    keys[label] += 1
                elif type(label) is int:
                    keys[str(label)] += 1
                else:
                    unclassified += 1
    return {
        "rows": [{"label": key, "events": n} for key, n in sorted(keys.items(), key=lambda item: (-item[1], item[0]))],
        "coverage": {"measured_logs": measured, "capped_logs": capped, "unclassified_events": unclassified},
    }


def _collision_log_gap(row):
    log, count = outcomes.events(row), profiles.measurement(row, "collisions")
    if log is None or count is None or outcomes.event_log_capped(log):
        return None
    retained = sum(e["type"] == "collision" for e in log)
    return {"counter": count, "retained": retained} if count != retained else None


def _final_context(rows):
    return _entries(
        rows,
        lambda row: (
            {"final": diag["final"]}
            if isinstance(diag := row.get("diagnostics"), dict) and isinstance(diag.get("final"), dict)
            else None
        ),
    )


def _incidents(rows):
    data = []
    measured = 0
    for row in rows:
        diag = row.get("diagnostics")
        if not isinstance(diag, dict) or not isinstance(diag.get("incidents"), list):
            continue
        measured += 1
        for i, incident in enumerate(diag["incidents"]):
            if isinstance(incident, dict) and isinstance(incident.get("audit"), str):
                data.append(
                    {
                        "id": row.get("id"),
                        "sample_index": i,
                        "audit": incident["audit"],
                        "time_s": incident.get("t"),
                        "street": incident.get("street"),
                        "sample": incident,
                    }
                )
    return {"rows": data, "coverage": {"recorded_incident_logs": measured, "selected_routes": len(rows)}}


def _event_log_presence(rows):
    statuses = Counter()
    for row in rows:
        log = outcomes.events(row)
        if log is not None:
            status = "capped" if outcomes.event_log_capped(log) else "empty" if not log else "present"
        else:
            status = "malformed" if "events" in row else "absent"
        statuses[status] += 1
    return {"rows": [{"status": key, "routes": n} for key, n in sorted(statuses.items())]}


def _audit_presence(rows):
    coverage = []
    for field, unit in profiles.AUDIT_UNITS.items():
        present = sum(field in row for row in rows)
        measured = sum(profiles.measurement(row, field) is not None for row in rows)
        coverage.append(
            {
                "field": field,
                "unit": unit,
                "observed": measured,
                "absent": len(rows) - present,
                "invalid": present - measured,
            }
        )
    return {"rows": coverage}


def _event_after_end(row):
    elapsed, log = profiles.measurement(row, "time_s"), outcomes.events(row)
    if elapsed is None or log is None:
        return None
    # Saved elapsed and event times are rounded to tenths of a second.
    late = [i for i, e in enumerate(log) if (t := profiles.measurement(e, "t")) is not None and t - elapsed > 0.11]
    return {"time_s": elapsed, "event_indexes": late} if late else None


def _audit_samples_without_counter(row):
    diag = row.get("diagnostics")
    if not isinstance(diag, dict) or not isinstance(diag.get("incidents"), list):
        return None
    counters = {safety.AUDIT_KEYS.get(field, field): field for field in profiles.AUDIT_UNITS}
    found = set()
    for incident in diag["incidents"]:
        audit = incident.get("audit") if isinstance(incident, dict) else None
        if isinstance(audit, str) and audit in counters and profiles.measurement(row, counters[audit]) is None:
            found.add(counters[audit])
    return {"fields": sorted(found)} if found else None


REPORTS = {
    "evidence-missing-verdicts": (
        "Locate missing or non-boolean drive verdicts.",
        partial(_entries, read=_missing_verdict),
    ),
    "evidence-invalid-failure-lists": (
        "Locate malformed saved verdict-label lists.",
        partial(_entries, read=_invalid_failure_list),
    ),
    "evidence-passed-errors": (
        "Find drives that claimed a pass despite a simulation exception.",
        partial(_entries, read=_error_verdict),
    ),
    "evidence-passed-interruptions": (
        "Find drives that claimed a pass after being interrupted.",
        partial(_entries, read=_stopped_verdict),
    ),
    "evidence-collision-fault-count": (
        "Find at-fault counts above the number of collisions.",
        partial(_conflict, first="at_fault", second="collisions"),
    ),
    "evidence-stopped-duration": (
        "Find stationary durations exceeding recorded elapsed time.",
        partial(_conflict, first="stopped_s", second="time_s", margin=0.11),
    ),
    "evidence-speeding-duration": (
        "Find speeding durations exceeding recorded elapsed time.",
        partial(_conflict, first="speeding_s", second="time_s", margin=0.11),
    ),
    "evidence-off-road-duration": (
        "Find off-road durations exceeding recorded elapsed time.",
        partial(_conflict, first="off_road_s", second="time_s", margin=0.11),
    ),
    "evidence-latency-order": (
        "Find p50 call latency above p95.",
        partial(_conflict, first="latency_p50_ms", second="latency_p95_ms"),
    ),
    "evidence-partial-count": (
        "Find partial model answer counts above the total model decisions.",
        partial(_conflict, first="partial_decisions", second="model_decisions"),
    ),
    "evidence-decision-attribution-total": (
        "Find mismatches between attributed decision counts and the recorded decision count.",
        partial(_entries, read=_decision_total),
    ),
    "evidence-decision-share-total": (
        "Find recorded decision shares that fail to sum to one within rounding precision.",
        partial(_entries, read=_share_total),
    ),
    "evidence-flag-check-total": (
        "Reconcile the flagged-choice total with its per-check counts.",
        partial(_entries, read=_flag_total),
    ),
    "evidence-flags-without-decisions": (
        "Find positive flagged-choice counts on drives that recorded zero decisions.",
        partial(_zero_exposure, numerator="flagged_choices", exposure="decisions"),
    ),
    "evidence-spend-without-calls": (
        "Find positive spend on drives that recorded zero calls.",
        partial(_zero_exposure, numerator="cost_usd", exposure="calls"),
    ),
    "evidence-fractional-collisions": (
        "Find nonintegral collision counts.",
        partial(_counter_integer, field="collisions"),
    ),
    "evidence-fractional-decisions": (
        "Find nonintegral decision counts.",
        partial(_counter_integer, field="decisions"),
    ),
    "evidence-unlabeled-collisions": (
        "Find observed collisions absent from recorded verdict labels.",
        partial(_verdict_failure, field="collisions", reason="collision"),
    ),
    "evidence-event-log-coverage": ("Count absent, malformed, empty, retained and capped logs.", _event_log_presence),
    "evidence-event-frequency": ("Count retained events and affected routes separately.", _event_frequency),
    "evidence-collision-kinds": (
        "Group retained collisions by obstacle kind.",
        partial(_events_by_field, kind="collision", field="kind"),
    ),
    "evidence-collision-faults": (
        "Group retained collisions by recorded fault attribution, including shared fault.",
        partial(_events_by_field, kind="collision", field="fault"),
    ),
    "evidence-fallback-status": (
        "Group retained fallback events by their recorded error status.",
        partial(_events_by_field, kind="fallback", field="status"),
    ),
    "evidence-collision-log-gap": (
        "Find uncapped event logs that disagree with the route collision counter.",
        partial(_entries, read=_collision_log_gap),
    ),
    "evidence-events-after-end": (
        "Find event timestamps beyond the recorded end of the drive.",
        partial(_entries, read=_event_after_end),
    ),
    "evidence-final-context": ("Export saved final pose, speed and nearby traffic together.", _final_context),
    "evidence-audit-samples": ("Export each retained audit incident with its sample index and context.", _incidents),
    "evidence-audit-coverage": ("Distinguish unmeasured, malformed and valid audit counters.", _audit_presence),
    "evidence-unmeasured-audit-samples": (
        "Find retained audit samples without a corresponding measured counter.",
        partial(_entries, read=_audit_samples_without_counter),
    ),
}
