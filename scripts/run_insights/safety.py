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


def _report(fields, rows):
    summaries = {}
    for field, unit in fields.items():
        measured = 0
        total = 0
        affected = []
        for index, row in enumerate(rows):
            value = row.get(field)
            if type(value) not in (int, float) or value < 0 or (isinstance(value, float) and not isfinite(value)):
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
                    {key: incident[key] for key in ("t", "street", "edge", "speed", "value") if key in incident}
                    for incident in incidents
                    if isinstance(incident, dict) and incident.get("audit") == AUDIT_KEYS.get(field, field)
                ]
            affected.append(entry)
        summaries[field] = {
            "unit": unit,
            "measured_routes": measured,
            "unmeasured_routes": len(rows) - measured,
            "total": round(total, 6) if measured else None,
            "affected_routes": sorted(affected, key=lambda entry: -entry["value"]),
        }
    return summaries


REPORTS = {name: (description, partial(_report, fields)) for name, (description, fields) in QUESTIONS.items()}
