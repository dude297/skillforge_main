"""Offline: frontier_report on synthetic `fixture-not-gb10*` dirs, and frontier.sh against a local stub server.
Plumbing only. Nothing here is a GB10 measurement."""
import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from experiments.gb10_bench import frontier_report as fr

REPO = Path(__file__).resolve().parents[2]


def _w(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(obj if isinstance(obj, str) else json.dumps(obj), encoding="utf-8")


def _ttft(first, decode):
    return {"trials": [{"first_token_s": f, "decode_tok_s": d, "error": None} for f, d in zip(first, decode)]
            + [{"first_token_s": None, "decode_tok_s": None, "error": "URLError: x"}]}


def test_report_keeps_nulls_and_invents_no_rows(tmp_path):
    root = tmp_path / "frontier"
    _w(root / "fixture-not-gb10-empty" / "identity.json", {"at": "2026-01-01T00:00:00+00:00", "host": {"hostname": "devbox"},
                                                            "gpu": {"name": None}, "server": {"model_id": None}})
    full = root / "fixture-not-gb10-full"
    _w(full / "identity.json", {"at": "2026-01-01T00:00:00+00:00", "host": {"hostname": "devbox", "machine": "x86_64"},
                                "gpu": {"name": None}, "server": {"model_id": "fixture-model", "max_model_len": 4096},
                                "model": {"revision": None, "quantization": None}, "container": {}})
    _w(full / "probe.json", {"passed": False, "missing": ["identity"], "checks": {"endpoint": {"ok": True}, "identity": {"ok": False}}})
    _w(full / "ttft-c1-1.json", _ttft([0.1, 0.2, 0.3], [50.0, 40.0, None]))
    _w(full / "ttft-c2-1.json", _ttft([0.4], [30.0]))
    _w(full / "ttft-c2-2.json", _ttft([0.6], [20.0]))
    _w(full / "samples.csv", "ts,temp_c,power_w,util_pct,mem_used_mib,mem_available_kib\n1,,,,,\n2,61,,,,33554432\n")
    _w(full / "stages.tsv", "ttft-c2\taborted_temp temp=90\tT\n")
    _w(full / "oncall-run.json", {"mode": "LIVE_REAL_MODEL",
                                  "verification": {"regression": [{"name": "INC-1 replay: revert", "pass": True}],
                                                   "hidden": [{"name": "a", "pass": True}, {"name": "b", "pass": False}]},
                                  "synthesis": {"model_calls": 2, "latency_ms": 9000.0},
                                  "reuse": {"state": "done", "model_calls": 0, "latency_ms": 12.5,
                                            "diagnosis": {**fr.EXPECTED["INC-2"]}},
                                  "refusal": {"state": "refused"}, "approval": {"state": "approved", "kind": "host_cli"}})
    sim = root / "fixture-not-gb10-sim"
    _w(sim / "oncall-run.json", {"mode": "RECORDED_SIMULATION", "synthesis": {"model_calls": None},
                                 "verification": {"hidden": [{"name": "a", "pass": True}]}, "reuse": {"state": "done", "model_calls": 0}})

    rows = fr.report(root)["rows"]
    assert [(r["label"], r["concurrency"]) for r in rows] == [
        ("fixture-not-gb10-empty", None), ("fixture-not-gb10-full", 1), ("fixture-not-gb10-full", 2), ("fixture-not-gb10-sim", None)]
    empty, c1, c2, s = rows
    for k in ("model", "revision", "quantization", "context_length", "ttft_p50_s", "decode_tok_s_p50", "tool_call", "samples"):
        assert empty[k] is None, k
    assert all(v is None for k, v in empty["oncall"].items() if k != "note")
    assert c1["ttft_p50_s"] == 0.2 and c1["decode_tok_s_p50"] == 45.0 and c1["errors"] == 1 and c1["requests"] == 4
    assert c2["requests"] == 4 and c2["errors"] == 2
    assert c1["revision"] is None and c1["quantization"] is None and c1["hardware"]["gpu"] is None
    assert c1["samples"] == {"n": 1, "peak_temp_c": 61.0, "peak_power_w": None, "peak_gpu_mem_used_mib": None,
                             "min_mem_available_gib": 32.0}
    assert c1["tool_call"] == {"passed": False, "checks_ok": 1, "checks_total": 2, "missing": ["identity"]}
    o = c1["oncall"]
    assert (o["diagnosis_correct_inc1"], o["diagnosis_correct_inc2_reuse"], o["lookalike_refused"]) == (True, True, True)
    assert (o["hidden_passed"], o["hidden_total"], o["model_calls_first"], o["model_calls_reuse"]) == (1, 2, 2, 0)
    assert all(v is None for k, v in s["oncall"].items() if k not in ("mode", "note"))  # simulation is never credited
    md = (root / "frontier.md").read_text(encoding="utf-8")
    assert md.count("| fixture-not-gb10-") == 4 and "not measured" in md and "aborted_temp" in md
    assert "measured on devbox at 2026-01-01" in md
    on_disk = json.loads((root / "frontier.json").read_text(encoding="utf-8"))
    assert on_disk["rows"][0]["model"] is None  # null in JSON, not 0 / "" / "not measured"


def test_redact_hides_keys():
    assert fr.redact(["vllm", "serve", "m", "--api-key", "sk-1", "--hf-token=x", "--max-num-seqs", "4"]) == \
        ["vllm", "serve", "m", "--api-key", "<redacted>", "--hf-token=<redacted>", "--max-num-seqs", "4"]


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.endswith("/models"):
            return self._json(200, {"data": [{"id": "stub-not-a-model", "max_model_len": 4096}]})
        self._json(404, {})

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if not req.get("stream"):  # probe / oncall: plain text, no tool call, no skill JSON
            return self._json(200, {"choices": [{"message": {"role": "assistant", "content": "stub"}}],
                                    "usage": {"prompt_tokens": 3, "completion_tokens": 1}})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for d in ({"content": "1"}, {"content": " 2"}):
            self.wfile.write(f"data: {json.dumps({'choices': [{'delta': d}]})}\n\n".encode())
        self.wfile.write(f"data: {json.dumps({'choices': [], 'usage': {'prompt_tokens': 3, 'completion_tokens': 2}})}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


def _bash():
    git = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin" / "bash.exe"
    return str(git) if os.name == "nt" and git.exists() else shutil.which("bash") if os.name != "nt" else None


@pytest.mark.skipif(_bash() is None, reason="no POSIX bash")
def test_frontier_sh_against_stub(tmp_path):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    root = tmp_path / "frontier"
    env = {**os.environ, "LLM_BASE_URL": f"http://127.0.0.1:{srv.server_port}/v1", "LLM_API_KEY": "stub",
           "FRONTIER_ROOT": root.as_posix(), "PYTHON": Path(sys.executable).as_posix(),
           "FRONTIER_ALLOW_UNKNOWN_SENSORS": "1", "FRONTIER_STAGES": "probe,ttft"}
    try:
        r = subprocess.run([_bash(), "experiments/gb10_bench/frontier.sh", "fixture-not-gb10-stub", "--concurrency", "1,2"],
                           cwd=REPO, env=env, capture_output=True, text=True, timeout=300)
        bad = subprocess.run([_bash(), "experiments/gb10_bench/frontier.sh", "x", "--concurrency", "8"],
                             cwd=REPO, env=env, capture_output=True, text=True, timeout=60)
    finally:
        srv.shutdown()
    assert bad.returncode == 2  # concurrency capped at 4
    d = root / "fixture-not-gb10-stub"
    assert r.returncode == 0, r.stdout + r.stderr
    stages = (d / "stages.tsv").read_text()
    assert "override_unknown_sensors" in stages and "ttft-c2\tok" in stages
    assert sorted(p.name for p in d.glob("ttft-c*.json")) == ["ttft-c1-1.json", "ttft-c2-1.json", "ttft-c2-2.json"]
    rows = fr.report(root)["rows"]
    assert [x["concurrency"] for x in rows] == [1, 2]
    assert rows[0]["model"] == "stub-not-a-model" and rows[0]["tool_call"]["passed"] is False
    assert rows[0]["hardware"]["gpu"] is None and rows[0]["runtime"]["vllm_version"] is None
    assert rows[1]["requests"] == 20 and rows[1]["errors"] == 0
