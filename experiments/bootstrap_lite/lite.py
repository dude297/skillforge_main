"""EXPERIMENT (exp/bootstrap-lite): Bootstrap Lite backend. Read-only onboarding over the EXISTING manifest.

  python -m experiments.bootstrap_lite [--port 8766]    the operator console + two extra GET routes, same auth

It adds no bootstrap logic: discovery is `experiments.router.bootstrap.manifest()` (unchanged copy from exp/router),
and live health is the operator API's own cached `ops.status`. This module only assigns each displayed item ONE
state, from real evidence, and the rules are deliberately strict:

  illustrative  an example, not this workspace and not this machine
  discovered    read from the workspace file; nothing is set up
  configured    set up on this machine, but not answering / not in use
  approved      a person approved it, but it does not apply to this workspace
  active        working now: health check ok, exact-match approved skill, or a checker that exists in code
  unavailable   not set up, not reachable, or not built

Nothing here grants, connects, promotes or writes. Every "next step" is a host command a person runs.
Core (`app/`) never imports this; this imports core and the operator API, and appends two GET routes to it.
"""
import json
import re
import sqlite3
from pathlib import Path

from app import db, ui_api
from experiments.catalog import onboard
from experiments.router import bootstrap

STATES = ("illustrative", "discovered", "configured", "approved", "active", "unavailable")
ROOT = db.ROOT
# Supported workspace type: a SkillForge ops fixture (records + evidence + policy). Selected by id, never by path.
WORKSPACES = {"freight-week2": ROOT / "experiments" / "catalog" / "fixtures" / "freight_week2.json"}
WORKSPACES |= {p.stem.replace("_", "-"): p for p in sorted((ROOT / "data" / "learning").glob("*.json"))}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
REQUIRED = ("name", "records", "evidence", "policy")


def _checker(rule, field, ctx):
    """(active, evidence) for one invariant. Decided by onboard's verifier coverage, i.e. core's own gates: built in, or
    a pinned host verifier (sha256 in verifiers/pins.json) validated for this workspace's business context."""
    cov = onboard._verifier_coverage({"invariants": [{"rule": rule}], "context": ctx or {}})[0]
    if cov["verifiable"]:
        return True, f"{cov['by']}" + ("" if rule == "sum_lines" else " (sha256 in verifiers/pins.json), validated for this contract")
    return False, f"{cov['why']}: changes to {field} can't be verified"


ILLUSTRATIVE = [  # what the Bootstrap cinematic shows that this workspace does not have: labelled, never checked
    {"id": "ex-chat", "name": "Team chat (Slack, through NemoClaw)", "room": "intake"},
    {"id": "ex-git", "name": "Code repository (Git)", "room": None},
    {"id": "ex-erp", "name": "ERP (SAP or similar)", "room": None},
]


def _item(id, name, room, state, evidence, next_step=None):
    assert state in STATES, state
    return {"id": id, "name": name, "room": room, "state": state, "evidence": evidence, "next_step": next_step}


def workspaces():
    """The allowlist, with a cheap shape check: unsupported files are listed WITH the reason, not hidden."""
    out = []
    for wid, path in WORKSPACES.items():
        rel = path.relative_to(ROOT).as_posix()
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
            missing = [k for k in REQUIRED if k not in d]
            why = f"missing {', '.join(missing)}" if missing else None
            name = d.get("name")
        except (OSError, ValueError) as e:
            why, name = f"unreadable: {type(e).__name__}", None
        out.append({"id": wid, "file": rel, "name": bootstrap._untrusted(name or wid, 60), "supported": why is None,
                    "why_not": why, "kind": "supply chain (freight)" if wid.startswith("freight") else "accounting fixture"})
    return out


def _loaded_scenario(conn):
    try:
        r = conn.execute("SELECT value FROM meta WHERE key='scenario'").fetchone()
        return r[0] if r else None
    except sqlite3.Error:
        return None


