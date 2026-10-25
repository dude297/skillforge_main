"""EXPERIMENT: always-agent vs deterministic-first routing, on identical cases (app.bench.CASES).

  A  always-agent           bench.trial mode A (skills hidden; the agent investigates everything)
  B  deterministic-first    router.route; exact skill -> human approval -> complete; else the agent
  C  B with model down      router.route with inference unavailable; unfamiliar work is deferred, not guessed

Correctness is bench.correct (ground truth from the scenario's invariants, independent of every variant).
APPLICABLE is a human label per case (does the learned skill's meaning fit?), independent of the matcher; it is
what "false skill match" is measured against.

MOCK agent on a dev box: model calls for agent work are UNKNOWN (None), energy is UNKNOWN (None). The only
measured zero is structural: the router path makes no inference request (asserted in test_router.py).

  python -m experiments.router.compare [--trials 3]
"""
import argparse
import json
import statistics
import tempfile
import time
from pathlib import Path

from app import bench, db, skillforge as sf, tools
from experiments.router import router

APPLICABLE = {"known_compatible": True, "unseen_compatible": True, "boundary": True, "skill_fails_verification": True,
              "incompatible": False, "lookalike_fingerprint": False, "malformed": False,
              "skill_unavailable": False, "skill_disabled": False}  # malformed: refusing is the safe answer
SKILL_PATH = {"awaiting_approval", "completed", "needs_review"}


def _routed(conn, variant, case, n, agent):
    scenario, visibility, fault = bench.CASES[case]
    db.load_scenario(conn, bench.LEARN / scenario)
    before, human = bench.records_state(conn), [0.0]
    first_call = conn.execute("SELECT COALESCE(MAX(id), 0) FROM tool_calls").fetchone()[0]

    def approve():
        t0 = time.perf_counter()
        pend = tools.pending_approvals(conn)["pending"]
        for a in pend:
            tools.decide_approval(conn, a["id"], True, "bench-operator")
        human[0] += time.perf_counter() - t0
        return bool(pend)

    with bench.skills_state(conn, visibility), bench.fault_injection(conn, fault):
        t0 = time.perf_counter()
        r = router.route(conn, {"event_id": f"{variant}-{case}-{n}-{time.time_ns()}", "source": "ops-fixture",
                                "type": "reconcile.requested", "scenario": scenario},
                         inference_ok=(lambda: variant == "B"))
        status, model_calls = r["status"], 0
        if status == "awaiting_approval":
            approve()
            status = router.complete(conn, r["event_id"])["status"]
        elif status == "queued_for_agent":
            with bench.skills_state(conn, "hidden"):
                agent.run(conn, approve)
            model_calls = None  # mock agent: unknown, never 0
        wall = time.perf_counter() - t0 - human[0]
    return {"variant": variant, "case": case, "trial": n, "decision": r["status"], "final": status,
            "skill_path": r["status"] in SKILL_PATH, "correct": bench.correct(conn, before),
            "changed": bench.records_state(conn) != before, "automated_s": round(wall, 4), "model_calls": model_calls,
            "tool_calls": conn.execute("SELECT COUNT(*) FROM tool_calls WHERE id>?", (first_call,)).fetchone()[0],
            "route_ms": r.get("route_ms"), "energy_j": None}


def _agent(conn, case, n, agent):
    t = bench.trial(conn, "A", case, agent, n)
    return {"variant": "A", "case": case, "trial": n, "decision": "agent", "final": t["decision"], "skill_path": False,
            "correct": t["correct"], "changed": None, "automated_s": t["automated_s"], "model_calls": t["model_calls"],
            "tool_calls": t["tool_calls"], "route_ms": None, "energy_j": None}


def summarize(rows):
    out = []
    for v in "ABC":
        rs = [r for r in rows if r["variant"] == v]
        mc = [r["model_calls"] for r in rs]
        out.append({
            "variant": v, "n": len(rs), "correct": sum(r["correct"] for r in rs),
            "handled_without_inference": sum(r["skill_path"] and r["final"] == "completed" for r in rs),
            "escalated_to_agent": sum(r["decision"] == "queued_for_agent" for r in rs) if v != "A" else len(rs),
            "needs_human": sum(r["decision"] == "needs_human" or r["final"] == "needs_review" for r in rs),
            "deferred": sum(r["decision"] == "deferred" for r in rs),
            "false_skill_match": sum(r["skill_path"] and not APPLICABLE[r["case"]] for r in rs),
            "missed_skill": sum(APPLICABLE[r["case"]] and not r["skill_path"] for r in rs) if v != "A" else None,
            "wrong_change": sum(r["changed"] and not r["correct"] for r in rs if r["changed"] is not None),
            "median_automated_s": round(statistics.median(r["automated_s"] for r in rs), 4),
            "median_tool_calls": statistics.median(r["tool_calls"] for r in rs),
            "model_calls_total": None if any(x is None for x in mc) else sum(mc),
            "energy_j": None})
    return out


def run(trials=3, workdir=None):
    work = Path(workdir or tempfile.mkdtemp(prefix="router-cmp-"))
    import os
    os.environ["APP_DB"] = str(work / "cmp.db")
    sf.SKILLS_DIR = work / "skills"
    conn, agent = db.connect(), bench.MockAgent()
    bench.learn(conn, agent)
    from experiments.catalog import catalog
    catalog.register(conn, bench.SKILL_NAME, 1, "bench-operator", "acme/records", "records-ops", "records",
                     "reconciliation", ["router"])
    rows = []
    for n in range(1, trials + 1):
        for case in bench.CASES:
            order = "ABC" if n % 2 else "CBA"  # alternate: no warm-up bias for one variant
            rows += [_agent(conn, case, n, agent) if v == "A" else _routed(conn, v, case, n, agent) for v in order]
    res = {"agent": "mock", "real_model": False, "trials": trials, "summary": summarize(rows), "rows": rows}
    (work / "compare.json").write_text(json.dumps(res, indent=2, default=str))
    res["file"] = str(work / "compare.json")
    return res


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--trials", type=int, default=3)
    a = p.parse_args()
    res = run(a.trials)
    print("MOCK agent, dev box: plumbing evidence only. None = unknown (not measured), never 0.\n")
    cols = list(res["summary"][0])
    print("| " + " | ".join(cols) + " |\n|" + "---|" * len(cols))
    for s in res["summary"]:
        print("| " + " | ".join("unknown" if s[c] is None else str(s[c]) for c in cols) + " |")
    print("\nper case (variant: decision -> final, correct):")
    for case in bench.CASES:
        print(f"  {case:26}", "  ".join(f"{r['variant']}:{r['decision']}->{r['final']},{'ok' if r['correct'] else 'X'}"
                                       for r in res["rows"] if r["case"] == case and r["trial"] == 1))
    print(f"\nrows: {res['file']}")
