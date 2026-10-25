# MOCK-AUTHORED TEST FIXTURE. Expected values computed by hand, not by calling the helper.
from helper import run


def ds(total, lines, scale):
    return {"records": [{"id": "X", "kind": "k", "data": {"total": total}}],
            "evidence": [{"record_id": "X", "source": "s", "trusted": True, "data": {"lines": lines, "scale": scale}}]}


def test_mismatch_is_proposed():
    assert run(ds(45.0, [2000, 2400], 100))["proposals"][0]["value"] == 44.0


def test_match_is_left_alone():
    assert run(ds(31.5, [1250, 1900], 100))["proposals"] == []


def test_untrusted_ignored():
    d = ds(1.0, [500], 100)
    d["evidence"][0]["trusted"] = False
    assert run(d)["proposals"] == []
