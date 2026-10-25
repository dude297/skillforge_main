import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from adapters import llm
from app import db, tools
from app.__main__ import doctor, main, run_demo


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    c = db.connect()
    db.load_scenario(c)
    return c


def approved_action(conn, value=100):
    a = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                            "params": {"field": "quantity", "value": value}, "reason": "match trusted sources"})
    aid = a["action"]["id"]
    tools.call(conn, "request_approval", {"action_id": aid})
    tools.decide_approval(conn, aid, True, "alice")
    return aid


def qty(conn, rid="REC-001"):
    return tools.read_records(conn, rid)["records"][0]["data"]["quantity"]


# --- basic tool calls / invalid input ---

def test_read_and_investigate(conn):
    assert len(tools.call(conn, "read_records", {})["records"]) == 3
    f = {r: tools.call(conn, "investigate", {"record_id": r})["findings"] for r in ("REC-001", "REC-002", "REC-003")}
    assert f["REC-001"][0]["status"] == "mismatch" and f["REC-001"][0]["expected"] == 100
    assert f["REC-002"] == []
    assert f["REC-003"][0]["status"] == "conflicting_sources"


@pytest.mark.parametrize("name,args,code", [
    ("nope", {}, "unknown_tool"),
    ("investigate", [], "invalid_input"),
    ("investigate", {}, "invalid_input"),
    ("investigate", {"record_id": 5}, "invalid_input"),
    ("investigate", {"record_id": "REC-999"}, "not_found"),
    ("execute_action", {"action_id": "1"}, "invalid_input"),
    ("propose_action", {"record_id": "REC-001", "action_type": "delete_all", "params": {}, "reason": "x"}, "policy_violation"),
    ("propose_action", {"record_id": "REC-001", "action_type": "set_field", "params": {"field": "label", "value": "x"}, "reason": "x"}, "policy_violation"),
    ("propose_action", {"record_id": "REC-001", "action_type": "set_field", "params": {"field": "quantity", "value": 500}, "reason": "x"}, "policy_violation"),
    ("propose_action", {"record_id": "REC-001", "action_type": "set_field", "params": {"field": "quantity", "value": "100"}, "reason": "x"}, "invalid_input"),
    ("propose_action", {"record_id": "REC-001", "action_type": "set_field", "params": {"field": "status", "value": "gone"}, "reason": "x"}, "policy_violation"),
    ("propose_action", {"record_id": "REC-001", "action_type": "set_field", "params": {"field": "quantity", "value": 100}, "reason": ""}, "invalid_input"),
])
def test_invalid_inputs_return_structured_errors(conn, name, args, code):
    res = tools.call(conn, name, args)
    assert res["ok"] is False and res["error"]["code"] == code


def test_cli_bad_json_exit_code(conn, capsys):
    assert main(["call", "investigate", "{not json"]) == 2
    assert json.loads(capsys.readouterr().out)["error"]["code"] == "invalid_input"


# --- persistence ---

def test_state_persists_across_connections(conn):
    aid = approved_action(conn)
    tools.call(conn, "execute_action", {"action_id": aid})
    conn.close()
    fresh = db.connect()
    assert qty(fresh) == 100
    assert tools._action(fresh, aid)["status"] == "executed"
    assert [e["event"] for e in tools.get_audit(fresh)["events"]][-1] == "execute_action"


# --- approval enforcement ---

def test_execute_refused_without_approval(conn):
    aid = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                              "params": {"field": "quantity", "value": 100}, "reason": "r"})["action"]["id"]
    assert tools.call(conn, "execute_action", {"action_id": aid})["error"]["code"] == "not_approved"
    tools.call(conn, "request_approval", {"action_id": aid})
    assert tools.call(conn, "execute_action", {"action_id": aid})["error"]["code"] == "not_approved"
    assert qty(conn) == 120


def test_rejected_action_never_executes(conn):
    aid = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                              "params": {"field": "quantity", "value": 100}, "reason": "r"})["action"]["id"]
    tools.call(conn, "request_approval", {"action_id": aid})
    tools.decide_approval(conn, aid, False, "bob", "not convinced")
    assert tools.call(conn, "execute_action", {"action_id": aid})["error"]["code"] == "not_approved"
    with pytest.raises(tools.ToolError):  # decision is final
        tools.decide_approval(conn, aid, True, "bob")
    assert qty(conn) == 120


def test_agent_cannot_approve(conn):
    assert "decide_approval" not in tools.agent_tools()
    assert tools.call(conn, "decide_approval", {"action_id": 1, "approve": True, "approver": "x"})["error"]["code"] == "unknown_tool"
    aid = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                              "params": {"field": "quantity", "value": 100}, "reason": "r"})["action"]["id"]
    tools.call(conn, "request_approval", {"action_id": aid})
    for who in ("agent", " ", "system"):
        with pytest.raises(tools.ToolError):
            tools.decide_approval(conn, aid, True, who)


