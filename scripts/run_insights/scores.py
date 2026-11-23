"""Composite drive scores (matching static/js/bench/scores.js) and paired metric deltas."""

from functools import partial, reduce
from math import floor, isfinite
from operator import add

from . import comparison, decisions, motion, outcomes, profiles, safety


SCORES_VERSION = 1
REFERENCE_KMH = 50
REFERENCE_MPS = REFERENCE_KMH / 3.6

SCORE_COHORTS = ("length", "signals", "stops", "controls", "turns", "verdict", "arrival", "parking", "rerouting")


def _num(value):
    return value if type(value) in (int, float) and isfinite(value) else None


def _math_round(value):
    """Match ECMA-262 Math.round (half towards +infinity without 0.49999999999999994 carry)."""
    lower = floor(value)
    return lower + 1 if value - lower >= 0.5 else lower


def _round(value, digits=1):
    if type(value) not in (int, float) or not isfinite(value):
        return None
    factor = 10**digits
    result = _math_round(value * factor) / factor
    return 0.0 if result == 0 else result


def ramp(x, good, bad):
    """Linear ramp: 1 at good, 0 at bad, clamped to [0, 1]."""
    return max(0.0, min(1.0, (bad - x) / (bad - good)))


def comfort_score(row):
    km = max(0.1, (_num(row.get("distance_m")) or 0) / 1000)
    rms_jerk = _num(row.get("rms_jerk"))
    hard_brakes = _num(row.get("hard_brakes")) or 0
    max_lat = _num(row.get("max_lat_accel"))
    j = ramp(0 if rms_jerk is None else rms_jerk, 1, 6)
    b = ramp(hard_brakes / km, 0, 10)
    y = ramp(0 if max_lat is None else max_lat, 2, 7)
    return 100 * (0.4 * j + 0.3 * b + 0.3 * y)


def margin_score(row):
    collisions = _num(row.get("collisions"))
    if collisions is not None and collisions > 0:
        return 0.0
    km = max(0.1, (_num(row.get("distance_m")) or 0) / 1000)
    min_ttc = _num(row.get("min_ttc_s"))
    min_hw = _num(row.get("min_headway_s"))
    safety_brakes = _num(row.get("safety_brakes")) or 0
    t = 1.0 if min_ttc is None else ramp(min_ttc, 4, 1)
    h = 1.0 if min_hw is None else ramp(min_hw, 2, 0.5)
    s = ramp(safety_brakes / km, 0, 5)
    return 100 * (0.4 * t + 0.3 * h + 0.3 * s)


def raw_scores(row):
    raw_progress = _num(row.get("progress"))
    progress = 1.0 if row.get("arrived") else max(0.0, min(1.0, 0.0 if raw_progress is None else raw_progress))
    tags = row.get("tags")
    tag_length = _num(tags.get("length_m")) if isinstance(tags, dict) else None
    dist_length = _num(row.get("distance_m"))
    length = tag_length if tag_length is not None else dist_length if dist_length is not None else 0
    ideal = (progress * length) / REFERENCE_MPS
    raw_time = _num(row.get("time_s"))
    time_s = 0 if raw_time is None else raw_time
    lost = max(0.0, time_s - ideal)
    pace = 100 * min(1.0, ideal / time_s) if time_s > 0 else 0.0
    comfort = comfort_score(row)
    margin = margin_score(row)
    return {
        "progress": progress,
        "length_m": length,
        "time_lost_s": lost,
        "pace": pace,
        "comfort": comfort,
        "margin": margin,
        "score": (progress * (pace + comfort + margin)) / 3,
    }


def drive_scores(row):
    s = raw_scores(row)
    return {
        "progress": _round(s["progress"], 3),
        "pace": _round(s["pace"]),
        "comfort": _round(s["comfort"]),
        "margin": _round(s["margin"]),
        "score": _round(s["score"]),
        "time_lost_s": _round(s["time_lost_s"]),
        "time_lost_s_per_km": _round(s["time_lost_s"] / (s["length_m"] / 1000)) if s["length_m"] > 0 else None,
    }


