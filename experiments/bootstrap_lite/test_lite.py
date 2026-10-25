"""Bootstrap Lite: approval/activation status correctness, read-only discovery, and the API boundary.
  python -m pytest -q -p no:cacheprovider experiments/bootstrap_lite/test_lite.py"""
import hashlib
import http.client as hc
import json
import os
import threading
from pathlib import Path

import pytest

from adapters import models
from app import bench, db, skillforge as sf, ui_api
from experiments.bootstrap_lite import lite

TOKEN = "op-token-for-tests-0123456789-abcdefghij"


@pytest.fixture
def learned(tmp_path, monkeypatch):
    """A real DB after a MOCK learn: line-total-reconcile v1 is person-approved and active."""
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("APP_OPERATOR_TOKEN", TOKEN)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(models, "PROBE_FILE", tmp_path / "probe.json")
    monkeypatch.setattr(ui_api, "_status_cache", {"at": 0.0, "value": None})
    c = db.connect()
    db.load_scenario(c)
    bench.learn(c, bench.MockAgent())
    db.load_scenario(c, lite.WORKSPACES["learn-b"])
    c.commit()
    return c


def digest():
    return hashlib.sha256(Path(os.environ["APP_DB"]).read_bytes()).hexdigest()


def by_id(r):
    return {c["id"]: c for c in r["capabilities"] + r["workflows"]}


def test_supply_chain_workspace_claims_nothing_active_without_evidence(learned):
    before = digest()
    r = lite.discover("freight-week2", learned, None)
    caps = by_id(r)
    assert digest() == before and r["writes_performed"] == 0
    assert caps["records"]["state"] == "discovered"  # read from the file, not loaded
    assert caps["evidence-carrier_export"]["state"] == "discovered"
    assert caps["inference"]["state"] == caps["sandbox"]["state"] == "unavailable"  # no health answer = not active
    # unified-alpha ships the pinned freight verifier, validated for this contract revision: the CHECK is armed...
    assert caps["check-carrier_invoice_net"]["state"] == "active"
    assert "pins.json" in caps["check-carrier_invoice_net"]["evidence"]
    assert r["summary"]["active"] == [caps["check-carrier_invoice_net"]["name"]]  # ...and nothing else is
    assert [w["state"] for w in r["workflows"]] == ["discovered"]  # the freight skill is proposed, not built
    assert all(not p["granted"] for p in r["permissions"])
    assert {p["action"] for p in r["permissions"]} >= {"set_field", "any write to this environment"}


def test_checker_follows_the_verifiers_own_gates(monkeypatch, tmp_path):
    """A changed contract, an unpinned rule or a tampered verifier file are never shown as an active check."""
    ok, _ = lite._checker("carrier_invoice_net", "accrual", {"contract:kestrel-freight": "rev-2026-10"})
    assert ok
    ok, why = lite._checker("carrier_invoice_net", "accrual", {"contract:kestrel-freight": "rev-2026-11"})
    assert not ok and "rev-2026-11" in why and "can't be verified" in why
    assert not lite._checker("no_such_rule", "x", {})[0]
    bad = tmp_path / "verifiers"
    bad.mkdir()
    (bad / "pins.json").write_text((lite.onboard.tools.VERIFIERS / "pins.json").read_text())
    (bad / "carrier_invoice_net.py").write_text("SUPPORTS = {}\ndef expected(*a): return 0\n")  # wrong sha256
    monkeypatch.setattr(lite.onboard.tools, "VERIFIERS", bad)
    assert not lite._checker("carrier_invoice_net", "accrual", {"contract:kestrel-freight": "rev-2026-10"})[0]


def test_exact_match_approved_skill_is_active_near_miss_is_only_approved(learned):
    caps = by_id(lite.discover("learn-b", learned, None))
    assert caps["records"]["state"] == "configured"  # this scenario IS loaded in the app DB
    assert caps["check-sum_lines"]["state"] == "active"  # the checker exists in code
    assert caps["skill-line-total-reconcile"]["state"] == "active"
    assert caps["wf-line-total-reconcile"]["state"] == "active"
    near = by_id(lite.discover("lookalike", learned, None))
    assert near["skill-line-total-reconcile"]["state"] == "approved"  # approved somewhere != usable here
    assert "NOT a match" in near["skill-line-total-reconcile"]["evidence"]


def test_disabled_skill_is_not_active(learned):
    sf.disable_skill(learned, "line-total-reconcile", "alice")
    learned.commit()
    caps = by_id(lite.discover("learn-b", learned, None))
    assert "skill-line-total-reconcile" not in caps
    assert [w["state"] for w in lite.discover("learn-b", learned, None)["workflows"]] == ["discovered"]


