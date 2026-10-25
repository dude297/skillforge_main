"""Domain-neutral business tools. Every tool: (conn, **args) -> JSON-able dict, or raises ToolError.

Safety rules live HERE, in code, not in prompts:
- actions are validated against the scenario policy before they can exist
- execute_action refuses anything not approved by a human (decide_approval is not agent-callable)
- executions are UNIQUE per action, so retries never double-apply
- verify_action re-reads state from the DB; it never trusts what the agent reported
"""
import contextlib
import contextvars
import hashlib
import json
import os
import re
import sqlite3
import time
import types

from app.db import ROOT, audit


class ToolError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message

    def to_dict(self):
        return {"ok": False, "error": {"code": self.code, "message": self.message}}


def _policy(conn):
    row = conn.execute("SELECT value FROM meta WHERE key='policy'").fetchone()
    if not row:
        raise ToolError("not_initialized", "No scenario loaded. Run: python -m app reset")
    return json.loads(row["value"])


def _record(conn, record_id):
    if not isinstance(record_id, str) or not record_id:
        raise ToolError("invalid_input", "record_id must be a non-empty string")
    row = conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
    if not row:
        raise ToolError("not_found", f"record {record_id} not found")
    return {"id": row["id"], "kind": row["kind"], "data": json.loads(row["data"]), "updated_at": row["updated_at"]}


def _action(conn, action_id):
    if not isinstance(action_id, int) or isinstance(action_id, bool):
        raise ToolError("invalid_input", "action_id must be an integer")
    row = conn.execute("SELECT * FROM actions WHERE id=?", (action_id,)).fetchone()
    if not row:
        raise ToolError("not_found", f"action {action_id} not found")
    a = dict(row)
    a["params"] = json.loads(a["params"])
    return a


def _compare(conn, record):
    """Field-by-field comparison of a record against its trusted evidence."""
    evidence = [dict(e, data=json.loads(e["data"])) for e in
                conn.execute("SELECT source, data, trusted FROM evidence WHERE record_id=?", (record["id"],))]
    trusted = [e for e in evidence if e["trusted"]]
    findings = []
    for field in sorted({f for e in trusted for f in e["data"]} & set(record["data"])):  # only fields the record has
        seen = {e["source"]: e["data"][field] for e in trusted if field in e["data"]}
        values = set(json.dumps(v) for v in seen.values())
        current = record["data"].get(field)
        if len(values) > 1:
            findings.append({"field": field, "status": "conflicting_sources", "current": current, "sources": seen})
        elif json.loads(values.pop()) != current:
            findings.append({"field": field, "status": "mismatch", "current": current,
                             "expected": next(iter(seen.values())), "sources": seen})
    return evidence, findings


def _validate(policy, action_type, params, record):
    spec = policy.get("actions", {}).get(action_type)
    if spec is None:
        raise ToolError("policy_violation", f"action type '{action_type}' is not allowed")
    if action_type == "set_field":
        if set(params) != {"field", "value"}:
            raise ToolError("invalid_input", "set_field params must be exactly {field, value}")
        rule = spec["fields"].get(params["field"])
        if rule is None:
            raise ToolError("policy_violation", f"field '{params['field']}' may not be changed")
        v = params["value"]
        if rule["type"] == "number":
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                raise ToolError("invalid_input", "value must be a number")
            if v < rule.get("min", float("-inf")):
                raise ToolError("policy_violation", f"value below minimum {rule['min']}")
            cur = record["data"].get(params["field"])
            if isinstance(cur, (int, float)) and abs(v - cur) > rule.get("max_abs_change", float("inf")):
                raise ToolError("policy_violation", f"change exceeds max_abs_change {rule['max_abs_change']}")
        elif rule["type"] == "enum" and v not in rule["values"]:
            raise ToolError("policy_violation", f"value must be one of {rule['values']}")
    return spec


# ---- agent-callable tools -------------------------------------------------

def read_records(conn, record_id=None, kind=None):
    if record_id is not None:
        return {"ok": True, "records": [_record(conn, record_id)]}
    q, args = "SELECT id FROM records", ()
    if kind is not None:
        q, args = q + " WHERE kind=?", (kind,)
    return {"ok": True, "records": [_record(conn, r["id"]) for r in conn.execute(q + " ORDER BY id", args)]}


