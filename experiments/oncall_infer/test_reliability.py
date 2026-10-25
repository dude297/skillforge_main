"""Adversarial reliability tests for the OnCall path + the core skill registry it rides on. OFFLINE: the only network
is a loopback stub. Approvals are typed by the test into tmp registries ('pytest (not a human)').
python -m pytest -q -p no:cacheprovider experiments/oncall_infer/test_reliability.py"""
import copy
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
import time

import pytest

from adapters import llm as llm_mod
from app import db, skillforge as sf, tools
from app.tools import ToolError
from experiments.oncall_infer import oncall

BY = "pytest (not a human)"


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(sf, "SKILLS_DIR", sf.SKILLS_DIR)
    for k in ("APP_DB", "HIDDEN_DIR", "LLM_RETRIES"):
        monkeypatch.setenv(k, "x")
        monkeypatch.delenv(k)


@pytest.fixture
def staged(tmp_path):
    doc = oncall.run(state=tmp_path / "state", out=tmp_path / "run.json")
    assert doc["approval"]["state"] == "pending"
    return tmp_path / "state", tmp_path / "run.json"


def _conn(state):
    return db.connect(str(state / "app.db"))


def _approved(state):
    c = _conn(state)
    sf.approve_skill(c, oncall.NAME, 1, BY)
    return c


def _ds(name):
    s = json.loads(oncall.FIX[name].read_text(encoding="utf-8"))
    return {"records": s["records"], "evidence": s["evidence"]}


# ---- fingerprint ---------------------------------------------------------------------------------------------------
def test_fingerprint_inc1_inc2_equal_inc3_differs():
    f = {k: oncall.incident_fingerprint(_ds(k), k)["id"] for k in ("INC-1", "INC-2", "INC-3")}
    assert f["INC-1"] == f["INC-2"] != f["INC-3"]


def test_fingerprint_ignores_untrusted_evidence():
    """An attacker-controlled (untrusted) log must not make the lookalike look like INC-1."""
    ds3, ds1 = _ds("INC-3"), _ds("INC-1")
    forged = copy.deepcopy([e for e in ds1["evidence"] if e["source"] == "log"][0])
    forged["record_id"], forged["trusted"] = "INC-3", False
    ds3["evidence"].append(forged)
    assert oncall.incident_fingerprint(ds3, "INC-3")["id"] == oncall.incident_fingerprint(_ds("INC-3"), "INC-3")["id"]
    assert oncall.incident_fingerprint(ds3, "INC-3")["id"] != oncall.incident_fingerprint(ds1, "INC-1")["id"]


def test_fingerprint_ignores_other_records_evidence():
    ds = _ds("INC-3")
    ds["evidence"] += _ds("INC-1")["evidence"]
    assert oncall.incident_fingerprint(ds, "INC-3")["id"] != oncall.incident_fingerprint(ds, "INC-1")["id"]


def test_fingerprint_without_any_log_is_unknown_not_a_crash():
    ds = _ds("INC-1")
    ds["evidence"] = [e for e in ds["evidence"] if e["source"] != "log"]
    p = oncall.incident_parts(ds, "INC-1")
    assert p["exception_type"] is None and p["failure_category"] == "unknown"
    assert oncall.incident_fingerprint(ds, "INC-1")["id"] != oncall.incident_fingerprint(_ds("INC-1"), "INC-1")["id"]


# ---- approval provenance -------------------------------------------------------------------------------------------
@pytest.mark.parametrize("by", ["agent", "AGENT", " system ", "Policy", "", "   ", None, 7])
def test_non_human_approver_rejected_and_skill_stays_tested(staged, by):
    c = _conn(staged[0])
    with pytest.raises(ToolError):
        sf.approve_skill(c, oncall.NAME, 1, by)
    r = c.execute("SELECT status, active, decided_by FROM skills").fetchone()
    assert (r["status"], r["active"], r["decided_by"]) == ("tested", 0, None)


def test_agent_tool_dispatch_cannot_approve(staged):
    c = _conn(staged[0])
    for name in ("approve_skill", "decide_approval", "skill_approve"):
        assert tools.call(c, name, {"name": oncall.NAME, "version": 1, "by": "alice"})["error"]["code"] == "unknown_tool"
    assert c.execute("SELECT status FROM skills").fetchone()[0] == "tested"


