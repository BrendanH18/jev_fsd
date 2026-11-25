"""The /api/decide handler's logic: validate what the browser built, forward it to Jev, return the
answers plus the metadata and trace the UI shows. Pure functions; the client is injected."""

from __future__ import annotations

import json
from typing import Any, Dict

ALLOWED_QUESTIONS = {"motion", "vector", "route", "headlights"}
MAX_STATE_BYTES = 24 * 1024
MAX_CRITERIA = 32
# Jev accepts 6,000 characters (checked live on 11 November 2026). The city suite's busiest moments,
# with several situation clauses at once, need about 3,000; the 2,000 used before rejected one
# request in six there (docs/model-results.md). A new clause must keep the total under 4,000.
MAX_INSTRUCTIONS_CHARS = 6000
MAX_CRITERION_ID_CHARS = 64
MAX_CRITERION_CHARS = 6000
MAX_QUESTIONS_BYTES = 32 * 1024
MAX_STATE_DEPTH = 32
MAX_SAFE_INTEGER = (1 << 53) - 1


class InvalidRequest(ValueError):
    pass


def request_sequence(body: dict, error=InvalidRequest) -> tuple:
    tick, epoch = body.get("tick", 0), body.get("epoch", 0)
    if type(tick) is not int or type(epoch) is not int:
        raise error("tick and epoch must be integers")
    if not 0 <= tick <= MAX_SAFE_INTEGER or not 0 <= epoch <= MAX_SAFE_INTEGER:
        raise error("tick and epoch must be non-negative safe integers")
    return tick, epoch


def _check_state(state: dict) -> None:
    pending = [(state, 1)]
    while pending:
        value, depth = pending.pop()
        if isinstance(value, (dict, list)) and depth > MAX_STATE_DEPTH:
            raise InvalidRequest("state is nested more than %d levels" % MAX_STATE_DEPTH)
        if isinstance(value, dict):
            if any(not isinstance(key, str) for key in value):
                raise InvalidRequest("state object keys must be strings")
            if any(not utf8_text(key) for key in value):
                raise InvalidRequest("state object keys must contain valid Unicode")
            pending.extend((item, depth + 1) for item in value.values())
        elif isinstance(value, list):
            pending.extend((item, depth + 1) for item in value)
        elif isinstance(value, str) and not utf8_text(value):
            raise InvalidRequest("state strings must contain valid Unicode")
        elif value is not None and not isinstance(value, (str, int, float, bool)):
            raise InvalidRequest("state must contain JSON values")


def utf8_text(value: str) -> bool:
    """JSON can carry escaped lone surrogates, which providers cannot decode as Unicode."""
    return not any(0xD800 <= ord(char) <= 0xDFFF for char in value)


def validate_request(body: dict) -> Dict[str, Any]:
    if not isinstance(body, dict):
        raise InvalidRequest("decision request must be a JSON object")
    state = body.get("state")
    questions = body.get("questions")
    if not isinstance(state, dict):
        raise InvalidRequest("state must be a JSON object")
    try:
        state_size = len(json.dumps(state, allow_nan=False))
    except (TypeError, ValueError, RecursionError) as err:
        raise InvalidRequest("state must contain finite JSON values") from err
    if state_size > MAX_STATE_BYTES:
        raise InvalidRequest("state is larger than %d bytes" % MAX_STATE_BYTES)
    _check_state(state)
    if not isinstance(questions, dict) or not questions:
        raise InvalidRequest("questions must be a non-empty object")
    clean = {}
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
        if not utf8_text(instructions):
            raise InvalidRequest("question %s instructions contain invalid Unicode" % qid)
        for key, text in criteria.items():
            if not isinstance(key, str) or not key.strip():
                raise InvalidRequest("criteria for %s must have non-empty ids" % qid)
            if len(key) > MAX_CRITERION_ID_CHARS or not utf8_text(key):
                raise InvalidRequest(
                    "criteria ids for %s must be Unicode text up to %d characters" % (qid, MAX_CRITERION_ID_CHARS)
                )
            if text is not None and not isinstance(text, str):
                raise InvalidRequest("criteria for %s must be strings or null" % qid)
            if text is not None and (len(text) > MAX_CRITERION_CHARS or not utf8_text(text)):
                raise InvalidRequest(
                    "criterion text for %s must be Unicode text up to %d characters" % (qid, MAX_CRITERION_CHARS)
                )
        clean[qid] = {"type": "choice", "instructions": instructions, "criteria": dict(criteria)}
    if len(json.dumps(clean)) > MAX_QUESTIONS_BYTES:
        raise InvalidRequest("questions are larger than %d bytes" % MAX_QUESTIONS_BYTES)
    tick, epoch = request_sequence(body)
    return {"state": state, "questions": clean, "tick": tick, "epoch": epoch}


def jev_decide(client, body: dict) -> dict:
    req = validate_request(body)
    result = client.system_one(req["state"], req["questions"])
    answers = {}
    for qid, question in req["questions"].items():
        answer = result.answers.get(qid)
        if not isinstance(answer, dict) or answer.get("type", "choice") != "choice":
            continue
        choice = answer.get("choice")
        if isinstance(choice, str) and choice in question["criteria"]:
            answers[qid] = answer
    return {
        "tick": req["tick"],
        "epoch": req["epoch"],
        "answers": answers,
        "meta": dict(result.meta(), source="jev"),
        "trace": result.trace(),
    }
