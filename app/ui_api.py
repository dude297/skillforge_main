"""Read-only operator API + the bundled console, served from ONE loopback origin. Host side only.

  python -m app ui [--port 8766]        then open the printed URL once: it sets an HttpOnly session cookie

What it is NOT: it is not `serve` (the agent's tool service) and it holds no write path. Every endpoint is a GET
that projects existing authoritative rows; approvals, skill promotion, rollback, resets and execution stay host CLI
commands run by a person (`python -m app approve ...`). The browser can only watch.

Boundaries enforced here:
  - loopback bind only; Host header must name this loopback origin (blocks DNS rebinding)
  - its own operator token (data/.operator_token), never the agent token; HttpOnly SameSite=Strict cookie
  - the DB is opened read-only (mode=ro + query_only), so a bug here cannot write
  - sanitized projections: no hidden-validation cases, no raw tool arguments, no approval notes, no input snapshots;
    known secret values are redacted from every response as a last line of defence
  - bounded: limits clamped, ids validated, responses capped
"""
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from app import db

TOKEN_FILE = db.ROOT / "data" / ".operator_token"
DIST = Path(os.environ.get("APP_UI_DIST", db.ROOT / "ui" / "dist"))
RESULTS = Path(os.environ.get("APP_RESULTS", db.ROOT / "results"))
COOKIE = "sf_operator"
MAX_RESP = 2_000_000
MAX_LIMIT = 500
STATUS_TTL_S = 10
TEXT_MAX = 240
FILE_MAX = 64_000
LOOPBACK = ("127.0.0.1",)  # IPv4 loopback only: the stdlib server is AF_INET, and a name could resolve elsewhere
LOGIN_TTL_S = 600         # the printed login link works once, within 10 minutes of start
MIN_TOKEN = 32
# C0/C1 controls (except tab/newline) and bidi overrides/isolates: agent-written text must not spoof the console
UNSAFE_CHARS = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]")
_REDACT: list[str] = []   # filled by make_server(); applied before any truncation
NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{2,40}$")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
         ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
       "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def token():
    if os.environ.get("APP_OPERATOR_TOKEN"):
        if len(os.environ["APP_OPERATOR_TOKEN"]) < MIN_TOKEN:
            raise SystemExit(f"APP_OPERATOR_TOKEN must be at least {MIN_TOKEN} characters")
        return os.environ["APP_OPERATOR_TOKEN"]
    if not TOKEN_FILE.exists():
        TOKEN_FILE.write_text(secrets.token_urlsafe(32))
        if os.name == "posix":
            TOKEN_FILE.chmod(0o600)
    return TOKEN_FILE.read_text().strip()


SESSION_TTL_S = 12 * 3600


def _sign(tok, kind, msg):
    return hmac.new(tok.encode(), f"{kind}|{msg}".encode(), hashlib.sha256).hexdigest()[:32]


def login_link(port=8766, tok=None, now=None):
    """A ONE-TIME login URL, valid for LOGIN_TTL_S. Stateless (HMAC of the operator token), so `python -m app ui --link`
    can mint one for a running server without restarting it; the server remembers used codes. The permanent token
    itself never appears in a URL, a cookie, browser history or a terminal."""
    tok = tok or token()
    msg = f"{int(now or time.time())}.{secrets.token_urlsafe(9)}"
    return f"http://127.0.0.1:{port}/auth?code={msg}.{_sign(tok, 'login', msg)}"


def _check_login(tok, code, used, now=None):
    try:
        ts, nonce, sig = code.split(".")
        age = (now or time.time()) - int(ts)
    except ValueError:
        return "malformed login link"
    if not hmac.compare_digest(sig.encode(), _sign(tok, "login", f"{ts}.{nonce}").encode()):
        return "invalid login link"
    if not 0 <= age <= LOGIN_TTL_S:
        return "this login link has expired"
    if code in used:
        return "this login link was already used"
    used.add(code)
    return None


def new_session(tok, now=None):
    sid = f"{int(now or time.time())}.{secrets.token_urlsafe(18)}"
    return f"{sid}.{_sign(tok, 'session', sid)}"


