"""Reproducible failing check for the SYNTHETIC serving incidents (trusted code; never shown to the model).

Synthetic capacity model of one GB10-class GPU (numbers are illustrative, not measured):
  peak_gib = 28 (weights + runtime) + max_num_seqs * max_model_len * 4e-6 (KV/activations at full batch)
  limit    = 119.6 GiB * gpu_memory_utilization, and gpu_memory_utilization <= 0.92 (non-torch headroom)
plus a disk check on the latest metrics sample (cache volume needs >= 5 GB free).
"""
GPU_GIB, BASE_GIB, PER_TOKEN_GIB, MAX_UTIL, MIN_DISK_GB = 119.6, 28.0, 4e-6, 0.92, 5


def capacity(cfg):
    peak = BASE_GIB + cfg["max_num_seqs"] * cfg["max_model_len"] * PER_TOKEN_GIB
    limit = GPU_GIB * cfg["gpu_memory_utilization"]
    ok = peak <= limit and cfg["gpu_memory_utilization"] <= MAX_UTIL
    return {"ok": ok, "peak_gib": round(peak, 1), "limit_gib": round(limit, 1)}


def disk(series):
    free = series[-1]["disk_free_gb"] if series else None
    return {"ok": free is not None and free >= MIN_DISK_GB, "disk_free_gb": free}


def check(scenario, rid, override=None):
    """Run both checks on one incident's evidence. override={key: value} applies a proposed (never real) revert."""
    ev = {e["source"]: e["data"] for e in scenario["evidence"] if e["record_id"] == rid}
    cfg = {**ev["config_after"]["config"], **(override or {})}
    cap, dsk = capacity(cfg), disk(ev["metrics"]["series"])
    return {"ok": cap["ok"] and dsk["ok"], "capacity": cap, "disk": dsk}


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path
    for f in sys.argv[1:] or sorted(str(p) for p in Path(__file__).parent.glob("inc*.json")):
        s = json.loads(Path(f).read_text(encoding="utf-8"))
        for r in s["records"]:
            print(Path(f).name, r["id"], json.dumps(check(s, r["id"])))
