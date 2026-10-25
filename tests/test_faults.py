"""Fault injection. Every failure is SIMULATED on a dev box (fake model server, fake openclaw CLI, injected
exceptions, held DB locks). None of this is hardware validation. Each test asserts: no unauthorized or duplicate
mutation, no false success, state preserved, failure observable, recovery/escalation works."""
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer

import pytest

from adapters import llm, models
from app import bench, db, ops, server, skillforge as sf, tools
from test_contracts import CLIENT, FIX, client, fake_agent, start

LEARN = db.ROOT / "data" / "learning"


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(models, "PROBE_FILE", tmp_path / "probe.json")
    c = db.connect()
    db.load_scenario(c)
    return c


@pytest.fixture
def learned(conn):
    bench.learn(conn, bench.MockAgent())  # approved line-total-reconcile (MOCK fixture skill)
    db.load_scenario(conn, LEARN / "learn_b.json")
    return conn


def approved(conn, value=100):
    a = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                            "params": {"field": "quantity", "value": value}, "reason": "fix"})
    tools.call(conn, "request_approval", {"action_id": a["action"]["id"]})
    tools.decide_approval(conn, a["action"]["id"], True, "alice")
    return a["action"]["id"]


def executions(conn):
    return conn.execute("SELECT COUNT(*) FROM executions").fetchone()[0]


def records(conn):
    return [tuple(r) for r in conn.execute("SELECT id, data FROM records ORDER BY id")]


# --- a scriptable fake OpenAI-compatible server (tool calling) --------------------------------

@pytest.fixture
def fake_llm():
    state = {"mode": "good", "model": "nvidia/Qwen3.6-35B-A3B-NVFP4", "calls": 0}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, obj):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            mf = state.get("model_file")
            model = open(mf).read().strip() if mf and os.path.exists(mf) else state["model"]
            self._send(200, {"data": [{"id": model}]})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["calls"] += 1
            mode = state["mode"]
            if mode == "slow":
                time.sleep(3)
            if mode == "error500":
                return self._send(500, {"error": "engine dead"})
            if mode == "prose":
                return self._send(200, {"choices": [{"message": {"content": "I would call read_records."}}]})
            name, args = ("investigate", '{"record_id": "REC-7"}') if any(m["role"] == "tool" for m in body["messages"]) \
                else ("read_records", "{}")
            if mode == "badargs":
                args = "{record_id: REC-7"
            self._send(200, {"choices": [{"message": {"content": None, "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": name, "arguments": args}}]}}]})

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)  # a stuck slow request must not queue the next one
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/v1", state
    srv.shutdown()


# 1 + 13 + 14: inference unavailable / wrong model / unregistered artifacts --------------------------------

