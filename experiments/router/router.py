"""EXPERIMENT (exp/router): deterministic-first event router. Never imported by app/ or adapters/.

One structured event in -> one of five durable decisions, with NO model call on the routing path:

  awaiting_approval  exactly one approved skill matches on every signature part; it PROPOSED actions, a human
                     must still approve each one, then `complete` executes + verifies (core tools, unchanged)
  queued_for_agent   unfamiliar work and local inference answers a health check: hand to the agent
  needs_human        ambiguous match, skill refused/conflicting/out-of-scope output: a person decides
  refused            event fails the trusted schema / source allowlist
  deferred           needs the agent but inference is down, or the host is busy with another event's open work

Reuses, does not copy: sf.match_skills (fingerprints), run_skill(propose=True) (integrity, shape, signature,
Docker/subprocess runner, policy, approval request), bench.preflight, ops.fastpath(execute=True) (execute+verify),
ops.recover, ops.workflow_state, db.audit.

  python -m experiments.router.router route '{"event_id":"e1","source":"ops-fixture","type":"reconcile.requested","scenario":"learn_b.json"}'
  python -m experiments.router.router complete e1
  python -m experiments.router.router list
"""
import hashlib
import json
import os
import re
import sys
import time

from adapters import llm as llm_mod
from app import db, ops, skillforge as sf, tools
from app.bench import LEARN, preflight
from experiments.catalog import catalog

# Least-privilege event sources: a source may only emit the types listed, and only sees its own catalog namespace.
# Events carry a REFERENCE to host-owned data (a fixture file name), never data, policy or approvals.
SOURCES = {"ops-fixture": {"types": {"reconcile.requested"}, "namespace": "acme/records"},
           "freight-feed": {"types": {"reconcile.requested"}, "namespace": "acme/supply"},
           "finance-feed": {"types": {"reconcile.requested"}, "namespace": "acme/finance"}}
FIXTURE_DIRS = (LEARN, db.ROOT / "experiments" / "catalog" / "fixtures", db.ROOT / "experiments" / "ops_discrepancy" / "cases")
EVENT_KEYS = {"event_id", "source", "type", "scenario"}
ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
SCENARIO_RE = re.compile(r"^[a-z0-9_-]{1,60}\.json$")
OPEN_STATES = {"PENDING", "WAITING_APPROVAL", "READY", "VERIFYING"}
RESUMABLE = {"received", "deferred"}  # redelivery of these re-routes; anything else returns the stored decision

SCHEMA = """CREATE TABLE IF NOT EXISTS router_events (
  event_id TEXT PRIMARY KEY, body_sha TEXT NOT NULL, source TEXT, type TEXT, scenario TEXT,
  status TEXT NOT NULL, reason TEXT, actions TEXT, signature TEXT, router_model_calls INTEGER,
  route_ms REAL, received_at REAL NOT NULL, decided_at REAL, suggestions TEXT,
  kind TEXT,  -- why, as a closed vocabulary for user-facing text (explain); `reason` stays operator-facing
  held TEXT)  -- records nobody may call handled: {record_id: {status, reason}}"""


def inference_up():
    """Deterministic health check (GET /models), not a generation. Unset/mock endpoint = not available."""
    if os.environ.get("LLM_BASE_URL", "mock") == "mock":
        return False
    os.environ.setdefault("LLM_RETRIES", "0")
    try:
        llm_mod.from_env().health()
        return True
    except llm_mod.LLMUnavailable:
        return False


def _validate(event):
    if not isinstance(event, dict) or set(event) != EVENT_KEYS:
        return f"event must have exactly {sorted(EVENT_KEYS)}"
    if not all(isinstance(event[k], str) for k in EVENT_KEYS):
        return "all event fields must be strings"
    if not ID_RE.match(event["event_id"]):
        return "bad event_id"
    if event["type"] not in SOURCES.get(event["source"], {}).get("types", ()):
        return f"source '{event['source']}' may not emit '{event['type']}'"
    if not SCENARIO_RE.match(event["scenario"]) or not _fixture(event["scenario"]):
        return "scenario must name a host-owned fixture"
    return None


def _fixture(name):
    return next((d / name for d in FIXTURE_DIRS if (d / name).is_file()), None)


