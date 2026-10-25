# Resilience: model portability, failover, crash recovery, and fault results

Everything here was tested on a dev box with **simulated** failures: a fake vLLM, a fake `openclaw`/`nemoclaw`/`docker`, injected exceptions and held DB locks. None of it is GB10 hardware validation.

## 1. Model coupling: where model-specific facts live

| concern | where | notes |
|---|---|---|
| model ids, profile, parser, context and output limits, memory, storage, constraints, validation status | `data/models.json` | the only place; code reads it |
| endpoint, auth, timeout, retries | env: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_TIMEOUT`, `LLM_RETRIES` | `adapters/llm.py` |
| capability gate | `python -m app models probe` writes `data/model_probe.json` | 6 checks: endpoint, identity, **native** tool call, argument schema, two-step tool use, latency bound |
| agent CLI | `AGENT_CMD`, `AGENT_TIMEOUT`, `AGENT_RETRIES` | `app/bench.py` OpenClawAgent |
| metrics | `LLM_METRICS_URL`; unknown stays null | `adapters/metrics.py` |
| SkillForge business logic | **no model references** | skills are deterministic Python run in the sandbox runner; nothing is coupled to a model at run time (tested) |

Real-model skill generation (`bench.learn`, Gate 3) **refuses to start** unless the model being served now passed the probe within the last 12 h. The probe result names the model, and switching models means probing again.

## 2. Failover

| class | behaviour | tested by |
|---|---|---|
| transient inference error (connection refused, timeout, 5xx) | `LLM_RETRIES` (default 2) with exponential backoff, then `LLMUnavailable`. A 4xx (auth, model id) is not retried. | `test_f04_model_timeout_and_5xx_are_bounded` |
| agent gateway or CLI down | one retry (`AGENT_RETRIES`), only when the CLI produced no JSON. Timeouts are **not** retried because the run may still be in flight. Business tools are idempotent, so a repeated turn can't duplicate an action. | `test_f02_transient_*`, `test_f04_agent_turn_timeout_*` |
| primary model unavailable or incompatible | **operator-run** `scripts/switch_model.sh <new> <prev>`: stop the managed vLLM, `nemoclaw onboard --profile`, wait for `/health`, probe, check that `nemoclaw inference get` matches what is served. If any step fails, roll back to `<prev>` and re-probe. No hot standby: only one model is resident, and each switch takes minutes and recreates the sandbox (its home is copied). | `test_switch_model_verifies_and_rolls_back` (3 outcomes, with fake binaries) |
| all inference unavailable | `python -m app fastpath`: reuse only an **exact-match** approved skill, under the same policy, human approval and verifier. Anything else is escalated and audited as `escalated_no_model`. Read-only `status` keeps working. **No cloud fallback exists anywhere.** | `test_no_model_*` |

## 3. Workflow lifecycle and crash recovery

The workflow state is derived from the authoritative rows. There is no second state table that could disagree with them.

| durable rows | state |
|---|---|
| action `proposed` | PENDING |
| `pending_approval` | WAITING_APPROVAL |
| `approved` | READY |
| `executed`, no verification | VERIFYING (interrupted) |
| last verification passed | COMPLETED |
| last verification failed | NEEDS_REVIEW |
| `rejected` | CANCELLED |

- **Why EXECUTING is not a state:** `execute_action` writes the mutation, the execution row and the status flip in one SQLite transaction, under `BEGIN IMMEDIATE`, with every check inside the lock. A crash leaves the action either READY or VERIFYING, never half-applied.
- **When a reply is lost:** the retry returns `already_executed` with the recorded before/after values. Nothing is reapplied.
- **After a restart:** `python -m app status` shows what's stuck and what to do. `python -m app recover` verifies interrupted executions. It is a read-only check against the authoritative state and **never re-executes or approves**. Results that are still uncertain stay at NEEDS_REVIEW for a human.
- **Benchmark tasks** left open by a killed run are marked `aborted` on the next run. A human's open task is never touched.

## 4. Data integrity

- WAL journal plus `busy_timeout`. A lock held past the timeout now returns a retryable `db_busy` error instead of an exception, and nothing is partially written.
- `PRAGMA user_version` schema versioning. Migrations run as one transaction. A DB from **newer** code is refused.
- `python -m app db check|backup|restore`. Backups use the online backup API. `restore` refuses a backup that fails `integrity_check`, refuses while `serve` or `ui` still listens (any accepted connection counts, even a broken or wrong service) (offline only: a running agent could act on ids that name different actions in the restored generation), refuses when it cannot check `serve` unless the operator passes `--services-stopped`, and keeps the current DB as `*.before-restore-*`. Ids are not unique across generations (no AUTOINCREMENT), so start a NEW agent session after a restore; approvals stay safe because `approve --expect` binds the command to the action's content. Residual: a service started in the seconds between the check and the copy is not detected.
- Two open fixes that set the same record field to different values are refused (`conflict`).
- Skill promotion runs the hidden suite, copies the files, then commits the DB in one transaction. A crash before the commit leaves the skill `tested`, and promotion can be re-run safely.
- The DB, verifier, approvals and hidden suite are all on the host. In remote mode the sandbox gets only `client.py`, its URL and a token for agent tools.

## 5. Fault-injection matrix (`tests/test_faults.py`, plus the existing suites)

| # | failure | result | test |
|---|---|---|---|
| 1 | inference down before a task | learning refused, no task and no mutation; probe NO-GO | `test_f01_*` |
| 2 | model or agent crashes mid-investigation | re-proposing dedups; state is WAITING_APPROVAL; gateway failure retried once | `test_f02_*` |
| 3 | invalid structured tool calls | probe fails on `native_tool_call`/`schema`; bad args never reach business logic | `test_f03_*` |
| 4 | response timeout | the model gets bounded retries; an agent turn becomes `exit=timeout` without a retry | `test_f04_*` |
| 5 | host service restarts | client retries only a refused connection, then succeeds once | `test_client_survives_service_restart`, soak |
| 6 | timeout after the request reached the service | client reports `service_unreachable` (no false success); the retry returns `already_executed`; 1 execution | `test_f06_*` |
| 7 | interrupted during execution | rolled back, nothing half-applied; executes exactly once later; a restart before verify is fixed by `recover` | `test_f07_*` |
| 8 | DB temporarily unavailable | `db_busy` with `retryable`, no partial write; 6 concurrent executes give 1 execution and no errors | `test_f08_*` |
| 9 | approval delayed or rejected | never executes; state is CANCELLED | `test_f09_*` |
| 10 | hidden validation fails | not promotable; at most 5 unapproved drafts per name (bounds oracle probing) | `test_hidden_suite_*`, `test_f10_*` |
| 11 | approved skill fails on reuse | falls back to the agent and is counted on the skill; every executed action is verified | `test_f11_*` |
| 12 | Docker runner killed or over memory | killed by the cgroup limit; errors become `skill_error`, never proposals | `test_docker_*`, `test_runner_blocks_*` |
| 13 | wrong model or provider config | `not served` error; probe fails identity | `test_f13_f14_*` |
| 14 | missing or unregistered model artifacts | probe fails identity; a probe of another model doesn't count | `test_f14_*` |
| 15 | messaging channel unavailable | **not testable here.** NemoClaw keeps channels separate (`channels stop/start/status`); local `openclaw agent`/TUI paths don't use them (INFERRED). Runbook R12. | — |

**Soak (`python -m app soak`, mock):** 30 trials with seed 7 and 60 trials with seed 11, both **clean**. The mix covered trials, duplicate executes, a crash before verify, a service restart, a held DB lock and the no-model fast path. Results: 0 duplicate mutations, 0 unrecovered, 0 wrong matches, 0 exceptions, invariants checked after every trial. CI runs `test_soak_mock_trials_are_clean` with 24 trials.

## 6. Acceptance matrix (cross-model and degraded mode)

| requirement | primary (Qwen3.6) | alternate (Lightning, experimental) | no-model |
|---|---|---|---|
| passes probe (tool call, schema, two-step) | GB10 (`models probe`) | GB10 | n/a |
| solves an unfamiliar task | GB10 Gate 3 | GB10 (bake-off) | **refuses and escalates** (tested, mock) |
| generates a candidate skill | GB10 Gate 3 | optional | n/a |
| passes independent validation | GB10 Gate 4 | same hidden suite | n/a |
| reuses an approved skill | GB10 Gate 5 | **must** reuse the primary's skills (tested: skill runs regardless of model) | **yes**, with the same approval and verifier (tested, mock) |
| documented limitations | after Gate 5 | after bake-off | exact-match skills only |

Being able to run on either backend does **not** mean both models are equally capable. Model quality is compared only by `bakeoff` on real inference.

## 7. Readiness scorecard (verified capabilities only)

| area | verified here | GB10-only | score |
|---|---|---|---|
| deterministic core (approval, idempotency, verifier, atomic execute) | yes, 135 tests | — | ✅ |
| crash recovery / no duplicate mutation | yes (fault suite + soak) | real process kills under load | ✅ (simulated) |
| model capability gate + switch/rollback | logic yes (fakes) | real `onboard`, real parsers, switch time | 🟡 |
| no-model degraded mode | yes (mock) | — | ✅ |
| sandbox → host boundary | contract yes | OpenShell policy dry-run, DNS | 🟡 |
| Docker runner isolation | amd64 + arm64 (QEMU) | GB10 cgroups | 🟡 |
| offline restore | arm64 container | real USB on the box | 🟡 |
| real-model learning and reuse benefit | **no** | Gates 3–5 | 🔴 unknown |
| messaging channel | **no** | `channels add`, outage behaviour | 🔴 unknown |

✅ verified on the dev box · 🟡 logic verified, platform behaviour unverified · 🔴 not yet run
