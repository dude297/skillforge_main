# SkillForge: learn a deterministic skill from a verified solve, then reuse it

**Goal.** The agent learns a new deterministic capability by solving a problem, and then provably reuses it. The proof is verified outcomes and measured calls, not the agent saying it learned.

## 1. Integration decision

**Runtime: OpenClaw inside NemoClaw/OpenShell.** The event listing requires NemoClaw + OpenClaw + OpenShell. Hermes stays optional until the organisers explicitly allow it.

| need | existing capability (verified in docs) | decision |
|---|---|---|
| Agent writes skills | OpenClaw **Skill Workshop**. It writes `workshop-skills/` and "changes apply immediately". Previous versions are saved for undo. There is **no approval gate**. | **Don't** let generated code become an OpenClaw skill directly. Keep it in SkillForge's registry. |
| Agent runs tools | OpenClaw skills (`SKILL.md`, AgentSkills spec) plus the `exec` tool | One skill, `records-ops`. All tools go through `python3 -m app call ...`. |
| Human-gated promotion | Not available in OpenClaw | `python -m app skill approve`, which only a human runs on the host via `scripts/ro.sh`. |
| Isolation | OpenShell sandbox: `/sandbox` writable, filesystem/process policy locked at creation, network deny-by-default presets | The outer boundary. Our runner adds a second, inner layer (see §5). |
| One-off scripting | Agent's `exec` (OpenClaw); `execute_code` in Hermes | Used as **scratch work** during SOLVE. It is never treated as a skill. |

**Why it stays small.** There is no orchestrator, no subagents and no vector DB. There is one model server and one agent. SkillForge is about 350 lines on top of the existing tool layer, it uses the same SQLite file, and every call goes through the same `tools.call()` dispatcher with the same audit trail.

## 2. Lifecycle → mechanism

| stage | mechanism | intelligence type |
|---|---|---|
| DISCOVER | `search_skills` comes first. It returns no compatible skill, so the agent investigates. | deterministic |
| SOLVE | The agent reads evidence and infers the hidden rule. `investigate` reports *no direct mismatches*, so the rule has to be inferred. It may use `exec` scratch code. | **agentic (local LLM)** |
| VERIFY | Fixes go through the human approval gate, then `execute_action`, then `verify_action`. `verify_action` re-reads the DB and checks the scenario's human-owned invariants. | deterministic |
| GENERALIZE | The agent judges whether the rule is repeatable. Only then does it write a draft. | **agentic** |
| GENERATE | The agent writes `SKILL.md`, `scripts/helper.py` and `tests/test_helper.py` into `/sandbox/skill-drafts/<name>/`. | **skill synthesis (LLM)** |
| TEST | `propose_skill` copies the draft to `candidates/<name>/vN`. It then runs three checks: (1) an AST import/call allowlist, (2) the agent's own tests in the restricted runner, (3) a **replay** of the helper on the task's starting snapshot, whose proposals must **exactly equal** the fixes humans approved and the verifier passed. Check 3 is the independent expected output; the agent cannot write it. | deterministic |
| APPROVE | `skill approve <name> <v> --by <human>`. Only `tested` skills qualify, and the files must hash-match what was tested. The skill is copied to `approved/` with its hash pinned. | human |
| REUSE | `search_skills` matches keywords and also checks a **data-shape signature** computed by the system from the learning task's data. `run_skill` runs the approved helper in the runner, and its proposals go through the **same** policy, approval, execute and verify path. | deterministic |
| EVALUATE | `skill_runs` records ok/error/refused and the verifier's pass/fail for every action a skill produced. `tasks` records model calls, tool calls, latency, success and invariant violations. | deterministic |
| IMPROVE | If a skill-originated action fails verification, `verify_action` returns a `hint` and the failure is counted. The agent re-solves the case and calls `propose_skill` with the same name, which creates vN+1. A human approves it, or runs `skill rollback` / `skill disable`. | agentic + human |

**What is not learned.** A task that executed nothing, or whose fixes didn't pass verification, is refused with `nothing_verified`. A skill whose replay doesn't reproduce the verified fixes is marked `failed_tests` and cannot be approved.

## 3. Synthetic learning scenario (`data/learning/`)

| file | content | expected behaviour |
|---|---|---|
| `learn_a.json` | 5 records. `total` should equal `sum(lines)/scale` from trusted `line_export` evidence, with scale 100. Two records are wrong. Nothing in the tool output states the rule. | The agent must reason about the rule. It fixes A-102 (45→44) and A-104 (120→125), then proposes a skill. |
| `learn_b.json` | Same underlying problem with different ids, 6 records, **scale 1000** and 3 wrong. | The skill is compatible and runs. 3 proposals, which a human approves, then all are verified. A helper that hardcoded 100 would fail here, and the failure would be recorded. |
| `unrelated.json` | Looks similar, but each line item carries its own currency, so summing is wrong. | `search_skills` reports `compatible: false`, `run_skill` returns `incompatible_input`, and the refusal is recorded. |

Retarget the domain by writing new scenario files. Only the `sum_lines` invariant kind exists so far; add another kind in `tools.invariant_violations` when a new domain needs it.

## 4. Experience storage (SQLite; survives scenario resets)

