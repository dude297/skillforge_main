# GB10 compute frontier: what to measure, in what order, and what we can honestly claim

**Status:** the harness ran on the GB10 on 2026-10-25 for the served 35B model (c=1/2/4, 70 requests, 0 errors, plus a Qwen-only bench after the serving change); the numbers are in [BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25). The 120B-class and 200B parts below were not run. Before the GB10 runs it was tested against a local stub OpenAI server on a Windows dev box (`experiments/gb10_bench/test_frontier.py`, labels `fixture-not-gb10*`). The comparison template in section (d) is a blank template.

Rules from `docs/GB10_BENCH_RUNBOOK.md` apply: GPU inference is **AUTHORIZATION REQUIRED** (a named operator says yes, and the name goes in the label or notes); unknown stays `null` / "not measured", never 0; no serve-flag, host-setting, driver or profiler changes; no downloads without authorization.

## Tools

| what | command (repo root, on the GB10) |
|---|---|
| measure the served model | `bash experiments/gb10_bench/frontier.sh <label> [--concurrency 1,2,4]` |
| after a PERSON approved the OnCall skill | `bash experiments/gb10_bench/frontier.sh <label> --after-approval` |
| merge all labels | `python3 -m experiments.gb10_bench.frontier_report report` → `results/frontier/frontier.md` + `frontier.json` |

`frontier.sh` measures **only the model that is currently served**. It never switches models, onboards, downloads or changes serve flags. Per label it writes `results/frontier/<label>/`:

- `identity.json`: nvidia-smi name/driver/compute_cap, `/v1/models` id and `max_model_len`, vLLM `/version`, the managed container (label `com.nvidia.nemoclaw.managed-vllm=true`) image and serve args (API-key values redacted), model revision from `--revision`/env or the HF cache `refs/main` (else null), quantization from `--quantization` or the cached `config.json` (else null; never guessed from the model name), `nemoclaw inference get --json`.
- `samples.csv`: every 1 s, temperature, power, utilization, `memory.used` (`[N/A]` → empty = null) and `/proc/meminfo` MemAvailable. Stopped by a trap on exit.
- `stages.tsv`: each stage's status (`ok`, `failed`, `aborted_temp`, `aborted_timeout`, guard results).
- `probe.json`: core `models.probe` (same checks as `python3 -m app models probe`: endpoint, identity, native tool call, schema, multi-step, latency). It does **not** overwrite `data/model_probe.json`, the demo's gate record.
- `ttft-c<C>-<i>.json`: `ttft.py` (n=10, warm-up 2 discarded, `max_tokens` 128). `ttft.py` has no concurrency of its own, so concurrency C = C parallel copies; the report merges their trials. Numbers are **per request**, not aggregate server throughput.
- `oncall-run.json` + `oncall-state/`: `python3 -m experiments.oncall_infer run --live` into its **own** registry (never `data/unified/demo/`), then it stops and prints the approve command for a person.

Safety guards (env overrides): abort before any load if MemAvailable < `FRONTIER_MIN_MEM_GIB` (16) or GPU temp > `FRONTIER_MAX_TEMP_C` (85); unreadable sensors also abort (the `FRONTIER_ALLOW_UNKNOWN_SENSORS=1` override is for stub tests and is recorded in `stages.tsv`); the guard re-runs before every stage; a stage is killed mid-way if temp exceeds the limit or it passes `FRONTIER_STAGE_TIMEOUT_S` (600; OnCall `FRONTIER_ONCALL_TIMEOUT_S` 1200); concurrency is capped at 4. The 35B profile serves with `--max-num-seqs 4`, so c=4 is its ceiling anyway.

## (a) Order: 35B baseline first

1. Gates 0–2 GO (`docs/GB10_RUNBOOK.md`). Verify the demo endpoint works: `python3 -m app check-llm`, `curl -sf -H "Authorization: Bearer $LLM_API_KEY" http://127.0.0.1:8000/v1/models`.
2. Record the recovery config **before** anything else, into `results/frontier/recovery-<date>.txt`:
   - `nemoclaw inference get --json`
   - `nemoclaw profiles list` and the current profile id (expected `vllm.dgx-spark-gb10.single.qwen3-6-35b-a3b-nvfp4`, per `docs/DEPLOY_MANIFEST.md`; confirm on the box)
   - `docker inspect $(docker ps -q --filter label=com.nvidia.nemoclaw.managed-vllm=true) --format '{{.Config.Image}} {{.Args}}'`
   - the rollback command, written out in full: `bash scripts/switch_model.sh <current-profile-id> <current-profile-id>` (re-serves the baseline; it **recreates the sandbox**, so it is a last resort, not a quick undo)
3. With authorization: `bash experiments/gb10_bench/frontier.sh gb10-qwen36-35b --concurrency 1,2,4`. A person approves the OnCall skill (printed command), then `--after-approval`. Then `frontier_report report`.
4. Re-check the demo still works (step 1). The harness does not change serving, but the GPU was loaded.

