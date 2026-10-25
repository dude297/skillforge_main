"""EXPERIMENT: OnCall learning loop for a SYNTHETIC inference-serving incident, on the EXISTING SkillForge registry.

  python -m experiments.oncall_infer run   [--live --base-url URL --model ID] [--state DIR] [--out PATH]
  python -m experiments.oncall_infer reuse [--state DIR] [--out PATH]

A  synthesize: the served model writes SKILL.md + scripts/helper.py + tests (--live), else the checked-in
   reference skill is used and labelled RECORDED_SIMULATION (hand-written by an agent, not model output).
B  verify: core lint + the skill's own tests + INC-1 replay + the capacity check (regression) and the hidden suite
   (hidden/, never in a prompt) through core `skillforge.hidden_check`.
C  stage the candidate in core's skill registry (status 'tested') and STOP. A person approves with core's
   `python -m app skill approve` (printed). This script never approves.
D  reuse: INC-2 through core match_skills + run_skill (no model client may be constructed or called) and INC-3,
   which core's structural matcher calls exact but the section-17 incident fingerprint refuses.

Core (`app/`, `adapters/`) never imports this. Every number is measured on this run or null.
"""
import json
import os
import re
import shutil
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

from adapters import llm as llm_mod
from app import db, skillforge as sf, tools
from experiments.oncall_infer.fixtures import capacity_check

HERE = Path(__file__).resolve().parent
ROOT = db.ROOT
FIX = {k: HERE / "fixtures" / f for k, f in
       (("INC-1", "inc1_primary.json"), ("INC-2", "inc2_compatible.json"), ("INC-3", "inc3_lookalike.json"))}
HIDDEN_DIR = HERE / "hidden"
REFERENCE = HERE / "reference_skill"
SCENARIO = "oncall-infer-inc1"
NAME = "oncall-serving-config-revert"
DEFAULT_STATE = ROOT / "data" / "unified" / "demo" / "oncall"
DEFAULT_OUT = ROOT / "data" / "unified" / "demo" / "oncall-run.json"
PROMPT = """You are on call for an LLM inference service (vLLM-style). Write a deterministic, reusable Python
diagnostic skill for this CLASS of incident, not just this instance.
Input `dataset`: {"records": [{"id", "kind": "inference_incident", "data": {...}}], "evidence": [{"record_id",
"source", "trusted", "data"}]}. Evidence sources: "log" (data.lines: list of str), "metrics" (data.series),
"config_before" / "config_after" (data.config: dict of serving keys), "deploy" (data.id, data.description).
Use only trusted evidence. Never crash on missing fields.
Contract: scripts/helper.py defines run(dataset) -> {"proposals": [...], "refused": [...]}.
- proposals: at most one per record: {"record_id", "field": <config key>, "value": <baseline value to revert to>,
  "action_type": "revert_config", "reason": "class=serving_config_regression;key=<k>;from=<after>;to=<before>;deploy=<id>"}
  Only when the root cause is a serving config regression that a bounded revert of ONE key fixes. Never apply changes.
- refused: {"record_id", "code": "not_applicable"|"insufficient_evidence"|"requires_review", "reason"} for every
  record you do not propose for (a different root cause is not_applicable; ambiguous cases are requires_review).
Operational rule (a wrong revert is worse than a refusal; refusals state that human review is required):
- Propose only if ALL hold: trusted log evidence shows the diagnosed failure signature (GPU/CUDA out-of-memory), AND
  trusted config_before/config_after show exactly ONE memory-relevant serving key changed, AND that change moves in the
  direction that raises memory demand (so the revert lowers it). Symptoms alone (latency, 429s, errors) are never enough.
- Otherwise refuse: evidence missing, untrusted or incomplete -> insufficient_evidence; zero or several candidate keys, or
  conflicting signals -> requires_review; evidence of a different failure class -> not_applicable. Never pick a key by order.
- tests/test_helper.py must cover one positive case and at least two refusal cases, on small made-up datasets you build.
Allowed imports: json, math, re, collections, itertools, functools, statistics, datetime, typing. No files, network,
open/eval/exec/getattr. tests/test_helper.py: at least 3 plain `def test_*` functions using `from helper import run`.
Incident INC-1 (current data):
%s
Reply with ONLY a JSON object: {"skill_md": "<SKILL.md>", "helper": "<scripts/helper.py>", "tests": "<tests/test_helper.py>"}"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def rel(p):
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return Path(p).as_posix()


class Ctx:
    """Points core at an isolated registry (DB + skills dir) and this experiment's hidden suite."""

    def __init__(self, state):
        self.state = Path(state)
        self.db, self.skills = self.state / "app.db", self.state / "skills"
        os.environ["APP_DB"], os.environ["HIDDEN_DIR"] = str(self.db), str(HIDDEN_DIR)
        sf.SKILLS_DIR = self.skills  # module global read at call time
        self.conn = None

    def connect(self):
        self.state.mkdir(parents=True, exist_ok=True)
        self.conn = db.connect(str(self.db))
        return self.conn

    def approve_command(self, version):
        return (f'APP_DB="{rel(self.db)}" SKILLS_DIR="{rel(self.skills)}" HIDDEN_DIR="{rel(HIDDEN_DIR)}" '
                f'python -m app skill approve {NAME} {version} --by "<your name>"')