- `tasks`: label, scenario, mode (`real` or `mock`), input snapshot, latency, model calls (NULL means unmeasured, **never** a fake 0), tool calls, actions executed, verifications passed and failed, invariant violations, success, skills used and skill proposed.
- `tool_calls`: every agent tool call, with task, ok and ms.
- `skills`: name, version, status (`failed_tests`, `tested`, `approved`, `rejected`, `disabled` or `rolled_back`), active flag, source task, input shape, sha256, validation and approver.
  - On disk: `skills/candidates/<name>/vN/` and `skills/approved/<name>/vN/`, each with a system-written `meta.json`.
- `skill_runs`: status, proposal count, verified pass and fail.
- `audit`: every proposal, approval, execution, verification and skill change.

**Sensitive data:** `tasks.input_snapshot` stores the dataset so a skill can be replayed later. That is fine for synthetic data. With real data, keep only what the replay needs.

## 5. Security controls

| control | how | strength |
|---|---|---|
| Untrusted until validated | `propose_skill` copies the draft to `candidates/`. `run_skill` refuses anything not `approved` + `active`. | code-enforced |
| Human promotion | `approve_skill`, `reject_skill`, `disable_skill` and `rollback_skill` are **not agent tools**. A human approver must be named. | code-enforced (see trust gap) |
| No self-granted permissions | Skills only **compute proposals**. `meta.json` is written by the system with `allowed_operations: ["compute_proposals"]`, and fields the agent supplies are ignored. Every proposal goes through policy, human approval and the verifier. Promoting a skill never authorizes an action. | code-enforced |
| Tamper detection | A sha256 of the file tree is taken at test time, checked again at approval, and checked on every run (`integrity_error`). | code-enforced |
| Misuse on other data | The input-shape signature is computed by the system, not the agent. A mismatch gives `incompatible_input`. | code-enforced |
| Independent expected output | Replay against the human-approved, verifier-passed fixes | code-enforced |
| Isolated execution | The runner works on a throwaway copy in a temp dir as a child process. It uses `python -I -B`, a scrubbed environment (PATH only, so **no secrets**), a 15 s timeout, and on POSIX rlimits on CPU, memory (1 GB), file size (1 MB) and open files. The child gets no DB path. | real for env, timeout and rlimits. **rlimits are not applied on Windows dev.** |
| Network, process and filesystem guards inside the runner | socket, subprocess and `os.system` are monkeypatched, plus an AST allowlist | **Speed bumps only.** The real boundary is the OpenShell sandbox. |
| Versioning and rollback | `UNIQUE(name, version)`, one active version, `skill rollback` and `skill disable`, all audited | code-enforced |

**Trust gap (same as the core app).** The agent, the DB and the skill directories all live in one sandbox, and the agent has `exec`. A deliberately malicious agent could edit the DB or the files directly. Tamper hashes catch file edits, but not DB edits. If security is the pitch, the upgrade is to move the DB, the `approved/` directory and the human commands to the host.

**Honesty gap for the learning claim.** The verifier's rule (`sum_lines` in `tools.py`) and the scenario policy live in the sandbox, so an agent *could* read them instead of reasoning from the data. `flywheel.py`, the scripted answer, and the mock-authored fixture skill are **not shipped**. For the acceptance run, check the OpenClaw session log (`nemoclaw my-assistant logs`) to confirm the agent never `cat`'d `app/*.py` or queried `meta`. Report it honestly if it did.

## 6. Results measured on the dev laptop (MOCK)

`python -m app flywheel` uses a scripted agent and a **mock-authored** fixture skill (`tests/fixtures/mock_authored_skill/`, written by a human and labelled as such). This proves the **plumbing**. It is **not** evidence of learning, and model calls are not applicable.

| task | mode | model_calls | tool_calls | latency_s | executed | verified pass/fail | invariant violations | success | skill used |
|---|---|---|---|---|---|---|---|---|---|
| before-learning (A) | mock | n/a | 16 | 0.286 | 2 | 2/0 | 0 | 1 | none |
| after-learning (B) | mock | n/a | 8 | 0.158 | 3 | 3/0 | 0 | 1 | line-total-reconcile@v1 |
| unrelated | mock | n/a | 2 | 0.011 | 0 | 0/0 | 0 | 0 (correctly refused) | none |

The original 45 automated tests cover the list below. §10 lists the 15 added since, for 60 in total.
- learn, reuse and refuse with no model call possible
- bad candidates: lint, wrong helper, failing tests or no tests
- no agent promotion
- approval still required for skill proposals
- tamper refusal
- version, rollback and disable
- failed reuse leading to a hint and a counter
- incompatible data
- runner blocks for network, subprocess and hangs
- secret scrubbing
- model calls measured from a vLLM-style counter, with NULL when unmeasured

## 7. Hackathon acceptance test (REAL local model, GB10)

This has not been run yet. All steps use `scripts/ro.sh` on the host, with `SKILL_DIR` set to the installed skill dir.

Start from scratch: delete `/sandbox/skillforge` and `/sandbox/records-ops.db` inside the sandbox.

```bash
export SKILL_DIR=<installed records-ops dir> LLM_METRICS_URL=http://127.0.0.1:8000/metrics
curl -s $LLM_METRICS_URL | grep vllm:request_success_total     # counter reachable? (else model_calls stays n/a)
bash scripts/ro.sh reset --scenario data/learning/learn_a.json
bash scripts/ro.sh task begin "A-real" --mode real
```

