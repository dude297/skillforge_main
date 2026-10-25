"""EXPERIMENT: build a small approved library through the UNCHANGED core rules, then catalog it.

  line-total-reconcile       bench.learn (MOCK agent + mock-authored fixture), hidden suite validation/sum_lines.py
  freight-invoice-reconcile  scripted MOCK solve of ops case_primary, mock-authored fixture skill,
                             hidden suite experiments/ops_discrepancy/hidden_validation.py (12 cases)

Both go task -> verified fix -> propose_skill (lint, own tests, replay) -> approve_skill (hidden suite) -> catalog.
MOCK: a scripted stand-in did the "solve" and a human wrote the skill. This proves the plumbing, not learning.
"""
import contextlib
import json
import os
from pathlib import Path

from app import bench, db, skillforge as sf, tools
from experiments.catalog import catalog

HERE = Path(__file__).resolve().parent
OPS = HERE.parent / "ops_discrepancy"
FREIGHT = "freight-invoice-reconcile"
FREIGHT_DEPS = {"contract:kestrel-freight": "rev-2026-10", "schema:kfl-export": "v2"}
OPERATOR = "lib-operator"


@contextlib.contextmanager
def hidden_dir(path):
    old = os.environ.get("HIDDEN_DIR")
    os.environ["HIDDEN_DIR"] = str(path)
    try:
        yield
    finally:
        os.environ.pop("HIDDEN_DIR") if old is None else os.environ.__setitem__("HIDDEN_DIR", old)


def learn_freight(conn, by=OPERATOR):
    db.load_scenario(conn, OPS / "cases" / "case_primary.json")
    sf.task_begin(conn, "learn freight (MOCK solve)", "mock")
    a = tools.call(conn, "propose_action", {"record_id": "PO-7731", "action_type": "set_field",
                                            "params": {"field": "freight_accrued", "value": 1379.69},
                                            "reason": "carrier invoice net 1379.69 USD"})["action"]
    tools.call(conn, "request_approval", {"action_id": a["id"]})
    tools.decide_approval(conn, a["id"], True, by)
    tools.call(conn, "execute_action", {"action_id": a["id"]})
    assert tools.call(conn, "verify_action", {"action_id": a["id"]})["passed"]
    p = tools.call(conn, "propose_skill", {"name": FREIGHT, "path": str(HERE / "skills" / FREIGHT),
                                           "description": "reconcile PO freight accrual with the carrier invoice net",
                                           "tags": ["freight", "invoice", "reconcile"]})
    sf.task_end(conn)
    if p.get("status") != "tested":
        raise RuntimeError(f"freight skill did not pass propose_skill: {json.dumps(p)[:600]}")
    with hidden_dir(OPS):
        return sf.approve_skill(conn, FREIGHT, p["version"], by)


def build(conn, by=OPERATOR):
    bench.learn(conn, bench.MockAgent())
    learn_freight(conn, by)
    for k, v in FREIGHT_DEPS.items():
        catalog.set_env_version(conn, k, v, by)
    catalog.register(conn, bench.SKILL_NAME, 1, by, "acme/records", "records-ops", "records", "reconciliation",
                     ["router", "analyst", "agent"], aliases=["totals", "line items", "sum"],
                     environment={"runners": ["subprocess", "docker"], "python": "3.11"})
    catalog.register(conn, FREIGHT, 1, by, "acme/supply", "freight-ops", "supply-chain", "freight invoice reconciliation",
                     ["router", "analyst", "agent"],
                     aliases=["freight", "carrier", "invoice", "accrual", "kfl", "kestrel", "linehaul"],
                     environment={"runners": ["subprocess", "docker"], "python": "3.11"}, dependencies=FREIGHT_DEPS)
    return {"ok": True, "approved": [r["name"] for r in conn.execute("SELECT name FROM skills WHERE status='approved'")]}