# ---- section 17 incident fingerprint (trusted code, from evidence only) ----------------------------------------
_EXC = re.compile(r"\bERROR\s+(\w+):\s+([A-Za-z_][\w.]*(?:Error|Exception))\b")
_CATEGORIES = [("gpu_oom", re.compile(r"OutOfMemoryError|CUDA out of memory", re.I)),
               ("disk_full", re.compile(r"No space left on device|Errno 28", re.I)),
               ("network", re.compile(r"Connection (refused|reset)|timed out|ECONNRESET", re.I))]


def incident_parts(dataset, rid):
    lines = [str(x) for e in dataset["evidence"] if e["record_id"] == rid and e["trusted"] and e["source"] == "log"
             for x in e["data"].get("lines", [])]
    exc = next((m for m in map(_EXC.search, lines) if m), None)
    frames = [ln.split(" at ", 1)[1] for ln in lines if " at " in ln][:3]
    cat = next((c for c, rx in _CATEGORIES if any(rx.search(ln) for ln in lines)), "unknown")
    return {"exception_type": exc[2] if exc else None, "component": exc[1] if exc else None,
            "failure_category": cat, "top_frames": " | ".join(frames)}


def incident_fingerprint(dataset, rid):
    # ponytail: service_version from section 17 is left out on purpose: it differs between compatible incidents
    parts = incident_parts(dataset, rid)
    return {"parts": parts, "id": sf.stable_fingerprint(parts, free_text={"top_frames"})}


# ---- output helpers --------------------------------------------------------------------------------------------
_KIND = {"log": "log", "metrics": "metric", "config_before": "config", "config_after": "config", "deploy": "deploy"}


def _excerpt(src, d):
    if src == "log":
        return "\n".join([x for x in d["lines"] if "ERROR" in x][:3] or d["lines"][:3])
    if src == "metrics":
        s = d["series"]
        worst = max(s, key=lambda x: x["p99_ms"])
        f = lambda x: f"{x['t']} p99={x['p99_ms']}ms 429={x['http_429_pct']}% gpu_mem={x['gpu_mem_used_pct']}% disk_free={x['disk_free_gb']}GB"
        return f"{f(s[0])}\n{f(worst)}"
    if src.startswith("config"):
        return json.dumps({k: d["config"].get(k) for k in ("image_tag", "max_num_seqs", "max_model_len", "gpu_memory_utilization")})
    return f"{d['id']} at {d['at']} by {d['author']}: {d['description']}"


def incident_block(rid):
    s = json.loads(FIX[rid].read_text(encoding="utf-8"))
    r = next(x for x in s["records"] if x["id"] == rid)
    return {"id": rid, "title": r["data"]["title"], "service": r["data"]["service"], "summary": r["data"]["summary"],
            "evidence": [{"kind": _KIND[e["source"]], "name": e["data"]["name"], "excerpt": _excerpt(e["source"], e["data"]),
                          "source_path": f"{rel(FIX[rid])}#evidence[{i}]"} for i, e in enumerate(s["evidence"])]}