def _grants(conn):
    """{(name, version): [catalog rows]} from the AUTHORITATIVE catalog table, or None when this host has no
    organizational catalog (rc1 single-team mode, as core's scope treats it). Search relevance is never consulted."""
    try:
        if conn is None or not conn.execute("SELECT 1 FROM sqlite_master WHERE name='catalog_entries'").fetchone():
            return None
        rows = conn.execute("SELECT skill_name, version, namespace, roles, freshness, freshness_reason, dependencies "
                            "FROM catalog_entries WHERE catalog_only=0").fetchall()
    except sqlite3.Error:
        return {}  # a catalog we can't read grants nothing
    out = {}
    for n, v, ns, roles, fresh, why, deps in rows:
        out.setdefault((n, v), []).append({"namespace": ns, "roles": json.loads(roles), "freshness": fresh,
                                           "reason": why, "deps": json.loads(deps)})
    return out


def _skill_state(s, grants, ctx):
    """An exact-match approved skill is Active only where a team may actually run it: granted in the catalog, fresh,
    and no dependency this data declares differs from what the skill was validated against (undeclared = unknown)."""
    if grants is None:
        return "active", "person-approved and an exact match for this workspace's data (no organizational catalog: single team)"
    rows = grants.get((s["name"], s["version"]), [])
    bad = {id(g): [f"{k}={ctx[k]} (validated {v})" for k, v in g["deps"].items() if k in ctx and ctx[k] != v] for g in rows}
    ok = [g for g in rows if g["freshness"] == "fresh" and not bad[id(g)]]
    if ok:
        return "active", "person-approved, exact match, fresh; granted to " + "; ".join(
            f"{g['namespace']} ({', '.join(g['roles'])})" for g in ok)
    why = "; ".join(f"{g['namespace']}: " + (f"{g['freshness']}" + (f" ({g['reason']})" if g["reason"] else "")
                                             if g["freshness"] != "fresh" else "dependency changed " + ", ".join(bad[id(g)]))
                    for g in rows) or "not in the organizational catalog, so no team may run it"
    return "approved", f"person-approved and an exact match, but NOT usable here: {why}"[:240]


