"""Disk schemas used by the offline map audit.

The audit checks importer output without reconstructing a map or applying simulation policy.
Unknown fields are allowed so files can carry additional metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import pi
from sys import float_info

from .calming import KINDS as CALMING_KINDS
from .parse import TRANSIT_ROUTES
from .restrictions import KINDS as TURN_KINDS
from .restrictions import RED_KINDS


@dataclass(frozen=True)
class Issue:
    path: str
    message: str


@dataclass(frozen=True)
class Rule:
    accepts: object
    expectation: str

    def check(self, value, path):
        if not self.accepts(value):
            yield Issue(path, f"expected {self.expectation}")


@dataclass(frozen=True)
class Array:
    item: object
    minimum: int = 0
    maximum: int | None = None

    def check(self, value, path):
        if not isinstance(value, list):
            yield Issue(path, "expected an array")
            return
        if self.minimum == self.maximum and len(value) != self.minimum:
            yield Issue(path, f"expected exactly {self.minimum} items")
        elif len(value) < self.minimum:
            yield Issue(path, f"expected at least {self.minimum} items")
        elif self.maximum is not None and len(value) > self.maximum:
            yield Issue(path, f"expected at most {self.maximum} items")
        for i, item in enumerate(value):
            yield from self.item.check(item, f"{path}[{i}]")


@dataclass(frozen=True)
class Object:
    required: dict
    optional: dict = field(default_factory=dict)

    def check(self, value, path):
        if not isinstance(value, dict):
            yield Issue(path, "expected an object")
            return
        for key, rule in {**self.required, **self.optional}.items():
            location = f"{path}.{key}"
            if key in value:
                yield from rule.check(value[key], location)
            elif key in self.required:
                yield Issue(location, "required field is missing")


def finite(value):
    # JSON integers can be larger than the floating-point coordinates used by the loader.
    return type(value) in (float, int) and -float_info.max <= value <= float_info.max


def number(low=None, high=None, *, integer=False, positive=False):
    def accepts(value):
        return (
            finite(value)
            and (not integer or type(value) is int)
            and (not positive or value > 0)
            and (low is None or value >= low)
            and (high is None or value <= high)
        )

    description = "an integer" if integer else "a finite number"
    if positive:
        description += " greater than zero"
    if low is not None and high is not None:
        description += f" in [{low}, {high}]"
    elif low is not None:
        description += f" at least {low}"
    elif high is not None:
        description += f" at most {high}"
    return Rule(accepts, description)


def one_of(*values):
    return Rule(lambda v: isinstance(v, str) and v in values, "one of " + ", ".join(sorted(values)))


def nullable(rule):
    return Rule(lambda v: v is None or rule.accepts(v), f"null or {rule.expectation}")


def optional_array(item):
    return NullableArray(Array(item))


@dataclass(frozen=True)
class NullableArray:
    array: Array

    def check(self, value, path):
        if value is not None:
            yield from self.array.check(value, path)


NUM = number()
NONNEG = number(0)
POS = number(positive=True)
INDEX = number(0, integer=True)
COUNT = number(1, integer=True)
OSM_ID = number(integer=True)
TEXT = Rule(lambda v: isinstance(v, str), "a string")
ID = Rule(lambda v: isinstance(v, str) and bool(v.strip()), "a nonempty string identifier")
BOOL = Rule(lambda v: type(v) is bool, "a boolean")
XY = {"x": NUM, "y": NUM}
POINT = Array(NUM, 2, 2)
POLYLINE = Array(POINT, 2)
SIDE = one_of("left", "right")
DEGREES = number(-180, 180)
AT_EDGE = {"edge": ID, "s": NONNEG}
S_LINE = {"edge": ID, "s_line": NONNEG}
SPAN = {"edge": ID, "from": NONNEG, "to": NONNEG}

SCHEDULE = Object(
    {
        "days": Array(number(0, 6, integer=True), 1, 7),
        "start": number(0, 1439, integer=True),
        "end": number(0, 1440, integer=True),
    }
)
CONTROL = Object(
    {"type": one_of("signal", "stop", "yield"), "id": ID, "s_line": NONNEG},
    {"group": one_of("A", "B"), "all_way": BOOL, "roundabout": ID},
)
EDGE = Object(
    {
        "id": ID,
        "from": ID,
        "to": ID,
        "pts": POLYLINE,
        "lanes": COUNT,
        "lane_width": POS,
        "width": POS,
        "limit": POS,
        "oneway": BOOL,
        "name": TEXT,
        "cls": ID,
        "length": POS,
        "lane_offsets": Array(NUM, 1),
        "asphalt": Array(NUM, 2, 2),
        "parking": Array(NONNEG, 2, 2),
    },
    {"bike": BOOL, "ring": ID, "control": CONTROL},
)
APPROACH = Object({**S_LINE, "heading_deg": DEGREES, "group": one_of("A", "B")})
SIGNAL = Object(
    {"id": ID, **XY, "approaches": Array(APPROACH, 2), "cycle_s": POS, "offset_s": NONNEG, "vertices": Array(ID, 1)},
)
STOP = Object({"id": ID, **S_LINE, **XY, "all_way": BOOL, "junction": ID})
YIELD = Object({"id": ID, **S_LINE, "roundabout": ID, "junction": ID})
RING = Object(
    {
        "id": ID,
        **XY,
        "island_r": POS,
        "lane_r": POS,
        "outer_r": POS,
        "ccw": BOOL,
        "edges": Array(ID, 1),
        "vertices": Array(ID, 1),
    },
)
PACK_SCHEMA = Object(
    {
        "bbox": Array(NUM, 4, 4),
        "extent": Array(NUM, 4, 4),
        "name": TEXT,
        "origin": Object({"lat": number(-90, 90), "lon": number(-180, 180)}),
        "stats": Object(
            {key: INDEX for key in ("vertices", "edges", "intersections", "stops", "buildings", "yields")},
            {"build_ms": INDEX},
        ),
        "nodes": Array(Object({"id": ID, **XY}), 1),
        "edges": Array(EDGE, 1),
        "lanes": Array(Object({"edge": ID, "idx": INDEX, "pts": POLYLINE}), 1),
        "intersections": Array(SIGNAL),
        "stops": Array(STOP),
        "buildings": Array(Object({"pts": Array(POINT, 3), "h": POS})),
    },
    {"yields": Array(YIELD), "roundabouts": Array(RING)},
)

CROSSING = Object(
    {"id": ID, **AT_EDGE, **XY, "markings": one_of("zebra", "lines"), "island": BOOL},
    {"pxo": BOOL, "beacons": BOOL},
)
CALMING = Object({"id": ID, **XY, "kind": one_of(*CALMING_KINDS), "at": Array(Object(AT_EDGE), 1)}, {"crossing": BOOL})
DRIVEWAY = Object(
    {
        "id": ID,
        "way": OSM_ID,
        **AT_EDGE,
        **XY,
        "side": SIDE,
        "heading": number(-pi - 0.001, pi + 0.001),
        "length": POS,
        "name": TEXT,
    },
)
RAIL_STOP = Object({"id": ID, "name": TEXT, "s": NONNEG})
TRACK = Object(
    {
        "id": ID,
        "name": TEXT,
        "kind": one_of("rail", "tram", "light_rail", "narrow_gauge"),
        "operator": TEXT,
        "usage": TEXT,
        "length": POS,
        "ends": Array(one_of("terminus", "edge"), 2, 2),
        "pts": POLYLINE,
        "stops": Array(RAIL_STOP),
    },
)
RAIL_CROSSING = Object(
    {
        "id": ID,
        "track": ID,
        "s": NONNEG,
        **XY,
        "heading_deg": DEGREES,
        "lights": BOOL,
        "gates": BOOL,
        "bell": BOOL,
        "edges": Array(Object({**AT_EDGE, "angle_deg": number(0, 90)}), 1),
    },
)
TRANSIT_RUN = Object(
    {
        "edges": Array(ID, 1),
        "length": POS,
        "stops": Array(Object({"id": ID, **AT_EDGE})),
    },
    {"lane": INDEX},
)
TRANSIT_ROUTE = Object(
    {"id": ID, "ref": TEXT, "name": TEXT, "mode": one_of(*TRANSIT_ROUTES), "runs": Array(TRANSIT_RUN, 1)},
    {"colour": ID},
)
AREA = Object(
    {
        "id": ID,
        "name": TEXT,
        "kind": one_of("park", "garden", "recreation_ground", "water", "river", "canal", "grass"),
        "closed": BOOL,
        "rings": Array(Array(POINT, 3)),
        "lines": Array(POLYLINE),
    },
)
PARK_SPAN = Object({**SPAN, "left": nullable(ID), "right": nullable(ID), "water": BOOL, "name": TEXT})


def restriction(kinds):
    return Object(
        {"id": ID, "osm_relation": OSM_ID, "from": ID, "to": Array(ID, 1), "kind": one_of(*kinds)},
        {"condition": SCHEDULE, "suppressed_conditions": Array(SCHEDULE, 1)},
    )


LAYER_SCHEMAS = {
    "bridges": Object({"spans": Array(Object({**SPAN, "name": TEXT, "kind": ID}))}),
    "buslanes": Object(
        {
            "lanes": Array(
                Object(
                    {
                        "edge": ID,
                        "lane": INDEX,
                        "allowed": Array(one_of("bus", "taxi", "bicycle"), 1),
                        "hours": optional_array(SCHEDULE),
                    },
                    {"conditional": ID},
                )
            )
        }
    ),
    "calming": Object({"devices": Array(CALMING)}),
    "contraflow": Object(
        {
            "edges": Array(
                Object(
                    {
                        "edge": ID,
                        "kind": one_of("lane", "track", "shared"),
                        "side": SIDE,
                        "tag": ID,
                        "way": OSM_ID,
                        "name": TEXT,
                    }
                )
            )
        }
    ),
    "crossings": Object({"crossings": Array(CROSSING)}),
    "driveways": Object({"driveways": Array(DRIVEWAY)}),
    "parks": Object({"areas": Array(AREA), "spans": Array(PARK_SPAN)}),
    "rail": Object({"tracks": Array(TRACK), "crossings": Array(RAIL_CROSSING)}),
    "restrictions": Object(
        {"restrictions": Array(restriction(TURN_KINDS))},
        {
            "red_turns": Array(restriction(RED_KINDS)),
            "skipped": Array(Object({"id": OSM_ID, "reason": ID}, {"value": TEXT})),
        },
    ),
    "scrambles": Object({"scrambles": Array(Object({"signal": ID, **XY, "source": one_of("tagged", "diagonal")}))}),
    "transit": Object({"routes": Array(TRANSIT_ROUTE), "stops": Array(Object({"id": ID, **XY, "name": TEXT}))}),
    "zones": Object(
        {
            "zones": Array(
                Object(
                    {"id": ID, "name": TEXT, "kind": one_of("school", "playground"), "spans": Array(Object(SPAN), 1)}
                )
            )
        }
    ),
}
