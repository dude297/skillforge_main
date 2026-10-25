"""HIDDEN independent validation for the 'derived totals' problem family (record total = sum(lines) / scale).

Human-written. Never packaged into the sandbox (scripts/package_skill.sh copies only app/, adapters/llm.py, data/),
never passed to the agent, and expectations are written out by hand or computed here, not by any candidate helper.
Used by `skill approve` (dev/host) or `skill hidden-check` (host) before promotion.
"""
SCENARIOS = ["learn-a-derived-totals", "learn-b-derived-totals"]


def ds(rows, untrusted=()):
    """rows: (record_id, total_or_None, lines_or_None, scale). None = field missing (malformed)."""
    records, evidence = [], []
    for rid, total, lines, scale in rows:
        data = {"label": rid} | ({} if total is None else {"total": total})
        records.append({"id": rid, "kind": "batch", "data": data})
        if lines is not None:
            evidence.append({"record_id": rid, "source": "line_export", "trusted": rid not in untrusted,
                             "data": {"lines": lines, "scale": scale}})
    return {"records": records, "evidence": evidence}


def _large(n):
    rows, expected = [], []
    for i in range(n):
        lines, scale = [i * 3, 100, 7], 100
        truth = sum(lines) / scale
        total = truth + 1 if i % 7 == 0 else truth  # every 7th record is wrong by exactly 1
        rows.append((f"L{i}", total, lines, scale))
        if i % 7 == 0:
            expected.append([f"L{i}", "total", truth])
    return ds(rows), expected


def cases():
    big, big_expected = _large(500)
    return [
        {"name": "unseen_values_scale_10",
         "dataset": ds([("Q1", 3.0, [10, 25], 10), ("Q2", 1.0, [5], 10), ("Q3", 4.0, [40], 10)]),
         "expect": {"proposals": [["Q1", "total", 3.5], ["Q2", "total", 0.5]]}},
        {"name": "unseen_scale_1",
         "dataset": ds([("S1", 10, [4, 5], 1)]),
         "expect": {"proposals": [["S1", "total", 9.0]]}},
        {"name": "all_correct_no_proposals",
         "dataset": ds([("C1", 2.5, [250], 100), ("C2", 0.01, [1], 100)]),
         "expect": {"proposals": []}},
        {"name": "boundary_zero_and_empty_lines",
         "dataset": ds([("Z1", 0.0, [], 100), ("Z2", 5.0, [], 100), ("Z3", 0.0, [0, 0], 100)]),
         "expect": {"proposals": [["Z2", "total", 0.0]]}},
        {"name": "untrusted_evidence_ignored",
         "dataset": ds([("U1", 1.0, [500], 100), ("U2", 1.0, [500], 100)], untrusted={"U1"}),
         "expect": {"proposals": [["U2", "total", 5.0]]}},
        {"name": "record_without_evidence",
         "dataset": ds([("N1", 9.0, None, 100), ("N2", 9.0, [800], 100)]),
         "expect": {"proposals": [["N2", "total", 8.0]]}},
        {"name": "single_record", "dataset": ds([("ONE", 1.0, [150], 100)]),
         "expect": {"proposals": [["ONE", "total", 1.5]]}},
        {"name": "large_500_records", "dataset": big, "expect": {"proposals": big_expected}},
        {"name": "malformed_line_values",
         "dataset": ds([("M1", 1.0, ["x", 5], 100), ("M2", 1.0, [100], 100)]),
         "expect": {"no_proposals_for": ["M1"], "error_ok": True}},
        {"name": "malformed_missing_total",
         "dataset": ds([("T1", None, [100], 100), ("T2", 2.0, [100], 100)]),
         "expect": {"no_proposals_for": ["T1"], "error_ok": True}},
        {"name": "unrelated_mixed_currency_refused",
         "dataset": {"records": [{"id": "X1", "kind": "batch", "data": {"label": "x", "total": 1.0}}],
                     "evidence": [{"record_id": "X1", "source": "line_export", "trusted": True,
                                   "data": {"lines": [{"amount": 100, "currency": "EUR"}], "scale": 100}}]},
         "expect": {"shape_refused": True}},
    ]