def states(m, status, loaded_scenario, path_rel, context=None, grants=None):
    """(manifest, ops status projection or None, scenario name loaded in the app DB, workspace policy.context, catalog
    grants or None) -> displayed items. Reads only the pinned verifier files; writes nothing."""
    env, caps = m["environment"], []
    name = env["name"]["untrusted_text"]
    kinds = ", ".join(env["record_kinds"])
    loaded = loaded_scenario == name
    caps.append(_item("records", f"Business records ({env['records']} × {kinds})", "intake",
                      "configured" if loaded else "discovered",
                      "loaded in the app database" if loaded else f"read from {path_rel}; not loaded into the app database",
                      None if loaded else f"python3 -m app reset --scenario {path_rel}"))
    for src in env["evidence_sources"]:
        label, _, trust = src.partition(":")
        caps.append(_item(f"evidence-{label}", f"Evidence source: {label}", "intake", "discovered",
                          f"marked '{trust}' by the file itself; trust was not independently established"))

    def health(key, label, room, fix):
        h = (status or {}).get(key)
        if h is None:
            return _item(key, label, room, "unavailable", "no health answer from this machine", fix)
        state = "active" if h.get("ok") is True else "configured" if h.get("ok") is False else "unavailable"
        return _item(key, label, room, state, h.get("detail") or "", None if state == "active" else fix)

    model = ((status or {}).get("inference") or {}).get("model")
    caps.append(health("inference", f"Local model{f' ({model})' if model else ''}", "server", "python3 -m app status   # runbook R1b"))
    caps.append(health("sandbox", "Agent sandbox (OpenShell)", "server", "python3 -m app status   # runbook R1"))
    for inv in m["declared_capabilities"]["invariants"]:
        ok, why = _checker(inv["rule"], inv["field"], context)
        caps.append(_item(f"check-{inv['rule']}", f"Independent check: {inv['rule']} on {inv['field']}", "gate",
                          "active" if ok else "unavailable", why))
    usable = {}
    for s in m["compatible_skills"]:
        state, why = _skill_state(s, grants, context or {})
        usable[s["name"]] = state == "active"
        caps.append(_item(f"skill-{s['name']}", f"Skill {s['name']} v{s['version']}", "library", state, why))
    for s in m["near_misses"]:
        caps.append(_item(f"skill-{s['name']}", f"Skill {s['name']} v{s['version']}", "library", "approved",
                          "person-approved, but NOT a match here: " + "; ".join(map(str, s.get("reasons", [])))[:200]))
    for ex in ILLUSTRATIVE:
        caps.append(_item(ex["id"], ex["name"], ex["room"], "illustrative",
                          "example from the Bootstrap illustration; not part of this workspace and not checked"))

    workflows = [_item(f"wf-{s['name']}", f"Run skill {s['name']} (fast path)", "library", "active",
                       "exact match: proposes fixes without the model; each fix still needs a person")
                 for s in m["compatible_skills"] if usable[s["name"]]]
    workflows += [_item(f"wf-learn-{o['signature']}", f"Learn a {', '.join(o['kinds'])} skill", "server", "discovered",
                        f"{o['why']}; proposed: {o['how']}", "python3 -m app demo   # mock walk-through")
                  for o in m["missing_skill_opportunities"]]
    perms = [{"action": p["action"], "fields": p.get("fields", []), "human_approval": p["human_approval"],
              "granted": False, "how": "per change: python3 -m app approve <id> --by <your name>"
              if p["action"] in m["declared_capabilities"]["actions"] else "host step outside SkillForge; not offered here"}
             for p in m["required_permissions"]]
    active = [c["name"] for c in caps if c["state"] == "active"]
    return {"capabilities": caps, "workflows": workflows, "permissions": perms,
            "summary": {"active": active, "counts": {s: sum(c["state"] == s for c in caps) for s in STATES}}}


def discover(wid, conn=None, status=None):
    if not ID_RE.match(wid or "") or wid not in WORKSPACES:
        raise ui_api.ApiError(404, "unknown_workspace", "not a supported workspace id")
    ws = next(w for w in workspaces() if w["id"] == wid)
    if not ws["supported"]:
        raise ui_api.ApiError(422, "unsupported_workspace", ws["why_not"])
    try:
        m = bootstrap.manifest(WORKSPACES[wid])
        ctx = json.loads(WORKSPACES[wid].read_text(encoding="utf-8"))["policy"].get("context", {})
    except (KeyError, TypeError, ValueError, AttributeError) as e:  # fixture passed the shape check but not the loader
        raise ui_api.ApiError(422, "unsupported_workspace", f"{type(e).__name__} while reading the workspace")
    loaded = _loaded_scenario(conn) if conn is not None else None
    return {"ok": True, "workspace": ws, "manifest": m, "read_only": True, "writes_performed": m["writes_performed"],
            "status_checked_at": (status or {}).get("checked_at"), **states(m, status, loaded, ws["file"], ctx, _grants(conn))}


def _discover_route(conn, match, _q):
    try:
        st = ui_api.status(conn, {})
    except Exception:  # health is optional context: unknown stays unknown, discovery still answers
        st = None
    return discover(match[1], conn, st)


ROUTES = [
    (re.compile(r"^/ui/bootstrap/workspaces$"), lambda c, m, q: {"ok": True, "workspaces": workspaces()}),
    (re.compile(r"^/ui/bootstrap/discover/([a-z0-9][a-z0-9-]{1,40})$"), _discover_route),
]


def install():
    """Append the GET routes to the operator API (idempotent). Same auth, host check, read-only DB, size cap."""
    for r in ROUTES:
        if all(r[0].pattern != p.pattern for p, _ in ui_api.ROUTES):
            ui_api.ROUTES.append(r)
