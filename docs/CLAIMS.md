# Claims and evidence

Limitations in one place: [CLAIMS.md](CLAIMS.md). Measurements: [CLAIMS.md](CLAIMS.md).

Status values: **verified** (a test or recorded run in this tree shows it), **implemented** (code exists, no
dedicated evidence beyond review), **recorded simulation** (shown with a hand-written stand-in for the model),
**proposed** (design only), **not done**.

Environment "dev box" = Windows 11 x86_64, no GPU, Python 3.14.3, synthetic data, no real model.

Each claim rests on one of three kinds of evidence: tests and measurements on the dev box, recorded simulation,
and real hardware verification. GB10 rows (15, 15a, 15b, 21b, 21c, 22, 23, 24) rest on the GB10 operator's report and on sha256-named
evidence files that live on the GB10/SSD, not in this repository. **Sandbox isolation (claims 18, 23): Docker was checked on the dev box, and on the GB10 only as a re-verification of the approved skill; the timed GB10 runs used the subprocess runner.**

| # | claim | status | evidence | environment |
|---|---|---|---|---|
| 1 | Execution requires a person's approval at the host CLI; the agent has no approve tool | verified | `tests/test_core.py` (`test_agent_cannot_approve`, `test_execute_refused_without_approval`); [ARCHITECTURE.md §C](ARCHITECTURE.md#c-independent-verification) | dev box, MOCK |
| 2 | Each action executes at most once and every state change is audited | verified | `test_duplicate_proposal_and_execution_prevented`, `test_state_persists_across_connections` | dev box |
| 3 | The verifier re-reads state instead of trusting the agent | verified | `test_verification_checks_real_state` | dev box |
| 4 | Skills are hash-pinned; tampered skills are refused | verified | `tests/test_skillforge.py::test_tampered_approved_skill_refused` | dev box |
| 5 | A hidden suite catches skills that pass their own tests and the replay | verified | `tests/test_skillforge.py::test_hidden_suite_catches_what_self_tests_and_replay_miss` | dev box |
| 6 | The agent cannot promote a skill; an unapproved skill cannot run | verified | `tests/test_skillforge.py::test_agent_cannot_promote_and_unapproved_cannot_run` | dev box |
| 7 | Lookalike data with the same shape is routed to the agent, not to the skill | verified | [ARCHITECTURE.md §12–13](ARCHITECTURE.md) (`lookalike_fingerprint` 5/5 → agent) | dev box, MOCK |
| 8 | Deterministic reuse uses no model on the happy path | verified (MOCK) | [ARCHITECTURE.md §13](ARCHITECTURE.md): mode C decision `skill` | dev box, MOCK |
| 9 | Reuse reduced tool calls from 20 to 7–8 | verified (MOCK) | [ARCHITECTURE.md §13](ARCHITECTURE.md), `unseen_compatible` row | dev box, MOCK |
| 10 | Reuse is faster than the agent | **not shown**; in MOCK it was slower (0.06 s → 0.17 s) | [ARCHITECTURE.md §13](ARCHITECTURE.md) | dev box, MOCK |
| 11 | Learning pays back after n reuses | **not done** (no per-task model-call comparison measured) | [ARCHITECTURE.md §14](ARCHITECTURE.md) | — |
| 12 | OnCall: INC-2 is reused with zero model calls | verified (test) + recorded simulation | `experiments/oncall_infer/test_oncall_infer.py::test_after_approval_inc2_reused_with_zero_model_calls_and_inc3_refused`; `ui/public/demo/oncall-run.recorded.json` (`reuse.model_calls: 0`) | dev box, no model |
| 13 | OnCall: INC-3 is refused. The refusal comes from the **experiment's** fingerprint check, not from core; core `match_skills` says exact (known core gap) | verified (test) + recorded simulation | same test; `test_core_matcher_false_positive_on_lookalike_is_a_known_gap`; `refusal.reason` in the recorded JSON | dev box |
| 13a | OnCall: the fingerprint is bound to the approved registry row and fails closed; a direct core `run_skill` on INC-3 proposes nothing | verified (test) | `test_missing_or_tampered_fingerprint_refuses_reuse`, `test_core_path_bypass_yields_no_proposal` | dev box |
| 13b | OnCall reuse latency of about 117–256 ms across runs (256.0 ms in the committed artifact) | measured on the dev box: match plus deterministic execution only. **Not** an end-to-end inference saving; the first run had no model call to compare against | `reuse.latency_ms` in the recorded JSON | dev box |
| 13c | The recorded OnCall diagnostic code | **hand-written** reference (by a coding agent), not model output | `experiments/oncall_infer/reference_skill/`; `synthesis.provenance: recorded_reference` | — |
| 13d | The recorded OnCall approval | by a **synthetic agent identity** (`approval.kind: simulated`), not a person; only `host_cli` counts as a person, and names are not identity-verified | `approval` in the recorded JSON | — |
| 14 | OnCall: the reference skill passes the 9-case hidden suite; a wrong skill fails it | verified | `test_reference_skill_passes_hidden_and_stops_pending`, `test_wrong_skill_fails_hidden` | dev box |
| 15 | A local model writes the OnCall skill | **GB10, 1 of 2 with a disclosed prompt revision; 0 of 3 with the original prompt.** Qwen3.6-35B-A3B-NVFP4 wrote a skill that passed the hidden suite 9/9 and regression 5/5 (attempt 4, staged as `tested`); the identical re-run scored 8/9 and was rejected. Every failing candidate was rejected by the verifier, none staged. The prompt was revised after the 7/9 result (evidence-sufficiency rule); the authoring agent did not read the hidden suite | `docs/evidence/gb10/attempt4-oncall-run.json` (sanitized; sha256 `712dbf7827e0f7c1bf16890d8efcb2758398bcfcd888eeb3766e12369f634b58`, original `6683d26b...`) and `attempt5-oncall-run.json` (sha256 `f95121b01f36373f43d06ccc377bc739987841b17576883db04879ee6a2ee01d`); attempt 5 failed because the model answered `not_applicable` where the prompt says `requires_review`; skill tree sha256 `7fe0c025039b11b93617ba63955f3fe9da0ec55c7e7a0ed11bbae3982fa3aa0e`; details [CLAIMS.md §3](CLAIMS.md) | GB10, subprocess runner |
| 15a | A person (the operator) approved the live-written skill on the GB10 host CLI; it was reused on INC-2 with 0 model calls (6 trials, p50 28.2 ms) and INC-3 was refused every time | **measured, GB10** (operator report + sha256). Caveats: subprocess runner, `--by` not identity-verified, n=6, vLLM request counters unchanged | [CLAIMS.md](CLAIMS.md), `docs/evidence/gb10/reuse-oncall-run.json` | GB10 |
| 15b | Reliability of live skill synthesis | **not reliable enough for unattended use.** Later Qwen evaluation on the current serving config (`ONCALL_MAX_TOKENS` 40000, committed prompt, scratch states, nothing staged or approved, evaluator did not read the hidden suite, timings contended): thinking on 3 of 7 passed, thinking off 0 of 1; all 5 failures were hidden 8/9 on `oom_without_memory_key_change_escalates` (`not_applicable` instead of `requires_review`), not truncation; regression 5/5 in all 8 runs; the verifier rejected every failing candidate (no false accepts). With attempts 4 and 5: 4 of 9. No further prompt revision (teaching to the test). The 95% interval for 3 of 7 is roughly 16% to 75% | [CLAIMS.md §3](CLAIMS.md); GB10 summary `005-qwen-skill-eval.md` and SSD `eval-20261025-165709/` `MANIFEST.sha256` (not in this repo) | GB10 |
| 16 | Pinned freight verifier refuses a newer contract revision | verified | `tests/test_freight.py::test_newer_contract_revision_invalidates_the_verifier` | dev box |
| 17 | Stale catalog skills are refused until revalidated | verified (experiment) | `experiments/catalog/test_catalog.py` | dev box |
| 18 | Generated code runs in Docker with no network, read-only, uid 65534 | verified locally; on the GB10 the approved skill was re-verified on a copy under these flags ([CLAIMS.md](CLAIMS.md)) | [ARCHITECTURE.md §11](ARCHITECTURE.md) | dev box, Docker Desktop; GB10 re-verification |
| 19 | Indexed freight variant: 31× faster skill compute at 4,400 records | measured; **human-authored research, not promoted** | [ARCHITECTURE.md](ARCHITECTURE.md) §2; `experiments/perf/results/devbox.json` | dev box |
| 20 | Browser UI passes its e2e suites (mock 68/68; local backend 15/15) | verified on the dev box (reported; not re-run on this tree) | `ui/e2e/`, `ui/e2e-live/` | dev box |
| 21 | One-command launcher; attaches instead of colliding; stops only its own process | implemented; verified on Windows only by the owner's session (Ctrl-Break tested, real Ctrl-C not); not re-run on this tree | `scripts/demo_launcher.py` | dev box |
| 21a | Guided demo `#/demo`: six scenes, mode banner, autoplay stops at approval unless approved | verified on the dev box: mock e2e 78/78, lint/typecheck/build clean, one local-backend rehearsal (reported; not re-run here) | `ui/src/story/GuidedDemo.tsx`, `ui/e2e/demo.spec.ts` | dev box |
| 21b | GB10 compute-frontier harness | **run on the GB10**: c=1/2/4, 70 streaming requests, 0 errors; TTFT p50 0.0623 / 0.1087 / 0.1026 s; decode p50 75.63 / 61.83 / 55.27 tok/s per request (not aggregate); min MemAvailable 62.78 GiB; peak 62 C, 42.07 W | sanitized frontier report sha256 `6890165aa86abbb7834ec2aa15784bbf6326104363466d786b0fd66d4e8d23e2` (file on the GB10); [CLAIMS.md §3](CLAIMS.md) | GB10 (aarch64, vLLM 0.21.0) |
| 21c | GB10 bundle and preflight (`deploy/gb10/`) | the OnCall and frontier runs above were driven from this tooling on the GB10 (with five GB10-side patches, e.g. preflight accepts a git checkout without `SHA256SUMS`); the operator's full gate record is not reproduced here | `deploy/gb10/sf-gb10.sh`, [GB10_RUNBOOK.md](GB10_RUNBOOK.md) | GB10 |
| 22 | Runs on the Dell Pro Max GB10 with vLLM | **partly: vLLM serving and live OnCall synthesis plus verification ran on the GB10**; **NemoClaw v0.0.137, OpenShell 0.0.116 and OpenClaw v2026.9.2 are installed on the GB10 (operator-authorized, no sudo), and Gate 2 ran OpenClaw -> SkillForge host tools (records-ops) through them, but the OnCall runs used the host harness and the OnCall flow has not run under them** (claims 23, 26) | [CLAIMS.md §3](CLAIMS.md) | GB10, subprocess runner |
| 23 | OpenShell egress policy confines the sandbox to the host service | **partly verified, GB10 (Gate 2 GO, 13/13).** The policy `host-tools` was dry-run reviewed, then applied: only `host.openshell.internal:8765`, rest/enforce, allowed IP `172.18.0.1/32`, POST `/call`, binary `/usr/bin/python3`; the policy list shows `telegram` + `host-tools`. OCSF: `ALLOWED /usr/bin/python3.13 -> POST http://host.openshell.internal:8765/call [policy:nemoclaw_custom__host-tools__host-tools engine:l7]`; `denied_action_count`=0. **Not verified:** a negative test (a request to another destination being denied) is not recorded; a full egress review; scope is the records-ops round trip, not the OnCall flow | `adapters/openclaw/presets/host-tools.yaml`; GB10 report sha256 `25a552fe863dcbcce74fb4c5b66c0d4243ec66e95a959d750af6c7f046b99885` (not in this repo); [integrations/telegram/GAPS.md](../integrations/telegram/GAPS.md) | GB10 |
| 23c | OpenClaw (in the OpenShell sandbox, via NemoClaw) -> SkillForge host tools round trip | **VERIFIED, GB10, with records-ops tools** (Gate 2 GO, 13/13; `scripts/gb10_preflight.sh gate2` -> "RESULT: GO (gate2)"). Tool service `python3 -m app serve --bind 172.18.0.1 --port 8765` on the openshell docker bridge only (no 0.0.0.0), 401 without the agent token, `SKILL_RUNNER=docker`, on a scratch state (`learn_a`, 5 records); the approved OnCall registry was not touched. Sandbox `skillforge` (OpenShell 0.0.116, restricted tier, model `skillforge-qwen` via `inference.local`): session `gate2-rt-1` called `search_skills` + `read_records` and returned records A-101..A-105 (4 tool calls, 0 failures); `gate2-rt-2` called `get_audit`. `decide_approval` is not in the agent's tool set: calling it from the sandbox gives `unknown_tool`, so approval stays host-CLI only. The tool service writes one access-log line per request (method, path, status, tool, ok; no body or token), commit `2f8c6e7`. Persona: `integrations/openclaw-style/SOUL.md`. **Not verified:** OpenClaw-driven OnCall synthesis: pipeline verified end to end, no candidate passed the independent verifier (0 accepted; claim 23b) | GB10 report sha256 `25a552fe863dcbcce74fb4c5b66c0d4243ec66e95a959d750af6c7f046b99885` (not in this repo) | GB10 |
| 23a | NemoClaw/OpenShell/OpenClaw installed on the GB10; sandbox `skillforge` (restricted tier) serves the local Qwen as `https://inference.local`, with GPU/CUDA verified inside | **run on the GB10** (operator report): NemoClaw v0.0.137 (pinned), OpenShell 0.0.116, OpenClaw v2026.9.2, no sudo. Disclosed: NemoClaw's auth proxy listens on `0.0.0.0:11435` (token-protected, hard-coded, mitigation proposed, not applied; [ARCHITECTURE.md](ARCHITECTURE.md)). Other new listeners are loopback/bridge only | [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md) | GB10 |
| 23b | OnCall loop runs under NemoClaw/OpenShell/OpenClaw | **no.** The verified OnCall runs used the host harness. Gate 2 exercised records-ops tools only (claim 23c). OnCall under OpenClaw is Gate 3, final status NOT PASSED. Gate 3, OpenClaw in the sandbox `skillforge` driving OnCall through host tools: the agent called `read_records`, `investigate` and `propose_skill` through the `host-tools` policy (all ALLOWED) and the host verifier evaluated each candidate; 6 candidate versions, all `failed_tests`, nothing staged, nothing to approve (the first run failed lint on `import sys`/`os`; the second passed lint and regression but failed the hidden suite). The second run made more submissions than the instructed cap and was stopped by the operator, so its scores are not cited. The agent-facing response no longer exposes any hidden-suite verdict; a hard host-side per-task submission cap is in progress. The hidden suite never left the host and the approved registry was untouched. OpenClaw-driven OnCall synthesis: pipeline verified end to end, no candidate passed the independent verifier (0 accepted) | GB10 operator report (not in this repo) | GB10 |
| 24 | GPU, power or token savings | **not measured.** Raw GPU/power readings exist (62 C and 42.07 W peak in the frontier run); no comparison against an alternative exists | — | — |
| 24a | Skill lint is a security boundary | **no.** A GB10-side audit bypassed it by aliasing (`o = open`) and `operator.attrgetter`; fixed in `1094d95`. Hidden-suite secrecy against a hostile skill needs the Docker runner (the timed GB10 runs used the subprocess runner; the approved skill was later re-verified on a copy under Docker, [CLAIMS.md](CLAIMS.md)) | [ARCHITECTURE.md](ARCHITECTURE.md) | GB10-side audit |
| 25 | GPU-aware scheduling, model sleep/wake | **proposed** | `experiments/router/power.py` (read-only detection) | — |
| 26 | Messaging channel (Slack, Telegram) delivers tasks | **partly. Two halves, each verified on the GB10, the joined chain not recorded.** (1) Telegram <-> local model round trip (OpenShell OCSF: getUpdates -> inference.local -> sendChatAction -> sendMessage, all ALLOWED by policy `telegram_bot`; `skillforge-qwen` logged 5 chat completions in the window, Nemotron 0; OpenClaw telemetry denied). (2) OpenClaw in the sandbox -> SkillForge host tools round trip with records-ops tools (Gate 2 GO, claim 23c). **Not verified:** a single Telegram message driving SkillForge tools end to end, OpenClaw-driven OnCall synthesis (pipeline verified, 0 candidates accepted), a non-allowlisted-sender check, a full egress review. The SkillForge channel in this tree (`scripts/unified.py`) is still simulated; Slack not done | [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md), [integrations/telegram/GAPS.md](../integrations/telegram/GAPS.md); GB10 `openshell-ocsf.txt` sha256 `2237e29930c8846da986b97163df10662165ea4c1c812277b76c0c40bec290e7` (not in this repo); Gate 2 report sha256 `25a552fe863dcbcce74fb4c5b66c0d4243ec66e95a959d750af6c7f046b99885` (not in this repo) | GB10 |
| 27 | Tests prove skills correct | **no**: tests are evidence, not formal proof | [ARCHITECTURE.md §C](ARCHITECTURE.md#c-independent-verification) | — |


# Results and limits

Measurements (three kinds kept apart: dev-box simulation, stub-harness tests, GB10 live) and the full limitations list.

## Measurements

Three kinds of numbers are kept apart here. Do not quote a number from one section as if it came from another.

1. **Windows dev-box simulation results**: real measurements, but on a Windows 11 x86_64 laptop with no GPU, a MOCK
   agent or a hand-written reference skill, and synthetic data. They say nothing about model latency on a GB10.
2. **Stub-harness tests**: the GB10 measurement tools exercised against a local stub OpenAI server. They prove the
   harness runs and keeps unknown values null. They measure nothing.
3. **GB10 live measurements (2026-10-25)**: section 3 below. Reported by the GB10 operator's session; the evidence
   files are on the GB10/SSD and are not in this repository.

Unknown values stay `null` or "not measured", never 0.

### 1. Windows dev-box simulation results

Environment: Windows 11 x86_64, no GPU, Python 3.14.3, synthetic data, no real model.

#### OnCall deterministic reuse

| metric | value | what it is |
|---|---|---|
| INC-2 `model_calls` | 0 | enforced by a `NoModel` guard that raises on any model-client construction |
| INC-2 reuse latency | about 117–256 ms across recorded runs; 256.0 ms in the committed artifact | **match plus deterministic skill execution on the dev box only.** Not an inference saving: the first run had no model call to compare against |
| hidden suite / regression | 9/9, 5/5 | reference skill, recorded run |
| INC-3 | refused (fingerprint mismatch) | see [ARCHITECTURE.md](ARCHITECTURE.md) |

Source: `ui/public/demo/oncall-run.recorded.json` (`mode: RECORDED_SIMULATION`, `telemetry.gpu: null`).

#### Three-mode benchmark (MOCK agent)

`python -m app bench`, subprocess runner, 5 trials, median ± MAD of automated seconds. Full table:
[ARCHITECTURE.md §13](ARCHITECTURE.md).

| case | A agentic | C deterministic | tool calls A / C |
|---|---|---|---|
| known_compatible | 0.057 s | 0.160 s | 15 / 5 |
| unseen_compatible | 0.061 s | 0.176 s | 20 / 7 |

Reuse cut tool calls by about 2.5–3×. It made latency **worse** in mock (0.06 s → 0.17 s): the mock agent costs
nothing to think, while a skill run costs about 150 ms of process start-up. Learning break-even in seconds is
"never" under mock; in model calls it is not computed, because no per-task model-call comparison was measured ([ARCHITECTURE.md §14](ARCHITECTURE.md)).

#### Indexed freight skill variant (research)

Skill compute only, p50: 789 ms → 25.7 ms at 4,400 records (31×); 42.7 ms → 4.7 ms at 1,100 (9.1×), identical output.
End to end this is about 1.3× at 1,100 rows and invisible behind container start. The variant
(`experiments/perf/skills/freight-indexed`) is **human-authored research and was not promoted**; it is not something
SkillForge learned. Source: [ARCHITECTURE.md](ARCHITECTURE.md) §2, `experiments/perf/results/devbox.json`.

### 2. Stub-harness tests

| harness | tests | what they show |
|---|---|---|
| `experiments/gb10_bench/frontier.sh`, `frontier_report.py` | `test_frontier_sh_against_stub`, `test_report_keeps_nulls_and_invents_no_rows`, `test_redact_hides_keys` | the harness runs end to end against a stub, writes the expected files, redacts API keys, keeps nulls, invents no rows. Labels are `fixture-not-gb10*` |
| `experiments/gb10_bench/ttft.py` | `test_probe_against_fake_stream` | TTFT parsing of a streamed response |
| OnCall `--live` path | `test_live_path_counts_calls_and_tokens_against_a_stub_server`, `test_live_strict_fails_loudly_writes_nothing_and_keeps_previous_state` | call and token counting; strict failure with no silent fallback |

Run: `python -m pytest -q -p no:cacheprovider experiments/gb10_bench experiments/oncall_infer/test_oncall_infer.py`.

### 3. GB10 live measurements (2026-10-25)

Source of these numbers: the GB10 operator's session. Raw evidence stays on the GB10/SSD (`results/frontier/gb10-qwen36-35b`,
`results/gb10-evidence/`); this repository holds the sha256 of the files named below, not the files. Code: public
`633b030` plus GB10 patches; the final runs were at commit `35d5820`. All GB10 runs used the **subprocess runner**, not
Docker (see [ARCHITECTURE.md](ARCHITECTURE.md)).

