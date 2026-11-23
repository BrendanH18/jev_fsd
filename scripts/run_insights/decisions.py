"""Reports about who drove, the resources used, and the decisions a driver made."""

from functools import partial
from math import isfinite

from .profiles import ranking_summary

SOURCES = ("model_decisions", "local_decisions", "fallback_decisions")


def _number(value):
    return type(value) in (int, float) and isfinite(value) and value >= 0


def _measured(rows, *fields):
    return [row for row in rows if all(_number(row.get(key)) for key in fields)]


def _ratio(numerator, denominator, scale=1):
    return round(numerator / denominator * scale, 9) if denominator else None


def _rate(rows, numerator, denominator, scale=1):
    measured = _measured(rows, numerator, denominator)
    return {
        "routes_measured": len(measured),
        "numerator_total": sum(row[numerator] for row in measured) if measured else None,
        "denominator_total": sum(row[denominator] for row in measured) if measured else None,
        "rate": _ratio(sum(row[numerator] for row in measured), sum(row[denominator] for row in measured), scale),
    }


def _route_sort_key(route_id):
    return (route_id is None, "" if route_id is None else str(route_id))


def _ranks(rows, field):
    measured = _measured(rows, field)
    ordered = sorted(measured, key=lambda row: (-row[field], *_route_sort_key(row.get("id"))))
    routes = [{"id": row.get("id"), field: row[field]} for row in ordered]
    return {
        "routes": routes,
        "unavailable": len(rows) - len(measured),
        "summary": ranking_summary([row[field] for row in ordered], 6),
    }


def _mix(rows):
    measured = _measured(rows, *SOURCES)
    counts = {field: sum(row[field] for row in measured) for field in SOURCES}
    return {
        "routes_measured": len(measured),
        "counts": counts if measured else None,
        "shares": {field: _ratio(count, sum(counts.values())) for field, count in counts.items()},
    }


def _attribution_coverage(rows):
    measured = _measured(rows, *SOURCES)
    return {
        "routes_attributed": len(measured),
        "routes_total": len(rows),
        "coverage": _ratio(len(measured), len(rows)),
    }


def _fallback_exposure(rows):
    # Older and current records include the violations counter. It counts fallback incidents,
    # whereas the newer attribution counts which driver actually made the decision.
    measured = _measured(rows, "fallbacks")
    affected = [row for row in measured if row["fallbacks"]]
    return {
        "routes_measured": len(measured),
        "routes_affected": len(affected),
        "affected_share": _ratio(len(affected), len(measured)),
        "incidents": sum(row["fallbacks"] for row in measured) if measured else None,
    }


def _fallback_free_passes(rows):
    passes = [row for row in _measured(rows, "fallback_decisions", "model_decisions") if row.get("pass") is True]
    model_passes = [row for row in passes if row["model_decisions"] > 0]
    unassisted = [row.get("id") for row in model_passes if row["fallback_decisions"] == 0]
    return {
        "passing_routes_with_model_decisions": len(model_passes),
        "without_fallback": unassisted,
        "share": _ratio(len(unassisted), len(model_passes)),
    }


def _local_only(rows):
    measured = _measured(rows, *SOURCES)
    return [
        row.get("id")
        for row in measured
        if row["local_decisions"] > 0 and row["model_decisions"] == 0 and row["fallback_decisions"] == 0
    ]


def _spend_by_outcome(rows):
    measured = [row for row in _measured(rows, "cost_usd") if type(row.get("pass")) is bool]
    out = {}
    for passed, name in ((True, "passed"), (False, "failed")):
        costs = [row["cost_usd"] for row in measured if row["pass"] == passed]
        out[name] = {"routes": len(costs), "cost_usd": round(sum(costs), 6) if costs else None}
    return out


def _cost_per_pass(rows):
    measured = [row for row in _measured(rows, "cost_usd") if type(row.get("pass")) is bool]
    passed = sum(1 for row in measured if row["pass"])
    total = sum(row["cost_usd"] for row in measured)
    return {
        "routes_measured": len(measured),
        "passed": passed,
        "usd_per_pass": _ratio(total, passed),
    }


def _cost_concentration(rows):
    ranked = _ranks(rows, "cost_usd")
    total = sum(row["cost_usd"] for row in ranked["routes"])
    return {
        "routes": [{**row, "share_of_spend": _ratio(row["cost_usd"], total)} for row in ranked["routes"]],
        "unavailable": ranked["unavailable"],
        "summary": ranked["summary"],
    }


def _tail_inflation(rows):
    out = [
        {"id": row.get("id"), "p95_over_p50": _ratio(row["latency_p95_ms"], row["latency_p50_ms"])}
        for row in _measured(rows, "latency_p95_ms", "latency_p50_ms")
        if row["latency_p50_ms"] > 0
    ]
    out.sort(key=lambda item: (-item["p95_over_p50"], *_route_sort_key(item["id"])))
    return {
        "routes": out,
        "unavailable": len(rows) - len(out),
        "summary": ranking_summary([item["p95_over_p50"] for item in out], 6),
    }


