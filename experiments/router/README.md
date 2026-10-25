# exp/router: deterministic-first routing sprint (EXPERIMENTAL)

This branch is `exp/router`, cut from `integ/live` at rc1 (`a6fd80a`). Nothing under `app/`, `adapters/`, `tests/` or `data/` changed. Core never imports `experiments/`. This is experimental code.

**V2 (organizational skill library).**
- The router now gates exact matches through `experiments/catalog` (namespace, freshness, hash, environment) and attaches bounded catalog suggestions to escalations.
- Docs: `experiments/catalog/ARCHITECTURE_V2.md`, `SKILL_LIBRARY.md`, `PRODUCT_USE_CASES.md`, and `ROUTER_ACCEPTANCE.md` (here).

| file | what it is |
|---|---|
| `router.py` | the event router: 5 durable decisions, no model call on the routing path |
| `test_router.py` | 20 safety tests (lookalike, duplicates, restart, pending approvals, model down, conflict, failed verification, policy auto-approval, ambiguity, untrusted events, power, bootstrap, harness) |
| `compare.py` | A/B/C benchmark harness: always-agent vs deterministic-first vs deterministic-first with the model down |
| `power.py` | read-only detection of model sleep capability and GPU power; advice only, never acts |
| `bootstrap.py` | read-only environment manifest for one environment type (an ops fixture) |

```bash
python -m pytest -q -p no:cacheprovider experiments/router        # ~80 s on the dev box
python -m experiments.router.compare --trials 3                     # MOCK agent
python -m experiments.router.bootstrap data/learning/lookalike.json
python -m experiments.router.power                                  # on the GB10, with LLM_BASE_URL set
```

## 1. Audit: what already existed (reused, not copied)

| capability | where | status before this sprint |
|---|---|---|
| structural fingerprints | `sf.task_signature`, `stable_fingerprint`: shape, kinds, sources, writable fields, invariants | existed |
| deterministic matcher | `sf.match_skills`: a skill is used only for exactly one approved, active, all-parts-equal match | existed |
| `fastpath` | `ops.fastpath`: no-model reuse plus `--execute` for approved skill actions | existed, CLI-triggered, one-shot, no event identity |
| Mode C routing | `bench.trial` mode C: matcher, then skill, preflight, approve, execute, verify, else agent fallback | existed, benchmark only |
| skill registry and approval | `propose_skill`, then replay, hidden suite, human `approve_skill`; hash-pinned `approved/` | existed |
| model registry and probes | `data/models.json`, `adapters/models.py probe`, `learning_allowed` | existed |
| model switching | `scripts/switch_model.sh`: operator-run, probe, roll back | existed, manual only |
| durable task state | `tasks` table; workflow state derived from actions, executions and verifications (`ops.workflow_state`) | existed |
| crash recovery | `ops.recover`: verifies VERIFYING actions, never re-executes | existed |
| host service | `app/server.py`: token, agent tools only, no 0.0.0.0 bind | existed |
| OpenClaw invocation | `bench.OpenClawAgent`: `nemoclaw exec -- openclaw agent --json`, Gateway envelope parser | existed, unverified on the GB10 |
| audit trail | `audit` table, `db.audit` | existed |
| **missing before this sprint** | event identity and dedup, durable routing decisions, a "deferred, model down" outcome, a "human decides" outcome for ambiguity and conflicts, a check that the approver is a person and not policy, single-flight protection, power-state detection, an environment manifest | **added here, experimental only** |

## 2. Architecture (current, plus the experimental router)