**Hardware and serving.** NVIDIA GB10, aarch64, driver 580.178.04, MemTotal 121.63 GiB, vLLM 0.21.0+2325b6f0.dev.
Model Qwen3.6-35B-A3B-NVFP4 served locally as `skillforge-qwen`, `max_model_len` 32768, inline thinking (no reasoning parser). This is the **earlier config** (gpu-memory-utilization 0.4, max-num-seqs 4); the serving was later changed, see "Serving change" below. All OnCall attempts, approval and reuse below were measured under this earlier config.

**Throughput, per request, earlier config (0.4 / 32k / 4 seqs)** (frontier harness; decode tok/s is per request, not aggregate server throughput).
Source: sanitized frontier report, sha256 `6890165aa86abbb7834ec2aa15784bbf6326104363466d786b0fd66d4e8d23e2`.

| concurrency | requests | errors | TTFT p50 / p95 | decode tok/s p50 |
|---|---|---|---|---|
| 1 | 10 | 0 | 0.0623 / 0.0654 s | 75.63 |
| 2 | 20 | 0 | 0.1087 / 0.1169 s | 61.83 |
| 4 | 40 | 0 | 0.1026 / 0.1218 s | 55.27 |

0 of 70 streaming requests failed. Memory over the run (same report): 78 samples, min MemAvailable 62.78 GiB, derived
peak used 58.85 GiB (MemTotal minus min MemAvailable; CPU and GPU share one pool), peak temperature 62 C, peak power 42.07 W.

