# MOCK-AUTHORED TEST FIXTURE: human-written, deliberately wasteful (O(records x evidence) scan and a repeated
# computation) so the profiler/optimizer has something real to find. NOT produced by an agent.
def line_total(e):
    return sum(e["data"]["lines"]) / e["data"].get("scale", 1)


def run(dataset):
    proposals = []
    for r in dataset["records"]:
        for e in dataset["evidence"]:
            if e["record_id"] != r["id"] or not e["trusted"] or "lines" not in e["data"] or "total" not in r["data"]:
                continue
            if abs(r["data"]["total"] - line_total(e)) > 1e-9:
                proposals.append({"record_id": r["id"], "field": "total", "value": line_total(e),
                                  "reason": "sum(lines)/scale differs from total"})
    return {"proposals": proposals}