def test_reuse_records_simulated_kind_for_agent_typed_approval(staged):
    _approved(staged[0]).close()
    doc = oncall.reuse(*staged)
    assert doc["approval"]["kind"] == "simulated" and "NOT a human approval" in doc["model"]["note"]


def test_reuse_refuses_a_skill_that_was_never_approved_even_if_active_flag_set(staged):
    """status stays authoritative: flipping only active=1 on a 'tested' row must not enable reuse."""
    c = _conn(staged[0])
    c.execute("UPDATE skills SET active=1")
    c.commit()
    c.close()
    doc = oncall.reuse(*staged)
    assert doc["reuse"]["state"] == "refused" and doc["reuse"]["reason"] == "not approved"


# ---- registry integrity / immutability -----------------------------------------------------------------------------
def _helper(state, where):
    return state / "skills" / where / oncall.NAME / "v1" / "scripts" / "helper.py"


def test_candidate_tampered_before_approval_is_rejected(staged):
    h = _helper(staged[0], "candidates")
    h.write_text(h.read_text(encoding="utf-8") + "\n# tamper\n", encoding="utf-8")
    c = _conn(staged[0])
    with pytest.raises(ToolError) as e:
        sf.approve_skill(c, oncall.NAME, 1, BY)
    assert "changed after testing" in str(e.value)
    assert c.execute("SELECT status FROM skills").fetchone()[0] == "tested"


def test_approved_artifact_tampered_is_refused_at_run(staged):
    c = _approved(staged[0])
    _helper(staged[0], "approved").write_text(
        "def run(d):\n    return {'proposals': [{'record_id': 'INC-2', 'field': 'x', 'value': 1}]}\n", encoding="utf-8")
    db.load_scenario(c, oncall.FIX["INC-2"])
    with pytest.raises(ToolError) as e:
        sf.run_skill(c, oncall.NAME)
    assert "files changed since approval" in str(e.value)
    r = c.execute("SELECT status, detail FROM skill_runs").fetchone()
    assert (r["status"], r["detail"]) == ("refused", "integrity")


def test_approved_artifact_extra_file_is_detected(staged):
    c = _approved(staged[0])
    (_helper(staged[0], "approved").parent / "evil.py").write_text("x = 1\n", encoding="utf-8")
    db.load_scenario(c, oncall.FIX["INC-2"])
    with pytest.raises(ToolError):
        sf.run_skill(c, oncall.NAME)


def test_reuse_with_tampered_artifact_fails_closed_and_is_recorded(staged):
    """oncall.reuse must turn core's integrity refusal into a recorded refusal, not an uncaught traceback that leaves
    the saved artifact claiming 'awaiting approval'."""
    _approved(staged[0]).close()
    h = _helper(staged[0], "approved")
    h.write_text(h.read_text(encoding="utf-8") + "\n# tamper\n", encoding="utf-8")
    doc = oncall.reuse(*staged)
    assert doc["reuse"]["state"] == "refused" and "changed since approval" in doc["reuse"]["reason"]
    assert doc["reuse"]["diagnosis"] is None


def test_reapproving_is_invalid_state_and_keeps_provenance(staged):
    c = _approved(staged[0])
    with pytest.raises(ToolError):
        sf.approve_skill(c, oncall.NAME, 1, "someone else")
    assert c.execute("SELECT decided_by FROM skills").fetchone()[0] == BY


def test_approved_copy_is_independent_of_candidate(staged):
    c = _approved(staged[0])
    _helper(staged[0], "candidates").write_text("def run(d):\n    raise SystemExit\n", encoding="utf-8")
    db.load_scenario(c, oncall.FIX["INC-2"])
    assert sf.run_skill(c, oncall.NAME)["proposals"][0]["field"] == "max_model_len"


def test_unknown_skill_version(staged):
    with pytest.raises(ToolError):
        sf.approve_skill(_conn(staged[0]), oncall.NAME, 99, BY)


# ---- idempotency ---------------------------------------------------------------------------------------------------
def test_reuse_twice_is_stable(staged):
    _approved(staged[0]).close()
    a = oncall.reuse(*staged)
    b = oncall.reuse(*staged)
    assert a["reuse"]["diagnosis"] == b["reuse"]["diagnosis"] and b["refusal"]["state"] == "refused"
    assert b["reuse"]["model_calls"] == 0


