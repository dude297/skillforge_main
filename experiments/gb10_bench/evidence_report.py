"""EXPERIMENT: one evidence report from the files frontier.sh / experiments.oncall_infer wrote on the GB10.
Stdlib only, never imported by the core.

  python -m experiments.gb10_bench.evidence_report results/frontier/<label> [more dirs] [--out report.md] [--allow-mock]

Per run dir (all files optional; a missing one renders "not measured"):
  identity.json  samples.csv  stages.tsv  probe.json  ttft-c<C>-<i>.json  oncall-run.json  reuse-trials/reuse-<k>.json

Rules: every number names its source file and that file's sha256 prefix. A missing value is "not measured", never 0.
A run dir that is mock, fixture, synthetic, a recorded simulation, or not confirmed as a GB10 is REJECTED (exit 2)
unless --allow-mock, which prints a MOCK banner on top and in every section heading. Nothing is estimated.
Definitions of the latency terms: docs/EVIDENCE_PROTOCOL.md section 1.
"""
import argparse
import hashlib
import json
import re
import socket
import sys
from datetime import datetime, timezone
from pathlib import Path

from experiments.gb10_bench import frontier_report as fr
from experiments.gb10_bench.ttft import summarise

NM = "not measured"
MOCK_NAME = re.compile(r"fixture|fake|stub|mock|synthetic|devbox|dev-box|not-gb10|local", re.I)
MOCK_LABEL = re.compile(r"FAKE|STUB|MOCK|DEV BOX|FIXTURE|SYNTHETIC|--local", re.I)


class Rejected(Exception):
    pass


class Run:
    """One result dir: loads files lazily, remembers sha256 of every file it read (provenance)."""

    def __init__(self, d):
        self.d = Path(d)
        self.files = {}  # relative name -> (sha256 hex, bytes)

    def _read(self, name):
        p = self.d / name
        try:
            raw = p.read_bytes()
        except OSError:
            return None
        self.files[name] = (hashlib.sha256(raw).hexdigest(), len(raw))
        return raw

    def json(self, name):
        raw = self._read(name)
        try:
            return json.loads(raw) if raw is not None else None
        except ValueError:
            return None

    def ref(self, name, path=""):
        """provenance tag: file#path [sha256:12]"""
        sha = self.files.get(name, ("?",))[0][:12]
        return f"`{name}{'#' + path if path else ''}` [sha256:{sha}]"


def _walk_marked(x):
    if isinstance(x, dict):
        return x.get("_synthetic") is True or x.get("mock") is True or any(_walk_marked(v) for v in x.values())
    if isinstance(x, list):
        return any(_walk_marked(v) for v in x)
    return False


def disqualifiers(run, ident, oncall, ttfts, reuse_docs):
    """Reasons this dir is not genuine GB10 evidence. Empty list = acceptable."""
    why = []
    if MOCK_NAME.search(run.d.name):
        why.append(f"directory name {run.d.name!r} looks like a mock/fixture/dev run")
    gpu = ((ident or {}).get("gpu") or {}).get("name")
    if not ident:
        why.append("no identity.json: hardware not confirmed")
    elif "GB10" not in str(gpu or ""):
        why.append(f"identity.json gpu.name={gpu!r} does not say GB10: hardware not confirmed")
    if ident and not (ident.get("server") or {}).get("model_id"):
        why.append("identity.json has no served model id")
    for name, doc in [("identity.json", ident), ("oncall-run.json", oncall)] + ttfts + reuse_docs:
        if doc and _walk_marked(doc):
            why.append(f"{name} is marked synthetic/mock")
    for name, doc in ttfts:
        if MOCK_LABEL.search(str((doc or {}).get("label") or "")):
            why.append(f"{name} label {doc.get('label')!r} marks a non-GB10 run")
    for name, doc in [("oncall-run.json", oncall)] + reuse_docs:
        if doc and doc.get("mode") != "LIVE_REAL_MODEL":
            why.append(f"{name} mode={doc.get('mode')!r}: not a live real-model run (recorded simulation is not evidence)")
    return why


def f(x, unit="", nd=None):
    if x is None:
        return NM
    if isinstance(x, bool):
        return "yes" if x else "no"
    if isinstance(x, float) and nd is not None:
        x = round(x, nd)
    return f"{x}{unit}"


def bars(rows, width=36):
    """ASCII bar chart; rows = [(label, value|None)]. None draws 'not measured', never an empty bar."""
    vals = [v for _, v in rows if v is not None]
    top = max(vals) if vals else None
    out = []
    for k, v in rows:
        if v is None:
            out.append(f"{k:<14} {NM}")
        else:
            out.append(f"{k:<14} {'#' * max(1, round(width * v / top)) if top else '#'} {v}")
    return "```\n" + "\n".join(out) + "\n```"