def investigate(conn, record_id):
    record = _record(conn, record_id)
    evidence, findings = _compare(conn, record)
    conn.execute("INSERT INTO investigations (record_id, findings) VALUES (?, ?)", (record_id, json.dumps(findings)))
    audit(conn, "agent", "investigate", {"record_id": record_id, "findings": len(findings)})
    return {"ok": True, "record": record, "evidence": evidence, "findings": findings,
            "summary": f"{len(findings)} direct field mismatch(es)" if findings else
            "no direct field mismatches; interpret the evidence yourself (derived values may still disagree)"}


def propose_action(conn, record_id, action_type, params, reason):
    return _propose(conn, record_id, action_type, params, reason, origin="agent")


def _propose(conn, record_id, action_type, params, reason, origin):
    if not isinstance(params, dict) or not isinstance(reason, str) or not reason.strip():
        raise ToolError("invalid_input", "params must be an object and reason a non-empty string")
    record = _record(conn, record_id)
    _validate(_policy(conn), action_type, params, record)
    # The current value is part of the key: the same fix against the same state dedups, but if the record later
    # drifts, the same correction can be proposed (and approved) again.
    current = record["data"].get(params.get("field")) if isinstance(params.get("field"), str) else None
    key = hashlib.sha256(json.dumps([record_id, action_type, params, current], sort_keys=True).encode()).hexdigest()
    existing = conn.execute("SELECT id FROM actions WHERE idempotency_key=?", (key,)).fetchone()
    if existing:
        return {"ok": True, "deduplicated": True, "action": _action(conn, existing["id"])}
    for other in conn.execute("SELECT id, params FROM actions WHERE record_id=? AND status IN "
                              "('proposed', 'pending_approval', 'approved')", (record_id,)):
        op = json.loads(other["params"])
        if op.get("field") == params.get("field") and op.get("value") != params.get("value"):
            # two open fixes disagreeing on one field: approving both would let the last executor silently win
            raise ToolError("conflict", f"action {other['id']} already proposes {op.get('field')}={op.get('value')!r} "
                                        "for this record; a human must reject one first")
    cur = conn.execute("INSERT INTO actions (record_id, type, params, reason, idempotency_key, origin, task_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (record_id, action_type, json.dumps(params), reason, key, origin, current_task_id(conn)))
    audit(conn, origin.split("#")[0], "propose_action", {"action_id": cur.lastrowid, "record_id": record_id, "params": params})
    return {"ok": True, "deduplicated": False, "action": _action(conn, cur.lastrowid)}


def request_approval(conn, action_id):
    action = _action(conn, action_id)
    if action["status"] != "proposed":
        return {"ok": True, "action": action, "note": f"already {action['status']}"}
    spec = _policy(conn)["actions"][action["type"]]
    conn.execute("BEGIN IMMEDIATE")
    if spec.get("requires_approval", True):
        conn.execute("INSERT INTO approvals (action_id) VALUES (?)", (action_id,))
        conn.execute("UPDATE actions SET status='pending_approval' WHERE id=?", (action_id,))
    else:
        conn.execute("INSERT INTO approvals (action_id, status, decided_by, decided_at) VALUES (?, 'approved', 'policy', datetime('now'))", (action_id,))
        conn.execute("UPDATE actions SET status='approved' WHERE id=?", (action_id,))
    audit(conn, "agent", "request_approval", {"action_id": action_id})
    conn.execute("COMMIT")
    return {"ok": True, "action": _action(conn, action_id),
            "note": "waiting for a human: python -m app approve <action_id> --by <name>"}


def execute_action(conn, action_id):
    _action(conn, action_id)  # not_found before taking the write lock
    conn.execute("BEGIN IMMEDIATE")  # every check below runs under the write lock: no check-then-act race
    try:
        action = _action(conn, action_id)
        prior = conn.execute("SELECT * FROM executions WHERE action_id=?", (action_id,)).fetchone()
        if prior:  # idempotent retry (or a lost acknowledgement): report the recorded outcome, never re-apply
            conn.execute("ROLLBACK")
            return {"ok": True, "already_executed": True, "before": json.loads(prior["before"]), "after": json.loads(prior["after"])}
        if action["status"] != "approved":
            audit(conn, "agent", "execute_refused", {"action_id": action_id, "status": action["status"]})
            conn.execute("COMMIT")
            raise ToolError("not_approved", f"action {action_id} is '{action['status']}', not 'approved'")
        record = _record(conn, action["record_id"])
        _validate(_policy(conn), action["type"], action["params"], record)  # re-check against current state
        before = dict(record["data"])
        after = dict(before, **{action["params"]["field"]: action["params"]["value"]})
        conn.execute("UPDATE records SET data=?, updated_at=datetime('now') WHERE id=?", (json.dumps(after), record["id"]))
        conn.execute("INSERT INTO executions (action_id, before, after) VALUES (?, ?, ?)", (action_id, json.dumps(before), json.dumps(after)))
        conn.execute("UPDATE actions SET status='executed' WHERE id=?", (action_id,))
        audit(conn, "agent", "execute_action", {"action_id": action_id, "before": before, "after": after})
        conn.execute("COMMIT")
    except ToolError as e:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise e
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {"ok": True, "already_executed": False, "before": before, "after": after}


def verify_action(conn, action_id):
    action = _action(conn, action_id)
    checks = []
    executed = conn.execute("SELECT 1 FROM executions WHERE action_id=?", (action_id,)).fetchone()
    checks.append({"check": "execution_recorded", "passed": bool(executed)})
    record = _record(conn, action["record_id"])  # fresh read from DB
    field, want = action["params"]["field"], action["params"]["value"]
    checks.append({"check": "field_has_target_value", "passed": record["data"].get(field) == want,
                   "actual": record["data"].get(field), "expected": want})
    _, findings = _compare(conn, record)
    checks.append({"check": "no_remaining_discrepancy_on_field", "passed": not any(f["field"] == field for f in findings)})
    held = []
    for v in invariant_violations(conn, record["id"], held):
        checks.append({"check": f"invariant:{v['rule']}:{v['field']}", "passed": False, **v})
    for h in held:  # business rules that covered this record and held: shown, so "verified" is never just generic
        checks.append({"check": f"business_rule:{h['rule']}", "passed": True, "by": h["by"]})
    ruled = {i["rule"] for i in _policy(conn).get("invariants", []) if i.get("field") == field}
    covered = {h["rule"] for h in held} | {c.get("rule") for c in checks if c["check"].startswith("invariant:")}
    for rule in sorted(ruled - covered):  # a business rule governs this field but nothing could check it on this record
        checks.append({"check": f"business_rule:{rule}", "passed": False, "unverifiable": True,
                       "reason": "no trusted evidence covers this record, so the rule could not be checked"})
    passed = all(c["passed"] for c in checks)
    hint = None
    if action["origin"].startswith("skill:"):  # feed the outcome back to the skill that produced this action
        run_id = int(action["origin"].rsplit("#", 1)[1])
        conn.execute(f"UPDATE skill_runs SET {'verified_pass' if passed else 'verified_fail'} = "
                     f"{'verified_pass' if passed else 'verified_fail'} + 1 WHERE id=?", (run_id,))
        if not passed:
            hint = (f"{action['origin'].split('#')[0]} produced an action that FAILED verification. Investigate this "
                    "record manually, then propose a revised version with propose_skill (same name).")
    conn.execute("INSERT INTO verifications (action_id, passed, details) VALUES (?, ?, ?)", (action_id, int(passed), json.dumps(checks)))
    audit(conn, "verifier", "verify_action", {"action_id": action_id, "passed": passed})
    return {"ok": True, "passed": passed, "checks": checks, **({"hint": hint} if hint else {})}


VERIFIERS = ROOT / "verifiers"  # trusted host-side domain verifiers; never shipped to the sandbox
_LOADED = {}


def _domain_verifier(rule):
    """The pinned verifier module for a rule, or ValueError. The file's sha256 must equal verifiers/pins.json."""
    f = VERIFIERS / f"{rule}.py"
    try:
        pins = json.loads((VERIFIERS / "pins.json").read_text(encoding="utf-8"))
        code = f.read_bytes()  # hash and execute the SAME bytes: no swap between the check and the load
        sha = hashlib.sha256(code).hexdigest()
    except (OSError, ValueError):
        raise ValueError(f"no trusted verifier for rule '{rule}' on this host")
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,40}", rule) or pins.get(rule) != sha:
        raise ValueError(f"verifier for '{rule}' is missing from pins.json or not the pinned version")
    if sha not in _LOADED:
        mod = types.ModuleType(f"verifier_{rule}")
        mod.__file__ = str(f)
        exec(compile(code, str(f), "exec"), mod.__dict__)
        if not (isinstance(getattr(mod, "SUPPORTS", None), dict) and callable(getattr(mod, "expected", None))):
            raise ValueError(f"verifier for '{rule}' lacks SUPPORTS/expected()")
        _LOADED[sha] = mod
    return _LOADED[sha]


