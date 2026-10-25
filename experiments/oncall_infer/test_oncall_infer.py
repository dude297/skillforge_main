"""python -m pytest -q -p no:cacheprovider experiments/oncall_infer/test_oncall_infer.py
Approval in these tests is done in a tmp registry by the test itself, labelled 'pytest (not a human)'."""
import json
import shutil

import pytest

from adapters import llm as llm_mod
from app import db, skillforge as sf
from experiments.oncall_infer import oncall


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """oncall.Ctx rebinds sf.SKILLS_DIR and sets APP_DB/HIDDEN_DIR/LLM_RETRIES: restore all after each test."""
    monkeypatch.setattr(sf, "SKILLS_DIR", sf.SKILLS_DIR)
    for k in ("APP_DB", "HIDDEN_DIR", "LLM_RETRIES"):
        monkeypatch.setenv(k, "x")  # records the original (even "unset") for restore
        monkeypatch.delenv(k)


@pytest.fixture
def staged(tmp_path):
    out = tmp_path / "run.json"
    doc = oncall.run(state=tmp_path / "state", out=out)
    return tmp_path / "state", out, doc


def test_reference_skill_passes_hidden_and_stops_pending(staged):
    _, _, doc = staged
    assert doc["mode"] == "RECORDED_SIMULATION" and doc["synthesis"]["provenance"] == "recorded_reference"
    assert doc["synthesis"]["model_calls"] is None and doc["synthesis"]["prompt_tokens"] is None
    assert doc["verification"]["passed"] and all(c["pass"] for c in doc["verification"]["hidden"])
    assert doc["approval"]["state"] == "pending" and "python -m app skill approve" in doc["approval"]["command"]


def test_wrong_skill_fails_hidden(tmp_path, monkeypatch):
    monkeypatch.setenv("HIDDEN_DIR", str(oncall.HIDDEN_DIR))
    bad = tmp_path / "bad"
    shutil.copytree(oncall.REFERENCE, bad)
    # overfit: always revert max_num_seqs to 128, whatever the evidence says
    (bad / "scripts" / "helper.py").write_text(
        "def run(dataset):\n    return {'proposals': [{'record_id': r['id'], 'field': 'max_num_seqs', 'value': 128}"
        " for r in dataset['records']]}\n", encoding="utf-8")
    data = {"records": [], "evidence": []}
    res = sf.hidden_check(bad, oncall.SCENARIO, sf._shape_key(data))
    assert not res["ok"] and sum(c["ok"] for c in res["cases"]) < len(res["cases"])


def test_reuse_refused_without_approval(staged):
    state, out, _ = staged
    doc = oncall.reuse(state, out)
    assert doc["reuse"]["state"] == "refused" and doc["reuse"]["reason"] == "not approved"
    assert doc["refusal"]["reason"] == "not approved"


def test_after_approval_inc2_reused_with_zero_model_calls_and_inc3_refused(staged, monkeypatch):
    state, out, _ = staged
    conn = db.connect(str(state / "app.db"))
    sf.approve_skill(conn, oncall.NAME, 1, "pytest (not a human)")  # tmp registry only
    conn.close()

    def boom(*a, **k):
        raise AssertionError("model client used")
    monkeypatch.setattr(llm_mod, "from_env", boom)  # belt and braces on top of oncall.NoModel
    doc = oncall.reuse(state, out)
    r = doc["reuse"]
    assert r["state"] == "done" and r["model_calls"] == 0 and r["latency_ms"] is not None
    assert r["diagnosis"]["offending_key"] == "max_model_len" and r["diagnosis"]["baseline_value"] == 16384
    assert doc["refusal"]["state"] == "refused" and "fingerprint differs" in doc["refusal"]["reason"]
    saved = json.loads(out.read_text(encoding="utf-8"))["approval"]
    assert saved["by"] == "pytest (not a human)" and saved["kind"] == "simulated"


def _approve(state):
    conn = db.connect(str(state / "app.db"))
    sf.approve_skill(conn, oncall.NAME, 1, "pytest (not a human)")  # tmp registry only
    return conn


def test_core_matcher_false_positive_on_lookalike_is_a_known_gap(staged):
    """Documents the core gap: the structural matcher alone accepts INC-3. If core ever learns the incident
    fingerprint this test fails; update it and the README section 'Reuse gate and the known core gap'."""
    conn = _approve(staged[0])
    db.load_scenario(conn, oncall.FIX["INC-3"])
    m = sf.match_skills(conn)
    assert m["decision"] == "skill" and m["skill"]["match"] == "exact"


