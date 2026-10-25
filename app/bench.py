"""Three-mode benchmark (host side, trusted). Same inputs and correctness criteria for every mode.

  A  agentic solve        skills hidden; the agent investigates with its normal tools
  B  agent-assisted reuse  skills visible; the agent discovers/selects via search_skills + run_skill
  C  deterministic path    trusted matcher picks a skill, no LLM; uncertain/failed -> fall back to the agent

Agents:
  MockAgent      scripted stand-in (NO model; model_calls stay None). Proves the plumbing only.
  OpenClawAgent  the real agent in the NemoClaw sandbox via `openclaw agent --session-id .. -m .. --json`.

Human approvals are done by a stand-in ("bench-operator"), counted as interventions and timed separately so
automated latency excludes human wait. Every trial resets the domain data and restores skill visibility.

  python -m app bench [--trials 5] [--agent mock|openclaw] [--db PATH] [--skills-dir PATH]
"""
import contextlib
import functools
import json
import os
import shlex
import statistics
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from app import db, skillforge as sf, tools
from app.db import ROOT

LEARN = ROOT / "data" / "learning"
FIXTURE = ROOT / "tests" / "fixtures" / "mock_authored_skill"
SKILL_NAME = "line-total-reconcile"
PROMPT = "Records may have wrong totals. Check them all and fix what's wrong. Follow the records-ops procedure."

# case -> (scenario file, skill visibility for B/C, fault)
CASES = {
    "known_compatible": ("learn_a.json", "visible", None),
    "unseen_compatible": ("learn_b.json", "visible", None),
    "boundary": ("boundary.json", "visible", None),
    "incompatible": ("unrelated.json", "visible", None),
    "malformed": ("malformed.json", "visible", None),
    "lookalike_fingerprint": ("lookalike.json", "visible", None),
    "skill_unavailable": ("learn_b.json", "hidden", None),
    "skill_disabled": ("learn_b.json", "disabled", None),
    "skill_fails_verification": ("learn_b.json", "visible", "post_execute_drift"),
}


# ---- agents ----------------------------------------------------------------------

class MockAgent:
    """MOCK: scripted policy over the real tools. No model and no reasoning, so model_calls is None.
    Its 'investigation' encodes the rule a model would have to infer; it only reports what plumbing costs."""
    real = False
    name = "mock"

    def run(self, conn, approve, label=""):
        hit = tools.call(conn, "search_skills", {"query": "record total line items mismatch"})
        best = next((h for h in hit.get("skills", []) if h["compatible"]), None)
        if best:
            r = tools.call(conn, "run_skill", {"name": best["name"], "propose": True})
            if r.get("ok") and not r.get("errors"):
                approve()
                _execute_verify(conn)
                return {"turns": None, "used_skill": True}
        for rec in tools.call(conn, "read_records", {})["records"]:
            inv = tools.call(conn, "investigate", {"record_id": rec["id"]})
            for e in inv["evidence"]:
                lines = e["data"].get("lines")
                if e["source"] != "line_export" or not e["trusted"] or not isinstance(lines, list) \
                        or not all(isinstance(x, (int, float)) for x in lines) or "total" not in rec["data"]:
                    continue
                expected = sum(lines) / e["data"].get("scale", 1)
                if abs(rec["data"]["total"] - expected) > 1e-9:
                    a = tools.call(conn, "propose_action", {"record_id": rec["id"], "action_type": "set_field",
                                                            "params": {"field": "total", "value": expected},
                                                            "reason": "trusted line items / scale"})
                    if a.get("ok"):
                        tools.call(conn, "request_approval", {"action_id": a["action"]["id"]})
        approve()
        _execute_verify(conn)
        return {"turns": None, "used_skill": False}


