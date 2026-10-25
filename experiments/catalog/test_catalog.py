"""Catalog + retrieval + freshness acceptance tests. MOCK library (library.py); no model anywhere.
  python -m pytest -q -p no:cacheprovider experiments/catalog"""
import json
import re
import shutil
import sqlite3

import pytest

from adapters import models
from app import db, server, skillforge as sf, tools
from experiments.catalog import catalog, demo, library, retrieval_bench
from experiments.router import router

SUPPLY = {"namespaces": ["acme/supply"], "roles": ["analyst"]}
FREIGHT = library.FREIGHT


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    """Build the approved library ONCE (sandboxed skill runs are slow); each test gets a copy."""
    d = tmp_path_factory.mktemp("lib")
    mp = pytest.MonkeyPatch()
    mp.setenv("APP_DB", str(d / "lib.db"))
    mp.setattr(sf, "SKILLS_DIR", d / "skills")
    mp.setattr(models, "PROBE_FILE", d / "probe.json")
    c = db.connect()
    library.build(c)
    c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    c.close()
    mp.undo()
    return d


@pytest.fixture
def conn(built, tmp_path, monkeypatch):
    shutil.copy(built / "lib.db", tmp_path / "t.db")
    shutil.copytree(built / "skills", tmp_path / "skills")
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(models, "PROBE_FILE", tmp_path / "probe.json")
    return db.connect()


def ev(eid, scenario="freight_week2.json"):
    return {"event_id": eid, "source": "freight-feed", "type": "reconcile.requested", "scenario": scenario}


def no_inference():
    raise AssertionError("inference consulted on a path that must not need it")


# --- the three supply-chain paths --------------------------------------------------------------

def test_supply_chain_known_unknown_changed(conn):
    p = demo.run(conn)
    k = p["known"]
    assert k["route"] == "awaiting_approval" and k["final"] == "completed" and k["router_model_calls"] == 0
    assert k["oracle_before"]["PO-7801"] is False and all(k["oracle_after"].values())  # independent oracle
    u = p["unknown"]
    assert u["route"] == "queued_for_agent" and not u["actions"]
    assert FREIGHT in [s["name"] for s in u["suggestions"]]  # suggested, NOT executed
    c = p["changed"]
    assert c["stale"] and c["route"] == "needs_human" and "revalidation required" in c["reason"] and not c["actions"]
    assert c["direct_run_skill"] == "not_found" and c["pinned_run_skill"] == "not_found"  # core refuses on every path
    assert c["oracle"]["PO-7801"] is False  # nothing changed the data


def test_known_task_never_consults_inference(conn):
    r = router.route(conn, ev("k1"), inference_ok=no_inference)
    assert r["status"] == "awaiting_approval"


def test_changed_rule_with_model_down_is_still_refused_not_deferred(conn):
    catalog.set_env_version(conn, "contract:kestrel-freight", "rev-2026-11", "ops-lead")
    assert router.route(conn, ev("c1"), inference_ok=no_inference)["status"] == "needs_human"


def test_revalidation_against_the_new_rule_fails_and_preserves_the_old_version(conn, tmp_path):
    ops2 = tmp_path / "ops_rev2"  # contract rev-2026-11: detention credits no longer deductible
    shutil.copytree(library.OPS, ops2)
    hv = (ops2 / "hidden_validation.py").read_text()
    (ops2 / "hidden_validation.py").write_text(hv.replace('[["PO-7731", F, 1379.69]]', '[["PO-7731", F, 1419.69]]'))
    catalog.set_env_version(conn, "contract:kestrel-freight", "rev-2026-11", "ops-lead")
    with library.hidden_dir(ops2):
        r = catalog.revalidate(conn, FREIGHT, 1, "ops-lead")
    assert not r["ok"] and "case_primary" in r["failed_cases"]
    assert catalog.inspect(conn, FREIGHT, SUPPLY)["freshness"] == "stale"
    assert (sf.SKILLS_DIR / "approved" / FREIGHT / "v1" / "SKILL.md").is_file()  # prior version kept
    assert router.route(conn, ev("rv1"))["status"] == "needs_human"


