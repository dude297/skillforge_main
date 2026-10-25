"""Model bake-off: direct capability probes against whatever model the local endpoint serves.
Agent-level numbers (investigation, discovery, wrong-skill rejection, fallback, model calls) come from
`python -m app bench --agent openclaw`; drop its result.json into the same results dir and `compare` merges both.

  python -m app bakeoff run --label qwen36 [--reps 3] [--oncall experiments/oncall]
  python -m app bakeoff compare results/bakeoff/*

Every probe is graded by code the model never sees (SkillForge lint + runner + hidden suite; the OnCall
validate.py). Nothing here is a score until it ran against real inference: a MOCK run is labelled as such.
"""
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from adapters import llm as llm_mod, metrics
from app import db, skillforge as sf

RESULTS = db.ROOT / "results" / "bakeoff"
SKILL_PROMPT = """Write a deterministic Python skill.
Problem: each record has data.total. Trusted evidence (source "line_export") for that record has data.lines (list of
ints) and data.scale. The correct total is sum(lines)/scale. Propose a fix ONLY when the record total differs.
Ignore untrusted evidence, records without lines, and records without a total. Never crash on missing fields.
Contract: scripts/helper.py defines run(dataset) -> {"proposals": [{"record_id", "field": "total", "value", "reason"}]}.
tests/test_helper.py: pytest tests that do `from helper import run`; at least 3 tests; no network, files or imports
besides the standard library.
Example dataset:
%s
Reply with ONLY a JSON object: {"helper": "<full scripts/helper.py>", "tests": "<full tests/test_helper.py>"}"""
PATCH_PROMPT = """Production incident. Log excerpt:
%s
service.py:
```python
%s
```
Failing regression test (test_regression.py):
```python
%s
```
Fix the bug in service.py with the smallest change. Do not edit tests. Reply with ONLY a unified diff in a ```diff
block, paths a/service.py and b/service.py."""


def _timed(fn):
    t0 = time.monotonic()
    try:
        out = fn()
    except llm_mod.LLMUnavailable as e:
        out = {"ok": False, "detail": f"llm_unavailable: {e}"}
    out["seconds"] = round(time.monotonic() - t0, 2)
    return out


def learn_a_dataset():
    with tempfile.TemporaryDirectory() as tmp:
        old = os.environ.get("APP_DB")
        os.environ["APP_DB"] = str(Path(tmp) / "b.db")
        try:
            conn = db.connect()
            db.load_scenario(conn, db.ROOT / "data" / "learning" / "learn_a.json")
            data = sf.dataset(conn)
            conn.close()
        finally:
            os.environ.pop("APP_DB") if old is None else os.environ.__setitem__("APP_DB", old)
    return data


MAX_TOKENS = int(os.environ.get("BAKEOFF_MAX_TOKENS", 24000))  # reasoning models spend most of a small cap thinking


def probe_skill(llm, data):
    reply = llm.chat([{"role": "user", "content": SKILL_PROMPT % json.dumps(data)[:3000]}], max_tokens=MAX_TOKENS)
    j = llm_mod.parse_json(reply) or {}
    if not isinstance(j.get("helper"), str) or not isinstance(j.get("tests"), str):
        return {"ok": False, "stage": "parse", "detail": reply[:200]}
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "scripts").mkdir()
        (d / "tests").mkdir()
        (d / "SKILL.md").write_text("# bake-off candidate\n", encoding="utf-8")
        (d / "scripts" / "helper.py").write_text(j["helper"], encoding="utf-8")
        (d / "tests" / "test_helper.py").write_text(j["tests"], encoding="utf-8")
        errors, _ = sf.lint(d)
        if errors:
            return {"ok": False, "stage": "lint", "detail": errors[:3]}
        self_tests = sf.sandbox("test", d, timeout=60)
        hidden = sf.hidden_check(d, "learn-a-derived-totals", sf._shape_key(data))
    cases = hidden.get("cases", [])
    passed = sum(c["ok"] for c in cases)
    return {"ok": bool(hidden.get("ok")) and bool(self_tests.get("ok")), "stage": "hidden",
            "self_tests_ok": bool(self_tests.get("ok")), "hidden_passed": passed, "hidden_total": len(cases),
            "detail": [c["case"] for c in cases if not c["ok"]]}