def test_f01_inference_down_blocks_learning_and_mutates_nothing(conn, monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9/v1")
    monkeypatch.setenv("LLM_RETRIES", "0")
    before = records(conn)
    p = models.probe(llm.from_env())
    assert not p["passed"] and p["missing"][0] == "endpoint"
    res = bench.learn(conn, bench.OpenClawAgent(cmd="should-never-run {session} {message}"))
    assert res["refused"] and res["skill"] is None and records(conn) == before
    assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0


def test_f13_f14_wrong_or_unregistered_model_fails_probe(fake_llm, monkeypatch):
    url, st = fake_llm
    p = models.probe(llm.OpenAICompatLLM(url))
    assert p["passed"], p
    st["model"] = "some/unregistered-model"
    p = models.probe(llm.OpenAICompatLLM(url))
    assert not p["passed"] and "identity" in p["missing"]
    with pytest.raises(llm.LLMUnavailable, match="not served"):
        llm.OpenAICompatLLM(url, model="nvidia/Qwen3.6-35B-A3B-NVFP4").health()


def test_f14_probe_must_match_the_model_served_now(conn, fake_llm):
    url, st = fake_llm
    models.save(models.probe(llm.OpenAICompatLLM(url)))
    assert models.learning_allowed("nvidia/Qwen3.6-35B-A3B-NVFP4")[0]
    ok, why = models.learning_allowed("nvidia-nemotron-3.5-lightning-30b-a3b-nvfp4")  # switched, not re-probed
    assert not ok and "re-probe" in why


# 3: invalid structured tool calls --------------------------------------------------------------

@pytest.mark.parametrize("mode,missing", [("prose", "native_tool_call"), ("badargs", "schema")])
def test_f03_invalid_tool_calls_fail_the_probe(fake_llm, mode, missing):
    url, st = fake_llm
    st["mode"] = mode
    assert missing in models.probe(llm.OpenAICompatLLM(url))["missing"]


def test_f03_malformed_tool_args_never_reach_business_logic(conn):
    before = records(conn)
    for args in ([1], {"record_id": "REC-001", "action_type": "set_field", "params": "x", "reason": "r"},
                 {"record_id": "NOPE", "action_type": "set_field", "params": {"field": "quantity", "value": 1}, "reason": "r"}):
        assert server.handle(conn, {"tool": "propose_action", "args": args})["ok"] is False
    assert records(conn) == before and conn.execute("SELECT COUNT(*) FROM actions").fetchone()[0] == 0


# 4: timeouts (model and agent) ----------------------------------------------------------------

def test_f04_model_timeout_and_5xx_are_bounded(fake_llm, monkeypatch):
    url, st = fake_llm
    monkeypatch.setenv("LLM_RETRIES", "1")
    for mode in ("slow", "error500"):
        st["mode"], st["calls"] = mode, 0
        t0 = time.monotonic()
        with pytest.raises(llm.LLMUnavailable):
            llm.OpenAICompatLLM(url, model=st["model"], timeout=1).chat([{"role": "user", "content": "x"}])
        assert st["calls"] == 2 and time.monotonic() - t0 < 12  # 1 retry, then escalate; never unbounded


def test_f04_agent_turn_timeout_is_reported_not_retried(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_TIMEOUT", "2")
    t = fake_agent(tmp_path, "hang").turn("s", "m")
    assert t["exit"] == "timeout" and t["attempts"] == 1 and t["tool_count"] is None


def test_f02_transient_gateway_failure_retried_once(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RETRIES", "1")
    t = fake_agent(tmp_path, "flaky").turn("s", "m")
    assert t["exit"] == 0 and t["attempts"] == 2 and t["tool_count"] == 5


# 2 + 7: model/agent dies mid-workflow ----------------------------------------------------------------

def test_f02_agent_crash_after_proposing_resumes_without_duplicates(conn):
    a = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                            "params": {"field": "quantity", "value": 100}, "reason": "fix"})
    tools.call(conn, "request_approval", {"action_id": a["action"]["id"]})
    # ... model process dies here; a new session repeats the same steps:
    again = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                                "params": {"field": "quantity", "value": 100}, "reason": "fix again"})
    assert again["deduplicated"] and conn.execute("SELECT COUNT(*) FROM actions").fetchone()[0] == 1
    assert ops.status(conn)["workflows_by_state"] == {"WAITING_APPROVAL": [a["action"]["id"]]}


def test_f07_crash_inside_execution_rolls_back_then_executes_once(conn, monkeypatch):
    aid, before = approved(conn), records(conn)
    real = tools.audit

    def dying(c, actor, event, payload):
        if event == "execute_action":
            raise RuntimeError("process killed mid-transaction")
        return real(c, actor, event, payload)

    monkeypatch.setattr(tools, "audit", dying)
    with pytest.raises(RuntimeError):
        tools.execute_action(conn, aid)
    assert records(conn) == before and executions(conn) == 0  # atomic: nothing half-applied
    assert ops.status(conn)["workflows_by_state"] == {"READY": [aid]}
    monkeypatch.setattr(tools, "audit", real)
    assert tools.call(conn, "execute_action", {"action_id": aid})["already_executed"] is False
    assert tools.call(conn, "execute_action", {"action_id": aid})["already_executed"] is True and executions(conn) == 1


def test_f07_restart_between_execute_and_verify_is_recovered(conn):
    aid = approved(conn)
    tools.call(conn, "execute_action", {"action_id": aid})  # ... crash before verify_action
    c2 = db.connect()  # "restarted" process
    assert ops.status(c2)["workflows_by_state"] == {"VERIFYING": [aid]}
    r = ops.recover(c2)
    assert r["verified_after_restart"] == [{"action_id": aid, "passed": True}] and executions(c2) == 1
    assert ops.status(c2)["workflows_by_state"] == {"COMPLETED": [aid]}


# 5 + 6: host service restarts / times out after receiving ------------------------------------------------

