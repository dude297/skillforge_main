"""EXPERIMENT: supply-chain vertical slice through the EXISTING router. MOCK library (see library.py).

  known    freight_week2            exact match -> catalog gate -> skill proposes -> human approves -> execute+verify
  unknown  freight_duplicate_charges no exact match -> catalog suggestions (no authority) -> agent queue / deferred
  changed  carrier contract rev-2026-11 declared -> freight skill stale -> same week2 data -> refused -> revalidate

Correctness oracle for freight: experiments/ops_discrepancy/hidden_validation.verify (independent regex re-count of
the raw invoice lines; the core verifier does not know the 'carrier_invoice_net' invariant).

  python -m experiments.catalog.demo
"""
import json
import os
import tempfile
from pathlib import Path

from app import db, skillforge as sf, tools
from experiments.catalog import catalog, library
from experiments.ops_discrepancy import hidden_validation as hv
from experiments.router import router


def _ev(eid, scenario):
    return {"event_id": eid, "source": "freight-feed", "type": "reconcile.requested", "scenario": scenario}


def oracle(conn):
    """Every PO with trusted carrier evidence equals the independent invoice net."""
    out = {}
    for r in conn.execute("SELECT r.id, r.data, e.data ev FROM records r JOIN evidence e ON e.record_id=r.id "
                          "WHERE e.source='carrier_export' AND e.trusted=1"):
        out[r["id"]] = hv.verify(json.loads(r["data"])["freight_accrued"], json.loads(r["ev"])["lines"])
    return out


def run(conn, inference_ok=lambda: True, approver="ops-lead"):
    path = {}
    # 1. known task
    r = router.route(conn, _ev("sc-known", "freight_week2.json"), inference_ok)
    before = oracle(conn)
    for a in r["actions"]:
        tools.decide_approval(conn, a, True, approver)
    done = router.complete(conn, "sc-known")
    path["known"] = {"route": r["status"], "reason": r["reason"], "actions": r["actions"], "final": done["status"],
                     "oracle_before": before, "oracle_after": oracle(conn), "router_model_calls": r["router_model_calls"]}
    # 2. unknown task
    u = router.route(conn, _ev("sc-unknown", "freight_duplicate_charges.json"), inference_ok)
    path["unknown"] = {"route": u["status"], "reason": u["reason"], "suggestions": u["suggestions"],
                       "actions": u["actions"]}
    # 3. changed business rule: a contract revision the data does not show
    fresh = catalog.set_env_version(conn, "contract:kestrel-freight", "rev-2026-11", approver)
    c = router.route(conn, _ev("sc-changed", "freight_week2.json"), inference_ok)
    direct = tools.call(conn, "run_skill", {"name": library.FREIGHT, "propose": True})  # the agent-tool path
    pinned = tools.call(conn, "run_skill", {"name": library.FREIGHT, "version": 1})
    path["changed"] = {"stale": fresh["stale"], "route": c["status"], "reason": c["reason"], "actions": c["actions"],
                       "direct_run_skill": direct.get("error", {}).get("code"),
                       "pinned_run_skill": pinned.get("error", {}).get("code"), "oracle": oracle(conn)}
    return path


if __name__ == "__main__":
    work = Path(tempfile.mkdtemp(prefix="catalog-demo-"))
    os.environ["APP_DB"] = str(work / "demo.db")
    sf.SKILLS_DIR = work / "skills"
    conn = db.connect()
    print("MOCK library (scripted solve + human-written skills). No model involved.\n")
    print(json.dumps(library.build(conn)))
    print(json.dumps(run(conn), indent=2))
    with library.hidden_dir(library.OPS):
        print("\nrevalidate after review:", json.dumps(catalog.revalidate(conn, library.FREIGHT, 1, "ops-lead")))
