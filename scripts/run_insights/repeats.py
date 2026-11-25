"""Matched, complete-case summaries for repeated saved attempts by one driver."""

from collections import Counter
from functools import partial
from pathlib import Path

from . import comparison, outcomes, profiles, scores


# Keep gates, counters and decision-normalized quantities separate. A flagged
# choice is neither an audited violation nor an emergency-brake intervention.
METRICS = {
    "driving-score": ("display score", "mean", lambda row: score_value(row, "score")),
    "pace-score": ("pace score", "mean", lambda row: score_value(row, "pace")),
    "comfort-score": ("comfort score", "mean", lambda row: score_value(row, "comfort")),
    "margin-score": ("safety margin score", "mean", lambda row: score_value(row, "margin")),
    "pass-rate": ("pass fraction", "mean", lambda row: binary(row, "pass")),
    "arrival-rate": ("arrival fraction", "mean", lambda row: binary(row, "arrived")),
    "parking-success": ("parked fraction where a space was available", "mean", lambda row: parking_success(row)),
    "flagged-decision-rate": ("flagged choices per decision", "pooled", ("flagged_choices", "decisions")),
    "fallback-decision-rate": ("Rules fallback decisions per decision", "pooled", ("fallback_decisions", "decisions")),
    "safety-brake-rate": ("emergency-brake interventions per decision", "pooled", ("safety_brakes", "decisions")),
    "model-decision-rate": ("model decisions per decision", "pooled", ("model_decisions", "decisions")),
    "local-decision-rate": ("local decisions per decision", "pooled", ("local_decisions", "decisions")),
    "partial-answer-rate": ("partial answers per model decision", "pooled", ("partial_decisions", "model_decisions")),
    "cost-per-call": ("USD per call", "pooled", ("cost_usd", "calls")),
    "tokens-per-call": ("input tokens per call", "pooled", ("tokens", "calls")),
    "time": ("simulated seconds", "sum", "time_s"),
    "distance": ("driven metres", "sum", "distance_m"),
    "collisions": ("collisions", "sum", "collisions"),
    "at-fault-collisions": ("at-fault collisions", "sum", "at_fault"),
    "red-light-violations": ("red-light violations", "sum", "red_lights"),
    "stop-sign-violations": ("stop-sign violations", "sum", "stop_signs"),
    "yield-violations": ("failures to yield", "sum", "failed_to_yield"),
    "off-road-time": ("off-road seconds", "sum", "off_road_s"),
    "fallback-incidents": ("fallback incidents", "sum", "fallbacks"),
    "safety-brakes": ("emergency-brake interventions", "sum", "safety_brakes"),
    "hard-brakes": ("hard braking events", "sum", "hard_brakes"),
    "spend": ("recorded USD", "sum", "cost_usd"),
    "decision-volume": ("decisions", "sum", "decisions"),
    "peak-deceleration": ("strongest longitudinal deceleration (m/s²)", "min", "max_decel"),
    "shortest-ttc": ("shortest closing time to collision (s)", "min", "min_ttc_s"),
    "shortest-headway": ("shortest following headway (s)", "min", "min_headway_s"),
    "peak-lateral-load": ("peak lateral acceleration (m/s²)", "max", "max_lat_accel"),
}
DEFAULT_REPORTS = ("repeat-pass-rate", "repeat-driving-score", "repeat-failures", "repeat-coverage")


def binary(row, field):
    value = row.get(field)
    return int(value) if type(value) is bool else None


def parking_success(row):
    labels = outcomes.parking(row)
    if labels and labels[0] in ("parked", "did not park"):
        return int(labels[0] == "parked")
    return None


def score_value(row, field):
    required = {
        "pace": ("time_s", "progress"),
        "comfort": ("distance_m", "rms_jerk", "hard_brakes", "max_lat_accel"),
        "margin": ("distance_m", "collisions", "safety_brakes"),
    }
    keys = required[field] if field != "score" else set().union(*required.values())
    if any(profiles.measurement(row, key) is None for key in keys):
        return None
    if field in ("pace", "score") and outcomes.tag(row, "length_m") is None:
        if profiles.measurement(row, "distance_m") is None:
            return None
    return scores.raw_scores(row)[field]


def _same_conditions(left, right):
    differences = comparison.condition_differences(left, right)
    # Runs of different model/suite are separate experimental conditions,
    # even if they advertise the same driver label.
    for field in ("brain", "model", "suite_version"):
        if left.get(field) != right.get(field):
            differences[field] = None
    return differences


def validate_inputs(runs):
    """Check identities and conditions before applying any route selection."""
    _, base_config, _ = runs[0]
    for name, config, rows in runs:
        comparison.validate_suite(base_config, config)
        if differing := _same_conditions(base_config, config):
            raise ValueError(f"{name}: repeat conditions differ: {', '.join(differing)}")
        comparison.index_routes(name, rows)

    if comparison.is_arena_config(base_config):
        # A missing baseline field must not hide conflicts between later attempts.
        seen = {}
        for name, _, rows in runs:
            for row in rows:
                for field in (*comparison.ARENA_CONDITIONS, "track"):
                    if field not in row or row[field] is None:
                        continue
                    key = (row["id"], field)
                    if seen.setdefault(key, row[field]) != row[field]:
                        raise ValueError(f"{name}: {row['id']!r} repeat drive conditions differ: {field}")


def distinct_paths(paths):
    files = set()
    for path in paths:
        try:
            info = Path(path).stat()
        except OSError as exc:
            raise ValueError(f"{path}: {exc}") from exc
        identity = info.st_dev, info.st_ino
        if identity in files:
            raise ValueError(f"{path}: the same file was supplied more than once")
        files.add(identity)


