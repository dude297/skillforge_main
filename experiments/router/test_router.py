"""Router safety tests. MOCK fixture skill (bench.learn with MockAgent); no model anywhere.
  python -m pytest -q -p no:cacheprovider experiments/router"""
import json
import shutil

import pytest

from adapters import models
from app import bench, db, skillforge as sf, tools
from experiments.catalog import catalog
from experiments.router import router

UP, DOWN = (lambda: True), (lambda: False)


def ev(eid, scenario="learn_b.json", **kw):
    return {"event_id": eid, "source": "ops-fixture", "type": "reconcile.requested", "scenario": scenario, **kw}


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(models, "PROBE_FILE", tmp_path / "probe.json")
    c = db.connect()
    bench.learn(c, bench.MockAgent())  # approved line-total-reconcile, learned on learn_a
    catalog.register(c, bench.SKILL_NAME, 1, "lib-operator", "acme/records", "records-ops", "records", "reconciliation",
                     ["router"])
    return c


def approve_all(conn, by="alice"):
    for a in tools.pending_approvals(conn)["pending"]:
        tools.decide_approval(conn, a["id"], True, by)


def count(conn, sql):
    return conn.execute(sql).fetchone()[0]


def test_exact_match_proposes_only_and_needs_human_approval(conn):
    calls = []
    r = router.route(conn, ev("e1"), inference_ok=lambda: calls.append(1) or True)
    assert r["status"] == "awaiting_approval" and r["actions"] and r["router_model_calls"] == 0
    assert calls == []  # the skill path never even asks whether inference is up
    before = bench.records_state(conn)
    assert router.complete(conn, "e1")["status"] == "awaiting_approval"  # pending: nothing executed
    assert count(conn, "SELECT COUNT(*) FROM executions") == 0
    approve_all(conn)
    done = router.complete(conn, "e1")
    assert done["status"] == "completed" and set(done["states"].values()) == {"COMPLETED"}
    assert bench.correct(conn, before)


@pytest.mark.parametrize("scenario", ["lookalike.json", "unrelated.json"])
def test_lookalike_never_runs_the_skill(conn, scenario):
    up = router.route(conn, ev("x1", scenario), inference_ok=UP)
    assert up["status"] == "queued_for_agent" and not up["actions"]
    db.load_scenario(conn, bench.LEARN / scenario)  # fresh fixture state for the model-down variant
    before = bench.records_state(conn)
    down = router.route(conn, ev("x2", scenario), inference_ok=DOWN)
    assert down["status"] == "deferred" and "inference unavailable" in down["reason"]
    assert count(conn, "SELECT COUNT(*) FROM skill_runs WHERE status='ok'") == 0
    assert count(conn, "SELECT COUNT(*) FROM actions") == 0 and bench.records_state(conn) == before


def test_duplicate_and_reused_ids(conn):
    first = router.route(conn, ev("d1"), inference_ok=DOWN)
    again = router.route(conn, ev("d1"), inference_ok=DOWN)
    assert again["duplicate"] and again["actions"] == first["actions"]
    assert count(conn, "SELECT COUNT(*) FROM skill_runs") == 1 and count(conn, "SELECT COUNT(*) FROM actions") == len(first["actions"])
    assert router.route(conn, ev("d1", "boundary.json"))["status"] == "refused"


def test_restart_mid_route_resumes_without_duplicates(conn, tmp_path):
    first = router.route(conn, ev("r1"), inference_ok=DOWN)
    conn.execute("UPDATE router_events SET status='received', actions=NULL WHERE event_id='r1'")  # crash before decide
    conn.close()
    c2 = db.connect()  # restart
    again = router.route(c2, ev("r1"), inference_ok=DOWN)
    assert again["status"] == "awaiting_approval" and again["actions"] == first["actions"]
    assert count(c2, "SELECT COUNT(*) FROM actions") == len(first["actions"])


def test_pending_approval_defers_other_events_then_redelivery_routes(conn):
    router.route(conn, ev("p1"))
    blocked = router.route(conn, ev("p2", "learn_a.json"))
    assert blocked["status"] == "deferred" and blocked["reason"].startswith("busy")
    approve_all(conn)
    router.complete(conn, "p1")
    assert router.route(conn, ev("p2", "learn_a.json"))["status"] == "awaiting_approval"


def test_conflicting_open_change_goes_to_human(conn, monkeypatch):
    real = db.load_scenario

    def racing_writer(c, path=None):  # another writer files a different fix right after the data lands
        s = real(c, path)
        a = tools.call(c, "propose_action", {"record_id": "LOT-18", "action_type": "set_field",
                                             "params": {"field": "total", "value": 9.0}, "reason": "someone else"})
        assert a["ok"]
        return s
    monkeypatch.setattr(db, "load_scenario", racing_writer)
    r = router.route(conn, ev("c1"))
    assert r["status"] == "needs_human" and "conflict" in r["reason"]
    assert count(conn, "SELECT COUNT(*) FROM executions") == 0


