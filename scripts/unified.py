"""SkillForge unified-alpha: ONE entry point over the existing commands. Adds no API, auth path or service.

  python scripts/unified.py check                  preflight: versions, UI bundle, model/Docker presence (read-only)
  python scripts/unified.py setup                  fresh synthetic workspace DB + MOCK skill library in data/unified/
  python scripts/unified.py console [--port 8766]  operator console + World + Bootstrap Lite (foreground; Ctrl-C stops)
  python scripts/unified.py link   [--port 8766]   one-time login link for the running console
  python scripts/unified.py inspect [freight-week2]  read-only Bootstrap inspection, printed (writes nothing)
  python scripts/unified.py message "<text>" [--ref freight_week2.json] [--from dana]   SIMULATED employee message
  python scripts/unified.py pending                what waits for a person (then: python -m app approve ...)
  python scripts/unified.py complete <correlation_id>  after approval: execute + independent verification + reply
  python scripts/unified.py status                 health, tasks, routed events
  python scripts/unified.py test [fast|full|ui]    the suites, sequentially

Single workspace, single open task (alpha limitation). Every state lives in data/unified/ (gitignored);
data/app.db, data/rehearsal/ and skills/ are never touched. Nothing here downloads, installs, grants, approves or
sends: approvals stay `python -m app approve <id> --by <name>`, typed by a person on this host.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "unified"
ENV = {"APP_DB": str(WORK / "app.db"), "SKILLS_DIR": str(WORK / "skills")}
os.environ.update(ENV)  # before any app import: db.connect() and sf.SKILLS_DIR read these
sys.path.insert(0, str(ROOT))

# SIMULATED channel meta, as the (unbuilt) host adapter would produce it. Never presented as Slack or NemoClaw.
SIM_META = {"channel": "slack", "workspace": "T0ACME", "conversation": "#freight-ops", "assurance": "allowlist_only"}
SIM = "[SIMULATED channel: no Slack, no NemoClaw; experiments/channel/contract.py]"


def sh(*cmd, check=True):
    print("$", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=ROOT, env={**os.environ, **ENV}, check=check).returncode


def conn():
    from app import db
    return db.connect()


def check(_a):
    built = (ROOT / "ui" / "dist" / "index.html").exists()
    rows = [("python >= 3.11", sys.version_info >= (3, 11), sys.version.split()[0]),
            ("UI bundle ui/dist", built, "built" if built else "build: npm --prefix ui run build"),
            ("node (UI build/e2e only)", shutil.which("node") is not None, shutil.which("node") or "not found"),
            ("docker (skill isolation; else subprocess runner)", shutil.which("docker") is not None,
             shutil.which("docker") or "not found"),
            ("local model", None, os.environ.get("LLM_BASE_URL") or "LLM_BASE_URL unset: MOCK only, nothing downloaded"),
            ("workspace DB", Path(ENV["APP_DB"]).exists(), ENV["APP_DB"] if Path(ENV["APP_DB"]).exists() else "run: setup")]
    for name, ok, detail in rows:
        print(f"  [{ {True: ' ok ', False: 'MISS', None: ' -- '}[ok] }] {name}: {detail}")
    if Path(ENV["APP_DB"]).exists():  # doctor opens the DB: never create one from a preflight
        print("\n  doctor (read-only):")
        sh(sys.executable, "-m", "app", "doctor", check=False)
    return 0 if all(ok is not False for n, ok, _ in rows if n.startswith(("python", "UI"))) else 1


def setup(_a):
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    from experiments.catalog import library
    c = conn()
    print("MOCK library: a scripted stand-in did the solve and a human wrote the skills. This proves the plumbing, "
          "not learning. Hidden suites + catalog grants are real.")
    print(json.dumps(library.build(c), indent=1, default=str)[:1500])
    c.commit()
    print(f"\nready: {ENV['APP_DB']}. Next: console, then message")


def console(a):
    from app import ui_api
    from experiments.bootstrap_lite import lite
    lite.install()
    from experiments.oncall_infer import route as oncall_route
    oncall_route.install()
    print(f"World: http://127.0.0.1:{a.port}/#/world   Bootstrap Lite: #/world/onboard   Console: #/console\n"
          f"login: python scripts/unified.py link --port {a.port}   stop: Ctrl-C", flush=True)
    try:
        ui_api.serve("127.0.0.1", a.port)  # loopback only, read-only DB, operator session: unchanged
    except KeyboardInterrupt:
        print("stopped")


def link(a):
    sh(sys.executable, "-m", "app", "ui", "--link", "--port", str(a.port))


def inspect(a):
    from experiments.bootstrap_lite import lite
    r = lite.discover(a.workspace, conn(), None)
    print(f"workspace {r['workspace']['id']} ({r['workspace']['file']}); writes performed: {r['writes_performed']}")
    for c in r["capabilities"] + r["workflows"]:
        print(f"  {c['state']:<12} {c['name']}: {c['evidence'][:110]}")
    print(f"active now: {'; '.join(r['summary']['active']) or 'nothing'}")
    print("permissions (none granted): " + ", ".join(p["action"] for p in r["permissions"]))


def message(a):
    from experiments.channel import contract
    c = conn()
    meta = {**SIM_META, "conversation": a.conversation, "sender": a.sender, "message_id": a.id or f"m{int(__import__('time').time() * 1000)}"}
    r = contract.accept(c, {"text": a.text, "ref": a.ref}, meta)
    c.commit()
    print(f"{SIM}\n  {a.sender}: {a.text}\n  SkillForge: {r['reply']}\n  status {r['status']}, correlation id "
          f"{r.get('correlation_id')}")
    if r["status"] == "awaiting_approval":
        print("\nA person approves on this host (see the console, or):\n  python scripts/unified.py pending")


def pending(_a):
    sh(sys.executable, "-m", "app", "pending")
    print(f"\napprove as yourself, with the env above:  APP_DB={ENV['APP_DB']} python -m app approve <id> --by <name>"
          "\nthen: python scripts/unified.py complete <correlation_id>")


def complete(a):
    from experiments.channel import contract
    from experiments.router import router
    c = conn()
    r = router.complete(c, a.correlation_id)
    c.commit()
    s = contract.status(c, a.correlation_id)
    print(f"{SIM}\n  SkillForge -> {s.get('requested_by')}: {s['reply']}\n  status {s['status']}")
    for link_ in s.get("chain", []):
        print(f"  action {link_['action_id']}: approval {link_['approval']} by {link_['approved_by']}"
              f"{' (SELF-APPROVED)' if link_['self_approved'] else ''}, executed {link_['executed']}, "
              f"verified {link_['verified']}")
    return 0 if r.get("ok") else 1


def status(_a):
    from app import skillforge as sf
    from experiments.router import router
    c = conn()
    c.execute(router.SCHEMA)
    for t in sf.task_list(c)["tasks"][-8:]:
        print(f"  task {t['id']:>3} {t['status']:<6} success={t['success']} model_calls={t['model_calls']} "
              f"mode={t['mode']} {t['label']}")
    for e in c.execute("SELECT event_id, status, kind FROM router_events ORDER BY received_at DESC LIMIT 8"):
        print(f"  event {e['event_id']}: {e['status']} ({e['kind']})")
    sh(sys.executable, "-m", "app", "status", check=False)


TESTS = {  # sequential on purpose: the dev box has little free memory
    "fast": [["tests/test_contracts.py", "tests/test_bakeoff.py"]],
    # named files: skill fixtures' own tests (skills/*/tests) run inside the skill runner, not here
    "full": [["tests/"]] + [[str(p.relative_to(ROOT))] for p in sorted(ROOT.glob("experiments/*/test_*.py"))],
}


def test(a):
    if a.suite == "ui":
        for script in ("lint", "typecheck", "build", "test:e2e"):
            sh("npm", "--prefix", "ui", "run", script)
        return sh("npx", "--prefix", "ui", "playwright", "test", "-c", "ui/playwright.live.config.ts", check=False)
    return max(sh(sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *paths, check=False)
               for paths in TESTS[a.suite])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("check", "setup", "pending", "status"):
        sub.add_parser(name)
    for name in ("console", "link"):
        sub.add_parser(name).add_argument("--port", type=int, default=8766)
    sub.add_parser("inspect").add_argument("workspace", nargs="?", default="freight-week2")
    m = sub.add_parser("message")
    m.add_argument("text")
    m.add_argument("--ref", default="freight_week2.json")
    m.add_argument("--from", dest="sender", default="dana@acme.example")
    m.add_argument("--conversation", default=SIM_META["conversation"], help="#freight-ops (supply team) or #records")
    m.add_argument("--id", help="channel message id (default: a new one; reuse it to test redelivery)")
    sub.add_parser("complete").add_argument("correlation_id")
    sub.add_parser("test").add_argument("suite", nargs="?", default="fast", choices=["fast", "full", "ui"])
    a = p.parse_args()
    return globals()[a.cmd](a) or 0


if __name__ == "__main__":
    sys.exit(main())