def _latency_coverage(rows):
    called = [row for row in _measured(rows, "calls") if row["calls"] > 0]
    timed = _measured(called, "latency_p50_ms", "latency_p95_ms")
    return {
        "routes_with_calls": len(called),
        "routes_with_percentiles": len(timed),
        "coverage": _ratio(len(timed), len(called)),
    }


def _flag_checks(rows):
    counts = {}
    measured = 0
    for row in rows:
        checks = row.get("flagged_by_check")
        if not isinstance(checks, dict) or not all(_number(count) for count in checks.values()):
            continue
        measured += 1
        for check, count in checks.items():
            counts[check] = counts.get(check, 0) + count
    return {
        "routes_measured": measured,
        "by_check": dict(sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))),
    }


def _flag_outcomes(rows):
    measured = [row for row in _measured(rows, "flagged_choices") if type(row.get("pass")) is bool]
    out = {}
    for flagged, name in ((True, "with_flags"), (False, "without_flags")):
        group = [row for row in measured if (row["flagged_choices"] > 0) == flagged]
        passed = sum(row["pass"] for row in group)
        out[name] = {"routes": len(group), "passed": passed, "pass_rate": _ratio(passed, len(group))}
    return out


RANKINGS = {
    "fallback-decision-ranking": (
        "Routes ranked by decisions handed to Rules.",
        partial(_ranks, field="fallback_decisions"),
    ),
    "spend-concentration": ("Each route's share of recorded spend, largest first.", _cost_concentration),
    "token-demand": ("Routes ranked by recorded input tokens.", partial(_ranks, field="tokens")),
    "median-call-latency": (
        "Routes ranked by median recorded call latency in milliseconds.",
        partial(_ranks, field="latency_p50_ms"),
    ),
    "tail-call-latency": (
        "Routes ranked by 95th percentile recorded call latency in milliseconds.",
        partial(_ranks, field="latency_p95_ms"),
    ),
    "latency-tail-inflation": ("Routes ranked by the ratio of tail to median latency.", _tail_inflation),
}


def _ranked_routes(report, rows):
    return report(rows)["routes"]


EXTENDED_REPORTS = {
    f"{name}-summary": (f"{description} Includes suite statistics and unavailable counts.", report)
    for name, (description, report) in RANKINGS.items()
}


REPORTS = {
    **{name: (description, partial(_ranked_routes, report)) for name, (description, report) in RANKINGS.items()},
    "decision-sources": ("Decision counts and weighted shares for each source.", _mix),
    "attribution-coverage": ("Fraction of routes with complete decision-source counts.", _attribution_coverage),
    "partial-answer-rate": (
        "Share of model decisions that defaulted a requested answer.",
        lambda rows: _rate(rows, "partial_decisions", "model_decisions"),
    ),
    "fallback-free-passes": ("Passing routes with model decisions and no Rules fallback.", _fallback_free_passes),
    "local-only-routes": ("Routes with at least one decision, every one resolved locally.", _local_only),
    "decision-cadence": ("Decisions per simulated minute.", lambda rows: _rate(rows, "decisions", "time_s", 60)),
    "calls-per-decision": ("Recorded calls per driving decision.", lambda rows: _rate(rows, "calls", "decisions")),
    "calls-per-km": ("Recorded calls per kilometre driven.", lambda rows: _rate(rows, "calls", "distance_m", 1000)),
    "tokens-per-call": ("Recorded input tokens per call.", lambda rows: _rate(rows, "tokens", "calls")),
    "cost-per-call": ("Recorded US dollars per call.", lambda rows: _rate(rows, "cost_usd", "calls")),
    "cost-per-km": (
        "Recorded US dollars per kilometre driven.",
        lambda rows: _rate(rows, "cost_usd", "distance_m", 1000),
    ),
    "cost-per-pass": ("Total spend on routes with verdicts divided by passes.", _cost_per_pass),
    "spend-by-outcome": ("Spend on passed and failed routes.", _spend_by_outcome),
    "cost-per-drive-hour": (
        "Recorded US dollars per simulated hour.",
        lambda rows: _rate(rows, "cost_usd", "time_s", 3600),
    ),
    "latency-coverage": (
        "Share of routes with counted calls that report both percentiles; some calls are untimed.",
        _latency_coverage,
    ),
    "flagged-decision-rate": (
        "Flagged choices per decision on routes with flag telemetry.",
        lambda rows: _rate(rows, "flagged_choices", "decisions"),
    ),
    "flagged-check-frequency": ("Flagged choices grouped by the failed road-rule check.", _flag_checks),
    "flagged-route-outcomes": (
        "Pass rates for routes with and without flagged choices among those reporting flags.",
        _flag_outcomes,
    ),
    "fallback-exposure": (
        "Share of routes that encountered fallback incidents, including older records.",
        _fallback_exposure,
    ),
}