**Serving change and Qwen-only bench (label: UNCONTENDED; GB10 operator report).** Nemotron was stopped on purpose after 0/2 on OnCall (container kept). Qwen3.6-35B-A3B-NVFP4, vLLM 0.21.0, gpu-memory-utilization 0.80, `max_model_len` 131072, max-num-seqs 16, fp8 KV. KV cache 6,669,475 tokens (was 183k); vLLM reports 50.88x concurrency at 128k. Memory about 88% used (106.8/121.6 GiB).

| config | thinking | c=1 / 2 / 4 TTFT p50 (s) | decode tok/s per request | aggregate tok/s | errors | GPU max |
|---|---|---|---|---|---|---|
| earlier: 0.4 / 32k / 4 seqs | (frontier report above) | 0.062 / 0.109 / 0.105 | 75.6 / 61.9 / 55.2 | 75.6 / 123.8 / 220.8 | 0/70 | 62 C, 42.07 W |
| current: 0.80 / 128k / 16 seqs, fp8 KV | off | 0.058 / 0.085 / 0.082 | 73.8 / 59.2 / 55.6 | 73.8 / 118.4 / 222.5 | 0/70 | 65 C, 41.8 W |
| current: 0.80 / 128k / 16 seqs, fp8 KV | on | 0.053 / 0.086 / 0.115 | 72.7 / 57.0 / 34.0 | 72.7 / 114.1 / 136.2 | 0/70 | 75 C, 71.8 W |

