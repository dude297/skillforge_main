# GB10 evidence checklist

Collect this evidence on the GB10. Until an item is ticked, the claim it unlocks stays "pending GB10" in `docs/JUDGE_PITCH.md` and `docs/JUDGE_QA.md`. Null or `[N/A]` stays null; never write 0.

Paths:
- `EV/<cmd>` = `results/gb10-evidence/<UTC>-<cmd>/`, written by `deploy/gb10/sf-gb10.sh`.
- `FR` = `results/frontier/<label>/`, written by `sf-gb10.sh bench <label>` (which runs `experiments/gb10_bench/frontier.sh`).
- Merged report: `python3 -m experiments.gb10_bench.frontier_report report` -> `results/frontier/frontier.md` and `frontier.json`.

| # | Item | Where it comes from | Unlocks the claim |
|---|---|---|---|
| 1 | Hardware identity (host, arch, GPU name, driver) | `EV/preflight/console.txt` (header + `gpu` INFO line); `FR/identity.json` `host`, `gpu` | "Ran on a Dell GB10" |
| 2 | vLLM image and version | `FR/identity.json` `container.image`, `container.image_version_label`, `server.vllm_version`; `EV/preflight/console.txt` (managed vLLM container) | "served by vLLM <version>" |
| 3 | Served model id + revision | `EV/preflight/models.json` `data[].id`; `FR/identity.json` `model.revision` + `revision_source` (may be null) | the model name in the pitch |
| 4 | `/health` | `EV/preflight/console.txt` `PASS GET .../health` | "local inference verified" (with 5 and 6) |
| 5 | `/v1/models` | `EV/preflight/models.json` | same |
| 6 | One chat completion | `EV/preflight/check-llm.json` (`"mock": false`, `model`, `elapsed_s`) | same |
| 7 | TTFT p50/p95 | `FR/ttft-c<C>-<i>.json` `trials[].first_token_s`; merged in `frontier.md` | the TTFT number |
| 8 | Decode tok/s | `FR/ttft-c*.json` `trials[].decode_tok_s`; `frontier.md` | the decode throughput number |
| 9 | GPU memory / MemAvailable | `FR/samples.csv` `mem_used_mib` (may be blank on unified memory), `mem_available_kib`; preflight `MemAvailable` | "fits in unified memory with X GiB headroom" |
| 10 | Temperature | `FR/samples.csv` `temp_c`; `FR/stages.tsv` guard lines | "stayed under N °C" (optional) |
| 11 | OnCall model calls, synthesis wall ms (= model requests + in-loop lint + the skill's own tests; not pure inference latency), tokens | `EV/oncall/oncall-run.json` `synthesis.model_calls`, `latency_ms`, `prompt_tokens`, `completion_tokens` (tokens null if the server sent no `usage`) | "the local model wrote the skill in N calls, T s" |
| 12 | Generated code saved | `EV/oncall/oncall-run.json` `synthesis.code` + `synthesis.provenance == "model"`, `mode == "LIVE_REAL_MODEL"`; files in `data/unified/demo/oncall/skills/candidates/` | "model-written code" |
| 13 | Hidden-test results | `EV/oncall/oncall-run.json` `verification.hidden[]`, `regression[]`, `passed` | "model-written skill passed k/9 hidden cases" |
| 14 | Approval by a person | `EV/reuse/oncall-run.json` `approval.state == "approved"`, `kind == "host_cli"`, `by`, `at` | "a person approved it on the host" |
| 15 | Skill version + sha256 | `EV/reuse/oncall-run.json` `synthesis.skill_version`, `skill_hash`; registry audit `skill_approved` | "immutable, hash-pinned skill" |
| 16 | INC-2 reuse | `EV/reuse/oncall-run.json` `reuse.state == "done"`, `model_calls == 0`, `latency_ms` (match + run_skill, no validation or approval), `path` | "0 model calls on reuse, N ms on GB10" |
| 17 | INC-3 refusal | `EV/reuse/oncall-run.json` `refusal.state == "refused"`, `reason` | "lookalike refused on GB10" |
| 18 | Screenshots of `#/demo` | scenes 4, 5 and 6 with the banner reading **LIVE REAL MODEL** (scene 4), **DETERMINISTIC SKILL** (scene 5), and approval "Approved by <name>" without the "Not a person's decision" line; save next to `EV/reuse/` | the visual proof for the judges |
| 19 | Sandbox runner used | whether `SKILL_RUNNER=docker` was exported (write it in `EV/*/console.txt` or your notes) | "container-isolated verification" (docker only) |

## Consistency checks before you quote anything
- `oncall-run.json` `generated_at` is later than the preflight time, and `host` is the GB10 hostname, not `<dev-box>`.
- `model.id` equals an id in `models.json`.
- The `skill_hash` in `EV/oncall` equals the one in `EV/reuse`.
- The bench's OnCall run (`FR/oncall-run.json`) is a **separate** registry. Quote it as the bench run, not as the demo run.

For the comparison report (first-time LLM vs reuse, N trials, provenance): `docs/EVIDENCE_PROTOCOL.md`.
