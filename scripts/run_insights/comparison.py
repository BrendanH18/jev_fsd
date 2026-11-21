"""Compare saved reports on a common set of seeded scenarios."""

from . import outcomes


ROUTE_TAGS = ("length_m", "signals", "stops", "lefts", "rights")
CONDITIONS = ("map", "bbox", "pack", "seed", "count", "brain", "model", "mode", "npcs", "engine", "hour", "cover")
DEFAULTS = {"features": "bare", "weather": "dry", "track": "guarded", "park": False, "without": []}


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
            raise ValueError(f"{name}: comparison requires a route ID for every result")
        if route_id in indexed:
            raise ValueError(f"{name}: duplicate route ID {route_id!r}")
        indexed[route_id] = row
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


def describe(name, config):
    values = {field: config[field] for field in CONDITIONS if field in config}
    values.update({key: config.get(key, default) for key, default in DEFAULTS.items()})
    return {"file": name, "config": values}


def compare(baseline, other, reports):
    left_name, left_config, left_rows = baseline
    right_name, right_config, right_rows = other
    validate_suite(left_config, right_config)
    left, right = index_routes(left_name, left_rows), index_routes(right_name, right_rows)
    ids, missing_tags, changed_tags, changes = [], [], [], []
    for route_id, row in left.items():
        if route_id not in right:
            continue
        paired = right[route_id]
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

    left_matched = [left[route_id] for route_id in ids]
    right_matched = [right[route_id] for route_id in ids]
    return {
        "baseline": describe(left_name, left_config),
        "comparison": describe(right_name, right_config),
        "routes": {
            "matched": ids,
            "baseline_only": [route_id for route_id in left if route_id not in right],
            "comparison_only": [route_id for route_id in right if route_id not in left],
            "missing_tags": missing_tags,
            "changed_tags": changed_tags,
        },
        "outcome_changes": changes,
        "reports": {
            name: {"baseline": report(left_matched), "comparison": report(right_matched)}
            for name, report in reports.items()
        },
    }
