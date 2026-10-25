"""RESEARCH VARIANT (human-written, research/exec-perf) of the MOCK-AUTHORED freight fixture. Same contract v2 and
the same rules; the ONLY change: carrier evidence is indexed by record id once (O(records + evidence)) instead of
being re-scanned for every record (O(records x evidence)). Output must be byte-identical to the original's."""

from decimal import Decimal

CODES = {"LHL", "FSC", "ACC"}  # linehaul, fuel surcharge, accessorial
FIELD = "freight_accrued"


class Incompatible(Exception):
    pass


def _cents(amount, flag):
    if len(amount) != 9 or not amount.isdigit() or flag not in ("D", "C"):
        raise Incompatible(f"malformed amount {amount!r} {flag!r}")
    return int(amount) if flag == "D" else -int(amount)


def parse(lines, po_id, currency):
    """-> invoice net in cents. Raises Incompatible for anything outside the learned format."""
    hdr, net, n, trl = None, 0, 0, None
    for raw in lines:
        tok = raw.split(maxsplit=5)
        if not tok or tok[0].startswith("*"):
            continue
        if tok[0] == "HDR" and len(tok) == 5 and hdr is None:
            hdr = tok
        elif tok[0] == "LIN" and len(tok) >= 5 and hdr and trl is None:
            if tok[2] not in CODES:
                raise Incompatible(f"unknown charge code {tok[2]}")
            net, n = net + _cents(tok[3], tok[4]), n + 1
        elif tok[0] == "TRL" and len(tok) == 4 and hdr and trl is None:
            trl = (tok[1], _cents(tok[2], tok[3]))
        else:
            raise Incompatible(f"unexpected line {raw[:40]!r}")
    if hdr is None or trl is None:
        raise Incompatible("missing HDR or TRL (truncated export?)")
    if hdr[2] != po_id:
        raise Incompatible(f"invoice references {hdr[2]}, not {po_id}")
    if hdr[3] != currency:
        raise Incompatible(f"invoice currency {hdr[3]} != PO currency {currency}: needs FX handling")
    if not trl[0].isdigit() or int(trl[0]) != n or trl[1] != net:
        raise Incompatible("trailer count/control total mismatch")
    return net


def transform(dataset):
    proposals, escalate, by_record = [], [], {}
    for e in dataset["evidence"]:  # one pass, original evidence order kept per record
        if e.get("trusted") and e["source"] == "carrier_export":
            by_record.setdefault(e["record_id"], []).append(e)
    for rec in dataset["records"]:
        rid, data = rec["id"], rec["data"]
        ev = by_record.get(rid, [])
        if not ev:
            continue
        try:
            if len(ev) > 1:
                raise Incompatible("more than one carrier invoice for this PO")
            if FIELD not in data or "currency" not in data:
                raise Incompatible(f"record lacks {FIELD} or currency")
            invoiced = Decimal(parse(ev[0]["data"]["lines"], rid, data["currency"])) / 100
        except Incompatible as e:
            escalate.append({"record_id": rid, "reason": str(e)})
            continue
        if invoiced != Decimal(str(data[FIELD])):
            proposals.append({"record_id": rid, "field": FIELD, "value": float(invoiced),
                              "reason": f"carrier invoice net {invoiced} {data['currency']}"})
    return {"proposals": proposals, "escalate": escalate}


def _code(reason):
    """Data we cannot read -> insufficient_evidence; readable but outside the learned rule -> requires_review."""
    unreadable = ("malformed", "trailer", "missing", "lacks", "unexpected line")
    return "insufficient_evidence" if any(w in reason for w in unreadable) else "requires_review"


def run(dataset):
    """Contract v2: proposals, plus every record this skill will NOT decide, with a typed reason."""
    out = transform(dataset)
    covered = {e["record_id"] for e in dataset["evidence"] if e.get("trusted") and e["source"] == "carrier_export"}
    refused = [{"record_id": e["record_id"], "code": _code(e["reason"]), "reason": e["reason"][:200]} for e in out["escalate"]]
    refused += [{"record_id": r["id"], "code": "not_applicable", "reason": "no trusted carrier invoice for this PO"}
                for r in dataset["records"] if r["id"] not in covered]
    return {"proposals": out["proposals"], "refused": refused}
