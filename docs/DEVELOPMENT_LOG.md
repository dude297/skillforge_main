# Development log

This log separates what existed **before** the hackathon (2026-10-25) from what was done **on the event day**, links
each item to commit hashes, and records the tests actually run. Every commit carries an AI co-author trailer (Claude
Code). Per-person authorship is not recorded in git.

**About the hashes.** They refer to the team's private engineering repository, whose history is not published
(its commits carry personal author metadata). This public repository is a single curated snapshot commit. The hashes
are provenance you can ask the team to show, not links you can follow here. The recorded commit dates are the
committer's local clock (UTC-4). The event start time is **not recorded in git**, so a few commits dated 2026-10-25
that were prepared earlier are listed as pre-event and marked.

Environment for every test below: **Windows 11 x86_64 dev box, no GPU, no real model**, Python 3.14.3, synthetic data.
"Reported" = reported by the person who ran it, not re-run on this tree. "Re-run" = re-run on this public tree.

## Part 1. Pre-event foundations (before 2026-10-25)

Developed 2026-10-20 to 2026-10-23, none of it written on the event day. The core runtime (`app/`, `adapters/`) was
declared frozen in the team's rules (blocker, security and compatibility fixes only; some proposed core changes were
made on 2026-10-22).

| date | work | branch / key commits |
|---|---|---|
| 2026-10-20 | Local agent foundation: SQLite tools, approval gate, verifier, mock demo, OpenClaw skill, GB10 docs; LF line endings; model bake-off procedure | `0a6a17a`, `6cf82cd`, `75ec968` |
| 2026-10-20 | SkillForge core: learn, replay-validate, human-promote, reuse deterministic skills; sanitization, hidden validation, profiling; three-mode benchmark, deterministic matcher, trusted service boundary | `4315c68`, `e47796a`, `2182c02` |
| 2026-10-20 | GB10 readiness: runbook, gated preflight, least-privilege service, runner fix | `59f90ce` (`master`) |
| 2026-10-21 | Contract rehearsal, research-driven fixes, runbook gates 0-5, deploy manifest, demo plan; resilience (capability gate, failover, crash recovery, fault injection, soak) | `98872c9`, `4ca18c8`, `90e3445`, `e5a2a15`, `7e93be6`, `582ff71` (`prep/readiness`) |
| 2026-10-21 | OnCall and ops-discrepancy evaluation fixtures (experiments, not core) | `2ca1d1a` (`exp/scenarios`) |
| 2026-10-21 | UI: design system, story, operator console; four independent reviews integrated | `080b468`, `e321c70`, `7f6b95b`, `d81bc39` (`ui/console`) |
| 2026-10-21 | Read-only operator API, live console over real backend state; integration review fixes; release-candidate notes | `43c6122`, `25cf96c`, `a6fd80a` (`integ/live`, tag `rc1-2026-10-21`) |
| 2026-10-21 | Daylight World, Ember companion, perf/a11y pass, usability kit (not run) | `320feb6`, `d60bc2f`, `82ae167`, `2fb8cc1`, `94c147d`, `a881acb` (`exp/world`) |
| 2026-10-21 | Event kit (no product change) | `0b1672a`, `a98e2e2` (`prep/event-kit`) |
| 2026-10-22 | Exception workflow on the real backend (freight) | `954f682` (`exp/workflow`) |
| 2026-10-22 | Event router spike, A/B/C harness, organisational skill catalog | `abe7126`, `a131597`, `7e137cf`, `9e3c000` (`exp/router`) |
| 2026-10-22 | Enterprise slice: namespace isolation, typed skill refusals, verifier attestation (proposed core changes), Bootstrap Lite manifest | `80a1f2d`, `c0d1956`, `b266684`, `9bb106b`, `91e8f0d`, `6151037`, `2d440ba`, `3c510bd` (`exp/enterprise`) |
| 2026-10-22 | Bootstrap cinematic and honesty patch; restore-guard fixes | `c343ff6`, `b543cfa`, `42d11bf`, `a864178` |
| 2026-10-22 | Research only: execution-cost audit and CPU benchmark; GB10 measurement runbook and TTFT probe | `c405feb`, `6de3cf1` (`research/exec-perf`), `d03dd1e` (`research/gb10-bench`) |
| 2026-10-22 | Review packet, channel contract (synthetic), event-readiness handoff (doc only) | `15661b1`, `740c5de`, `bc5db46`, `cbf1ba5`, `ffbdbec` |
| 2026-10-22 | Functional read-only onboarding (Bootstrap Lite) | `e8fb788` (`exp/bootstrap-lite`) |
| 2026-10-23 | unified-alpha: merged the experiments above into one console, stabilization, browser acceptance | `5a7cd29`, `ae63d41`, `0ff2ecd`, `b132e9e`, `427bded`, `0f56032`, `e2864b4`, `2719faf`, `9faeb26`, `7d77af1`, `136ad0e` (`integration/unified-alpha`) |
| 2026-10-23 | One connected product path (homepage to Bootstrap to Lite to office to console); truthful provenance | `aef91a2`, `552613e`, `e364083` (`ui/product-experience`) |
| 2026-10-25, early | Dated on the event date but outside the event-day product work (a judgement call; the event start time is not recorded): Telegram bridge experiment (not merged, **not in this tree**) and the event-kit screenshots | `4440911` (`exp/telegram`, 04:07), `fce80be` (`prep/event-kit`, 12:30) |

Public snapshot of this foundation: `5b6489a` ("Pre-event foundation: snapshot of private commit e364083", 13:01 on
2026-10-25, a tree snapshot, not a replay of history).

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

**Pending: GB10 preflight not yet run; live Qwen inference unconfirmed.** Reported by the operator so far: an
aarch64 GB10 host with the GPU detected, about 121 GiB memory, Docker 29.6.2. No skill has been written by a served
model, and no inference number exists.

## GB10 results: pending — not yet measured

> **Not measured yet. Nothing in this section has been pre-filled and nothing may be estimated.** Each
> `bash deploy/gb10/sf-gb10.sh <command>` run writes `results/gb10-evidence/<UTC time>-<command>/`. Copy facts from
> those folders only; leave a row empty rather than guess.

| step | evidence folder | result | notes |
|---|---|---|---|
| preflight (bundle, host, `/health`, `/v1/models`, one chat completion) | | | |
| oncall `--live` (model, model_calls, tokens, verification, hidden) | | | |
| person's approval (`approval.kind`) | | | |
| reuse (INC-2 model_calls, latency; INC-3 refused) | | | |
| bench (TTFT, decode tok/s per request, memory, temperature) | | | |

A failure on Windows localhost (for example the intermittent tests in [LIMITATIONS.md](LIMITATIONS.md#reliability))
is not evidence about the GB10 in either direction.
