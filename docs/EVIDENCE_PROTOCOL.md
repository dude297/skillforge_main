# Evidence protocol: first-time LLM execution vs deterministic reuse (GB10)

For the Dell operator. Status: **nothing here has been run on a GB10.** The report generator was tested only on synthetic fixtures (`experiments/gb10_bench/fixtures/synthetic_*`, which it rejects on purpose). Unknown stays "not measured", never 0. GPU inference needs a named operator's authorization (`docs/GB10_BENCH_RUNBOOK.md` section 2); put that name in the run label or your notes.

## 1. Definitions (use these words, and only these, in the pitch)

| term | what it is | clock starts / stops | where it is recorded | NOT included |
|---|---|---|---|---|
| **Model inference latency** | time the served model spends on a request. Three parts: **TTFT** (request sent to first content or reasoning chunk, client side), **decode tok/s** = (completion_tokens - 1) / (e2e - TTFT), **total generation time** (`e2e_s`, request to last chunk) | per request, in `ttft.py` | `ttft-c<C>-<i>.json` `trials[]`; server side `/metrics` (runbook M3b) | tests, skill execution, human time |
| **Validation latency** | time the host spends checking a candidate skill: lint, the skill's own tests, INC-1 replay, capacity check, hidden suite. Tests, no model | `synthesized` to `verified` audit events | `oncall-run.json` `audit[].t` (**1 s resolution**, derived by the report); not stored as its own field | model time, approval |
| **Deterministic reuse latency** | match + `run_skill` of an approved, pinned skill on a compatible incident. **No LLM**; the `NoModel` guard counts any attempt and `model_calls` must be 0 | `perf_counter` around `_decide` + `run_skill` in `oncall.reuse` | `oncall-run.json` `reuse.latency_ms`, `reuse.model_calls` | hidden-suite validation, human approval, applying the change (the skill only proposes) |
| **End-to-end response time** | what a person waits for one task. Must be stated per path: first-time = incident loaded to candidate staged at `pending_approval` (model + validation, **excluding human wait**); reuse = the reuse latency above | audit `incident_loaded` to `pending_approval` | derived by the report from `audit[].t` | the person's reading and approval time (unbounded; never averaged in) |

Rules: never write "latency" without one of these four prefixes. TTFT, decode tok/s and `e2e_s` describe the model, not the task. A "speed-up" must name both endpoints, e.g. "first-time automated end-to-end s versus reuse latency ms", and say what each leaves out.

### Where the existing code or docs blur these (found in the audit; core is frozen, so only reported)

1. `oncall.py` `synthesize_live` times `synthesis.latency_ms` over the whole attempt loop: model requests **plus** in-loop `sf.lint` and the skill's own sandboxed tests. The field reads like model latency, and `frontier_report.py` publishes it as `e2e_latency_ms` ("e2e ms"). It is model + validation of the first attempt(s), not inference, and it excludes the hidden suite. The report here labels it that way.
2. `reuse.latency_ms` (match + `run_skill`) must not be quoted as a speed-up over `synthesis.latency_ms` (the pitch and Q&A now say so explicitly). The two measure different scopes: reuse leaves out hidden-suite validation and approval; synthesis leaves out the hidden suite too, but includes model time. A ratio of the two is only meaningful with that caveat spelled out (the report prints it).
3. `reuse.latency_ms` includes `sf.run_skill`, which starts the sandbox (a child process, or a throwaway Docker container with `SKILL_RUNNER=docker`). On the dev box the Docker start dominated skill runs (`docs/EXEC_PERF.md`: 3,555 ms vs 43 ms compute). So "deterministic reuse is fast" depends on the runner; state `SKILL_RUNNER`.
4. `docs/GB10_BENCH_RUNBOOK.md` M4 called `ttft.py`'s `e2e_s` "end-to-end generation time" and in the same row the Gate 5 `median_s`. These differ (one request vs one agent task with tools, verification and approvals). Fixed in the runbook: M4 now says "total generation time (one request)" and points Gate 5 `automated_s` at the end-to-end definition above.
5. `app/bench.py` `automated_s` is end-to-end (match, skill exec, execute, verify, agent turns) minus human approval seconds. It is **not** inference latency; its `model_calls` come from `task_end`. Mode A with `MockAgent` has `model_calls: None` and is plumbing only.
6. `ttft.py` TTFT counts the first reasoning chunk as the first token (`reasoning_content`/`reasoning`). For a reasoning model that is time to start thinking, not time to the first answer token.
7. `frontier.sh` runs the ttft stage (with 2 warm-up requests) **before** the OnCall stage, so the OnCall first-time run hits a **warm** model. No cold-model number comes out of this protocol unless the model was just loaded (section 3).
8. `samples.csv` spans the entire `frontier.sh` run; peaks are not per stage. `memory.used` is often blank on unified memory.
9. Tokens on the OnCall run are totals over all attempts, and null when the server returned no `usage`.

