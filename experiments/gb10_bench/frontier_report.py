"""EXPERIMENT: GB10 compute-frontier helpers for experiments/gb10_bench/frontier.sh. Stdlib only, never imported by core.

  python -m experiments.gb10_bench.frontier_report identity --base-url URL --out DIR/identity.json
  python -m experiments.gb10_bench.frontier_report probe    --out DIR/probe.json   # LLM_BASE_URL/LLM_API_KEY from env
  python -m experiments.gb10_bench.frontier_report report   [--root results/frontier]  # -> frontier.md + frontier.json

Every value is read from a file frontier.sh wrote on the host it ran on, or it is null ("not measured").
Nothing is estimated, defaulted to 0, or copied from a vendor spec. Runs against a stub server are plumbing only.
"""
import argparse
import csv
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from experiments.gb10_bench.ttft import summarise

NM = "not measured"
# Hand-written from experiments/oncall_infer/fixtures/*.json (config_before/config_after + deploy id). Not model output.
EXPECTED = {"INC-2": {"offending_key": "max_model_len", "deployed_value": 131072, "baseline_value": 16384,
                      "deploy": "d-5203", "root_cause_class": "serving_config_regression"}}
LABEL = "com.nvidia.nemoclaw.managed-vllm=true"
_SECRET = re.compile(r"key|token|secret|passw", re.I)


def _sh(cmd, timeout=20):
    """stdout of a read-only command, or None (missing tool, error, timeout)."""
    if not shutil.which(cmd[0]):
        return None
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else None
    except (subprocess.SubprocessError, OSError):
        return None


def _val(x):
    """nvidia-smi field -> str, or None for [N/A] / Not Supported / empty."""
    x = (x or "").strip()
    return None if not x or x.startswith("[") or "Not Supported" in x or x == "N/A" else x


def _get(url, key=None, timeout=10):
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"} if key else {})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception:
        return None


def redact(args):
    """Serve args with secret values replaced; never record an API key."""
    out, hide = [], False
    for a in args or []:
        if hide:
            out.append("<redacted>")
            hide = False
            continue
        if a.startswith("--") and _SECRET.search(a):
            if "=" in a:
                out.append(a.split("=", 1)[0] + "=<redacted>")
            else:
                out.append(a)
                hide = True
            continue
        out.append(a)
    return out


def _flag(args, name):
    for i, a in enumerate(args):
        if a == name and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return None


def _hf_cache(model, mounts):
    """(revision, quantization) from a local HF cache, if one is found; else (None, None). Reads only."""
    if not model or "/" not in model:
        return None, None
    repo = "models--" + model.replace("/", "--")
    roots = [Path(m) for m in mounts] + [Path.home() / ".cache" / "huggingface"]
    for r in roots:
        for d in (r / "hub" / repo, r / repo):
            ref = d / "refs" / "main"
            try:
                rev = ref.read_text().strip() if ref.is_file() else None
            except OSError:
                rev = None
            if not rev:
                continue
            q = None
            try:
                cfg = json.loads((d / "snapshots" / rev / "config.json").read_text())
                qc = cfg.get("quantization_config") or {}
                q = qc.get("quant_method") or qc.get("quant_algo")
            except (OSError, ValueError):
                pass
            return rev, q
    return None, None


