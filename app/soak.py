"""Mock soak test: repeated mixed trials with injected faults, checking invariants after EVERY trial.
MOCK agent and in-process faults: proves the plumbing's failure behaviour, not model quality or hardware.

  python -m app soak --trials 30 [--seed 7]
"""
import json
import random
import sqlite3
import tempfile
import threading
import time
import traceback
from http.server import HTTPServer
from pathlib import Path

from app import bench, db, ops, server, skillforge as sf, tools

WRONG_SKILL_CASES = {"incompatible", "malformed", "lookalike_fingerprint"}  # a 'skill' decision here = incorrect match
STEPS = ["trial", "trial", "duplicate_execute", "crash_before_verify", "service_restart", "db_locked", "no_model"]


def invariants(conn):
    """Authoritative-state checks that must hold no matter what failed."""
    bad = []
    dup = conn.execute("SELECT action_id FROM executions GROUP BY action_id HAVING COUNT(*) > 1").fetchall()
    if dup:
        bad.append(f"duplicate executions {[r[0] for r in dup]}")
    rogue = conn.execute("SELECT e.action_id FROM executions e JOIN actions a ON a.id = e.action_id "
                         "LEFT JOIN approvals p ON p.action_id = a.id "
                         "WHERE COALESCE(p.status, '') != 'approved'").fetchall()
    if rogue:
        bad.append(f"executed without approval {[r[0] for r in rogue]}")
    if conn.execute("SELECT COUNT(*) FROM actions WHERE status='executed'").fetchone()[0] != \
            conn.execute("SELECT COUNT(*) FROM executions").fetchone()[0]:
        bad.append("executed actions != execution rows")
    if conn.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        bad.append("integrity")
    return bad


