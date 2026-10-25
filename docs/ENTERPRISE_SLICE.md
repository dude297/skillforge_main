# Enterprise slice: authorized task → approved capability, agent, or person (branch `exp/enterprise`)

This slice was developed on `exp/enterprise` (the freight workflow `exp/workflow` with the router and catalog `exp/router` merged in, plus the work below). Its code is part of this tree (`experiments/`, and the namespace, contract v2 and pinned-verifier changes in `app/`). Whether the core changes were reviewed is not recorded. Everything in this document ran on a dev box with a MOCK library: a scripted solve and human-written skills. No model, no GB10, no real channel. The data is SYNTHETIC.

## 1. P0: three correctness and security gaps (all real; fixed in the core)

| gap (audit finding) | fix | core files | tests |
|---|---|---|---|
| **Agent namespace leak.** `search_skills` listed every approved skill. `run_skill` (pinned versions too) could invoke any of them. `propose_skill` could add a version under another team's name, which deactivates theirs once approved. `get_audit` returned every task's events. | Scope comes from **trusted host config** on `serve` (`APP_AGENT_NAMESPACE`, `APP_AGENT_ROLES`, like `APP_AGENT_TOOLS`), applied only inside `tools.call`. No tool takes a namespace argument, so a forged one is `invalid_input`. Scoped means visible = approved versions the catalog lists for that namespace and role, and fresh. **No catalog means nothing is visible (fail closed).** Out of scope answers exactly like "does not exist". Another team's name gets `name_unavailable`. The agent sees only its current task's audit. Operator CLI commands are unscoped. Unscoped behaviour is rc1's. | `app/tools.py`, `app/skillforge.py` | `experiments/catalog/test_scope.py` (10) |
| **Silent skips.** A skill could skip a CAD invoice, which looked like "nothing to change". | **Contract v2:** optional `refused[{record_id, code ∈ not_applicable, insufficient_evidence, requires_review, reason}]`. A record is proposed or refused, never both; malformed refusals reject the whole output. `run_skill` returns per-record `outcomes` (`change_proposed`, `no_change`, a refusal code, or `not_reported`) plus `needs_person`. `no_change` is claimed **only** when a v2 skill attests coverage. Hidden validation also checks refusals against the suite's expected escalations. v1 skills still work. | `app/skillforge.py` | `tests/test_freight.py` (mixed batch, v1 silence, malformed refusals, hidden refusal) |
| **Unchecked business rules.** The core verifier **skipped invariant rules it didn't know**. The freight check lived in a side oracle, plus a freight branch I had put in the generic core on `exp/workflow`. | Any rule other than the built-in `sum_lines` needs a **trusted host module** `verifiers/<rule>.py` whose sha256 equals `verifiers/pins.json`. It is never shipped to the sandbox and shares no code with skills or the agent tool. The module declares `SUPPORTS` (the business-context revisions it was validated for), and `policy.context` must match. Otherwise every covered record is **unverifiable**, and therefore can never be verified. The freight rule moved into `verifiers/carrier_invoice_net.py`, so no freight code remains in the generic verifier. | `app/tools.py` + `verifiers/` | unknown rule, tampered or unpinned verifier, contract rev-2026-11, and 4 wrong amounts all fail to verify |

**Visible evidence:** `verify_action` now also records each business rule that covered the record and held (`business_rule:carrier_invoice_net`, "pinned verifier v1"). The console shows it, so "verified" is never only the generic field check.

**Layering, proven by a test:** suppose someone revalidates the *skill* for contract rev-2026-11 but nobody revalidates the *verifier*. The skill may then propose, and a person may approve, but the result still reads `needs_review`, never "verified".

## 2. P1: the supply-chain story (`python -m experiments.catalog.slice`, tested by `test_slice.py`)

Events are structured inbound events standing in for a channel (SIMULATED). The replies are `router.explain()`, built from status, kind and the employee's own record ids. They never contain internal reasons, other teams' skill names, namespaces or paths.

