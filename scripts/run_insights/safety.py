"""Route-level traffic audits. Seen-gated metrics contribute only where recorded."""

from functools import partial
from math import isfinite


# Some world.violations keys used in diagnostics differ from their saved result fields.
AUDIT_KEYS = {
    "at_fault": "collisions_at_fault",
    "red_lights": "red_lights_run",
    "stop_signs": "stop_signs_run",
}

# Each question selects the counters that distinguish its hazard. The unit is the
# unit of the recorded measurement; an increment in a sampled duration or distance
# is not an additional incident.
QUESTIONS = {
    "safety-collisions": (
        "Which routes recorded collisions, and how many did the audit attribute to the driver?",
        {"collisions": "collisions", "at_fault": "collisions"},
    ),
    "safety-signals": (
        "Where did the driver run a red or fail to stop safely for amber?",
        {"red_lights": "violations", "amber_lights_run": "violations"},
    ),
    "safety-stop-signs": ("Where did the driver miss a required stop?", {"stop_signs": "violations"}),
    "safety-yields": ("Where did the audit record a failure to yield?", {"failed_to_yield": "violations"}),
    "safety-plows": ("Where did the driver pass a snow plow on its right?", {"plow_right_passes": "passes"}),
    "safety-merges": ("Where did the driver take another vehicle's merge turn?", {"merge_cut_ins": "cut-ins"}),
    "safety-cyclists": (
        "Where did the driver pass too close to a cyclist or conflict with a contraflow rider?",
        {"close_passes": "passes", "contraflow_conflicts": "conflicts"},
    ),
    "safety-bus-lanes": ("How far did the driver travel in a reserved bus lane?", {"bus_lane_driving": "metres"}),
    "safety-high-beams": ("How long did high beams dazzle another road user?", {"glare_seconds": "seconds"}),
    "safety-sun-glare": (
        "How long did the driver exceed the glare speed target?",
        {"glare_speeding_seconds": "seconds"},
    ),
    "safety-prohibited-turns": ("Where did the driver make a prohibited turn?", {"illegal_turns": "turns"}),
    "safety-speed-humps": ("Where did the driver take a speed hump too fast?", {"hump_hits": "hits"}),
    "safety-crossovers": (
        "Where did the driver go before the pedestrian reached the far curb?",
        {"pxo_early_goes": "violations"},
    ),
    "safety-collection-crews": (
        "Where did the driver pass too close to a collection worker?",
        {"crew_close_passes": "passes"},
    ),
    "safety-directed-stops": (
        "Where did the driver disobey a crossing guard or traffic officer?",
        {"guard_violations": "violations", "officer_violations": "violations"},
    ),
    "safety-fresh-greens": (
        "Where did the driver enter ahead of a red-light runner?",
        {"fresh_green_conflicts": "conflicts"},
    ),
    "safety-driveways": (
        "Where did the driver conflict with a vehicle reversing from a driveway?",
        {"reversing_conflicts": "conflicts"},
    ),
    "safety-potholes": ("Where did the driver hit a pothole too fast?", {"pothole_hits": "hits"}),
    "safety-ball-warnings": (
        "Where did the driver ignore a ball rolling into the street?",
        {"ball_warnings_ignored": "warnings ignored"},
    ),
    "safety-geese": ("Where did the driver crowd geese crossing the road?", {"wildlife_conflicts": "conflicts"}),
    "safety-tailgaters": ("Where did the driver brake-check a following vehicle?", {"brake_checks": "brake checks"}),
    "safety-winter-surfaces": (
        "Where did the driver mishandle black ice or enter a snowbank narrowing out of turn?",
        {"ice_overspeed": "violations", "snowbank_conflicts": "conflicts"},
    ),
    "safety-puddles": ("Where did the driver splash a pedestrian?", {"pedestrians_splashed": "splash incidents"}),
    "safety-parking-conflicts": (
        "Where did the driver block or go around a parallel parker?",
        {"parking_conflicts": "conflicts"},
    ),
    "safety-road-closures": ("Where did the driver enter a closed road?", {"closure_entries": "entries"}),
}


INCIDENT_FIELDS = ("t", "street", "edge", "speed", "value", "x", "y", "with", "kind")


def _valid_nonneg(value):
    return type(value) in (int, float) and value >= 0 and (not isinstance(value, float) or isfinite(value))