1. In the TUI: *"Records may have wrong totals. Check them all and fix what's wrong."*
2. Approve the fixes on the host with `bash scripts/ro.sh pending`, then `approve <ids> --by <you>`. Then tell the agent "approved".
3. Expect the agent to execute, verify, then write the draft and call `propose_skill`. If it doesn't do so on its own, prompt once: *"If that fix is repeatable, turn it into a skill."* Record that you prompted.
4. Run `bash scripts/ro.sh task mark solved` right after the fixes verify. Run `task mark skill_generated` after `propose_skill`. These split model calls by phase.
5. Check the skill: `bash scripts/ro.sh skill list` should show `tested`.
   - If `optimization_recommended` is 1, let the agent make its **one** optimization attempt, then run `task mark optimized`.
   - Run `bash scripts/ro.sh skill approve <name> <v> --by <you>` for the original, and for the revision if it was retained. On the host, `ro.sh` first checks that the sandbox app code matches `dist/`, then runs the **hidden suite** on the downloaded candidate. Only after that does it approve.
   - Finish with `task end`.
6. Repeat on B with `reset --scenario data/learning/learn_b.json`, `task begin "B-real" --mode real`, the same prompt, approve, then `task end`.
7. Repeat on unrelated: `reset --scenario data/learning/unrelated.json`, `task begin`, the same prompt, then `task end`. **Pass:** the agent does not use the skill and reports that it doesn't apply, or reasons about the currency problem.
8. Control run: B without the skill. Run `skill disable <name> --by <you>`, then B again as `"B-real-noskill"`, then `skill rollback` or re-approve. This gives a fair before/after on the **same** data.
9. Collect the results with `bash scripts/ro.sh task list`, and save the OpenClaw session log as evidence that the helper was written by the agent.

**Pass criteria:**
- A succeeds and the skill was **written by the model**, reaching `tested` (the replay matched).
- B succeeds with `skills_used` set, and with fewer model calls and tool calls than `B-real-noskill`.
- Verification is 100% in both runs.
- Unrelated: there are no skill-originated actions.

Report the actual numbers, including if they're worse.

## 8. Tool disclosure benchmark (progressive vs direct), real model only

From the NemoClaw docs:
- `onboard --tool-disclosure direct` / `NEMOCLAW_TOOL_DISCLOSURE=direct`.
- Switch an existing sandbox with `nemoclaw <sb> rebuild --tool-disclosure direct`.
- Progressive is the default for the managed-vLLM Qwen3.6-35B-A3B preview, and direct for other local providers.
- The literal value `progressive` is **unverified**.
- Disclosure changes model context, not authorization.

Our agent sees **one skill**, and its tools sit behind `exec`. So disclosure mainly affects OpenClaw's built-in tool schemas. Don't assume either mode is faster.

**Procedure:**
1. In each mode, run the B-real flow three times (`task begin "B-direct-1" --mode real` and so on).
2. Compare the average `model_calls`, `latency_s` and `success`.
3. Use vLLM `vllm:prompt_tokens_total` deltas for context size: `curl` before and after, by hand.
4. Keep the faster mode only if success is equal.
5. Timebox to 30 minutes. A rebuild costs several minutes.

## 9. Hermes compatibility (optional runtime, only if the organisers allow it)

| SkillForge piece | Hermes native equivalent (verified in docs) | fit |
|---|---|---|
| candidate → human approval | `skills.write_approval: true`, which stages writes in `~/.hermes/pending/skills/`, plus `/skills pending`, `diff`, `approve` and `reject` | **Better than OpenClaw.** A native gate exists. |
| skill authoring | `skill_manage` with create, patch, write_file, etc. Layout is `SKILL.md` plus `scripts/` and `references/` | Same AgentSkills format; our draft layout is compatible. |
| scratch code | `execute_code`, which strips secret-looking environment variables, has a 300 s timeout, and is **not a container sandbox** | Still use our replay runner for TEST. |
| versioning/rollback | A `version` frontmatter field. No documented rollback for agent-created skills. | Keep our registry. |
| memory | `MEMORY.md`/`USER.md`, and a session DB with FTS (`session_search`) | Our `tasks` table remains the metrics source. |
| deployment | `nemohermes onboard`, which can run side by side with an OpenClaw sandbox (distinct names) | It's unverified whether skill paths and the approval gate behave the same inside the NemoClaw sandbox. |

**Minimal Hermes path:**
1. Install `records-ops` as a Hermes skill (same `SKILL.md`, since it follows the AgentSkills format).
2. Keep `propose_skill`, `approve` and `run_skill` exactly as they are.
3. Optionally *also* set `skills.write_approval: true`, so Hermes' native gate stops the agent from installing its draft as a live Hermes skill.

There is no code change in this repo for that path.

## 10. Sanitization, profiling and bounded optimization

A candidate that passes its own tests and the replay is **not** promotable on that alone.

### 10.1 Audit: trust boundaries as they actually are

These are what the agent can reach through its `exec` tool inside the sandbox. Execution logs are evidence after the fact; they do **not** prevent access.

