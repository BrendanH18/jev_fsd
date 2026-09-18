import math
import unittest

from helpers import *  # noqa: F401,F403  (sys.path setup)

from jev import geometry as g


class GeometryTests(unittest.TestCase):
    def test_douglas_peucker_keeps_endpoints_and_bends(self):
        pts = [(0, 0), (1, 0.01), (2, 0), (3, 0), (3, 5), (6, 5)]
        out = g.douglas_peucker(pts, 0.3)
        self.assertEqual(out[0], (0, 0))
        self.assertEqual(out[-1], (6, 5))
        self.assertIn((3, 0), out)
        self.assertIn((3, 5), out)
        self.assertNotIn((1, 0.01), out)

    def test_offset_right_of_travel(self):
        # travelling east, right is south (negative y)
        out = g.offset_polyline([(0, 0), (10, 0)], 2.0)
        self.assertAlmostEqual(out[0][1], -2.0)
        self.assertAlmostEqual(out[1][1], -2.0)
        left = g.offset_polyline([(0, 0), (10, 0)], -2.0)
        self.assertAlmostEqual(left[0][1], 2.0)

    def test_offset_miter_on_right_angle(self):
        # east then north; a right angle miter sits at sqrt(2)*d from the corner
        out = g.offset_polyline([(0, 0), (10, 0), (10, 10)], 1.0)
        cx, cy = out[1]
        self.assertAlmostEqual(math.hypot(cx - 10, cy - 0), math.sqrt(2), places=6)
        self.assertGreater(cx, 10)  # right of both legs: east of the corner and south of the first leg
        self.assertLess(cy, 0)

    def test_offset_hairpin_is_clamped(self):
        out = g.offset_polyline([(0, 0), (10, 0), (0, 0.01)], 1.0)
        self.assertLessEqual(math.hypot(out[1][0] - 10, out[1][1]), 2.0 + 1e-9)

    def test_project_point_lateral_sign(self):
        pts = [(0, 0), (10, 0)]
        south = g.project_point(pts, (5, -1))
        north = g.project_point(pts, (5, 1))
        self.assertAlmostEqual(south["lateral"], 1.0)   # right of travel
        self.assertAlmostEqual(north["lateral"], -1.0)
        self.assertAlmostEqual(south["s"], 5.0)
        beyond = g.project_point(pts, (14, 0))
        self.assertAlmostEqual(beyond["s"], 10.0)
        self.assertAlmostEqual(beyond["distance"], 4.0)

    def test_fillet_endpoints_lie_on_legs(self):
        pts = g.fillet((0, 0), (10, 0), (10, 10), 4.0)
        self.assertAlmostEqual(pts[0][0], 6.0)
        self.assertAlmostEqual(pts[0][1], 0.0)
        self.assertAlmostEqual(pts[-1][0], 10.0)
        self.assertAlmostEqual(pts[-1][1], 4.0)
        # the curve stays inside the corner
        for x, y in pts:
            self.assertLessEqual(x, 10 + 1e-9)
            self.assertGreaterEqual(y, -1e-9)

    def test_resample_step_and_end(self):
        pts = g.resample([(0, 0), (10, 0)], 3.0)
        self.assertEqual(pts[0], (0, 0))
        self.assertEqual(pts[-1], (10, 0))
        self.assertAlmostEqual(pts[1][0], 3.0)

    def test_turn_classification(self):
        self.assertEqual(g.classify_turn(math.radians(10)), "straight")
        self.assertEqual(g.classify_turn(math.radians(80)), "left")
        self.assertEqual(g.classify_turn(math.radians(-80)), "right")
        self.assertEqual(g.classify_turn(math.radians(170)), "uturn")
        self.assertAlmostEqual(g.turn_angle(math.radians(170), math.radians(-170)), math.radians(20))

    def test_point_and_heading_at(self):
        pts = [(0, 0), (10, 0), (10, 10)]
        self.assertEqual(g.point_at(pts, 15), (10, 5))
        self.assertAlmostEqual(g.heading_at(pts, 15), math.pi / 2)
        self.assertAlmostEqual(g.heading_at(pts, 5), 0.0)


if __name__ == "__main__":
    unittest.main()
