# Limitations

Each claim and its evidence: [CLAIMS.md](CLAIMS.md). Security gaps in detail:
[SECURITY.md](SECURITY.md).

## Evidence

- **The committed OnCall recording is still a `RECORDED_SIMULATION`**: its skill was hand-written by a coding agent,
  and its approval was typed by an agent (`approval.kind: simulated`). Do not read it as the GB10 result.
- **GB10 live synthesis is a small sample with a prompt revision.** Qwen wrote a skill that passed the 9-case hidden
  suite once (9/9) and failed the identical repeat (8/9); with the original prompt 0 of 3 attempts passed. The prompt
  was revised by the operator after seeing the 7/9 result (disclosed, evidence-sufficiency rule). Two samples are not a
  success rate; output is not deterministic at temperature 0 on this vLLM. See [BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25).
- **GB10 approval and reuse: done, with caveats.** A person (the operator) approved the passing skill on the GB10 host CLI; the `--by` name is not identity-verified. INC-2 reuse made 0 model calls (6 trials, p50 28.2 ms, min 27.0, max 42.1) and INC-3 was refused every time, all in the subprocess runner (no Docker isolation). n=6, one skill. There is no GB10 first-time-vs-reuse speed-up claim (different scopes: 173.0 s model call vs ~28 ms with 0 model calls). GPU telemetry for the passing run was not captured.
- **GB10 evidence files are not in this repository.** Numbers are the GB10 operator's report plus the sha256 of the files
  on the GB10/SSD; they are not independently reproducible from this tree.
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
- **GB10 runs used the subprocess runner**, not Docker (Docker was permission-denied for the GB10 user; the docker path
  fails closed). **The skill lint is not a security boundary** (a bypass by aliasing and `operator.attrgetter` was found
  and fixed in `1094d95`); under the subprocess runner a hostile skill could read the hidden suite from disk, so hidden-suite
  secrecy needs the Docker runner ([SECURITY.md](SECURITY.md#runner-lint-and-hidden-suite-secrecy)).
- **NemoClaw/OpenShell is not installed on the GB10.** Nothing on the OnCall path ran under it; the egress policy and
  host-service binding are unverified on a real NemoClaw/OpenShell runtime.
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
- **Screenshots under `ui/screenshots/` come from earlier builds** and are not evidence. Some show copy that was later
  removed because it overstated what is verified (for example the status bar text "Live reads the GB10", which
  the current UI replaces with "Live reads this machine"). Trust the current UI source and the recorded JSON, not the older images.

## Launchers and UI

- `start-demo.ps1` / `start-demo.sh` were verified on Windows only. `start-demo.sh` has not been run on Linux or
  macOS (on the GB10 it is reached via `sf-gb10.sh demo`; this tree has no record of that being run).
- Stopping with **Ctrl-Break** was tested; a real **Ctrl-C** was not.
- Without `ui/node_modules`, the launcher runs `npm ci`, which needs network access.
- The UI suites (mock e2e 78/78, lint, typecheck, build) were reported by the owner's session and not re-run on the
  public tree.

## Scope

- Several components live under `experiments/` and are not imported by the core (router, catalog, OnCall, GB10
  harness).
- GPU-aware scheduling and model sleep/wake are proposals only.
- Team members and per-person contributions are not recorded in git.
