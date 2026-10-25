# GB10 benchmark runbook: hardware-aware execution readiness (branch `research/gb10-bench`)

**Status:** research and docs only. Nothing here was run on the GB10. No core change (`app/`, `adapters/` untouched). Nothing is merged, pushed or deployed.

**Rules that apply to every row below:**
- Each result file carries a `label`: `GB10`, `DEV BOX` or `FAKE SERVER`. Only `GB10` rows are hardware evidence.
- Unknown stays `null`, never `0`. A failed probe is recorded with its error and adds no number.
- Rows marked **AUTHORIZATION REQUIRED** run GPU inference or touch model serving. Run them only after a named operator says yes, and record that person's name in the result's `label` (for example `GB10 qwen36, authorized by <name>`).
- Don't install profilers (`nsys`, `ncu`), drivers or packages. Don't change vLLM, NemoClaw, Docker or host settings, and don't drop caches. Every command here only reads.
- Isolation stays as it is: the Docker runner flags (`--network none --read-only --memory 512m --memory-swap 512m --cpus 1 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges --user 65534:65534`), `host-tools.yaml`, no `0.0.0.0` bind, and the agent tool allowlist. No container reuse.
- Raw outputs go to `results/gb10_bench/` on the box. Copy the files; don't paraphrase them.

## 0. What already exists (audit)

| area | existing harness or probe | gives | gap this runbook fills |
|---|---|---|---|
| skill CPU compute | `experiments/perf/harness.py` `compute` (research/exec-perf) | warm in-process p50/p95/MAD, rows/s, tracemalloc peak; first call discarded | GB10 run; label (now `BENCH_LABEL` env, defaults to `dev box, NOT the GB10`) |
| runner, cold | harness `runner` (subprocess, 5 trials) and `--docker` (3 trials, n=110) | cold wall time per isolated run, in-runner compute, runner peak KB | bare container-start floor; more Docker samples |
| core path | harness `core_path`, `dispatch` | per-stage ms: load, match, run_skill, approve, execute, verify | none |
| inference, server side | `adapters/metrics.py` (vLLM `/metrics`: requests, tokens, TTFT and e2e sums and counts, KV cache) read by `task_end` and `bench` | per-task mean TTFT, inference seconds, tokens; `null` when `/metrics` is unreachable | client-side TTFT and decode tokens/s per request |
| inference, client side | `python -m app check-llm` (`elapsed_s`), `bakeoff` (`seconds` per probe) | non-streaming wall time | no streaming TTFT anywhere → `experiments/gb10_bench/ttft.py` (new) |
| GPU memory | `metrics.gpu_memory_used_mib()` (nvidia-smi `memory.used`) | `null` if absent or `[N/A]` | unified-memory reading via `/proc/meminfo` |
| power | `experiments/router/power.py` on `exp/router`: `gpu_power_w()` (nvidia-smi `power.draw`), `/is_sleeping` GET only | instantaneous watts or `null` | sampling over a workload; energy |
| reliability | `app/soak.py`, `app/bench.py` (MOCK unless `--agent openclaw`) | plumbing invariants | not performance |
| frozen results | `experiments/perf/results/devbox.json` (label `dev box, NOT the GB10`) | the only measured baseline | — |

**The optimized freight variant** is `experiments/perf/skills/freight-indexed` (research/exec-perf). It is a human-written, evidence-indexed copy of `freight-invoice-reconcile` from `exp/enterprise`. The core verdict was "not retained: correctness changed" (mislabelled; see `docs/EXEC_PERF.md` §3), and no person approved it. **It stays unpromoted.** Here it is only a measurement subject, and nothing in this runbook changes its status.

## 1. Measurement matrix (GB10)

Availability: **yes** = stock OS, existing harness, or already staged; **unknown-until-native** = depends on what the Dell GB10 build exposes.

