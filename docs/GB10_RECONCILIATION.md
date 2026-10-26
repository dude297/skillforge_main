# GB10 source reconciliation

This document tracks code transfer from the Dell GB10 development worktrees into the public SkillForge repository. It is an integration checklist, not a benchmark report or a deployment record.

## Baselines

- Public base: `main` at `4a4b8827c4e13a854348e0fb6508bdec2b61ae3c`.
- Dell development checkout: `gb10-local` at `36766a5` (operator-reported).
- Model serving: Qwen remains active; the approved demo registry and runtime are outside this reconciliation.
- Local handoff: `~/skillforge-gb10/outbox/HANDOFF.md`.

## Integration scope

- [ ] Import the Gate 3 OpenClaw/SkillForge bridge, host-side verifier integration, agent-facing response boundaries, and per-task submission limit.
- [ ] Integrate the data-file skill prototype, schema matching, explicit approval, and deterministic reuse tests.
- [ ] Include the best-of-N evaluation harness with its experimental methodology. Store detailed measurements in separately identified evidence records.
- [ ] Reconcile Docker runner and service changes with existing code in `main`.
- [ ] Make fault tests hermetic and independent of running local services.
- [ ] Review changes for credentials, host identifiers, private paths, state files, model weights, and sensitive validation material.
- [ ] Run focused unit tests and appropriate regression/security checks against the exact PR commit before review.

## Workflow

Use the isolated reconciliation checkout and reviewed, sanitized patches. Apply non-duplicate changes incrementally; record commit hashes and test commands in the PR as integrations are completed.

Do not alter the active `gb10-local` checkout, Qwen serving stack, or approved demo skills. Keep local model caches, scratch state, credentials, and raw evaluation artifacts off the public branch.

This PR remains a draft until its code changes have been integrated and verified. 
