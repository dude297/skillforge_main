"""Read-only operator API (app/ui_api.py): auth, method/host/ID/query validation, size caps, no writes, and no data
the console must never show (hidden-validation cases, approval notes, full record snapshots, tokens, API keys)."""
import hashlib
import http.client as hc
import json
import threading

import pytest

from adapters import models
from app import bench, db, skillforge as sf, tools, ui_api

TOKEN = "op-token-for-tests-0123456789-abcdefghij"
LEARN = db.ROOT / "data" / "learning"


@pytest.fixture
def world(tmp_path, monkeypatch):
    """A real DB after a MOCK learn (approved skill with hidden validation) plus a pending approval with a note."""
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("APP_OPERATOR_TOKEN", TOKEN)
    monkeypatch.setenv("LLM_API_KEY", "sk-llm-key-must-never-leak")
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(models, "PROBE_FILE", tmp_path / "probe.json")
    monkeypatch.setattr(ui_api, "RESULTS", tmp_path / "results")
    monkeypatch.setattr(ui_api, "_status_cache", {"at": 0.0, "value": None})
    c = db.connect()
    db.load_scenario(c)
    bench.learn(c, bench.MockAgent())
    db.load_scenario(c, LEARN / "learn_b.json")
    sf.task_begin(c, "reuse", "mock")
    run = tools.call(c, "run_skill", {"name": "line-total-reconcile", "propose": True})
    first = run["actions"][0]["id"]
    tools.decide_approval(c, first, True, "alice", note="PRIVATE-NOTE-xyz")
    tools.call(c, "execute_action", {"action_id": first})
    tools.call(c, "verify_action", {"action_id": first})
    # a marker in the hidden-validation record: it must never appear in any response
    c.execute("UPDATE skills SET hidden_validation=json_set(hidden_validation, '$.cases', json('[{\"name\":\"HIDDEN-CASE-marker\",\"ok\":true}]'))")
    return c


