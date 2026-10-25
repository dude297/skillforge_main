"""Freight accrual domain (SYNTHETIC data): read-only freight_invoice tool, the verifier's own carrier_invoice_net
rule, hidden validation of the MOCK-authored skill, and the full message -> approval -> verify -> reply rehearsal."""
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

from app import bench, db, skillforge as sf, tools

FREIGHT = db.ROOT / "data" / "freight"
FIXTURE = db.ROOT / "tests" / "fixtures" / "freight_skill"


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(sf, "SKILLS_DIR", tmp_path / "skills")
    return db.connect()


def fix(conn, po, value, approver="alice"):
    a = tools.call(conn, "propose_action", {"record_id": po, "action_type": "set_field",
                                            "params": {"field": "freight_accrued", "value": value}, "reason": "test"})
    assert a["ok"], a
    tools.call(conn, "request_approval", {"action_id": a["action"]["id"]})
    tools.decide_approval(conn, a["action"]["id"], True, approver)
    tools.call(conn, "execute_action", {"action_id": a["action"]["id"]})
    return tools.call(conn, "verify_action", {"action_id": a["action"]["id"]})


def oracle(conn):
    """Independent of app/tools.py: the ops fixture's own regex re-count (validation/freight_accrual.py)."""
    _, hv = sf.find_hidden_suite("ops-freight-accrual-primary")
    return {r["id"]: hv.verify(json.loads(r["data"])["freight_accrued"], json.loads(r["ev"])["lines"]) for r in conn.execute(
        "SELECT r.id, r.data, e.data ev FROM records r JOIN evidence e ON e.record_id=r.id "
        "WHERE e.source='carrier_export' AND e.trusted=1")}


def test_freight_invoice_tool_reads_and_flags_but_changes_nothing(conn):
    db.load_scenario(conn, FREIGHT / "case_primary.json")
    before = bench.records_state(conn)
    r = tools.call(conn, "freight_invoice", {"record_id": "PO-7731"})
    assert r["ok"] and r["invoices"][0]["lines_net"] == 1379.69 and r["invoices"][0]["issues"] == []
    assert r["invoices"][0]["header"]["invoice_id"] == "KFL-INV-20417"
    db.load_scenario(conn, FREIGHT / "case_incompatible.json")
    cad = tools.call(conn, "freight_invoice", {"record_id": "PO-9902"})["invoices"][0]["issues"]
    assert any("CAD" in i for i in cad)
    db.load_scenario(conn, FREIGHT / "case_compatible.json")
    assert len(tools.call(conn, "freight_invoice", {"record_id": "PO-8811"})["invoices"]) <= 1  # untrusted ignored
    db.load_scenario(conn, FREIGHT / "case_primary.json")
    assert bench.records_state(conn) == before


def test_verifier_accepts_only_the_invoice_net(conn):
    db.load_scenario(conn, FREIGHT / "case_primary.json")
    assert not oracle(conn)["PO-7731"]
    wrong = fix(conn, "PO-7731", 1379.00)  # within policy, wrong value
    assert not wrong["passed"] and any(c["check"].startswith("invariant:carrier_invoice_net") for c in wrong["checks"])
    db.load_scenario(conn, FREIGHT / "case_primary.json")
    right = fix(conn, "PO-7731", 1379.69)
    assert right["passed"] and all(oracle(conn).values())


def test_verifier_never_verifies_outside_the_rule(conn):
    db.load_scenario(conn, FREIGHT / "case_incompatible.json")
    naive = fix(conn, "PO-9902", 1518.00)  # the naive line sum of a CAD invoice
    assert not naive["passed"]
    assert any(v.get("unverifiable") for v in tools.invariant_violations(conn, "PO-9902"))


@pytest.mark.parametrize("line", ["LIN 004 DTY 000012000 D  customs duty", "LIN 004 LHL 0001234.5 D", "garbage"])
def test_verifier_treats_unknown_format_as_unverifiable(line):
    lines = ["HDR KFL-INV-1  P1 USD 20261001", "LIN 001 LHL 000010000 D  x", line, "TRL 001 000010000 D"]
    v = tools._domain_verifier("carrier_invoice_net")
    with pytest.raises(ValueError):
        v.expected("P1", {"currency": "USD"}, [{"lines": lines}], {})
    assert v.expected("P1", {"currency": "USD"}, [{"lines": lines[:2] + lines[3:]}], {}) == 100.0


