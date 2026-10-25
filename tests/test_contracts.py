"""Integration-contract rehearsal without a GB10: openclaw --json parsing (fixtures, NOT real OpenClaw), session
separation, and host-service failure behaviour (auth, restart, malformed input, oversized output, verifier failure)."""
import http.client
import json
import os
import shlex
import socket
import subprocess
import sys
import threading
import time
from http.server import HTTPServer
from pathlib import Path

import pytest

from app import bench, db, server, skillforge as sf, tools

ROOT = db.ROOT
FIX = ROOT / "tests" / "fixtures" / "openclaw"
CLIENT = str(ROOT / "adapters" / "openclaw" / "client.py")


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    c = db.connect()
    db.load_scenario(c)
    return c


def start(port=0):
    srv = HTTPServer(("127.0.0.1", port), server.Handler)
    srv.token = "t0k"
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def client(url, tool, args="{}", tok="t0k", **env):
    return subprocess.run([sys.executable, CLIENT, tool, args], capture_output=True, text=True, timeout=60,
                          env={**os.environ, "APP_REMOTE": url, "APP_TOKEN": tok, **env})


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# --- openclaw agent --json contract (fixtures) ----------------------------------------------

@pytest.mark.parametrize("mode,tools_,turns,errors,missing", [
    ("ok", 5, 4, False, 0), ("banner", 5, 4, False, 0),
    ("missing", None, None, False, 2),  # optional in the source: unknown (None), never 0
    ("inflight", None, None, True, 0), ("flat", None, None, True, 0), ("garbage", None, None, True, 0)])
def test_agent_json_contract(mode, tools_, turns, errors, missing, tmp_path):
    out = subprocess.run([sys.executable, str(FIX / "fake_openclaw.py"), "s", "m"], capture_output=True, text=True,
                         env={**os.environ, "FAKE_LOG": str(tmp_path / "log"), "FAKE_MODE": mode}).stdout
    p = bench.parse_agent_json(out)
    assert (p["tool_count"], p["turns"], bool(p["schema_errors"]), len(p["missing"])) == (tools_, turns, errors, missing)


def test_captured_real_output_matches_contract_if_present():
    real = FIX / "captured_gb10.json"
    if not real.exists():
        pytest.skip("no real openclaw --json capture yet (Gate 2 saves one)")
    assert bench.parse_agent_json(real.read_text())["schema_errors"] == []


def fake_agent(tmp_path, mode="ok"):
    cmd = " ".join(shlex.quote(a.replace("\\", "/")) for a in (sys.executable, str(FIX / "fake_openclaw.py")))
    os.environ["FAKE_LOG"], os.environ["FAKE_MODE"] = str(tmp_path / "calls.log"), mode
    return bench.OpenClawAgent(cmd=cmd + " {session} {message}")


def test_each_trial_gets_a_fresh_session_and_approval_reuses_it(tmp_path):
    agent = fake_agent(tmp_path)
    a = agent.run(None, lambda: True)
    b = agent.run(None, lambda: False)
    calls = [json.loads(ln) for ln in (tmp_path / "calls.log").read_text().splitlines()]
    assert [c[0] for c in calls] == [a["session"], a["session"], b["session"]] and a["session"] != b["session"]
    assert calls[1][1].startswith("Approved.") and all(t["schema_errors"] == [] for t in a["turns"])


def test_broken_cli_is_reported_not_counted_as_zero(tmp_path):
    turn = fake_agent(tmp_path, "fail").turn("s1", "hi")
    assert turn["exit"] == 1 and turn["tool_count"] is None and turn["schema_errors"] and "gateway" in turn["stderr"]
    res = {"agent": "openclaw", "real_model": True, "trials": 1, "agent_turn_errors": [turn], "summary": [],
           "learning": {"phases": {}, "model_calls": None, "tool_calls": None, "skill": None, "autonomous": True},
           "breakeven_C": {}, "breakeven_B": {}, "result_file": "x"}
    assert "WARNING: 1 agent turn(s) failed" in bench.report(res)


