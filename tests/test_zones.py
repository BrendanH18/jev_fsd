import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts the project on the path)

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.pack import pack_from_osm, pack_path
from jev.osm.parse import OsmData, parse_xml
from jev.osm.project import Projection
from jev.osm.zones import (MIN_SPAN_M, SCHOOL_REACH_M, build_zones, kind_of, load_zones, zones_from_osm,
                           zones_path)

LAT0, LON0 = 49.0, -123.0


def street(places=()):
    """An east-west two-way street 600 m long between two side streets, its centreline on y = 0;
    `places` are (osm id, tags, outline) with the outline as [(x, y), ...] (closed when its last point
    is its first; one point is a node)."""
    proj = Projection(LAT0, LON0)
    osm = OsmData()

    def node(nid, x, y, tags=None):
        lat, lon = proj.to_latlon(x, y)
        osm.add_node(nid, lat, lon, tags or {})

    for nid, x in ((1, -300), (2, 300)):
        node(nid, x, 0)
        node(10 + nid, x, 100)
        node(20 + nid, x, -100)
        osm.add_way(30 + nid, [20 + nid, nid, 10 + nid], {"highway": "residential", "name": "Side %d" % nid})
    osm.add_way(40, [1, 2], {"highway": "residential", "name": "Main St", "maxspeed": "50"})
    next_id = 1000
    for osm_id, tags, outline in places:
        if len(outline) == 1:
            node(osm_id, *outline[0], tags)
            continue
        refs = []
        for i, (x, y) in enumerate(outline):
            if i == len(outline) - 1 and (x, y) == outline[0]:
                refs.append(refs[0])
                continue
            next_id += 1
            node(next_id, x, y)
            refs.append(next_id)
        osm.add_way(osm_id, refs, tags)
    s, w = proj.to_latlon(-320, -120)
    n, e = proj.to_latlon(320, 120)
    return osm, (w, s, e, n)


def box(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]


SCHOOL = {"amenity": "school", "name": "Bayview Elementary"}


