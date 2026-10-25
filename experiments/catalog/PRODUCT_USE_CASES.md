# Product use cases: what the library demonstrates today (EXPERIMENTAL, MOCK-backed)

`python -m experiments.catalog.demo` builds the library (`library.py`) in a temp directory, then routes three freight events through the **existing** router. The decision path below is what that run recorded on the dev box.

## Supply chain: freight accrual vs carrier invoice

**Library.**
- `freight-invoice-reconcile@v1`, namespace `acme/supply`, owner `freight-ops`. It pins `contract:kestrel-freight=rev-2026-10` and `schema:kfl-export=v2`. It passed the ops fixture's 12-case hidden suite under the unchanged `approve_skill` rule.
- `line-total-reconcile@v1`, namespace `acme/records`.
- PO-quantity, duplicate-charge and contract-rate capabilities exist **only as catalog metadata**. They are not validated skills.

| path | event | decision path | result |
|---|---|---|---|
| **known** | `freight_week2.json` (new values, same carrier export) | source `freight-feed` → namespace `acme/supply` → `match_skills` exact → `check_exact` ok (fresh, approved, hash, hidden validation, runner, unique) → `run_skill` proposes 1 action (PO-7801 → 952.50) → **awaiting_approval** → human `ops-lead` approves → `complete` executes and verifies | `completed`. Oracle before: PO-7801 wrong. Oracle after: both POs equal the independent invoice net. Router model calls 0; the inference health check was never called (test asserts) |
| **unknown** | `freight_duplicate_charges.json` (AP ledger shows one invoice paid twice) | fingerprint `none` (new evidence source and shape) → no stale exact match → `catalog.search` on record kinds and sources → suggestion `freight-invoice-reconcile` (registry approved, **not executed**) → **queued_for_agent** (deferred if the model is down) | no actions. The suggestion is context for the agent, not permission |
| **changed rule** | operator declares contract `rev-2026-11`, then the same week-2 data | `refresh` → skill stale and registry `disabled` → `match_skills` has no active candidate → `stale_exact` (learned fingerprint equals current) → **needs_human: "revalidation required: contract:kestrel-freight validated against rev-2026-10, environment has rev-2026-11"** | no actions. Agent-tool `run_skill` and pinned `run_skill v1` both refused (`not_found`). Data unchanged |
| revalidate | human runs `catalog.revalidate` | the hidden suite as it is now: pass → re-pinned to rev-2026-11 and reactivated; new-rule suite → fails, stays stale | both outcomes tested |

**Why this matters.** The changed contract does not show in the data: the fingerprint is still exact. Without dependency pins, the old rule would have been proposed confidently. With them, the router stops and names the reason.

**Gap found.** The skill correctly refuses a CAD invoice (`case_incompatible`), but the proposals-only output contract cannot report that refusal. Routed through the router, it would end "completed: nothing to change". A core `escalate` channel is proposed in `ARCHITECTURE_V2.md` §4.

## OnCall: portability of the same interfaces

`fixtures/oncall_catalog.json` holds 6 read-only diagnosis entries in `acme/sre`: log-signature diagnosis, service config check, dependency-version investigation, a validated rounding-regression procedure, a disk-pressure runbook and a cert-expiry check.
- The same `search` and `check_exact` serve them. `LedgerMismatch stack trace` → `log-signature-diagnose`.
- SRE cannot see supply skills.
- Every entry is `catalog_only`, so none is executable.
- No catalog or router conditional mentions a domain (tested).

**Not built:** an executable OnCall skill, patching, deployment and infrastructure control. Read-only diagnosis is the intended scope. An executable diagnosis skill would follow the same path as freight: verified solve, hidden suite, approval, register.

## Bootstrap into an unfamiliar dataset

`python -m experiments.router.bootstrap experiments/ops_discrepancy/cases/case_compatible.json --db <a DB built by library.py> --namespace acme/supply` produces the following (tested by `test_bootstrap_manifest_retrieves_procedures_read_only`):
- environment identity and sources
- input schema
- tool inventory
- declared capabilities and required permissions (every write and any event subscription needs human approval)
- roles from code constants
- **relevant procedures** retrieved from the catalog (authority: none)
- exact-compatible skills: **none here**, because the untrusted buyer spreadsheet changes the fingerprint
- near misses and missing-capability opportunities
- **unverified assumptions**, e.g. that the trust flags come from the fixture, and that the verifier ignores `carrier_invoice_net`

It opens the DB read-only (hash unchanged, tested) and writes nothing.

It does **not** claim to understand the business. Equal labels do not prove equal meaning, and the manifest says so.

## What a judge or buyer should take away
- **Routine work is checkable.** Repeatable, validated work runs with no model and still waits for a person to approve each change.
- **Search never authorizes.** It finds candidates fast and locally. Execution needs an exact, fresh, intact, authorized skill.
- **Silent rule changes are stopped.** A business-rule change the data can't show is caught by dependency pins, not by luck.
- **The evidence is limited.** It is MOCK and dev-box only. Real model calls, latency and energy need the GB10 (see `experiments/router/README.md` §6).
