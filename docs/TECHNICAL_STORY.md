# SkillForge technical story (judge-facing)

Every claim below points to code or a doc in this repo. GB10 numbers are the GB10 operator's report with sha256-named evidence (`docs/BENCHMARKS.md` section 3). Anything about the GB10 that was not measured is marked as such and is listed again in section 6. Latency words follow `docs/EVIDENCE_PROTOCOL.md` section 1 (model inference, validation, deterministic reuse, end-to-end are four different things).

## 1. The architecture in one paragraph

A local model writes a small diagnostic program (a "skill") for an incident class, once. The host verifies it with checks the model never sees: static lint, the skill's own tests, a replay of the original incident, a capacity check and a hidden suite (`experiments/oncall_infer/oncall.py` `verify`, `hidden/`). A person approves it on the host CLI, and its files are pinned by sha256 (`app/skillforge.py` `approve_skill`). A compatible later incident runs the pinned code with no model client built at all (`NoModel` guard counts any attempt). A lookalike is refused because its incident fingerprint differs (`oncall.py` `_decide`). Skills only propose a change; a person applies it.

## 2. Why a GB10 suits this architecture

| claim | basis | status |
|---|---|---|
| Inference is local, so incident logs, configs and generated code do not leave the machine | the model client talks to `LLM_BASE_URL` (default `http://127.0.0.1:8000/v1`); no cloud API exists in the OnCall path; the console binds loopback only (never `0.0.0.0`, `CLAUDE.md` rule); skill verification runs with no network when `SKILL_RUNNER=docker` (`--network none`, `app/skillforge.py` `sandbox`) | design fact from code. Not a data-loss guarantee: the default child-process runner is not network isolation (`docs/JUDGE_QA.md`) |
| One 128 GB unified-memory pool holds a large model next to the verifier, sandbox and console | spec 128 GB LPDDR5x (`docs/GB10_FRONTIER.md`); the earlier 35B profile reserved about 0.4 x 128 GB = 51 GB (arithmetic from its serve flag, not a reading); the current serving config (0.80) used about 88% of memory, 106.8/121.6 GiB (GB10 operator report). Measured on the GB10: MemTotal 121.63 GiB; during the frontier run min MemAvailable 62.78 GiB, derived peak used 58.85 GiB (78 samples) | measured, GB10: frontier report sha256 `6890165aa86abbb7834ec2aa15784bbf6326104363466d786b0fd66d4e8d23e2` |
| A large model can stay resident, so the one-time synthesis call has no model-load penalty | the managed vLLM container stays up between requests; `frontier.sh` records warm-up separately | measured, GB10, per request: TTFT p50 0.0623 s (c=1), 0.1087 s (c=2), 0.1026 s (c=4); decode p50 75.63 / 61.83 / 55.27 tok/s; 0 of 70 errors (same report). First-vs-warm split: not reported here |
| The expensive step (model) is paid once per incident class, the repeat step needs no GPU time | reuse path has no model client (`NoModel`); `model_calls == 0` is enforced and recorded in `oncall-run.json` | 0 model calls: shown on the dev box (recorded run) and on the GB10 (6 trials after a person's approval; vLLM request counters unchanged). The one-time synthesis cost on GB10 (attempt 4): 1 call, 173.0 s, 12,763 completion tokens. Time saved: **not measured** (different scopes) |
| Memory pressure and GPU heat are observed, not assumed | `frontier.sh` guards (MemAvailable >= 16 GiB, temp <= 85 C) abort before load; `samples.csv` records every second | measured, GB10: peak 62 C, 42.07 W in the frontier run; attempt 5: temp max 67 C, power max 44.0 W, util p50 96% (235 samples) |

What the GB10 does **not** prove for us: that deterministic reuse is faster end to end than the agent (plausible, unmeasured: `docs/EXEC_PERF.md` finding 4 shows a 31x speedup inside a skill shrinking to 1.3x end to end behind process start), that the model reliably writes correct skills (live result: 1 of 2 with a disclosed prompt revision, 0 of 3 before), or any energy or cost saving (nothing is measured).

## 3. Comparison with Hermes (NousResearch Hermes agent)

What this repo can say, and its source:

- **Hermes has a skills system and a native approval gate.** `docs/SKILLFORGE.md` section 9 records, from Hermes docs (not re-verified for this document): `skill_manage` authoring, `skills.write_approval: true` staging writes for `/skills approve`, and `execute_code` that "is not a container sandbox". So "SkillForge has human approval and Hermes does not" is **false** and must not be said.
- **What SkillForge adds, by code:**
  1. Candidate skills must pass checks the model never saw (hidden suite, `experiments/oncall_infer/hidden/`; INC-1 replay; capacity check) before they can be approved. Approval re-runs the hidden suite and refuses a changed file hash.
  2. Approved skills are immutable and sha256-pinned; reuse runs exactly that code.
  3. Reuse is a deterministic path with no model call (`NoModel` guard); bench mode C selects skills with a trusted matcher, no LLM (`app/bench.py`; exercised only with the mock agent so far).
  4. A lookalike is refused by an incident fingerprint (fail closed when missing).
  5. Run files state when a result is a simulation (`mode: RECORDED_SIMULATION`) and the UI counts only host-CLI approvals as a person's.
- **What we have not done:** run Hermes, benchmark against it, or test Hermes' skills against our hidden suites. `docs/SKILLFORGE.md` section 9 describes a Hermes compatibility path that is design only. Hermes is optional in this event until organisers allow it; the intended runtime is OpenClaw in NemoClaw, which was installed on the GB10 only after the live OnCall runs (the runs used the host harness).
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

**GB10 results (2026-10-25).** Raw evidence is on the GB10/SSD; run records for attempts 4 and 5 are committed sanitized at `docs/evidence/gb10/attempt4-oncall-run.json` (sha256 `712dbf7827e0f7c1bf16890d8efcb2758398bcfcd888eeb3766e12369f634b58`) and `attempt5-oncall-run.json` (sha256 `f95121b01f36373f43d06ccc377bc739987841b17576883db04879ee6a2ee01d`). Full table: `docs/BENCHMARKS.md` section 3. Numbers in a generated report come only from:

```
python3 -m experiments.gb10_bench.evidence_report results/frontier/<label> [...] --out results/frontier/evidence_report.md
```

The report rejects mock, fixture, recorded-simulation and non-GB10 inputs, shows "not measured" for absent values and prints each number's source file and sha256. Procedure: `docs/EVIDENCE_PROTOCOL.md`.

| result | value |
|---|---|
| served model id / quantization | `skillforge-qwen` = Qwen3.6-35B-A3B-NVFP4, vLLM 0.21.0+2325b6f0.dev, `max_model_len` 32768 (earlier config, 0.4 / 4 seqs; all OnCall results), inline thinking. Current config: 0.80, `max_model_len` 131072, 16 seqs, fp8 KV, KV cache 6,669,475 tokens; single-stream decode unchanged (73.8 vs 75.6 tok/s at c=1, thinking off), the gain is context, KV capacity and concurrency headroom (UNCONTENDED, [BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25)). Revision: not reported |
| first-time synthesis (Qwen, thinking, revised prompt) | attempt 4: 1 model call, 173.0 s, 1,998 / 12,763 tokens, hidden 9/9, regression 5/5, staged `tested`. Attempt 5 (same config): 1 call, 233.8 s, 1,998 / 17,067 tokens, hidden 8/9, rejected (model answered `not_applicable` where the prompt says `requires_review`). Original prompt: 0 of 3 passed (5/9, 7/9, Nemotron failed lint) |
| first-time automated end-to-end s | not reported (only the synthesis model-call time above) |
| deterministic reuse on GB10: latency ms, model calls | 0 model calls; 27.0 ms first run, n=6 p50 28.2 ms (min 27.0, max 42.1): reuse decision plus sandboxed run, subprocess runner, after a person's approval (`--by` unverified). INC-3 refused every time. Evidence: `docs/evidence/gb10/reuse-oncall-run.json`. Dev box for comparison: 117 to 256 ms, Windows, not GPU, reference skill |
| TTFT, decode tok/s per concurrency | see section 2 and `docs/BENCHMARKS.md` section 3 (per request, c=1/2/4) |
| unified memory headroom, peak temperature | see section 2 |
| request error rate, probe, stages | 0 of 70 streaming requests failed; probe and stages: not reported here |

## 6. What is NOT yet verified on hardware

- The GB10 approval, INC-2 reuse and INC-3 refusal happened (see `docs/BENCHMARKS.md` section 3) but with caveats: subprocess runner (no Docker isolation), `--by` name not identity-verified, n=6 reuse trials of one skill.
- Reliability of live synthesis: 1 pass in 2 revised-prompt attempts; the prompt was revised after seeing a failure (disclosed); vLLM output is not deterministic at temperature 0.
- NemoClaw v0.0.137 / OpenShell 0.0.116 / OpenClaw v2026.9.2: installed on the GB10 (operator-authorized, no sudo); sandbox `skillforge` serves the local Qwen via `https://inference.local`; a Telegram <-> local model round trip is verified from OpenShell logs (`docs/CLAIMS.md` #26, [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md)). Gate 2 passed 13/13: an OpenClaw agent in the sandbox called SkillForge host tools (`search_skills`, `read_records`, `get_audit`) through the applied `host-tools` policy; `decide_approval` is not in its tool set, so approval stays host-CLI only (`docs/CLAIMS.md` #23c). The OnCall loop has **not** run under them (Gates 3/4 in progress), and a single Telegram message driving SkillForge tools, a non-allowlisted-sender check and a full egress review are not verified ([integrations/telegram/GAPS.md](../integrations/telegram/GAPS.md)). NemoClaw's auth proxy listens on `0.0.0.0:11435` (token-protected; mitigation proposed, not applied; `docs/SECURITY.md`). Nemotron attempt 6 failed (`max_tokens` hit while reasoning; Nemotron 0 of 2). Docker was permission-denied, so all GB10 runs used the subprocess runner, under which hidden-suite secrecy against a hostile skill is not guaranteed (the lint is not a boundary; a bypass was found and fixed in `1094d95`). Docs: `docs/SECURITY.md`.
- The GB10 raw evidence files themselves are not in this repository (except the two sanitized run records); the recorded 9/9 in the committed UI demo is still a hand-written reference skill.
- The `openclaw agent --json` field names (`meta.toolSummary.calls`, `meta.agentMeta.assistantTurns`) are source-read, never seen on a GB10 (`app/bench.py`).
- The Docker runner on native arm64 and its start time (dev box: about 3.5 s per run).
- That `nvidia-smi` reports memory and power on unified memory (may print `[N/A]`).
- vLLM `usage` in streams, so token counts and decode tok/s may be null.
- That the approval on the host is a named person's (`kind: host_cli` is inferred from the `--by` text; the name is not identity-verified).
- Comparison with Hermes or any framework: not run.
- Energy, cost, or "faster than the agent": not measured and not claimed.
