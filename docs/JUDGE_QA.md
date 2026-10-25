# Judge Q&A

Short answers first, then the evidence. Cite file paths when pushed. Never give a GB10 number that isn't in `results/`.

## How is this different from an ordinary agent, or a Hermes-style agent?
A simple tool-calling agent loop (a pattern we compare against, not a survey of products) sends every new request through the model, so each recurrence costs another round of inference, and whatever code comes out is used without an independent check. SkillForge calls the model **once** per incident class. It turns the result into an immutable program and checks it with tests the model never saw. A person approves it, and after that it runs without the model. Recurrences are handled deterministically, and a lookalike incident is refused. (If "Hermes" means a specific product, we haven't benchmarked against it. The comparison above is with the pattern of re-running the model on every request.)

## What is different?
Three design choices, tied together (we have not benchmarked them against other systems):
1. **Verified, approved, immutable executable skills.** The model writes the code. The host verifies it: static lint, the skill's own tests, a replay of INC-1, a capacity check, and a hidden suite. A person approves it on the host CLI. The approved files are pinned by sha256 (`app/skillforge.py` `approve_skill`).
2. **Deterministic reuse.** A compatible incident runs the pinned code. A `NoModel` guard counts any model call and fails the run if there is one (`experiments/oncall_infer/oncall.py`).
3. **Fail-closed refusal of lookalikes.** An incident fingerprint (exception type, component, failure category, top frames) must match the one stored when the skill was approved. If it differs or is missing, the incident is refused.

## Why the GB10?
- The logs, configs and code of an inference fleet are sensitive. With a local model, synthesis is designed to happen on the box with no cloud API (egress policy not yet verified on the GB10).
- 128 GB of unified memory (`docs/GB10_FRONTIER.md`) holds a 35B mixture-of-experts model (Qwen3.6-35B-A3B NVFP4, ~3B active parameters per token) together with the sandbox, verifier and console on one machine.
- Measured GB10 throughput, latency and memory headroom: **pending GB10** (`docs/GB10_EVIDENCE_CHECKLIST.md`).

## Why not just call the LLM every time?
Each call costs latency, GPU time and tokens, and it can give a different answer, so every answer would need review. Once a skill is approved, the same input gives the same output from code a person has already looked at. Reuse used 0 model calls in our runs, guard-enforced. We do **not** claim a measured speed-up: the recorded first run made no model call to compare against, and the live comparison is pending GB10.

## How are generated skills validated?
In order (`experiments/oncall_infer/oncall.py` `verify`):
1. Static lint: allowed imports only, no `open/eval/exec`, no dunder attributes, no unbounded loops (`app/skillforge.py` `lint`).
2. The skill's own tests, run in the sandbox.
3. INC-1 replay: the skill must propose reverting `max_num_seqs` 1024 -> 128.
4. Capacity check: it fails on the deployed config and passes with the proposed revert (simulated, never applied).
5. A hidden suite of 9 cases (`experiments/oncall_infer/hidden/`). It is never put in a prompt, and it includes two lookalikes that must produce no proposal.

The candidate is then staged as `tested` and the run stops.

## Who approves, and how?
- Only the host CLI: `python -m app skill approve <name> <version> --by "<name>"`. The browser API is GET-only; every other method returns 405 (`app/ui_api.py`).
- Approval re-runs the hidden suite and refuses if the candidate files' hash has changed since testing (`approve_skill`).
- The UI treats an approval as a person's only when `approval.kind == "host_cli"`. **Caveat:** the kind is inferred from the `--by` text (`oncall.py` ~line 372). The name is not identity-verified. The recorded run is labelled `simulated` ("recorded-sim (agent, not a human)").

## What stops unsafe or incorrect reuse?
- Core's structural matcher must report `exact`, **and** the incident fingerprint must equal the stored one. A missing fingerprint means refusal.
- **Known gap, stated plainly:** on its own, the core matcher calls the lookalike INC-3 `exact`. Core reuse paths outside OnCall don't check the fingerprint. Two things contain this: the OnCall skill lives in its own registry, which the console's core paths never open; and any approvable skill must pass the hidden lookalike cases, so even a direct core run on INC-3 proposes nothing (`test_core_path_bypass_yields_no_proposal`). A full fix needs a change to the frozen core (`experiments/oncall_infer/README.md`).
- Skills only **propose**: "revert X to Y, a person applies it". Nothing is applied automatically.

## Which measurements are real?
| Item | Real, dev box (Windows, no GPU) | Recorded / simulated | Stub | Pending GB10 |
|---|---|---|---|---|
| Hidden suite 9/9 | yes, for the hand-written reference skill | the skill is hand-written | | for model-written code |
| Reuse INC-2, 0 model calls | yes (guard) | | | on GB10 |
| Reuse latency 256 ms (`reuse.latency_ms`; other runs ~117-256 ms) | yes: match + execution, not inference | | | on GB10 |
| INC-3 refusal | yes | | | on GB10 |
| Approval | | simulated agent identity | | by a person (`host_cli`) |
| Synthesis model calls / latency / tokens | | null in the recording | | yes |
| TTFT, decode tok/s, memory, temperature | | | bench tests use fixtures (`experiments/gb10_bench/test_frontier.py`) | yes |
| Test suites: oncall + gb10_bench + contracts 33 passed, 1 skipped; UI mock e2e 78/78 | yes (re-run on this tree's code) | | the e2e runs against mock/recorded data | |

## Tough questions
**Is test-based verification a proof?** No. The run file says so: `"note": "tests, not a formal proof"`. It shows that the skill behaves correctly on cases it never saw, including lookalikes. That is evidence, not a guarantee, and it's why a person still approves the skill and its output is only a proposal.

**What if the model writes bad code?** It fails lint, its tests, the replay or the hidden suite. It's then recorded as `rejected`, never staged, and can't be approved. The UI shows the failed cases. We report that as the outcome. We don't swap in the reference skill.

**How secure is the sandbox?** By default it's a child process running on a throwaway copy of the skill, with a scrubbed environment, a 15 s timeout and POSIX rlimits (CPU 10 s, 1 GB address space, 1 MB file size, 64 open files). It also runs behind the static lint. That is **not** network isolation. With `SKILL_RUNNER=docker`, each run is a throwaway container: `--network none`, read-only root, 512 MB, 64 pids, no capabilities, unprivileged user (`app/skillforge.py` `sandbox`). The lint is an early filter, not a proof that the code is safe. Say which runner the demo used.

**The 15 s timeout?** Under heavy GPU load, verification can time out. The candidate is then rejected, never passed. We re-run when the GPU is idle and don't raise the timeout.

**Is the incident data real?** No. INC-1, INC-2 and INC-3 are synthetic and hand-written (`experiments/oncall_infer/fixtures/`), modelled on real vLLM failure modes.
