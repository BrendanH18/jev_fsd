"""Route-level explanations of aggregate changes on matched drives."""

from collections import Counter
from functools import partial

from . import outcomes, profiles


def _verdict_flow(left, right, classify):
    transitions = Counter((classify(before), classify(after)) for before, after in zip(left, right, strict=True))
    return {
        "rows": [{"before": a, "after": b, "routes": count} for (a, b), count in sorted(transitions.items())],
        "coverage": {"pairs": len(left)},
    }


def _failure_flow(left, right):
    flows = {}
    coverage = 0
    for before, after in zip(left, right, strict=True):
        first, second = outcomes.reasons(before), outcomes.reasons(after)
        if first is None or second is None:
            continue
        coverage += 1
        first, second = set(first), set(second)
        for key, labels in (("added", second - first), ("removed", first - second), ("retained", first & second)):
            for label in labels:
                flows.setdefault(label, {"added": 0, "removed": 0, "retained": 0})[key] += 1
    return {
        "rows": [{"reason": label, **counts} for label, counts in sorted(flows.items())],
        "coverage": {"pairs": len(left), "labeled_pairs": coverage},
    }


def _flag_flow(left, right):
    counts = {}
    coverage = 0
    for before, after in zip(left, right, strict=True):
        a, b = (row.get("flagged_by_check") for row in (before, after))
        if any(
            not isinstance(checks, dict) or any(type(n) is not int or n < 0 for n in checks.values())
            for checks in (a, b)
        ):
            continue
        coverage += 1
        for check in a.keys() | b.keys():
            first, second = a.get(check, 0), b.get(check, 0)
            entry = counts.setdefault(check, {"before": 0, "after": 0, "increased_on": 0, "decreased_on": 0})
            entry["before"] += first
            entry["after"] += second
            entry["increased_on"] += second > first
            entry["decreased_on"] += second < first
    return {
        "rows": [
            {"check": check, **entry, "change": entry["after"] - entry["before"]}
            for check, entry in sorted(counts.items())
        ],
        "coverage": {"pairs": len(left), "pairs_with_check_maps": coverage},
    }


def _parking_outcome(row):
    labels = outcomes.parking(row)
    return labels[0] if labels else "unknown"


def _transition_detail(left, right, *, classify, before_value, after_value):
    return {
        "rows": [
            {"id": before["id"], "before_s": before.get("time_s"), "after_s": after.get("time_s")}
            for before, after in zip(left, right, strict=True)
            if classify(before) == before_value and classify(after) == after_value
        ],
        "coverage": {"pairs": len(left)},
    }


def _paired_values(left, right, field, read):
    rows = []
    coverage = dict.fromkeys(("both", "baseline_only", "comparison_only", "neither"), 0)
    for before, after in zip(left, right, strict=True):
        a, b = read(before, field), read(after, field)
        if a is None:
            coverage["comparison_only" if b is not None else "neither"] += 1
        elif b is None:
            coverage["baseline_only"] += 1
        else:
            coverage["both"] += 1
            rows.append({"id": before["id"], "before": a, "after": b, "change": b - a})
    return rows, coverage


def contributions(left, right, *, field, unit):
    """Show the signed route contributions behind a net change in a total."""
    measured, coverage = _paired_values(left, right, field, profiles.measurement)
    increases = sum(row["change"] for row in measured if row["change"] > 0)
    decreases = sum(row["change"] for row in measured if row["change"] < 0)
    rows = [row for row in measured if row["change"] != 0]
    rows.sort(key=lambda row: (-abs(row["change"]), row["id"]))
    return {
        "unit": unit,
        "coverage": {"pairs": len(left), **coverage},
        "totals": {
            "change": sum(row["change"] for row in measured) if measured else None,
            "increase": increases if measured else None,
            "decrease": decreases if measured else None,
            "unchanged_pairs": coverage["both"] - len(rows),
        },
        "rows": rows,
    }


def _time_tradeoffs(left, right):
    buckets = {}
    measured = 0
    for before, after in zip(left, right, strict=True):
        first, second = (profiles.measurement(row, "time_s") for row in (before, after))
        if first is None or second is None:
            continue
        measured += 1
        pair = (outcomes.verdict(before), outcomes.verdict(after))
        buckets.setdefault(pair, []).append(second - first)
    return {
        "rows": [
            {"before": a, "after": b, **profiles.distribution(values, len(values))}
            for (a, b), values in sorted(buckets.items())
        ],
        "coverage": {"pairs": len(left), "pairs_with_time": measured},
        "unit": "seconds",
    }


# Totals worth decomposing by route. Rates and instantaneous peaks need different
# aggregation and belong in the matched metric catalog.
CONTRIBUTION_FIELDS = {
    "time_s": "simulated seconds",
    "distance_m": "driven metres",
    "stopped_s": "stationary seconds",
    "speeding_s": "seconds above the speeding threshold",
    "off_road_s": "off-road seconds",
    "collisions": "collisions",
    "at_fault": "at-fault collisions",
    "red_lights": "red-light violations",
    "stop_signs": "missed stop signs",
    "failed_to_yield": "failures to yield",
    "safety_brakes": "emergency-brake interventions",
    "hard_brakes": "hard braking events",
    "lane_changes": "lane changes",
    "deadlocks": "deadlock overrides",
    "fallbacks": "fallback incidents",
    "calls": "model calls",
    "tokens": "input tokens",
    "decisions": "driving decisions",
    "cost_usd": "US dollars",
    "flagged_choices": "flagged choices",
    "model_decisions": "model decisions",
    "local_decisions": "local decisions",
    "fallback_decisions": "fallback decisions",
    "partial_decisions": "partial model decisions",
}

REPORTS = {
    **{
        f"changes-{field.replace('_', '-')}": (
            f"Rank route contributions to the net change in {unit}.",
            partial(contributions, field=field, unit=unit),
        )
        for field, unit in CONTRIBUTION_FIELDS.items()
    },
    "changes-verdict-flow": (
        "Cross-tabulate matched pass, fail and unknown verdicts.",
        partial(_verdict_flow, classify=outcomes.verdict),
    ),
    "changes-arrival-flow": (
        "Cross-tabulate matched arrivals, unfinished drives and unknown outcomes.",
        partial(_verdict_flow, classify=outcomes.arrival),
    ),
    "changes-parking-flow": (
        "Cross-tabulate matched parking outcomes, including absent measurements.",
        partial(_verdict_flow, classify=_parking_outcome),
    ),
    "changes-failure-reasons": ("Count added, retained and removed verdict labels on matched routes.", _failure_flow),
    "changes-flag-checks": ("Attribute changes in flagged choices to each saved road-rule check.", _flag_flow),
    "changes-new-passes": (
        "Find matched drives that failed before and pass now.",
        partial(_transition_detail, classify=outcomes.verdict, before_value="failed", after_value="passed"),
    ),
    "changes-lost-arrivals": (
        "Find matched drives that previously arrived and are now unfinished.",
        partial(_transition_detail, classify=outcomes.arrival, before_value="arrived", after_value="unfinished"),
    ),
    "changes-recovered-arrivals": (
        "Find matched drives that previously finished short and now arrive.",
        partial(_transition_detail, classify=outcomes.arrival, before_value="unfinished", after_value="arrived"),
    ),
    "changes-time-by-verdict": ("Compare duration changes within each matched verdict transition.", _time_tradeoffs),
}