def _principal(event):
    return {"namespaces": [SOURCES[event["source"]]["namespace"]], "roles": ["router"]}


def _row(conn, event_id):
    r = conn.execute("SELECT * FROM router_events WHERE event_id=?", (event_id,)).fetchone()
    return dict(r, actions=json.loads(r["actions"] or "[]"), suggestions=json.loads(r["suggestions"] or "[]"),
                held=json.loads(r["held"] or "{}")) if r else None


def _decide(conn, eid, status, reason, t0, actions=(), signature=None, suggestions=(), kind=None, held=None):
    conn.execute("UPDATE router_events SET status=?, reason=?, actions=?, signature=?, router_model_calls=0, route_ms=?, "
                 "decided_at=?, suggestions=?, kind=?, held=? WHERE event_id=?",
                 (status, reason, json.dumps(list(actions)), signature, round((time.perf_counter() - t0) * 1000, 3),
                  time.time(), json.dumps(list(suggestions)), kind or status, json.dumps(held or {}), eid))
    db.audit(conn, "router", f"route_{status}", {"event_id": eid, "reason": reason, "actions": list(actions),
                                                  "kind": kind or status})
    return _row(conn, eid)


def _busy(conn):
    """Single flight: loading an event's data replaces the domain tables, so never while other work is open.
    ponytail: one event at a time; per-record locking when events stop being whole-dataset fixtures."""
    return any(f["state"] in OPEN_STATES for f in ops._workflows(conn)) or tools.current_task_id(conn) is not None


def _task_open(conn, event):
    """Open (or, after a crash, resume) this event's core task, so console History and the World see a router run
    under one task id like any other run, labelled 'deterministic' (fixed skill code; no model, no agent). Only the
    skill path opens one: nothing else runs anything here.
    ponytail: the event is named in the label; a router_events.task_id column if labels stop being enough."""
    mark = f"event {event['event_id']}"
    tid = tools.current_task_id(conn)
    if tid is None:
        sf.task_begin(conn, f"Routed {event['scenario'].removesuffix('.json')} - {mark}", "deterministic")  # no model, no agent
    elif not conn.execute("SELECT label FROM tasks WHERE id=?", (tid,)).fetchone()["label"].endswith(mark):
        raise RuntimeError("another task is open")  # unreachable while _busy holds; never adopt someone else's task


def _task_close(conn, event_id):
    """Close this event's task once the event reached a terminal decision. model_calls=0 is a fact here, not a
    default: the router path has no model client."""
    tid = tools.current_task_id(conn)
    if tid and conn.execute("SELECT label FROM tasks WHERE id=?", (tid,)).fetchone()["label"].endswith(f"event {event_id}"):
        sf.task_end(conn, model_calls=0)


