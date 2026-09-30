import math
import unittest
from unittest.mock import patch

import server
from jev import geometry as g
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.drives import suggested_drives
from jev.maps import MAP_CATALOG, catalog, map_identity
from jev.osm.pack import build_pack, pack_path, synthetic_pack
from jev.routing import Router


class CanadianMapsTests(unittest.TestCase):
    def test_all_catalog_maps_are_bundled_and_identifiable(self):
        entries = catalog(MAPS_DIR)
        self.assertEqual(len(entries), 4)
        self.assertEqual({m['city'] for m in entries}, {'Vancouver', 'Victoria', 'Toronto', 'Montréal'})
        for item in entries:
            with self.subTest(map=item['id']):
                self.assertTrue(item['cached'])
                self.assertGreater(item['stats']['roads'], 100)
                self.assertTrue(item['preview'])
                self.assertEqual(map_identity(tuple(item['bbox']))['id'], item['id'])

    def test_each_city_offers_three_distinct_drivable_routes(self):
        for item in MAP_CATALOG:
            with self.subTest(map=item['id']):
                bbox = PRESET_BBOXES[item['id']]
                self.assertTrue(pack_path(MAPS_DIR, bbox).is_file())
                pack = build_pack(bbox, MAPS_DIR)
                router = Router(pack)
                lane = next(l for l in router.lanes.values() if l['length'] > 70)
                point = g.point_at(lane['pts'], lane['length'] / 2, lane['cum'])
                start = dict(x=point[0], y=point[1], heading=g.heading_of(lane['pts'][0], lane['pts'][1]))
                drives = suggested_drives(router, start)
                self.assertEqual(len(drives), 3)
                self.assertEqual(len({tuple(d['destination']) for d in drives}), 3)
                for d in drives:
                    self.assertGreater(d['length_m'], 250)
                    self.assertLess(d['length_m'], 1900)
                    self.assertLess(g.dist(point, d['route']['polyline'][0]), 10)
                    for a, b in zip(d['route']['edges'], d['route']['edges'][1:]):
                        self.assertEqual(router.edges[a]['to'], router.edges[b]['from'])

    def test_selected_city_status_and_map_use_the_same_bbox(self):
        for name in ('victoria', 'toronto', 'montreal'):
            with self.subTest(map=name):
                status = server.api_status(None, {'map': [name]})
                pack = server.api_map(None, {'map': [name]})
                self.assertEqual(status['map']['id'], name)
                self.assertFalse(status['map']['synthetic'])
                self.assertEqual(pack['bbox'], list(PRESET_BBOXES[name]))
                self.assertEqual(pack['routing_bbox'], status['map']['bbox'])

    def test_route_api_uses_selected_city_graph(self):
        entry = server.load_map('victoria')
        router = entry['router']
        lane = next(l for l in router.lanes.values() if l['length'] > 70)
        p = g.point_at(lane['pts'], lane['length'] / 3, lane['cum'])
        q = g.point_at(lane['pts'], lane['length'] * 0.8, lane['cum'])
        result = server.api_route({'bbox': 'victoria', 'from': {'x': p[0], 'y': p[1], 'heading': g.heading_of(lane['pts'][0], lane['pts'][1])}, 'to': {'x': q[0], 'y': q[1]}}, {})
        self.assertTrue(result['routes'])
        self.assertTrue(all(e in router.edges for e in result['routes'][0]['edges']))

    def test_failed_map_retains_requested_routing_key(self):
        pack = synthetic_pack()
        entry = {'pack': pack, 'bbox': PRESET_BBOXES['victoria'], 'error': 'offline'}
        with patch.object(server, 'load_map', return_value=entry):
            result = server.api_map(None, {'map': ['victoria']})
        self.assertTrue(result['synthetic'])
        self.assertEqual(result['routing_bbox'], list(PRESET_BBOXES['victoria']))
        self.assertNotIn('routing_bbox', pack)

    def test_invalid_drive_coordinates_are_rejected(self):
        for value in (math.inf, math.nan, 'invalid'):
            with self.subTest(value=value), self.assertRaises(server.BadRequest):
                server.api_drives({'bbox': 'victoria', 'from': {'x': value, 'y': 0, 'heading': 0}}, {})

    def test_no_reachable_start_returns_no_fake_missions(self):
        router = Router(synthetic_pack())
        self.assertEqual(suggested_drives(router, {'x': 1e6, 'y': 1e6, 'heading': 0}), [])


if __name__ == '__main__':
    unittest.main()
