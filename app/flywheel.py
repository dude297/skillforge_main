"""MOCK flywheel benchmark: proves the SkillForge PLUMBING end to end without a model.

Everything the "agent" does here is a fixed script, and the skill it submits is a MOCK-AUTHORED fixture
(tests/fixtures/mock_authored_skill). Model calls are therefore 0 by construction and say nothing about
learning. The real acceptance test (local model discovers and writes the skill) is in docs/SKILLFORGE.md.
"""
from pathlib import Path

from app import db, skillforge as sf, tools
from app.db import ROOT

FIXTURE = ROOT / "tests" / "fixtures" / "mock_authored_skill"            # efficient
NAIVE = ROOT / "tests" / "fixtures" / "mock_authored_skill_naive"     # correct but wasteful
LEARN = ROOT / "data" / "learning"


def _human_approves_all(conn, approver):
    for a in tools.pending_approvals(conn)["pending"]:
        tools.decide_approval(conn, a["id"], True, approver)


def _execute_and_verify_approved(conn):
    for a in conn.execute("SELECT id FROM actions WHERE status='approved' ORDER BY id").fetchall():
        tools.call(conn, "execute_action", {"action_id": a["id"]})
        tools.call(conn, "verify_action", {"action_id": a["id"]})


def run(conn, approver="demo-operator", fixture=NAIVE, optimized=FIXTURE):
    rows = []

    # 1) BEFORE: unfamiliar problem, solved step by step (scripted stand-in for model reasoning)
    db.load_scenario(conn, LEARN / "learn_a.json")
    sf.task_begin(conn, "before-learning (scenario A)", "mock")
    tools.call(conn, "search_skills", {"query": "record total mismatch"})  # nothing approved yet
    recs = tools.call(conn, "read_records", {})["records"]
    for r in recs:
        inv = tools.call(conn, "investigate", {"record_id": r["id"]})
        for e in inv["evidence"]:  # MOCK "reasoning": the inference a model would have to make
            if e["trusted"] and "lines" in e["data"]:
                expected = sum(e["data"]["lines"]) / e["data"].get("scale", 1)
                if abs(r["data"]["total"] - expected) > 1e-9:
                    a = tools.call(conn, "propose_action", {"record_id": r["id"], "action_type": "set_field",
                                                            "params": {"field": "total", "value": expected},
                                                            "reason": "line items / scale disagree with total"})
                    tools.call(conn, "request_approval", {"action_id": a["action"]["id"]})
    _human_approves_all(conn, approver)
    _execute_and_verify_approved(conn)
    sf.task_mark(conn, "solved")
    proposal = tools.call(conn, "propose_skill", {"name": "line-total-reconcile", "path": str(fixture),
                                                  "description": "recompute record total from trusted line items / scale",
                                                  "tags": ["reconcile", "total", "lines"]})
    sf.task_mark(conn, "skill_generated")
    optimized_proposal = None
    if proposal.get("status") == "tested" and proposal.get("profile", {}).get("recommended"):
        # bounded optimization: ONE revision, driven by the profile evidence returned above
        optimized_proposal = tools.call(conn, "propose_skill", {
            "name": "line-total-reconcile", "path": str(optimized), "optimizes": proposal["version"],
            "description": "recompute record total from trusted line items / scale (indexed)",
            "tags": ["reconcile", "total", "lines"]})
    rows.append(sf.task_end(conn, model_calls=None))
    if proposal.get("status") == "tested":
        sf.approve_skill(conn, "line-total-reconcile", proposal["version"], approver)  # original kept for rollback
    if optimized_proposal and optimized_proposal.get("status") == "tested":
        sf.approve_skill(conn, "line-total-reconcile", optimized_proposal["version"], approver)

    # 2) AFTER: same problem, new data -> discovered skill, deterministic run, same gates
    db.load_scenario(conn, LEARN / "learn_b.json")
    sf.task_begin(conn, "after-learning (scenario B)", "mock")
    hit = tools.call(conn, "search_skills", {"query": "record total mismatch"})
    if hit["skills"] and hit["skills"][0]["compatible"]:
        tools.call(conn, "run_skill", {"name": hit["skills"][0]["name"], "propose": True})
    _human_approves_all(conn, approver)
    _execute_and_verify_approved(conn)
    rows.append(sf.task_end(conn, model_calls=None))

    # 3) UNRELATED: similar-looking data, different problem -> skill must be refused
    db.load_scenario(conn, LEARN / "unrelated.json")
    sf.task_begin(conn, "unrelated (mixed currency)", "mock")
    hit = tools.call(conn, "search_skills", {"query": "record total mismatch"})
    misuse = tools.call(conn, "run_skill", {"name": "line-total-reconcile", "propose": True})
    rows.append(sf.task_end(conn, model_calls=None))
    ids = {r["task_id"] for r in rows}
    return {"proposal": proposal, "optimized_proposal": optimized_proposal, "tasks": [t for t in sf.task_list(conn)["tasks"] if t["id"] in ids], "unrelated_search": hit, "unrelated_run": misuse,
            "skills": sf.list_skills(conn)["skills"]}


def compare_reuse(conn, name, versions, trials=5, approver="demo-operator"):
    """Same workload (scenario B), end to end through the tool layer, once per trial per version.
    Mode A (agentic, no skill) needs the real model: not measured here."""
    runs = {v: {"lat": [], "calls": [], "ok": []} for v in versions}
    for i in range(trials):
        for v in (versions if i % 2 == 0 else versions[::-1]):  # interleave + alternate order: no warm-up bias
            db.load_scenario(conn, LEARN / "learn_b.json")
            sf.task_begin(conn, f"reuse {name}@v{v} trial {i + 1}", "mock")
            tools.call(conn, "run_skill", {"name": name, "propose": True, "version": v})
            _human_approves_all(conn, approver)
            _execute_and_verify_approved(conn)
            t = sf.task_end(conn)
            runs[v]["lat"].append(t["latency_s"] * 1000)
            runs[v]["calls"].append(t["tool_calls"])
            runs[v]["ok"].append(t["success"])
    out = {}
    for v, r in runs.items():
        med, mad = sf._stats(r["lat"][1:])
        out[v] = {"first_trial_ms": round(r["lat"][0], 1), "median_ms_rest": med, "mad_ms_rest": mad,
                  "tool_calls": sorted(set(r["calls"])), "success_rate": sum(r["ok"]) / len(r["ok"])}
    return out


def table(tasks):
    cols = ["id", "label", "mode", "model_calls", "tool_calls", "duplicate_tool_calls", "db_queries", "data_bytes",
            "latency_s", "actions_executed", "verifications_passed", "invariant_violations", "success", "skills_used"]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for t in tasks:
        lines.append("| " + " | ".join("n/a" if t.get(c) is None else str(t.get(c)) for c in cols) + " |")
    return "\n".join(lines)


def bench_table(rows):
    cols = ["version", "size", "records", "correct", "cold_median_ms", "cold_mad_ms", "first_call_ms",
            "warm_median_ms", "warm_mad_ms", "work_line_events"]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join(str(r[c]) for c in cols) + " |" for r in rows]
    return "\n".join(lines)