# --- the verifier attests only what it can check; everything else is unverifiable, never "verified" -----------

def _scenario(tmp_path, base, **policy):
    d = json.loads((FREIGHT / base).read_text(encoding="utf-8"))
    d["policy"].update(policy)
    f = tmp_path / f"s{len(policy)}.json"
    f.write_text(json.dumps(d), encoding="utf-8")
    return f


def test_unknown_rule_is_never_silently_skipped(conn, tmp_path):
    db.load_scenario(conn, _scenario(tmp_path, "case_primary.json",
                                     invariants=[{"rule": "made_up_rule", "field": "freight_accrued", "source": "carrier_export"}]))
    v = fix(conn, "PO-7731", 1379.69)
    assert not v["passed"]
    bad = [c for c in v["checks"] if c["check"].startswith("invariant:made_up_rule")]
    assert bad and bad[0]["unverifiable"] and "no trusted verifier" in bad[0]["reason"]


def test_tampered_or_unpinned_verifier_is_refused(conn, tmp_path, monkeypatch):
    vdir = tmp_path / "verifiers"
    shutil.copytree(tools.VERIFIERS, vdir)
    (vdir / "carrier_invoice_net.py").write_text((vdir / "carrier_invoice_net.py").read_text() + "\n# edited\n")
    monkeypatch.setattr(tools, "VERIFIERS", vdir)
    db.load_scenario(conn, FREIGHT / "case_primary.json")
    v = fix(conn, "PO-7731", 1379.69)  # the right number, but nobody trusted can attest it
    assert not v["passed"] and any("not the pinned version" in c.get("reason", "") for c in v["checks"])
    (vdir / "pins.json").unlink()
    assert tools.invariant_violations(conn, "PO-7731")[0]["unverifiable"]


def test_newer_contract_revision_invalidates_the_verifier(conn):
    db.load_scenario(conn, FREIGHT / "week2_rev2026_11.json")
    v = fix(conn, "PO-7801", 952.50)  # correct under the OLD contract; the new revision changes the rule
    assert not v["passed"]
    reason = next(c["reason"] for c in v["checks"] if c.get("unverifiable"))
    assert "rev-2026-11" in reason and "not validated" in reason


@pytest.mark.parametrize("value", [952.49, 952.51, 977.50, 500.0])  # off by a cent, credit ignored, arbitrary (0 is refused earlier by policy)
def test_incorrect_freight_charge_cannot_verify(conn, value):
    db.load_scenario(conn, FREIGHT / "week2.json")
    v = fix(conn, "PO-7801", value)
    assert not v["passed"]
    db.load_scenario(conn, FREIGHT / "week2.json")
    assert fix(conn, "PO-7801", 952.50)["passed"]  # and the correct one does


def test_mock_authored_skill_passes_the_hidden_suite_and_reuses_on_week2(conn):
    res = sf.hidden_check(FIXTURE, "ops-freight-accrual-primary", None)
    assert res["ok"], [c for c in res["cases"] if not c["ok"]]
    assert len(res["cases"]) == 12


def test_agent_skill_doc_lists_every_agent_tool():
    doc = (db.ROOT / "adapters" / "openclaw" / "skill" / "SKILL.md").read_text(encoding="utf-8")
    listed = set(re.findall(r"^\| (\w+) \|", doc, re.M)) - {"tool"}
    assert listed == set(tools.agent_tools())


