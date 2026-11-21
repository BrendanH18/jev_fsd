"""Route outcomes, scenario coverage and events retained by the benchmark runner."""

from collections import Counter
from itertools import combinations
from math import isfinite


def reasons(row):
    values = row.get("failures")
    if isinstance(values, list) and all(isinstance(v, str) for v in values):
        return sorted(set(values))
    return None


def counts(rows, labels):
    """Count each label emitted by a measured route. None means unmeasured."""
    histogram = Counter()
    measured = 0
    for row in rows:
        found = labels(row)
        if found is not None:
            measured += 1
            histogram.update(found)
    return {"measured_routes": measured, "counts": dict(sorted(histogram.items()))}


def verdict(row):
    value = row.get("pass")
    return "passed" if value is True else "failed" if value is False else "unknown"


def arrival(row):
    value = row.get("arrived")
    return "arrived" if value is True else "unfinished" if value is False else "unknown"


def failure_labels(row, transform):
    values = reasons(row)
    return transform(values) if values is not None else None


def failure_pairs(rows):
    pairs = Counter()
    measured = 0
    for row in rows:
        values = reasons(row)
        if values is not None:
            measured += 1
            pairs.update(combinations(values, 2))
    return {"measured_routes": measured, "pairs": [{"reasons": pair, "routes": n} for pair, n in sorted(pairs.items())]}


def inconsistencies(rows):
    return [
        row.get("id")
        for row in rows
        if reasons(row) is not None and verdict(row) != "unknown" and row["pass"] == bool(reasons(row))
    ]


def parking(row):
    if row.get("arrived") is False and ("parked" in row or row.get("no_space") is True):
        return ["did not arrive"]
    if row.get("no_space") is True:
        return ["no space"]
    if isinstance(row.get("parked"), bool):
        return ["parked" if row["parked"] else "did not park"]
    return None


def tag(row, key):
    tags = row.get("tags")
    value = tags.get(key) if isinstance(tags, dict) else None
    if type(value) not in (int, float) or not isfinite(value) or value < 0:
        return None
    return value if key == "length_m" or int(value) == value else None


def cohort(rows, classify):
    groups = {}
    for row in rows:
        key = classify(row)
        groups.setdefault(key or "unknown", Counter())[verdict(row)] += 1
    return {key: dict(values) for key, values in sorted(groups.items())}


def controls(row):
    signals, stops = tag(row, "signals"), tag(row, "stops")
    if signals is None or stops is None:
        return None
    if signals and stops:
        return "both"
    return "signals only" if signals else "stops only" if stops else "neither"


def turns(row):
    left, right = tag(row, "lefts"), tag(row, "rights")
    if left is None or right is None:
        return None
    if left == right:
        return "balanced" if left else "no recorded left or right turns"
    return "mostly left" if left > right else "mostly right"


def length(row):
    meters = tag(row, "length_m")
    if meters is not None:
        return "under 500 m" if meters < 500 else "500 to under 1000 m" if meters < 1000 else "1000 m or more"
    return None


def events(row):
    items = row.get("events")
    if isinstance(items, list) and all(isinstance(e, dict) and isinstance(e.get("type"), str) for e in items):
        return items
    return None


def event_labels(row, transform):
    items = events(row)
    return transform(items) if items is not None else None


def first_reroute(rows):
    result = []
    for row in rows:
        first = next((e for e in events(row) or [] if e["type"] == "reroute"), None)
        if first:
            result.append({"id": row.get("id"), "time_s": first.get("t")})
    return result


def streak(rows):
    longest = current = []
    for row in rows:
        if verdict(row) != "passed":
            current = []
            continue
        current.append(row.get("id"))
        if len(current) > len(longest):
            longest = current
    return longest


def exposure(row, field):
    value = row.get(field)
    if type(value) in (int, float) and isfinite(value) and value >= 0:
        return "observed" if value else "none"
    return None


def duplicate_ids(rows):
    ids = Counter(row["id"] for row in rows if isinstance(row.get("id"), str))
    return {key: n for key, n in sorted(ids.items()) if n > 1}


