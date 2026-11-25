"""Compare saved reports on a common set of seeded scenarios."""

from . import outcomes, profiles, safety


ROUTE_TAGS = ("length_m", "signals", "stops", "lefts", "rights")
CONDITIONS = (
    "map",
    "bbox",
    "pack",
    "seed",
    "count",
    "brain",
    "driver",
    "model",
    "mode",
    "npcs",
    "engine",
    "hour",
    "cover",
    "set",
    "suite_version",
)
DEFAULTS = {"features": "bare", "weather": "dry", "track": "guarded", "park": False, "without": []}
DIFF_FIELDS = ("weather", "features", "npcs", "track", "park", "hour", "without", "cover", "mode", "driver")
COUNTED_VIOLATIONS = tuple(
    field
    for _, fields in safety.QUESTIONS.values()
    for field, unit in fields.items()
    if unit not in ("collisions", "seconds", "metres")
)
REQUIRED_VIOLATION_COUNTS = {"red_lights", "stop_signs", "failed_to_yield"}
# These verdict reasons describe how the drive ended, not an audit violation.
NON_AUDIT_FAILURES = {"simulation error", "timeout", "stuck", "not parked"}


def is_arena_config(config):
    if config.get("kind") == "arena":
        return True
    return (
        isinstance(config.get("set"), str)
        and bool(config.get("set"))
        and "bbox" not in config
        and "seed" not in config
        and "pack" not in config
    )


def _driver_value(config):
    if config.get("driver") is not None:
        return config["driver"]
    brain = config.get("brain")
    model = config.get("model")
    if brain and model and str(model) not in str(brain):
        return f"{brain}:{model}"
    return model if model is not None else brain


def condition_differences(left, right):
    diffs = {}
    for field in DIFF_FIELDS:
        if field == "driver":
            before, after = _driver_value(left), _driver_value(right)
        elif field in DEFAULTS:
            before = left.get(field, DEFAULTS[field])
            after = right.get(field, DEFAULTS[field])
        else:
            before, after = left.get(field), right.get(field)
        if field == "without" and all(
            isinstance(values, list) and all(isinstance(value, str) for value in values) for values in (before, after)
        ):
            if set(before) == set(after):
                continue
        if before != after:
            diffs[field] = {"baseline": before, "comparison": after}
    return diffs


def restrictions_at(config):
    without = config.get("without", [])
    if not isinstance(without, list):
        raise ValueError("expected a benchmark config without array")
    # Match suiteOptions in static/js/bench/runner.js and CITY_HOUR in options.js.
    if config.get("features") == "city" and "restrictions" not in without:
        hour = config.get("hour", 15.5)
        if type(hour) not in (int, float) or not 0 <= hour < 24:
            raise ValueError("comparison requires a valid route restriction hour")
        return hour
    return None


def valid_bbox(bbox):
    return isinstance(bbox, list) and len(bbox) == 4 and all(type(value) in (int, float) for value in bbox)


def validate_suite(left, right):
    left_version = left.get("suite_version", "legacy")
    right_version = right.get("suite_version", "legacy")
    if left_version != right_version and not (
        left_version in ("legacy", "custom") and right_version in ("legacy", "custom")
    ):
        raise ValueError("comparison requires the same suite version in both configs")
    left_arena, right_arena = is_arena_config(left), is_arena_config(right)
    if left_arena or right_arena:
        if left_arena != right_arena:
            raise ValueError("comparison requires both runs to use the same suite type (benchmark or arena)")
        left_set, right_set = left.get("set"), right.get("set")
        if left_set is not None and right_set is not None and left_set != right_set:
            raise ValueError("comparison requires the same arena set in both configs")
        return
    # Browser and CLI saves can name the same map by cache key and preset respectively.
    left_bbox, right_bbox = left.get("bbox"), right.get("bbox")
    if left_bbox is not None and right_bbox is not None:
        same_map = valid_bbox(left_bbox) and valid_bbox(right_bbox) and left_bbox == right_bbox
    else:
        name = left.get("map")
        same_map = isinstance(name, str) and bool(name) and name == right.get("map")
    if not same_map:
        raise ValueError("comparison requires the same map")
    for key in ("seed", "count"):
        a, b = left.get(key), right.get(key)
        if type(a) is not int or type(b) is not int or a != b:
            raise ValueError(f"comparison requires the same {key} in both configs")
    a, b = left.get("pack"), right.get("pack")
    if type(a) not in (int, str) or type(b) not in (int, str) or not str(a) or str(a) != str(b):
        raise ValueError("comparison requires the same pack in both configs")
    if restrictions_at(left) != restrictions_at(right):
        raise ValueError("comparison requires the same route restriction settings")


def index_routes(name, rows):
    indexed = {}
    for row in rows:
        route_id = row.get("id")
        if not isinstance(route_id, str) or not route_id.strip():
            route_id = row.get("challenge")
        if not isinstance(route_id, str) or not route_id.strip():
            raise ValueError(f"{name}: comparison requires a route ID for every result")
        if route_id in indexed:
            raise ValueError(f"{name}: duplicate route ID {route_id!r}")
        indexed[route_id] = row if row.get("id") == route_id else {**row, "id": route_id}
    return indexed


def route_changes(left, right):
    changes = {}
    for field, read in (("verdict", outcomes.verdict), ("arrival", outcomes.arrival)):
        before, after = read(left), read(right)
        if before != after:
            changes[field] = {"baseline": before, "comparison": after}
    before, after = outcomes.reasons(left), outcomes.reasons(right)
    if before is not None and after is not None and before != after:
        changes["failures_added"] = sorted(set(after) - set(before))
        changes["failures_removed"] = sorted(set(before) - set(after))
    return changes


