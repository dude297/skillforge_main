# Demo guide

See also: [README](../README.md) for the overview, [GB10_SETUP.md](GB10_SETUP.md) for the hardware path.

Evidence kinds are kept apart: tests and measurements on the dev box, recorded simulation, and real hardware
verification. **There is no real hardware verification yet.**

Three kinds of step appear below, and they are never mixed up on screen or in speech:

| label | meaning | has it happened? |
|---|---|---|
| **LIVE MODEL** | a served local model (vLLM) answers prompts | **No.** No live model run has happened. Every LIVE MODEL step below is a procedure for the GB10, not a result. |
| **RECORDED SIMULATION** | the model's part is replaced by a hand-written reference skill, labelled as such; no model is called | yes, on the Windows dev box (`ui/public/demo/oncall-run.recorded.json`) |
| **DETERMINISTIC REUSE** | trusted code and an approved skill; no model client is constructed | yes, on the Windows dev box, inside the recorded simulation and the tests |

All incidents and records are synthetic. Commands run from the repository root.

## 1. OnCall: nine steps

Source: [experiments/oncall_infer/README.md](../experiments/oncall_infer/README.md).

| # | step | command | kind |
|---|---|---|---|
| 1 | Show the incident INC-1: `max_num_seqs` raised 128 → 1024, CUDA OOM, 429s | open `experiments/oncall_infer/fixtures/inc1_primary.json` | data (synthetic) |
| 2 | Reproduce the failing capacity check | `python experiments/oncall_infer/fixtures/capacity_check.py` | deterministic |
| 3a | Synthesize a skill with the model | `python -m experiments.oncall_infer run --live --base-url http://127.0.0.1:8000/v1` (`--model auto`, the default, uses the id served at `/v1/models`) | **LIVE MODEL (not done)** |
| 3b | …or use the recorded reference skill | `python -m experiments.oncall_infer run` | **RECORDED SIMULATION** |
| 4 | Verify the candidate: core lint, the skill's own tests, an INC-1 replay, the capacity check, the hidden suite (never in a prompt) | part of step 3 | deterministic |
| 5 | Stop: the candidate is `tested`, the run is `pending` | printed by step 3 | deterministic |
| 6 | A **person** approves on the host | `APP_DB="data/unified/demo/oncall/app.db" SKILLS_DIR="data/unified/demo/oncall/skills" HIDDEN_DIR="experiments/oncall_infer/hidden" python -m app skill approve oncall-serving-config-revert 1 --by "<your name>"` | human |
| 7 | INC-2 (same failure class, key `max_model_len`) is handled by the approved skill | `python -m experiments.oncall_infer reuse` | **DETERMINISTIC REUSE** (`model_calls: 0`) |
| 8 | INC-3 (disk full, lookalike) is refused | same `reuse` command | deterministic refusal |
| 9 | Show the result in the browser | guided demo `http://127.0.0.1:8766/#/demo`, or the console incident view `#/console/investigations/incident`; both read `GET /ui/demo/oncall` | read-only view |

