"""Distributions of saved benchmark measurements across route cohorts."""

from functools import partial
from math import isfinite
from sys import float_info

from . import outcomes, safety


AUDIT_UNITS = {field: unit for _, fields in safety.QUESTIONS.values() for field, unit in fields.items()}
METRICS = {
    **AUDIT_UNITS,
    "off_road_s": "seconds",
    "safety_brakes": "interventions",
    "deadlocks": "overrides",
    "fallbacks": "incidents",
    "time_s": "seconds",
    "distance_m": "metres",
    "progress": "fraction",
    "avg_kmh": "km/h",
    "stopped_s": "seconds",
    "speeding_s": "seconds",
    "wall_ms": "milliseconds",
    "max_accel": "m/s²",
    "max_decel": "m/s²",
    "hard_brakes": "brakes",
    "rms_jerk": "m/s³",
    "max_jerk": "m/s³",
    "max_lat_accel": "m/s²",
    "lane_rms_m": "metres",
    "lane_max_m": "metres",
    "lane_changes": "changes",
    "min_gap_m": "metres",
    "min_ttc_s": "seconds",
    "min_headway_s": "seconds",
    "decisions": "decisions",
    "calls": "calls",
    "tokens": "input tokens",
    "cost_usd": "USD",
    "latency_p50_ms": "milliseconds",
    "latency_p95_ms": "milliseconds",
    "model_decisions": "decisions",
    "partial_decisions": "decisions",
    "local_decisions": "decisions",
    "fallback_decisions": "decisions",
    "model_share": "fraction",
    "local_share": "fraction",
    "fallback_share": "fraction",
    "flagged_choices": "choices",
}

METRIC_LABELS = {
    "at_fault": "at-fault collisions",
    "avg_kmh": "mean trip speed",
    "glare_seconds": "time dazzling another road user",
    "glare_speeding_seconds": "time exceeding the sun-glare speed target",
    "max_decel": "most negative longitudinal acceleration",
    "progress": "route progress (arrivals count as complete)",
    "rms_jerk": "RMS longitudinal jerk",
    "lane_rms_m": "RMS lane-tracking deviation",
    "lane_max_m": "peak lane-tracking deviation",
    "min_gap_m": "minimum positive following gap",
    "min_ttc_s": "minimum closing time to collision",
    "min_headway_s": "minimum following headway",
    "latency_p50_ms": "per-route median call latency",
    "latency_p95_ms": "per-route p95 call latency",
    "wall_ms": "wall-clock run time",
}


def measurement(row, field):
    if field == "progress" and row.get("arrived") is True:
        return 1
    value = row.get(field)
    if type(value) not in (int, float):
        return None
    try:
        if not isfinite(value):
            return None
    except OverflowError:
        return None
    if field == "max_decel":
        return value if value <= 0 else None
    if field == "progress" or field.endswith("_share"):
        return value if 0 <= value <= 1 else None
    return value if value >= 0 else None


def ratio(numerator, denominator, scale=1):
    if numerator is None or not denominator:
        return None
    value = numerator / denominator * scale
    return value if isfinite(value) else None


def distance_ratio(row):
    if row.get("arrived") is True:
        return ratio(measurement(row, "distance_m"), outcomes.tag(row, "length_m"))
    return None


def per_kilometre(row, field):
    return exposure_rate(row, field, "distance_m", 1000)


def exposure_rate(row, field, exposure, scale):
    return ratio(measurement(row, field), measurement(row, exposure), scale)


def control_count(row, field):
    count = outcomes.tag(row, field)
    return None if count is None else str(int(count)) if count < 3 else "3 or more"


def presence(row, field):
    count = measurement(row, field)
    if count is None or int(count) != count:
        return None
    return "one or more" if count else "zero"


def parking(row):
    result = outcomes.parking(row)
    if result:
        return result[0]
    return "unrecorded"


def rerouting(row):
    events = outcomes.events(row)
    if events is None:
        return None
    if any(event["type"] == "reroute" for event in events):
        return "reroute observed"
    return "unknown (retention limit)" if len(events) >= 50 else "none observed"


