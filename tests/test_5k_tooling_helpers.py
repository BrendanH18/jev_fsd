"""Tests for the shared offline Jev fixtures."""

import unittest

from helpers import FakeClient, fake_answers, grid_pack


class ToolingHelpersTests(unittest.TestCase):
    def test_choice_probabilities(self):
        questions = {
            "one": {"type": "choice", "criteria": {"only": "One option"}},
            "many": {"type": "choice", "criteria": {"a": "First", "b": "Second"}},
        }
        answers = fake_answers(questions, {"many": "a"})
        self.assertEqual(answers["one"]["probabilities"]["only"], 1)
        self.assertEqual(answers["many"]["choice"], "a")
        self.assertAlmostEqual(sum(answers["many"]["probabilities"].values()), 1)

    def test_zero_picks(self):
        questions = {"s": {"type": "score", "criteria": ["Low", "High"]}, "n": {"type": "noul"}}
        answers = fake_answers(questions, {"s": 0, "n": 0})
        self.assertEqual(answers["s"]["score"], 0)
        self.assertEqual(answers["n"]["noul"], 0)
        self.assertEqual(answers["s"]["legend"]["1"], "High")

    def test_bad_questions(self):
        for question, error in (
            ({"type": "choice", "criteria": {}}, "Fake choice 'q' needs criteria"),
            ({"type": "score", "criteria": []}, "Fake score 'q' needs criteria"),
            ({"type": "unknown"}, "Unsupported fake question type 'unknown'"),
        ):
            with self.subTest(question=question), self.assertRaisesRegex(ValueError, error):
                fake_answers({"q": question})
        with self.assertRaisesRegex(ValueError, "Fake pick 'bad' is not a choice"):
            fake_answers({"q": {"type": "choice", "criteria": {"a": "First"}}}, {"q": "bad"})

    def test_calls_and_request_do_not_share_mutable_input(self):
        state = {"car": {"speed": 1}}
        questions = {"n": {"type": "noul"}}
        client = FakeClient(input_tokens=13)
        result = client.system_one(state, questions)
        state["car"]["speed"] = 77
        questions.clear()
        self.assertEqual(client.calls[0][0]["car"]["speed"], 1)
        self.assertIn("n", client.calls[0][1])
        self.assertEqual(result.request["state"]["car"]["speed"], 1)
        self.assertIn("n", result.request["questions"])
        self.assertEqual(result.response["usage"]["input_tokens"], 13)

    def test_grid_pack_is_fresh(self):
        first = grid_pack()
        first["edges"][0]["name"] = "Contaminated"
        self.assertNotEqual(grid_pack()["edges"][0]["name"], "Contaminated")


if __name__ == "__main__":
    unittest.main()
