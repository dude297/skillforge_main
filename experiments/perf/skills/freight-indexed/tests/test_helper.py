# MOCK-AUTHORED FIXTURE. Expected values computed by hand, not by calling the helper.
from helper import run


def ds(accrued, lines, currency="USD", po="P1"):
    return {"records": [{"id": po, "kind": "freight_po", "data": {"label": po, "currency": currency, "freight_accrued": accrued}}],
            "evidence": [{"record_id": po, "source": "carrier_export", "trusted": True, "data": {"lines": lines}}]}


INV = ["HDR KFL-INV-1  P1 USD 20261001", "LIN 001 LHL 000010000 D  linehaul", "LIN 002 ACC 000001000 C  credit",
       "TRL 002 000009000 D"]


def test_mismatch_is_proposed():
    assert run(ds(100.0, INV))["proposals"][0]["value"] == 90.0


def test_match_is_left_alone():
    assert run(ds(90.0, INV))["proposals"] == []


def test_other_currency_gets_no_proposal():
    assert run(ds(100.0, [INV[0].replace("USD", "CAD")] + INV[1:]))["proposals"] == []


def test_other_currency_is_refused_for_review_not_skipped():
    out = run(ds(100.0, [INV[0].replace("USD", "CAD")] + INV[1:]))
    assert out["refused"] == [{"record_id": "P1", "code": "requires_review",
                               "reason": "invoice currency CAD != PO currency USD: needs FX handling"}]


def test_record_without_invoice_is_not_applicable():
    d = ds(100.0, INV)
    d["evidence"] = []
    assert run(d)["refused"][0]["code"] == "not_applicable"
