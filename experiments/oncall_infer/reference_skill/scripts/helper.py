"""RECORDED REFERENCE (hand-written by an agent for the demo, NOT model output).
Diagnose serving-config regressions: GPU OOM in the engine log + exactly one memory-relevant key changed by the
deploy -> propose reverting that key to its baseline. Never applies anything."""
import re

MEMORY_KEYS = ("max_num_seqs", "max_model_len", "gpu_memory_utilization")
OOM_RE = re.compile(r"OutOfMemoryError|CUDA out of memory", re.I)


def _refuse(rid, code, reason):
    return {"record_id": rid, "code": code, "reason": reason}


def run(dataset):
    ev = {}
    for e in dataset.get("evidence", []):
        if e.get("trusted"):
            ev.setdefault(e.get("record_id"), {})[e.get("source")] = e.get("data") or {}
    proposals, refused = [], []
    for rec in dataset.get("records", []):
        rid, src = rec.get("id"), ev.get(rec.get("id"), {})
        before = (src.get("config_before") or {}).get("config")
        after = (src.get("config_after") or {}).get("config")
        lines = (src.get("log") or {}).get("lines") or []
        if not isinstance(before, dict) or not isinstance(after, dict):
            refused.append(_refuse(rid, "insufficient_evidence", "config before/after missing"))
            continue
        if not any(OOM_RE.search(str(line)) for line in lines):
            refused.append(_refuse(rid, "not_applicable", "no GPU OOM signature in the engine log"))
            continue
        changed = [k for k in MEMORY_KEYS if before.get(k) != after.get(k)]
        if len(changed) != 1:
            refused.append(_refuse(rid, "requires_review",
                                   f"OOM with {len(changed)} memory-relevant config changes; a person must decide"))
            continue
        key = changed[0]
        deploy = (src.get("deploy") or {}).get("id")
        proposals.append({"record_id": rid, "field": key, "value": before[key], "action_type": "revert_config",
                          "reason": f"class=serving_config_regression;key={key};from={after[key]};"
                                    f"to={before[key]};deploy={deploy}"})
    return {"proposals": proposals, "refused": refused}
