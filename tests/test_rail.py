import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts the project on the path)

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.pack import pack_from_osm
from jev.osm.parse import parse_xml
from jev.osm.project import Projection
from jev.osm.rail import _clip, build_rail, load_rail, rail_from_osm, rail_path

from test_crossings import LAT0, LON0, avenue


def with_track(osm, first, way_id, pts, tags=None, crossing=None):
    """Add a railway way through `pts` (x, y), its nodes numbered from `first`; `crossing`: the index
    of a point that is a level crossing, which the avenue's way at y = 0 then shares."""
    proj = Projection(LAT0, LON0)
    ids = []
    for i, (x, y) in enumerate(pts):
        lat, lon = proj.to_latlon(x, y)
        osm.add_node(first + i, lat, lon, {"railway": "level_crossing"} if i == crossing else {})
        ids.append(first + i)
    osm.add_way(way_id, ids, {"railway": "tram", **(tags or {})})
    return ids


class RailTests(unittest.TestCase):
    def setUp(self):
        self.osm, self.bbox = avenue()
        # (the avenue's east way, from x = 300 to 0, gets the crossing node at x = 100)
        self.east = next(w for w in self.osm.ways if w["id"] == 11)

    def cross_at(self, nid, index=1):
        self.east["nodes"].insert(index, nid)

    def test_a_track_across_the_avenue_is_a_level_crossing_of_both_its_ways(self):
        # a tram line from a buffer stop north of the avenue, across it at x = 100 at 60 deg, and on
        # south off the map, in two ways joined end to end; a stop on it
        ids = with_track(self.osm, 1000, 60, [(100 + 40 / 3 ** 0.5, 40), (100, 0)], crossing=1)
        with_track(self.osm, 1100, 61, [(100, 0), (100 - 400 / 3 ** 0.5, -400)])
        self.osm.ways[-1]["nodes"][0] = ids[-1]
        self.cross_at(ids[-1])
        proj = Projection(LAT0, LON0)
        lat, lon = proj.to_latlon(100 + 20 / 3 ** 0.5, 20)
        self.osm.add_node(1300, lat, lon, {"railway": "tram_stop", "name": "Main Stop"})
        pack = pack_from_osm(self.osm, self.bbox)
        rail = rail_from_osm(self.osm, pack)
        self.assertEqual(len(rail["tracks"]), 1)
        track = rail["tracks"][0]
        self.assertEqual(track["kind"], "tram")
        # (clipped to the map: one end the buffer stop, the other cut where it leaves)
        self.assertEqual(sorted(track["ends"]), ["edge", "terminus"])
        self.assertLess(track["length"], 200)
        self.assertEqual([s["name"] for s in track["stops"]], ["Main Stop"])
        self.assertEqual(len(rail["crossings"]), 1)
        c = rail["crossings"][0]
        self.assertEqual(c["id"], "lx%d" % ids[-1])
        self.assertAlmostEqual(c["x"], 100, delta=0.1)
        self.assertFalse(c["lights"] or c["gates"] or c["bell"])
        edges = {e["id"]: e for e in pack["edges"]}
        self.assertEqual(len(c["edges"]), 2, "both ways of the avenue")
        for on in c["edges"]:
            e = edges[on["edge"]]
            self.assertEqual(e["name"], "Main Ave")
            self.assertAlmostEqual(on["angle_deg"], 60, delta=0.5)
            x = e["pts"][0][0] + (on["s"] if e["pts"][-1][0] > e["pts"][0][0] else -on["s"])
            self.assertAlmostEqual(x, 100, delta=0.6)

    def test_a_track_is_cut_where_it_crosses_the_map_s_edge_either_way(self):
        extent = [-100, -100, 100, 100]
        inside, outside = [(0, 0), (50, 0)], [(150, 0)]
        piece, ends = _clip(inside + outside, extent, [(0, 0)])
        self.assertEqual(piece[-1], (100, 0))
        self.assertEqual(ends, (True, False))
        piece, ends = _clip(list(reversed(inside + outside)), extent, [(0, 0)])
        self.assertEqual(piece[0], (100, 0))
        self.assertEqual(ends, (False, True))

    def test_no_crossing_where_the_track_does_not_meet_a_street_or_runs_along_it(self):
        # tracks over the avenue on a bridge (no shared node), a disused one, and one laid along it
        with_track(self.osm, 1000, 60, [(100, 50), (100, -50)])
        ids = with_track(self.osm, 1100, 61, [(150, 50), (150, 0), (150, -50)], {"disused": "yes"}, crossing=1)
        self.cross_at(ids[1])
        ids = with_track(self.osm, 1200, 62, [(200, 0.5), (250, 0.5)], crossing=0)
        self.cross_at(ids[0])
        rail = rail_from_osm(self.osm, pack_from_osm(self.osm, self.bbox))
        self.assertEqual(rail["tracks"], [])
        self.assertEqual(rail["crossings"], [])

    def test_built_beside_the_pack_from_the_cached_download_only(self):
        pack = pack_from_osm(self.osm, self.bbox)
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(build_rail(self.bbox, Path(tmp), pack))
            self.assertIsNone(load_rail(self.bbox, Path(tmp)))
            xml = b"""<?xml version="1.0"?><osm></osm>"""
            fetch.cache_path(Path(tmp), self.bbox).write_bytes(xml)
            rail = build_rail(self.bbox, Path(tmp), pack)
            self.assertEqual(rail["tracks"], [])
            self.assertTrue(rail_path(Path(tmp), self.bbox).is_file())
            self.assertEqual(load_rail(self.bbox, Path(tmp)), rail)

    def test_edmonton_has_the_high_level_bridge_streetcar_line_and_its_crossings(self):
        rail = load_rail(PRESET_BBOXES["edmonton"], MAPS_DIR)
        self.assertEqual(len(rail["tracks"]), 1)
        track = rail["tracks"][0]
        self.assertEqual((track["kind"], track["usage"]), ("tram", "tourism"))
        self.assertEqual(track["ends"], ["edge", "terminus"])
        self.assertEqual([s["name"] for s in track["stops"]], ["107 Street", "Old Strathcona", "Whyte Avenue"])
        pack = json.loads((MAPS_DIR / ("%s.v6.pack.json" % fetch.cache_key(PRESET_BBOXES["edmonton"]))).read_text())
        names = {e["id"]: e["name"] for e in pack["edges"]}
        streets = sorted({names[on["edge"]] for c in rail["crossings"] for on in c["edges"] if names[on["edge"]]})
        self.assertEqual(streets, ["104 Street NW", "105 Street NW", "106 Street NW", "106A Street NW", "107 Street NW", "83 Avenue NW", "Gateway Boulevard NW"])
        # (none has lights, gates or a bell: crossbucks only)
        self.assertFalse(any(c["lights"] or c["gates"] or c["bell"] for c in rail["crossings"]))

    def test_the_overpass_query_asks_for_the_tracks_and_their_stops(self):
        q = fetch.overpass_query((-113.5, 53.5, -113.4, 53.6))
        self.assertIn('way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"]', q)
        self.assertIn('node["railway"~"^(tram_stop|halt|station)$"]', q)

    def test_parsing_keeps_the_tracks_and_their_crossing_nodes(self):
        xml = b"""<?xml version="1.0"?><osm>
          <node id="1" lat="49" lon="-123"><tag k="railway" v="level_crossing"/></node><node id="2" lat="49.001" lon="-123"/>
          <way id="5"><nd ref="1"/><nd ref="2"/><tag k="railway" v="tram"/></way>
        </osm>"""
        osm = parse_xml(xml)
        self.assertEqual(osm.nodes[1][2], {"railway": "level_crossing"})
        self.assertEqual([w["id"] for w in osm.ways], [5])


if __name__ == "__main__":
    unittest.main()
