# Limitations

Each claim and its evidence: [CLAIMS.md](CLAIMS.md). Security gaps in detail:
[SECURITY.md](SECURITY.md).

## Evidence

- **No real-model run yet.** No served model has written a skill, investigated a problem or produced a measurement
  in this repository. The OnCall recording is a `RECORDED_SIMULATION`: the skill was hand-written by a coding agent,
  and the approval was typed by an agent (`approval.kind: simulated`). The `--live` path is tested against a stub
  server only.
- **Nothing measured on a GB10.** The operator has reported an aarch64 GB10 host with the GPU detected, about
  121 GiB memory and Docker 29.6.2. Live Qwen inference is not confirmed. See [BENCHMARKS.md](BENCHMARKS.md).
- **Decode tok/s is per request only.** The frontier harness runs C parallel copies of a single-request probe; it
  does not measure aggregate server throughput.
- All data (OnCall incidents, freight records) is synthetic, and the message channel is simulated (no Slack or
  Telegram in this tree).
- Tests, replay and hidden suites are evidence, not a formal proof that a skill is correct.
- The reuse latency (about 117–256 ms) is a dev-box measurement of match plus deterministic execution, not an
  inference saving.

## Security and correctness

- **Core matcher gap.** Core `match_skills` reports the OnCall lookalike INC-3 as an `exact` match. The refusal comes
  from the experiment's incident fingerprint; core reuse paths do not consult it. A direct core `run_skill` is
  contained by the hidden suite's lookalike cases. Fixing it needs a core change ([SECURITY.md](SECURITY.md#incident-fingerprint-and-the-core-matcher-gap)).
- **Approver identity is not verified.** `--by` is free text; `approval.kind: host_cli` means a command was typed on
  the host, not that the named person approved.
- The subprocess runner's rlimits are not applied on Windows. Docker isolation was checked only on the dev box.
- The OpenShell egress policy and the host-service binding are unverified on a real NemoClaw/OpenShell runtime.
- With the `--local` fallback package, the agent has `exec` inside the sandbox, so guarantees hold only through the
  tool interface.

## Reliability

- **15 s core sandbox timeout.** Skill tests and hidden checks run under core's 15 s timeout. Under heavy load (for
  example while the GPU serves a model), verification can time out and the candidate is rejected rather than passed.
  Re-run when idle; raising the timeout is a core change.
- **Flaky tests seen under load** on the dev box: `tests/test_faults.py::test_restore_checkpoint_and_resume_interrupted_workflow`
  and `::test_corrupt_backup_is_not_restored` (each passed when re-run alone), and once
  `experiments/oncall_infer/test_oncall_infer.py::test_after_approval_inc2_reused_with_zero_model_calls_and_inc3_refused`
  (`ToolError` at `app/skillforge.py:748`; passed on re-run). Causes not investigated.
- Single workspace, single open task (`scripts/unified.py`).

## Launchers and UI

- `start-demo.ps1` / `start-demo.sh` were verified on Windows only. `start-demo.sh` has not been run on Linux or
  macOS (on the GB10 it is reached via `sf-gb10.sh demo`, not yet run).
- Stopping with **Ctrl-Break** was tested; a real **Ctrl-C** was not.
- Without `ui/node_modules`, the launcher runs `npm ci`, which needs network access.
- The UI suites (mock e2e 78/78, lint, typecheck, build) were reported by the owner's session and not re-run on the
  public tree.

## Scope

- Several components live under `experiments/` and are not imported by the core (router, catalog, OnCall, GB10
  harness).
- GPU-aware scheduling and model sleep/wake are proposals only.
- Team members and per-person contributions are not recorded in git.