# `openclaw agent --json` (Gateway path, openclaw 2026.9.2) per src/commands/agent-via-gateway.ts and
# src/agents/embedded-agent-runner/types.ts: {runId, status, summary, result: {payloads, meta}} with
# meta.toolSummary.calls and meta.agentMeta.assistantTurns (both optional in the source). Source-read, NOT yet seen
# on a GB10. Structural/type mismatches -> schema_errors (report warns); absent optional fields -> missing (None,
# never 0).
AGENT_JSON_FIELDS = {"tool_count": ("toolSummary", "calls"), "turns": ("agentMeta", "assistantTurns")}


def parse_agent_json(stdout):
    """-> {tool_count, turns, status, schema_errors, missing}. Tolerates banner lines before the JSON object."""
    out = {"tool_count": None, "turns": None, "status": None, "schema_errors": [], "missing": []}
    lines = (stdout or "").splitlines()
    first = next((i for i, ln in enumerate(lines) if ln.startswith("{")), None)  # skip banner lines
    if first is None:
        out["schema_errors"] = [f"no JSON object in stdout (starts {(stdout or '')[:60]!r})"]
        return out
    try:
        j, _ = json.JSONDecoder().raw_decode("\n".join(lines[first:]))
    except json.JSONDecodeError as e:
        out["schema_errors"] = [f"not JSON: {e.msg}"]
        return out
    out["status"] = j.get("status")
    if out["status"] not in (None, "ok", "completed"):
        out["schema_errors"].append(f"status={out['status']!r} (in_flight = duplicate run on this session)")
    meta = (j.get("result") or {}).get("meta") if isinstance(j.get("result"), dict) else j.get("meta")
    if not isinstance(meta, dict):
        out["schema_errors"].append("no result.meta object (is this `agent exec --json` or an older CLI?)")
        return out
    for key, (obj, field) in AGENT_JSON_FIELDS.items():
        v = (meta.get(obj) or {}).get(field) if isinstance(meta.get(obj, {}), dict) else "bad"
        if v is None:
            out["missing"].append(f"meta.{obj}.{field}")
        elif not isinstance(v, int) or isinstance(v, bool):
            out["schema_errors"].append(f"meta.{obj}.{field}: expected int, got {type(v).__name__}")
        else:
            out[key] = v
    return out


class OpenClawAgent:
    """REAL agent. AGENT_CMD is a template; {session} and {message} are substituted per argument.
    Default per docs.openclaw.ai/cli/agent + NemoClaw `exec` (verify on the GB10 before trusting numbers)."""
    real = True
    name = "openclaw"
    DEFAULT = ("nemoclaw {sandbox} exec --no-tty -- openclaw agent --session-id {session} "
               "-m {message} --json --timeout 900")

    def __init__(self, sandbox=None, cmd=None):
        self.sandbox = sandbox or os.environ.get("SANDBOX", "my-assistant")
        self.cmd = cmd or os.environ.get("AGENT_CMD", self.DEFAULT)

    def turn(self, session, message):
        argv = [a.replace("{sandbox}", self.sandbox).replace("{session}", session).replace("{message}", message)
                for a in shlex.split(self.cmd)]
        t0 = time.perf_counter()
        for attempt in range(1 + int(os.environ.get("AGENT_RETRIES", 1))):
            try:
                p = subprocess.run(argv, capture_output=True, text=True, timeout=float(os.environ.get("AGENT_TIMEOUT", 1000)))
            except subprocess.TimeoutExpired:
                # Not retried: the run may still be going inside the gateway, and a resend would race it (in_flight).
                return {"exit": "timeout", "seconds": round(time.perf_counter() - t0, 3), "attempts": attempt + 1,
                        "tool_count": None, "turns": None, "status": None, "missing": [],
                        "schema_errors": ["agent turn timed out (AGENT_TIMEOUT)"]}
            out = {"exit": p.returncode, "seconds": round(time.perf_counter() - t0, 3), "attempts": attempt + 1,
                   **parse_agent_json(p.stdout)}
            # Retry ONLY an infrastructure failure that produced no agent JSON (gateway/CLI down). Tool calls the agent
            # made before failing are safe to repeat: proposals dedup and execution is idempotent (tools.py).
            if not (p.returncode and not any(ln.startswith("{") for ln in p.stdout.splitlines())):
                break
            time.sleep(min(2 ** attempt, 10))
        if p.returncode or out["schema_errors"]:
            out["stderr"] = p.stderr[-300:]
        return out

    def run(self, conn, approve, label=""):
        session = f"bench-{uuid.uuid4().hex[:10]}"  # fresh session per trial: no conversational carry-over
        turns = [self.turn(session, PROMPT)]
        if approve():
            turns.append(self.turn(session, "Approved. Execute the approved actions, verify each, and report."))
        return {"turns": turns, "used_skill": None, "session": session}