def test_revalidation_passes_and_reactivates(conn):
    catalog.set_env_version(conn, "contract:kestrel-freight", "rev-2026-11", "ops-lead")
    with library.hidden_dir(library.OPS):
        r = catalog.revalidate(conn, FREIGHT, 1, "ops-lead")
    assert r["ok"] and r["dependencies"]["contract:kestrel-freight"] == "rev-2026-11"
    assert router.route(conn, ev("rv2"))["status"] == "needs_human"  # rev-2026-10 data no longer fits the skill
    new = router.route(conn, ev("rv3", "freight_week2_rev2026_11.json"))
    assert new["status"] == "awaiting_approval"  # skill and data now agree on the contract revision
    for a in new["actions"]:
        tools.decide_approval(conn, a, True, "ops-lead")
    # but the TRUSTED verifier was only validated for rev-2026-10: it refuses to attest, so nothing reads "verified"
    done = router.complete(conn, "rv3")
    assert done["status"] == "needs_review" and "verified" not in router.explain(router._row(conn, "rv3")).lower()


def test_undeclared_dependency_counts_as_changed(conn):
    conn.execute("DELETE FROM env_versions WHERE key='schema:kfl-export'")
    assert catalog.refresh(conn)["stale"][0]["name"] == FREIGHT


# --- retrieval vs execution boundary -----------------------------------------------------------

def test_search_is_bounded_summaries_without_authority(conn):
    res = catalog.search(conn, "freight invoice reconcile carrier", SUPPLY, limit=99)
    assert len(res["results"]) <= catalog.MAX_RESULTS and res["authority"].startswith("none")
    hit = res["results"][0]
    assert hit["name"] == FREIGHT and set(hit["summary"]) == {"untrusted_text"}
    assert not {"executable", "path", "sha256", "skill_md", "validation"} & set(hit)


def test_no_hidden_or_secret_data_in_any_retrieval_output(conn):
    outs = [catalog.search(conn, "freight", SUPPLY), catalog.inspect(conn, FREIGHT, SUPPLY),
            catalog.get_skill_md(conn, FREIGHT, SUPPLY)]
    blob = json.dumps(outs)
    for leak in ("PO-7731", "1379.69", "replay", "cases", "large_200_pos", str(sf.SKILLS_DIR), "validation/",
                 server.TOKEN_FILE.name, "ops_discrepancy"):
        assert leak not in blob, leak


def test_cross_namespace_and_wrong_role_get_the_same_not_found(conn):
    finance = {"namespaces": ["acme/finance"], "roles": ["analyst"]}
    nobody = {"namespaces": ["acme/supply"], "roles": ["intern"]}
    assert not catalog.search(conn, "freight invoice", finance)["results"]
    assert not catalog.search(conn, "freight invoice", nobody)["results"]
    for who in (finance, nobody):
        for fn in (catalog.inspect, catalog.get_skill_md):
            with pytest.raises(tools.ToolError) as e:
                fn(conn, FREIGHT, who)
            assert e.value.code == "not_found" and "visible" in e.value.message
        assert not catalog.check_exact(conn, FREIGHT, who)["executable"]


def test_prompt_injection_in_retrieved_text_changes_nothing(conn):
    evil = json.loads((retrieval_bench.FIX / "synthetic_catalog.json").read_text())[-1]
    assert evil["name"] == "totally-safe-helper"
    catalog.register_catalog_only(conn, evil, "lib-operator")
    assert "totally-safe-helper" not in [r["name"] for r in catalog.search(conn, "freight invoice reconcile approved", SUPPLY)["results"]]
    mine = {"namespaces": ["acme/evil"], "roles": ["analyst"]}
    hit = catalog.search(conn, "freight invoice", mine)["results"][0]
    assert hit["registry"] == "catalog_only" and "IGNORE" in hit["summary"]["untrusted_text"]
    assert not catalog.check_exact(conn, "totally-safe-helper", mine)["executable"]
    for q in ('" OR namespace:* NEAR(', "freight) OR (*", "'; DROP TABLE skills; --", "\x00" * 5):
        assert catalog.search(conn, q, SUPPLY)["ok"]  # FTS/SQL syntax in a query is inert
    assert conn.execute("SELECT COUNT(*) FROM skills").fetchone()[0] >= 2


