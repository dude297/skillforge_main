"""P1/P7: the enterprise slice end to end. The success criterion is ZERO unauthorized or falsely verified changes,
checked against an oracle that shares no code with the skill, the agent tool or the core verifier.
  python -m pytest -q -p no:cacheprovider experiments/catalog/test_slice.py"""
import json

import pytest

from adapters import models
from app import db, skillforge as sf
from experiments.catalog import library, slice as story
from experiments.router import router


@pytest.fixture(scope="module")
def ran(tmp_path_factory):
    d = tmp_path_factory.mktemp("slice")
    mp = pytest.MonkeyPatch()
    mp.setenv("APP_DB", str(d / "s.db"))
    mp.setattr(sf, "SKILLS_DIR", d / "skills")
    mp.setattr(models, "PROBE_FILE", d / "probe.json")
    c = db.connect()
    library.build(c)
    log = {s["step"]: s for s in story.run(c)}
    yield c, log
    c.close()
    mp.undo()


def test_known_task_is_deterministic_approved_and_verified(ran):
    c, log = ran
    s = log["1 known task"]
    assert s["first"]["status"] == "awaiting_approval" and s["final"]["status"] == "completed"
    assert s["router_model_calls"] == 0 and s["agent_model_calls"] is None  # unknown, never 0
    assert s["final"]["reply"] == "Done: 1 change(s) applied after approval and independently verified."


def test_unfamiliar_task_escalates_or_waits_and_changes_nothing(ran):
    _, log = ran
    assert log["2a unfamiliar task, model up"]["first"]["status"] == "queued_for_agent"
    down = log["2b unfamiliar task, model down"]["first"]
    assert down["status"] == "deferred" and "Local AI is offline" in down["reply"] and not down["actions"]


def test_B_newer_contract_revision_is_stopped_before_approval(ran):
    _, log = ran
    b = log["B newer contract revision"]["first"]
    assert b["status"] == "needs_human" and not b["actions"]
    assert "rule it depends on has changed" in b["reply"] and "verified" not in b["reply"]


def test_C_mixed_batch_says_exactly_what_was_and_was_not_handled(ran):
    _, log = ran
    s = log["C mixed batch"]
    assert s["first"]["held"] == ["PO-8103", "PO-8104"] and len(s["first"]["actions"]) == 1
    assert s["final"]["status"] == "completed_partial"
    reply = s["final"]["reply"]
    assert reply.startswith("1 change(s) applied after approval and independently verified.")
    assert "PO-8103" in reply and "CAD" in reply and "PO-8104" in reply
    # PO-8104's export is broken (trailer), its value is untouched (the line sum happens to match: the oracle is lenient)
    assert s["oracle_after"]["PO-8101"] and s["oracle_after"]["PO-8102"] and not s["oracle_after"]["PO-8103"]


def test_A_wrong_department_learns_nothing_about_other_teams(ran):
    c, log = ran
    a = log["A wrong department"]["first"]
    assert a["status"] == "needs_human" and not a["actions"]
    row = router._row(c, "sA")
    for leak in (library.FREIGHT, "acme/supply", "freight-ops", "skills"):
        assert leak not in a["reply"] and leak not in json.dumps(row["suggestions"])
    assert "no approved automation" in a["reply"]


def test_duplicate_delivery_runs_nothing_again(ran):
    _, log = ran
    assert log["duplicate delivery of 1"]["first"] == {"status": "completed", "duplicate": True}


