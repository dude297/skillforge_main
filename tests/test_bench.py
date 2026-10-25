"""Matcher, trust boundary (service/client/docker runner), metrics adapter and the three-mode harness."""
import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import HTTPServer

import pytest

from adapters import metrics
from app import bench, db, server, skillforge as sf, tools

ROOT = db.ROOT


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(sf, "BENCH", {"sizes": (1, 8), "trials": 2, "repeats": 5})
    c = db.connect()
    bench.learn(c, bench.MockAgent())  # approved line-total-reconcile@v1 learned on scenario A
    return c


# --- deterministic matcher ------------------------------------------------------------

@pytest.mark.parametrize("scenario,decision,level", [
    ("learn_b.json", "skill", "exact"),
    ("boundary.json", "skill", "exact"),
    ("lookalike.json", "agent", "uncertain"),  # same shape, different kind/source/invariants
    ("unrelated.json", "agent", "none"),
    ("malformed.json", "agent", "none"),
])
def test_matcher_routes(conn, scenario, decision, level):
    db.load_scenario(conn, bench.LEARN / scenario)
    m = sf.match_skills(conn)
    assert m["decision"] == decision and m["candidates"][0]["match"] == level


def test_lookalike_is_refused_on_every_path(conn):
    db.load_scenario(conn, bench.LEARN / "lookalike.json")
    assert sf._shape_key(sf.dataset(conn)) == conn.execute("SELECT input_shape FROM skills").fetchone()[0]
    assert tools.call(conn, "search_skills", {})["skills"][0]["compatible"] is False
    r = tools.call(conn, "run_skill", {"name": bench.SKILL_NAME, "propose": True})
    assert r["error"]["code"] == "uncertain_match"
    assert conn.execute("SELECT COUNT(*) FROM actions").fetchone()[0] == 0  # no state change, nothing proposed


def test_ambiguous_or_unwritable_or_unsigned_goes_to_agent(conn):
    db.load_scenario(conn, bench.LEARN / "learn_b.json")
    conn.execute("INSERT INTO skills (name, version, description, tags, status, active, input_shape, sha256, validation, "
                 "signature, touches) SELECT 'twin', 1, description, tags, status, 1, input_shape, sha256, validation, "
                 "signature, touches FROM skills WHERE name=?", (bench.SKILL_NAME,))
    assert sf.match_skills(conn)["why"].startswith("ambiguous")
    conn.execute("DELETE FROM skills WHERE name='twin'")
    conn.execute("UPDATE skills SET touches='[\"secret_field\"]'")
    m = sf.match_skills(conn)
    assert m["decision"] == "agent" and "not writable" in m["candidates"][0]["reasons"][-1]
    conn.execute("UPDATE skills SET touches='[\"total\"]', signature=NULL")
    assert sf.match_skills(conn)["candidates"][0]["match"] == "uncertain"


def test_fingerprint_normalizes_only_free_text():
    a = sf.stable_fingerprint({"exc": "KeyError", "msg": "missing key at 0x7f3a for user 1234"}, free_text={"msg"})
    b = sf.stable_fingerprint({"exc": "KeyError", "msg": "Missing  key at 0xdeadbeef for user 99"}, free_text={"msg"})
    c = sf.stable_fingerprint({"exc": "ValueError", "msg": "missing key at 0x7f3a for user 1234"}, free_text={"msg"})
    assert a == b and a != c
    assert sf.stable_fingerprint({"service": "api-v1"}) != sf.stable_fingerprint({"service": "api-v2"})  # ids keep digits


# --- trust boundary: service + client ----------------------------------------------------

def test_service_rejects_host_paths_traversal_and_privileged_tools(conn):
    h = lambda body: server.handle(conn, body)
    assert h({"tool": "propose_skill", "args": {"name": "x", "description": "x", "path": "/etc"}})["error"]["code"] == "invalid_input"
    for bad in ({"../../etc/passwd": "x"}, {"scripts/../x.py": "x"}, {"run.sh": "x"}):
        assert h({"tool": "propose_skill", "args": {"name": "abc", "description": "x"}, "files": bad})["error"]["code"] == "invalid_input"
    assert h({"tool": "read_records", "args": {}, "files": {"SKILL.md": "x"}})["error"]["code"] == "invalid_input"
    for privileged in ("decide_approval", "approve_skill", "rollback_skill", "hidden_check", "load_scenario"):
        assert h({"tool": privileged, "args": {}})["error"]["code"] == "unknown_tool"