```
 event source (allowlisted)            HOST (trusted)                                     SANDBOX (OpenShell)
 ─────────────────────────   ┌──────────────────────────────────────────────────────┐   ┌──────────────────┐
 {event_id, source, type,  ─▶│ router.route ──validate──▶ refused                    │   │ OpenClaw agent   │
  scenario-ref}              │   │ dedup(event_id, sha) ─▶ stored decision            │   │  (local vLLM)    │
                             │   │ single-flight ───────▶ deferred(busy)              │   │      │           │
                             │   ▼                                                    │   │      ▼           │
                             │ sf.match_skills (fingerprint, NO model)                │   │ client.py ──┐    │
                             │   ├─ 1 exact ─▶ run_skill(propose) ─▶ preflight        │   └─────────────┼────┘
                             │   │              ├─ ok ─▶ awaiting_approval ─▶ HUMAN   │                 │
                             │   │              └─ bad/conflict ─▶ needs_human        │  app.server ◀───┘
                             │   ├─ ambiguous ─▶ needs_human                          │  (agent tools only,
                             │   └─ none/uncertain ─▶ inference_up()? (GET /models)   │   token, bridge IP)
                             │          ├─ yes ─▶ queued_for_agent ─────────────────────▶ agent turn
                             │          └─ no  ─▶ deferred (no cloud fallback)        │
                             │ router.complete: human-approved only ─▶ ops.fastpath   │
                             │   (execute+verify) ─▶ completed | needs_review         │
                             │ SQLite (WAL): records, actions, approvals, executions, │
                             │   verifications, audit, skills, router_events          │
                             │ Docker/subprocess skill runner (--network none, ro, …) │
                             └──────────────────────────────────────────────────────┘
```

Safety properties, each backed by a test:
- **A match never authorises.** The skill only proposes. `complete` executes nothing while any approval is pending, and it refuses actions approved by `policy` instead of a named person (`test_policy_auto_approval_is_not_human_authorization`).
- **Lookalike data cannot run the wrong skill.** `lookalike.json` (same shape, different meaning) and `unrelated.json` are queued or deferred, with zero skill runs and zero actions (`test_lookalike_never_runs_the_skill`).
- **No semantic matching.** Routing uses only `match_skills` equality. Keyword search (`search_skills`) is not used for routing.
- **Duplicates and restarts.** The same `event_id` with the same body returns the stored decision and runs nothing new. The same id with a different body is refused. A crash mid-route resumes on redelivery without re-loading data or duplicating actions (proposals dedup by idempotency key).

## 3. Hybrid runtime specification (design; only the router part is built)

**Coordinator:** one long-lived host process. stdlib, no model, no LLM heartbeat. Its jobs:
1. **Receive** events from allowlisted local sources: a unix socket or the `router route` CLI, later a file-drop watcher. Each source has its own allowed `type` set, and events carry references to data, never policy or approvals.
2. **Route** with `router.route` (built).
3. **Queue.** `router_events` *is* the queue: `queued_for_agent` and `deferred` rows. No new broker.
4. **Track health** as four separate signals, never collapsed into one:

| signal | check | cost |
|---|---|---|
| coordinator health | process alive plus `PRAGMA quick_check` | none |
| inference availability | `GET /v1/models` (health, not generation) | ~ms |
| agent session availability | `nemoclaw <sb> status` (`ops._sandbox_check`) | subprocess |
| approved skill execution | Docker runner present, image tagged, skill hash intact | subprocess |

5. **Dispatch.** When inference is up, take the oldest `queued_for_agent` row and run one agent turn (`OpenClawAgent.turn`). When inference comes back after `deferred` rows, re-route them through redelivery, which the router already supports.
6. **Wake policy.** Read `power.detect()` once at start and after every model switch. The idle policy is **off by default**. Even when it is configured, it only *recommends* (`operator_may_sleep`). An operator command does the sleep and wake, and only after hardware validation. The coordinator never stops a model or an unrelated container.

The loop is event-driven: block on the socket, and wake on a timer of minutes only to re-check `deferred` rows against inference health. No polling goes through the model.

## 4. Bootstrap feasibility (one environment type)

