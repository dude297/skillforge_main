# Verified execution: cost audit and optimization research (branch `research/exec-perf`)

**Status:**
- Research only.
- No core change. Nothing is merged.

**Measured where:** the dev box only (Windows 11, x86_64, 22 logical CPUs, Python 3.14.3; Docker Desktop on WSL2, 8 GB VM). **There are no GB10 numbers** in this document.

**Data:** synthetic freight batches from `experiments/perf/gen.py`, in integer cents. The ground truth is the generator's intent per record, fixed before any invoice text is written.

**Reproduce:**
```
python -m experiments.perf.harness [--docker] --out experiments/perf/results/<file>.json
python -m pytest -q -p no:cacheprovider experiments/perf/test_perf.py
```
Raw results are in `experiments/perf/results/devbox.json`.

## 1. Profiling audit: what already exists and what's missing

| stage | already measured | missing |
|---|---|---|
| routing | `router_events.route_ms`; `router_model_calls` = 0 by construction | — |
| model inference | `adapters/metrics.py` from vLLM `/metrics`: requests, prompt and generation tokens, TTFT, end-to-end; `bench` `model_calls` (null when unknown) | **no model on this host**, so nothing measured |
| tool dispatch | `tool_calls`: ms, SQL statements, response bytes, args hash per agent call | dispatch versus body split (measured here) |
| sandbox start | `bench()`: `cold_median_ms` per skill version | start versus copy versus compute split: inferred here from cold minus in-runner compute |
| skill runtime | runner `bench` (warm per call), `profile` (line events, duplicate calls, peak KB, bytes in and out) | — |
| verification | — | per-action time (measured here) |
| DB | SQL statement counts per tool call | load and commit times (measured here) |
| end to end | `bench` `automated_s` per trial | per-stage breakdown of one batch (measured here) |
| peak memory / energy | runner peak (tracemalloc) / — | process RSS; energy needs a GB10 power source |

## 2. Results (dev box; p50 ± MAD, with p95)

**Skill compute, warm, in-process** (15 runs, 3 at n=4400; byte-identical output, checked against the truth on every run):

| records | original (scalar) | indexed variant | speedup | rows/s (orig → variant) |
|---|---|---|---|---|
| 11 | 0.065 ± 0.004 ms (p95 0.076) | 0.044 ± 0.003 ms (p95 0.067) | ~1.5× (sub-0.1 ms: noise level) | 169k → 250k |
| 110 | 0.66 ± 0.03 (p95 1.10) | 0.39 ± 0.01 (p95 0.42) | 1.7× | 166k → 284k |
| 1,100 | 42.7 ± 2.0 (p95 54.6) | 4.7 ± 0.8 (p95 11.6) | 9.1× | 26k → 236k |
| 4,400 | 789 ± 16 (p95 805) | 25.7 ± 2.2 (p95 27.9) | 31× | 5.6k → 171k |

**Cause:** the original re-scans all evidence for every record, O(records × evidence). The variant builds one index (`skills/freight-indexed`, a 6-line diff). Peak traced memory is the same (1.25 MB at 1,100).

**The isolated runner, cold** (one fresh process or container per run, as in production):

| runner | records | original | variant | compute inside the runner |
|---|---|---|---|---|
| subprocess | 11 | 129 ± 1 ms | 156 ± 17 | 0.2 ms |
| subprocess | 110 | 133 ± 12 | 203 ± 42 | 1.0 / 0.7 ms |
| subprocess | 1,100 | 206 ± 6 | 158 ± 5 | 49 / 8 ms |
| **Docker** (`--network none`, 512 MB, …) | 110 | **3,555 ± 32** | **4,146 ± 10** | 43 / 32 ms |

**Reading the runner table:**
- Below about 1,000 records, process start, the copy and JSON (about 130 ms) dominate, and the variants are within noise. A 50–70 ms spread between them at 11 and 110 rows is noise, not a regression.
- In the Docker runner, container start costs about 3.5–4 s per run on this machine and swamps the skill entirely.

**One batch through the agent tool boundary** (`run_skill` propose → person approves → execute → verify), in ms:

| records / actions | load | exact match | run_skill (of which runner) | approve | execute | verify | total excl. the person |
|---|---|---|---|---|---|---|---|
| 110 / 20 | 18 | 4 | 177 (139) | 9 | 18 | 37 | **255** |
| 1,100 / 200 | 45 | 41 | 423 (193) | 50 | 114 | 304 | **927** |

