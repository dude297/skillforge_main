"""EXPERIMENT: metadata + SQLite FTS5 retrieval benchmark on a hand-labelled synthetic catalog. No model.

  fts_text     FTS5 (porter) over name, domain, workflow, data sources, summary
  fts_aliases  same + owner-curated aliases (the catalog's `aliases` field)

Labels (fixtures/retrieval_queries.json) were written by hand before running; `relevant` is what a correct answer
must surface for an analyst who may see acme/supply, acme/sre and acme/records (NOT finance, hr, evil).

  python -m experiments.catalog.retrieval_bench
"""
import json
import statistics
import tempfile
import time
from pathlib import Path

from app import db
from experiments.catalog import catalog

FIX = Path(__file__).resolve().parent / "fixtures"
PRINCIPAL = {"namespaces": ["acme/supply", "acme/sre", "acme/records"], "roles": ["analyst"]}
K = 5


def entries():
    return json.loads((FIX / "synthetic_catalog.json").read_text()) + json.loads((FIX / "oncall_catalog.json").read_text())


def build(path, with_aliases=True):
    conn = db.connect(str(path))
    catalog.ensure(conn)
    t0 = time.perf_counter()
    for e in entries():
        catalog.register_catalog_only(conn, e if with_aliases else {**e, "aliases": []}, "bench-operator")
    build_ms = (time.perf_counter() - t0) * 1000
    return conn, build_ms


def evaluate(conn, queries):
    rows, lat = [], []
    allowed = set(PRINCIPAL["namespaces"])
    for q in queries:
        t0 = time.perf_counter()
        res = catalog.search(conn, q["query"], PRINCIPAL, K)["results"]
        lat.append((time.perf_counter() - t0) * 1000)
        names = [r["name"] for r in res]
        rel = set(q["relevant"])
        rows.append({"query": q["query"], "kind": q["kind"], "top": names,
                     "recall": len(rel & set(names)) / len(rel) if rel else None,
                     "p_at_3": len(rel & set(names[:3])) / 3 if rel else None,
                     "top1_ok": bool(names) and names[0] in rel if rel else None,
                     "top1_wrong": bool(names) and names[0] not in rel,
                     "auth_failures": sum(r["namespace"] not in allowed or r["freshness"] == "revoked" for r in res),
                     "context_bytes": len(json.dumps(res))})
    scored = [r for r in rows if r["recall"] is not None]
    return {"queries": len(rows), "recall_at_5": round(statistics.mean(r["recall"] for r in scored), 3),
            "precision_at_3": round(statistics.mean(r["p_at_3"] for r in scored), 3),
            "top1_correct": round(statistics.mean(r["top1_ok"] for r in scored), 3),
            "wrong_top1_rate": round(statistics.mean(r["top1_wrong"] for r in rows), 3),
            "zero_recall_queries": [r["query"] for r in scored if r["recall"] == 0],
            "auth_failures": sum(r["auth_failures"] for r in rows),
            "latency_ms_median": round(statistics.median(lat), 3), "latency_ms_max": round(max(lat), 3),
            "context_bytes_median": statistics.median(r["context_bytes"] for r in rows), "rows": rows}


def run(workdir=None):
    work = Path(workdir or tempfile.mkdtemp(prefix="retrieval-"))
    queries = json.loads((FIX / "retrieval_queries.json").read_text())
    out = {"entries": len(entries()), "k": K}
    for name, aliases in (("fts_text", False), ("fts_aliases", True)):
        path = work / f"{name}.db"
        conn, build_ms = build(path, aliases)
        r = evaluate(conn, queries)
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        size = conn.execute("PRAGMA page_count").fetchone()[0] * conn.execute("PRAGMA page_size").fetchone()[0]
        conn.close()
        out[name] = {**r, "build_ms": round(build_ms, 2), "db_bytes_total": size}
    return out


if __name__ == "__main__":
    res = run()
    print(f"synthetic catalog: {res['entries']} entries, k={res['k']}, no model, dev box\n")
    cols = ["recall_at_5", "precision_at_3", "top1_correct", "wrong_top1_rate", "auth_failures", "latency_ms_median",
            "latency_ms_max", "context_bytes_median", "build_ms", "db_bytes_total"]
    print("| variant | " + " | ".join(cols) + " |\n|---|" + "---|" * len(cols))
    for v in ("fts_text", "fts_aliases"):
        print(f"| {v} | " + " | ".join(str(res[v][c]) for c in cols) + " |")
    for v in ("fts_text", "fts_aliases"):
        print(f"\n{v} zero-recall queries: {res[v]['zero_recall_queries']}")
        print(f"{v} wrong top-1: {[(r['query'], r['top'][:1]) for r in res[v]['rows'] if r['top1_wrong']]}")