| # | metric | exact command on the GB10 | available without installing | samples / warm-up | units | unknown → | auth |
|---|---|---|---|---|---|---|---|
| M1 | CPU skill execution (warm, in-process) | `BENCH_LABEL="GB10 Grace CPU" python3 -m experiments.perf.harness --out results/gb10_bench/perf_cpu.json` | yes (stdlib; repo already on box) | 15 per size (3 at 4,400), 1 discarded; sizes 11/110/1,100/4,400 | ms p50/p95/MAD, rows/s, peak KB | — (always measurable) | none |
| M1b | CPU, per core class | `lscpu -e` (use the MAXMHZ column to find big vs little cores), then `taskset -c <big> python3 -m experiments.perf.harness --sizes 1100 --runner-sizes 11 --core-sizes 110 --out results/gb10_bench/perf_core_<cls>.json` with `BENCH_LABEL` set | yes (`taskset` from util-linux) | as M1, ×2 runs per class | ms | — | none |
| M2 | Docker runner, cold per run (production path) | `BENCH_LABEL="GB10 docker" python3 -m experiments.perf.harness --docker --out results/gb10_bench/perf_docker.json` (rows `runner_cold_docker`) | yes once the staged arm64 runner image is loaded (`offline.sh restore`; 43.5 MB, already staged) | 3 per variant at n=110 (fixed in harness); run twice | ms p50/MAD; in-runner compute ms | — | none |
| M2b | Docker start floor, first vs steady state | `img=python:3.12-slim; for i in $(seq 12); do s=$(date +%s%N); docker run --rm --network none --read-only --memory 512m --memory-swap 512m --cpus 1 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 "$img" python -c pass; echo $(( ($(date +%s%N)-s)/1000000 )); done \| tee results/gb10_bench/docker_floor.txt` | yes | 12; run 1 = "first" (reported alone, n=1), runs 1–2 discarded, 3–12 = "steady" | ms | first-after-boot is not forced (that would need dropping caches): record `cold_after_boot: null` unless it was truly the first run since boot | none |
| M3 | TTFT, client side (streaming) | `export LLM_API_KEY=$(cat ~/.nemoclaw/dual-station-vllm-api-key); python3 -m experiments.gb10_bench.ttft --base-url http://127.0.0.1:8000/v1 --n 10 --warmup 2 --label "GB10 <model>, authorized by <name>" --out results/gb10_bench/ttft.json` | yes (stdlib), if a model is served | 10, 2 discarded; `--max-tokens 128` | s (`first_token_s`, `first_byte_s`) p50/p95/MAD | `null` if no content or reasoning chunk arrives; the error is recorded | **AUTHORIZATION REQUIRED** |
| M3b | TTFT, server side | `curl -s http://127.0.0.1:8000/metrics \| grep -E '^vllm:(time_to_first_token_seconds\|e2e_request_latency_seconds\|inter_token_latency_seconds\|time_per_output_token_seconds)_(sum\|count)'` before and after M3 or Gate 5; the delta of sum/count is the mean | yes, if `/metrics` is reachable (Gate 1 check) | 1 delta per workload | s (mean only; histogram buckets give coarse p50/p95) | metric name absent → `null` (`adapters/metrics.py` behaviour) | read-only scrape: none. The workload it brackets: **AUTHORIZATION REQUIRED** |
| M4 | total generation time of one request (model inference only; NOT task end-to-end, see `docs/EVIDENCE_PROTOCOL.md` section 1) | M3 `e2e_s`; `/metrics` `vllm:e2e_request_latency_seconds`. Task end-to-end (agent turns + tools + verification, minus human wait) is separate: Gate 5 `bench` `median_s`/`first_s` (`automated_s`) | yes | as M3; Gate 5: 3 trials per case/mode, first = cold | s | `null` | **AUTHORIZATION REQUIRED** |
| M5 | token throughput | M3 `decode_tok_s` = (completion_tokens − 1) / (e2e − TTFT), from `stream_options.include_usage`; aggregate = Δ`vllm:generation_tokens_total` / wall s | yes | as M3 | tok/s | server sends no usage → `null` (never estimated from chunk counts) | **AUTHORIZATION REQUIRED** |
| M6 | host RAM | `grep -E '^(MemTotal\|MemAvailable\|Cached\|SwapTotal\|SwapFree):' /proc/meminfo; free -m` | yes | 3 snapshots each: idle (no model), model loaded, during Gate 5 | kB / MiB | — | none |
| M7 | GB10 unified memory | `/proc/meminfo` (CPU and GPU share one LPDDR5x pool, so this is the system view); `nvidia-smi --query-gpu=memory.used,memory.total --format=csv`; `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv`; vLLM PID `VmRSS`/`VmHWM` from `/proc/<pid>/status` | `/proc`: yes. nvidia-smi memory fields: **unknown-until-native** (may print `[N/A]` / `Not Supported` on unified memory) | as M6 | MiB | `[N/A]`, `Not Supported`, or a missing field → `null`. Don't substitute RSS for GPU allocations: CUDA allocations may not show in RSS | none (reads only) |
| M8 | container RSS | long-lived (vLLM, sandbox, gateway): `docker stats --no-stream --format '{{.Name}},{{.MemUsage}},{{.CPUPerc}}'`. Runner containers: `runner_peak_kb` from the harness (in-runner tracemalloc, Python heap only) | yes | 3 snapshots; runner: per harness row | MiB / KB | runner container RSS: `null`. It lives under a second, so `docker stats` can't sample it reliably. The 512 MB cap is the bound. | none |
| M9 | model availability | `curl -sf -H "Authorization: Bearer $LLM_API_KEY" http://127.0.0.1:8000/v1/models`; `nemoclaw inference get --json` (read only); `docker ps --format '{{.Names}} {{.Image}} {{.Status}}'` | yes (Gate 1 checks the first) | 1 | model id, `max_model_len` | not served → `available: false`; can't tell → `null` | none (no inference) |
| M9b | model load and warm-up | load: `docker inspect -f '{{.State.StartedAt}}' <vllm-container>` plus the first `Application startup complete` / `Uvicorn running` line in `docker logs <vllm-container>`. Warm-up: `python3 -m app check-llm` ×4; run 1 = cold `elapsed_s`, runs 2–4 = warm | logs: yes. check-llm: yes | load: 1 per container start. check-llm: 4, the first reported separately | s | log line absent → `load_s: null` | logs: none. check-llm: **AUTHORIZATION REQUIRED** (Gate 1 already includes it) |
| M10 | power / energy | `nvidia-smi --query-gpu=timestamp,power.draw,power.limit,utilization.gpu,clocks.sm,temperature.gpu --format=csv -lms 500 > results/gb10_bench/power.csv &` around a workload, then `kill %1`. Also `ls /sys/class/hwmon/*/name /sys/class/powercap 2>/dev/null` (list only). `python3 -m experiments.router.power` on `exp/router` for a single read. | **unknown-until-native**: `power.draw` may be `[N/A]` on GB10; RAPL powercap is x86 and is probably absent on Grace. Whole-system wall power needs a meter (none) | 60 s idle baseline, then every 500 ms through the workload | W; energy J = Σ W·Δt over the window, minus idle × duration | `[N/A]` → `null`; no system meter → `system_energy_j: null`. Never quote TDP or FLOPS instead | sampling: none. The GPU workload it brackets: **AUTHORIZATION REQUIRED** |
| M11 | GPU identity and support | `nvidia-smi --query-gpu=name,compute_cap,driver_version --format=csv`; `which nsys ncu nvcc` (report presence only) | yes (Gate 0 needs nvidia-smi) | 1 | — | field `[N/A]` → `null` | none |

