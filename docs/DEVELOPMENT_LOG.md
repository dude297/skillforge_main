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

## Present state (2026-10-25)

What runs and is verified (evidence: [CLAIMS.md](CLAIMS.md), [evidence/gb10/](evidence/gb10/README.md)):

- Core runtime on the dev box: approval gate, verifier, skill registry, deterministic reuse, guided demo and console (mock e2e 78/78 reported; contracts + oncall + gb10_bench 33 passed, 1 skipped).
- GB10: vLLM serving Qwen3.6-35B-A3B-NVFP4; frontier bench (70 requests, 0 errors); live OnCall synthesis (attempt 4 hidden 9/9), a person's approval on the host CLI, INC-2 reuse with 0 model calls (6 trials, p50 28.2 ms), INC-3 refused. Generation is not reliable: 3 of 7 later attempts passed with thinking on, 0 of 1 off; the verifier rejected every failure.
- Current serving: CONFIG `qwen-solo-mtp` (current serving): Qwen3.6-35B-A3B-NVFP4, vLLM 0.21.0, gpu-memory-utilization 0.60, `max_model_len` 131072, max-num-seqs 16, `--async-scheduling`, MTP speculative decoding (`num_speculative_tokens` 2); KV cache 3,708,983 tokens; memory 85/121 GiB. Measured with a QUICK-PROBE harness, not the frontier or `qwen_bench` harnesses, so these numbers are not directly comparable to the frontier tables: c=1 decode 89.6 to 91.2 tok/s (thinking off) and 87.4 to 90.3 (thinking on), against 72 to 74 on the previous config with the same probe; TTFT 0.08 s; aggregate with 512-token requests 189 / 330 / 504 tok/s at c=4 / 8 / 16 (previous config 177 / 240 / 355); MTP acceptance 74.7% (11,061 of 14,814). Sanity check after the restart: PASS, the approved skill intact, INC-2 reuse 0 model calls (49.2 ms), INC-3 refused. The OnCall attempts and the pass-rate evaluation ran under the earlier configs.
- NemoClaw/OpenShell/OpenClaw installed on the GB10; Telegram <-> local model round trip verified; Gate 2 GO (13/13, records-ops tools through the `host-tools` policy).
- Hosted preview: https://skillforge-ui-lab.vercel.app (read-only, recorded data).

Not done: OpenClaw-driven OnCall synthesis (Gate 3: pipeline verified end to end, 0 candidates accepted), Telegram -> SkillForge tools in one message, non-allowlisted-sender check, full egress review, GPU/power/token savings.

## History

The sections below are the record of how the work unfolded; they are history, not current status.

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
| 2026-10-25, early | Dated on the event date but outside the event-day product work (a judgement call; the event start time is not recorded): Telegram bridge experiment (not merged; its code is **not in this tree**; the later GB10 Telegram setup is under `integrations/telegram/`) and the event-kit screenshots | `4440911` (`exp/telegram`, 04:07), `fce80be` (`prep/event-kit`, 12:30) |

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
| 9 | Release preparation: this public tree, redactions, docs, licence, security and a release audit (one-off; superseded by this document) | documentation commits `0be258a`, `b9ea481`, `535c1bb`, `6890664`, `636cf8c`, `0590be3` (13:02-14:17, branch `publish/public-rc`); public snapshot `633b030` (14:39); audit on branch `docs/public-release` | completed | see Part 3 | the audit was a review by the same team's tooling, not an external review |

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

Parts 1 to 3 above predate the GB10 session. The test results in Part 3 are dev-box results and were not re-run for
the GB10 patches. The live GB10 model results are in the next section.

## GB10 results (event day, 2026-10-25)

Source: the GB10 operator's session, reported to this tree. Evidence files live on the GB10/SSD; the sha256 below
identify them. Code: public `633b030` plus GB10 patches (final runs at `35d5820`). Full figures:
[CLAIMS.md](CLAIMS.md).

