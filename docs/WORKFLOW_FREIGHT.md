# Freight exception workflow: employee request → verified result

This workflow was built on rc1 (`integ/live`, branch `exp/workflow`) and is part of this tree. The data is **SYNTHETIC**: Bramblewood Outfitters and Kestrel Freight Lines are fictional. The agent in every run below is a **scripted MOCK**, and the channel is **SIMULATED**. No real model and no real Slack or Telegram were used.

## 1. Event requirements → evidence

Sources:
- builderbase.com/event/dell-x-nvidia-ai-hackathon-san-francisco
- luma.com/dellxnvdia-hackathon (series page)
- startupgrind.com/e/mbt6dn (Boston stop)

Published wording:
- "Ship an always-on business agent in 8 hours"
- "running 100% locally on the Dell Pro Max with GB10"
- "OpenClaw, NVIDIA NemoClaw, and OpenShell"
- "the final demo must also run on that machine"
- "No cloud. No prompt-engineering demos."
- Boston: "from a blank repo"

**Not published anywhere:** judging criteria, a submission checklist, a required messaging channel, or a rule on prebuilt code.

| requirement | existing implementation | real test evidence | missing integration | demo proof |
|---|---|---|---|---|
| GB10 local inference | `adapters/llm.py`, `models.json`, `models probe`, runbook Gates 0–5 | fake vLLM servers only | everything on hardware | `models probe` PASS on the GB10 (not recorded; local inference itself is verified, [BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25)) |
| NemoClaw | onboarding profiles, `nemoclaw exec` agent command, `switch_model.sh` | fake `nemoclaw` binaries | real onboard, sandbox, `channels add` | `nemoclaw <sb> status` |
| OpenClaw | `adapters/openclaw/skill/SKILL.md` + `client.py`; `bench.OpenClawAgent` (Gateway JSON) | contract parsed from source; fixtures hand-written | a real agent turn following SKILL.md (Gate 2 ran OpenClaw against the records-ops skill on the GB10, [CLAIMS.md](CLAIMS.md) #23c) | TUI or channel transcript |
| OpenShell | Docker skill runner flags; `host.openshell.internal` preset; no-0.0.0.0 bind | Docker runner tests (when Docker exists); docs | policy `--dry-run`, `openshell term` egress view | "nothing left the box" screenshot |
| Slack / Discord / Telegram | **none of ours, by design**: NemoClaw `channels add` | **none** | tokens, `channels add`, rebuild, round trip | real message in, reply out |
| autonomous execution | agent tools, skill reuse (`run_skill`), `fastpath` | MOCK agent over the real HTTP tool service (rehearsals, e2e) | real model choosing the tools | unscripted model run |
| business usefulness | freight accrual vs carrier invoice (this doc) | real backend, synthetic data, MOCK agent | real model on the same data | §3 |
| local-first | no cloud endpoint anywhere; `fastpath` without a model | `test_no_model_*`; no-cloud tests | measured on the GB10 offline | unplug the network, run `fastpath` |
| security and human oversight | approvals only on the host CLI; `--expect` fingerprints; verifier; hidden suite; agent token surface | 172 pytest; console security tests | channel allowlist (`SLACK_ALLOWED_USERS` / `TELEGRAM_ALLOWED_IDS`) | refused early execute; approve on the host |
| demo reliability | rehearsals, MOCK fallback labelled, runbook R10–R12 | rehearsal three acts (test) | rehearse 3× on the GB10 | §8 |

**Open organizer questions** (draft kept private, not in the public tree; **still not sent**):
- May we bring prebuilt code, given the "blank repo" wording?
- Is a human-approval step acceptable in an "always-on" agent?
- Will there be outbound internet for Slack or Telegram?
- What are the judging criteria?

## 2. Messaging (no second framework)

The channel belongs to NemoClaw, and SkillForge adds no messaging code. This is from the NVIDIA NemoClaw docs (`messaging-channels/set-up-slack`, `set-up-telegram`) and is **not run for this workflow** (the Telegram path on the GB10 is in [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md)):
- **Slack (preferred).** It uses Socket Mode, so the GB10 needs no public URL (inferred).

  ```bash
  SLACK_BOT_TOKEN=xoxb-… SLACK_APP_TOKEN=xapp-… SLACK_ALLOWED_USERS=<member ids> nemoclaw <sb> channels add slack
  nemoclaw <sb> rebuild
  ```

  - Channel messages need an @mention.
  - Senders not on the allowlist get a denial notice.
  - Tokens are registered with the OpenShell gateway, and the sandbox sees placeholders only.
  - *Setup risk:* someone with workspace rights must create the app (bot + app-level token) **in advance**, and the venue needs outbound internet.
- **Telegram (fallback).**

  ```bash
  TELEGRAM_BOT_TOKEN=… TELEGRAM_ALLOWED_IDS=<ids> nemoclaw <sb> channels add telegram
  nemoclaw <sb> rebuild
  ```

  BotFather setup takes minutes. Whether it uses polling is unverified.
- **Last resort:** the OpenClaw TUI, or `nemoclaw <sb> exec -- openclaw agent -m …`.

**Approval never travels over the channel.**
- Approval is `python -m app approve <id> --by <name> --expect <fp>` on the host. The console shows the exact command.
- An "approved" chat message grants nothing: `execute_action` refuses anything the host has not approved (tested).
- To deliver the result after approval, there are two options, both **unverified on the GB10**:
  - the employee replies "continue" in the thread, or
  - the operator runs `openclaw agent --session-id <s> -m "Approved on the host. Execute, verify, report." --deliver --channel slack`. The `--deliver` flag is documented in docs.openclaw.ai/tools/agent-send.

## 3. The actual workflow (real backend, MOCK agent, SIMULATED channel)

`python scripts/rehearse_freight.py --ui --approve manual`. It is tested hands-free by `tests/test_freight.py::test_freight_rehearsal_end_to_end`. A recorded run, with manual approvals:

| # | employee (simulated channel) | what the backend did | agent reply |
|---|---|---|---|
| 1 | "PO-7731's freight accrual doesn't match the Kestrel invoice. Can you check this week's POs?" | `search_skills` (none) → `read_records` → `freight_invoice` ×2 (read-only domain tool) → `propose_action` PO-7731 1250.00→1379.69 → `request_approval` → agent's `execute_action` **refused** (not approved) → person ran the console's `approve 1 --expect fd0bf145` → execute → **verifier's own `carrier_invoice_net` check passed** → `propose_skill` → person promoted it (12-case hidden suite ran on the host) | "Found 1 discrepancy … Waiting for an authorized approver." then "Done and independently verified: PO-7731 freight_accrued 1250.00 → 1379.69" |
| 2 | "Weekly freight accrual check, please." | `search_skills` → compatible → `run_skill` (no model) proposes PO-7801 → 952.50 → person approved → execute → verified | "Approved skill freight-invoice-reconcile@v1 proposed 1 change … Waiting for approval." then "Done and independently verified" |
| 3 | "PO-9902's accrual looks off against the cross-border invoice." | skill proposes nothing → `freight_invoice` reports `invoice currency CAD != PO currency USD` → nothing proposed | "I changed nothing. Needs a person: PO-9902 … No approved rule covers this (e.g. currency conversion)." |

Screenshots of the real console are in `ui/screenshots/freight/`:
- `1-waiting/`: approval pending, the refused early execute, and the copyable bound command
- `2-skill-waiting/`: the skill's proposal awaiting approval
- `3-done/`: all three tasks
- Each view at 1440 px and 390 px.

**What changed to get here** (additive; core changes need review before any merge):
- `app/tools.py`: the read-only `freight_invoice` tool, plus the verifier rule kind `carrier_invoice_net`. That rule is the verifier's own regex reading. It shares no code with the tool or the skill, and treats any other currency, unknown code or broken trailer as **unverifiable, never verified**. This is the designed extension point (`docs/EXTENSIONS.md`, "add one domain tool + `verify_action` domain checks").
- `data/freight/`: 4 synthetic cases. `validation/freight_accrual.py`: the ops fixture's hidden suite (12 cases, plus `week2`). `tests/fixtures/freight_skill`: the MOCK-authored skill.
- `adapters/openclaw/skill/SKILL.md`: the `freight_invoice` row, plus "propose nothing and ask a person on `issues`". Every answer ends `verified`, `waiting for approval` or `needs a person`.
- **Console fix.** A closed task with no executed change but an unmet rule showed **"Applied, not fully verified"**, which was false. It now says **"Nothing changed, needs a person"**, and the before/after comparison only uses successful tasks.

**Router: not used.** Agent-side `search_skills`/`run_skill` and rc1 `fastpath` already cover repeat work, so `exp/router` stays experimental.

## 4. Test status (dev box, run one at a time)
- **pytest:** 172 passed, 2 skipped (rc1: 163; this branch adds 9 freight tests).
- **Console e2e (`npx playwright test`):** 28 passed. 1 failure under load ("live mode without a backend"); that test passes on its own here and on rc1, so it is flaky, not a regression.
- **Live console e2e (`-c playwright.live.config.ts`):** 5 passed. **"restoring an older database while the console is open resyncs" fails here AND on unmodified rc1** (`prep/event-kit` worktree): after a restore the console shows "Waiting for the first task on this system". This is a pre-existing rc1 bug on Windows and has not been investigated.

## 5. Buyer persona and value (assumptions labelled)

**Who:** an operations manager at a mid-size distributor. They own freight-accrual exceptions at month end.

- **Today (ASSUMED, not measured):**
  - An analyst opens the carrier's invoice export.
  - They read implied-cent amounts and credit lines by hand.
  - They compare the net to the PO accrual in the ERP and correct it.
  - The task repeats every week across many POs.
- **Risks:**
  - a wrong correction: summing a CAD invoice as USD, or missing a credit
  - silent drift after a contract change
  - supplier data sent to a cloud model
- **Required oversight:** a named person approves every change. Corrections are capped by policy (`max_abs_change 500`).
- **What is observed here:**
  - Every change waited for a person, and an early attempt was refused.
  - Verification is independent of whoever proposed the change.
  - A compatible week was handled by an approved skill with **no model call**. That is a code path, not an estimate.
  - The out-of-rule CAD invoice was **not** changed and was routed to a person.
  - Nothing left the machine.
- **Not measured:** analyst time today, time saved, error rates. **No ROI claim is made.**

## 6. Enterprise roadmap (documented, not built)

| item | why later | first step |
|---|---|---|
| SAP/ERP connector | needs a real customer system and its auth | read-only extract to the records/evidence shape |
| Jira / incident integration | scope | file the "needs a person" result as a ticket |
| email ingestion | untrusted input surface | carrier invoices by email into trusted evidence only after source checks |
| org-wide permissions, namespaces | built as an experiment on `exp/router` (`experiments/catalog`) | review the catalog gate before core |
| skill catalog search, RAG | `exp/router`: FTS5 recall@5 0.969 on a synthetic set; no embeddings needed yet | held-out real queries |
| dependency invalidation | `exp/router`: contract revision → skill stale → human revalidation | adopt after review |
| power management | sleep/wake unverified on the GB10 | `experiments/router/power.py` detection, read-only |
| multi-user / multi-tenant | not needed for one appliance | — |

## 7. Missing GB10 tests (in order)
1. Gates 0–2 (runtime, model probe, sandbox→host service) from `docs/GB10_RUNBOOK.md`.
2. The real model on `data/freight/case_primary.json`: does it call `freight_invoice`, propose 1379.69, and stop for approval?
3. `channels add slack` (or telegram), rebuild, then: message in, agent turn, approval on the host, result delivered (continue, or `--deliver`).
4. Real-model skill generation from the freight solve (learning gate), then reuse on `week2`.
5. The CAD case with the real model: it must answer "needs a person".
6. `openshell term` during the run: no unexpected egress.

## 8. GO / NO-GO

| item | verdict |
|---|---|
| backend workflow (approve, verify, reuse, escalate) | **GO** (real backend, tested) |
| console shows it truthfully | **GO** after the status fix on this branch |
| real-model autonomy | **NO-GO until Gate 3 passes on the GB10** |
| messaging channel | **NO-GO until a real round trip** (tokens + internet + rebuild); fallback TUI |
| using this code at the event | **BLOCKED on organizer answer** (prebuilt code) |

**Next engineering step:** on the GB10, run Gate 2. Then run the real model on `case_primary.json` through the TUI. Then do the Slack `channels add` round trip. Before that, a person needs to send the organizer questions and create the Slack app.
