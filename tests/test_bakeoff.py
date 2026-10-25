"""Bake-off harness plumbing with a SCRIPTED fake LLM (no model). Proves the grading, not any model's quality."""
import json

import pytest

from adapters import llm as llm_mod
from app import bakeoff, db

FIXTURE = db.ROOT / "tests" / "fixtures" / "mock_authored_skill"
WRONG = "def run(dataset):\n    return {'proposals': [{'record_id': r['id'], 'field': 'total', 'value': 0, 'reason': 'x'}" \
        " for r in dataset['records']]}\n"


class Scripted:
    is_mock, model = True, "SCRIPTED (no inference)"

    def __init__(self, helper):
        self.helper = helper

    def health(self):
        return {"ok": True, "mock": True, "model": self.model}

    def chat(self, messages, **_):
        if "Write a deterministic Python skill" in messages[-1]["content"]:
            return "Sure:\n" + json.dumps({"helper": self.helper,
                                           "tests": (FIXTURE / "tests" / "test_helper.py").read_text()})
        return '{"tool": "investigate", "args": {"record_id": "REC-001"}}'


@pytest.fixture(autouse=True)
def results_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(bakeoff, "RESULTS", tmp_path / "bakeoff")


def test_correct_skill_passes_hidden_suite_and_compare_renders(tmp_path):
    r = bakeoff.run("good", reps=1, llm=Scripted((FIXTURE / "scripts" / "helper.py").read_text()))
    sk = r["probes"]["skill_codegen"][0]
    assert r["probes"]["tool_call"][0]["ok"] and sk["ok"] and sk["hidden_passed"] == sk["hidden_total"] > 5
    table = bakeoff.compare([tmp_path / "bakeoff" / "good"])
    assert "| good | True | 1/1 | 1/1 |" in table and "MOCK rows prove the harness only" in table


def test_wrong_skill_is_caught_by_hidden_suite_not_self_report():
    sk = bakeoff.run("bad", reps=1, llm=Scripted(WRONG))["probes"]["skill_codegen"][0]
    assert not sk["ok"] and sk["hidden_passed"] < sk["hidden_total"]


def test_unparseable_reply_and_dead_endpoint_are_failures_not_crashes():
    r = bakeoff.run("mock", reps=1, llm=llm_mod.MockLLM())
    assert not r["probes"]["skill_codegen"][0]["ok"] and r["probes"]["skill_codegen"][0]["stage"] == "parse"
    dead = llm_mod.OpenAICompatLLM("http://127.0.0.1:9/v1", timeout=2)
    assert "llm_unavailable" in bakeoff._timed(lambda: bakeoff.probe_skill(dead, {}))["detail"]