def invariant_violations(conn, record_id=None, passed=None):
    """Ground-truth controls from the scenario policy, owned by humans, evaluated only by the verifier.
    Built in: 'sum_lines'. Any other rule needs a pinned domain verifier (verifiers/<rule>.py) whose SUPPORTS match the
    policy's business `context`; otherwise every record it covers is UNVERIFIABLE. An unknown rule is never skipped.
    passed: optional list that receives {record_id, rule, by} for every rule that covered a record AND held."""
    out = []
    policy = _policy(conn)
    for inv in policy.get("invariants", []):
        q, args = "SELECT * FROM records", ()
        if record_id:
            q, args = q + " WHERE id=?", (record_id,)
        for r in conn.execute(q, args):
            data = json.loads(r["data"])
            ev = conn.execute("SELECT data FROM evidence WHERE record_id=? AND source=? AND trusted=1",
                              (r["id"], inv["source"])).fetchone()
            if inv["rule"] == "sum_lines" and ev:
                e = json.loads(ev["data"])
                try:
                    expected = sum(e["lines"]) / e.get("scale", 1)
                    actual = float(data[inv["field"]])
                except (KeyError, TypeError, ValueError, ZeroDivisionError):  # malformed: cannot be verified
                    out.append({"record_id": r["id"], "rule": "sum_lines", "field": inv["field"], "unverifiable": True})
                    continue
                if abs(actual - expected) > 1e-9:
                    out.append({"record_id": r["id"], "rule": "sum_lines", "field": inv["field"],
                                "actual": data.get(inv["field"]), "expected": expected})
                elif passed is not None:
                    passed.append({"record_id": r["id"], "rule": "sum_lines", "by": "built-in verifier"})
            elif inv["rule"] != "sum_lines":
                rows = [json.loads(x["data"]) for x in conn.execute(
                    "SELECT data FROM evidence WHERE record_id=? AND source=? AND trusted=1", (r["id"], inv["source"]))]
                try:
                    mod = _domain_verifier(inv["rule"])
                    ctx = policy.get("context", {})
                    stale = [f"{k}={ctx.get(k, 'not declared')}" for k, ok in mod.SUPPORTS.items() if ctx.get(k) not in ok]
                    if stale:
                        raise ValueError(f"verifier {inv['rule']} v{mod.VERSION} was not validated for {', '.join(stale)}")
                    expected = mod.expected(r["id"], data, rows, inv)
                    if expected is None:
                        continue  # the rule does not cover this record
                    actual = float(data[inv["field"]])
                except Exception as e:  # noqa: BLE001  any verifier failure is outside what can be attested: never "verified"
                    out.append({"record_id": r["id"], "rule": inv["rule"], "field": inv["field"], "unverifiable": True,
                                "reason": str(e)[:200]})
                    continue
                if round(actual, 2) != round(expected, 2):
                    out.append({"record_id": r["id"], "rule": inv["rule"], "field": inv["field"],
                                "actual": data.get(inv["field"]), "expected": expected})
                elif passed is not None:
                    passed.append({"record_id": r["id"], "rule": inv["rule"], "by": f"pinned verifier v{mod.VERSION}"})
    return out


