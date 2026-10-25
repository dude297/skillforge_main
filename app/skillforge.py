"""SkillForge: learn a deterministic helper from a verified solve, test it, human-promote it, reuse it.

Lifecycle: task begin -> agent solves (verified) -> propose_skill (copied to candidates/, linted, its own tests
run, then REPLAYED on the task's starting data and compared to the human-approved, verifier-passed fixes)
-> human `skill approve` (copied to approved/, hash-pinned) -> search_skills/run_skill on new data
-> proposals still go through policy + human approval + verifier -> task end records metrics.

A skill only ever COMPUTES proposals. It gets no DB handle, no network, no secrets, and no new permissions.
"""
import ast
import hashlib
import importlib.util
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from adapters import metrics as inference_metrics
from app import tools
from app.db import ROOT, audit
from app.tools import ToolError

MAX_DRAFTS = 5
SKILLS_DIR = Path(os.environ.get("SKILLS_DIR", ROOT / "skills"))
RUNNER = Path(__file__).with_name("_runner.py")
NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{2,40}$")
ALLOWED_IMPORTS = {"json", "math", "decimal", "fractions", "statistics", "collections", "itertools", "functools",
                   "re", "datetime", "typing", "dataclasses", "operator", "copy", "helper"}
BANNED_CALLS = {"open", "exec", "eval", "compile", "__import__", "input", "breakpoint", "globals", "locals",
                "vars", "getattr", "setattr", "delattr"}
BANNED_ATTRS = {"attrgetter", "methodcaller"}  # operator is allowed; these reach arbitrary attributes
MAX_SKILL_BYTES = 200_000
MAX_OUTPUT_BYTES = 2_000_000


# ---- data helpers ---------------------------------------------------------

def dataset(conn):
    """Canonical input handed to skills: records + evidence, nothing else (no policy, no audit)."""
    return {
        "records": [{"id": r["id"], "kind": r["kind"], "data": json.loads(r["data"])}
                    for r in conn.execute("SELECT * FROM records ORDER BY id")],
        "evidence": [{"record_id": e["record_id"], "source": e["source"], "trusted": bool(e["trusted"]),
                      "data": json.loads(e["data"])} for e in conn.execute("SELECT * FROM evidence ORDER BY id")],
    }


def shape(v):
    """Structural signature (keys + types, no values). Same problem on new data -> same shape."""
    if isinstance(v, dict):
        return {k: shape(v[k]) for k in sorted(v)}
    if isinstance(v, list):
        return ["list", sorted({json.dumps(shape(x), sort_keys=True) for x in v})]
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    return "null" if v is None else type(v).__name__


def _shape_key(data):
    return json.dumps(shape(data), sort_keys=True)


# ---- deterministic matching ------------------------------------------------
# A signature is computed by TRUSTED code from data + policy, never from agent text. Equal signatures mean
# "same category of task", not "equivalent task": the skill still only proposes, and every proposal still goes
# through policy, human approval and the verifier.

