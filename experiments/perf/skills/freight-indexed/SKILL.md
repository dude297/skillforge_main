---
name: freight-invoice-reconcile
description: RESEARCH VARIANT of the mock-authored freight fixture (human-written; evidence indexed once; NOT agent-generated). Proposes freight_accrued = carrier invoice net (debits minus credits, implied cents) when the KFL v2 invoice is in the PO currency; refuses, with a typed reason, anything it cannot decide.
---
Run: `run_skill freight-invoice-reconcile` returns proposals setting `freight_accrued` to the KFL v2 invoice net.
Records it cannot decide are returned in `refused`: other currency, unknown charge code, duplicate invoices
(`requires_review`); unreadable exports (`insufficient_evidence`); POs without a carrier invoice (`not_applicable`).