| resource | agent can read? | agent can modify? | consequence / mitigation |
|---|---|---|---|
| Verifier rule (`tools.invariant_violations`, `sum_lines`) and scenario policy (DB `meta`, `data/learning/*.json`) | **yes** | **yes** (installed code, DB) | It could copy the rule instead of inferring it. Mitigation: check the session log (honesty gap). Tampering with code is caught at approval time by `ro.sh` comparing `sha256sum app/*.py` against the host package. |
| Learning snapshot and expected fixes (`tasks.input_snapshot`, `skills.validation`) | **yes** (DB) | **yes** (DB) | DB edits are the known trust gap. The fix is a host-side DB. |
| Hidden validation suite (`validation/*.py`) | **no**. It is never packaged and no tool takes a path to it. | **no** | It runs on the host (`ro.sh skill approve`, then `skill hidden-check`) or in-process in dev. |
| Validation code (`skillforge.py`) | yes | yes (installed copy) | Its effect is checked by the host-side integrity check plus the hidden check run with **host** code. |
| Candidate and approved skill files | yes | yes | A tree sha256 is taken at test time, checked again at approval and on every run. |
| Generated helper at runtime | n/a | n/a | It gets only the dataset JSON on stdin. It has no DB, no tools, no env secrets, no network, process or file-delete calls (speed bumps), and runs under a timeout and rlimits. |

**Gap fixed in this round:** the profiler's duplicate-call report used to echo argument values, which are evidence payloads, back to the agent. It now reports only function names and counts (tested).

### 10.2 Helpers are pure by contract (already true; now enforced harder)

The contract is `run(dataset) -> {"proposals": [...]}`. Trusted I/O, authorization, execution and verification all stay outside the helper. **Output sanitization** is new:
- Only the keys `record_id`, `field`, `value`, `reason` and `action_type` are allowed.
- Values must be scalars.
- `reason` is limited to 300 characters.
- There can be at most one proposal per input record.
- No extra top-level keys are allowed.
- Child stdout is limited to 2 MB.

Anything else is rejected as data exposure or waste.

### 10.3 Static sanitization (`lint`: early filter, not proof)

| errors (block the candidate) | warnings (optimization hints) |
|---|---|
| imports outside the stdlib allowlist (no network, file, OS or subprocess modules) | unused imports |
| `open`, `exec`, `eval`, `compile`, `__import__`, `getattr` and similar | the same call with the same arguments repeated in one function, e.g. `line_total(e)` computed twice |
| dunder attribute access | nested loops (possible O(n·m) scan) |
| constant-true `while` with no `break`/`return` | `while` loops (termination not checked), recursion |
| no `run()` | |

### 10.4 Runtime profiling (stored in SQLite)

| measured | where |
|---|---|
| Helper: elapsed, traced line executions (a deterministic "work" measure), calls per helper function, **repeated calls with identical arguments**, peak memory (`tracemalloc`), bytes in and out | runner `profile` mode, stored in `skills.profile` |
| Agent tool calls: latency, **SQL statements** (`sqlite3` trace callback), **response bytes**, args hash, which gives **duplicate identical tool calls** | `tool_calls` per call; aggregated into `tasks.duplicate_tool_calls`, `db_queries`, `data_bytes`, `tool_breakdown` |
| Batch vs individual | `tool_breakdown`, e.g. agentic A = `investigate` ×5 against reuse = `run_skill` ×1 |
| Model calls per phase (discovery, generation, reuse) | `task mark <phase>`. `ro.sh` passes the host-side vLLM counter delta. |
| LLM calls / tool calls / internal Python calls | kept separate: vLLM counter / `tool_calls` table / the profiler |

### 10.5 Bounded optimization (one attempt, evidence-driven)

1. After a candidate passes (lint, own tests and replay), it is **profiled at 1× and 8×** the learning data.
2. Optimization is recommended **only on runtime evidence**: work grows more than 16× for 8× the data (superlinear), or there are repeated identical internal calls. Efficient helpers get `recommended: false`, and `optimizes=` is then refused with `not_recommended`.
3. The agent may submit **one** revision with `propose_skill(..., optimizes=N)`. A second attempt, or optimizing a revision, is refused. There is no recursion, and the revision inherits the parent's input shape and expected fixes, so it cannot loosen anything.
4. The revision goes through the **same** lint, own tests and replay. A human approval runs the **same** hidden suite.
5. Both versions are **benchmarked on identical inputs** at 1×, 8× and 32×:
   - cold = whole child process
   - first = first call in a fresh process
   - warm = later calls
   - each reported as median and MAD, along with a correctness check against the scaled verified fixes
6. **Retention rule:** keep the revision only if it is correct at every size **and** it reduces work by at least 20% **and** warm speed improves by at least 10%. Both thresholds are fixed in code; the agent cannot change them. Otherwise the revision is marked `not_retained` (it cannot be approved) and the original stays.
7. The original stays `approved`, so `skill rollback` returns to it.

### 10.6 Independent correctness (hidden suite)

`validation/sum_lines.py` holds 11 human-written cases. The agent never sees them.
- unseen values
- scale 10 and scale 1
- all-correct data (no proposals)
- zero and empty lines
- untrusted evidence ignored
- a record with no evidence
- a single record
- **500 records**
- malformed line values and a missing total: an error is allowed, but no proposal for the bad record
- the unrelated mixed-currency shape must be refused