# These are observable cohorts, not causal controls. Outcome and behavior cohorts may have
# different members on each side of a comparison.
COHORTS = {
    "length": ("planned route length", outcomes.length),
    "signals": ("mapped traffic signal count", partial(control_count, field="signals")),
    "stops": ("mapped stop sign count", partial(control_count, field="stops")),
    "lefts": ("planned left-turn count", partial(control_count, field="lefts")),
    "rights": ("planned right-turn count", partial(control_count, field="rights")),
    "controls": ("mix of mapped traffic signals and stop signs", outcomes.controls),
    "turns": ("balance of planned left and right turns", outcomes.turns),
    "verdict": ("drive verdict", outcomes.verdict),
    "arrival": ("arrival outcome", outcomes.arrival),
    "parking": ("recorded parking outcome", parking),
    "rerouting": ("observed rerouting", rerouting),
    "brake-assist": ("recorded emergency-brake intervention", partial(presence, field="safety_brakes")),
    "deadlocks": ("recorded deadlock override", partial(presence, field="deadlocks")),
    "fallback": ("recorded model fallback incident", partial(presence, field="fallbacks")),
    "flags": ("recorded flagged choice", partial(presence, field="flagged_choices")),
    "collisions": ("recorded collision", partial(presence, field="collisions")),
}


def percentile(values, fraction):
    position = fraction * (len(values) - 1)
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    if position == lower:
        return values[lower]
    weight = position - lower
    diff = values[upper] - values[lower]
    if -float_info.max <= diff <= float_info.max:
        return values[lower] + diff * weight
    return values[lower] * (1 - weight) + values[upper] * weight


def _mean(values):
    if not values:
        return None
    total = sum(values)
    if type(total) is int or isfinite(total):
        return total / len(values)
    return sum(v / len(values) for v in values)


def distribution(values, route_count):
    values.sort()
    count = len(values)
    return {
        "routes": route_count,
        "measured": count,
        "unavailable": route_count - count,
        "zero": values.count(0),
        "mean": _mean(values),
        "min": values[0] if values else None,
        "p25": percentile(values, 0.25) if values else None,
        "median": percentile(values, 0.5) if values else None,
        "p75": percentile(values, 0.75) if values else None,
        "p90": percentile(values, 0.9) if values else None,
        "p95": percentile(values, 0.95) if values else None,
        "max": values[-1] if values else None,
    }


def ranking_summary(values, digits):
    stats = distribution(values, len(values))
    return {
        key: round(stats[key], digits) if stats[key] is not None else None
        for key in ("min", "median", "p95", "max", "mean")
    }


def profile(rows, *, field, unit, cohort, read):
    counts, measured = {}, {}
    for row in rows:
        group = cohort(row) or "unknown"
        counts[group] = counts.get(group, 0) + 1
        value = read(row)
        if value is not None:
            measured.setdefault(group, []).append(value)
    groups = {group: distribution(measured.get(group, []), count) for group, count in sorted(counts.items())}
    return {"field": field, "unit": unit, "groups": groups}


# Omit cohorts determined by the measurement itself. With a zero-tolerance audit, the
# verdict already tells us that every passing drive with a measurement recorded zero.
THRESHOLDED_AUDITS = {"bus_lane_driving", "glare_seconds", "glare_speeding_seconds"}
EXCLUDED = {
    "verdict": AUDIT_UNITS.keys() - THRESHOLDED_AUDITS,
    "arrival": {"progress"},
    "brake-assist": {"safety_brakes"},
    "collisions": {"collisions", "at_fault"},
    "deadlocks": {"deadlocks"},
    "fallback": {"fallbacks", "fallback_decisions", "fallback_share"},
    "flags": {"flagged_choices"},
}


def report_for(field, label, unit, cohort_key, read):
    cohort_label, cohort = COHORTS[cohort_key]
    name = f"profile-{field.replace('_', '-')}-by-{cohort_key}"
    description = f"Per-route distribution of {label} ({unit}) by {cohort_label}."
    return name, (description, partial(profile, field=field, unit=unit, cohort=cohort, read=read))


