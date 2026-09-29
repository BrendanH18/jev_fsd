import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.verify_jev import FIXTURES_DIR, check, main
from jev.decide import validate_request


class SnapshotVerificationTests(unittest.TestCase):
    def test_committed_cases_are_valid_requests(self):
        paths = list(FIXTURES_DIR.glob("*.json"))
        self.assertGreaterEqual(len(paths), 11)
        for path in paths:
            with self.subTest(case=path.name):
                snap = json.loads(path.read_text())
                validate_request(snap)
                self.assertEqual(set(snap["questions"]["vector"]["criteria"]),
                                 {c["id"] for c in snap["state"]["candidates"]})

    def test_offline_never_constructs_a_live_client(self):
        with patch("scripts.verify_jev.JevClient", side_effect=AssertionError("live client")), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["verify_jev", "--offline", str(FIXTURES_DIR / "mid_block_at.json")]), 0)

    def test_offline_rejects_impossible_expectation(self):
        snap = json.loads((FIXTURES_DIR / "mid_block_at.json").read_text())
        snap["expect"]["motion"] = "teleport"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text(json.dumps(snap))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["verify_jev", "--offline", str(path)]), 1)

    def test_live_expectations_check_confidence_and_vector(self):
        answers = {"motion": {"choice": "stop", "probabilities": {"stop": 0.5}},
                   "vector": {"choice": "hard_brake"}}
        problems = check({"motion": "stop", "motion_min_p": 0.7, "vector_not_in": ["hard_brake"]}, answers)
        self.assertEqual(len(problems), 2)
        self.assertTrue(check({"motion_absent": True}, answers))