def run(trials=30, seed=7):
    rng = random.Random(seed)
    work = Path(tempfile.mkdtemp(prefix="soak-"))
    import os
    os.environ["APP_DB"] = str(work / "soak.db")
    sf.SKILLS_DIR = work / "skills"
    conn = db.connect()
    learning = bench.learn(conn, bench.MockAgent())
    m = {"trials": 0, "completed": 0, "correct": 0, "safe_escalations": 0, "incorrect_matches": 0,
         "duplicate_mutations": 0, "unrecovered": 0, "unexpected_exceptions": 0, "invariant_violations": [],
         "by_step": {}, "learning_approved": learning["approved"]}
    t0 = time.perf_counter()
    for i in range(trials):
        step = rng.choice(STEPS)
        case = rng.choice(list(bench.CASES))
        m["trials"] += 1
        m["by_step"][step] = m["by_step"].get(step, 0) + 1
        try:
            ok = STEP_FNS[step](conn, case, rng, i, m)
            m["completed"] += 1
            m["correct"] += bool(ok)
            if not ok:
                m.setdefault("incorrect", []).append(f"#{i} {step}/{case}")
        except Exception:
            m["unexpected_exceptions"] += 1
            m.setdefault("exceptions", []).append(f"#{i} {step}/{case}: {traceback.format_exc(limit=3)[-400:]}")
            if tools.current_task_id(conn):
                conn.execute("UPDATE tasks SET status='aborted' WHERE status='open'")
        bad = invariants(conn)
        if bad:
            m["invariant_violations"].append({"trial": i, "step": step, "violations": bad})
            m["duplicate_mutations"] += any("duplicate" in b for b in bad)
    m["unrecovered"] = len(ops.status(conn)["workflows_by_state"].get("VERIFYING", []))
    m["seconds"] = round(time.perf_counter() - t0, 1)
    try:
        import resource
        m["max_rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    except ImportError:
        m["max_rss_mb"] = None  # not available on Windows; unknown, not 0
    m["clean"] = (m["unexpected_exceptions"] == 0 and not m["invariant_violations"] and m["incorrect_matches"] == 0
                  and m["unrecovered"] == 0 and m["correct"] == m["trials"])
    m["db"] = os.environ["APP_DB"]
    return m


# ---- steps: each returns True when the outcome was correct ------------------------------------------

def s_trial(conn, case, rng, i, m):
    row = bench.trial(conn, rng.choice("AC"), case, bench.MockAgent(), i)
    if row["decision"] == "skill" and case in WRONG_SKILL_CASES:
        m["incorrect_matches"] += 1
    m["safe_escalations"] += bool(row["fallback"])
    if case == "skill_fails_verification" and not row["correct"]:
        # post-execution drift: the MOCK agent in A/B doesn't react to a failed verification (only C self-corrects).
        # Acceptable only if the failure is visible: the verifier recorded passed=0 (NEEDS_REVIEW), no false success.
        return row["mode"] in ("A", "B") and row["verifications_failed"] and             "NEEDS_REVIEW" in ops.status(conn)["workflows_by_state"]
    return row["correct"]


def _approved_action(conn):
    db.load_scenario(conn)
    a = tools.call(conn, "propose_action", {"record_id": "REC-001", "action_type": "set_field",
                                            "params": {"field": "quantity", "value": 100}, "reason": "soak"})
    tools.call(conn, "request_approval", {"action_id": a["action"]["id"]})
    tools.decide_approval(conn, a["action"]["id"], True, "soak-human")
    return a["action"]["id"]


def s_duplicate(conn, case, rng, i, m):
    aid = _approved_action(conn)
    r = [tools.call(conn, "execute_action", {"action_id": aid}) for _ in range(3)]
    return [x["already_executed"] for x in r] == [False, True, True] and \
        tools.call(conn, "verify_action", {"action_id": aid})["passed"]


def s_crash_before_verify(conn, case, rng, i, m):
    aid = _approved_action(conn)
    tools.call(conn, "execute_action", {"action_id": aid})  # "crash" here; new process recovers
    rec = ops.recover(db.connect())
    return {"action_id": aid, "passed": True} in rec["verified_after_restart"]


def s_service_restart(conn, case, rng, i, m):
    aid = _approved_action(conn)
    srv = HTTPServer(("127.0.0.1", 0), server.Handler)
    srv.token = "soak"
    port = srv.server_port
    srv.server_close()  # service "down"
    results = {}

    def call():
        import urllib.request
        from adapters.openclaw import client as cl
        req = urllib.request.Request(f"http://127.0.0.1:{port}/call", method="POST",
                                     data=json.dumps({"tool": "execute_action", "args": {"action_id": aid}}).encode(),
                                     headers={"Authorization": "Bearer soak", "Content-Type": "application/json"})
        results["r"] = cl.send(req, retries=3)

    t = threading.Thread(target=call)
    t.start()
    time.sleep(1.2)
    srv2 = HTTPServer(("127.0.0.1", port), server.Handler)  # service back on the same port
    srv2.token = "soak"
    threading.Thread(target=srv2.serve_forever, daemon=True).start()
    t.join(30)
    srv2.shutdown()
    srv2.server_close()
    again = tools.call(conn, "execute_action", {"action_id": aid})
    verified = tools.call(conn, "verify_action", {"action_id": aid})["passed"]
    return bool(results.get("r", {}).get("ok")) and again["already_executed"] and verified


def s_db_locked(conn, case, rng, i, m):
    aid = _approved_action(conn)
    import os
    conn.execute("PRAGMA busy_timeout = 100")
    b = sqlite3.connect(os.environ["APP_DB"], isolation_level=None)
    b.execute("BEGIN EXCLUSIVE")
    try:
        first = tools.call(conn, "execute_action", {"action_id": aid})
    finally:
        b.execute("ROLLBACK")
        b.close()
        conn.execute("PRAGMA busy_timeout = 5000")
    second = tools.call(conn, "execute_action", {"action_id": aid})
    verified = tools.call(conn, "verify_action", {"action_id": aid})["passed"]
    return first.get("error", {}).get("code") == "db_busy" and second["ok"] and not second["already_executed"] and verified


def s_no_model(conn, case, rng, i, m):
    scenario, _, _ = bench.CASES[case]
    db.load_scenario(conn, bench.LEARN / scenario)
    r = ops.fastpath(conn)
    if r["decision"] == "escalate":
        m["safe_escalations"] += 1
        return case not in ("known_compatible", "unseen_compatible", "boundary", "skill_fails_verification")
    if case in WRONG_SKILL_CASES:
        m["incorrect_matches"] += 1
        return False
    for aid in r["awaiting_approval"]:
        tools.decide_approval(conn, aid, True, "soak-human")
    return ops.fastpath(conn, execute=True)["ok"]


STEP_FNS = {"trial": s_trial, "duplicate_execute": s_duplicate, "crash_before_verify": s_crash_before_verify,
            "service_restart": s_service_restart, "db_locked": s_db_locked, "no_model": s_no_model}
