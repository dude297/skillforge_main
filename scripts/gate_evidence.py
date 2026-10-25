"""Host-side evidence for gates 3-5, read from the authoritative DB / result files (never from agent claims).

  python3 scripts/gate_evidence.py gate3|gate4            (DB: $APP_DB or data/app.db; skills: $SKILLS_DIR or skills/)
  python3 scripts/gate_evidence.py gate5 <result.json>

Prints one JSON object {gate, go, checks:[{check, pass, detail}]} and exits 0 only on GO.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import db, skillforge as sf  # noqa: E402

FIXTURE_HELPER = db.ROOT / "tests" / "fixtures" / "mock_authored_skill" / "scripts" / "helper.py"


def latest_real_skill(conn):
    return conn.execute("""SELECT s.* FROM skills s JOIN tasks t ON t.id = s.source_task
                           WHERE t.mode = 'real' ORDER BY s.id DESC LIMIT 1""").fetchone()


def gate3(conn):
    s = latest_real_skill(conn)
    helper = sf.SKILLS_DIR / "candidates" / s["name"] / f"v{s['version']}" / "scripts" / "helper.py" if s else None
    text = helper.read_text(encoding="utf-8") if helper and helper.exists() else ""
    return [("skill proposed from a REAL-model task", bool(s), dict(s)["name"] + f"@v{s['version']}" if s else "none"),
            ("candidate files on host", bool(text), str(helper)),
            ("not the mock fixture", bool(text) and text != FIXTURE_HELPER.read_text(encoding="utf-8")
             and "MOCK-AUTHORED" not in text, "fixture copy = NOT autonomous"),
            ("self-tests + replay passed (status tested/approved)", bool(s) and s["status"] in ("tested", "approved"),
             s["status"] if s else None)]


def gate4(conn):
    s = latest_real_skill(conn)
    row = next((r for r in sf.list_skills(conn)["skills"] if s and (r["name"], r["version"]) == (s["name"], s["version"])), {})
    return gate3(conn) + [("hidden suite passed on host", row.get("hidden_ok") == 1, row.get("hidden_ok")),  # provenance too
            ("human approved + active", row.get("status") == "approved" and row.get("active") == 1,
             f"{row.get('status')} by {row.get('decided_by')}"),
            ("files sha256 pinned", bool(s and s["sha256"]), (s["sha256"][:16] if s and s["sha256"] else None))]


def gate5(path):
    if not Path(path).is_file():
        return [("benchmark result file exists", False, f"{path} (run the Gate 5 bench with --out)")]
    r = json.loads(Path(path).read_text())
    rows = r.get("rows", [])
    by_mode = {m: [x for x in rows if x["mode"] == m] for m in ("A", "B", "C")}
    cmd = r.get("agent_cmd") or ""
    return [("real model (not mock)", r.get("real_model") is True, r.get("agent")),
            ("agent command is real openclaw (no AGENT_CMD test double)", "openclaw agent" in cmd and "fake" not in cmd, cmd),
            ("no agent CLI/contract errors", not r.get("agent_turn_errors"), len(r.get("agent_turn_errors") or [])),
            ("mode A and C trials ran", bool(by_mode["A"]) and bool(by_mode["C"]),
             {m: len(v) for m, v in by_mode.items()}),
            ("every trial correct (ground truth)", bool(rows) and all(x["correct"] for x in rows),
             f"{sum(bool(x['correct']) for x in rows)}/{len(rows)}"),
            ("model_calls measured (break-even valid)", bool(rows) and all(x["model_calls"] is not None for x in rows
                                                                            if x["mode"] in ("A", "C")),
             "null -> report break-even as pending")]


def main():
    gate = sys.argv[1] if len(sys.argv) > 1 else ""
    if gate == "gate5":
        checks = gate5(sys.argv[2])
    elif gate in ("gate3", "gate4"):
        checks = {"gate3": gate3, "gate4": gate4}[gate](db.connect())
    else:
        print(__doc__)
        return 2
    out = {"gate": gate, "go": all(c[1] for c in checks),
           "checks": [{"check": c, "pass": bool(p), "detail": d} for c, p, d in checks]}
    print(json.dumps(out, default=str))
    return 0 if out["go"] else 1


if __name__ == "__main__":
    sys.exit(main())
