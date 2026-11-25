"""Shared fakes and fixtures for the offline tests. No API key, no network."""

from __future__ import annotations

import sys
from copy import deepcopy
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev.client import JevResult  # noqa: E402
from jev.osm.pack import synthetic_osm as synthetic_osm  # noqa: E402
from jev.osm.pack import synthetic_pack as synthetic_pack  # noqa: E402


def fake_answers(questions, picks=None):
    """API-shaped answers. `picks` maps question id -> choice key, noul float, or score float."""
    picks = {} if picks is None else picks
    out = {}
    for qid, q in questions.items():
        pick = picks.get(qid)
        if q["type"] == "choice":
            keys = list(q["criteria"])
            if not keys:
                raise ValueError(f"Fake choice {qid!r} needs criteria")
            chosen = pick if pick is not None else keys[-1]
            if chosen not in keys:
                raise ValueError(f"Fake pick {chosen!r} is not a choice for {qid!r}")
            rest = 0.05 / max(1, len(keys) - 1)
            confidence = 1.0 if len(keys) == 1 else 0.95
            probs = {k: confidence if k == chosen else rest for k in keys}
            out[qid] = {"type": "choice", "choice": chosen, "probabilities": probs, "confidence": 0.9}
        elif q["type"] == "score":
            n = len(q["criteria"])
            if not n:
                raise ValueError(f"Fake score {qid!r} needs criteria")
            out[qid] = {
                "type": "score",
                "score": pick if pick is not None else 0.0,
                "legend": {str(i): c for i, c in enumerate(q["criteria"])},
                "probabilities": {str(i): 1 / n for i in range(n)},
                "confidence": 0.8,
            }
        elif q["type"] == "noul":
            out[qid] = {"type": "noul", "noul": pick if pick is not None else 0.02}
        else:
            raise ValueError(f"Unsupported fake question type {q['type']!r} for {qid!r}")
    return out


class FakeClient:
    """Stands in for JevClient. `picker(state, questions)` returns the picks for that request."""

    def __init__(self, picker=None, input_tokens=800):
        self.picker = (lambda state, questions: {}) if picker is None else picker
        self.input_tokens = input_tokens
        self.calls = []
        self.model = "jev-fake"
        self.configured = True

    def system_one(self, state, questions):
        self.calls.append(deepcopy((state, questions)))
        answers = fake_answers(questions, self.picker(state, questions))
        return JevResult(
            {"state": deepcopy(state), "model": self.model, "questions": deepcopy(questions)},
            {"model": self.model, "answers": answers, "usage": {"input_tokens": self.input_tokens}},
            12.0,
        )


@lru_cache(maxsize=1)
def _grid_pack():
    return synthetic_pack()


def grid_pack():
    """Return a private copy of the synthetic 4x4 grid pack."""
    return deepcopy(_grid_pack())