def session_ok(tok, value, now=None):
    """Signed + expiring session id: never the token itself. Survives an API restart; rotate the token file to revoke."""
    try:
        ts, rnd, sig = value.split(".")
        age = (now or time.time()) - int(ts)
    except ValueError:
        return False
    return 0 <= age <= SESSION_TTL_S and hmac.compare_digest(sig.encode(), _sign(tok, "session", f"{ts}.{rnd}").encode())


def _secrets(op_token):
    """Values that must never appear in a response, whatever a bug or a detail string might carry."""
    vals = [op_token, os.environ.get("LLM_API_KEY"), os.environ.get("APP_TOKEN")]
    for f in (db.ROOT / "data" / ".agent_token", Path.home() / ".nemoclaw" / "dual-station-vllm-api-key"):
        try:
            vals.append(f.read_text().strip())
        except OSError:
            pass
    return [v for v in vals if v and len(v) >= 8]


def ro_connect():
    path = Path(os.environ.get("APP_DB", db.DEFAULT_DB))
    if not path.exists():
        raise ApiError(503, "no_database", "no database yet: run `python -m app reset` on the host")
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    if conn.execute("PRAGMA user_version").fetchone()[0] != db.SCHEMA_VERSION:
        conn.close()
        raise ApiError(503, "schema_mismatch", "database schema differs from this code; run `python -m app db check`")
    return conn


# ---- projections -------------------------------------------------------------------------------------------

def _text(s):
    for secret in _REDACT:  # BEFORE truncation: a secret cut in half would no longer match the final scrub
        s = s.replace(secret, "[redacted]")
    s = UNSAFE_CHARS.sub("", s)
    return s if len(s) <= TEXT_MAX else s[:TEXT_MAX - 1] + "…"


def _clip(v):
    if isinstance(v, str):
        return _text(v)
    if isinstance(v, (int, float, bool)) or v is None:
        return v
    s = json.dumps(v, default=str)
    return v if len(s) <= TEXT_MAX and not UNSAFE_CHARS.search(s) and not any(x in s for x in _REDACT) else _text(s)


def _j(text, default=None):
    try:
        return json.loads(text) if text else default
    except (TypeError, json.JSONDecodeError):
        return default


# Per audit event, the payload keys a viewer may see. Anything else (approval notes, full record snapshots, unknown
# events) is dropped; the event itself is still listed so nothing silently disappears from the timeline.
EVENT_FIELDS = {
    "reset": ("scenario",), "task_begin": ("task_id", "label", "mode"),
    "task_end": ("task_id", "success", "tool_calls", "model_calls"),
    "investigate": ("record_id", "findings"), "propose_action": ("action_id", "record_id"),
    "request_approval": ("action_id",), "approval_approved": ("action_id",), "approval_rejected": ("action_id",),
    "execute_refused": ("action_id", "status"), "execute_action": ("action_id",),
    "verify_action": ("action_id", "passed"), "run_skill": ("run_id", "proposals"),
    "run_skill_refused": ("name", "reason", "differs"), "run_skill_error": ("name", "run_id"),
    "propose_skill": ("name", "version", "status", "optimizes"), "skill_approved": ("name", "version"),
    "skill_rejected": ("name", "version"), "skill_disabled": ("name",), "skill_rollback": ("name", "from", "to"),
    "skill_hidden_validation_failed": ("name", "version"), "recover": ("verified",), "escalated_no_model": ("level",),
    # router decisions (experiments/router): the closed `kind` vocabulary only, never the operator-facing free text
    **{f"route_{s}": ("event_id", "kind") for s in ("awaiting_approval", "needs_human", "deferred", "queued_for_agent",
                                                   "completed", "refused")},
}


def event_view(row):
    p = _j(row["payload"], {}) or {}
    keep = EVENT_FIELDS.get(row["event"], ())
    out = {k: _clip(p[k]) for k in keep if k in p}
    if row["event"] == "execute_action":  # only the fields that changed, not the whole record
        b, a = p.get("before") or {}, p.get("after") or {}
        out["changed"] = {k: [_clip(b.get(k)), _clip(a.get(k))] for k in sorted(set(b) | set(a)) if b.get(k) != a.get(k)}
    if row["event"] == "propose_action" and isinstance(p.get("params"), dict):
        out["params"] = {k: _clip(v) for k, v in p["params"].items() if k in ("field", "value")}
    return {"id": row["id"], "ts": row["ts"], "actor": _clip(row["actor"])[:80], "event": _clip(row["event"]), "payload": out}