`bootstrap.py <fixture>` produces the environment summary, tool inventory with signatures, declared capabilities (the policy's actions, fields and invariants), input shape and proposal schema, roles from code constants, example event, compatible skills, near misses, and missing-skill opportunities. Fixture text is wrapped as `untrusted_text` and truncated. The app DB is opened `mode=ro`, and a test checks that the DB file hash is unchanged. It does not infer privileges and does not write to the environment. A Git-repo environment type is **not** built; see the roadmap.

## 5. Evidence (dev box, MOCK agent, 3 trials × 9 cases × 3 variants)

| variant | n | correct | handled without inference | escalated to agent | needs human/review | deferred | false skill match | missed skill | wrong change | median tool calls | model calls | energy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A always-agent | 27 | 24 | 0 | 27 | 0 | 0 | 0 | unknown | 0 | 15 | unknown | unknown |
| B deterministic-first | 27 | 24 | 9 | 15 | 3 | 0 | 0 | 0 | 3* | 7 | unknown | unknown |
| C B with model down | 27 | 15 | 9 | 0 | 3 | 15 | 0 | 0 | 3* | 0 | **0** | unknown |

How to read this:
- **Correctness.** B is as correct as A. C stays safe: the 12 "not correct" rows are deferred work that was left **undone and unchanged**, not wrong changes.
- **The starred wrong changes** are the injected `post_execute_drift` fault, where another writer changes the record after execution. In B and C the verifier catches it and the event ends `needs_review`. Mock agent A has no retry, so it also fails that case.
- **Model calls.** Only C's 0 is measured, and it is structural: the router path makes no inference request, which `test_exact_match_*` asserts. Agent model calls are unknown with the mock agent.
- **Latency.** Mock latencies are meaningless for this comparison because the mock agent costs about 0 s. The skill path pays a subprocess skill run, so B's median looks slower than A's here. The real comparison needs the GB10 model.
- **Energy** is unknown everywhere. No power source exists on this host.

## 6. Open questions only the GB10 can answer

1. Does NemoClaw-managed vLLM expose `/is_sleeping` (sleep mode plus dev mode)? Run `python -m experiments.router.power`. If it does, what are the measured sleep→wake latencies and the memory released?
2. Does `nvidia-smi --query-gpu=power.draw` report on GB10 unified memory, or `[N/A]`? Is there another power source (Dell/NVIDIA tooling, IPMI)? Until one is found, energy stays unknown.
3. Cold vs warm agent latency and model calls per task for A vs B, with the real OpenClaw agent: run `compare.py` with an OpenClaw agent swapped in. One-line change: pass `bench.OpenClawAgent()`.
4. Idle power with the model resident vs slept, if sleep is supported.
5. Whether the `GET /v1/models` health check needs `LLM_API_KEY` under NemoClaw. It sends the key if set.

## 7. Recommendation for the demo

**Don't ship the router.** rc1's `python -m app fastpath` already covers the demo need: exact-match reuse with no model, behind human approval. If judges ask about "repeatable work without the model", show `fastpath` and, optionally, the table in §5 clearly labelled MOCK. Run `power.py` once on the GB10 (read-only) and record the answer to Q1–Q2. That is the only sprint item worth demo time.

## 8. Long-term roadmap (each step gated on the previous one's evidence)

1. **Real-model comparison** on the GB10: fill A/B model calls, latency, and the cold/warm split. Kill the idea if B doesn't beat A per verified task.
2. **Coordinator process** (§3) around `router.route`, using a unix socket and the existing `router_events` table.
3. **Per-record locking** instead of single-flight, once events reference live records instead of whole-dataset fixtures.
4. **Measured power policy**, only if Q1 and Q2 come back positive: operator-confirmed sleep, then a configurable idle threshold.
5. **A second environment type** for bootstrap (a read-only Git repo: tree, manifests, test commands as untrusted data). Only after one real event source exists.
6. Never: automatic skill self-promotion, cloud fallback, semantic matching as authorisation, or multi-tenant claims.