def _t(s):
    try:
        return datetime.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def audit_span(oncall, a, b):
    """seconds between two audit events; second resolution (timestamps are isoformat(timespec='seconds'))."""
    t = {e.get("event"): _t(e.get("t")) for e in (oncall or {}).get("audit") or []}
    return (t[b] - t[a]).total_seconds() if t.get(a) and t.get(b) else None


def reuse_trials(run):
    """-> (list of docs, source names). reuse-trials/reuse-<k>.json in numeric order, else the main oncall-run.json."""
    paths = sorted((run.d / "reuse-trials").glob("reuse-*.json"),
                   key=lambda p: int(re.sub(r"\D", "", p.stem) or 0)) if (run.d / "reuse-trials").is_dir() else []
    names = [f"reuse-trials/{p.name}" for p in paths]
    docs = [(n, run.json(n)) for n in names]
    return [(n, d) for n, d in docs if d]


def all_reuse(run, oncall):
    """first reuse after approval (main oncall-run.json) followed by the repeat trials."""
    first = [("oncall-run.json", oncall)] if oncall and (oncall.get("reuse") or {}).get("state") == "done" else []
    return first + reuse_trials(run)


def section_identity(run, ident, ttfts, oncall):
    s = (ident or {}).get("server") or {}
    m = (ident or {}).get("model") or {}
    c = (ident or {}).get("container") or {}
    h = (ident or {}).get("host") or {}
    g = (ident or {}).get("gpu") or {}
    served = s.get("model_id")
    ids = {"identity.json /v1/models": served, "oncall-run.json model.id": ((oncall or {}).get("model") or {}).get("id")}
    ids.update({n: (d or {}).get("model") for n, d in ttfts})
    seen = {v for v in ids.values() if v}
    L = ["| field | value | source |", "|---|---|---|"]
    ri = lambda p: run.ref("identity.json", p)
    for lab, v, p in [("served model id", served, "server.model_id"), ("weights (serve args)", m.get("weights"), "model.weights"),
                      ("revision", m.get("revision"), "model.revision"), ("revision source", m.get("revision_source"), "model.revision_source"),
                      ("quantization", m.get("quantization"), "model.quantization"),
                      ("max_model_len", s.get("max_model_len"), "server.max_model_len"),
                      ("vLLM version", s.get("vllm_version"), "server.vllm_version"), ("container image", c.get("image"), "container.image"),
                      ("host", h.get("hostname"), "host.hostname"), ("machine", h.get("machine"), "host.machine"),
                      ("GPU", g.get("name"), "gpu.name"), ("driver", g.get("driver"), "gpu.driver"),
                      ("generated by identity at", (ident or {}).get("at"), "at")]:
        L.append(f"| {lab} | {f(v)} | {ri(p)} |")
    L.append("")
    if len(seen) > 1:
        L.append(f"**MISMATCH: model ids differ across files: {ids}**")
    elif len(seen) == 1:
        L.append(f"All files that name a model agree on `{next(iter(seen))}` ({len([v for v in ids.values() if v])} files).")
    return L