def test_f06_client_timeout_after_service_executed_then_retry_is_idempotent(conn, monkeypatch):
    aid = approved(conn)
    real = server.handle

    def slow(c, body):
        res = real(c, body)
        if body.get("tool") == "execute_action":
            time.sleep(3)  # reply lost / late: the mutation already committed
        return res

    monkeypatch.setattr(server, "handle", slow)
    srv = start()
    url = f"http://127.0.0.1:{srv.server_port}/call"
    try:
        r1 = client(url, "execute_action", json.dumps({"action_id": aid}), APP_TIMEOUT="1")
        assert json.loads(r1.stdout)["error"]["code"] == "service_unreachable" and r1.returncode == 2  # no false success
        time.sleep(2.5)
        r2 = json.loads(client(url, "execute_action", json.dumps({"action_id": aid})).stdout)
        assert r2["ok"] and r2["already_executed"] and executions(conn) == 1  # reconciled, not repeated
    finally:
        srv.shutdown()


# 8: database temporarily unavailable ----------------------------------------------------------------

def test_f08_locked_db_returns_retryable_error_and_no_partial_write(conn):
    aid, before = approved(conn), records(conn)
    conn.execute("PRAGMA busy_timeout = 200")
    blocker = sqlite3.connect(os.environ["APP_DB"], isolation_level=None)
    blocker.execute("BEGIN EXCLUSIVE")
    try:
        r = tools.call(conn, "execute_action", {"action_id": aid})
        assert r["ok"] is False and r["error"]["code"] == "db_busy" and r["retryable"] and r["unlogged"]
    finally:
        blocker.execute("ROLLBACK")
        blocker.close()
    assert records(conn) == before and executions(conn) == 0
    assert tools.call(conn, "execute_action", {"action_id": aid})["ok"] and executions(conn) == 1


def test_f08_concurrent_executes_apply_once_without_errors(conn):
    aid, results = approved(conn), []

    def go():
        c = db.connect()
        results.append(tools.call(c, "execute_action", {"action_id": aid}))
        c.close()

    ts = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert all(r["ok"] for r in results), results
    assert sum(not r["already_executed"] for r in results) == 1 and executions(conn) == 1


def test_f08_conflicting_open_fixes_are_refused(conn):
    approved(conn, 100)
    r = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                            "params": {"field": "quantity", "value": 99}, "reason": "other fix"})
    assert r["error"]["code"] == "conflict"


# 9: approval delayed or rejected ----------------------------------------------------------------

def test_f09_delayed_or_rejected_approval_never_executes(conn):
    a = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                            "params": {"field": "quantity", "value": 100}, "reason": "fix"})
    aid, before = a["action"]["id"], records(conn)
    tools.call(conn, "request_approval", {"action_id": aid})
    assert tools.call(conn, "execute_action", {"action_id": aid})["error"]["code"] == "not_approved"  # still waiting
    tools.decide_approval(conn, aid, False, "alice")
    assert tools.call(conn, "execute_action", {"action_id": aid})["error"]["code"] == "not_approved"
    assert records(conn) == before and ops.status(conn)["workflows_by_state"] == {"CANCELLED": [aid]}


# 10 + 11: skill fails hidden validation / fails during reuse -----------------------------------------------

def test_f11_skill_failing_verification_falls_back_and_is_marked(learned):
    row = bench.trial(learned, "C", "skill_fails_verification", bench.MockAgent(), 1)
    assert row["decision"] == "skill_failed_verification" and row["fallback"] is True
    s = [x for x in sf.list_skills(learned)["skills"] if x["status"] == "approved"][0]
    assert s["verified_fail"] >= 1  # observable on the skill's record
    assert "VERIFYING" not in ops.status(learned)["workflows_by_state"]  # every executed action was verified


def test_f10_submission_limit_bounds_oracle_probing(conn, tmp_path, monkeypatch):
    monkeypatch.setattr(sf, "MAX_DRAFTS", 2)
    conn.execute("INSERT INTO skills (name, version, description, tags, status, input_shape, sha256, validation) "
                 "VALUES ('probe-x', 1, 'd', '[]', 'failed_tests', 's', 'h', '{}'), "
                 "('probe-x', 2, 'd', '[]', 'rejected', 's', 'h', '{}')")
    d = tmp_path / "draft"
    for f in ("SKILL.md", "scripts/helper.py", "tests/test_helper.py"):
        (d / f).parent.mkdir(parents=True, exist_ok=True)
        (d / f).write_text("x")
    assert tools.call(conn, "propose_skill", {"name": "probe-x", "path": str(d), "description": "d"})["error"]["code"] \
        == "submission_limit"


# no-model mode (all inference unavailable) ------------------------------------------------------------