SIGNATURE_PARTS = ("shape", "kinds", "sources", "writable", "invariants")
_VOLATILE = [(re.compile(r"0x[0-9a-f]+"), "0x#"),
             (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"), "<uuid>"),
             (re.compile(r"\d+"), "#")]


def normalize(text):
    """Strip volatile tokens (addresses, uuids, numbers, whitespace) from free text such as an error message or a
    stack frame. For FREE TEXT only: never apply it to identifiers whose digits carry meaning."""
    t = str(text).strip().lower()
    for rx, sub in _VOLATILE:
        t = rx.sub(sub, t)
    return re.sub(r"\s+", " ", t)


def stable_fingerprint(parts, free_text=()):
    """sha256 over canonical parts; keys in free_text are normalize()d first. Domain-neutral building block,
    e.g. a future OnCall fingerprint: {exception_type, top_frames, component, category, service_version}."""
    canon = {k: normalize(v) if k in free_text else v for k, v in sorted(parts.items())}
    return hashlib.sha256(json.dumps(canon, sort_keys=True, default=str).encode()).hexdigest()[:16]


def task_signature(data, policy):
    sig = {"shape": _shape_key(data),
           "kinds": sorted({r["kind"] for r in data["records"]}),
           "sources": sorted({f"{e['source']}:{'trusted' if e['trusted'] else 'untrusted'}" for e in data["evidence"]}),
           "writable": sorted({f for spec in policy.get("actions", {}).values() for f in spec.get("fields", {})}),
           "invariants": sorted(f"{i['rule']}:{i['field']}:{i['source']}" for i in policy.get("invariants", []))}
    sig["id"] = stable_fingerprint({k: sig[k] for k in SIGNATURE_PARTS})
    return sig


def match_skills(conn):
    """Trusted matcher. decision='skill' only for exactly ONE approved, active skill whose learned signature equals
    the current one on every part and whose touched fields are still writable. Anything else -> 'agent'.
    In a scoped agent call only that team's skills exist for the matcher (tools.visible_skill_ids)."""
    cur = task_signature(dataset(conn), tools._policy(conn))
    candidates = []
    visible = tools.visible_skill_ids(conn)
    for s in conn.execute("SELECT * FROM skills WHERE status='approved' AND active=1 ORDER BY name"):
        if visible is not None and s["id"] not in visible:
            continue
        learned = json.loads(s["signature"] or "null")
        if not learned:
            candidates.append({"name": s["name"], "version": s["version"], "match": "uncertain",
                               "reasons": ["no learned signature recorded"]})
            continue
        diffs = [k for k in SIGNATURE_PARTS if learned.get(k) != cur[k]]
        untouchable = sorted(set(json.loads(s["touches"] or "[]")) - set(cur["writable"]))
        if untouchable:
            diffs.append(f"skill writes fields not writable here: {untouchable}")
        level = "exact" if not diffs else "uncertain" if learned["shape"] == cur["shape"] else "none"
        candidates.append({"name": s["name"], "version": s["version"], "match": level, "reasons": diffs})
    exact = [c for c in candidates if c["match"] == "exact"]
    if len(exact) == 1:
        return {"decision": "skill", "skill": exact[0], "candidates": candidates, "signature": cur["id"]}
    why = "ambiguous: several exact matches" if exact else \
          "only uncertain matches (looks similar, differs in kind/source/policy)" if any(
              c["match"] == "uncertain" for c in candidates) else "no compatible skill"
    return {"decision": "agent", "why": why, "candidates": candidates, "signature": cur["id"]}


def _tree_hash(d):
    h = hashlib.sha256()
    for p in sorted(Path(d).rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts and p.name != "meta.json":  # meta is system-written
            h.update(p.relative_to(d).as_posix().encode() + b"\0" + p.read_bytes() + b"\0")
    return h.hexdigest()


def lint(skill_dir):
    """Static screen over generated code: (errors -> reject, warnings -> optimization hints).
    An early filter only; it does not prove arbitrary Python is safe (the runner + OpenShell do the containing)."""
    errors, warnings = [], []
    for rel in ("scripts/helper.py", "tests/test_helper.py"):
        try:
            tree = ast.parse((skill_dir / rel).read_text(encoding="utf-8"))
        except SyntaxError as e:
            errors.append(f"{rel}: syntax error {e}")
            continue
        imported, used = {}, {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
        for node in ast.walk(tree):
            mods = [a.name for a in node.names] if isinstance(node, ast.Import) else                    [node.module or ""] if isinstance(node, ast.ImportFrom) else []
            errors += [f"{rel}: import '{m}' not allowed" for m in mods if m.split(".")[0] not in ALLOWED_IMPORTS]
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                imported.update({(a.asname or a.name).split(".")[0]: a.name for a in node.names})
            if isinstance(node, ast.Name) and node.id in BANNED_CALLS:  # any reference, not only a direct call (o = open)
                errors.append(f"{rel}: use of '{node.id}' not allowed")
            if isinstance(node, ast.Name) and node.id.startswith("__"):  # __builtins__ and friends
                errors.append(f"{rel}: dunder name '{node.id}' not allowed")
            if isinstance(node, ast.Attribute) and node.attr in BANNED_ATTRS or                     isinstance(node, ast.ImportFrom) and any(a.name in BANNED_ATTRS for a in node.names):
                errors.append(f"{rel}: dynamic attribute access not allowed (operator.attrgetter/methodcaller)")
            if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
                errors.append(f"{rel}: dunder attribute '{node.attr}' not allowed")
            if isinstance(node, ast.While) and isinstance(node.test, ast.Constant) and node.test.value                     and not any(isinstance(n, (ast.Break, ast.Return)) for n in ast.walk(node)):
                errors.append(f"{rel}:{node.lineno}: unbounded loop (constant-true while without break/return)")
        if rel != "scripts/helper.py":
            continue
        if not any(isinstance(n, ast.FunctionDef) and n.name == "run" for n in tree.body):
            errors.append("scripts/helper.py must define run(dataset) -> {'proposals': [...]}")
        warnings += [f"unused import '{m}'" for alias, m in imported.items() if alias not in used]
        for fn in (n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)):
            if any(isinstance(c, ast.Call) and isinstance(c.func, ast.Name) and c.func.id == fn.name for c in ast.walk(fn)):
                warnings.append(f"{fn.name}: recursive (check depth is bounded)")
            calls = {}
            for c in ast.walk(fn):
                if isinstance(c, ast.Call) and c.args:  # same call, same argument expressions
                    calls.setdefault(ast.dump(c), []).append(c)
            warnings += [f"{fn.name}: `{ast.unparse(cs[0])}` computed {len(cs)}x (lines {[c.lineno for c in cs]}); reuse the result?"
                         for cs in calls.values() if len(cs) > 1]
            for loop in (n for n in ast.walk(fn) if isinstance(n, (ast.For, ast.While))):
                if any(isinstance(inner, (ast.For, ast.While)) for b in loop.body for inner in ast.walk(b)):
                    warnings.append(f"{fn.name}:{loop.lineno}: nested loop (possible O(n*m) scan; index with a dict?)")
                    break
            if any(isinstance(n, ast.While) for n in ast.walk(fn)):
                warnings.append(f"{fn.name}: while-loop (termination not statically checked)")
    return errors, warnings


def _limits():  # POSIX only; runs in the child before exec
    import resource
    for res, val in ((resource.RLIMIT_CPU, 10), (resource.RLIMIT_AS, 1 << 30),
                     (resource.RLIMIT_FSIZE, 1 << 20), (resource.RLIMIT_NOFILE, 64)):
        resource.setrlimit(res, (val, val))


def sandbox(mode, skill_dir, payload=None, timeout=15):
    """Run untrusted skill code in a child: throwaway copy, scrubbed env, timeout, rlimits (POSIX)."""
    tmp = Path(tempfile.mkdtemp(prefix="skillrun-"))
    try:
        work = tmp / "skill"
        shutil.copytree(skill_dir, work, ignore=shutil.ignore_patterns("__pycache__"))
        env = {"PATH": os.environ.get("PATH", "")}
        if os.name == "nt":
            env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", "")  # python won't start on Windows without it
        stdin = json.dumps(payload) if payload is not None else ""
        if os.environ.get("SKILL_RUNNER") == "docker":
            # Strong isolation for the host-side trusted service: throwaway container, no network, read-only FS,
            # no host mounts except the skill copy (ro), unprivileged user, no capabilities, CPU/mem/pid limits.
            shutil.copy(RUNNER, tmp / "_runner.py")
            name = f"skillrun-{uuid.uuid4().hex[:12]}"
            cmd = ["docker", "run", "--rm", "-i", "--name", name, "--network", "none", "--read-only",
                   "--memory", "512m", "--memory-swap", "512m",  # swap == memory: no extra swap headroom
                   "--cpus", "1", "--pids-limit", "64", "--cap-drop", "ALL",
                   "--security-opt", "no-new-privileges", "--user", "65534:65534", "--tmpfs", "/tmp:size=16m",
                   "-v", f"{tmp}:/w:ro", os.environ.get("SKILL_RUNNER_IMAGE", "python:3.12-slim"),
                   "python", "-I", "-B", "/w/_runner.py", mode, "/w/skill"]
            try:
                proc = subprocess.run(cmd, input=stdin, capture_output=True, text=True, timeout=timeout + 10, env=env)
            except subprocess.TimeoutExpired:
                subprocess.run(["docker", "kill", name], capture_output=True)  # the client dying doesn't stop it
                raise
        else:
            proc = subprocess.run([sys.executable, "-I", "-B", str(RUNNER), mode, str(work)],
                                  input=stdin, capture_output=True, text=True, timeout=timeout, env=env, cwd=tmp,
                                  preexec_fn=_limits if os.name == "posix" else None)
        if len(proc.stdout) > MAX_OUTPUT_BYTES:
            return {"ok": False, "error": f"output exceeds {MAX_OUTPUT_BYTES} bytes"}
        try:
            return json.loads(proc.stdout.strip().splitlines()[-1])
        except (IndexError, json.JSONDecodeError):
            return {"ok": False, "error": f"runner crashed (exit {proc.returncode}): {proc.stderr[-500:]}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"timeout after {timeout}s"}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _proposal_set(proposals):
    out = set()
    for p in proposals:
        v = p["value"]
        out.add((p["record_id"], p["field"], round(v, 9) if isinstance(v, (int, float)) else json.dumps(v)))
    return out


PROPOSAL_KEYS = {"record_id", "field", "value", "reason", "action_type"}
REFUSAL_CODES = {"not_applicable", "insufficient_evidence", "requires_review"}


def _refusals(output):
    """Contract v2: optional `refused: [{record_id, code, reason}]` = records the skill looked at and will NOT decide.
    -> list (possibly empty), None when the skill is v1 (no key), or False when the list is malformed."""
    if not isinstance(output, dict) or "refused" not in output:
        return None
    rs = output["refused"]
    ok = isinstance(rs, list) and all(isinstance(x, dict) and set(x) <= {"record_id", "code", "reason"}
                                      and isinstance(x.get("record_id"), str) and x.get("code") in REFUSAL_CODES
                                      and len(str(x.get("reason", ""))) <= 300 for x in rs)
    return rs if ok and len({x["record_id"] for x in rs}) == len(rs) else False


def outcomes(data, proposals, refused):
    """Per record: change_proposed | no_change | <refusal code> | not_reported. `no_change` only when a v2 skill
    reported its refusals (it attests coverage); a v1 skill's silence is `not_reported`, never "nothing to change"."""
    out = {r["id"]: {"status": "no_change" if refused is not None else "not_reported"} for r in data["records"]}
    for x in refused or []:
        if x["record_id"] in out:
            out[x["record_id"]] = {"status": x["code"], "reason": str(x.get("reason", ""))[:300]}
    for p in proposals:
        if p["record_id"] in out:
            out[p["record_id"]] = {"status": "change_proposed"}
    return out


def _valid_proposals(output, n_records=None):
    """Output sanitization: only the proposal keys, scalar values, short reasons, at most one per record; optionally a
    typed refusal list (_refusals). Anything else (extra payload, copied evidence, huge output) is rejected."""
    ps = output.get("proposals") if isinstance(output, dict) else None
    if not isinstance(ps, list) or not {"proposals"} <= set(output) <= {"proposals", "refused"} or _refusals(output) is False:
        return None
    if {p.get("record_id") for p in ps if isinstance(p, dict)} & {x["record_id"] for x in output.get("refused", [])}:
        return None  # a record is either proposed or refused, never both
    for p in ps:
        if not (isinstance(p, dict) and set(p) <= PROPOSAL_KEYS and isinstance(p.get("record_id"), str)
                and isinstance(p.get("field"), str) and "value" in p
                and isinstance(p["value"], (int, float, str, bool, type(None)))
                and len(str(p.get("reason", ""))) <= 300):
            return None
    if n_records is not None and len(ps) > n_records:
        return None
    return ps


# ---- tasks (experience log) -----------------------------------------------

def _inference_snapshot():
    return inference_metrics.snapshot()  # None when LLM_METRICS_URL unset/unreachable


def _inference_since_start(t):
    start = json.loads(t["metrics_start"] or "null")
    if isinstance(start, (int, float)):  # rows written before the full-snapshot format
        start = {"requests": start}
    return inference_metrics.delta(start, _inference_snapshot())


def task_begin(conn, label, mode):
    if mode not in ("real", "mock", "deterministic"):
        raise ToolError("invalid_input", "mode must be 'real' (local model drives), 'mock' (scripted) or "
                                         "'deterministic' (an approved skill runs as fixed code: no model, no agent)")
    if tools.current_task_id(conn):
        raise ToolError("invalid_state", "a task is already open; run `task end` first")
    scenario = conn.execute("SELECT value FROM meta WHERE key='scenario'").fetchone()
    data = dataset(conn)
    sig = task_signature(data, tools._policy(conn)) if scenario else None
    probe = ROOT / "data" / "model_probe.json"  # last probed model (python -m app models probe); None = unknown
    model = json.loads(probe.read_text()).get("model") if mode == "real" and probe.exists() else None
    cur = conn.execute("INSERT INTO tasks (label, scenario, mode, input_snapshot, metrics_start, started_at, signature, "
                       "model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (label, scenario["value"] if scenario else None, mode,
                                                                  json.dumps(data), json.dumps(_inference_snapshot()),
                                                                  time.time(), json.dumps(sig), model))
    audit(conn, "operator", "task_begin", {"task_id": cur.lastrowid, "label": label, "mode": mode})
    return {"ok": True, "task_id": cur.lastrowid}


def _verified_fixes(conn, task_id):
    """Executed actions in this task whose LATEST verification passed."""
    rows = conn.execute("""
        SELECT a.record_id, a.params, v.passed FROM actions a
        JOIN verifications v ON v.id = (SELECT MAX(id) FROM verifications WHERE action_id = a.id)
        WHERE a.task_id = ? AND a.status = 'executed'""", (task_id,)).fetchall()
    return [dict(record_id=r["record_id"], **json.loads(r["params"])) for r in rows if r["passed"]], \
           sum(1 for r in rows if not r["passed"])


def _model_calls_since_start(t):
    return _inference_since_start(t)["requests"]


def task_mark(conn, phase, model_calls=None):
    """Phase boundary inside a task (e.g. 'solved', 'skill_generated') so model calls can be split by phase.
    model_calls = cumulative since task begin (host-measured via ro.sh) or read from LLM_METRICS_URL here."""
    tid = tools.current_task_id(conn)
    if not tid:
        raise ToolError("invalid_state", "no open task")
    t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    marks = json.loads(t["phase_marks"] or "[]") + [{
        "phase": str(phase), "t_s": round(time.time() - t["started_at"], 3),
        "model_calls": model_calls if model_calls is not None else _model_calls_since_start(t),
        "tool_calls": conn.execute("SELECT COUNT(*) FROM tool_calls WHERE task_id=?", (tid,)).fetchone()[0]}]
    conn.execute("UPDATE tasks SET phase_marks=? WHERE id=?", (json.dumps(marks), tid))
    return {"ok": True, "marks": marks}


def task_end(conn, model_calls=None):
    tid = tools.current_task_id(conn)
    if not tid:
        raise ToolError("invalid_state", "no open task")
    t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    inference = _inference_since_start(t)
    inference["gpu_memory_used_mib_end"] = inference_metrics.gpu_memory_used_mib()
    if model_calls is None:
        model_calls = inference["requests"]
    passed, failed = _verified_fixes(conn, tid)
    executed = conn.execute("SELECT COUNT(*) FROM actions WHERE task_id=? AND status='executed'", (tid,)).fetchone()[0]
    violations = len(tools.invariant_violations(conn)) if conn.execute("SELECT 1 FROM meta WHERE key='policy'").fetchone() else 0
    used = sorted({f"{r['name']}@v{r['version']}" for r in conn.execute(
        "SELECT s.name, s.version FROM skill_runs r JOIN skills s ON s.id=r.skill_id WHERE r.task_id=? AND r.status='ok'", (tid,))})
    proposed = [f"{r['name']}@v{r['version']}:{r['status']}" for r in conn.execute(
        "SELECT name, version, status FROM skills WHERE source_task=?", (tid,))]
    agg = conn.execute("SELECT COUNT(*) n, COALESCE(SUM(queries),0) q, COALESCE(SUM(resp_bytes),0) b "
                       "FROM tool_calls WHERE task_id=?", (tid,)).fetchone()
    dupes = conn.execute("SELECT COALESCE(SUM(c - 1), 0) FROM (SELECT COUNT(*) c FROM tool_calls WHERE task_id=? "
                         "GROUP BY tool, args_hash HAVING c > 1)", (tid,)).fetchone()[0]
    breakdown = {r["tool"]: r["c"] for r in conn.execute(
        "SELECT tool, COUNT(*) c FROM tool_calls WHERE task_id=? GROUP BY tool ORDER BY tool", (tid,))}
    stats = dict(ended_at=time.time(), latency_s=round(time.time() - t["started_at"], 3), model_calls=model_calls,
                 tool_calls=agg["n"], duplicate_tool_calls=dupes, db_queries=agg["q"], data_bytes=agg["b"],
                 tool_breakdown=json.dumps(breakdown), inference=json.dumps(inference),
                 actions_executed=executed, verifications_passed=len(passed), verifications_failed=failed,
                 invariant_violations=violations,
                 success=int(executed > 0 and len(passed) == executed and failed == 0 and violations == 0),
                 skills_used=",".join(used), skill_proposed=",".join(proposed), status="closed")
    conn.execute(f"UPDATE tasks SET {', '.join(k + '=?' for k in stats)} WHERE id=?", (*stats.values(), tid))
    audit(conn, "operator", "task_end", {"task_id": tid, **{k: stats[k] for k in ("success", "tool_calls", "model_calls")}})
    return {"ok": True, "task_id": tid, **stats}


def task_list(conn):
    cols = "id, label, scenario, mode, latency_s, model_calls, tool_calls, duplicate_tool_calls, db_queries, data_bytes, " \
           "tool_breakdown, phase_marks, actions_executed, verifications_passed, verifications_failed, " \
           "invariant_violations, success, skills_used, skill_proposed, status"
    return {"ok": True, "tasks": [dict(r) for r in conn.execute(f"SELECT {cols} FROM tasks ORDER BY id")]}


# ---- profiling, benchmarking, hidden validation -----------------------------

BENCH = {"sizes": (1, 8, 32), "trials": 5, "repeats": 15}   # tests shrink this
RETAIN = {"min_work_reduction": 0.2, "min_warm_speedup": 0.1}  # an optimization must clear BOTH


def _scaled(snapshot, k):
    """k copies of the dataset with suffixed ids: same problem, k times the size."""
    sfx = lambda i: "" if i == 0 else f"~{i}"
    return {"records": [{**r, "id": r["id"] + sfx(i)} for i in range(k) for r in snapshot["records"]],
            "evidence": [{**e, "record_id": e["record_id"] + sfx(i)} for i in range(k) for e in snapshot["evidence"]]}


def _scaled_expected(expected, k):
    return {(rid + ("" if i == 0 else f"~{i}"), f, v) for i in range(k) for rid, f, v in expected}


def _stats(xs):
    if not xs:
        return None, None
    med = statistics.median(xs)
    return round(med, 4), round(statistics.median(abs(x - med) for x in xs), 4)  # median, MAD


def profile_skill(skill_dir, snapshot):
    """Profile on the learning data at 1x and 8x. Recommend optimization only on RUNTIME evidence of waste."""
    p1, p8 = sandbox("profile", skill_dir, _scaled(snapshot, 1)), sandbox("profile", skill_dir, _scaled(snapshot, 8))
    if not (p1.get("ok") and p8.get("ok")):
        return {"ok": False, "error": str(p1.get("error") or p8.get("error"))[:300]}
    a, b = p1["profile"], p8["profile"]
    growth = round(b["line_events"] / max(a["line_events"], 1), 1)
    evidence = []
    if growth > 16:  # 8x the data should cost ~8x the work
        evidence.append(f"work grew {growth}x for 8x data (superlinear: look for a nested scan)")
    if b["duplicate_calls"]:
        evidence.append(f"{b['duplicate_calls']} internal calls repeated with identical arguments: {b['duplicates_by_function']}")
    return {"ok": True, "size_1x": a, "size_8x": b, "work_growth_8x": growth, "recommended": bool(evidence),
            "evidence": evidence}


def _skill_dir(s):
    return SKILLS_DIR / "candidates" / s["name"] / f"v{s['version']}"


def _lineage_inputs(conn, s):
    """Learning snapshot + verified expected fixes of the ORIGINAL skill this one descends from."""
    root = _skill(conn, s["name"], s["parent_version"]) if s["parent_version"] else s
    snap = json.loads(conn.execute("SELECT input_snapshot FROM tasks WHERE id=?", (root["source_task"],)).fetchone()[0])
    return snap, json.loads(root["validation"])["replay"]["expected"]


def bench(conn, name, versions, sizes=None, trials=None, repeats=None):
    """Identical inputs for every version. cold = whole child process (interpreter start included);
    first = first run() in a fresh process; warm = later run() calls in the same process. Stored in skill_benchmarks."""
    sizes, trials, repeats = sizes or BENCH["sizes"], trials or BENCH["trials"], repeats or BENCH["repeats"]
    rows = {v: _skill(conn, name, v) for v in versions}
    snap, expected = _lineage_inputs(conn, rows[versions[0]])
    out = []
    for k in sizes:
        data, want = _scaled(snap, k), _scaled_expected(expected, k)
        for v, s in rows.items():
            d, cold, correct = _skill_dir(s), [], True
            for _ in range(trials):
                t0 = time.perf_counter()
                r = sandbox("run", d, data)
                cold.append((time.perf_counter() - t0) * 1000)
                got = _valid_proposals(r.get("output"), len(data["records"])) if r.get("ok") else None
                correct = correct and got is not None and _proposal_set(got) == want
            w = sandbox("bench", d, {"input": data, "repeats": repeats})
            times = w.get("times_ms", []) if w.get("ok") else []
            work = sandbox("profile", d, data).get("profile", {}).get("line_events")
            row = dict(name=name, version=v, size=k, records=len(data["records"]), trials=trials, correct=int(correct),
                       first_call_ms=round(times[0], 4) if times else None, work_line_events=work)
            row["cold_median_ms"], row["cold_mad_ms"] = _stats(cold)
            row["warm_median_ms"], row["warm_mad_ms"] = _stats(times[1:])
            conn.execute(f"INSERT INTO skill_benchmarks ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                         tuple(row.values()))
            out.append(row)
    return out


def _verdict(rows, parent_v, child_v):
    big = max(r["size"] for r in rows)
    p = next(r for r in rows if r["size"] == big and r["version"] == parent_v)
    c = next(r for r in rows if r["size"] == big and r["version"] == child_v)
    correct = all(r["correct"] for r in rows)
    work_red = 1 - (c["work_line_events"] or 0) / max(p["work_line_events"] or 1, 1)
    speedup = 1 - c["warm_median_ms"] / p["warm_median_ms"] if p["warm_median_ms"] and c["warm_median_ms"] is not None else 0
    cold = 1 - c["cold_median_ms"] / p["cold_median_ms"] if p["cold_median_ms"] and c["cold_median_ms"] is not None else 0
    retained = correct and work_red >= RETAIN["min_work_reduction"] and speedup >= RETAIN["min_warm_speedup"]
    return {"retained": retained, "correct_all_sizes": correct, "size": big,
            "work_reduction": round(work_red, 3), "warm_speedup": round(speedup, 3),
            "cold_speedup": round(cold, 3),  # reported, not gated: dominated by interpreter start + noise
            "thresholds": RETAIN,
            "tradeoff": ("optimized revision kept; original stays approved for rollback"
                         + ("" if abs(cold) >= 0.1 else ". End-to-end (cold, per-process) difference is within noise at this "
                            "size: the gain is algorithmic and only shows with larger data or warm reuse")
                         if retained else
                         "not retained: " + ("correctness changed" if not correct else "improvement below threshold")
                         + "; original version remains the one to use")}


def find_hidden_suite(scenario):
    """Hidden, human-written validation suites live in HIDDEN_DIR (default ./validation). NOT shipped to the sandbox."""
    d = Path(os.environ.get("HIDDEN_DIR", ROOT / "validation"))
    for f in sorted(d.glob("*.py")) if d.is_dir() else []:
        spec = importlib.util.spec_from_file_location(f"hidden_{f.stem}", f)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if scenario in getattr(mod, "SCENARIOS", ()):
            return f.name, mod
    return None, None


def hidden_check(skill_dir, scenario, input_shape):
    """Run the hidden suite against a candidate. Expectations are independent of anything the agent wrote."""
    suite_name, mod = find_hidden_suite(scenario)
    if not mod:
        return {"ok": False, "error": f"no hidden validation suite for scenario '{scenario}' (write one in validation/)"}
    results = []
    for case in mod.cases():
        exp, data, why = case["expect"], case["dataset"], None
        if exp.get("shape_refused"):
            ok, detail = _shape_key(data) != input_shape, "learned shape must not match"
        else:
            r = sandbox("run", skill_dir, data)
            got = _valid_proposals(r.get("output"), len(data["records"])) if r.get("ok") else None
            if "proposals" in exp:
                ok = got is not None and _proposal_set(got) == {(a, b, round(c, 9)) for a, b, c in exp["proposals"]}
                held = _refusals(r.get("output")) if got is not None else None
                if ok and held is not None and "escalate" in exp:  # v2 must refuse exactly what a person must see
                    ok = {x["record_id"] for x in held if x["code"] != "not_applicable"} == set(exp["escalate"])
                elif ok and exp.get("escalate"):  # v1 reports no refusals: it can't show what a person must see
                    ok, why = False, f"contract v1 skill reports no refusals; must escalate {sorted(exp['escalate'])}"
            else:  # malformed input: may error, must never propose for the bad records
                ok = (got is None and exp.get("error_ok", False) and not r.get("ok")) or \
                     (got is not None and not {p["record_id"] for p in got} & set(exp["no_proposals_for"]))
            detail = "ok" if ok else why or (str(r.get("error"))[-200:] if not r.get("ok") else f"got {len(got or [])} proposals")
        results.append({"case": case["name"], "ok": ok, "detail": detail})
    return {"ok": all(c["ok"] for c in results), "suite": suite_name, "cases": results}


# ---- agent-callable --------------------------------------------------------

def propose_skill(conn, name, path, description, tags=None, optimizes=None):
    """Submit a drafted skill dir (SKILL.md, scripts/helper.py, tests/test_helper.py) learned from the open task.
    optimizes=<version>: ONE optimized revision of that version, allowed only when its profile recommended it."""
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise ToolError("invalid_input", "name must match ^[a-z][a-z0-9_-]{2,40}$")
    scope = tools.agent_scope(conn)
    if scope:  # scoped: a name this namespace owns in the catalog, or one no approved/catalogued skill uses yet
        owned = conn.execute("SELECT 1 FROM sqlite_master WHERE name='catalog_entries'").fetchone() and conn.execute(
            "SELECT 1 FROM catalog_entries WHERE skill_name=? AND namespace = ?", (name, scope[0])).fetchone()
        taken = conn.execute("SELECT 1 FROM skills WHERE name=? AND status IN ('approved', 'disabled', 'rolled_back')", (name,)).fetchone() or (conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name='catalog_entries'").fetchone() and conn.execute(
            "SELECT 1 FROM catalog_entries WHERE skill_name=?", (name,)).fetchone())
        if taken and not owned:
            raise ToolError("name_unavailable", "this skill name is not available in your workspace; choose another name")
    if not isinstance(description, str) or not description.strip():
        raise ToolError("invalid_input", "description required")
    tags = tags or []
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ToolError("invalid_input", "tags must be a list of strings")
    src = Path(str(path))
    missing = [f for f in ("SKILL.md", "scripts/helper.py", "tests/test_helper.py") if not (src / f).is_file()]
    if missing:
        raise ToolError("invalid_input", f"skill dir {src} is missing {missing}")
    if sum(p.stat().st_size for p in src.rglob("*") if p.is_file()) > MAX_SKILL_BYTES:
        raise ToolError("invalid_input", f"skill dir exceeds {MAX_SKILL_BYTES} bytes")
    drafts = conn.execute("SELECT COUNT(*) FROM skills WHERE name=? AND status!='approved'", (name,)).fetchone()[0]
    if drafts >= MAX_DRAFTS:  # bounds trial-and-error against the validators (hidden-suite oracle probing)
        raise ToolError("submission_limit", f"{name} already has {drafts} unapproved versions; a human must review "
                                            "(skill reject/approve) before more drafts are accepted")

    parent = None
    if optimizes is not None:  # bounded: one revision, of an original, with profiling evidence
        parent = _skill(conn, name, optimizes)
        if parent["parent_version"]:
            raise ToolError("not_allowed", "an optimized revision cannot itself be optimized")
        if parent["status"] not in ("tested", "approved"):
            raise ToolError("not_allowed", f"{name}@v{optimizes} is '{parent['status']}'")
        if not json.loads(parent["profile"] or "{}").get("recommended"):
            raise ToolError("not_recommended", f"{name}@v{optimizes} showed no meaningful waste; leave it as is")
        if conn.execute("SELECT 1 FROM skills WHERE name=? AND parent_version=?", (name, optimizes)).fetchone():
            raise ToolError("not_allowed", f"{name}@v{optimizes} already had its one optimization attempt")
        tid = parent["source_task"]
        snapshot, exp_lists = _lineage_inputs(conn, parent)
        expected_set = {tuple(x) for x in exp_lists}
        input_shape, signature = parent["input_shape"], parent["signature"]
    else:
        tid = tools.current_task_id(conn)
        if not tid:
            raise ToolError("no_open_task", "skills are learned from a task: operator must run `task begin` first")
        fixes, _ = _verified_fixes(conn, tid)
        if not fixes:
            raise ToolError("nothing_verified", "this task has no executed + verified fix to generalize from")
        expected_set = _proposal_set(fixes)
        snapshot = json.loads(conn.execute("SELECT input_snapshot FROM tasks WHERE id=?", (tid,)).fetchone()[0])
        input_shape = _shape_key(snapshot)
        signature = conn.execute("SELECT signature FROM tasks WHERE id=?", (tid,)).fetchone()[0]

    version = (conn.execute("SELECT MAX(version) FROM skills WHERE name=?", (name,)).fetchone()[0] or 0) + 1
    dest = SKILLS_DIR / "candidates" / name / f"v{version}"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns("__pycache__", "meta.json"))

    errors, warnings = lint(dest)
    validation = {"lint": errors, "lint_warnings": warnings}
    if not errors:
        validation["own_tests"] = sandbox("test", dest)
        out = sandbox("run", dest, snapshot)
        got = _valid_proposals(out.get("output"), len(snapshot["records"])) if out.get("ok") else None
        validation["replay"] = {  # independent expected output: what humans approved and the verifier confirmed
            "ok": got is not None and _proposal_set(got) == expected_set,
            "expected": sorted(map(list, expected_set)),
            "got": sorted(map(list, _proposal_set(got))) if got is not None else out.get("error", "bad/unsafe output")}
    ok = not errors and validation["own_tests"].get("ok") and validation["replay"]["ok"]
    profile = profile_skill(dest, snapshot) if ok else None
    status = "tested" if ok else "failed_tests"
    sha = _tree_hash(dest)
    touches = sorted({f for _, f, _ in expected_set})
    conn.execute("INSERT INTO skills (name, version, description, tags, status, source_task, input_shape, sha256, "
                 "validation, parent_version, profile, signature, touches) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                 (name, version, description, json.dumps(tags), status, tid, input_shape, sha, json.dumps(validation),
                  optimizes, json.dumps(profile), signature, json.dumps(touches)))
    optimization = None
    if parent is not None and ok:
        rows = bench(conn, name, [optimizes, version])
        optimization = {**_verdict(rows, optimizes, version), "benchmark": rows}
        status = "tested" if optimization["retained"] else "not_retained"
        conn.execute("UPDATE skills SET status=?, optimization=? WHERE name=? AND version=?",
                     (status, json.dumps(optimization), name, version))
    scenario = conn.execute("SELECT scenario FROM tasks WHERE id=?", (tid,)).fetchone()[0]
    # meta.json is written by the system, never by the agent: the skill cannot grant itself anything
    (dest / "meta.json").write_text(json.dumps({
        "name": name, "version": version, "parent_version": optimizes, "description": description, "tags": tags,
        "source_task": tid, "scenario": scenario, "created_by": "agent", "status": status,
        "allowed_operations": ["compute_proposals"], "input_shape": input_shape, "files_sha256": sha,
        "validation": validation, "profile": profile, "optimization": optimization}, indent=2))
    audit(conn, "agent", "propose_skill", {"name": name, "version": version, "status": status, "optimizes": optimizes})
    res = {"ok": True, "name": name, "version": version, "status": status, "validation": validation}
    if profile:
        res["profile"] = {k: profile.get(k) for k in ("work_growth_8x", "recommended", "evidence")}
    if optimization:
        res["optimization"] = {k: v for k, v in optimization.items() if k != "benchmark"}
    if status == "tested":
        res["next"] = f"human: python -m app skill approve {name} {version} --by <name> (runs hidden validation)"
        if profile and profile.get("recommended") and parent is None:
            res["next"] += (f". Optional, once: write an optimized revision addressing {profile['evidence']} and "
                            f"propose_skill with optimizes={version}")
    elif status == "failed_tests":
        res["next"] = "fix the helper/tests and propose_skill again (new version)"
    else:
        res["next"] = "optimization not retained; keep using the original version"
    return res


