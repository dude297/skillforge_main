"""Host-side operator commands: diagnosis, crash recovery, no-model fast path, DB safety. Never runs in the sandbox.

Workflow state is DERIVED from the authoritative rows (actions, executions, verifications), not kept in a second
state table that could disagree with them:

  proposed -> PENDING        pending_approval -> WAITING_APPROVAL     approved -> READY (to execute)
  executed, no verification -> VERIFYING (interrupted: `recover` verifies it)
  executed, last verification passed -> COMPLETED      ... failed -> NEEDS_REVIEW (human; never auto-redone)
  rejected -> CANCELLED
EXECUTING is deliberately not durable: execute_action mutates + records the execution + flips status in ONE
transaction, so a crash leaves either READY (nothing happened) or VERIFYING (it happened), never in between.
"""
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from adapters import llm as llm_mod, models
from app import db, skillforge as sf, tools

STUCK_S = 30 * 60


def workflow_state(conn, action):
    if action["status"] == "executed":
        v = conn.execute("SELECT passed FROM verifications WHERE action_id=? ORDER BY id DESC LIMIT 1",
                         (action["id"],)).fetchone()
        return "VERIFYING" if v is None else ("COMPLETED" if v["passed"] else "NEEDS_REVIEW")
    return {"proposed": "PENDING", "pending_approval": "WAITING_APPROVAL", "approved": "READY",
            "rejected": "CANCELLED"}.get(action["status"], "FAILED")


def _workflows(conn):
    rows = conn.execute("SELECT id, status, record_id, origin, task_id, created_at FROM actions ORDER BY id").fetchall()
    return [{"action_id": r["id"], "record_id": r["record_id"], "origin": r["origin"], "task_id": r["task_id"],
             "state": workflow_state(conn, r), "created_at": r["created_at"]} for r in rows]


def _service_check():
    url = os.environ.get("APP_SERVICE_URL") or (f"http://{os.environ['BRIDGE']}:{os.environ.get('PORT', 8765)}/call"
                                                if os.environ.get("BRIDGE") else None)
    if not url:
        return {"ok": None, "detail": "unknown: set APP_SERVICE_URL or BRIDGE"}
    try:
        urllib.request.urlopen(urllib.request.Request(url, data=b"{}", method="POST"), timeout=5)
        return {"ok": False, "detail": "answered WITHOUT a token: wrong service?"}
    except urllib.error.HTTPError as e:
        return {"ok": e.code == 401, "detail": f"{url} -> HTTP {e.code} (401 expected without token)"}
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        return {"ok": False, "detail": f"{url} unreachable: {e} (runbook decision tree D5/D6)"}


def _sandbox_check():
    if not shutil.which("nemoclaw"):
        return {"ok": None, "detail": "unknown: nemoclaw not on PATH"}
    sb = os.environ.get("SANDBOX", "my-assistant")
    try:
        p = subprocess.run(["nemoclaw", sb, "status"], capture_output=True, text=True, timeout=30)
        return {"ok": p.returncode == 0, "detail": (p.stdout or p.stderr)[-200:]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "detail": "nemoclaw status timed out (runbook R1)"}


def _inference_check():
    if os.environ.get("LLM_BASE_URL", "mock") == "mock":
        return {"ok": None, "model": None, "detail": "unknown: LLM_BASE_URL not set"}
    os.environ.setdefault("LLM_RETRIES", "0")  # a diagnosis must answer quickly
    try:
        info = llm_mod.from_env().health()
    except llm_mod.LLMUnavailable as e:
        return {"ok": False, "model": None, "detail": f"{e} (runbook R1b; 401 -> LLM_API_KEY)"}
    allowed, why = models.learning_allowed(info["model"])
    return {"ok": True, "model": info["model"], "registered": (models.lookup(info["model"]) or {}).get("id"),
            "learning_allowed": allowed, "detail": why}