| step | evidence | result | notes |
|---|---|---|---|
| hardware and serving | frontier report sha256 `6890165aa86abbb7834ec2aa15784bbf6326104363466d786b0fd66d4e8d23e2` | NVIDIA GB10, aarch64, driver 580.178.04, 121.63 GiB; vLLM 0.21.0+2325b6f0.dev; Qwen3.6-35B-A3B-NVFP4 as `skillforge-qwen`, `max_model_len` 32768 (earlier config: 0.4 / 4 seqs) | NemoClaw/OpenShell not yet installed at this step (installed later the same day, see below) |
| bench (frontier) | same report | c=1/2/4: 10/20/40 requests, 0 errors; TTFT p50 0.0623 / 0.1087 / 0.1026 s; decode p50 75.63 / 61.83 / 55.27 tok/s per request; min MemAvailable 62.78 GiB; peak 62 C, 42.07 W | per request, not aggregate |
| oncall `--live` #1 to #3 (original prompt) | operator report; no sha256 supplied | #1 Qwen non-thinking 5/9; #2 Qwen thinking 7/9; #3 Nemotron 2 calls, 660 s, 51,972 tokens, failed lint; all rejected | 0 of 3 passed |
| operator prompt revision | commit `f1457b0` on the GB10 branch | evidence-sufficiency rule added after the 7/9 result; authoring agent did not read the hidden suite | disclosed manual hint |
| oncall `--live` #4 (revised prompt) | `docs/evidence/gb10/attempt4-oncall-run.json` sha256 `712dbf7827e0f7c1bf16890d8efcb2758398bcfcd888eeb3766e12369f634b58` (sanitized; original `6683d26b...`) | 1 call, 173.0 s, 1,998 / 12,763 tokens; hidden 9/9, regression 5/5, PASSED, staged `tested`; skill tree sha256 `7fe0c025039b11b93617ba63955f3fe9da0ec55c7e7a0ed11bbae3982fa3aa0e`; proposal only | GPU telemetry not captured |
| oncall `--live` #5 (repeat) | `docs/evidence/gb10/attempt5-oncall-run.json` sha256 `f95121b01f36373f43d06ccc377bc739987841b17576883db04879ee6a2ee01d` (sanitized; original `0448b065...`) | 1 call, 233.8 s, 1,998 / 17,067 tokens; hidden 8/9, REJECTED, not staged; 235 GPU samples, util p50 96%, max 67 C, max 44.0 W | model answered `not_applicable` where the prompt says `requires_review`; output not deterministic at temperature 0 |
| runner | operator report | subprocess runner for every run (Docker permission-denied; docker path fails closed) | hidden-suite secrecy needs Docker |
| security finding | commit `1094d95` | lint bypass via aliasing / `operator.attrgetter` fixed; attempt 4 unaffected (hash unchanged, imports `json`, `typing` only) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| person's approval of #4 (`approval.kind`) | operator report, 2026-10-25T20:25:02Z | a person (the operator) ran `skill approve ... 1 --by "<operator>"` on the host CLI: approved, active, sha256 `7fe0c025...aa0e` matches, hidden suite re-run ok, `approval.kind` `host_cli` | `--by` not identity-verified |
| reuse (INC-2 model_calls, latency; INC-3 refused) on the GB10 | `docs/evidence/gb10/reuse-oncall-run.json` (sanitized sha256 `029bb68463e95c4628ad3acf2dc96e34724155ae8aa3f06c17b796605b974260`; GB10 original `1e32985ef4bffa612f5c36879ec1dbdbe9415d1badee85059f5f29eef84086d2`); console.txt `c0f70c5f...fcb2`; SSD SHA256SUMS 57 lines, 0 failures, sha256 `e40e446b...895e` | INC-2: 0 model calls, 27.0 ms; 6 fresh-process trials p50 28.2, min 27.0, max 42.1 ms; INC-3 refused every time (fingerprint: OOM -> disk full); vLLM request counters unchanged (Qwen 44713, Nemotron 78758) | subprocess runner (no Docker isolation); n=6; latency scope is decision plus sandboxed run, not a speed-up claim |
| oncall `--live` #6 (Nemotron, adapter fix) | GB10 `console.txt` sha256 `c103565e937f9a1254d934d8982f4a0e2ef33dd1d4411518a30d09f1d2521cee` (not in this repo) | FAILED, no candidate: both calls hit `max_tokens`=32000 while reasoning (finish_reason=length). Nemotron 0 of 2; Qwen 1 pass in 4. 13.7 min wall (contended by the NemoClaw install); GPU util p50 96%, max 74 C, max 46.2 W | thinking-budget problem, not formatting |
| NemoClaw stack install | operator report | NemoClaw v0.0.137 (pinned), OpenShell 0.0.116, OpenClaw v2026.9.2 installed with the operator's authorization; no sudo | OnCall loop has not run under it |
| sandbox `skillforge` | operator report | agent openclaw, restricted tier; provider compatible-endpoint to `skillforge-qwen` at 127.0.0.1:8000, seen in the sandbox as `https://inference.local`; GPU/CUDA verified; only network policy `telegram_bot` (api.telegram.org:443, rest, enforce) | [telegram_setup.md](../integrations/telegram/telegram_setup.md) |
| incident: sandbox deleted | operator report | the first `channels add telegram` rebuild deleted the original sandbox `my-assistant` (non-interactive recreate lacked `NEMOCLAW_COMPATIBLE_AUTH_MODE=none`, failed at provider_selection). Fixed in `integrations/telegram/telegram-setup.sh`; recreated as `skillforge` with Telegram set at onboarding; vLLM untouched | do not run `channels add` on a sandbox you need without the fixed script |
| Telegram <-> local model round trip | GB10 `openshell-ocsf.txt` sha256 `2237e29930c8846da986b97163df10662165ea4c1c812277b76c0c40bec290e7` (token-free; not in this repo) | VERIFIED in OpenShell OCSF logs: getUpdates -> inference.local -> sendChatAction -> sendMessage, all ALLOWED by `telegram_bot`; `skillforge-qwen` logged 5 chat completions in the window, Nemotron 0; `telemetry.openclaw.ai:443` DENIED | not verified: a single Telegram message driving SkillForge tools end to end, non-allowlisted-sender check, full egress review; see [GAPS.md](../integrations/telegram/GAPS.md) |
| Gate 2: OpenClaw (sandbox `skillforge`) -> SkillForge host tools | GB10 report sha256 `25a552fe863dcbcce74fb4c5b66c0d4243ec66e95a959d750af6c7f046b99885` (not in this repo); `scripts/gb10_preflight.sh gate2` -> "RESULT: GO (gate2)" | GO 13/13. Tool service `serve --bind 172.18.0.1 --port 8765` (bridge only, 401 without token, `SKILL_RUNNER=docker`, scratch state `learn_a`, 5 records; approved registry untouched). Policy `host-tools` (dry-run reviewed, applied): only host.openshell.internal:8765, POST /call, `/usr/bin/python3`. Session `gate2-rt-1`: `search_skills` + `read_records` -> A-101..A-105 (4 calls, 0 failures); `gate2-rt-2`: `get_audit`. OCSF ALLOWED `/usr/bin/python3.13 -> POST http://host.openshell.internal:8765/call`, `denied_action_count`=0. `decide_approval` from the sandbox: `unknown_tool`. Access log per request, commit `2f8c6e7` | records-ops tools only; OnCall flow under OpenClaw (Gates 3/4) in progress; Telegram -> tools in one message not recorded |
| serving change (Qwen only, UNCONTENDED) | GB10 `artifacts/bench/qwen3.6-35b-a3b-nvfp4-solo128k-20261025T215550Z.json` sha256 `8b035111270928b25352682de5780dadad16a09538dc7daacb4cfc9b20f3c7c2`; SSD `SHA256SUMS` sha256 `d199b610022ca4a9f0685fa84cf8c1fb7deb4bccf2398104904f72e0388bb28a` (93 lines, 0 failures) | Nemotron stopped on purpose after 0/2 on OnCall (container kept). Qwen3.6-35B-A3B-NVFP4, vLLM 0.21.0, 0.80 / `max_model_len` 131072 / 16 seqs / fp8 KV; KV cache 6,669,475 tokens (was 183k), 50.88x at 128k, memory about 88% (106.8/121.6 GiB). Thinking off c=1/2/4: TTFT p50 0.058/0.085/0.082 s, decode 73.8/59.2/55.6 tok/s, aggregate 73.8/118.4/222.5, 0/70 (earlier config 0.062/0.109/0.105, 75.6/61.9/55.2, aggregate 75.6/123.8/220.8, 0/70). Thinking on: decode 72.7/57.0/34.0, aggregate 72.7/114.1/136.2, 0/70, 75 C, 71.8 W. `qwen_bench` 33 req c=1: TTFT p50 0.069 s, e2e p50 0.689 s, 73.2 tok/s, JSON 12/12, tool calls 12/12, 0/33 errors. Non-streaming 512 tok aggregate 177/240/355 at c=4/8/16 | single-stream decode unchanged (memory-bandwidth bound); buys context 32k -> 128k, KV capacity, concurrency headroom. Thinking-on c=4 drop unexplained, not re-run. All OnCall results were under the earlier config |
| default `ONCALL_MAX_TOKENS` 24000 | commit `d14701d` | live thinking runs used 12-17k tokens; 8192 truncated them | no run under the new default is recorded here |
| listener review | operator report | NemoClaw auth proxy on `0.0.0.0:11435` (token-protected, 401 without token; hard-coded upstream). Other new listeners loopback/bridge only. UFW mitigation proposed, **not applied** | [ARCHITECTURE.md](ARCHITECTURE.md) |
| hosted preview | operator report | Vercel project `skillforge-ui-lab` (Root Directory `ui`), https://skillforge-ui-lab.vercel.app, read-only, recorded data, no backend calls | not the product |

A failure on Windows localhost (for example the intermittent tests in [CLAIMS.md](CLAIMS.md))
is not evidence about the GB10 in either direction.