def search_skills(conn, query=""):
    """Approved, active skills ranked by keyword overlap; `compatible` = fits the CURRENT data's shape."""
    words = set(re.findall(r"\w+", str(query).lower()))
    m = match_skills(conn)
    level = {(c["name"], c["version"]): c for c in m["candidates"]}
    hits = []
    for s in conn.execute("SELECT * FROM skills WHERE status='approved' AND active=1"):
        if (s["name"], s["version"]) not in level:  # out of this agent's scope: not listed at all
            continue
        text = set(re.findall(r"\w+", f"{s['name']} {s['description']} {' '.join(json.loads(s['tags']))}".lower()))
        c = level[(s["name"], s["version"])]
        hits.append({"name": s["name"], "version": s["version"], "description": s["description"],
                     "score": len(words & text), "compatible": c["match"] == "exact" and m["decision"] == "skill",
                     "match": c["match"], "reasons": c["reasons"]})
    hits.sort(key=lambda h: (not h["compatible"], -h["score"], h["name"]))
    best = next((h for h in hits if h["compatible"]), None)
    return {"ok": True, "skills": hits,
            "recommendation": f"run_skill {best['name']} (deterministic, no model reasoning needed)" if best else
                              "no compatible skill: investigate with your own reasoning"}


def run_skill(conn, name, propose=False, version=None):
    """Run an approved skill on the current data. propose=true files its proposals (policy + approval still apply).
    version pins an approved version (default: the active one)."""
    if version is None:
        s = conn.execute("SELECT * FROM skills WHERE name=? AND status='approved' AND active=1", (name,)).fetchone()
    else:
        s = conn.execute("SELECT * FROM skills WHERE name=? AND version=? AND status='approved'", (name, version)).fetchone()
    visible = tools.visible_skill_ids(conn)
    if not s or (visible is not None and s["id"] not in visible):  # out of scope = does not exist (same answer)
        raise ToolError("not_found", f"no approved{'' if version else ', active'} skill '{name}'"
                                     + (f" v{version}" if version else ""))
    tid = tools.current_task_id(conn)
    d = SKILLS_DIR / "approved" / name / f"v{s['version']}"

    def record(status, n=0, detail=None):
        return conn.execute("INSERT INTO skill_runs (skill_id, task_id, status, proposals, detail) VALUES (?, ?, ?, ?, ?)",
                            (s["id"], tid, status, n, detail)).lastrowid

    if not d.is_dir() or _tree_hash(d) != s["sha256"]:
        record("refused", detail="integrity")
        raise ToolError("integrity_error", f"{name}@v{s['version']} files changed since approval; refusing to run")
    data = dataset(conn)
    if _shape_key(data) != s["input_shape"]:
        record("refused", detail="incompatible_input")
        audit(conn, "agent", "run_skill_refused", {"name": name, "reason": "incompatible_input"})
        raise ToolError("incompatible_input", f"current data does not match the shape {name} was learned on; "
                                              "investigate with your own reasoning instead")
    learned, now = json.loads(s["signature"] or "null"), task_signature(data, tools._policy(conn))
    diffs = [k for k in SIGNATURE_PARTS if not learned or learned.get(k) != now[k]]
    if diffs:
        record("refused", detail="uncertain_match")
        audit(conn, "agent", "run_skill_refused", {"name": name, "reason": "uncertain_match", "differs": diffs})
        raise ToolError("uncertain_match", f"data looks like what {name} was learned on but differs in {diffs}; "
                                           "investigate with your own reasoning instead")
    out = sandbox("run", d, data)
    proposals = _valid_proposals(out.get("output"), len(data["records"])) if out.get("ok") else None
    if proposals is None:
        rid = record("error", detail=str(out.get("error", "bad output shape"))[:500])
        audit(conn, "agent", "run_skill_error", {"name": name, "run_id": rid})
        raise ToolError("skill_error", f"{name} failed: {str(out.get('error', 'output must be {proposals: [...]}'))[:300]}")
    refused = _refusals(out.get("output"))
    per_record = outcomes(data, proposals, refused)
    held = {k: v for k, v in per_record.items() if v["status"] in REFUSAL_CODES}
    run_id = record("ok", len(proposals), json.dumps({"refused": held}) if held else None)
    audit(conn, f"skill:{name}@v{s['version']}", "run_skill", {"run_id": run_id, "proposals": len(proposals),
                                                                "refused": len(held)})
    result = {"ok": True, "skill": f"{name}@v{s['version']}", "run_id": run_id, "proposals": proposals,
              "outcomes": per_record, "contract": "v2" if refused is not None else "v1"}
    if held:
        result["needs_person"] = sorted(held)
    if propose:
        filed, errors = [], []
        for p in proposals:
            try:
                a = tools._propose(conn, p["record_id"], p.get("action_type", "set_field"),
                                   {"field": p["field"], "value": p["value"]}, p.get("reason") or f"skill {name}",
                                   origin=f"skill:{name}@v{s['version']}#{run_id}")["action"]
                filed.append(tools.request_approval(conn, a["id"])["action"])
            except ToolError as e:
                errors.append({"proposal": p, **e.to_dict()["error"]})
        result.update(actions=filed, errors=errors,
                      next="waiting for human approval of each action, then execute_action + verify_action")
    return result