def test_remote_client_round_trip_and_auth(conn, tmp_path):
    srv = HTTPServer(("127.0.0.1", 0), server.Handler)
    srv.token = "t0k"
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_port}/call"
    client = str(ROOT / "adapters" / "openclaw" / "client.py")
    run = lambda tok, *a: subprocess.run([sys.executable, client, *a], capture_output=True, text=True, cwd=tmp_path,
                                         env={**os.environ, "APP_REMOTE": url, "APP_TOKEN": tok})
    db.load_scenario(conn, bench.LEARN / "learn_b.json")
    ok = run("t0k", "search_skills", "{}")
    assert ok.returncode == 0 and json.loads(ok.stdout)["skills"][0]["compatible"] is True
    bad = run("nope", "read_records", "{}")
    assert bad.returncode == 2 and json.loads(bad.stdout)["error"]["code"] == "unauthorized"
    srv.shutdown()


def test_remote_package_ships_no_trusted_code(tmp_path):
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash not available")
    r = subprocess.run([bash, "scripts/package_skill.sh"], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "APP_REMOTE": "http://10.0.0.1:8765/call"})
    assert r.returncode == 0, r.stderr
    files = sorted(p.name for p in (ROOT / "dist" / "records-ops").rglob("*") if p.is_file())
    shutil.rmtree(ROOT / "dist")
    assert files == ["SKILL.md", "client.json", "client.py"]


# --- docker runner (strong isolation for host-side execution) ----------------------------

def _docker_ready():
    if not shutil.which("docker"):
        return False
    r = subprocess.run(["docker", "image", "inspect", os.environ.get("SKILL_RUNNER_IMAGE", "python:3.12-slim")],
                       capture_output=True)
    return r.returncode == 0


@pytest.mark.skipif(not _docker_ready(), reason="docker or python:3.12-slim image not available")
def test_docker_runner_isolation(tmp_path, monkeypatch):
    monkeypatch.setenv("SKILL_RUNNER", "docker")
    d = tmp_path / "s"
    shutil.copytree(bench.FIXTURE, d)
    data = {"records": [{"id": "X", "kind": "k", "data": {"total": 45.0}}],
            "evidence": [{"record_id": "X", "source": "s", "trusted": True, "data": {"lines": [2000, 2400], "scale": 100}}]}
    assert sf.sandbox("run", d, data)["output"]["proposals"][0]["value"] == 44.0
    host_file = str(ROOT / "README.md")
    (d / "scripts" / "helper.py").write_text(
        "import os, socket\n"
        "def run(d):\n"
        "    out = {'host_file_visible': os.path.exists(%r), 'uid': os.getuid()}\n"
        "    try:\n"
        "        socket.getaddrinfo('example.com', 80); out['dns'] = True\n"
        "    except Exception:\n"
        "        out['dns'] = False\n"
        "    return out\n" % host_file)
    out = sf.sandbox("run", d, {})["output"]
    assert out == {"host_file_visible": False, "uid": 65534, "dns": False}


# --- metrics adapter -----------------------------------------------------------------------

def test_metrics_parse_and_delta_keep_unknowns():
    text = ('vllm:request_success_total{finished_reason="stop"} 10\nvllm:request_success_total{finished_reason="length"} 2\n'
            "vllm:prompt_tokens_total 1000\nvllm:time_to_first_token_seconds_sum 3.0\n"
            "vllm:time_to_first_token_seconds_count 12\nvllm:request_success_created 99\n")
    a = metrics.parse(text)
    assert a["requests"] == 12 and a["prompt_tokens"] == 1000 and a["generation_tokens"] is None
    b = metrics.parse(text.replace(" 10\n", " 14\n").replace("1000", "1800").replace("3.0", "5.0").replace(" 12\n", " 16\n"))
    d = metrics.delta(a, b)
    assert (d["requests"], d["prompt_tokens"], d["mean_ttft_s"]) == (4, 800, 0.5)
    assert d["generation_tokens"] is None and d["inference_s"] is None  # absent stays unknown, not 0
    assert metrics.delta(None, b)["requests"] is None