@pytest.fixture
def api(world):
    srv = ui_api.make_server(port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_port

    def req(path, method="GET", headers=None, auth=True, body=None):
        h = {"Host": f"127.0.0.1:{port}", **({"Authorization": f"Bearer {TOKEN}"} if auth else {}), **(headers or {})}
        c = hc.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        try:
            return r.status, json.loads(data), r
        except json.JSONDecodeError:
            return r.status, data, r
    req.port = port
    yield req
    srv.shutdown()
    srv.server_close()


def db_digest():
    import os
    from pathlib import Path
    p = Path(os.environ["APP_DB"])
    return hashlib.sha256(p.read_bytes()).hexdigest()


ENDPOINTS = ["/ui/status", "/ui/tasks", "/ui/tasks/1", "/ui/tasks/2", "/ui/events?after=0&limit=500", "/ui/approvals",
             "/ui/actions/1", "/ui/skills", "/ui/skills/line-total-reconcile/1"]


def test_every_endpoint_answers_and_needs_the_operator_token(api):
    for ep in ENDPOINTS:
        code, body, _ = api(ep)
        assert code == 200 and body["ok"], (ep, body)
        assert api(ep, auth=False)[0] == 401
        assert api(ep, auth=False, headers={"Authorization": "Bearer wrong"})[0] == 401
        assert api(ep, auth=False, headers={"Cookie": f"{ui_api.COOKIE}=wrong"})[0] == 401
    session = ui_api.new_session(TOKEN)
    assert api("/ui/tasks", auth=False, headers={"Cookie": f"other=1; {ui_api.COOKIE}={session}"})[0] == 200
    # the raw token is never a session (it would make the cookie a permanent credential)
    assert api("/ui/tasks", auth=False, headers={"Cookie": f"{ui_api.COOKIE}={TOKEN}"})[0] == 401
    assert api("/ui/health", auth=False)[0] == 200  # says only "this is the API"


def test_agent_token_is_not_an_operator_token(api, monkeypatch):
    monkeypatch.setenv("APP_TOKEN", "agent-token-abcdefgh")
    assert api("/ui/tasks", auth=False, headers={"Authorization": "Bearer agent-token-abcdefgh"})[0] == 401


def test_write_methods_are_refused_everywhere(api):
    for m in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
        for ep in ("/ui/approvals", "/ui/actions/2", "/ui/skills/line-total-reconcile/1", "/"):
            code, body, r = api(ep, method=m, body=b'{"approve": true}')
            assert code == 405 and r.getheader("Allow") == "GET", (m, ep)


def _path(link):
    return "/" + link.split("/", 3)[3]  # "/auth?code=..." from "http://127.0.0.1:<port>/auth?code=..."


def test_login_link_works_once_and_sets_a_signed_session(api):
    link = _path(ui_api.login_link(8766, TOKEN))
    assert TOKEN not in link  # the permanent token never appears in a URL
    code, _, r = api(link, auth=False)
    assert code == 303 and r.getheader("Location").startswith("/#/console") and r.getheader("Cache-Control") == "no-store"
    cookie = r.getheader("Set-Cookie")
    assert "HttpOnly" in cookie and "SameSite=Strict" in cookie and TOKEN not in cookie
    session = cookie.split(";")[0].split("=", 1)[1]
    assert api("/ui/tasks", auth=False, headers={"Cookie": f"{ui_api.COOKIE}={session}"})[0] == 200
    code, body, r = api(link, auth=False)  # reused
    assert code == 401 and "already used" in body["error"]["message"] and r.getheader("Cache-Control") == "no-store"


def test_expired_forged_and_legacy_login_links_are_refused(api):
    old = _path(ui_api.login_link(8766, TOKEN, now=__import__("time").time() - ui_api.LOGIN_TTL_S - 5))
    assert "expired" in api(old, auth=False)[1]["error"]["message"]
    forged = _path(ui_api.login_link(8766, "some-other-token-of-sufficient-length-xx"))
    assert "invalid" in api(forged, auth=False)[1]["error"]["message"]
    for bad in ("/auth?code=", "/auth?code=a.b", "/auth?code=x.y.z", f"/auth?token={TOKEN}", "/auth?code=1.%C3%A9.%C3%A9"):
        assert api(bad, auth=False)[0] == 401, bad


def test_sessions_are_signed_expiring_and_survive_a_restart(api):
    import time
    assert ui_api.session_ok(TOKEN, ui_api.new_session(TOKEN))  # stateless: a new server process accepts it
    assert not ui_api.session_ok(TOKEN, ui_api.new_session("another-token-of-sufficient-length-xxxx"))
    assert not ui_api.session_ok(TOKEN, ui_api.new_session(TOKEN, now=time.time() - ui_api.SESSION_TTL_S - 5))
    for junk in ("", "a.b", "1.2.3", "x" * 5000):
        assert not ui_api.session_ok(TOKEN, junk)


def test_non_ascii_credentials_are_a_401_not_a_crash(api):
    for h in ({"Cookie": f"{ui_api.COOKIE}=café"}, {"Authorization": "Bearer café"}):
        code, body, _ = api("/ui/tasks", auth=False, headers={k: v.encode("utf-8").decode("latin-1") for k, v in h.items()})
        assert code == 401, h


def test_short_operator_tokens_are_refused(monkeypatch):
    monkeypatch.setenv("APP_OPERATOR_TOKEN", "short-token")
    with pytest.raises(SystemExit):
        ui_api.token()


def test_duplicate_host_and_absolute_targets_are_refused(api):
    import socket
    port = api.port
    for raw in (f"GET /ui/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nHost: evil.example\r\n\r\n",
                f"GET http://evil.example/ui/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n",
                "GET /ui/health HTTP/1.1\r\n\r\n"):
        with socket.create_connection(("127.0.0.1", port), timeout=5) as c:
            c.sendall(raw.encode())
            assert c.recv(64).split(b" ")[1] == b"403", raw


def test_dns_rebinding_host_is_refused(api):
    assert api("/ui/tasks", headers={"Host": "attacker.example:8766"})[0] == 403
    assert api("/", headers={"Host": "attacker.example"})[0] == 403


def test_invalid_ids_and_malformed_queries(api):
    for ep in ("/ui/tasks/abc", "/ui/tasks/-1", "/ui/tasks/1;DROP", "/ui/tasks/9999999999999", "/ui/skills/BAD/1",
               "/ui/skills/line-total-reconcile/x", "/ui/skills/../../etc/1", "/ui/nope", "/ui/tasks/1/extra"):
        assert api(ep)[0] == 404, ep
    assert api("/ui/tasks/424242")[1]["error"]["code"] == "not_found"
    for q in ("limit=abc", "limit=-1", "limit=1e3", "after=0x10", "limit=" + "9" * 30):
        assert api(f"/ui/events?{q}")[0] == 400, q
    code, body, _ = api("/ui/tasks?limit=999999")  # clamped, not refused
    assert code == 200 and len(body["tasks"]) <= 200


def test_static_files_cannot_escape_the_bundle(api, tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>x</title>")
    monkeypatch.setattr(ui_api, "DIST", dist)
    code, body, r = api("/", auth=False)
    assert code == 200 and b"<title>x" in body and "frame-ancestors 'none'" in r.getheader("Content-Security-Policy")
    for ep in ("/../t.db", "/%2e%2e/t.db", "/assets/../../t.db", "/assets", "//etc/passwd"):
        assert api(ep, auth=False)[0] == 404, ep


def test_oversized_responses_are_refused(api, monkeypatch):
    monkeypatch.setattr(ui_api, "MAX_RESP", 200)
    code, body, _ = api("/ui/events?after=0&limit=500")
    assert code == 413 and body["error"]["code"] == "response_too_large"


def test_nothing_secret_or_oracle_leaves_the_api(api, world):
    blob = ""
    for ep in ENDPOINTS:
        blob += json.dumps(api(ep)[1])
    for forbidden in ("HIDDEN-CASE-marker", "PRIVATE-NOTE-xyz", "sk-llm-key-must-never-leak", TOKEN, "input_snapshot",
                      "hidden_validation", "args_hash", "metrics_start"):
        assert forbidden not in blob, forbidden
    skill = api("/ui/skills/line-total-reconcile/1")[1]
    assert skill["skill"]["hidden_ok"] is True and set(skill["files"]) <= {"SKILL.md", "scripts/helper.py", "tests/test_helper.py"}
    # execute events carry only the changed fields, never the whole record
    ev = [e for e in api("/ui/events?after=0&limit=500")[1]["events"] if e["event"] == "execute_action"]
    assert ev and all(set(e["payload"]) == {"action_id", "changed"} for e in ev)
    assert all(set(e["payload"]["changed"]) == {"total"} for e in ev)


def test_secret_values_are_redacted_even_if_a_row_contains_them(api, world):
    db.audit(world, "agent", "custom_event", {"x": 1})
    world.execute("UPDATE tasks SET label=? WHERE id=1", (f"oops {TOKEN} sk-llm-key-must-never-leak",))
    text = json.dumps(api("/ui/tasks")[1])
    assert TOKEN not in text and "sk-llm-key-must-never-leak" not in text and "[redacted]" in text
    unknown = [e for e in api("/ui/events?after=0&limit=500")[1]["events"] if e["event"] == "custom_event"]
    assert unknown and unknown[0]["payload"] == {}  # unknown events are listed, their payload is not


def test_the_api_never_writes(api, world):
    world.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    before = db_digest()
    for _ in range(3):
        for ep in ENDPOINTS:
            api(ep)
    world.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    assert db_digest() == before
    ro = ui_api.ro_connect()
    with pytest.raises(Exception):
        ro.execute("UPDATE actions SET status='approved'")
    ro.close()


def test_projection_reflects_authoritative_state(api, world):
    tasks = api("/ui/tasks")[1]["tasks"]
    assert [t["id"] for t in tasks] == sorted((t["id"] for t in tasks), reverse=True)
    reuse = tasks[0]
    detail = api(f"/ui/tasks/{reuse['id']}")[1]
    assert detail["events"][0]["event"] == "task_begin" and detail["events_complete"]
    ids = [e["id"] for e in detail["events"]]
    assert ids == sorted(ids) and len(ids) == len(set(ids))
    states = {a["id"]: a["state"] for a in detail["actions"]}
    assert "COMPLETED" in states.values() and "WAITING_APPROVAL" in states.values()
    pend = api("/ui/approvals")[1]["pending"]
    assert {a["id"] for a in pend} == {i for i, s in states.items() if s == "WAITING_APPROVAL"}
    done = next(a for a in detail["actions"] if a["state"] == "COMPLETED")
    assert done["verifications"][-1]["passed"] and done["approval"]["decided_by"] == "alice"
    assert "note" not in done["approval"]


def test_events_are_incremental(api):
    allv = api("/ui/events?after=0&limit=500")[1]
    last = allv["last_id"]
    assert allv["events"][-1]["id"] == last
    assert api(f"/ui/events?after={last}")[1]["events"] == []
    two = api("/ui/events?after=0&limit=2")[1]["events"]
    assert [e["id"] for e in two] == [e["id"] for e in allv["events"][:2]]


def test_missing_db_and_bench_are_explicit(api, monkeypatch, tmp_path):
    assert api("/ui/bench/latest")[1]["error"]["code"] == "no_results"
    out = tmp_path / "results" / "x"
    out.mkdir(parents=True)
    (out / "result.json").write_text(json.dumps({"real_model": False, "agent": "mock", "trials": 1, "summary": [],
                                                 "db": "/secret/path.db", "rows": [{"big": 1}]}))
    b = api("/ui/bench/latest")[1]
    assert b["ok"] and b["result"]["real_model"] is False and "db" not in b["result"] and "rows" not in b["result"]
    monkeypatch.setenv("APP_DB", str(tmp_path / "missing.db"))
    code, body, _ = api("/ui/tasks")
    assert code == 503 and body["error"]["code"] == "no_database"


def test_refuses_non_loopback_bind():
    with pytest.raises(SystemExit):
        ui_api.make_server("0.0.0.0", 0)


def test_a_browser_burst_is_queued_while_the_accept_loop_stalls(monkeypatch):
    """Live e2e saw ERR_CONNECTION_REFUSED mid-run: with the default backlog of 5, Windows RSTs the 6th connection while
    the accept loop is briefly busy. Bound and listening, serve_forever not running = a stalled accept loop."""
    import socket
    monkeypatch.setenv("APP_OPERATOR_TOKEN", "x" * 40)
    srv = ui_api.make_server("127.0.0.1", 0)
    socks = []
    try:
        for _ in range(20):  # a reload (~6 connections) plus API polls, with margin
            s = socket.create_connection(("127.0.0.1", srv.server_port), timeout=2)
            socks.append(s)
    finally:
        for s in socks:
            s.close()
        srv.server_close()
    assert len(socks) == 20


def test_secrets_cut_by_truncation_and_spoofing_characters_never_reach_the_console(api, world):
    reason = "x" * 230 + "sk-llm-key-must-never-leak"  # the secret straddles the clip boundary
    world.execute("UPDATE actions SET reason=? WHERE id=(SELECT MIN(id) FROM actions)", (reason,))
    world.execute("UPDATE tasks SET label=? WHERE id=1", ("ok\u202eevil\x07\x1b[31m",))
    text = json.dumps([api("/ui/tasks/2")[1], api("/ui/tasks")[1]])
    assert "sk-llm" not in text and "[redacted]" in text
    label = api("/ui/tasks/1")[1]["task"]["label"]
    assert label == "okevil[31m"


def test_non_dict_params_are_not_echoed(api, world):
    db.audit(world, "agent", "propose_action", {"action_id": 99, "record_id": "R", "params": "RAW-ARGS-marker"})
    ev = [e for e in api("/ui/events?after=0&limit=500")[1]["events"] if e["payload"].get("action_id") == 99]
    assert ev and "params" not in ev[0]["payload"] and "RAW-ARGS-marker" not in json.dumps(ev)


def test_events_anchor_reveals_a_replaced_database(api, world):
    allv = api("/ui/events?after=0&limit=500")[1]
    last = allv["events"][-1]
    a = api(f"/ui/events?after={last['id']}")[1]["anchor"]
    assert a == {"id": last["id"], "ts": last["ts"], "event": last["event"]}
    world.execute("UPDATE audit SET event='something_else' WHERE id=?", (last["id"],))  # what a restore looks like
    assert api(f"/ui/events?after={last['id']}")[1]["anchor"]["event"] != last["event"]
    assert api("/ui/events?after=999999")[1]["anchor"] is None


def test_task_detail_reports_truncation(api, world, monkeypatch):
    monkeypatch.setattr(ui_api, "MAX_LIMIT", 3)
    d = api("/ui/tasks/1")[1]
    assert len(d["events"]) == 3 and d["events_truncated"] and not d["events_complete"]


def test_slow_status_never_blocks_readers(api, monkeypatch):
    first = api("/ui/status")[1]
    monkeypatch.setattr(ui_api, "_status_cache", {"at": 0.0, "value": first})  # stale cache
    assert ui_api._status_lock.acquire(blocking=False)  # someone is recomputing (e.g. nemoclaw taking 30 s)
    try:
        t0 = __import__("time").time()
        code, body, _ = api("/ui/status")
        assert code == 200 and body == first and __import__("time").time() - t0 < 2
    finally:
        ui_api._status_lock.release()


def test_approve_expect_binds_the_command_to_the_reviewed_change(world, monkeypatch, capsys):
    from app.__main__ import main
    pend = tools.pending_approvals(world)["pending"]
    a, b = pend[0], pend[1]
    fp = ui_api.fingerprint(a["record_id"], json.dumps(a["params"]))
    other = ui_api.fingerprint(b["record_id"], json.dumps(b["params"]))
    assert main(["approve", str(a["id"]), "--by", "carol", "--expect", other]) == 2  # wrong change: refused
    assert "fingerprint_mismatch" in capsys.readouterr().out
    assert main(["approve", str(a["id"]), str(b["id"]), "--by", "carol", "--expect", fp]) == 2  # one per id
    assert {x["id"] for x in tools.pending_approvals(world)["pending"]} >= {a["id"], b["id"]}  # nothing approved
    main(["approve", str(a["id"]), "--by", "carol", "--expect", fp])
    assert a["id"] not in {x["id"] for x in tools.pending_approvals(world)["pending"]}


def test_api_fingerprint_matches_the_cli(api, world):
    pend = api("/ui/approvals")[1]["pending"]
    row = world.execute("SELECT record_id, params FROM actions WHERE id=?", (pend[0]["id"],)).fetchone()
    from app.__main__ import action_fingerprint
    assert pend[0]["fingerprint"] == action_fingerprint(row["record_id"], row["params"])


def test_rehearsal_refuses_to_wipe_a_database_it_does_not_own(tmp_path):
    import subprocess, sys
    victim = tmp_path / "app.db"
    victim.write_bytes(b"precious")
    p = subprocess.run([sys.executable, "scripts/rehearse.py", "--db", str(victim), "--pace", "0"], cwd=db.ROOT,
                       capture_output=True, text=True, timeout=60)
    assert p.returncode != 0 and "refusing to delete" in (p.stdout + p.stderr) and victim.read_bytes() == b"precious"