# ---- human-only -------------------------------------------------------------

def _skill(conn, name, version):
    s = conn.execute("SELECT * FROM skills WHERE name=? AND version=?", (name, int(version))).fetchone()
    if not s:
        raise ToolError("not_found", f"skill {name}@v{version} not found")
    return s


def _human(by):
    if not isinstance(by, str) or not by.strip() or by.strip().lower() in ("agent", "system", "policy"):
        raise ToolError("invalid_input", "must name a human")


def approve_skill(conn, name, version, by, hidden_sha=None):
    """Human promotion. Requires the HIDDEN validation suite to pass: run here if the suite is present
    (dev / host), otherwise the host must have run `skill hidden-check` on these exact files (hidden_sha)."""
    _human(by)
    s = _skill(conn, name, version)
    if s["status"] != "tested":
        raise ToolError("invalid_state", f"{name}@v{version} is '{s['status']}'; only 'tested' skills can be approved")
    cand = SKILLS_DIR / "candidates" / name / f"v{version}"
    if _tree_hash(cand) != s["sha256"]:
        raise ToolError("integrity_error", "candidate files changed after testing; re-propose")
    scenario = conn.execute("SELECT scenario FROM tasks WHERE id=?", (s["source_task"],)).fetchone()[0]
    if find_hidden_suite(scenario)[1]:
        hidden = hidden_check(cand, scenario, s["input_shape"])
    elif hidden_sha:
        hidden = {"ok": hidden_sha == s["sha256"], "ran_on": "host", "sha256": hidden_sha}
    else:
        raise ToolError("hidden_validation_required", "no hidden suite here: run `skill hidden-check` on the host "
                                                      "(scripts/ro.sh does this) and pass --hidden-sha")
    conn.execute("UPDATE skills SET hidden_validation=? WHERE id=?", (json.dumps(hidden), s["id"]))
    if not hidden["ok"]:
        audit(conn, f"human:{by}", "skill_hidden_validation_failed", {"name": name, "version": int(version)})
        raise ToolError("hidden_validation_failed", f"{name}@v{version} failed independent validation: "
                        + json.dumps([c for c in hidden.get("cases", []) if not c["ok"]] or hidden)[:600])
    dest = SKILLS_DIR / "approved" / name / f"v{version}"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(cand, dest)
    meta = json.loads((dest / "meta.json").read_text())
    (dest / "meta.json").write_text(json.dumps({**meta, "status": "approved", "approved_by": by}, indent=2))
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("UPDATE skills SET active=0 WHERE name=?", (name,))
    conn.execute("UPDATE skills SET status='approved', active=1, decided_by=? WHERE id=?", (by, s["id"]))
    audit(conn, f"human:{by}", "skill_approved", {"name": name, "version": int(version), "sha256": s["sha256"]})
    conn.execute("COMMIT")
    return {"ok": True, "active": f"{name}@v{version}"}