def test_core_path_bypass_yields_no_proposal(staged):
    """A caller that skips oncall._decide (core run_skill directly) still gets nothing on the lookalike, because
    approval re-ran the hidden suite whose lookalike cases demand zero proposals."""
    conn = _approve(staged[0])
    db.load_scenario(conn, oncall.FIX["INC-3"])
    with oncall.NoModel() as guard:
        res = sf.run_skill(conn, oncall.NAME)
    assert res["proposals"] == [] and guard.calls == 0


@pytest.mark.parametrize("fp", [None, {"id": "tampered", "parts": {}}])
def test_missing_or_tampered_fingerprint_refuses_reuse(staged, fp):
    state, out, _ = staged
    conn = _approve(state)
    row = conn.execute("SELECT id, validation FROM skills WHERE name=?", (oncall.NAME,)).fetchone()
    v = json.loads(row["validation"])
    v["incident_fingerprint"] = fp
    conn.execute("UPDATE skills SET validation=? WHERE id=?", (json.dumps(v), row["id"]))
    conn.commit()
    conn.close()
    doc = oncall.reuse(state, out)
    assert doc["reuse"]["state"] == "refused" and doc["reuse"]["diagnosis"] is None
    assert doc["refusal"]["state"] == "refused"


def test_no_sidecar_fingerprint_file(staged):
    assert not (staged[0] / "learned_fingerprint.json").exists()


def test_noModel_guard_counts_and_raises():
    with oncall.NoModel() as g:
        with pytest.raises(AssertionError):
            llm_mod.OpenAICompatLLM("http://x")
    assert g.calls == 1
    llm_mod.OpenAICompatLLM("http://x")  # restored afterwards


def test_live_unreachable_falls_back_to_recorded(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_RETRIES", "0")
    doc = oncall.run(True, "http://127.0.0.1:9/v1", "m", tmp_path / "s", tmp_path / "o.json")
    assert doc["mode"] == "RECORDED_SIMULATION" and not doc["model"]["available"]
    assert "unavailable" in doc["model"]["note"] and doc["synthesis"]["model_calls"] is None


def test_live_strict_fails_loudly_writes_nothing_and_keeps_previous_state(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_RETRIES", "0")
    (tmp_path / "s").mkdir()
    (tmp_path / "s" / "keep.txt").write_text("previous run", encoding="utf-8")
    with pytest.raises(llm_mod.LLMUnavailable):
        oncall.run(True, "http://127.0.0.1:9/v1", None, tmp_path / "s", tmp_path / "o.json", allow_fallback=False)
    assert not (tmp_path / "o.json").exists() and (tmp_path / "s" / "keep.txt").exists()


def test_live_path_counts_calls_and_tokens_against_a_stub_server(tmp_path):
    """Plumbing only: a local STUB answers with the reference skill. Proves counting, not model quality."""
    import http.server
    import threading
    ref = oncall.REFERENCE
    reply = json.dumps({"skill_md": (ref / "SKILL.md").read_text(encoding="utf-8"),
                        "helper": (ref / "scripts" / "helper.py").read_text(encoding="utf-8"),
                        "tests": (ref / "tests" / "test_helper.py").read_text(encoding="utf-8")})

    class H(http.server.BaseHTTPRequestHandler):
        def _send(self, body):
            b = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            self._send({"data": [{"id": "stub-model"}]})

        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            self._send({"choices": [{"message": {"content": reply}}], "usage": {"prompt_tokens": 11, "completion_tokens": 7}})

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        # model=None is CLI '--model auto': the served id comes from /v1/models; strict, as the CLI default
        doc = oncall.run(True, f"http://127.0.0.1:{srv.server_port}/v1", None, tmp_path / "s", tmp_path / "o.json",
                         allow_fallback=False)
        assert doc["model"]["id"] == "stub-model"
    finally:
        srv.shutdown()
    s = doc["synthesis"]
    assert doc["mode"] == "LIVE_REAL_MODEL" and s["provenance"] == "model"
    assert (s["model_calls"], s["prompt_tokens"], s["completion_tokens"]) == (1, 11, 7) and s["latency_ms"] > 0
    assert doc["verification"]["passed"]
