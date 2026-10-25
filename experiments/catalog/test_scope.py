"""P0-1: agent-facing namespace isolation. The scope comes from the host (APP_AGENT_NAMESPACE / APP_AGENT_ROLES on the
`serve` process), never from tool arguments; out-of-scope skills do not exist for the agent.
  python -m pytest -q -p no:cacheprovider experiments/catalog/test_scope.py"""
import json
import shutil

import pytest

from adapters import models
from app import bench, db, server, skillforge as sf, tools
from experiments.catalog import catalog, library

RECORDS, SUPPLY = "acme/records", "acme/supply"
LINE, FREIGHT = bench.SKILL_NAME, library.FREIGHT


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    d = tmp_path_factory.mktemp("lib")
    mp = pytest.MonkeyPatch()
    mp.setenv("APP_DB", str(d / "lib.db"))
    mp.setattr(sf, "SKILLS_DIR", d / "skills")
    mp.setattr(models, "PROBE_FILE", d / "probe.json")
    c = db.connect()
    library.build(c)  # line-total in acme/records, freight in acme/supply, roles router/analyst/agent
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
    monkeypatch.delenv("APP_AGENT_NAMESPACE", raising=False)
    c = db.connect()
    db.load_scenario(c, bench.LEARN / "learn_b.json")  # line-total data
    return c


def scope(monkeypatch, ns, roles="agent"):
    monkeypatch.setenv("APP_AGENT_NAMESPACE", ns)
    monkeypatch.setenv("APP_AGENT_ROLES", roles)


def names(conn):
    return [h["name"] for h in tools.call(conn, "search_skills", {"query": "total freight invoice"})["skills"]]


def test_unscoped_single_team_host_is_rc1_behaviour(conn):
    conn.execute("DELETE FROM catalog_entries WHERE namespace=?", (SUPPLY,))  # one namespace only
    assert sorted(names(conn)) == sorted([LINE, FREIGHT])  # (freight is uncatalogued here, still rc1-visible)
    conn.execute("DROP TABLE catalog_entries")  # no catalog at all: rc1
    assert sorted(names(conn)) == sorted([LINE, FREIGHT])


def test_missing_scope_on_a_multi_team_host_fails_closed(conn, tmp_path):
    # the library holds two namespaces and the host set no APP_AGENT_NAMESPACE: the agent sees nothing
    assert names(conn) == []
    assert tools.call(conn, "run_skill", {"name": LINE, "propose": True})["error"]["code"] == "not_found"
    assert tools.call(conn, "propose_skill", {"name": FREIGHT, "path": str(tmp_path), "description": "x"}
                      )["error"]["code"] == "name_unavailable"
    assert tools.call(conn, "get_audit", {})["events"] == []  # no open task: nothing
    assert {s["name"] for s in sf.list_skills(conn)["skills"]} >= {LINE, FREIGHT}  # the operator is unaffected


def test_an_approved_but_uncatalogued_name_cannot_be_taken_either(conn, monkeypatch, tmp_path):
    conn.execute("DELETE FROM catalog_entries WHERE skill_name=?", (LINE,))
    scope(monkeypatch, SUPPLY)
    r = tools.call(conn, "propose_skill", {"name": LINE, "path": str(tmp_path), "description": "mine now"})
    assert r["error"]["code"] == "name_unavailable"


def test_no_agent_result_exposes_skill_files_or_hidden_suites(conn, monkeypatch):
    scope(monkeypatch, RECORDS)
    out = json.dumps([tools.call(conn, "search_skills", {"query": "total"}),
                      tools.call(conn, "run_skill", {"name": LINE}), tools.call(conn, "get_audit", {})])
    for leak in ("approved/", "approved\\\\", "hidden", "SKILL.md", "def run("):
        assert leak not in out, leak