The thinking-on decode drop at c=4 (34.0 tok/s) is unexplained and was not re-run. Takeaway: single-stream decode is unchanged (memory-bandwidth bound); the change buys context (32k -> 128k), KV capacity and concurrency headroom, not speed.

- `qwen_bench` (current config, 33 requests, c=1, thinking off): TTFT p50 0.069 s (p95 0.255), end-to-end p50 0.689 s, decode p50 73.2 tok/s, JSON 12/12, native tool calls 12/12, 0/33 errors.
- 512-token non-streaming aggregate (current config): 177 / 240 / 355 tok/s at c=4 / 8 / 16.
- Evidence (GB10): `artifacts/bench/qwen3.6-35b-a3b-nvfp4-solo128k-20261025T215550Z.json` sha256 `8b035111270928b25352682de5780dadad16a09538dc7daacb4cfc9b20f3c7c2`; SSD `SHA256SUMS` sha256 `d199b610022ca4a9f0685fa84cf8c1fb7deb4bccf2398104904f72e0388bb28a` (93 lines, 0 failures). Neither file is in this repo.
- Default `ONCALL_MAX_TOKENS` is now 24000 (commit `d14701d`): live thinking runs used 12-17k tokens and 8192 truncated them.

**Current serving config (GB10 operator report).** CONFIG `qwen-solo-mtp` (current serving): Qwen3.6-35B-A3B-NVFP4, vLLM 0.21.0, gpu-memory-utilization 0.60, `max_model_len` 131072, max-num-seqs 16, `--async-scheduling`, MTP speculative decoding (`num_speculative_tokens` 2); KV cache 3,708,983 tokens; memory 85/121 GiB. Measured with a QUICK-PROBE harness, not the frontier or `qwen_bench` harnesses, so these numbers are not directly comparable to the frontier tables: c=1 decode 89.6 to 91.2 tok/s (thinking off) and 87.4 to 90.3 (thinking on), against 72 to 74 on the previous config with the same probe; TTFT 0.08 s; aggregate with 512-token requests 189 / 330 / 504 tok/s at c=4 / 8 / 16 (previous config 177 / 240 / 355); MTP acceptance 74.7% (11,061 of 14,814). Sanity check after the restart: PASS, the approved skill intact, INC-2 reuse 0 model calls (49.2 ms), INC-3 refused. The OnCall attempts and the pass-rate evaluation ran under the earlier configs.