def test_no_model_fastpath_reuses_approved_skill_with_same_checks(learned, monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9/v1")  # nothing is served
    r = ops.fastpath(learned)
    assert r["ok"] and r["decision"] == "skill" and r["awaiting_approval"]
    assert ops.fastpath(learned, execute=True)["executed_and_verified"] == []  # nothing runs before approval
    for aid in r["awaiting_approval"]:
        tools.decide_approval(learned, aid, True, "alice")
    done = ops.fastpath(learned, execute=True)
    assert done["ok"] and all(d["passed"] for d in done["executed_and_verified"])


@pytest.mark.parametrize("scenario", ["lookalike.json", "unrelated.json", "malformed.json"])
def test_no_model_fastpath_escalates_unfamiliar_tasks(learned, scenario):
    db.load_scenario(learned, LEARN / scenario)
    before = records(learned)
    r = ops.fastpath(learned)
    assert r["ok"] is False and r["decision"] == "escalate" and records(learned) == before
    assert learned.execute("SELECT 1 FROM audit WHERE event='escalated_no_model'").fetchone()


def test_skill_learned_under_one_model_runs_unchanged_under_another(learned, tmp_path):
    learned.execute("UPDATE tasks SET model='nvidia/Qwen3.6-35B-A3B-NVFP4'")  # provenance: learned under Qwen
    models.save({"model": "nvidia-nemotron-3.5-lightning-30b-a3b-nvfp4", "passed": True, "ts": time.time()})
    r = tools.call(learned, "run_skill", {"name": "line-total-reconcile"})
    assert r["ok"] and r["proposals"]  # deterministic helper: no model involved in execution


# data integrity: checkpoint/restore, migrations ---------------------------------------------------------

def test_restore_checkpoint_and_resume_interrupted_workflow(conn, tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "_running_services", lambda: ([], False))  # a live console on this host must not decide the test
    aid = approved(conn)
    b = ops.db_backup(conn, tmp_path / "ck.db")
    assert b["integrity"] == "ok"
    tools.call(conn, "execute_action", {"action_id": aid})
    conn.close()
    assert ops.db_restore(tmp_path / "ck.db", services_stopped=True)["ok"]
    c = db.connect()
    assert executions(c) == 0 and ops.status(c)["workflows_by_state"] == {"READY": [aid]}
    assert tools.call(c, "execute_action", {"action_id": aid})["ok"] and executions(c) == 1
    assert ops.recover(c)["verified_after_restart"] == [{"action_id": aid, "passed": True}]


def test_corrupt_backup_is_not_restored(conn, tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "_running_services", lambda: ([], False))  # a live console on this host must not decide the test
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"not a database" * 100)
    with pytest.raises(sqlite3.DatabaseError):
        ops.db_restore(bad, services_stopped=True)


def test_newer_schema_is_refused_and_old_schema_upgraded(tmp_path):
    p = tmp_path / "n.db"
    c = sqlite3.connect(p)
    c.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
    c.close()
    with pytest.raises(RuntimeError, match="newer than this code"):
        db.connect(str(p))
    c = db.connect(str(tmp_path / "fresh.db"))
    assert c.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


# secrets never land in authoritative records or benchmark artifacts ------------------------------------------

