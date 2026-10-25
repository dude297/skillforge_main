"""Offline tests for evidence_report.py on SYNTHETIC fixtures (experiments/gb10_bench/fixtures/synthetic_*).
The fixtures carry invented numbers and a `_synthetic` marker: the report must reject them. The accept path is exercised
on a copy in tmp_path with the marker stripped. Nothing here is a GB10 measurement."""
import json
import shutil
from pathlib import Path

import pytest

from experiments.gb10_bench import evidence_report as er

FIX = Path(__file__).parent / "fixtures"


def _unmarked(name, tmp_path):
    """copy of a synthetic fixture with the markers stripped, to test the formatting path of a 'genuine' run."""
    dst = tmp_path / "run-a"
    shutil.copytree(FIX / name, dst)
    for p in dst.rglob("*.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        d.pop("_synthetic", None)
        d.pop("_note", None)
        if "label" in d:
            d["label"] = "GB10 test"
        p.write_text(json.dumps(d), encoding="utf-8")
    return dst


@pytest.mark.parametrize("name", ["synthetic_gb10_full", "synthetic_gb10_sparse", "synthetic_mock_sim"])
def test_synthetic_fixture_is_rejected(name):
    with pytest.raises(er.Rejected):
        er.build([FIX / name])
    assert er.main([str(FIX / name)]) == 2


def test_allow_mock_labels_loudly():
    text = er.build([FIX / "synthetic_gb10_full"], allow_mock=True)
    assert "MOCK REPORT" in text and "NOT GB10 EVIDENCE" in text
    assert text.count("(MOCK)") >= 6  # every section heading carries it


def test_recorded_simulation_is_rejected_even_when_unmarked(tmp_path):
    d = _unmarked("synthetic_mock_sim", tmp_path)
    with pytest.raises(er.Rejected, match="RECORDED_SIMULATION"):
        er.build([d])


def test_non_gb10_hardware_is_rejected(tmp_path):
    d = _unmarked("synthetic_gb10_full", tmp_path)
    ident = json.loads((d / "identity.json").read_text())
    ident["gpu"]["name"] = "NVIDIA RTX 4090"
    (d / "identity.json").write_text(json.dumps(ident))
    with pytest.raises(er.Rejected, match="GB10"):
        er.build([d])


def test_genuine_shaped_run_renders_numbers_with_provenance(tmp_path):
    t = er.build([_unmarked("synthetic_gb10_full", tmp_path)])
    assert "MOCK" not in t
    assert "| first-time (LLM) | model calls (chat requests) | 2 |" in t
    assert "100.0 / 110.0 (n=4)" in t  # warm reuse p50/p95 over trials 2..5
    assert "| reuse (no LLM) | latency ms, first trial (cold: new process, first sandbox start) | 300.0 |" in t
    assert "**90.0x**" in t
    assert "| derived peak system used GiB" in t and "70.0" in t
    assert "sha256:" in t and "`identity.json#server.model_id`" in t
    assert "3 / 10 (30.0%)" in t


def test_missing_metrics_render_not_measured_never_zero(tmp_path):
    t = er.build([_unmarked("synthetic_gb10_sparse", tmp_path)])
    rows = {l.split("|")[2].strip(): l.split("|")[3].strip() for l in t.splitlines() if l.startswith("| ") and l.count("|") >= 5}
    assert rows["prompt / completion tokens (null if server sent no usage)"] == er.NM
    assert rows["latency ms, first trial (cold: new process, first sandbox start)"] == er.NM
    assert rows["model calls"] == er.NM  # reuse never ran: the guard's 0 is not claimed
    assert "Ratio: not computed" in t
    assert "| not measured | not measured | not measured | not measured | not measured |" in t  # no ttft files
    assert "| samples (1 s each) | not measured |" in t


def test_model_id_mismatch_is_flagged(tmp_path):
    d = _unmarked("synthetic_gb10_full", tmp_path)
    o = json.loads((d / "oncall-run.json").read_text())
    o["model"]["id"] = "some-other-model"
    (d / "oncall-run.json").write_text(json.dumps(o))
    assert "MISMATCH" in er.build([d])


def test_reuse_with_model_call_is_counted_as_failure_not_latency(tmp_path):
    d = _unmarked("synthetic_gb10_full", tmp_path)
    p = d / "reuse-trials" / "reuse-3.json"
    j = json.loads(p.read_text())
    j["reuse"]["model_calls"] = 1
    p.write_text(json.dumps(j))
    t = er.build([d])
    assert "trials failing the contract (refused, or model_calls != 0) | 1 |" in t


def test_sf_gb10_dir_without_identity_is_accepted_with_derived_label(tmp_path):
    d = _unmarked("synthetic_sfgb10_oncall", tmp_path)
    assert not (d / "identity.json").exists()
    t = er.build([d])
    assert "MOCK" not in t and er.DERIVED in t
    assert "| GPU | not measured |" in t and "synthetic-model-35b" in t and "`console.txt`" in t
    assert "| gpu.csv peak utilization.gpu / temperature.gpu C / power.draw W | 90.0 / 60.0 / 40.0 |" in t


def test_sf_gb10_x86_is_rejected(tmp_path):
    d = _unmarked("synthetic_sfgb10_oncall", tmp_path)
    c = d / "console.txt"
    c.write_text(c.read_text().replace("arch=aarch64", "arch=x86_64"), encoding="utf-8")
    with pytest.raises(er.Rejected, match="aarch64"):
        er.build([d])


def test_sf_gb10_mock_mode_is_rejected(tmp_path):
    d = _unmarked("synthetic_sfgb10_oncall", tmp_path)
    o = json.loads((d / "oncall-run.json").read_text())
    o["mode"] = "RECORDED_SIMULATION"
    (d / "oncall-run.json").write_text(json.dumps(o))
    with pytest.raises(er.Rejected, match="RECORDED_SIMULATION"):
        er.build([d])


def test_sf_gb10_fixture_as_shipped_is_rejected():
    with pytest.raises(er.Rejected):
        er.build([FIX / "synthetic_sfgb10_oncall"])