def test_zero_unauthorized_or_falsely_verified_changes(ran):
    """Walk the permanent audit trail (domain tables are wiped by each scenario load; the audit is not): within each
    data generation, every execution follows a NAMED person's approval of that action, and every executed change's
    record is oracle-correct in the step that made it."""
    c, log = ran
    approved, executions = {}, 0
    for e in c.execute("SELECT actor, event, payload FROM audit ORDER BY id"):
        p = json.loads(e["payload"])
        if e["event"] == "reset":
            approved = {}
        elif e["event"] == "approval_approved":
            approved[p["action_id"]] = e["actor"]
        elif e["event"] == "execute_action":
            executions += 1
            who = approved.get(p["action_id"], "")
            assert who.startswith("human:") and who not in ("human:policy", "human:agent"), (p, who)
    assert executions >= 2  # the known task and the supported record of the mixed batch (plus learning)
    for name in ("1 known task", "C mixed batch"):  # each record a change was applied to is oracle-correct after it
        s = log[name]
        assert all(s["oracle_after"][r] for r in s["oracle_after"] if r not in s["final"]["held"])
    for s in log.values():  # "verified" is only ever said for steps that actually completed
        for reply in (s["first"].get("reply", ""), (s.get("final") or {}).get("reply", "")):
            if "independently verified" in reply:
                assert (s.get("final") or {}).get("status") in ("completed", "completed_partial")


def test_restart_then_redelivery_when_local_ai_is_back(ran):
    c, _ = ran
    c2 = db.connect()
    r = router.route(c2, {"event_id": "s2b", "source": "freight-feed", "type": "reconcile.requested",
                          "scenario": "freight_duplicate_charges.json"}, lambda: True)
    assert r["status"] == "queued_for_agent"


def test_router_runs_are_core_tasks_the_console_and_world_can_show(ran):
    """unified-alpha: a routed skill run is ONE core task (task_begin..task_end), so console History, Investigations and
    the World's live fold all key it by the same task id; a mixed batch never closes as a success."""
    c, _ = ran
    tasks = {r["label"].rsplit("event ", 1)[-1]: dict(r) for r in c.execute(
        "SELECT id, label, mode, model, status, success, model_calls, actions_executed, invariant_violations FROM tasks "
        "WHERE label LIKE 'Routed %'")}
    assert set(tasks) == {"s1", "sC"}  # only events that ran a skill; refused/stale/queued/deferred ran nothing
    assert all(t["status"] == "closed" and t["model_calls"] == 0 for t in tasks.values())
    # provenance: fixed skill code, no model and no agent; never 'mock' (an agent) and never 'real' (a model)
    assert all(t["mode"] == "deterministic" and t["model"] is None for t in tasks.values())
    assert tasks["s1"]["success"] == 1 and tasks["s1"]["actions_executed"] == 1
    assert tasks["sC"]["success"] == 0 and tasks["sC"]["invariant_violations"] > 0  # partial: console "Partly done"
    assert c.execute("SELECT COUNT(*) FROM tasks WHERE status='open'").fetchone()[0] == 0
    # the audit stream (the World's source) brackets each routed decision with its task: begin < event_<status> < end.
    # (actions are not checked by id: a later scenario load replaces that table, ids repeat across data generations)
    aud = [(r["id"], r["event"], json.loads(r["payload"])) for r in c.execute("SELECT id, event, payload FROM audit")]
    for eid, t in tasks.items():
        b = next(i for i, e, p in aud if e == "task_begin" and p["task_id"] == t["id"])
        d = next(i for i, e, p in aud if e.startswith("event_") and p.get("event_id") == eid)
        n = next(i for i, e, p in aud if e == "task_end" and p["task_id"] == t["id"])
        assert b < d < n


def test_router_decisions_reach_the_console_as_a_closed_vocabulary_only(ran):
    """The World labels 'handed to a person' / 'deferred, no model' from the route event's `kind`; the operator API
    passes that and the event id, never the operator-facing free-text reason (skill names, gate details)."""
    from app import ui_api
    c, _ = ran
    rows = c.execute("SELECT id, ts, actor, event, payload FROM audit WHERE event LIKE 'route_%'").fetchall()
    views = [(r["event"], ui_api.event_view(r)["payload"]) for r in rows]
    assert ("route_deferred", {"event_id": "s2b", "kind": "inference_down"}) in views
    assert {v["kind"] for e, v in views if e == "route_needs_human"} == {"not_authorized", "stale"}  # A and B
    assert all(set(v) == {"event_id", "kind"} for _, v in views)