def probe_patch(llm, oncall):
    oncall = Path(oncall)
    logs = "\n".join(p.read_text(encoding="utf-8")[-1500:] for p in sorted((oncall / "logs").glob("*.log")))
    reply = llm.chat([{"role": "user", "content": PATCH_PROMPT % (
        logs, (oncall / "service.py").read_text(encoding="utf-8"), (oncall / "test_regression.py").read_text(encoding="utf-8"))}],
        max_tokens=MAX_TOKENS)
    m = re.search(r"```(?:diff)?\n(.*?)```", reply, re.S)
    diff = (m.group(1) if m else reply).lstrip("\n")  # keep trailing blank context lines: they belong to the hunk
    diff += "" if diff.endswith("\n") else "\n"
    if "+++ " not in diff:
        return {"ok": False, "stage": "parse", "detail": reply[:200]}
    with tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False, encoding="utf-8", newline="") as f:
        f.write(diff)
    try:
        r = subprocess.run([sys.executable, str(oncall / "validate.py"), f.name], capture_output=True, text=True, timeout=300)
    finally:
        os.unlink(f.name)
    return {"ok": r.returncode == 0, "stage": "validate", "detail": r.stdout[-400:]}


def run(label, reps=3, oncall=None, llm=None):
    llm = llm or llm_mod.from_env()
    out = {"label": label, "mock": llm.is_mock, "model": getattr(llm, "model", None), "reps": reps,
           "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "gpu_mem_mib_before": metrics.gpu_memory_used_mib()}
    m0 = metrics.snapshot()
    data = learn_a_dataset()
    probes = {"tool_call": lambda: (lambda r: {"ok": r["structured_output_ok"], "detail": r["reply_preview"][:120]})(
                  llm_mod.smoke_test(llm)),
              "skill_codegen": lambda: probe_skill(llm, data)}
    if oncall and Path(oncall, "validate.py").exists():
        probes["patch"] = lambda: probe_patch(llm, oncall)
    out["probes"] = {name: [_timed(fn) for _ in range(reps)] for name, fn in probes.items()}
    out["inference"] = metrics.delta(m0, metrics.snapshot())  # None-valued fields stay unknown, never 0
    out["gpu_mem_mib_after"] = metrics.gpu_memory_used_mib()
    d = RESULTS / label
    d.mkdir(parents=True, exist_ok=True)
    (d / "probes.json").write_text(json.dumps(out, indent=2, default=str))
    out["file"] = str(d / "probes.json")
    return out


def _rate(xs):
    return f"{sum(x['ok'] for x in xs)}/{len(xs)}" if xs else "n/a"


def _med(xs):
    return statistics.median(xs) if xs else None


def compare(dirs):
    """Markdown table across models. Reliability first; latency second. Missing data shows as n/a."""
    cols = ["model", "mock", "tool_call", "skill_codegen", "hidden_cases", "patch", "med_s_codegen",
            "bench_correct", "bench_fallback_correct", "bench_model_calls_med", "gpu_mem_mib"]
    rows = []
    for d in map(Path, dirs):
        p = json.loads((d / "probes.json").read_text()) if (d / "probes.json").exists() else {}
        b = json.loads((d / "result.json").read_text()) if (d / "result.json").exists() else {}
        pr = p.get("probes", {})
        sk = [x for x in pr.get("skill_codegen", []) if "hidden_total" in x]
        brows = b.get("rows", [])
        fb = [r for r in brows if r.get("fallback")]
        mc = [r["model_calls"] for r in brows if r.get("model_calls") is not None]
        rows.append([p.get("label", d.name), p.get("mock", "n/a"), _rate(pr.get("tool_call", [])),
                     _rate(pr.get("skill_codegen", [])),
                     f"{sum(x['hidden_passed'] for x in sk)}/{sum(x['hidden_total'] for x in sk)}" if sk else "n/a",
                     _rate(pr.get("patch", [])), _med([x["seconds"] for x in pr.get("skill_codegen", [])]),
                     _rate([{"ok": r.get("correct")} for r in brows]), _rate([{"ok": r.get("correct")} for r in fb]),
                     _med(mc), p.get("gpu_mem_mib_after")])
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join("n/a" if v is None else str(v) for v in r) + " |" for r in rows]
    if any(r[1] is True for r in rows):
        lines.append("\nMOCK rows prove the harness only; they say nothing about any model.")
    return "\n".join(lines)