def _evidence(conn, record_id):
    return [{"source": _clip(e["source"]), "trusted": bool(e["trusted"]), "summary": _clip(e["data"])}
            for e in conn.execute("SELECT source, data, trusted FROM evidence WHERE record_id=? ORDER BY id LIMIT 20",
                                  (record_id,))]


def fingerprint(record_id, params_text):
    """Short hash of WHAT an action changes; `python -m app approve <id> --expect <fp>` refuses on mismatch, so a
    command copied from the console can't approve a different action (ids restart after a scenario reset, and the
    operator's shell may point at another APP_DB)."""
    from app.__main__ import action_fingerprint
    return action_fingerprint(record_id, params_text)


def action_view(conn, a):
    from app.ops import workflow_state
    params = _j(a["params"], {}) or {}
    field = params.get("field")
    rec = conn.execute("SELECT data FROM records WHERE id=?", (a["record_id"],)).fetchone()
    ap = conn.execute("SELECT status, decided_by, requested_at, decided_at FROM approvals WHERE action_id=?",
                      (a["id"],)).fetchone()
    ex = conn.execute("SELECT before, after, executed_at FROM executions WHERE action_id=?", (a["id"],)).fetchone()
    ver = []
    for v in conn.execute("SELECT passed, details, created_at FROM verifications WHERE action_id=? ORDER BY id", (a["id"],)):
        ver.append({"passed": bool(v["passed"]), "at": v["created_at"],
                    "checks": [{k: _clip(c.get(k)) for k in ("check", "passed", "actual", "expected") if k in c}
                               for c in (_j(v["details"], []) or [])[:20]]})
    changed = None
    if ex:
        b, af = _j(ex["before"], {}) or {}, _j(ex["after"], {}) or {}
        changed = {k: [_clip(b.get(k)), _clip(af.get(k))] for k in sorted(set(b) | set(af)) if b.get(k) != af.get(k)}
    return {"id": a["id"], "fingerprint": fingerprint(a["record_id"], a["params"]), "task_id": a["task_id"],
            "record_id": _clip(a["record_id"]), "type": _clip(a["type"]),
            "field": _clip(field), "value": _clip(params.get("value")), "reason": _clip(a["reason"]),
            "status": a["status"], "state": workflow_state(conn, a), "origin": _clip(a["origin"]),
            "created_at": a["created_at"],
            "current_value": _clip((_j(rec["data"], {}) or {}).get(field)) if rec and isinstance(field, str) else None,
            "approval": {k: _clip(v) for k, v in dict(ap).items()} if ap else None,
            "execution": {"at": ex["executed_at"], "changed": changed} if ex else None,
            "verifications": ver, "evidence": _evidence(conn, a["record_id"])}


TASK_COLS = ("id, label, scenario, mode, status, model, started_at, ended_at, latency_s, model_calls, tool_calls, "
             "duplicate_tool_calls, actions_executed, verifications_passed, verifications_failed, invariant_violations, "
             "success, skills_used, skill_proposed, tool_breakdown, phase_marks")


def task_view(r):
    t = {k: _clip(v) if isinstance(v, str) and k not in ("tool_breakdown", "phase_marks", "skills_used", "skill_proposed") else v
         for k, v in dict(r).items()}
    t["tool_breakdown"] = _j(t["tool_breakdown"])
    t["phase_marks"] = _j(t["phase_marks"])
    for k in ("skills_used", "skill_proposed"):
        t[k] = [s for s in (t[k] or "").split(",") if s]
    return t


def tasks(conn, q):
    limit = _int(q, "limit", 50, 1, 200)
    return {"ok": True, "tasks": [task_view(r) for r in conn.execute(
        f"SELECT {TASK_COLS} FROM tasks ORDER BY id DESC LIMIT ?", (limit,))]}