**Other measurements:**

| measure | result |
|---|---|
| `tools.call` dispatch, including the audit row | 0.29 ms p50 vs 0.06 ms bare: about 0.23 ms per call |
| verification | about 1.5 ms per action (reads the record, reads `pins.json` and hashes the verifier on every call) |
| model inference | **not measured (null)** |
| model calls on this path | none by construction: no model client on the `run_skill` → approve → execute → verify path |

**Correctness on every measured run:**
- Every proposal and refusal matches the generator's truth.
- Both variants' outputs are byte-identical.
- The approval boundary held: execute before approval gave `not_approved`.
- Redelivery added no actions.
- All verifications passed.
- Final DB values equal the truth in cents.

## 3. Optimization mechanism: reuse the existing one, which has two defects

The core already has the smallest safe mechanism (`propose_skill(optimizes=<v>)`):
- The original must have runtime profile evidence of waste.
- Exactly one revision is allowed, and it can't itself be optimized.
- It goes through lint, its own tests and an exact replay.
- Both versions are benchmarked on identical inputs.
- To be kept, it needs ≥20% work reduction AND ≥10% warm speedup, AND correctness at every size.
- After that come the hidden suite and a named person's approval.
- Each version is hash-pinned, and the original stays approved for rollback.

**No new mechanism is proposed.**

Running the indexed variant through it, unchanged, gave **"not retained: correctness changed"**. That verdict is false:

1. **Scaled benchmark inputs are invalid for this domain.** `_scaled()` copies records under new ids (`PO-7731~1`), but each invoice header still names `PO-7731`. Both the approved original and the variant therefore correctly refuse the copies, and both score `correct=0` at 8× and 32×. The verdict blames the variant. The failure is safe (nothing is promoted) but mislabelled, and it blocks every domain skill whose evidence references its own record id.
2. **The superlinear detector missed the quadratic.** On the tiny learning set (2 records), 8× the data cost 13.2× the work, under the 16× threshold. The recommendation came only from a side signal: 49 repeated `_cents` calls.

**Proposed fixes (core, NOT applied; for review):**
- (a) `_verdict` declares a size **inconclusive** when the parent itself fails it, rather than "correctness changed".
- (b) `bench()` accepts an independent, domain-valid input set for a skill (for example from a generator like `gen.py`) instead of `_scaled()`, with expected outputs from a source that shares no code with the skill.
- (c) Profile growth at sizes where the per-record constant cost no longer dominates.

