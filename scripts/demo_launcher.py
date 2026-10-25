"""One-command demo launcher (shared by start-demo.ps1 / start-demo.sh). Wraps scripts/unified.py; reimplements nothing.

  python scripts/demo_launcher.py [--port 8766] [--no-open] [--reset-demo]

Attaches to a SkillForge console already on the port; never kills anything it did not start. Loopback only.
"""
import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "unified"
UI = ROOT / "ui"
UNIFIED = [sys.executable, str(ROOT / "scripts" / "unified.py")]
SERVICE = "skillforge-operator-api"  # what app/ui_api.py's public /ui/health answers


def die(msg):
    print(f"\n[demo] STOP: {msg}", flush=True)
    sys.exit(1)


def run(cmd, **kw):
    print("[demo] $", " ".join(str(c) for c in cmd), flush=True)
    return subprocess.run(cmd, cwd=ROOT, **kw).returncode


def probe(port):
    """'free' | 'ours' (a SkillForge operator API) | 'foreign' (anything else holding the port)."""
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
    except OSError:
        return "free"
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/ui/health", timeout=2) as r:
            return "ours" if json.load(r).get("service") == SERVICE else "foreign"
    except Exception:
        return "foreign"


def ui_stale():
    built = UI / "dist" / "index.html"
    if not built.exists():
        return "missing"
    srcs = [p for p in (UI / "src").rglob("*") if p.is_file()]
    srcs += [UI / f for f in ("index.html", "package.json", "package-lock.json", "vite.config.ts") if (UI / f).exists()]
    return "older than ui/src" if max(p.stat().st_mtime for p in srcs) > built.stat().st_mtime else None


def build_ui():
    why = ui_stale()
    if not why:
        return
    npm = shutil.which("npm")
    have_dist = (UI / "dist" / "index.html").exists()
    if not npm:
        if have_dist:
            return print(f"[demo] WARN: ui/dist is {why} but npm is not installed; serving the existing bundle")
        die("ui/dist is missing and npm is not installed. Install Node.js, then: npm --prefix ui ci && npm --prefix ui run build")
    if not (UI / "node_modules").exists():
        print("[demo] WARN: ui/node_modules is absent. Running `npm --prefix ui ci` from the committed lockfile "
              "(downloads the locked packages from the npm registry).", flush=True)
        if run([npm, "--prefix", "ui", "ci"]):
            die("npm ci failed; fix it, then re-run")
    print(f"[demo] ui/dist is {why}: building", flush=True)
    if run([npm, "--prefix", "ui", "run", "build"]):
        if have_dist:  # another agent's half-done ui/src edit must not kill the demo
            return print("[demo] WARN: UI build failed; serving the previous ui/dist bundle")
        die("UI build failed and there is no previous bundle")


def model_mode():
    url = os.environ.get("LLM_BASE_URL", "")  # adapters/llm.py: e.g. http://localhost:8000/v1; unset/"mock" -> MockLLM
    if not url or url == "mock":
        return "MOCK / RECORDED SIMULATION (LLM_BASE_URL unset)"
    req = urllib.request.Request(url.rstrip("/") + "/models")
    if os.environ.get("LLM_API_KEY"):
        req.add_header("Authorization", f"Bearer {os.environ['LLM_API_KEY']}")
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            ids = [m.get("id") for m in json.load(r).get("data", [])]
        return f"LIVE REAL MODEL at {url} ({', '.join(map(str, ids)) or 'no model id listed'})"
    except Exception as e:
        return f"UNAVAILABLE -> recorded simulation ({url}/models: {type(e).__name__})"


def login_link(port):
    r = subprocess.run(UNIFIED + ["link", "--port", str(port)], cwd=ROOT, capture_output=True, text=True)
    return next((ln.strip() for ln in r.stdout.splitlines() if "/auth?code=" in ln), None)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8766)
    p.add_argument("--no-open", action="store_true", help="do not open the browser")
    p.add_argument("--reset-demo", action="store_true", help="delete ONLY data/unified/ (synthetic demo state) first")
    a = p.parse_args()

    if sys.version_info < (3, 11):
        die(f"python >= 3.11 required, this is {sys.version.split()[0]}")

    port, state = a.port, probe(a.port)
    for _ in range(10):  # ponytail: next 10 ports only; widen if the demo box is that crowded
        if state != "foreign":
            break
        print(f"[demo] port {port} is held by something that is not SkillForge; leaving it alone, trying {port + 1}")
        port += 1
        state = probe(port)
    if state == "foreign":
        die(f"ports {a.port}..{port} are all taken by other programs; pass --port <free port>")

    if a.reset_demo:
        if state == "ours":
            die(f"a SkillForge console is running on {port}; stop it before --reset-demo")
        if WORK.exists():
            print(f"[demo] --reset-demo removes {WORK} (synthetic demo state only):")
            for f in sorted(WORK.rglob("*"))[:40]:
                print(f"    {f.relative_to(ROOT)}")
            shutil.rmtree(WORK)

    build_ui()
    if not (WORK / "app.db").exists():
        if WORK.exists() and any(WORK.iterdir()):
            die(f"{WORK} has files but no app.db; not touching it. Re-run with --reset-demo to recreate it")
        if run(UNIFIED + ["setup"]):
            die("unified.py setup failed")
    if run(UNIFIED + ["check"]):
        die("preflight `python scripts/unified.py check` failed (see above)")

    proc = None
    if state == "ours":
        print(f"\n[demo] a SkillForge console already answers on {port}: attaching (it will be left running)")
    else:
        log = open(WORK / "console.log", "ab")
        proc = subprocess.Popen(UNIFIED + ["console", "--port", str(port)], cwd=ROOT, stdout=log,
                                stderr=subprocess.STDOUT)
        print(f"[demo] started console pid {proc.pid} (log: data/unified/console.log)", flush=True)
        deadline = time.monotonic() + 60
        while probe(port) != "ours":
            if proc.poll() is not None:
                die(f"console exited with {proc.returncode}; see data/unified/console.log")
            if time.monotonic() > deadline:
                proc.terminate()
                die("console not ready within 60 s; see data/unified/console.log")
            time.sleep(0.25)

    base = f"http://127.0.0.1:{port}/"
    link = login_link(port)
    print(f"""
==================== SkillForge demo ====================
  mode       : {model_mode()}
  landing    : {base}#/
  guided demo: {base}#/demo
  Bootstrap  : {base}#/world/onboard
  World      : {base}#/world
  console    : {base}#/console
  login      : {link or 'could not get a link: python scripts/unified.py link --port ' + str(port)}
               (one-time, 10 min; new one: python scripts/unified.py link --port {port})
  stop       : {'Ctrl-C (stops only pid ' + str(proc.pid) + ')' if proc else 'attached: this launcher stops nothing'}
==========================================================""", flush=True)
    if link and not a.no_open:
        webbrowser.open(link)  # login sets the session cookie, then the pages above work
    if not proc:
        return 0

    def _stop(*_):
        raise KeyboardInterrupt
    for sig in ("SIGTERM", "SIGBREAK"):  # window close / Ctrl-Break / kill <launcher pid> also clean up our child
        if hasattr(signal, sig):
            signal.signal(getattr(signal, sig), _stop)
    try:
        proc.wait()
        die(f"console exited with {proc.returncode}; see data/unified/console.log")
    except KeyboardInterrupt:
        pass
    finally:
        if proc.poll() is None:
            proc.terminate()  # the Popen handle we own: TerminateProcess on Windows, SIGTERM elsewhere
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()
        print(f"\n[demo] stopped console pid {proc.pid}; port {port} {probe(port)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
