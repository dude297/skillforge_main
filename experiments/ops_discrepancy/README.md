# Ops discrepancy: freight accrual vs. carrier invoice (optional, not core)

This is a second business example for SkillForge-style learning, deliberately different from `sum_lines`. **All data is synthetic, written in a confidential style.** Bramblewood Outfitters Ltd and Kestrel Freight Lines are fictional. Nothing in `app/`, `adapters/`, `scripts/` or `tests/` imports this directory, and it is never packaged into the sandbox.

## The problem

Each purchase order (PO) in the ERP carries a `freight_accrued` amount. The carrier sends its invoices in an unfamiliar fixed-width export called "KFL v2":

```
* KESTREL FREIGHT LINES - INVOICE EXPORT KFL v2 - CONFIDENTIAL (SYNTHETIC)
HDR KFL-INV-20417  PO-7731    USD 20261003
LIN 001 LHL 000123450 D  linehaul DAL->MEM 14 plt
LIN 002 FSC 000018519 D  fuel surcharge 15.0%
LIN 003 ACC 000004000 C  detention credit (carrier late)
TRL 003 000137969 D
```

The format has these quirks:
- Amounts are 9 digits in **implied cents**.
- Each amount carries a debit or credit flag (`D` or `C`).
- The currency appears only in the header.
- A trailer holds the line count and the control total.
- Banner, comment and blank lines are noise.

**The rule** (never stated in the data; a skill must learn it): `freight_accrued` must equal the invoice net (debits minus credits) **in the PO currency**.

| file | role |
|---|---|
| `cases/case_primary.json` | PO-7731 is accrued at 1250.00, but the invoice net is **1379.69**. PO-7732 is already correct |
| `cases/case_compatible.json` | the same rule with other values and noise. PO-8810 has 980.00 accrued, but the invoice net is **1048.85**. An untrusted buyer spreadsheet for PO-8811 is ignored |
| `cases/case_incompatible.json` | looks identical, but the invoice is in **CAD** against a USD PO. The naive sum (1518.00) is wrong, so this case must be **escalated**, not fixed |
| `reference_transform.py` | the deterministic transform a learned skill should converge to. It returns `{"proposals": [...], "escalate": [...]}` |
| `hidden_validation.py` | hidden suite with 12 cases, in the style of `validation/sum_lines.py`, plus the independent verifier |
| `test_ops_discrepancy.py` | the proofs (see below) |

The case files use the same shape as `data/scenario.json` (`name`, `records`, `evidence`, `policy`), so `app.db.load_scenario` could load them unchanged.

## What gets escalated (never guessed)

The transform proposes nothing for a record, and escalates it, when any of these is true:
- the invoice currency differs from the PO currency
- the invoice references a different PO
- the export contains an unknown charge code (for example `DTY`, customs duty)
- an amount is malformed
- the trailer count or control total does not match (a truncated export)
- the trailer is missing
- there is more than one invoice for the PO
- the record lacks the needed fields

A record with no trusted `carrier_export` evidence is left alone.

## Approval point and independent verification

1. **Proposed action:** `set_field(PO-7731, freight_accrued, 1379.69)`, with the reason "carrier invoice net 1379.69 USD". The policy requires approval and caps the change at `max_abs_change: 500`.
2. **What the human approves:** that exact field change on that exact PO. The human sees the invoice id, the old and new value, and the reason. Escalations go to the human as a list ("needs FX handling", "trailer mismatch", and so on) with no proposed number.
3. **Independent verification after execution:** `hidden_validation.verify(po_value, raw_lines)` re-reads the raw `LIN` lines with its own regex, recomputes debits minus credits from implied cents, and compares the result with the stored PO value. It shares no code with the transform, so a transform bug cannot verify itself.

## Hidden suite (`hidden_validation.cases()`, 12 cases)

The suite covers:
- primary
- compatible
- incompatible currency (escalate)
- all correct (no proposals, including an empty invoice)
- implied cents versus dollars, plus a credit line
- a truncated export (trailer count mismatch, and a missing trailer)
- an unknown charge code
- a malformed amount, next to a good record
- an invoice for another PO
- duplicate invoices
- untrusted evidence and a record with no evidence
- **200 POs**, with every fifth one wrong. The expected values for this case are computed by `independent_net`, not by the transform

## Tests

```
python -m pytest experiments/ops_discrepancy -q -p no:cacheprovider     # 5 passed
```

The tests prove four things:
- the reference transform passes every hidden case
- primary and compatible are solved by the **same** transform and verify independently after a simulated execution
- the incompatible case is escalated with a CAD reason and gets no proposal
- a naive "sum the lines" helper is **rejected** by the hidden suite

## Plugging into SkillForge later (NOT done now)

- **Scenario:** copy `cases/case_primary.json` and `case_compatible.json` into `data/learning/`. Their `name`s already match `SCENARIOS` in the hidden suite.
- **Hidden suite:** move `hidden_validation.py` into `validation/` (or point `HIDDEN_DIR` at it). `skillforge.find_hidden_suite` discovers suites through `SCENARIOS`.
- **Adapter needed:** `skillforge.hidden_check` currently only understands `{"proposals": ...}` with `expect.proposals`, `no_proposals_for` or `shape_refused`. Two routes are possible:
  - Teach it the `escalate` expectation.
  - Map each `escalate` case to `no_proposals_for` with `error_ok`, and drop the `escalate` key from helper output, because `_valid_proposals` requires the output keys to be exactly `{"proposals"}`.
- **Matcher:** the evidence `source` (`carrier_export`) and the `carrier_invoice_net` invariant give this family its own signature, distinct from `sum_lines`. The incompatible case has the *same* signature, so its refusal must come from the skill itself (escalate), which is exactly what this fixture tests.