Notes:
- `--live` fails loudly: if the endpoint, the model id or the synthesis fails, it exits with code 2 and writes
  nothing. It never falls back silently. Only `--allow-fallback` turns a failure into a labelled
  `RECORDED_SIMULATION`. On the GB10, `bash deploy/gb10/sf-gb10.sh oncall` wraps this step and keeps evidence
  ([GB10_SETUP.md](GB10_SETUP.md#portable-bundle-path)). `model_calls` counts chat requests with `LLM_RETRIES=0`; tokens are recorded only when the
  server returns `usage`, otherwise they stay null.
- Step 8: the core structural matcher reports an **exact** match for INC-3. The refusal comes from the experiment's
  incident fingerprint (exception type, failure category, top frames differ). The recorded reason is in
  `ui/public/demo/oncall-run.recorded.json` → `refusal.reason`.
- `GET /ui/demo/oncall` serves `data/unified/demo/oncall-run.json` if a local run exists, otherwise the recorded file.
  The response has `served_from`, so the source is always visible.
- In the recorded artifact, the approval in step 6 was typed by an agent into a throwaway registry with
  `--by "recorded-sim (agent, not a human)"`, so `approval.kind` is `simulated`. It is not a human approval, and the
  JSON says so. `approval.kind` is `host_cli` only when the `--by` text is not marked as an agent or test. Only
  `host_cli` counts as a person's decision in the UI, and the name is not identity-verified.
- The incident fingerprint is bound to the approved skill's registry row and fails closed. Core `match_skills` still
  says `exact` for INC-3 (a known core gap, documented by `test_core_matcher_false_positive_on_lookalike_is_a_known_gap`).
- No GPU telemetry is collected (`telemetry.gpu: null`).

Recorded result (dev box): hidden 9/9, regression 5/5, INC-2 reuse `model_calls: 0`, INC-3 refused
(`ui/public/demo/oncall-run.recorded.json`). Reuse latency was about 117–256 ms across recorded runs (256.0 ms in
the committed file). That is local match plus deterministic execution, not an inference saving: the first run made no
model call to compare against.

## 2. Supply chain: freight accruals (second domain)

Source: `scripts/unified.py`, [WORKFLOW_FREIGHT.md](WORKFLOW_FREIGHT.md). The channel is **simulated** (no Slack, no
NemoClaw channel); the skill library is a MOCK library written by a person.

```bash
python scripts/unified.py setup                      # synthetic workspace + MOCK skill library in data/unified/
python scripts/unified.py inspect                    # read-only Bootstrap inspection; writes nothing
python scripts/unified.py message "Week 2 freight accruals look off" --id m1   # SIMULATED employee message
python scripts/unified.py pending                    # what waits for a person
APP_DB=data/unified/app.db python -m app approve <id> --by <name>               # a person approves on the host
python scripts/unified.py complete <correlation_id>  # execute + independent verification + reply
python scripts/unified.py status
```

The message is routed (`experiments/router`), matched against the catalog (`experiments/catalog`), and handled by
the approved `freight-invoice-reconcile` skill when the match is exact, or sent to a person. Kind of each step:
routing and matching are deterministic; the skill run is DETERMINISTIC REUSE; no model is involved.

## 3. UI routes

Start the console with `./start-demo.ps1` or `bash start-demo.sh` (verified on Windows only), or with
`python scripts/unified.py console`, then open the one-time login link it prints. Base URL: `http://127.0.0.1:8766`.

| route | what it is |
|---|---|
| `#/` | the product story ("How it works") |
| `#/world/onboard` | Bootstrap Lite: five read-only steps over the real backend manifest |
| `#/world/bootstrap` | Bootstrap illustration (labelled as an illustration) |
| `#/world` | Daylight World: the runtime as a 2.5D office; story, recorded or live backend state, labelled |
| `#/console/overview`, `/investigations`, `/skills`, `/history`, `/benchmarks`, `/system` | operator console (read-only; approvals happen on the host CLI) |
| `#/console/investigations/incident` | console incident view of the OnCall run |
| `#/demo` | guided OnCall demo, see below |

**Guided demo** (`http://127.0.0.1:8766/#/demo`):
- Six scenes: company onboarding, the living company, an incident arrives, the fix becomes a tested skill, the next
  one takes the short path, technical proof.
- A mode banner names the source of what is shown (for example RECORDED SCRIPTED SIMULATION, DETERMINISTIC SKILL).
- Autoplay stops at the approval scene unless the run's `approval.state` is `approved`. A scripted approval in a
  recording is labelled as not a person's decision (`approval.kind: simulated`).
- Verified on the dev box: mock e2e 78/78, lint, typecheck and build clean, one local-backend browser rehearsal
  (reported by the owner; not re-run on this tree).

## 4. What to say about model use

- "No live model has run. The OnCall skill you see was written by hand and is labelled as a recorded simulation."
- "Reuse made zero model calls because no model client was constructed, not because a model was fast."
- "Nothing has run on the GB10 yet. The GB10 procedure is in [GB10_RUNBOOK.md](GB10_RUNBOOK.md)."

## 5. GB10 commands (not yet run)

None of these has been run. They need the GB10, a served model, and a named operator's authorization for GPU
inference ([GB10_BENCH_RUNBOOK.md](GB10_BENCH_RUNBOOK.md)).

OnCall with a live model ([experiments/oncall_infer/README.md](../experiments/oncall_infer/README.md)):

```bash
python -m experiments.oncall_infer run --live --base-url http://127.0.0.1:8000/v1   # --model auto = served id
# a PERSON types the printed command, e.g.
APP_DB="data/unified/demo/oncall/app.db" SKILLS_DIR="data/unified/demo/oncall/skills" \
  HIDDEN_DIR="experiments/oncall_infer/hidden" python -m app skill approve oncall-serving-config-revert 1 --by "<your name>"
python -m experiments.oncall_infer reuse
```

Compute frontier for the currently served model ([GB10_FRONTIER.md](GB10_FRONTIER.md)):

```bash
bash experiments/gb10_bench/frontier.sh <label> [--concurrency 1,2,4]
bash experiments/gb10_bench/frontier.sh <label> --after-approval     # after a PERSON approved the OnCall skill
python3 -m experiments.gb10_bench.frontier_report report             # merge results/frontier/*/
```

## 6. Reset

```bash
bash start-demo.sh --reset-demo --no-open           # deletes only data/unified/ (stop the console first)
```