# ---- helpers -----------------------------------------------------------------------

def _execute_verify(conn):
    for a in conn.execute("SELECT id FROM actions WHERE status='approved' ORDER BY id").fetchall():
        tools.call(conn, "execute_action", {"action_id": a["id"]})
        tools.call(conn, "verify_action", {"action_id": a["id"]})


@contextlib.contextmanager
def skills_state(conn, visibility):
    """Trusted harness control of skill visibility for one trial; previous state always restored."""
    saved = [tuple(r) for r in conn.execute("SELECT id, status, active FROM skills")]
    if visibility == "hidden":
        conn.execute("UPDATE skills SET active=0")
    elif visibility == "disabled":
        conn.execute("UPDATE skills SET status='disabled', active=0 WHERE active=1")
    try:
        yield
    finally:
        for sid, status, active in saved:
            conn.execute("UPDATE skills SET status=?, active=? WHERE id=?", (status, active, sid))


@contextlib.contextmanager
def fault_injection(conn, fault):
    """Same fault for every mode: after the FIRST execute_action of the trial, another writer changes that record
    (total + 1) before anyone verifies it. Implemented by wrapping the trusted tool, not by touching agent code."""
    if fault != "post_execute_drift":
        yield
        return
    real, fired = tools.execute_action, []

    @functools.wraps(real)  # the tool registry keys tools by __name__
    def drifting(c, action_id):
        res = real(c, action_id)
        if res.get("ok") and not res.get("already_executed") and not fired:
            fired.append(action_id)
            c.execute("UPDATE records SET data=json_set(data, '$.total', json_extract(data, '$.total') + 1) "
                      "WHERE id=(SELECT record_id FROM actions WHERE id=?)", (action_id,))
        return res

    tools.execute_action = drifting
    try:
        yield
    finally:
        tools.execute_action = real


@contextlib.contextmanager
def timed(phases, name):
    t0 = time.perf_counter()
    try:
        yield
    finally:
        phases[name] = round(phases.get(name, 0) + time.perf_counter() - t0, 4)


def records_state(conn):
    return {r["id"]: json.loads(r["data"]) for r in conn.execute("SELECT id, data FROM records")}


def correct(conn, before):
    """Ground truth, independent of the agent: with invariants, every VERIFIABLE invariant holds and unverifiable
    (malformed) records are untouched; without invariants, nothing may change."""
    after = records_state(conn)
    if not tools._policy(conn).get("invariants"):
        return after == before
    v = tools.invariant_violations(conn)
    bad = {x["record_id"] for x in v if x.get("unverifiable")}
    return not [x for x in v if not x.get("unverifiable")] and all(after[r] == before[r] for r in bad)


def preflight(conn, run):
    """Sanity of skill output before anything is approved: known records, learned fields only, no errors."""
    s = conn.execute("SELECT touches FROM skills WHERE name=? AND active=1", (run["skill"].split("@")[0],)).fetchone()
    ids = {r["id"] for r in conn.execute("SELECT id FROM records")}
    touches = set(json.loads(s["touches"] or "[]")) if s else set()
    return not run.get("errors") and all(p["record_id"] in ids and p["field"] in touches for p in run["proposals"])


# ---- one trial -----------------------------------------------------------------------

