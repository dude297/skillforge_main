# MOCK-AUTHORED TEST FIXTURE: written by a human to exercise SkillForge. NOT produced by an agent.
def run(dataset):
    records = {r["id"]: r for r in dataset["records"]}
    proposals = []
    for e in dataset["evidence"]:
        rec = records.get(e["record_id"])
        if not e["trusted"] or rec is None or "lines" not in e["data"] or "total" not in rec["data"]:
            continue
        expected = sum(e["data"]["lines"]) / e["data"].get("scale", 1)
        if abs(rec["data"]["total"] - expected) > 1e-9:
            proposals.append({"record_id": rec["id"], "field": "total", "value": expected,
                              "reason": f"sum(lines)/scale = {expected}, record says {rec['data']['total']}"})
    return {"proposals": proposals}
