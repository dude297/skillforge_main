"""CLI. Agent boundary = `call` (JSON in, JSON out). Human boundary = approve/reject/pending.

  python -m app reset                         load data/scenario.json into a fresh DB
  python -m app call <tool> '<json-args>'     agent-callable tool (see app/tools.py AGENT_TOOLS)
  python -m app tools                         list agent tools
  python -m app pending                       pending approvals (human)
  python -m app approve <id>... --by NAME     human approval (one or more action ids)
  python -m app reject <id>... --by NAME      human rejection
  python -m app task begin <label> --mode real|mock / task end [--model-calls N] / task list
  python -m app skill list | approve <name> <ver> --by NAME | reject <name> <ver> --by NAME
                      | disable <name> --by NAME | rollback <name> --by NAME
  python -m app serve [--bind IP --port N]   trusted agent-tool service (host side of the sandbox boundary)
  python -m app ui [--port 8766]              read-only operator API + console (loopback only; GET only)
  python -m app flywheel                      MOCK SkillForge benchmark (A: learn, B: reuse, unrelated: refuse)
  python -m app audit                         audit trail
  python -m app demo [--yes]                  scripted MOCK-agent walkthrough of the full loop
  python -m app doctor                        environment checks
  python -m app check-llm                     local inference endpoint readiness (uses LLM_* env)
"""
import argparse
import inspect
import json
import platform
import shutil
import sqlite3
import sys
from pathlib import Path

from adapters import llm as llm_mod
from app import db, skillforge as sf, tools


def action_fingerprint(record_id, params_text):
    """8 hex chars of sha256(record | canonical params): identifies WHAT an action changes, not its reusable id."""
    import hashlib
    params = json.loads(params_text) if isinstance(params_text, str) else params_text
    return hashlib.sha256(json.dumps([record_id, params], sort_keys=True).encode()).hexdigest()[:8]


def out(obj):
    print(json.dumps(obj, indent=2, default=str))


def run_demo(conn, auto_approve=False, approver="demo-operator", stream=print, ask=input):
    """MOCK AGENT: a fixed script calling the real tools. It shows the plumbing, not model reasoning.
    In the real runtime OpenClaw (driven by the local model) makes these same `call` invocations."""
    def step(title, result):
        stream(f"\n== {title}\n{json.dumps(result, indent=2, default=str)}")
        if not result.get("ok", True):
            raise SystemExit(f"demo step failed: {title}")
        return result

    db.load_scenario(conn)
    since = conn.execute("SELECT MAX(id) FROM audit").fetchone()[0]
    stream("[MOCK AGENT] deterministic script, no LLM involved")
    step("1. read records", tools.call(conn, "read_records", {}))
    inv = step("2. investigate REC-001", tools.call(conn, "investigate", {"record_id": "REC-001"}))
    mismatch = next(f for f in inv["findings"] if f["status"] == "mismatch")
    prop = step("3. propose bounded fix", tools.call(conn, "propose_action", {
        "record_id": "REC-001", "action_type": "set_field",
        "params": {"field": mismatch["field"], "value": mismatch["expected"]},
        "reason": f"trusted sources agree on {mismatch['expected']}, record says {mismatch['current']}"}))
    action_id = prop["action"]["id"]
    step("4. request approval", tools.call(conn, "request_approval", {"action_id": action_id}))
    step("4b. agent tries to execute before approval (must be refused)",
         {"ok": True, "refused": tools.call(conn, "execute_action", {"action_id": action_id})})
    if auto_approve:
        stream(f"\n[HUMAN] auto-approved by '{approver}' (--yes)")
        ok = True
    else:
        ok = ask(f"\n[HUMAN] approve action {action_id} {prop['action']['params']}? [y/N] ").strip().lower() == "y"
    step("5. human decision", tools.decide_approval(conn, action_id, ok, approver))
    if not ok:
        stream("\nRejected. Execution will be refused:")
        step("6. execute (refused)", {"ok": True, "refused": tools.call(conn, "execute_action", {"action_id": action_id})})
        return {"ok": True, "executed": False}
    step("6. execute", tools.call(conn, "execute_action", {"action_id": action_id}))
    step("6b. retry execute (idempotent, no double-apply)", tools.call(conn, "execute_action", {"action_id": action_id}))
    ver = step("7. independent verification", tools.call(conn, "verify_action", {"action_id": action_id}))
    aud = tools.get_audit(conn)
    stream("\n== 8. audit trail")
    for e in (e for e in aud["events"] if e["id"] >= since):
        stream(f"  {e['ts']}  {e['actor']:<22} {e['event']}")
    stream(f"\nRESULT: verification {'PASSED' if ver['passed'] else 'FAILED'}")
    return {"ok": True, "executed": True, "verified": ver["passed"]}


