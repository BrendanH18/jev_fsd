"""The /api/decide handler's logic: validate what the browser built, forward it to Jev, return the
answers plus the metadata and trace the UI shows. Pure functions; the client is injected."""

from __future__ import annotations

import json
from typing import Any, Dict

ALLOWED_QUESTIONS = {"motion", "vector", "route"}
MAX_STATE_BYTES = 24 * 1024
MAX_CRITERIA = 32
MAX_INSTRUCTIONS_CHARS = 2000


class InvalidRequest(ValueError):
    pass


def validate_request(body: dict) -> Dict[str, Any]:
    state = body.get("state")
    questions = body.get("questions")
    if not isinstance(state, dict):
        raise InvalidRequest("state must be a JSON object")
    if len(json.dumps(state)) > MAX_STATE_BYTES:
        raise InvalidRequest("state is larger than %d bytes" % MAX_STATE_BYTES)
    if not isinstance(questions, dict) or not questions:
        raise InvalidRequest("questions must be a non-empty object")
    for qid, q in questions.items():
        if qid not in ALLOWED_QUESTIONS:
            raise InvalidRequest("unknown question id %r" % qid)
        if not isinstance(q, dict) or q.get("type") != "choice":
            raise InvalidRequest("question %s must be a choice" % qid)
        criteria = q.get("criteria")
        if not isinstance(criteria, dict) or not 1 <= len(criteria) <= MAX_CRITERIA:
            raise InvalidRequest("question %s needs 1..%d criteria" % (qid, MAX_CRITERIA))
        instructions = q.get("instructions")
        if not isinstance(instructions, str) or not instructions.strip():
            raise InvalidRequest("question %s needs string instructions" % qid)
        if len(instructions) > MAX_INSTRUCTIONS_CHARS:
            raise InvalidRequest("question %s instructions are too long" % qid)
        for key, text in criteria.items():
            if text is not None and not isinstance(text, str):
                raise InvalidRequest("criteria for %s must be strings or null" % qid)
    tick = body.get("tick", 0)
    epoch = body.get("epoch", 0)
    if not isinstance(tick, int) or not isinstance(epoch, int):
        raise InvalidRequest("tick and epoch must be integers")
    return {"state": state, "questions": questions, "tick": tick, "epoch": epoch}


def jev_decide(client, body: dict) -> dict:
    req = validate_request(body)
    result = client.system_one(req["state"], req["questions"])
    return {"tick": req["tick"], "epoch": req["epoch"], "answers": result.answers,
            "meta": dict(result.meta(), source="jev"), "trace": result.trace()}
