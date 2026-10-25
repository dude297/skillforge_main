# Demo guide

The single demo document: what each kind of step is, the OnCall steps, the host-side live sequence, the browser route,
the fallback and recovery, the second (freight) workflow, UI routes and reset. Overview: [README](../README.md).
Words to say: [JUDGE_PITCH.md](JUDGE_PITCH.md), [JUDGE_QA.md](JUDGE_QA.md). Hardware path: [GB10_SETUP.md](GB10_SETUP.md).

Three kinds of step are never mixed up on screen or in speech:

| label | meaning | status |
|---|---|---|
| **LIVE MODEL** | a served local model (vLLM) answers prompts | has run on the GB10 (2026-10-25): Qwen3.6-35B-A3B wrote an OnCall skill that passed the hidden suite 9/9 once (attempt 4). Generation is not reliable: 3 of 7 passed in the later evaluation with thinking on, 4 of 9 pooled with the earlier revised-prompt attempts ([BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25)). Every failing candidate was rejected by the verifier. |
| **RECORDED SIMULATION** | the model's part is replaced by a hand-written reference skill, labelled as such; no model is called | the committed recording `ui/public/demo/oncall-run.recorded.json` (dev box) |
| **DETERMINISTIC REUSE** | trusted code and an approved skill; no model client is constructed | on the dev box (recording and tests) and on the GB10 (6 trials after a person's approval, subprocess runner) |

All incidents and records are synthetic. Commands run from the repository root.

## 1. OnCall: nine steps

Source: [experiments/oncall_infer/README.md](../experiments/oncall_infer/README.md).

| # | step | command | kind |
|---|---|---|---|
| 1 | Show the incident INC-1: `max_num_seqs` raised 128 → 1024, CUDA OOM, 429s | open `experiments/oncall_infer/fixtures/inc1_primary.json` | data (synthetic) |
| 2 | Reproduce the failing capacity check | `python experiments/oncall_infer/fixtures/capacity_check.py` | deterministic |
| 3a | Synthesize a skill with the model | `python -m experiments.oncall_infer run --live --base-url http://127.0.0.1:8000/v1` (`--model auto`, the default, uses the id served at `/v1/models`) | **LIVE MODEL** |
| 3b | or use the recorded reference skill | `python -m experiments.oncall_infer run` | **RECORDED SIMULATION** |
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
- The recorded run collects no GPU telemetry (`telemetry.gpu: null`).

Recorded result (dev box): hidden 9/9, regression 5/5, INC-2 reuse `model_calls: 0`, INC-3 refused
(`ui/public/demo/oncall-run.recorded.json`). Reuse latency was about 117–256 ms across recorded runs (256.0 ms in
the committed file): local match plus deterministic execution, not an inference saving.

GB10 result (2026-10-25, subprocess runner): the attempt-4 skill, approved by a person (the operator; `--by` name not
identity-verified), was reused on INC-2 with 0 model calls (6 trials, p50 28.2 ms) and INC-3 was refused every time
([BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25)).

## 2. Truth banners (`#/demo`)

Open `#/demo` at 1440 px wide (also fine at 1024, 768, 390). The coloured banner under the top bar is the truth
label on every scene. Read it aloud first.

| Banner | Means | Say |
|---|---|---|
| LIVE REAL MODEL | `mode == LIVE_REAL_MODEL` and code provenance is `model` | "The local model wrote this code, a few minutes ago." |
| RECORDED SCRIPTED SIMULATION | recorded file, hand-written reference code | "This is a recorded simulation. The code is not model output." |
| DETERMINISTIC SKILL | scene 5 only, when reuse actually ran | "Fixed code ran: no model, no agent." |
| UNAVAILABLE | no valid run file | Say so; go to Recovery. Nothing is filled in. |

Keys: Right/Left = next/previous scene, Space = Play/Pause, N = notes (presenter). Autoplay stops at scene 4 while the
skill is not approved. Six scenes: company onboarding, the living company, an incident arrives, the fix becomes a
tested skill, the next one takes the short path, technical proof. Approval in a recording is labelled as not a
person's decision (`approval.kind: simulated`).

## 3. Live sequence on the GB10 (host side)

Every command writes `results/gb10-evidence/<UTC>-<cmd>/` (see `deploy/gb10/sf-gb10.sh`). Ground rules:
- Never present the recorded run as live. The banner says LIVE REAL MODEL only when `mode == LIVE_REAL_MODEL` and
  `synthesis.provenance == "model"` (`ui/src/data/oncall.ts:44`).
- If a model-written skill fails verification, that is the result to show. Do not swap in the recorded skill.
- Only a person types the approve command; type your own real name (it is not identity-verified).

Before judges arrive:

| Step | Command | Expect |
|---|---|---|
| Bundle | `cd ~/skillforge-live && sha256sum -c skillforge-gb10-*.tar.gz.sha256` | `OK` |
| Preflight | `bash deploy/gb10/sf-gb10.sh preflight` | `PREFLIGHT: PASS -> LIVE INFERENCE VERIFIED` (10-120 s; check-llm timeout 120 s on a cold first request) |
| Stronger sandbox | `docker image inspect --platform linux/arm64 python:3.12-slim`, then `export SKILL_RUNNER=docker` in every terminal | image present |
| Optional bench | `bash deploy/gb10/sf-gb10.sh bench <label>` writes `results/frontier/<label>/`. Finish it before the demo: it loads the GPU and runs its own OnCall synthesis | `stages.tsv` all `ok` |

Preflight PASS: run the live sequence. FAIL: use the fallback (section 5); do not debug vLLM in front of judges. Without
`SKILL_RUNNER=docker`, skills run in a subprocess sandbox (scrubbed environment, POSIX rlimits, static lint); say so and
do not claim network isolation.

| # | Do | Say |
|---|---|---|
| A1 | Show the preflight output | "The model is served locally by vLLM on this GB10: `/health`, `/v1/models`, one real chat completion." |
| A2 | `bash deploy/gb10/sf-gb10.sh oncall` | "INC-1: a deploy raised `max_num_seqs`, the GPU ran out of memory, the gateway returned 429s. The local model is writing a diagnostic skill: code plus tests." (up to 2 attempts, 300 s request timeout each; one successful run took 173.0 s) |
| A3 | Meanwhile start the console (`bash deploy/gb10/sf-gb10.sh demo`), open the printed login link and `#/demo` scenes 1-3 | "Workspace onboarding and evidence, each item with the file it came from." |
| A4 | When it prints `STOP.`, open `results/gb10-evidence/<latest>-oncall/oncall-run.json` or scene 4 (reload) | "Lint, the skill's own tests, a replay of INC-1, a capacity check, nine hidden cases the model never saw. It is `tested`, not runnable." |

Check at scene 4 (after a reload): banner LIVE REAL MODEL, "Who wrote the code" names the model, verification passed,
approval "Waiting for a person" leads to A5. Verification failed: say "The model's skill failed the hidden checks, so it
was rejected and cannot be approved. That is the safety property working", show the failing case names, then re-run A2
once or use the fallback for reuse and refusal, clearly labelled. `oncall` exit 2 (`--live` fails loudly, nothing new
written): check `generated_at` in scene 6; an older file may still be on disk, so do not show it as this run. Hidden cases
showing `timeout after 15s`: see Recovery.

| # | Do | Say |
|---|---|---|
| A5 | **A person** types the printed command with their own name: `APP_DB=... SKILLS_DIR=... HIDDEN_DIR=... python3 -m app skill approve oncall-serving-config-revert 1 --by "<your name>"` | "The browser cannot approve anything. Approval happens on the host, re-runs the hidden suite and checks the files still match the recorded sha256." |
| A6 | `bash deploy/gb10/sf-gb10.sh reuse` | "INC-2: same class of failure, different service and key. It runs the approved skill as fixed code; a guard fails the run if any model call is made. INC-3 looks the same structurally but is a full disk; its fingerprint differs, so it is refused." |
| A7 | Reload `#/demo`, scene 4 → 5 → 6 | Scene 4: "Approved by <name>, at <time>." Scene 5: "0 model requests on reuse, measured latency X ms: match plus execution, not a benchmark." Scene 6: "Every number comes from the run file." |

End on scene 5 (refusal panel): "It doesn't guess outside its contract."

After the demo, copy `results/gb10-evidence/` and `results/frontier/` to the SSD; screenshots of `#/demo` scenes 4-6 are
supplementary evidence ([EVIDENCE_PROTOCOL.md](EVIDENCE_PROTOCOL.md)).

## 4. Browser route (live variant, about 6 minutes)

| t | Click / key | Scene | Point to |
|---|---|---|---|
| 0:00 | Open `#/demo` | 1 Company onboarding | Banner, then the five steps ("read-only discovery; nothing here writes") |
| 0:30 | Right | 2 Enter the living company | Ember and the rooms ("Ember is only an indicator; it follows the run file") |
| 0:50 | Right | 3 An incident arrives | INC-1 evidence list with file paths |
| 1:20 | Right | 4 The fix becomes a tested skill | "Who wrote the code", hidden-test list, approval box |
| 2:20 | (host) a person types the approve command, reload `#/demo`, Right x3 | 4 | "Approved by <name>" ("the browser cannot approve") |
| 3:00 | Right | 5 The next one takes the short path | INC-2 table (model requests, latency), INC-3 refusal. Latency is one measured run, not a benchmark |
| 4:00 | Right | 6 Technical proof | Inspector: Approval, Reuse, Audit trail. Fields not measured say "not measured" |
| 5:00 | "Open in the console" | Console, Investigations, OnCall incident | Same proof, same banner; close on the INC-3 refusal |

## 5. Fallback: recorded simulation (about 3 minutes)

Use it when preflight fails, the model is down, or `oncall` exits 2. Serve the UI (`bash deploy/gb10/sf-gb10.sh demo`,
`bash start-demo.sh --no-open` on any laptop, or `npm run preview` in `ui/` and open `http://127.0.0.1:4173/#/demo`).
Hosted read-only preview: https://skillforge-ui-lab.vercel.app.

Say first, before any scene: **"This is a recorded simulation. The code is a hand-written reference, not model output,
and the approval was typed by an agent, not a person. The banner says so."**

| Scene | Say |
|---|---|
| 1-3 | Onboarding, office, evidence with source paths (Play runs about 90 s to scene 4). |
| 4 | "RECORDED SCRIPTED SIMULATION. Approval is labelled 'not a person's decision'. The verification flow is the real one: nine hidden cases." Autoplay pauses here; press Right. |
| 5 | "Genuinely deterministic, ran on this machine: 0 model calls on INC-2, INC-3 refused by the fingerprint." (Banner: DETERMINISTIC SKILL.) |
| 6 | "Provenance for every field." |

If the GB10 came up but the live attempt failed, also say so and show `console.txt` from the evidence folder. Never say
the GB10 produced the recorded numbers.

## 6. Recovery

| Symptom | Action | Never |
|---|---|---|
| Hidden case `timeout after 15s` (core sandbox, `app/skillforge.py:199`) | The candidate was rejected, not passed. Stop `bench` or any other GPU load, wait until `nvidia-smi` shows the GPU idle, re-run `sf-gb10.sh oncall` once. If it times out again, say so and use the fallback for reuse. | raise the timeout (core change); substitute the recorded skill |
| `oncall` exit 2 | Read `console.txt` in the evidence folder: endpoint, model id, or an unparseable reply. `MODEL=<served id>` pins the id. | `--allow-fallback` while presenting as live |
| Approve says the hash does not match or the hidden suite failed | Do not retry with other files. Re-run `oncall`. | edit files under `data/unified/demo/oncall/` |
| Scene 1 says "Discovery failed" | The operator API is not running or the login link expired (10 min). Continue to scene 2. Renew: `python3 scripts/unified.py link --port 8766`. | |
| Banner UNAVAILABLE, scenes 3-6 say "No OnCall run to show" | No valid run file. Serve from the host (`python -m app ui`) or rebuild with `ui/public/demo/oncall-run.recorded.json`. | edit the file |
| Console shows "not connected" or stale data | Intended: the UI never falls back from live to synthetic. Use `#/demo` (recorded, labelled). | |
| Page stale after a new `oncall` run | Reload; the run is read once per page load. | |
| Port 8766 busy | The launcher attaches or moves to the next port; read the printed URLs. | kill processes you did not start |

## 7. Supply chain: freight accruals (second domain)

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
the approved `freight-invoice-reconcile` skill when the match is exact, or sent to a person. Routing and matching are
deterministic; the skill run is DETERMINISTIC REUSE; no model is involved.

## 8. UI routes

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
| `#/demo` | guided OnCall demo |

Verified on the dev box: mock e2e 78/78, lint, typecheck and build clean, one local-backend browser rehearsal (reported
by the owner; not re-run on this tree).

## 9. What to say about model use

- Recorded run: "The OnCall skill you see was written by hand and is labelled as a recorded simulation."
- Live run: "A local model wrote this skill; the host verified it with checks the model never saw. Generation is not
  reliable: it passed in 3 of 7 later attempts, and every failing candidate was rejected."
- "Reuse made zero model calls because no model client was constructed, not because a model was fast."

## 10. GB10 compute frontier

For the currently served model ([GB10_FRONTIER.md](GB10_FRONTIER.md)):

```bash
bash experiments/gb10_bench/frontier.sh <label> [--concurrency 1,2,4]
bash experiments/gb10_bench/frontier.sh <label> --after-approval     # after a PERSON approved the OnCall skill
python3 -m experiments.gb10_bench.frontier_report report             # merge results/frontier/*/
```

## 11. Reset

```bash
bash start-demo.sh --reset-demo --no-open           # deletes only data/unified/ (stop the console first)
```
