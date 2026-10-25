# Development and validation record

This record documents the SkillForge repository snapshot, the October 25, 2026 demonstration milestone, and
the verification evidence for the published code. **It does not claim that every component in the repository
was authored on October 25.** Dates in the event-day table apply to the work described in those rows, not to
all components included in the final snapshot. Every tracked engineering commit has an AI co-author trailer
(Claude Code); individual human authorship is not established by those trailers.

**About the hashes.** The engineering commit IDs refer to a separate repository whose history is not published
here (it includes personal author metadata). This public repository is a curated snapshot, not a replay of
the engineering commit history. The hashes are identifiers that the team can substantiate independently.

Dev-box test environment: **Windows 11 x86_64, no GPU, no real model**, Python 3.14.3, synthetic data.
"Reported" means reported by its operator, not re-run against this public tree; "Re-run" means re-run against
this public tree. GB10 model runs are reported separately below.

## Part 1. Repository scope at the demonstration milestone

The snapshot contains the trusted SQLite-backed tool service, approval and verification gates, versioned and
hash-pinned skill registry, deterministic matcher, independent verifiers, workflow and catalog experiments,
operator console, Daylight World and Bootstrap Lite, plus GB10 setup and deployment tooling.
This section describes what is present, not when each subsystem was first implemented.

## Part 2. Event-day work (2026-10-25)

All commit times 2026-10-25, UTC-4. Engineering line: branch `demo/judge-kit` (contains the GB10 candidate
`demo/oncall` at `c040cd5`).

| # | workstream | commits | status | tests actually run (result, environment) | remaining limits |
|---|---|---|---|---|---|
| 1 | Demo launchers `start-demo.ps1` / `start-demo.sh` over `scripts/demo_launcher.py` | `4de851a` (12:51) | completed; verified on Windows only | both wrappers, attach-not-collide, clean stop via Ctrl-Break (reported). `bash start-demo.sh --no-open` re-run on Windows Git Bash: console up, `/ui/health` 200 | not run on Linux/macOS; real Ctrl-C untested; `npm ci` needs network |
| 2 | OnCall loop: synthetic INC-1/2/3, hidden suite, run/reuse driver on the core registry, `GET /ui/demo/oncall`, recorded artifact | `f0a7f6b`, `b50a03d`, `a5e663f`, `f1c25df` (12:52) | completed; recorded simulation | oncall + contracts (re-run, Part 3) | no model has written the skill |
| 3 | Guided six-scene demo `#/demo`, console incident view, OnCall replay in the office, read-only preview build | `9583103`, `dcf7118`, `25bccdf`, `bd22fa2` (13:03) | completed; dev box | mock e2e, lint, typecheck, build (reported); lint and build re-run (Part 3) | shows recorded data until a live run exists |
| 4 | Fingerprint and approval-kind fixes after a bypass audit: fingerprint bound to the approved registry row (fail closed), `approval.kind` `simulated`/`host_cli`, UI counts only `host_cli` | `c4d3af3`, `6aa814c` (13:07) | completed; dev box | bypass regression tests in `test_oncall_infer.py` (re-run) | core matcher still says `exact` for INC-3 (documented gap); names not identity-verified |
| 5 | GB10 compute-frontier harness (`frontier.sh`, `frontier_report.py`) | `da8af25` (13:16) | completed; **stub-tested only** | `experiments/gb10_bench` against a local stub server (re-run) | nothing measured on a GB10 |
| 6 | Real-backend browser rehearsal and fixes: 3 phone-width defects, 4 labelling issues | `a24592a` (13:27) | completed; dev box | mock e2e 78/78; lint, typecheck, build clean (reported) | UI e2e suites not re-run on this tree |
| 7 | GB10 handoff: `--live` fails loudly (no silent fallback), `--model auto` = served id, `deploy/gb10/sf-gb10.sh`, portable bundle with run-time leak check (no dev-box identifiers), check-llm 120 s timeout | `b4711f2`, `86ae750`, `ab775be` (14:01-14:02), `c040cd5` (14:03, `demo/oncall`) | completed on the dev box; **GB10 run pending** | oncall + gb10_bench + contracts (re-run). Preflight dry-run on the dev box **failed the inference checks, as expected** (no model served) | preflight not yet run on the GB10 |
| 8 | Judge kit (pitch, live demo runbook, Q&A, GB10 evidence checklist); demo copy fix; UI copy: unverified claims removed (GB10 measurements, "faster", unconditional sandbox limits) | `5c0e9a3`, `ab998e6` (14:27), `16c1a73` (14:33, `demo/judge-kit`) | completed | UI copy only; no new measurements | judge kit contains no GB10 numbers (all "pending GB10") |
| 9 | Release preparation: this public tree, redactions, docs, licence, security and release audit | documentation commits `0be258a`, `b9ea481`, `535c1bb`, `6890664`, `636cf8c`, `0590be3` (13:02-14:17, branch `publish/public-rc`); public snapshot `633b030` (14:39); audit on branch `docs/public-release` | completed | see Part 3 and [RELEASE_AUDIT.md](RELEASE_AUDIT.md) | audit is a point-in-time review by the same team's tooling, not an external review |

