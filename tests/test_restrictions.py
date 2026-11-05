import unittest
import helpers  # noqa
from jev.osm.parse import OsmData, parse_xml
from jev.osm.fetch import overpass_query
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

    def test_red_only_bans_are_separate(self):
        for kind in ('no_right_turn_on_red', 'no_left_turn_on_red'):
            with self.subTest(kind=kind):
                layer = self.fixture({'restriction': kind})
                self.assertEqual(layer['restrictions'], [])
                r = layer['red_turns'][0]
                self.assertEqual((r['from'], r['to'], r['kind'], r['osm_relation']), ('a', ['b'], kind, 1))
                self.assertFalse(banned(layer['restrictions'], 'a', 'b'))

    def test_alternative_red_relation(self):
        for direction in ('right', 'left'):
            kind = 'no_' + direction + '_turn'
            layer = self.fixture({'type': 'restriction:on_red', 'restriction:on_red': kind})
            self.assertEqual(layer['restrictions'], [])
            self.assertEqual(layer['red_turns'][0]['kind'], kind + '_on_red')
        # The type sets the namespace: a stray ordinary restriction tag must not become a ban.
        layer = self.fixture({'type': 'restriction:on_red', 'restriction': 'no_right_turn'})
        self.assertEqual(layer['restrictions'], [])
        self.assertEqual(layer.get('red_turns', []), [])

    def test_red_motorcar_and_exemptions(self):
        layer = self.fixture({'restriction': 'no_left_turn_on_red', 'restriction:motorcar': 'no_right_turn_on_red'})
        self.assertEqual(layer['red_turns'][0]['kind'], 'no_right_turn_on_red')
        for exempt in ('motorcar', 'motor_vehicle', 'vehicle'):
            for tags in ({'restriction': 'no_right_turn_on_red'}, {'type': 'restriction:on_red', 'restriction:on_red': 'no_right_turn'}):
                with self.subTest(exempt=exempt, tags=tags):
                    layer = self.fixture({**tags, 'except': 'bicycle;' + exempt})
                    self.assertEqual(layer.get('red_turns', []), [])
        layer = self.fixture({'restriction': 'no_right_turn_on_red', 'except': 'bicycle;bus'})
        self.assertEqual(len(layer['red_turns']), 1)

    def test_red_schedules_and_exemptions(self):
        tags = {'restriction:conditional': 'no_right_turn_on_red @ (Fr 22:00-02:00)'}
        layer = self.fixture(tags)
        self.assertEqual(layer['restrictions'], [])
        self.assertTrue(in_effect(layer['red_turns'][0], 1, 5))
        self.assertFalse(in_effect(layer['red_turns'][0], 1, 4))
        for tags in (
            {'restriction': 'no_right_turn_on_red', 'restriction:conditional': 'none @ (Mo-Fr 07:00-09:00)'},
            {'type': 'restriction:on_red', 'restriction:on_red': 'no_right_turn', 'restriction:on_red:conditional': 'none @ (Mo-Fr 07:00-09:00)'},
        ):
            r = self.fixture(tags)['red_turns'][0]
            self.assertFalse(in_effect(r, 8, 0))
            self.assertTrue(in_effect(r, 9, 0))

    def test_unsupported_red_conditions_and_geometry(self):
        layer = self.fixture({'restriction:conditional': 'no_right_turn_on_red @ (sunrise-sunset)'})
        self.assertEqual(layer['restrictions'], [])
        self.assertEqual(layer.get('red_turns', []), [])
        self.assertEqual(layer['skipped'][0]['reason'], 'unsupported condition')
        layer = self.fixture({'restriction': 'no_right_turn_on_red'}, via=('way', 5, 'via'))
        self.assertEqual(layer.get('red_turns', []), [])
        self.assertEqual(layer['skipped'][0]['reason'], 'via-way or missing via-node')

    def test_red_parser_and_fetch(self):
        osm = parse_xml('<osm><relation id="1"><member type="node" ref="2" role="via"/><tag k="type" v="restriction:on_red"/><tag k="restriction:on_red" v="no_right_turn"/></relation></osm>')
        self.assertEqual(len(osm.relations), 1)
        self.assertEqual(osm.relations[0]['tags']['restriction:on_red'], 'no_right_turn')
        self.assertIn('rel["type"~"^restriction(:on_red)?$"]', overpass_query((-79.41, 43.66, -79.40, 43.67)))

    def test_red_bans_do_not_change_routing(self):
        import json
        from jev.config import MAPS_DIR
        pack = json.loads((MAPS_DIR / '4a96d42cb3f2.v6.pack.json').read_text())
        original = json.loads((MAPS_DIR / '4a96d42cb3f2.restrictions.v1.json').read_text())
        r = next(r for r in original['restrictions'] if r['kind'] == 'no_left_turn')
        router = Router(pack)
        a, b = router.edges[r['from']], router.edges[r['to'][0]]
        before = router.astar(a['id'], a['length']-10, b['id'], 10, restrictions=True)
        self.assertTrue(before)
        pack['restrictions'] = {'restrictions_version': '1', 'restrictions': [], 'red_turns': [{**r, 'kind': 'no_left_turn_on_red'}]}
        after = router.astar(a['id'], a['length']-10, b['id'], 10, restrictions=True)
        self.assertEqual(before, after)

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