def assess_regression(left, right, routes=None):
    """Compare observed verdicts, audit labels and counters over matched rows."""
    passed_delta = collision_delta = violation_delta = 0
    verdict_pairs = label_pairs = collision_pairs = traffic_counter_pairs = 0
    missing_traffic_counts = {}
    new_audit_failures = []
    increased_violations = []
    lost_passes = []
    increased_collisions = []
    skipped = {
        key: (routes or {}).get(key, []) for key in ("baseline_only", "comparison_only", "missing_tags", "changed_tags")
    }
    for before, after in zip(left, right, strict=True):
        if type(before.get("pass")) is bool and type(after.get("pass")) is bool:
            verdict_pairs += 1
            passed_delta += after["pass"] - before["pass"]
            if before["pass"] and not after["pass"]:
                lost_passes.append(before["id"])
        earlier, later = outcomes.reasons(before), outcomes.reasons(after)
        if earlier is not None and later is not None:
            label_pairs += 1
            added = sorted(set(later) - set(earlier) - NON_AUDIT_FAILURES)
            if added:
                new_audit_failures.append({"id": before.get("id"), "failures": added})
        first = profiles.measurement(before, "collisions")
        second = profiles.measurement(after, "collisions")
        if first is not None and second is not None:
            collision_pairs += 1
            collision_delta += second - first
            if second > first:
                increased_collisions.append({"id": before["id"], "increase": second - first})
        for field in COUNTED_VIOLATIONS:
            first = profiles.measurement(before, field)
            second = profiles.measurement(after, field)
            if first is not None and second is not None:
                traffic_counter_pairs += 1
                violation_delta += second - first
                if second > first:
                    increased_violations.append({"id": before.get("id"), "field": field, "increase": second - first})
            elif first is not None or second is not None or field in REQUIRED_VIOLATION_COUNTS:
                missing_traffic_counts[field] = missing_traffic_counts.get(field, 0) + 1
    return {
        "regressed": bool(lost_passes or increased_collisions or increased_violations or new_audit_failures),
        "deltas": {
            "passed": passed_delta if verdict_pairs else None,
            "collisions": collision_delta if collision_pairs else None,
            "violations": violation_delta if traffic_counter_pairs else None,
        },
        "new_audit_failures": new_audit_failures,
        "increased_violations": increased_violations,
        "lost_passes": lost_passes,
        "increased_collisions": increased_collisions,
        "coverage": {
            "matched_routes": len(left),
            "verdict_pairs": verdict_pairs,
            "failure_label_pairs": label_pairs,
            "collision_count_pairs": collision_pairs,
            "comparable_traffic_counters": traffic_counter_pairs,
            "missing_traffic_counts": missing_traffic_counts,
            **skipped,
            "incomplete": not left
            or min(verdict_pairs, label_pairs, collision_pairs) < len(left)
            or bool(missing_traffic_counts)
            or any(skipped.values()),
        },
    }


def describe(name, config):
    values = {field: config[field] for field in CONDITIONS if field in config}
    values.update({key: config.get(key, default) for key, default in DEFAULTS.items()})
    return {"file": name, "config": values}


def match_routes(left_name, left_config, left_rows, right_name, right_config, right_rows):
    validate_suite(left_config, right_config)
    left, right = index_routes(left_name, left_rows), index_routes(right_name, right_rows)
    arena = is_arena_config(left_config) and is_arena_config(right_config)
    ids, missing_tags, changed_tags, changes = [], [], [], []
    for route_id, row in left.items():
        if route_id not in right:
            continue
        paired = right[route_id]
        if arena:
            if any(
                row.get(field) is not None and paired.get(field) is not None and row[field] != paired[field]
                for field in ("map", "pack", "seed", "version", "weather", "time", "car")
            ):
                changed_tags.append(route_id)
                continue
            ids.append(route_id)
            if changed := route_changes(row, paired):
                changes.append({"id": route_id, **changed})
            continue
        first = [outcomes.tag(row, tag) for tag in ROUTE_TAGS]
        second = [outcomes.tag(paired, tag) for tag in ROUTE_TAGS]
        if None in first or None in second:
            missing_tags.append(route_id)
        elif first != second:
            changed_tags.append(route_id)
        else:
            ids.append(route_id)
            if changed := route_changes(row, paired):
                changes.append({"id": route_id, **changed})
    routes_meta = {
        "matched": ids,
        "baseline_only": [route_id for route_id in left if route_id not in right],
        "comparison_only": [route_id for route_id in right if route_id not in left],
        "missing_tags": missing_tags,
        "changed_tags": changed_tags,
    }
    left_matched = [left[route_id] for route_id in ids]
    right_matched = [right[route_id] for route_id in ids]
    return routes_meta, changes, left_matched, right_matched


def compare(baseline, other, reports, paired_reports=None):
    left_name, left_config, left_rows = baseline
    right_name, right_config, right_rows = other
    routes_meta, changes, left_matched, right_matched = match_routes(
        left_name, left_config, left_rows, right_name, right_config, right_rows
    )
    return {
        "baseline": describe(left_name, left_config),
        "comparison": describe(right_name, right_config),
        "condition_differences": condition_differences(left_config, right_config),
        "routes": routes_meta,
        "outcome_changes": changes,
        "reports": {
            **{
                name: {"baseline": report(left_matched), "comparison": report(right_matched)}
                for name, report in reports.items()
            },
            **{name: report(left_matched, right_matched) for name, report in (paired_reports or {}).items()},
        },
    }