def test_skills_state_restored_even_when_trial_crashes(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    c = db.connect()
    bench.learn(c, bench.MockAgent())
    before = [tuple(r) for r in c.execute("SELECT id, status, active FROM skills")]
    with pytest.raises(RuntimeError):
        with bench.skills_state(c, "disabled"):
            raise RuntimeError("agent crashed mid-trial")
    assert [tuple(r) for r in c.execute("SELECT id, status, active FROM skills")] == before


# --- host service resilience ------------------------------------------------------------------

def raw(srv, body=b"", headers=None, method="POST", path="/call"):
    h = http.client.HTTPConnection("127.0.0.1", srv.server_port, timeout=10)
    h.request(method, path, body=body, headers={"Authorization": "Bearer t0k", **(headers or {})})
    r = h.getresponse()
    return r.status, json.loads(r.read())


def test_malformed_requests_get_structured_errors(conn):
    srv = start()
    try:
        assert raw(srv, b"{not json")[0] == 400
        assert raw(srv, b"", {"Content-Length": "-1"})[0] == 400  # would block a naive rfile.read(-1)
        assert raw(srv, b"[1,2]")[1]["error"]["code"] == "unknown_tool"
        assert raw(srv, json.dumps({"tool": "read_records", "args": [1]}).encode())[1]["error"]["code"] == "invalid_input"
        assert raw(srv, method="GET")[0] == 405 and raw(srv, b"{}", path="/admin")[0] == 404
        assert raw(srv, b"{}", {"Authorization": "Bearer t0k "})[0] == 401
        assert raw(srv, json.dumps({"tool": "read_records"}).encode())[1]["ok"]  # still serving
    finally:
        srv.shutdown()


def test_tool_crash_and_oversized_result_are_contained(conn, monkeypatch):
    srv = start()
    try:
        monkeypatch.setattr(server, "MAX_RESP", 50)
        assert raw(srv, json.dumps({"tool": "read_records"}).encode())[1]["error"]["code"] == "response_too_large"
        monkeypatch.setattr(server, "MAX_RESP", 4_000_000)
        monkeypatch.setattr(server, "handle", lambda c, b: 1 / 0)
        status, body = raw(srv, json.dumps({"tool": "read_records"}).encode())
        assert status == 200 and body["error"]["code"] == "internal_error" and "ZeroDivision" in body["error"]["message"]
    finally:
        srv.shutdown()


def test_client_unreachable_and_wrong_service(tmp_path):
    r = client(f"http://127.0.0.1:{free_port()}/call", "read_records", APP_RETRIES="0")
    assert r.returncode == 2 and json.loads(r.stdout)["error"]["code"] == "service_unreachable"
    srv = HTTPServer(("127.0.0.1", 0), type("H", (server.BaseHTTPRequestHandler,), {
        "do_POST": lambda s: (s.send_response(200), s.end_headers(), s.wfile.write(b"<html>proxy</html>")),
        "log_message": lambda *a: None}))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        r = client(f"http://127.0.0.1:{srv.server_port}/call", "read_records")
        assert r.returncode == 2 and json.loads(r.stdout)["error"]["code"] == "bad_response"
    finally:
        srv.shutdown()


def test_client_survives_service_restart(conn):
    port = free_port()
    p = subprocess.Popen([sys.executable, CLIENT, "read_records", "{}"], stdout=subprocess.PIPE, text=True,
                         env={**os.environ, "APP_REMOTE": f"http://127.0.0.1:{port}/call", "APP_TOKEN": "t0k",
                              "APP_RETRIES": "3"})
    time.sleep(1.5)  # service is "down" (restarting) when the call starts
    srv = start(port)
    try:
        out, _ = p.communicate(timeout=30)
        assert p.returncode == 0 and json.loads(out)["ok"]
    finally:
        srv.shutdown()


def test_duplicate_calls_idempotent_and_verifier_failure_escalates(conn):
    srv = start()
    url = f"http://127.0.0.1:{srv.server_port}/call"
    try:
        prop_args = json.dumps({"record_id": "REC-001", "action_type": "set_field",
                                "params": {"field": "quantity", "value": 100}, "reason": "contract test"})
        aid = json.loads(client(url, "propose_action", prop_args).stdout)["action"]["id"]
        again = json.loads(client(url, "propose_action", prop_args).stdout)
        assert again["deduplicated"] and again["action"]["id"] == aid
        assert json.loads(client(url, "execute_action", json.dumps({"action_id": aid})).stdout)["ok"] is False
        client(url, "request_approval", json.dumps({"action_id": aid}))
        tools.decide_approval(conn, aid, True, "human")  # host CLI only; no service endpoint for this
        first = json.loads(client(url, "execute_action", json.dumps({"action_id": aid})).stdout)
        second = json.loads(client(url, "execute_action", json.dumps({"action_id": aid})).stdout)
        assert first["ok"] and second["already_executed"]
        assert conn.execute("SELECT COUNT(*) FROM executions WHERE action_id=?", (aid,)).fetchone()[0] == 1
        conn.execute("UPDATE records SET data=json_set(data, '$.quantity', 120) WHERE id='REC-001'")  # another writer changes it after execution
        v = json.loads(client(url, "verify_action", json.dumps({"action_id": aid})).stdout)
        assert v["ok"] and v["passed"] is False
        row = conn.execute("SELECT passed FROM verifications WHERE action_id=? ORDER BY id DESC", (aid,)).fetchone()
        assert row["passed"] == 0  # failure is recorded host-side for a human, not hidden by the agent
    finally:
        srv.shutdown()


# --- gate evidence: mock / fixture results can never pass the real-model gates ------------------

def test_gate_evidence_refuses_mock_and_fixture(tmp_path, monkeypatch):
    sys.path.insert(0, str(ROOT / "scripts"))
    import gate_evidence as ge
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    c = db.connect()
    bench.learn(c, bench.MockAgent())  # mock task + fixture skill, approved
    assert not all(p for _, p, _ in ge.gate3(c))  # no REAL task
    c.execute("UPDATE tasks SET mode='real'")  # pretend: fixture skill under a real task
    checks = {name: ok for name, ok, _ in ge.gate3(c)}
    assert checks["skill proposed from a REAL-model task"] and not checks["not the mock fixture"]
    res = bench.run(1, bench.MockAgent(), str(tmp_path / "b.db"), str(tmp_path / "bs"), modes=("A", "C"),
                    cases=["unseen_compatible"])
    checks = {name: ok for name, ok, _ in ge.gate5(res["result_file"])}
    assert not checks["real model (not mock)"] and checks["mode A and C trials ran"]


def test_rerun_after_killed_bench_is_not_blocked(tmp_path, monkeypatch):
    dbp = tmp_path / "b.db"
    monkeypatch.setenv("APP_DB", str(dbp))
    c = db.connect()
    sf.task_begin(c, "bench A unseen_compatible #1", "real")  # what a killed trial leaves behind
    res = bench.run(1, bench.MockAgent(), str(dbp), str(tmp_path / "s"), modes=("C",), cases=["unseen_compatible"])
    c = db.connect()
    assert res["summary"] and c.execute("SELECT status FROM tasks WHERE id=1").fetchone()[0] == "aborted"
    sf.task_begin(c, "human task", "real")  # a human's open task is NOT closed by the harness
    with pytest.raises(RuntimeError):
        bench.run(1, bench.MockAgent(), str(dbp), str(tmp_path / "s"), modes=("C",), cases=["unseen_compatible"],
                  reuse_skill=True)
