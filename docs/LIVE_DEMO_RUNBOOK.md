# Live demo runbook (GB10, judges watching)

The run starts with real inference and ends with deterministic reuse plus a refusal. Every command writes `results/gb10-evidence/<UTC>-<cmd>/` (see `deploy/gb10/sf-gb10.sh`). Times marked *est.* are estimates; nothing has been timed on a GB10 yet.

**Ground rules**
- Never present the recorded run as live. The banner on `#/demo` says LIVE REAL MODEL only when `mode == LIVE_REAL_MODEL` and `synthesis.provenance == "model"` (`ui/src/data/oncall.ts:44`).
- If a model-written skill fails verification, that is the result to show. Do not swap in the recorded skill.
- Only a person types the approve command. The UI counts an approval as a person's decision only when `approval.kind == "host_cli"`. That label comes from the `--by` text, so type your own real name. The name is not identity-verified.

## 0. Before judges arrive (T-30 min)
| Step | Command | Expect | Time |
|---|---|---|---|
| Bundle | `cd ~/skillforge-live && sha256sum -c skillforge-gb10-*.tar.gz.sha256` | `OK` | 5 s |
| Preflight | `bash deploy/gb10/sf-gb10.sh preflight` | `PREFLIGHT: PASS -> LIVE INFERENCE VERIFIED` | 10-120 s (check-llm timeout 120 s on a cold first request) |
| Optional: stronger sandbox | `docker image inspect --platform linux/arm64 python:3.12-slim` succeeds -> `export SKILL_RUNNER=docker` in every terminal you use | image present | 2 s |
| Optional: bench | `bash deploy/gb10/sf-gb10.sh bench gb10-qwen36-35b` (writes `results/frontier/<label>/`) | `stages.tsv` all `ok` | *est.* 5-20 min. **Finish it before the demo**: it loads the GPU and runs its own OnCall synthesis |

**GO/NO-GO 1:** preflight PASS -> live sequence (A). FAIL -> fallback (B). Don't debug vLLM in front of judges.

If you skip `SKILL_RUNNER=docker`, skills run in a subprocess sandbox: scrubbed environment, POSIX rlimits, static lint. If asked, say so; don't claim network isolation.

## A. Live sequence (~6-10 min, *est.*)
| # | Do | Say | Time |
|---|---|---|---|
| A1 | Show the preflight output (or its folder) | "The model is served locally by vLLM on this GB10. Here are `/health`, `/v1/models` and one real chat completion. Nothing goes to the cloud." | 30 s |
| A2 | `bash deploy/gb10/sf-gb10.sh oncall` | "INC-1 is a synthetic incident: a deploy raised `max_num_seqs`, the GPU ran out of memory, and the gateway returned 429s. The local model is now writing a diagnostic skill: code plus tests." | *est.* 1-5 min (2 attempts max, 300 s request timeout each) |
| A3 | While it runs, open `#/demo` scenes 1-3 in the browser (start the console first in another terminal: `bash deploy/gb10/sf-gb10.sh demo`, open the printed login link) | "That's the workspace onboarding and the evidence, each item with the file it came from." | overlaps A2 |
| A4 | When it prints `STOP.`, open `results/gb10-evidence/<latest>-oncall/oncall-run.json` or scene 4 (reload) | "The host checked it: lint, the skill's own tests, a replay of INC-1, a capacity check, and nine hidden cases the model never saw. It is now `tested`, not runnable." | 60 s |

**GO/NO-GO 2** (scene 4 after a reload):
- Banner shows **LIVE REAL MODEL**, "Who wrote the code" names the model, verification **passed**, approval **Waiting for a person** -> go to A5.
- Verification **failed** -> say: "The model's skill failed the hidden checks, so it was rejected and can't be approved. That is the safety property working." Show the failing case names. Then either re-run A2 once (if time allows) or go to B for reuse and refusal, clearly labelled as recorded.
- `oncall` exited 2 (`--live` fails loudly, nothing new written) -> check `generated_at` in scene 6. An older file may still be on disk, so **don't show it as this run**. Go to B.
- Hidden cases show `timeout after 15s` -> see Recovery.

| # | Do | Say | Time |
|---|---|---|---|
| A5 | **A person** types the printed command with their own name: `APP_DB=... SKILLS_DIR=... HIDDEN_DIR=... python3 -m app skill approve oncall-serving-config-revert 1 --by "<your name>"` | "The browser can't approve anything. Approval happens on the host, re-runs the hidden suite, and checks the files still match the recorded sha256." | 20-40 s |
| A6 | `bash deploy/gb10/sf-gb10.sh reuse` | "INC-2: same class of failure, different service and key. It runs the approved skill as fixed code. A guard fails the run if any model call is made. INC-3 looks the same structurally, but it's a full disk. Its fingerprint differs, so it's refused." | *est.* 5-15 s |
| A7 | Reload `#/demo`, scene 4 -> 5 -> 6 | Scene 4: "Approved by <name>, at <time>." Scene 5: "0 model requests on reuse, measured latency X ms. That's match plus execution, not a benchmark." Scene 6: "Every number here comes from the run file: version, hash, approver, tests, audit trail." | 90 s |

End on scene 5 (refusal panel): "It doesn't guess outside its contract."

## B. Fallback: recorded simulation (~3 min)
Use it when preflight fails, the model is down, or `oncall` fails. Start `bash deploy/gb10/sf-gb10.sh demo` (or `start-demo.sh --no-open` on any laptop) and open `#/demo`.

Say first, before any scene: **"This is a recorded simulation. The code is a hand-written reference, not model output, and the approval was typed by an agent, not a person. The banner says so."**

| Scene | Say |
|---|---|
| 1-3 | Onboarding, office, evidence (same as A3). |
| 4 | "RECORDED SCRIPTED SIMULATION. The code is a hand-written reference. The approval is labelled 'Not a person's decision'. The verification flow is the real one: nine hidden cases." |
| 5 | "This part is genuinely deterministic. It ran on this machine: 0 model calls on INC-2, and INC-3 refused by the fingerprint." (Banner: DETERMINISTIC SKILL.) |
| 6 | "Provenance for every field. Fields we didn't measure say 'not measured'." |

If the GB10 came up but the live run failed, also say: "The live attempt is in `results/gb10-evidence/`; here is what it did." Show the console.txt. Never say the GB10 produced the recorded numbers.

## Recovery
| Symptom | Action | Never |
|---|---|---|
| Hidden case `timeout after 15s` (core sandbox, `app/skillforge.py:199`) | The candidate was rejected, not passed. Stop `bench` or any other GPU load and wait until `nvidia-smi` shows the GPU idle. Re-run `sf-gb10.sh oncall` once; it rebuilds its throwaway registry. If it times out again, say so and go to B for reuse. | raise the timeout (core change); substitute the recorded skill |
| `oncall` exit 2 | Read `console.txt` in the evidence folder: endpoint, model id, or a reply that couldn't be parsed. `MODEL=<served id>` pins the id. | `--allow-fallback` while presenting as live |
| Approve says the hash does not match or the hidden suite failed | Don't retry with other files. Re-run `oncall`. | edit files under `data/unified/demo/oncall/` |
| Port 8766 busy | The launcher attaches or moves to the next port; read the printed URLs. | kill processes you didn't start |
| Login link expired (10 min) | `python3 scripts/unified.py link --port 8766` | |

## After the demo
Copy `results/gb10-evidence/` and `results/frontier/` to the SSD. Capture screenshots of `#/demo` scenes 4-6 for `docs/GB10_EVIDENCE_CHECKLIST.md`.