def freight_invoice(conn, record_id):
    """Read-only domain tool: the trusted carrier invoice export for one PO, parsed into header, lines and trailer,
    with the format checks a person would make. It reports; it decides nothing and changes nothing."""
    record = _record(conn, record_id)
    rows = conn.execute("SELECT data FROM evidence WHERE record_id=? AND source='carrier_export' AND trusted=1",
                        (record_id,)).fetchall()
    invoices = []
    for row in rows:
        inv, issues = {"header": None, "lines": [], "trailer": None}, []
        for ln in json.loads(row["data"]).get("lines", []):
            tok = ln.split(maxsplit=5)
            if not tok or tok[0].startswith("*"):
                continue
            if tok[0] == "HDR" and len(tok) >= 5:
                inv["header"] = {"invoice_id": tok[1], "po": tok[2], "currency": tok[3], "date": tok[4]}
            elif tok[0] == "LIN" and len(tok) >= 5:
                ok = len(tok[3]) == 9 and tok[3].isdigit() and tok[4] in ("D", "C")
                inv["lines"].append({"code": tok[2], "amount": int(tok[3]) / 100 if ok else tok[3], "dc": tok[4],
                                     "text": tok[5][:60] if len(tok) > 5 else ""})
                if not ok:
                    issues.append(f"malformed amount {tok[3]!r}")
            elif tok[0] == "TRL" and len(tok) >= 4:
                inv["trailer"] = {"count": tok[1], "control_total": tok[2], "dc": tok[3]}
            else:
                issues.append(f"unrecognised line {ln[:30]!r}")
        h, t = inv["header"], inv["trailer"]
        net = sum(x["amount"] * (1 if x["dc"] == "D" else -1) for x in inv["lines"] if isinstance(x["amount"], float))
        if not h or not t:
            issues.append("missing header or trailer")
        else:
            if h["po"] != record_id:
                issues.append(f"invoice references {h['po']}")
            if h["currency"] != record["data"].get("currency"):
                issues.append(f"invoice currency {h['currency']} != PO currency {record['data'].get('currency')}")
            if t["count"] != f"{len(inv['lines']):03d}":
                issues.append("trailer line count mismatch")
        unknown = sorted({x["code"] for x in inv["lines"]} - {"LHL", "FSC", "ACC"})
        if unknown:
            issues.append(f"unknown charge codes {unknown}")
        invoices.append({**inv, "lines_net": round(net, 2), "issues": issues})
    if len(invoices) > 1:
        invoices[0]["issues"].append("more than one invoice for this PO")
    audit(conn, "agent", "freight_invoice", {"record_id": record_id, "invoices": len(invoices)})
    return {"ok": True, "record": record, "invoices": invoices,
            "summary": "no trusted carrier invoice" if not invoices else
            f"{len(invoices)} invoice(s); issues: {invoices[0]['issues'] or 'none'}"}


