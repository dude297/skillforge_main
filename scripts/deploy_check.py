"""Clean deployment check for a FRESH clone (real processes, no preexisting state). Prints PASS/FAIL per step.
  python scripts/deploy_check.py <fresh-clone-dir>      (build or restore ui/dist in that clone first)
Uses ports 8785/8786 and the clone's own data/app.db; never touches this checkout."""
import json, os, secrets, sqlite3, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
UI_PORT, AGENT_PORT = 8786, 8785
DB = ROOT / "data" / "app.db"          # the real default path of a fresh checkout
TOKEN = secrets.token_urlsafe(24)
ENV = dict(os.environ, APP_DB=str(DB), SKILLS_DIR=str(ROOT / "skills"), APP_OPERATOR_TOKEN=TOKEN,
           APP_SERVICE_URL=f"http://127.0.0.1:{AGENT_PORT}/call", PYTHONIOENCODING="utf-8")
results = []


def check(name, ok, evidence=""):
    results.append((name, bool(ok), evidence))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {evidence}", flush=True)


def cli(*a):
    p = subprocess.run([sys.executable, "-m", "app", *a], cwd=ROOT, env=ENV, capture_output=True, text=True, encoding="utf-8")
    return p.returncode, p.stdout


def api(path, auth=True):
    req = urllib.request.Request(f"http://127.0.0.1:{UI_PORT}{path}", headers={"Authorization": f"Bearer {TOKEN}"} if auth else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
    except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
        return 0, {"error": str(e)}


def wait(fn, timeout=60, step=0.3):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(step)
    return None


def start_ui():
    p = subprocess.Popen([sys.executable, "-m", "app", "ui", "--port", str(UI_PORT)], cwd=ROOT, env=ENV,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = wait(lambda: api("/ui/health", auth=False)[0] == 200, 20)
    return p, ok


def kill_tree(p):
    if p and p.poll() is None:
        if os.name == "nt":
            subprocess.run(["taskkill", "/pid", str(p.pid), "/T", "/F"], capture_output=True)
        else:
            p.terminate()
        p.wait(10)


def port_free(port):
    import socket
    try:
        socket.create_connection(("127.0.0.1", port), timeout=0.3).close()
        return False
    except OSError:
        return True


check("fresh: no database before init", not DB.exists(), str(DB))
check("fresh: no operator token file", not (ROOT / "data" / ".operator_token").exists())
check("fresh: console bundle present (built or restored)", (ROOT / "ui" / "dist" / "index.html").exists())
rc, out = cli("db", "check")
check("init: db check creates + migrates", rc == 0 and json.loads(out)["integrity_check"] == "ok", out.strip().replace("\n", " ")[:120])
rc, out = cli("reset")
check("init: scenario loaded", rc == 0, out.strip().replace("\n", " ")[:100])

ui, ok = start_ui()
check("operator API up", ok)
code, body = api("/ui/tasks", auth=False)
check("API refuses without operator session", code == 401, str(code))
code, body = api("/ui/tasks")
check("API answers with token; empty history on fresh DB", code == 200 and body["tasks"] == [], str(body)[:80])
status = api("/ui/status")[1]
check("status: inference not checked (no LLM env) reported as unknown, not healthy", status["inference"]["ok"] is None, status["inference"]["detail"])

# the rehearsal starts the agent tool service itself (real `serve`, per-run agent token) and waits for a PERSON
reh = subprocess.Popen([sys.executable, "scripts/rehearse.py", "--db", str(DB), "--skills", str(ROOT / "skills"), "--keep",
                        "--port", str(AGENT_PORT), "--approve", "manual", "--pace", "0.2"],
                       cwd=ROOT, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
pend = wait(lambda: (lambda b: b["pending"] if len(b.get("pending", [])) >= 2 else None)(api("/ui/approvals")[1]), 60)
check("act 1: agent proposals wait for approval", pend and [a["id"] for a in pend] == [1, 2], str([(a["id"], a["state"]) for a in pend or []]))
code, _ = api("/ui/approvals")
rc, out = cli("approve", "1", "2", "--by", "rehearsal-human")
check("human approves on host CLI", rc == 0)
sk = wait(lambda: next((s for s in api("/ui/skills")[1].get("skills", []) if s["status"] == "tested"), None), 60)
check("skill drafted, own tests + replay passed, waiting for promotion", sk and sk["validation"]["own_tests_ok"] and sk["validation"]["replay_ok"], str(sk and sk["validation"]))
t1 = api("/ui/tasks/1")[1]
done = [a for a in t1["actions"] if a["state"] == "COMPLETED"]
check("act 1: both changes executed + verified", len(done) == 2, str([(a['id'], a['state']) for a in t1["actions"]]))
rc, out = cli("skill", "approve", "line-total-reconcile", "1", "--by", "rehearsal-human")
check("skill promotion on host runs hidden suite", rc == 0 and json.loads(out).get("ok"), out.strip().replace("\n", " ")[:120])

pend2 = wait(lambda: (lambda b: b["pending"] if len(b.get("pending", [])) >= 3 else None)(api("/ui/approvals")[1]), 60)
check("act 2: skill proposals (no model) wait for approval", pend2 and all(a["origin"].startswith("skill:line-total-reconcile@v1") for a in pend2),
      str([(a["id"], a["origin"]) for a in pend2 or []]))

# fault: kill the operator API while act 2 is waiting; the backend keeps going; restart it
kill_tree(ui)
check("operator API killed -> port free", wait(lambda: port_free(UI_PORT), 10))
rc, out = cli("approve", "1", "2", "3", "--by", "rehearsal-human")
check("approval while console is down", rc == 0)
rc_reh = reh.wait(120)
log = reh.stdout.read()
check("rehearsal completed, expectations met", rc_reh == 0 and '"expectations_met": true' in log, f"exit {rc_reh}")
ui, ok = start_ui()
check("operator API restarted", ok)
tasks = api("/ui/tasks")[1]["tasks"]
check("after restart: history intact (2 tasks, both verified)", [(t["id"], t["success"]) for t in tasks] == [(2, 1), (1, 1)], str([(t['id'], t['status'], t['success']) for t in tasks]))
check("act 2 used the skill, model calls unknown (mock) not 0", tasks[0]["skills_used"] == ["line-total-reconcile@v1"] and tasks[0]["model_calls"] is None)

# fault: kill the agent tool service during active execution (rehearse --restart-service), on the same DB
r2 = subprocess.run([sys.executable, "scripts/rehearse.py", "--db", str(DB), "--skills", str(ROOT / "skills"), "--keep",
                     "--port", str(AGENT_PORT), "--approve", "auto", "--pace", "0", "--restart-service"],
                    cwd=ROOT, env=ENV, capture_output=True, text=True, encoding="utf-8")
check("service restart mid-execution: run still completes correctly", r2.returncode == 0 and "FAULT  host service restarts" in r2.stdout, f"exit {r2.returncode}")

# no duplicate actions anywhere: executions are unique per action and match audit execute events per scenario load
c = sqlite3.connect(f"{DB.as_uri()}?mode=ro", uri=True)
dup_exec = c.execute("SELECT COUNT(*) FROM (SELECT action_id FROM executions GROUP BY action_id HAVING COUNT(*)>1)").fetchone()[0]
ev = api("/ui/events?after=0&limit=500")[1]["events"]
segments, cur = [], []
for e in ev:
    if e["event"] == "reset":
        segments.append(cur); cur = []
    cur.append(e)
segments.append(cur)
dupe_in_segment = sum(len(s := [e["payload"].get("action_id") for e in seg if e["event"] == "execute_action"]) - len(set(s)) for seg in segments)
ids = [e["id"] for e in ev]
check("no duplicate executions (DB) and none within any scenario run (audit)", dup_exec == 0 and dupe_in_segment == 0, f"db dupes {dup_exec}, audit dupes {dupe_in_segment}")
check("audit ids strictly increasing, no duplicates", ids == sorted(set(ids)), f"{len(ids)} events")
check("audit history: approvals by the human recorded", sum(e["event"] == "approval_approved" and e["actor"] == "human:rehearsal-human" for e in ev) == 5)
check("audit history: refused pre-approval execution recorded", any(e["event"] == "execute_refused" for e in ev))
rc, out = cli("status")
check("operator status: nothing stuck", rc == 0 and "nothing pending" in out, json.loads(out)["next_actions"][0][:80])

# shut down cleanly
kill_tree(ui)
c.close()
check("all ports free after shutdown", wait(lambda: port_free(UI_PORT) and port_free(AGENT_PORT), 10))
rc, out = cli("db", "check")
check("DB integrity after shutdown", rc == 0 and json.loads(out)["integrity_check"] == "ok")
print(json.dumps({"passed": sum(r[1] for r in results), "failed": [r[0] for r in results if not r[1]]}))