Promotion requires the suite to pass. A new domain needs its own suite file; without one, approval is refused.

The test `test_hidden_suite_catches_what_self_tests_and_replay_miss` shows why this matters. A helper that hardcodes `/100` passes its own tests **and** the replay on scenario A (where every scale is 100), but fails `unseen_values_scale_10` and cannot be approved.

### 10.7 Promotion policy

A skill can only be promoted if all of these pass:
- lint errors: none
- own tests: pass
- replay of the verified fixes: exact match
- output sanitization: pass
- runner limits: pass
- **hidden suite: pass**
- file hash: unchanged
- named human approver

For revisions, the optimization must also be retained. Optimization itself is optional: a slow but correct original is still promotable (tested), and the speed tradeoff is recorded in `skills.optimization`.

### 10.8 Measured results (dev laptop, Windows, Python 3.14, MOCK)

`python -m app flywheel`: the "agent" is scripted. The v1 skill is a human-written fixture that is **deliberately wasteful** but correct (nested scan plus a repeated computation). The v2 "optimization" is the human-written efficient fixture. These numbers show the **pipeline works**. They are **not** evidence that a model can optimize.

Profile of v1: work grew **49.4×** for 8× the data, and `line_total` was called 16 times with identical arguments. So `recommended: true`.

Benchmark, same inputs. Times in ms; cold/warm values are median ± MAD:

| version | records | correct | cold | first call | warm | work (line events) |
|---|---|---|---|---|---|---|
| v1 original | 5 | ✓ | 150.8 ± 6.7 | 0.014 | 0.0037 ± 0.0002 | 101 |
| v2 optimized | 5 | ✓ | 171.7 ± 21.2 | 0.018 | 0.0043 ± 0.0001 | 40 |
| v1 original | 40 | ✓ | 152.0 ± 4.0 | 0.210 | 0.089 ± 0.005 | 4,987 |
| v2 optimized | 40 | ✓ | 127.7 ± 7.9 | 0.037 | 0.026 ± 0.002 | 292 |
| v1 original | 160 | ✓ | 136.2 ± 3.8 | 1.281 | 1.349 ± 0.191 | 77,539 |
| v2 optimized | 160 | ✓ | 147.3 ± 28.7 | 0.132 | 0.200 ± 0.041 | 1,156 |

The verdict was **retained**: work −98.5%, warm speed +85% at 160 records, correct at all sizes.

**The honest tradeoff:** cold, end-to-end time is dominated by interpreter start-up of about 130–170 ms and does not improve. Interleaved task-level reuse on scenario B (5 trials each) shows the same thing:
- v1: median 213.5 ± 8.0 ms
- v2: median 220.0 ± 16.0 ms

Both used 7 tool calls with 100% success. At this data size, the optimization is algorithmic insurance for larger data, not a speedup the user would notice. The verdict text says so.

**Modes on the same workload (scenario B):**

| mode | model calls | tool calls | latency | correctness | status |
|---|---|---|---|---|---|
| A: agentic, no skill | **needs GB10** | needs GB10 | needs GB10 | needs GB10 | not measured. Mock numbers deliberately not substituted. |
| B: original skill (v1) | 0 (no model in path, asserted in tests) | 7 | 213.5 ± 8.0 ms | 3/3 verified | measured, mock harness |
| C: optimized skill (v2) | 0 | 7 | 220.0 ± 16.0 ms | 3/3 verified | measured, mock harness |

**Tests:** 60 passing; three consecutive runs of about 62–65 s each. The 15 new tests cover:
- the static sanitizer
- output sanitization (5 cases)
- the hidden suite catching a hardcoded helper
- hidden-validation-required plus the host sha path
- profile recommendation, including no data leak and `not_recommended` for an efficient helper
- a retained-once optimization plus rollback
- a no-gain revision marked `not_retained`
- a fast-but-wrong revision rejected
- tool-call instrumentation (duplicates, queries, bytes, breakdown)
- version pinning
- migration of an old DB
- per-phase model calls

## 11. Trust boundary v2: trusted service outside the sandbox

**What changed.** Previously the whole app ran inside the sandbox: DB, verifier, scenario data and validation code. The agent's `exec` tool could read or modify all of it.

**Remote mode (now the default package):**
- The sandbox gets only three files: `SKILL.md`, `client.py` and `client.json` (URL + agent token).
- `client.py` forwards each tool call to `python -m app serve` on the host.
- The host side holds the DB, verifier, scenario data, skill registry, hidden suite, approvals and all state changes.

```
sandbox (agent, exec)                         host (trusted)
  client.py --POST /call, Bearer token-->  app/server.py --> tools.call() --> SQLite, verifier, skill registry
                                                         \--> skill runner (subprocess, or docker isolation)
  human: python -m app approve / skill approve / reset    (CLI on the host; no HTTP endpoint exists for these)
```

