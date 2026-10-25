import copy

import hidden_validation as hv
import reference_transform as rt


def test_reference_transform_passes_hidden_suite():
    res = hv.check(rt.transform)
    assert res["ok"], [c for c in res["cases"] if not c["ok"]]
    assert len(res["cases"]) >= 8


def test_primary_and_compatible_solved_by_same_transform_and_verified_independently():
    for name, po in (("case_primary", "PO-7731"), ("case_compatible", "PO-8810")):
        data = hv._file(name)
        out = rt.transform(data)
        assert out["escalate"] == [] and [p["record_id"] for p in out["proposals"]] == [po]
        # simulate the approved execution, then verify from the raw lines without the transform
        for rec in data["records"]:
            for p in out["proposals"]:
                if p["record_id"] == rec["id"]:
                    rec["data"][p["field"]] = p["value"]
            lines = next(e["data"]["lines"] for e in data["evidence"]
                         if e["record_id"] == rec["id"] and e["source"] == "carrier_export")
            assert hv.verify(rec["data"]["freight_accrued"], lines), rec["id"]


def test_incompatible_case_is_escalated_not_auto_fixed():
    data = hv._file("case_incompatible")
    out = rt.transform(data)
    assert out["proposals"] == []
    assert out["escalate"][0]["record_id"] == "PO-9902" and "CAD" in out["escalate"][0]["reason"]
    # a naive "just sum the lines" helper would have proposed the wrong number:
    assert hv.independent_net(data["evidence"][0]["data"]["lines"]) == 1518.00


def test_hidden_suite_rejects_naive_helper_that_ignores_currency():
    def naive(dataset):
        return {"escalate": [], "proposals": [
            {"record_id": r["id"], "field": "freight_accrued", "value": v}
            for r in dataset["records"] for e in dataset["evidence"]
            if e["record_id"] == r["id"] and e["trusted"]
            and (v := hv.independent_net(e["data"]["lines"])) != r["data"]["freight_accrued"]]}

    res = hv.check(naive)
    failed = {c["case"] for c in res["cases"] if not c["ok"]}
    assert not res["ok"] and "case_incompatible_currency_escalated" in failed


def test_transform_is_deterministic_and_pure():
    data = hv._file("case_compatible")
    before = copy.deepcopy(data)
    assert rt.transform(data) == rt.transform(data)
    assert data == before