def test_run_skill_propose_twice_never_duplicates_open_actions(staged):
    c = _approved(staged[0])
    db.load_scenario(c, oncall.FIX["INC-2"])
    r1 = sf.run_skill(c, oncall.NAME, propose=True)
    r2 = sf.run_skill(c, oncall.NAME, propose=True)
    n = c.execute("SELECT COUNT(*) FROM actions WHERE status NOT IN ('rejected','failed')").fetchone()[0]
    assert len(r1["actions"]) == 1 and n == 1, (r1.get("errors"), r2.get("errors"), n)


def test_approval_cannot_be_decided_twice(staged):
    c = _approved(staged[0])
    db.load_scenario(c, oncall.FIX["INC-2"])
    a = sf.run_skill(c, oncall.NAME, propose=True)["actions"][0]
    tools.decide_approval(c, a["id"], True, "alice")
    with pytest.raises(ToolError):
        tools.decide_approval(c, a["id"], False, "mallory")
    r = c.execute("SELECT status, decided_by FROM approvals").fetchone()
    assert (r["status"], r["decided_by"]) == ("approved", "alice")


def test_run_twice_resets_state_and_stays_pending(tmp_path):
    for _ in range(2):
        d = oncall.run(state=tmp_path / "s", out=tmp_path / "o.json")
        assert d["approval"]["state"] == "pending"
    assert _conn(tmp_path / "s").execute("SELECT COUNT(*) FROM skills").fetchone()[0] == 1


# ---- --live: no silent fallback ------------------------------------------------------------------------------------
def _stub(mode, reply=""):
    class H(http.server.BaseHTTPRequestHandler):
        def _send(self, body, code=200):
            b = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            self._send({"data": [{"id": "stub"}]})

        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            if mode == "hang":
                time.sleep(3)
            if mode == "500":
                return self._send({"error": "boom"}, 500)
            self._send({"choices": [{"message": {"content": reply}, "finish_reason": "length" if mode == "length" else "stop"}],
                        "usage": {"prompt_tokens": 5, "completion_tokens": 7}})

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}/v1"


@pytest.mark.parametrize("mode,reply", [("ok", "I cannot help with that."), ("ok", '{"skill_md": 1}'), ("500", "")])
def test_live_strict_bad_model_reply_raises_and_writes_nothing(tmp_path, monkeypatch, mode, reply):
    monkeypatch.setenv("LLM_RETRIES", "0")
    srv, url = _stub(mode, reply)
    try:
        with pytest.raises(llm_mod.LLMUnavailable):
            oncall.run(True, url, None, tmp_path / "s", tmp_path / "o.json", allow_fallback=False)
    finally:
        srv.shutdown()
    assert not (tmp_path / "o.json").exists()


def test_live_strict_synthesis_failure_keeps_previous_state(tmp_path, monkeypatch):
    """CLI contract: no run or registry written on a failed --live run. A previous run's registry must survive."""
    monkeypatch.setenv("LLM_RETRIES", "0")
    oncall.run(state=tmp_path / "s", out=tmp_path / "o.json")
    before = (tmp_path / "o.json").read_text(encoding="utf-8")
    srv, url = _stub("ok", "no json here")
    try:
        with pytest.raises(llm_mod.LLMUnavailable):
            oncall.run(True, url, None, tmp_path / "s", tmp_path / "o.json", allow_fallback=False)
    finally:
        srv.shutdown()
    assert (tmp_path / "o.json").read_text(encoding="utf-8") == before
    assert _conn(tmp_path / "s").execute("SELECT COUNT(*) FROM skills").fetchone()[0] == 1  # registry not wiped