| property | how | tested |
|---|---|---|
| Only agent tools are exposed | The service dispatches through `tools.call`. `decide_approval`, `approve_skill`, `rollback_skill`, `hidden_check` and `load_scenario` all return `unknown_tool`. | yes |
| Agent cannot make the host read host paths | `propose_skill` over the service refuses `path` and accepts only file contents for `SKILL.md`, `scripts/*.py` and `tests/*.py` (regex, no `..`). The client reads the draft directory inside the sandbox. | yes |
| Authentication | Bearer token with constant-time compare; 401 otherwise. The token only reaches the same agent tool surface, and it is gitignored (`data/.agent_token`). | yes |
| No sensitive logging | The request log is silenced: no bodies, no headers. | by inspection |
| Narrow binding | `--bind` must be the bridge-gateway IP. OpenShell **always blocks loopback** and blocks private IPs unless admitted, so the preset targets `host.openshell.internal` with `allowed_ips` pinned to the bridge /32 (`adapters/openclaw/presets/host-tools.yaml`, POST `/call` only; see GB10_RUNBOOK Gate 2). | **NOT verified on runtime** |
| Generated code on the host | `SKILL_RUNNER=docker`: a throwaway container with `--network none --read-only --cap-drop ALL --security-opt no-new-privileges`, user 65534, 512 MB memory, 1 CPU, 64 pids, and only the skill copy mounted read-only. It is killed on timeout. | **yes, locally**: no host files visible, uid 65534, no DNS |
| Package contents | The remote package contains exactly `SKILL.md`, `client.json` and `client.py`. | yes |

**Runner cost** (mock, unseen-compatible task, 5 trials):

| runner | reuse (B/C) | one-time learning |
|---|---|---|
| subprocess | about 0.16 s | about 2.2 s |
| docker | about 0.72 s | about 11.7 s |

Use docker on the GB10 host, because generated code then runs outside OpenShell. The 0.6 s is expected to be small next to real model latency, but that is not yet measured.

**Still not isolated:**
- If the remote service is unreachable, the `--local` package is the fallback, and it reverts to the old in-sandbox trust model.
- The agent can still see the data its own tools return. That is by design.
- The hidden suite and the DB are only as safe as the host account running `serve`.
- None of the network policy is verified on a GB10.

## 12. Deterministic skill matcher

`match_skills()` is trusted code. A **signature** is computed from data and policy at learning time, and computed again for each new task.

| part | why |
|---|---|
| `shape` | keys and types of the structured input |
| `kinds` | record kinds (`batch` vs `budget`) |
| `sources` | evidence sources plus trusted/untrusted |
| `writable` | fields the current policy lets anyone change |
| `invariants` | the verifier rules that define "correct" here |

Plus `touches`: the fields the skill's verified fixes changed. They must still be writable.

**Decision rule:** exactly one approved, active skill must match **exactly** on every part. Then `decision: skill`. In every other case it is `decision: agent`, with a reason:
- `uncertain`: same shape, different meaning
- `none`: different shape
- `ambiguous`: more than one exact match
- unsigned (legacy) skill
- the skill writes fields that are not writable

`run_skill` enforces the same check (`uncertain_match`), and `search_skills` reports `compatible` from it. So mode B cannot misuse a lookalike either.

A match selects a **procedure**; it never authorizes anything. Proposals still need policy, a human approval and the verifier.

There is no string similarity, no embeddings and no description matching. `normalize()`/`stable_fingerprint()` are domain-neutral helpers for free text (they strip addresses, UUIDs and numbers), meant for future OnCall fingerprints (§17). Structural identifiers are never normalized, so `api-v1` ≠ `api-v2`.

**The lookalike case is the point.** `lookalike.json` has the **identical data shape**, but its records are budgets and its evidence is a forecast export, with no invariant saying the lines must sum. A shape-only matcher would "fix" correct budgets. Ours routes it to the agent, and the test checks that nothing was proposed.

## 13. Three-mode benchmark (`python -m app bench`)

| mode | what runs | LLM |
|---|---|---|
| A, agentic | skills hidden; the agent investigates with its normal tools | yes |
| B, agent-assisted reuse | skills visible; the agent discovers them with `search_skills` and runs them with `run_skill` | yes (discovery and selection turns) |
| C, deterministic path | trusted `match_skills`, then `run_skill`, a preflight check (known records, learned fields only), approval, execute, verify. Uncertain matches, a rejected skill or a failed verification fall back to the agent, with skills hidden. | none on the happy path |

How the harness runs:
- The same scenario files and the same ground-truth correctness check apply to every mode.
- **Correctness:** with invariants, every verifiable invariant must hold and malformed records must be untouched. Without invariants, **nothing may change**.
- Each trial resets the domain data and restores skill visibility. Mode order alternates by trial.
- The real agent gets a **fresh session id per trial**.
- Human approvals are done by a stand-in. They are counted and timed separately, so `automated_s` excludes human wait.
- Phases are timed: `match`, `skill_exec`, `execute`, `verify`, `agent`. Learning is timed as `solve`, `generate_and_validate` and `hidden_validation_and_approval`.
- Inference deltas come from vLLM `/metrics` when `LLM_METRICS_URL` is set: requests, prompt and generation tokens, mean TTFT, inference seconds, KV cache usage. Otherwise **null**.
- Rows are stored in the `bench_trials` table and `result.json`.

Cases:
- **Same data shape and meaning:** `known_compatible` (A), `unseen_compatible` (B), `boundary` (zero, smallest step, scale 1, large change within policy).
- **Different shape or meaning:** `incompatible`, `malformed`, `lookalike_fingerprint`.
- **Skill unusable:** `skill_unavailable`, `skill_disabled`.
- **Fault injection:** `skill_fails_verification` (another writer changes the record between execute and verify; injected the same way in **every** mode).

