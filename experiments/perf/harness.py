"""RESEARCH (research/exec-perf): where does the time go when an approved skill handles a freight batch?

Measures, with the UNCHANGED core:
  compute   skill run() in-process, warm (scalar original vs indexed variant), p50/p95/MAD, rows/s, peak memory
  runner    the real isolated runner (sf.sandbox): cold per call = interpreter + copy + JSON + compute
  docker    the same through SKILL_RUNNER=docker (only with --docker; small n)
  core      one batch end to end: load, match, run_skill(propose), approve, execute, verify, per stage
  dispatch  tools.call overhead vs the bare function
  optimize  the EXISTING optimized-revision mechanism (profile -> propose_skill(optimizes=1) -> bench -> verdict)
Correctness is checked on every measured output against the generator's truth; a mismatch aborts the run.
Model inference is not measured here (no model on this host): it is reported as null, never 0.

  python -m experiments.perf.harness [--sizes 11,110,1100] [--docker] [--out experiments/perf/results/x.json]
"""
import argparse
import copy
import json
import os
import platform
import runpy
import statistics
import tempfile
import time
import tracemalloc
from pathlib import Path

from adapters import models
from app import db, skillforge as sf, tools
from experiments.catalog import library
from experiments.perf import gen

HERE = Path(__file__).parent
VARIANTS = {"scalar": db.ROOT / "experiments" / "catalog" / "skills" / library.FREIGHT,
            "indexed": HERE / "skills" / "freight-indexed"}


def stats(xs):
    xs = sorted(xs)
    med = statistics.median(xs)
    return {"n": len(xs), "p50_ms": round(med, 3), "p95_ms": round(xs[min(len(xs) - 1, int(0.95 * len(xs)))], 3),
            "mad_ms": round(statistics.median(abs(x - med) for x in xs), 3), "min_ms": round(xs[0], 3)}


def outcome(out):
    """skill output -> {po: (status, value_cents)}; anything unmentioned is a v2 'no_change'."""
    st = {r["record_id"]: (r["code"], None) for r in out["refused"]}
    st.update({p["record_id"]: ("change_proposed", round(p["value"] * 100)) for p in out["proposals"]})
    return st


def check(out, truth):
    st = outcome(out)
    bad = [po for po, t in truth.items() if st.get(po, ("no_change", None)) != (t["status"], t["value_cents"])]
    if bad:
        raise AssertionError(f"{len(bad)} records disagree with the generator's truth, e.g. {bad[:3]}")