## Part 3. Tests on this tree

Windows 11 x86_64, Python 3.14.3, Node 24.15.0, no GPU, no model. Re-run on this public tree on 2026-10-25.

| command | result |
|---|---|
| `python -m app demo --yes` | exits 0, `RESULT: verification PASSED` (MOCK plumbing; it labels itself MOCK) |
| `python -m pytest -q -p no:cacheprovider tests/test_contracts.py experiments/oncall_infer/test_oncall_infer.py experiments/gb10_bench` | **33 passed, 1 skipped** (93 s) |
| `python -m pytest -q -p no:cacheprovider tests/test_contracts.py tests/test_bakeoff.py experiments/oncall_infer/test_oncall_infer.py experiments/gb10_bench` | **36 passed, 1 skipped** (155 s) |
| earlier run of the first command plus `tests/test_freight.py` | 63 passed, 1 skipped (owner's session) |
| `cd ui && npm ci && npm run lint && npm run build` | 184 packages installed; lint clean; `tsc` and Vite build succeed |
| `bash start-demo.sh --no-open --port 8799` | console started, `GET /ui/health` returned 200, then stopped |
| `bash -n` on `deploy/gb10/*.sh` and `start-demo.sh` | all OK (owner's session) |
| relative Markdown links (all `.md` files) | 0 dead, checked with a local script |
| UI mock e2e 78/78 (Playwright) | reported by the owner's session; **not** re-run here |
| full suite (`python -m pytest -q -p no:cacheprovider`, about 3 min) | **not run** in this pass |

Known intermittent failures on Windows localhost under load, causes not investigated:
`test_after_approval_inc2_reused_with_zero_model_calls_and_inc3_refused` once raised a `ToolError` and passed on
re-run; `tests/test_faults.py::test_restore_checkpoint_and_resume_interrupted_workflow` and
`::test_corrupt_backup_is_not_restored` failed once in a full run and passed when re-run alone.

## Real-model integration

The test results in Part 3 are dev-box results and were not re-run for the GB10 patches. The live GB10 model
results are in the next section.

## GB10 results (event day, 2026-10-25)

Source: the GB10 operator's session, reported to this tree. Evidence files live on the GB10/SSD; the sha256 below
identify them. Code: public `633b030` plus GB10 patches (final runs at `35d5820`). Full figures:
[BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25).

| step | evidence | result | notes |
|---|---|---|---|
| hardware and serving | frontier report sha256 `6890165aa86abbb7834ec2aa15784bbf6326104363466d786b0fd66d4e8d23e2` | NVIDIA GB10, aarch64, driver 580.178.04, 121.63 GiB; vLLM 0.21.0+2325b6f0.dev; Qwen3.6-35B-A3B-NVFP4 as `skillforge-qwen`, `max_model_len` 32768 | NemoClaw/OpenShell not installed |
| bench (frontier) | same report | c=1/2/4: 10/20/40 requests, 0 errors; TTFT p50 0.0623 / 0.1087 / 0.1026 s; decode p50 75.63 / 61.83 / 55.27 tok/s per request; min MemAvailable 62.78 GiB; peak 62 C, 42.07 W | per request, not aggregate |
| oncall `--live` #1 to #3 (original prompt) | operator report; no sha256 supplied | #1 Qwen non-thinking 5/9; #2 Qwen thinking 7/9; #3 Nemotron 2 calls, 660 s, 51,972 tokens, failed lint; all rejected | 0 of 3 passed |
| operator prompt revision | commit `f1457b0` on the GB10 branch | evidence-sufficiency rule added after the 7/9 result; authoring agent did not read the hidden suite | disclosed manual hint |
| oncall `--live` #4 (revised prompt) | `docs/evidence/gb10/attempt4-oncall-run.json` sha256 `712dbf7827e0f7c1bf16890d8efcb2758398bcfcd888eeb3766e12369f634b58` (sanitized; original `6683d26b...`) | 1 call, 173.0 s, 1,998 / 12,763 tokens; hidden 9/9, regression 5/5, PASSED, staged `tested`; skill tree sha256 `7fe0c025039b11b93617ba63955f3fe9da0ec55c7e7a0ed11bbae3982fa3aa0e`; proposal only | GPU telemetry not captured |
| oncall `--live` #5 (repeat) | `docs/evidence/gb10/attempt5-oncall-run.json` sha256 `f95121b01f36373f43d06ccc377bc739987841b17576883db04879ee6a2ee01d` (sanitized; original `0448b065...`) | 1 call, 233.8 s, 1,998 / 17,067 tokens; hidden 8/9, REJECTED, not staged; 235 GPU samples, util p50 96%, max 67 C, max 44.0 W | model answered `not_applicable` where the prompt says `requires_review`; output not deterministic at temperature 0 |
| runner | operator report | subprocess runner for every run (Docker permission-denied; docker path fails closed) | hidden-suite secrecy needs Docker |
| security finding | commit `1094d95` | lint bypass via aliasing / `operator.attrgetter` fixed; attempt 4 unaffected (hash unchanged, imports `json`, `typing` only) | [SECURITY.md](SECURITY.md#runner-lint-and-hidden-suite-secrecy) |
| person's approval of #4 (`approval.kind`) | operator report, 2026-10-25T20:25:02Z | a person (the operator) ran `skill approve ... 1 --by "<operator>"` on the host CLI: approved, active, sha256 `7fe0c025...aa0e` matches, hidden suite re-run ok, `approval.kind` `host_cli` | `--by` not identity-verified |
| reuse (INC-2 model_calls, latency; INC-3 refused) on the GB10 | `docs/evidence/gb10/reuse-oncall-run.json` (sanitized sha256 `029bb68463e95c4628ad3acf2dc96e34724155ae8aa3f06c17b796605b974260`; GB10 original `1e32985ef4bffa612f5c36879ec1dbdbe9415d1badee85059f5f29eef84086d2`); console.txt `c0f70c5f...fcb2`; SSD SHA256SUMS 57 lines, 0 failures, sha256 `e40e446b...895e` | INC-2: 0 model calls, 27.0 ms; 6 fresh-process trials p50 28.2, min 27.0, max 42.1 ms; INC-3 refused every time (fingerprint: OOM -> disk full); vLLM request counters unchanged (Qwen 44713, Nemotron 78758) | subprocess runner (no Docker isolation); n=6; latency scope is decision plus sandboxed run, not a speed-up claim |

A failure on Windows localhost (for example the intermittent tests in [LIMITATIONS.md](LIMITATIONS.md#reliability))
is not evidence about the GB10 in either direction.