## (b) 120B-class: not run (needs the demo model taken down or a second machine)

- The only switch path we have is `scripts/switch_model.sh` → `nemoclaw onboard --profile <id>`, which **stops the managed vLLM and recreates the NemoClaw sandbox**. Only one model is resident; there is no hot standby. Expect minutes of downtime per switch plus a rollback.
- Memory: a 120B NVFP4 model is roughly 120e9 × ~0.56 bytes ≈ **60–75 GB of weights** (to be confirmed from the model card). The 35B runs at `--gpu-memory-utilization 0.4`, i.e. it reserves ≈ 0.4 × 128 GB ≈ 51 GB of the shared 128 GB LPDDR5x pool. 51 + 60–75 GB, before OS, containers, CUDA context and the 120B's own KV cache, does not leave a safe margin, and NemoClaw manages one vLLM anyway. **A 120B test means taking the demo model down.**
- Do it **only** if all of these hold: the demo is over (or a second machine is used); `nemoclaw profiles list` **on the GB10** lists a supported or experimental 120B-class profile (do **not** assume "Nemotron 3.5 Super VL" or any other name exists: **unverified**; nothing 120B is in `DEPLOY_MANIFEST.md` and nothing 120B is staged); the weights are staged or a named person authorizes the download.
- Then: `bash scripts/switch_model.sh <120b-profile> <35b-profile>` (rolls back automatically if the probe fails), `frontier.sh gb10-<model>-120b --concurrency 1,2`, and switch back with the recorded rollback command. Re-run Gate 2 afterwards.

## (c) 200B: feasibility assessment only (no test run)

- Arithmetic: NVFP4 ≈ 4 bits/weight plus block scales ≈ **~0.56 bytes/param** → 200e9 × 0.56 ≈ **112 GB of weights**. The GB10 has 128 GB unified memory shared by OS, Docker, the NemoClaw sandbox, the CUDA context/runtime and the KV cache. 128 − 112 = 16 GB for all of that is at best marginal, with little or no room for useful context. Treat as **unproven, likely impractical for agent workloads on one GB10**.
- NVIDIA markets DGX Spark as able to run models "up to 200B parameters". That is a **vendor claim to verify, not our measurement**, and its conditions (quantization, context length, batch size) are not stated in our sources.
- Evidence that would settle it: (1) a supported/experimental NemoClaw profile for a ~200B model on this hardware; (2) the model card's stated memory requirements; (3) a short authorized load test: model loads, `/v1/models` answers, `frontier.sh` at c=1 completes, with MemAvailable and temp from `samples.csv`.
- **No download happens without authorization.** A 200B checkpoint is >100 GB.

## (d) Comparison template

Generated by `frontier_report.py`; one row per (label, concurrency). Missing → "not measured" (JSON `null`).

| label | model | revision | quantization | runtime | hardware | context | concurrency | TTFT p50/p95 s | decode tok/s p50 | peak GPU mem MiB | min MemAvailable GiB | peak temp C | tool-call probe | OnCall INC-1 replay | OnCall INC-2 reuse dx | hidden | e2e ms | model calls first / reuse | reuse ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gb10-qwen36-35b | | | | | | | 1 | | | | | | | | | | | | |
| gb10-qwen36-35b | | | | | | | 2 | | | | | | | | | | | | |
| gb10-qwen36-35b | | | | | | | 4 | | | | | | | | | | | | |
| gb10-<120b, only per (b)> | | | | | | | 1 | | | | | | | | | | | | |

Each label gets "measured on `<host>` at `<time>`" under the table, from its `identity.json`.

- OnCall correctness: "INC-1 replay" is `verify()`'s check that the skill proposes `max_num_seqs` 1024 → 128; "INC-2 reuse dx" compares the reuse diagnosis with hand-written expected values from `fixtures/inc2_compatible.json` (`max_model_len` 131072 → 16384, deploy `d-5203`). If the endpoint failed and OnCall fell back to the hand-written reference skill (`RECORDED_SIMULATION`), every OnCall column is "not measured": the model did not write it.
- `nvidia-smi memory.used` may be `[N/A]` on unified memory; then "peak GPU mem" stays "not measured" and MemAvailable is the system view.

## (e) "Deterministic reuse avoided N model requests"

- **N = `synthesis.model_calls` of the first OnCall run**, measured on this run (chat requests actually sent, `LLM_RETRIES=0`). Reuse is measured at **0** model calls: the `NoModel` guard counts and refuses any model client use during reuse.
- That is a statement about **requests**, nothing else. It is **not** an end-to-end latency, energy or cost claim. A latency comparison needs the first run's `e2e ms` and the reuse `reuse ms` from the same label, and even then the two runs do different work (synthesis + verification vs a match + deterministic helper). An energy claim needs measured power over both windows (`samples.csv`; `power.draw` may be `[N/A]` on GB10) and a whole-system meter we do not have. Unmeasured → not claimed.