# --- correctness fixes found by the harness --------------------------------------------------

def test_same_fix_can_be_reproposed_after_drift(conn):
    db.load_scenario(conn, bench.LEARN / "learn_b.json")
    args = {"record_id": "LOT-18", "action_type": "set_field", "params": {"field": "total", "value": 6.25}, "reason": "r"}
    a1 = tools.call(conn, "propose_action", args)
    assert tools.call(conn, "propose_action", args)["deduplicated"] is True  # same state -> same action
    tools.call(conn, "request_approval", {"action_id": a1["action"]["id"]})
    tools.decide_approval(conn, a1["action"]["id"], True, "alice")
    tools.call(conn, "execute_action", {"action_id": a1["action"]["id"]})
    conn.execute("UPDATE records SET data=json_set(data, '$.total', 7.25) WHERE id='LOT-18'")  # drift
    again = tools.call(conn, "propose_action", args)
    assert again["deduplicated"] is False and again["action"]["id"] != a1["action"]["id"]


def test_malformed_evidence_is_unverifiable_not_a_crash(conn):
    db.load_scenario(conn, bench.LEARN / "malformed.json")
    v = {x["record_id"]: x for x in tools.invariant_violations(conn)}
    assert v["MF-3"].get("unverifiable") and "MF-2" not in v


# --- harness ----------------------------------------------------------------------------------

def test_three_modes_mock_end_to_end(tmp_path):
    res = bench.run(trials=1, agent=bench.MockAgent(), db_path=tmp_path / "b.db", skills_dir=tmp_path / "sk")
    rows = {(r["case"], r["mode"]): r for r in res["summary"]}
    for case in bench.CASES:
        for mode in "ABC":
            r = rows[(case, mode)]
            assert r["model_calls"] is None  # mock: unknown, never 0
            if case != "skill_fails_verification" or mode == "C":
                assert r["correct"] == "1/1", (case, mode)
    assert rows[("unseen_compatible", "C")]["decision"] == "skill" and rows[("unseen_compatible", "C")]["fallback"] == 0
    assert rows[("unseen_compatible", "B")]["decision"] == "skill" and rows[("unseen_compatible", "A")]["decision"] == "agent"
    for case in ("incompatible", "malformed", "lookalike_fingerprint", "skill_unavailable", "skill_disabled"):
        assert rows[(case, "C")]["decision"] == "agent" and rows[(case, "C")]["fallback"] == 1
    assert rows[("skill_fails_verification", "C")]["decision"] == "skill_failed_verification"
    assert rows[("unseen_compatible", "C")]["tool_calls"] < rows[("unseen_compatible", "A")]["tool_calls"]
    assert res["learning"]["autonomous"] is False and res["learning"]["approved"]


@pytest.mark.parametrize("L,a,r,p,expect", [
    (100.0, 10.0, 1.0, 0.9, 13),   # gain 8/reuse -> ceil(100/8)
    (100.0, 1.0, 2.0, 1.0, "never (reuse is not cheaper)"),
    (None, 10.0, 1.0, 1.0, "pending (unmeasured input)"),
])
def test_breakeven_formula(L, a, r, p, expect):
    rows = [{"case": "unseen_compatible", "mode": "A", "automated_s": a, "model_calls": a, "correct": True, "decision": "agent"}]
    ok = int(p * 10)
    rows += [{"case": "unseen_compatible", "mode": "C", "automated_s": r, "model_calls": r, "correct": True,
              "decision": "skill" if i < ok else "agent"} for i in range(10)]
    res = bench.breakeven({"phases": {"x": L} if L is not None else {}, "model_calls": L}, rows)
    assert res["model_calls"]["n_star"] == expect