### Measured results: MOCK agent, dev laptop, subprocess runner, 5 trials, median ± MAD of automated seconds

| case | A agentic | B agent reuse | C deterministic | C decision | correct A/B/C | tool calls A/B/C |
|---|---|---|---|---|---|---|
| known_compatible | 0.057 ± 0.004 | 0.159 ± 0.005 | 0.160 ± 0.023 | skill | 5/5 · 5/5 · 5/5 | 15 / 6 / 5 |
| unseen_compatible | 0.061 ± 0.003 | 0.168 ± 0.023 | 0.176 ± 0.006 | skill | 5/5 · 5/5 · 5/5 | 20 / 8 / 7 |
| boundary | 0.054 ± 0.011 | 0.159 ± 0.025 | 0.143 ± 0.005 | skill | 5/5 · 5/5 · 5/5 | 15 / 6 / 5 |
| incompatible | 0.008 | 0.010 | 0.012 | → agent (5 fallbacks) | 5/5 · 5/5 · 5/5 | 4 / 4 / 4 |
| malformed | 0.028 | 0.025 | 0.030 | → agent | 5/5 · 5/5 · 5/5 | 9 / 9 / 9 |
| lookalike_fingerprint | 0.009 | 0.010 | 0.013 | → agent (uncertain) | 5/5 · 5/5 · 5/5 | 4 / 4 / 4 |
| skill_unavailable | 0.069 | 0.067 | 0.071 | → agent | 5/5 · 5/5 · 5/5 | 20 / 20 / 20 |
| skill_disabled | 0.076 | 0.074 | 0.096 | → agent | 5/5 · 5/5 · 5/5 | 20 / 20 / 20 |
| skill_fails_verification | 0.097 | 0.215 | 0.207 | skill_failed_verification → agent | **0/5 · 0/5 · 5/5** | 20 / 8 / 17 |

How to read this honestly:
- **Every routing and fallback decision was correct**, and C never applied a skill to the wrong data. Mode C recovered from the injected verification failure. The **scripted** mock A and B agents never retry after a failed verification, so they stay wrong. That is a limitation of the mock; the real agent is told to re-investigate on a verification hint, but that is untested.
- **Tool calls drop about 2.5–3× with reuse**: 20 → 7–8.
- **Latency gets worse with reuse in mock: 0.06 s → 0.17 s.** The mock "agent" costs nothing to think, while a skill run costs about 150 ms of process start-up (about 700 ms with docker). Mock mode A is therefore **not** a valid stand-in for real agentic latency, and these numbers say nothing about real speedups.
- Human approvals are the same in every mode (2–3 per task). Reuse does not remove the human from the loop, by design.

## 14. Learning break-even (`bench.breakeven`)

```
L = one-time learning cost   (skill generation + validation + hidden check + approval, automated part)
a = agentic cost per task    (mode A median)
r = reuse attempt cost       (mode B or C median)
p = reuse success rate       (C decided "skill" AND the outcome was correct)
expected cost per reuse = r + (1 - p) * a        # failed reuse falls back to the agent (maintenance)
n* = ceil( L / (p*a - r) )                       # reuses to pay back L; "never" if p*a <= r
```

The formula is computed separately for automated seconds and for model calls. Any unmeasured input gives `pending`.

**Measured (mock):** L = 1.77 s, a = 0.061 s, r = 0.176 s, p = 1.0. That gives **n\* = never**, for the reason above.

**Model calls:** **pending**, because the mock has no model.

On the GB10 this becomes meaningful: a will be several model calls and probably tens of seconds, while r in mode C is 0 model calls. Expect n\* to be small, but nothing here proves that yet.

**What it does not capture yet:**
- the human time to review a skill
- re-validation when the policy or data changes (hidden-suite upkeep)
- the cost of a wrong reuse that slips past the verifier (zero observed; the matcher and verifier exist to keep it there)

## 15. GB10 acceptance procedure (real model)

Load one model at a time. Record **every** manual hint in the run log; the harness counts the step-3 nudge prompt as a hint.

```bash
# 0. Host prep (repo + python3 on the host; docker image pre-pulled for the isolated runner)
bash scripts/gb10_preflight.sh
docker pull python:3.12-slim            # do this in advance if the venue is offline
export LLM_METRICS_URL=http://127.0.0.1:8000/metrics SKILL_RUNNER=docker
curl -s $LLM_METRICS_URL | grep -E 'vllm:(request_success|prompt_tokens|generation_tokens|time_to_first_token)' | head

# 1. Inference: default Qwen first (Express Install). For Lightning (experimental):
#    stop nemoclaw-vllm; nemoclaw onboard --profile vllm.dgx-spark-gb10.single.nemotron-3.5-lightning-30b-a3b-nvfp4
LLM_BASE_URL=http://127.0.0.1:8000/v1 python3 -m app check-llm     # structured_output_ok must be true

# 2. Trusted service + boundary: SUPERSEDED, use docs/GB10_RUNBOOK.md Gate 2.
#    (The sandbox dials host.openshell.internal; a private IP literal in the preset is refused by NemoClaw.)

# 3. Smoke: one real agent turn drives a real tool call
nemoclaw my-assistant exec --no-tty -- openclaw agent --session-id smoke1 -m "List the records." --json | head -40

# 4. Benchmark with the REAL agent (Mode A, autonomous skill generation, hidden check, B, C, fallbacks)
python3 -m app bench --agent openclaw --trials 3 --db data/app.db --skills-dir skills
```