| step | event | decision | employee reply (verbatim) | tool calls | ms | model calls |
|---|---|---|---|---|---|---|
| known task | supply, week 2 | exact → approve → verify | "Done: 1 change(s) applied after approval and independently verified." | 3 | 160 | router 0; agent n/a |
| unfamiliar, model up | duplicate AP payments | queued for agent | "This is new to me. The local agent will investigate; any change will still need approval." | 0 | 2.4 | router 0; agent **unknown** |
| unfamiliar, model down | same | deferred | "Local AI is offline, so I can't investigate yet. Your request is saved; nothing was changed." | 0 | 2.0 | 0 |
| **B** newer contract | week 2 under rev-2026-11 | stopped **before** approval | "This looks routine, but a rule it depends on has changed. Nothing was changed; the procedure must be revalidated by its owner first." | 0 | 2.4 | 0 |
| **C** mixed batch | 1 wrong, 1 fine, 1 CAD, 1 broken export | 1 proposal → approved → partial | "1 change(s) applied after approval and independently verified. Not changed, needs a person: PO-8103: invoice currency CAD differs from PO currency USD; PO-8104: invoice trailer does not match its lines." | 3 | 180 | 0 |
| **A** wrong department | finance asks for a supply task | not authorized | "Your team has no approved automation for this. Nothing was changed; a person will look at it." (no skill name, namespace or owner) | 0 | 1.8 | 0 |
| duplicate delivery | known task again | stored result | (nothing runs again) | 0 | — | 0 |
| restart, then redelivery | the deferred event, model back | queued for agent | as above | 0 | — | 0 |

**Proof of "zero unauthorized or falsely verified changes"** (`test_zero_unauthorized_or_falsely_verified_changes`). The test walks the **permanent audit trail**, data generation by generation:
- every execution follows a named person's approval of that action
- every record a change was applied to is correct by the fixture's independent oracle
- "independently verified" appears only for steps that actually completed

**Not covered:** the "unfamiliar" path stops at the agent queue. With no model, nobody investigates. Its cost in model calls and time is **unmeasured**.

## 3. P2: Bootstrap Lite (`python -m experiments.catalog.onboard <dataset> --namespace … --role … --db …`)

It is real and read-only for one environment type: a SkillForge ops dataset. Each run produces a versioned manifest (`schema_version: 1`) with:
- workspace identity (dataset sha256, fingerprint)
- data sources, schemas, supported tools, allowed actions
- business context
- **verifier coverage per business rule**
- compatible skills **from catalog grants, not search**
- dependency status (undeclared means unknown, not a mismatch)
- proposed workflows
- missing permissions and unknowns
- the exact **human** activation commands; nothing is activated

Tests (`test_onboard.py`, 6): the DB is byte-identical after a run, a wrong namespace or role gets no grants, and an injected "grant write access" in the dataset stays `untrusted_text`. Real manifests for the UI are `experiments/catalog/fixtures/onboard_manifest_{ready,blocked}.json`, with the contract in `docs/PRODUCT_CONTRACTS.md`.

**Not built:** the UI view (the cinematic worktree belongs to `exp/bootstrap`), a second environment type, any connector.

## 4. P3: what an operator sees about a skill