def reject_skill(conn, name, version, by):
    _human(by)
    s = _skill(conn, name, version)
    if s["status"] not in ("tested", "failed_tests"):
        raise ToolError("invalid_state", f"{name}@v{version} is '{s['status']}'")
    conn.execute("UPDATE skills SET status='rejected', decided_by=? WHERE id=?", (by, s["id"]))
    audit(conn, f"human:{by}", "skill_rejected", {"name": name, "version": int(version)})
    return {"ok": True}


def disable_skill(conn, name, by):
    _human(by)
    n = conn.execute("UPDATE skills SET status='disabled', active=0 WHERE name=? AND active=1", (name,)).rowcount
    if not n:
        raise ToolError("not_found", f"no active version of {name}")
    audit(conn, f"human:{by}", "skill_disabled", {"name": name})
    return {"ok": True}


def rollback_skill(conn, name, by):
    """Deactivate the active version and re-activate the newest earlier approved version."""
    _human(by)
    cur = conn.execute("SELECT * FROM skills WHERE name=? AND active=1", (name,)).fetchone()
    if not cur:
        raise ToolError("not_found", f"no active version of {name}")
    prev = conn.execute("SELECT * FROM skills WHERE name=? AND status='approved' AND version<? ORDER BY version DESC",
                        (name, cur["version"])).fetchone()
    if not prev:
        raise ToolError("invalid_state", f"no earlier approved version of {name}; use `skill disable`")
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("UPDATE skills SET status='rolled_back', active=0 WHERE id=?", (cur["id"],))
    conn.execute("UPDATE skills SET active=1 WHERE id=?", (prev["id"],))
    audit(conn, f"human:{by}", "skill_rollback", {"name": name, "from": cur["version"], "to": prev["version"]})
    conn.execute("COMMIT")
    return {"ok": True, "active": f"{name}@v{prev['version']}"}