def test_other_teams_skills_do_not_exist_for_the_agent(conn, monkeypatch):
    scope(monkeypatch, SUPPLY)
    assert names(conn) == [FREIGHT]
    hidden = tools.call(conn, "run_skill", {"name": LINE, "propose": True})
    absent = tools.call(conn, "run_skill", {"name": "no-such-skill", "propose": True})
    assert hidden["error"]["code"] == absent["error"]["code"] == "not_found"
    assert hidden["error"]["message"] == f"no approved, active skill '{LINE}'"  # same wording as a missing skill
    assert tools.call(conn, "run_skill", {"name": LINE, "version": 1})["error"]["code"] == "not_found"  # pinned, too
    assert conn.execute("SELECT COUNT(*) FROM actions").fetchone()[0] == 0
    scope(monkeypatch, RECORDS)
    assert names(conn) == [LINE]
    assert tools.call(conn, "run_skill", {"name": LINE, "propose": True})["ok"]


def test_the_matcher_only_sees_the_callers_skills(conn, monkeypatch):
    scope(monkeypatch, SUPPLY)
    hit = tools.call(conn, "search_skills", {"query": ""})
    assert not any(h["compatible"] for h in hit["skills"]) and "no compatible skill" in hit["recommendation"]
    assert LINE not in json.dumps(hit)  # not even as a near miss


@pytest.mark.parametrize("tool,args", [
    ("search_skills", {"query": "", "namespace": RECORDS}),
    ("run_skill", {"name": LINE, "namespace": RECORDS}),
    ("get_audit", {"namespace": RECORDS}),
])
def test_a_forged_namespace_argument_is_refused(conn, monkeypatch, tool, args):
    scope(monkeypatch, SUPPLY)
    r = tools.call(conn, tool, args)
    assert r["error"]["code"] == "invalid_input"
    body = {"tool": tool, "args": {k: v for k, v in args.items() if k != "namespace"}, "namespace": RECORDS}
    assert server.handle(conn, body).get("ok") in (True, False)  # top-level extras are ignored, never trusted
    assert LINE not in json.dumps(server.handle(conn, {"tool": "search_skills", "args": {}, "namespace": RECORDS}))


def test_agent_audit_is_limited_to_its_own_task(conn, monkeypatch):
    scope(monkeypatch, RECORDS)
    tools.call(conn, "run_skill", {"name": LINE})  # an earlier task's activity
    scope(monkeypatch, SUPPLY)
    assert tools.call(conn, "get_audit", {})["events"] == []  # no open task: nothing
    sf.task_begin(conn, "supply task", "mock")
    tools.call(conn, "read_records", {})
    ev = tools.call(conn, "get_audit", {"limit": 50})["events"]
    assert ev and ev[0]["event"] == "task_begin" and LINE not in json.dumps(ev)
    sf.task_end(conn)
    assert len(tools.get_audit(conn, 500)["events"]) > len(ev)  # the operator still sees everything


def test_an_agent_cannot_take_over_another_teams_skill_name(conn, monkeypatch, tmp_path):
    scope(monkeypatch, SUPPLY)
    r = tools.call(conn, "propose_skill", {"name": LINE, "path": str(tmp_path), "description": "mine now"})
    assert r["error"]["code"] == "name_unavailable" and RECORDS not in r["error"]["message"]


def test_stale_and_uncatalogued_skills_are_invisible(conn, monkeypatch):
    scope(monkeypatch, SUPPLY)
    catalog.set_env_version(conn, "contract:kestrel-freight", "rev-2026-11", "ops-lead")  # freight goes stale
    assert names(conn) == []
    conn.execute("DROP TABLE catalog_entries")  # no catalog on this host at all
    scope(monkeypatch, RECORDS)
    assert names(conn) == [] and tools.call(conn, "run_skill", {"name": LINE})["error"]["code"] == "not_found"


def test_roles_matter_and_operator_commands_are_never_scoped(conn, monkeypatch):
    scope(monkeypatch, RECORDS, roles="intern")
    assert names(conn) == []
    assert {s["name"] for s in sf.list_skills(conn)["skills"]} >= {LINE, FREIGHT}  # host CLI: unscoped