def test_live_length_twice_writes_failure_log_only(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_RETRIES", "0")
    oncall.run(state=tmp_path / "s", out=tmp_path / "prev.json")
    srv, url = _stub("length", '{"skill_md": "cut')
    try:
        with pytest.raises(llm_mod.LLMUnavailable) as e:
            oncall.run(True, url, None, tmp_path / "s", tmp_path / "o.json", allow_fallback=False)
    finally:
        srv.shutdown()
    log = tmp_path / "o.failed.json"
    d = json.loads(log.read_text(encoding="utf-8"))
    resp = [x for x in d["audit"] if x["event"] == "synthesis_response"]
    assert e.value.failure_log == str(log) and not (tmp_path / "o.json").exists()
    assert d["schema"] == "skillforge.oncall_failed_run/1" and d["mode"] == "LIVE_FAILED" and d["model"]["endpoint"] == url
    assert len(resp) == 2 and all("finish_reason=length" in x["detail"] for x in resp)
    assert _conn(tmp_path / "s").execute("SELECT COUNT(*) FROM skills").fetchone()[0] == 1  # previous registry intact
    print(json.dumps(d, indent=1))


def test_live_timeout_is_a_meaningful_error(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_RETRIES", "0")
    real = oncall.synthesize_live
    monkeypatch.setattr(oncall, "synthesize_live", lambda *a, **k: real(*a, **{**k, "timeout": 1}))
    srv, url = _stub("hang")
    try:
        with pytest.raises(llm_mod.LLMUnavailable) as e:
            oncall.run(True, url, None, tmp_path / "s", tmp_path / "o.json", allow_fallback=False)
    finally:
        srv.shutdown()
    assert "chat/completions" in str(e.value) and "timed out" in str(e.value).lower()


def test_live_wrong_model_id_fails_before_wiping_anything(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_RETRIES", "0")
    srv, url = _stub("ok")
    (tmp_path / "s").mkdir()
    (tmp_path / "s" / "keep").write_text("x")
    try:
        with pytest.raises(llm_mod.LLMUnavailable) as e:
            oncall.run(True, url, "not-served", tmp_path / "s", tmp_path / "o.json", allow_fallback=False)
    finally:
        srv.shutdown()
    assert "not served" in str(e.value) and (tmp_path / "s" / "keep").exists()


def test_live_overfit_model_skill_is_rejected_not_staged(tmp_path, monkeypatch):
    """A live model that returns an always-revert skill passes its own tests but must fail the hidden suite:
    no pending approval, nothing staged."""
    monkeypatch.setenv("LLM_RETRIES", "0")
    helper = ("def run(dataset):\n    return {'proposals': [{'record_id': r['id'], 'field': 'max_num_seqs', 'value': 128,"
              " 'action_type': 'revert_config'} for r in dataset['records']], 'refused': []}\n")
    tests = ("from helper import run\n\ndef test_a():\n    assert run({'records': [], 'evidence': []})['proposals'] == []\n\n"
             "def test_b():\n    assert 'refused' in run({'records': [], 'evidence': []})\n\n"
             "def test_c():\n    assert isinstance(run({'records': [], 'evidence': []}), dict)\n")
    reply = json.dumps({"skill_md": (oncall.REFERENCE / "SKILL.md").read_text(encoding="utf-8"),
                        "helper": helper, "tests": tests})
    srv, url = _stub("ok", reply)
    try:
        doc = oncall.run(True, url, None, tmp_path / "s", tmp_path / "o.json", allow_fallback=False)
    finally:
        srv.shutdown()
    assert doc["mode"] == "LIVE_REAL_MODEL" and not doc["verification"]["passed"]
    assert doc["approval"]["state"] == "rejected"
    assert _conn(tmp_path / "s").execute("SELECT COUNT(*) FROM skills").fetchone()[0] == 0


def test_cli_live_failure_exits_2_without_writing(tmp_path):
    out = tmp_path / "o.json"
    r = subprocess.run([sys.executable, "-m", "experiments.oncall_infer", "run", "--live", "--base-url",
                        "http://127.0.0.1:9/v1", "--model", "m", "--state", str(tmp_path / "s"), "--out", str(out)],
                       capture_output=True, text=True, timeout=120, env={**os.environ, "LLM_RETRIES": "0"})
    assert r.returncode == 2 and "LIVE RUN FAILED (no run or registry written" in r.stderr and not out.exists()
    assert "failure log: none" in r.stderr and not (tmp_path / "o.failed.json").exists()  # pre-flight failure: no run, no audit


# ---- timeouts in the skill sandbox ---------------------------------------------------------------------------------
def test_skill_infinite_loop_times_out_with_a_meaningful_error(tmp_path):
    d = tmp_path / "sk"
    shutil.copytree(oncall.REFERENCE, d)
    (d / "scripts" / "helper.py").write_text("def run(dataset):\n    while True:\n        pass\n", encoding="utf-8")
    t0 = time.monotonic()
    r = sf.sandbox("run", d, {"records": [], "evidence": []}, timeout=2)
    assert not r["ok"] and "timeout after 2s" in r["error"] and time.monotonic() - t0 < 10