def _hidden_check_dir(path):
    """Host-side: validate a candidate dir downloaded from the sandbox against the hidden suite."""
    from pathlib import Path
    d = Path(path)
    meta = json.loads((d / "meta.json").read_text())
    res = sf.hidden_check(d, meta["scenario"], meta["input_shape"])
    return {**res, "sha256": sf._tree_hash(d)}


def doctor(conn):
    checks = []
    add = lambda name, ok, detail="": checks.append({"check": name, "ok": bool(ok), "detail": detail})
    add("python>=3.11", sys.version_info >= (3, 11), sys.version.split()[0])
    add("sqlite", True, sqlite3.sqlite_version)
    add("arch", True, platform.machine())
    try:
        tools._policy(conn)
        add("scenario_loaded", True)
    except tools.ToolError as e:
        add("scenario_loaded", False, e.message)
    try:
        add("llm_endpoint", True, json.dumps(llm_mod.from_env().health()))
    except llm_mod.LLMUnavailable as e:
        add("llm_endpoint", False, str(e))
    for exe in ("git", "docker", "nvidia-smi", "node", "openshell", "nemoclaw", "openclaw"):
        add(f"on_path:{exe}", shutil.which(exe), "info only off-GB10")
    return {"ok": all(c["ok"] for c in checks[:4]), "checks": checks}


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m app", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("reset").add_argument("--scenario")
    c = sub.add_parser("call")
    c.add_argument("tool")
    c.add_argument("args", nargs="?", default="{}")
    for name in ("approve", "reject"):
        a = sub.add_parser(name)
        a.add_argument("action_ids", type=int, nargs="+")
        a.add_argument("--by", required=True)
        a.add_argument("--note", default="")
        a.add_argument("--expect", help="comma-separated fingerprints, one per id (the console's commands include them): "
                                        "refuse if any action is not exactly what was reviewed")
    t = sub.add_parser("task")
    t.add_argument("op", choices=["begin", "mark", "end", "list"])
    t.add_argument("label", nargs="?", default="task")
    t.add_argument("--mode", choices=["real", "mock"], default="real")
    t.add_argument("--model-calls", type=int, help="override when the inference counter is unreachable")
    k = sub.add_parser("skill")
    k.add_argument("op", choices=["list", "approve", "reject", "disable", "rollback", "bench", "hidden-check"])
    k.add_argument("name", nargs="?", help="skill name (hidden-check: a downloaded candidate dir)")
    k.add_argument("version", nargs="*", type=int, help="version(s); bench takes two")
    k.add_argument("--by")
    k.add_argument("--hidden-sha", help="sha256 printed by a host-side `skill hidden-check` of these exact files")
    sub.add_parser("demo").add_argument("--yes", action="store_true", help="auto-approve as 'demo-operator'")
    bn = sub.add_parser("bench", help="three-mode benchmark A/B/C (+ learning cost and break-even)")
    bn.add_argument("--trials", type=int, default=5)
    bn.add_argument("--agent", choices=["mock", "openclaw"], default="mock")
    bn.add_argument("--db", help="real runs: the SAME db the `serve` process uses")
    bn.add_argument("--skills-dir")
    bn.add_argument("--cases", help="comma-separated subset of app.bench.CASES")
    bn.add_argument("--modes", default="A,B,C", help="subset, e.g. C or A,C")
    bn.add_argument("--reuse-skill", action="store_true", help="skip learning if an approved skill already exists")
    bn.add_argument("--out", help="also copy result.json here (e.g. results/bakeoff/<label>)")
    bk = sub.add_parser("bakeoff", help="model capability probes vs the served model; compare result dirs")
    bk.add_argument("op", choices=["run", "compare"])
    bk.add_argument("dirs", nargs="*", help="compare: result dirs")
    bk.add_argument("--label", help="run: results/bakeoff/<label>")
    bk.add_argument("--reps", type=int, default=3)
    bk.add_argument("--oncall", help="run: path to experiments/oncall (exp/scenarios branch) for the patch probe")
    sv = sub.add_parser("serve", help="trusted agent-tool service for the sandbox (host only)")
    sv.add_argument("--bind", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8765)
    ui = sub.add_parser("ui", help="read-only operator API + console on one loopback origin (host only)")
    ui.add_argument("--bind", default="127.0.0.1")
    ui.add_argument("--port", type=int, default=8766)
    ui.add_argument("--link", action="store_true", help="print a fresh one-time login link for a running console")
    sub.add_parser("models", help="local model registry + capability probe").add_argument("op", choices=["list", "probe"])
    sub.add_parser("status", help="operator diagnosis: inference, sandbox, service, stuck work, next steps")
    sub.add_parser("recover", help="after a crash: verify interrupted executions; never re-executes")
    sk = sub.add_parser("soak", help="MOCK soak test: mixed trials + injected faults, invariants after each")
    sk.add_argument("--trials", type=int, default=30)
    sk.add_argument("--seed", type=int, default=7)
    sub.add_parser("fastpath", help="NO-MODEL mode: reuse an exactly matching approved skill, else escalate"
                   ).add_argument("--execute", action="store_true", help="execute + verify approved skill actions")
    dbp = sub.add_parser("db", help="integrity check / online backup / restore (stop serve before restore)")
    dbp.add_argument("op", choices=["check", "backup", "restore"])
    dbp.add_argument("path", nargs="?")
    dbp.add_argument("--services-stopped", action="store_true",
                     help="restore: you stopped serve and ui (needed when serve's address is not configured)")
    for name in ("tools", "pending", "audit", "doctor", "check-llm", "flywheel"):
        sub.add_parser(name)
    a = p.parse_args(argv)

    if a.cmd == "bench":
        from app import bench
        agent = bench.OpenClawAgent() if a.agent == "openclaw" else bench.MockAgent()
        res = bench.run(a.trials, agent, a.db, a.skills_dir, modes=tuple(a.modes.split(",")),
                        cases=a.cases.split(",") if a.cases else None, reuse_skill=a.reuse_skill)
        print(bench.report(res))
        if a.out:
            Path(a.out).mkdir(parents=True, exist_ok=True)
            shutil.copy(res["result_file"], Path(a.out) / "result.json")
        return 0
    if a.cmd == "bakeoff":
        from app import bakeoff
        if a.op == "compare":
            print(bakeoff.compare(a.dirs))
            return 0
        if not a.label:
            p.error("bakeoff run needs --label")
        r = bakeoff.run(a.label, a.reps, a.oncall)
        print(json.dumps({k: v for k, v in r.items() if k != "probes"}, indent=2, default=str))
        print(bakeoff.compare([Path(r["file"]).parent]))
        return 0
    if a.cmd == "serve":
        from app import server
        return server.serve(a.bind, a.port)
    if a.cmd == "ui":
        from app import ui_api
        if a.link:
            print(ui_api.login_link(a.port))
            return 0
        return ui_api.serve(a.bind, a.port)
    if a.cmd == "soak":
        from app import soak
        res = soak.run(a.trials, a.seed)
        out(res)
        return 0 if res["clean"] else 1
    if a.cmd == "models":
        from adapters import models
        if a.op == "list":
            return out({"ok": True, "registry": str(models.REGISTRY), "models": [
                {k: m[k] for k in ("id", "role", "nemoclaw_profile", "tool_parser", "validation")} for m in models.registry()["models"]]}) or 0
        res = models.probe(llm_mod.from_env())
        models.save(res)
        out(res)
        return 0 if res["passed"] else 1
    if a.cmd == "db" and a.op == "restore":
        from app import ops
        res = ops.db_restore(a.path or p.error("db restore needs a backup path"), a.services_stopped)
        out(res)
        return 0 if res["ok"] else 1
    conn = db.connect()
    if a.cmd in ("status", "recover", "fastpath", "db"):
        from app import ops
        if a.cmd == "db":
            res = ops.db_backup(conn, a.path) if a.op == "backup" else {
                "ok": conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok",
                "integrity_check": conn.execute("PRAGMA integrity_check").fetchone()[0],
                "journal_mode": conn.execute("PRAGMA journal_mode").fetchone()[0]}
        else:
            res = {"status": lambda: ops.status(conn), "recover": lambda: ops.recover(conn),
                   "fastpath": lambda: ops.fastpath(conn, a.execute)}[a.cmd]()
        out(res)
        return 0 if res.get("ok", True) else 1
    if a.cmd == "reset":
        s = db.load_scenario(conn, a.scenario)
        return out({"ok": True, "scenario": s["name"], "records": len(s["records"])})
    if a.cmd == "call":
        try:
            args = json.loads(a.args)
        except json.JSONDecodeError as e:
            args = None
            res = tools.ToolError("invalid_input", f"args is not valid JSON: {e}").to_dict()
        if args is not None:
            res = tools.call(conn, a.tool, args)
        out(res)
        return 0 if res.get("ok") else 2
    try:
        if a.cmd in ("approve", "reject"):
            if a.expect is not None:
                want = a.expect.split(",")
                if len(want) != len(a.action_ids):
                    raise tools.ToolError("invalid_input", "--expect needs one fingerprint per action id")
                for i, fp in zip(a.action_ids, want):
                    row = conn.execute("SELECT record_id, params FROM actions WHERE id=?", (i,)).fetchone()
                    if not row or action_fingerprint(row["record_id"], row["params"]) != fp:
                        raise tools.ToolError("fingerprint_mismatch", f"action {i} is not the change you reviewed "
                                              "(different database? APP_DB) or it was replaced after a reset. Nothing "
                                              "was approved; re-check the console.")
            return out([tools.decide_approval(conn, i, a.cmd == "approve", a.by, a.note) for i in a.action_ids])
        if a.cmd == "task":
            return out({"begin": lambda: sf.task_begin(conn, a.label, a.mode),
                        "mark": lambda: sf.task_mark(conn, a.label, a.model_calls),
                        "end": lambda: sf.task_end(conn, a.model_calls), "list": lambda: sf.task_list(conn)}[a.op]())
        if a.cmd == "skill":
            ops = {"list": lambda: sf.list_skills(conn),
                   "approve": lambda: sf.approve_skill(conn, a.name, a.version[0], a.by, a.hidden_sha),
                   "reject": lambda: sf.reject_skill(conn, a.name, a.version[0], a.by),
                   "bench": lambda: {"ok": True, "rows": sf.bench(conn, a.name, a.version)},
                   "hidden-check": lambda: _hidden_check_dir(a.name),
                   "disable": lambda: sf.disable_skill(conn, a.name, a.by),
                   "rollback": lambda: sf.rollback_skill(conn, a.name, a.by)}
            return out(ops[a.op]())
    except tools.ToolError as e:
        out(e.to_dict())
        return 2
    if a.cmd == "flywheel":
        from app import flywheel  # dev-only; not shipped into the sandbox (it contains the scripted answer)
        res = flywheel.run(conn)
        print("[MOCK] scripted agent + MOCK-AUTHORED fixture skill; model_calls n/a. Not evidence of learning.\n")
        print(flywheel.table(res["tasks"]))
        print(f"\nskill proposal: {res['proposal'].get('status')}  replay ok: {res['proposal'].get('validation', {}).get('replay', {}).get('ok')}")
        if res.get("optimized_proposal"):
            o = res["optimized_proposal"]
            print(f"profile of v1: {res['proposal'].get('profile')}")
            print(f"optimized v{o.get('version')}: status={o.get('status')} verdict={o.get('optimization')}")
            print("\nbenchmark (identical inputs; cold = process incl. interpreter start, warm = in-process):")
            print(flywheel.bench_table(sf.bench_rows(conn, "line-total-reconcile")))
            cmp = flywheel.compare_reuse(conn, "line-total-reconcile", [res["proposal"]["version"], o["version"]])
            print("\nend-to-end reuse on scenario B (5 trials each; mode A = agentic needs the real model, not run here):")
            for v, r in cmp.items():
                print(f"  v{v}: {r}")
        print(f"unrelated: search says '{res['unrelated_search']['recommendation']}'; run_skill -> {res['unrelated_run'].get('error', {}).get('code')}")
        return 0 if [t["success"] for t in res["tasks"]] == [1, 1, 0] else 1
    if a.cmd == "tools":
        return out({n: str(inspect.signature(f)).replace("(conn, ", "(").replace("(conn)", "()") for n, f in tools.agent_tools().items()})
    if a.cmd == "pending":
        return out(tools.pending_approvals(conn))
    if a.cmd == "audit":
        return out(tools.get_audit(conn, 500))
    if a.cmd == "demo":
        res = run_demo(conn, auto_approve=a.yes)
        return 0 if res.get("verified", True) else 1
    if a.cmd == "doctor":
        res = doctor(conn)
        out(res)
        return 0 if res["ok"] else 1
    if a.cmd == "check-llm":
        try:
            res = llm_mod.smoke_test(llm_mod.from_env())
            if res.get("mock"):
                res["warning"] = "LLM_BASE_URL unset -> MOCK. Set LLM_BASE_URL to test real local inference."
            out(res)
            return 0
        except llm_mod.LLMUnavailable as e:
            out({"ok": False, "error": {"code": "llm_unavailable", "message": str(e)}})
            return 3


if __name__ == "__main__":
    sys.exit(main() or 0)
