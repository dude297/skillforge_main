"""TRUSTED host-side domain verifier: freight accrual must equal the carrier invoice net (KFL v2 export).

Loaded by app/tools.py only when its sha256 matches verifiers/pins.json; never shipped to the sandbox; shares no code
with the agent's freight_invoice tool or any skill. It ATTESTS only inside the rule it was written for:
  - the business context names a contract revision listed in SUPPORTS (a new revision may change the rule)
  - exactly one trusted invoice, in the PO's currency, for this PO, with known charge codes and a matching trailer
Anything else raises ValueError -> the record is "unverifiable", which can never verify.
"""
import re

RULE = "carrier_invoice_net"
VERSION = "1"
SUPPORTS = {"contract:kestrel-freight": ["rev-2026-10"]}  # revisions this rule was validated against
CODES = {"LHL", "FSC", "ACC"}

_LIN = re.compile(r"^LIN\s+\d+\s+([A-Z]{3})\s+(\d{9})\s+([DC])(\s|$)")
_TRL = re.compile(r"^TRL\s+(\d+)\s+(\d{9})\s+([DC])\s*$")
_HDR = re.compile(r"^HDR\s+\S+\s+(\S+)\s+([A-Z]{3})\s+\d{8}\s*$")


def _net_cents(lines, po_id, currency):
    hdr, net, n, trl = [], 0, 0, []
    for ln in lines:
        if not ln.strip() or ln.startswith("*"):
            continue
        h, m, t = _HDR.match(ln), _LIN.match(ln), _TRL.match(ln)
        if h:
            hdr.append(h)
        elif m and m[1] in CODES:
            net, n = net + int(m[2]) * (1 if m[3] == "D" else -1), n + 1
        elif t:
            trl.append(t)
        else:
            raise ValueError("invoice line outside the rule (unknown charge code or malformed amount)")
    if len(hdr) != 1 or len(trl) != 1:
        raise ValueError("invoice is missing its header or trailer")
    if hdr[0][1] != po_id:
        raise ValueError("invoice references another PO")
    if hdr[0][2] != currency:
        raise ValueError(f"invoice currency {hdr[0][2]} differs from PO currency {currency}")
    if int(trl[0][1]) != n or int(trl[0][2]) * (1 if trl[0][3] == "D" else -1) != net:
        raise ValueError("invoice trailer does not match its lines")
    return net


def expected(record_id, data, evidence, inv):
    """evidence: trusted rows from inv['source'] for this record. -> expected field value, or None when the rule
    does not apply (no carrier invoice for this PO)."""
    if not evidence:
        return None
    if len(evidence) != 1:
        raise ValueError("more than one invoice for this PO")
    return _net_cents(evidence[0].get("lines", []), record_id, data["currency"]) / 100