**Live OnCall synthesis (Qwen writes the skill), earlier config.** The verifier is lint, the skill's own tests, an INC-1 replay, a capacity
check and a hidden suite of 9 cases the model never sees.

| # | run (UTC, 25 Oct) | model / prompt | result |
|---|---|---|---|
| 1 | 190129Z | Qwen, non-thinking, original prompt | hidden 5/9, rejected |
| 2 | 190703Z | Qwen thinking, original prompt | hidden 7/9 (failed 2 escalation cases), rejected |
| 3 | 193003Z | Nemotron on :8001, original prompt | 2 calls, 660 s, 51,972 completion tokens, failed lint, rejected |
| 4 | 200351Z | Qwen thinking, **revised prompt** | 1 model call, 173.0 s, 1,998 prompt / 12,763 completion tokens; hidden 9/9, regression 5/5, PASSED, staged as `tested` |
| 5 | 200758Z | same config as 4 (repeatability) | 1 call, 233.8 s, 1,998 / 17,067 tokens; hidden 8/9 (failed "OOM present but no memory key changed"), regression 5/5, REJECTED, never staged |

| 6 | 2026-10-25, GB10 | Nemotron, with the adapter fix (string-aware JSON extraction + truncation feedback) | 2 calls, both hit `max_tokens`=32000 while reasoning (finish_reason=length, from vLLM counters); no JSON answer, **no candidate**, FAILED |

- **Prompt revision, disclosed.** Between attempts 3 and 4 the operator revised the prompt after seeing the 7/9 result. It
  adds an evidence-sufficiency rule: propose only with trusted OOM evidence and exactly one memory key raised; otherwise
  refuse with `requires_review` / `insufficient_evidence` / `not_applicable`. The authoring agent did not read the hidden suite.
- **Pass rate.** Original prompt: 0 of 3 passed. Revised prompt: 1 of 2 passed (9/9, then 8/9), and 3 of 7 with thinking on plus 0 of 1 with thinking off in the later evaluation below: 4 passes in 9 attempts under the revised prompt. Every failing candidate was rejected by the verifier and none was staged.
- **Attempt 6 (Nemotron, failed).** A thinking-budget problem, not formatting: both calls exhausted 32000 tokens while reasoning. Nemotron total **0 of 2** (attempts 3 and 6). Wall time 13.7 min, contended by the NemoClaw install, so do not read it as clean latency. GPU 823 samples, utilization p50 96%, temperature max 74 C, power max 46.2 W. Evidence on the GB10: `console.txt` sha256 `c103565e937f9a1254d934d8982f4a0e2ef33dd1d4411518a30d09f1d2521cee` (not in this repo). **Overall tally: Qwen 1 pass in 4 (1 of 2 with the disclosed revision); Nemotron 0 of 2.**
- **Extra bench numbers (GB10 operator report).** Qwen: TTFT p50 0.081 s, decode about 69-76 tok/s, structured JSON 12/12, tool calls 12/12, 0 of 33 errors. Nemotron: TTFT 0.244 s, first answer token 8.1 s. `check-llm` warm-after-idle 0.35-0.56 s (cold start not measured). No file hashes were supplied for these.
- **Not deterministic.** Attempts 4 and 5 used the same configuration at temperature 0 and produced different code and
  different outcomes (vLLM is not deterministic here).
- **Attempt 4 artifact.** Skill tree sha256 `7fe0c025039b11b93617ba63955f3fe9da0ec55c7e7a0ed11bbae3982fa3aa0e`;
  run record committed (sanitized, host replaced by `<gb10-host>`) at `docs/evidence/gb10/attempt4-oncall-run.json`,
  sha256 `712dbf7827e0f7c1bf16890d8efcb2758398bcfcd888eeb3766e12369f634b58` (pre-sanitization original on the GB10:
  `6683d26bbed1e0b8ce4d6f7508a309498da9c0b5aefbe8585e0b67769fec87a1`). Proposal: revert
  `max_num_seqs` 1024 to 128 on deploy `d-4117`. **Proposal only; nothing was applied.** GPU telemetry for attempt 4: not captured (null).
