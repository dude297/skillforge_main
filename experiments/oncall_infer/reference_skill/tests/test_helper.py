from helper import run

CFG = {"max_num_seqs": 128, "max_model_len": 32768, "gpu_memory_utilization": 0.85, "image_tag": "a"}


def ds(after, lines):
    ev = {"config_before": {"config": CFG}, "config_after": {"config": {**CFG, **after}},
          "log": {"lines": lines}, "deploy": {"id": "d-1"}}
    return {"records": [{"id": "I", "kind": "inference_incident", "data": {}}],
            "evidence": [{"record_id": "I", "source": k, "trusted": True, "data": v} for k, v in ev.items()]}


def test_reverts_single_memory_key():
    out = run(ds({"max_num_seqs": 1024}, ["torch.OutOfMemoryError: CUDA out of memory"]))
    assert [(p["field"], p["value"]) for p in out["proposals"]] == [("max_num_seqs", 128)]


def test_no_oom_is_not_applicable():
    out = run(ds({"max_num_seqs": 1024}, ["OSError: [Errno 28] No space left on device"]))
    assert out["proposals"] == [] and out["refused"][0]["code"] == "not_applicable"


def test_oom_without_key_change_needs_review():
    out = run(ds({"image_tag": "b"}, ["CUDA out of memory"]))
    assert out["proposals"] == [] and out["refused"][0]["code"] == "requires_review"


def test_untrusted_evidence_ignored():
    d = ds({"max_num_seqs": 1024}, ["CUDA out of memory"])
    for e in d["evidence"]:
        e["trusted"] = False
    assert run(d)["proposals"] == []