REPORTS = dict(
    report_for(field, METRIC_LABELS.get(field, field.replace("_", " ")), unit, key, partial(measurement, field=field))
    for key in COHORTS
    for field, unit in METRICS.items()
    if field not in EXCLUDED.get(key, ())
)
REPORTS.update(
    [
        report_for("distance_ratio", "driven-to-planned distance on arrivals", "ratio", "rerouting", distance_ratio),
        report_for(
            "safety_brakes_per_km",
            "emergency-brake interventions per kilometre driven",
            "interventions/km",
            "length",
            partial(per_kilometre, field="safety_brakes"),
        ),
        report_for(
            "tokens_per_km",
            "recorded input tokens per kilometre driven",
            "tokens/km",
            "length",
            partial(per_kilometre, field="tokens"),
        ),
    ]
)

# Counts and durations are hard to compare between drives of different lengths.
# Use the exposure actually recorded, including on drives that did not finish.
RATE_METRICS = {
    "collisions_per_km": ("collisions", "distance_m", 1000, "collisions/km"),
    "at_fault_per_km": ("at_fault", "distance_m", 1000, "at-fault collisions/km"),
    "hard_brakes_per_km": ("hard_brakes", "distance_m", 1000, "brakes/km"),
    "lane_changes_per_km": ("lane_changes", "distance_m", 1000, "changes/km"),
    "calls_per_km": ("calls", "distance_m", 1000, "calls/km"),
    "cost_usd_per_km": ("cost_usd", "distance_m", 1000, "USD/km"),
    "off_road_pct": ("off_road_s", "time_s", 100, "% of drive time"),
    "stopped_pct": ("stopped_s", "time_s", 100, "% of drive time"),
    "speeding_pct": ("speeding_s", "time_s", 100, "% of drive time"),
    "flags_per_100_decisions": ("flagged_choices", "decisions", 100, "choices/100 decisions"),
}
RATE_COHORTS = ("length", "signals", "stops", "lefts", "rights", "controls", "turns", "arrival", "parking", "rerouting")

RATE_REPORTS = dict(
    report_for(
        name,
        METRIC_LABELS.get(field, field.replace("_", " ")),
        unit,
        cohort,
        partial(exposure_rate, field=field, exposure=exposure, scale=scale),
    )
    for name, (field, exposure, scale, unit) in RATE_METRICS.items()
    for cohort in RATE_COHORTS
)
REPORTS.update(RATE_REPORTS)


def paired_rate(left, right, *, field, exposure, scale, unit, cohort):
    """Compare rates on identically measured routes, grouped by their baseline conditions."""
    groups = {}
    for before, after in zip(left, right, strict=True):
        group = groups.setdefault(cohort(before) or "unknown", {"pairs": 0, "baseline_only": 0, "comparison_only": 0})
        group["pairs"] += 1
        before_rate = exposure_rate(before, field, exposure, scale)
        after_rate = exposure_rate(after, field, exposure, scale)
        if before_rate is None or after_rate is None:
            group["baseline_only"] += before_rate is not None
            group["comparison_only"] += after_rate is not None
            continue
        group.setdefault("baseline", []).append(before_rate)
        group.setdefault("comparison", []).append(after_rate)
        group.setdefault("difference", []).append(after_rate - before_rate)

    for group in groups.values():
        for key in ("baseline", "comparison", "difference"):
            group[key] = distribution(group.get(key, []), group["pairs"])
    return {
        "numerator": field,
        "exposure": exposure,
        "unit": unit,
        "difference_unit": "percentage points" if unit.startswith("%") else unit,
        "cohort_side": "baseline",
        "groups": dict(sorted(groups.items())),
    }


PAIRED_RATES = {
    f"paired-{name.replace('_', '-')}-by-{key}": (
        f"Matched changes in {METRIC_LABELS.get(field, field.replace('_', ' '))} ({unit}) by baseline {COHORTS[key][0]}.",
        partial(paired_rate, field=field, exposure=exposure, scale=scale, unit=unit, cohort=COHORTS[key][1]),
    )
    for name, (field, exposure, scale, unit) in RATE_METRICS.items()
    for key in RATE_COHORTS
}
