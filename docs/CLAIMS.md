# Claims and evidence

Limitations in one place: [LIMITATIONS.md](LIMITATIONS.md). Measurements: [BENCHMARKS.md](BENCHMARKS.md).

Status values: **verified** (a test or recorded run in this tree shows it), **implemented** (code exists, no
dedicated evidence beyond review), **recorded simulation** (shown with a hand-written stand-in for the model),
**proposed** (design only), **not done**.

Environment "dev box" = Windows 11 x86_64, no GPU, Python 3.14.3, synthetic data, no real model.

Each claim rests on one of three kinds of evidence: tests and measurements on the dev box, recorded simulation,
and real hardware verification. **No claim has real hardware verification.**

| # | claim | status | evidence | environment |
|---|---|---|---|---|
| 1 | Execution requires a person's approval at the host CLI; the agent has no approve tool | verified | `tests/test_core.py` (`test_agent_cannot_approve`, `test_execute_refused_without_approval`); [ARCHITECTURE.md §C](ARCHITECTURE.md#c-independent-verification) | dev box, MOCK |
| 2 | Each action executes at most once and every state change is audited | verified | `test_duplicate_proposal_and_execution_prevented`, `test_state_persists_across_connections` | dev box |
| 3 | The verifier re-reads state instead of trusting the agent | verified | `test_verification_checks_real_state` | dev box |
| 4 | Skills are hash-pinned; tampered skills are refused | verified | `tests/test_skillforge.py::test_tampered_approved_skill_refused` | dev box |
| 5 | A hidden suite catches skills that pass their own tests and the replay | verified | `tests/test_skillforge.py::test_hidden_suite_catches_what_self_tests_and_replay_miss` | dev box |
| 6 | The agent cannot promote a skill; an unapproved skill cannot run | verified | `tests/test_skillforge.py::test_agent_cannot_promote_and_unapproved_cannot_run` | dev box |
| 7 | Lookalike data with the same shape is routed to the agent, not to the skill | verified | [SKILLFORGE.md §12–13](SKILLFORGE.md#12-deterministic-skill-matcher) (`lookalike_fingerprint` 5/5 → agent) | dev box, MOCK |
| 8 | Deterministic reuse uses no model on the happy path | verified (MOCK) | [SKILLFORGE.md §13](SKILLFORGE.md#13-three-mode-benchmark-python--m-app-bench): mode C decision `skill` | dev box, MOCK |
| 9 | Reuse reduced tool calls from 20 to 7–8 | verified (MOCK) | [SKILLFORGE.md §13](SKILLFORGE.md#13-three-mode-benchmark-python--m-app-bench), `unseen_compatible` row | dev box, MOCK |
| 10 | Reuse is faster than the agent | **not shown**; in MOCK it was slower (0.06 s → 0.17 s) | [SKILLFORGE.md §13](SKILLFORGE.md#13-three-mode-benchmark-python--m-app-bench) | dev box, MOCK |
| 11 | Learning pays back after n reuses | **pending** (no model-call data) | [SKILLFORGE.md §14](SKILLFORGE.md#14-learning-break-even-benchbreakeven) | — |
| 12 | OnCall: INC-2 is reused with zero model calls | verified (test) + recorded simulation | `experiments/oncall_infer/test_oncall_infer.py::test_after_approval_inc2_reused_with_zero_model_calls_and_inc3_refused`; `ui/public/demo/oncall-run.recorded.json` (`reuse.model_calls: 0`) | dev box, no model |
| 13 | OnCall: INC-3 is refused. The refusal comes from the **experiment's** fingerprint check, not from core; core `match_skills` says exact (known core gap) | verified (test) + recorded simulation | same test; `test_core_matcher_false_positive_on_lookalike_is_a_known_gap`; `refusal.reason` in the recorded JSON | dev box |
| 13a | OnCall: the fingerprint is bound to the approved registry row and fails closed; a direct core `run_skill` on INC-3 proposes nothing | verified (test) | `test_missing_or_tampered_fingerprint_refuses_reuse`, `test_core_path_bypass_yields_no_proposal` | dev box |
| 13b | OnCall reuse latency of about 117–256 ms across runs (256.0 ms in the committed artifact) | measured on the dev box: match plus deterministic execution only. **Not** an end-to-end inference saving; the first run had no model call to compare against | `reuse.latency_ms` in the recorded JSON | dev box |
| 13c | The recorded OnCall diagnostic code | **hand-written** reference (by a coding agent), not model output | `experiments/oncall_infer/reference_skill/`; `synthesis.provenance: recorded_reference` | — |
| 13d | The recorded OnCall approval | by a **synthetic agent identity** (`approval.kind: simulated`), not a person; only `host_cli` counts as a person, and names are not identity-verified | `approval` in the recorded JSON | — |
| 14 | OnCall: the reference skill passes the 9-case hidden suite; a wrong skill fails it | verified | `test_reference_skill_passes_hidden_and_stops_pending`, `test_wrong_skill_fails_hidden` | dev box |
| 15 | A local model writes the OnCall skill | **not done** | the `--live` path is tested only against a stub server (`test_live_path_counts_calls_and_tokens_against_a_stub_server`); it fails loudly with no silent fallback (`test_live_strict_fails_loudly_writes_nothing_and_keeps_previous_state`) | — |
| 16 | Pinned freight verifier refuses a newer contract revision | verified | `tests/test_freight.py::test_newer_contract_revision_invalidates_the_verifier` | dev box |
| 17 | Stale catalog skills are refused until revalidated | verified (experiment) | `experiments/catalog/test_catalog.py` | dev box |
| 18 | Generated code runs in Docker with no network, read-only, uid 65534 | verified locally | [SKILLFORGE.md §11](SKILLFORGE.md#11-trust-boundary-v2-trusted-service-outside-the-sandbox) | dev box, Docker Desktop |
| 19 | Indexed freight variant: 31× faster skill compute at 4,400 records | measured; **human-authored research, not promoted** | [EXEC_PERF.md](EXEC_PERF.md) §2; `experiments/perf/results/devbox.json` | dev box |
| 20 | Browser UI passes its e2e suites (mock 68/68; local backend 15/15) | verified on the dev box (reported; not re-run on this tree) | `ui/e2e/`, `ui/e2e-live/` | dev box |
| 21 | One-command launcher; attaches instead of colliding; stops only its own process | implemented; verified on Windows only by the owner's session (Ctrl-Break tested, real Ctrl-C not); not re-run on this tree | `scripts/demo_launcher.py` | dev box |
| 21a | Guided demo `#/demo`: six scenes, mode banner, autoplay stops at approval unless approved | verified on the dev box: mock e2e 78/78, lint/typecheck/build clean, one local-backend rehearsal (reported; not re-run here) | `ui/src/story/GuidedDemo.tsx`, `ui/e2e/demo.spec.ts` | dev box |
| 21b | GB10 compute-frontier harness | stub-tested only; nothing measured on a GB10 | `experiments/gb10_bench/test_frontier.py`, [GB10_FRONTIER.md](GB10_FRONTIER.md) | dev box, stub server |
| 21c | GB10 bundle and preflight (`deploy/gb10/`) | implemented; preflight dry-run on the dev box failed the inference checks, as expected; **not run on a GB10** | `deploy/gb10/sf-gb10.sh`, [GB10_SETUP.md](GB10_SETUP.md#portable-bundle-path) | dev box |
| 22 | Runs on the Dell Pro Max GB10 with NemoClaw, OpenShell and vLLM | **not done** | [GB10_RUNBOOK.md](GB10_RUNBOOK.md) (procedure only) | — |
| 23 | OpenShell egress policy confines the sandbox to the host service | **not verified** | `adapters/openclaw/presets/host-tools.yaml` | — |
| 24 | GPU, power or token savings | **not measured** | — | — |
| 25 | GPU-aware scheduling, model sleep/wake | **proposed** | `experiments/router/power.py` (read-only detection) | — |
| 26 | Messaging channel (Slack, Telegram) delivers tasks | **not done** in this tree; channel is simulated | `scripts/unified.py` (`SIM_META`) | — |
| 27 | Tests prove skills correct | **no**: tests are evidence, not formal proof | [ARCHITECTURE.md §C](ARCHITECTURE.md#c-independent-verification) | — |
