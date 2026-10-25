# SkillForge positioning and roadmap

**SkillForge is a private AI operations teammate. It learns a company's workflows and turns repeatable work into independently verified automation.** It runs on one machine in the company's office, and a person approves every change.

**First buyer:** an operations manager who owns exception investigation and reconciliation, for example freight accruals against carrier invoices at month end. They need three things:
- fewer hours of line-by-line checking
- no wrong corrections, especially out-of-rule cases like a foreign-currency invoice
- data that stays inside the company

Their time spent and error rates today are **not measured** here; ask them, don't assume.

## What the product can demonstrate today (dev box, synthetic data, scripted stand-in for the model)
- An approved deterministic skill handles a known task with **no model call**. Each change waits for a named approver and is checked by an independent, pinned business-rule verifier.
- Partly supported work reports exactly which records were handled and which need a person, and why.
- Stale procedures are stopped before anyone is asked to approve. This covers a new contract revision, whether declared by the operator or by the data.
- Another team's skills are invisible to an agent or event source from the wrong namespace.
- Every step is in an audit trail, and the live operator console shows it read-only.
- It works offline. When local AI is down, unfamiliar work waits and is not guessed.
- A read-only onboarding manifest for one dataset type lists tools, actions, verifier coverage, grants, missing permissions and unknowns.

## Still experimental (do not present as working)
- autonomous skill generation by the real model: run on the GB10 but not reliable (about 3 of 7 attempts pass; the verifier rejects the rest), so it is not unattended
- inference performance beyond the measured GB10 TTFT and decode figures; model calls per task
- onboarding beyond one dataset type; any real connector
- GPU sleep/wake (detection only, advisory)
- real organizational identity; sender identity from the chat channel
- cross-department governance beyond catalog namespaces and roles
- general enterprise connector compatibility (ERP, Jira, email)

## Must not be claimed
- production-ready enterprise deployment
- universal or instant integration
- fully autonomous financial corrections: every change has a human approver
- validated energy or cost savings: nothing is measured
- guaranteed model independence
- end-to-end autonomous learning on the GB10: synthesis, approval and reuse ran on the GB10 with a person approving, and OpenClaw-driven OnCall (Gates 3/4) is not done

## Roadmap, with the evidence needed before each step enters production scope

| # | step | evidence required first |
|---|---|---|
| 1 | secure business workflow integration (this slice) | GB10: real model completes the freight story incl. `needs_person` (not run); 0 unauthorized or falsely verified changes over repeated runs; core P0 changes reviewed (a review is not recorded) |
| 2 | functional Bootstrap Lite | the manifest is correct on a second, independently prepared dataset; the UI shows only manifest data; a person activates |
| 3 | multi-workspace capability governance | per-workspace DB or record isolation designed; identity from a real IdP, not config; an external security review |
| 4 | skill dependency/invalidation | owners keep `env_versions` current in practice; revalidation turnaround measured |
| 5 | persistent lightweight coordinator | a real event source with at-least-once delivery; restart/redelivery soak with zero duplicates |
| 6 | measured model wake/sleep | GB10 shows sleep/wake capability, wake latency, and idle-power difference with a real power source |
| 7 | broader enterprise integrations | one customer system, read-only first, with its auth model reviewed |
| 8 | semantic retrieval | held-out real queries show FTS + aliases recall clearly below need |
| 9 | skill composition | several proven skills that customers want chained; verifier coverage for the combined outcome |

**Not in current scope:** steps 3–9.
