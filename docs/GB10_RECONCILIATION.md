# GB10 reconciliation checkpoint — 2026-10-25

> **Draft-only staging record.** This file does not mean the Dell GB10 changes have been merged, tested on the public main branch, or deployed. Keep the working GB10 installation and its approved skills unchanged while reconciling.

## Starting points

- Public `main` when this branch was cut: `4a4b8827c4e13a854348e0fb6508bdec2b61ae3c`.
- Dell live Git checkout (operator report): `gb10-local` at `36766a5`, clean.
- Live Qwen stack (operator report): `qwen-solo-mtp`, local inference healthy; Nemotron intentionally stopped.
- Source-of-truth handoff on the Dell: `~/skillforge-gb10/outbox/HANDOFF.md`. This file and the scratch/SSD evidence are not included in this PR.

## Changes to reconcile (NOT YET APPLIED)

- [ ] Gate 3 host bridge, independent-verifier hook, restricted agent-facing response (no hidden oracle), and per-task submission cap. Operator reports the fixed-bridge Gate 3 candidate was refused by human-triggered hidden validation at 8/9; do **not** call Gate 3 passed.
- [ ] Data-file prototype, schema fingerprinting, approval and deterministic reuse, with appropriate labels distinguishing its three held-out examples from a separate hidden suite.
- [ ] Best-of-N experiment code/results summary: spec-only reviewer selected 2/4 passing candidates at N=4, K=4, temperature 0. This is a separate experiment and must not be pooled with the single-shot 3/7 rate.
- [ ] Docker-runner and gate-related local fixes: compare against existing `main` before applying; avoid duplicate commits.
- [ ] Hermeticize `test_faults` (do not rely on a live console port).
- [ ] Review sanitized changes for secrets, host details, private paths, temporary state, model weights, and accidentally exposed validation material; retain raw evidence and model caches on the Dell/SSD only.
- [ ] Run focused tests, static checks, and security review against the exact proposed PR head. No change to the live serving or approval state.

## Reconciliation method

Start from public `main` in a separate worktree, inspect `git am --check` or `git apply --check` for each scrubbed patch, apply only reviewed and non-duplicate changes, and push this branch for review. Do not rebase, reset, force-push, pull, or cherry-pick into the active `gb10-local` tree.

This document is a staging checklist, **not** acceptance evidence. Update it with actual applied commit hashes and test results before marking the PR ready for review.