def section_compare(run, oncall, trials):
    syn = (oncall or {}).get("synthesis") or {}
    ver = (oncall or {}).get("verification") or {}
    hid = ver.get("hidden") or []
    ro = lambda p: run.ref("oncall-run.json", p)
    lat = []
    bad = 0
    for n, d in trials:
        r = (d or {}).get("reuse") or {}
        if r.get("state") == "done" and r.get("model_calls") == 0 and r.get("latency_ms") is not None:
            lat.append((n, r["latency_ms"]))
        else:
            bad += 1
    ms = [v for _, v in lat]
    first, rest = (ms[0] if ms else None), ms[1:]
    summ = summarise(rest) if len(rest) >= 3 else None
    L = ["| step | measurement | value | source |", "|---|---|---|---|"]
    row = lambda a, b, v, s: L.append(f"| {a} | {b} | {f(v)} | {s} |")
    row("first-time (LLM)", "model calls (chat requests)", syn.get("model_calls"), ro("synthesis.model_calls"))
    row("first-time (LLM)", "synthesis wall ms (model calls + in-loop lint + skill's own tests)", syn.get("latency_ms"), ro("synthesis.latency_ms"))
    row("first-time (LLM)", "prompt / completion tokens (null if server sent no usage)",
        None if syn.get("prompt_tokens") is None else f"{syn.get('prompt_tokens')} / {f(syn.get('completion_tokens'))}", ro("synthesis.*_tokens"))
    row("first-time (LLM)", "automated end-to-end s: incident_loaded to pending_approval (+-1 s, excludes human wait)",
        audit_span(oncall, "incident_loaded", "pending_approval"), ro("audit[].t"))
    row("validation", "hidden + regression verification s (+-1 s; tests, not model)", audit_span(oncall, "synthesized", "verified"), ro("audit[].t"))
    row("validation", "hidden cases passed", None if not hid else f"{sum(1 for x in hid if x.get('pass'))}/{len(hid)}", ro("verification.hidden"))
    row("approval", "approver / kind", None if not (oncall or {}).get("approval", {}).get("by") else
        f"{oncall['approval']['by']} / {oncall['approval'].get('kind')}", ro("approval"))
    src = (f"{len(lat)} files `oncall-run.json` + `reuse-trials/` (first = oncall-run.json; sha256 of each in the file table below)" if len(lat) > 1
           else run.ref(lat[0][0]) if lat else run.ref("oncall-run.json", "reuse"))
    row("reuse (no LLM)", "trials counted (state done, model_calls == 0)", len(lat) or None, src)
    row("reuse (no LLM)", "model calls", 0 if lat else None, "NoModel guard, " + src)
    row("reuse (no LLM)", "latency ms, first trial (cold: new process, first sandbox start)", first, src)
    row("reuse (no LLM)", "latency ms p50 / p95 of trials 2..N (warm)", None if not summ else f"{summ['p50']} / {summ['p95']} (n={summ['n']})", src)
    row("reuse (no LLM)", "trials failing the contract (refused, or model_calls != 0)", bad if trials else None, src)
    L.append("")
    syn_ms = syn.get("latency_ms")
    if syn_ms is not None and summ:
        L.append(f"Ratio first-time synthesis wall / reuse warm p50 = **{round(syn_ms / summ['p50'], 1)}x**. "
                 "Not like for like: synthesis is a one-time cost (model + lint + own tests); reuse is match + `run_skill` only. "
                 "Neither includes hidden-suite validation or human approval time. Quote the two latencies, not just the ratio.")
    else:
        L.append("Ratio: not computed (needs a measured synthesis latency and at least 4 reuse trials).")
    return L


def section_memory(run, ident):
    s = fr.samples(run.d / "samples.csv") if (run.d / "samples.csv").is_file() else None
    run._read("samples.csv")
    tot = ((ident or {}).get("host") or {}).get("mem_total_kib")
    rs = lambda p="": run.ref("samples.csv", p)
    gib = lambda kib: None if kib is None else round(kib / 2**20, 2)
    used = None if (s is None or tot is None or s["min_mem_available_gib"] is None) else round(tot / 2**20 - s["min_mem_available_gib"], 2)
    L = ["| field | value | source |", "|---|---|---|"]
    for lab, v, src in [
            ("samples (1 s each)", (s or {}).get("n"), rs()),
            ("GPU memory.used peak MiB (blank on unified memory is normal)", (s or {}).get("peak_gpu_mem_used_mib"), rs("mem_used_mib")),
            ("system MemTotal GiB", gib(tot), run.ref("identity.json", "host.mem_total_kib")),
            ("min MemAvailable GiB (headroom at worst point)", (s or {}).get("min_mem_available_gib"), rs("mem_available_kib")),
            ("derived peak system used GiB = MemTotal - min MemAvailable (CPU+GPU share one pool)", used, "derived from the two rows above"),
            ("peak temperature C", (s or {}).get("peak_temp_c"), rs("temp_c")),
            ("peak power W (blank when [N/A])", (s or {}).get("peak_power_w"), rs("power_w"))]:
        L.append(f"| {lab} | {f(v)} | {src} |")
    L += ["", "Window = the whole frontier run (idle, probe, TTFT, OnCall), not one stage. Model weights vs KV cache are not separable here."]
    return L


def section_throughput(run, d):
    by_c = fr.ttft_by_c(d)
    for p in sorted(d.glob("ttft-c*-*.json")):
        run._read(p.name)
    L = ["| concurrency | requests | errors | TTFT p50 / p95 s | decode tok/s p50 (per request) | source |", "|---|---|---|---|---|---|"]
    for c, v in sorted(by_c.items()):
        t, dec = v["ttft"] or {}, v["decode"] or {}
        srcs = ", ".join(run.ref(p.name) for p in sorted(d.glob(f"ttft-c{c}-*.json")))
        L.append(f"| {c} | {v['requests']} | {v['errors']} | {f(t.get('p50'))} / {f(t.get('p95'))} | {f(dec.get('p50'))} | {srcs} |")
    if not by_c:
        L.append(f"| {NM} | {NM} | {NM} | {NM} | {NM} | no ttft-c*-*.json |")
    L += ["", "Per-request figures (copies run in parallel but are not time-aligned): aggregate server throughput is **not measured**. "
          "TTFT is client side and counts the first content or reasoning chunk. Decode tok/s = (completion_tokens - 1) / (e2e - TTFT), null without server `usage`.", ""]
    if by_c:
        L.append("decode tok/s p50 by concurrency:")
        L.append(bars([(f"c={c}", (v["decode"] or {}).get("p50")) for c, v in sorted(by_c.items())]))
        L.append("TTFT p50 s by concurrency:")
        L.append(bars([(f"c={c}", (v["ttft"] or {}).get("p50")) for c, v in sorted(by_c.items())]))
    return L, by_c


