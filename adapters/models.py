"""Local model registry (data/models.json) + capability probe. Model-specific facts live in the JSON, not in code.

  python -m app models list
  python -m app models probe        # against LLM_BASE_URL (+ LLM_API_KEY); writes data/model_probe.json

The probe uses NATIVE OpenAI tool calling (`tools=[...]`), the path OpenClaw and vLLM's --tool-call-parser use.
Autonomous skill generation is allowed only while the CURRENTLY served model has a passing probe (learning_allowed).
"""
import json
import os
import time
from pathlib import Path

from adapters import llm as llm_mod

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "models.json"
PROBE_FILE = ROOT / "data" / "model_probe.json"
PROBE_MAX_AGE_S = 12 * 3600

TOOLS = [
    {"type": "function", "function": {"name": "read_records", "description": "List business records.",
                                      "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "investigate", "description": "Investigate one record by id.",
                                      "parameters": {"type": "object", "properties": {"record_id": {"type": "string"}},
                                                     "required": ["record_id"]}}},
]


def registry():
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


def lookup(served_id):
    return next((m for m in registry()["models"] if served_id in m["served_names"] or served_id == m["id"]), None)


def _tool_call(msg):
    calls = (msg or {}).get("tool_calls") or []
    if not calls:
        return None, None
    f = calls[0].get("function") or {}
    try:
        args = json.loads(f.get("arguments") or "{}")
    except (json.JSONDecodeError, TypeError):
        args = None
    return {"id": calls[0].get("id", "call_0"), "name": f.get("name"), "args": args}, calls[0]


def probe(llm, timeout_s=None):
    """Six checks, each recorded; unknown stays None. Never raises for model misbehaviour."""
    timeout_s = timeout_s or float(os.environ.get("PROBE_LATENCY_S", 120))
    checks, t_all = {}, time.monotonic()
    out = {"model": None, "registered": None, "checks": checks, "ts": time.time()}
    try:
        info = llm.health()
        checks["endpoint"] = {"ok": True}
    except llm_mod.LLMUnavailable as e:
        checks["endpoint"] = {"ok": False, "detail": str(e)[:200]}
        return _finish(out, t_all, timeout_s)
    out["model"] = info["model"]
    entry = lookup(info["model"])
    out["registered"] = entry["id"] if entry else None
    checks["identity"] = {"ok": entry is not None, "detail": None if entry else
                          f"served '{info['model']}' is not in data/models.json (wrong profile or artifacts?)"}
    msgs = [{"role": "system", "content": "You operate a records system through tools. Always use a tool."},
            {"role": "user", "content": "Find out which records exist."}]
    try:
        m1 = llm.chat_message(msgs, tools=TOOLS, max_tokens=(entry or {}).get("max_tokens", 2048))
        c1, raw1 = _tool_call(m1)
        checks["native_tool_call"] = {"ok": bool(c1) and c1["name"] == "read_records",
                                      "detail": c1 or str((m1 or {}).get("content"))[:160]}
        checks["schema"] = {"ok": bool(c1) and isinstance(c1["args"], dict),
                            "detail": None if c1 and isinstance(c1["args"], dict) else "arguments not a JSON object"}
        if checks["native_tool_call"]["ok"]:
            msgs += [{"role": "assistant", "content": None, "tool_calls": [raw1]},
                     {"role": "tool", "tool_call_id": c1["id"],
                      "content": json.dumps({"ok": True, "records": [{"id": "REC-7", "data": {"total": 5}}]})},
                     {"role": "user", "content": "Investigate the record you found."}]
            m2 = llm.chat_message(msgs, tools=TOOLS, max_tokens=(entry or {}).get("max_tokens", 2048))
            c2, _ = _tool_call(m2)
            checks["multi_step"] = {"ok": bool(c2) and c2["name"] == "investigate"
                                    and (c2["args"] or {}).get("record_id") == "REC-7", "detail": c2}
    except llm_mod.LLMUnavailable as e:
        checks.setdefault("native_tool_call", {"ok": False, "detail": str(e)[:200]})
    return _finish(out, t_all, timeout_s)


def _finish(out, t0, timeout_s):
    out["elapsed_s"] = round(time.monotonic() - t0, 2)
    out["checks"]["latency_bound"] = {"ok": out["elapsed_s"] <= timeout_s, "detail": f"<= {timeout_s}s"}
    required = registry()["required_for_learning"]
    out["missing"] = [c for c in required if not out["checks"].get(c, {}).get("ok")]
    out["passed"] = not out["missing"]
    return out


def save(result):
    PROBE_FILE.write_text(json.dumps(result, indent=2, default=str))


def learning_allowed(served_model):
    """(ok, reason). The served model must have a recent passing probe. Reads data/model_probe.json."""
    if not PROBE_FILE.exists():
        return False, "no model probe on record: run `python -m app models probe`"
    p = json.loads(PROBE_FILE.read_text())
    if not p.get("passed"):
        return False, f"last probe of {p.get('model')} failed: missing {p.get('missing')}"
    if served_model and p.get("model") != served_model:
        return False, f"probe was for {p.get('model')}, but {served_model} is served now: re-probe after switching"
    if time.time() - p.get("ts", 0) > PROBE_MAX_AGE_S:
        return False, "probe older than 12h: re-probe"
    return True, f"{p['model']} passed the capability probe"