`catalog.card()` answers each of these in plain fields: what it does (the author's words, marked untrusted), owner, who may use it, data read, fields it may propose, environment, approver, hidden tests, last validated, last verified run, status, **can it run now and why**, approval needed, independently verified. The "can run now" answer comes only from the exact-match gate on the data loaded now, and the card says so: "Search finds candidates; it never authorizes."

## 5. P4: messaging review (no second implementation)

The channel is NemoClaw's (`docs/WORKFLOW_FREIGHT.md` §2). Reviewed against the security requirements:

| requirement | status |
|---|---|
| trusted identity and workspace | **Partly met.** The sender is enforced by NemoClaw's allowlist (`SLACK_ALLOWED_USERS` / `TELEGRAM_ALLOWED_IDS`), and the workspace is the `serve` scope. **Gap:** the sender's identity is not passed to SkillForge, so the audit can't attribute a request to an employee. |
| messaging never grants approval | **Met.** Approval is a host CLI command bound by `--expect`; an "approved" chat message grants nothing (tested). |
| no duplicate execution on redelivery | **Met.** Proposals deduplicate and execution is unique per action (tested); routed events dedupe on `event_id`. |
| channel outage keeps authoritative state | **Met** by design. State lives in SQLite on the host. The channel is not tested here. |
| sanitized outbound | **Router path met** (`explain`). On the agent path the model writes the reply; SKILL.md chat hygiene applies, which is **instruction-level only**. |
| no sensitive data in public channels | **Not enforced.** It relies on `SLACK_ALLOWED_CHANNELS` plus DMs. Recommend DMs only for the demo. |
| message ↔ task correlation | **Gap.** In the channel path nobody opens a SkillForge task for an inbound message. The console groups by task, so channel-driven work shows up as tool calls without a task. |

**Proposed fix (not built):** a host-side bridge that turns an inbound channel message into a router event, `event_id` = channel message id, sender = channel user id from NemoClaw. It would need NemoClaw to expose inbound messages to the host, which is **unverified**. Until then the demo opens the task on the host (`python -m app task begin "<message summary>"`).

## 6. P5: why deterministic-first matters (measured here; nothing about real models inferred)

| case | decision and explanation | correct | tool calls | latency | model calls | verification | approval |
|---|---|---|---|---|---|---|---|
| known compatible | exact skill, deterministic | yes (oracle) | 3 | 160 ms incl. execute + verify | **0** (no model on this path) | passed (pinned verifier) | 1 named person |
| unknown | escalated to the local agent | n/a (not run) | 0 to route | 2 ms to route | **unknown** (no model here) | n/a | would be required |
| stale / unauthorized | blocked before any proposal | yes (nothing changed) | 0 | 2 ms | 0 | n/a | not reached |

The MOCK A/B/C router comparison (`experiments/router/compare.py`) is unchanged: 9 of 27 tasks were handled without inference, with 0 false skill matches. Agent model calls and energy are **unknown**; that comparison needs the GB10.

## 7. Tests run (final, sequential, one suite group at a time; about 0.6 GB RAM free, taken by other apps)

| suite group | result |
|---|---|
| `tests/test_faults.py`, `test_ui_api.py`, `test_bakeoff.py` | 63 passed |
| `tests/test_core.py`, `test_bench.py`, `test_contracts.py` | 67 passed, 2 skipped |
| `tests/test_skillforge.py`, `test_freight.py` | 58 passed |
| `experiments/catalog` (`test_catalog`, `test_scope`, `test_slice`, `test_onboard`) | 46 passed |
| `experiments/router`, `experiments/ops_discrepancy` | 25 passed |

That is every file in `tests/` (188 passed, 2 skipped) plus 71 experiment tests. Console code changed on this branch: `tsc` and eslint clean, and screenshots taken from a real task. The browser e2e suites were **not** re-run on this branch.

## 8. GO / NO-GO (dev box)

| area | verdict | why |
|---|---|---|
| catalog security | **GO (experimental)** | agent scope from host config, fail closed, 10 tests; core change needs review |
| deterministic routing | **GO (experimental)** | exact plus gate plus refusals plus explain; 20 + 8 tests |
| business verification | **GO for freight on this branch** | pinned verifier, fail-closed unknown rules, contract-aware; core change needs review |
| Bootstrap Lite | **GO for the backend manifest**, **NO-GO for the UI** | real read-only manifest; UI view not built |
| communication channel | **NO-GO** | no real round trip; identity and correlation gaps (§5) |
| live console | **GO with a caveat** | real data; a mixed batch reads "Partly done, needs a person" (Investigations and History), and a verified change lists the business rule that held (`ui/screenshots/partial-*.png`); router events don't create console tasks yet |
| real-model learning | **NO-GO** (freight story) | not run with a real model on the freight data; the OnCall equivalent ran on the GB10 ([BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25)) |
| GB10 hardware | **NO-GO** (dev-box verdict) | nothing of this slice ran on hardware |

## 9. Open GB10-only questions for this slice
- Real model on `data/freight/case_primary.json`: does it call `freight_invoice`, propose 1379.69, stop for approval, and report `needs_person` for `mixed.json`?
- Does `serve` with `APP_AGENT_NAMESPACE` set behave identically through the sandbox (`host.openshell.internal`)?
- Can NemoClaw surface inbound channel messages, or the sender id, to the host? That decides the §5 fix.
- Measure model calls per task (vLLM `/metrics`) for the known versus unknown case.

## 10. Open items
1. A review of the core changes, which were made as three separable commits in the engineering history: P0-3 `80a1f2d`, P0-2 `c0d1956`, P0-1 `b266684`. No review is recorded.
2. Console: router events as console tasks. This needs a `mode` for router-handled tasks, which is a core change. The "partly done" state and the visible business-rule check are done.
3. The Bootstrap Lite UI view from `docs/PRODUCT_CONTRACTS.md`, in the `exp/bootstrap` worktree.
4. The channel bridge (§5). NemoClaw inbound behaviour: a Telegram <-> local model round trip is verified on the GB10, but the sender id reaching SkillForge is not ([integrations/telegram/GAPS.md](../integrations/telegram/GAPS.md)).
