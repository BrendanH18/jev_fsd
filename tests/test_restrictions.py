import unittest
import helpers  # noqa
from jev.osm.parse import OsmData, parse_xml
from jev.osm.restrictions import restrictions_from_osm, parse_condition, in_effect, banned
from jev.routing import Router


class RestrictionTests(unittest.TestCase):
    def fixture(self, tags=None, via=('node', 2, 'via')):
        osm = OsmData()
        osm.add_way(10, [1, 2]); osm.add_way(20, [2, 3])
        osm.add_relation(1, [('way', 10, 'from'), via, ('way', 20, 'to')], {'type': 'restriction', **(tags or {'restriction': 'no_left_turn'})})
        edges = [{'id': 'a', 'from': 'n1', 'to': 'n2'}, {'id': 'b', 'from': 'n2', 'to': 'n3'}, {'id': 'c', 'from': 'n2', 'to': 'n4'}]
        return restrictions_from_osm(osm, {'edges': edges})

    def test_pairs_and_only(self):
        r = self.fixture()['restrictions']
        self.assertTrue(banned(r, 'a', 'b')); self.assertFalse(banned(r, 'a', 'c'))
        r = self.fixture({'restriction': 'only_left_turn'})['restrictions']
        self.assertFalse(banned(r, 'a', 'b')); self.assertTrue(banned(r, 'a', 'c'))

    def test_motorcar_and_exemptions(self):
        self.assertEqual(self.fixture({'restriction': 'no_left_turn', 'except': 'bicycle;motorcar'})['restrictions'], [])
        r = self.fixture({'restriction': 'no_left_turn', 'restriction:motorcar': 'only_right_turn'})['restrictions']
        self.assertEqual(r[0]['kind'], 'only_right_turn')

    def test_conditional_week_and_overnight(self):
        r = self.fixture({'restriction:conditional': 'no_left_turn @ (Mo-Fr 07:00-09:00)'})['restrictions'][0]
        self.assertTrue(in_effect(r, 8, 0)); self.assertFalse(in_effect(r, 9, 0)); self.assertFalse(in_effect(r, 8, 5))
        r['condition'] = parse_condition('Fr 22:00-02:00')
        self.assertTrue(in_effect(r, 1, 5)); self.assertFalse(in_effect(r, 1, 4))

    def test_conditional_overrides_base(self):
        records = self.fixture({'restriction': 'no_left_turn', 'restriction:conditional': 'none @ (Mo-Fr 07:00-09:00)'})['restrictions']
        self.assertFalse(banned(records, 'a', 'b', 8, 0))
        self.assertTrue(banned(records, 'a', 'b', 10, 0))

    def test_unsupported_is_explicit(self):
        self.assertEqual(self.fixture(via=('way', 5, 'via'))['skipped'][0]['reason'], 'via-way or missing via-node')
        layer = self.fixture({'restriction:conditional': 'no_left_turn @ (sunrise-sunset)'})
        self.assertEqual(len(layer['restrictions']), 0); self.assertEqual(len(layer['skipped']), 1)

    def test_parser(self):
        osm = parse_xml('<osm><relation id="1"><member type="node" ref="2" role="via"/><tag k="type" v="restriction"/></relation></osm>')
        self.assertEqual(len(osm.relations), 1)

    def test_router_opt_in(self):
        # Real committed map: disabled calls must return identical routes.
        import json
        from jev.config import MAPS_DIR
        pack = json.loads((MAPS_DIR / '4a96d42cb3f2.v6.pack.json').read_text())
        router = Router(pack)
        pack['restrictions'] = json.loads((MAPS_DIR / '4a96d42cb3f2.restrictions.v1.json').read_text())
        r = next(r for r in pack['restrictions']['restrictions'] if r['kind'] == 'no_left_turn')
        a, b = router.edges[r['from']], router.edges[r['to'][0]]
        old = router.astar(a['id'], a['length']-10, b['id'], 10)
        off = router.astar(a['id'], a['length']-10, b['id'], 10, restrictions=False)
        self.assertEqual(old, off)
        on = router.astar(a['id'], a['length']-10, b['id'], 10, restrictions=True)
        self.assertTrue(on)
        self.assertFalse(any(banned(pack['restrictions']['restrictions'], x, y) for x, y in zip(on[0], on[0][1:])))