- **Attempt 5 GPU telemetry.** 235 samples, utilization p50 96%, temperature max 67 C, power p50 42.9 W / max 44.0 W
  (source: `nvidia-smi` 1 s samples in the run's `gpu.csv` on the GB10/SSD evidence store, sha256
  `e3560c82a6822deeb5ba998596fe2a3908897a257bbbbba9b846edccec917b27`, summarised by the GB10 operator; not in the
  committed run record, whose `telemetry` field is null).
- **Why attempt 5 failed.** For the case "OOM present but no memory key changed" the model answered `not_applicable`,
  although the revised prompt says zero or several candidate keys mean `requires_review`: the model did not follow an
  explicit instruction. The verifier caught it.
- The committed records and `docs/evidence/gb10/README.md` are the verifiable evidence for attempts 4 and 5. Attempts 1,
  2 and 3 have no committed record or sha256 in this tree: those rows are the operator's report only.
- **Lint-bypass finding.** The attempt-4 candidate imports only `json` and `typing`, uses no file, attribute or dunder
  access, passes the hardened lint, and its hash is unchanged, so its 9/9 is not contaminated by the finding in ARCHITECTURE.md.

**Qwen skill-synthesis evaluation (GB10, 2026-10-25; GB10 operator report).** Current serving config (0.80 / `max_model_len` 131072 / 16 seqs, fp8 KV), `ONCALL_MAX_TOKENS` 40000, the committed prompt including the one disclosed revision. Scratch states only: nothing was staged or approved. The evaluator never read the hidden suite. Timings are CONTENDED (parallel runs).

| setting | runs | passed (hidden 9/9 and regression 5/5) | failed |
|---|---|---|---|
| thinking on | 7 | 3 | 4, each hidden 8/9 |
| thinking off | 1 | 0 | 1, hidden 8/9 |

- Regression passed 5/5 in all 8 runs. All 5 failures are the same hidden case, `oom_without_memory_key_change_escalates`: the model maps "OOM present, zero memory keys changed" to `not_applicable` instead of `requires_review`. That is an instruction-following miss, not truncation or format (completion tokens 7.8k to 16.0k, far under the cap).
- Pooled with live attempts 4 and 5 under the revised prompt: 4 passes in 9 attempts. The 95% confidence interval for 3 of 7 is roughly 16% to 75%.
- 275 to 469 s per run (mean about 422 s), contended, so not clean latency.
- The verifier rejected every failing candidate: no false accepts.
- **Decision: no further prompt revision.** The failing hidden case name is now known, so any change would be teaching to the test.
- **Verdict.** Generation is not reliable enough for unattended use (about 3 of 7 per attempt). The verifier plus human approval is what makes it safe; reuse of an approved skill is deterministic.
- The `app bakeoff` `skill_codegen` probe at its committed 4096-token cap truncates with thinking on (0 of 2); at 40000 it passes 1 of 2 (one lint failure on `import pytest`, one hidden 11/11 pass).
- Evidence on the GB10 (not in this repo): summary `005-qwen-skill-eval.md` and the SSD folder `eval-20261025-165709/` with `MANIFEST.sha256`.