def test_failed_verification_needs_review(conn):
    router.route(conn, ev("v1"))
    approve_all(conn)
    with bench.fault_injection(conn, "post_execute_drift"):
        done = router.complete(conn, "v1")
    assert done["status"] == "needs_review" and "NEEDS_REVIEW" in done["states"].values()


def test_policy_auto_approval_is_not_human_authorization(conn, tmp_path, monkeypatch):
    learn = tmp_path / "learning"
    shutil.copytree(bench.LEARN, learn)
    s = json.loads((learn / "learn_b.json").read_text())
    s["policy"]["actions"]["set_field"]["requires_approval"] = False
    (learn / "auto.json").write_text(json.dumps(s))
    monkeypatch.setattr(router, "FIXTURE_DIRS", (learn,))
    r = router.route(conn, ev("a1", "auto.json"))
    assert r["status"] == "awaiting_approval"  # same skill matched; policy auto-approved its actions
    assert router.complete(conn, "a1")["status"] == "needs_human"
    assert count(conn, "SELECT COUNT(*) FROM executions") == 0


def test_ambiguous_exact_matches_go_to_human(conn):
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(skills)") if r["name"] not in ("id", "name")]
    conn.execute(f"INSERT INTO skills (name, {', '.join(cols)}) SELECT 'lookalike-twin', {', '.join(cols)} "
                 "FROM skills WHERE active=1")
    r = router.route(conn, ev("m1"), inference_ok=UP)
    assert r["status"] == "needs_human" and r["reason"].startswith("ambiguous")
    assert count(conn, "SELECT COUNT(*) FROM skill_runs") == 0


@pytest.mark.parametrize("bad", [
    {**ev("b1"), "source": "internet"},
    {**ev("b2"), "type": "skill.approve"},
    ev("b3", approve=True),
    ev("b4", "../scenario.json"),
    ev("b5", "nope.json"),
    {**ev("b6"), "event_id": "x" * 200},
    "not an event",
])
def test_untrusted_events_refused(conn, bad):
    n = count(conn, "SELECT COUNT(*) FROM actions")
    assert router.route(conn, bad)["status"] == "refused"
    assert count(conn, "SELECT COUNT(*) FROM actions") == n and count(conn, "SELECT COUNT(*) FROM router_events") == 0


# --- power detection, bootstrap manifest, comparison harness ------------------------------

def test_power_detect_is_read_only(monkeypatch):
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from experiments.router import power
    seen, state = [], {"code": 404}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            seen.append(("GET", self.path))
            b = b'{"is_sleeping": false}' if state["code"] == 200 else b"{}"
            self.send_response(state["code"])
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_POST(self):
            seen.append(("POST", self.path))

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_port}/v1"
    assert power.detect(url)["sleep_mode"] is False
    state["code"] = 200
    caps = power.detect(url)
    srv.shutdown()
    assert caps["sleep_mode"] is True and caps["is_sleeping"] is False
    assert all(m == "GET" and p == "/is_sleeping" for m, p in seen)  # never /sleep or /wake_up
    assert power.detect("mock")["sleep_mode"] is None
    assert power.recommend(9999, caps)["action"] == "none"  # no policy configured -> never acts
    assert power.recommend(9999, caps, 600)["action"] == "operator_may_sleep"


def test_bootstrap_manifest_is_read_only(conn, tmp_path):
    import hashlib
    from experiments.router import bootstrap
    app_db = tmp_path / "t.db"
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    h = hashlib.sha256(app_db.read_bytes()).hexdigest()
    ok = bootstrap.manifest(bench.LEARN / "learn_b.json", app_db)
    look = bootstrap.manifest(bench.LEARN / "lookalike.json", app_db)
    assert hashlib.sha256(app_db.read_bytes()).hexdigest() == h
    assert [c["name"] for c in ok["compatible_skills"]] == [bench.SKILL_NAME] and not ok["missing_skill_opportunities"]
    assert not look["compatible_skills"] and look["near_misses"] and look["missing_skill_opportunities"]
    assert "untrusted_text" in look["environment"]["description"]
    assert "approve" not in " ".join(look["roles"]["agent"])


def test_comparison_harness_honest_metrics(tmp_path, monkeypatch):
    from experiments.router import compare
    monkeypatch.setattr(sf, "SKILLS_DIR", sf.SKILLS_DIR)  # restored after run() reassigns it
    monkeypatch.setenv("APP_DB", str(tmp_path / "x.db"))
    s = {r["variant"]: r for r in compare.run(1, tmp_path)["summary"]}
    assert all(s[v]["false_skill_match"] == 0 and s[v]["energy_j"] is None for v in "ABC")
    assert s["A"]["model_calls_total"] is None and s["B"]["model_calls_total"] is None  # mock agent: unknown
    assert s["C"]["model_calls_total"] == 0 and s["C"]["escalated_to_agent"] == 0
    assert s["B"]["handled_without_inference"] == s["C"]["handled_without_inference"] > 0