How `bench --agent openclaw` works:
1. It runs **learning** with the real model first. The model solves scenario A, then gets one prompt to turn the fix into a skill (recorded as a hint).
2. If a skill reaches `tested`, the host runs the hidden suite and approves it as `bench-operator`. Substitute a named human if the rules require it.
3. Then every case runs in modes A, B and C.
4. If the model's skill fails validation, the B and C reuse rows will show `→ agent`. **That is a valid, reportable result. Do not swap in the fixture.**

Pass criteria for the demo:
- The learning row shows `autonomous=True`, with a skill the model wrote that is `tested` and hidden-valid.
- `unseen_compatible`: C is correct with 0 model calls, and B and A are correct.
- Every fallback case is correct.
- The break-even for model calls is a number, not `pending`.

Record the A-vs-C model calls and automated seconds. **That pair is the headline.**

Before trusting the real numbers, verify:
- **AGENT_CMD:** the flags come from the docs. If `--no-tty` or `--json` differ, override with `AGENT_CMD='...'`.
- **The OpenClaw memory/bootstrap files.** A fresh `--session-id` resets the conversation, but if OpenClaw memory persists across sessions, earlier trials could leak into later ones. Check and clear it between modes.

## 16. Model assumptions (from vendor docs; not run)

| model | id | serve | notes |
|---|---|---|---|
| Qwen3.6-35B-A3B NVFP4 | `nvidia/Qwen3.6-35B-A3B-NVFP4` (NemoClaw `qwen3.6-35b-a3b-nvfp4`) | NemoClaw default on Spark: `nvcr.io/nvidia/vllm:26.05.post1-py3`, 262,144 context, 4 sequences, 0.4 GPU memory | `--tool-call-parser qwen3_xml --reasoning-parser qwen3` per the model card |
| Nemotron 3.5 Lightning 30B-A3B NVFP4 | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` (NemoClaw `nemotron-3.5-lightning-30b`, **Experimental**) | profile `vllm.dgx-spark-gb10.single.nemotron-3.5-lightning-30b-a3b-nvfp4`: 65,536 context, 1 sequence, 0.65 GPU memory, fp8 KV | Tool parser conflict: docs say `step3p5`, the card says `qwen3_coder`. Reasoning arrives in `message.reasoning`; use `max_tokens` ≥ 1024. On GB10 it runs via Marlin (W4A16). |

- There is one managed `nemoclaw-vllm` container, so in practice one model at a time.
- Switching models takes a profile change or re-onboard, not just `inference set`, which only changes routing.
- **Model load time** has no vLLM metric. Measure container start → `/v1/models` responding by hand.
- **Peak GPU memory** comes from `nvidia-smi` and may read N/A on GB10 unified memory, which is recorded as null.

## 17. OnCall interfaces (prepared, not implemented)

**Monitor → Detect → Investigate → Patch → Test → Human review → Learn → Reuse** maps onto what already exists. An OnCall scenario would supply:
- **records:** services and incidents
- **evidence:** alerts, log excerpts, deploy history
- **policy:** allowed remediations, such as a flag flip or rollback to a pinned version, with an approval requirement
- **invariants:** a health check or error rate below threshold

The incident fingerprint would come from `stable_fingerprint({exception_type, top_frames, component, failure_category, service_version}, free_text={"top_frames"})`. It would be **added to** the structural signature, never used alone. Equal fingerprints mean "probably the same class of incident", so reuse stays a proposal that a human approves and the verifier checks.

Not built: monitoring integrations, patch generation, CI/test execution or PR automation.

## 18. Status

| item | status |
|---|---|
| Registry, runner, replay, hidden suite, promotion, versioning, bounded optimization | implemented; **79 tests pass**, three consecutive runs (Windows, Python 3.14) |
| Deterministic matcher + lookalike refusal | implemented and tested |
| Three-mode harness, fault injection, break-even | implemented and tested with the **MOCK** agent |
| Trusted service + thin client + remote package | implemented and tested locally over HTTP |
| Least privilege: `APP_AGENT_TOOLS` allowlist (can only remove tools), wildcard bind refused, tools listed at startup | implemented and tested |
| Resource limits bite: docker 512 MB kill (tested locally), POSIX `RLIMIT_AS` stops a 2 GB allocation (tested on Linux, Python 3.11) | tested |
| Docker runner isolation | **tested locally** (Docker 29, `python:3.12-slim`) |
| OpenShell admits the sandbox → `host.openshell.internal:8765` (`host-tools.yaml`) | **not verified** |
| `openclaw agent --json` driver, session isolation, tool counts | from docs only; **not verified** |
| vLLM `/metrics` names and access from the host | from docs, parser tested against a fake; **not verified on GB10** |
| A real model solves, writes a skill that passes the hidden suite, then reuses it | **not run; needs GB10** |
| Any real-model latency or model-call improvement | **none claimed** |
| `--local` fallback package / `scripts/ro.sh` | kept for when the remote boundary can't be set up; weaker trust model |