def get_audit(conn, limit=50):
    """Scoped agent call: only the current task's events (other tasks may belong to other teams). Operator: all."""
    since = 0
    if agent_scope(conn):
        tid = current_task_id(conn)
        row = conn.execute("SELECT id FROM audit WHERE event='task_begin' AND json_extract(payload, '$.task_id')=? "
                           "ORDER BY id DESC LIMIT 1", (tid,)).fetchone() if tid else None
        if not row:
            return {"ok": True, "events": [], "note": "no open task: nothing to show in this workspace scope"}
        since = row["id"]
    rows = conn.execute("SELECT * FROM (SELECT * FROM audit WHERE id >= ? ORDER BY id DESC LIMIT ?) ORDER BY id",
                        (since, int(limit)))
    return {"ok": True, "events": [dict(r, payload=json.loads(r["payload"])) for r in rows]}


# ---- agent scope: which team's skills an agent call may see (TRUSTED context, never from tool arguments) -----------

_IN_AGENT_CALL = contextvars.ContextVar("in_agent_call", default=False)
_HOST_SCOPE = contextvars.ContextVar("host_scope", default=None)


@contextlib.contextmanager
def acting_for(namespace, roles):
    """A trusted HOST component (e.g. the event router) calling agent tools on behalf of a namespace it resolved itself
    (never from event or model text). Takes precedence over APP_AGENT_NAMESPACE for calls inside the block."""
    tok = _HOST_SCOPE.set((namespace, set(roles)))
    try:
        yield
    finally:
        _HOST_SCOPE.reset(tok)


def agent_scope(conn=None):
    """(namespace, roles) during an agent tool call when the host started this process with APP_AGENT_NAMESPACE (the
    operator's choice, like APP_AGENT_TOOLS); None otherwise (single-team rc1 behaviour, and every operator command).
    Fail closed: an agent call with NO configured namespace on a host whose catalog holds several namespaces gets the
    empty scope ("", no roles), so it sees no skills, only its own task's audit, and may not reuse catalogued names."""
    if not _IN_AGENT_CALL.get():
        return None
    if _HOST_SCOPE.get():
        return _HOST_SCOPE.get()
    ns = os.environ.get("APP_AGENT_NAMESPACE", "").strip()
    if not ns:
        multi = conn is not None and conn.execute("SELECT 1 FROM sqlite_master WHERE name='catalog_entries'").fetchone()             and conn.execute("SELECT COUNT(DISTINCT namespace) FROM catalog_entries").fetchone()[0] > 1
        return ("", set()) if multi else None
    return ns, {r.strip() for r in os.environ.get("APP_AGENT_ROLES", "agent").split(",") if r.strip()}