class ZoneTests(unittest.TestCase):
    def test_a_school_beside_the_street_makes_a_zone_both_ways_along_its_frontage(self):
        # grounds from x = -100 to 0, their near side 15 m north of the centreline
        osm, bbox = street([(50, SCHOOL, box(-100, 15, 0, 80))])
        pack = pack_from_osm(osm, bbox)
        out = zones_from_osm(osm, pack)
        self.assertEqual(len(out["zones"]), 1)
        z = out["zones"][0]
        self.assertEqual((z["id"], z["kind"], z["name"]), ("sw50", "school", "Bayview Elementary"))
        edges = {e["id"]: e for e in pack["edges"]}
        self.assertEqual(len(z["spans"]), 2, "one each way the traffic goes")
        for span in z["spans"]:
            e = edges[span["edge"]]
            self.assertEqual(e["name"], "Main St")
            # within SCHOOL_REACH_M of the grounds: from about x = -100 - 16 to 0 + 16
            eastbound = e["pts"][0][0] < e["pts"][-1][0]
            start, end = e["pts"][0][0], e["pts"][-1][0]
            lo = (start + span["from"]) if eastbound else (start - span["to"])
            hi = (start + span["to"]) if eastbound else (start - span["from"])
            reach = (SCHOOL_REACH_M ** 2 - 15 ** 2) ** 0.5
            self.assertAlmostEqual(lo, -100 - reach, delta=2.5)
            self.assertAlmostEqual(hi, reach, delta=2.5)
            self.assertLess(span["to"], e["length"])
            self.assertTrue(abs(end) == 300)

    def test_a_street_inside_the_grounds_is_in_the_zone(self):
        osm, bbox = street([(51, SCHOOL, box(-60, -40, 60, 40))])
        out = zones_from_osm(osm, pack_from_osm(osm, bbox))
        spans = out["zones"][0]["spans"]
        self.assertTrue(all(s["to"] - s["from"] > 120 for s in spans))

    def test_far_away_or_glancing_places_make_no_zone(self):
        osm, bbox = street([
            (52, SCHOOL, box(-100, 60, 0, 90)),                           # 60 m off the street
            (53, {"leisure": "playground"}, box(200, 20 + 14, 205, 40)),  # a corner only: shorter than MIN_SPAN_M
        ])
        out = zones_from_osm(osm, pack_from_osm(osm, bbox))
        self.assertEqual([z["id"] for z in out["zones"] if z["kind"] == "school"], [])
        for z in out["zones"]:
            self.assertTrue(all(s["to"] - s["from"] >= MIN_SPAN_M for s in z["spans"]))

    def test_a_playground_reaches_further_into_its_park(self):
        # 30 m in from the street: too far for a school, near enough for a playground
        osm, bbox = street([(54, {"leisure": "playground"}, box(-20, 30, 20, 50)), (55, SCHOOL, box(100, 30, 140, 50))])
        out = zones_from_osm(osm, pack_from_osm(osm, bbox))
        self.assertEqual([(z["id"], z["kind"]) for z in out["zones"]], [("pw54", "playground")])

    def test_which_schools_count(self):
        self.assertEqual(kind_of({"amenity": "school"}), "school")
        self.assertEqual(kind_of({"leisure": "playground"}, point=True), "playground")
        self.assertEqual(kind_of({"amenity": "school", "isced:level": "1;2"}), "school")
        self.assertIsNone(kind_of({"amenity": "school", "isced:level": "5"}), "post-secondary")
        self.assertIsNone(kind_of({"amenity": "school", "name": "English Centre"}, point=True), "a point needs grades")
        self.assertEqual(kind_of({"amenity": "school", "grades": "K-7"}, point=True), "school")
        self.assertIsNone(kind_of({"amenity": "college"}))
        self.assertIsNone(kind_of({"leisure": "park"}))

    def test_a_school_mapped_as_a_point_with_grades(self):
        osm, bbox = street([(60, {"amenity": "school", "grades": "K-7", "name": "Point School"}, [(0, 25)]),
                            (61, {"amenity": "school", "name": "Dance Studio"}, [(150, 20)])])
        out = zones_from_osm(osm, pack_from_osm(osm, bbox))
        self.assertEqual([z["id"] for z in out["zones"]], ["sn60"])

    def test_multipolygon_grounds_are_read(self):
        osm, bbox = street([(70, {}, box(-100, 15, 0, 80))])
        osm.add_relation(71, [("way", 70, "outer")], {"type": "multipolygon", "amenity": "school", "name": "Big School"})
        out = zones_from_osm(osm, pack_from_osm(osm, bbox))
        self.assertEqual([(z["id"], z["name"]) for z in out["zones"]], [("sr71", "Big School")])
        xml = ('<?xml version="1.0"?><osm><relation id="71"><member type="way" ref="70" role="outer"/>'
               '<tag k="type" v="multipolygon"/><tag k="amenity" v="school"/></relation>'
               '<relation id="72"><tag k="type" v="multipolygon"/><tag k="landuse" v="grass"/></relation></osm>')
        self.assertEqual([r["id"] for r in parse_xml(xml).relations], [71], "only schools and playgrounds are kept")

    def test_grounds_split_across_several_outer_ways_are_one_ring(self):
        # a square round the middle of the street, its outline in two ways (reversed, as mapped)
        osm, bbox = street([(80, {}, [(-60, -40), (60, -40), (60, 40)]), (81, {}, [(-60, -40), (-60, 40), (60, 40)])])
        n80, n81 = osm.ways[-2]["nodes"], osm.ways[-1]["nodes"]
        osm.ways[-1]["nodes"] = [n80[0]] + n81[1:-1] + [n80[-1]]   # (sharing the corner nodes)
        osm.add_relation(82, [("way", 80, "outer"), ("way", 81, "outer")], {"type": "multipolygon", "amenity": "school"})
        out = zones_from_osm(osm, pack_from_osm(osm, bbox))
        spans = out["zones"][0]["spans"]
        self.assertTrue(spans and all(s["to"] - s["from"] > 120 for s in spans), spans)

    def test_the_overpass_query_asks_for_schools_and_playgrounds(self):
        q = fetch.overpass_query((-123.1, 49.2, -123.0, 49.3))
        for part in ('way["amenity"="school"]', 'way["leisure"="playground"]', 'node["amenity"="school"]', 'rel["amenity"="school"]'):
            self.assertIn(part, q)

    def test_built_beside_the_pack_from_the_cached_download_only(self):
        osm, bbox = street([(50, SCHOOL, box(-100, 15, 0, 80))])
        pack = pack_from_osm(osm, bbox)
        with tempfile.TemporaryDirectory() as directory:
            maps = Path(directory)
            self.assertIsNone(build_zones(bbox, maps, pack))
            self.assertFalse(zones_path(maps, bbox).exists())
            lines = ['<?xml version="1.0"?><osm>']
            for nid, (lat, lon, tags) in osm.nodes.items():
                lines.append('<node id="%d" lat="%.8f" lon="%.8f">%s</node>' % (nid, lat, lon, "".join('<tag k="%s" v="%s"/>' % kv for kv in tags.items())))
            for w in osm.ways:
                lines.append('<way id="%d">%s%s</way>' % (w["id"], "".join('<nd ref="%d"/>' % n for n in w["nodes"]), "".join('<tag k="%s" v="%s"/>' % kv for kv in w["tags"].items())))
            lines.append("</osm>")
            fetch.cache_path(maps, bbox).write_text("".join(lines))
            built = build_zones(bbox, maps, pack)
            self.assertEqual(len(built["zones"]), 1)
            self.assertEqual(load_zones(bbox, maps), built)
            self.assertEqual(json.loads(zones_path(maps, bbox).read_text())["zones_version"], "1")

    def test_every_bundled_map_has_its_zones_on_its_own_edges(self):
        total = 0
        for name, bbox in PRESET_BBOXES.items():
            with self.subTest(name=name):
                zones = load_zones(bbox, MAPS_DIR)
                self.assertIsNotNone(zones)
                pack = json.loads(pack_path(MAPS_DIR, bbox).read_text())
                edges = {e["id"]: e for e in pack["edges"]}
                for z in zones["zones"]:
                    self.assertIn(z["kind"], ("school", "playground"))
                    for span in z["spans"]:
                        self.assertIn(span["edge"], edges)
                        self.assertTrue(0 <= span["from"] < span["to"] <= edges[span["edge"]]["length"] + 0.1)
                total += len(zones["zones"])
        self.assertGreater(total, 100)
        kits = load_zones(PRESET_BBOXES["kitsilano"], MAPS_DIR)
        tennyson = [z for z in kits["zones"] if z["name"] == "Lord Tennyson Elementary School"]
        self.assertTrue(tennyson and any(s["edge"] == "e131" for s in tennyson[0]["spans"]), "West 11th Avenue's, for the challenge")

    def test_demo_bundles_zones_and_the_clock_with_each_map(self):
        from scripts import build_demo
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            with contextlib.redirect_stdout(io.StringIO()):
                build_demo.build(output)
            kits = json.loads((output / "demo-data/kitsilano.json").read_text())
            self.assertGreater(len(kits["zones"]["zones"]), 5)
            self.assertEqual(kits["utc_offset"], -7)


if __name__ == "__main__":
    unittest.main()