def _report(fields, rows):
    summaries = {}
    for field, unit in fields.items():
        measured = 0
        total = 0
        affected = []
        for index, row in enumerate(rows):
            value = row.get(field)
            if not _valid_nonneg(value):
                continue
            measured += 1
            total += value
            if value == 0:
                continue
            entry = {"id": row.get("id"), "row_index": index, "value": value}
            diagnostics = row.get("diagnostics")
            incidents = diagnostics.get("incidents") if isinstance(diagnostics, dict) else None
            if isinstance(incidents, list):
                # The runner saves at most eight samples per audit, sometimes on
                # consecutive simulation steps. The counter supplies the total.
                entry["samples"] = [
                    {key: incident[key] for key in INCIDENT_FIELDS if key in incident}
                    for incident in incidents
                    if isinstance(incident, dict) and incident.get("audit") == AUDIT_KEYS.get(field, field)
                ]
            affected.append(entry)
        summaries[field] = {
            "unit": unit,
            "measured_routes": measured,
            "unmeasured_routes": len(rows) - measured,
            "total": round(total, 6) if measured else None,
            "affected_routes": sorted(
                affected,
                key=lambda entry: (
                    -entry["value"],
                    entry["id"] is None,
                    "" if entry["id"] is None else str(entry["id"]),
                ),
            ),
        }
    return summaries


def _all_hazard_families():
    families = [(name.removeprefix("safety-"), fields) for name, (_, fields) in QUESTIONS.items()]
    families.append(("off-road", {"off_road_s": "seconds"}))
    return families


def _field_exposure(rows, field, unit, family):
    measured = 0
    triggered = 0
    total = 0.0
    paired_total = 0.0
    measured_m = 0.0
    for row in rows:
        value = row.get(field)
        if not _valid_nonneg(value):
            continue
        measured += 1
        total += value
        if value > 0:
            triggered += 1
        distance = row.get("distance_m")
        if _valid_nonneg(distance) and distance > 0:
            paired_total += value
            measured_m += distance
    measured_km = measured_m / 1000
    return {
        "family": family,
        "unit": unit,
        "measured_routes": measured,
        "unmeasured_routes": len(rows) - measured,
        "triggered_routes": triggered,
        "total": round(total, 6) if measured else None,
        "measured_km": round(measured_km, 4) if measured_m > 0 else None,
        "per_km": round(paired_total / measured_km, 6) if measured_km > 0 else None,
    }


def _total_km(rows):
    distances = [row["distance_m"] for row in rows if _valid_nonneg(row.get("distance_m"))]
    return round(sum(distances) / 1000, 4) if distances else None


def safety_overview(rows):
    hazards = {}
    families_triggered = 0
    for family, fields in _all_hazard_families():
        family_hit = False
        for field, unit in fields.items():
            entry = _field_exposure(rows, field, unit, family)
            hazards[field] = entry
            if entry["triggered_routes"] > 0:
                family_hit = True
        if family_hit:
            families_triggered += 1
    off_road = _report({"off_road_s": "seconds"}, rows)["off_road_s"]
    return {
        "routes": len(rows),
        "total_km": _total_km(rows),
        "families_measured": sum(
            1 for _, fields in _all_hazard_families() if any(hazards[field]["measured_routes"] > 0 for field in fields)
        ),
        "families_triggered": families_triggered,
        "fields_triggered": sum(1 for entry in hazards.values() if entry["triggered_routes"] > 0),
        "hazards": hazards,
        "off_road_incidents": off_road,
    }


def safety_exposure(rows):
    by_family = {}
    ranked = []
    for family, fields in _all_hazard_families():
        family_fields = {}
        measured_indices = set()
        triggered_indices = set()
        for field, unit in fields.items():
            entry = _field_exposure(rows, field, unit, family)
            family_fields[field] = {key: value for key, value in entry.items() if key != "family"}
            if entry["triggered_routes"] > 0:
                ranked.append({"field": field, **entry})
            for index, row in enumerate(rows):
                value = row.get(field)
                if _valid_nonneg(value):
                    measured_indices.add(index)
                    if value > 0:
                        triggered_indices.add(index)
        by_family[family] = {
            "measured_routes": len(measured_indices),
            "triggered_routes": len(triggered_indices),
            "fields": family_fields,
        }
    ranked.sort(key=lambda item: (-item["triggered_routes"], item["field"]))
    return {
        "routes": len(rows),
        "total_km": _total_km(rows),
        "by_family": by_family,
        "ranked_hazards": ranked,
        "off_road_incidents": _report({"off_road_s": "seconds"}, rows)["off_road_s"],
    }


REPORTS = {name: (description, partial(_report, fields)) for name, (description, fields) in QUESTIONS.items()}
EXTENDED_REPORTS = {
    "safety-overview": (
        "Aggregate measured routes, triggered routes, totals, per-km exposure and off-road incidents across all hazards.",
        safety_overview,
    ),
    "safety-exposure": (
        "Per-family and per-km hazard exposure summary ranked by triggered routes, including off-road incidents.",
        safety_exposure,
    ),
}