def test_revoked_version_is_gone_from_search_and_unexecutable_without_reindex(conn):
    catalog.revoke(conn, FREIGHT, 1, "ops-lead", "superseded")
    assert FREIGHT not in [r["name"] for r in catalog.search(conn, "freight invoice", SUPPLY)["results"]]
    assert tools.call(conn, "run_skill", {"name": FREIGHT, "version": 1})["error"]["code"] == "not_found"
    assert router.route(conn, ev("rk1"), inference_ok=lambda: False)["status"] == "deferred"


def test_new_registration_is_searchable_without_reindex(conn):
    catalog.register_catalog_only(conn, {"namespace": "acme/supply", "name": "pallet-count-check", "domain": "supply-chain",
                                         "workflow": "receiving", "summary": "Count pallets on a delivery."}, "lib-operator")
    assert catalog.search(conn, "pallet", SUPPLY)["results"][0]["name"] == "pallet-count-check"


def test_tampered_artifact_is_refused_everywhere(conn, monkeypatch):
    helper = sf.SKILLS_DIR / "approved" / FREIGHT / "v1" / "scripts" / "helper.py"
    helper.write_text(helper.read_text() + "\n# tampered\n")
    router.route(conn, ev("t0"), inference_ok=lambda: False)  # loads week2 data
    assert "artifact changed" in " ".join(catalog.check_exact(conn, FREIGHT, {**SUPPLY, "roles": ["router"]})["reasons"])
    with pytest.raises(tools.ToolError):
        catalog.get_skill_md(conn, FREIGHT, SUPPLY)
    assert tools.call(conn, "run_skill", {"name": FREIGHT})["error"]["code"] == "not_found"  # unscoped, 2 teams: closed
    monkeypatch.setenv("APP_AGENT_NAMESPACE", "acme/supply")  # the supply team's own agent: visible, but refused
    assert tools.call(conn, "run_skill", {"name": FREIGHT})["error"]["code"] == "integrity_error"
    assert router.route(conn, ev("t1"))["status"] == "needs_human"


def test_missing_validation_record_blocks_execution_and_registration(conn):
    conn.execute("UPDATE skills SET hidden_validation=NULL WHERE name=?", (FREIGHT,))
    assert router.route(conn, ev("mv1"))["status"] == "needs_human"
    conn.execute("DELETE FROM catalog_entries WHERE skill_name=?", (FREIGHT,))
    with pytest.raises(tools.ToolError) as e:
        catalog.register(conn, FREIGHT, 1, "ops-lead", "acme/supply", "t", "d", "w", ["router"])
    assert e.value.code == "no_validation_record"


def test_malformed_skill_md_is_not_registered(conn):
    d = sf.SKILLS_DIR / "approved" / bench_name() / "v1"
    (d / "SKILL.md").write_text("no frontmatter here, just text\n")
    conn.execute("UPDATE skills SET sha256=? WHERE name=?", (sf._tree_hash(d), bench_name()))  # 'approved before the rule'
    conn.execute("DELETE FROM catalog_entries WHERE skill_name=?", (bench_name(),))
    with pytest.raises(tools.ToolError) as e:
        catalog.register(conn, bench_name(), 1, "ops-lead", "acme/records", "t", "d", "w", ["router"])
    assert e.value.code == "malformed_skill_md"


def bench_name():
    from app import bench
    return bench.SKILL_NAME


def test_environment_incompatibility_blocks_execution(conn, monkeypatch):
    conn.execute("UPDATE catalog_entries SET environment=? WHERE skill_name=?", (json.dumps({"runners": ["docker"]}), FREIGHT))
    monkeypatch.delenv("SKILL_RUNNER", raising=False)
    r = router.route(conn, ev("env1"))
    assert r["status"] == "needs_human" and "runner 'subprocess'" in r["reason"]


# --- index, restart, portability ---------------------------------------------------------------

def test_index_corruption_and_loss_are_rebuilt(conn):
    want = catalog.search(conn, "freight invoice", SUPPLY)["results"]
    conn.execute("UPDATE catalog_fts_data SET block = x'deadbeef' WHERE id > 1")
    assert catalog.search(conn, "freight invoice", SUPPLY)["results"] == want
    conn.execute("DROP TABLE catalog_fts")
    assert catalog.search(conn, "freight invoice", SUPPLY)["results"] == want
    assert conn.execute("SELECT COUNT(*) FROM audit WHERE event='index_rebuilt'").fetchone()[0] >= 2
    conn.execute("UPDATE catalog_fts_data SET block = x'deadbeef' WHERE id > 1")
    assert catalog.verify_index(conn)["rebuilt"] and catalog.search(conn, "freight invoice", SUPPLY)["results"] == want