def diagnosis(proposal, outcome=None):
    if not proposal:
        return None
    kv = dict(x.split("=", 1) for x in str(proposal.get("reason", "")).split(";") if "=" in x)
    try:
        kv["from"] = json.loads(kv["from"])  # "131072" -> 131072; leave non-JSON text as is
    except (KeyError, ValueError):
        pass
    return {"root_cause_class": kv.get("class"), "offending_key": proposal["field"], "deployed_value": kv.get("from"),
            "baseline_value": proposal["value"], "deploy": kv.get("deploy"),
            "recommended_remediation": f"revert {proposal['field']} to {proposal['value']} (proposal only; never applied; "
                                       "a person approves and applies it)", "outcome": outcome}


def write(out, doc):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(doc, indent=2) + "\n")


# ---- Stage A ---------------------------------------------------------------------------------------------------
def synthesize_live(base_url, model, data, dest, audit, attempts=2, timeout=int(os.environ.get("ONCALL_TIMEOUT", 300))):
    """Real model. model_calls = chat requests sent (LLM_RETRIES=0, so transport retries cannot hide calls)."""
    os.environ["LLM_RETRIES"] = "0"
    client = llm_mod.OpenAICompatLLM(base_url, model, os.environ.get("LLM_API_KEY") or None, timeout)
    info = client.health()  # GET /models: not a model call
    audit("model_health", f"{base_url} serves {info['model']}")
    calls, usage, t0, feedback = 0, {"prompt_tokens": 0, "completion_tokens": 0, "seen": False}, time.monotonic(), ""
    for i in range(attempts):
        body = {"model": client.model, "temperature": 0, "max_tokens": int(os.environ.get("ONCALL_MAX_TOKENS", 8192)),
                "messages": [{"role": "user", "content": PROMPT % json.dumps(data) + feedback}]}
        calls += 1
        out = client._req("/chat/completions", body)  # adapter transport; keeps `usage` that chat() drops
        u = out.get("usage") or {}
        if "prompt_tokens" in u:
            usage["seen"] = True
            usage["prompt_tokens"] += u.get("prompt_tokens") or 0
            usage["completion_tokens"] += u.get("completion_tokens") or 0
        text = ((out.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        j = llm_mod.parse_json(text) or {}
        if not all(isinstance(j.get(k), str) for k in ("skill_md", "helper", "tests")):
            feedback = "\nYour previous reply was not the required JSON object. Reply with only the JSON object."
            audit("synthesis_parse_failed", f"attempt {i + 1}: {text[:120]!r}")
            continue
        _write_skill(dest, j["skill_md"], j["helper"], j["tests"])
        errors, _ = sf.lint(dest)
        own = sf.sandbox("test", dest, timeout=60) if not errors else {"ok": False}
        audit("synthesis_attempt", f"attempt {i + 1}: lint_errors={len(errors)} own_tests_ok={bool(own.get('ok'))}")
        if not errors and own.get("ok"):
            break
        feedback = "\nYour previous skill failed: " + json.dumps(errors[:3] or own.get("failures", [])[:2] or own)[:1500]
    if not (dest / "scripts" / "helper.py").is_file():
        raise llm_mod.LLMUnavailable(f"model never returned a parseable skill in {attempts} attempts")
    return {"model_calls": calls, "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            "prompt_tokens": usage["prompt_tokens"] if usage["seen"] else None,
            "completion_tokens": usage["completion_tokens"] if usage["seen"] else None, "model": client.model}


def _write_skill(dest, md, helper, tests):
    shutil.rmtree(dest, ignore_errors=True)
    (dest / "scripts").mkdir(parents=True)
    (dest / "tests").mkdir()
    for p, t in (("SKILL.md", md), ("scripts/helper.py", helper), ("tests/test_helper.py", tests)):
        with open(dest / p, "w", encoding="utf-8", newline="\n") as f:
            f.write(t)


# ---- Stage B ---------------------------------------------------------------------------------------------------
def verify(skill_dir, inc1_data, input_shape):
    errors, _ = sf.lint(skill_dir)
    reg = [{"name": "lint (core static screen)", "pass": not errors}]
    own = sf.sandbox("test", skill_dir, timeout=60) if not errors else {"ok": False, "tests_run": 0}
    reg.append({"name": f"skill's own tests ({own.get('tests_run', 0)} run)", "pass": bool(own.get("ok"))})
    s1 = json.loads(FIX["INC-1"].read_text(encoding="utf-8"))
    pre = capacity_check.check(s1, "INC-1")
    reg.append({"name": "INC-1 capacity check fails on the deployed config (reproduces the incident)", "pass": not pre["ok"]})
    r = sf.sandbox("run", skill_dir, inc1_data) if not errors else {"ok": False}
    got = sf._valid_proposals(r.get("output"), len(inc1_data["records"])) if r.get("ok") else None
    p = (got or [None])[0]
    reg.append({"name": "INC-1 replay: revert max_num_seqs 1024 -> 128",
                "pass": bool(got) and len(got) == 1 and (p["record_id"], p["field"], p["value"]) == ("INC-1", "max_num_seqs", 128)})
    post = capacity_check.check(s1, "INC-1", {p["field"]: p["value"]} if p else None)
    reg.append({"name": "INC-1 capacity check passes with the proposed revert (simulated, not applied)", "pass": bool(p) and post["ok"]})
    hidden = sf.hidden_check(skill_dir, SCENARIO, input_shape) if not errors else {"ok": False, "cases": []}
    hid = [{"name": c["case"], "pass": bool(c["ok"])} for c in hidden.get("cases", [])] or \
          [{"name": f"hidden suite: {hidden.get('error', 'not run (lint failed)')}", "pass": False}]
    passed = all(x["pass"] for x in reg + hid)
    return {"hidden": hid, "regression": reg, "passed": passed, "note": "tests, not a formal proof"}, p


# ---- run -------------------------------------------------------------------------------------------------------
def run(live=False, base_url=None, model=None, state=DEFAULT_STATE, out=DEFAULT_OUT, allow_fallback=True):
    """allow_fallback=False (the CLI default for --live): any model failure raises LLMUnavailable instead of
    quietly producing a RECORDED_SIMULATION, and the endpoint is checked BEFORE the previous state is wiped."""
    if live and not allow_fallback:
        llm_mod.OpenAICompatLLM(base_url, model, os.environ.get("LLM_API_KEY") or None, 30).health()  # GET /models only
    ctx = Ctx(state)
    prev = ctx.state.with_name(ctx.state.name + ".prev")  # throwaway registry per run, but kept until the run succeeds
    shutil.rmtree(prev, ignore_errors=True)
    if ctx.state.exists():
        ctx.state.rename(prev)
    log = []
    audit = lambda ev, d: log.append({"t": now(), "event": ev, "detail": d})
    conn = ctx.connect()
    db.load_scenario(conn, FIX["INC-1"])
    audit("incident_loaded", f"INC-1 from {rel(FIX['INC-1'])} (SYNTHETIC)")
    sf.task_begin(conn, "oncall-infer INC-1", "real" if live else "mock")
    data = sf.dataset(conn)
    sig = sf.task_signature(data, tools._policy(conn))
    draft = ctx.state / "draft" / NAME
    model_block = {"id": model, "endpoint": base_url, "available": False, "note": ""}
    syn = None
    if live:
        try:
            syn = synthesize_live(base_url, model, data, draft, audit)
            model_block.update(id=syn.pop("model"), available=True,
                               note="LIVE: the served model wrote the skill on this run; hidden suite never shown to it")
            audit("synthesized", f"model wrote the skill in {syn['model_calls']} call(s), {syn['latency_ms']} ms")
        except llm_mod.LLMUnavailable as e:
            if not allow_fallback:
                conn.close()
                shutil.rmtree(ctx.state, ignore_errors=True)
                if prev.exists():
                    prev.rename(ctx.state)  # failed strict --live run: the previous registry survives
                raise
            model_block["note"] = f"endpoint unavailable ({str(e)[:200]}); fell back to the RECORDED reference skill"
            audit("model_unavailable", str(e)[:300])
    if syn is None:
        shutil.rmtree(draft, ignore_errors=True)
        shutil.copytree(REFERENCE, draft, ignore=shutil.ignore_patterns("__pycache__"))
        model_block["note"] = (model_block["note"] or "no --live: no model was called") + \
            ". RECORDED SIMULATION: the skill is a hand-written reference (written by an agent, NOT model output)."
        syn = {"model_calls": None, "latency_ms": None, "prompt_tokens": None, "completion_tokens": None}
        audit("recorded_reference", f"copied {rel(REFERENCE)} (hand-written, not model output)")
    mode = "LIVE_REAL_MODEL" if model_block["available"] else "RECORDED_SIMULATION"
    sha = sf._tree_hash(draft)
    synthesis = {"provenance": "model" if mode == "LIVE_REAL_MODEL" else "recorded_reference", **syn,
                 "code": (draft / "scripts" / "helper.py").read_text(encoding="utf-8"),
                 "skill_name": NAME, "skill_version": 1, "skill_hash": sha}

    ver, proposal = verify(draft, data, sf._shape_key(data))
    audit("verified", f"hidden {sum(x['pass'] for x in ver['hidden'])}/{len(ver['hidden'])}, regression "
                      f"{sum(x['pass'] for x in ver['regression'])}/{len(ver['regression'])}")
    approval = {"state": "rejected", "by": None, "at": None,
                "command": "none: the candidate failed verification and was not staged for approval"}
    if ver["passed"]:  # Stage C: stage in core's registry as 'tested' (what propose_skill would record), then STOP
        dest = sf.SKILLS_DIR / "candidates" / NAME / "v1"
        shutil.copytree(draft, dest)
        fp = incident_fingerprint(data, "INC-1")
        validation = {"lint": [], "verification": ver, "staged_by": "experiments.oncall_infer (not propose_skill: "
                      "OnCall has no executed+verified action to replay; the replay is the INC-1 regression test)",
                      "incident_fingerprint": fp}  # bound to the registry row, not a loose sidecar file
        conn.execute("INSERT INTO skills (name, version, description, tags, status, source_task, input_shape, sha256, "
                     "validation, signature, touches) VALUES (?, 1, ?, ?, 'tested', ?, ?, ?, ?, ?, ?)",
                     (NAME, "Revert a single memory-relevant serving key after a deploy-induced GPU OOM",
                      json.dumps(["oncall", "inference", "vllm"]), tools.current_task_id(conn), sf._shape_key(data),
                      sf._tree_hash(dest), json.dumps(validation), json.dumps(sig), json.dumps([proposal["field"]])))
        (dest / "meta.json").write_text(json.dumps({"name": NAME, "version": 1, "scenario": SCENARIO, "status": "tested",
                                                    "created_by": synthesis["provenance"], "files_sha256": sha,
                                                    "incident_fingerprint": fp}, indent=2), encoding="utf-8")
        db.audit(conn, "experiment:oncall_infer", "skill_staged", {"name": NAME, "version": 1, "provenance": synthesis["provenance"]})
        approval = {"state": "pending", "by": None, "at": None, "command": ctx.approve_command(1)}
        audit("pending_approval", "stopped: a person must run the approve command on the host")
    sf.task_end(conn, model_calls=syn["model_calls"])
    conn.close()
    shutil.rmtree(prev, ignore_errors=True)
    doc = {"schema": "skillforge.oncall_run/1", "mode": mode, "generated_at": now(), "host": socket.gethostname(),
           "model": model_block, "incident": incident_block("INC-1"), "synthesis": synthesis, "verification": ver,
           "approval": approval,
           "reuse": {"incident_id": "INC-2", "path": "deterministic_fastpath", "model_calls": None, "latency_ms": None,
                     "diagnosis": None, "state": "not_run", "reason": "awaiting approval"},
           "refusal": {"incident_id": "INC-3", "state": "not_run", "reason": "awaiting approval"},
           "telemetry": {"gpu": None, "note": "no GPU telemetry on this host"}, "audit": log}
    write(out, doc)
    return doc


# ---- Stage D ---------------------------------------------------------------------------------------------------
class NoModel:
    """Fastpath guard: any attempt to build or call a model client is counted and raises."""

    def __init__(self):
        self.calls, self._saved = 0, {}

    def _trip(self, *_, **__):
        self.calls += 1
        raise AssertionError("fastpath tried to use a model client")

    def __enter__(self):
        for cls in (llm_mod.OpenAICompatLLM, llm_mod.MockLLM):
            for attr in ("__init__", "chat", "chat_message", "health"):
                self._saved[(cls, attr)] = cls.__dict__.get(attr)
                setattr(cls, attr, self._trip)
        self._saved[(llm_mod, "from_env")] = llm_mod.from_env
        llm_mod.from_env = self._trip
        return self

    def __exit__(self, *exc):
        for (obj, attr), v in self._saved.items():
            if v is None:
                delattr(obj, attr)
            else:
                setattr(obj, attr, v)


def _decide(conn, rid, learned_fp):
    """Core structural matcher first, then the incident fingerprint. -> (accepted, reason, match).
    Fails closed: no learned fingerprint on the approved row means no reuse."""
    m = sf.match_skills(conn)
    if m["decision"] != "skill":
        return False, f"core matcher: {m['why']}", m
    if not learned_fp or not learned_fp.get("id"):
        return False, "no incident fingerprint recorded with the approved skill: refusing reuse (fail closed)", m
    cur = incident_fingerprint(sf.dataset(conn), rid)
    if cur["id"] != learned_fp["id"]:
        diff = [f"{k}: {learned_fp['parts'][k]!r} -> {cur['parts'][k]!r}" for k in learned_fp["parts"]
                if learned_fp["parts"][k] != cur["parts"][k]]
        return False, ("structural signature matches (core matcher: exact) but the incident fingerprint differs: "
                       + "; ".join(diff)), m
    return True, "core matcher exact + incident fingerprint equal", m


def reuse(state=DEFAULT_STATE, out=DEFAULT_OUT):
    ctx = Ctx(state)
    doc = json.loads(Path(out).read_text(encoding="utf-8"))
    log = doc["audit"]
    audit = lambda ev, d: log.append({"t": now(), "event": ev, "detail": d})
    conn = ctx.connect()
    s = conn.execute("SELECT * FROM skills WHERE name=? AND version=1", (NAME,)).fetchone()
    if not s or s["status"] != "approved":
        why = "not approved"
        doc["reuse"].update(state="refused", reason=why, model_calls=None, latency_ms=None, diagnosis=None)
        doc["refusal"].update(state="refused", reason=why)
        audit("reuse_refused", f"{NAME}@v1 is '{s['status'] if s else 'missing'}': not approved")
        write(out, doc)
        conn.close()
        return doc
    ev = conn.execute("SELECT ts FROM audit WHERE event='skill_approved' ORDER BY id DESC").fetchone()
    doc["approval"].update(state="approved", by=s["decided_by"], at=ev["ts"].replace(" ", "T") + "Z" if ev else None)  # sqlite datetime('now') is UTC
    audit("approved", f"{NAME}@v1 approved by {s['decided_by']!r} via core `skill approve`")
    # kind: 'simulated' = an agent/test typed it (marked in --by); 'host_cli' = typed on the host, name not identity-verified
    simulated = bool(re.search(r"not a human|\(agent|recorded-sim", str(s["decided_by"]), re.I))
    doc["approval"]["kind"] = "simulated" if simulated else "host_cli"
    if simulated:
        doc["model"]["note"] += (" APPROVAL in this artifact was typed by an agent into a throwaway registry to show the "
                                 "full sequence; it is NOT a human approval.")
    learned_fp = json.loads(s["validation"] or "{}").get("incident_fingerprint")

    db.load_scenario(conn, FIX["INC-2"])
    with NoModel() as guard:
        t0 = time.perf_counter()
        ok, why, _ = _decide(conn, "INC-2", learned_fp)
        try:
            res = sf.run_skill(conn, NAME) if ok else None
        except tools.ToolError as e:  # e.g. integrity_error: approved files changed since approval -> recorded refusal
            ok, why, res = False, f"core refused to run the skill: {e}", None
        ms = round((time.perf_counter() - t0) * 1000, 1)
    if ok:
        p = (res["proposals"] or [None])[0]
        doc["reuse"].update(state="done", reason=why, model_calls=guard.calls, latency_ms=ms,
                            diagnosis=diagnosis(p, res["outcomes"].get("INC-2")))
    else:
        doc["reuse"].update(state="refused", reason=why, model_calls=guard.calls, latency_ms=ms, diagnosis=None)
    audit("reuse_inc2", f"{doc['reuse']['state']}: {why} ({ms} ms, model_calls={guard.calls})")

    db.load_scenario(conn, FIX["INC-3"])
    with NoModel():
        ok3, why3, _ = _decide(conn, "INC-3", learned_fp)
        if ok3:
            try:
                sf.run_skill(conn, NAME)
            except tools.ToolError as e:
                ok3, why3 = False, f"core refused to run the skill: {e}"
    doc["refusal"].update(state="UNEXPECTED_ACCEPT" if ok3 else "refused", reason=why3)
    audit("reuse_inc3", f"{doc['refusal']['state']}: {why3}")
    conn.close()
    write(out, doc)
    return doc
