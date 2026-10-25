"""HIDDEN independent validation for the SYNTHETIC serving-config-regression family. Human/agent-written, never put
in a model prompt, never copied into a skill dir. Loaded by core `skillforge.hidden_check` via HIDDEN_DIR.
Expectations are written by hand below; none of them are the INC-1/INC-2/INC-3 fixtures."""

SCENARIOS = ["oncall-infer-inc1"]
BASE = {"model": "m", "image_tag": "vllm-0.11.2", "max_num_seqs": 128, "max_model_len": 32768,
        "gpu_memory_utilization": 0.85, "tensor_parallel_size": 1}
OOM = "ERROR engine: torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 1.00 GiB"
ENOSPC = "ERROR engine: OSError: [Errno 28] No space left on device: '/var/lib/vllm/cache/x.bin'"
FILLER = "WARN  gateway: upstream unavailable, shedding load: HTTP 429 Too Many Requests"


def incident(rid, after=None, log=(OOM,), drop=()):
    ev = {"log": {"name": "x.log", "lines": [FILLER, *log]},
          "metrics": {"name": "m.json", "series": [{"t": "t0", "p99_ms": 900, "http_429_pct": 0.0,
                                                     "gpu_mem_used_pct": 70.0, "disk_free_gb": 100}]},
          "config_before": {"name": "before", "config": dict(BASE)},
          "config_after": {"name": "after", "config": {**BASE, **(after or {})}},
          "deploy": {"name": "d.json", "id": f"d-{rid}", "at": "t0", "author": "x", "description": "x"}}
    rec = {"id": rid, "kind": "inference_incident", "data": {"title": "t", "service": "s", "severity": "SEV3",
                                                             "opened_at": "t0", "summary": "s"}}
    return rec, [{"record_id": rid, "source": k, "trusted": True, "data": v} for k, v in ev.items() if k not in drop]


def ds(*incs):
    return {"records": [r for r, _ in incs], "evidence": [e for _, es in incs for e in es]}


def cases():
    return [
        {"name": "num_seqs_raised_oom", "dataset": ds(incident("H-1", {"max_num_seqs": 2048})),
         "expect": {"proposals": [("H-1", "max_num_seqs", 128)], "escalate": []}},
        {"name": "gpu_util_raised_oom", "dataset": ds(incident("H-2", {"gpu_memory_utilization": 0.97})),
         "expect": {"proposals": [("H-2", "gpu_memory_utilization", 0.85)], "escalate": []}},
        {"name": "context_raised_oom", "dataset": ds(incident("H-3", {"max_model_len": 262144})),
         "expect": {"proposals": [("H-3", "max_model_len", 32768)], "escalate": []}},
        {"name": "oom_without_memory_key_change_escalates", "dataset": ds(incident("H-4", {"image_tag": "vllm-0.12.0"})),
         "expect": {"proposals": [], "escalate": ["H-4"]}},
        {"name": "two_memory_keys_changed_escalates",
         "dataset": ds(incident("H-5", {"max_num_seqs": 512, "max_model_len": 65536})),
         "expect": {"proposals": [], "escalate": ["H-5"]}},
        {"name": "disk_full_lookalike_not_applicable",
         "dataset": ds(incident("H-6", {"image_tag": "vllm-0.12.0"}, log=(ENOSPC,))),
         "expect": {"proposals": [], "escalate": []}},
        {"name": "key_changed_but_no_oom_not_applicable",
         "dataset": ds(incident("H-7", {"max_num_seqs": 256}, log=(ENOSPC,))),
         "expect": {"proposals": [], "escalate": []}},
        {"name": "mixed_batch_one_fix", "dataset": ds(incident("H-8", {"max_num_seqs": 1024}),
                                                       incident("H-9", {"image_tag": "x"}, log=(ENOSPC,))),
         "expect": {"proposals": [("H-8", "max_num_seqs", 128)], "escalate": []}},
        {"name": "missing_config_after_never_proposes",
         "dataset": ds(incident("H-10", {"max_num_seqs": 999}, drop=("config_after",))),
         "expect": {"no_proposals_for": ["H-10"], "error_ok": True}},
    ]
