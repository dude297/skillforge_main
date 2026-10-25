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
Model Qwen3.6-35B-A3B-NVFP4 served locally as `skillforge-qwen`, `max_model_len` 32768, inline thinking (no reasoning parser).

**Throughput, per request** (frontier harness; decode tok/s is per request, not aggregate server throughput).
Source: sanitized frontier report, sha256 `6890165aa86abbb7834ec2aa15784bbf6326104363466d786b0fd66d4e8d23e2`.

| concurrency | requests | errors | TTFT p50 / p95 | decode tok/s p50 |
|---|---|---|---|---|
| 1 | 10 | 0 | 0.0623 / 0.0654 s | 75.63 |
| 2 | 20 | 0 | 0.1087 / 0.1169 s | 61.83 |
| 4 | 40 | 0 | 0.1026 / 0.1218 s | 55.27 |

0 of 70 streaming requests failed. Memory over the run (same report): 78 samples, min MemAvailable 62.78 GiB, derived
peak used 58.85 GiB (MemTotal minus min MemAvailable; CPU and GPU share one pool), peak temperature 62 C, peak power 42.07 W.

**Live OnCall synthesis (Qwen writes the skill).** The verifier is lint, the skill's own tests, an INC-1 replay, a capacity
check and a hidden suite of 9 cases the model never sees.

| # | run (UTC, 25 Oct) | model / prompt | result |
|---|---|---|---|
| 1 | 190129Z | Qwen, non-thinking, original prompt | hidden 5/9, rejected |
| 2 | 190703Z | Qwen thinking, original prompt | hidden 7/9 (failed 2 escalation cases), rejected |
| 3 | 193003Z | Nemotron on :8001, original prompt | 2 calls, 660 s, 51,972 completion tokens, failed lint, rejected |
| 4 | 200351Z | Qwen thinking, **revised prompt** | 1 model call, 173.0 s, 1,998 prompt / 12,763 completion tokens; hidden 9/9, regression 5/5, PASSED, staged as `tested` |
| 5 | 200758Z | same config as 4 (repeatability) | 1 call, 233.8 s, 1,998 / 17,067 tokens; hidden 8/9 (failed "OOM present but no memory key changed"), regression 5/5, REJECTED, never staged |

- **Prompt revision, disclosed.** Between attempts 3 and 4 the operator revised the prompt after seeing the 7/9 result. It
  adds an evidence-sufficiency rule: propose only with trusted OOM evidence and exactly one memory key raised; otherwise
  refuse with `requires_review` / `insufficient_evidence` / `not_applicable`. The authoring agent did not read the hidden suite.
- **Pass rate.** Original prompt: 0 of 3 passed. Revised prompt: 1 of 2 passed (9/9, then 8/9). Two samples are not a
  success rate. Every failing candidate was rejected by the verifier and none was staged.
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

**Pending, do not claim:** a person's approval of attempt 4 (`skill approve` on the GB10); reuse on INC-2 and refusal of
INC-3 on the GB10. No GB10 reuse latency exists. No first-time-vs-reuse comparison exists.

**Not run under NemoClaw.** NemoClaw/OpenShell is not installed on the GB10; nothing on the OnCall path ran under it.

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