**Order on the day** (each step only after its gate is GO): M11, M6, M9 → M1, M1b, M2, M2b (no model needed, Gate 0) → *authorization* → M9b, M3/M3b/M4/M5 with M10 sampling and M7/M8 snapshots running alongside → Gate 5 `bench` (M4 plus `model_calls`).

## 2. Authorization summary

| needs a named operator's yes (GPU inference or model serving) | read-only, no authorization beyond the gate it sits in |
|---|---|
| M3 streaming TTFT probe; M4 e2e generation; M5 throughput; M9b `check-llm` warm-up; the workloads M3b and M10 bracket; Gate 5 `bench --agent openclaw`; any model bake-off or profile switch (re-onboards and may rebuild the sandbox); anything `cuDF` | M1, M1b, M2, M2b (CPU and Docker runner, staged 43.5 MB image); M6, M7, M8 snapshots; M9 `/v1/models` and `docker logs`; M10 idle sampling; M11 identity |
| **Never, even with authorization, in this track:** installing profilers or drivers, changing `--gpu-memory-utilization`, `--max-num-seqs`, compilation or CUDA Graph flags, enabling sleep mode, dropping caches, pulling multi-GB images or weights | — |

## 3. Optimization hypotheses (measurable; config-level or measurement-only)

Shared stop rule: **stop at once on any verifier failure, output difference against the generator truth, refusal-class change, or isolation regression** (a Docker test failing, a flag changed, a bind on `0.0.0.0`).