# --- GB10 readiness: least privilege + resource limits actually bite --------------------------

def test_token_scope_allowlist_only_removes(conn, monkeypatch):
    db.load_scenario(conn, bench.LEARN / "learn_b.json")
    monkeypatch.setenv("APP_AGENT_TOOLS", "read_records,investigate,decide_approval")  # privileged name is ignored
    assert server.allowed_tools() == {"read_records", "investigate"}
    assert server.handle(conn, {"tool": "read_records", "args": {}})["ok"]
    for t in ("propose_skill", "run_skill", "decide_approval"):
        assert server.handle(conn, {"tool": t, "args": {}})["error"]["code"] == "unknown_tool"


def test_service_refuses_wildcard_bind():
    with pytest.raises(SystemExit):
        server.serve("0.0.0.0", 0)


@pytest.mark.skipif(os.name != "posix", reason="rlimits are POSIX-only")
def test_posix_rlimit_stops_memory_hog(tmp_path):
    d = tmp_path / "s"
    shutil.copytree(bench.FIXTURE, d)
    (d / "scripts" / "helper.py").write_text("def run(d):\n    x = bytearray(2 * 1024 ** 3)\n    return {'proposals': []}\n")
    r = sf.sandbox("run", d, {})
    assert r["ok"] is False and "MemoryError" in r["error"]


@pytest.mark.skipif(not _docker_ready(), reason="docker or python:3.12-slim image not available")
def test_docker_memory_limit_kills_hog(tmp_path, monkeypatch):
    monkeypatch.setenv("SKILL_RUNNER", "docker")
    d = tmp_path / "s"
    shutil.copytree(bench.FIXTURE, d)
    (d / "scripts" / "helper.py").write_text(
        "def run(d):\n    x = bytearray(800 * 1024 ** 2)\n    return {'proposals': []}\n")  # > 512m but < 512m + swap
    r = sf.sandbox("run", d, {}, timeout=60)
    assert r["ok"] is False


def test_docker_runner_command_keeps_every_isolation_flag(tmp_path, monkeypatch):
    """Guards the flag list itself (a dropped flag would not make the functional tests fail)."""
    monkeypatch.setenv("SKILL_RUNNER", "docker")
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout='{"ok": true, "output": {"proposals": []}}', stderr="")

    monkeypatch.setattr(sf.subprocess, "run", fake_run)
    d = tmp_path / "s"
    shutil.copytree(bench.FIXTURE, d)
    sf.sandbox("run", d, {})
    cmd = " ".join(seen["cmd"])
    for flag in ("--network none", "--read-only", "--memory 512m", "--memory-swap 512m", "--cpus 1",
                 "--pids-limit 64", "--cap-drop ALL", "--security-opt no-new-privileges", "--user 65534:65534", "--rm"):
        assert flag in cmd, flag
    assert ":/w:ro" in cmd and cmd.count(" -v ") == 1  # exactly one mount, read-only


@pytest.mark.skipif(not _docker_ready(), reason="docker or python:3.12-slim image not available")
def test_docker_runner_caps_and_pids_enforced(tmp_path, monkeypatch):
    monkeypatch.setenv("SKILL_RUNNER", "docker")
    d = tmp_path / "s"
    shutil.copytree(bench.FIXTURE, d)
    (d / "scripts" / "helper.py").write_text(
        "import threading, time\n"
        "def run(d):\n"
        "    cap = [l.split()[1] for l in open('/proc/self/status') if l.startswith('CapEff')][0]\n"
        "    n = 0\n"
        "    try:\n"
        "        for _ in range(200):\n"
        "            threading.Thread(target=time.sleep, args=(5,), daemon=True).start(); n += 1\n"
        "    except RuntimeError:\n"
        "        pass\n"
        "    return {'cap_eff': cap, 'threads_started': n}\n")
    out = sf.sandbox("run", d, {}, timeout=60)["output"]
    assert out["cap_eff"] == "0000000000000000" and out["threads_started"] < 64