def route(conn, event, inference_ok=inference_up):
    conn.execute(SCHEMA)
    t0 = time.perf_counter()
    bad = _validate(event)
    if bad:
        db.audit(conn, "router", "route_refused", {"reason": bad, "event_id": str((event or {}).get("event_id"))[:80]
                                                  if isinstance(event, dict) else None})
        return {"status": "refused", "reason": bad}
    eid, sha = event["event_id"], hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()
    prior = _row(conn, eid)
    if prior and prior["body_sha"] != sha:
        db.audit(conn, "router", "route_refused", {"event_id": eid, "reason": "event_id reused with different content"})
        return {"status": "refused", "reason": "event_id reused with different content", "stored": prior}
    if prior and prior["status"] not in RESUMABLE:
        return {**prior, "duplicate": True}
    if not prior:
        conn.execute("INSERT INTO router_events (event_id, body_sha, source, type, scenario, status, received_at) "
                     "VALUES (?, ?, ?, ?, ?, 'received', ?)", (eid, sha, event["source"], event["type"],
                                                               event["scenario"], time.time()))
    loaded = (conn.execute("SELECT value FROM meta WHERE key='router_event'").fetchone() or [None])[0] == eid
    if not loaded:  # resuming after a crash skips the reload: actions already filed for this event survive
        if _busy(conn):
            return _decide(conn, eid, "deferred", "busy: other open work (approval/execution/task) on this host", t0,
                           kind="busy")
        db.load_scenario(conn, _fixture(event["scenario"]))
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('router_event', ?)", (eid,))

    m, who = sf.match_skills(conn), _principal(event)
    if m["decision"] == "skill":
        gate = catalog.check_exact(conn, m["skill"]["name"], who, m)  # approved+fresh+hash+namespace+env+exact
        if not gate["executable"]:
            return _decide(conn, eid, "needs_human", "exact fingerprint but not executable: " + "; ".join(gate["reasons"]),
                           t0, signature=m["signature"], kind=gate.get("kind", "not_authorized"))
        _task_open(conn, event)
        with tools.acting_for(who["namespaces"][0], who["roles"]):  # the source's namespace, from SOURCES (trusted)
            run = tools.call(conn, "run_skill", {"name": m["skill"]["name"], "propose": True})
        if not run.get("ok") or not preflight(conn, run):
            _task_close(conn, eid)
            return _decide(conn, eid, "needs_human", "skill refused, conflicting or out-of-scope: "
                           + json.dumps(run.get("error") or run.get("errors"))[:400], t0, signature=m["signature"],
                           kind="conflict")
        ids = [a["id"] for a in run["actions"]]
        held = {k: v for k, v in run.get("outcomes", {}).items() if v["status"] in sf.REFUSAL_CODES}
        if ids:  # the task stays open while a person decides: the console shows "Waiting for you"
            return _decide(conn, eid, "awaiting_approval", f"exact match {run['skill']}", t0, ids, m["signature"], held=held)
        _task_close(conn, eid)
        held |= _unresolved(conn)  # nothing proposed: "no change needed" only if the VERIFIER finds nothing wrong
        if held:
            return _decide(conn, eid, "needs_human", f"{run['skill']} proposed nothing; {len(held)} record(s) unresolved",
                           t0, signature=m["signature"], kind="records_need_person", held=held)
        return _decide(conn, eid, "completed", f"exact match {run['skill']}: verifier finds nothing to change", t0,
                       signature=m["signature"], kind="no_change_verified")
    if m["why"].startswith("ambiguous"):
        return _decide(conn, eid, "needs_human", m["why"], t0, signature=m["signature"], kind="ambiguous")
    stale = catalog.stale_exact(conn, m["signature"], who)
    if stale:  # it used to be routine, but a dependency changed: revalidate, don't guess and don't hand to the agent
        return _decide(conn, eid, "needs_human", "revalidation required: " + json.dumps(stale)[:400], t0,
                       signature=m["signature"], kind="stale")
    hints = [{k: r[k] for k in ("name", "version", "registry", "freshness")}  # context for the agent, NOT authority
             for r in catalog.search(conn, catalog.event_query(conn), who, 3)["results"]]
    if inference_ok():
        return _decide(conn, eid, "queued_for_agent", m["why"], t0, signature=m["signature"], suggestions=hints)
    return _decide(conn, eid, "deferred", f"{m['why']}; local inference unavailable (no cloud fallback)", t0,
                   signature=m["signature"], suggestions=hints, kind="inference_down")


def complete(conn, event_id):
    """After the human decided: execute + verify this event's approved actions. Executes nothing while any approval
    is pending, and never an action approved by 'policy' instead of a person (a match is not an authorization)."""
    conn.execute(SCHEMA)
    ev = _row(conn, event_id)
    if not ev or ev["status"] != "awaiting_approval":
        return {"ok": False, "status": ev and ev["status"], "reason": "event is not awaiting approval"}
    approvals = {r["action_id"]: r for r in conn.execute(
        f"SELECT action_id, status, decided_by FROM approvals WHERE action_id IN ({','.join('?' * len(ev['actions']))})",
        ev["actions"])}
    if any(approvals.get(i) is None or approvals[i]["status"] == "pending" for i in ev["actions"]):
        return {"ok": False, "status": "awaiting_approval", "reason": "approval still pending; nothing executed"}
    if any(a["status"] == "approved" and a["decided_by"] == "policy" for a in approvals.values()):
        _task_close(conn, event_id)
        _decide(conn, event_id, "needs_human", "auto-approved by policy; router requires a human approval", time.perf_counter())
        return {"ok": False, "status": "needs_human"}
    ops.fastpath(conn, execute=True)
    rows = {r["id"]: r for r in conn.execute(f"SELECT * FROM actions WHERE id IN ({','.join('?' * len(ev['actions']))})",
                                             ev["actions"])}
    if any(ops.workflow_state(conn, r) == "VERIFYING" for r in rows.values()):
        ops.recover(conn, by="router")  # an interrupted verify from an earlier attempt
    states = {i: ops.workflow_state(conn, rows[i]) for i in ev["actions"]}
    held = ev["held"] | _unresolved(conn)  # records still wrong or unverifiable after the approved changes
    status = "needs_review" if "NEEDS_REVIEW" in states.values() else \
             ("completed_partial" if held else "completed") if "COMPLETED" in states.values() else "cancelled"
    conn.execute("UPDATE router_events SET status=?, reason=?, kind=?, held=? WHERE event_id=?",
                 (status, json.dumps(states), status, json.dumps(held), event_id))
    db.audit(conn, "router", f"event_{status}", {"event_id": event_id, "states": states, "held": sorted(held)})
    _task_close(conn, event_id)
    return {"ok": status == "completed", "status": status, "states": states, "held": held}