def visible_skill_ids(conn):
    """None = unscoped (every approved skill). Scoped: ids of approved versions the organizational catalog lists for this
    namespace and a matching role, and fresh. No catalog on this host -> nothing is visible (fail closed)."""
    scope = agent_scope(conn)
    if scope is None:
        return None
    ns, roles = scope
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='catalog_entries'").fetchone():
        return set()
    return {r["id"] for r in conn.execute(
        f"SELECT s.id FROM skills s JOIN catalog_entries e ON e.skill_name = s.name AND e.version = s.version "
        f"WHERE e.namespace = ? AND e.freshness = 'fresh' AND e.catalog_only = 0 AND EXISTS (SELECT 1 FROM json_each(e.roles) j "
        f"WHERE j.value IN ({','.join('?' * len(roles)) or 'NULL'}))", (ns, *sorted(roles)))}


# ---- human-only -----------------------------------------------------------

def decide_approval(conn, action_id, approve, approver, note=""):
    """Human decision. Deliberately NOT in AGENT_TOOLS; call it from the operator CLI / channel adapter only."""
    if not isinstance(approver, str) or not approver.strip() or approver.strip().lower() in ("agent", "system", "policy"):
        raise ToolError("invalid_input", "approver must name a human")
    action = _action(conn, action_id)
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute("SELECT status FROM approvals WHERE action_id=?", (action_id,)).fetchone()
    if not row or row["status"] != "pending":
        conn.execute("ROLLBACK")
        raise ToolError("invalid_state", f"no pending approval for action {action_id} (action is '{action['status']}')")
    status = "approved" if approve else "rejected"
    conn.execute("UPDATE approvals SET status=?, decided_by=?, note=?, decided_at=datetime('now') WHERE action_id=?",
                 (status, approver, note, action_id))
    conn.execute("UPDATE actions SET status=? WHERE id=?", (status, action_id))
    audit(conn, f"human:{approver}", f"approval_{status}", {"action_id": action_id, "note": note})
    conn.execute("COMMIT")
    return {"ok": True, "action": _action(conn, action_id)}


def pending_approvals(conn):
    rows = conn.execute("SELECT a.id FROM approvals p JOIN actions a ON a.id=p.action_id WHERE p.status='pending' ORDER BY a.id")
    return {"ok": True, "pending": [_action(conn, r["id"]) for r in rows]}


def current_task_id(conn):
    row = conn.execute("SELECT id FROM tasks WHERE status='open'").fetchone()
    return row["id"] if row else None


def agent_tools():
    from app import skillforge  # late import: skillforge builds on this module
    return {f.__name__: f for f in (read_records, investigate, freight_invoice, propose_action, request_approval, execute_action,
                                    verify_action, get_audit, skillforge.search_skills, skillforge.run_skill,
                                    skillforge.propose_skill)}


def call(conn, name, args):
    """Single dispatch point for agents. Returns a dict, never raises for expected errors. Every call is logged
    with its latency, SQL statement count, response size and an args hash (to spot repeated identical calls)."""
    queries = [0]
    conn.set_trace_callback(lambda _: queries.__setitem__(0, queries[0] + 1))
    t0 = time.perf_counter()
    scoped = _IN_AGENT_CALL.set(True)  # the agent boundary: scope applies to everything below, nothing else
    try:
        res = _dispatch(conn, name, args)
    finally:
        _IN_AGENT_CALL.reset(scoped)
        conn.set_trace_callback(None)
    ms = (time.perf_counter() - t0) * 1000
    args_hash = hashlib.sha256(json.dumps([name, args], sort_keys=True, default=str).encode()).hexdigest()[:16]
    try:
        conn.execute("INSERT INTO tool_calls (task_id, tool, ok, ms, args_hash, queries, resp_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)",
                     (current_task_id(conn), str(name), int(bool(res.get("ok"))), ms, args_hash, queries[0],
                      len(json.dumps(res, default=str))))
    except sqlite3.OperationalError:  # DB locked: the tool's own outcome stands (committed or rolled back);
        res = {**res, "unlogged": True}  # only this metrics row is lost, and the caller is told so
    return res


def _dispatch(conn, name, args):
    tools = agent_tools()
    fn = tools.get(name)
    if fn is None:
        return ToolError("unknown_tool", f"'{name}' is not an agent tool; available: {sorted(tools)}").to_dict()
    if not isinstance(args, dict):
        return ToolError("invalid_input", "arguments must be a JSON object").to_dict()
    try:
        return fn(conn, **args)
    except ToolError as e:
        return e.to_dict()
    except TypeError as e:  # wrong/missing argument names
        return ToolError("invalid_input", str(e)).to_dict()
    except sqlite3.OperationalError as e:  # e.g. locked past busy_timeout: nothing was committed, safe to retry
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        return {**ToolError("db_busy", f"database temporarily unavailable ({e}); retry the same call").to_dict(),
                "retryable": True}
