import json
import shutil
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from adapters import llm
from app import db, flywheel, skillforge as sf, tools

LEARN = flywheel.LEARN


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(sf, "BENCH", {"sizes": (1, 8), "trials": 2, "repeats": 5})  # keep the suite fast
    return db.connect()


def skill_dir(tmp_path, helper=None, tests=None, name="draft", src=None):
    d = tmp_path / name
    shutil.copytree(src or flywheel.FIXTURE, d)
    if helper is not None:
        (d / "scripts" / "helper.py").write_text(helper)
    if tests is not None:
        (d / "tests" / "test_helper.py").write_text(tests)
    return d


def solve_a(conn):
    """Scripted solve of scenario A inside an open task (what the agent would do the first time)."""
    db.load_scenario(conn, LEARN / "learn_a.json")
    sf.task_begin(conn, "a", "mock")
    for rid, value in (("A-102", 44.0), ("A-104", 125.0)):
        a = tools.call(conn, "propose_action", {"record_id": rid, "action_type": "set_field",
                                                "params": {"field": "total", "value": value}, "reason": "lines/scale"})["action"]
        tools.call(conn, "request_approval", {"action_id": a["id"]})
        tools.decide_approval(conn, a["id"], True, "alice")
        tools.call(conn, "execute_action", {"action_id": a["id"]})
        assert tools.call(conn, "verify_action", {"action_id": a["id"]})["passed"]


def learned(conn, tmp_path):
    solve_a(conn)
    p = tools.call(conn, "propose_skill", {"name": "line-total", "path": str(skill_dir(tmp_path)), "description": "totals"})
    assert p["status"] == "tested", p
    sf.task_end(conn)
    sf.approve_skill(conn, "line-total", p["version"], "alice")
    return p


# --- acceptance: learn -> reuse -> refuse, all without a model -------------------

