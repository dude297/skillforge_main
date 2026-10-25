"""HIDDEN independent validation for the 'freight accrual vs carrier invoice' family (SYNTHETIC data).

Same style as validation/sum_lines.py: human-written, never packaged, never shown to the agent. Expectations
are written by hand, or (large case) computed by `independent_net`, a separate regex re-count of the raw
LIN lines that shares no code with reference_transform.py. It doubles as the post-execution verifier.
"""
import json
import re
from pathlib import Path

SCENARIOS = ["ops-freight-accrual-primary", "ops-freight-accrual-compatible"]
CASES_DIR = Path(__file__).resolve().parent / "cases"
F = "freight_accrued"
_LIN = re.compile(r"^LIN\s+\d+\s+[A-Z]{3}\s+(\d{9})\s+([DC])\b")


def independent_net(lines):
    """Invoice net from the raw export: debit LIN amounts minus credit LIN amounts, implied cents -> units."""
    cents = sum(int(m[1]) * (1 if m[2] == "D" else -1) for m in map(_LIN.match, lines) if m)
    return round(cents / 100, 2)


def verify(po_value, lines):
    """Independent post-execution check: the PO now equals the carrier net recomputed from raw lines."""
    return round(float(po_value), 2) == independent_net(lines)


def kfl(po, items, cur="USD", trl=None):
    """items: [(code, cents, 'D'|'C')]. trl overrides the trailer line (None = correct trailer, '' = omit)."""
    out = [f"HDR KFL-INV-90000  {po:<10} {cur} 20261020"]
    out += [f"LIN {i:03d} {c} {a:09d} {f}  synthetic" for i, (c, a, f) in enumerate(items, 1)]
    net = sum(a if f == "D" else -a for _, a, f in items)
    default = f"TRL {len(items):03d} {abs(net):09d} {'D' if net >= 0 else 'C'}"
    return out + ([default] if trl is None else [trl] if trl else [])


def ds(rows, untrusted=()):
    """rows: (po, accrued, currency, lines_or_None or [lines, lines] for duplicate invoices)."""
    records, evidence = [], []
    for po, accrued, cur, lines in rows:
        records.append({"id": po, "kind": "freight_po", "data": {"label": po, "currency": cur, F: accrued}})
        for ls in ([] if lines is None else lines if lines and isinstance(lines[0], list) else [lines]):
            evidence.append({"record_id": po, "source": "carrier_export", "trusted": po not in untrusted,
                             "data": {"lines": ls}})
    return {"records": records, "evidence": evidence}


def _file(name):
    return json.loads((CASES_DIR / f"{name}.json").read_text(encoding="utf-8"))


def _large(n):
    rows, expected = [], []
    for i in range(n):
        lines = kfl(f"PO-L{i}", [("LHL", 10000 + i * 37, "D"), ("FSC", 1500 + i, "D"), ("ACC", i % 400, "C")])
        truth = independent_net(lines)
        rows.append((f"PO-L{i}", truth + 5 if i % 5 == 0 else truth, "USD", lines))
        if i % 5 == 0:
            expected.append([f"PO-L{i}", F, truth])
    return ds(rows), expected


def cases():
    big, big_expected = _large(200)
    lhl = [("LHL", 50000, "D"), ("FSC", 7500, "D")]
    return [
        {"name": "case_primary", "dataset": _file("case_primary"),
         "expect": {"proposals": [["PO-7731", F, 1379.69]], "escalate": []}},
        {"name": "case_compatible", "dataset": _file("case_compatible"),
         "expect": {"proposals": [["PO-8810", F, 1048.85]], "escalate": []}},
        {"name": "case_incompatible_currency_escalated", "dataset": _file("case_incompatible"),
         "expect": {"proposals": [], "escalate": ["PO-9902"]}},
        {"name": "all_correct_no_proposals",
         "dataset": ds([("P1", 575.00, "USD", kfl("P1", lhl)), ("P2", 0.0, "USD", kfl("P2", []))]),
         "expect": {"proposals": [], "escalate": []}},
        {"name": "implied_cents_not_dollars_and_credit",
         "dataset": ds([("C1", 1.00, "USD", kfl("C1", [("ACC", 99, "D")])),
                        ("C2", 100.00, "USD", kfl("C2", [("LHL", 10000, "D"), ("ACC", 3000, "C")]))]),
         "expect": {"proposals": [["C1", F, 0.99], ["C2", F, 70.0]], "escalate": []}},
        {"name": "truncated_export_trailer_mismatch",
         "dataset": ds([("T1", 1.00, "USD", kfl("T1", lhl, trl="TRL 003 000057500 D")),
                        ("T2", 1.00, "USD", kfl("T2", lhl, trl=""))]),
         "expect": {"proposals": [], "escalate": ["T1", "T2"]}},
        {"name": "unknown_charge_code_customs_duty",
         "dataset": ds([("D1", 1.00, "USD", kfl("D1", [("LHL", 50000, "D"), ("DTY", 12000, "D")]))]),
         "expect": {"proposals": [], "escalate": ["D1"]}},
        {"name": "malformed_amount_with_decimal_point",
         "dataset": ds([("M1", 1.00, "USD", ["HDR KFL-INV-1  M1 USD 20261020",
                                             "LIN 001 LHL 0001234.5 D", "TRL 001 000123450 D"]),
                        ("M2", 1.00, "USD", kfl("M2", lhl))]),
         "expect": {"proposals": [["M2", F, 575.0]], "escalate": ["M1"]}},
        {"name": "invoice_for_other_po",
         "dataset": ds([("X1", 1.00, "USD", kfl("X9", lhl))]),
         "expect": {"proposals": [], "escalate": ["X1"]}},
        {"name": "duplicate_invoices_escalated",
         "dataset": ds([("DUP", 1.00, "USD", [kfl("DUP", lhl), kfl("DUP", lhl)])]),
         "expect": {"proposals": [], "escalate": ["DUP"]}},
        {"name": "untrusted_ignored_and_no_evidence",
         "dataset": ds([("U1", 1.00, "USD", kfl("U1", lhl)), ("N1", 1.00, "USD", None)], untrusted={"U1"}),
         "expect": {"proposals": [], "escalate": []}},
        {"name": "large_200_pos", "dataset": big, "expect": {"proposals": big_expected, "escalate": []}},
    ]


def check(transform):
    """Run every case against a candidate transform. -> {"ok": bool, "cases": [{"case", "ok", "detail"}]}."""
    results = []
    for case in cases():
        exp = case["expect"]
        try:
            out = transform(case["dataset"])
            got_p = {(p["record_id"], p["field"], round(p["value"], 9)) for p in out["proposals"]}
            got_e = {e["record_id"] for e in out["escalate"]}
            ok = got_p == {(a, b, round(c, 9)) for a, b, c in exp["proposals"]} and got_e == set(exp["escalate"])
            detail = "ok" if ok else f"proposals={sorted(got_p)[:5]} escalate={sorted(got_e)}"
        except Exception as e:  # a crash is a failure: incompatible input must be escalated, not blow up
            ok, detail = False, f"{type(e).__name__}: {e}"
        results.append({"case": case["name"], "ok": ok, "detail": detail})
    return {"ok": all(r["ok"] for r in results), "cases": results}


if __name__ == "__main__":
    import reference_transform
    print(json.dumps(check(reference_transform.transform), indent=1))
