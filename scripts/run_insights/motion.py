"""Route rankings based on measurements saved by DriveMetrics and the benchmark runner."""

from math import isfinite


def _ratio(numerator, denominator, scale=1):
    if denominator > 0:
        return numerator / denominator * scale
    return None


def _moving_time(elapsed, stopped):
    return elapsed - stopped if 0 <= stopped <= elapsed else None


def _moving_speed(distance, elapsed, stopped):
    moving = _moving_time(elapsed, stopped)
    if moving is not None:
        return _ratio(distance, moving, 3.6)
    return None


def _time_share(elapsed, stopped):
    if _moving_time(elapsed, stopped) is not None:
        return _ratio(stopped, elapsed, 100)
    return None


def _valid_number(value):
    return type(value) in (int, float) and isfinite(value)


def _rank(description, unit, *fields, calculate=None, lowest_first=False):
    """Rank using full precision, retaining input order on ties and counting unavailable rows."""

    def report(rows):
        routes = []
        for row in rows:
            values = [1 if field == "progress" and row.get("arrived") is True else row.get(field) for field in fields]
            if not all(_valid_number(v) and (v <= 0 if k == "max_decel" else v >= 0) for k, v in zip(fields, values)):
                continue
            value = calculate(*values) if calculate else values[0]
            if _valid_number(value):
                routes.append({"id": row.get("id"), "value": value})
        routes.sort(key=lambda route: route["value"], reverse=not lowest_first)
        for route in routes:
            route["value"] = round(route["value"], 4)
        return {"unit": unit, "routes": routes, "unavailable": len(rows) - len(routes)}

    return description, report


REPORTS = {
    "motion-duration": _rank("Which routes consumed the most simulated time?", "s", "time_s"),
    "motion-distance": _rank("Which drives covered the most ground, including reverse travel?", "m", "distance_m"),
    "motion-progress": _rank(
        "Which routes reached the smallest fraction of their route length?",
        "%",
        "progress",
        calculate=lambda progress: 100 * progress if progress <= 1 else None,
        lowest_first=True,
    ),
    "motion-trip-speed": _rank(
        "Which drives had the lowest overall mean speed, stops included?", "km/h", "avg_kmh", lowest_first=True
    ),
    "motion-moving-speed": _rank(
        "Which drives covered the least distance per moving hour (estimated from total distance)?",
        "km/h",
        "distance_m",
        "time_s",
        "stopped_s",
        calculate=_moving_speed,
        lowest_first=True,
    ),
    "motion-moving-time": _rank(
        "Which drives spent the most time moving at 0.3 m/s or faster?",
        "s",
        "time_s",
        "stopped_s",
        calculate=_moving_time,
    ),
    "motion-stopped-time": _rank("Which drives accumulated the most time below 0.3 m/s?", "s", "stopped_s"),
    "motion-stopped-share": _rank(
        "Which drives spent the highest percentage of their time stopped?",
        "%",
        "time_s",
        "stopped_s",
        calculate=_time_share,
    ),
    "motion-simulation-speed": _rank(
        "Which drives advanced the fewest simulated seconds per wall-clock second?",
        "sim s/wall s",
        "time_s",
        "wall_ms",
        calculate=lambda elapsed, wall_ms: _ratio(elapsed, wall_ms, 1000),
        lowest_first=True,
    ),
    "motion-peak-acceleration": _rank("Which drives recorded the strongest forward acceleration?", "m/s²", "max_accel"),
    "motion-peak-deceleration": _rank(
        "Which drives had the most negative longitudinal acceleration?", "m/s²", "max_decel", lowest_first=True
    ),
    "motion-rms-jerk": _rank("Which drives had the roughest longitudinal acceleration overall?", "m/s³", "rms_jerk"),
    "motion-peak-jerk": _rank("Which drives recorded the sharpest single acceleration change?", "m/s³", "max_jerk"),
    "motion-jerk-crest": _rank(
        "Where did a jerk spike stand out most relative to the drive's RMS jerk?",
        "peak/RMS",
        "max_jerk",
        "rms_jerk",
        calculate=_ratio,
    ),
    "motion-cornering-load": _rank(
        "Which drives produced the highest peak lateral acceleration?", "m/s²", "max_lat_accel"
    ),
    "motion-hard-brake-density": _rank(
        "Which drives recorded the most hard brakes per kilometre?",
        "brakes/km",
        "hard_brakes",
        "distance_m",
        calculate=lambda brakes, distance: _ratio(brakes, distance, 1000),
    ),
    "motion-lane-tracking": _rank(
        "Which drives had the largest RMS deviation from their tracked lane centre?", "m", "lane_rms_m"
    ),
    "motion-peak-lane-error": _rank("Which drives strayed farthest from the tracked lane centre?", "m", "lane_max_m"),
    "motion-lane-error-crest": _rank(
        "Where did a single lane deviation stand out most relative to RMS deviation?",
        "peak/RMS",
        "lane_max_m",
        "lane_rms_m",
        calculate=_ratio,
    ),
    "motion-lane-change-density": _rank(
        "Which routes had the most lane changes per kilometre?",
        "changes/km",
        "lane_changes",
        "distance_m",
        calculate=lambda changes, distance: _ratio(changes, distance, 1000),
    ),
    "motion-following-gap": _rank(
        "Which drives recorded the smallest gap to a vehicle ahead?", "m", "min_gap_m", lowest_first=True
    ),
    "motion-closing-time": _rank(
        "Which drives had the shortest time to collision while closing on a lead vehicle?",
        "s",
        "min_ttc_s",
        lowest_first=True,
    ),
    "motion-following-headway": _rank(
        "Which drives recorded the shortest following headway above 2 m/s?",
        "s",
        "min_headway_s",
        lowest_first=True,
    ),
    "motion-off-road-time": _rank("Which drives spent the most time off road?", "s", "off_road_s"),
    "motion-speeding-share": _rank(
        "Which drives spent the greatest percentage of elapsed time over 110% of the speed limit?",
        "%",
        "speeding_s",
        "time_s",
        calculate=lambda speeding, elapsed: _time_share(elapsed, speeding),
    ),
}
