"""EXPERIMENT (exp/router): organizational skill catalog OVER the existing registry. Never imported by app/.

Authority stays where it is: `skills` (status, active, sha256, signature, touches, hidden_validation),
`skill_runs`, `audit`, approved/ artifacts. This module adds only what retrieval and freshness need:

  catalog_entries  org metadata per approved version (namespace, owner, roles, deps, freshness)
  env_versions     operator-declared versions of things skills depend on (contract rev, schema, ...)
  catalog_fts      FTS5 index: a REBUILDABLE secondary structure, never consulted for authority

Search returns metadata summaries only and carries no authority. Execution still needs check_exact
(approved + active + fresh + artifact hash + hidden validation + namespace/role + environment + exact
fingerprint), then the unchanged core path (run_skill -> policy -> human approval -> execute -> verify).
Text from SKILL.md and fixtures is UNTRUSTED: stored, indexed, returned wrapped; never interpreted.
"""
import json
import os
import re
import sqlite3
import sys
import time

from app import db, skillforge as sf
from app.tools import ToolError

SCHEMA = """
CREATE TABLE IF NOT EXISTS catalog_entries (
  id INTEGER PRIMARY KEY,
  skill_name TEXT NOT NULL, version INTEGER NOT NULL,
  namespace TEXT NOT NULL, owner_team TEXT NOT NULL, domain TEXT NOT NULL, workflow TEXT NOT NULL,
  summary TEXT NOT NULL,                    -- SKILL.md description: UNTRUSTED
  aliases TEXT NOT NULL DEFAULT '[]',       -- owner-curated search keywords
  data_sources TEXT NOT NULL DEFAULT '[]',  -- derived from the registry signature at registration (search input only)
  roles TEXT NOT NULL,                      -- who may see/inspect/route to it
  environment TEXT NOT NULL DEFAULT '{}',   -- {"runners": [...], "python": "3.11"}
  dependencies TEXT NOT NULL DEFAULT '{}',  -- {key: version} pinned when last validated
  freshness TEXT NOT NULL DEFAULT 'fresh',  -- fresh | stale | revoked
  freshness_reason TEXT, validated_at REAL,
  catalog_only INTEGER NOT NULL DEFAULT 0,  -- metadata with no approved artifact: never executable
  registered_by TEXT NOT NULL, registered_at REAL NOT NULL,
  UNIQUE(namespace, skill_name, version));
CREATE TABLE IF NOT EXISTS env_versions (key TEXT PRIMARY KEY, version TEXT NOT NULL, set_by TEXT NOT NULL, set_at REAL NOT NULL);
"""
FTS = "CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(name, aliases, domain, workflow, sources, summary, " \
      "tokenize='porter unicode61')"
WEIGHTS = (8.0, 4.0, 2.0, 2.0, 1.0, 1.0)
NS_RE = re.compile(r"^[a-z0-9-]+/[a-z0-9-]+$")
MAX_RESULTS = 10
SUMMARY_CHARS = 240


def ensure(conn):
    conn.executescript(SCHEMA)
    conn.execute(FTS)


def _human(by):
    if not isinstance(by, str) or not by.strip() or by.strip().lower() in ("agent", "system", "policy", "router"):
        raise ToolError("invalid_input", "must name a human")


def _untrusted(text, n=SUMMARY_CHARS):
    return {"untrusted_text": str(text)[:n]}


def _skill_md(path):
    """Agent Skills style frontmatter: '---', name:, description:, '---'. -> (name, description) or raise."""
    text = path.read_text(encoding="utf-8") if path.is_file() else ""
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, re.S)
    fields = dict(re.findall(r"^([a-z-]+):[ \t]*(.+)$", m[1], re.M)) if m else {}
    if not fields.get("name") or not fields.get("description"):
        raise ToolError("malformed_skill_md", "SKILL.md needs YAML frontmatter with name and description")
    if len(fields["description"]) > 1024:
        raise ToolError("malformed_skill_md", "description longer than 1024 characters")
    return fields["name"].strip(), fields["description"].strip()


def _approved_dir(name, version):
    return sf.SKILLS_DIR / "approved" / name / f"v{version}"


def _index_row(conn, e):
    conn.execute("INSERT INTO catalog_fts (rowid, name, aliases, domain, workflow, sources, summary) "
                 "VALUES (?, ?, ?, ?, ?, ?, ?)", (e["id"], e["skill_name"].replace("-", " "),
                                                  " ".join(json.loads(e["aliases"])), e["domain"], e["workflow"],
                                                  " ".join(json.loads(e["data_sources"])), e["summary"]))


