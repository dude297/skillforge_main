# Benchmarks and measurements

Three kinds of numbers are kept apart here. Do not quote a number from one section as if it came from another.

1. **Windows dev-box simulation results**: real measurements, but on a Windows 11 x86_64 laptop with no GPU, a MOCK
   agent or a hand-written reference skill, and synthetic data. They say nothing about model latency on a GB10.
2. **Stub-harness tests**: the GB10 measurement tools exercised against a local stub OpenAI server. They prove the
   harness runs and keeps unknown values null. They measure nothing.
3. **GB10 live measurements (2026-10-25)**: section 3 below. Reported by the GB10 operator's session; the evidence
   files are on the GB10/SSD and are not in this repository.

Unknown values stay `null` or "not measured", never 0.

## 1. Windows dev-box simulation results

Environment: Windows 11 x86_64, no GPU, Python 3.14.3, synthetic data, no real model.

### OnCall deterministic reuse

| metric | value | what it is |
|---|---|---|
| INC-2 `model_calls` | 0 | enforced by a `NoModel` guard that raises on any model-client construction |
| INC-2 reuse latency | about 117–256 ms across recorded runs; 256.0 ms in the committed artifact | **match plus deterministic skill execution on the dev box only.** Not an inference saving: the first run had no model call to compare against |
| hidden suite / regression | 9/9, 5/5 | reference skill, recorded run |
| INC-3 | refused (fingerprint mismatch) | see [SECURITY.md](SECURITY.md#incident-fingerprint-and-the-core-matcher-gap) |

Source: `ui/public/demo/oncall-run.recorded.json` (`mode: RECORDED_SIMULATION`, `telemetry.gpu: null`).

### Three-mode benchmark (MOCK agent)

`python -m app bench`, subprocess runner, 5 trials, median ± MAD of automated seconds. Full table:
[SKILLFORGE.md §13](SKILLFORGE.md#13-three-mode-benchmark-python--m-app-bench).

| case | A agentic | C deterministic | tool calls A / C |
|---|---|---|---|
| known_compatible | 0.057 s | 0.160 s | 15 / 5 |
| unseen_compatible | 0.061 s | 0.176 s | 20 / 7 |

Reuse cut tool calls by about 2.5–3×. It made latency **worse** in mock (0.06 s → 0.17 s): the mock agent costs
nothing to think, while a skill run costs about 150 ms of process start-up. Learning break-even in seconds is
"never" under mock; in model calls it is **pending** ([SKILLFORGE.md §14](SKILLFORGE.md#14-learning-break-even-benchbreakeven)).

### Indexed freight skill variant (research)

Skill compute only, p50: 789 ms → 25.7 ms at 4,400 records (31×); 42.7 ms → 4.7 ms at 1,100 (9.1×), identical output.
End to end this is about 1.3× at 1,100 rows and invisible behind container start. The variant
(`experiments/perf/skills/freight-indexed`) is **human-authored research and was not promoted**; it is not something
SkillForge learned. Source: [EXEC_PERF.md](EXEC_PERF.md) §2, `experiments/perf/results/devbox.json`.

## 2. Stub-harness tests

| harness | tests | what they show |
|---|---|---|
| `experiments/gb10_bench/frontier.sh`, `frontier_report.py` | `test_frontier_sh_against_stub`, `test_report_keeps_nulls_and_invents_no_rows`, `test_redact_hides_keys` | the harness runs end to end against a stub, writes the expected files, redacts API keys, keeps nulls, invents no rows. Labels are `fixture-not-gb10*` |
| `experiments/gb10_bench/ttft.py` | `test_probe_against_fake_stream` | TTFT parsing of a streamed response |
| OnCall `--live` path | `test_live_path_counts_calls_and_tokens_against_a_stub_server`, `test_live_strict_fails_loudly_writes_nothing_and_keeps_previous_state` | call and token counting; strict failure with no silent fallback |

Run: `python -m pytest -q -p no:cacheprovider experiments/gb10_bench experiments/oncall_infer/test_oncall_infer.py`.

## 3. GB10 live measurements (2026-10-25)

Source of these numbers: the GB10 operator's session. Raw evidence stays on the GB10/SSD (`results/frontier/gb10-qwen36-35b`,
`results/gb10-evidence/`); this repository holds the sha256 of the files named below, not the files. Code: public
`633b030` plus GB10 patches; the final runs were at commit `35d5820`. All GB10 runs used the **subprocess runner**, not
Docker (see [SECURITY.md](SECURITY.md#runner-lint-and-hidden-suite-secrecy)).

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
- **Pass rate.** Original prompt: 0 of 3 passed. Revised prompt: 1 of 2 passed (9/9, then 8/9). Two samples are not a
  success rate. Every failing candidate was rejected by the verifier and none was staged.
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
  access, passes the hardened lint, and its hash is unchanged, so its 9/9 is not contaminated by the finding in SECURITY.md.

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

**OnCall not run under NemoClaw; Gate 2 was.** NemoClaw v0.0.137, OpenShell 0.0.116 and OpenClaw v2026.9.2 were installed on the GB10 on 2026-10-25, during attempt 6 and after the OnCall runs above (operator-authorized, no sudo); nothing on the OnCall path ran under them. Afterwards Gate 2 passed 13/13 (GB10 report sha256 `25a552fe863dcbcce74fb4c5b66c0d4243ec66e95a959d750af6c7f046b99885`): an OpenClaw agent in the sandbox called `search_skills`, `read_records` (records A-101..A-105; 4 tool calls, 0 failures) and `get_audit` on the host tool service through the `host-tools` policy. That is a records-ops round trip, not a benchmark and not the OnCall flow (Gates 3/4 in progress) ([CLAIMS.md](CLAIMS.md) #23c). A Telegram <-> local model round trip was verified separately ([CLAIMS.md](CLAIMS.md) #26, [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md)).

### Methodology

From [GB10_FRONTIER.md](GB10_FRONTIER.md), [GB10_BENCH_RUNBOOK.md](GB10_BENCH_RUNBOOK.md) and [EXEC_PERF.md](EXEC_PERF.md) §5–6:

- **Authorization.** GPU inference needs a named operator's yes; the name goes in the label.
- **Order.** The 35B demo model (Qwen3.6-35B-A3B NVFP4) first, at concurrency 1, 2, 4. Larger models only after the
  judged demo, because switching recreates the NemoClaw sandbox.
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