| # | hypothesis | metric | baseline source | success threshold | stop rule | what a "yes" leads to |
|---|---|---|---|---|---|---|
| H1 | Container start dominates every Docker skill run on the GB10, as on the dev box | (`runner_cold_docker` p50 − `in_runner_compute_ms`) / p50; M2b steady floor | dev box 3,555 ms vs 43 ms compute (`devbox.json`) | ratio ≥ 0.8 = confirmed | one M2 run + one M2b run; no tuning follows | Report it. Container reuse is **not proposed** (it weakens per-run isolation). |
| H2 | Native arm64 Docker starts the runner at least 50% faster than Docker Desktop/WSL2 | M2b steady p50 | dev box Docker row above (inferred floor about 3.5 s) | ≥ 50% lower | 2 runs of M2b; if the MAD overlaps the dev box number, call it "no difference" | Updates the break-even in EXEC_PERF §6 only |
| H3 | The indexed variant cuts cold subprocess-runner time ≥ 20% at ≥ 1,100 records on Grace | `runner_cold_subprocess` p50 at 1,100 (scalar vs indexed) | dev box 206 → 158 ms | ≥ 20% | stop if < 10% after 2 harness runs | Evidence for the **proposed core fixes in EXEC_PERF §3** only. The variant **stays unpromoted**; no promotion is recommended. |
| H4 | Core class matters: an unpinned `--cpus 1` runner adds variance on Grace's mixed cores | M1b p50 and MAD/p50 at 1,100, big vs little | none (new) | big-core p50 ≥ 20% faster, or MAD/p50 > 20% unpinned | 2 runs per class; stop if the difference is < 10% | Record as a variance source. `--cpuset-cpus` would be a core change: post-event review only |
| H5 | Model warm-up is real: the first request after load is ≥ 2× a warm one | M9b cold vs warm-p50 `elapsed_s`; M3 discarded warm-ups vs measured | none on hardware | cold ≥ 2× warm | 1 load cycle; don't restart the model just to measure this | Keep the runbook warm-up step and keep reporting `first_s` separately (both already exist) |
| H6 | Decode, not prefill, dominates e2e for agent turns | decode share = (e2e − TTFT) / e2e from M3, and M3b `time_to_first_token` vs `e2e` sums during Gate 5 | none | share ≥ 0.8 → the output length is the only lever | measurement only | If confirmed, the post-event candidate is shorter outputs (prompt-level). No serving-flag change. |
| H7 | Prefix caching already serves the repeated agent system prompt and tool schemas | Δ`vllm:prefix_cache_hits_total` / Δ`vllm:prefix_cache_queries_total` during Gate 5 (if the metrics exist); TTFT of turn 1 vs later turns | none | hit rate ≥ 50% | read-only; metric absent → `null` and stop | If low, a **post-event** config question for the model owner (needs authorization to change) |
| H8 | Concurrency settings don't matter for the single-operator demo | max `vllm:num_requests_running` sampled every 1 s through Gate 5 | serve flag `--max-num-seqs 4` (DEPLOY_MANIFEST) | max ≤ 1 → irrelevant | read-only | Leave `--max-num-seqs` alone |
| H9 | Model choice: the other profile lowers Gate 5 agent latency ≥ 20% at equal correctness | Gate 5 `median_s`, `correct`, `structured_output_ok`, TTFT p50 | the first profile's Gate 5 `result.json` | ≥ 20% lower `median_s` and no correctness loss | **AUTHORIZATION REQUIRED**; time-box 90 min (GB10_RUNBOOK); stop on any correctness or parser regression | Pick a profile (runbook "Optional after Gate 5 GO") |

Deliberately not listed: GPU kernels, cuDF ports and container pooling. EXEC_PERF §4 shows the skill workload is milliseconds of text parsing dominated by process and container start; its §5 step 6 keeps cuDF as a post-event, approval-gated item with a 2× end-to-end stop rule.

## 4. Advisory CPU-vs-GPU execution record (design only)

Not implemented. Nothing reads this record to decide where work runs. No scheduler, no native kernels.