**Approval and reuse on the GB10 (2026-10-25, GB10 commit `35d5820`; the GB10 operator's report).**

- **Approval.** At 20:25:02Z a person (the operator) typed `python -m app skill approve oncall-serving-config-revert 1 --by "<operator>"` on the GB10 host CLI. Result: status approved, active, sha256 `7fe0c025039b11b93617ba63955f3fe9da0ec55c7e7a0ed11bbae3982fa3aa0e` (matches the attempt-4 tree hash). The command re-ran the hidden suite (`hidden_validation.ok` true). Audit actor `human:<operator>`, `approval.kind` `host_cli`. Caveat: the `--by` name is not identity-verified.
- **INC-2 reuse** (`sf-gb10.sh reuse`, 20:25:08Z): state done, deterministic fast path, **0 model calls**, 27.0 ms. Matched by "core matcher exact + incident fingerprint equal". It generalized to a different key: diagnosis `serving_config_regression`, key `max_model_len`, deployed 131072 vs baseline 16384, deploy `d-5203`, proposal "revert max_model_len to 16384" (proposal only, never applied).
- **INC-3 refused.** Reason: "structural signature matches (core matcher: exact) but the incident fingerprint differs: exception_type: 'torch.OutOfMemoryError' -> 'OSError'; failure_category: 'gpu_oom' -> 'disk_full'; top_frames: 'vllm/worker/model_runner.py:execute_model' -> 'vllm/compilation/backends.py:save_graph'".
- **Repeatability.** 5 more reuse trials in fresh processes: 42.1 (first), 28.4, 27.9, 28.5, 27.7 ms, all 0 model calls, INC-3 refused every time. Over n=6: p50 28.2 ms, min 27.0, max 42.1.
- **Server side.** vLLM Prometheus counters (`request_success_total`, `prompt_tokens_total`, `generation_tokens_total`) were unchanged before and after the reuse trials (Qwen 44713 -> 44713, Nemotron 78758 -> 78758): no request reached either model server. This backs up the in-process `NoModel` guard.
- **Latency scope.** The reuse decision plus the sandboxed skill run in the SUBPROCESS runner (no Docker isolation), on GB10 aarch64. It is not a speed-up claim against synthesis; these are different scopes: synthesis attempt 4 took one model call of 173.0 s, reuse made 0 model calls in about 28 ms.
- **Evidence.** Run record `docs/evidence/gb10/reuse-oncall-run.json` (sanitized copy; its sha256 is listed in `docs/evidence/gb10/README.md`); GB10 original `results/gb10-evidence/20261025T202508Z-reuse/oncall-run.json` sha256 `1e32985ef4bffa612f5c36879ec1dbdbe9415d1badee85059f5f29eef84086d2` (pre-sanitization). `console.txt` sha256 `c0f70c5f042379aa9269c3b83ca4b2124074069ed95e2d796fd4b45beb2abcfc`. SSD `SHA256SUMS` (57 lines, 0 failures) sha256 `e40e446bdffa6c1d6a515da803cafc9953f6295a9364c36362d0881a3906895e`.
- **Caveats.** Subprocess runner (no Docker isolation); unauthenticated `--by` identity; small n (1 of 2 passes with the disclosed revision; 6 reuse trials); disclosed prompt revision after attempt 2. Overall live status: GO.
- **Docker follow-up (after the runs above).** The GB10 Docker path first failed closed on every run (the 0700 temp dir was unreadable by the container's uid 65534; fixed in this release, `tests/test_docker_runner.py`). With the fix, the approved attempt-4 skill was re-verified on a copy with `SKILL_RUNNER=docker` (`--network none`, read-only, 512 MB, 1 CPU, pids 64, no capabilities, uid 65534, only the skill copy mounted, so the hidden suite is unreachable): hidden 9/9, regression 5/5, same hash `7fe0c025...` (GB10 evidence `docker-reverify.json`, sha256 `4b7d54fd1cbd3462ce8a3b5d0127c9113152edfc51fbb58c2a8a790717148f02`, not committed). INC-2 reuse under Docker: 0 model calls, 275.5 ms (container start-up included), INC-3 refused. The original attempt-4 verification and the 6 timed reuse trials still ran in the subprocess runner.

**OnCall not run under NemoClaw; Gate 2 was.** NemoClaw v0.0.137, OpenShell 0.0.116 and OpenClaw v2026.9.2 were installed on the GB10 on 2026-10-25, during attempt 6 and after the OnCall runs above (operator-authorized, no sudo); nothing on the OnCall path ran under them. Afterwards Gate 2 passed 13/13 (GB10 report sha256 `25a552fe863dcbcce74fb4c5b66c0d4243ec66e95a959d750af6c7f046b99885`): an OpenClaw agent in the sandbox called `search_skills`, `read_records` (records A-101..A-105; 4 tool calls, 0 failures) and `get_audit` on the host tool service through the `host-tools` policy. That is a records-ops round trip, not a benchmark and not the OnCall flow (Gate 3: pipeline verified end to end, no candidate passed the independent verifier, 0 accepted; details in [CLAIMS.md](CLAIMS.md) #23b) ([CLAIMS.md](CLAIMS.md) #23c). A Telegram <-> local model round trip was verified separately ([CLAIMS.md](CLAIMS.md) #26, [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md)).

#### Methodology

From [GB10_RUNBOOK.md](GB10_RUNBOOK.md), [GB10_RUNBOOK.md](GB10_RUNBOOK.md) and [ARCHITECTURE.md](ARCHITECTURE.md) §5–6:

- **Authorization.** GPU inference needs a named operator's yes; the name goes in the label.
- **Order.** The 35B demo model (Qwen3.6-35B-A3B NVFP4) first, at concurrency 1, 2, 4 (done). Larger models are not
  measured; switching recreates the NemoClaw sandbox ([GB10_RUNBOOK.md](GB10_RUNBOOK.md)).
- **Identity.** `identity.json` records GPU name and driver, the served model id from `/v1/models`, `max_model_len`,
  vLLM version, container image and serve args (keys redacted). Quantization and revision are null unless read from
  config, never guessed from the name.
- **Samples.** Temperature, power, utilization, memory every 1 s; `[N/A]` becomes null.
- **TTFT and decode.** `ttft.py`, n=10 after 2 discarded warm-ups, `max_tokens` 128. Concurrency C = C parallel
  copies. **Decode tok/s is per request, not aggregate server throughput.**
- **Guards.** Abort if MemAvailable < 16 GiB or GPU temp > 85 °C; per-stage timeout 600 s (OnCall 1200 s);
  concurrency capped at 4.
- **OnCall.** `run --live` into its own registry, stop for a person's approval, then `--after-approval` measures
  reuse. Reuse savings are only claimable as (first-run model calls and time) versus (reuse: 0 calls, measured time),
  both from the same GB10 session.
- **Break-even.** Batch size where `skill_cold + approve + execute + verify < agent turns × measured model latency`,
  computed only from measured numbers.


## Limitations

Each claim and its evidence: [CLAIMS.md](CLAIMS.md). Security gaps in detail:
[ARCHITECTURE.md](ARCHITECTURE.md).

### Evidence

- **The committed OnCall recording is still a `RECORDED_SIMULATION`**: its skill was hand-written by a coding agent,
  and its approval was typed by an agent (`approval.kind: simulated`). Do not read it as the GB10 result.
- **GB10 live synthesis is not reliable.** Qwen wrote a skill that passed the 9-case hidden suite once (9/9) and failed
  the identical repeat (8/9); with the original prompt 0 of 3 attempts passed. The prompt was revised by the operator
  after seeing the 7/9 result (disclosed, evidence-sufficiency rule). A later evaluation (current serving config,
  committed prompt, scratch states, nothing staged or approved, timings contended) passed 3 of 7 with thinking on and
  0 of 1 with thinking off; 4 of 9 pooled with attempts 4 and 5. All five failures were hidden 8/9 on one case
  (`not_applicable` instead of `requires_review`); the verifier rejected every one. The prompt is not revised
  further, because the case name is known and a change would teach to the test. Generation is not reliable enough for
  unattended use; the verifier plus human approval is what makes it safe. Output is not deterministic at temperature 0
  on this vLLM. See [CLAIMS.md](CLAIMS.md).
- **GB10 approval and reuse: done, with caveats.** A person (the operator) approved the passing skill on the GB10 host CLI; the `--by` name is not identity-verified. INC-2 reuse made 0 model calls (6 trials, p50 28.2 ms, min 27.0, max 42.1) and INC-3 was refused every time, all in the subprocess runner (no Docker isolation). n=6, one skill. There is no GB10 first-time-vs-reuse speed-up claim (different scopes: 173.0 s model call vs ~28 ms with 0 model calls). GPU telemetry for the passing run was not captured.
- **Docker follow-up (after the runs above).** The GB10 Docker path first failed closed on every run (the 0700 temp dir was unreadable by the container's uid 65534; fixed in this release, `tests/test_docker_runner.py`). With the fix, the approved attempt-4 skill was re-verified on a copy with `SKILL_RUNNER=docker` (`--network none`, read-only, 512 MB, 1 CPU, pids 64, no capabilities, uid 65534, only the skill copy mounted, so the hidden suite is unreachable): hidden 9/9, regression 5/5, same hash `7fe0c025...` (GB10 evidence `docker-reverify.json`, sha256 `4b7d54fd1cbd3462ce8a3b5d0127c9113152edfc51fbb58c2a8a790717148f02`, not committed). INC-2 reuse under Docker: 0 model calls, 275.5 ms (container start-up included), INC-3 refused. The original attempt-4 verification and the 6 timed reuse trials still ran in the subprocess runner.
- **GB10 evidence files are not in this repository.** Numbers are the GB10 operator's report plus the sha256 of the files
  on the GB10/SSD; they are not independently reproducible from this tree.
- **Decode tok/s is per request only.** The frontier harness runs C parallel copies of a single-request probe; it
  does not measure aggregate server throughput.
- All data (OnCall incidents, freight records) is synthetic, and the message channel is simulated (no Slack or
  Telegram in this tree's SkillForge code). A Telegram <-> local model round trip was verified on the GB10 through NemoClaw/OpenShell ([CLAIMS.md](CLAIMS.md) #26); OpenClaw -> SkillForge host tools was verified separately (Gate 2, records-ops tools; CLAIMS #23c), but a single Telegram message driving SkillForge tools end to end is not recorded.
- Tests, replay and hidden suites are evidence, not a formal proof that a skill is correct.
- The reuse latency (about 117–256 ms) is a dev-box measurement of match plus deterministic execution, not an
  inference saving.

### Security and correctness

- **Core matcher gap.** Core `match_skills` reports the OnCall lookalike INC-3 as an `exact` match. The refusal comes
  from the experiment's incident fingerprint; core reuse paths do not consult it. A direct core `run_skill` is
  contained by the hidden suite's lookalike cases. Fixing it needs a core change ([ARCHITECTURE.md](ARCHITECTURE.md)).
- **Approver identity is not verified.** `--by` is free text; `approval.kind: host_cli` means a command was typed on
  the host, not that the named person approved.
- The subprocess runner's rlimits are not applied on Windows. Docker isolation was checked only on the dev box.
- **GB10 runs used the subprocess runner**, not Docker (Docker was permission-denied for the GB10 user; the docker path
  fails closed). **The skill lint is not a security boundary** (a bypass by aliasing and `operator.attrgetter` was found
  and fixed in `1094d95`); under the subprocess runner a hostile skill could read the hidden suite from disk, so hidden-suite
  secrecy needs the Docker runner ([ARCHITECTURE.md](ARCHITECTURE.md)).
- **Gate 2 passed (OpenClaw in the sandbox -> SkillForge host tools, records-ops tools only), but the OnCall loop has not run under NemoClaw/OpenShell/OpenClaw.** The OnCall runs used the host harness, under the earlier serving config (0.4 / 32k / 4 seqs). The `host-tools` policy was applied and exercised for the records-ops round trip; no negative test is recorded. Not verified: OpenClaw driving OnCall synthesis/verification (Gate 3: pipeline verified end to end, no candidate passed the independent verifier, 0 accepted; [CLAIMS.md](CLAIMS.md) #23b), Telegram -> SkillForge tools in one end-to-end message, a non-allowlisted-sender check, a full egress review. See [CLAIMS.md](CLAIMS.md) #23c, [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md) and [integrations/telegram/GAPS.md](../integrations/telegram/GAPS.md).
- **Serving change is a capacity change, not a speed change.** Single-stream decode is unchanged (73.8 tok/s at c=1, thinking off, current config vs 75.6, earlier config). The thinking-on c=4 decode drop (34.0 tok/s) is unexplained and was not re-run. Nemotron was stopped after 0/2 on OnCall; Qwen-only numbers are UNCONTENDED.
- **NemoClaw's auth proxy listens on `0.0.0.0:11435`** (token-protected, 401 without the token; hard-coded in NemoClaw `scripts/ollama-auth-proxy.mts:478`, not configurable). Mitigation proposed (UFW allow lo and 172.18.0.0/16 to 11435, deny the rest), **not applied**; awaiting an operator decision.
- **Nemotron has not produced a passing skill.** Attempts 3 and 6 failed (0 of 2); attempt 6 hit `max_tokens` 32000 while reasoning with no answer (a thinking-budget problem).
- **Incident, 2026-10-25.** The first `channels add telegram` rebuild deleted the original sandbox `my-assistant` (the non-interactive recreate lacked `NEMOCLAW_COMPATIBLE_AUTH_MODE=none`). Fixed in `integrations/telegram/telegram-setup.sh`; recreated as `skillforge`; vLLM untouched.
- **Hosted preview is not the product.** https://skillforge-ui-lab.vercel.app is read-only with recorded data and no backend calls.
- With the `--local` fallback package, the agent has `exec` inside the sandbox, so guarantees hold only through the
  tool interface.

### Reliability

- **15 s core sandbox timeout.** Skill tests and hidden checks run under core's 15 s timeout. Under heavy load (for
  example while the GPU serves a model), verification can time out and the candidate is rejected rather than passed.
  Re-run when idle; raising the timeout is a core change.
- **Flaky tests seen under load** on the dev box: `tests/test_faults.py::test_restore_checkpoint_and_resume_interrupted_workflow`
  and `::test_corrupt_backup_is_not_restored` (each passed when re-run alone), and once
  `experiments/oncall_infer/test_oncall_infer.py::test_after_approval_inc2_reused_with_zero_model_calls_and_inc3_refused`
  (`ToolError` at `app/skillforge.py:748`; passed on re-run). Causes not investigated.
- Single workspace, single open task (`scripts/unified.py`).
- **Screenshots under `ui/screenshots/` come from earlier builds** and are not evidence. Some show copy that was later
  removed because it overstated what is verified (for example the status bar text "Live reads the GB10", which
  the current UI replaces with "Live reads this machine"). Trust the current UI source and the recorded JSON, not the older images.

### Launchers and UI

- `start-demo.ps1` / `start-demo.sh` were verified on Windows only. `start-demo.sh` has not been run on Linux or
  macOS (on the GB10 it is reached via `sf-gb10.sh demo`; this tree has no record of that being run).
- Stopping with **Ctrl-Break** was tested; a real **Ctrl-C** was not.
- Without `ui/node_modules`, the launcher runs `npm ci`, which needs network access.
- The UI suites (mock e2e 78/78, lint, typecheck, build) were reported by the owner's session and not re-run on the
  public tree.

### Scope

- Several components live under `experiments/` and are not imported by the core (router, catalog, OnCall, GB10
  harness).
- GPU-aware scheduling and model sleep/wake are proposals only.
- Team members and per-person contributions are not recorded in git.