def identity(base_url, api_key=None):
    host = {"hostname": socket.gethostname(), "machine": platform.machine(), "mem_total_kib": None}
    try:
        host["mem_total_kib"] = int(next(l.split()[1] for l in open("/proc/meminfo") if l.startswith("MemTotal:")))
    except (OSError, StopIteration, ValueError):
        pass
    q = _sh(["nvidia-smi", "--query-gpu=name,driver_version,compute_cap", "--format=csv,noheader"])
    f = [x for x in (q.splitlines()[0].split(",") if q else [])]
    gpu = {"name": _val(f[0]) if f else None, "driver": _val(f[1]) if len(f) > 1 else None,
           "compute_cap": _val(f[2]) if len(f) > 2 else None}
    models = _get(base_url.rstrip("/") + "/models", api_key) or {}
    m0 = (models.get("data") or [{}])[0]
    server = {"model_id": m0.get("id"), "max_model_len": m0.get("max_model_len"),
              "vllm_version": (_get(base_url.rstrip("/").removesuffix("/v1") + "/version") or {}).get("version")}
    ctr = {"id": None, "image": None, "image_id": None, "serve_args": None, "env": None}
    cid = (_sh(["docker", "ps", "-q", "--filter", f"label={LABEL}"]) or "").split()
    mounts, args = [], []
    if cid:
        info = json.loads(_sh(["docker", "inspect", cid[0]]) or "[{}]")[0]
        cfg = info.get("Config") or {}
        args = (cfg.get("Entrypoint") or []) + (cfg.get("Cmd") or []) if not info.get("Args") else \
            [info.get("Path")] + info.get("Args")
        env = dict(e.split("=", 1) for e in cfg.get("Env") or [] if "=" in e)
        ctr = {"id": cid[0], "image": cfg.get("Image"), "image_id": info.get("Image"), "serve_args": redact(args),
               "env": {k: v for k, v in env.items() if re.search(r"REVISION|VLLM_VERSION|^MODEL", k) and not _SECRET.search(k)},
               "image_version_label": (cfg.get("Labels") or {}).get("org.opencontainers.image.version")}
        mounts = [m.get("Source") for m in info.get("Mounts") or [] if m.get("Source")]
    model_arg = _flag(args, "--model") or next((args[i + 1] for i, a in enumerate(args[:-1]) if a == "serve"), None)
    rev = _flag(args, "--revision") or (ctr["env"] or {}).get("MODEL_REVISION") or (ctr["env"] or {}).get("HF_REVISION")
    cache_rev, cache_q = _hf_cache(model_arg or server["model_id"], mounts)
    model = {"served_id": server["model_id"], "weights": model_arg,
             "revision": rev or cache_rev, "revision_source": "serve args/env" if rev else ("hf cache refs/main" if cache_rev else None),
             "quantization": _flag(args, "--quantization") or cache_q,
             "quantization_source": "serve args" if _flag(args, "--quantization") else ("hf config.json" if cache_q else None),
             "gpu_memory_utilization": _flag(args, "--gpu-memory-utilization"), "max_num_seqs": _flag(args, "--max-num-seqs")}
    inf = _sh(["nemoclaw", "inference", "get", "--json"])
    return {"schema": "skillforge.frontier_identity/1", "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "base_url": base_url, "host": host, "gpu": gpu, "server": server, "container": ctr, "model": model,
            "nemoclaw_inference": json.loads(inf) if inf and inf.startswith("{") else inf}


def probe():
    """Core capability probe (same checks as `python -m app models probe`) WITHOUT models.save(): the demo's
    data/model_probe.json gate record is not overwritten by a benchmark run."""
    from adapters import llm as llm_mod, models
    return models.probe(llm_mod.from_env())