def test_secrets_absent_from_db_and_bench_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "sk-local-SECRET-123456")
    res = bench.run(1, bench.MockAgent(), str(tmp_path / "b.db"), str(tmp_path / "s"), modes=("A", "C"),
                    cases=["unseen_compatible"])
    c = db.connect(str(tmp_path / "b.db"))
    srv = start()
    try:
        client(f"http://127.0.0.1:{srv.server_port}/call", "read_records")  # token t0k sent as header only
    finally:
        srv.shutdown()
    blob = "\n".join(str(tuple(r)) for t in [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
                     for r in c.execute(f"SELECT * FROM {t}")) + open(res["result_file"]).read()
    assert "SECRET-123456" not in blob and "Bearer" not in blob


# operator-controlled model switch: fake nemoclaw/docker binaries, fake vLLM ---------------------------------

FAKE_NEMOCLAW = """#!/usr/bin/env bash
echo "nemoclaw $*" >> "$FAKE_DIR/calls"
case "$1 $2" in
  "onboard --profile") case "$3" in good*) echo nvidia/Qwen3.6-35B-A3B-NVFP4 ;; *) echo unregistered/model ;; esac > "$FAKE_DIR/model"
                       [ "$3" = "broken-onboard" ] && exit 1; exit 0 ;;
  "inference get") echo "{\\"provider\\": \\"vllm-local\\", \\"model\\": \\"$(cat "$FAKE_DIR/model")\\"}" ;;
esac
"""
FAKE_DOCKER = """#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_DIR/calls"
[ "$1" = ps ] && echo abc123
exit 0
"""


@pytest.mark.parametrize("new,prev,code,last_onboard", [
    ("good-lightning", "good-qwen", 0, "good-lightning"),   # validated switch
    ("bad-model", "good-qwen", 3, "good-qwen"),             # new model fails probe -> rolled back
    ("bad-model", "bad-other", 4, "bad-other"),             # nothing validates -> no-model mode advice
])
def test_switch_model_verifies_and_rolls_back(fake_llm, tmp_path, monkeypatch, new, prev, code, last_onboard):
    import shutil as sh
    bash = sh.which("bash")
    if not bash or "system32" in bash.lower():
        pytest.skip("needs a POSIX bash")
    url, st = fake_llm
    st["model_file"] = str(tmp_path / "model")
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    for name, body in (("nemoclaw", FAKE_NEMOCLAW), ("docker", FAKE_DOCKER)):
        (bin_ / name).write_bytes(body.encode())
        (bin_ / name).chmod(0o755)
    py = bin_ / "python3"  # route python3 to this interpreter, in this repo
    py.write_bytes(f'#!/usr/bin/env bash\nexec "{sys.executable.replace(chr(92), "/")}" "$@"\n'.encode())
    py.chmod(0o755)
    env = {**os.environ, "PATH": str(bin_) + os.pathsep + os.environ["PATH"], "FAKE_DIR": str(tmp_path),
           "LLM_BASE_URL": url, "WAIT_TRIES": "2", "WAIT_SLEEP": "0", "VLLM_KEY_FILE": str(tmp_path / "nokey")}
    probe_file = db.ROOT / "data" / "model_probe.json"
    saved = probe_file.read_bytes() if probe_file.exists() else None
    try:
        r = subprocess.run([bash, "scripts/switch_model.sh", new, prev], cwd=db.ROOT, env=env, capture_output=True,
                           text=True, timeout=120)
    finally:
        probe_file.unlink(missing_ok=True)
        if saved is not None:
            probe_file.write_bytes(saved)
    calls = (tmp_path / "calls").read_text()
    assert r.returncode == code, r.stdout + r.stderr
    onboards = [ln.split()[-2] for ln in calls.splitlines() if " onboard --profile " in ln]
    assert onboards[-1] == last_onboard, calls
    assert "docker container stop abc123" in calls  # the resident model is stopped before another is served


def test_soak_mock_trials_are_clean(monkeypatch, tmp_path):
    from app import soak
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    m = soak.run(trials=24, seed=3)
    assert m["clean"], {k: m[k] for k in ("correct", "trials", "invariant_violations", "unrecovered")} | {
        "incorrect": m.get("incorrect"), "exceptions": m.get("exceptions")}


def test_restore_refuses_while_a_service_still_answers(conn, tmp_path, monkeypatch):
    """Runbook R15 is offline-only: stop serve and ui first. A still-running console or agent service blocks it."""
    assert ops.db_backup(conn, tmp_path / "b.db")["ok"]
    before = records(conn)

    class Up(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):  # stands in for /ui/health
            self.send_response(200)
            self.end_headers()

        def do_POST(self):  # stands in for serve: 401 without a token (or a wrong/broken service: 500)
            self.send_response(self.server.code)
            self.end_headers()

    srv = HTTPServer(("127.0.0.1", 0), Up)
    srv.code = 401
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("APP_UI_PORT", str(srv.server_port))
        r = ops.db_restore(tmp_path / "b.db")
        assert not r["ok"] and r["running"] == ["operator console (python -m app ui)"]
        monkeypatch.setenv("APP_SERVICE_URL", f"http://127.0.0.1:{srv.server_port}/call")
        assert len(ops.db_restore(tmp_path / "b.db")["running"]) == 2
        srv.code = 500  # a service that answers with an error is still running: never treated as stopped
        assert len(ops.db_restore(tmp_path / "b.db")["running"]) == 2
    finally:
        srv.shutdown()
    assert records(conn) == before  # nothing was overwritten
    monkeypatch.delenv("APP_SERVICE_URL")
    monkeypatch.setenv("APP_UI_PORT", "1")  # nothing listens there
    monkeypatch.setenv("PORT", "1")  # and nothing on serve's loopback port
    refused = ops.db_restore(tmp_path / "b.db")  # serve's address unknown: unknown is not "stopped"
    assert not refused["ok"] and "--services-stopped" in refused["error"] and records(conn) == before
    done = ops.db_restore(tmp_path / "b.db", services_stopped=True)
    assert done["ok"] and "NOT checked" in done["services_checked"][0]  # said, not assumed
