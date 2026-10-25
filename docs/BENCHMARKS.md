# Benchmarks and measurements

Three kinds of numbers are kept apart here. Do not quote a number from one section as if it came from another.

1. **Windows dev-box simulation results**: real measurements, but on a Windows 11 x86_64 laptop with no GPU, a MOCK
   agent or a hand-written reference skill, and synthetic data. They say nothing about model latency on a GB10.
2. **Stub-harness tests**: the GB10 measurement tools exercised against a local stub OpenAI server. They prove the
   harness runs and keeps unknown values null. They measure nothing.
3. **Actual GB10 measurements: NONE YET.**

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

## 3. Actual GB10 measurements

**None yet.** No TTFT, decode rate, memory, power, temperature or token number in this repository was measured on a
GB10. Results will come from `results/gb10-evidence/` (`deploy/gb10/sf-gb10.sh`) and `results/frontier/`
(`frontier.sh`), and will be added to [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md#gb10-results-pending--not-yet-measured).

### Methodology (prepared, not run)

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