def driver_scores(rows):
    raw = [raw_scores(row) for row in rows]

    def total(key):
        # JS reduce adds in drive order using IEEE 754 arithmetic.
        return reduce(add, (item[key] for item in raw), 0.0)

    def mean(key, digits=1):
        return _round(total(key) / len(raw), digits) if raw else None

    lost = total("time_lost_s")
    km = total("length_m") / 1000
    return {
        "drives": len(rows),
        "passed": sum(1 for row in rows if row.get("pass")),
        "progress": mean("progress", 3),
        "pace": mean("pace"),
        "comfort": mean("comfort"),
        "margin": mean("margin"),
        "score": mean("score"),
        "time_lost_s": _round(lost),
        "time_lost_s_per_km": _round(lost / km) if km > 0 else None,
        "km": _round(km, 2),
    }


def _route_sort_key(route_id):
    return (route_id is None, "" if route_id is None else str(route_id))


def scores_summary(rows):
    per_route = [drive_scores(row) for row in rows]
    distributions = {
        field: profiles.distribution([item[field] for item in per_route if item[field] is not None], len(rows))
        for field in ("score", "progress", "pace", "comfort", "margin", "time_lost_s", "time_lost_s_per_km")
    }
    return {
        "version": SCORES_VERSION,
        "aggregate": driver_scores(rows),
        "distributions": distributions,
    }


def scores_ranked(rows):
    routes = []
    values = []
    for row in rows:
        item = drive_scores(row)
        routes.append({"id": row.get("id"), **item})
        values.append(item["score"])
    routes.sort(key=lambda item: (-item["score"], *_route_sort_key(item["id"])))
    return {
        "unit": "score",
        "routes": routes,
        "unavailable": 0,
        "summary": profiles.ranking_summary(values, 1),
    }


def scores_lowest(rows):
    routes = []
    values = []
    for row in rows:
        item = drive_scores(row)
        entry = {"id": row.get("id"), "pass": row.get("pass"), "arrived": row.get("arrived"), **item}
        routes.append(entry)
        values.append(item["score"])
    routes.sort(key=lambda item: (item["score"], *_route_sort_key(item["id"])))
    return {
        "unit": "score",
        "routes": routes,
        "unavailable": 0,
        "summary": profiles.ranking_summary(values, 1),
    }


def scores_by_cohort(rows, *, cohort_key):
    _, classify = profiles.COHORTS[cohort_key]
    grouped = {}
    for row in rows:
        group = classify(row) or "unknown"
        grouped.setdefault(group, []).append(row)
    groups = {}
    for group, group_rows in sorted(grouped.items()):
        summary = scores_summary(group_rows)
        groups[group] = {
            "routes": len(group_rows),
            "aggregate": summary["aggregate"],
            "distributions": summary["distributions"],
        }
    return {"cohort": cohort_key, "version": SCORES_VERSION, "groups": groups}


REPORTS = {
    "scores-summary": ("Suite aggregate composite scores and per-component distributions.", scores_summary),
    "scores-ranked": ("Routes ranked by composite score, highest first.", scores_ranked),
    "scores-lowest": ("Worst-scoring routes with composite component breakdown.", scores_lowest),
    **{
        f"scores-by-{key}": (
            f"Composite score aggregates and distributions grouped by {profiles.COHORTS[key][0]}.",
            partial(scores_by_cohort, cohort_key=key),
        )
        for key in SCORE_COHORTS
    },
}


def _score_field(row, field):
    return drive_scores(row)[field]


PAIRED_SCORE_SPECS = {
    "score": ("composite score", "points", partial(_score_field, field="score")),
    "comfort": ("comfort score", "points", partial(_score_field, field="comfort")),
    "margin": ("margin score", "points", partial(_score_field, field="margin")),
    "pace": ("pace score", "points", partial(_score_field, field="pace")),
    "time_lost_s_per_km": ("time lost per kilometre", "s/km", partial(_score_field, field="time_lost_s_per_km")),
}

PAIRED_CONTINUOUS_FIELDS = (
    "avg_kmh",
    "time_s",
    "rms_jerk",
    "max_lat_accel",
    "lane_rms_m",
    "min_ttc_s",
    "min_headway_s",
    "min_gap_m",
    "latency_p50_ms",
    "latency_p95_ms",
    "model_share",
    "fallback_share",
)

