# SkillForge technical story (judge-facing)

Every claim below points to code or a doc in this repo. Anything about the GB10 that was not measured is marked **pending GB10 evidence** and is listed again in section 6. Latency words follow `docs/EVIDENCE_PROTOCOL.md` section 1 (model inference, validation, deterministic reuse, end-to-end are four different things).

## 1. The architecture in one paragraph

A local model writes a small diagnostic program (a "skill") for an incident class, once. The host verifies it with checks the model never sees: static lint, the skill's own tests, a replay of the original incident, a capacity check and a hidden suite (`experiments/oncall_infer/oncall.py` `verify`, `hidden/`). A person approves it on the host CLI, and its files are pinned by sha256 (`app/skillforge.py` `approve_skill`). A compatible later incident runs the pinned code with no model client built at all (`NoModel` guard counts any attempt). A lookalike is refused because its incident fingerprint differs (`oncall.py` `_decide`). Skills only propose a change; a person applies it.

## 2. Why a GB10 suits this architecture

| claim | basis | status |
|---|---|---|
| Inference is local, so incident logs, configs and generated code do not leave the machine | the model client talks to `LLM_BASE_URL` (default `http://127.0.0.1:8000/v1`); no cloud API exists in the OnCall path; the console binds loopback only (never `0.0.0.0`, `CLAUDE.md` rule); skill verification runs with no network when `SKILL_RUNNER=docker` (`--network none`, `app/skillforge.py` `sandbox`) | design fact from code. Not a data-loss guarantee: the default child-process runner is not network isolation (`docs/JUDGE_QA.md`) |
| One 128 GB unified-memory pool holds a large model next to the verifier, sandbox and console | spec 128 GB LPDDR5x (`docs/GB10_FRONTIER.md`); the 35B profile reserves about 0.4 x 128 GB = 51 GB (arithmetic from its serve flag, not a reading). The OS-visible MemTotal (about 121 GiB is expected from the platform; **unconfirmed**) and the real headroom come from `identity.json` and `samples.csv` | **pending GB10 evidence**: report section "GPU / unified memory" |
| A large model can stay resident, so the one-time synthesis call has no model-load penalty | the managed vLLM container stays up between requests; `frontier.sh` records warm-up separately | **pending GB10 evidence**: TTFT, decode tok/s, first vs warm request |
| The expensive step (model) is paid once per incident class, the repeat step needs no GPU time | reuse path has no model client (`NoModel`); `model_calls == 0` is enforced and recorded in `oncall-run.json` | 0 model calls: shown on the dev box (recorded run); on GB10 **pending**. Any time saved: **not measured** |
| Memory pressure and GPU heat are observed, not assumed | `frontier.sh` guards (MemAvailable >= 16 GiB, temp <= 85 C) abort before load; `samples.csv` records every second | harness exists; no GB10 readings yet |

What the GB10 does **not** prove for us: that deterministic reuse is faster end to end than the agent (plausible, unmeasured: `docs/EXEC_PERF.md` finding 4 shows a 31x speedup inside a skill shrinking to 1.3x end to end behind process start), that the model writes correct skills (needs the live run), or any energy or cost saving (nothing is measured).

## 3. Comparison with Hermes (NousResearch Hermes agent)

What this repo can say, and its source:

- **Hermes has a skills system and a native approval gate.** `docs/SKILLFORGE.md` section 9 records, from Hermes docs (not re-verified for this document): `skill_manage` authoring, `skills.write_approval: true` staging writes for `/skills approve`, and `execute_code` that "is not a container sandbox". So "SkillForge has human approval and Hermes does not" is **false** and must not be said.
- **What SkillForge adds, by code:**
  1. Candidate skills must pass checks the model never saw (hidden suite, `experiments/oncall_infer/hidden/`; INC-1 replay; capacity check) before they can be approved. Approval re-runs the hidden suite and refuses a changed file hash.
  2. Approved skills are immutable and sha256-pinned; reuse runs exactly that code.
  3. Reuse is a deterministic path with no model call (`NoModel` guard); bench mode C selects skills with a trusted matcher, no LLM (`app/bench.py`; exercised only with the mock agent so far).
  4. A lookalike is refused by an incident fingerprint (fail closed when missing).
  5. Run files state when a result is a simulation (`mode: RECORDED_SIMULATION`) and the UI counts only host-CLI approvals as a person's.