def rebuild_index(conn):
    t0 = time.perf_counter()
    conn.execute("DROP TABLE IF EXISTS catalog_fts")
    conn.execute(FTS)
    for e in conn.execute("SELECT * FROM catalog_entries").fetchall():
        _index_row(conn, e)
    return {"ok": True, "entries": conn.execute("SELECT COUNT(*) FROM catalog_entries").fetchone()[0],
            "build_ms": round((time.perf_counter() - t0) * 1000, 3)}


def _rebuild(conn, why):
    rebuild_index(conn)
    db.audit(conn, "catalog", "index_rebuilt", {"why": why})


def _index_ok(conn):
    """Per query, cheap: index present and row count in step with the entries (docsize is a rowid table).
    ponytail: full FTS integrity-check is O(index) (~600 ms at 10k entries), so it runs in verify_index() and after a
    failing query, not on every search."""
    try:
        bad = conn.execute("SELECT COUNT(*) FROM catalog_fts_docsize").fetchone()[0] !=               conn.execute("SELECT COUNT(*) FROM catalog_entries").fetchone()[0]
    except sqlite3.DatabaseError:
        bad = True
    if bad:
        _rebuild(conn, "missing or out of step")
    return not bad


def verify_index(conn):
    """Full integrity check (startup / operator). Corrupt -> rebuilt from catalog_entries."""
    ensure(conn)
    try:
        conn.execute("INSERT INTO catalog_fts (catalog_fts) VALUES ('integrity-check')")
        return {"ok": True, "rebuilt": not _index_ok(conn)}
    except sqlite3.DatabaseError as e:
        _rebuild(conn, f"integrity-check: {e}")
        return {"ok": True, "rebuilt": True}