## 2. What the report needs (and where it comes from)

One result dir per run, `results/frontier/<label>/`, written by `frontier.sh`:

| file | by | feeds |
|---|---|---|
| `identity.json` | `frontier_report identity` | model identity, host/GPU proof, MemTotal |
| `ttft-c<C>-<i>.json` | `ttft.py` | TTFT, decode tok/s, request error rate |
| `samples.csv`, `stages.tsv`, `probe.json` | sampler, guards, `models.probe` | GPU/unified memory, temperature, stage and probe errors |
| `oncall-run.json` | `oncall_infer run --live`, then `reuse` | first-time model calls, synthesis wall ms, tokens, hidden results, approval, first reuse |
| `reuse-trials/reuse-<k>.json` | section 3 step 6 | N repeat reuse latencies |

The report rejects (exit 2) any dir whose `identity.json` GPU name does not contain `GB10`, whose name or files are marked mock/fixture/synthetic, or whose OnCall `mode` is not `LIVE_REAL_MODEL`. `--allow-mock` renders it under a MOCK banner for debugging only.

## 3. Procedure

Repo root on the GB10, after `docs/GB10_RUNBOOK.md` Gates 0 to 2 are GO and the operator has authorized GPU inference. K = 3 runs (3 labels), N = 10 reuse trials each.

```bash
# 0. Context. Write the authorizer's name and the runner into your notes.
export SKILL_RUNNER=docker            # or leave unset for the child-process sandbox; REPORT WHICH
python3 -m app check-llm              # one warm-up chat; confirms the served id

# 1. Per run k in 1..3: measure the served model, then OnCall first-time synthesis (STOPS for a person).
L=gb10-run1                           # then gb10-run2, gb10-run3
bash experiments/gb10_bench/frontier.sh $L --concurrency 1,2,4

# 2. A PERSON reads results/frontier/$L/oncall-run.json (code, hidden tests), then types the approve command that
#    frontier.sh printed (python -m app skill approve ... --by "<Full Name>"). Never an agent, never a script.

# 3. Reuse, first call after approval (writes reuse into oncall-run.json; model_calls must be 0).
bash experiments/gb10_bench/frontier.sh $L --after-approval

# 4. N repeat reuse trials. Trial 1 of the loop is warm for the OS cache but still a fresh process;
#    the first reuse after approval (step 3) is kept in oncall-run.json and reported as the cold-ish sample.
FR=results/frontier/$L; mkdir -p $FR/reuse-trials
for k in $(seq 1 10); do
  cp $FR/oncall-run.json $FR/reuse-trials/reuse-$k.json
  python3 -m experiments.oncall_infer reuse --state $FR/oncall-state --out $FR/reuse-trials/reuse-$k.json
done

# 5. Report (all runs side by side; runs are NOT pooled into one average)
python3 -m experiments.gb10_bench.evidence_report results/frontier/gb10-run1 results/frontier/gb10-run2 \
        results/frontier/gb10-run3 --out results/frontier/evidence_report.md
python3 -m experiments.gb10_bench.frontier_report report     # optional: the older merged table
```

