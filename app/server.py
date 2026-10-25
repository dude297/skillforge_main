"""Trusted tool service. Runs on the HOST, outside the agent sandbox, next to the authoritative DB, the verifier
and the hidden validation suite. The agent's sandbox only gets adapters/openclaw/client.py + a URL + a token.

Exposes the AGENT tools and nothing else: there is no endpoint for approvals, skill promotion, rollback,
scenario resets or hidden validation. Those stay host CLI commands run by a human.

  python -m app serve [--bind 127.0.0.1] [--port 8765]

Bind it to the narrowest address the sandbox can reach (on the GB10: the OpenShell/docker bridge gateway IP,
never 0.0.0.0). The token only authorizes the same agent tool surface the agent already has; it is not a secret
that unlocks anything privileged, but it keeps other local processes/containers out.
"""
import hmac
import json
import os
import re
import secrets
import shutil
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from app import db, skillforge, tools

TOKEN_FILE = db.ROOT / "data" / ".agent_token"
MAX_BODY = 1_000_000
MAX_RESP = 4_000_000  # a runaway tool result must not stall the sandbox client or flood the model context
DRAFT_FILE_RE = re.compile(r"^(SKILL\.md|scripts/[A-Za-z0-9_]+\.py|tests/[A-Za-z0-9_]+\.py)$")


def token():
    if os.environ.get("APP_TOKEN"):
        return os.environ["APP_TOKEN"]
    if not TOKEN_FILE.exists():
        TOKEN_FILE.write_text(secrets.token_urlsafe(32))
        if os.name == "posix":
            TOKEN_FILE.chmod(0o600)
    return TOKEN_FILE.read_text().strip()


def allowed_tools():
    """APP_AGENT_TOOLS=read_records,investigate,... narrows the agent's surface for a run (default: all agent tools).
    Names outside the agent tool set are ignored, so this can only REMOVE capabilities, never add privileged ones."""
    every = set(tools.agent_tools())
    want = {t.strip() for t in os.environ.get("APP_AGENT_TOOLS", "").split(",") if t.strip()}
    return every & want if want else every


def handle(conn, body):
    """Validate one request and dispatch it. Pure function of (conn, body) so it is testable without sockets."""
    tool, args, files = body.get("tool"), body.get("args", {}), body.get("files")
    allowed = allowed_tools()
    if tool not in allowed:  # least privilege: the token only reaches the tools this run was started with
        return tools.ToolError("unknown_tool", f"'{tool}' is not enabled on this service; enabled: {sorted(allowed)}").to_dict()
    if not isinstance(args, dict):
        return tools.ToolError("invalid_input", "args must be an object").to_dict()
    if tool == "propose_skill":
        # The host must never read a path the agent names (that would let it pull arbitrary HOST files into the
        # registry). Drafts arrive as file contents; we stage them ourselves.
        if "path" in args or not isinstance(files, dict) or not files:
            return tools.ToolError("invalid_input", "remote propose_skill takes draft file contents in 'files', not a path").to_dict()
        bad = [f for f in files if not isinstance(f, str) or not DRAFT_FILE_RE.match(f) or not isinstance(files[f], str)]
        if bad:
            return tools.ToolError("invalid_input", f"draft files must be SKILL.md, scripts/*.py, tests/*.py; got {bad}").to_dict()
        stage = skillforge.SKILLS_DIR / "staging" / uuid.uuid4().hex
        try:
            for rel, content in files.items():
                (stage / rel).parent.mkdir(parents=True, exist_ok=True)
                (stage / rel).write_text(content, encoding="utf-8")
            return tools.call(conn, "propose_skill", {**args, "path": str(stage)})
        finally:
            shutil.rmtree(stage, ignore_errors=True)
    if files is not None:
        return tools.ToolError("invalid_input", "'files' is only accepted for propose_skill").to_dict()
    return tools.call(conn, tool, args)


class Handler(BaseHTTPRequestHandler):
    timeout = 30  # single-threaded server: a stalled/slow client must not wedge every other call

    def log_message(self, fmt, *a):  # never log bodies (records, drafts) or headers (token)
        pass

    def _log(self, code, tool=None, ok=None):  # one access line per request on stderr: no body, no headers, no token
        print(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "client": self.client_address[0],
                          "method": self.command, "path": self.path, "status": code,
                          "tool": str(tool)[:64] if tool else None, "ok": ok}), file=sys.stderr, flush=True)

    def _send(self, code, obj, tool=None):
        self._log(code, tool, obj.get("ok") if isinstance(obj, dict) else None)  # app errors are HTTP 200 with ok=false
        body = json.dumps(obj, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0:  # rfile.read(-1) would block until the client hangs up
            return self._send(400, {"ok": False, "error": {"code": "invalid_input", "message": "bad Content-Length"}})
        if n > MAX_BODY:
            self.close_connection = True
            return self._send(413, {"ok": False, "error": {"code": "too_large", "message": f"body > {MAX_BODY} bytes"}})
        # Read the (bounded) body BEFORE any reply: closing a socket with unread data sends a TCP reset, and the
        # client would then report a 401/404 as "service_unreachable".
        raw = self.rfile.read(n)
        if not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {self.server.token}"):
            return self._send(401, {"ok": False, "error": {"code": "unauthorized", "message": "bad or missing token"}})
        if self.path != "/call":
            return self._send(404, {"ok": False, "error": {"code": "not_found", "message": "POST /call only"}})
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"ok": False, "error": {"code": "invalid_input", "message": "body is not JSON"}})
        conn = db.connect()
        try:
            res = handle(conn, body if isinstance(body, dict) else {})
        except Exception as e:  # a tool bug must come back as a structured error, not a dropped connection
            print(json.dumps({"internal_error": type(e).__name__}), file=sys.stderr, flush=True)  # type only: no data
            res = tools.ToolError("internal_error", f"{type(e).__name__}; see host service stderr").to_dict()
        finally:
            conn.close()
        if len(json.dumps(res, default=str)) > MAX_RESP:
            res = tools.ToolError("response_too_large", f"result > {MAX_RESP} bytes; narrow the request").to_dict()
        self._send(200, res, tool=body.get("tool") if isinstance(body, dict) else None)

    do_GET = do_PUT = do_DELETE = lambda self: self._send(405, {"ok": False, "error": {"code": "method", "message": "POST /call"}})


def serve(bind="127.0.0.1", port=8765):
    if bind in ("0.0.0.0", "::", ""):
        raise SystemExit("refusing to bind all interfaces; bind the bridge gateway IP the sandbox uses")
    srv = HTTPServer((bind, port), Handler)  # single-threaded on purpose: one SQLite writer, no races
    srv.token = token()
    print(json.dumps({"ok": True, "listening": f"http://{bind}:{srv.server_port}/call", "token_file": str(TOKEN_FILE),
                      "enabled_tools": sorted(allowed_tools())}), flush=True)
    srv.serve_forever()
