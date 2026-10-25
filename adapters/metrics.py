"""Inference metrics from vLLM's Prometheus endpoint. Unknown values stay None, never 0.

LLM_METRICS_URL  e.g. http://127.0.0.1:8000/metrics (host side; vLLM serves /metrics without the API key)
Names per docs.vllm.ai/en/stable/usage/metrics.html (vLLM V1). Missing names -> None for that field.
"""
import os
import shutil
import subprocess
import urllib.request

COUNTERS = {
    "requests": "vllm:request_success_total",
    "prompt_tokens": "vllm:prompt_tokens_total",
    "generation_tokens": "vllm:generation_tokens_total",
    "ttft_sum_s": "vllm:time_to_first_token_seconds_sum",
    "ttft_count": "vllm:time_to_first_token_seconds_count",
    "e2e_sum_s": "vllm:e2e_request_latency_seconds_sum",
    "e2e_count": "vllm:e2e_request_latency_seconds_count",
}
GAUGES = {"kv_cache_usage": "vllm:kv_cache_usage_perc"}


def parse(text):
    """Sum every label series of each known metric. Absent metric -> None."""
    out = {}
    for key, name in {**COUNTERS, **GAUGES}.items():
        vals = [float(line.rsplit(" ", 1)[1]) for line in text.splitlines()
                if line.startswith(name) and line[len(name):len(name) + 1] in ("{", " ")]
        out[key] = sum(vals) if vals else None
    return out


def snapshot(url=None):
    url = url or os.environ.get("LLM_METRICS_URL")
    if not url:
        return None
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return parse(r.read().decode())
    except Exception:
        return None


def delta(start, end):
    """Per-task inference usage between two snapshots. Derived means only when their count moved."""
    if not start or not end:
        return {k: None for k in ("requests", "prompt_tokens", "generation_tokens", "mean_ttft_s",
                                  "inference_s", "mean_request_s", "kv_cache_usage_end")}
    d = {k: (end[k] - start[k]) if end.get(k) is not None and start.get(k) is not None else None for k in COUNTERS}
    mean = lambda s, c: round(d[s] / d[c], 4) if d[s] is not None and d[c] else None
    return {"requests": int(d["requests"]) if d["requests"] is not None else None,
            "prompt_tokens": int(d["prompt_tokens"]) if d["prompt_tokens"] is not None else None,
            "generation_tokens": int(d["generation_tokens"]) if d["generation_tokens"] is not None else None,
            "mean_ttft_s": mean("ttft_sum_s", "ttft_count"),
            "inference_s": round(d["e2e_sum_s"], 4) if d["e2e_sum_s"] is not None else None,
            "mean_request_s": mean("e2e_sum_s", "e2e_count"),
            "kv_cache_usage_end": end.get("kv_cache_usage")}


def gpu_memory_used_mib():
    """nvidia-smi memory.used; None when unavailable (no GPU here, or GB10 unified memory reports N/A)."""
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=5).stdout.strip().splitlines()
        return sum(float(x) for x in out) if out else None
    except (ValueError, subprocess.SubprocessError, OSError):
        return None