def _unresolved(conn):
    """Authoritative: records the verifier says are still wrong, or that it cannot attest."""
    return {v["record_id"]: {"status": "requires_review" if v.get("unverifiable") else "still_wrong",
                             "reason": v.get("reason") or f"{v['field']} does not satisfy {v['rule']}"}
            for v in tools.invariant_violations(conn)}


def explain(ev):
    """The employee-facing reply for a routed event. Built only from status, kind, counts and record ids of the
    employee's own data: never from internal reasons, other teams' skill names, namespaces or paths."""
    if not ev or ev.get("status") == "refused":
        return "This request can't be accepted from this source. Nothing was changed."
    n, held, k = len(ev.get("actions") or []), ev.get("held") or {}, ev.get("kind")
    people = "; ".join(f"{r}: {v.get('reason') or v['status'].replace('_', ' ')}" for r, v in sorted(held.items()))
    tail = f" Not changed, needs a person: {people}." if held else ""
    st = ev["status"]
    if st == "awaiting_approval":
        return (f"I found {n} change(s) that follow an approved procedure. They wait for an authorized approver; "
                f"I can't approve changes myself.{tail}")
    if st == "completed":
        return ("No change needed: the independent check found nothing wrong." if k == "no_change_verified" else
                f"Done: {n} change(s) applied after approval and independently verified.")
    if st == "completed_partial":
        return f"{n} change(s) applied after approval and independently verified.{tail}"
    if st == "needs_review":
        return "A change was applied but failed the independent check. A person must review it; nothing was retried."
    if st == "cancelled":
        return "The proposed change(s) were rejected. Nothing was changed."
    if st == "queued_for_agent":
        return "This is new to me. The local agent will investigate; any change will still need approval."
    if st == "deferred":
        return ("I'm finishing other work that waits for a person. Your request is saved; nothing was changed." if k == "busy"
                else "Local AI is offline, so I can't investigate yet. Your request is saved; nothing was changed.")
    return {"stale": "This looks routine, but a rule it depends on has changed. Nothing was changed; the procedure "
                     "must be revalidated by its owner first.",
            "not_authorized": "Your team has no approved automation for this. Nothing was changed; a person will look at it.",
            "not_executable": "The approved procedure can't run here right now. Nothing was changed; a person will look at it.",
            "records_need_person": f"Nothing was changed.{tail}",
            "ambiguous": "More than one procedure could apply. Nothing was changed; a person will choose.",
            "conflict": "Another change to the same records is already open. Nothing was changed; a person will decide.",
            }.get(k, "Nothing was changed; a person will look at it.")


def main(argv):
    conn = db.connect()
    if argv[:1] == ["route"]:
        res = route(conn, json.loads(argv[1]))
    elif argv[:1] == ["complete"]:
        res = complete(conn, argv[1])
    else:
        conn.execute(SCHEMA)
        res = [dict(r) for r in conn.execute("SELECT * FROM router_events ORDER BY received_at")]
    print(json.dumps(res, indent=2, default=str))


if __name__ == "__main__":
    main(sys.argv[1:])