def task(conn, tid):
    r = conn.execute(f"SELECT {TASK_COLS} FROM tasks WHERE id=?", (tid,)).fetchone()
    if not r:
        raise ApiError(404, "not_found", f"no task {tid}")
    # The task's own audit range: task_begin .. task_end (or the newest event while it is open).
    begin = conn.execute("SELECT id FROM audit WHERE event='task_begin' AND json_extract(payload,'$.task_id')=? "
                         "ORDER BY id LIMIT 1", (tid,)).fetchone()
    end = conn.execute("SELECT id FROM audit WHERE event='task_end' AND json_extract(payload,'$.task_id')=? "
                       "ORDER BY id LIMIT 1", (tid,)).fetchone()
    events = []
    if begin:
        hi = end["id"] if end else conn.execute("SELECT MAX(id) FROM audit").fetchone()[0]
        events = [event_view(e) for e in conn.execute(
            "SELECT * FROM audit WHERE id BETWEEN ? AND ? ORDER BY id LIMIT ?", (begin["id"], hi, MAX_LIMIT))]
    calls = [dict(c, ok=bool(c["ok"]), ms=round(c["ms"], 2)) for c in conn.execute(
        "SELECT id, tool, ok, ms, ts FROM tool_calls WHERE task_id=? ORDER BY id LIMIT ?", (tid, MAX_LIMIT))]
    actions = [action_view(conn, a) for a in conn.execute("SELECT * FROM actions WHERE task_id=? ORDER BY id LIMIT 100", (tid,))]
    learned = [dict(s) for s in conn.execute("SELECT name, version, status FROM skills WHERE source_task=? ORDER BY id", (tid,))]
    return {"ok": True, "task": task_view(r), "events": events, "events_complete": bool(begin) and len(events) < MAX_LIMIT,
            "events_truncated": len(events) >= MAX_LIMIT,
            "tool_calls": calls, "actions": actions, "skills_proposed": learned}


def events(conn, q):
    after, limit = _int(q, "after", 0, 0, 2**62), _int(q, "limit", 200, 1, MAX_LIMIT)
    rows = conn.execute("SELECT * FROM audit WHERE id > ? ORDER BY id LIMIT ?", (after, limit)).fetchall()
    anchor = conn.execute("SELECT ts, event FROM audit WHERE id=?", (after,)).fetchone() if after else None
    return {"ok": True, "events": [event_view(r) for r in rows],
            # the event the client says it has seen last: if its ts/event differ, the DB was replaced -> resync
            "anchor": {"id": after, "ts": anchor["ts"], "event": anchor["event"]} if anchor else None,
            "last_id": conn.execute("SELECT COALESCE(MAX(id), 0) FROM audit").fetchone()[0]}


def approvals(conn, _q):
    rows = conn.execute("SELECT a.* FROM approvals p JOIN actions a ON a.id=p.action_id WHERE p.status='pending' "
                        "ORDER BY a.id LIMIT 100")
    return {"ok": True, "pending": [action_view(conn, a) for a in rows]}


def action(conn, aid):
    a = conn.execute("SELECT * FROM actions WHERE id=?", (aid,)).fetchone()
    if not a:
        raise ApiError(404, "not_found", f"no action {aid}")
    return {"ok": True, "action": action_view(conn, a)}


def _validation(text):
    v = _j(text, {}) or {}
    own, replay = v.get("own_tests") or {}, v.get("replay") or {}
    return {"lint_errors": len(v.get("lint") or []), "own_tests_ok": own.get("ok") if own else None,
            "own_tests": {k: own[k] for k in ("passed", "failed", "total") if isinstance(own.get(k), int)} or None,
            "replay_ok": replay.get("ok") if replay else None}


def _skill_row(conn, s):
    hidden = _j(s["hidden_validation"])  # ONLY the verdict leaves this function: cases are the oracle
    runs = conn.execute("SELECT COUNT(*) n, COALESCE(SUM(status='ok'),0) ok, COALESCE(SUM(status='refused'),0) refused, "
                        "COALESCE(SUM(status='error'),0) error, COALESCE(SUM(verified_pass),0) vp, "
                        "COALESCE(SUM(verified_fail),0) vf FROM skill_runs WHERE skill_id=?", (s["id"],)).fetchone()
    prof, opt = _j(s["profile"], {}) or {}, _j(s["optimization"], {}) or {}
    return {"name": s["name"], "version": s["version"], "parent_version": s["parent_version"], "status": s["status"],
            "active": bool(s["active"]), "description": _clip(s["description"]), "decided_by": _clip(s["decided_by"]),
            "source_task": s["source_task"], "created_at": s["created_at"], "sha256": s["sha256"][:16],
            "touches": [_clip(x) for x in (_j(s["touches"], []) or [])][:20], "validation": _validation(s["validation"]),
            "hidden_ok": None if hidden is None else bool(hidden.get("ok")),
            "optimization": {"recommended": prof.get("recommended"), "retained": opt.get("retained"),
                             "warm_speedup": opt.get("warm_speedup")},
            "runs": {"total": runs["n"], "ok": runs["ok"], "refused": runs["refused"], "error": runs["error"],
                     "verified_pass": runs["vp"], "verified_fail": runs["vf"]}}


