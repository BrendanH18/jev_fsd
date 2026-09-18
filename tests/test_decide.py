import unittest

from helpers import FakeClient

from jev.decide import InvalidRequest, jev_decide, validate_request

GOOD = {
    "tick": 5, "epoch": 1,
    "state": {"car": {"speed": 8.0}, "candidates": [{"id": "keep_lane_hold"}, {"id": "hard_brake"}]},
    "questions": {
        "motion": {"type": "choice", "instructions": "Drive or stop?", "criteria": {"drive": "go", "stop": "halt"}},
        "vector": {"type": "choice", "instructions": "Pick.", "criteria": {"keep_lane_hold": None, "hard_brake": None}},
    },
}


class ValidateTests(unittest.TestCase):
    def test_good_request(self):
        req = validate_request(GOOD)
        self.assertEqual(req["tick"], 5)
        self.assertEqual(set(req["questions"]), {"motion", "vector"})

    def test_rejects(self):
        bad = [
            dict(GOOD, state="text"),
            dict(GOOD, state={"blob": "x" * 30000}),
            dict(GOOD, questions={}),
            dict(GOOD, questions={"free_text": GOOD["questions"]["motion"]}),
            dict(GOOD, questions={"motion": {"type": "noul", "instructions": "?"}}),
            dict(GOOD, questions={"motion": {"type": "choice", "instructions": "?", "criteria": {}}}),
            dict(GOOD, questions={"motion": {"type": "choice", "instructions": "?",
                                              "criteria": {str(i): None for i in range(40)}}}),
            dict(GOOD, questions={"motion": {"type": "choice", "instructions": "x" * 3000,
                                              "criteria": {"a": None}}}),
            dict(GOOD, tick="5"),
        ]
        for body in bad:
            with self.assertRaises(InvalidRequest):
                validate_request(body)


class DecideTests(unittest.TestCase):
    def test_answers_meta_trace(self):
        client = FakeClient(picker=lambda s, q: {"motion": "drive", "vector": "keep_lane_hold"})
        out = jev_decide(client, GOOD)
        self.assertEqual(out["answers"]["motion"]["choice"], "drive")
        self.assertEqual(out["answers"]["vector"]["choice"], "keep_lane_hold")
        self.assertEqual(out["meta"]["source"], "jev")
        self.assertEqual(out["meta"]["input_tokens"], 800)
        self.assertGreater(out["meta"]["cost_usd"], 0)
        self.assertEqual(out["tick"], 5)
        self.assertNotIn("Authorization", str(out["trace"]))
        self.assertEqual(client.calls[0][1], GOOD["questions"])


if __name__ == "__main__":
    unittest.main()