def compute(sizes, repeats):
    rows = []
    for n in sizes:
        data, truth = gen.build(n)
        outs = {}
        for v, d in VARIANTS.items():
            run = runpy.run_path(str(d / "scripts" / "helper.py"))["run"]
            reps = repeats if n <= 1100 else max(3, repeats // 5)
            times = []
            for _ in range(reps + 1):  # first call discarded (warm-up)
                x = copy.deepcopy(data)
                t0 = time.perf_counter()
                out = run(x)
                times.append((time.perf_counter() - t0) * 1000)
            tracemalloc.start()
            run(copy.deepcopy(data))
            peak = tracemalloc.get_traced_memory()[1]
            tracemalloc.stop()
            check(out, truth)
            outs[v] = json.dumps(out, sort_keys=True)
            s = stats(times[1:])
            rows.append({"stage": "compute_warm", "variant": v, "records": n, **s,
                         "rows_per_s": round(n / (s["p50_ms"] / 1000)) if s["p50_ms"] else None,
                         "peak_kb": peak // 1024})
        assert outs["scalar"] == outs["indexed"], f"variants differ at n={n}"  # byte-identical contract output
    return rows


def runner(sizes, trials, docker=False):
    rows, old = [], os.environ.get("SKILL_RUNNER")
    if docker:
        os.environ["SKILL_RUNNER"] = "docker"
    try:
        for n in sizes:
            data, truth = gen.build(n)
            for v, d in VARIANTS.items():
                times = []
                for _ in range(trials):
                    t0 = time.perf_counter()
                    r = sf.sandbox("run", d, data)
                    times.append((time.perf_counter() - t0) * 1000)
                    if not r.get("ok"):
                        raise RuntimeError(f"runner failed: {str(r.get('error'))[:300]}")
                    check(r["output"], truth)
                prof = sf.sandbox("profile", d, data).get("profile", {})
                rows.append({"stage": "runner_cold_docker" if docker else "runner_cold_subprocess", "variant": v,
                             "records": n, **stats(times), "in_runner_compute_ms": prof.get("elapsed_ms"),
                             "line_events": prof.get("line_events"), "runner_peak_kb": prof.get("peak_kb"),
                             "input_bytes": prof.get("input_bytes"), "output_bytes": prof.get("output_bytes")})
    finally:
        os.environ.pop("SKILL_RUNNER", None) if old is None else os.environ.__setitem__("SKILL_RUNNER", old)
    return rows


def _fresh_db(tmp):
    os.environ["APP_DB"] = str(tmp / "perf.db")
    sf.SKILLS_DIR, models.PROBE_FILE = tmp / "skills", tmp / "probe.json"
    conn = db.connect()
    library.learn_freight(conn)  # approved v1 through the unchanged core (replay + hidden suite + named approver)
    return conn


def core_path(n, tmp):
    """One batch end to end through the agent tool boundary, timed per stage (wall clock, this process)."""
    conn = _fresh_db(tmp)
    data, truth = gen.build(n)
    f = tmp / f"gen{n}.json"
    f.write_text(json.dumps(data), encoding="utf-8")
    t, inner = {}, []
    real = sf.sandbox

    def timed(*a, **k):
        t0 = time.perf_counter()
        try:
            return real(*a, **k)
        finally:
            inner.append((time.perf_counter() - t0) * 1000)

    def clock(name, fn):
        t0 = time.perf_counter()
        r = fn()
        t[name] = round((time.perf_counter() - t0) * 1000, 3)
        return r

    clock("db_load_scenario", lambda: db.load_scenario(conn, f))
    m = clock("match_exact", lambda: sf.match_skills(conn))
    assert m["decision"] == "skill", m
    sf.sandbox = timed
    try:
        run = clock("run_skill_propose_total", lambda: tools.call(conn, "run_skill", {"name": library.FREIGHT, "propose": True}))
    finally:
        sf.sandbox = real
    assert run["ok"], run
    check({"proposals": run["proposals"], "refused": [{"record_id": k, "code": v["status"]} for k, v in
                                                       run["outcomes"].items() if v["status"] in sf.REFUSAL_CODES]}, truth)
    ids = [a["id"] for a in run["actions"]]
    t["of_which_isolated_runner"] = round(sum(inner), 3)
    t["of_which_propose_and_request_approval"] = None  # inside run_skill; not separable without core changes
    early = tools.call(conn, "execute_action", {"action_id": ids[0]})
    assert early["error"]["code"] == "not_approved"  # approval boundary unchanged
    again = tools.call(conn, "run_skill", {"name": library.FREIGHT, "propose": True})
    assert all(a.get("deduplicated", True) for a in again["actions"]) and \
        conn.execute("SELECT COUNT(*) FROM actions").fetchone()[0] == len(ids)  # redelivery adds nothing
    clock("human_approve_all", lambda: [tools.decide_approval(conn, i, True, "perf-operator") for i in ids])
    clock("execute_all", lambda: [tools.call(conn, "execute_action", {"action_id": i}) for i in ids])
    ver = clock("verify_all", lambda: [tools.call(conn, "verify_action", {"action_id": i}) for i in ids])
    assert all(v["passed"] for v in ver), [v for v in ver if not v["passed"]][:2]
    final = {r["id"]: round(json.loads(r["data"])["freight_accrued"] * 100) for r in conn.execute("SELECT * FROM records")}
    assert all(final[po] == tr["value_cents"] for po, tr in truth.items() if tr["value_cents"] is not None)
    t["end_to_end_excl_human"] = round(sum(v for k, v in t.items() if v and not k.startswith("of_which")
                                           and k != "human_approve_all"), 3)
    q = conn.execute("SELECT tool, COUNT(*) c, SUM(ms) ms, SUM(queries) qs FROM tool_calls GROUP BY tool").fetchall()
    conn.close()
    return {"stage": "core_path", "records": n, "actions": len(ids), "ms": t, "model_inference_ms": None,
            "model_calls_on_this_path": "none by construction (no model client on this path); agent path not measured",
            "tool_calls": [dict(r) for r in q]}


def dispatch(tmp, k=300):
    conn = _fresh_db(tmp)
    a, b = [], []
    for _ in range(k):
        t0 = time.perf_counter(); tools.get_audit(conn, 1); a.append((time.perf_counter() - t0) * 1000)
        t0 = time.perf_counter(); tools.call(conn, "get_audit", {"limit": 1}); b.append((time.perf_counter() - t0) * 1000)
    conn.close()
    return {"stage": "dispatch", "bare_get_audit": stats(a), "via_tools_call": stats(b)}


def optimize(tmp):
    """The EXISTING mechanism, unchanged: profile evidence -> one optimized revision -> replay + own tests ->
    identical-input bench -> verdict -> (human) approve with the hidden suite. Nothing here bypasses a step."""
    conn = _fresh_db(tmp)
    v1 = sf._skill(conn, library.FREIGHT, 1)
    prof = json.loads(v1["profile"] or "{}")
    res = {"stage": "optimize_existing_mechanism", "v1_profile": {k: prof.get(k) for k in ("work_growth_8x", "recommended", "evidence")}}
    if not prof.get("recommended"):
        conn.close()
        return {**res, "result": "v1 profile did not recommend optimization: stop"}
    p = tools.call(conn, "propose_skill", {"name": library.FREIGHT, "path": str(VARIANTS["indexed"]), "optimizes": 1,
                                           "description": "same rules; carrier evidence indexed once (research variant)",
                                           "tags": ["freight", "invoice", "reconcile"]})
    res["propose"] = {k: p.get(k) for k in ("ok", "version", "status", "optimization")} if p.get("ok") else p
    res["bench_rows"] = [dict(r) for r in conn.execute(
        "SELECT version, size, records, correct, warm_median_ms, cold_median_ms, work_line_events FROM skill_benchmarks")]
    if p.get("ok") and p["status"] == "tested":
        with library.hidden_dir(library.OPS):
            ap = sf.approve_skill(conn, library.FREIGHT, p["version"], "perf-operator")
        res["approve"] = {k: ap.get(k) for k in ("ok", "status", "error") if k in ap} | {
            "hidden": (ap.get("hidden") or {}).get("ok") if isinstance(ap.get("hidden"), dict) else ap.get("hidden")}
    conn.close()
    return res


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", default="11,110,1100,4400")
    ap.add_argument("--runner-sizes", default="11,110,1100")
    ap.add_argument("--core-sizes", default="110,1100")
    ap.add_argument("--repeats", type=int, default=15)
    ap.add_argument("--trials", type=int, default=5)
    ap.add_argument("--docker", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    sizes = lambda s: [int(x) for x in s.split(",") if x]
    res = {"host": {"platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version(),
                    "cpus": os.cpu_count(), "label": os.environ.get("BENCH_LABEL", "dev box, NOT the GB10")},
           "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "rows": []}
    res["rows"] += compute(sizes(a.sizes), a.repeats)
    res["rows"] += runner(sizes(a.runner_sizes), a.trials)
    if a.docker:
        res["rows"] += runner([110], 3, docker=True)
    for n in sizes(a.core_sizes):
        with tempfile.TemporaryDirectory() as d:
            res["rows"].append(core_path(n, Path(d)))
    with tempfile.TemporaryDirectory() as d:
        res["rows"].append(dispatch(Path(d)))
    with tempfile.TemporaryDirectory() as d:
        res["rows"].append(optimize(Path(d)))
    text = json.dumps(res, indent=1, default=str)
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
