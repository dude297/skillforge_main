"""Agent-side tool client. This is the ONLY code shipped into the OpenClaw sandbox in remote mode.

  python3 client.py <tool> '<json-args>'

Remote mode (default when configured): POSTs to the trusted host service named in client.json
(or env APP_REMOTE / APP_TOKEN). The sandbox then holds no DB, verifier, validation suite or scenario data.
For propose_skill, the draft directory named in args.path is read HERE and sent as file contents.

Local fallback (no remote configured, full app packaged next to this file): runs `python3 -m app call`.
Stdlib only.
"""
import http.client
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def config():
    cfg = {}
    if (HERE / "client.json").exists():
        cfg = json.loads((HERE / "client.json").read_text())
    return os.environ.get("APP_REMOTE", cfg.get("remote")), os.environ.get("APP_TOKEN", cfg.get("token"))


def draft_files(path):
    root = Path(path)
    files = {}
    for rel in ["SKILL.md"] + [f"{d}/{p.name}" for d in ("scripts", "tests") for p in sorted((root / d).glob("*.py"))]:
        if (root / rel).is_file():
            files[rel] = (root / rel).read_text(encoding="utf-8")
    return files


def send(req, retries=int(os.environ.get("APP_RETRIES", 3))):
    """Retry ONLY when the connection was refused (service restarting): the request never reached it, so a retry
    cannot double-apply anything. Timeouts/resets after sending are NOT retried; the agent sees service_unreachable."""
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=float(os.environ.get("APP_TIMEOUT", 120))) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read() or b"{}") or {"ok": False, "error": {"code": f"http_{e.code}", "message": str(e)}}
            except json.JSONDecodeError:
                return {"ok": False, "error": {"code": f"http_{e.code}", "message": str(e)}}
        except urllib.error.URLError as e:
            if isinstance(e.reason, ConnectionRefusedError) and attempt < retries:
                time.sleep(2 ** attempt)
                continue
            return {"ok": False, "error": {"code": "service_unreachable", "message": str(e)}}
        except (TimeoutError, ConnectionError, http.client.HTTPException) as e:
            return {"ok": False, "error": {"code": "service_unreachable", "message": f"{type(e).__name__}: {e}"}}
        except json.JSONDecodeError:
            return {"ok": False, "error": {"code": "bad_response", "message": "service reply is not JSON (wrong URL/port?)"}}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    tool, args = sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    remote, token = config()
    if not remote:  # local fallback package
        return subprocess.call([sys.executable, "-m", "app", "call", tool, json.dumps(args)], cwd=HERE)
    body = {"tool": tool, "args": args}
    if tool == "propose_skill" and isinstance(args, dict) and "path" in args:
        body["files"] = draft_files(args.pop("path"))
    req = urllib.request.Request(remote, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    res = send(req)
    print(json.dumps(res, indent=2))
    return 0 if res.get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