REPORTS = {
    "suite-verdicts": ("Count recorded pass, fail and unknown verdicts.", lambda r: counts(r, lambda x: [verdict(x)])),
    "suite-arrival-verdicts": ("Cross-tabulate arrival and pass status.", lambda r: cohort(r, arrival)),
    "suite-failure-reasons": ("Count routes affected by each saved failure reason.", lambda r: counts(r, reasons)),
    "suite-failure-pairs": ("Find failure reasons that occur together on a route.", failure_pairs),
    "suite-sole-failures": (
        "Identify reasons that alone prevented a pass.",
        lambda r: counts(
            [x for x in r if verdict(x) != "unknown"],
            lambda x: failure_labels(x, lambda v: v if len(v) == 1 and verdict(x) == "failed" else []),
        ),
    ),
    "suite-failure-burden": (
        "Count routes by number of distinct failure reasons.",
        lambda r: counts(r, lambda x: failure_labels(x, lambda v: [str(len(v))])),
    ),
    "suite-verdict-conflicts": ("Find verdicts inconsistent with their saved reasons.", inconsistencies),
    "suite-simulation-errors": (
        "Group thrown simulation steps by recorded error message.",
        lambda r: counts(r, lambda x: [x["simulation_error"]] if isinstance(x.get("simulation_error"), str) else []),
    ),
    "suite-parking-outcomes": (
        "Count parking outcomes, including unavailable spaces and drives that never arrived.",
        lambda r: counts(r, parking),
    ),
    "suite-length-outcomes": ("Compare verdicts across planned route length bands.", lambda r: cohort(r, length)),
    "suite-control-outcomes": ("Compare verdicts by signal and stop-sign exposure.", lambda r: cohort(r, controls)),
    "suite-turn-outcomes": (
        "Compare verdicts by the balance of recorded left and right turns.",
        lambda r: cohort(r, turns),
    ),
    "suite-event-mix": (
        "Count events by type in the retained route logs.",
        lambda r: counts(r, lambda x: event_labels(x, lambda es: [e["type"] for e in es])),
    ),
    "suite-final-events": (
        "Count last event types on unfinished drives with complete event logs.",
        lambda r: counts(
            [x for x in r if arrival(x) == "unfinished"],
            lambda x: event_labels(x, lambda es: None if len(es) >= 50 else [es[-1]["type"]] if es else []),
        ),
    ),
    "suite-first-reroute": ("Locate the first retained reroute in each affected drive.", first_reroute),
    "suite-reroute-outcomes": (
        "Compare verdicts with and without a retained reroute.",
        lambda r: cohort(
            r,
            lambda x: event_labels(
                x, lambda es: "reroute observed" if any(e["type"] == "reroute" for e in es) else "none observed"
            ),
        ),
    ),
    "suite-event-cap": (
        "Identify logs reaching the runner's 50-event retention ceiling.",
        lambda r: [x.get("id") for x in r if len(events(x) or []) >= 50],
    ),
    "suite-pass-streak": ("Find the earliest longest consecutive passing sequence in saved order.", streak),
    "suite-duplicate-ids": ("Detect repeated scenario identifiers before matching runs.", duplicate_ids),
    "suite-missing-tags": (
        "Count routes missing each geometry tag used in suite comparisons.",
        lambda r: counts(
            r, lambda x: [k for k in ("length_m", "signals", "stops", "lefts", "rights") if tag(x, k) is None]
        ),
    ),
    "suite-failed-distance": (
        "Sum planned metres of failed routes with a length tag.",
        lambda r: {
            "planned_m": sum(
                tag(x, "length_m") for x in r if verdict(x) == "failed" and tag(x, "length_m") is not None
            ),
            "measured_routes": sum(verdict(x) == "failed" and tag(x, "length_m") is not None for x in r),
        },
    ),
    "suite-failed-arrivals": (
        "Find arrivals that still failed and list their recorded reasons.",
        lambda r: [
            {"id": x.get("id"), "failures": reasons(x)} for x in r if arrival(x) == "arrived" and verdict(x) == "failed"
        ],
    ),
    "suite-unfinished-reasons": (
        "Count recorded reasons among drives that never arrived.",
        lambda r: counts([x for x in r if arrival(x) == "unfinished"], reasons),
    ),
    "suite-deadlock-outcomes": (
        "Compare verdicts for routes with and without recorded deadlocks.",
        lambda r: cohort(r, lambda x: exposure(x, "deadlocks")),
    ),
    "suite-safety-brake-outcomes": (
        "Compare verdicts for routes with and without safety-brake interventions.",
        lambda r: cohort(r, lambda x: exposure(x, "safety_brakes")),
    ),
}
