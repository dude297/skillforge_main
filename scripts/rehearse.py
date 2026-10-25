"""End-to-end rehearsal: a SCRIPTED MOCK agent drives the real, secured backend while the console watches.

  python scripts/rehearse.py [--ui] [--approve auto|manual] [--pace 0.8] [--fail-verify] [--restart-service]

What is real here: the trusted tool service (`python -m app serve`, agent token, POST /call), every tool, the
policy, approvals, the verifier, the skill sandbox + hidden validation, the audit trail, and the read-only operator
API/console that displays it. What is NOT: the agent's decisions. They are a fixed script (no model, model_calls stay
null), and the skill it submits is the mock-authored fixture in tests/fixtures. It proves the integration, not
autonomy. On the GB10 the same tool calls come from OpenClaw driven by the local model.

Host steps (reset, task begin/end, approve, skill approve) run through the real CLI, exactly as an operator would.
--approve manual waits for YOU to run the printed approve command in another terminal (the console shows it too).
Uses its own database (data/rehearsal/) unless --db is given, so it never touches data/app.db.
"""
import argparse
import json
import os
import secrets
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "adapters" / "openclaw"))
import client  # noqa: E402  the same stdlib client the sandbox uses

FIXTURE = ROOT / "tests" / "fixtures" / "mock_authored_skill"
LEARN = ROOT / "data" / "learning"
SKILL = "line-total-reconcile"
OPERATOR = "rehearsal-operator"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Rehearsal:
    def __init__(self, a):
        self.a = a
        self.env = dict(os.environ, APP_DB=str(a.db), SKILLS_DIR=str(a.skills), APP_TOKEN=secrets.token_urlsafe(24),
                        APP_RESULTS=str(a.db.parent / "results"), PYTHONIOENCODING="utf-8")
        self.url = f"http://127.0.0.1:{a.port}/call"
        self.serve = None
        self.restarted = False

    # -- processes ------------------------------------------------------------------------------------------
    def start_service(self):
        try:  # someone else on the port (e.g. a leftover serve) would answer with the wrong token: refuse, don't guess
            socket.create_connection(("127.0.0.1", self.a.port), timeout=0.2).close()
            raise SystemExit(f"port {self.a.port} is already in use; stop that process or pass --port")
        except OSError:
            pass
        self.serve = subprocess.Popen([sys.executable, "-m", "app", "serve", "--port", str(self.a.port)], cwd=ROOT,
                                      env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if self.serve.poll() is not None:
                raise SystemExit(f"agent tool service exited ({self.serve.returncode})")
            try:
                socket.create_connection(("127.0.0.1", self.a.port), timeout=0.2).close()
                return
            except OSError:
                time.sleep(0.1)
        raise SystemExit("agent tool service did not start")

    def stop_service(self):
        if self.serve and self.serve.poll() is None:
            self.serve.terminate()
            self.serve.wait(10)

    def host(self, *args):
        """An operator command, through the real CLI."""
        p = subprocess.run([sys.executable, "-m", "app", *args], cwd=ROOT, env=self.env, capture_output=True,
                           text=True, encoding="utf-8")
        if p.returncode != 0:
            raise SystemExit(f"host command failed: python -m app {' '.join(args)}\n{p.stdout[-800:]}{p.stderr[-800:]}")
        return json.loads(p.stdout) if p.stdout.strip().startswith(("{", "[")) else p.stdout

    # -- the agent: tool calls over HTTP with the agent token, nothing else ------------------------------------
    def call(self, tool, args=None, files=None):
        body = {"tool": tool, "args": args or {}}
        if files is not None:
            body["files"] = files
        req = urllib.request.Request(self.url, data=json.dumps(body).encode(), method="POST", headers={
            "Content-Type": "application/json", "Authorization": f"Bearer {self.env['APP_TOKEN']}"})
        res = client.send(req)
        log(f"  agent  {tool:<17} {'ok' if res.get('ok') else 'ERR ' + str((res.get('error') or {}).get('code'))}")
        time.sleep(self.a.pace)
        return res

    # -- human decisions ----------------------------------------------------------------------------------------
    def ro(self):
        c = sqlite3.connect(f"{Path(self.a.db).resolve().as_uri()}?mode=ro", uri=True)
        c.row_factory = sqlite3.Row
        return c

    def await_approvals(self, ids):
        if not ids:
            return
        if self.a.approve == "auto":
            time.sleep(self.a.pace * 2)
            self.host("approve", *map(str, ids), "--by", OPERATOR)
            log(f"  human  approved {ids} (auto, as '{OPERATOR}')")
            return
        log(f"  WAITING for a person. In another terminal (same env):\n"
            f"    APP_DB={self.a.db} python -m app approve {' '.join(map(str, ids))} --by <your name>")
        while True:
            with self.ro() as c:
                left = [r[0] for r in c.execute(f"SELECT action_id FROM approvals WHERE status='pending' AND action_id IN "
                                                f"({','.join('?' * len(ids))})", ids)]
            if not left:
                return
            time.sleep(1)

    def await_skill_promotion(self, version):
        if self.a.approve == "auto":
            time.sleep(self.a.pace * 2)
            self.host("skill", "approve", SKILL, str(version), "--by", OPERATOR)
            log(f"  human  promoted {SKILL} v{version} (hidden validation ran on the host)")
            return
        log(f"  WAITING for a person to promote the skill:\n"
            f"    APP_DB={self.a.db} SKILLS_DIR={self.a.skills} python -m app skill approve {SKILL} {version} --by <your name>")
        while True:
            with self.ro() as c:
                r = c.execute("SELECT status FROM skills WHERE name=? AND version=?", (SKILL, version)).fetchone()
            if r and r[0] != "tested":
                return
            time.sleep(1)

    # -- shared agent steps -------------------------------------------------------------------------------------
    def execute_and_verify(self, ids, drift_first=False):
        results = []
        for i, aid in enumerate(ids):
            if self.a.restart_service and not self.restarted:
                self.restarted = True
                log("  FAULT  host service restarts while the agent is mid-run (connection refused, client retries)")
                self.stop_service()
                threading.Timer(1.5, self.start_service).start()
            self.call("execute_action", {"action_id": aid})
            again = self.call("execute_action", {"action_id": aid})  # a retried call must never double-apply
            assert again.get("already_executed"), f"duplicate execute was not idempotent: {again}"
            if drift_first and i == 0:
                log("  FAULT  another writer changes the record after the fix, before verification")
                with sqlite3.connect(self.a.db) as c:
                    c.execute("UPDATE records SET data=json_set(data, '$.total', json_extract(data, '$.total') + 1) "
                              "WHERE id=(SELECT record_id FROM actions WHERE id=?)", (aid,))
            v = self.call("verify_action", {"action_id": aid})
            results.append({"action_id": aid, "passed": v.get("passed")})
        return results

    # -- act 1: unfamiliar problem, solved step by step, then learned ------------------------------------------------
    def act_learn(self):
        log("ACT 1  unfamiliar data: the (scripted) agent investigates, a person approves, the verifier checks")
        self.host("reset", "--scenario", str(LEARN / "learn_a.json"))
        tid = self.host("task", "begin", "Totals check, batch A", "--mode", "mock")["task_id"]
        self.call("search_skills", {"query": "record total line items mismatch"})
        recs = self.call("read_records")["records"]
        ids = []
        for rec in recs:
            inv = self.call("investigate", {"record_id": rec["id"]})
            for e in inv.get("evidence", []):  # MOCK reasoning: the rule a model would have to infer
                lines = e["data"].get("lines")
                if e["source"] != "line_export" or not e["trusted"] or not isinstance(lines, list) or "total" not in rec["data"]:
                    continue
                expected = sum(lines) / e["data"].get("scale", 1)
                if abs(rec["data"]["total"] - expected) > 1e-9:
                    p = self.call("propose_action", {"record_id": rec["id"], "action_type": "set_field",
                                                     "params": {"field": "total", "value": expected},
                                                     "reason": f"trusted line items / scale = {expected}; record says {rec['data']['total']}"})
                    if p.get("ok"):
                        self.call("request_approval", {"action_id": p["action"]["id"]})
                        ids.append(p["action"]["id"])
        self.call("execute_action", {"action_id": ids[0]})  # tries to act before approval: must be refused
        self.await_approvals(ids)
        verified = self.execute_and_verify(ids)
        files = client.draft_files(FIXTURE)
        sk = self.call("propose_skill", {"name": SKILL, "description": "MOCK-AUTHORED fixture: recompute a record total "
                                         "from trusted line items and scale", "tags": ["totals", "mock"]}, files=files)
        self.host("task", "end")
        if sk.get("status") == "tested":
            self.await_skill_promotion(sk["version"])
        return {"task_id": tid, "actions": ids, "verified": verified, "skill": {k: sk.get(k) for k in ("version", "status")}}

    # -- act 2: new data of the same kind, handled by the learned skill ------------------------------------------------
    def act_reuse(self):
        log("ACT 2  new data, same kind: the approved skill handles it with no model; same approval + verifier")
        self.host("reset", "--scenario", str(LEARN / "learn_b.json"))
        tid = self.host("task", "begin", "Totals check, batch B", "--mode", "mock")["task_id"]
        hit = self.call("search_skills", {"query": "record total line items mismatch"})
        best = next((h for h in hit.get("skills", []) if h.get("compatible")), None)
        if not best:
            self.host("task", "end")
            return {"task_id": tid, "skill_used": None}
        run = self.call("run_skill", {"name": best["name"], "propose": True})
        ids = [x["id"] for x in run.get("actions", [])]
        self.await_approvals(ids)
        verified = self.execute_and_verify(ids, drift_first=self.a.fail_verify)
        self.host("task", "end")
        return {"task_id": tid, "skill_used": run.get("skill"), "actions": ids, "verified": verified}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", type=Path, default=ROOT / "data" / "rehearsal" / "app.db")
    ap.add_argument("--skills", type=Path, help="default: <db dir>/skills")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--pace", type=float, default=0.8, help="seconds between agent steps, so the console can be watched")
    ap.add_argument("--approve", choices=["auto", "manual"], default="auto")
    ap.add_argument("--fail-verify", action="store_true", help="fault: a record drifts after the fix (act 2)")
    ap.add_argument("--restart-service", action="store_true", help="fault: the host service restarts mid-run")
    ap.add_argument("--keep", action="store_true", help="keep the existing DB (default for the rehearsal DB: start fresh)")
    ap.add_argument("--fresh", action="store_true", help="allow deleting a NON-default --db (and its <dir>/skills) first")
    ap.add_argument("--ui", action="store_true", help="also start the read-only console on 127.0.0.1:8766")
    ap.add_argument("--bench", action="store_true", help="also record a MOCK benchmark (1 trial) for the Benchmarks view")
    a = ap.parse_args()
    a.db = a.db.resolve()
    a.skills = (a.skills or a.db.parent / "skills").resolve()
    a.db.parent.mkdir(parents=True, exist_ok=True)
    default_db = (ROOT / "data" / "rehearsal" / "app.db").resolve()
    if not a.keep and a.db != default_db and not a.fresh and a.db.exists():
        raise SystemExit(f"refusing to delete {a.db}: it is not the rehearsal DB. Pass --keep to use it, or --fresh to wipe it.")
    if not a.keep:  # only the DB named here and its own <dir>/skills, never anything else
        for f in (a.db, Path(f"{a.db}-wal"), Path(f"{a.db}-shm")):
            f.unlink(missing_ok=True)
        if a.skills.is_dir() and a.skills == (a.db.parent / "skills").resolve():
            import shutil
            shutil.rmtree(a.skills)
    r = Rehearsal(a)
    ui = None
    try:
        r.start_service()
        log(f"agent tool service up on {r.url} (agent token is per-run); DB {a.db}")
        r.host("db", "check")  # creates/migrates the DB before anyone reads it
        if a.ui:
            ui = subprocess.Popen([sys.executable, "-m", "app", "ui"], cwd=ROOT, env=dict(r.env, APP_SERVICE_URL=r.url),
                                  stdout=subprocess.PIPE, text=True)
            log(f"console: {ui.stdout.readline().strip()}")
            log(ui.stdout.readline().strip())
        out = {"mock_agent": True, "model_calls": None, "act1": r.act_learn(), "act2": r.act_reuse()}
        if a.bench:  # bench uses its own temp DB; only result.json lands next to the rehearsal DB
            log("BENCH  recording a MOCK A/B/C benchmark (plumbing only, no model)")
            r.host("bench", "--trials", "1", "--out", str(a.db.parent / "results" / "mock-rehearsal"))
        a1 = all(v["passed"] for v in out["act1"]["verified"])
        a2 = [v["passed"] for v in out["act2"].get("verified", [])]
        out["expectations_met"] = a1 and out["act1"]["skill"]["status"] == "tested" and bool(a2) and (
            (a2[0] is False and all(a2[1:])) if a.fail_verify else all(a2))
        print(json.dumps(out, indent=2))
        if ui:
            log("rehearsal done; console still running. Ctrl+C to stop.")
            ui.wait()
        return 0 if out["expectations_met"] else 1
    except KeyboardInterrupt:
        return 130
    finally:
        r.stop_service()
        if ui and ui.poll() is None:
            ui.terminate()


if __name__ == "__main__":
    sys.exit(main())