def trial(conn, mode, case, agent, n=0, approver="bench-operator"):
    scenario, visibility, fault = CASES[case]
    db.load_scenario(conn, LEARN / scenario)
    before = records_state(conn)
    phases, human = {}, {"approvals": 0, "seconds": 0.0}

    def approve():
        t0 = time.perf_counter()
        pend = tools.pending_approvals(conn)["pending"]
        for a in pend:
            tools.decide_approval(conn, a["id"], True, approver)
        human["approvals"] += len(pend)
        human["seconds"] += time.perf_counter() - t0
        return bool(pend)

    vis = "hidden" if mode == "A" else visibility
    decision, fallback, info = None, False, {}
    with skills_state(conn, vis), fault_injection(conn, fault):
        task = sf.task_begin(conn, f"bench {mode} {case} #{n}", "real" if agent.real else "mock")["task_id"]
        t0 = time.perf_counter()
        if mode == "C":
            with timed(phases, "match"):
                m = sf.match_skills(conn)
            decision = m["decision"] if m["decision"] == "agent" else "skill"
            if decision == "skill":
                with timed(phases, "skill_exec"):
                    run = tools.call(conn, "run_skill", {"name": m["skill"]["name"], "propose": True})
                if run.get("ok") and preflight(conn, run):
                    approve()
                    with timed(phases, "execute"):
                        ids = [a["id"] for a in run["actions"]]
                        for i in ids:
                            tools.call(conn, "execute_action", {"action_id": i})
                    with timed(phases, "verify"):
                        # verify EVERY executed action (a generator in all() would stop at the first failure and
                        # leave the rest executed-but-unverified)
                        ok = all([tools.call(conn, "verify_action", {"action_id": i}).get("passed") for i in ids])
                    if not ok:
                        decision, fallback = "skill_failed_verification", True
                else:
                    decision, fallback = "skill_rejected", True
            else:
                fallback = True
            if fallback:  # the agent takes over; a skill that just failed is not offered again
                with skills_state(conn, "hidden"), timed(phases, "agent"):
                    info = agent.run(conn, approve)
        else:
            with timed(phases, "agent"):
                info = agent.run(conn, approve)
            used = conn.execute("SELECT 1 FROM skill_runs WHERE task_id=? AND status='ok'", (task,)).fetchone()
            decision = "skill" if used else "agent"
        wall = time.perf_counter() - t0
        t = sf.task_end(conn)
    return {"mode": mode, "case": case, "trial": n, "agent": agent.name, "decision": decision, "fallback": fallback,
            "correct": correct(conn, before), "automated_s": round(wall - human["seconds"], 4),
            "human_approvals": human["approvals"], "model_calls": t["model_calls"], "tool_calls": t["tool_calls"],
            "verifications_failed": t["verifications_failed"], "phases": phases,
            "inference": json.loads(t["inference"]) if isinstance(t.get("inference"), str) else t.get("inference"),
            "agent_info": info}


# ---- learning (one-time cost) --------------------------------------------------------

def learn(conn, agent, approver="bench-operator"):
    """Mode-A solve on scenario A, then skill generation, validation and promotion; each phase timed.
    MOCK: the 'generated' skill is the human-written fixture -> infrastructure cost only, not autonomous learning."""
    if agent.real:  # autonomous generation only on a model that passed the capability probe (adapters/models.py)
        from adapters import llm as llm_mod, models
        try:
            served = llm_mod.from_env().health()["model"] if os.environ.get("LLM_BASE_URL", "mock") != "mock" else None
        except llm_mod.LLMUnavailable:
            served = None
        ok, why = models.learning_allowed(served)
        if not ok:
            return {"phases": {}, "model_calls": None, "tool_calls": None, "skill": None, "approved": False,
                    "autonomous": True, "manual_hints": None, "refused": why}
    db.load_scenario(conn, LEARN / "learn_a.json")
    phases = {}
    sf.task_begin(conn, "bench learning", "real" if agent.real else "mock")
    with timed(phases, "solve"):
        info = agent.run(conn, lambda: [tools.decide_approval(conn, a["id"], True, approver)
                                        for a in tools.pending_approvals(conn)["pending"]] and True)
    sf.task_mark(conn, "solved")
    with timed(phases, "generate_and_validate"):
        if agent.real:
            # SAME session as the solve, so the model knows what it just fixed. Counted as one manual hint.
            turn = agent.turn(info["session"],
                              "If the fix you just made is repeatable, turn it into a skill (records-ops step 5).")
            p = {"real_turn": turn, "manual_hints": 1}
        else:
            p = tools.call(conn, "propose_skill", {"name": SKILL_NAME, "path": str(FIXTURE),
                                                   "description": "recompute record total from trusted line items / scale",
                                                   "tags": ["reconcile", "total", "lines"]})
    sf.task_mark(conn, "skill_generated")
    t = sf.task_end(conn)
    s = conn.execute("SELECT name, version, status FROM skills ORDER BY id DESC").fetchone()
    approved = False
    if s and s["status"] == "tested":
        with timed(phases, "hidden_validation_and_approval"):
            sf.approve_skill(conn, s["name"], s["version"], approver)
        approved = True
    return {"phases": phases, "model_calls": t["model_calls"], "tool_calls": t["tool_calls"],
            "phase_marks": t.get("phase_marks"), "skill": dict(s) if s else None, "approved": approved,
            "autonomous": agent.real, "manual_hints": 1 if agent.real else None,
            "proposal": p if not agent.real else p.get("real_turn")}