def skills(conn, _q):
    return {"ok": True, "skills": [_skill_row(conn, s) for s in conn.execute("SELECT * FROM skills ORDER BY name, version")]}


def skill(conn, name, version):
    from app import skillforge as sf
    s = conn.execute("SELECT * FROM skills WHERE name=? AND version=?", (name, version)).fetchone()
    if not s:
        raise ApiError(404, "not_found", f"no skill {name} v{version}")
    d = sf.SKILLS_DIR / "candidates" / name / f"v{version}"  # name matched NAME_RE, version is an int
    files = {}
    for rel in ("SKILL.md", "scripts/helper.py", "tests/test_helper.py"):
        p = d / rel
        if p.is_file() and p.stat().st_size <= FILE_MAX:
            files[rel] = UNSAFE_CHARS.sub("\ufffd", p.read_text(encoding="utf-8", errors="replace"))  # visible, not hidden
    return {"ok": True, "skill": _skill_row(conn, s), "files": files,
            "files_note": None if files else "skill files are not on this host"}


def bench_latest(_conn, _q):
    found = sorted(RESULTS.rglob("result.json"), key=lambda p: p.stat().st_mtime, reverse=True) if RESULTS.is_dir() else []
    if not found:
        raise ApiError(404, "no_results", f"no result.json under {RESULTS.name}/: run `python -m app bench --out results/<label>`")
    f = found[0]
    if f.stat().st_size > 50_000_000:
        raise ApiError(413, "too_large", "newest result.json is over 50 MB")
    r = json.loads(f.read_text(encoding="utf-8"))
    learning = r.get("learning") or {}
    return {"ok": True, "file": f.relative_to(RESULTS).as_posix(), "mtime": f.stat().st_mtime,
            "result": {"real_model": r.get("real_model") is True, "agent": r.get("agent"), "trials": r.get("trials"),
                       "modes": r.get("modes"), "summary": r.get("summary"), "breakeven_C": r.get("breakeven_C"),
                       "breakeven_B": r.get("breakeven_B"),
                       "learning": {k: learning.get(k) for k in ("model_calls", "tool_calls", "approved", "autonomous", "phases")}}}


_status_cache = {"at": 0.0, "value": None}
_status_lock = threading.Lock()


def status(conn, _q):
    """ops.status, cached: it may shell out to nemoclaw and probe inference, which must not run on every poll."""
    from app import ops
    fresh = _status_cache["value"] is not None and time.time() - _status_cache["at"] <= STATUS_TTL_S
    if fresh or (_status_cache["value"] is not None and not _status_lock.acquire(blocking=False)):
        return _status_cache["value"]  # fresh, or another request is recomputing: answer with the last one
    if _status_cache["value"] is None:
        _status_lock.acquire()
    try:
        if _status_cache["value"] is None or time.time() - _status_cache["at"] > STATUS_TTL_S:
            s = ops.status(conn)
            inf = s["inference"]
            _status_cache["value"] = {
                "ok": True, "checked_at": time.time(),
                "inference": {"ok": inf.get("ok"), "model": inf.get("model"), "detail": _clip(inf.get("detail")),
                              "learning_allowed": inf.get("learning_allowed")},
                "sandbox": {"ok": s["sandbox"]["ok"], "detail": _clip(s["sandbox"]["detail"])},
                "host_service": {"ok": s["host_service"]["ok"], "detail": _clip(s["host_service"]["detail"])},
                "db": {"quick_check": s["db"]["quick_check"]},
                "open_tasks": [{k: t[k] for k in ("id", "label", "mode", "age_s")} for t in s["open_tasks"]],
                "workflows_by_state": s["workflows_by_state"], "approved_skills": s["approved_skills"],
                "last_task": {k: _clip(v) for k, v in s["last_task"].items()} if s["last_task"] else None,
                "next_actions": [_clip(a) for a in s["next_actions"]],
                "db": {"quick_check": s["db"]["quick_check"], "path": _clip(s["db"]["path"])}}
            _status_cache["at"] = time.time()
        return _status_cache["value"]
    finally:
        _status_lock.release()