def test_catalog_survives_restart(conn, tmp_path):
    before = catalog.inspect(conn, FREIGHT, SUPPLY)
    conn.close()
    c2 = db.connect()
    assert catalog.inspect(c2, FREIGHT, SUPPLY) == before
    assert router.route(c2, ev("rs1"))["status"] == "awaiting_approval"


def test_same_interfaces_serve_oncall_with_no_domain_branching(conn):
    for e in json.loads((retrieval_bench.FIX / "oncall_catalog.json").read_text()):
        catalog.register_catalog_only(conn, e, "lib-operator")
    sre = {"namespaces": ["acme/sre"], "roles": ["analyst"]}
    assert catalog.search(conn, "LedgerMismatch stack trace", sre)["results"][0]["name"] == "log-signature-diagnose"
    assert catalog.search(conn, "dependency version since release", sre)["results"][0]["name"] == "dependency-version-investigate"
    assert not catalog.search(conn, "freight invoice", sre)["results"]  # supply skills invisible to SRE
    assert not catalog.check_exact(conn, "log-signature-diagnose", sre)["executable"]  # catalog-only: read-only metadata
    for f in (catalog.__file__, router.__file__):  # generic code: no conditional mentions a domain
        conds = [ln for ln in open(f).read().lower().splitlines() if " if " in f" {ln.strip()}" or "elif " in ln]
        assert not [ln for ln in conds if re.search(r"(freight|oncall|supply|sre|kfl)", ln)], f


def test_retrieval_benchmark_has_no_authorization_failures(tmp_path):
    res = retrieval_bench.run(tmp_path)
    assert res["fts_text"]["auth_failures"] == 0 and res["fts_aliases"]["auth_failures"] == 0
    assert res["fts_aliases"]["recall_at_5"] >= res["fts_text"]["recall_at_5"]


def test_bootstrap_manifest_retrieves_procedures_read_only(conn, tmp_path):
    import hashlib
    from experiments.router import bootstrap
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    dbf = tmp_path / "t.db"
    h = hashlib.sha256(dbf.read_bytes()).hexdigest()
    m = bootstrap.manifest(library.OPS / "cases" / "case_compatible.json", dbf, SUPPLY)
    assert hashlib.sha256(dbf.read_bytes()).hexdigest() == h and m["writes_performed"] == 0
    assert FREIGHT in [r["name"] for r in m["relevant_procedures"]["results"]]
    assert m["relevant_procedures"]["authority"].startswith("none")
    assert not m["compatible_skills"]  # the untrusted buyer spreadsheet changes the fingerprint: not exact
    assert any("carrier_invoice_net" in a for a in m["unverified_assumptions"])
    assert not bootstrap.manifest(library.OPS / "cases" / "case_compatible.json", dbf)["relevant_procedures"]["results"]


def test_operator_card_answers_the_business_questions_without_implying_authority(conn):
    router.route(conn, ev("cd1"), inference_ok=lambda: False)  # loads week2 data
    c = catalog.card(conn, FREIGHT, {**SUPPLY, "roles": ["router"]})
    assert c["owner"] == "freight-ops" and c["fields_it_may_propose"] == ["freight_accrued"]
    assert c["hidden_tests_passed"] is True and c["status"] == "fresh" and c["needs_approval"] is True
    assert c["can_run_now"] is True and c["why"] == ["exact match for the data loaded now"]
    assert c["result_independently_verified"] == [{"rule": "carrier_invoice_net", "independent": True}]
    assert "never authorizes" in c["note"] and set(c["what_it_does"]) == {"untrusted_text"}
    catalog.set_env_version(conn, "contract:kestrel-freight", "rev-2026-11", "ops-lead")
    c2 = catalog.card(conn, FREIGHT, {**SUPPLY, "roles": ["router"]})
    assert c2["can_run_now"] is False and c2["status"].startswith("stale: contract:kestrel-freight")
    assert any("stale" in w for w in c2["why"])