Warm vs cold, stated plainly:
- **Model**: warm. Step 1 sends 2 discarded warm-up requests per concurrency before measuring, and OnCall runs after them. A cold-model first request is recorded only if the model was freshly loaded by someone else (note `docker inspect -f '{{.State.StartedAt}}'` of the vLLM container and run `FRONTIER_STAGES=oncall bash experiments/gb10_bench/frontier.sh <label>` as the first request). Do not restart, reload or switch the model to get it.
- **Reuse**: step 3 is the first reuse in a fresh state (new registry, sandbox start included); steps 4 trials are repeat runs. The report prints the first value alone and p50/p95 of the repeats.
- First-time LLM has n = 1 per run (it needs a person's approval). Three runs give three independent samples, shown separately. Do not call a mean of 3 a p95.

## 4. What to record by hand (not in any file)

- Authorizer name, operator name, UTC start and end, the label list.
- `SKILL_RUNNER` value, and whether `docker` containers were available.
- Which model profile was served and that you did not change it (`nemoclaw inference get --json` before and after).
- Anything you did that the scripts did not, as a manual hint (CLAUDE.md: record every manual hint).
- Screenshots only as supplementary (item 18 of the evidence map below).

## 5. Acceptance checks before any number is quoted

1. The report was produced without `--allow-mock` and has no MOCK banner.
2. "Model identity" says all files agree, and the served id matches `docs/SKILLFORGE.md`/the pitch wording.
3. First-time `model_calls` is at least 1 and `mode` was `LIVE_REAL_MODEL`; every counted reuse trial has `model_calls == 0`. "Trials failing the contract" is 0, or you report the failures.
4. Hidden suite result and approval (`kind: host_cli`, a person's name) are present, or the first-time row is quoted as "candidate not approved".
5. Quote reuse and first-time as two latencies with their scopes (section 1). The ratio line is context, not the headline.
6. Anything shown as "not measured" stays "not measured" in the slides.

Until these files exist, every GB10 figure in the pitch stays **pending GB10 evidence**.

## 6. Evidence map: item, source file, claim it supports

Paths: `EV/<cmd>` = `results/gb10-evidence/<UTC>-<cmd>/`, written by `deploy/gb10/sf-gb10.sh`; `FR` = `results/frontier/<label>/`, written by `sf-gb10.sh bench <label>` (which runs `experiments/gb10_bench/frontier.sh`). Merged report: `python -m experiments.gb10_bench.frontier_report report` writes `results/frontier/frontier.md` and `frontier.json`. Null or `[N/A]` stays null; never write 0.

| # | Item | Where it comes from | Supports the claim | Recorded (2026-10-25) |
|---|---|---|---|---|
| 1 | Hardware identity (host, arch, GPU name, driver) | `EV/preflight/console.txt`; `FR/identity.json` `host`, `gpu` | "Ran on a Dell GB10" | yes, [BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25) |
| 2 | vLLM image and version | `FR/identity.json` `container.image`, `server.vllm_version` | "served by vLLM <version>" | yes (0.21.0+2325b6f0.dev) |
| 3 | Served model id + revision | `EV/preflight/models.json`; `FR/identity.json` `model.revision` (may be null) | the model name in the pitch | id yes; revision not reported |
| 4-6 | `/health`, `/v1/models`, one chat completion | `EV/preflight/console.txt`, `models.json`, `check-llm.json` (`"mock": false`) | "local inference verified" | yes |
| 7-8 | TTFT p50/p95, decode tok/s | `FR/ttft-c<C>-<i>.json` `trials[]`; `frontier.md` | the TTFT and decode numbers | yes, per request |
| 9-10 | Unified memory, temperature | `FR/samples.csv`; preflight `MemAvailable` | headroom, "stayed under N C" | yes |
| 11 | OnCall model calls, synthesis wall ms (model requests + in-loop lint + the skill's own tests; not pure inference latency), tokens | `EV/oncall/oncall-run.json` `synthesis.*` | "the local model wrote the skill in N calls, T s" | yes (attempts 4 and 5 committed under `docs/evidence/gb10/`) |
| 12-13 | Generated code saved; hidden-test results | `synthesis.code`, `synthesis.provenance == "model"`, `mode == "LIVE_REAL_MODEL"`, `verification.hidden[]` | "model-written skill passed k/9 hidden cases" | yes |
| 14-15 | Approval by a person; skill version + sha256 | `EV/reuse/oncall-run.json` `approval.*`, `synthesis.skill_hash`; registry audit `skill_approved` | "a person approved it on the host", "hash-pinned skill" | yes (`host_cli`; name not identity-verified) |
| 16-17 | INC-2 reuse; INC-3 refusal | `reuse.state == "done"`, `model_calls == 0`, `latency_ms`; `refusal.state == "refused"` | "0 model calls on reuse", "lookalike refused" | yes, `docs/evidence/gb10/reuse-oncall-run.json` |
| 18 | Screenshots of `#/demo` scenes 4-6 (banners LIVE REAL MODEL, DETERMINISTIC SKILL; approval "Approved by <name>") | next to `EV/reuse/` | visual proof | not in this repository |
| 19 | Sandbox runner used | whether `SKILL_RUNNER=docker` was exported | "container-isolated verification" | subprocess runner for the timed runs; Docker re-verification of the approved skill is recorded in [LIMITATIONS.md](LIMITATIONS.md#evidence) |

Consistency checks before quoting anything: `generated_at` in `oncall-run.json` is later than the preflight time and
`host` is the GB10 hostname, not `<dev-box>`; `model.id` equals an id in `models.json`; the `skill_hash` in `EV/oncall`
equals the one in `EV/reuse`; the bench's OnCall run (`FR/oncall-run.json`) is a separate registry, so quote it as the
bench run, not as the demo run.
