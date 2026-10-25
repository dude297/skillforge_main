# Development log: hackathon work

This log lists the workstreams done during the hackathon, their status and the tests actually run. Every commit
carries an AI co-author trailer (Claude Code). Per-person authorship is not recorded in git.

Environment for every test below: **Windows 11 x86_64 dev box, no GPU, no real model**, Python 3.14.3, synthetic data.
"Reported" = reported by the person who ran it, not re-run on this tree. "Re-run here" = re-run on this public tree.

### Workstreams

| # | workstream | status | tests actually run (result, environment) | remaining limits |
|---|---|---|---|---|
| 1 | Demo launchers `start-demo.ps1` / `start-demo.sh` over `scripts/demo_launcher.py` | completed; verified on Windows only | manual: both wrappers, attach-not-collide, clean stop via Ctrl-Break (reported, dev box) | not run on Linux/macOS; real Ctrl-C untested; `npm ci` needs network |
| 2 | OnCall loop: synthetic INC-1/2/3, hidden suite, run/reuse driver on the core registry, `GET /ui/demo/oncall`, recorded artifact | completed; verified on the dev box (recorded simulation) | oncall + contracts (re-run here, see [Tests on this tree](#tests-on-this-tree)) | no model has written the skill |
| 3 | Guided six-scene demo `#/demo`, console incident view, OnCall replay in the office, read-only preview build | completed; verified on the dev box | mock e2e, lint, typecheck, build (see row 6) | shows recorded data until a live run exists |
| 4 | Fingerprint and approval-kind fixes after a bypass audit: fingerprint bound to the approved registry row (fail closed), `approval.kind` `simulated`/`host_cli`, UI counts only `host_cli` | completed; verified on the dev box | bypass regression tests in `test_oncall_infer.py` (re-run here) | core matcher still says `exact` for INC-3 (documented gap); names not identity-verified |
| 5 | GB10 compute-frontier harness (`frontier.sh`, `frontier_report.py`) | completed; **stub-tested only** | `experiments/gb10_bench` against a local stub server (re-run here) | nothing measured on a GB10 |
| 6 | Real-backend browser rehearsal and fixes: 3 phone-width defects, 4 labelling issues | completed; verified on the dev box | mock e2e 78/78; lint, typecheck, build clean (reported) | UI suites not re-run on this tree (no `ui/node_modules`) |
| 7 | GB10 handoff: `--live` fails loudly (no silent fallback), `--model auto` = served id, `deploy/gb10/sf-gb10.sh`, portable bundle with leak check, check-llm 120 s timeout | completed on the dev box; **GB10 run blocked/pending** | oncall + gb10_bench + contracts (re-run here). Preflight dry-run on the dev box **failed the inference checks, as expected** (no model served) | preflight not yet run on the GB10 |
| 8 | Release preparation: this public tree, redactions, docs, security and licence gates | completed | secret and privacy grep, relative Markdown link check, `bash -n` on the shell scripts (re-run here) | — |

### Tests on this tree

Windows 11 x86_64, Python 3.14.3, no GPU, no model.

| command | result |
|---|---|
| `python -m pytest -q -p no:cacheprovider tests/test_contracts.py experiments/oncall_infer/test_oncall_infer.py experiments/gb10_bench` | **63 passed, 1 skipped** (run together with `tests/test_freight.py`) |
| `bash -n` on `deploy/gb10/*.sh` and `start-demo.sh` | all OK |
| UI suites (mock e2e 78/78, lint, typecheck, build) | reported; **not** re-run on this tree (no `ui/node_modules`) |
| relative Markdown links | all resolve, checked with a local script |

Known intermittent failures on Windows localhost under load, causes not investigated:
`test_after_approval_inc2_reused_with_zero_model_calls_and_inc3_refused` once raised a `ToolError` and passed on
re-run; `tests/test_faults.py::test_restore_checkpoint_and_resume_interrupted_workflow` and
`::test_corrupt_backup_is_not_restored` failed once in a full run and passed when re-run alone.

### Real-model integration

**Pending: GB10 preflight not yet run; live Qwen inference unconfirmed.** Reported by the operator so far: an
aarch64 GB10 host with the GPU detected, about 121 GiB memory, Docker 29.6.2. No skill has been written by a served
model, and no inference number exists.

### GB10 results (to be filled from evidence folders `results/gb10-evidence/`)

> **Not filled yet.** Each `bash deploy/gb10/sf-gb10.sh <command>` run writes `results/gb10-evidence/<UTC time>-<command>/`.
> Copy facts from those folders only; leave a row empty rather than estimate.

| step | evidence folder | result | notes |
|---|---|---|---|
| preflight (bundle, host, `/health`, `/v1/models`, one chat completion) | | | |
| oncall `--live` (model, model_calls, tokens, verification, hidden) | | | |
| person's approval (`approval.kind`) | | | |
| reuse (INC-2 model_calls, latency; INC-3 refused) | | | |
| bench (TTFT, decode tok/s per request, memory, temperature) | | | |

A failure on Windows localhost (for example the intermittent tests in [LIMITATIONS.md](LIMITATIONS.md#reliability))
is not evidence about the GB10 in either direction.