def test_freight_rehearsal_end_to_end(tmp_path):
    """Real service + CLI + verifier + hidden suite; SCRIPTED agent; SIMULATED channel."""
    dbp = tmp_path / "r" / "app.db"
    p = subprocess.run([sys.executable, "scripts/rehearse_freight.py", "--db", str(dbp), "--fresh", "--pace", "0",
                        "--port", "8791"], cwd=db.ROOT, capture_output=True, text=True, encoding="utf-8", timeout=400,
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    assert p.returncode == 0, p.stdout[-2000:] + p.stderr[-2000:]
    out = json.loads(p.stdout[p.stdout.index("{\n"):])
    assert out["mock_agent"] and out["model_calls"] is None and out["expectations_met"]
    assert out["act1"]["skill"]["status"] == "tested" and out["act2"]["skill_used"] == "freight-invoice-reconcile@v1"
    i = out["act2"]["intervention"]
    assert i["actions"] == [] and i["skill_proposals"] == 0 and "CAD" in i["needs_person"][0][1]
    msgs = [json.loads(x) for x in (dbp.parent / "messages.jsonl").read_text(encoding="utf-8").splitlines()]
    assert all(m["channel"] == "SIMULATED" for m in msgs)
    agent = [m["text"] for m in msgs if m["from"] == "agent"]
    assert sum("independently verified" in t for t in agent) == 2 and "Needs a person" in agent[-1]
    c = db.connect(str(dbp))  # the records the employee asked about really changed, and only after approval
    actors = [r[0] for r in c.execute("SELECT actor FROM audit WHERE event='approval_approved'")]  # audit survives resets
    assert len(actors) == 2 and set(actors) == {"human:rehearsal-operator"}
    assert c.execute("SELECT COUNT(*) FROM audit WHERE event='skill_approved'").fetchone()[0] == 1
    assert c.execute("SELECT COUNT(*) FROM audit WHERE event='execute_refused'").fetchone()[0] >= 1


# --- a skill says what it will NOT decide; silence is never "nothing to change" ------------------------------

def _learned_freight(conn):
    db.load_scenario(conn, FREIGHT / "case_primary.json")
    sf.task_begin(conn, "learn freight", "mock")
    fix(conn, "PO-7731", 1379.69)
    p = tools.call(conn, "propose_skill", {"name": "freight-invoice-reconcile", "path": str(FIXTURE),
                                           "description": "freight accrual = carrier invoice net", "tags": ["freight"]})
    sf.task_end(conn)
    assert p["status"] == "tested", p
    sf.approve_skill(conn, "freight-invoice-reconcile", p["version"], "alice")


def test_mixed_batch_reports_every_record(conn):
    _learned_freight(conn)
    db.load_scenario(conn, FREIGHT / "mixed.json")
    r = tools.call(conn, "run_skill", {"name": "freight-invoice-reconcile", "propose": True})
    assert r["contract"] == "v2"
    status = {k: v["status"] for k, v in r["outcomes"].items()}
    assert status == {"PO-8101": "change_proposed", "PO-8102": "no_change", "PO-8103": "requires_review",
                      "PO-8104": "insufficient_evidence"}
    assert r["needs_person"] == ["PO-8103", "PO-8104"] and "CAD" in r["outcomes"]["PO-8103"]["reason"]
    assert [a["record_id"] for a in r["actions"]] == ["PO-8101"]  # only the supported record gets a proposal
    tools.decide_approval(conn, r["actions"][0]["id"], True, "alice")
    tools.call(conn, "execute_action", {"action_id": r["actions"][0]["id"]})
    assert tools.call(conn, "verify_action", {"action_id": r["actions"][0]["id"]})["passed"]
    # the refused records stay unverifiable: the task as a whole is NOT a success
    left = {v["record_id"] for v in tools.invariant_violations(conn)}
    assert left == {"PO-8103", "PO-8104"}


def test_v1_skill_silence_is_not_reported_never_no_change():
    data = {"records": [{"id": "A", "kind": "k", "data": {}}, {"id": "B", "kind": "k", "data": {}}], "evidence": []}
    v1 = sf.outcomes(data, [{"record_id": "A", "field": "f", "value": 1}], None)
    assert v1["B"]["status"] == "not_reported" and v1["A"]["status"] == "change_proposed"
    assert sf.outcomes(data, [], [])["B"]["status"] == "no_change"


@pytest.mark.parametrize("out", [
    {"proposals": [], "refused": [{"record_id": "A", "code": "looks_fine"}]},            # unknown code
    {"proposals": [], "refused": "all good"},                                              # not a list
    {"proposals": [{"record_id": "A", "field": "f", "value": 1}], "refused": [{"record_id": "A", "code": "requires_review"}]},
    {"proposals": [], "refused": [{"record_id": "A", "code": "requires_review", "evidence": "copied"}]},  # extra keys
])
def test_malformed_refusals_reject_the_whole_output(out):
    assert sf._valid_proposals(out, 5) is None


def test_hidden_suite_rejects_a_v2_skill_that_hides_a_refusal(tmp_path):
    bad = tmp_path / "bad"
    shutil.copytree(FIXTURE, bad)
    h = bad / "scripts" / "helper.py"
    h.write_text(h.read_text().replace('return {"proposals": out["proposals"], "refused": refused}',
                                       'return {"proposals": out["proposals"], "refused": []}'))
    res = sf.hidden_check(bad, "ops-freight-accrual-primary", None)
    failed = {c["case"] for c in res["cases"] if not c["ok"]}
    assert not res["ok"] and "case_incompatible_currency_escalated" in failed



def test_a_v1_skill_cannot_pass_a_suite_that_requires_escalations(tmp_path):
    """Contract v1 reports no refusals, so it cannot show the records a person must see. Before unified-alpha it
    passed such cases silently (a residual risk found in review) and could be promoted as verified."""
    v1 = tmp_path / "v1"
    shutil.copytree(FIXTURE, v1)
    h = v1 / "scripts" / "helper.py"
    h.write_text(h.read_text().replace('return {"proposals": out["proposals"], "refused": refused}',
                                       'return {"proposals": out["proposals"]}'))
    res = sf.hidden_check(v1, "ops-freight-accrual-primary", None)
    bad = {c["case"]: c["detail"] for c in res["cases"] if not c["ok"]}
    assert not res["ok"] and "case_incompatible_currency_escalated" in bad
    assert "contract v1" in bad["case_incompatible_currency_escalated"]
    assert all(c["ok"] for c in res["cases"] if c["case"] not in bad)  # cases needing no escalation still pass


def test_a_verified_freight_change_names_the_business_rule_that_held(conn):
    db.load_scenario(conn, FREIGHT / "week2.json")
    v = fix(conn, "PO-7801", 952.50)
    assert v["passed"]
    assert {"check": "business_rule:carrier_invoice_net", "passed": True, "by": "pinned verifier v1"} in v["checks"]


def test_rehearsal_never_says_verified_when_nothing_was_applied(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("rf", db.ROOT / "scripts" / "rehearse_freight.py")
    rf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rf)
    said = []
    fake = type("R", (), {"say": lambda self, who, text: said.append(text)})()
    rf.FreightRehearsal._report(fake, [], [], [])
    rf.FreightRehearsal._report(fake, [1], [{"action_id": 1, "passed": False}], ["PO-1 x -> y"])
    assert "verified" not in said[0].replace("nothing was verified", "") and "FAILED" in said[1]


def _pinned(tmp_path, monkeypatch, body):
    """A verifiers/ dir whose carrier_invoice_net module is `body`, correctly pinned (the host trusted it)."""
    import hashlib
    vdir = tmp_path / "verifiers"
    vdir.mkdir()
    (vdir / "carrier_invoice_net.py").write_bytes(body.encode())
    (vdir / "pins.json").write_text(json.dumps({"carrier_invoice_net": hashlib.sha256(body.encode()).hexdigest()}))
    monkeypatch.setattr(tools, "VERIFIERS", vdir)


@pytest.mark.parametrize("body", [
    "SUPPORTS = {}\ndef expected(rid, data, rows, inv):\n    return 1 / 0\n",  # crashes on use
    "def expected(rid, data, rows, inv):\n    return 952.5\n",                # no SUPPORTS declared
    "raise RuntimeError('broken at import')\n",
])
def test_a_broken_pinned_verifier_is_unverifiable_never_a_crash_or_a_pass(conn, tmp_path, monkeypatch, body):
    _pinned(tmp_path, monkeypatch, body)
    db.load_scenario(conn, FREIGHT / "week2.json")
    v = fix(conn, "PO-7801", 952.50)
    assert not v["passed"] and any(c.get("unverifiable") for c in v["checks"])


def test_a_record_the_rule_cannot_cover_is_never_verified(conn, tmp_path):
    d = json.loads((FREIGHT / "week2.json").read_text(encoding="utf-8"))
    d["evidence"] = [e for e in d["evidence"] if e["record_id"] != "PO-7801"]  # no invoice for this PO
    f = tmp_path / "noinv.json"
    f.write_text(json.dumps(d), encoding="utf-8")
    db.load_scenario(conn, f)
    v = fix(conn, "PO-7801", 952.50)  # field check passes; nothing can check the business rule
    assert not v["passed"]
    assert {"check": "business_rule:carrier_invoice_net", "passed": False, "unverifiable": True,
            "reason": "no trusted evidence covers this record, so the rule could not be checked"} in v["checks"]