PAIRED_METRIC_SPECS = {
    **PAIRED_SCORE_SPECS,
    **{
        field: (
            profiles.METRIC_LABELS.get(field, field.replace("_", " ")),
            profiles.METRICS[field],
            partial(profiles.measurement, field=field),
        )
        for field in PAIRED_CONTINUOUS_FIELDS
    },
}


def paired_metric(left, right, *, field, unit, cohort, read):
    """Compare score or continuous measurements on matched routes, grouped by baseline cohort."""
    groups = {}
    for before, after in zip(left, right, strict=True):
        group = groups.setdefault(
            cohort(before) or "unknown",
            {"pairs": 0, "baseline_only": 0, "comparison_only": 0},
        )
        group["pairs"] += 1
        before_val = read(before)
        after_val = read(after)
        if before_val is None or after_val is None:
            group["baseline_only"] += before_val is not None
            group["comparison_only"] += after_val is not None
            continue
        group.setdefault("baseline", []).append(before_val)
        group.setdefault("comparison", []).append(after_val)
        group.setdefault("difference", []).append(after_val - before_val)
    for group in groups.values():
        for key in ("baseline", "comparison", "difference"):
            group[key] = profiles.distribution(group.get(key, []), group["pairs"])
    return {
        "field": field,
        "unit": unit,
        "difference_unit": "percentage points" if unit.startswith("%") else unit,
        "cohort_side": "baseline",
        "groups": dict(sorted(groups.items())),
    }


PAIRED_METRICS = {
    f"paired-{name.replace('_', '-')}-by-{key}": (
        f"Matched changes in {label} ({unit}) by baseline {profiles.COHORTS[key][0]}.",
        partial(paired_metric, field=name, unit=unit, cohort=profiles.COHORTS[key][1], read=read),
    )
    for name, (label, unit, read) in PAIRED_METRIC_SPECS.items()
    for key in profiles.RATE_COHORTS
}