# ---- report ----------------------------------------------------------------------------------------------------
def _load(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _num(x):
    try:
        return float(x) if str(x).strip() != "" else None
    except ValueError:
        return None


def samples(path):
    """Peaks from samples.csv; a column with no numeric value stays None."""
    cols = {"temp_c": [], "power_w": [], "util_pct": [], "mem_used_mib": [], "mem_available_kib": []}
    try:
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                for k in cols:
                    v = _num(row.get(k))
                    if v is not None:
                        cols[k].append(v)
    except OSError:
        return None
    mx = lambda k: max(cols[k]) if cols[k] else None
    return {"n": len(cols["temp_c"]) or None, "peak_temp_c": mx("temp_c"), "peak_power_w": mx("power_w"),
            "peak_gpu_mem_used_mib": mx("mem_used_mib"),
            "min_mem_available_gib": round(min(cols["mem_available_kib"]) / 2**20, 2) if cols["mem_available_kib"] else None}


def stages(path):
    out = {}
    try:
        for line in Path(path).read_text().splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                out[parts[0]] = parts[1]
    except OSError:
        pass
    return out


def ttft_by_c(d):
    """{concurrency: merged stats} from ttft-c<C>-<i>.json; per-request numbers, not aggregate throughput."""
    groups = {}
    for p in sorted(d.glob("ttft-c*-*.json")):
        m = re.match(r"ttft-c(\d+)-\d+\.json$", p.name)
        j = _load(p)
        if m and j:
            groups.setdefault(int(m.group(1)), []).append(j)
    out = {}
    for c, runs in groups.items():
        trials = [t for r in runs for t in r.get("trials", [])]
        ok = [t for t in trials if not t.get("error")]
        out[c] = {"copies": len(runs), "requests": len(trials), "errors": len(trials) - len(ok),
                  "ttft": summarise([t.get("first_token_s") for t in ok]),
                  "decode": summarise([t.get("decode_tok_s") for t in ok])}
    return out


def oncall(d):
    doc = _load(d / "oncall-run.json")
    blank = {"mode": None, "diagnosis_correct_inc1": None, "diagnosis_correct_inc2_reuse": None, "lookalike_refused": None,
             "hidden_passed": None, "hidden_total": None, "e2e_latency_ms": None, "model_calls_first": None,
             "model_calls_reuse": None, "reuse_latency_ms": None, "note": "no oncall-run.json"}
    if not doc:
        return blank
    if doc.get("mode") != "LIVE_REAL_MODEL":  # a hand-written reference skill is not this model's result
        return {**blank, "mode": doc.get("mode"), "note": "RECORDED_SIMULATION: model did not write the skill; not credited"}
    ver = doc.get("verification") or {}
    reg = {x["name"]: x["pass"] for x in ver.get("regression", [])}
    hid = ver.get("hidden") or []
    syn, reu = doc.get("synthesis") or {}, doc.get("reuse") or {}
    inc1 = next((v for k, v in reg.items() if k.startswith("INC-1 replay")), None)
    dx = reu.get("diagnosis")
    inc2 = None if reu.get("state") in (None, "not_run") else \
        bool(dx) and all(dx.get(k) == v for k, v in EXPECTED["INC-2"].items())
    done = reu.get("state") == "done"
    ref = (doc.get("refusal") or {}).get("state")
    return {"mode": doc["mode"], "diagnosis_correct_inc1": inc1, "diagnosis_correct_inc2_reuse": inc2,
            "lookalike_refused": None if ref in (None, "not_run") else ref == "refused",
            "hidden_passed": sum(1 for x in hid if x["pass"]) if hid else None, "hidden_total": len(hid) or None,
            "e2e_latency_ms": syn.get("latency_ms"), "model_calls_first": syn.get("model_calls"),
            "model_calls_reuse": reu.get("model_calls") if done else None,
            "reuse_latency_ms": reu.get("latency_ms") if done else None,
            "approval": (doc.get("approval") or {}).get("state"), "approval_kind": (doc.get("approval") or {}).get("kind"),
            "note": None if done else f"reuse {reu.get('state')}: {reu.get('reason')}"}


def rows_for(d):
    ident = _load(d / "identity.json") or {}
    pr = _load(d / "probe.json")
    checks = (pr or {}).get("checks") or {}
    tool = None if pr is None else {"passed": pr.get("passed"), "checks_ok": sum(1 for c in checks.values() if c.get("ok")),
                                    "checks_total": len(checks), "missing": pr.get("missing")}
    g, m, s, c = ident.get("gpu") or {}, ident.get("model") or {}, ident.get("server") or {}, ident.get("container") or {}
    base = {"label": d.name, "host": (ident.get("host") or {}).get("hostname"), "measured_at": ident.get("at"),
            "model": s.get("model_id"), "revision": m.get("revision"), "quantization": m.get("quantization"),
            "runtime": {"vllm_version": s.get("vllm_version"), "image": c.get("image")},
            "hardware": {"gpu": g.get("name"), "driver": g.get("driver"), "compute_cap": g.get("compute_cap"),
                         "machine": (ident.get("host") or {}).get("machine")},
            "context_length": s.get("max_model_len"), "samples": samples(d / "samples.csv"), "stages": stages(d / "stages.tsv"),
            "tool_call": tool, "oncall": oncall(d)}
    by_c = ttft_by_c(d)
    if not by_c:
        return [{**base, "concurrency": None, "ttft_p50_s": None, "ttft_p95_s": None, "decode_tok_s_p50": None,
                 "requests": None, "errors": None}]
    return [{**base, "concurrency": cc, "ttft_p50_s": (v["ttft"] or {}).get("p50"), "ttft_p95_s": (v["ttft"] or {}).get("p95"),
             "decode_tok_s_p50": (v["decode"] or {}).get("p50"), "requests": v["requests"], "errors": v["errors"]}
            for cc, v in sorted(by_c.items())]


def _f(x):
    if x is None:
        return NM
    if isinstance(x, bool):
        return "yes" if x else "no"
    return str(x)


def markdown(rows):
    cols = ["label", "model", "revision", "quantization", "runtime", "hardware", "context", "concurrency", "TTFT p50/p95 s",
            "decode tok/s p50", "peak GPU mem MiB", "min MemAvailable GiB", "peak temp C", "tool-call probe",
            "OnCall INC-1 replay", "OnCall INC-2 reuse dx", "hidden", "e2e ms", "model calls first / reuse", "reuse ms"]
    out = ["# GB10 compute frontier", "",
           "Generated by `frontier_report.py` from `results/frontier/*/`. `not measured` = no file or no value: never 0, never"
           " estimated. Rows whose label is not a real GB10 run are plumbing only.", "",
           "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        sm, oc, t = r["samples"] or {}, r["oncall"], r["tool_call"]
        hw = r["hardware"]
        cells = [r["label"], r["model"], r["revision"], r["quantization"],
                 " ".join(x for x in (r["runtime"]["vllm_version"], r["runtime"]["image"]) if x) or None,
                 " / ".join(x for x in (hw["gpu"], hw["machine"]) if x) or None, r["context_length"], r["concurrency"],
                 None if r["ttft_p50_s"] is None else f"{r['ttft_p50_s']} / {_f(r['ttft_p95_s'])}", r["decode_tok_s_p50"],
                 sm.get("peak_gpu_mem_used_mib"), sm.get("min_mem_available_gib"), sm.get("peak_temp_c"),
                 None if t is None else f"{'pass' if t['passed'] else 'fail'} ({t['checks_ok']}/{t['checks_total']})",
                 oc["diagnosis_correct_inc1"], oc["diagnosis_correct_inc2_reuse"],
                 None if oc["hidden_total"] is None else f"{oc['hidden_passed']}/{oc['hidden_total']}", oc["e2e_latency_ms"],
                 None if oc["model_calls_first"] is None else f"{oc['model_calls_first']} / {_f(oc['model_calls_reuse'])}",
                 oc["reuse_latency_ms"]]
        out.append("| " + " | ".join(_f(c).replace("|", "/") for c in cells) + " |")
    out.append("")
    seen = set()
    for r in rows:
        if r["label"] not in seen:
            seen.add(r["label"])
            bad = {k: v for k, v in r["stages"].items() if v != "ok"}
            out.append(f"- **{r['label']}**: measured on {_f(r['host'])} at {_f(r['measured_at'])}."
                       + (f" Stages not ok: {bad}." if bad else "") + (f" OnCall: {r['oncall']['note']}." if r["oncall"]["note"] else ""))
    return "\n".join(out) + "\n"


def report(root):
    root = Path(root)
    rows = [r for d in sorted(p for p in root.iterdir() if p.is_dir()) for r in rows_for(d)] if root.is_dir() else []
    doc = {"schema": "skillforge.frontier/1", "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "generated_on": socket.gethostname(), "rows": rows}
    root.mkdir(parents=True, exist_ok=True)
    for name, text in (("frontier.json", json.dumps(doc, indent=2) + "\n"), ("frontier.md", markdown(rows))):
        with open(root / name, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    return doc


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m experiments.gb10_bench.frontier_report")
    ap.add_argument("cmd", choices=["identity", "probe", "report"])
    ap.add_argument("--base-url", default=os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8000/v1"))
    ap.add_argument("--out")
    ap.add_argument("--root", default="results/frontier")
    a = ap.parse_args(argv)
    if a.cmd == "report":
        doc = report(a.root)
        print(f"{len(doc['rows'])} row(s) -> {Path(a.root) / 'frontier.md'} and frontier.json")
        return 0
    res = identity(a.base_url, os.environ.get("LLM_API_KEY")) if a.cmd == "identity" else probe()
    text = json.dumps(res, indent=2, default=str) + "\n"
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        with open(a.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