- **What we have not done:** run Hermes, benchmark against it, or test Hermes' skills against our hidden suites. `docs/SKILLFORGE.md` section 9 describes a Hermes compatibility path that is design only. Hermes is optional in this event until organisers allow it; the runtime here is OpenClaw in NemoClaw.
- Safe sentence: "Hermes can store and gate skills too. We differ by independently verifying a skill before approval, pinning it, and then running it with no model call; we have not compared performance with Hermes."

## 4. Comparison with conventional agent frameworks (LangGraph / CrewAI / AutoGen style)

Not tested here. This section describes the general pattern, not any one product's feature list; say "as we understand them" and invite correction.

| topic | typical orchestration framework | SkillForge (from code) |
|---|---|---|
| where the model sits | a graph/crew/conversation of model calls; each recurrence normally re-enters the model | model called to author a skill; recurrence goes through a deterministic path (`NoModel` guard) |
| reuse of past work | memory, saved prompts, cached state; a model still reads and decides | executable code, hash-pinned; chosen by a matcher plus fingerprint |
| trust in generated code | usually the developer's responsibility | lint, own tests, replay, hidden suite, human approval; tests, not a proof (`"note": "tests, not a formal proof"`) |
| lookalike input | handled by the model's judgment | refused unless the fingerprint matches |
| orchestration code | the framework is the product | none: "no orchestrator, no subagents, no vector DB" (`docs/SKILLFORGE.md` section 1) |

Fair limits: those frameworks do things we do not (rich multi-agent workflows, many integrations); SkillForge is one narrow loop. Also, a framework user could add caching, tests and approvals themselves. Our claim is only that this loop ships with those checks and measures `model_calls` for the reuse path.

Known gap to volunteer: core `match_skills` calls the lookalike INC-3 "exact"; the fingerprint check lives in the OnCall path, and core reuse paths outside it do not consult it (`experiments/oncall_infer/README.md`, `docs/JUDGE_QA.md`).

## 5. Results

**Pending GB10 evidence.** No file under `results/frontier/` or `results/gb10-evidence/` exists yet. When it does, the numbers come only from:

```
python3 -m experiments.gb10_bench.evidence_report results/frontier/<label> [...] --out results/frontier/evidence_report.md
```

The report rejects mock, fixture, recorded-simulation and non-GB10 inputs, shows "not measured" for absent values and prints each number's source file and sha256. Procedure: `docs/EVIDENCE_PROTOCOL.md`.

| result | value |
|---|---|
| served model id / revision / quantization | pending GB10 evidence |
| first-time synthesis: model calls, synthesis wall ms, tokens, hidden-suite result for model-written code | pending GB10 evidence |
| first-time automated end-to-end s | pending GB10 evidence |
| deterministic reuse: latency ms (first, warm p50/p95), model calls | pending GB10 evidence (dev box: 0 model calls, 117 to 256 ms, Windows, not GPU, reference skill) |
| TTFT, decode tok/s per concurrency | pending GB10 evidence |
| unified memory headroom, peak temperature | pending GB10 evidence |
| request error rate, probe, stages | pending GB10 evidence |

## 6. What is NOT yet verified on hardware

- That any of this runs on a GB10 at all (Gates 0 to 5 of `docs/GB10_RUNBOOK.md` are unticked).
- That the served model writes a skill that passes the hidden suite; the recorded 9/9 is for a hand-written reference skill.
- Every latency, throughput, memory, temperature and power figure; `ttft.py` and `frontier.sh` have only met a local stub server.
- The `openclaw agent --json` field names (`meta.toolSummary.calls`, `meta.agentMeta.assistantTurns`) are source-read, never seen on a GB10 (`app/bench.py`).
- The Docker runner on native arm64 and its start time (dev box: about 3.5 s per run).
- That `nvidia-smi` reports memory and power on unified memory (may print `[N/A]`).
- vLLM `usage` in streams, so token counts and decode tok/s may be null.
- That the approval on the host is a named person's (`kind: host_cli` is inferred from the `--by` text; the name is not identity-verified).
- Comparison with Hermes or any framework: not run.
- Energy, cost, or "faster than the agent": not measured and not claimed.