@pytest.mark.parametrize("ok,state", [(True, "active"), (False, "configured"), (None, "unavailable")])
def test_health_maps_to_state(learned, ok, state):
    st = {"inference": {"ok": ok, "model": "m" if ok else None, "detail": "d"}, "sandbox": {"ok": ok, "detail": "d"}}
    caps = by_id(lite.discover("freight-week2", learned, st))
    assert caps["inference"]["state"] == caps["sandbox"]["state"] == state
    assert (caps["inference"]["next_step"] is None) == (state == "active")


def test_illustrative_items_are_never_anything_else(learned):
    st = {"inference": {"ok": True, "detail": ""}, "sandbox": {"ok": True, "detail": ""}}
    for wid in ("freight-week2", "learn-b"):
        caps = lite.discover(wid, learned, st)["capabilities"]
        ex = [c for c in caps if c["id"].startswith("ex-")]
        assert len(ex) == 3 and {c["state"] for c in ex} == {"illustrative"}
        assert all(c["state"] in lite.STATES for c in caps)


def test_unknown_or_hostile_workspace_ids_are_refused():
    for bad in ("nope", "../app", "freight_week2", "", "A" * 50):
        with pytest.raises(ui_api.ApiError) as e:
            lite.discover(bad)
        assert e.value.status == 404


def test_api_routes_need_the_operator_session_and_stay_read_only(learned):
    lite.install()
    lite.install()  # idempotent
    assert sum(p.pattern.startswith("^/ui/bootstrap") for p, _ in ui_api.ROUTES) == 2
    srv = ui_api.make_server(port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    host = f"127.0.0.1:{srv.server_port}"

    def req(path, method="GET", auth=True):
        c = hc.HTTPConnection("127.0.0.1", srv.server_port, timeout=60)
        c.request(method, path, headers={"Host": host, **({"Authorization": f"Bearer {TOKEN}"} if auth else {})})
        r = c.getresponse()
        body = json.loads(r.read())
        c.close()
        return r.status, body
    try:
        before = digest()
        assert req("/ui/bootstrap/workspaces", auth=False)[0] == 401
        assert req("/ui/bootstrap/discover/freight-week2", auth=False)[0] == 401
        assert req("/ui/bootstrap/discover/freight-week2", method="POST")[0] == 405
        code, ws = req("/ui/bootstrap/workspaces")
        assert code == 200 and ws["workspaces"][0]["id"] == "freight-week2" and ws["workspaces"][0]["supported"]
        code, r = req("/ui/bootstrap/discover/freight-week2")
        assert code == 200 and r["read_only"] and r["manifest"]["writes_performed"] == 0
        assert by_id(r)["inference"]["state"] == "unavailable"  # LLM_BASE_URL unset: unknown, never active
        assert req("/ui/bootstrap/discover/nope")[0] == 404
        assert req("/ui/bootstrap/discover/..%2Fapp")[0] == 404
        assert digest() == before
    finally:
        srv.shutdown()
        srv.server_close()


def test_an_exact_match_is_active_only_where_the_catalog_lets_a_team_run_it():
    """Bootstrap never implies authorization: on a host WITH an organizational catalog, approval + fingerprint is not
    enough. Not catalogued, stale, revoked-away or a changed dependency all stay 'approved', never 'active'."""
    s = {"name": "freight-invoice-reconcile", "version": 1}
    key = ("freight-invoice-reconcile", 1)
    g = {"namespace": "acme/supply", "roles": ["analyst"], "freshness": "fresh", "reason": None,
         "deps": {"contract:kestrel-freight": "rev-2026-10"}}
    ctx = {"contract:kestrel-freight": "rev-2026-10"}
    assert lite._skill_state(s, None, ctx)[0] == "active"  # no catalog on this host: rc1 single-team behaviour
    state, why = lite._skill_state(s, {key: [g]}, ctx)
    assert state == "active" and "acme/supply (analyst)" in why
    assert lite._skill_state(s, {}, ctx) == ("approved", "person-approved and an exact match, but NOT usable here: "
                                             "not in the organizational catalog, so no team may run it")
    assert lite._skill_state(s, {key: [{**g, "freshness": "stale", "reason": "owner changed"}]}, ctx)[0] == "approved"
    state, why = lite._skill_state(s, {key: [g]}, {"contract:kestrel-freight": "rev-2026-11"})
    assert state == "approved" and "rev-2026-11" in why
    assert lite._skill_state(s, {key: [g]}, {})[0] == "active"  # the data doesn't say: unknown, not a mismatch