def test_authorized_action_executes(conn):
    aid = approved_action(conn)
    res = tools.call(conn, "execute_action", {"action_id": aid})
    assert res["ok"] and res["before"]["quantity"] == 120 and res["after"]["quantity"] == 100
    assert qty(conn) == 100


# --- idempotency ---

def test_duplicate_proposal_and_execution_prevented(conn):
    aid = approved_action(conn)
    again = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                                "params": {"field": "quantity", "value": 100}, "reason": "dup"})
    assert again["deduplicated"] and again["action"]["id"] == aid
    first = tools.call(conn, "execute_action", {"action_id": aid})
    conn.execute("UPDATE records SET data=json_set(data, '$.quantity', 999) WHERE id='REC-001'")  # drift after execution
    second = tools.call(conn, "execute_action", {"action_id": aid})
    assert second["already_executed"] and second["after"] == first["after"]
    assert qty(conn) == 999  # retry did NOT re-apply
    assert conn.execute("SELECT COUNT(*) FROM executions").fetchone()[0] == 1


# --- verification ---

def test_verification_checks_real_state(conn):
    aid = approved_action(conn)
    assert tools.call(conn, "verify_action", {"action_id": aid})["passed"] is False  # not executed yet
    tools.call(conn, "execute_action", {"action_id": aid})
    assert tools.call(conn, "verify_action", {"action_id": aid})["passed"] is True
    conn.execute("UPDATE records SET data=json_set(data, '$.quantity', 120) WHERE id='REC-001'")  # tamper
    res = tools.call(conn, "verify_action", {"action_id": aid})
    assert res["passed"] is False
    assert {c["check"]: c["passed"] for c in res["checks"]}["field_has_target_value"] is False


# --- model availability ---

def test_model_unavailable_fails_safely(conn, monkeypatch, capsys):
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9/v1")  # discard port: nothing listens
    monkeypatch.setenv("LLM_TIMEOUT", "2")
    with pytest.raises(llm.LLMUnavailable):
        llm.from_env().health()
    assert main(["check-llm"]) == 3
    assert json.loads(capsys.readouterr().out)["error"]["code"] == "llm_unavailable"
    d = doctor(conn)
    assert d["ok"] is True  # core app still healthy without a model
    assert {c["check"]: c["ok"] for c in d["checks"]}["llm_endpoint"] is False
    assert tools.call(conn, "investigate", {"record_id": "REC-001"})["ok"]  # tools don't need the model


def test_mock_is_labelled(monkeypatch):
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    m = llm.from_env()
    assert m.is_mock and m.health()["mock"] is True


@pytest.fixture
def fake_openai_server():
    replies = {"content": '```json\n{"tool": "investigate", "args": {"record_id": "REC-001"}}\n```'}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass

        def _send(self, obj):
            body = json.dumps(obj).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self._send({"data": [{"id": "local-model"}]})

        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            self._send({"choices": [{"message": {"content": replies["content"]}}]} if replies["content"] else {"bogus": 1})

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/v1", replies
    srv.shutdown()


def test_openai_compatible_endpoint(fake_openai_server):
    url, replies = fake_openai_server
    client = llm.OpenAICompatLLM(url)
    res = llm.smoke_test(client)
    assert res["model"] == "local-model" and res["structured_output_ok"] is True
    with pytest.raises(llm.LLMUnavailable):
        llm.OpenAICompatLLM(url, model="missing").health()
    replies["content"] = None
    with pytest.raises(llm.LLMUnavailable):
        client.chat([{"role": "user", "content": "hi"}])


def test_parse_json_handles_noise():
    assert llm.parse_json('Sure! {"a": {"b": 1}} done') == {"a": {"b": 1}}
    assert llm.parse_json("no json here") is None


# --- repeated demo ---

def test_demo_is_repeatable(conn):
    snapshots = []
    for _ in range(3):
        res = run_demo(conn, auto_approve=True, stream=lambda *_: None)
        assert res == {"ok": True, "executed": True, "verified": True}
        snapshots.append([dict(r) for r in conn.execute("SELECT id, data FROM records ORDER BY id")])
    assert snapshots[0] == snapshots[1] == snapshots[2]


def test_demo_rejection_path(conn):
    res = run_demo(conn, ask=lambda _: "n", stream=lambda *_: None)
    assert res == {"ok": True, "executed": False}
    assert qty(conn) == 120