def status(conn):
    """One answer to: inference? sandbox? service? model? stuck work? skills? last workflow? what to do?"""
    now = time.time()
    flows = _workflows(conn)
    open_tasks = [dict(r) | {"age_s": round(now - r["started_at"])} for r in
                  conn.execute("SELECT id, label, mode, started_at FROM tasks WHERE status='open'")]
    last = conn.execute("SELECT id, label, mode, status, verifications_failed FROM tasks WHERE status!='open' "
                        "ORDER BY id DESC LIMIT 1").fetchone()
    by_state = {}
    for f in flows:
        by_state.setdefault(f["state"], []).append(f["action_id"])
    actions = []
    if by_state.get("VERIFYING"):
        actions.append(f"executed but never verified {by_state['VERIFYING']}: run `python -m app recover`")
    if by_state.get("NEEDS_REVIEW"):
        actions.append(f"verification FAILED {by_state['NEEDS_REVIEW']}: human review; `python -m app audit`")
    if by_state.get("WAITING_APPROVAL"):
        actions.append(f"awaiting approval {by_state['WAITING_APPROVAL']}: `python -m app pending` then approve/reject")
    stuck = [t for t in open_tasks if t["age_s"] > STUCK_S]
    if stuck:
        actions.append(f"task(s) open > {STUCK_S // 60} min {[t['id'] for t in stuck]}: `python -m app task end` "
                       "(or rerun bench: it closes its own stale tasks)")
    integrity = conn.execute("PRAGMA quick_check").fetchone()[0]
    if integrity != "ok":
        actions.append("DB integrity check FAILED: stop serve; `python -m app db restore <backup>`")
    out = {"inference": _inference_check(), "sandbox": _sandbox_check(), "host_service": _service_check(),
           "db": {"path": os.environ.get("APP_DB", str(db.DEFAULT_DB)), "quick_check": integrity},
           "open_tasks": open_tasks, "workflows_by_state": by_state,
           "approved_skills": [f"{s['name']}@v{s['version']}" for s in sf.list_skills(conn)["skills"]
                               if s["status"] == "approved" and s["active"]],
           "last_task": dict(last) if last else None, "next_actions": actions or ["nothing pending"]}
    return out


def recover(conn, by="recover"):
    """After a crash/restart. Verifies interrupted executions (read-only check of authoritative state, records the
    verification); NEVER re-executes, never approves. Uncertain outcomes are left for a human (NEEDS_REVIEW)."""
    verified = []
    for f in _workflows(conn):
        if f["state"] == "VERIFYING":
            r = tools.verify_action(conn, f["action_id"])
            verified.append({"action_id": f["action_id"], "passed": r["passed"]})
    db.audit(conn, f"operator:{by}", "recover", {"verified": verified})
    flows = _workflows(conn)
    return {"ok": True, "verified_after_restart": verified,
            "ready_to_execute": [f["action_id"] for f in flows if f["state"] == "READY"],
            "needs_review": [f["action_id"] for f in flows if f["state"] == "NEEDS_REVIEW"],
            "note": "READY actions are safe to (re)execute: execute_action is idempotent per action"}


def fastpath(conn, execute=False):
    """No-model mode: reuse ONE exactly-matching approved skill; same policy, human approval and verifier.
    Anything unfamiliar is escalated, never guessed and never sent to a cloud model."""
    from app.bench import preflight  # host-side harness check of skill output
    if execute:
        done = []
        for a in conn.execute("SELECT id FROM actions WHERE status='approved' AND origin LIKE 'skill:%' ORDER BY id"):
            tools.call(conn, "execute_action", {"action_id": a["id"]})
            done.append({"action_id": a["id"], **{k: v for k, v in tools.call(
                conn, "verify_action", {"action_id": a["id"]}).items() if k in ("passed", "hint")}})
        return {"ok": all(d["passed"] for d in done), "executed_and_verified": done}
    m = sf.match_skills(conn)
    if m["decision"] != "skill":
        db.audit(conn, "operator:fastpath", "escalated_no_model", {"level": m.get("level")})
        return {"ok": False, "decision": "escalate", "match": m.get("level"),
                "reason": "no approved skill matches this data exactly; agentic investigation needs the local model. "
                          "Escalate to a human (no cloud fallback)."}
    run = tools.call(conn, "run_skill", {"name": m["skill"]["name"], "propose": True})
    if not run.get("ok") or not preflight(conn, run):
        return {"ok": False, "decision": "escalate", "reason": "skill refused or produced out-of-scope output",
                "detail": run.get("error") or run.get("errors")}
    return {"ok": True, "decision": "skill", "skill": run["skill"],
            "awaiting_approval": [a["id"] for a in run["actions"]],
            "next": "python -m app approve <ids> --by <name>; then python -m app fastpath --execute"}


