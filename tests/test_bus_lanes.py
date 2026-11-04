import unittest
import helpers
from jev.osm.bus_lanes import parse_hours, buslanes_from_osm
from jev.osm.parse import OsmData


class BusLaneTests(unittest.TestCase):
    def test_hours(self):
        windows = parse_hours('designated @ (Mo-Fr 07:00-09:00,15:30-18:30)')
        self.assertEqual(windows, [{'days': [0,1,2,3,4], 'start': 420, 'end': 540}, {'days':[0,1,2,3,4], 'start':930,'end':1110}])
        self.assertIsNone(parse_hours('designated @ (PH off)'))

    def build(self, tags, forward=True):
        osm = OsmData()
        osm.add_node(1,49,-123); osm.add_node(2,49,-122.999)
        osm.add_way(10,[1,2],tags)
        edge = {'id':'e0','from':'n1' if forward else 'n2','to':'n2' if forward else 'n1','pts':[[0,0],[73,0]],'length':73,'lanes':2,'oneway':False,'name':'Main'}
        return buslanes_from_osm(osm,{'origin':{'lat':49,'lon':-123},'edges':[edge]})['lanes']

    def test_directional_conditional_count(self):
        tags={'lanes:bus:forward:conditional':'1 @ (Mo-Fr 07:00-09:00)'}
        lanes=self.build(tags)
        self.assertEqual(len(lanes),1)
        self.assertEqual(lanes[0]['lane'],1)
        self.assertEqual(lanes[0]['hours'][0]['start'],420)
        self.assertEqual(self.build(tags,False),[])

    def test_busway_both_directions(self):
        for forward in (True,False):
            self.assertEqual(self.build({'busway':'lane'},forward)[0]['lane'],1)

    def test_lane_list_and_permissions(self):
        lanes=self.build({'bus:lanes:forward':'yes|designated','taxi:lanes:forward':'no|yes','cycleway':'share_busway'})
        self.assertEqual(lanes[0]['allowed'],['bus','taxi','bicycle'])
        self.assertEqual(self.build({'bus:lanes:forward':'yes|yes'}),[])
        conditional=self.build({'bus:lanes:conditional':'yes|yes|yes|designated @ (Mo-Fr 07:00-09:00)'})
        self.assertEqual(conditional[0]['lane'],1)
        self.assertEqual(conditional[0]['hours'][0]['end'],540)

    def test_busway_side(self):
        self.assertEqual(self.build({'busway:left':'lane'}),[])
        self.assertEqual(len(self.build({'busway:left':'lane'},False)),1)

    def test_count_does_not_override_lane_lists(self):
        # (lanes:bus counts both ways on a two-way street; the lane lists say which lane)
        for forward in (True, False):
            self.assertEqual([l['lane'] for l in self.build({'lanes:bus': '2', 'bus:lanes:forward': 'yes|designated', 'bus:lanes:backward': 'yes|designated'}, forward)], [1])
            self.assertEqual([l['lane'] for l in self.build({'lanes:bus': '2'}, forward)], [1])