# ---- summary + break-even ------------------------------------------------------------

def _med_mad(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None, None
    m = statistics.median(xs)
    return round(m, 4), round(statistics.median(abs(x - m) for x in xs), 4)


def summarize(rows):
    out = {}
    for r in rows:
        out.setdefault((r["case"], r["mode"]), []).append(r)
    table = []
    for (case, mode), rs in sorted(out.items()):
        med, mad = _med_mad([r["automated_s"] for r in rs])
        mc = [r["model_calls"] for r in rs]
        table.append({"case": case, "mode": mode, "n": len(rs), "correct": f"{sum(r['correct'] for r in rs)}/{len(rs)}",
                      "decision": ",".join(sorted({r["decision"] for r in rs})),
                      "fallback": sum(r["fallback"] for r in rs), "median_s": med, "mad_s": mad,
                      "first_s": rs[0]["automated_s"],
                      "model_calls": None if any(x is None for x in mc) else statistics.median(mc),
                      "tool_calls": statistics.median(r["tool_calls"] for r in rs),
                      "human_approvals": statistics.median(r["human_approvals"] for r in rs)})
    return table


def breakeven(learning, rows, case="unseen_compatible", reuse_mode="C"):
    """n* = ceil(L / (p*a - r)): reuses needed to pay back the one-time learning cost L, where
    a = agentic cost per task (mode A), r = reuse attempt cost (mode B or C), p = reuse success rate.
    Expected reuse cost r + (1-p)*a includes falling back to the agent when reuse fails (maintenance).
    Computed separately for automated seconds and for model calls; None inputs -> 'pending'."""
    a_rows = [r for r in rows if r["case"] == case and r["mode"] == "A"]
    c_rows = [r for r in rows if r["case"] == case and r["mode"] == reuse_mode]
    p = sum(r["correct"] and r["decision"] == "skill" for r in c_rows) / len(c_rows) if c_rows else None
    res = {"formula": "n* = ceil(L / (p*a - r)); never if p*a <= r", "p_reuse_success": p, "case": case,
           "reuse_mode": reuse_mode}
    for metric, L in (("automated_s", sum(learning["phases"].values())), ("model_calls", learning["model_calls"])):
        a = _med_mad([r[metric] for r in a_rows])[0] if all(r[metric] is not None for r in a_rows) else None
        r = _med_mad([x[metric] for x in c_rows])[0] if all(x[metric] is not None for x in c_rows) else None
        if None in (L, a, r, p):
            res[metric] = {"L": L, "a": a, "r": r, "n_star": "pending (unmeasured input)"}
            continue
        gain = p * a - r
        n = "never (reuse is not cheaper)" if gain <= 0 else int(-(-L // gain))
        res[metric] = {"L": round(L, 4), "a": a, "r": r, "gain_per_reuse": round(gain, 4), "n_star": n}
    return res


def run(trials=5, agent=None, db_path=None, skills_dir=None, modes=("A", "B", "C"), cases=None, reuse_skill=False):
    agent = agent or MockAgent()
    work = Path(tempfile.mkdtemp(prefix="bench-"))
    os.environ["APP_DB"] = str(db_path or work / "bench.db")
    sf.SKILLS_DIR = Path(skills_dir) if skills_dir else work / "skills"
    conn = db.connect()
    # A killed/crashed bench run leaves its own task open, which would block every rerun (runbook R8). Close only
    # bench-owned tasks, marked 'aborted' so they never count as results; a human's open task is left alone.
    conn.execute("UPDATE tasks SET status='aborted', ended_at=? WHERE status='open' AND label LIKE 'bench %'", (time.time(),))
    existing = conn.execute("SELECT name, version FROM skills WHERE status='approved' AND active=1").fetchone()
    if reuse_skill and existing:  # rerun after a crash without paying (real-model) learning again
        learning = {"phases": {}, "model_calls": None, "tool_calls": None, "skill": dict(existing), "approved": True,
                    "autonomous": None, "reused_existing_skill": True}
    else:
        learning = learn(conn, agent)
    rows = []
    for case in cases or CASES:
        for i in range(trials):
            for mode in (modes if i % 2 == 0 else modes[::-1]):  # alternate order: no warm-up bias for one mode
                rows.append(trial(conn, mode, case, agent, i + 1))
    conn.execute("CREATE TABLE IF NOT EXISTS bench_trials (id INTEGER PRIMARY KEY, row TEXT NOT NULL)")
    conn.executemany("INSERT INTO bench_trials (row) VALUES (?)", [(json.dumps(r, default=str),) for r in rows])
    result = {"modes": list(modes), "agent": agent.name, "agent_cmd": getattr(agent, "cmd", None),
              "real_model": agent.real, "trials": trials, "learning": learning,
              "summary": summarize(rows), "breakeven_C": breakeven(learning, rows, reuse_mode="C"),
              "breakeven_B": breakeven(learning, rows, reuse_mode="B"), "db": os.environ["APP_DB"],
              "agent_turn_errors": [t for r in rows for t in ((r.get("agent_info") or {}).get("turns") or [])
                                    if t.get("exit") or t.get("schema_errors")]}
    (work / "result.json").write_text(json.dumps({**result, "rows": rows}, indent=2, default=str))
    result["result_file"] = str(work / "result.json")
    return result


def report(res):
    lines = [f"agent={res['agent']} real_model={res['real_model']} trials={res['trials']}  (MOCK = plumbing only)"
             if not res["real_model"] else f"agent={res['agent']} REAL local model, trials={res['trials']}"]
    bad = res.get("agent_turn_errors") or []
    if bad:  # never let a CLI contract mismatch masquerade as "0 tool calls"
        lines.append(f"WARNING: {len(bad)} agent turn(s) failed or broke the openclaw --json contract, "
                     f"e.g. exit={bad[0].get('exit')} {bad[0].get('schema_errors')}")
    lg = res["learning"]
    lines.append(f"\nlearning (one-time): phases_s={lg['phases']} model_calls={lg['model_calls']} "
                 f"tool_calls={lg['tool_calls']} skill={lg['skill']} autonomous={lg['autonomous']}")
    if lg.get("refused"):
        lines.append(f"LEARNING REFUSED: {lg['refused']}")
    cols = ["case", "mode", "n", "correct", "decision", "fallback", "median_s", "mad_s", "first_s",
            "model_calls", "tool_calls", "human_approvals"]
    lines += ["", "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join("n/a" if r[c] is None else str(r[c]) for c in cols) + " |" for r in res["summary"]]
    for k in ("breakeven_C", "breakeven_B"):
        lines.append(f"\n{k}: {json.dumps(res[k])}")
    lines.append(f"\nfull rows: {res['result_file']}")
    return "\n".join(lines)