def panels(runs):
    """Keep common proven routes, with an explicit exclusion reason for every other ID."""
    indexed = [comparison.index_routes(name, rows) for name, _, rows in runs]
    ids = dict.fromkeys(route_id for attempt in indexed for route_id in attempt)
    arena = comparison.is_arena_config(runs[0][1])
    matched, excluded = {}, []
    for route_id in ids:
        rows = [attempt.get(route_id) for attempt in indexed]
        missing = [i for i, row in enumerate(rows, 1) if row is None]
        if missing:
            excluded.append({"id": route_id, "reason": "missing attempt", "attempts": missing})
            continue
        interrupted = [i for i, row in enumerate(rows, 1) if row.get("stopped") is True]
        if interrupted:
            excluded.append({"id": route_id, "reason": "interrupted drive", "attempts": interrupted})
            continue
        if not arena:
            geometry = [tuple(outcomes.tag(row, field) for field in comparison.ROUTE_TAGS) for row in rows]
            if any(None in tags for tags in geometry):
                excluded.append({"id": route_id, "reason": "missing route tags"})
                continue
            if len(set(geometry)) > 1:
                excluded.append({"id": route_id, "reason": "changed route tags"})
                continue
        matched[route_id] = rows
    return matched, excluded


def _fold(values, mode):
    if not values:
        return None
    if mode == "pooled":
        return profiles.ratio(sum(v[0] for v in values), sum(v[1] for v in values))
    if mode == "mean":
        return profiles.distribution(list(values), len(values))["mean"]
    if mode == "min":
        return min(values)
    if mode == "max":
        return max(values)
    return sum(values)


def _observation(row, mode, source):
    if mode == "pooled":
        numerator, denominator = (profiles.measurement(row, field) for field in source)
        return (numerator, denominator) if numerator is not None and denominator else None
    return source(row) if callable(source) else profiles.measurement(row, source)


def _spread(values, count):
    dist = profiles.distribution(values, count)
    return {
        **dist,
        "range": dist["max"] - dist["min"] if values else None,
    }


def metric_report(panel, count, *, unit, mode, source):
    complete = []
    routes = []
    for route_id, rows in panel.items():
        observations = [_observation(row, mode, source) for row in rows]
        values = [_fold([v], mode) if v is not None else None for v in observations]
        available = [v for v in values if v is not None]
        if len(available) == count:
            complete.append(observations)
        routes.append(
            {
                "id": route_id,
                "complete": len(available) == count,
                **_spread(available, count),
                "values": values,
            }
        )
    attempts = [_fold([route[i] for route in complete], mode) for i in range(count)]
    return {
        "unit": unit,
        "aggregation": mode,
        "coverage": {"matched_routes": len(panel), "complete_routes": len(complete)},
        "spread": _spread([v for v in attempts if v is not None], count),
        "attempts": [{"attempt": i, "value": v} for i, v in enumerate(attempts, 1)],
        "rows": routes,
    }


def recurring_failures(panel, count):
    routes = []
    for route_id, rows in panel.items():
        failures = [outcomes.reasons(row) for row in rows]
        labeled = sum(values is not None for values in failures)
        for reason, times in sorted(Counter(reason for values in failures if values for reason in values).items()):
            routes.append(
                {
                    "id": route_id,
                    "reason": reason,
                    "occurrences": times,
                    "labeled_attempts": labeled,
                    "attempts": count,
                    "recurring": times > 1,
                    "every_attempt": times == count,
                }
            )
    return {"rows": routes, "coverage": {"matched_routes": len(panel), "attempts": count}}


def verdict_sequences(panel, count):
    return {
        "coverage": {"matched_routes": len(panel), "attempts": count},
        "rows": [
            {
                "id": route_id,
                "verdicts": verdicts,
                "changed": "passed" in verdicts and "failed" in verdicts,
                "unknown_attempts": verdicts.count("unknown"),
            }
            for route_id, rows in panel.items()
            for verdicts in [[outcomes.verdict(row) for row in rows]]
        ],
    }


def attempt_coverage(panel, count):
    return {
        "rows": [
            {
                "attempt": i + 1,
                "matched_routes": len(panel),
                "recorded_verdicts": sum(type(rows[i].get("pass")) is bool for rows in panel.values()),
                "recorded_failure_lists": sum(outcomes.reasons(rows[i]) is not None for rows in panel.values()),
            }
            for i in range(count)
        ]
    }


REPORTS = {
    **{
        f"repeat-{key}": (
            f"Attempt-to-attempt spread in {unit} on a fixed complete-route panel.",
            partial(metric_report, unit=unit, mode=mode, source=source),
        )
        for key, (unit, mode, source) in METRICS.items()
    },
    "repeat-failures": ("Recurring and universal failure reasons by route.", recurring_failures),
    "repeat-verdicts": ("Saved verdict sequences, including pass/fail flips and unknowns.", verdict_sequences),
    "repeat-coverage": ("Verdict and failure-label coverage by attempt.", attempt_coverage),
}


def build(runs, keys, limit=None):
    matched, excluded = panels(runs)
    results = {}
    for key in keys:
        data = REPORTS[key][1](matched, len(runs))
        if limit is not None:
            data["rows"] = data["rows"][:limit]
        results[key] = data
    return {
        "attempts": [
            {"attempt": i, **comparison.describe(name, config), "selected_routes": len(rows)}
            for i, (name, config, rows) in enumerate(runs, 1)
        ],
        "routes": {"matched": list(matched), "excluded": excluded},
        "reports": results,
    }