```json
{
  "schema": "exec_advisory/v1",
  "advisory": true,
  "auto_applied": false,
  "created_at": "YYYY-MM-DDTHH:MM:SSZ",
  "host": {"label": "GB10", "machine": "aarch64"},
  "task_kind": "skill_run",
  "subject": "freight-invoice-reconcile@v1",
  "records": 1100,
  "measured": {"runner": "docker", "cpu_ms_p50": null, "cpu_ms_mad": null, "n": 0, "gpu_ms_p50": null},
  "gpu": {"present": null, "name": null, "compute_cap": null, "free_for_tasks": null,
          "note": "the GPU is shared with model serving; no authorized GPU path for skills exists"},
  "recommendation": "insufficient_evidence",
  "reason": "no GB10 CPU measurement yet",
  "evidence": ["results/gb10_bench/perf_docker.json#rows[stage=runner_cold_docker]", "docs/EXEC_PERF.md#4"],
  "rule": {"gpu_requires_measured_gpu_ms": true, "gpu_min_e2e_speedup": 2.0, "min_samples": 5, "identical_output_required": true}
}
```

| field | rule |
|---|---|
| `task_kind` | `skill_run`, `agent_turn` or `batch_transform` |
| `recommendation` | `cpu` · `gpu_candidate` · `insufficient_evidence`. `gpu_candidate` only when `gpu_ms_p50` was **measured** (never derived from FLOPS), is ≥ `gpu_min_e2e_speedup` faster end to end including transfer and start, has ≥ `min_samples`, and produced byte-identical output. Otherwise `cpu` when CPU is measured, else `insufficient_evidence`. |
| unknowns | `null`, never 0; `n: 0` with `null` stats means "not measured" |
| `evidence` | paths into raw result files; a record without evidence is invalid |
| `advisory` / `auto_applied` | always `true` / `false`; a consumer that sees anything else must ignore the record |

**Where it would be displayed (later):** as a read-only `execution_advisories` list in `python -m app status` output (`ops.status`) and a read-only panel in the operator console (`python -m app ui`), next to the inference check. No approve or apply button. For now: the JSON file sits in `results/gb10_bench/` and is shown with `cat`; core stays frozen.

## 5. First GB10 session vs later

| item | first GB10 session | later |
|---|---|---|
| M1, M1b, M2, M2b, M6–M8, M9, M11, idle M10 | yes, after Gate 0 (minutes, no model) | repeat on new builds |
| M3–M5, M9b, loaded M10 | only with a named operator's authorization, after Gate 1 | wider prompt lengths and concurrency sweeps |
| Gate 5 `bench --agent openclaw` | per GB10_RUNBOOK (already authorization-gated) | more trials |
| H1–H8 | read and record | act on confirmed ones via review |
| H9 bake-off | optional, authorized, 90-min time-box | full comparison |
| advisory record | hand-written JSON file at most | read-only `status` field and console panel (core change, needs review) |
| EXEC_PERF §3 core fixes (`_verdict` inconclusive, domain-valid bench inputs) | no (core frozen) | review |
| `--cpuset-cpus`, prefix-cache or serving-flag changes | no | only with authorization and evidence from H4, H7 |
| cuDF, Triton, CUDA kernels, profiler installs | no | only per EXEC_PERF §5 with approval and stop rules |
| promoting `freight-indexed` | **no** | not recommended here either |

## 6. Limitations

- Every number in the repo is DEV BOX (Windows, x86_64, Docker Desktop on WSL2). There are no GB10 numbers anywhere.
- `ttft.py` has only been run against a fake local server (`experiments/gb10_bench/test_ttft.py`). That checks the plumbing, not a measurement. Its client TTFT includes HTTP and Python overhead, and with reasoning models "first token" means the first reasoning chunk.
- `decode_tok_s` needs `stream_options.include_usage`. If the served vLLM build ignores it, throughput stays `null`; use the `/metrics` aggregate instead.
- `/metrics` names vary across vLLM versions (`inter_token_latency_seconds` vs `time_per_output_token_seconds`, `kv_cache_usage_perc`, `prefix_cache_*`). A name that's absent yields `null`. Histograms give only a mean and coarse quantiles.
- Unified memory: there is no clean split between CPU and GPU use. nvidia-smi memory and power fields may be `[N/A]` on GB10; this is unknown until run natively.
- Runner container RSS isn't sampled (the containers are too short-lived). `runner_peak_kb` is Python heap only.
- Harness Docker samples are small (n=3 at one size). M2b adds a floor but no skill work.
- "Cold" never means "after dropping the page cache": that would be a host-setting change.
- Energy covers the GPU only, if at all. Whole-system energy needs a wall meter, so it is `null`.
- Model load time comes from container logs, so it is approximate to the second.