def build_summary(config, rows, top=5):
    """Build a concise executive digest of verdicts, composite scores, safety, motion and decisions."""
    verdict_counts = outcomes.REPORTS["suite-verdicts"][1](rows)["counts"]
    passed = verdict_counts.get("passed", 0)
    failed = verdict_counts.get("failed", 0)
    unknown = verdict_counts.get("unknown", 0)
    arrived = sum(1 for row in rows if outcomes.arrival(row) == "arrived")
    unfinished = sum(1 for row in rows if outcomes.arrival(row) == "unfinished")
    failure_reasons = outcomes.REPORTS["suite-failure-reasons"][1](rows)["counts"]
    top_reasons = sorted(failure_reasons.items(), key=lambda pair: (-pair[1], pair[0]))[:top]

    lowest = scores_lowest(rows)["routes"][:top]
    exposure = safety.safety_exposure(rows)
    triggered_hazards = [
        {
            "field": item["field"],
            "family": item["family"],
            "triggered_routes": item["triggered_routes"],
            "total": item["total"],
            "unit": item["unit"],
            "per_km": item["per_km"],
        }
        for item in exposure["ranked_hazards"][:top]
    ]

    motion_peaks = {}
    for key, report_id in (
        ("rms_jerk", "motion-rms-jerk"),
        ("max_lat_accel", "motion-cornering-load"),
        ("max_decel", "motion-peak-deceleration"),
        ("lane_rms_m", "motion-lane-tracking"),
        ("min_ttc_s", "motion-closing-time"),
        ("min_headway_s", "motion-following-headway"),
        ("min_gap_m", "motion-following-gap"),
        ("avg_kmh", "motion-trip-speed"),
    ):
        result = motion.REPORTS[report_id][1](rows)
        motion_peaks[key] = {"unit": result["unit"], **result["summary"]}

    cost_rows = [v for row in rows if (v := profiles.measurement(row, "cost_usd")) is not None]
    token_rows = [v for row in rows if (v := profiles.measurement(row, "tokens")) is not None]
    call_rows = [v for row in rows if (v := profiles.measurement(row, "calls")) is not None]
    mix = decisions.REPORTS["decision-sources"][1](rows)
    model_share = mix["shares"]["model_decisions"]
    fallback_share = mix["shares"]["fallback_decisions"]
    if model_share is None:
        ms_vals = [v for row in rows if (v := profiles.measurement(row, "model_share")) is not None]
        model_share = round(sum(ms_vals) / len(ms_vals), 6) if ms_vals else None
    if fallback_share is None:
        fs_vals = [v for row in rows if (v := profiles.measurement(row, "fallback_share")) is not None]
        fallback_share = round(sum(fs_vals) / len(fs_vals), 6) if fs_vals else None
    cost_pass = decisions.REPORTS["cost-per-pass"][1](rows)
    fallback_exp = decisions.REPORTS["fallback-exposure"][1](rows)
    lat_p50 = decisions.EXTENDED_REPORTS["median-call-latency-summary"][1](rows)["summary"]
    lat_p95 = decisions.EXTENDED_REPORTS["tail-call-latency-summary"][1](rows)["summary"]

    return {
        "config": comparison.describe("", config)["config"],
        "verdicts": {
            "total": len(rows),
            "passed": passed,
            "failed": failed,
            "unknown": unknown,
            "pass_rate": round(passed / len(rows), 4) if rows else None,
            "arrived": arrived,
            "unfinished": unfinished,
            "top_failure_reasons": [{"reason": reason, "routes": count} for reason, count in top_reasons],
        },
        "scores": {
            "aggregate": driver_scores(rows),
            "lowest_routes": [
                {
                    "id": item["id"],
                    "score": item["score"],
                    "pace": item["pace"],
                    "comfort": item["comfort"],
                    "margin": item["margin"],
                    "pass": item["pass"],
                }
                for item in lowest
            ],
        },
        "safety": {
            "total_km": exposure["total_km"],
            "families_triggered": sum(1 for fam in exposure["by_family"].values() if fam["triggered_routes"] > 0),
            "triggered_hazards": triggered_hazards,
            "off_road_s": {
                "triggered_routes": len(exposure["off_road_incidents"]["affected_routes"]),
                "total": exposure["off_road_incidents"]["total"],
            },
        },
        "motion_peaks": motion_peaks,
        "decisions": {
            "cost_usd": round(sum(cost_rows), 6) if cost_rows else None,
            "usd_per_pass": cost_pass["usd_per_pass"],
            "tokens": sum(token_rows) if token_rows else None,
            "calls": sum(call_rows) if call_rows else None,
            "latency_p50_ms": lat_p50,
            "latency_p95_ms": lat_p95,
            "model_share": model_share,
            "fallback_share": fallback_share,
            "fallback_routes_affected": fallback_exp["routes_affected"],
        },
    }


def _diff(before, after, digits=1):
    if before is None or after is None:
        return None
    return round(after - before, digits)


def build_comparison_summary(baseline, other, top=5):
    """Build an executive comparison digest over matched routes."""
    left_name, left_config, left_rows = baseline
    right_name, right_config, right_rows = other
    routes_meta, changes, left_matched, right_matched = comparison.match_routes(
        left_name, left_config, left_rows, right_name, right_config, right_rows
    )
    left_digest = build_summary(left_config, left_matched, top=top)
    right_digest = build_summary(right_config, right_matched, top=top)
    left_agg = left_digest["scores"]["aggregate"]
    right_agg = right_digest["scores"]["aggregate"]
    audit_deltas = comparison.assess_regression(left_matched, right_matched)["deltas"]
    return {
        "baseline": {"file": left_name, "summary": left_digest},
        "comparison": {"file": right_name, "summary": right_digest},
        "condition_differences": comparison.condition_differences(left_config, right_config),
        "routes": routes_meta,
        "deltas": {
            **audit_deltas,
            "score": _diff(left_agg["score"], right_agg["score"]),
            "pace": _diff(left_agg["pace"], right_agg["pace"]),
            "comfort": _diff(left_agg["comfort"], right_agg["comfort"]),
            "margin": _diff(left_agg["margin"], right_agg["margin"]),
            "time_lost_s_per_km": _diff(left_agg["time_lost_s_per_km"], right_agg["time_lost_s_per_km"]),
        },
        "outcome_changes": changes,
    }