def _insert(conn, row):
    cur = conn.execute(f"INSERT INTO catalog_entries ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                       tuple(row.values()))
    _index_row(conn, conn.execute("SELECT * FROM catalog_entries WHERE id=?", (cur.lastrowid,)).fetchone())
    return cur.lastrowid


def _org_fields(namespace, owner_team, domain, workflow, roles, aliases):
    if not isinstance(namespace, str) or not NS_RE.match(namespace):
        raise ToolError("invalid_input", "namespace must look like 'org/unit'")
    if not (isinstance(roles, list) and roles and all(isinstance(r, str) for r in roles)):
        raise ToolError("invalid_input", "roles must be a non-empty list of strings")
    if not all(isinstance(x, str) and x for x in (owner_team, domain, workflow)):
        raise ToolError("invalid_input", "owner_team, domain, workflow required")
    return {"namespace": namespace, "owner_team": owner_team, "domain": domain, "workflow": workflow,
            "roles": json.dumps(sorted(roles)), "aliases": json.dumps([str(a) for a in aliases])}


def register(conn, name, version, by, namespace, owner_team, domain, workflow, roles, aliases=(),
             environment=None, dependencies=None):
    """Human-only: list an APPROVED, hidden-validated, hash-intact registry version in the catalog."""
    ensure(conn)
    _human(by)
    s = sf._skill(conn, name, version)
    if s["status"] != "approved":
        raise ToolError("not_approved", f"{name}@v{version} is '{s['status']}'")
    if not json.loads(s["hidden_validation"] or "null") or not json.loads(s["hidden_validation"]).get("ok"):
        raise ToolError("no_validation_record", f"{name}@v{version} has no passing hidden validation on record")
    d = _approved_dir(name, version)
    if not d.is_dir() or sf._tree_hash(d) != s["sha256"]:
        raise ToolError("integrity_error", f"{name}@v{version} artifact missing or changed since approval")
    md_name, description = _skill_md(d / "SKILL.md")
    if md_name != name:
        raise ToolError("malformed_skill_md", f"SKILL.md name '{md_name}' != registry name '{name}'")
    sig = json.loads(s["signature"] or "{}")
    row = {"skill_name": name, "version": int(version), **_org_fields(namespace, owner_team, domain, workflow, roles, aliases),
           "summary": description, "data_sources": json.dumps(sig.get("kinds", []) + sig.get("sources", [])),
           "environment": json.dumps(environment or {}), "dependencies": json.dumps(dependencies or {}),
           "validated_at": time.time(), "registered_by": by, "registered_at": time.time()}
    eid = _insert(conn, row)
    db.audit(conn, f"human:{by}", "catalog_register", {"name": name, "version": int(version), "namespace": namespace})
    refresh(conn)
    return {"ok": True, "entry_id": eid}


def register_catalog_only(conn, entry, by):
    """Fixture/benchmark metadata with NO artifact. Searchable, never executable."""
    ensure(conn)
    _human(by)
    row = {"skill_name": entry["name"], "version": int(entry.get("version", 1)),
           **_org_fields(entry["namespace"], entry.get("owner_team", "fixture"), entry["domain"], entry["workflow"],
                         entry.get("roles", ["analyst"]), entry.get("aliases", ())),
           "summary": str(entry["summary"])[:1024], "data_sources": json.dumps(entry.get("data_sources", [])),
           "freshness": entry.get("freshness", "fresh"), "catalog_only": 1, "registered_by": by,
           "registered_at": time.time()}
    return _insert(conn, row)


# ---- retrieval (no authority) ----------------------------------------------------------------

def _visible(principal):
    ns, roles = list(principal.get("namespaces", [])), list(principal.get("roles", []))
    if not ns or not roles:
        return "0", []
    return (f"e.namespace IN ({','.join('?' * len(ns))}) AND EXISTS (SELECT 1 FROM json_each(e.roles) r "
            f"WHERE r.value IN ({','.join('?' * len(roles))}))", ns + roles)


def _registry_status(conn, e):
    if e["catalog_only"]:
        return "catalog_only"
    s = conn.execute("SELECT status, active FROM skills WHERE name=? AND version=?", (e["skill_name"], e["version"])).fetchone()
    return "missing" if not s else f"{s['status']}{'' if s['active'] else ' (inactive)'}"


def search(conn, query, principal, limit=5):
    """FTS5 over org metadata, filtered by namespace, role and revocation BEFORE the limit. Summaries only."""
    ensure(conn)
    _index_ok(conn)
    limit = max(1, min(int(limit), MAX_RESULTS))
    terms = [t for t in re.findall(r"[a-z0-9]+", str(query).lower()) if len(t) > 1][:16]
    if not terms:
        return {"ok": True, "results": []}
    match = " OR ".join(f'"{t}"' + ("*" if len(t) >= 4 else "") for t in terms)  # quoted: no FTS syntax injection
    where, args = _visible(principal)
    sql = (f"SELECT e.*, bm25(catalog_fts, {', '.join(map(str, WEIGHTS))}) AS score FROM catalog_fts "
           f"JOIN catalog_entries e ON e.id = catalog_fts.rowid WHERE catalog_fts MATCH ? "
           f"AND e.freshness != 'revoked' AND {where} ORDER BY score LIMIT ?")
    try:
        rows = conn.execute(sql, [match, *args, limit]).fetchall()
    except sqlite3.DatabaseError as e:  # corrupt index: rebuild from the authoritative entries, retry once
        _rebuild(conn, f"query failed: {e}")
        rows = conn.execute(sql, [match, *args, limit]).fetchall()
    return {"ok": True, "authority": "none: suggestions only; execution requires check_exact + human approval",
            "results": [{"name": e["skill_name"], "version": e["version"], "namespace": e["namespace"],
                         "domain": e["domain"], "workflow": e["workflow"], "summary": _untrusted(e["summary"]),
                         "freshness": e["freshness"], "registry": _registry_status(conn, e),
                         "score": round(-e["score"], 3)} for e in rows]}


def _entry(conn, name, principal, version=None, include_revoked=True):
    ensure(conn)
    where, args = _visible(principal)
    q = f"SELECT e.* FROM catalog_entries e WHERE e.skill_name=? AND {where}"
    if version is not None:
        q, args = q + " AND e.version=?", args + [int(version)]
    if not include_revoked:
        q += " AND e.freshness != 'revoked'"
    e = conn.execute(q + " ORDER BY e.version DESC", [name, *args]).fetchone()
    if not e:  # same answer for "absent" and "not yours": no existence oracle across namespaces
        raise ToolError("not_found", f"no visible catalog entry '{name}'")
    return e


def inspect(conn, name, principal, version=None):
    e = _entry(conn, name, principal, version)
    s = None if e["catalog_only"] else conn.execute("SELECT * FROM skills WHERE name=? AND version=?",
                                                    (e["skill_name"], e["version"])).fetchone()
    runs = conn.execute("SELECT COUNT(*) n, COALESCE(SUM(verified_pass), 0) p, COALESCE(SUM(verified_fail), 0) f, "
                        "MAX(CASE WHEN verified_pass > 0 THEN ts END) last FROM skill_runs WHERE skill_id=?",
                        (s["id"],)).fetchone() if s else None
    return {"ok": True, "name": e["skill_name"], "version": e["version"], "namespace": e["namespace"],
            "owner_team": e["owner_team"], "domain": e["domain"], "workflow": e["workflow"],
            "summary": _untrusted(e["summary"], 1024), "roles": json.loads(e["roles"]),
            "dependencies": json.loads(e["dependencies"]), "environment": json.loads(e["environment"]),
            "freshness": e["freshness"], "freshness_reason": e["freshness_reason"], "registry": _registry_status(conn, e),
            "artifact_sha256": s["sha256"] if s else None, "approved_by": s["decided_by"] if s else None,
            "hidden_validation_ok": bool(json.loads(s["hidden_validation"] or "{}").get("ok")) if s else None,
            "input_schema": json.loads(s["input_shape"]) if s else None,
            "output_schema": {"proposals": sorted(sf.PROPOSAL_KEYS), "fields": json.loads(s["touches"] or "[]")} if s else None,
            "executions": dict(runs) if runs else None}


def get_skill_md(conn, name, principal, version=None):
    """Full instructions for ONE visible, approved, non-revoked, hash-intact version. Returned as untrusted text."""
    e = _entry(conn, name, principal, version, include_revoked=False)
    if e["catalog_only"]:
        raise ToolError("not_found", "catalog-only entry has no artifact")
    s = sf._skill(conn, e["skill_name"], e["version"])
    d = _approved_dir(e["skill_name"], e["version"])
    if s["status"] not in ("approved", "disabled") or not d.is_dir() or sf._tree_hash(d) != s["sha256"]:
        raise ToolError("integrity_error", "artifact missing, unapproved or changed since approval")
    return {"ok": True, "name": e["skill_name"], "version": e["version"], "sha256": s["sha256"],
            "skill_md": _untrusted((d / "SKILL.md").read_text(encoding="utf-8"), 20_000)}


def check_exact(conn, name, principal, match=None):
    """Everything execution needs, from AUTHORITATIVE rows (never from the index). -> {executable, reasons}."""
    try:
        e = _entry(conn, name, principal, include_revoked=False)
    except ToolError:
        return {"executable": False, "reasons": ["not in a catalog namespace/role visible to this principal"],
                "kind": "not_authorized"}
    reasons = []
    if e["catalog_only"]:
        return {"executable": False, "reasons": ["catalog-only metadata: no approved artifact"]}
    if e["freshness"] != "fresh":
        reasons.append(f"{e['freshness']}: {e['freshness_reason']}")
    try:  # the data itself may declare a newer revision of something this skill depends on
        ctx = json.loads(conn.execute("SELECT value FROM meta WHERE key='policy'").fetchone()[0]).get("context", {})
    except (TypeError, ValueError):
        ctx = {}
    drift = [f"{k}: this data uses {ctx[k]}, the skill was validated against {v}"
             for k, v in json.loads(e["dependencies"]).items() if k in ctx and ctx[k] != v]
    reasons += drift
    s = conn.execute("SELECT * FROM skills WHERE name=? AND version=?", (e["skill_name"], e["version"])).fetchone()
    if not s or s["status"] != "approved" or not s["active"]:
        reasons.append(f"registry: {s['status'] if s else 'missing'}{'' if s and s['active'] else ', not active'}")
    elif not json.loads(s["hidden_validation"] or "{}").get("ok"):
        reasons.append("no passing hidden validation on record")
    d = _approved_dir(e["skill_name"], e["version"])
    if s and (not d.is_dir() or sf._tree_hash(d) != s["sha256"]):
        reasons.append("artifact changed since approval")
    env = json.loads(e["environment"])
    runner = os.environ.get("SKILL_RUNNER") or "subprocess"
    if runner not in env.get("runners", [runner]):
        reasons.append(f"runner '{runner}' not in {env['runners']}")
    if "python" in env and sys.version_info[:2] < tuple(map(int, env["python"].split("."))):
        reasons.append(f"needs python >= {env['python']}")
    m = match or sf.match_skills(conn)
    c = next((c for c in m["candidates"] if c["name"] == name and c["version"] == e["version"]), None)
    if not c or c["match"] != "exact":
        reasons.append(f"fingerprint not exact: {c['reasons'] if c else 'not an active approved candidate'}")
    elif m["decision"] != "skill":
        reasons.append(m["why"])
    kind = "stale" if (e["freshness"] == "stale" or drift) else "not_executable"
    return {"executable": not reasons, "reasons": reasons, "version": e["version"], "kind": kind}


def stale_exact(conn, signature_id, principal):
    """Stale/disabled entries whose LEARNED fingerprint equals the current data's: 'this used to be routine'."""
    ensure(conn)
    where, args = _visible(principal)
    return [dict(name=r["skill_name"], version=r["version"], reason=r["freshness_reason"]) for r in conn.execute(
        f"SELECT e.* FROM catalog_entries e JOIN skills s ON s.name=e.skill_name AND s.version=e.version "
        f"WHERE e.freshness='stale' AND json_extract(s.signature, '$.id')=? AND {where}", [signature_id, *args])]


def event_query(conn):
    """Deterministic discovery query from the current data: record kinds and evidence sources."""
    d = sf.dataset(conn)
    return " ".join(sorted({r["kind"] for r in d["records"]} | {e["source"] for e in d["evidence"]}))


# ---- freshness (dependencies) ------------------------------------------------------------------

def _set_registry(conn, name, version, executable, actor, reason):
    """Uses the EXISTING registry states: stale -> 'disabled' (so core run_skill refuses it on every path);
    revalidated -> 'approved' + the one active version."""
    if executable:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("UPDATE skills SET active=0 WHERE name=?", (name,))
        conn.execute("UPDATE skills SET status='approved', active=1 WHERE name=? AND version=?", (name, version))
        conn.execute("COMMIT")
    else:
        conn.execute("UPDATE skills SET status='disabled', active=0 WHERE name=? AND version=? AND status='approved'",
                     (name, version))
    db.audit(conn, actor, "skill_reactivated" if executable else "skill_disabled_stale",
             {"name": name, "version": version, "reason": reason})


def set_env_version(conn, key, version, by):
    """Human/operator declares a dependency's current version (e.g. a new carrier contract revision)."""
    ensure(conn)
    _human(by)
    conn.execute("INSERT OR REPLACE INTO env_versions (key, version, set_by, set_at) VALUES (?, ?, ?, ?)",
                 (str(key), str(version), by, time.time()))
    db.audit(conn, f"human:{by}", "env_version_set", {"key": key, "version": version})
    return refresh(conn)


def refresh(conn):
    """Mark entries stale when a pinned dependency differs from (or is missing in) env_versions. Unchanged skill
    code is NOT evidence of compatibility; an undeclared dependency counts as changed."""
    ensure(conn)
    env = {r["key"]: r["version"] for r in conn.execute("SELECT * FROM env_versions")}
    changed = []
    for e in conn.execute("SELECT * FROM catalog_entries WHERE freshness='fresh'").fetchall():
        diffs = [f"{k}: validated against {v}, environment has {env.get(k, 'nothing declared')}"
                 for k, v in json.loads(e["dependencies"]).items() if env.get(k) != v]
        if diffs:
            reason = "; ".join(diffs)
            conn.execute("UPDATE catalog_entries SET freshness='stale', freshness_reason=? WHERE id=?", (reason, e["id"]))
            if not e["catalog_only"]:
                _set_registry(conn, e["skill_name"], e["version"], False, "catalog:freshness", reason)
            changed.append({"name": e["skill_name"], "version": e["version"], "reason": reason})
    return {"ok": True, "stale": changed}


def revalidate(conn, name, version, by):
    """Human-only: re-run the hidden suite (as it stands NOW) on the unchanged approved artifact. Pass -> deps re-pinned
    to the current environment and the version reactivated. Fail -> stays stale; a new version is needed."""
    ensure(conn)
    _human(by)
    e = conn.execute("SELECT * FROM catalog_entries WHERE skill_name=? AND version=? AND catalog_only=0",
                     (name, int(version))).fetchone()
    if not e or e["freshness"] != "stale":
        raise ToolError("invalid_state", f"{name}@v{version} is not a stale catalog entry")
    s = sf._skill(conn, name, version)
    d = _approved_dir(name, version)
    if not d.is_dir() or sf._tree_hash(d) != s["sha256"]:
        raise ToolError("integrity_error", "artifact changed since approval")
    scenario = conn.execute("SELECT scenario FROM tasks WHERE id=?", (s["source_task"],)).fetchone()[0]
    hidden = sf.hidden_check(d, scenario, s["input_shape"])
    if not hidden["ok"]:
        db.audit(conn, f"human:{by}", "catalog_revalidation_failed", {"name": name, "version": int(version)})
        return {"ok": False, "failed_cases": [c["case"] for c in hidden.get("cases", []) if not c["ok"]] or hidden.get("error")}
    env = {r["key"]: r["version"] for r in conn.execute("SELECT * FROM env_versions")}
    deps = {k: env.get(k, v) for k, v in json.loads(e["dependencies"]).items()}
    conn.execute("UPDATE skills SET hidden_validation=? WHERE id=?", (json.dumps(hidden), s["id"]))
    conn.execute("UPDATE catalog_entries SET freshness='fresh', freshness_reason=NULL, dependencies=?, validated_at=? "
                 "WHERE id=?", (json.dumps(deps), time.time(), e["id"]))
    _set_registry(conn, name, int(version), True, f"human:{by}", "revalidated")
    return {"ok": True, "active": f"{name}@v{version}", "dependencies": deps}


def revoke(conn, name, version, by, reason):
    """Human-only, terminal for this version: hidden from search, disabled in the registry, kept for audit."""
    ensure(conn)
    _human(by)
    n = conn.execute("UPDATE catalog_entries SET freshness='revoked', freshness_reason=? WHERE skill_name=? AND version=?",
                     (str(reason), name, int(version))).rowcount
    if not n:
        raise ToolError("not_found", f"{name}@v{version} not in catalog")
    conn.execute("UPDATE skills SET status='disabled', active=0 WHERE name=? AND version=?", (name, int(version)))
    db.audit(conn, f"human:{by}", "catalog_revoke", {"name": name, "version": int(version), "reason": reason})
    return {"ok": True}


# ---- operator card: one plain answer per question an operations manager asks about a skill --------------------------

def card(conn, name, principal):
    """Plain-language view for a business operator, from existing metadata. Relevance is never shown as permission:
    `can_run_now` comes only from check_exact on the CURRENT data, and still means 'may propose', never 'may change'."""
    from app import tools  # noqa: PLC0415
    i = inspect(conn, name, principal)
    gate = check_exact(conn, name, principal)
    try:
        policy = tools._policy(conn)
    except ToolError:
        policy = {}
    rules = [r["rule"] for r in policy.get("invariants", [])]
    verified_by = []
    for rule in rules:
        if rule == "sum_lines":
            verified_by.append({"rule": rule, "independent": True})
            continue
        try:
            tools._domain_verifier(rule)
            verified_by.append({"rule": rule, "independent": True})
        except ValueError as e:
            verified_by.append({"rule": rule, "independent": False, "why": str(e)})
    last = (i.get("executions") or {}).get("last")
    actions = policy.get("actions", {})
    return {
        "name": i["name"], "version": i["version"],
        "what_it_does": i["summary"],  # untrusted_text: the author's words
        "owner": i["owner_team"], "namespace": i["namespace"], "who_may_use": i["roles"],
        "data_it_reads": json.loads(conn.execute("SELECT data_sources FROM catalog_entries WHERE skill_name=? AND version=?",
                                                 (i["name"], i["version"])).fetchone()[0]),
        "fields_it_may_propose": (i.get("output_schema") or {}).get("fields", []),
        "environment": i["environment"] or "any supported runner",
        "approved_by": i["approved_by"], "hidden_tests_passed": i["hidden_validation_ok"],
        "last_validated": time.strftime("%Y-%m-%d", time.gmtime(conn.execute(
            "SELECT validated_at FROM catalog_entries WHERE skill_name=? AND version=?", (i["name"], i["version"])).fetchone()[0] or 0)),
        "last_verified_run": last,
        "status": i["freshness"] + ("" if i["freshness"] == "fresh" else f": {i['freshness_reason']}"),
        "can_run_now": gate["executable"],
        "why": gate["reasons"] or ["exact match for the data loaded now"],
        "needs_approval": all(a.get("requires_approval", True) for a in actions.values()) if actions else None,
        "result_independently_verified": verified_by or None,
        "note": "Search finds candidates; it never authorizes. Running proposes changes that a named person approves.",
    }