def test_flywheel_end_to_end_no_llm(conn, monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9/v1")  # any inference attempt would fail loudly
    monkeypatch.setattr(llm.OpenAICompatLLM, "_req", lambda *a, **k: pytest.fail("model was called"))
    res = flywheel.run(conn)
    before, after, unrelated = res["tasks"]
    assert res["proposal"]["status"] == "tested" and res["proposal"]["validation"]["replay"]["ok"]
    assert before["success"] == 1 and after["success"] == 1 and after["skills_used"] == "line-total-reconcile@v2"
    assert res["proposal"]["profile"]["recommended"] and res["optimized_proposal"]["optimization"]["retained"]
    assert after["actions_executed"] == 3 and after["verifications_passed"] == 3 and after["invariant_violations"] == 0
    assert after["tool_calls"] < before["tool_calls"]
    assert unrelated["success"] == 0 and unrelated["actions_executed"] == 0
    assert res["unrelated_run"]["error"]["code"] == "incompatible_input"
    v1, v2 = res["skills"]
    assert (v1["status"], v2["status"], v2["active"], v2["parent_version"]) == ("approved", "approved", 1, 1)
    assert (v2["runs_ok"], v2["runs_refused"], v2["verified_pass"], v2["verified_fail"]) == (1, 1, 3, 0)
    assert v1["hidden_ok"] == 1 and v2["hidden_ok"] == 1


# --- learning preconditions ------------------------------------------------------------

def test_propose_requires_open_task_with_verified_fix(conn, tmp_path):
    db.load_scenario(conn, LEARN / "learn_a.json")
    args = {"name": "line-total", "path": str(skill_dir(tmp_path)), "description": "x"}
    assert tools.call(conn, "propose_skill", args)["error"]["code"] == "no_open_task"
    sf.task_begin(conn, "a", "mock")
    assert tools.call(conn, "propose_skill", args)["error"]["code"] == "nothing_verified"


@pytest.mark.parametrize("helper,tests,why", [
    ("import os\ndef run(d):\n    return {'proposals': []}\n", None, "lint"),
    ("def run(d):\n    open('x', 'w')\n    return {'proposals': []}\n", None, "lint"),
    ("def run(d):\n    return {'proposals': [{'record_id': 'A-102', 'field': 'total', 'value': 44.0}]}\n", "", "replay"),
    (None, "def test_wrong():\n    assert 1 == 2\n", "own_tests"),
    (None, "# no tests at all\n", "own_tests"),
])
def test_bad_candidates_fail_and_cannot_be_approved(conn, tmp_path, helper, tests, why):
    solve_a(conn)
    p = tools.call(conn, "propose_skill", {"name": "bad-skill", "path": str(skill_dir(tmp_path, helper, tests)),
                                           "description": "x"})
    assert p["status"] == "failed_tests"
    v = p["validation"]
    assert v["lint"] if why == "lint" else not v[why]["ok"]
    with pytest.raises(tools.ToolError):
        sf.approve_skill(conn, "bad-skill", p["version"], "alice")


# --- promotion / permissions ------------------------------------------------------------

def test_agent_cannot_promote_and_unapproved_cannot_run(conn, tmp_path):
    assert not {"approve_skill", "reject_skill", "disable_skill", "rollback_skill"} & set(tools.agent_tools())
    solve_a(conn)
    p = tools.call(conn, "propose_skill", {"name": "line-total", "path": str(skill_dir(tmp_path)), "description": "x"})
    assert tools.call(conn, "run_skill", {"name": "line-total"})["error"]["code"] == "not_found"  # tested != approved
    with pytest.raises(tools.ToolError):
        sf.approve_skill(conn, "line-total", p["version"], "agent")


def test_skill_proposals_still_need_human_approval(conn, tmp_path):
    learned(conn, tmp_path)
    db.load_scenario(conn, LEARN / "learn_b.json")
    r = tools.call(conn, "run_skill", {"name": "line-total", "propose": True})
    assert len(r["actions"]) == 3 and all(a["origin"].startswith("skill:line-total@v1#") for a in r["actions"])
    assert tools.call(conn, "execute_action", {"action_id": r["actions"][0]["id"]})["error"]["code"] == "not_approved"


def test_tampered_approved_skill_refused(conn, tmp_path):
    learned(conn, tmp_path)
    (sf.SKILLS_DIR / "approved" / "line-total" / "v1" / "scripts" / "helper.py").write_text("def run(d):\n    return {}\n")
    db.load_scenario(conn, LEARN / "learn_b.json")
    assert tools.call(conn, "run_skill", {"name": "line-total"})["error"]["code"] == "integrity_error"


def test_versioning_rollback_disable(conn, tmp_path):
    learned(conn, tmp_path)
    solve_a(conn)
    p2 = tools.call(conn, "propose_skill", {"name": "line-total", "path": str(skill_dir(tmp_path, name="v2")), "description": "x"})
    sf.task_end(conn)
    assert p2["version"] == 2
    sf.approve_skill(conn, "line-total", 2, "alice")
    assert tools.call(conn, "search_skills", {})["skills"][0]["version"] == 2
    assert sf.rollback_skill(conn, "line-total", "alice")["active"] == "line-total@v1"
    assert tools.call(conn, "search_skills", {})["skills"][0]["version"] == 1
    sf.disable_skill(conn, "line-total", "alice")
    assert tools.call(conn, "search_skills", {})["skills"] == []


def test_failed_reuse_is_recorded_and_suggests_revision(conn, tmp_path):
    learned(conn, tmp_path)
    db.load_scenario(conn, LEARN / "learn_b.json")
    r = tools.call(conn, "run_skill", {"name": "line-total", "propose": True})
    aid = r["actions"][0]["id"]
    tools.decide_approval(conn, aid, True, "alice")
    tools.call(conn, "execute_action", {"action_id": aid})
    conn.execute("UPDATE evidence SET data=json_set(data, '$.scale', 100) WHERE record_id=?", (r["actions"][0]["record_id"],))
    v = tools.call(conn, "verify_action", {"action_id": aid})  # ground truth moved -> skill's answer is now wrong
    assert v["passed"] is False and "propose_skill" in v["hint"]
    assert sf.list_skills(conn)["skills"][0]["verified_fail"] == 1


def test_incompatible_data_refused_and_recorded(conn, tmp_path):
    learned(conn, tmp_path)
    for scenario in (LEARN / "unrelated.json", db.DEFAULT_SCENARIO):
        db.load_scenario(conn, scenario)
        assert tools.call(conn, "search_skills", {"query": "total"})["skills"][0]["compatible"] is False
        assert tools.call(conn, "run_skill", {"name": "line-total"})["error"]["code"] == "incompatible_input"
    assert sf.list_skills(conn)["skills"][0]["runs_refused"] == 2


# --- restricted runner ----------------------------------------------------------------

@pytest.mark.parametrize("body,expect", [
    ("import socket\n    socket.socket()", "blocked"),
    ("import subprocess\n    subprocess.Popen(['echo'])", "blocked"),
    ("while True: pass", "timeout"),
])
def test_runner_blocks_network_processes_and_hangs(tmp_path, body, expect):
    d = skill_dir(tmp_path, helper=f"def run(d):\n    {body}\n")
    res = sf.sandbox("run", d, {}, timeout=3)
    assert res["ok"] is False and expect in res["error"]


def test_runner_scrubs_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("SUPER_SECRET_TOKEN", "hunter2")
    d = skill_dir(tmp_path, helper="import os\ndef run(d):\n    return dict(os.environ)\n")
    res = sf.sandbox("run", d, {})
    assert res["ok"] and "SUPER_SECRET_TOKEN" not in res["output"]


# --- metrics -------------------------------------------------------------------------

def test_model_calls_measured_from_inference_counter(conn, monkeypatch):
    count = {"n": 10}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass

        def do_GET(self):
            body = (f'# HELP x\nvllm:request_success_total{{finished_reason="stop"}} {count["n"]}.0\n'
                    'vllm:request_success_total{finished_reason="length"} 1.0\n').encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("LLM_METRICS_URL", f"http://127.0.0.1:{srv.server_port}/metrics")
    db.load_scenario(conn)
    sf.task_begin(conn, "t", "real")
    count["n"] += 4  # discovery/solve phase
    sf.task_mark(conn, "solved")
    count["n"] += 3  # skill generation phase
    sf.task_mark(conn, "skill_generated")
    t = sf.task_end(conn)
    assert t["model_calls"] == 7
    marks = json.loads(sf.task_list(conn)["tasks"][-1]["phase_marks"])
    assert [(m["phase"], m["model_calls"]) for m in marks] == [("solved", 4), ("skill_generated", 7)]
    srv.shutdown()
    monkeypatch.delenv("LLM_METRICS_URL")
    sf.task_begin(conn, "t2", "real")
    assert sf.task_end(conn)["model_calls"] is None  # unmeasured is reported as unknown, never 0


# =====================  sanitization / profiling / optimization addendum  =====================

HARDCODED_SCALE = """def run(dataset):
    recs = {r["id"]: r for r in dataset["records"]}
    out = []
    for e in dataset["evidence"]:
        r = recs.get(e["record_id"])
        if r is None or not e["trusted"] or "total" not in r["data"]:
            continue
        v = sum(e["data"]["lines"]) / 100
        if abs(r["data"]["total"] - v) > 1e-9:
            out.append({"record_id": r["id"], "field": "total", "value": v})
    return {"proposals": out}
"""


def test_static_sanitizer_errors_and_warnings(tmp_path):
    d = skill_dir(tmp_path, helper="import math\ndef run(d):\n    while True:\n        x = 1\n")
    errors, _ = sf.lint(d)
    assert any("unbounded loop" in e for e in errors)
    _, warnings = sf.lint(skill_dir(tmp_path, name="naive", src=flywheel.NAIVE))
    assert any("nested loop" in w for w in warnings) and any("line_total(e)" in w and "2x" in w for w in warnings)
    _, warnings = sf.lint(skill_dir(tmp_path, helper="import math\ndef run(d):\n    return {'proposals': []}\n", name="u"))
    assert any("unused import 'math'" in w for w in warnings)
    assert sf.lint(skill_dir(tmp_path, name="clean")) == ([], [])  # efficient fixture: nothing to flag


@pytest.mark.parametrize("output", [
    {"proposals": [{"record_id": "A-102", "field": "total", "value": 44.0, "evidence": "copied payload"}]},
    {"proposals": [], "debug": "extra top-level data"},
    {"proposals": [{"record_id": "A-102", "field": "total", "value": {"nested": 1}}]},
    {"proposals": [{"record_id": "A-102", "field": "total", "value": 44.0, "reason": "x" * 301}]},
    {"proposals": [{"record_id": f"A-{i}", "field": "total", "value": 1} for i in range(6)]},  # > 5 records
])
def test_output_sanitizer_rejects_exposure_and_excess(output):
    assert sf._valid_proposals(output, n_records=5) is None


def test_hidden_suite_catches_what_self_tests_and_replay_miss(conn, tmp_path):
    solve_a(conn)  # scenario A only has scale 100, so a hardcoded /100 passes replay and its own tests
    p = tools.call(conn, "propose_skill", {"name": "hardcoded", "path": str(skill_dir(tmp_path, HARDCODED_SCALE)),
                                           "description": "x"})
    assert p["status"] == "tested" and p["validation"]["replay"]["ok"] and p["validation"]["own_tests"]["ok"]
    with pytest.raises(tools.ToolError) as e:
        sf.approve_skill(conn, "hardcoded", p["version"], "alice")
    assert e.value.code == "hidden_validation_failed" and "unseen_values_scale_10" in e.value.message
    assert tools.call(conn, "run_skill", {"name": "hardcoded"})["error"]["code"] == "not_found"


def test_hidden_validation_required_and_host_sha_path(conn, tmp_path, monkeypatch, capsys):
    from app.__main__ import main
    solve_a(conn)
    p = tools.call(conn, "propose_skill", {"name": "line-total", "path": str(skill_dir(tmp_path)), "description": "x"})
    cand = sf.SKILLS_DIR / "candidates" / "line-total" / "v1"
    main(["skill", "hidden-check", str(cand)])  # host side: suite present, prints result + sha
    host = json.loads(capsys.readouterr().out)
    assert host["ok"] and len(host["cases"]) == 11
    monkeypatch.setenv("HIDDEN_DIR", str(tmp_path / "no-suite-here"))  # sandbox side: suite absent
    with pytest.raises(tools.ToolError) as e:
        sf.approve_skill(conn, "line-total", p["version"], "alice")
    assert e.value.code == "hidden_validation_required"
    with pytest.raises(tools.ToolError):
        sf.approve_skill(conn, "line-total", p["version"], "alice", hidden_sha="0" * 64)
    assert sf.approve_skill(conn, "line-total", p["version"], "alice", hidden_sha=host["sha256"])["ok"]


def test_profile_flags_waste_without_leaking_data(conn, tmp_path):
    solve_a(conn)
    naive = tools.call(conn, "propose_skill", {"name": "naive", "path": str(skill_dir(tmp_path, src=flywheel.NAIVE)),
                                               "description": "x"})
    good = tools.call(conn, "propose_skill", {"name": "good", "path": str(skill_dir(tmp_path, name="g")), "description": "x"})
    assert naive["profile"]["recommended"] and naive["profile"]["work_growth_8x"] > 16
    assert not good["profile"]["recommended"] and good["profile"]["work_growth_8x"] <= 16
    assert "A-10" not in json.dumps(naive["profile"])  # function names + counts only, never argument values
    assert tools.call(conn, "propose_skill", {"name": "good", "path": str(skill_dir(tmp_path, name="g2")),
                                              "description": "x", "optimizes": good["version"]})["error"]["code"] == "not_recommended"


def test_bounded_optimization_retained_once_and_rollback(conn, tmp_path):
    solve_a(conn)
    v1 = tools.call(conn, "propose_skill", {"name": "ltr", "path": str(skill_dir(tmp_path, src=flywheel.NAIVE)), "description": "x"})
    v2 = tools.call(conn, "propose_skill", {"name": "ltr", "path": str(skill_dir(tmp_path, name="opt")),
                                            "description": "x", "optimizes": v1["version"]})
    o = v2["optimization"]
    assert v2["status"] == "tested" and o["retained"] and o["correct_all_sizes"] and o["work_reduction"] > 0.5
    again = {"name": "ltr", "path": str(skill_dir(tmp_path, name="opt2")), "description": "x"}
    assert tools.call(conn, "propose_skill", {**again, "optimizes": v1["version"]})["error"]["code"] == "not_allowed"
    assert tools.call(conn, "propose_skill", {**again, "optimizes": v2["version"]})["error"]["code"] == "not_allowed"
    rows = sf.bench_rows(conn, "ltr")
    assert {(r["version"], r["size"]) for r in rows} == {(1, 1), (2, 1), (1, 8), (2, 8)} and all(r["correct"] for r in rows)
    sf.task_end(conn)
    sf.approve_skill(conn, "ltr", 1, "alice")
    sf.approve_skill(conn, "ltr", 2, "alice")
    assert sf.rollback_skill(conn, "ltr", "alice")["active"] == "ltr@v1"  # original verified version still there


def test_optimization_without_real_gain_not_retained(conn, tmp_path):
    solve_a(conn)
    v1 = tools.call(conn, "propose_skill", {"name": "ltr", "path": str(skill_dir(tmp_path, src=flywheel.NAIVE)), "description": "x"})
    same = tools.call(conn, "propose_skill", {"name": "ltr", "path": str(skill_dir(tmp_path, name="same", src=flywheel.NAIVE)),
                                              "description": "x", "optimizes": v1["version"]})
    assert same["status"] == "not_retained" and same["optimization"]["work_reduction"] == 0
    with pytest.raises(tools.ToolError):
        sf.approve_skill(conn, "ltr", same["version"], "alice")
    sf.task_end(conn)
    assert sf.approve_skill(conn, "ltr", v1["version"], "alice")["ok"]  # slow-but-correct original is still promotable


def test_optimization_that_breaks_correctness_is_rejected(conn, tmp_path):
    solve_a(conn)
    v1 = tools.call(conn, "propose_skill", {"name": "ltr", "path": str(skill_dir(tmp_path, src=flywheel.NAIVE)), "description": "x"})
    fast_wrong = "def run(dataset):\n    return {'proposals': []}\n"
    r = tools.call(conn, "propose_skill", {"name": "ltr", "path": str(skill_dir(tmp_path, fast_wrong, "", name="w")),
                                           "description": "x", "optimizes": v1["version"]})
    assert r["status"] == "failed_tests" and not r["validation"]["replay"]["ok"]


def test_tool_call_instrumentation(conn):
    db.load_scenario(conn)
    sf.task_begin(conn, "t", "mock")
    for _ in range(3):
        tools.call(conn, "investigate", {"record_id": "REC-001"})  # same args 3x -> 2 duplicates
    tools.call(conn, "read_records", {})
    t = sf.task_end(conn)
    assert t["duplicate_tool_calls"] == 2 and t["tool_calls"] == 4
    assert t["db_queries"] > 4 and t["data_bytes"] > 500
    assert json.loads(t["tool_breakdown"]) == {"investigate": 3, "read_records": 1}


def test_run_skill_version_pin_requires_approved(conn, tmp_path):
    learned(conn, tmp_path)
    db.load_scenario(conn, LEARN / "learn_b.json")
    assert tools.call(conn, "run_skill", {"name": "line-total", "version": 1})["ok"]
    assert tools.call(conn, "run_skill", {"name": "line-total", "version": 9})["error"]["code"] == "not_found"


def test_old_database_is_migrated(tmp_path):
    import sqlite3
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.execute("CREATE TABLE tool_calls (id INTEGER PRIMARY KEY, task_id INTEGER, tool TEXT, ok INTEGER, ms REAL, ts TEXT)")
    old.close()
    cols = {r["name"] for r in db.connect(path).execute("PRAGMA table_info(tool_calls)")}
    assert {"args_hash", "queries", "resp_bytes"} <= cols


def test_deterministic_task_mode_never_claims_a_model(conn, tmp_path, monkeypatch):
    """Router fast path: fixed skill code ran, no model and no agent. Even with a probed model on the host, the task
    carries no model name, and no other mode word is accepted."""
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "model_probe.json").write_text(json.dumps({"model": "qwen-probed"}))
    monkeypatch.setattr(sf, "ROOT", tmp_path)
    db.load_scenario(conn)
    sf.task_begin(conn, "routed", "deterministic")
    sf.task_end(conn, model_calls=0)
    t = conn.execute("SELECT mode, model, model_calls FROM tasks ORDER BY id DESC LIMIT 1").fetchone()
    assert (t["mode"], t["model"], t["model_calls"]) == ("deterministic", None, 0)
    sf.task_begin(conn, "agent", "real")  # the same probe IS attributed to a real run: the test above is meaningful
    assert conn.execute("SELECT model FROM tasks ORDER BY id DESC LIMIT 1").fetchone()["model"] == "qwen-probed"
    sf.task_end(conn)
    with pytest.raises(sf.ToolError):
        sf.task_begin(conn, "x", "agent")
