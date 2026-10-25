"""EXPERIMENT: read-only environment manifest for ONE supported environment type: a SkillForge ops fixture.

Opens the fixture in an in-memory DB and the app DB READ-ONLY (skill registry only); writes nothing anywhere.
Fixture text (names, descriptions, labels) is untrusted DATA: it is truncated and tagged, never interpreted.
Roles and permissions come from code constants (agent tool set, policy), never inferred from the environment.

  python -m experiments.router.bootstrap data/learning/learn_b.json [--db data/app.db]
"""
import argparse
import inspect
import json
import os
import sqlite3
from pathlib import Path

from app import db, server, skillforge as sf, tools


def _untrusted(s, n=120):
    return {"untrusted_text": str(s)[:n]}


def manifest(scenario_path, app_db=None, principal=None):
    """principal = {"namespaces": [...], "roles": [...]} for catalog retrieval (default: none visible)."""
    from experiments.catalog import catalog
    mem = db.connect(":memory:")
    catalog.ensure(mem)
    scenario = db.load_scenario(mem, scenario_path)
    app_db = Path(app_db or os.environ.get("APP_DB", db.DEFAULT_DB))
    if app_db.exists():  # copy only the skill registry, through a read-only handle
        ro = sqlite3.connect(f"file:{app_db.as_posix()}?mode=ro", uri=True)
        ro.row_factory = sqlite3.Row
        rows = [dict(r) for r in ro.execute("SELECT * FROM skills WHERE status='approved' AND active=1")]
        has_catalog = ro.execute("SELECT 1 FROM sqlite_master WHERE name='catalog_entries'").fetchone()
        entries = [dict(r) for r in ro.execute("SELECT * FROM catalog_entries")] if has_catalog else []
        ro.close()
        for e in entries:
            mem.execute(f"INSERT INTO catalog_entries ({', '.join(e)}) VALUES ({', '.join('?' * len(e))})", tuple(e.values()))
        for r in rows:
            r.pop("id")
            r["source_task"] = None  # tasks are not copied; the FK would refuse the row
            mem.execute(f"INSERT INTO skills ({', '.join(r)}) VALUES ({', '.join('?' * len(r))})", tuple(r.values()))
    data, policy = sf.dataset(mem), tools._policy(mem)
    sig, match = sf.task_signature(data, policy), sf.match_skills(mem)
    agent = tools.agent_tools()
    kinds = sorted({r["kind"] for r in data["records"]})
    catalog.rebuild_index(mem)
    procedures = catalog.search(mem, catalog.event_query(mem), principal or {}, 5)["results"]
    return {
        "environment": {"type": "skillforge-ops-fixture", "name": _untrusted(scenario["name"]),
                        "description": _untrusted(scenario.get("description", "")), "records": len(data["records"]),
                        "record_kinds": kinds, "evidence_sources": sig["sources"], "signature": sig["id"]},
        "tool_inventory": {n: str(inspect.signature(f)).replace("(conn, ", "(").replace("(conn)", "()")
                           for n, f in agent.items()},
        "declared_capabilities": {"actions": {a: {"requires_approval": s.get("requires_approval", True),
                                                  "fields": s.get("fields", {})} for a, s in policy.get("actions", {}).items()},
                                  "invariants": policy.get("invariants", [])},
        "schemas": {"input_shape": sf.shape(data), "proposal_keys": sorted(sf.PROPOSAL_KEYS)},
        "roles": {"agent": sorted(server.allowed_tools()),
                  "human_only": ["approve", "reject", "skill approve|reject|disable|rollback", "reset", "recover"],
                  "router": ["route (read + propose via run_skill)", "complete (execute+verify human-approved only)"]},
        "example_tasks": [{"event": {"source": "ops-fixture", "type": "reconcile.requested",
                                     "scenario": Path(scenario_path).name}}],
        "compatible_skills": [c for c in match["candidates"] if c["match"] == "exact"],
        "near_misses": [c for c in match["candidates"] if c["match"] == "uncertain"],
        "missing_skill_opportunities": [] if match["decision"] == "skill" else [
            {"signature": sig["id"], "kinds": kinds, "why": match["why"],
             "how": "solve once with the agent (verified), then propose_skill -> hidden validation -> human approve"}],
        "relevant_procedures": {"authority": "none: retrieved metadata, never a grant", "results": procedures},
        "required_permissions": [{"action": a, "fields": sorted(s.get("fields", {})), "human_approval": s.get("requires_approval", True)}
                                 for a, s in policy.get("actions", {}).items()]
                                + [{"action": "subscribe to events from this environment", "human_approval": True},
                                   {"action": "any write to this environment", "human_approval": True}],
        "unverified_assumptions": [
            "evidence 'trusted' flags come from the fixture file; trust was not independently established",
            "policy (writable fields, limits) comes from the fixture file, not from the environment owner",
            "rules other than the built-in sum_lines are attested only by a pinned host verifier; without one their "
            "records stay unverifiable: " + json.dumps(sorted({i['rule'] for i in policy.get('invariants', [])} - {"sum_lines"})),
            "record kinds/sources are labels only; equal labels do not prove equal business meaning"],
        "writes_performed": 0,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("scenario")
    p.add_argument("--db")
    p.add_argument("--namespace", action="append", default=[], help="catalog namespaces the reader may see")
    a = p.parse_args()
    who = {"namespaces": a.namespace, "roles": ["analyst"]} if a.namespace else None
    print(json.dumps(manifest(a.scenario, a.db, who), indent=2, default=str))