def list_skills(conn):
    rows = conn.execute("""
        SELECT s.name, s.version, s.parent_version, s.status, s.active, s.source_task, s.decided_by, s.description,
               json_extract(s.profile, '$.recommended') AS optimization_recommended,
               json_extract(s.optimization, '$.retained') AS optimization_retained,
               json_extract(s.optimization, '$.warm_speedup') AS warm_speedup,
               json_extract(s.hidden_validation, '$.ok') AS hidden_ok,
               COUNT(r.id) AS runs, COALESCE(SUM(r.status='ok'), 0) AS runs_ok,
               COALESCE(SUM(r.status='refused'), 0) AS runs_refused, COALESCE(SUM(r.status='error'), 0) AS runs_error,
               COALESCE(SUM(r.verified_pass), 0) AS verified_pass, COALESCE(SUM(r.verified_fail), 0) AS verified_fail
        FROM skills s LEFT JOIN skill_runs r ON r.skill_id = s.id GROUP BY s.id ORDER BY s.name, s.version""")
    return {"ok": True, "skills": [dict(r) for r in rows]}


def bench_rows(conn, name):
    """Latest benchmark row per (version, size)."""
    return [dict(r) for r in conn.execute("""
        SELECT * FROM skill_benchmarks WHERE id IN (SELECT MAX(id) FROM skill_benchmarks WHERE name=? GROUP BY version, size)
        ORDER BY size, version""", (name,))]
