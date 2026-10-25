"""EXPERIMENT: the enterprise vertical slice, start to finish, on the real backend. MOCK library (library.py), no model,
SIMULATED channel: each "employee message" is a structured inbound event, each reply is router.explain().

  python -m experiments.catalog.slice

Steps: known task -> unfamiliar task (model up, then down) -> B newer contract revision -> C mixed batch ->
A wrong department -> duplicate delivery -> restart. Ends with an audit of every executed change.
"""
import json
import os
import tempfile
import time
from pathlib import Path

from app import db, skillforge as sf, tools
from experiments.catalog import library
from experiments.ops_discrepancy import hidden_validation as hv
from experiments.router import router

UP, DOWN = (lambda: True), (lambda: False)


def oracle(conn):
    """Independent of everything under test: the ops fixture's raw-line re-count, per PO with a USD/CAD invoice."""
    return {r["id"]: hv.verify(json.loads(r["data"])["freight_accrued"], json.loads(r["ev"])["lines"]) for r in conn.execute(
        "SELECT r.id, r.data, e.data ev FROM records r JOIN evidence e ON e.record_id=r.id "
        "WHERE e.source='carrier_export' AND e.trusted=1")}


def step(conn, log, label, source, scenario, eid, inference=UP, approver="ops-lead"):
    calls0 = conn.execute("SELECT COALESCE(MAX(id), 0) FROM tool_calls").fetchone()[0]
    t0 = time.perf_counter()
    ev = {"event_id": eid, "source": source, "type": "reconcile.requested", "scenario": scenario}
    r = router.route(conn, ev, inference)
    first = {"status": r["status"], "reply": router.explain(r), "actions": r.get("actions", []), "held": sorted(r.get("held") or {})}
    final = None
    if r["status"] == "awaiting_approval":
        for a in r["actions"]:
            tools.decide_approval(conn, a, True, approver)
        router.complete(conn, eid)
        row = router._row(conn, eid)
        final = {"status": row["status"], "reply": router.explain(row), "held": sorted(row["held"])}
    log.append({"step": label, "event": eid, "source": source, "scenario": scenario, "first": first, "final": final,
                "oracle_after": oracle(conn), "router_model_calls": r.get("router_model_calls"),
                "agent_model_calls": None,  # no model here: unknown, never 0
                "tool_calls": conn.execute("SELECT COUNT(*) FROM tool_calls WHERE id>?", (calls0,)).fetchone()[0],
                "ms": round((time.perf_counter() - t0) * 1000, 1)})
    return log[-1]


def run(conn):
    log = []
    step(conn, log, "1 known task", "freight-feed", "freight_week2.json", "s1")
    step(conn, log, "2a unfamiliar task, model up", "freight-feed", "freight_duplicate_charges.json", "s2a")
    step(conn, log, "2b unfamiliar task, model down", "freight-feed", "freight_duplicate_charges.json", "s2b", DOWN)
    step(conn, log, "B newer contract revision", "freight-feed", "freight_week2_rev2026_11.json", "sB")
    step(conn, log, "C mixed batch", "freight-feed", "freight_mixed.json", "sC")
    step(conn, log, "A wrong department", "finance-feed", "freight_week2.json", "sA")
    dup = router.route(conn, {"event_id": "s1", "source": "freight-feed", "type": "reconcile.requested",
                              "scenario": "freight_week2.json"}, UP)
    log.append({"step": "duplicate delivery of 1", "first": {"status": dup["status"], "duplicate": dup.get("duplicate")}})
    return log


def audit_changes(conn):
    """Every executed change: who approved it, and did it verify. A change verified without a human approver, or
    approved by policy/agent, would be an unauthorized change."""
    rows = conn.execute("""SELECT a.id, a.record_id, ap.decided_by, ap.status, v.passed FROM actions a
        LEFT JOIN approvals ap ON ap.action_id = a.id
        LEFT JOIN verifications v ON v.id = (SELECT MAX(id) FROM verifications WHERE action_id = a.id)
        WHERE a.status = 'executed'""").fetchall()
    return [dict(r) for r in rows]


if __name__ == "__main__":
    work = Path(tempfile.mkdtemp(prefix="slice-"))
    os.environ["APP_DB"] = str(work / "slice.db")
    sf.SKILLS_DIR = work / "skills"
    conn = db.connect()
    print("MOCK library (scripted solve, human-written skills); no model; SIMULATED channel.\n")
    library.build(conn)
    for s in run(conn):
        print(f"== {s['step']}  [{s.get('event', '')} from {s.get('source', '')}]")
        print(f"   {s['first']}")
        if s.get("final"):
            print(f"   after approval: {s['final']}")
        if "tool_calls" in s:
            print(f"   tool calls {s['tool_calls']}, {s['ms']} ms, router model calls {s['router_model_calls']}, "
                  f"agent model calls {s['agent_model_calls'] or 'unknown'}")
    conn.close()
    conn = db.connect()  # restart: the deferred event is redelivered once local AI is back
    r = router.route(conn, {"event_id": "s2b", "source": "freight-feed", "type": "reconcile.requested",
                            "scenario": "freight_duplicate_charges.json"}, UP)
    print(f"== restart, redelivery of s2b with local AI back: {r['status']}: {router.explain(r)}")
