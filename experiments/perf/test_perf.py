"""Correctness of the research variant, independent of any benchmark (a benchmark is never proof of correctness).
  python -m pytest -q -p no:cacheprovider experiments/perf/test_perf.py"""
import copy
import json
import runpy

import pytest

from app import skillforge as sf, tools
from experiments.perf import gen, harness

RUN = {v: runpy.run_path(str(d / "scripts" / "helper.py"))["run"] for v, d in harness.VARIANTS.items()}


@pytest.mark.parametrize("n,seed", [(11, 7), (220, 1), (1100, 2)])
def test_both_variants_match_the_generators_truth_and_each_other_byte_for_byte(n, seed):
    data, truth = gen.build(n, seed)
    outs = {v: run(copy.deepcopy(data)) for v, run in RUN.items()}
    for out in outs.values():
        harness.check(out, truth)
    assert json.dumps(outs["scalar"], sort_keys=True) == json.dumps(outs["indexed"], sort_keys=True)


def test_every_refusal_class_is_present_and_preserved():
    data, truth = gen.build(110)
    st = harness.outcome(RUN["indexed"](copy.deepcopy(data)))
    seen = {s for s, _ in st.values()} | {"no_change"}
    assert seen == {"no_change", "change_proposed", "requires_review", "insufficient_evidence", "not_applicable"}
    assert {t["status"] for t in truth.values()} == seen


def test_the_oracle_has_teeth():
    data, truth = gen.build(110)
    out = RUN["indexed"](copy.deepcopy(data))
    out["proposals"][0]["value"] += 0.01  # one cent off
    with pytest.raises(AssertionError):
        harness.check(out, truth)
    out = RUN["indexed"](copy.deepcopy(data))
    out["refused"] = [r for r in out["refused"] if r["code"] != "requires_review"]  # a silently dropped refusal
    with pytest.raises(AssertionError):
        harness.check(out, truth)


def test_the_pinned_business_verifier_agrees_with_the_generator_in_integer_cents():
    data, truth = gen.build(220)
    mod, inv = tools._domain_verifier("carrier_invoice_net"), data["policy"]["invariants"][0]
    ev = {}
    for e in data["evidence"]:
        ev.setdefault(e["record_id"], []).append(e["data"])
    checked = 0
    for r in data["records"]:
        t = truth[r["id"]]
        if t["status"] == "change_proposed":
            assert round(mod.expected(r["id"], r["data"], ev[r["id"]], inv) * 100) == t["value_cents"]
            checked += 1
    assert checked == sum(t["status"] == "change_proposed" for t in truth.values()) > 0


def test_the_variant_passes_its_own_tests_and_the_hidden_suite_in_the_isolated_runner():
    d = harness.VARIANTS["indexed"]
    assert sf.sandbox("test", d)["ok"]
    res = sf.hidden_check(d, "ops-freight-accrual-primary", None)
    assert res["ok"] and len(res["cases"]) == 12, [c for c in res["cases"] if not c["ok"]]