# ---- DB safety -------------------------------------------------------------------

def db_backup(conn, dest=None):
    dest = Path(dest or db.ROOT / "data" / "backups" / f"app-{time.strftime('%Y%m%d-%H%M%S')}.db")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(dest) as out:
        conn.backup(out)  # online, consistent snapshot (SQLite backup API), safe while serve runs
    return {"ok": True, "backup": str(dest), "integrity": _check(dest)}


def _check(path):
    c = sqlite3.connect(path)
    try:
        return c.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        c.close()


def _listening(url):
    """True if anything accepts a TCP connection at url's host:port. Deliberately not an HTTP check: a wrong, broken
    or slow service, or one that resets the connection, is still a live process that may hold the DB."""
    u = urllib.parse.urlsplit(url)
    try:
        socket.create_connection((u.hostname, u.port), timeout=2).close()
        return True
    except (OSError, ValueError):
        return False


def _running_services():
    """(still answering, agent service checked?). The agent service at APP_SERVICE_URL/BRIDGE when configured, and
    always on serve's default loopback port; the operator console on its loopback port (APP_UI_PORT, 8766)."""
    up = []
    url = os.environ.get("APP_SERVICE_URL") or (f"http://{os.environ['BRIDGE']}:{os.environ.get('PORT', 8765)}/call"
                                                if os.environ.get("BRIDGE") else None)
    for u in dict.fromkeys(filter(None, [url, f"http://127.0.0.1:{os.environ.get('PORT', 8765)}/call"])):
        if _listening(u):
            up.append(f"agent tool service (python -m app serve) at {u}")
    if _listening(f"http://127.0.0.1:{os.environ.get('APP_UI_PORT', 8766)}/ui/health"):
        up.append("operator console (python -m app ui)")
    return up, url is not None


def db_restore(src, services_stopped=False):
    """Restore a backup over APP_DB. OFFLINE ONLY (runbook R15): stop `serve` and `ui`, restore, check, start again.
    Refuses while either service still answers: a running agent could otherwise act on ids that now name different
    actions in the restored generation. If serve's address is not configured (APP_SERVICE_URL/BRIDGE) and nothing answers
    on loopback, it still refuses unless the operator states services_stopped (CLI --services-stopped): unknown is not
    "stopped". The current DB is kept as *.before-restore."""
    src, target = Path(src), Path(os.environ.get("APP_DB", db.DEFAULT_DB))
    running, agent_checked = _running_services()
    if running:
        return {"ok": False, "error": f"stop these first, then restore: {running}", "running": running}
    if not agent_checked and not services_stopped:
        return {"ok": False, "running": [], "error": "cannot check the agent service (set APP_SERVICE_URL or BRIDGE); "
                "stop `serve` and `ui`, then restore again with --services-stopped"}
    if _check(src) != "ok":
        return {"ok": False, "error": f"backup {src} fails integrity_check; not restoring"}
    if target.exists():
        keep = target.with_suffix(f".before-restore-{int(time.time())}.db")
        with sqlite3.connect(target) as cur, sqlite3.connect(keep) as k:
            cur.backup(k)
    with sqlite3.connect(src) as s, sqlite3.connect(target) as t:
        s.backup(t)
    checked = "agent service" if agent_checked else "agent service NOT checked: the operator stated it was stopped"
    return {"ok": True, "restored": str(target), "from": str(src), "integrity": _check(target),
            "services_checked": [checked, "operator console"],
            "next": "start serve/ui again, then `python -m app status`; reload any open console"}
