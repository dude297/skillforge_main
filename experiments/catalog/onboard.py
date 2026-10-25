"""EXPERIMENT: Bootstrap Lite for ONE supported environment type (a SkillForge ops dataset). Read-only.

  python -m experiments.catalog.onboard <dataset.json> --namespace acme/supply --role analyst [--db app.db] [--out m.json]

Connect (the operator names one dataset) -> Inspect (read-only manifest) -> Define role (the operator states namespace
and role; nothing is inferred from the data) -> Propose workflows -> Review permissions -> Activate. Activation is NOT
done here: the manifest lists the exact human commands. Dataset text is untrusted data, wrapped, never followed.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

from app import tools
from experiments.router import bootstrap

SCHEMA_VERSION = 1


def _verifier_coverage(policy):
    """For each business rule: can THIS host independently attest it for THIS data's context?"""
    out = []
    for inv in policy.get("invariants", []):
        rule = inv.get("rule")
        if rule == "sum_lines":
            out.append({"rule": rule, "verifiable": True, "by": "built-in verifier"})
            continue
        try:
            mod = tools._domain_verifier(rule)
        except ValueError as e:
            out.append({"rule": rule, "verifiable": False, "why": str(e)})
            continue
        ctx = policy.get("context", {})
        bad = [f"{k}={ctx.get(k, 'not declared')} (validated: {', '.join(v)})" for k, v in mod.SUPPORTS.items()
               if ctx.get(k) not in v]
        out.append({"rule": rule, "verifiable": not bad, "by": f"pinned verifier {rule} v{mod.VERSION}",
                    **({"why": "not validated for " + "; ".join(bad)} if bad else {})})
    return out


def _grants(app_db, namespace, role):
    """{(name, version): {freshness, dependencies}} the catalog grants to this namespace and role (read-only)."""
    import sqlite3
    if not app_db or not Path(app_db).exists():
        return {}
    ro = sqlite3.connect(f"file:{Path(app_db).as_posix()}?mode=ro", uri=True)
    ro.row_factory = sqlite3.Row
    try:
        if not ro.execute("SELECT 1 FROM sqlite_master WHERE name='catalog_entries'").fetchone():
            return {}
        return {(e["skill_name"], e["version"]): {"freshness": e["freshness"], "dependencies": json.loads(e["dependencies"])}
                for e in ro.execute("SELECT * FROM catalog_entries WHERE namespace=? AND catalog_only=0 AND freshness!='revoked' "
                                    "AND EXISTS (SELECT 1 FROM json_each(roles) j WHERE j.value=?)", (namespace, role))}
    finally:
        ro.close()


def onboard(dataset, namespace, role, app_db=None):
    principal = {"namespaces": [namespace], "roles": [role]}
    m = bootstrap.manifest(dataset, app_db, principal)
    policy = json.loads(Path(dataset).read_text(encoding="utf-8"))["policy"]
    ctx = policy.get("context", {})
    coverage = _verifier_coverage(policy)
    grants = _grants(app_db, namespace, role)  # authority comes from catalog rows, never from search relevance
    usable = [{"skill": f"{c['name']}@v{c['version']}", "freshness": grants[(c["name"], c["version"])]["freshness"]}
              for c in m["compatible_skills"] if (c["name"], c["version"]) in grants]
    deps = [{"skill": f"{n}@v{v}", "dependency": k, "validated_against": pin, "this_data": ctx.get(k, "not declared"),
             "matches": None if k not in ctx else ctx[k] == pin}  # None: the data doesn't say
            for (n, v), g in grants.items() for k, pin in g["dependencies"].items()]
    fresh_usable = [u for u in usable if u["freshness"] == "fresh"
                    and not any(d["skill"] == u["skill"] and d["matches"] is False for d in deps)]
    workflows = ([{"workflow": f"Run {u['skill']} on new data of this kind", "how": "deterministic, no model; every change "
                   "waits for a named approver; the verifier checks the result", "ready": all(c["verifiable"] for c in coverage)}
                  for u in fresh_usable]
                 or [{"workflow": "Investigate with the local agent, then keep a proven fix as a skill",
                      "how": "agent proposes, a person approves, the verifier checks; a skill needs hidden tests and a "
                             "person's promotion", "ready": False}])
    missing = []
    if not usable:
        missing.append(f"no approved capability is granted to {namespace} / role {role} for this data")
    missing += [f"business rule '{c['rule']}' cannot be independently verified here: {c['why']}" for c in coverage
                if not c["verifiable"]]
    missing += [f"{d['skill']} was validated against {d['dependency']}={d['validated_against']}, this data declares "
                f"{d['this_data']}: revalidation needed" for d in deps if d["matches"] is False]
    missing.append("no messaging channel is authorized for this workspace (NemoClaw `channels add` + an admin's tokens)")
    raw = Path(dataset).read_bytes()
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "live: generated from this host's data, read-only",
        "workspace": {"namespace": namespace, "role": role, "dataset": Path(dataset).name,
                      "dataset_sha256": hashlib.sha256(raw).hexdigest(), "signature": m["environment"]["signature"],
                      "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        "steps": {
            "connect": {"done": True, "what": "one dataset named by the operator, opened read-only"},
            "inspect": {"done": True, "writes_performed": m["writes_performed"]},
            "define_role": {"done": True, "by": "operator", "namespace": namespace, "role": role},
            "propose_workflows": {"done": True},
            "review_permissions": {"done": False, "by": "a person with authority for this workspace"},
            "activate": {"done": False, "by": "a person; never automatic"}},
        "environment": m["environment"],
        "data_sources": m["environment"]["evidence_sources"],
        "schemas": m["schemas"],
        "supported_tools": sorted(m["tool_inventory"]),
        "allowed_actions": m["declared_capabilities"]["actions"],
        "business_context": ctx,
        "verifier_coverage": coverage,
        "compatible_skills": usable,
        "dependencies": deps,
        "proposed_workflows": workflows,
        "missing_permissions": missing,
        "unknowns": m["unverified_assumptions"] + [
            f"this data does not declare {d['dependency']}; {d['skill']} assumes {d['validated_against']}: confirm with "
            "the data owner" for d in deps if d["matches"] is None],
        "relevant_procedures": m["relevant_procedures"],
        "activation_commands": [
            "review this manifest with the workspace owner",
            "python -m app skill approve <name> <version> --by <you>   # only for skills that passed hidden validation",
            "catalog.register(conn, <name>, <version>, '<you>', '" + namespace + "', <owner team>, <domain>, <workflow>, "
            "['" + role + "', 'router', 'agent'], dependencies=" + json.dumps(ctx) + ")",
            "nemoclaw <sandbox> channels add slack   # with an admin's tokens; then rebuild"],
        "authority": "none: this manifest grants nothing; every step after 'propose workflows' is a human action",
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("dataset")
    p.add_argument("--namespace", required=True)
    p.add_argument("--role", required=True)
    p.add_argument("--db")
    p.add_argument("--out")
    a = p.parse_args()
    res = onboard(a.dataset, a.namespace, a.role, a.db)
    text = json.dumps(res, indent=2, default=str)
    if a.out:
        Path(a.out).write_text(text + "\n", encoding="utf-8")
    print(text)