def _int(q, key, default, lo, hi):
    raw = q.get(key, [None])[-1]
    if raw is None:
        return default
    if not re.fullmatch(r"\d{1,19}", raw):
        raise ApiError(400, "invalid_input", f"{key} must be a non-negative integer")
    return max(lo, min(hi, int(raw)))


ROUTES = [  # (pattern, handler(conn, match, query))
    (re.compile(r"^/ui/status$"), lambda c, m, q: status(c, q)),
    (re.compile(r"^/ui/tasks$"), lambda c, m, q: tasks(c, q)),
    (re.compile(r"^/ui/tasks/(\d{1,12})$"), lambda c, m, q: task(c, int(m[1]))),
    (re.compile(r"^/ui/events$"), lambda c, m, q: events(c, q)),
    (re.compile(r"^/ui/approvals$"), lambda c, m, q: approvals(c, q)),
    (re.compile(r"^/ui/actions/(\d{1,12})$"), lambda c, m, q: action(c, int(m[1]))),
    (re.compile(r"^/ui/skills$"), lambda c, m, q: skills(c, q)),
    (re.compile(r"^/ui/skills/([a-z][a-z0-9_-]{2,40})/(\d{1,6})$"), lambda c, m, q: skill(c, m[1], int(m[2]))),
    (re.compile(r"^/ui/bench/latest$"), lambda c, m, q: bench_latest(c, q)),
]


def api(path, query):
    """Pure dispatch: (path, query dict) -> (http status, JSON-able body). Testable without sockets."""
    if path == "/ui/health":
        return 200, {"ok": True, "service": "skillforge-operator-api", "read_only": True}
    for pat, fn in ROUTES:
        m = pat.match(path)
        if m:
            conn = None
            try:
                conn = ro_connect()
                return 200, fn(conn, m, query)
            except ApiError as e:
                return e.status, {"ok": False, "error": {"code": e.code, "message": e.message}}
            except sqlite3.OperationalError as e:  # locked past timeout, or a half-migrated DB: retryable
                return 503, {"ok": False, "error": {"code": "db_unavailable", "message": _clip(str(e))}, "retryable": True}
            except Exception as e:  # a projection bug must answer 500, not drop the connection; type only, no data
                return 500, {"ok": False, "error": {"code": "internal_error", "message": type(e).__name__}}
            finally:
                if conn is not None:
                    conn.close()
    return 404, {"ok": False, "error": {"code": "not_found", "message": "unknown endpoint"}}