def section_errors(run, by_c, trials, oncall):
    req = sum(v["requests"] for v in by_c.values()) if by_c else None
    err = sum(v["errors"] for v in by_c.values()) if by_c else None
    stg = fr.stages(run.d / "stages.tsv")
    run._read("stages.tsv")
    pr = run.json("probe.json")
    bad = {k: v for k, v in stg.items() if v != "ok"}
    L = ["| measure | value | source |", "|---|---|---|",
         f"| streaming requests failed / sent | {f(err) if req is None else f'{err} / {req}'}"
         f"{'' if not req else f' ({round(100 * err / req, 1)}%)'} | ttft-c*-*.json `trials[].error` |",
         f"| tool-call capability probe | {NM if pr is None else ('pass' if pr.get('passed') else 'FAIL, missing: ' + str(pr.get('missing')))} | {run.ref('probe.json', 'passed')} |",
         f"| stages not ok | {NM if not stg else (bad or 'none')} | {run.ref('stages.tsv')} |",
         f"| OnCall reuse trials refused or with model calls | {NM if not trials else sum(1 for _, d in trials if not ((d.get('reuse') or {}).get('state') == 'done' and (d.get('reuse') or {}).get('model_calls') == 0))} | reuse trials |",
         f"| INC-3 lookalike | {f(((oncall or {}).get('refusal') or {}).get('state'))} | {run.ref('oncall-run.json', 'refusal.state')} |"]
    return L


def render_run(d, allow_mock):
    run = Run(d)
    ident, oncall = run.json("identity.json"), run.json("oncall-run.json")
    ttfts = []
    for p in sorted(Path(d).glob("ttft-c*-*.json")):
        ttfts.append((p.name, run.json(p.name)))
    trials = all_reuse(run, oncall)
    why = disqualifiers(run, ident, oncall, ttfts, [x for x in trials if x[0] != "oncall-run.json"])
    if why and not allow_mock:
        raise Rejected(f"REJECTED {d}:\n  - " + "\n  - ".join(why))
    tag = " (MOCK)" if why else ""
    L = [f"## Run `{Path(d).name}`{tag}", ""]
    if why:
        L += ["> **MOCK / NOT GB10 EVIDENCE. Do not quote any number below.** Reasons:", *[f"> - {w}" for w in why], ""]
    L += [f"### Model identity{tag}", "", *section_identity(run, ident, ttfts, oncall), "",
          f"### First-time LLM execution vs deterministic reuse{tag}", "", *section_compare(run, oncall, trials), "",
          f"### GPU / unified memory{tag}", "", *section_memory(run, ident), ""]
    tp, by_c = section_throughput(run, Path(d))
    L += [f"### Throughput{tag}", "", *tp, "", f"### Error rate{tag}", "", *section_errors(run, by_c, trials, oncall), ""]
    L += ["### Source files read", "", "| file | sha256 | bytes |", "|---|---|---|",
          *[f"| `{n}` | `{h}` | {b} |" for n, (h, b) in sorted(run.files.items())], ""]
    return L, bool(why)


def build(dirs, allow_mock=False):
    body, mock = [], False
    for d in dirs:
        lines, m = render_run(d, allow_mock)
        body += lines
        mock |= m
    head = ["# SkillForge GB10 evidence report", "",
            f"Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')} on {socket.gethostname()} by "
            "`experiments/gb10_bench/evidence_report.py`. Every figure names its source file and sha256 prefix. "
            f"`{NM}` = absent in the evidence, never 0. Latency terms: `docs/EVIDENCE_PROTOCOL.md` section 1.", ""]
    if mock:
        head += ["> **MOCK REPORT: at least one input is not genuine GB10 evidence (--allow-mock). Nothing here may be presented as a result.**", ""]
    return "\n".join(head + body) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m experiments.gb10_bench.evidence_report")
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--out")
    ap.add_argument("--allow-mock", action="store_true", help="render mock/fixture/non-GB10 inputs with loud MOCK labels instead of rejecting")
    a = ap.parse_args(argv)
    try:
        text = build(a.dirs, a.allow_mock)
    except Rejected as e:
        print(e, file=sys.stderr)
        return 2
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        print(f"wrote {a.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