**Until those are reviewed:** the only path is a **manual, explicitly approved experiment**. Take the evidence in §2 and `test_perf.py` (byte-identical output, the generator's truth, the pinned business verifier in integer cents, own tests, the hidden suite 12 of 12 in the isolated runner), and let a person decide. A benchmark is never treated as proof of correctness.

Generated native binaries are never executed. Variants are source-level Python in the same runner.

## 4. Conclusion of the optimization question

| question | answer from the data |
|---|---|
| Is there a real optimization? | **Yes, algorithmic and on the CPU**: 9× at 1,100 rows, 31× at 4,400, with identical output. |
| Does it matter end to end today? | Only for batches of **≥ about 1,000 records** (subprocess runner: 206 → 158 ms at 1,100). Below that, fixed costs dominate. In the Docker runner it is invisible next to container start on this machine. |
| Biggest fixed cost observed | **Docker container start per skill run** (about 3.5 s here; GB10 unknown). Making that cheaper by reusing containers would weaken per-run isolation, so it is **not proposed**. Measure on the GB10 first. |
| Second | verification at about 1.5 ms per action (verifier re-hashed on every call); about 0.3 s per 200 actions. Small; leave it. |
| GPU? | **Not justified by this workload.** It is text parsing plus a few integer sums, about 26 ms for 4,400 rows on one CPU core after the fix, dominated by process and container start. A GPU kernel would add transfer and launch costs to a millisecond job. **Stop here.** The GPU work below is a plan with stop criteria, not a recommendation. |

## 5. GB10 plan: hardware-dependent and approval-gated

**No driver installs, container downloads, kernel builds or vLLM config changes without approval.**

1. **Baseline first:** run `python -m experiments.perf.harness --docker` on the GB10 (arm64, native Docker). It answers how long container start takes there.
2. **CUDA SM121 support:**
   - `nvidia-smi --query-gpu=name,compute_cap,driver_version --format=csv`
   - `nvcc --version`, if present (don't install it)
   - record whether the preinstalled vLLM image runs; NemoClaw's own `validation.level: hardware` is the evidence
3. **Profilers:** check for `nsys` and `ncu` with `which nsys ncu`. Use them only if present; installing needs approval.
4. **vLLM:** from `/metrics`, record TTFT, end-to-end latency, prompt and generation tokens per agent turn, and the number of model calls per task (bench modes A and C, Gate 5). Read, don't change, `--compilation-config` and CUDA Graph settings via `nemoclaw inference get --json` and the container args.
5. **Deterministic CPU path on the GB10:** the harness on the Grace cores (n = 110, 1,100, 4,400, and 44,000 only if memory allows), cold and warm.
6. **cuDF (only if approved and already available):**
   - Run a parse-and-sum equivalent on the same generated data at 10⁵–10⁶ rows.
   - Compare against the indexed CPU variant, including host↔device transfer and process start.
   - **Stop if** the GPU path isn't at least 2× faster end to end at a batch size a customer actually has, or if any output differs from the truth.
7. **Triton/CUDA kernel:** only if steps 5–6 show a GPU-suitable, profiled bottleneck that cuDF can't serve. **Not expected for this workload.**

## 6. Quantitative evaluation design (for the GB10 run)

**Per (workload size, variant, runner):**
- correctness against the truth: must be 100%
- verifier pass rate
- p50 / p95 / MAD over ≥15 warm runs and ≥5 cold runs
- rows/s
- model calls and input/output tokens (null if unknown)
- peak memory (tracemalloc plus `/usr/bin/time -v` max RSS)
- cold-start overhead (cold minus in-runner compute)
- energy only from a real power source (`nvidia-smi --query-gpu=power.draw`, a wall meter): otherwise null

**Variability:** report the MAD, and bootstrap a 95% CI of the median when there are at least 15 runs.

**Break-even** of reuse against the agent path: the batch size where `skill_cold + approve + execute + verify < agent turns × measured model latency`. Computed only from measured Gate 5 numbers.

**A variant fails, and rolls back with `skill rollback`, if any of these hold:**
- any output differs
- a refusal class changes
- the verifier fails
- p50 regresses beyond the MAD at a customer-relevant size

**Never quote** theoretical GPU FLOPS as throughput.

## 7. Judge-facing explanation (only what is true)

1. **Not just tool calling.** A skill is code that must reproduce exactly the fixes a person approved and the verifier confirmed. It must pass a hidden suite it never saw, and a named person promotes it. Even then it only proposes; approval and independent verification still apply.
2. **Exact compatibility matters** because "looks similar" data is where automation silently goes wrong. A different signature means no skill runs, and the work escalates.
3. **Deterministic reuse removes model calls on that path** by construction: there is no model client in it. How much latency that saves against the agent is measured only at Gate 5.
4. **Profiling prevents misleading claims.** Here, a 31× speedup in the skill is real but becomes about 1.3× end to end at 1,100 rows and invisible behind container start. We report that rather than the 31×.
5. **Optimized variants:** the system can keep a faster version of a skill only when its output is identical, its tests pass and a person approves it. We found the existing gate mislabels one class of skills, and proposed a fix.
6. **GPU is workload-dependent.** This workload is too small and too text-bound; we stopped. The plan says what would justify a GPU.
7. **Verified versus experimental:** see §8.

## 8. Not verified (do not claim)

- Any GB10, arm64-native, GPU, vLLM latency, token or energy number.
- That deterministic reuse is faster end to end than the agent. Plausible, unmeasured.
- Docker container start on the GB10. The 3.5 s here is Docker Desktop on Windows.
- That the indexed variant is a promoted skill. It is not: the core verdict rejected it for the reason in §3, and no person approved it.
- cuDF or GPU benefit for any SkillForge workload.
- Customer batch sizes. The about-1,000-record threshold is where the effect appears, not evidence that customers have such batches.

## 9. Recommended next hardware experiment

On the GB10 after Gate 0:
1. `python -m experiments.perf.harness --docker --out results/perf_gb10.json` (minutes, no model, no download).
2. Then compare container-start cost and the CPU compute curve with this file.
3. Only if Gate 5 runs, add the measured model latency to compute the real break-even.