class Handler(BaseHTTPRequestHandler):
    server_version = "skillforge-ui"
    sys_version = ""
    timeout = 30

    def log_message(self, fmt, *a):  # never log query strings (the /auth token) or headers (cookie)
        pass

    def _send(self, code, body, ctype="application/json", extra=()):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, default=str)
        if isinstance(body, str):
            for s in self.server.secret_values:
                body = body.replace(s, "[redacted]")
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", CSP)
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, err, msg, extra=()):
        self._send(code, {"ok": False, "error": {"code": err, "message": msg}}, extra=extra)

    def _authorized(self):
        """Bearer <operator token> (CLI, tests) or the signed session cookie set by /auth. Bytes compare: a non-ASCII
        header must be a 401, not a handler crash."""
        tok = self.server.token
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer ") and hmac.compare_digest(auth[7:].encode("utf-8", "replace"), tok.encode()):
            return True
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE and session_ok(tok, v):
                return True
        return False

    def _drain(self):
        """Read (and ignore) a small request body before replying: closing a socket with unread data sends a TCP
        reset, which the client reports as a network error instead of our 405/401. Big or bad bodies: just close."""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if 0 < n <= 65536:
            self.rfile.read(n)
        if n:
            self.close_connection = True

    def do_GET(self):
        self._drain()
        hosts = self.headers.get_all("Host") or []
        # DNS rebinding: a remote page resolving to 127.0.0.1 sends another Host. Exactly one Host, origin-form target.
        if len(hosts) != 1 or hosts[0].lower() not in self.server.hosts or not self.path.startswith("/"):
            return self._err(403, "bad_host", "this API answers only to its own loopback origin")
        url = urlsplit(self.path)
        query = parse_qs(url.query, keep_blank_values=True)
        if url.path == "/auth":
            with self.server.login_lock:
                why = _check_login(self.server.token, query.get("code", [""])[-1], self.server.used_codes)
            if why:
                return self._err(401, "unauthorized", f"{why}: get a new one with `python -m app ui --link`",
                                 extra=[("Cache-Control", "no-store")])
            # replace the history entry: the (now spent) code doesn't stay in the address bar
            return self._send(303, "", "text/plain", extra=[
                ("Set-Cookie", f"{COOKIE}={new_session(self.server.token)}; HttpOnly; SameSite=Strict; Path=/; "
                               f"Max-Age={SESSION_TTL_S}"),
                ("Location", "/#/console/overview"), ("Cache-Control", "no-store")])
        if url.path.startswith("/ui/"):
            if url.path != "/ui/health" and not self._authorized():  # health says only "this is the API": public
                return self._err(401, "unauthorized", "operator session required: open the URL printed by `python -m app ui`")
            code, body = api(url.path, query)
            text = json.dumps(body, default=str)
            if len(text) > MAX_RESP:
                return self._err(413, "response_too_large", f"response > {MAX_RESP} bytes; narrow it with limit=")
            return self._send(code, text, extra=[("Cache-Control", "no-store")])
        return self._static(url.path)

    def _static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        root = DIST.resolve()
        try:
            f = (root / rel).resolve()
        except (OSError, ValueError):
            return self._err(404, "not_found", "no such file")
        if root not in f.parents or not f.is_file():  # no traversal, no directory listing
            return self._err(404, "not_found", "no such file" if root.is_dir() else
                             "console not built: run `npm run build` in ui/")
        ctype = TYPES.get(f.suffix.lower()) or mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        cache = "public, max-age=31536000, immutable" if "assets" in f.relative_to(root).parts else "no-cache"
        self._send(200, f.read_bytes(), ctype, extra=[("Cache-Control", cache)])

    def _method_not_allowed(self):
        self._drain()
        self.close_connection = True
        self._err(405, "method_not_allowed", "read-only API: GET only. Approvals and promotion are host commands.",
                  extra=[("Allow", "GET")])

    do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = do_TRACE = do_CONNECT = _method_not_allowed


class _Server(ThreadingHTTPServer):
    # socketserver's default listen backlog is 5. A browser reload opens ~6 connections plus API polls, and when the
    # accept loop stalls for a moment (memory pressure) Windows answers the overflow with a RST, which the browser shows
    # as ERR_CONNECTION_REFUSED. Loopback-only, so a larger queue exposes nothing new.
    request_queue_size = 64


def make_server(bind="127.0.0.1", port=8766):
    if bind not in LOOPBACK:
        raise SystemExit(f"refusing to bind {bind!r}: the operator API is loopback-only (127.0.0.1)")
    srv = _Server((bind, port), Handler)  # readers only: concurrent GETs are safe on WAL
    srv.daemon_threads = True
    srv.token = token()
    srv.secret_values = _secrets(srv.token)
    _REDACT[:] = srv.secret_values
    srv.used_codes, srv.login_lock = set(), threading.Lock()
    p = srv.server_port
    srv.hosts = {f"127.0.0.1:{p}", f"localhost:{p}"}  # an SSH tunnel to 127.0.0.1:<p> keeps this Host
    return srv


def serve(bind="127.0.0.1", port=8766):
    srv = make_server(bind, port)
    print(json.dumps({"ok": True, "console": f"http://127.0.0.1:{srv.server_port}/", "read_only": True,
                      "db": os.environ.get("APP_DB", str(db.DEFAULT_DB)),
                      "new_login_link": "python -m app ui --link"}), flush=True)
    print(f"open (one-time, {LOGIN_TTL_S // 60} min): {login_link(srv.server_port, srv.token)}", flush=True)
    srv.serve_forever()
